/**
 * Class 0x31 — the wall-crawler and the thrower.
 *
 * Four character types share one 35-state machine and four **behaviour sets**,
 * and which set a spawn gets is a byte in its own descriptor. `zsass` (set 1)
 * stands out of reach and throws; `zstin` (set 0) is the one that moves —
 * it walks in, circles onto the walls and the ceiling at middle range, and
 * when you let it inside thirty units it waits for the attack permit and
 * **arcs onto you with a knife**, connecting on a frame of the leap clip
 * rather than on any range test, then leaps back out to one side.
 *
 * The shape worth holding on to is that none of that is written as behaviour.
 * `ThrowerPickNextState` turns one distance into a band, draws a state id out
 * of a table, and `ThrowerTryEnterState` says yes or no. The repertoire is
 * data; the code is a gate.
 */
import type { Events } from "../../core/events";
import { CountEnemyThrowerIn } from "../combat/counts";
import type { Rng } from "../../core/rng";
import type { ThrowHandJson } from "../../bundle";
import { ActorFlag, DamageZone, type Actor } from "../actor";
import type { ActorDebug } from "../registry";
import { TurnActorTowardCamera } from "../actor_turn";
import { ReleaseAttackSlot, ThrowerTryClaimAttackSlot } from "../combat/permits";
import { G } from "../globals";
import type { GameHost } from "../host";
import { CharacterTypeOf, MotionOf, ThrowHandsOf } from "../tables";
import { vec3, type Vec3 } from "../vec";
import { GAME_HZ } from "../class30/states";
import { ThrowerStateLeapToPoint } from "./leap";
import {
  ThrowerStateDelayedPounce, ThrowerStateEntranceClip, ThrowerStateWalkDistance,
} from "./entrance";
import { ThrowerStatePathFollow } from "./path";
import {
  ThrowerStateLeapAside, ThrowerStateLeapDown, ThrowerStateWithdraw,
} from "./pounce";
import {
  ThrowerStateStandAndDecide, ThrowerStateWaitForPermit,
} from "./stand";
import { ThrowerSnapToSurface, ThrowerStateLeapToSurface } from "./surface";
import { ThrowerOnShot } from "./on_shot";
import {
  ThrowerStateCorpse, ThrowerStateDeathClip, ThrowerStateFallAndLand,
  ThrowerStateFallToSurface, ThrowerLeave,
} from "./death";
import {
  ThrowerStateGetUp, ThrowerStateHitReaction, ThrowerStateKnockedTumbling,
} from "./react";
import {
  ThrowerStateCloseAndStrike, ThrowerStateRearm, ThrowerStateRestoreBothHands,
  ThrowerStateStrikeOnTheSpot,
} from "./standing";
import {
  ThrowerStateBlinkInThreeHops, ThrowerStateGrabPlayer, ThrowerStateLeapStrike,
  ThrowerStateRideObjectPath, ThrowerStateWaitForCue,
} from "./scripted";
import { ThrowerStanceOf } from "./tables";
import { ThrowerState, ThrowSub } from "./states";

/** Hands whose arm has not been shot off. `ThrowerStateThrow` refuses the rest. */
function usableHands(obj: Actor): ThrowHandJson[] {
  return ThrowHandsOf(obj)
    .filter((h) => (obj.zones & DamageZone.All & h.cancel_mask) !== h.cancel_mask);
}

/**
 * `AimThrownWeapon` — `FUN_004503D0`. A point `aim_ahead` in front of the
 * camera; the camera looks down its own local -Z, which is where the player is.
 */
export function AimThrownWeapon(obj: Actor, host: GameHost, eye: Vec3,
                                out: Vec3): void {
  const cfg = CharacterTypeOf(obj)?.throw;
  host.aimPoint(cfg?.aim_ahead ?? 0, out);
  out.y = eye.y;
}

/**
 * `SpawnThrownWeapon` — `FUN_004504E0`. The hand goes bare and the weapon
 * takes off.
 */
export function SpawnThrownWeapon(obj: Actor, hand: ThrowHandJson,
                                  host: GameHost, eye: Vec3,
                                  events?: Events): void {
  const cfg = CharacterTypeOf(obj)?.throw;
  if (!cfg) return;
  const from = vec3();
  if (!host.boneWorld(obj.at, hand.bone, from)) return;

  host.setBoneSlot(obj.at, hand.bone, hand.bare);
  obj.zones |= hand.cancel_mask & DamageZone.All;

  const target = vec3();
  AimThrownWeapon(obj, host, eye, target);
  const d = Math.hypot(target.x - from.x, target.y - from.y,
                       target.z - from.z);
  const ttl = Math.max(1, d / cfg.speed);
  G.g_thrown_weapons.push({
    id: G.g_thrown_next_id++,
    from: obj.at,
    slot: hand.projectile,
    pos: from,
    vel: vec3((target.x - from.x) / ttl, (target.y - from.y) / ttl,
              (target.z - from.z) / ttl),
    ttl,
    // Which hand it left decides which way it tumbles.
    spin: hand.bone === 5 ? cfg.spin : -cfg.spin,
    spinAngle: 0,
    after: 0,
    hit: false,
    stickFrames: cfg.stick_frames,
    blinkFrames: cfg.blink_frames,
    visible: true,
  });
  events?.emit("enemy.threw", { at: obj.at, who: obj.name });
}

/**
 * Put one hand's weapon back.
 *
 * [diverges] Not `ThrowerStateRearm` (`FUN_0044F7A0`), which is class 0x31's
 * state 29 and lives in `standing.ts`: that one is character type 0x16's, has
 * its own clip and restores *both* hands on the clip's midpoint. This is the
 * one-hand swap the port's throw loop does on its way out, and it exists
 * because the port's throw is a loop where the engine's is a state.
 */
function ThrowerRearmHand(obj: Actor, hand: ThrowHandJson,
                          host: GameHost): void {
  if (hand.held) host.setBoneSlot(obj.at, hand.bone, hand.held);
  obj.zones &= ~(hand.cancel_mask & DamageZone.All);
}

/**
 * `ThrowerStateThrow` — `FUN_0044FAF0`. Play the clip, let go on the exact
 * frame the hand names, then re-arm and give the permit up so the next enemy —
 * or this one — can take a turn.
 */
export function ThrowerStateThrow(obj: Actor, host: GameHost, eye: Vec3,
                                  events?: Events): void {
  const hands = usableHands(obj);
  if (!hands.length) {
    if (obj.attackPermit >= 0) ReleaseAttackSlot(obj);
    obj.state = ThrowerState.StandAndDecide;
    obj.sub = 0;
    return;
  }
  if (obj.attackPermit < 0) {
    // The engine only ever *enters* this state with a permit —
    // `ThrowerTryEnterState`'s case `0x1F` claims one first and refuses
    // otherwise — so an actor here without one has nothing to do. Looping
    // instead left a `zslman` walking into the camera on its idle's root
    // motion while it waited for a permit that the hub would have asked for.
    if (!ThrowerTryClaimAttackSlot(obj, host)) {
      obj.state = ThrowerState.StandAndDecide;
      obj.sub = 0;
      return;
    }
    obj.sub = ThrowSub.Draw;
  }

  const hand = hands[Math.min(Math.max(0, obj.attack), hands.length - 1)];
  if (obj.sub === ThrowSub.Draw) {
    obj.attack = hands.indexOf(hand);
    obj.action = { motion: hand.motion, t: 0, loop: false };
    obj.sub = ThrowSub.Winding;
    return;
  }

  const m = MotionOf(obj, hand.motion);
  if (!obj.action || !m) {
    if (obj.sub === ThrowSub.Thrown) ThrowerRearmHand(obj, hand, host);
    ReleaseAttackSlot(obj);
    obj.sub = ThrowSub.Draw;
    obj.attack = (obj.attack + 1) % hands.length;
    return;
  }
  if (obj.sub === ThrowSub.Winding && obj.action.t * GAME_HZ >= hand.release_frame) {
    obj.sub = ThrowSub.Thrown;
    SpawnThrownWeapon(obj, hand, host, eye, events);
  }
}

/**
 * `EnemyThrowerUpdate` — `FUN_00449910`.
 *
 * The engine's own order: the cooldown ticks, the shot drain runs, the state
 * runs, and only then does `vel += acc; pos += vel` integrate. Class 0x31
 * integrates **acceleration as well as velocity**, unlike class 0x30, which is
 * what makes its fall and its knock-back physical — but the leap states do not
 * use it at all: they write the position outright from the arc's closed form.
 */
export function EnemyThrowerUpdate(obj: Actor, eye: Vec3, dt: number, rng: Rng,
                                   host: GameHost, events?: Events): void {
  // The cooldown is also the post-knockdown window in which shots ricochet:
  // `EnemyThrowerUpdate` clears `obj+0x34` bit 0x100 when it reaches zero.
  if (obj.cooldown > 0) {
    obj.cooldown = Math.max(0, obj.cooldown - dt * GAME_HZ);
    if (obj.cooldown === 0) obj.flags &= ~ActorFlag.ShotImmune;
  }
  // The shot drain, in the engine's own place: before the state runs.
  ThrowerOnShot(obj);

  // `ThrowerPushOutOfWorld` (`FUN_00449D40`), the collision hook at
  // `obj+0x12F0`, runs `ThrowerSnapToSurface` every frame — **but only in
  // states 7 and 8**. That is what holds a wall-crawler on its wall while it
  // stands and waits, and what drops it into the fall the moment the wall has
  // gone out from under it.
  //
  // [diverges] The hook's other two jobs, the two sphere push-outs, are not
  // here: `ColiTestSphereAgainstFullSet` is ported but nothing has read the
  // engine's own penetration depth, so pushing by it would be invention.
  if (obj.state === ThrowerState.StandAndDecide
      || obj.state === ThrowerState.WaitForPermit) {
    ThrowerSnapToSurface(obj);
  }

  const stance = ThrowerStanceOf(obj) & 3;
  switch (obj.state) {
    case ThrowerState.HitReaction:
      return ThrowerStateHitReaction(obj, eye, rng, host);
    case ThrowerState.FallAndLand:
      return ThrowerStateFallAndLand(obj, eye, dt, rng);
    case ThrowerState.Death:
      return ThrowerStateDeathClip(obj);
    case ThrowerState.Corpse:
      return ThrowerStateCorpse(obj, dt, rng, false);
    case ThrowerState.CorpseBlink:
      return ThrowerStateCorpse(obj, dt, rng, true);
    // Slot 6 holds `ThrowerLeave`, which nothing ever enters as a state. It is
    // here so that an actor forced into it by a descriptor still leaves.
    case ThrowerState.Leave:
      return ThrowerLeave(obj);
    case ThrowerState.FallToSurface:
      return ThrowerStateFallToSurface(obj, dt);
    case ThrowerState.GetUp:
      return ThrowerStateGetUp(obj, eye, rng, host);
    case ThrowerState.RideObjectPath:
      return ThrowerStateRideObjectPath(obj, dt, host);
    case ThrowerState.LeapStrike:
      return ThrowerStateLeapStrike(obj, dt, rng, host, events);
    case ThrowerState.CloseAndStrike:
      return ThrowerStateCloseAndStrike(obj, eye, rng, host, events);
    case ThrowerState.GrabPlayer:
      return ThrowerStateGrabPlayer(obj, eye, dt, rng, events);
    case ThrowerState.WaitForCue:
      return ThrowerStateWaitForCue(obj, dt, rng);
    case ThrowerState.Rearm:
      return ThrowerStateRearm(obj, host);
    case ThrowerState.RestoreBothHands:
      return ThrowerStateRestoreBothHands(obj, dt, stance, host);
    case ThrowerState.StrikeOnTheSpot:
      return ThrowerStateStrikeOnTheSpot(obj, dt, rng, host, events);
    case ThrowerState.KnockedTumbling:
      return ThrowerStateKnockedTumbling(obj, eye, dt, rng);
    case ThrowerState.BlinkIn:
      return ThrowerStateBlinkInThreeHops(obj, dt, stance);
    case ThrowerState.StandAndDecide:
      return ThrowerStateStandAndDecide(obj, eye, dt, rng, host);
    case ThrowerState.WaitForPermit:
      return ThrowerStateWaitForPermit(obj, eye, rng, host);
    // Three ids, one handler: the router names 12 and 13, the wait names 9.
    case ThrowerState.Pounce:
    case ThrowerState.PounceNear:
    case ThrowerState.PounceFar:
      return ThrowerStateLeapDown(obj, dt, rng, host, events);
    case ThrowerState.LeapAside:
      return ThrowerStateLeapAside(obj, eye, dt, rng);
    case ThrowerState.LeapToWallA:
    case ThrowerState.LeapToWallB:
    case ThrowerState.LeapToCeiling:
      return ThrowerStateLeapToSurface(obj, dt);
    case ThrowerState.WalkDistance:
      return ThrowerStateWalkDistance(obj, rng);
    case ThrowerState.EntranceClip:
      return ThrowerStateEntranceClip(obj);
    case ThrowerState.DelayedPounce:
      return ThrowerStateDelayedPounce(obj, dt, rng, host, events);
    case ThrowerState.Withdraw:
      return ThrowerStateWithdraw(obj, eye, dt, rng);
    case ThrowerState.LeapToPoint:
      ThrowerStateLeapToPoint(obj);
      return ActorIntegrate(obj, dt);
    case ThrowerState.PathFollow:
      // It moves itself: each leg is an arc with its own duration.
      return ThrowerStatePathFollow(obj, dt);
    case ThrowerState.Throw:
      TurnActorTowardCamera(obj, eye, dt);
      return ThrowerStateThrow(obj, host, eye, events);
    // State 0 is the engine's shared no-op: an actor placed in it does nothing
    // for ever, which is what the engine does too.
    case ThrowerState.Idle:
      return;
    default:
      // Every one of the 35 states now has an arm, so this is only reachable
      // through a descriptor byte outside 0..34.
      obj.state = ThrowerState.StandAndDecide;
      obj.sub = 0;
      return;
  }
}

/**
 * `pos += vel`, at the engine's own 60 Hz. The arc's velocity is per frame, so
 * the port scales it by however much of a frame this tick covered.
 */
function ActorIntegrate(obj: Actor, dt: number): void {
  const frames = dt * GAME_HZ;
  obj.pos.x += obj.vel.x * frames;
  obj.pos.y += obj.vel.y * frames;
  obj.pos.z += obj.vel.z * frames;
}

/**
 * `EnemyThrowerInit` — `FUN_00449620`.
 *
 * The start state is the descriptor's own byte +2 and the behaviour set is
 * byte +1. Stage 2's class-0x31 spawns start in 18, 19, 20, 23 and 26 — never
 * in the throw state an earlier port assumed, which is why the two `zsass`
 * above the street stood in mid-air instead of dropping into it.
 */
export function EnemyThrowerInit(obj: Actor): void {
  obj.sub = ThrowSub.Draw;
  obj.attack = 0;
  obj.attackPermit = -1;
  // `obj+0x1316`, from the descriptor's `+0x20`: the surface the actor starts
  // attached to. Every shipped stage-2 spawn starts on the ground; stage 6's
  // eight `BlinkIn` spawns cover all four stances.
  obj.flags2 = 0;
  obj.alpha = 1;
  obj.pendingHit = null;
  obj.knockCount = 0;
  obj.stance = 0;
  obj.moveBand = 0;
  obj.arcPhase = 0;
  obj.arcScript = null;
  obj.state = ThrowerEntryState(obj);
  // `INC word [g_enemies_present]` then `INC word [g_enemies_alive]`, with no
  // guard at all -- unlike class 0x30's, which excludes two kinds.
  CountEnemyThrowerIn();
}

/**
 * Which state to actually start in.
 *
 * All seven entrances the shipped data uses are ported — 18, 19, 20, 23, 26,
 * 27 and 34 — and so are the two, 21 and 22, that no descriptor names.
 * Anything else resolves to the hub, which is where every entrance ends.
 */
export function ThrowerEntryState(obj: Actor): ThrowerState {
  switch (obj.initialState) {
    case ThrowerState.GrabPlayer:
      return obj.grab ? ThrowerState.GrabPlayer : ThrowerState.StandAndDecide;
    case ThrowerState.WaitForCue:
      return obj.cue ? ThrowerState.WaitForCue : ThrowerState.StandAndDecide;
    case ThrowerState.BlinkIn:
      return ThrowerState.BlinkIn;
    case ThrowerState.LeapStrike:
      return obj.leapStrikeFrames > 0
        ? ThrowerState.LeapStrike : ThrowerState.StandAndDecide;
    case ThrowerState.RideObjectPath:
      return ThrowerState.RideObjectPath;
    case ThrowerState.WalkDistance:
      return obj.walkDistance > 0
        ? ThrowerState.WalkDistance : ThrowerState.StandAndDecide;
    case ThrowerState.EntranceClip:
      return obj.entranceMotion > 0
        ? ThrowerState.EntranceClip : ThrowerState.StandAndDecide;
    case ThrowerState.DelayedPounce:
      return obj.pounce ? ThrowerState.DelayedPounce : ThrowerState.StandAndDecide;
    case ThrowerState.LeapToPoint:
      return obj.leap ? ThrowerState.LeapToPoint : ThrowerState.StandAndDecide;
    case ThrowerState.PathFollow:
      return obj.path ? ThrowerState.PathFollow : ThrowerState.StandAndDecide;
    default:
      return ThrowerState.StandAndDecide;
  }
}

/**
 * The thrower. Its states are class 0x31's own table, not class 0x30's, so
 * the number is shown raw rather than named with the wrong vocabulary.
 */
export function EnemyThrowerDebug(obj: Actor): ActorDebug {
  return {
    summary: `state ${obj.state}/${obj.sub}`
      + (obj.dead ? " · dead" : obj.attackPermit >= 0 ? " · permit" : ""),
    detail: [
      `rank ${obj.rank}/${obj.allowance} · queue ${obj.queueRank}`,
      `hp ${obj.hp}/${obj.maxHp} · motion ${obj.motion}`
        + ` · flags 0x${(obj.flags >>> 0).toString(16)}`,
    ],
    hot: obj.attackPermit >= 0,
  };
}

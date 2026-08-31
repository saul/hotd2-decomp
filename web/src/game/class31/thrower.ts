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
import type { Rng } from "../../core/rng";
import type { ThrowHandJson } from "../../bundle";
import { DamageZone, type Actor } from "../actor";
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
import { ThrowerStateLeapToSurface } from "./surface";
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

/** `ThrowerStateRearm` — `FUN_0044F7A0`. The hand gets its weapon back. */
export function ThrowerStateRearm(obj: Actor, hand: ThrowHandJson,
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
    return;
  }
  if (obj.attackPermit < 0) {
    if (!ThrowerTryClaimAttackSlot(obj, host)) return;
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
    if (obj.sub === ThrowSub.Thrown) ThrowerStateRearm(obj, hand, host);
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
  if (obj.cooldown > 0) obj.cooldown = Math.max(0, obj.cooldown - dt * GAME_HZ);

  switch (obj.state) {
    case ThrowerState.StandAndDecide:
      return ThrowerStateStandAndDecide(obj, eye, dt, rng, host);
    case ThrowerState.WaitForPermit:
      return ThrowerStateWaitForPermit(obj, rng, host);
    // Three ids, one handler: the router names 12 and 13, the wait names 9.
    case ThrowerState.Pounce:
    case ThrowerState.PounceNear:
    case ThrowerState.PounceFar:
      return ThrowerStateLeapDown(obj, dt, rng, host, events);
    case ThrowerState.LeapAside:
      return ThrowerStateLeapAside(obj, eye, dt, rng, host);
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
    default:
      // [diverges] The eighteen unread states — the hit reactions, the death
      // chain, the two scripted attacks, the grab — are not modelled. An actor
      // in one of them would sit on a permit for ever, so it is sent back to
      // the hub, which is where every ported state also ends.
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
  obj.flags2 = 0;
  obj.stance = 0;
  obj.moveBand = 0;
  obj.arcPhase = 0;
  obj.arcScript = null;
  obj.state = ThrowerEntryState(obj);
}

/**
 * Which state to actually start in.
 *
 * [diverges] Of the five entrances the shipped stages use, four are ported;
 * state 21 rides an object path this port does not evaluate. Anything else
 * resolves to the hub, which is where every entrance ends anyway.
 */
export function ThrowerEntryState(obj: Actor): ThrowerState {
  switch (obj.initialState) {
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

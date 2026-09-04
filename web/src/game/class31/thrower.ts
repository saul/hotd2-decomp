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
import { ActorFlag, DamageZone, ThrowerFlag, ThrowerStance, type ThrowerActor }
  from "../actor";
import {
  DeadSweep, registerClass, type ActorDebug, type ClassFrame,
  type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { TurnActorTowardCamera } from "../actor_turn";
import { ThrowerReleaseAttackPermit, ThrowerTryClaimAttackSlot }
  from "../combat/permits";
import {
  ThrowerRetireFromAliveCount, ThrowerRetireFromPresentCount,
} from "../combat/counts";
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
import { ThrowerPushOutOfWorld } from "./collide";
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

/**
 * How high the hand is above the actor's own origin, for the fallback in
 * {@link SpawnThrownWeapon}. The same four units `ZombieThrowHandWeapon` uses.
 */
const HAND_HEIGHT = 4;

/** Hands whose arm has not been shot off. `ThrowerStateThrow` refuses the rest. */
function usableHands(obj: ThrowerActor): ThrowHandJson[] {
  return ThrowHandsOf(obj)
    .filter((h) => (obj.zones & DamageZone.All & h.cancel_mask) !== h.cancel_mask);
}

/** Character type 0x18 — `zslman`. It has its own clip for everything. */
const CHAR_ZSLMAN = 0x18;

/**
 * `ThrowerStateThrow`'s throw clips for character type 0x18, by hand and by
 * stance — and **the throw entry it does not read**.
 *
 * Type 0x18 is diverted out of the shared path *twice*, by two copies of the
 * same compare, and the second one is the one that was missed:
 *
 * * `CMP word ptr [ESI+0x1f4], 0x18` (`6683bef401000018`) at **0x0044FB7A**
 *   picks the **clip**. Every other type takes it from the throw entry's
 *   `+0x00` (`MOVSX EDX, word ptr [EDI]` — `0fbf17` at 0x0044FB84); type 0x18
 *   jumps to 0x0044FB98 and takes it from the switch below instead.
 * * `CMP word ptr [ESI+0x1f4], 0x18` again at **0x0044FC83** picks the
 *   **release frame**, as {@link ThrowerThrowCue} describes.
 *
 * So for `zslman` the exported entry's `motion` *and* its `release_frame` are
 * both dead. The bundle gives it `motion: 9 / 8` and `release_frame: 48`; the
 * engine plays 0x1F7 / 0x1F6 and releases on 25. The port used to read both
 * from the entry, which made it play the wrong clip and then let go 23 frames
 * into the wrong clip. Saying only "23 frames late" understates it. `[proved]`
 *
 * **The index.** `handIdx + 10*stance`, where `handIdx` is `obj+0x131A` — 0
 * for bone 5, 1 for bone 8, from `ThrowerPickThrowingHand` (`FUN_0044F630`) —
 * and `stance` is `3*bit8 + 2*bit7 + bit6` of `obj+0x136C`
 * (`8b866c130000` at 0x0044FB98, then the shifts and `LEA`s to 0x0044FBBB).
 * That index runs into a 32-byte table of jump-table selectors at
 * `0x0044FD1C` (`MOV CL, byte ptr [EAX + 0x44fd1c]` — `8a881cfd4400` at
 * 0x0044FBCF), bounded by `CMP EAX, 0x1f` / `JA` (`83f81f`, `0f8797000000`)
 * at 0x0044FBC4, and out through the nine-entry jump table at `0x0044FCF8`
 * (`ff248df8fc4400`).
 *
 * **It is `.text`, not a table, which is why it is here and not in the
 * bundle.** `.rdata` starts at 0x004C4000; 0x0044FD1C sits inside
 * `ThrowerStateThrow`'s own body, has exactly one xref in the program — the
 * `MOV CL` above — and its nine jump targets are all addresses inside this
 * one function. It is a compiler-emitted dense switch, and the clip ids are
 * `MOV` immediates in its arms (`b8f7010000` = `MOV EAX, 0x1F7`). Under the
 * `.rdata` travels, `.text` does not rule in `docs/formats/bundle.md` that
 * puts it here, beside `stand.ts`'s `WAIT_BY_STANCE_ZSLMAN`, which is the
 * same shape read out of the neighbouring state.
 *
 * **24 of those 32 bytes are unreachable padding, not data.** `handIdx` is 0
 * or 1 and `stance` is 0..3, so the only indices that can occur are 0, 1, 10,
 * 11, 20, 21, 30 and 31 — the eight below. The other 24 bytes all hold `0x08`,
 * the selector for the default arm, because a dense switch has to be dense.
 * Reading the raw table as an eight-by-four grid of clips would be reading the
 * compiler's padding as the game's data.
 */
const THROW_BY_STANCE_ZSLMAN = [
  // handIdx 0 — bone 5, the right hand. Ground, WallA, WallB, Ceiling.
  [0x1f7, 0x1fc, 0x1f2, 0x204],
  // handIdx 1 — bone 8, the left.
  [0x1f6, 0x1fb, 0x1f1, 0x203],
];

/**
 * The frame type 0x18 lets go on: `0x19` = 25, written to `obj+0x1350` by
 * **all eight** arms of the switch above, the same ten bytes each time
 * (`c7865013000019000000`, at 0x0044FBE1, FBF2, FC03, FC14, FC25, FC36, FC47
 * and FC58). It is uniform across every arm, which is why the release frame
 * does not depend on which clip was picked.
 */
const ZSLMAN_RELEASE_FRAME = 0x19;

/**
 * The clip a throw plays and the frame the weapon leaves the hand — one
 * routine because `ThrowerStateThrow` decides both on the character type, and
 * splitting them is how the port came to play one type's clip against another
 * type's frame.
 *
 * The release frame in the exe is `obj+0x1350` — the **same word** as
 * {@link ThrowerTail.landSurface}, which states 2 and 33 use for the surface
 * under
 * the body. The switch writes the constant `0x19` into it and the compare at
 * 0x0044FC9B..0x0044FCA7 reads it back (`8b8e9c010000` / `8b8650130000` /
 * `3bc8`): one address, two readings, both inside class 0x31, and no `cls`
 * test can tell them apart. The port keeps only the surface reading in the
 * field and returns the frame from here, so the two are never confused at a
 * use site; see the note on {@link ThrowerTail.landSurface}.
 *
 * Every other character type compares `obj+0x19C` against the throw entry's
 * own `+0x08` at 0x0044FC8D (`0fbf4708` then `39869c010000`). `[proved]`
 *
 * `[open]` — **the default arm.** The exe's stance is `3*bit8 + 2*bit7 + bit6`,
 * a sum, not a selector: if two surface bits were ever set at once it exceeds
 * 3, the index leaves the table's range, and the switch takes its default —
 * which plays the clip passed in as the routine's *second argument* and
 * **does not write `obj+0x1350` at all**, so the compare would read a landing
 * surface as a frame number. The port's {@link ThrowerStanceOf} `& 3` cannot
 * produce that, so the two formulas agree exactly while the bits stay
 * exclusive and diverge if they ever do not. Whether the engine can set two at
 * once is undetermined; the fallback below is what the port does if the table
 * is ever indexed outside itself.
 */
function ThrowerThrowCue(obj: ThrowerActor, hand: ThrowHandJson):
    { motion: number; release: number } {
  const entry = { motion: hand.motion, release: hand.release_frame };
  if (obj.charType !== CHAR_ZSLMAN) return entry;
  const handIdx = hand.bone === 5 ? 0 : 1;
  const motion = THROW_BY_STANCE_ZSLMAN[handIdx]?.[ThrowerStanceOf(obj) & 3];
  if (motion === undefined) return entry;
  return { motion, release: ZSLMAN_RELEASE_FRAME };
}

/**
 * `AimThrownWeapon` — `FUN_004503D0`. A point `aim_ahead` in front of the
 * camera; the camera looks down its own local -Z, which is where the player is.
 */
export function AimThrownWeapon(obj: ThrowerActor, host: GameHost, eye: Vec3,
                                out: Vec3): void {
  const cfg = CharacterTypeOf(obj)?.throw;
  host.aimPoint(cfg?.aim_ahead ?? 0, out);
  out.y = eye.y;
}

/**
 * `SpawnThrownWeapon` — `FUN_004504E0`. The hand goes bare and the weapon
 * takes off.
 */
export function SpawnThrownWeapon(obj: ThrowerActor, hand: ThrowHandJson,
                                  host: GameHost, eye: Vec3,
                                  events?: Events): void {
  const cfg = CharacterTypeOf(obj)?.throw;
  if (!cfg) return;
  const from = vec3();
  // [diverges] The engine reads the hand's own recorded position —
  // `obj + 0x274 + bone * 0x90`, transformed by the camera matrix — and so it
  // **cannot fail**: `SpawnThrownWeapon` (`FUN_004504E0`) has no path that
  // declines to make the weapon. The port has no skeleton in `game/`, so it
  // asks the host, and a host that cannot answer used to make this `return`.
  // That is the whole of "the thrower plays the animation and no axe appears":
  // `ThrowerStateThrow` had already advanced its own sub-state to `Thrown`, so
  // the throw was counted and the weapon was not. Fall back to the actor's own
  // position lifted by a chest height, exactly as `ZombieThrowHandWeapon`
  // (`FUN_0045A240`) does on the class-0x30 side.
  if (!host.boneWorld(obj.at, hand.bone, from)) {
    from.x = obj.pos.x;
    from.y = obj.pos.y + HAND_HEIGHT;
    from.z = obj.pos.z;
  }

  // `obj+0x20C + bone*0x90` -- the draw record, recorded on the actor beside
  // the call that asks the renderer for it, so a snapshot carries which model
  // each bone is showing. `render/characters/gore.ts` used to record it, which
  // made the snapshot depend on whether a hierarchy was in the scene.
  obj.boneSlot[String(hand.bone)] = hand.bare;
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
function ThrowerRearmHand(obj: ThrowerActor, hand: ThrowHandJson,
                          host: GameHost): void {
  if (hand.held) {
    obj.boneSlot[String(hand.bone)] = hand.held;
    host.setBoneSlot(obj.at, hand.bone, hand.held);
  }
  obj.zones &= ~(hand.cancel_mask & DamageZone.All);
}

/**
 * `ThrowerStateThrow` — `FUN_0044FAF0`. Play the clip, let go on the exact
 * frame the hand names, then re-arm and give the permit up so the next enemy —
 * or this one — can take a turn.
 */
export function ThrowerStateThrow(obj: ThrowerActor, host: GameHost, eye: Vec3,
                                  events?: Events): void {
  const hands = usableHands(obj);
  if (!hands.length) {
    if (obj.attackPermit >= 0) ThrowerReleaseAttackPermit(obj);
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
  // The clip and the release frame together — see {@link ThrowerThrowCue}.
  // Both are the throw entry's for three of the four character types and
  // neither is for 0x18.
  const cue = ThrowerThrowCue(obj, hand);
  if (obj.sub === ThrowSub.Draw) {
    obj.attack = hands.indexOf(hand);
    obj.action = { motion: cue.motion, ticks: 0, loop: false };
    obj.sub = ThrowSub.Winding;
    return;
  }

  const m = MotionOf(obj, cue.motion);
  if (!obj.action || !m) {
    if (obj.sub === ThrowSub.Thrown) ThrowerRearmHand(obj, hand, host);
    ThrowerReleaseAttackPermit(obj);
    obj.sub = ThrowSub.Draw;
    obj.attack = (obj.attack + 1) % hands.length;
    return;
  }
  // The frame the weapon leaves the hand. The local name is here so the frame
  // reading of `obj+0x1350` is never confused with the landing-surface one at
  // a use site; see {@link ThrowerThrowCue} and
  // {@link ThrowerTail.landSurface}.
  const throwCueFrame = cue.release;
  if (obj.sub === ThrowSub.Winding && obj.action.ticks >= throwCueFrame) {
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
export function EnemyThrowerUpdate(obj: ThrowerActor, f: ClassFrame): void {
  const { eye, dt, rng, host, events } = f;
  // The cooldown is also the post-knockdown window in which shots ricochet:
  // `EnemyThrowerUpdate` clears `obj+0x34` bit 0x100 when it reaches zero.
  if (obj.cooldown > 0) {
    obj.cooldown = Math.max(0, obj.cooldown - dt * GAME_HZ);
    if (obj.cooldown === 0) obj.flags &= ~ActorFlag.ShotImmune;
  }
  // The shot drain, in the engine's own place: before the state runs.
  ThrowerOnShot(obj);

  ThrowerRunState(obj, eye, dt, rng, host, events);

  // `ThrowerPushOutOfWorld` (`FUN_00449D40`), the collision hook at
  // `obj+0x12F0`, and it runs **after** the state — the same place
  // `EnemyZombieUpdate` runs its own. That ordering is the whole of it: every
  // state here writes `obj.pos` outright, so a push that ran first was
  // overwritten before anything drew it, and the body stayed in the wall.
  //
  // Two things say it is after. `FUN_00405160`, which registers the sphere
  // `ThrowerPlaceCollisionSphere` writes into the per-frame list, is reached
  // from the *end* of `EnemyThrowerUpdate` through `FUN_00409B70` — so the
  // sphere has to have been placed by then. And the hook's own last act is
  // `ThrowerSnapToSurface` for states 7 and 8, which is what holds a
  // wall-crawler on its wall; a snap applied before the state moves the actor
  // would be undone every frame.
  ThrowerPushOutOfWorld(obj);
}

/**
 * The state table, dispatched. `g_class31_states` (0x00592960) is 35 entries
 * and every one has an arm here.
 */
function ThrowerRunState(obj: ThrowerActor, eye: Vec3, dt: number, rng: Rng,
                         host: GameHost, events?: Events): void {
  const stance = ThrowerStanceOf(obj) & 3;
  switch (obj.state) {
    case ThrowerState.HitReaction:
      return ThrowerStateHitReaction(obj, eye, rng, host);
    case ThrowerState.FallAndLand:
      return ThrowerStateFallAndLand(obj, host, dt, rng);
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
      return ThrowerStateKnockedTumbling(obj, host, dt, rng);
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
/** `param_1[0x4a]` in `EnemyThrowerInit`: `obj+0x128`, the body sphere. */
const CHAR_ZSASS = 0x16;
const BODY_RADIUS_ZSASS = 5.0;
const BODY_RADIUS_OTHER = 4.0;

function ActorIntegrate(obj: ThrowerActor, dt: number): void {
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
export function EnemyThrowerInit(obj: ThrowerActor): void {
  obj.sub = ThrowSub.Draw;
  obj.attack = 0;
  obj.attackPermit = -1;
  // `obj+0x1316`, from the descriptor's `+0x20`: the surface the actor starts
  // attached to. Every shipped stage-2 spawn starts on the ground; stage 6's
  // eight `BlinkIn` spawns cover all four stances, and five of them carry a
  // surface bit.
  //
  //   00449762  MOVSX EAX, word ptr [ESI + 0x1316]   0fbf8616130000
  //   00449769  OR    EAX, 0x180000                  0d00001800
  //   0044977a  MOV   dword ptr [ESI + 0x136c], EAX  89866c130000
  //
  // `| 0x180000` — **every** thrower is born colliding, against the world and
  // against other actors both. Without these two bits `ThrowerPushOutOfWorld`
  // does nothing at all and the body is tested at its origin alone, which
  // draws a thrower standing a radius deep in a wall.
  //
  // The word is **sign-extended**, not zero-extended, so a descriptor setting
  // `0x8000` would raise the whole high half. None does; the shift pair says
  // so anyway rather than pretending the question is not there.
  obj.flags2 = ((obj.descFlags << 16) >> 16) | ThrowerFlag.Collide;
  // Then the stance, from bits 6/7/8 of what the descriptor just supplied —
  // `ECX = 3*bit8 + 2*bit7 + bit6` at 0x00449770..0x00449794, a four-arm jump
  // table at `0x00449900`, and each non-ground arm raises `OffGround`
  // (`OR AL, 0x20` — `0c20`). Two surface bits at once make the index exceed
  // 3 and the whole thing is skipped: `CMP ECX, 0x3` / `JA` (`83f903` /
  // `7745`) at 0x0044979B.
  //
  // Each arm also writes `obj+0x134C` = 0.0/1.0/2.0/3.0. Nothing in class
  // 0x31 reads that float — its only readers in the program are `FUN_0040F220`
  // and class 0x30's `FUN_004534A0`, which seed it with quite different
  // numbers — so its meaning is `[open]` and the port does not carry it.
  //
  // Two surface bits at once therefore leave the actor on the ground with no
  // `OffGround` at all — the engine falls out of the switch rather than
  // picking a stance. No shipped spawn does it; the arm is here because the
  // engine has it.
  const stance = ThrowerStanceOf(obj);
  if (stance !== ThrowerStance.Ground && stance <= ThrowerStance.Ceiling) {
    obj.flags2 |= ThrowerFlag.OffGround;
  }
  // `param_1[0x4a]`, at `obj+0x128`: 5.0 for character type 0x16 and 4.0 for
  // 0x17 through 0x19. It is the radius both push-outs test with.
  obj.bodyRadius = obj.charType === CHAR_ZSASS
    ? BODY_RADIUS_ZSASS : BODY_RADIUS_OTHER;
  obj.alpha = 1;
  obj.pendingHit = null;
  obj.thr.knockCount = 0;
  obj.thr.stance = 0;
  obj.thr.moveBand = 0;
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
export function ThrowerEntryState(obj: ThrowerActor): ThrowerState {
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
export function EnemyThrowerDebug(obj: ThrowerActor): ActorDebug {
  // `ThrowerStateWaitForPermit` is a pose held until a permit frees, so an
  // actor parked in it looks exactly like one whose own logic has stalled.
  // `ThrowerTryClaimAttackSlot` refuses on two things and neither is visible
  // from the row without saying so.
  const waiting = obj.state === ThrowerState.WaitForPermit
    && obj.attackPermit < 0;
  const held = G.g_attack_permits.findIndex((p) => p !== -1);
  const why = !waiting ? null
    : G.g_attack_committed !== 0 ? "another enemy is committed off screen"
    : held !== -1
      ? `all ${G.g_max_attackers} permits held — 0x`
        + `${(G.g_attack_permits[held] ?? 0).toString(16).toUpperCase()} has it`
      : "a permit is free — the claim is not being made";
  const detail = [
    `rank ${obj.rank}/${obj.allowance} · queue ${obj.queueRank}`,
    `hp ${obj.hp}/${obj.maxHp} · motion ${obj.motion}`
      + ` · flags 0x${(obj.flags >>> 0).toString(16)}`,
  ];
  return {
    summary: `${ThrowerState[obj.state] ?? obj.state}/${obj.sub}`
      + (obj.dead ? " · dead" : obj.attackPermit >= 0 ? " · permit"
         : waiting ? " · wants a permit" : ""),
    detail: why ? [`blocked: ${why}`, ...detail] : detail,
    hot: obj.attackPermit >= 0,
  };
}

/**
 * What a class-0x31 thrower gives back when `GameUpdate`'s sweep reaches it.
 *
 * The permit on every reason, in **its own** bit: `ThrowerFlag.OffScreenPermit`
 * is `obj+0x136C` bit 0x40000000, because class 0x30 already uses 0x20000000
 * of the same word for its own actors — the note on
 * `ThrowerTryClaimAttackSlot` (`FUN_0044CA40`) is where that split is proved.
 *
 * The counts **only on a despawn**, and that is not an omission. Class 0x31's
 * death is four states and it runs the two retires where the exe does —
 * `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) drops the alive count as the
 * fall opens, `ThrowerStateCorpse` the present count when the body is done —
 * so a thrower that has merely died is *present but not alive*, exactly as the
 * engine leaves it, and a sweep that retired both here would collapse the one
 * window class 0x30 has already lost.
 */
function EnemyThrowerDeadSweep(obj: ThrowerActor, why: DeadSweep): void {
  ThrowerReleaseAttackPermit(obj);
  if (why !== DeadSweep.Despawned) return;
  ThrowerRetireFromAliveCount(obj);
  ThrowerRetireFromPresentCount(obj);
}

/** Class 0x31's row of `g_class_handlers`, filled by the class itself. */
export const EnemyThrowerHandler: ClassHandler = {
  init: EnemyThrowerInit,
  update: EnemyThrowerUpdate,
  leave: ThrowerLeave,
  onDeadSweep: EnemyThrowerDeadSweep,
  updatesWhenDead: true,
  debug: EnemyThrowerDebug,
};

registerClass(SpawnClass.Thrower, EnemyThrowerHandler);

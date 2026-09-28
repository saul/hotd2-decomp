/**
 * `ZombieStateDelayedPounce` — class 0x30 state 28, and **no shipped spawn
 * reaches it.**
 *
 * `g_class30_states[28]` is `0x004586E0` -- the dword at `0x00592B58`, with
 * `[27]` `0x004584E0` (`ZombieStateEmerge`) and `[29]` `0x00458960`
 * (`ZombieStateRideCarrier`) either side, so the indexing is not adrift
 * (`L38`). The entry is not shared. Ghidra had no function there: its two
 * calls to `ActorSetPartVisibility` (`FUN_00409D10`) were found by a byte scan
 * for the call, and the function was created for this port.
 *
 * What it does, `[proved]` from the listing `0x004586E0`..`0x0045894C` and the
 * jump table at `0x00458950` (sub 0 `0x00458706`, 1 `0x0045877D`, 2
 * `0x0045883D`, 3 `0x004588F2`): hold clip 0x10F -- hidden, when the
 * descriptor's `+0x03` is 1 -- for the delay at `+0x04`; then show the actor,
 * claim a permit (and take player 0's if the claim is refused), and ride
 * `g_class30_pounce_arc_script` to a point 12 below and 12 in front of the
 * camera, or 12 ahead of the descriptor's own point along the camera's
 * heading; splash on the ground under it at clip frames 1 and 15; on the
 * landing, at frame 27, hit the player once; play the clip out, give the
 * permit back and join `ZombieStateAttackRun`.
 *
 * **Every arm but the last falls into the next** (`L53`): sub 0 ends
 * `INC word [ESI+0x1312]` at `0x00458770` and runs on into sub 1's decrement
 * at `0x0045877D`; sub 1 ends at `0x00458830` and runs into `0x0045883D`; sub
 * 2's arc end is `INC` at `0x004588EB` straight into `0x004588F2`.
 *
 * **Who reaches it**, `[proved]` for the image and the twelve scenes: no
 * class-0x30 routine stores 28 into `obj+0x1310` as an immediate -- a sweep of
 * every `MOV word [reg + 0x1310], imm` finds none -- and every store from a
 * register copies the descriptor's `+0x02` (`EnemyZombieInit`) or `+0x03` (the
 * entrances' branches, `ZombieScriptEnded`), a civilian's op-0x1A order
 * (`ZombieStateAwaitCivilianOrder`), or a state the actor was already in
 * (`ZombieStateHoldForCameraCue`, `ZombieStateTargetLostPause`). Across all
 * twelve scenes' `evt/` files no class-0x30 descriptor names 28 at `+0x02` or
 * `+0x03`, and no civilian order is 28 (the orders shipped are 1, 34, 35, 36
 * and 49). So this state is live code nothing enters.
 *
 * The two clips come from different banks: 0x10F from `debu.bin` and 0x162
 * from `ebi.bin` (`g_motion_bank_of`). Which character the state was written
 * for is `[open]`.
 */
import type { Events } from "../../core/events";
import { ActorFlag, MotionFlag, ZombieFlag2, type ZombieActor } from "../actor";
import {
  ActorArcBeginToWaypoint, ActorArcStep, ActorPlayCursor, ArcPhase,
} from "../class31/arc";
import { QueryGroundHeightAt } from "../coli";
import { ReleaseAttackSlot, TryClaimAttackSlot } from "../combat/permits";
import { PlayerTakeDamage } from "../combat/player";
import { SpawnSpriteEffect } from "../effects/sprite";
import type { GameHost } from "../host";
import { ActorSetPartVisibility } from "../model_draw";
import { MotionPlayLength, SecondsToTicks, T } from "../tables";
import { vec3 } from "../vec";
import { LeapTargetMode, ZombieLeapStrikeTarget } from "./leap_target";
import { ActorSetMotion } from "./motion_cue";
import { ZombieState } from "./states";

/** The state's sub-states at `obj+0x1312`, which the engine increments. */
export enum DelayedPounceSub {
  /** Take the actor off the ground and cut to the crouch. */
  Arm = 0,
  /** Count the delay out, then show the actor and launch. */
  Wait = 1,
  /** In the air; splash, and strike on the landing. */
  Flight = 2,
  /** Play the leap clip out and hand over. */
  Settle = 3,
}

/** `PUSH 0x10f` at `0x0045875F`: the clip held through the delay. */
export const POUNCE_CROUCH_MOTION = 0x10f;
/** `CMP dword ptr [ESI + 0x1B4], 0x162` at `0x0045883D`: the leap. */
export const POUNCE_LEAP_MOTION = 0x162;
/** `CMP dword ptr [ESI + 0x19C], 0x1B` at `0x00458856`: the hit's frame. */
export const POUNCE_HIT_CURSOR = 0x1b;
/** `CMP EAX, 0x1` / `CMP EAX, 0xF` at `0x00458896`: the two splash frames. */
export const POUNCE_SPLASH_CURSORS: readonly number[] = [1, 0xf];
/**
 * `PUSH 0x62` at `0x004588CC`: the splash sprite kind -- slots
 * `0x1339..0x1356` at scale 1.5, the strip {@link SpriteEffectKind.Splash}
 * draws at 1.0.
 */
const POUNCE_SPLASH_KIND = 0x62;
/** `PUSH 0x1` / `PUSH -0x1` at `0x004588C6`/`0x004588C0`. */
const FACE_CAMERA = 1;
const NO_PLAYER = -1;
/** `PUSH 0x9` at `0x00458875`: `PlayerTakeDamage`'s overlay kind. */
const POUNCE_HIT_OVERLAY = 9;
/** `PUSH 0x1` at `0x00458877`: raise the hit latch. */
const POUNCE_HIT_LATCH = 1;
/** `PUSH 0x1` at `0x00458813`: `ActorArcBeginToWaypoint`'s step. */
const POUNCE_ARC_STEP = 1;
/** `CMP AL, 0x1` at `0x0045872A`: `tail+0x03` of 1 hides the actor. */
const POUNCE_HIDDEN = 1;

/**
 * `g_class30_pounce_arc_script` — `0x00593140`, in the bundle as
 * `combat.arc_scripts.pounce`: `{0x162,0,5,15}{0x162,16,5,26}{0x162,27,5,40}`.
 * The state passes the address as a literal (`PUSH 0x593140` at
 * `0x00458815`), never the no-script sentinel.
 */
function PounceArcScript() {
  return T.chars?.combat?.arc_scripts?.pounce ?? null;
}

/**
 * `ZombieStateDelayedPounce` — `FUN_004586E0`, class 0x30 state 28.
 *
 * `[port-only]` where the engine reads its one motion track: `obj+0x1B4` and
 * `obj+0x19C` are the arc stage on the port's one-shot channel while one is
 * running, as `ThrowerEmitGroundDust`'s trail reads them -- see
 * `ActorPlayCursor`. And the port's descriptor block for the tail: a spawn
 * whose `+0x02` or `+0x03` names 28 carries `delayed_pounce`, and a bundle
 * without it counts no delay and lands in the camera's space.
 */
export function ZombieStateDelayedPounce(obj: ZombieActor, dt: number,
                                         host: GameHost,
                                         events?: Events): void {
  const t = obj.delayedPounce;

  if (obj.sub === DelayedPounceSub.Arm) {
    // `00458709 OR EAX, 0x22100`: off the ground snap, no stagger, and no
    // shot lands while it waits.
    obj.flags |= ActorFlag.Airborne | ActorFlag.NoHitReaction
               | ActorFlag.ShotImmune;
    // `00458717 AND EAX, 0xdfffffff` / `OR EAX, 0x100000` on `obj+0x136C`:
    // off the world push, and carried by something other than its feet.
    obj.flags2 = (obj.flags2 & ~ZombieFlag2.CollideWorld) | ZombieFlag2.Carried;
    // `0045872A CMP byte [EDI+3], 1`: the same hide `ZombieStateEmerge`
    // makes -- every part, the camera and the shadow (`0x90000`), and the
    // skeleton (`AND AL, 0xfe` into `obj+0x1F8`).
    if (obj.attackState === POUNCE_HIDDEN) {
      ActorSetPartVisibility(obj, 0);
      obj.flags |= ActorFlag.NoCameraTrack | ActorFlag.NoShadow;
      obj.motionFlags &= ~MotionFlag.Drawn;
    }
    // `00458765 CALL ActorSetMotion(obj+0x194, 0x10f)` -- a cut, whatever
    // `+0x03` said.
    ActorSetMotion(obj, POUNCE_CROUCH_MOTION);
    obj.zom.holdFrames = t?.delay ?? 0;              // +0x1330, `tail+0x04`
    obj.sub = DelayedPounceSub.Wait;
    // No return: `0x00458777` runs on into sub 1 at `0x0045877D`.
  }

  if (obj.sub === DelayedPounceSub.Wait) {
    // `DEC ECX` / `TEST EAX, EAX` / `JG` -- out on the frame it reaches 0.
    obj.zom.holdFrames -= SecondsToTicks(dt);
    if (obj.zom.holdFrames > 0) return;
    // `0045879D ActorSetPartVisibility(obj+0x194, 1)` and `OR EDX, 0x1` into
    // `obj+0x1F8`: drawn again, whatever `+0x03` said.
    ActorSetPartVisibility(obj, 1);
    obj.motionFlags |= MotionFlag.Drawn;
    // `004587B5 AND EDX, 0xfff6feff` / `OR EDX, 0x10000000`: shootable, with
    // a camera point and a shadow -- and mid-attack. `0x2000` stays up.
    obj.flags = (obj.flags & ~(ActorFlag.NoShadow | ActorFlag.NoCameraTrack
                               | ActorFlag.ShotImmune))
              | ActorFlag.Committed;
    // `004587C4 CALL TryClaimAttackSlot`, and then **the claim's answer is
    // overruled**: `CMP AL, 0xff / JNZ` / `MOV byte [ESI+0x121], 0x0`. A
    // refused actor leaps at player 0 all the same, holding an index no
    // permit table entry names -- and gives that entry back on the way out.
    TryClaimAttackSlot(obj, host);
    if (obj.attackPermit === -1) obj.attackPermit = 0;
    // `004587E3 CMP ECX, 0xbf800000`: a descriptor point is copied into
    // `obj+0x13E4` and turned from (mode 1); the sentinel leaves the point
    // alone for the camera-space landing (mode 0).
    const p = t?.point;
    if (p) {
      obj.target.x = p[0];
      obj.target.y = p[1];
      obj.target.z = p[2];
    }
    ZombieLeapStrikeTarget(obj, obj.target,
                           p ? LeapTargetMode.FromPoint
                             : LeapTargetMode.CameraSpace, host);
    ActorArcBeginToWaypoint(obj, obj.target, PounceArcScript(),
                            POUNCE_ARC_STEP);
    // `0045882A AND ECX, 0xfffeffff`: the hit's latch, down for this leap.
    obj.flags2 &= ~ZombieFlag2.OneShotFired;
    obj.sub = DelayedPounceSub.Flight;
    // No return: `0x00458837` runs on into sub 2 at `0x0045883D`.
  }

  if (obj.sub === DelayedPounceSub.Flight) {
    const track = obj.action ? obj.action.motion : obj.motion;
    const cursor = ActorPlayCursor(obj);
    if (track === POUNCE_LEAP_MOTION) {
      // `0045884D CMP [ESI+0x1360], 4`: down -- the phase the last frame's
      // step left -- on the landing stage's first frame, once a leap.
      //
      // [diverges] On a flight longer than 17 frames the port never sees the
      // two together, and the engine always does. The engine's states read a
      // clip's start frame `fade + 2` times: `ActorSetMotionBlended`
      // (`FUN_004119A0`) arms the hold, `SkeletonAdvancePlayCursor`
      // (`FUN_004111A0`) lets go when the counter is `fade + 2` past it, and
      // `ZombieAdvanceMotion` (`FUN_00454860`) steps the counter after the
      // state. `FitArcScriptByFadeLength` grows the fades until `f1 + f2` is
      // `T - 10`, which puts the Settled read on the **last** of the reads of
      // frame 27 -- a hit for every flight from 11 frames to where the fades
      // clamp. The port's states read a start frame `fade + 1` times, because
      // its clocks advance before its states (`ActorSetOneShotBlended`), so
      // stage 1 lets go a frame early, the arc comes down a frame later
      // against stage 2, and stage 2 lets go of 27 a frame sooner: the read
      // comes two frames late, and only a flight of 17 frames or fewer hits.
      // The faithful fix is that phase, which moves every class-0x30 and
      // class-0x31 cursor test with it, and not this test.
      if (obj.arcPhase === ArcPhase.Settled && cursor === POUNCE_HIT_CURSOR
          && !(obj.flags2 & ZombieFlag2.OneShotFired)) {
        // `0045887A PlayerTakeDamage((s8)obj+0x121, 1, 9)`: no hit frame of
        // an attack entry, no distance test -- the landing is the strike.
        PlayerTakeDamage(obj.attackPermit, POUNCE_HIT_LATCH,
                         POUNCE_HIT_OVERLAY, events, obj);
        obj.flags2 |= ZombieFlag2.OneShotFired;
      }
      // `004588B8 QueryGroundHeightAt(x, y, z)` from the body's own height,
      // and `SpawnSpriteEffect({x, ground, z}, 0x62, 1, -1)` at `0x004588D3`.
      if (POUNCE_SPLASH_CURSORS.includes(cursor)) {
        const ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y, obj.pos.z);
        SpawnSpriteEffect(vec3(obj.pos.x, ground, obj.pos.z), 0, 0,
                          POUNCE_SPLASH_KIND, FACE_CAMERA, NO_PLAYER, host,
                          events);
      }
    }
    // `004588DE ActorArcStep(obj, 1)` / `CMP EAX, 0x1` / `JZ return`.
    if (ActorArcStep(obj, POUNCE_ARC_STEP, dt, host, events)) return;
    obj.sub = DelayedPounceSub.Settle;
    // No return: `0x004588EB` runs on into sub 3 at `0x004588F2`.
  }

  if (obj.sub !== DelayedPounceSub.Settle) return;
  // `004588FE MOVSX EDX, [g_motion_play_length + obj+0x1B4 * 2]; DEC EDX;
  // CMP EAX, EDX; JL return`. `[port-only]` A one-shot that has run out has
  // passed that frame: the channel ends a clip only past
  // `g_motion_play_length + 1`, where the engine's cursor wraps.
  const act = obj.action;
  if (act && ActorPlayCursor(obj) < MotionPlayLength(obj, act.motion) - 1) {
    return;
  }
  // `0045890F AND EAX, 0xeffddfff`: no longer mid-attack, back on the ground
  // snap, and staggerable.
  obj.flags &= ~(ActorFlag.Committed | ActorFlag.Airborne
                 | ActorFlag.NoHitReaction);
  // `0045891D AND EAX, 0xffeeffff` / `OR EAX, 0x20000000`.
  obj.flags2 = (obj.flags2 & ~(ZombieFlag2.Carried | ZombieFlag2.OneShotFired))
             | ZombieFlag2.CollideWorld;
  // `0045892D CALL ReleaseAttackSlot` -- whichever index `obj+0x121` names,
  // the overruled 0 included.
  ReleaseAttackSlot(obj);
  obj.state = ZombieState.AttackRun;
  obj.sub = 0;
}

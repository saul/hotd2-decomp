/**
 * `ZombieStateLeapStrike` — `FUN_0045E330`. Class 0x30 state 0x34, and
 * **what a crawler attacks with.**
 *
 * `ZombieStateHoldAtRange` hands a successful claim to one of two states, and
 * the body condition decides which:
 *
 * ```
 * 0045585e  83be0c13000004       CMP  dword ptr [ESI + 0x130c], 0x4
 * 00455865  7415                 JZ   0x0045587c
 * 00455867  66c786101300000300   MOV  word ptr [ESI + 0x1310], 0x3    ; strike
 * 0045587c  66c786101300003400   MOV  word ptr [ESI + 0x1310], 0x34   ; this
 * ```
 *
 * Every `znkager` -- all twenty of stage 2's crawlers -- is body condition 4,
 * so none of them ever runs `ZombieStateStrike`. They leap: close to the
 * attack's own distance on its lunge clip, ride an arc to a point just under
 * and in front of the camera, and **land the hit on touching down**, through
 * `ActorStrikeConnect` with no hit-frame test at all. Then they bounce back
 * out of your face under gravity and retreat.
 *
 * That corrects an earlier reading. The port had the crawlers in
 * `ZombieStateStrike`, and `strike.ts` proved -- correctly, for that state --
 * that their condition-4 attack could never connect there, because its hit
 * frame is 40 on a 20-frame clip. The proof was about a state the crawlers do
 * not run. See `L53`.
 *
 * The table entry is `[proved]` from `g_class30_states[0x34]` =
 * `0x0045E330`, with `[0x33]` `0x0045DED0` and `[0x35]` `0x0045E660` either
 * side (`L38`); the sub-states come off the jump table at `0x0045E640`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, ZombieFlag2, type ZombieActor } from "../actor";
import { ActorFacePlayerTarget } from "../actor_turn";
import {
  ARC_GRAVITY_HALF, ActorArcBeginToWaypoint, ActorArcStep, ActorLocalPoint,
} from "../class31/arc";
import { QueryGroundHeightAt } from "../coli";
import { ActorPlayHitVoice, ActorVoice } from "../combat/voice";
import { G } from "../globals";
import type { GameHost } from "../host";
import { AttackListOf, T } from "../tables";
import { dist2d, vec3, type Vec3 } from "../vec";
import { ClearCurrentActorVelocityAndAccel } from "./knockback";
import { ZombieGiveUpAttack } from "./leave";
import { ActorSetMotionBlended } from "./motion_cue";
import { HALVED_CONDITION } from "./split";
import { GAME_HZ, MotionFade, ZombieState } from "./states";
import { ActorStrikeConnect, ZombiePickAttack } from "./strike";

/** The state's sub-states at `obj+0x1312`, which the engine increments. */
export enum LeapStrikeSub {
  /** Draw the attack and anchor the strike. */
  Pick = 0,
  /** Face the player and close to the attack's distance on its lunge. */
  Close = 1,
  /** Aim, begin the arc, cry out. */
  Launch = 2,
  /** In the air; the hit lands when the arc is down. */
  Flight = 3,
  /** Wait for the landing clip to end, then kick back off. */
  Recoil = 4,
  /** Fall and bounce until settled, then retreat. */
  Bounce = 5,
}

/**
 * `OR EDX, 0x10020000` at `0x0045E384`: {@link ActorFlag.Committed} and
 * {@link ActorFlag.Airborne} -- mid-attack, and off the ground snap.
 */
const LEAP_FLAGS = ActorFlag.Committed | ActorFlag.Airborne;

/**
 * `g_class30_leap_strike_arc_script` — `0x00593180`, in the bundle as
 * `combat.arc_scripts.leap_strike`: `{0x41C,0,5,10}{0x41C,11,5,38}
 * {0x41D,0,3,0}`. The engine passes the address as a literal
 * (`PUSH 0x593180` at `0x0045E487`), never the no-script sentinel.
 */
function LeapStrikeArcScript() {
  return T.chars?.combat?.arc_scripts?.leap_strike ?? null;
}
/** `PUSH 0x2` at `0x0045E485` -- `ActorArcBeginTo`'s step. */
const LEAP_ARC_STEP = 2;
/** `CDQ; AND EDX, 3; ADD EAX, EDX; SAR EAX, 2` -- the arc's quarter mark. */
const SPLIT_ARC_FRACTION = 4;

/** `MOV dword ptr [ESI + 0x5c], 0xbcdf0123` at `0x0045E524`: -0.027222222. */
const RECOIL_GRAVITY = -ARC_GRAVITY_HALF;
/** `0xbe99999a` at `0x0045E571` -- the kick is 0.3 units along the view's -z. */
const RECOIL_SPEED = -0.3;
/** `FMUL float ptr [0x004c4d0c]` -- `000080be`, -0.25. */
const BOUNCE_RESTITUTION = -0.25;
/** `FCOMP float ptr [0x004c4d08]` -- `9a99193e`, 0.15. */
const BOUNCE_SETTLE = 0.15;
/** `PUSH 0x2916a9` at `0x0045E5D8` -- `COMMON\ENE_WALK6_22.WAV`. */
const SND_BOUNCE = 0x2916a9;

/** `ZombieLeapStrikeTarget`'s mode. `DEC EAX; JZ` at `0x0045A6D9`. */
export enum LeapTargetMode {
  /** In the camera block's own matrix -- the one `ZombieStateLeapStrike` uses. */
  CameraSpace = 0,
  /** From the point itself, turned by `g_camera_yaw_bams`. */
  FromPoint = 1,
}

/** `(float)(1 - 2 * obj+0x121)`, doubled: two units to one side per permit. */
const LEAP_SIDE = 2;
/** Condition 4's point: `c0400000` -3.0 and `c1480000` -12.5 in view space. */
const LEAP_DROP_CRAWLER = -3.0;
const LEAP_DEPTH_CRAWLER = -12.5;
/** ...and everyone else's, `c1400000` twice at `0x0045A722`/`0x0045A72A`. */
const LEAP_DROP = -12.0;
const LEAP_DEPTH = -12.0;
/** Mode 1's forward offsets: `41400000` 12.0 and `41480000` 12.5. */
const LEAP_AHEAD = 12.0;
const LEAP_AHEAD_CRAWLER = 12.5;

/**
 * `ZombieLeapStrikeTarget` — `FUN_0045A690`. Rewrites `point` as the place a
 * leap lands.
 *
 * ```
 * x = g_max_attackers == 1 ? 0 : 2 * (1 - 2 * obj+0x121)
 * mode != 1:  top = g_camera_blocks[g_camera_index] + 0x40
 *             point = top . (cond 4 ? (-x, -3.0, -12.5) : (x, -12.0, -12.0))
 * mode 1:     T(point) Ry(g_camera_yaw_bams)
 *             point = (cond 4 ? (-x, 0, 12.5) : (x, 0, 12.0))
 * ```
 *
 * `GameHost.viewPoint` is the `+0x40` matrix's seam, as it is for state 9's
 * landing point. A host with no camera leaves the point where it was, which
 * is the player's own position as `ActorFacePlayerTarget` recorded it and
 * only a headless run can see. Mode 1 is state 28's (`0x0045880B`), which the
 * port does not have; it is transcribed with the rest of the routine.
 */
export function ZombieLeapStrikeTarget(obj: ZombieActor, point: Vec3,
                                       mode: LeapTargetMode,
                                       host: GameHost): void {
  const x = G.g_max_attackers === 1
    ? 0 : LEAP_SIDE * (1 - 2 * obj.attackPermit);
  const crawler = obj.condition === HALVED_CONDITION;
  if (mode !== LeapTargetMode.FromPoint) {
    if (crawler) host.viewPoint(-x, LEAP_DROP_CRAWLER, LEAP_DEPTH_CRAWLER, point);
    else host.viewPoint(x, LEAP_DROP, LEAP_DEPTH, point);
    return;
  }
  _from.x = point.x; _from.y = point.y; _from.z = point.z;
  if (crawler) {
    ActorLocalPoint(_from, G.g_camera_yaw_bams, -x, 0, LEAP_AHEAD_CRAWLER, point);
  } else {
    ActorLocalPoint(_from, G.g_camera_yaw_bams, x, 0, LEAP_AHEAD, point);
  }
}
const _from = vec3();
const _kick = vec3();
const ORIGIN = vec3();

export function ZombieStateLeapStrike(obj: ZombieActor, eye: Vec3, dt: number,
                                      rng: Rng, host: GameHost,
                                      events?: Events): void {
  const frames = dt * GAME_HZ;
  if (obj.sub === LeapStrikeSub.Pick) {
    // `0045e384 OR EDX, 0x10020000`.
    obj.flags |= LEAP_FLAGS;
    // `picks[type][cond][(rand() >> 4) % 10 + (obj+0x1318 & 7) * 10]` into
    // `obj+0x131A` -- `ZombieStateStrike`'s draw, with the `>> 4` the port's
    // generator does not model (`ZombiePickAttack` says why it is one draw).
    obj.attack = ZombiePickAttack(obj, rng);
    // `0045e3db TEST EAX, 0x40000` / `0045e3e8 OR EAX, 0x40000`: the anchor
    // `ZombieStateStrike` captures, captured the same way.
    if (!(obj.flags2 & ZombieFlag2.StrikeAnchor)) {
      obj.strikeStart.x = obj.pos.x;
      obj.strikeStart.y = obj.pos.y;
      obj.strikeStart.z = obj.pos.z;
      obj.flags2 |= ZombieFlag2.StrikeAnchor;
    }
    obj.sub = LeapStrikeSub.Close;
  }

  // The engine dereferences `base + obj+0x131A * 0x10` blind. A draw the
  // bundle has no entry for is `ZombieStateStrike`'s own case, and gets that
  // state's answer -- see `ZombiePickAttack` and `ZombieGiveUpAttack`.
  const atk = AttackListOf(obj)[String(obj.attack)] ?? null;
  if (!atk) { ZombieGiveUpAttack(obj); return; }

  if (obj.sub === LeapStrikeSub.Close) {
    // `0045e410 CALL ActorFacePlayerTarget`, then the 2-D distance to the
    // point it recorded against the entry's `+0x04` -- `FCOMP [EBX + 0x4]` and
    // `TEST AH, 0x41`, so equal counts as in range.
    ActorFacePlayerTarget(obj, eye);
    if (dist2d(obj.pos, obj.target) > atk.distance) {
      // `0045e444 MOVSX EAX, word ptr [EBX + 0x2]` -- the lunge -- and
      // `ActorSetMotionBlended(obj+0x194, lunge, 0, 10)` unless `obj+0x1B4`
      // already holds it. The clip's own root motion is what closes.
      if (obj.motion !== atk.lunge) {
        ActorSetMotionBlended(obj, atk.lunge, 0, MotionFade.Normal);
      }
      return;
    }
    obj.sub = LeapStrikeSub.Launch;
  }

  if (obj.sub === LeapStrikeSub.Launch) {
    ZombieLeapStrikeTarget(obj, obj.target, LeapTargetMode.CameraSpace, host);
    ActorArcBeginToWaypoint(obj, obj.target, LeapStrikeArcScript(),
                            LEAP_ARC_STEP);
    // `0045e493 PUSH 0x3 / CALL 0x0040a6f0` -- the attack cry.
    ActorPlayHitVoice(obj, ActorVoice.Attack, rng,
                      (id) => events?.emit("sound.play", { id }));
    obj.sub = LeapStrikeSub.Flight;
  }

  if (obj.sub === LeapStrikeSub.Flight) {
    // `0045e4a5..0045e4e6`: past a quarter of the arc, a condition-4 actor
    // carrying both half-body bits splits in two. [diverges]
    // `ZombieSplitInTwo` (`FUN_0045D9F0`) is not ported, because
    // `ZombieFlag2.SplitArmed` is never raised by anything the shipped game
    // runs; see `class30/split.ts`. The test is kept, and so is the bit it
    // clears, so an actor that somehow carried it would lose it here as it
    // does in the engine.
    const armed = ZombieFlag2.LowSphere | ZombieFlag2.SplitArmed;
    if (obj.arcFrames > Math.trunc(obj.arcTotal / SPLIT_ARC_FRACTION)
        && obj.condition === HALVED_CONDITION
        && (obj.flags2 & armed) === armed) {
      obj.flags2 &= ~ZombieFlag2.SplitArmed;
    }
    // `0045e4eb PUSH 0x1 / PUSH ESI / CALL ActorArcStep`, `CMP EAX, 0x1 / JZ`.
    if (ActorArcStep(obj, 1, dt)) return;
    // `0045e500 CALL ActorStrikeConnect` -- on touching down, and on no frame
    // of any clip. This is the half the port never had: the crawlers' hit.
    ActorStrikeConnect(obj, atk, events);
    obj.sub = LeapStrikeSub.Recoil;
  }

  if (obj.sub === LeapStrikeSub.Recoil) {
    // `0045e50f MOV AL, [ESI + 0x1f1] / TEST AL, AL / JZ` -- the byte the
    // sampler raises once the clip has reached its play length. The port's
    // arc stages play on the one-shot channel, which ends by clearing it.
    if (obj.action !== null) return;
    // `[port-only]`: the engine's one track **still holds the landing clip**,
    // because `ActorArcStep` set it there with `ActorSetMotionBlended`, and it
    // plays on -- wrapping, as the sampler's `% (play_length + 1)` does --
    // through the bounce. The port played the three stages on the one-shot
    // channel instead, so its base track is still the lunge from sub 1, and
    // that clip's root motion would carry the crawler into the camera for the
    // length of the bounce. This brings the base track level with the
    // engine's: the landing clip, from its first frame, with no fade.
    const landing = obj.arcScript?.[2]?.motion;
    if (landing) ActorSetMotionBlended(obj, landing, 0, 0);
    ClearCurrentActorVelocityAndAccel(obj);
    obj.accY = RECOIL_GRAVITY;
    // `MatrixRotateY(g_camera_blocks[g_camera_index] + 0xD0)` applied to
    // `(0, 0, -0.3)`, and only x and z kept (`0045e588`, `0045e58b`). The port
    // keeps one camera heading, `g_camera_yaw_bams`, and reads it for the
    // block's yaw word as `Class14CameraBlockYaw` and the bat do.
    ActorLocalPoint(ORIGIN, G.g_camera_yaw_bams, 0, 0, RECOIL_SPEED, _kick);
    obj.vel.x = _kick.x;
    obj.vel.z = _kick.z;
    obj.sub = LeapStrikeSub.Bounce;
  }

  if (obj.sub !== LeapStrikeSub.Bounce) return;
  // `0045e59d FLD [ESI+0x5c] / FADD [ESI+0x50] / FSTP [ESI+0x50]`, then the
  // floor under the actor where it stands now; `EnemyZombieUpdate` moves it
  // by the velocity after the state returns.
  obj.vel.y += obj.accY * frames;
  const ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y, obj.pos.z);
  if (obj.pos.y + obj.vel.y > ground) return;
  obj.pos.y = ground;
  obj.vel.y *= BOUNCE_RESTITUTION;
  events?.emit("sound.play", { id: SND_BOUNCE });
  if (Math.abs(obj.vel.y) > BOUNCE_SETTLE) return;
  ClearCurrentActorVelocityAndAccel(obj);
  obj.state = ZombieState.BackOff;
  obj.sub = 0;
  // `0045e61f AND EAX, 0xfffdffff` -- back on the ground snap. `Committed`
  // stays up; `ZombieStateBackOff`'s own first frame is what lowers it.
  obj.flags &= ~ActorFlag.Airborne;
}

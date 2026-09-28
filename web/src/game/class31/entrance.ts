/**
 * The three entrances a `zstin` arrives by, all reading the same four bytes of
 * descriptor as three different things.
 *
 * Stage 2 uses each of them: block 17 step 5's pair walk fifteen units out of
 * the dark (state 18), block 18 and block 23's play a one-shot clip on the
 * spot (state 19), and block 21's two wait and then leap straight at you
 * (state 23). Every one of them ends up in `ThrowerStateStandAndDecide`, which
 * is where the fight actually starts.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, MotionFlag, ThrowerFlag, type ThrowerActor }
  from "../actor";
import { ThrowerTryClaimAttackSlot } from "../combat/permits";
import type { GameHost } from "../host";
import { MotionOf, SecondsToTicks } from "../tables";
import { vec3, type Vec3 } from "../vec";
import { TurnAngleTowardFrames } from "../actor_turn";
import { ActorSetMotionBlended, ZombieSetMotionIfIdle }
  from "../class30/motion_cue";
import { GAME_HZ, MotionFade } from "../class30/states";
import {
  ActorArcBegin, ActorArcStep, ActorClipFrame, ActorClipLength,
  ActorPlayCursor, ArcPhase,
} from "./arc";
import { ThrowerPickLandingPoint } from "./leap_down";
import { ThrowerMotion, ThrowerState } from "./states";
import { ThrowerStrikeConnect } from "./strike";
import {
  ThrowerAttackOf, ThrowerLoadAttackArcScript, ThrowerMotionOf,
  ThrowerPickAttack, ThrowerStanceOf,
} from "./tables";

const _dest = vec3();

/**
 * `ThrowerStateWalkDistance` — `FUN_0044E2A0`, class 0x31 state 18.
 *
 * Plays the set's walk clip and hands to the hub once the **2D** distance from
 * where it started reaches the float at descriptor tail `+0x04`. The walking
 * is the clip's own root motion, exactly as class 0x30's is; there is no
 * velocity here at all.
 */
export function ThrowerStateWalkDistance(obj: ThrowerActor, rng: Rng): void {
  if (obj.sub === 0) {
    ZombieSetMotionIfIdle(obj, ThrowerMotionOf(obj, ThrowerMotion.Walk), rng,
                          "clip", MotionFade.Quick);
    obj.arcFrom = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
    obj.sub = 1;
  }
  const dx = obj.arcFrom.x - obj.pos.x;
  const dz = obj.arcFrom.z - obj.pos.z;
  if (Math.hypot(dx, dz) < obj.walkDistance) return;

  obj.strikeStart.x = obj.pos.x;
  obj.strikeStart.y = obj.pos.y;
  obj.strikeStart.z = obj.pos.z;
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
}

/**
 * `ThrowerStateEntranceClip` — `FUN_0044E410`, class 0x31 state 19.
 *
 * One clip, named by the descriptor, played to two frames off its end. Stage
 * 2's `zstin` all name motion 296.
 */
export function ThrowerStateEntranceClip(obj: ThrowerActor): void {
  if (obj.sub === 0) {
    const m = MotionOf(obj, obj.entranceMotion);
    if (!m) { obj.state = ThrowerState.StandAndDecide; return; }
    obj.action = { motion: obj.entranceMotion, ticks: 0 };
    obj.rootActionFrame = -1;
    obj.sub = 1;
  }
  const len = ActorClipLength(obj, obj.entranceMotion);
  if (obj.action && ActorClipFrame(obj) < len - 2) return;
  obj.action = null;
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
}

/** `PUSH 0xccc` at `0x0044E980`: the roll's return to level, BAMS a frame. */
const POUNCE_ROLL_RATE = 0xccc;

/**
 * `ThrowerStateDelayedPounce` — `FUN_0044E830`, class 0x31 state 23.
 *
 * Both an entrance and an attack: a wait on a clip, then a leap at the camera
 * that ends in `ThrowerStateWithdraw` rather than in the leap aside. Stage 2
 * block 21's two `zstin` are the shipped spawns in it -- motion 310, a walk,
 * for 45 and 60 frames. `[proved]` from the listing, three subs that fall into
 * each other with no `RET` between (`SUB EAX,0/JZ`, `DEC/JZ`, `DEC/JZ` at
 * `0x0044E846`):
 *
 * ```
 * sub 0  0044e863  obj+0x1F8 |= 0x10                      ; RootMotionY
 *        0044e879  ActorSetMotionBlended(obj+0x194, desc+4, 0, 5)
 *        0044e884  obj+0x34 |= 0x100                       ; ShotImmune
 *        0044e894  obj+0x1330 = desc+8; sub 1, and on
 * sub 1  0044e8a0  if (--obj+0x1330 > 0) return
 *        0044e8ba  obj+0x1F8 &= ~0x10; obj+0x34 &= ~0x100
 *        0044e8ca  if (!ThrowerTryClaimAttackSlot(obj)) obj+0x121 = 0xFF
 *        0044e8e6  obj+0x34 |= 0x10000000; obj+0x136C |= 0x20000
 *        0044e927  obj+0x131A = g_class31_attack_picks[set]
 *                               [(rand() >> 4) % 10 + (obj+0x1318 & 7) * 10]
 *        0044e930  ThrowerLoadAttackArcScript(obj)
 *        0044e93b  ThrowerPickLandingPoint(obj, &p)
 *        0044e964  ActorArcBegin(obj+0x40..0x48, p.x, g_camera_eye_y, p.z,
 *                                desc+8)
 *        0044e96c  sub 2; obj+0x1360 = 0, and on
 * sub 2  0044e988  obj+0x6C = TurnAngleToward(obj+0x6C, 0, 0xCCC)
 *        0044e99e  if (obj+0x121 != 0xFF) ThrowerStrikeConnect(obj)
 *        0044e9f5  if (obj+0x19C > g_class31_melee_attacks[set]
 *                                   [attack + stance*4].hit_frame)
 *                    obj+0x34 |= 0x2000                    ; NoHitReaction
 *        0044ea07  if (ActorArcStep(obj, 1) != 1) {
 *                    obj+0x34 &= ~0x10000000; obj+0x136C &= ~0x20000
 *                    state 0x19, sub 0 }
 * ```
 *
 * **The wait cannot be shot, and it is a climb.** `ShotImmune` makes every
 * hit a ricochet until the counter runs out -- and on that same frame
 * `ActorArcStep`'s windup raises it again, so the actor is only shootable
 * from the takeoff on. The clip is the ordinary motion, so it loops for the
 * whole wait and its root carries the actor: 310 walks 7.19 units along its
 * own -Z a cycle. Both shipped spawns are placed on their sides against a
 * wall -- orient `(0, 0xC000, 0xC000)`, which `SpawnFromDescriptor`
 * (`FUN_00408A20`) copies to `obj+0x64..0x6C` -- and `SkeletonApplyRootMotion`
 * (`FUN_00410C50`) turns the delta by `Rz(roll) Ry(yaw) Rx(pitch)`, which
 * takes that -Z to world -Y. Bit `0x10` is what lets the height through, so
 * the walk is a climb straight down the wall: measured in the page, 8.7 units
 * in the 45-frame wait and 12.6 in the 60, the fade holding the first six
 * frames still (see `ApplyRootMotion`). Then the roll comes back to level in
 * the first six frames of the leap.
 *
 * **Three stances, and they are not the same one.** The script comes from the
 * live stance, which `obj+0x136C |= 0x20000` has just moved to the pounce
 * rows; the connect reads its hit frame through `obj+0x1364`, which only
 * `ThrowerStateLeapDown` writes and so is 0 for a spawn that has never leapt
 * down; and the `0x2000` test reads the live stance again. So stage 2's pair
 * swing row 4's clip 289, connect on row 0's frame 62 or 64, and stop
 * flinching past row 4's 66. That is what the code does, and it is not a
 * transcription slip.
 *
 * It used to play the wait as a one-shot, with no immunity and no root
 * height; raise `ActorFlag.BackingOff` (`0x20000000`, the bit
 * `RankEnemiesByDistance` drops from the queue) for `0x10000000`; latch the
 * connect's stance itself; aim at `obj.lookAt.y`, the actor's own tracked
 * point, for the eye's height; and never raise `0x2000`.
 */
export function ThrowerStateDelayedPounce(obj: ThrowerActor, eye: Vec3,
                                          dt: number, rng: Rng,
                                          host: GameHost,
                                          events?: Events): void {
  const p = obj.pounce;
  // [port-only] The engine reads `obj+0x1390` blind; the exporter emits no
  // tail for a descriptor whose clip or count is out of range.
  if (!p) { obj.state = ThrowerState.StandAndDecide; obj.sub = 0; return; }

  if (obj.sub === 0) {
    obj.motionFlags |= MotionFlag.RootMotionY;
    ActorSetMotionBlended(obj, p.motion, 0, MotionFade.Quick);
    obj.flags |= ActorFlag.ShotImmune;
    obj.sub = 1;
    obj.slideTimer = p.frames;
  }

  if (obj.sub === 1) {
    obj.slideTimer -= dt * GAME_HZ;
    if (obj.slideTimer > 0) return;
    obj.motionFlags &= ~MotionFlag.RootMotionY;
    obj.flags &= ~ActorFlag.ShotImmune;
    if (!ThrowerTryClaimAttackSlot(obj, rng, host)) obj.attackPermit = -1;
    obj.flags |= ActorFlag.Committed;
    obj.flags2 |= ThrowerFlag.Pouncing;
    obj.attack = ThrowerPickAttack(obj, rng.int(10));
    ThrowerLoadAttackArcScript(obj);
    ThrowerPickLandingPoint(obj, host, _dest);
    _dest.y = eye.y;                      // `g_camera_eye_y`, `0x009C71E4`
    ActorArcBegin(obj, _dest, p.frames);
    obj.sub = 2;
    obj.arcPhase = ArcPhase.Windup;
  }
  // A sub-state past 2 is the engine's `POP EDI / POP ESI / RET` at
  // `0x0044E855`: the dispatch has three arms and nothing else.
  if (obj.sub !== 2) return;

  // Roll back to level at 0xCCC a frame -- it comes in off the vertical.
  // `0044e97d`: `obj+0x6C = TurnAngleToward(obj+0x6C, 0, 0xCCC)`, on the
  // **roll**, every frame of sub 2 and on the frame sub 1 falls into it. This
  // line wrapped the yaw instead and never touched the roll.
  obj.roll = TurnAngleTowardFrames(obj.roll, 0, POUNCE_ROLL_RATE,
                                   SecondsToTicks(dt));
  if (obj.attackPermit >= 0) ThrowerStrikeConnect(obj, events);

  // Past the **live** stance's hit frame the actor stops flinching. Nothing
  // here takes the bit down again; `ThrowerStateWithdraw`'s exit does.
  const e = ThrowerAttackOf(obj, ThrowerStanceOf(obj), obj.attack);
  if (e && ActorPlayCursor(obj) > e.hit_frame) {
    obj.flags |= ActorFlag.NoHitReaction;
  }
  if (ActorArcStep(obj, 1, dt, host, events)) return;

  obj.flags &= ~ActorFlag.Committed;
  obj.flags2 &= ~ThrowerFlag.Pouncing;
  obj.state = ThrowerState.Withdraw;
  obj.sub = 0;
}

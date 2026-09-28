/**
 * The pounce, the leap back, and the pause between them.
 *
 * `ThrowerStateLeapDown` is the attack, and it is not a swing at a range: it
 * is an **arc onto a point in front of the camera** with the attack's own clip
 * laid over it, running `ThrowerStrikeConnect` every frame. The stab lands
 * because the arc put the actor there on the frame the attack entry names.
 *
 * `ThrowerStateLeapAside` is the leap back out of your face, and it is the
 * reason the fight has a rhythm: the actor arcs to a point five units to one
 * side of the camera and fifty in front, then stands there for ninety frames
 * before the router will consider anything else. That pause *is* the cooldown
 * — there is no timer. `zslman` is the exception: it leaps back to where its
 * pounce began, which for the wall-crawling ones is the wall.
 */
import type { ArcStage } from "../../bundle/characters";
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, ThrowerFlag, type ThrowerActor } from "../actor";
import { TurnActorAwayFromPoint } from "../actor_turn";
import { ThrowerReleaseAttackPermit } from "../combat/permits";
import { ActorPlayHitVoice, ActorVoice } from "../combat/voice";
import { ColiTraceSegmentAllSets } from "../coli";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import { DrawRecordSlot } from "../model_draw";
import { MotionPlayFrame, MotionPlayLength, SecondsToTicks } from "../tables";
import type { GameHost } from "../host";
import { vec3, type Vec3 } from "../vec";
import { ActorSetMotionBlended, SetCurrentActorMotionBlended }
  from "../class30/motion_cue";
import { GAME_HZ } from "../class30/states";
import {
  ARC_SCRIPT_DRAW_ATTACK, ActorArcBeginToWaypoint, ActorArcStep,
  ActorLocalPoint, ActorPlayCursor, ActorPlayMotion,
} from "./arc";
import { ThrowerPickLandingPoint } from "./leap_down";
import {
  ASIDE_AHEAD, ASIDE_SIDEWAYS, LEAP_ASIDE_CLEAR, LEAP_ASIDE_FRAMES,
  ThrowerMotion, ThrowerState,
} from "./states";
import { ThrowerStrikeConnect } from "./strike";
import { ThrowerArcScript, ThrowerMotionOf, ThrowerStanceOf } from "./tables";

const _dest = vec3();
/**
 * `FADD`/`FSUB float ptr [0x004C49C4]` = `0x447A0000` at `0x0044B9C8` and
 * `0x0044B9DD`: how far above and below the tracked point the probe reaches.
 */
const ASIDE_PROBE = 1000;

const CHAR_ZSASS = 0x16;
/** `CMP word ptr [ESI + 0x1F4], 0x17` at `0x0044ECF8`: `zskamere`. */
const CHAR_ZSKAMERE = 0x17;
const CHAR_ZSLMAN = 0x18;
/**
 * `PUSH 0xffffff00` at `0x0044BB1B`: the leap aside's turn, a negative rate,
 * so the long way round, away from where the leap began.
 */
const LEAP_ASIDE_TURN_RATE = -0x100;
/** `PUSH 0xffffff00` at `0x0044ED0E`: type 0x17's turn out of the swing. */
const WITHDRAW_TURN_RATE = -0x100;
/** Type 0x17 is clear of the camera at thirty units, not fifty. */
const WITHDRAW_CLEAR_BACKING = 30;

/** The head, whose draw record is `obj+0x20C + 2 * 0x90` = `obj+0x32C`. */
const HEAD_BONE = 2;
/**
 * `CMP EAX, 0x2002` at `0x0044B6F6`, against `obj+0x32C`: the pounce cries out
 * only while the head's draw record holds this slot. `[open]` which character
 * types' heads it is and what replaces it; the test is the engine's either way.
 */
const CRYING_HEAD_SLOT = 0x2002;
/**
 * `AND EAX, 0xfffff61f` at `0x0044B721`: what the pounce takes off every type
 * but `zslman` -- the swing's connect latch, the three surface bits and
 * off-the-ground. **Not** bit `0x200`, which the port used to clear with them.
 */
const LEAP_DOWN_CLEAR = ThrowerFlag.Struck | ThrowerFlag.Surface
                      | ThrowerFlag.OffGround;
/**
 * `g_script_flags[0xF2]` -- `MOV AL, [0x009C72F2]` at `0x0044B7E7`. In
 * Training Mode the re-snap waits on it. `FUN_00497760` raises it
 * (`0x004979B6`); what it stands for there is `[open]`.
 */
const LEAP_DOWN_HOLD_FLAG = 0xf2;
/** `SUB EAX, 0x2` at `0x0044B827` and `0x0044BC44`: two short of the end. */
const CLIP_END_SLACK = 2;

/**
 * `3*bit8 + 2*bit7 + bit6` of `obj+0x136C` -- the surface row, **without**
 * the pounce bit `ThrowerStanceOf` also counts. `ThrowerStateLeapAside`
 * computes it twice for `zslman` (`0x0044BA7F`, `0x0044BB8B`) and switches on
 * 1, 2 and 3 with everything else taking the default arm.
 */
function LeapAsideSurfaceRow(obj: ThrowerActor): number {
  const f = obj.flags2;
  return (f & ThrowerFlag.Ceiling ? 3 : 0) + (f & ThrowerFlag.WallB ? 2 : 0)
       + (f & ThrowerFlag.WallA ? 1 : 0);
}

/**
 * `ThrowerStateLeapDown` — `FUN_0044B670`, class 0x31 states 9, 12 and 13.
 *
 * Three state ids, one handler: the router's picks name 12 at middle range and
 * 13 far out, and `ThrowerStateWaitForPermit` sends the close case to 9.
 * `[proved]` from the listing -- four arms off the jump table at `0x0044B868`
 * (`0x0044B68F`, `0x0044B759`, `0x0044B7A4`, `0x0044B835`), each of the first
 * three ending in `INC word ptr [ESI + 0x1312]` and running on into the next,
 * and `JA 0x0044B861` returning for a sub past 3:
 *
 * ```
 * sub 0  0044b695  ThrowerPickLandingPoint(obj, &p)
 *        0044b6ad  obj+0x68 = g_camera_yaw_bams
 *        0044b6b0  ActorArcBeginToWaypoint(obj, &p, &DAT_007DCC70, 1)
 *        0044b6fb  obj+0x1364 = bit6 + 2*(bit7 + 2*bit17) + 3*bit8 of +0x136C
 *        0044b6f0  obj+0x34 |= 0x10000000
 *        0044b709  if (obj+0x32C == 0x2002) ActorPlayHitVoice(obj, 3)
 *        0044b721  type != 0x18: obj+0x136C &= 0xfffff61f
 *        0044b734  type == 0x18: obj+0x136C &= ~0x800; obj+0x13D8.. = obj+0x40..
 * sub 1  0044b76f  if (!(obj+0x136C & 0x800) && type != 0x18)
 *                    ThrowerStrikeConnect(obj)
 *        0044b77a  if (ActorArcStep(obj, 1) == 1) return
 *        0044b791  obj+0x136C &= 0xffe7ffff
 * sub 2  0044b7b0  if (!(obj+0x136C & 0x800)) ThrowerStrikeConnect(obj)
 *        0044b7b8  if (g_GameMode != 2 || !g_script_flags[0xF2])
 *                    obj+0x40.. = ThrowerPickLandingPoint(obj)
 *        0044b82c  if (obj+0x19C < g_motion_play_length[obj+0x1B4] - 2) return
 * sub 3  0044b83e  obj+0x136C &= ~0x800; obj+0x34 &= ~0x10000000
 *                  state 10, sub 0
 * ```
 *
 * Two details that are easy to get backwards. The **stance is latched after
 * the arc is begun and before the surface bits are cleared**, so a thrower
 * that pounces off a wall swings the wall's attack, and arrives on the
 * ground. And the attack index is not chosen here at all: passing the
 * sentinel to `ActorArcBeginToWaypoint` is what makes it draw one.
 *
 * `zslman` is the other shape: it keeps its surface, does not connect in
 * flight, and records where it left from -- which is where
 * `ThrowerStateLeapAside` sends it back to.
 *
 * **Down, it collides with nothing.** Both collision bits come off the frame
 * the arc lands, and the re-snap to the landing point holds it there while the
 * clip plays out; `ThrowerStateLeapAside` raises them again on its first
 * frame.
 *
 * This used to raise and clear `ActorFlag.BackingOff` (`0x20000000`) for
 * `0x10000000`, clear bit `0x200` with the surface bits, skip the attack draw
 * and the two stores for `zslman`, never cry out, leave collision up, connect
 * on every frame whatever `0x800` said, skip the Training-Mode test, run its
 * exit for any sub past 2, and wait for the port's one-shot channel to empty
 * rather than for the cursor to come within two of the clip's end.
 */
export function ThrowerStateLeapDown(obj: ThrowerActor, dt: number, rng: Rng,
                                     host: GameHost, events?: Events): void {
  if (obj.sub === 0) {
    ThrowerPickLandingPoint(obj, host, _dest);
    obj.yaw = G.g_camera_yaw_bams;
    ActorArcBeginToWaypoint(obj, _dest, ARC_SCRIPT_DRAW_ATTACK, 1, rng);
    obj.thr.stance = ThrowerStanceOf(obj);
    obj.flags |= ActorFlag.Committed;
    if (DrawRecordSlot(obj, HEAD_BONE) === CRYING_HEAD_SLOT) {
      ActorPlayHitVoice(obj, ActorVoice.Attack, rng,
                        (id) => events?.emit("sound.play", { id }));
    }
    if (obj.charType !== CHAR_ZSLMAN) {
      obj.flags2 &= ~LEAP_DOWN_CLEAR;
    } else {
      obj.flags2 &= ~ThrowerFlag.Struck;
      obj.strikeStart.x = obj.pos.x;
      obj.strikeStart.y = obj.pos.y;
      obj.strikeStart.z = obj.pos.z;
    }
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    if (!(obj.flags2 & ThrowerFlag.Struck) && obj.charType !== CHAR_ZSLMAN) {
      ThrowerStrikeConnect(obj, events);
    }
    if (ActorArcStep(obj, 1, dt, host, events)) return;
    obj.flags2 &= ~ThrowerFlag.Collide;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    if (!(obj.flags2 & ThrowerFlag.Struck)) ThrowerStrikeConnect(obj, events);
    // The engine re-snaps to the landing point every frame, so the actor
    // tracks a camera that is still moving -- unless Training Mode is holding
    // it.
    if (G.g_GameMode !== GameMode.Training
        || !G.g_script_flags[LEAP_DOWN_HOLD_FLAG]) {
      ThrowerPickLandingPoint(obj, host, _dest);
      obj.pos.x = _dest.x;
      obj.pos.y = _dest.y;
      obj.pos.z = _dest.z;
    }
    if (ActorPlayCursor(obj)
        < MotionPlayLength(obj, ActorPlayMotion(obj)) - CLIP_END_SLACK) {
      return;
    }
    obj.sub = 3;
  }

  if (obj.sub !== 3) return;
  obj.flags2 &= ~ThrowerFlag.Struck;
  obj.flags &= ~ActorFlag.Committed;
  obj.state = ThrowerState.LeapAside;
  obj.sub = 0;
}

/**
 * `ThrowerStateLeapAside`'s choice of script, `0x0044BA3F`..`0x0044BAE5`: by
 * attack, then by character, then -- for `zslman` alone -- by surface.
 *
 * ```
 * obj+0x131A == 3 && type != 0x18  ->  0x00564AF8    aside_attack3
 * type 0x16                        ->  0x005649A8    aside_zsass
 * type 0x17                        ->  nothing copied
 * type 0x18, surface row 1, 2, 3   ->  0x00564D68, 0x00564DC8, 0x00564E28
 *            anything else         ->  0x00564D08    aside_zslman_<row>
 * every other type                 ->  0x00564AC8    aside
 * ```
 *
 * `zslman`'s four sit `0x60` apart, interleaved with its four pounce scripts;
 * the exporter used to read them at `0x30`, which gave rows 1 to 3 a pounce
 * and its neighbour's leap.
 *
 * [diverges] **Character type 0x17 gets no script.** Its arm is
 * `JZ 0x0044BAE7`, past the `MOVSD.REP` every other arm ends in, so the engine
 * hands `ActorArcBeginToWaypoint` twelve dwords of this frame's uninitialised
 * stack. The port cannot reproduce that and does not invent a stand-in: it
 * installs none, and the arc ends on the frame it begins. `zskamere` reaches
 * this state only through `ThrowerStateFallToSurface` with `obj+0x34` bit
 * `0x20000000` up -- its picks name neither 12 nor 13, and
 * `ThrowerStateWaitForPermit` sends it to 0x18 or 0x20 -- and no shipped run
 * has been shown to get it there. `[open]` whether one does.
 */
function LeapAsideScript(obj: ThrowerActor): ArcStage[] | null {
  if (obj.attack === 3 && obj.charType !== CHAR_ZSLMAN) {
    return ThrowerArcScript("aside_attack3");
  }
  switch (obj.charType) {
    case CHAR_ZSASS: return ThrowerArcScript("aside_zsass");
    case CHAR_ZSKAMERE: return null;
    case CHAR_ZSLMAN: {
      const row = LeapAsideSurfaceRow(obj);
      return ThrowerArcScript(`aside_zslman_${row >= 1 && row <= 3 ? row : 0}`);
    }
    default: return ThrowerArcScript("aside");
  }
}

/**
 * `zslman`'s landing clip by surface row, `0x0044BB8B`..`0x0044BBCD`: 1 takes
 * `0x211`, 2 `0x20E`, 3 `0x214`, and anything else `0x20B` -- played through
 * `ActorSetMotionBlended` at fade 5 where every other type takes the motion
 * set's landing clip at fade 1.
 */
const ZSLMAN_LAND_BY_ROW: Readonly<Record<number, number>> = {
  1: 0x211, 2: 0x20e, 3: 0x214,
};
const ZSLMAN_LAND_DEFAULT = 0x20b;
/** `PUSH 0x1` at `0x0044BB6E` and `PUSH 0x5` at `0x0044BBD2`. */
const LEAP_ASIDE_LAND_FADE = 1;
const LEAP_ASIDE_LAND_FADE_ZSLMAN = 5;

/**
 * `ThrowerStateLeapAside` — `FUN_0044B880`, class 0x31 state 10.
 *
 * Where to land is worked out in the **camera's own frame**, yaw only: five
 * units to one side and fifty in front. Then a vertical segment is traced
 * there, from a thousand units below the actor's tracked point to a thousand
 * above, and the actor lands on whatever that hits — a ledge, a walkway, the
 * street. When the trace misses, the engine's own fallback is the ground plane
 * `g_camera_fixed_eye_y`, which is what a host with no collision always gets.
 *
 * `[proved]` from the listing. Three arms (`SUB EAX, 0` / `DEC` / `DEC` at
 * `0x0044B890`), the first two running on into the next, and a `RET` at
 * `0x0044B8A3` for any other sub. Ghidra's pseudocode stops sub 0 at the
 * `MatrixStackPop` at `0x0044BA37`, which it has marked no-return (`L35`); the
 * listing goes on into the script choice and the arc.
 *
 * ```
 * sub 0  0044b8ba  obj+0x34 |= 0x20000000; obj+0x136C |= 0x180000
 *        0044b8d7  type 0x17: obj+0x34 |= 0x2000
 *        0044b8e1  type != 0x18:
 *                    MatrixTranslate(g_camera_eye); MatrixRotateY(yaw)
 *                    x = obj+0x136C & 0x10 ? 5.0 : (1 - 2*(rand() % 2)) * 5.0
 *                    p = MatrixTransformPoint(x, 0, 50.0)
 *        0044b9ea      if (ColiTraceSegmentAllSets(p.x, obj+0x104 - 1000, p.z,
 *                                                  p.x, obj+0x104 + 1000, p.z))
 *                        obj+0x13D8.. = g_coli_hit
 *                      else obj+0x13D8.. = (p.x, g_camera_fixed_eye_y, p.z)
 *        0044baf6  ActorArcBeginToWaypoint(obj, obj+0x13D8, script, 1)
 * sub 1  0044bb23  if (!(obj+0x136C & 0x20))
 *                    TurnActorAwayFromPoint(obj, obj+0x13D8, obj+0x13E0, -0x100)
 *        0044bb2e  if (ActorArcStep(obj, 1) == 1) return
 *        0044bb43  obj+0x34 &= ~0x20000000; obj+0x1338 = 0
 *        0044bb56  ThrowerReleaseAttackPermit(obj)
 *        0044bb84  type != 0x18: SetCurrentActorMotionBlended(set[4], 0, 1)
 *        0044bbde  type == 0x18: ActorSetMotionBlended(by row, 0, 5)
 * sub 2  0044bbf6  if (++obj+0x1338 < 0x5A && 2D distance to the eye < 50)
 *                    return
 *        0044bc49  if (obj+0x19C < g_motion_play_length[obj+0x1B4] - 2) return
 *                  state 7, sub 0
 * ```
 *
 * **`zslman` goes back where it came from.** It skips the camera-relative
 * point entirely, so its arc is to `obj+0x13D8` as `ThrowerStateLeapDown`
 * left it -- the spot it pounced from -- on the script for the surface it
 * never left. And `0x20000000` is up for the whole leap, which is what
 * `ThrowerEmitGroundDust`'s landing column answers and what sends a fall out
 * of it back here.
 *
 * This used to raise none of sub 0's three writes; take a camera-relative
 * point for `zslman` too, and pick its script by `ThrowerStanceOf & 3`; give
 * `zskamere` the default script; land through class 0x30's
 * `ZombieSetMotionIfIdle`, which refused while the arc's clip was on and drew
 * a `rand()` the engine does not; count ninety frames with `>` where the
 * engine counts with `>=`; run sub 2 for any sub; and wait for the one-shot
 * channel to empty rather than for the cursor.
 */
export function ThrowerStateLeapAside(obj: ThrowerActor, eye: Vec3, dt: number,
                                      rng: Rng, host?: GameHost,
                                      events?: Events): void {
  if (obj.sub === 0) {
    obj.flags |= ActorFlag.BackingOff;
    obj.flags2 |= ThrowerFlag.Collide;
    if (obj.charType === CHAR_ZSKAMERE) obj.flags |= ActorFlag.NoHitReaction;
    if (obj.charType !== CHAR_ZSLMAN) {
      // `rand() & 0x80000001` with the sign fix-up, of a `rand()` that is
      // never negative: `rand() % 2`, and 0 is the right-hand side.
      const side = (obj.flags2 & ThrowerFlag.LeapAsideFixedSide)
        ? 1 : 1 - 2 * rng.int(2);
      // The camera's **yaw only**, not its whole matrix: the point stays level
      // however the camera is pitched, which is why the engine builds it with
      // a bare `MatrixRotateY(g_camera_yaw_bams)`.
      ActorLocalPoint(eye, G.g_camera_yaw_bams, side * ASIDE_SIDEWAYS, 0,
                      ASIDE_AHEAD, _dest);
      if (ColiTraceSegmentAllSets(_dest.x, obj.lookAt.y - ASIDE_PROBE, _dest.z,
                                  _dest.x, obj.lookAt.y + ASIDE_PROBE,
                                  _dest.z)) {
        obj.strikeStart.x = G.g_coli_hit_x;
        obj.strikeStart.y = G.g_coli_hit_y;
        obj.strikeStart.z = G.g_coli_hit_z;
      } else {
        obj.strikeStart.x = _dest.x;
        obj.strikeStart.y = G.g_camera_fixed_eye_y;
        obj.strikeStart.z = _dest.z;
      }
    }
    ActorArcBeginToWaypoint(obj, obj.strikeStart, LeapAsideScript(obj), 1);
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    if (!(obj.flags2 & ThrowerFlag.OffGround)) {
      TurnActorAwayFromPoint(obj, obj.strikeStart, LEAP_ASIDE_TURN_RATE, dt);
    }
    if (ActorArcStep(obj, 1, dt, host, events)) return;
    obj.flags &= ~ActorFlag.BackingOff;
    obj.thr.sinceLanding = 0;
    ThrowerReleaseAttackPermit(obj);
    if (obj.charType !== CHAR_ZSLMAN) {
      const land = ThrowerMotionOf(obj, ThrowerMotion.Land);
      if (land !== undefined) {
        SetCurrentActorMotionBlended(obj, land, 0, LEAP_ASIDE_LAND_FADE);
      }
    } else {
      ActorSetMotionBlended(obj,
        ZSLMAN_LAND_BY_ROW[LeapAsideSurfaceRow(obj)] ?? ZSLMAN_LAND_DEFAULT,
        0, LEAP_ASIDE_LAND_FADE_ZSLMAN);
    }
    obj.sub = 2;
  }

  // Stand where it landed until it is clear of the camera *and* the landing
  // clip has all but played out. That wait is the pause between attacks.
  if (obj.sub !== 2) return;
  obj.thr.sinceLanding += SecondsToTicks(dt);
  if (obj.thr.sinceLanding < LEAP_ASIDE_FRAMES
      && dist2(obj, eye) < LEAP_ASIDE_CLEAR * LEAP_ASIDE_CLEAR) {
    return;
  }
  if (ActorPlayCursor(obj)
      < MotionPlayLength(obj, ActorPlayMotion(obj)) - CLIP_END_SLACK) {
    return;
  }
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
}

function dist2(obj: ThrowerActor, eye: Vec3): number {
  const dx = obj.pos.x - eye.x;
  const dz = obj.pos.z - eye.z;
  return dx * dx + dz * dz;
}

/**
 * `ThrowerStateWithdraw` — `FUN_0044EC80`, class 0x31 state 25.
 *
 * The retreat the two *scripted* attacks end in — state 22's and state 23's —
 * where the ordinary pounce ends in the leap aside instead. Play the landing
 * clip, and go back to standing once ninety frames have passed or the actor
 * is clear of the camera. `[proved]`, the whole routine:
 *
 * ```
 * sub 0     obj+0x34 |= 0x20000000; obj+0x136C |= 0x180000
 *           type 0x17: obj+0x34 |= 0x2000
 *           SetCurrentActorMotionBlended(g_class31_motion_sets[cond][4], 0, 1)
 *           sub 1, obj+0x1338 = 0, and on into sub 1
 * type 0x17 TurnActorAwayFromPoint(obj, obj+0x13D8, obj+0x13E0, -0x100)   0044ed16
 *           if (++obj+0x1338 < 0x5A && 2D distance to the eye < 30) return
 * others    if (++obj+0x1338 < 0x5A && 2D distance to the eye < 50) return
 *           if (obj+0x19C < g_motion_play_length[obj+0x1B4] - 2) return
 * exit      obj+0x1338 = 0; ThrowerReleaseAttackPermit; state 7, sub 0
 *           obj+0x34 &= ~0x20002000
 * ```
 *
 * **Character type 0x17 is a different retreat**: it keeps turning to face
 * where its strike began -- the negative rate turns the long way, so away
 * from it -- it only has to get thirty units clear, it does not wait for the
 * clip, and it will not flinch while it goes. The port had one retreat for
 * every type, with no turn at all, a pooled "if idle" motion call at fade 10,
 * and an exit that waited on the swing channel instead of the clip.
 */
export function ThrowerStateWithdraw(obj: ThrowerActor, eye: Vec3, dt: number,
                                     _rng: Rng): void {
  const backsOff = obj.charType === CHAR_ZSKAMERE;
  if (obj.sub === 0) {
    obj.flags |= ActorFlag.BackingOff;
    obj.flags2 |= 0x180000;
    if (backsOff) obj.flags |= ActorFlag.NoHitReaction;
    const land = ThrowerMotionOf(obj, ThrowerMotion.Land);
    if (land !== undefined) SetCurrentActorMotionBlended(obj, land, 0, 1);
    obj.sub = 1;
    obj.thr.sinceLanding = 0;
  } else if (obj.sub !== 1) {
    return;
  }

  if (backsOff) {
    TurnActorAwayFromPoint(obj, obj.strikeStart, WITHDRAW_TURN_RATE, dt);
    obj.thr.sinceLanding += dt * GAME_HZ;
    if (obj.thr.sinceLanding < LEAP_ASIDE_FRAMES
        && dist2(obj, eye) < WITHDRAW_CLEAR_BACKING * WITHDRAW_CLEAR_BACKING) {
      return;
    }
  } else {
    obj.thr.sinceLanding += dt * GAME_HZ;
    if (obj.thr.sinceLanding < LEAP_ASIDE_FRAMES
        && dist2(obj, eye) < LEAP_ASIDE_CLEAR * LEAP_ASIDE_CLEAR) return;
    if (MotionPlayFrame(obj) < MotionPlayLength(obj) - 2) return;
  }

  obj.thr.sinceLanding = 0;
  ThrowerReleaseAttackPermit(obj);
  obj.state = ThrowerState.StandAndDecide;
  obj.flags &= ~(ActorFlag.BackingOff | ActorFlag.NoHitReaction);
  obj.sub = 0;
}

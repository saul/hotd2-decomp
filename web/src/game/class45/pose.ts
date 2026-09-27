/**
 * Class 0x45 poses its own skeletons: `Boss3ComposeBonePose` and the two
 * routines around it.
 *
 * The heads' extra rotations and the body's chain along its path are
 * gameplay, not decoration. The jaw test that gates every head shot reads
 * the extra Z, the neck sum gates it again, and the weak bone's world point
 * -- which the camera tracks and the body publishes as `obj+0x100` -- is the
 * end of the chain these build. So all of it is here, over the model words
 * `class45/model.ts` keeps, and `render/characters/boss3.ts` draws the result.
 */
import type { Events } from "../../core/events";
import type { Boss3Actor } from "../actor";
import { G } from "../globals";
import { BAMS_TO_RAD_F64, RAD_TO_BAMS } from "../../core/bams";
import { FtolS16 } from "../matrix";
import { MotionPlayLength } from "../tables";
import { Boss3BodyState, Boss3HeadState, Boss3Variant } from "./state";
import { Boss3PoseMatrices } from "./model";
import { Boss3NextRand } from "./rand";
import { Boss3SpawnSplashAt } from "./tasks";

/** `FMUL double ptr [0x0055CB20]` -- radians to BAMS (`0x004C4378`), negated. */
const RAD_TO_BAMS_NEG = -RAD_TO_BAMS;
/** `[0x0055CB30]`, `[0x0055CB34]` -- 516 and 258: the attack's Y extra, less per index. */
const ATTACK_Y_BASE = 516;
const ATTACK_Y_STEP = 258;
/** `[0x0055CB2C]`, `[0x005308E8]` -- 288 and 144: the X extra. */
const ATTACK_X_BASE = 288;
const ATTACK_X_STEP = 144;
/** Heads 0 and 4 hold their extras until cursor `0x28`. */
const ATTACK_HOLD_CURSOR = 0x28;
/** `[0x004C43A0]` 8.0 and `[0x0055CB28]` 0.125 -- the flinch's decay. */
const DECAY_FRAMES = 8;
const DECAY_SCALE = 0.125;
/** `[0x0055CB3C]` 6400.0 and `[0x0055CB38]` 1536.0 -- the big head's jaw sway. */
const SWAY_AMPLITUDE = 6400;
const SWAY_OFFSET = 1536;
/** The sway's step, its end and its rewind: `+0x200`, `0x8000`, `-300 - NextRand(0x96)`. */
const SWAY_STEP = 0x200;
const SWAY_END = 0x8000;
const SWAY_REWIND = -300;
const SWAY_REWIND_SPREAD = 0x96;
/** The chain walks three path points a bone, four on variant 0's surfacing 2. */
const CHAIN_STRIDE = 3;
const CHAIN_STRIDE_LONG = 4;
/** `CMP ECX, 0x3C` -- the walk's own bound. */
const CHAIN_WALK_LIMIT = 0x3c;
/** The path cursor's lap restart: `0x11E` on variant 0, `0xDD` otherwise. */
export const BOSS3_PATH_RESTART_A = 0x11e;
export const BOSS3_PATH_RESTART_B = 0xdd;
/** Variant 0 pitches the chain between path points `0x43F` and `0x57A`. */
const PITCH_FROM = 0x43f;
const PITCH_TO = 0x57a;
/** `[0x004E1FDC]` 65536.0 and `[0x0055CB1C]` 512.0 -- the dead body's ripple. */
const RIPPLE_TURN = 65536;
const RIPPLE_AMPLITUDE = 512;
/** The clip the body's tail is excluded from the chain in. */
const CLIP_SURFACE = 0x3d;
/** `0.5` at `[0x004C43AC]` -- an odd cursor's root, halved against the last even one. */
const ROOT_HALF = 0.5;

/** `(u16)v`, then the short way round: `CMP 0x8000; JLE; SUB 0x10000`. */
function Wrap16(v: number): number {
  const d = v & 0xffff;
  return d > 0x8000 ? d - 0x10000 : d;
}

/** Signed division truncating toward zero, as `IDIV`/`SAR`-with-bias do. */
const Div = (a: number, b: number): number => Math.trunc(a / b);

/** `__ftol` of a float the FPU carried. */
const Ftol = (v: number): number => Math.trunc(v);

/** `pts[c]` of the body's path. */
function Pt(pts: number[], c: number, k: number): number {
  return pts[c * 3 + k] ?? 0;
}

/**
 * `Boss3BigHeadJawSway` — `FUN_00422C70`. Stage 6's big head works its jaw:
 * while `+0x77B4` is negative it counts up; once it is not, it steps by
 * `0x200` and swings the two jaws' extra Z by `sin * 6400 -/+ 1536`, and
 * past half a turn rewinds to `-300 - NextRand(0x96)`.
 */
export function Boss3BigHeadJawSway(obj: Boss3Actor): void {
  const blk = obj.boss3.block;
  if (!blk) return;
  if (blk.jawSway < 0) blk.jawSway += 1;
  if (blk.jawSway < 0) return;
  const v = blk.jawSway + SWAY_STEP;
  blk.jawSway = v;
  const s = Math.sin(v * BAMS_TO_RAD_F64);
  blk.extraZ[blk.jawA] = Ftol(s * SWAY_AMPLITUDE - SWAY_OFFSET);
  blk.extraZ[blk.jawB] = Ftol(SWAY_OFFSET - s * SWAY_AMPLITUDE);
  if (blk.jawSway >= SWAY_END) {
    blk.jawSway = SWAY_REWIND - Boss3NextRand(SWAY_REWIND_SPREAD);
  }
}

/**
 * `Boss3ComposeBonePose` — `FUN_00421F20`. Per bone, per state (the table at
 * `0x00422C38`), then the skeleton's matrices over what that left:
 *
 * * **4** the big head's jaw sway (stage 6, `Boss3BigHeadJawSway`);
 * * **5** the bite's extra rotation -- `extraX = ftol(B t)`, `extraY =
 *   ftol(A t)` with `A = 516 - idx*258`, `B = 288 - idx*144` and `t` rising
 *   to the hit frame and falling after -- and the neck's summed Z at the weak
 *   bone into `+0x5A4`;
 * * **6, 7** the extras decaying by `(8 - obj+0x1340) / 8`;
 * * **10..12** the body's chain along its path, **13** the same eased by a
 *   thirty-second, **14** the dead body's ripple.
 *
 * `g_boss3_pose_bone` (`0x007DC724`) is written every pass and read by
 * nothing, as in the engine.
 */
export function Boss3ComposeBonePose(obj: Boss3Actor): void {
  const t = obj.boss3;
  const blk = t.block;
  if (!blk) return;
  const idx = t.index;
  const body = idx === 8;
  const state = obj.state;
  const weak = blk.weakBone;
  const a = Ftol(ATTACK_Y_BASE - idx * ATTACK_Y_STEP);
  const b = Ftol(ATTACK_X_BASE - idx * ATTACK_X_STEP);
  // The frame's locals: F+0x10 and F+0x20 the two path cursors, F+0x18 the
  // yaw (and neck) sum, F+0x44 the pitch sum, F+0x24 the extra Z's factor --
  // zero, and only the chain ever writes it -- and F+0x0C the attack's t.
  let c1 = blk.pathCursor;
  let c2 = blk.pathCursor;
  let yawSum = 0;
  let pitchSum = 0;
  let zFactor = 0;
  let tt = 0;
  const variant = G.g_boss3_variant;
  const restart = variant !== 0 ? BOSS3_PATH_RESTART_B : BOSS3_PATH_RESTART_A;
  const wrap = (c: number): number => (c >= blk.pathCount ? restart : c);
  const pts = blk.points;
  const eye = G.g_camera_block_eye;
  for (let i = 0; i < blk.boneCount; i++) {
    G.g_boss3_pose_bone = i;
    const o = i * 3;
    switch (state) {
      case Boss3HeadState.Idle:
        if (variant === Boss3Variant.Stage6 && idx === 2 && i === blk.jawA) {
          Boss3BigHeadJawSway(obj);
        }
        break;
      case Boss3HeadState.Attack: {
        // A zero hit frame skips the division (`0x00422136`), and `t` is then
        // the last one computed -- which is what the unwritten frame slot
        // holds, so it carries over from the bone before.
        let skipExtras = false;
        const cur = t.cursor;
        const hit = blk.hitFrame;
        const len = MotionPlayLength(obj, obj.motion);
        if (idx === 2) {
          skipExtras = true;
        } else if (idx === 1 || idx === 3) {
          if (hit !== 0) {
            tt = hit > cur ? Math.fround(cur / hit)
              : Math.fround((len - cur) / (len - hit));
          }
        } else if (cur > ATTACK_HOLD_CURSOR && cur < hit) {
          tt = Math.fround((cur - ATTACK_HOLD_CURSOR)
                           / (hit - ATTACK_HOLD_CURSOR));
        } else if (hit > cur) {
          skipExtras = true;
        } else if (hit !== 0) {
          tt = Math.fround((len - cur) / (len - hit));
        }
        if (!skipExtras) {
          blk.extraX[i] = Ftol(b * tt);
          blk.extraY[i] = Ftol(a * tt);
          blk.extraZ[i] = Ftol(zFactor * tt);
        }
        if (i <= weak) {
          yawSum += t.boneRot[o + 2];
          if (i === weak) blk.neckSum = yawSum | 0;
        }
        break;
      }
      case Boss3HeadState.Flinch:
      case Boss3HeadState.Dead: {
        const k = (DECAY_FRAMES - t.blend);
        blk.extraX[i] = Ftol(k * blk.extraX[i] * DECAY_SCALE);
        blk.extraY[i] = Ftol(k * blk.extraY[i] * DECAY_SCALE);
        blk.extraZ[i] = Ftol(k * blk.extraZ[i] * DECAY_SCALE);
        break;
      }
      case Boss3BodyState.Swim:
      case Boss3BodyState.Surfaced:
      case Boss3BodyState.Lunge: {
        if (i === 1) {
          // `0x00422200`: bone 1 sits on the path cursor.
          t.boneRot[o] = 0;
          t.boneRot[o + 2] = 0;
          const px = Pt(pts, blk.pathCursor, 0);
          const py = Pt(pts, blk.pathCursor, 1);
          const pz = Pt(pts, blk.pathCursor, 2);
          blk.anchorX[1] = px; blk.anchorZ[1] = pz;
          blk.anchor2X[1] = px; blk.anchor2Y[1] = py; blk.anchor2Z[1] = pz;
          if (state === Boss3BodyState.Lunge) {
            const ang = Math.atan2(obj.pos.x - eye.x, obj.pos.z - eye.z);
            const f = Ftol(ang * RAD_TO_BAMS_NEG);
            const d = Wrap16(((0xc000 - f) & 0xffff) - (blk.yaw[1] & 0xffff));
            blk.yaw[1] = blk.yaw[1] + Div(d, 6);
            t.boneRot[o + 1] = blk.yaw[1];
            if (variant === 0 && blk.eventIndex === 4) {
              blk.yaw[1] = FtolS16(ang * RAD_TO_BAMS) - 0x4000;
              t.boneRot[o + 1] = blk.yaw[1];
            }
          } else {
            t.boneRot[o + 1] = 0;
          }
        }
        if (state === Boss3BodyState.Lunge) {
          if (i > 1 && i <= weak) {
            const d = Wrap16(-blk.yaw[i]);
            if (variant === 1 && blk.eventIndex === 4) {
              const div = Math.fround(Div(i, 2) + 4);
              if (div !== 0) blk.yaw[i] = Ftol(d / div + blk.yaw[i]);
            } else {
              blk.yaw[i] = blk.yaw[i] + Div(d, 10);
            }
            t.boneRot[o + 1] = blk.yaw[i];
            if (variant !== 0) break;
            if (blk.eventIndex === 4) {
              blk.yaw[i] = 0;
              t.boneRot[o + 1] = 0;
            }
          }
          if (variant !== 0) break;
          if (i > 0 && i <= weak && blk.eventIndex === 3
              && blk.pathCursor >= PITCH_TO) {
            const d = Wrap16((t.boneRot[o + 2] & 0xffff)
                             - (blk.pitch[i] & 0xffff));
            blk.pitch[i] = blk.pitch[i] + Div(d, 16);
            t.boneRot[o + 2] = blk.pitch[i];
          }
          break;
        }
        // States 10 and 11, `0x00422486`.
        if (i <= 0 || i > weak) break;
        if (variant === 0 && obj.motion === CLIP_SURFACE && i > 0xf
            && t.counter !== 2 && t.counter !== 6) break;
        const n = variant === 0 && blk.eventIndex === 2
          ? CHAIN_STRIDE_LONG : CHAIN_STRIDE;
        for (let k = 0; k < CHAIN_WALK_LIMIT; k++) {
          if (k >= n) break;
          c1 = wrap(c1 + 1);
        }
        const px = Pt(pts, c1, 0);
        const pz = Pt(pts, c1, 2);
        const yawRaw = Ftol(Math.atan2(px - blk.anchorX[i],
                                       pz - blk.anchorZ[i]) * RAD_TO_BAMS);
        if (i + 1 < blk.anchorX.length) {
          blk.anchorX[i + 1] = px;
          blk.anchorZ[i + 1] = pz;
        }
        const yawNew = ((yawRaw & 0xffff) + 0x4000) & 0xffff;
        for (let k = 0; k < 3; k++) c2 = wrap(c2 + 1);
        const qx = Pt(pts, c2, 0), qy = Pt(pts, c2, 1), qz = Pt(pts, c2, 2);
        const dx = qx - blk.anchor2X[i];
        const dz = qz - blk.anchor2Z[i];
        const pitchRaw = FtolS16(Math.atan2(-(qy - blk.anchor2Y[i]),
                                            Math.sqrt(dx * dx + dz * dz))
                                 * RAD_TO_BAMS);
        zFactor = pitchRaw;
        if (i + 1 < blk.anchor2X.length) {
          blk.anchor2X[i + 1] = qx;
          blk.anchor2Y[i + 1] = qy;
          blk.anchor2Z[i + 1] = qz;
        }
        t.boneRot[o + 1] = (yawNew - yawSum) | 0;
        if (variant === 0 && PITCH_FROM < blk.pathCursor
            && blk.pathCursor < PITCH_TO) {
          t.boneRot[o + 2] = (pitchRaw - pitchSum) | 0;
        }
        if (blk.pathCursor === PITCH_TO) blk.splashLatch = 0;
        pitchSum = (pitchSum + t.boneRot[o + 2]) | 0;
        blk.yaw[i] = t.boneRot[o + 1];
        yawSum = (yawSum + t.boneRot[o + 1]) | 0;
        blk.pitch[i] = t.boneRot[o + 2];
        if (i === weak) blk.pathCursorWeak = (c1 << 16) >> 16;
        break;
      }
      case Boss3BodyState.Recover: {
        if (i <= 0 || i > weak) break;
        if (variant === 0) {
          if (obj.motion === CLIP_SURFACE && i > 0xf
              && t.counter !== 2 && t.counter !== 6) break;
        } else if (variant === 1) {
          if (i > 0xf && obj.motion === CLIP_SURFACE) break;
        }
        const n = blk.eventIndex === 2 ? CHAIN_STRIDE_LONG : CHAIN_STRIDE;
        for (let k = 0; k < CHAIN_WALK_LIMIT; k++) {
          if (k >= n) break;
          c1 = wrap(c1 + 1);
        }
        const px = Pt(pts, c1, 0);
        const pz = Pt(pts, c1, 2);
        const yawNew = (Ftol(Math.atan2(px - blk.anchorX[i],
                                        pz - blk.anchorZ[i]) * RAD_TO_BAMS)
                        + 0x4000) & 0xffff;
        const d = Wrap16(((yawNew - yawSum) & 0xffff)
                         - (blk.yaw[i] & 0xffff));
        t.boneRot[o + 1] = blk.yaw[i] + Div(d, 32);
        blk.yaw[i] = t.boneRot[o + 1];
        yawSum = (yawSum + t.boneRot[o + 1]) | 0;
        if (i + 1 < blk.anchorX.length) {
          blk.anchorX[i + 1] = px;
          blk.anchorZ[i + 1] = pz;
        }
        if (i === weak) blk.pathCursorWeak = (c1 << 16) >> 16;
        break;
      }
      case Boss3BodyState.Dead: {
        if (i <= 0 || i > weak) break;
        const k = Ftol(i * RIPPLE_TURN / weak);
        t.boneRot[o + 1] = Ftol(Math.sin(k * BAMS_TO_RAD_F64) * RIPPLE_AMPLITUDE
                                + t.boneRot[o + 1]);
        break;
      }
      default:
        break;
    }
  }
  // `0x004229CA`..: bone 0 of a head takes the root translation -- the last
  // draw's on an even cursor, and halfway from the last even one on an odd
  // cursor (`obj+0x12F4`) -- and the body takes none.
  if (!body) {
    if ((t.cursor & 1) === 0) {
      t.prevRoot.x = t.rootNow.x;
      t.prevRoot.y = t.rootNow.y;
      t.prevRoot.z = t.rootNow.z;
      t.pivot.x = t.rootNow.x; t.pivot.y = t.rootNow.y; t.pivot.z = t.rootNow.z;
    } else {
      t.pivot.x = (t.rootNow.x - t.prevRoot.x) * ROOT_HALF + t.prevRoot.x;
      t.pivot.y = (t.rootNow.y - t.prevRoot.y) * ROOT_HALF + t.prevRoot.y;
      t.pivot.z = (t.rootNow.z - t.prevRoot.z) * ROOT_HALF + t.prevRoot.z;
    }
  } else {
    t.pivot.x = 0; t.pivot.y = 0; t.pivot.z = 0;
  }
  t.composed = true;
  Boss3PoseMatrices(obj, true);
}

/** The bite flash's clock stops at `0x25` on a head. */
const FLASH_FRAMES = 0x25;
/**
 * The wake's windows (`0x00421CA3`..`0x00421D01`): not in clip `0x3D` before
 * cursor `0x37`, not past bone 15 in clips `0x3B`/`0x3C`, and only while the
 * path cursor is in `(0x5E, 0x519]` or at `0x57A` and beyond.
 */
const CLIP_WAKE_LATE = 0x3d;
const WAKE_LATE_FROM = 0x37;
const CLIP_WAKE_TURN_A = 0x3b;
const CLIP_WAKE_TURN_B = 0x3c;
const WAKE_TURN_LAST_BONE = 0xf;
const WAKE_FIRST_AFTER = 0x5e;
const WAKE_FIRST_END = 0x519;
const WAKE_SECOND_FROM = 0x57a;
/** The dive splash's line, `[0x004C4C78]` -- -15.0. */
const SPLASH_LINE = -15;
/** `PlaySoundId(0x4116A9)` -- `COMMON\SIBUKI2`. */
export const SOUND_SIBUKI2 = 0x4116a9;
/** The splash cue: surfacing 3, from path point `0x43F`. */
const SPLASH_EVENT = 3;
const SPLASH_FROM = 0x43f;

/**
 * `Boss3DrawBoneParts` — `FUN_004219E0`. Draws bones 1.. of the skeleton
 * (`render/`'s) and, per bone, the three things in it that are not drawing:
 *
 * * **the bite flash's clock**, `+0x7640`: a head in state 5 steps it once a
 *   frame at its second jaw while it is below `0x25`, and the body in state
 *   11 at its weak bone without a bound. `Boss3FightHeadUpdate`'s state 5
 *   reads it for its two sound cues, so this is a gameplay clock in a draw
 *   routine (L7) -- kept here, where the engine keeps it, not moved;
 * * **the dive splash**: at surfacing 3 from path point `0x43F`, variant 0,
 *   the second jaw's world point going under -15 plays `SIBUKI2`, throws a
 *   splash there and raises `+0x5A0`; coming back above drops it.
 *
 * The flash itself and the body's wake cels are drawn by
 * `render/characters/boss3.ts` from the same state.
 */
export function Boss3DrawBoneParts(obj: Boss3Actor, events?: Events): void {
  const t = obj.boss3;
  const blk = t.block;
  if (!blk) return;
  t.drawn = true;
  const wake = G.g_boss3_variant === 0 && t.index === 8
    && obj.state >= Boss3BodyState.Swim && obj.state <= Boss3BodyState.Recover
    && !(obj.motion === CLIP_WAKE_LATE && t.cursor < WAKE_LATE_FROM)
    && ((blk.pathCursor > WAKE_FIRST_AFTER && blk.pathCursor <= WAKE_FIRST_END)
        || blk.pathCursor >= WAKE_SECOND_FROM);
  for (let i = 1; i < blk.boneCount; i++) {
    // `0x00421A59`/`0x00421AFA`: a head's bite flash at its second jaw, the
    // clock stepped first and its cels chosen by the new value.
    if (t.index !== 8 && obj.state === Boss3HeadState.Attack && i === blk.jawB
        && blk.flashClock < FLASH_FRAMES) {
      blk.flashClock += 1;
      t.flash = blk.flashClock;
    }
    // `0x00421BBE`: the body's, at its weak bone in state 11, uncapped.
    if (t.index === 8 && obj.state === Boss3BodyState.Surfaced
        && i === blk.weakBone) {
      blk.flashClock = ((blk.flashClock + 1) << 16) >> 16;
      t.flash = blk.flashClock;
    }
    // `0x00421C73`: two wake cels on every chain bone below the weak one
    // but, in the two turning clips, the tail's past bone 15.
    if (wake && i < blk.weakBone
        && !((obj.motion === CLIP_WAKE_TURN_A || obj.motion === CLIP_WAKE_TURN_B)
             && i > WAKE_TURN_LAST_BONE)) {
      t.wakeBones |= 1 << i;
      t.wakeCel = G.g_frame_counter >>> 0;
    }
    if (blk.eventIndex === SPLASH_EVENT && blk.pathCursor >= SPLASH_FROM
        && i === blk.jawB) {
      const o = i * 3;
      const wx = t.boneOrigin[o], wy = t.boneOrigin[o + 1];
      const wz = t.boneOrigin[o + 2];
      if (G.g_boss3_variant === 0 && obj.state !== Boss3BodyState.Dead
          && blk.splashLatch === 0 && wy < SPLASH_LINE) {
        events?.emit("sound.play", { id: SOUND_SIBUKI2 });
        Boss3SpawnSplashAt(wx, SPLASH_LINE, wz, 0);
        PoseHookNone(6, 0x28);
        blk.splashLatch = 1;
      }
      if (blk.splashLatch === 1 && wy > SPLASH_LINE) blk.splashLatch = 0;
    }
  }
}

/**
 * `PoseHookNone` — `FUN_00420810`. A bare `RET`. The class calls it with
 * `(4, 0x14)`, `(6, 0x1E)` and `(6, 0x28)` wherever something lands or
 * splashes; what it was on the original hardware is `[open]`, and on PC it
 * does nothing.
 */
export function PoseHookNone(a: number, b: number): void {
  void a; void b;
}

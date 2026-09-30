/**
 * `CarrierPropSelectRoutine`'s selectors 4 and 7 -- stage 4's `st4_09.bin[0]`
 * (slot `0x954`), which rides `op_` path `0x176` into place round the
 * stage-4 boss's first entrance, and the effect it plays afterwards.
 *
 * Two shipped spawns, each a class-0x13 prop with behaviour 8 at `(0, 0, 0)`
 * drawing slot `0x954`: stage 4 block 23's evt `0x8CF0` (selector 4, the
 * first time the boss arrives) and block 27's `0xA7E4` (selector 7, the
 * third, when it is already there). The model is authored in world space
 * (x -143..685, z -2214..-1577), so the pose the path ends on -- the path's
 * last key less the three literals below -- is where the model stands as
 * authored.
 *
 * ```c
 * // FUN_00440C20, from its disassembly; sub = obj->+0x1310, ride = sub->+0x04
 * switch (sub->state) {                            // jump table 0x00440FD8, 0..6
 * case 0: ride = ActorAllocSub(0x58); sub->+0x04 = ride;
 *         ride[0] = 0x15; ride[1] = 0x1CD; ride[0x54] = 0x1AF0;
 *         if (selector == 7) {
 *             PropSeatOnObjectPath(obj, 0x176, g_cam_path_length[0x176]);
 *             x -= 301.893f; y -= 121.721f; z += 1586.767f;
 *             sub->state = 2; break;
 *         }
 *         PlaySoundId(0x1A1BA9); sub->state++;             // falls into 1
 * case 1: if (g_screen_shake_frames < 0x1E) g_screen_shake_frames = 0x28;
 *         PropSeatOnObjectPath(obj, 0x176, g_cam_path_frame);
 *         if (g_cam_path_frame == g_cam_path_length[0x176] - 0x1E)
 *             { PlaySoundId(0x1B1BA9); PlaySoundId(0x1C1BA9); }
 *         if (g_cam_path_frame >= g_cam_path_length[0x176]) sub->state++;
 *         x -= 301.893f; y -= 121.721f; z += 1586.767f;
 *         Push(0);
 *         s = f < 100 ? f * 0.1f : f < 150 ? 10.0f
 *           : (len - f) / (len - 150) * 7.0f + 3.0f;      // stored single
 *         Translate(-25, 43, -1625); RotY(g_camera_block_yaw_bams[g_camera_index]);
 *         Translate(0, s + s, 0); Scale(30, s, 1); NoOpStub(30.0f);
 *         AssetDrawSlot(ride[0x54]); if (++ride[0x54] > 0x1AF9) ride[0x54] = 0x1AF0;
 *         Pop(1); break;
 * case 2: if (g_active_cam_path == 0xB9 && g_cam_path_frame >= 0xE7)
 *             { ride[2] = ride[3] = 0; sub->state++; }
 *         break;
 * case 3: if (g_cam_path_frame == 0x1CC)
 *             { g_screen_shake_frames = 0x28; PlaySoundId(0x1E1BA9); sub->state++; }
 *                                                           // falls into 4
 * case 4: if (g_cam_path_frame < 0x258) {
 *             if (g_motion_slots[ride[1]].state == 2)
 *                 { Push(0); Translate(303.346, 42.4852, -1685.53); EffectDrawUnlit(ride); Pop(1); }
 *             if (ride[2] < g_motion_play_length[ride[1]] - 2 && g_cam_path_frame >= 0x1D6) ride[2]++;
 *         } else if (g_cam_path_frame >= 0x320) {
 *             ride[1] = 0x1CC; ride[2] = ride[3] = 0; sub->state++;
 *         }
 *         break;
 * case 5: if (g_cam_path_frame == 0x3C0)
 *             { g_screen_shake_frames = 0x28; PlaySoundId(0x1E1BA9); sub->state++; }
 *                                                           // falls into 6
 * case 6: if (g_motion_slots[ride[1]].state == 2)
 *             { Push(0); Translate(326.789, 42.4852, -1982.95); EffectDrawUnlit(ride); Pop(1); }
 *         if (ride[2] < g_motion_play_length[ride[1]] - 2 && g_cam_path_frame >= 0x3CA) ride[2]++;
 * }
 * if (g_cam_path_frame != 0x30A && g_cam_path_frame == 0x38E) obj->+0x1F4 = 0x954;
 * ```
 *
 * The prop itself is `ScriptedPropUpdate13`'s draw, after this returns: slot
 * `obj+0x1F4` under `T(pos) RotX RotZ RotY`.
 *
 * **The motion is resident.** `[likely]`: both clips are
 * `komono_colo.bin`'s, bank 28, and every block that spawns one of these
 * queues job 8 on bank 28 before the spawn (block 23 op 20, block 27 op 40)
 * and job 9 on it after the prop's own despawn cue has passed (op 144, op
 * 90); the port has no motion residency, and treats the clip as loaded.
 */
import type { Actor } from "../actor";
import { CameraBlockYaw } from "../camera/view";
import { EffectDrawUnlit } from "../effect_draw";
import { G } from "../globals";
import {
  MatIdentity, MatrixRotateY, MatrixScale, MatrixTranslate,
} from "../matrix";
import type { ClassFrame } from "../registry";
import { SpawnClass } from "../spawn_class";
import { PropSeatOnObjectPath } from "./index";
import {
  CARRIER4_EFFECT, CARRIER4_SPRITE_FIRST, CARRIER4_SPRITE_LAST,
  CARRIER_FX_MOTION_A, CARRIER_FX_MOTION_B, CarrierRoutine4State,
  type ScriptedPropTail,
} from "./state";

/** `PUSH 0x176` -- the `op_` object path the model rides. */
export const CARRIER4_PATH = 0x176;
/** `[0x00577310]` -- `g_cam_path_length[0x176]`, read from the image: 240. */
export const CARRIER4_PATH_LENGTH = 240;
/**
 * `FSUB float [0x00564508]`, `FSUB float [0x00564504]` and `FADD float
 * [0x00564500]` -- taken off the path's pose every frame it is seated.
 */
export const CARRIER4_OFFSET_X = Math.fround(301.89300537109375);
export const CARRIER4_OFFSET_Y = Math.fround(121.72100067138672);
export const CARRIER4_OFFSET_Z = Math.fround(1586.7669677734375);
/** The parked selector: seated at the path's end, and straight to `Wait`. */
const SELECTOR_PARKED = 7;
/** `CMP [0x009c8e8c], 0x1E` / `MOV [0x009c8e8c], 0x28`. */
export const CARRIER4_SHAKE_BELOW = 0x1e;
export const CARRIER4_SHAKE_FRAMES = 0x28;
/** `PUSH 0x1A1BA9`, `0x1B1BA9`, `0x1C1BA9`, `0x1E1BA9`. */
export const SFX_CARRIER4_START = 0x1a1ba9;
export const SFX_CARRIER4_LAND_A = 0x1b1ba9;
export const SFX_CARRIER4_LAND_B = 0x1c1ba9;
export const SFX_CARRIER4_CUE = 0x1e1ba9;
/** `ADD EAX, -0x1E` -- the landing sounds, thirty frames before the end. */
const LAND_SOUND_LEAD = 0x1e;
/**
 * The strip's scale over the camera's frame: `FMUL float [0x0055D230]`
 * (0.1f) below frame 100, `0x41200000` (10.0) below 150, then
 * `FMUL float [0x005644FC]` (7.0) and `FADD float [0x004C49C0]` (3.0).
 */
const SPRITE_GROW_UNTIL = 100;
const SPRITE_HOLD_UNTIL = 0x96;
const SPRITE_GROW_RATE = Math.fround(0.1);
const SPRITE_HOLD_SCALE = 10.0;
const SPRITE_SHRINK_SPAN = 7.0;
const SPRITE_SHRINK_FLOOR = 3.0;
/** `PUSH 0xC4CB2000; PUSH 0x422C0000; PUSH 0xC1C80000` -- where it stands. */
export const CARRIER4_SPRITE_AT: readonly [number, number, number] = [-25.0, 43.0, -1625.0];
/** `PUSH 0x41F00000` -- the strip's width, and `NoOpStub`'s argument. */
const SPRITE_WIDTH = 30.0;
/** `CMP [0x009a2d78], 0xB9` and `CMP [0x009a6110], 0xE7`. */
export const CARRIER4_WAIT_PATH = 0xb9;
export const CARRIER4_WAIT_FRAME = 0xe7;
/** `CMP [0x009a6110], 0x1CC`, `0x258`, `0x1D6`, `0x320`. */
const CUE_A_FRAME = 0x1cc;
const PLAY_A_UNTIL = 0x258;
const PLAY_A_STEP_FROM = 0x1d6;
const CUE_B_AFTER = 0x320;
/** `CMP [0x009a6110], 0x3C0` and `0x3CA`. */
const CUE_B_FRAME = 0x3c0;
const PLAY_B_STEP_FROM = 0x3ca;
/** The two places the effect is drawn -- `PUSH` immediates, world space. */
export const CARRIER4_FX_A_AT: readonly [number, number, number] = [
  Math.fround(303.3464050292969), Math.fround(42.485198974609375),
  Math.fround(-1685.530029296875)];
export const CARRIER4_FX_B_AT: readonly [number, number, number] = [
  Math.fround(326.7886962890625), Math.fround(42.485198974609375),
  Math.fround(-1982.946044921875)];
/**
 * `g_motion_play_length[0x1CC]` and `[0x1CD]`, read from the image: 100
 * each. The cursor stops two short.
 */
export const CARRIER_FX_PLAY_LENGTH = 100;
/** `CMP EAX, 0x30A` / `CMP EAX, 0x38E` and the `MOV word [EBX+0x1F4], 0x954`. */
const SLOT_SKIP_FRAME = 0x30a;
const SLOT_SET_FRAME = 0x38e;
export const CARRIER4_SLOT = 0x954;

/**
 * `CarrierPropRoutine4` — `FUN_00440C20`. One frame of selectors 4 and 7.
 */
export function CarrierPropRoutine4(obj: Actor, f: ClassFrame): void {
  const sub = obj.cls === SpawnClass.ScriptedProp
    ? (obj as { prop13: ScriptedPropTail }).prop13 : null;
  if (!sub) return;
  sub.draws = [];
  const ride = sub.fx;
  const frame = G.g_cam_path_frame;

  switch (sub.state as CarrierRoutine4State) {
    case CarrierRoutine4State.Begin:
      sub.riding = true;
      ride.effect = CARRIER4_EFFECT;
      ride.motion = CARRIER_FX_MOTION_A;
      sub.spriteCel = CARRIER4_SPRITE_FIRST;
      if (sub.selector === SELECTOR_PARKED) {
        PropSeatOnObjectPath(obj, CARRIER4_PATH, CARRIER4_PATH_LENGTH, f);
        CarrierPropRoutine4Offset(obj);
        sub.state = CarrierRoutine4State.Wait;
        break;
      }
      f.events?.emit("sound.play", { id: SFX_CARRIER4_START });
      sub.state = CarrierRoutine4State.Ride;
      CarrierPropRoutine4Ride(obj, sub, f);
      break;
    case CarrierRoutine4State.Ride:
      CarrierPropRoutine4Ride(obj, sub, f);
      break;
    case CarrierRoutine4State.Wait:
      if (G.g_active_cam_path === CARRIER4_WAIT_PATH
          && frame >= CARRIER4_WAIT_FRAME) {
        ride.frame = 0;
        ride.prev = 0;
        sub.state = CarrierRoutine4State.CueA;
      }
      break;
    case CarrierRoutine4State.CueA:
      if (frame === CUE_A_FRAME) {
        G.g_screen_shake_frames = CARRIER4_SHAKE_FRAMES;
        f.events?.emit("sound.play", { id: SFX_CARRIER4_CUE });
        sub.state = CarrierRoutine4State.PlayA;
      }
      CarrierPropRoutine4PlayA(obj, sub, f);
      break;
    case CarrierRoutine4State.PlayA:
      CarrierPropRoutine4PlayA(obj, sub, f);
      break;
    case CarrierRoutine4State.CueB:
      if (frame === CUE_B_FRAME) {
        G.g_screen_shake_frames = CARRIER4_SHAKE_FRAMES;
        f.events?.emit("sound.play", { id: SFX_CARRIER4_CUE });
        sub.state = CarrierRoutine4State.PlayB;
      }
      CarrierPropRoutine4PlayB(sub, f);
      break;
    case CarrierRoutine4State.PlayB:
      CarrierPropRoutine4PlayB(sub, f);
      break;
    default:
      break;
  }
  // `0x00440FB8`, which every state reaches.
  if (frame !== SLOT_SKIP_FRAME && frame === SLOT_SET_FRAME) {
    sub.slot = CARRIER4_SLOT;
  }
}

/**
 * The three literals taken off the seated pose, `0x00440C81` and again at
 * `0x00440D28`. `[port-only]` as a function: the routine writes them out
 * twice, identically.
 */
function CarrierPropRoutine4Offset(obj: Actor): void {
  obj.pos.x = Math.fround(obj.pos.x - CARRIER4_OFFSET_X);
  obj.pos.y = Math.fround(obj.pos.y - CARRIER4_OFFSET_Y);
  obj.pos.z = Math.fround(obj.pos.z + CARRIER4_OFFSET_Z);
}

/**
 * Case 1's body, `0x00440CC4`, which case 0 falls into. `[port-only]` as a
 * function, as `CarrierPropRoutine2Ride` is.
 */
function CarrierPropRoutine4Ride(obj: Actor, sub: ScriptedPropTail,
                                 f: ClassFrame): void {
  if (G.g_screen_shake_frames < CARRIER4_SHAKE_BELOW) {
    G.g_screen_shake_frames = CARRIER4_SHAKE_FRAMES;
  }
  const frame = G.g_cam_path_frame;
  PropSeatOnObjectPath(obj, CARRIER4_PATH, frame, f);
  if (frame === CARRIER4_PATH_LENGTH - LAND_SOUND_LEAD) {
    f.events?.emit("sound.play", { id: SFX_CARRIER4_LAND_A });
    f.events?.emit("sound.play", { id: SFX_CARRIER4_LAND_B });
  }
  if (frame >= CARRIER4_PATH_LENGTH) sub.state = CarrierRoutine4State.Wait;
  CarrierPropRoutine4Offset(obj);
  sub.draws.push({
    slot: sub.spriteCel,
    m: CarrierSpriteMatrix(CARRIER4_SPRITE_AT, frame, CARRIER4_PATH_LENGTH),
  });
  sub.spriteCel += 1;
  if (sub.spriteCel > CARRIER4_SPRITE_LAST) sub.spriteCel = CARRIER4_SPRITE_FIRST;
}

/**
 * The camera-facing strip's matrix, `0x00440D4E..0x00440E14` here and
 * `0x00441116..0x004411DA` in `CarrierPropRoutine5` (`FUN_00441000`), which
 * differ only in the first translation and the path whose length they read.
 * `[port-only]` as a function: both routines write it out in full.
 *
 * ```c
 * s = f < 100 ? (float)f * 0.1f : f < 150 ? 10.0f
 *   : (float)(len - f) / (float)(len - 150) * 7.0f + 3.0f;   // FSTP single
 * Push(0); Translate(at); RotY(g_camera_block_yaw_bams[g_camera_index]);
 * Translate(0, s + s, 0); Scale(30, s, 1);
 * ```
 */
export function CarrierSpriteMatrix(at: readonly [number, number, number],
                                    frame: number, len: number): number[] {
  let s: number;
  if (frame < SPRITE_GROW_UNTIL) {
    s = Math.fround(frame * SPRITE_GROW_RATE);
  } else if (frame < SPRITE_HOLD_UNTIL) {
    s = SPRITE_HOLD_SCALE;
  } else {
    s = Math.fround((len - frame) / (len - SPRITE_HOLD_UNTIL)
                    * SPRITE_SHRINK_SPAN + SPRITE_SHRINK_FLOOR);
  }
  const m = MatIdentity();
  MatrixTranslate(m, at[0], at[1], at[2]);
  MatrixRotateY(m, CameraBlockYaw(G.g_camera_index));
  MatrixTranslate(m, 0, Math.fround(s + s), 0);
  MatrixScale(m, SPRITE_WIDTH, s, 1.0);
  return m;
}

/**
 * Case 4's body, `0x00440E97`, which case 3 falls into. `[port-only]` as a
 * function.
 */
function CarrierPropRoutine4PlayA(_obj: Actor, sub: ScriptedPropTail,
                                  f: ClassFrame): void {
  const ride = sub.fx;
  const frame = G.g_cam_path_frame;
  if (frame < PLAY_A_UNTIL) {
    // `Push(0); Translate(303.346, 42.4852, -1685.53)`.
    CarrierPropDrawEffect(sub, CarrierEffectMatrix(CARRIER4_FX_A_AT), f);
    if (ride.frame < CARRIER_FX_PLAY_LENGTH - 2
        && G.g_cam_path_frame >= PLAY_A_STEP_FROM) {
      ride.frame += 1;
    }
    return;
  }
  if (frame < CUE_B_AFTER) return;
  ride.motion = CARRIER_FX_MOTION_B;
  ride.frame = 0;
  ride.prev = 0;
  sub.state = CarrierRoutine4State.CueB;
}

/** `Push(0); Translate(at)` -- a world-space point. `[port-only]`. */
function CarrierEffectMatrix(at: readonly [number, number, number]): number[] {
  const m = MatIdentity();
  MatrixTranslate(m, at[0], at[1], at[2]);
  return m;
}

/** Case 6's body, `0x00440F5A`, which case 5 falls into. `[port-only]`. */
function CarrierPropRoutine4PlayB(sub: ScriptedPropTail, f: ClassFrame): void {
  const ride = sub.fx;
  // `Push(0); Translate(326.789, 42.4852, -1982.95)`.
  CarrierPropDrawEffect(sub, CarrierEffectMatrix(CARRIER4_FX_B_AT), f);
  if (ride.frame < CARRIER_FX_PLAY_LENGTH - 2
      && G.g_cam_path_frame >= PLAY_B_STEP_FROM) {
    ride.frame += 1;
  }
}

/**
 * `EffectDrawUnlit(ride)` under the matrix the routine pushed, both
 * routines' draw of the effect. `[port-only]` as a function: the call and
 * the push around it.
 */
export function CarrierPropDrawEffect(sub: ScriptedPropTail, m: number[],
                                      f: ClassFrame): void {
  EffectDrawUnlit(sub.fx, m, sub.draws, f.rng);
}

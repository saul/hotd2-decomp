/**
 * `CarrierPropSelectRoutine`'s selectors 5 and 8 -- stage 4's `st4_09.bin[2]`
 * (slot `0x956`), selectors 4 and 7's other half: the same seven states on
 * `op_` path `0x177`, with its own literals, effect `0x18` playing the two
 * motions the other way round, and a half turn on the effect.
 *
 * Two shipped spawns, each a class-0x13 prop with behaviour 8 at `(0, 0, 0)`
 * drawing slot `0x956`: block 25's evt `0x9D40` (selector 5, the boss's
 * second entrance) and block 29's `0xAC7C` (selector 8, the fourth). The
 * model is authored in world space (x -657..-152, z -2261..-1567).
 *
 * ```c
 * // FUN_00441000, from its disassembly; the differences from FUN_00440C20
 * case 0: ride[0] = 0x18; ride[1] = 0x1CC; ride[0x54] = 0x1AF0;
 *         if (selector == 8) {
 *             PropSeatOnObjectPath(obj, 0x177, g_cam_path_length[0x177]);
 *             x += 443.97f; z += 1489.209f;                // no y
 *             sub->state = 2; return;
 *         }
 *         PlaySoundId(0x1A1BA9); sub->state++;             // falls into 1
 * case 1: ...as selector 4 on 0x177, the same two offsets...,
 *         Translate(-355, 43, -1625) for the strip
 * case 2: if (g_active_cam_path == 0xC1 && g_cam_path_frame >= 0x1C3) ...
 * case 3: if (g_cam_path_frame == 0x208) ...                // falls into 4
 * case 4: if (g_cam_path_frame < 0x28A) {
 *             ...Translate(-232.312, 42.4892, -1829.43); RotY(0x8000); EffectDrawUnlit...
 *             ...step from 0x212...
 *         } else if (g_cam_path_frame >= 0x320) { ride[1] = 0x1CD; ... }
 * case 5: if (g_cam_path_frame == 0x3CA) ...                // falls into 6
 * case 6: ...Translate(-373.742, 42.4892, -2100); RotY(0x8000); EffectDrawUnlit...
 *         ...step from 0x3D4...
 * // and no tail: nothing writes obj+0x1F4
 * ```
 *
 * The motion is resident on the same reading as selector 4's
 * (`CarrierPropRoutine4`): block 25 queues job 8 on bank 28 at op 20 and
 * job 9 at op 144, block 29 at ops 40 and 90. `[likely]`
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import { MatIdentity, MatrixRotateY, MatrixTranslate } from "../matrix";
import type { ClassFrame } from "../registry";
import { SpawnClass } from "../spawn_class";
import { PropSeatOnObjectPath } from "./index";
import {
  CARRIER4_SHAKE_BELOW, CARRIER4_SHAKE_FRAMES, CARRIER_FX_PLAY_LENGTH,
  CarrierPropDrawEffect, CarrierSpriteMatrix, SFX_CARRIER4_CUE,
  SFX_CARRIER4_LAND_A, SFX_CARRIER4_LAND_B, SFX_CARRIER4_START,
} from "./routine4";
import {
  CARRIER4_SPRITE_FIRST, CARRIER4_SPRITE_LAST, CARRIER5_EFFECT,
  CARRIER_FX_MOTION_A, CARRIER_FX_MOTION_B, CarrierRoutine4State,
  type ScriptedPropTail,
} from "./state";

/** `PUSH 0x177` -- the `op_` object path the model rides. */
export const CARRIER5_PATH = 0x177;
/** `[0x00577314]` -- `g_cam_path_length[0x177]`, read from the image: 240. */
export const CARRIER5_PATH_LENGTH = 240;
/**
 * `FADD float [0x00564510]` and `FADD float [0x0056450C]` -- added to the
 * path's x and z every frame it is seated. Nothing touches y.
 */
export const CARRIER5_OFFSET_X = Math.fround(443.9700012207031);
export const CARRIER5_OFFSET_Z = Math.fround(1489.208984375);
/** The parked selector. */
const SELECTOR_PARKED = 8;
/** `ADD EAX, -0x1E` -- the landing sounds. */
const LAND_SOUND_LEAD = 0x1e;
/** `PUSH 0xC4CB2000; PUSH 0x422C0000; PUSH 0xC3B18000`. */
export const CARRIER5_SPRITE_AT: readonly [number, number, number] = [-355.0, 43.0, -1625.0];
/** `CMP [0x009a2d78], 0xC1` and `CMP [0x009a6110], 0x1C3`. */
export const CARRIER5_WAIT_PATH = 0xc1;
export const CARRIER5_WAIT_FRAME = 0x1c3;
/** `0x208`, `0x28A`, `0x212`, `0x320`, `0x3CA`, `0x3D4`. */
const CUE_A_FRAME = 0x208;
const PLAY_A_UNTIL = 0x28a;
const PLAY_A_STEP_FROM = 0x212;
const CUE_B_AFTER = 0x320;
const CUE_B_FRAME = 0x3ca;
const PLAY_B_STEP_FROM = 0x3d4;
/** `PUSH 0x8000` -- the half turn both effect draws make. */
export const CARRIER5_FX_YAW = 0x8000;
/** The two places the effect is drawn -- `PUSH` immediates, world space. */
export const CARRIER5_FX_A_AT: readonly [number, number, number] = [
  Math.fround(-232.31199645996094), Math.fround(42.489200592041016),
  Math.fround(-1829.4300537109375)];
export const CARRIER5_FX_B_AT: readonly [number, number, number] = [
  Math.fround(-373.74200439453125), Math.fround(42.489200592041016), -2100.0];

/**
 * `CarrierPropRoutine5` — `FUN_00441000`. One frame of selectors 5 and 8.
 */
export function CarrierPropRoutine5(obj: Actor, f: ClassFrame): void {
  const sub = obj.cls === SpawnClass.ScriptedProp
    ? (obj as { prop13: ScriptedPropTail }).prop13 : null;
  if (!sub) return;
  sub.draws = [];
  const ride = sub.fx;
  const frame = G.g_cam_path_frame;

  switch (sub.state as CarrierRoutine4State) {
    case CarrierRoutine4State.Begin:
      sub.riding = true;
      ride.effect = CARRIER5_EFFECT;
      ride.motion = CARRIER_FX_MOTION_B;
      sub.spriteCel = CARRIER4_SPRITE_FIRST;
      if (sub.selector === SELECTOR_PARKED) {
        PropSeatOnObjectPath(obj, CARRIER5_PATH, CARRIER5_PATH_LENGTH, f);
        CarrierPropRoutine5Offset(obj);
        sub.state = CarrierRoutine4State.Wait;
        return;
      }
      f.events?.emit("sound.play", { id: SFX_CARRIER4_START });
      sub.state = CarrierRoutine4State.Ride;
      CarrierPropRoutine5Ride(obj, sub, f);
      return;
    case CarrierRoutine4State.Ride:
      CarrierPropRoutine5Ride(obj, sub, f);
      return;
    case CarrierRoutine4State.Wait:
      if (G.g_active_cam_path === CARRIER5_WAIT_PATH
          && frame >= CARRIER5_WAIT_FRAME) {
        ride.frame = 0;
        ride.prev = 0;
        sub.state = CarrierRoutine4State.CueA;
      }
      return;
    case CarrierRoutine4State.CueA:
      if (frame === CUE_A_FRAME) {
        G.g_screen_shake_frames = CARRIER4_SHAKE_FRAMES;
        f.events?.emit("sound.play", { id: SFX_CARRIER4_CUE });
        sub.state = CarrierRoutine4State.PlayA;
      }
      CarrierPropRoutine5PlayA(sub, f);
      return;
    case CarrierRoutine4State.PlayA:
      CarrierPropRoutine5PlayA(sub, f);
      return;
    case CarrierRoutine4State.CueB:
      if (frame === CUE_B_FRAME) {
        G.g_screen_shake_frames = CARRIER4_SHAKE_FRAMES;
        f.events?.emit("sound.play", { id: SFX_CARRIER4_CUE });
        sub.state = CarrierRoutine4State.PlayB;
      }
      CarrierPropRoutine5PlayB(sub, f);
      return;
    case CarrierRoutine4State.PlayB:
      CarrierPropRoutine5PlayB(sub, f);
      return;
    default:
      return;
  }
}

/** `0x00441061` and `0x004410FB`. `[port-only]` as a function. */
function CarrierPropRoutine5Offset(obj: Actor): void {
  obj.pos.x = Math.fround(obj.pos.x + CARRIER5_OFFSET_X);
  obj.pos.z = Math.fround(obj.pos.z + CARRIER5_OFFSET_Z);
}

/** Case 1's body, `0x00441097`. `[port-only]` as a function. */
function CarrierPropRoutine5Ride(obj: Actor, sub: ScriptedPropTail,
                                 f: ClassFrame): void {
  if (G.g_screen_shake_frames < CARRIER4_SHAKE_BELOW) {
    G.g_screen_shake_frames = CARRIER4_SHAKE_FRAMES;
  }
  const frame = G.g_cam_path_frame;
  PropSeatOnObjectPath(obj, CARRIER5_PATH, frame, f);
  if (frame === CARRIER5_PATH_LENGTH - LAND_SOUND_LEAD) {
    f.events?.emit("sound.play", { id: SFX_CARRIER4_LAND_A });
    f.events?.emit("sound.play", { id: SFX_CARRIER4_LAND_B });
  }
  if (frame >= CARRIER5_PATH_LENGTH) sub.state = CarrierRoutine4State.Wait;
  CarrierPropRoutine5Offset(obj);
  sub.draws.push({
    slot: sub.spriteCel,
    m: CarrierSpriteMatrix(CARRIER5_SPRITE_AT, frame, CARRIER5_PATH_LENGTH),
  });
  sub.spriteCel += 1;
  if (sub.spriteCel > CARRIER4_SPRITE_LAST) sub.spriteCel = CARRIER4_SPRITE_FIRST;
}

/** `Push(0); Translate(at); RotY(0x8000)`. `[port-only]`. */
function CarrierEffectMatrix5(at: readonly [number, number, number]):
    number[] {
  const m = MatIdentity();
  MatrixTranslate(m, at[0], at[1], at[2]);
  MatrixRotateY(m, CARRIER5_FX_YAW);
  return m;
}

/** Case 4's body, `0x00441267`, which case 3 falls into. `[port-only]`. */
function CarrierPropRoutine5PlayA(sub: ScriptedPropTail, f: ClassFrame): void {
  const ride = sub.fx;
  const frame = G.g_cam_path_frame;
  if (frame < PLAY_A_UNTIL) {
    CarrierPropDrawEffect(sub, CarrierEffectMatrix5(CARRIER5_FX_A_AT), f);
    if (ride.frame < CARRIER_FX_PLAY_LENGTH - 2
        && G.g_cam_path_frame >= PLAY_A_STEP_FROM) {
      ride.frame += 1;
    }
    return;
  }
  if (frame < CUE_B_AFTER) return;
  ride.motion = CARRIER_FX_MOTION_A;
  ride.frame = 0;
  ride.prev = 0;
  sub.state = CarrierRoutine4State.CueB;
}

/** Case 6's body, `0x00441330`, which case 5 falls into. `[port-only]`. */
function CarrierPropRoutine5PlayB(sub: ScriptedPropTail, f: ClassFrame): void {
  const ride = sub.fx;
  CarrierPropDrawEffect(sub, CarrierEffectMatrix5(CARRIER5_FX_B_AT), f);
  if (ride.frame < CARRIER_FX_PLAY_LENGTH - 2
      && G.g_cam_path_frame >= PLAY_B_STEP_FROM) {
    ride.frame += 1;
  }
}

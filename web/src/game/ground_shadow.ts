/**
 * The ground shadow: asset slot `0x10D0`, a disc flattened onto the floor
 * under an object.
 *
 * Two routines, and the port draws through them only for class 0x31's thrown
 * weapon so far: class 0x30's weapon makes the same call at `0x0045A622` and
 * its port does not yet. `ActorDrawShadow` (`FUN_0040A590`, `model_draw.ts`)
 * is the skinned actors' way in, picking the size by character type; the
 * renderer does not draw a character's shadow yet, so that routine stops at
 * the size and does not call down here.
 *
 * The routine is the draw and nothing else: no state of the object's is
 * written, and the one thing it does besides the draw is the floor query,
 * whose trace leaves `g_coli_hit_*` behind like any other.
 */
import { ActorFlag } from "./actor";
import { QueryGroundHeightAt } from "./coli";
import { AppState, G } from "./globals";
import {
  MatCopy, MatIdentity, MatrixScale, MatrixTranslate, type Mat,
} from "./matrix";
import type { Vec3 } from "./vec";

/** `PUSH 0x10d0` at `0x0040A6C8`: the disc, `common.bin` 200. */
export const GROUND_SHADOW_SLOT = 0x10d0;
/**
 * `SetDrawLayerNibble(0xD)` at `0x0040A684`, and back to the world's 8 at
 * `0x0040A6DB` once the disc is drawn.
 */
export const GROUND_SHADOW_LAYER = 0x0d;
/** `obj+0x1F8` bit 0: drawn at all. The same bit the object's own draw tests. */
const DRAWN = 1;
/** `obj+0x1F8` bit 2: trace the floor rather than sit at the object's own y. */
const TRACE_GROUND = 4;
/** `FADD float ptr [0x004C49C0]` -- 3.0, how far above the object the probe starts. */
const GROUND_PROBE_LIFT = 3.0;
/** `FADD float ptr [0x004C4CC8]` -- 0.1, the disc's height off what it found. */
const GROUND_SHADOW_LIFT = 0.10000000149011612;
/**
 * `CMP dword ptr [0x009c8e98], 0xd` at `0x0040A640`: in this `g_app_state`
 * the disc sits on `g_camera_fixed_eye_y` whatever the object's bits say.
 * Which screen 0xD is has not been read, so it has no {@link AppState} member.
 */
const APP_STATE_FIXED_GROUND = 0x0d as AppState;

/** What the routine reads off its object: `obj+0x34` and `obj+0x40..0x48`. */
export interface GroundShadowCaster {
  flags: number;
  pos: Vec3;
}

/**
 * `ActorDrawGroundShadow` — `FUN_0040A620`. The disc under `obj`, `w` across
 * and `d` deep.
 *
 * ```
 * if ((obj+0x34 & 0x80000) || !(obj+0x1F8 & 1)) return;
 * h = g_app_state == 0xD ? g_camera_fixed_eye_y
 *   : obj+0x1F8 & 4     ? QueryGroundHeightAt(x, y + 3.0, z)
 *   :                     obj+0x44;
 * SetDrawLayerNibble(0xD); MatrixStackPush(0)
 * MatrixTranslate(x, h + 0.1, z); MatrixScale(w, 1.0, d); NoOpStub(w)
 * AssetDrawSlot(0x10D0); MatrixStackPop(1); SetDrawLayerNibble(8)
 * ```
 *
 * `[proved]` from the listing `0x0040A620`..`0x0040A6E4`. `w` is pushed after
 * `d`, so it is the **x** scale. The height is an `f32` both times it is
 * stored -- the query's result through `FSTP [ESP+0x14]`, and the lifted one
 * through the `FSTP [ESP]` that pushes `MatrixTranslate`'s argument.
 *
 * `drawWord` is the object's `obj+0x1F8`, which the port keeps under a
 * different name on each kind of object. `top` is the matrix the stack holds
 * when the routine is called -- the camera's world-to-view, for every caller
 * the port has. Returns the matrix `AssetDrawSlot` draws the disc under, or
 * `null` for no disc. `[port-only]`: the engine draws, the port hands the
 * renderer the matrix.
 */
export function ActorDrawGroundShadow(obj: GroundShadowCaster, drawWord: number,
                                      w: number, d: number,
                                      top: ArrayLike<number> | null): Mat | null {
  if (obj.flags & ActorFlag.NoShadow) return null;
  if (!(drawWord & DRAWN)) return null;
  let h: number;
  if (G.g_app_state === APP_STATE_FIXED_GROUND) {
    h = G.g_camera_fixed_eye_y;
  } else if (drawWord & TRACE_GROUND) {
    h = Math.fround(QueryGroundHeightAt(
      obj.pos.x, Math.fround(obj.pos.y + GROUND_PROBE_LIFT), obj.pos.z));
  } else {
    h = obj.pos.y;
  }
  const m = top ? MatCopy(MatIdentity(), top) : MatIdentity();
  MatrixTranslate(m, obj.pos.x, Math.fround(h + GROUND_SHADOW_LIFT), obj.pos.z);
  MatrixScale(m, w, 1.0, d);
  return m;
}

/**
 * `ActorDrawGroundShadowWithSize` — `FUN_0040A600`. The three arguments
 * passed straight on, and nothing else (`0x0040A600`..`0x0040A617`): the size
 * is the caller's, where `ActorDrawShadow` picks one by character type.
 * Both thrown-weapon routines call it, at 5 by 5. `[proved]`
 */
export function ActorDrawGroundShadowWithSize(obj: GroundShadowCaster,
                                              drawWord: number, w: number,
                                              d: number,
                                              top: ArrayLike<number> | null):
    Mat | null {
  return ActorDrawGroundShadow(obj, drawWord, w, d, top);
}

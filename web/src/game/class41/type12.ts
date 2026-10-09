/**
 * Class 0x41 type 12 — the family's commonest object: a model the descriptor
 * names, drawn at the spawn's pose, with a lifetime of its own and one camera
 * cue that takes it away.
 *
 * 36 shipped spawns over stages 2 to 6, each drawing the model its descriptor
 * names — among them the canal tile `0x13B5` stage 2's blocks 35 and 37 put
 * down, which is the same model `class41/water.ts`'s task ripples. The routine,
 * `0x00467E50`..`0x00467F4D` `[proved]`:
 *
 * ```
 * 00467e56  CALL PropExpireByStepLifetime(obj)       ; never returns if it retires
 * 00467e5b  CMP g_active_cam_path,0x2f ; JNZ draw
 * 00467e68  CMP g_cam_path_frame,0x96  ; JNZ draw
 * 00467e75  CALL ActorDespawn(obj) ; RET
 * 00467e81  PUSH 0 ; CALL MatrixStackPush
 * 00467e86  FLD [ESI+0x1c8] ; FADD [ESI+0x1a4] ; FSTP [ESP]   ; z + obj+0x1C8
 *           MatrixTranslate(+0x19C, +0x1A0, that)
 *           MatrixRotateZ(+0x1D4); MatrixRotateY(+0x1D0); MatrixRotateX(+0x1CC)
 * 00467ee1  MatrixScale(+0x1A8, +0x1AC, +0x1B0)
 * 00467efb  MaxOfThreeToNoOpStub(+0x1A8, +0x1AC, +0x1B0)  ; dead
 * 00467f00  if (g_GameMode != 2 && g_scene_lighting != 0)
 *               SubmitSlotWithSceneLightArray((s16)+0x28C)
 *           else AssetDrawSlot((s16)+0x28C)
 *           MatrixStackPop(1)
 * ```
 *
 * `PlaceGenericProp`'s arm, `0x00461F03`: `obj+0x11C = (u16)placer+0x1F4`,
 * `obj+0x28C = placer+0x11C`, then the shared tail at `0x00462083` writes
 * `1.0` to `+0x1A8`, `+0x1AC` and `+0x1B0` — the scale. Nothing in the game
 * writes those three again for this type, and nothing writes `+0x1C8`, so the
 * draw is the placed pose at unit scale; both are transcribed because the
 * routine reads them, not because they move.
 *
 * **The camera cue is the one thing the port was missing**: an exact-frame
 * equality on camera path `0x2F` at frame `0x96`, so the prop goes on the one
 * frame the camera is there and never if the route does not play path `0x2F`.
 * No `RegisterForShotTest`, no radius and no `AND` on `obj+0x34`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { MatrixScale } from "../matrix";
import { PropExpireByStepLifetime } from "./lifetime";
import { ActorDespawnProp } from "./prop";
import {
  PropDrawBegin, PropDrawSlot, PropMatrixPush, PropMatrixTRzRyRx,
  PropSubmitSlotWithSceneLightArray,
} from "./prop_draw";
import type { BreakableProp } from "./prop_state";
import { GameMode } from "../game_mode";

/** `g_active_cam_path` and `g_cam_path_frame` at which a type-12 prop goes. */
export const TYPE12_DESPAWN_CAM_PATH = 0x2f;
export const TYPE12_DESPAWN_CAM_FRAME = 0x96;

/** `MOV EAX,0x3F800000` at `0x00462083` — the arm's scale, all three axes. */
export const TYPE12_SCALE = 1.0;

/**
 * `PropDrawOnlyType12` — `FUN_00467E50`. `g_class41_updates[12]`.
 *
 * `obj+0x28C` under `T(x, y, z + obj+0x1C8) . Rz . Ry . Rx . S(obj+0x1A8..)`,
 * from the prologue's step lifetime until camera path `0x2F` frame `0x96`.
 * `+0x1C8` is {@link BreakableProp.vz}, `+0x1A8..+0x1B0`
 * {@link BreakableProp.restX}/`restY`/`restZ` — the offsets those fields
 * carry, read here as the routine reads them.
 */
export function PropDrawOnlyType12(p: BreakableProp, rng: Rng,
                                   events?: Events): void {
  void rng; void events;
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;
  if (G.g_active_cam_path === TYPE12_DESPAWN_CAM_PATH
      && G.g_cam_path_frame === TYPE12_DESPAWN_CAM_FRAME) {
    ActorDespawnProp(p);
    return;
  }
  const m = PropMatrixPush();
  // `FLD +0x1C8; FADD +0x1A4; FSTP` — a float32 sum on its way to the stack.
  PropMatrixTRzRyRx(m, p.x, p.y, Math.fround(p.vz + p.z), p.pitch, p.yaw,
                    p.roll);
  MatrixScale(m, p.restX, p.restY, p.restZ);
  // `g_GameMode != 2 && g_scene_lighting` (`0x00467F00`) submits through the
  // scene light array, else `AssetDrawSlot`.
  if (G.g_GameMode !== GameMode.Training && G.g_scene_lighting !== 0) {
    PropSubmitSlotWithSceneLightArray(p, m, p.slot);
  } else {
    PropDrawSlot(p, m, p.slot);
  }
}

/**
 * `PlaceGenericProp` case 0xC's arm.
 *
 * The lifetime and the slot it writes are the constructor's table rows —
 * `GENERIC_LIFETIME_FROM_1F4` and the prologue's `obj+0x28C` — and are not
 * written twice; what is left is the shared tail it jumps to.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00461F03`
 * of `PlaceGenericProp`'s switch, and its jump to `0x00462083`.
 */
export function PlaceGenericPropType12(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void pl; void rng;
  p.restX = TYPE12_SCALE;
  p.restY = TYPE12_SCALE;
  p.restZ = TYPE12_SCALE;
}

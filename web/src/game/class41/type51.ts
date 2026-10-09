/**
 * Class 0x41 type 51 — a model the descriptor names, drawn at the spawn's
 * pose, and nothing else. Eleven shipped spawns, all stage 5; one of them is
 * the body of the van whose doors are class 0x44's hinge pair.
 *
 * The whole routine, `0x0046EB20`..`0x0046EBC8` `[proved]`:
 *
 * ```
 * 0046eb26  CALL PropExpireByStepLifetime(obj)       ; never returns if it retires
 * 0046eb2d  PUSH 0 ; CALL MatrixStackPush
 * 0046eb32  FLD [ESI+0x1c8] ; FADD [ESI+0x1a4] ; FSTP [ESP]   ; z + obj+0x1C8
 *           MatrixTranslate(+0x19C, +0x1A0, that)
 *           MatrixRotateY(+0x1D0); MatrixRotateZ(+0x1D4); MatrixRotateX(+0x1CC)
 * 0046eb7b  if (g_GameMode != 2 && g_scene_lighting != 0)
 *               SubmitSlotWithSceneLightArray((s16)+0x28C)
 *           else AssetDrawSlot((s16)+0x28C)
 *           MatrixStackPop(1)
 * ```
 *
 * `Ry . Rz . Rx` — the one descriptor-slot type that composes yaw before
 * roll. `PlaceGenericProp`'s arm, `0x004623FB`, writes `obj+0x11C =
 * (u16)placer+0x1F4` and `obj+0x28C = placer+0x11C` and nothing else, and
 * both are the constructor's table rows already (`GENERIC_LIFETIME_FROM_1F4`
 * and the prologue's slot), so it has no arm of its own here. Nothing writes
 * `+0x1C8` for this type, so the draw is the placed pose. No radius, no shot
 * sphere, no `AND` on `obj+0x34`.
 *
 * The old note on this type said it "needs nothing else", and of its behaviour
 * that was right: the port drew it from the fields with the right order. It
 * is transcribed whole anyway so that nothing about it is left to the
 * renderer — the order included.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTranslate }
  from "../matrix";
import { PropExpireByStepLifetime } from "./lifetime";
import {
  PropDrawBegin, PropDrawSlot, PropMatrixPush,
  PropSubmitSlotWithSceneLightArray,
} from "./prop_draw";
import type { BreakableProp } from "./prop_state";
import { GameMode } from "../game_mode";
import { G } from "../globals";

/**
 * `PropDrawOnlyType51` — `FUN_0046EB20`. `g_class41_updates[51]`.
 *
 * `+0x1C8` is {@link BreakableProp.vz}, the offset that field carries.
 */
export function PropDrawOnlyType51(p: BreakableProp, rng: Rng,
                                   events?: Events): void {
  void rng; void events;
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, Math.fround(p.vz + p.z));
  MatrixRotateY(m, p.yaw);
  MatrixRotateZ(m, p.roll);
  MatrixRotateX(m, p.pitch);
  // `g_GameMode != 2 && g_scene_lighting` (`0x0046EB7B`) submits through the
  // scene light array, else `AssetDrawSlot`.
  if (G.g_GameMode !== GameMode.Training && G.g_scene_lighting !== 0) {
    PropSubmitSlotWithSceneLightArray(p, m, p.slot);
  } else {
    PropDrawSlot(p, m, p.slot);
  }
}

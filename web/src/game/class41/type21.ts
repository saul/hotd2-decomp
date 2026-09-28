/**
 * Class 0x41 type 21 — a ten-frame strip on the free-running frame counter.
 *
 * One shipped spawn, stage 2 blocks 25 and 26 (evt `0x11670`), yawed `0xC000`.
 * The whole routine, `0x004694A0`..`0x0046950B` `[proved]`:
 *
 * ```
 * 004694a6  CALL PropExpireByStepLifetime(obj)
 * 004694ad  PUSH 0 ; CALL MatrixStackPush
 *           MatrixTranslate(+0x19C, +0x1A0, +0x1A4); MatrixRotateY(+0x1D0)
 * 004694da  PUSH 9 ; CALL SetDrawLayerNibble
 * 004694df  MOV EAX,[g_frame_counter] ; XOR EDX,EDX ; MOV ECX,10 ; DIV ECX
 * 004694ed  ADD EDX,0x132f ; CALL AssetDrawSlot
 * 004694f9  PUSH 8 ; CALL SetDrawLayerNibble
 *           MatrixStackPop(1)
 * ```
 *
 * `DIV`, not `IDIV`: the counter is taken unsigned, so the strip is
 * `0x132F..0x1338` whatever the counter's sign. No arm, no radius, no shot
 * sphere and no `AND` on `obj+0x34`; the descriptor's `+0x11C` (2) is its
 * step lifetime.
 *
 * The frame is `g_frame_counter`'s, not the object's, so every type-21 prop
 * shows the same frame at once, and the strip is in draw layer 9 — one after
 * the world's own translucent layer, so it blends over it whatever the depth.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { MatrixRotateY, MatrixTranslate } from "../matrix";
import { PropExpireByStepLifetime } from "./lifetime";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import type { BreakableProp } from "./prop_state";

/** `ADD EDX,0x132F` — the strip's first slot. */
export const TYPE21_FIRST_SLOT = 0x132f;
/** `MOV ECX,10; DIV ECX` — the strip's length. */
export const TYPE21_FRAMES = 10;
/** `PUSH 9; CALL SetDrawLayerNibble` around the draw. */
export const TYPE21_DRAW_LAYER = 9;

/**
 * `PropDrawOnlyType21` — `FUN_004694A0`. `g_class41_updates[21]`.
 */
export function PropDrawOnlyType21(p: BreakableProp, rng: Rng,
                                   events?: Events): void {
  void rng; void events;
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, p.yaw);
  const frame = (G.g_frame_counter >>> 0) % TYPE21_FRAMES;
  PropDrawSlot(p, m, frame + TYPE21_FIRST_SLOT, TYPE21_DRAW_LAYER);
}

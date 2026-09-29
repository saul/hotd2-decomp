/**
 * The shell screens' idle dimmer: five minutes with nothing held, and the
 * screen darkens.
 *
 * The title, the options list and both its sub-screens, the ranking and the
 * item screens call `ScreenIdleDim` once a frame from their draw; their arms
 * call `ScreenIdleReset`. The count is the frames since a button was last
 * held -- `g_pad_held` or the second held word -- so a mouse moving over the
 * screen does not keep it lit, in the engine as here. `[proved]`
 */
import { G } from "./globals";

/** `CMP EAX, 0x4650` -- 18000 frames, five minutes at 60. */
const IDLE_DIM_AFTER = 0x4650;
/** `MOV EAX, 0x468C`: the count stops sixty frames later. */
const IDLE_DIM_CAP = 0x468c;
/** `FMUL [0x004C4CC0]`, f32: the dim's alpha rises 0.01 a frame... */
const IDLE_DIM_STEP = Math.fround(0.01);
/** ...to 0.6 (`FCOMP qword [0x004E3108]`). */
const IDLE_DIM_ALPHA = 0.6;

/**
 * `ScreenIdleDim` — `FUN_00413CC0`. Any held button zeroes the count;
 * otherwise it goes up one, and past 18000 the screen is drawn over with
 * asset slot `0x93E` -- `pol/common.bin` entry 129 -- at alpha
 * `(count - 18000) * 0.01`, at most 0.6, translated to z -0.2 and scaled
 * (1, 2, 1) in view space (`AssetDrawSlotWithAlpha`). The count is held at
 * `0x468C`. `[proved]`
 *
 * The draw is recorded in `G.g_screen_idle_dim`, which `GameUpdate` clears
 * at the head of every frame; the renderer draws the model.
 */
export function ScreenIdleDim(): void {
  if (G.g_pad_held !== 0 || G.g_pad_aux_held !== 0) {
    G.g_screen_idle_frames = 0;
    return;
  }
  G.g_screen_idle_frames += 1;
  if (G.g_screen_idle_frames <= IDLE_DIM_AFTER) return;
  // `FILD; FMUL; FST` to the float, and the compare on the unrounded
  // product still in ST0.
  const v = (G.g_screen_idle_frames - IDLE_DIM_AFTER) * IDLE_DIM_STEP;
  G.g_screen_idle_dim = Math.fround(v < IDLE_DIM_ALPHA ? v : IDLE_DIM_ALPHA);
  if (G.g_screen_idle_frames > IDLE_DIM_CAP) {
    G.g_screen_idle_frames = IDLE_DIM_CAP;
  }
}

/** `ScreenIdleReset` — `FUN_00413DA0`. The count back to 0. */
export function ScreenIdleReset(): void {
  G.g_screen_idle_frames = 0;
}

/**
 * The chapter card's title: eight screen sprites that zoom in, echo, cut
 * between each other, fade, rest and stretch away, one frame a call.
 *
 * `ChapterCardInstall`'s sub 0 seeds it with `ChapterTitleReset` and fills
 * `G.g_chapter_title_sprites` with the scene's eight ids; every sub-1 frame
 * then calls `ChapterTitleDraw` with the scene's two anchor points. Every draw
 * is a `ScreenSpriteDraw` (`FUN_00499F00`): centred on its point, depth 1.0,
 * so the HUD layer draws it. The routine's state is
 * `G.g_chapter_title_parts` -- record 0's frame counter and phase, and each
 * record's scale and alpha.
 *
 * Every step and offset below is a float the routine loads from `.rdata`
 * (`FADD float ptr [addr]`), named with its address, or an immediate it
 * `PUSH`es. The arithmetic is x87 on `float` operands stored back to `float`,
 * which is one rounding: `Math.fround` of the double result.
 */
import { G } from "../globals";
import { ScreenSpriteDraw } from "../screen_sprite";
import { CHAPTER_TITLE_PARTS } from "./state";

const f32 = Math.fround;

/** `ChapterTitleDraw`'s five phases, record 0's `+0x1C` (table `0x00437A54`). */
export enum ChapterTitlePhase {
  /** Frames 0..14: the four big copies shrink to their size. */
  ZoomIn = 0,
  /** 15..45: the echo copies grow and fade; s7 and s4 fade in from 25. */
  Echo = 1,
  /** 46..85: five-frame cuts, then a fade out. */
  Cuts = 2,
  /** 86..115: nothing drawn. */
  Rest = 3,
  /** 116..170: s6/s3 grow and fade, s0/s1 and s7/s4 stretch away. */
  Stretch = 4,
}

/** Where `ChapterTitleReset` starts each record's scale -- its immediates. */
const RESET_SCALE_0 = 1.5;           // 0x3FC00000
const RESET_SCALE_1 = 4.5;           // 0x40900000
const RESET_SCALE_2 = 2.0;           // 0x40000000
const RESET_SCALE_3 = 6.0;           // 0x40C00000

/** The per-frame steps, `.rdata`. */
const STEP_THIRTIETH = f32(0.033333335);      // [0x0055DD0C]
const STEP_ECHO_0 = f32(0.23333333);          // [0x0055E1BC]
const STEP_FIFTEENTH = f32(0.06666667);       // [0x004D1CE4]
const STEP_ECHO_1 = f32(0.33333334);          // [0x0055E1B8]
const FADE_IN_STEP = f32(0.025);              // [0x004C4CB0]
const FADE_OUT_STEP = f32(0.1);               // [0x004C4CC8]
const STRETCH_FADE_STEP = f32(0.022222223);   // [0x0055E1B0]
const SQUASH_X_0 = f32(0.12000000476837158);  // [0x0055E1AC]
const STRETCH_Y_0 = f32(1.6);                 // [0x0055E1A8]
const SQUASH_X_1 = f32(0.198);                // [0x0055E1A4]
const STRETCH_Y_1 = f32(3.2);                 // [0x0055E1A0]

/** The offsets from the anchor points, `.rdata`. */
const OFF_3 = 3;                     // [0x004C49C0]
const OFF_5 = 5;                     // [0x0055D2B4]
const OFF_10 = 10;                   // [0x004C43A4]
const OFF_12 = 12;                   // [0x004D1D20]
const OFF_15 = 15;                   // [0x004C4398]
const OFF_20 = 20;                   // [0x004C4C8C]
const OFF_25 = 25;                   // [0x004E30E8]
const OFF_30 = 30;                   // [0x0055CCD4]
const OFF_33 = 33;                   // [0x0055E1B4]
const OFF_40 = 40;                   // [0x004ECB7C]
const OFF_50 = 50;                   // [0x0055D2AC]
/** One fixed `y` in phase 2's second cut: `PUSH 0x43a28000` at `0x00437073`. */
const CUT_Y_FIXED = 325;
/** The scale the fade-out's s7/s4 are drawn at: `PUSH 0x3f333333`. */
const SMALL = f32(0.7);
/** Phase 2's dim copies: `PUSH 0x3f000000`. */
const HALF = 0.5;
/** Every draw's depth: `PUSH 0x3f800000`. */
const DEPTH = 1;

/** The frame numbers the phases test, each the routine's own `CMP AX, imm`. */
const ZOOM_LAST = 0x0e;
const ECHO_FROM = 0x0f;
const ECHO_LAST = 0x2d;
const ECHO_FADE_FROM = 0x19;
const CUT_A_LAST = 0x32;
const CUT_B_FROM = 0x33;
const CUT_B_LAST = 0x37;
const CUT_C_FROM = 0x38;
const CUT_C_LAST = 0x3c;
const CUT_D_FROM = 0x3d;
const CUT_D_LAST = 0x41;
const CUT_E_FROM = 0x42;
const CUT_E_LAST = 0x46;
const CUT_F_FROM = 0x47;
const CUT_F_LAST = 0x4b;
const FADE_FROM = 0x4c;
const FADE_LAST = 0x55;
const REST_LAST = 0x73;
const STRETCH_FROM = 0x74;
const STRETCH_LAST = 0xa0;
const STRETCH_SOLID_FROM = 0x96;
const SQUASH_0_FROM = 0xa1;
const SQUASH_0_LAST = 0xa5;
const SQUASH_1_FROM = 0xa6;
const SQUASH_1_LAST = 0xaa;

/** `(v << 16) >> 16` -- the counter is a word, `INC AX`. */
function s16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * `ChapterTitleReset` — `FUN_00436A30`. Every record to scale 1, alpha 1,
 * frame and phase 0; then records 0..3's scales to 1.5, 4.5, 2 and 6 and
 * records 4 and 5's alpha to 0. The four other words each record carries
 * are zeroed too and read by nothing, so the port has none of them (see
 * `ChapterTitlePart`).
 */
export function ChapterTitleReset(): void {
  const parts = G.g_chapter_title_parts;
  for (let i = 0; i < CHAPTER_TITLE_PARTS; i++) {
    const p = parts[i];
    p.sx = 1;
    p.sy = 1;
    p.frame = 0;
    p.alpha = 1;
    p.phase = 0;
  }
  parts[0].sx = RESET_SCALE_0;
  parts[0].sy = RESET_SCALE_0;
  parts[1].sx = RESET_SCALE_1;
  parts[1].sy = RESET_SCALE_1;
  parts[2].sx = RESET_SCALE_2;
  parts[2].sy = RESET_SCALE_2;
  parts[3].sx = RESET_SCALE_3;
  parts[3].sy = RESET_SCALE_3;
  parts[4].alpha = 0;
  parts[5].alpha = 0;
}

/**
 * `ChapterTitleDraw` — `FUN_00436AD0`. One frame of the title, about the two
 * anchor points `(x0, y0)` and `(x1, y1)` its caller pushes; then record 0's
 * frame counter steps, on every path (`INC AX` before each `RET`). A phase
 * above 4 draws nothing (`CMP EAX, 0x4; JA 0x00437A40`) and only steps the
 * counter.
 */
export function ChapterTitleDraw(x0: number, y0: number, x1: number,
                                 y1: number): void {
  const p = G.g_chapter_title_parts;
  const r0 = p[0];
  const n = r0.frame;
  switch (r0.phase) {
    case ChapterTitlePhase.ZoomIn: ChapterTitleZoomIn(x0, y0, x1, y1, n); break;
    case ChapterTitlePhase.Echo: ChapterTitleEcho(x0, y0, x1, y1, n); break;
    case ChapterTitlePhase.Cuts: ChapterTitleCuts(x0, y0, x1, y1, n); break;
    case ChapterTitlePhase.Rest:
      // `0x0043763D`: nothing drawn; at frame 115 phase 4, record 0's scale
      // and alpha back to 1.
      if (n === REST_LAST) {
        r0.phase = ChapterTitlePhase.Stretch;
        r0.sx = 1;
        r0.sy = 1;
        r0.alpha = 1;
      }
      break;
    case ChapterTitlePhase.Stretch:
      ChapterTitleStretch(x0, y0, x1, y1, n);
      break;
  }
  r0.frame = s16(r0.frame + 1);
}

/**
 * One `ScreenSpriteDraw` of sprite `s[i]`, `MOVSX` of the word at
 * `0x007DCBA0 + i*2`. `[port-only]` as a function.
 */
function Sprite(i: number, x: number, y: number, sx: number, sy: number,
                alpha: number): void {
  ScreenSpriteDraw(s16(G.g_chapter_title_sprites[i]), x, y, DEPTH, sx, sy,
                   alpha);
}

/**
 * Phase 0, `0x00436AEC`. At frame 14 the phase becomes 1 and the shrink still
 * runs; from 15 it does not (`CMP AX, 0xE; JNZ` then `CMP AX, 0xF; JGE`).
 * Then s0 at both of the first point's places and s1 at both of the
 * second's, each at its record's scale. `[port-only]` as a function: the
 * phase's arm.
 */
function ChapterTitleZoomIn(x0: number, y0: number, x1: number, y1: number,
                            n: number): void {
  const [r0, r1, r2, r3] = G.g_chapter_title_parts;
  let shrink = true;
  if (n === ZOOM_LAST) r0.phase = ChapterTitlePhase.Echo;
  else if (n >= ECHO_FROM) shrink = false;
  if (shrink) {
    r0.sx = f32(r0.sx - STEP_THIRTIETH);
    r0.sy = f32(r0.sy - STEP_THIRTIETH);
    r1.sx = f32(r1.sx - STEP_ECHO_0);
    r1.sy = f32(r1.sy - STEP_ECHO_0);
    r2.sx = f32(r2.sx - STEP_FIFTEENTH);
    r2.sy = f32(r2.sy - STEP_FIFTEENTH);
    r3.sx = f32(r3.sx - STEP_ECHO_1);
    r3.sy = f32(r3.sy - STEP_ECHO_1);
  }
  Sprite(0, x0, y0, r0.sx, r0.sy, 1);
  Sprite(0, f32(x0 + OFF_10), f32(y0 + OFF_10), r1.sx, r1.sy, 1);
  Sprite(1, x1, y1, r2.sx, r2.sy, 1);
  Sprite(1, f32(x1 + OFF_10), f32(y1 + OFF_10), r3.sx, r3.sy, 1);
}

/**
 * Phase 1, `0x00436C97`. Frames 15..45 grow records 1 and 3 by a thirtieth
 * and fade them by as much, their alpha forced to 0 on frame 45 (the `JNZ`s
 * at `0x00436CE7` and `0x00436D2D` test the `CMP AX, 0x2D` before them: the
 * x87 instructions between leave the flags alone). Frames 25..45 fade
 * records 4 and 5 in by 0.025. Six draws, and phase 2 on frame 45.
 * `[port-only]` as a function: the phase's arm.
 */
function ChapterTitleEcho(x0: number, y0: number, x1: number, y1: number,
                          n: number): void {
  const [r0, r1, r2, r3, r4, r5] = G.g_chapter_title_parts;
  let fadeIn = false;
  if (n >= ECHO_FROM && n <= ECHO_LAST) {
    r1.sx = f32(r1.sx + STEP_THIRTIETH);
    r1.sy = f32(r1.sy + STEP_THIRTIETH);
    r1.alpha = f32(r1.alpha - STEP_THIRTIETH);
    if (n === ECHO_LAST) r1.alpha = 0;
    r3.sx = f32(r3.sx + STEP_THIRTIETH);
    r3.sy = f32(r3.sy + STEP_THIRTIETH);
    r3.alpha = f32(r3.alpha - STEP_THIRTIETH);
    if (n === ECHO_LAST) {
      r3.alpha = 0;
      fadeIn = true;                                  // JMP 0x00436D47
    }
  }
  if (!fadeIn && n >= ECHO_FADE_FROM && n <= ECHO_LAST) fadeIn = true;
  if (fadeIn) {
    r4.alpha = f32(r4.alpha + FADE_IN_STEP);
    r5.alpha = f32(r5.alpha + FADE_IN_STEP);
  }
  Sprite(0, x0, y0, r0.sx, r0.sy, 1);
  Sprite(0, f32(x0 + OFF_10), f32(y0 + OFF_10), r1.sx, r1.sy, r1.alpha);
  Sprite(1, x1, y1, r2.sx, r2.sy, 1);
  Sprite(1, f32(x1 + OFF_10), f32(y1 + OFF_10), r3.sx, r3.sy, r3.alpha);
  Sprite(7, f32(x0 + OFF_40), f32(y0 + OFF_40), 1, 1, r4.alpha);
  Sprite(4, f32(x1 + OFF_50), f32(y1 - OFF_30), 1, 1, r5.alpha);
  if (n === ECHO_LAST) r0.phase = ChapterTitlePhase.Cuts;
}

/**
 * Phase 2, `0x00436F00`: six five-frame cuts, each four draws, then frames
 * 76..85 fade s0, s1, s7 and s4 out from 1 by a tenth; phase 3 on frame 85.
 *
 * The first cut's s4 is at `y0 - 30` -- the first point's `y`, where every
 * other s4 is placed from the second's: `FLD float ptr [ESP + 0x1C]` at
 * `0x00436FCC` loads the second argument, not the fourth. Transcribed as
 * the routine has it. `[port-only]` as a function: the phase's arm.
 */
function ChapterTitleCuts(x0: number, y0: number, x1: number, y1: number,
                          n: number): void {
  const [r0, , r2, , r4, r5] = G.g_chapter_title_parts;
  if (n <= CUT_A_LAST) {
    Sprite(5, x0, f32(y0 + OFF_20), r0.sx, r0.sy, 1);
    Sprite(2, x1, f32(y1 - OFF_25), r2.sx, r2.sy, 1);
    Sprite(7, f32(x0 + OFF_40), f32(y0 + OFF_40), 1, 1, r4.alpha);
    Sprite(4, f32(x1 + OFF_50), f32(y0 - OFF_30), 1, 1, r5.alpha);
  }
  if (n >= CUT_B_FROM && n <= CUT_B_LAST) {
    Sprite(5, x0, f32(y0 + OFF_20), r0.sx, r0.sy, 1);
    Sprite(2, x1, CUT_Y_FIXED, r2.sx, r2.sy, 1);
    Sprite(6, f32(x0 + OFF_30), f32(y0 + OFF_40), 1, 1, 1);
    Sprite(3, f32(x1 + OFF_20), f32(y1 - OFF_5), 1, 1, 1);
  }
  if (n >= CUT_C_FROM && n <= CUT_C_LAST) {
    Sprite(0, f32(x0 + OFF_20), f32(y0 + OFF_30), 1, 1, 1);
    Sprite(1, f32(x1 + OFF_10), f32(y1 - OFF_15), 1, 1, 1);
    Sprite(6, f32(x0 + OFF_30), f32(y0 + OFF_40), 1, 1, 1);
    Sprite(3, f32(x1 + OFF_20), f32(y1 - OFF_5), 1, 1, 1);
  }
  if (n >= CUT_D_FROM && n <= CUT_D_LAST) {
    Sprite(0, f32(x0 + OFF_20), f32(y0 + OFF_30), 1, 1, 1);
    Sprite(1, f32(x1 + OFF_10), f32(y1 - OFF_15), 1, 1, 1);
    Sprite(6, x0, f32(y0 + OFF_30), 1, 1, HALF);
    Sprite(3, x1, f32(y1 - OFF_15), 1, 1, HALF);
  }
  if (n >= CUT_E_FROM && n <= CUT_E_LAST) {
    Sprite(5, x0, f32(y0 + OFF_30), 1, 1, 1);
    Sprite(2, x1, f32(y1 - OFF_15), 1, 1, 1);
    Sprite(6, x0, f32(y0 + OFF_30), 1, 1, HALF);
    Sprite(3, x1, f32(y1 - OFF_15), 1, 1, HALF);
  }
  if (n >= CUT_F_FROM && n <= CUT_F_LAST) {
    Sprite(5, x0, f32(y0 + OFF_30), 1, 1, 1);
    Sprite(2, x1, f32(y1 - OFF_15), 1, 1, 1);
    Sprite(7, f32(x0 + OFF_3), f32(y0 + OFF_33), SMALL, SMALL, 1);
    Sprite(4, f32(x1 + OFF_3), f32(y1 - OFF_12), SMALL, SMALL, 1);
  }
  // `CMP AX, 0x4C; JNZ` / `JL` / `CMP AX, 0x55; JG` at `0x004374DC`: frame 76
  // seeds the alpha, 77..85 run on it, and past 85 the routine leaves.
  let fade = false;
  if (n === FADE_FROM) {
    r0.alpha = 1;
    fade = true;
  } else if (n > FADE_FROM) {
    if (n > FADE_LAST) return;
    fade = true;
  }
  if (fade) {
    Sprite(0, f32(x0 + OFF_20), f32(y0 + OFF_40), 1, 1, r0.alpha);
    Sprite(1, f32(x1 + OFF_10), f32(y1 - OFF_5), 1, 1, r0.alpha);
    Sprite(7, f32(x0 + OFF_3), f32(y0 + OFF_33), SMALL, SMALL, r0.alpha);
    Sprite(4, f32(x1 + OFF_3), f32(y1 - OFF_12), SMALL, SMALL, r0.alpha);
    r0.alpha = f32(r0.alpha - FADE_OUT_STEP);
  }
  if (n === FADE_LAST) r0.phase = ChapterTitlePhase.Rest;
}

/**
 * Phase 4, `0x00437682`. Frames 116..160 grow record 0 by a fifteenth and
 * fade it by 0.0222, drawing s6/s3 at its scale and alpha and s7/s4 at the
 * alpha's complement, with s0/s1 solid from 150. Frame 161 resets record 0's
 * scale and 161..165 squash s7/s4 (x down 0.12, y up 1.6 a frame) over solid
 * s0/s1; frame 166 resets it again and 166..170 squash s0/s1 (x down 0.198,
 * y up 3.2). `[port-only]` as a function: the phase's arm.
 */
function ChapterTitleStretch(x0: number, y0: number, x1: number, y1: number,
                             n: number): void {
  const r0 = G.g_chapter_title_parts[0];
  if (n >= STRETCH_FROM && n <= STRETCH_LAST) {
    r0.sx = f32(r0.sx + STEP_FIFTEENTH);
    r0.sy = f32(r0.sy + STEP_FIFTEENTH);
    r0.alpha = f32(r0.alpha - STRETCH_FADE_STEP);
    Sprite(6, f32(x0 + OFF_20), f32(y0 + OFF_40), r0.sx, r0.sy, r0.alpha);
    Sprite(3, f32(x1 + OFF_10), f32(y1 - OFF_5), r0.sx, r0.sy, r0.alpha);
    const rest = f32(1 - r0.alpha);
    Sprite(7, f32(x0 + OFF_10), f32(y0 + OFF_30), 1, 1, rest);
    Sprite(4, x1, f32(y1 - OFF_20), 1, 1, rest);
    if (n >= STRETCH_SOLID_FROM) {
      Sprite(0, f32(x0 + OFF_10), f32(y0 + OFF_30), 1, 1, 1);
      Sprite(1, x1, f32(y1 - OFF_20), 1, 1, 1);
    }
  }
  if (n === SQUASH_0_FROM || (n > SQUASH_0_FROM && n <= SQUASH_0_LAST)) {
    if (n === SQUASH_0_FROM) {
      r0.sx = 1;
      r0.sy = 1;
    }
    Sprite(7, f32(x0 + OFF_10), f32(y0 + OFF_30), r0.sx, r0.sy, 1);
    Sprite(4, x1, f32(y1 - OFF_20), r0.sx, r0.sy, 1);
    Sprite(0, f32(x0 + OFF_10), f32(y0 + OFF_30), 1, 1, 1);
    Sprite(1, x1, f32(y1 - OFF_20), 1, 1, 1);
    r0.sx = f32(r0.sx - SQUASH_X_0);
    r0.sy = f32(r0.sy + STRETCH_Y_0);
  }
  if (n === SQUASH_1_FROM || (n > SQUASH_1_FROM && n <= SQUASH_1_LAST)) {
    if (n === SQUASH_1_FROM) {
      r0.sx = 1;
      r0.sy = 1;
    }
    Sprite(0, f32(x0 + OFF_10), f32(y0 + OFF_30), r0.sx, r0.sy, 1);
    Sprite(1, x1, f32(y1 - OFF_20), r0.sx, r0.sy, 1);
    r0.sx = f32(r0.sx - SQUASH_X_1);
    r0.sy = f32(r0.sy + STRETCH_Y_1);
  }
}

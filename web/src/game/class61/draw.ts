/**
 * The result card's two number draws: a player's score and a player's
 * accuracy, in `result.bin` digits in the camera's own space.
 *
 * Both are one `MatrixLoadIdentity; MatrixTranslate(p*stride + x + column, y,
 * -1); MatrixScale(0.04); AssetDrawSlot(0x165F + digit)` per digit
 * (`game/view_slot.ts`), and both decompile to one digit and a return: the
 * decompiler takes the `MatrixStackPop` after the first draw for a routine
 * that never returns (L35). Every digit's test falls through to the next.
 */
import { G } from "../globals";
import { DrawSlotInView } from "../view_slot";
import { RESULT_GLYPH_FIRST } from "./state";

/** `MatrixScale(0x3d23d70a)`: 0.04 on all three axes, every digit. */
const DIGIT_SCALE = Math.fround(0.04);
/** `PUSH 0xbf800000`: z -1. */
const DIGIT_Z = -1;
/**
 * The digit columns, from the left: 0, then `[0x0055E15C]` 0.0288,
 * `[0x0055E194]` 0.0576, `[0x0055E190]` 0.0864, `[0x0055E18C]` 0.1152 and
 * `[0x0055E188]` 0.144.
 */
const COLUMN = [0, Math.fround(0.0288), Math.fround(0.0576),
                Math.fround(0.0864), Math.fround(0.1152), Math.fround(0.144)];
/** `PUSH 0x1679` at `0x00436839`, the glyph after the accuracy's units. */
const PERCENT_SLOT = 0x1679;

/** `FILD p; FMUL stride; FADD x [; FADD column]; FSTP` -- one float. */
function DigitX(p: number, x: number, stride: number, column: number): number {
  return Math.fround(p * stride + x + column);
}

/**
 * `ResultCardDrawScore` — `FUN_004362E0`. `g_player_score[p]`, a dword,
 * right-aligned in six columns with the leading zeros dropped: the 100000s
 * above 99999 (`CMP ESI, 0x1869f; JLE`), the 10000s above 9999, the 1000s
 * above 999, the 100s above 99, the 10s above 9, and the units always. Each
 * digit is `(score / 10^k) % 10` by `IMUL`/`SAR`/`IDIV`, truncating.
 */
export function ResultCardDrawScore(p: number, x: number, y: number,
                                    stride: number): void {
  const score = G.g_player_score[p] ?? 0;
  const at = (k: number, div: number): void => {
    DrawSlotInView(RESULT_GLYPH_FIRST + (Math.trunc(score / div) % 10),
                   DigitX(p, x, stride, COLUMN[k]), y, DIGIT_Z, DIGIT_SCALE);
  };
  if (score > 99999) at(0, 100000);
  if (score > 9999) at(1, 10000);
  if (score > 999) at(2, 1000);
  if (score > 99) at(3, 100);
  if (score > 9) at(4, 10);
  at(5, 1);
}

/**
 * `ResultCardDrawAccuracy` — `FUN_00436620`. `g_player_shot_count[p]` is
 * **written** 1 when it is 0 (`0x0043663C`); then `pct = hits * 100 /
 * shots`, both s16 and the division truncating. Above 100 (`CMP ESI, 0x64;
 * JLE`) or below 0 it is drawn as 0. The hundreds when above 99, the tens
 * when above 9 -- columns 0 and 0.0288 -- the units always at 0.0576, and
 * slot `0x1679` after them at 0.0864.
 */
export function ResultCardDrawAccuracy(p: number, x: number, y: number,
                                       stride: number): void {
  if (((G.g_player_shot_count[p] << 16) >> 16) === 0) {
    G.g_player_shot_count[p] = 1;
  }
  const hits = (G.g_player_hit_count[p] << 16) >> 16;
  const shots = (G.g_player_shot_count[p] << 16) >> 16;
  let pct = Math.trunc((hits * 100) / shots);
  if (pct > 100 || pct < 0) {
    pct = 0;
  } else {
    if (pct > 99) {
      DrawSlotInView(RESULT_GLYPH_FIRST + Math.trunc(pct / 100) % 10,
                     DigitX(p, x, stride, COLUMN[0]), y, DIGIT_Z, DIGIT_SCALE);
    }
    if (pct > 9) {
      DrawSlotInView(RESULT_GLYPH_FIRST + Math.trunc(pct / 10) % 10,
                     DigitX(p, x, stride, COLUMN[1]), y, DIGIT_Z, DIGIT_SCALE);
    }
  }
  DrawSlotInView(RESULT_GLYPH_FIRST + pct % 10,
                 DigitX(p, x, stride, COLUMN[2]), y, DIGIT_Z, DIGIT_SCALE);
  DrawSlotInView(PERCENT_SLOT, DigitX(p, x, stride, COLUMN[3]), y, DIGIT_Z,
                 DIGIT_SCALE);
}

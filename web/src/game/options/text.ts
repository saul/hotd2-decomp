/**
 * How the options screen draws: its text, its numbers and its backgrounds.
 *
 * The screen has no font of its own in the engine's sense -- no string
 * renderer the rest of the game shares. `OptionsDrawText` draws a string one
 * 16x32 glyph sprite at a time out of `scr_opt_moji05.bin`, on a grid of
 * 16-pixel columns and 24-pixel lines, and the numbers and backgrounds are
 * two more routines beside it. Every glyph is a {@link SCREEN_SPRITE_LIT}
 * quad, so the text takes the colour `SetRenderLightColour` last set: red on
 * the highlighted row, white elsewhere. `[proved]`
 */
import { DrawScreenSprite, OptionsDrawSprite, SCREEN_SPRITE_LIT,
         SetRenderLightColour } from "../screen_sprite";
import { OPTIONS_BACKGROUND_BASES, OPTIONS_BACKGROUND_TILES, OptionsSprite }
  from "../options_data";
import { T } from "../tables";

/** The grid: a column is 16 pixels (`FMUL [0x0055DCF0]`), a line 24 (`[0x004ECB84]`). */
export const OPTIONS_COLUMN_PX = 16;
export const OPTIONS_LINE_PX = 24;

/** `OptionsDrawText`'s flags word. */
export enum OptionsTextFlag {
  /** Centred on 320: `x = 320 - len*8` (`[0x004C49CC]`, `[0x004C43A0]`). */
  Centre = 0x2,
  /** `(col, row)` are pixels, and the glyphs are drawn at 0.8. */
  Pixels = 0x4,
  /** Half alpha: the greyed-out row. */
  Faded = 0x8,
  /** `SetRenderLightColour(1, 0, 0)` first: the highlighted row. */
  Red = 0x10,
  /** `SetRenderLightColour(0.6, 0.6, 0.6)` first. */
  Grey = 0x40,
  /** `C` and `G` are not pulled 3 pixels left. */
  NoKern = 0x80,
  /** Depth 0.9 instead of 1.0. */
  Near = 0x100,
}

/** Lower case sits 7 pixels down its line (`FADD [0x005644FC]`). */
const LOWER_CASE_DROP = 7;
/** `C` and `G` are drawn 3 pixels left (`FSUB [0x004C49C0]`). */
const KERN_CG = 3;

/** The glyph sprite of one character code, 0 for none. */
function Glyph(c: number): number {
  return T.options?.glyphs?.[c - 0x20] ?? 0;
}

/**
 * `OptionsDrawText` — `FUN_00487CA0`. One string at column `col`, line
 * `row`:
 *
 * ```
 * x = flags & 2 ? 320 - len*8 : col*16;   y = row*24
 * flags & 4:     x = col, y = row, both scales 0.8
 * flags & 8:     alpha 0.5
 * flags & 0x10:  SetRenderLightColour(1, 0, 0)
 * flags & 0x40:  SetRenderLightColour(0.6, 0.6, 0.6)
 * flags & 0x100: depth 0.9
 * each char:  a..z  glyph at (x, y + 7)
 *             A..Z  glyph at (x, y) -- C and G at (x - 3, y) unless 0x80
 *             ~     0x7F2 at (x, y)
 *             other glyph at (x, y), if it has one
 *             x += 16
 * SetRenderLightColour(1, 1, 1)
 * ```
 *
 * Every glyph goes through `OptionsDrawSprite` with rotation word 1 and flags
 * `0x2000`, lit. Flag bit 0, which every caller passes, is tested nowhere.
 * `[proved]`
 */
export function OptionsDrawText(col: number, row: number, text: string,
                                flags: number): void {
  let depth = 1;
  let sx = 1;
  let sy = 1;
  let alpha = 1;
  let x = (flags & OptionsTextFlag.Centre) !== 0
    ? 320 - text.length * 8 : col * OPTIONS_COLUMN_PX;
  let y = row * OPTIONS_LINE_PX;
  if ((flags & OptionsTextFlag.Pixels) !== 0) {
    sx = 0.8;
    sy = 0.8;
    x = col;
    y = row;
  }
  if ((flags & OptionsTextFlag.Faded) !== 0) alpha = 0.5;
  if ((flags & OptionsTextFlag.Red) !== 0) SetRenderLightColour(1, 0, 0);
  if ((flags & OptionsTextFlag.Grey) !== 0) {
    SetRenderLightColour(0.6, 0.6, 0.6);
  }
  if ((flags & OptionsTextFlag.Near) !== 0) depth = 0.9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const draw = (id: number, dx: number, dy: number) =>
      OptionsDrawSprite(id, dx, dy, depth, sx, sy, 1, alpha,
                        SCREEN_SPRITE_LIT);
    if (c >= 0x61 && c <= 0x7a) {
      draw(Glyph(c), x, y + LOWER_CASE_DROP);
    } else if (c >= 0x41 && c <= 0x5a) {
      if (c === 0x43 || c === 0x47) {
        if ((flags & OptionsTextFlag.NoKern) !== 0) draw(Glyph(c), x, y);
        else draw(Glyph(c), x - KERN_CG, y);
      } else {
        draw(Glyph(c), x, y);
      }
    } else if (c === 0x7e) {
      draw(OptionsSprite.Tilde, x, y);
    } else {
      const id = Glyph(c);
      if (id !== 0) draw(id, x, y);
    }
    x += OPTIONS_COLUMN_PX;
  }
  SetRenderLightColour(1, 1, 1);
}

/** The units digit's offset past the column: `FADD qword [0x0056AFD0]`, 32. */
const UNITS_DX = 32;

/**
 * `OptionsDrawNumber` — `FUN_00487EE0`. `n` in three places at column
 * `col`, line `row`, right-aligned: the hundreds only above 99, the tens only
 * when they or the hundreds are there, the units always -- each the glyph of
 * its digit (`[digit*2 + 0x0056AF30]`, the glyph table at `'0'`), white, at
 * depth 1, unlit (flags 0). `[proved]`
 */
export function OptionsDrawNumber(col: number, row: number, n: number): void {
  const x = col * OPTIONS_COLUMN_PX;
  const y = row * OPTIONS_LINE_PX;
  const digit = (d: number) => Glyph(0x30 + d);
  const hundreds = Math.trunc((n % 1000) / 100);
  if (hundreds > 0) OptionsDrawSprite(digit(hundreds), x, y, 1, 1, 1, 0, 1, 0);
  const tens = Math.trunc((n % 100) / 10);
  if (tens > 0 || n >= 100) {
    OptionsDrawSprite(digit(tens), x + OPTIONS_COLUMN_PX, y, 1, 1, 1, 0, 1, 0);
  }
  OptionsDrawSprite(digit(n % 10), x + UNITS_DX, y, 1, 1, 1, 0, 1, 0);
}

/** The background's tiles are 128 pixels, and it is drawn at depth 200. */
const BACKGROUND_TILE_PX = 0x80;
const BACKGROUND_DEPTH = 200;
const SCREEN_WIDTH_PX = 0x280;

/**
 * `OptionsDrawBackground` — `FUN_00488090`. Screen `n` (0 the list, 1 Sight
 * Speed, 2 Gun Calibration) as twenty 128x128 tiles, row by row from the
 * top-left, five across the 640 pixels and four down, at depth 200 -- behind
 * everything else the screen draws. Any other `n` draws nothing. `[proved]`
 */
export function OptionsDrawBackground(n: number): void {
  const base = OPTIONS_BACKGROUND_BASES[n];
  if (base === undefined) return;
  let id = base;
  for (let y = 0; id < base + OPTIONS_BACKGROUND_TILES; y += BACKGROUND_TILE_PX) {
    for (let x = 0; x < SCREEN_WIDTH_PX; x += BACKGROUND_TILE_PX) {
      DrawScreenSprite(id, x, y, BACKGROUND_DEPTH, 1, 1, 0);
      id += 1;
    }
  }
}

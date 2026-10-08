/**
 * The tables that make a face move: the mouth cels a civilian talks through
 * and the ones a scripted humanoid talks and blinks through.
 *
 * Neither class animates a face with a motion. Each draws its head bone
 * through its own per-node hook, and the hook adds a **cel** to the slot it
 * submits -- a small number out of one of these tables, indexed by a counter
 * the hook steps as it draws:
 *
 * * `CivilianDrawBonePart` (`FUN_0048D1F0`) draws bone 2 at the bone's own
 *   record slot plus `g_civilian_mouth_tables[sub+0xA8]` at `sub+0xA0`. Every
 *   `hito_kao_*` face bank is laid out for it -- twenty consecutive slots a
 *   face, the head and its mouth shapes.
 * * `ScriptedHumanoidBoneDrawHook` (`FUN_00485260`) draws bone 2 at a
 *   per-character base plus `g_class25_face_cels[n % 13]`, a ramp 0 to 6 and
 *   back, or `g_class25_face_cels_two` for character type 0x36.
 *
 * Both are `.rdata`, so they travel in the bundle; the bases each class adds
 * them to are immediates in the hooks and live in `web/src/game/`.
 * `docs/formats/civilians.md` and `docs/formats/combat.md` are the long form.
 */

import { i8 } from "./bytes";
import type { ExeTables } from "./exetab";

/**
 * `g_civilian_mouth_tables` -- `0x0056B950`, `{s8 *cels; s32 count}[6]`.
 *
 * `CivilianDrawBonePart` reads entry `sub+0xA8` as `(&tables)[mode * 2]` and
 * `*(int *)(0x0056B954 + mode * 8)`, so eight bytes a row, the pointer first.
 *
 * **Six rows, and the bound is the index's** (`L6`): the hook skips the whole
 * arm when the mode is 6 (`if (sub+0xA8 != 6)`), `CivilianInit` writes 6, and
 * the only other writers are op `0x25`, which stores its operand, and the hook
 * itself, which stores 3. The two words after row 5 (`0x2C`, `0x00100080`)
 * are not a pointer into the image.
 */
export const CIVILIAN_MOUTH_TABLES = 0x0056b950;
/** `CMP` against 6 in `CivilianDrawBonePart`: the mode that draws no cel. */
export const CIVILIAN_MOUTH_ROWS = 6;

/**
 * `g_class25_face_cels` -- `0x00596C80`, `u8[13]`, the ramp
 * `0 1 2 3 4 5 6 5 4 3 2 1 0`. Thirteen because the hook's index is the
 * remainder of an `IDIV` by `0xD`, so the table is exactly that long.
 */
export const HUMANOID_FACE_CELS = 0x00596c80;
/**
 * `g_class25_face_cels_two` -- `0x00596C90`, `u8[13]`,
 * `0 1 1 1 1 1 1 1 0 0 0 0 0`: two cels over the same thirteen-frame cycle,
 * character type 0x36's mouth.
 */
export const HUMANOID_FACE_CELS_TWO = 0x00596c90;
/** `MOV ECX, 0xd; CDQ; IDIV ECX` -- the cycle both tables are read over. */
export const HUMANOID_FACE_CYCLE = 13;

/**
 * {@link CIVILIAN_MOUTH_TABLES}, resolved: one list of cels a mode, each the
 * row's `count` signed bytes -- `MOVSX`, `(char)` in the decompilation.
 * Empty when the image does not hold the table where this build has it.
 */
export function civilianMouthTables(tables: ExeTables): number[][] {
  const out: number[][] = [];
  for (let m = 0; m < CIVILIAN_MOUTH_ROWS; m++) {
    const ptr = tables.ru32(CIVILIAN_MOUTH_TABLES + m * 8);
    const count = tables.ri32(CIVILIAN_MOUTH_TABLES + m * 8 + 4);
    const o = ptr === null ? null : tables.v2r(ptr);
    if (o === null || count === null || count <= 0
        || o + count > tables.data.length) {
      return [];
    }
    const row: number[] = [];
    for (let i = 0; i < count; i++) row.push(i8(tables.data, o + i));
    out.push(row);
  }
  return out;
}

/** One of the two class-0x25 cel tables, {@link HUMANOID_FACE_CYCLE} long. */
export function humanoidFaceCels(tables: ExeTables, va: number): number[] {
  const o = tables.v2r(va);
  if (o === null || o + HUMANOID_FACE_CYCLE > tables.data.length) return [];
  const out: number[] = [];
  for (let i = 0; i < HUMANOID_FACE_CYCLE; i++) out.push(i8(tables.data, o + i));
  return out;
}

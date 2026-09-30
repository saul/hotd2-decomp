/**
 * The image tables three class-0x41 constructors build their objects from,
 * read as the constructors read them and carried raw: the multiply each
 * routine applies (`* 0.1`, `* 0.001`) is the routine's, and stays in
 * `game/class41/` with it.
 *
 * Each table's address and row count is the constructor's own loop -- a
 * `MOV EDI, <first field>` and a `CMP EDI, <end>` in `.text` -- which the
 * `*_slots.ts` modules carry as immediates; nothing here scans for where a
 * table ends (`L6`).
 */
import type { ExeTables } from "./exetab";
import { TYPE16_ROW_COUNT, TYPE16_ROWS } from "../game/class41/type16_slots";
import { TYPE29_ROW_COUNT, TYPE29_ROWS } from "../game/class41/type29_slots";
import { TYPE37_HULL, TYPE37_HULL_POINTS } from "../game/class41/type37_slots";

/** A signed 16-bit read, or null outside the image. */
function ri16(tables: ExeTables, va: number): number | null {
  const v = tables.ru16(va);
  return v === null ? null : (v << 16) >> 16;
}

/**
 * `g_type16_prop_xz` -- `0x00593D20`, six `{s16 x, z}` rows `PlaceTable16Props`
 * (`FUN_00462FE0`) places its objects at, raw. Empty if the image is short.
 */
export function type16Rows(tables: ExeTables): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < TYPE16_ROW_COUNT; i++) {
    const x = ri16(tables, TYPE16_ROWS + i * 4);
    const z = ri16(tables, TYPE16_ROWS + i * 4 + 2);
    if (x === null || z === null) return [];
    out.push([x, z]);
  }
  return out;
}

/**
 * `g_type29_prop_xyz` -- `0x00593D38`, nine `{f32 x, y, z}` rows
 * `PlaceTable29Props` (`FUN_00463270`) copies into its objects.
 */
export function type29Rows(tables: ExeTables): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < TYPE29_ROW_COUNT; i++) {
    const row: number[] = [];
    for (let k = 0; k < 3; k++) {
      const v = tables.rf32(TYPE29_ROWS + i * 12 + k * 4);
      if (v === null) return [];
      row.push(v);
    }
    out.push([row[0], row[1], row[2]]);
  }
  return out;
}

/**
 * `g_type37_hull_points` -- `0x00593E40`, the eight `{s16 x, y, z}` corners
 * `PropUpdateType37` (`FUN_0046B5F0`) tests a falling object's floor against
 * and pivots on, raw.
 */
export function type37Hull(tables: ExeTables): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < TYPE37_HULL_POINTS; i++) {
    const row: number[] = [];
    for (let k = 0; k < 3; k++) {
      const v = ri16(tables, TYPE37_HULL + i * 6 + k * 2);
      if (v === null) return [];
      row.push(v);
    }
    out.push([row[0], row[1], row[2]]);
  }
  return out;
}

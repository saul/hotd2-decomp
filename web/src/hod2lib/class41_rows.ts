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
import { ExeTables } from "./exetab";
import { TYPE16_ROW_COUNT, TYPE16_ROWS } from "../game/class41/type16_slots";
import { TYPE29_ROW_COUNT, TYPE29_ROWS } from "../game/class41/type29_slots";
import { TYPE37_HULL, TYPE37_HULL_POINTS } from "../game/class41/type37_slots";
import {
  GOLDEN_FROG_LESSON_ROW_COUNT, GOLDEN_FROG_LESSON_ROWS, ITEM_PICKUP_KINDS,
  ITEM_PICKUP_STRIDE, ITEM_PICKUP_TABLE,
} from "../game/class41/item_pickup_slots";

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

/** One `g_item_pickup_slot` record, raw. See `ItemPickupRowJson`. */
export interface ItemPickupRow {
  slot: number;
  score: number;
  scale: number;
  y_offset: number;
}

/**
 * `g_item_pickup_slot` -- `0x00595058`, the score pickup's record per item
 * kind (`class41/item_pickup_slots.ts`), for the five kinds the release
 * switch hands `SpawnScorePickup` (`FUN_004723F0`). Keyed by the kind, which
 * is the index both routines read it by. Empty if the image is short.
 */
export function itemPickupRows(tables: ExeTables):
    Record<string, ItemPickupRow> {
  const out: Record<string, ItemPickupRow> = {};
  for (const kind of ITEM_PICKUP_KINDS) {
    const va = ITEM_PICKUP_TABLE + kind * ITEM_PICKUP_STRIDE;
    const slot = tables.ru16(va);
    const score = ri16(tables, va + 2);
    const scale = tables.rf32(va + 4);
    const y = tables.rf32(va + 8);
    if (slot === null || score === null || scale === null || y === null) {
      return {};
    }
    out[String(kind)] = { slot, score, scale, y_offset: y };
  }
  return out;
}

/**
 * `g_golden_frog_lesson_xz` -- `0x0059579C`, the fifteen `{s16 x, z}` rows
 * class 0x41 constructor 68 (`PlaceGoldenFrogFromLessonTable`,
 * `FUN_00463E50`) places its frog at, raw. Empty if the image is short.
 */
export function goldenFrogLessonRows(tables: ExeTables): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < GOLDEN_FROG_LESSON_ROW_COUNT; i++) {
    const x = ri16(tables, GOLDEN_FROG_LESSON_ROWS + i * 4);
    const z = ri16(tables, GOLDEN_FROG_LESSON_ROWS + i * 4 + 2);
    if (x === null || z === null) return [];
    out.push([x, z]);
  }
  return out;
}

/**
 * Every `pol/` file whose slot list names `slot`: the lists at
 * `0x004E794C` (`ExeTables.POL_SLOT_LIST`, a pointer a file, counts at
 * `0x004E803C`) that the load job binds slot by slot and the free job clears
 * slot by slot (`FUN_00419020`), so these are the files whose state decides
 * the slot's resident bit (`game/pol_files.ts`).
 */
export function polFilesHoldingSlot(tables: ExeTables, slot: number): number[] {
  const out: number[] = [];
  for (const [fi, [, cnt]] of tables.polFiles()) {
    const list = tables.ru32(ExeTables.POL_SLOT_LIST + fi * 4);
    if (!list) continue;
    for (let k = 0; k < cnt; k++) {
      if (ri16(tables, list + k * 2) === slot) {
        out.push(fi);
        break;
      }
    }
  }
  return out;
}

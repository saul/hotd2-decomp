/**
 * Class 0x32's tables and descriptor tail -- the stage-5 boss.
 *
 * Every table here is `.rdata` an instruction of the class indexes directly
 * (the address beside each is the one that instruction names), so they
 * travel in the bundle (`characters.class32`) rather than as constants in
 * `game/class32/`. The seventeen-row tables are by the boss's rank,
 * `obj+0x131E`: `Class32AdjustRank` clamps it to 0..15 and `Class32Update`
 * writes 16 after 18000 frames, so all seventeen rows are reachable. See
 * `docs/re/boss-magician.md` for the reading.
 */

import { f32, i32 } from "./bytes";
import type { ExeTables } from "./exetab";
import type { Spawn } from "./evt";

/** `g_class32_phases` -- six `{i32 state; f32 floor}` records. */
export const CLASS32_PHASES = 0x00596770;
export const CLASS32_PHASE_COUNT = 6;
/** `g_class32_hop_offsets` -- four `(x, y, z)` floats. */
export const CLASS32_HOP_OFFSETS = 0x005967a0;
/** `g_class32_hop_frames` -- i32 by rank. */
export const CLASS32_HOP_FRAMES = 0x005967d0;
/** `g_class32_circle_offsets` -- four `(x, y, z)` floats. */
export const CLASS32_CIRCLE_OFFSETS = 0x00596818;
/** `g_class32_rank_rows` -- four i32 by rank. */
export const CLASS32_RANK_ROWS = 0x00596848;
/** `g_class32_projectile_frames` -- i32 by rank. */
export const CLASS32_PROJECTILE_FRAMES = 0x00596958;
/** `g_class32_barrage_rows` -- four i32 by rank. */
export const CLASS32_BARRAGE_ROWS = 0x005969a0;
/** Ranks 0..16. */
export const CLASS32_RANKS = 17;
/** The two offset tables' four points. */
export const CLASS32_POINTS = 4;

/**
 * Class 0x32's `.rdata`, read where the routines read it. An empty object
 * when there is no executable -- the client then has no tables and the boss
 * never leaves its first state, which is what a bundle without them should
 * do.
 */
export function class32Tables(tables: ExeTables | null):
    Record<string, unknown> {
  if (tables === null) return {};
  const d = tables.data;
  const at = (va: number): number => {
    const o = tables.v2r(va);
    if (o === null) throw new Error(`class32: 0x${va.toString(16)} unmapped`);
    return o;
  };
  const phases: [number, number][] = [];
  let o = at(CLASS32_PHASES);
  for (let i = 0; i < CLASS32_PHASE_COUNT; i++, o += 8) {
    phases.push([i32(d, o), f32(d, o + 4)]);
  }
  const points = (va: number): [number, number, number][] => {
    const b = at(va);
    return Array.from({ length: CLASS32_POINTS }, (_u, i) =>
      [f32(d, b + i * 12), f32(d, b + i * 12 + 4), f32(d, b + i * 12 + 8)]);
  };
  const ints = (va: number): number[] => {
    const b = at(va);
    return Array.from({ length: CLASS32_RANKS }, (_u, i) => i32(d, b + i * 4));
  };
  const rows = (va: number): [number, number, number, number][] => {
    const b = at(va);
    return Array.from({ length: CLASS32_RANKS }, (_u, i) =>
      [i32(d, b + i * 16), i32(d, b + i * 16 + 4), i32(d, b + i * 16 + 8),
       i32(d, b + i * 16 + 12)]);
  };
  return {
    phases,
    hop_offsets: points(CLASS32_HOP_OFFSETS),
    hop_frames: ints(CLASS32_HOP_FRAMES),
    circle_offsets: points(CLASS32_CIRCLE_OFFSETS),
    rank_rows: rows(CLASS32_RANK_ROWS),
    projectile_frames: ints(CLASS32_PROJECTILE_FRAMES),
    barrage_rows: rows(CLASS32_BARRAGE_ROWS),
  };
}

/**
 * Class 0x32's descriptor tail, every field a routine of the class reads
 * through `obj+0x1390` -- see `CharacterPlacement.class32` for which routine
 * reads which.
 */
export function class32Tail(rec: Spawn): Record<string, unknown> {
  const i8 = (off: number): number => rec.param(off, "i8") ?? 0;
  const i32v = (off: number): number => rec.param(off, "i32") ?? 0;
  const f = (off: number): number => rec.param(off, "f32") ?? 0;
  return {
    char_type: i8(0x00),
    state: i8(0x02),
    damage: i8(0x04),
    projectile_hp: i8(0x10),
    trail_interval: i8(0x12),
    projectile_radius: f(0x14),
    afterimage_interval: i8(0x19),
    held_trail_interval: i8(0x1a),
    burst_frames: i32v(0x1c),
    burst_bright: i32v(0x20),
    retire_speed: f(0x28),
    death_frames: i32v(0x2c),
    death_burst_interval: i32v(0x34),
  };
}

/**
 * Every clip the class plays: the literal motion arguments of its
 * `ActorSetMotionBlended` calls (`Class32Init` seats 0x8E), `boss5.bin`'s
 * bank. Its states measure their exits on these clips' play lengths, so an
 * unbaked one is a state that never ends. `[proved]`: the arguments were
 * read at each call site in `0x0047C960..0x0048096F`.
 */
export const CLASS32_MOTIONS: readonly number[] = [
  0x82, 0x84, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f, 0x94,
];

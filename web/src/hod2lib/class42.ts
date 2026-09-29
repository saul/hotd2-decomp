/**
 * Class 0x42's tables -- the worm.
 *
 * Every array here is `.rdata` that `PlaceWormBatch` (`FUN_0042F9B0`) and
 * `WormUpdate` (`FUN_0042FCA0`) index directly, so it travels in the bundle
 * (`characters.class42`) rather than as a constant in `game/class42/`. Each
 * extent is the one its reader's index can reach, not the gap to the next
 * table (L6): the per-member rows stop at the fifteenth member, the crawl at
 * the row its `< 0x3B` test lets through, the leap path at the rows its
 * `> 0x1F` test lets through.
 *
 * And the two motions the halves of a split worm follow, `0xBF` and `0xC0`,
 * which `MotionFrameRecord` (`FUN_00412FB0`) reads a frame of at a time --
 * `g_motion_slots[motion].base + 4 + frame * 0x14`, the two-node stride of
 * the effect layout `MotionBank.effectFrames` already decodes. Both are in
 * bank 33, `mol.bin`, sixty frames each, and the halves' counters stop at
 * `0x3B`: the last frame there is.
 */

import { i16, i32, i8, u8 } from "./bytes";
import type { ExeTables } from "./exetab";
import { loadBank } from "./mot";
import type { Stage } from "./stage";
import * as degraded from "./degraded";

/** `g_worm_offsets_6_8` -- `s8 {x, z}[8]`, tenths: sub-type 0's members. */
export const WORM_OFFSETS_6_8 = 0x0055d698;
/** `g_worm_offsets_10_15` -- `s8 {x, z}[15]`, tenths: sub-type 2's. */
export const WORM_OFFSETS_10_15 = 0x0055d6c0;
/** `g_worm_drop_delay` -- `u8[15]`, frames. */
export const WORM_DROP_DELAY = 0x0055d6e8;
/** `g_worm_yaw_offsets` -- `s32[15]`, BAMS. */
export const WORM_YAW_OFFSETS = 0x0055d6fc;
/** `g_worm_orbit_phase` -- `s32[15]`, BAMS. */
export const WORM_ORBIT_PHASE = 0x0055d74c;
/** `g_worm_crawl_steps` -- `s16[60]`, hundredths. */
export const WORM_CRAWL_STEPS = 0x0055d2e0;
export const WORM_CRAWL_STEP_COUNT = 60;
/** `g_worm_crawl_scale` -- `s16[59][3]`, ten-thousandths. */
export const WORM_CRAWL_SCALE = 0x0055d358;
export const WORM_CRAWL_ROWS = 0x3b;
/**
 * `g_worm_leap_path` -- `s16 {rise, reach}`, hundredths. `WormUpdate` indexes
 * `0x0055D440 + frame * 4` and reads it only while the frame is past `0x1F`,
 * so the first row it reaches is `0x20`, at `0x0055D4C0`.
 */
export const WORM_LEAP_PATH_BASE = 0x0055d440;
export const WORM_LEAP_PATH_FIRST = 0x20;
export const WORM_LEAP_ROWS = 0x3c;
/** `g_worm_leap_scale` -- `s16[60][3]`, ten-thousandths. */
export const WORM_LEAP_SCALE = 0x0055d530;
/** The most members a batch can make -- sub-type 2 with two players. */
export const WORM_MEMBERS_MAX = 15;
/** Sub-type 0's most -- eight, with two players. */
export const WORM_MEMBERS_ON_COG_MAX = 8;
/** The two motions `MotionFrameRecord` is handed: half 0's, then half 1's. */
export const WORM_HALF_MOTIONS: readonly number[] = [0xbf, 0xc0];
/** Frames each half runs, `0..0x3B`. */
export const WORM_HALF_FRAMES = 0x3c;

function run(tables: ExeTables, va: number, n: number, size: number,
             read: (d: Uint8Array, o: number) => number): number[] {
  const o = tables.v2r(va);
  if (o === null) return [];
  return Array.from({ length: n }, (_, i) => read(tables.data, o + i * size));
}

/**
 * The `characters.class42` block, for a stage that spawns the class.
 *
 * The halves are `{motion, t, r}` with `frames * 3` numbers each, the
 * `effectFrames` shape `EffectDefJson` carries for one bone: `t` the
 * translation, `r` the three angles in BAMS as the record holds them,
 * `(rx, ry, rz)`.
 */
export async function class42Tables(stage: Stage):
    Promise<Record<string, unknown>> {
  const tables = stage.tables;
  const halves: Record<string, unknown>[] = [];
  for (const motion of WORM_HALF_MOTIONS) {
    const bankId = tables.motionBankOf(motion);
    const banks = tables.motionBanks();
    const bank = bankId !== null && banks.has(bankId)
      ? await loadBank(stage.source, banks.get(bankId)![0],
                       banks.get(bankId)![1])
      : null;
    const frames = bank ? bank.effectFrames(motion, 2) : [];
    if (frames.length < WORM_HALF_FRAMES) {
      degraded.note("hod2lib.class42.halves", `motion 0x${motion.toString(16)}`,
                    "a split worm's half stands still where it was shot",
                    `${frames.length} frames decoded, ${WORM_HALF_FRAMES} read`);
    }
    halves.push({
      motion,
      t: frames.flatMap((f) => f.t[0] ?? [0, 0, 0]),
      r: frames.flatMap((f) => f.r[0] ?? [0, 0, 0]),
    });
  }
  return {
    offsets_6_8: run(tables, WORM_OFFSETS_6_8, WORM_MEMBERS_ON_COG_MAX * 2, 1, i8),
    offsets_10_15: run(tables, WORM_OFFSETS_10_15, WORM_MEMBERS_MAX * 2, 1, i8),
    drop_delay: run(tables, WORM_DROP_DELAY, WORM_MEMBERS_MAX, 1, u8),
    yaw_offsets: run(tables, WORM_YAW_OFFSETS, WORM_MEMBERS_MAX, 4, i32),
    orbit_phase: run(tables, WORM_ORBIT_PHASE, WORM_MEMBERS_MAX, 4, i32),
    crawl_steps: run(tables, WORM_CRAWL_STEPS, WORM_CRAWL_STEP_COUNT, 2, i16),
    crawl_scale: run(tables, WORM_CRAWL_SCALE, WORM_CRAWL_ROWS * 3, 2, i16),
    leap_path: run(tables,
                   WORM_LEAP_PATH_BASE + WORM_LEAP_PATH_FIRST * 4,
                   (WORM_LEAP_ROWS - WORM_LEAP_PATH_FIRST) * 2, 2, i16),
    leap_scale: run(tables, WORM_LEAP_SCALE, WORM_LEAP_ROWS * 3, 2, i16),
    halves,
  };
}

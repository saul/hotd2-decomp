/**
 * The asset slots class 0x41's type-1 task draws besides the one its table
 * names -- the join keys the exporter has to carry so that `render/` has
 * something to draw, and the pairings `WaterSurfaceUpdate` (`FUN_0046E3A0`)
 * applies to them.
 *
 * Data-only, and apart from `water.ts`, so that `hod2lib/bundle.ts` can import
 * it without pulling in `globals.ts` -- the arrangement `class19/slots.ts` has.
 * Every number here is a `.text` immediate in `WaterSurfaceUpdate`. The table
 * the task *starts* from, `g_water_surface_slots` (`0x00593DA4`), is image
 * data and travels in the bundle instead: the exporter resolves each
 * placement's slot through it.
 *
 * All of them are canal water: flat tiles at `y = -25` in `st2_07.bin`,
 * `st1_1.bin`, `komono_boss2.bin` and `komono_venis.bin`.
 */

/** `komono_boss2.bin[0]`, index 0: the stage-2 boss arena's water. */
export const WATER_ARENA_SLOT = 0x13a7;
/** `st2_07.bin[1]` -- `AssetDrawSlot(0x13A5)` beside {@link WATER_ARENA_SLOT}. */
export const WATER_ARENA_PAIR_SLOT = 0x13a5;
/** `komono_boss2.bin[2]` -- what {@link WATER_ARENA_SLOT} becomes on flag 9. */
export const WATER_ARENA_ALT_SLOT = 0x13a9;
/** `komono_boss2.bin[5]` -- `AssetDrawSlot(0x13AC)` beside the alternate. */
export const WATER_ARENA_ALT_PAIR_SLOT = 0x13ac;
/** `st2_07.bin[0]`, index 1: the water in stage 2's blocks 37 and 41. */
export const WATER_DEATH_SLOT = 0x13a0;
/** `st1_1.bin[7]` -- what {@link WATER_DEATH_SLOT} becomes on flag 9, and
 * turns back from on camera path 0x6E. */
export const WATER_DEATH_ALT_SLOT = 0x13a2;
/** `st2_07.bin[3]`, index 2: block 16's canal, killed at step 0xF. */
export const WATER_CANAL_SLOT = 0x13b5;

/**
 * `[port-only]` as a table -- what else a task that starts on a slot can
 * draw: the pair drawn beside it and the slot a swap turns it into, and the
 * pair of that. The routine's own tests, gathered as data so the exporter
 * carries the models and `render/` knows which tiles only this task draws.
 * A slot with no entry draws itself and nothing else.
 */
export const WATER_SURFACE_ALSO_DRAWS: Readonly<Partial<Record<number,
    readonly number[]>>> = {
  [WATER_ARENA_SLOT]: [WATER_ARENA_PAIR_SLOT, WATER_ARENA_ALT_SLOT,
                       WATER_ARENA_ALT_PAIR_SLOT],
  [WATER_DEATH_SLOT]: [WATER_DEATH_ALT_SLOT],
};

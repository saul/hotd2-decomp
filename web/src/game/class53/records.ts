/**
 * Class 0x53's `.rdata` — the cat's two playlist tables, `0x00589A64`..
 * `0x00589ADB`, as cited constants.
 *
 * Data only, and imported by the exporter for the clip list: the
 * `class22/records.ts` / `class23/records.ts` arrangement. One class's own
 * tables, read by nothing else, kept as the bytes the image holds and read out
 * of them. 0x78 bytes from `0x00589A64`, read with Ghidra's `read_memory`.
 *
 * ## Where each table ends, and why that is proved rather than hunted
 *
 * Both are six rows of five s16s. `CatMotionListUpdate` (`FUN_00431340`) names
 * **both** bases — `0x00589A64` for the clip and `0x00589AA0` for its repeat
 * count, each indexed `set * 5 + index` — so the second base is where the
 * first table stops, and 0x3C bytes is six rows. The repeat table's six rows
 * run to `0x00589ADB`; four zero bytes follow, then `g_class28_route_table`
 * at `0x00589AE0`. `L6` is the reason to say so: the length comes from the
 * code's own second address, not from where the data looked like it ended.
 */

const CAT_RDATA_HEX =
  // g_cat_motions, 0x00589A64: six rows of five s16s.
  "ff020003fa02ffffffff" + "fa02fc02fd02ffffffff" + "01030403fa02fc02fd02"
  + "03030403fd02ffffffff" + "fc02ffffffffffffffff" + "0503fc02fd02ffffffff"
  // g_cat_motion_repeats, 0x00589AA0: the same shape.
  + "feff0100feffffffffff" + "04000100feffffffffff" + "0200010001000100feff"
  + "04000100feffffffffff" + "feffffffffffffffffff" + "02000100feffffffffff";

const CAT_RDATA_BASE = 0x00589a64;

const RDATA: DataView = (() => {
  const n = CAT_RDATA_HEX.length / 2;
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    b[i] = parseInt(CAT_RDATA_HEX.slice(i * 2, i * 2 + 2), 16);
  }
  return new DataView(b.buffer);
})();

function s16(va: number): number {
  return RDATA.getInt16(va - CAT_RDATA_BASE, true);
}

/** Entries per row of both tables: the `* 5` in every index. */
export const CAT_LIST_STRIDE = 5;
/** Rows in both tables — the animation sets `CatInit` can be given. */
export const CAT_SETS = 6;

/** The clip slot that ends a row: `CatMotionListUpdate` wraps to entry 0. */
export const CAT_LIST_END = -1;
/**
 * The repeat count that never matches, so the clip loops for ever. The
 * routine tests `!= -2` before comparing, and every row that is not one
 * clip long ends on one.
 */
export const CAT_REPEAT_FOREVER = -2;

/**
 * `g_cat_motions` — `0x00589A64`, six rows of five clip ids, `-1` past a
 * row's end:
 *
 * ```
 * set 0  0x2FF 0x300 0x2FA
 * set 1  0x2FA 0x2FC 0x2FD
 * set 2  0x301 0x304 0x2FA 0x2FC 0x2FD
 * set 3  0x303 0x304 0x2FD
 * set 4  0x2FC
 * set 5  0x305 0x2FC 0x2FD
 * ```
 *
 * `CatInit` (`FUN_00431250`) seats `obj+0x1B4` from entry 0 of the spawn's
 * set, and `CatMotionListUpdate` (`FUN_00431340`) steps through the row.
 * Every id is in `nya.bin`'s bank, 762..773.
 */
export const CAT_MOTIONS: readonly number[] =
  Array.from({ length: CAT_SETS * CAT_LIST_STRIDE },
             (_u, i) => s16(0x00589a64 + i * 2));

/**
 * `g_cat_motion_repeats` — `0x00589AA0`, the same shape: how many times each
 * clip of `g_cat_motions` plays before the next, or `-2` for ever.
 *
 * ```
 * set 0  -2  1 -2
 * set 1   4  1 -2
 * set 2   2  1  1  1 -2
 * set 3   4  1 -2
 * set 4  -2
 * set 5   2  1 -2
 * ```
 */
export const CAT_MOTION_REPEATS: readonly number[] =
  Array.from({ length: CAT_SETS * CAT_LIST_STRIDE },
             (_u, i) => s16(0x00589aa0 + i * 2));

/**
 * Every clip a class-0x53 actor can play: the playlist's ids, which already
 * include the three `CatBranchTriggerUpdate` (`FUN_00431430`) names as
 * literals — 0x2FA, 0x2FD and 0x305.
 *
 * Baked for the reason `FROG_CLIPS` is: **an unbaked clip is an actor that
 * waits for ever.** `CatMotionListUpdate` leaves a clip when the model
 * counter reaches `g_motion_play_length[clip] - 1`, and with no clip in the
 * bundle that length is 0 and the counter never equals -1. Before this list
 * the exporter baked entry 0 of each spawn's set and nothing else, so `0x2FD`
 * -- the clip that runs -- was in no bundle, and the stage-2 block-11 cat could
 * at best have crept onto it and stopped.
 */
export const CAT_CLIPS: readonly number[] =
  [...new Set(CAT_MOTIONS.filter((m) => m >= 0))].sort((a, b) => a - b);

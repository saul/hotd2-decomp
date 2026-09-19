/**
 * Class 0x40's tables, transcribed from the EXE.
 *
 * Small enough that the bundle plumbing to deliver them would be larger than
 * they are — the same call `BAT_SPLINE_POINTS` makes — and kept next to the
 * routines that walk them so a reader can check both at once.
 * `tools/verify_horde.py` asserts every number here against `Hod2.exe`.
 */

/**
 * `g_horde_formation` — `0x0055E200`. `s8 {x, z}` control points, eight per
 * member, ten members per formation, five formations: offsets from the
 * placer's x and z.
 *
 * **Flat, not nested, and on purpose.** `HordeMemberUpdate` indexes it as
 * `(segment + (idx + formation * 10) * 8) * 2` and walks points `segment`,
 * `segment + 1` and `segment + 2`. Nothing stops `segment` passing 5 — a
 * formation-2 member that cannot start its dive at the end of the spline goes
 * on counting segments — and then the walk reads the **next member's** row.
 * A nested table would have to decide what that means; the flat one does what
 * the engine does.
 *
 * Rows past a formation's member count are padding: `(-1, 0), (0, 0), ...`.
 */
export const HORDE_FORMATION: readonly number[] = [
  -30, -20, -27, -16, -24, -12, -20, -12, -15, -10, -10, -5, -5, -3, 0, -6,  // formation 0 member 0
  -30, -20, -28, -16, -25, -10, -23, -5, -20, 0, -16, 5, -5, 1, -2, 4,  // formation 0 member 1
  -30, -25, -35, -12, -30, -7, -35, -2, -25, -5, -18, -8, -15, -12, -10, -8,  // formation 0 member 2
  -30, -20, -27, -16, -24, -12, -20, -12, -15, -10, -10, -5, -5, -3, 0, -6,  // formation 0 member 3
  -30, -20, -28, -16, -25, -10, -23, -5, -20, 0, -16, 5, -5, 1, -2, 4,  // formation 0 member 4
  -30, -20, -27, -16, -24, -12, -20, -12, -15, -10, -10, -5, -5, -3, 0, -6,  // formation 0 member 5
  -30, -20, -28, -16, -25, -10, -23, -5, -20, 0, -16, 5, -5, 1, -2, 4,  // formation 0 member 6
  -30, -25, -35, -12, -30, -7, -35, -2, -25, -5, -18, -8, -15, -12, -10, -8,  // formation 0 member 7
  -30, -20, -27, -16, -24, -12, -20, -12, -15, -10, -10, -5, -5, -3, 0, -6,  // formation 0 member 8
  -30, -20, -28, -16, -25, -10, -23, -5, -20, 0, -16, 5, -5, 1, -2, 4,  // formation 0 member 9
  -4, 0, -3, 5, -2, 10, -1, 15, 0, 20, 6, 25, 7, 30, 8, 35,  // formation 1 member 0
  -5, 0, -5, 5, -4, 10, -6, 15, -4, 20, -1, 25, 2, 30, 1, 35,  // formation 1 member 1
  -6, 0, -7, 5, -8, 10, -9, 15, -8, 20, -5, 25, -6, 30, -7, 35,  // formation 1 member 2
  -4, 0, -3, 5, -2, 10, -1, 15, 0, 20, 6, 25, 7, 30, 7, 35,  // formation 1 member 3
  -5, 0, -5, 5, -6, 10, -4, 15, -6, 20, 0, 25, 2, 30, 1, 35,  // formation 1 member 4
  -6, 0, -7, 5, -8, 10, -9, 15, -8, 20, -4, 25, -6, 30, -7, 35,  // formation 1 member 5
  -5, 0, -4, 5, -5, 10, -6, 15, -5, 20, 1, 25, 2, 30, 1, 35,  // formation 1 member 6
  -6, 0, -6, 5, -8, 10, -9, 15, -11, 20, -5, 25, -6, 30, -7, 35,  // formation 1 member 7
  -4, 0, -3, 5, -2, 10, -1, 15, 0, 20, 6, 25, 7, 30, 8, 35,  // formation 1 member 8
  -5, 0, -5, 5, -4, 10, -6, 15, -4, 20, -1, 25, 2, 30, 1, 35,  // formation 1 member 9
  10, -12, 7, -6, 5, -10, 0, -8, -5, -6, -10, -7, -15, -6, -20, -5,  // formation 2 member 0
  10, 10, 7, 9, 3, 8, -2, 7, -5, 5, -10, 6, -15, 7, -20, 7,  // formation 2 member 1
  14, 0, 7, 1, 3, -1, -2, 1, -5, -1, -10, 1, -15, 0, -20, 0,  // formation 2 member 2
  38, -4, 31, -2, 24, -4, 16, -4, 8, -5, -2, -3, -8, -1, -12, -2,  // formation 2 member 3
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // formation 2 member 4
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // formation 2 member 5
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // formation 2 member 6
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // formation 2 member 7
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // formation 2 member 8
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // formation 2 member 9
  -30, -14, -29, -3, -27, 0, -20, 2, -15, 4, -10, 0, -5, 0, 0, 0,  // formation 3 member 0
  -28, 24, -24, 10, -22, 6, -20, 4, -17, 4, -15, 5, -10, 5, -5, 5,  // formation 3 member 1
  -30, -14, -29, -3, -27, 0, -20, 2, -15, 4, -10, 0, -5, 0, 0, 0,  // formation 3 member 2
  -28, 24, -24, 10, -22, 6, -20, 4, -17, 4, -15, 5, -10, 5, -5, 5,  // formation 3 member 3
  -30, -14, -29, -3, -27, 0, -20, 2, -15, 4, -10, 0, -5, 0, 0, 0,  // formation 3 member 4
  -28, 24, -24, 10, -22, 6, -20, 4, -17, 4, -15, 5, -10, 5, -5, 5,  // formation 3 member 5
  -30, -14, -29, -3, -27, 0, -20, 2, -15, 4, -10, 0, -5, 0, 0, 0,  // formation 3 member 6
  -28, 24, -24, 10, -22, 6, -20, 4, -17, 4, -15, 5, -10, 5, -5, 5,  // formation 3 member 7
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // formation 3 member 8
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // formation 3 member 9
  0, 0, -1, 5, 3, 10, 5, 15, 12, 17, 15, 19, 20, 21, 25, 23,  // formation 4 member 0
  0, 0, 0, 5, 3, 9, 6, 12, 11, 15, 14, 20, 21, 21, 26, 22,  // formation 4 member 1
  0, 0, 1, 5, 4, 11, 6, 16, 11, 15, 16, 16, 20, 20, 25, 21,  // formation 4 member 2
  0, 0, -1, 5, 3, 10, 5, 15, 12, 17, 15, 19, 20, 21, 25, 23,  // formation 4 member 3
  0, 0, 0, 5, 3, 9, 6, 12, 11, 15, 14, 20, 21, 21, 26, 22,  // formation 4 member 4
  0, 0, 1, 5, 4, 11, 6, 16, 11, 15, 16, 16, 20, 20, 25, 21,  // formation 4 member 5
  0, 0, -1, 5, 3, 10, 5, 15, 12, 17, 15, 19, 20, 21, 25, 23,  // formation 4 member 6
  0, 0, 0, 5, 3, 9, 6, 12, 11, 15, 14, 20, 21, 21, 26, 22,  // formation 4 member 7
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // formation 4 member 8
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // formation 4 member 9
];

/** `g_horde_formation`'s stride: eight points of two bytes per member. */
export const HORDE_FORMATION_POINTS = 8;
/** ...and ten members per formation. */
export const HORDE_FORMATION_MEMBERS = 10;

/**
 * `g_horde_spline_rates` — `0x0055E520`, `f32 [5]`: how far along a spline
 * segment a member moves each frame, by formation. `HordeMemberInit`
 * overrides three of them per member; see `HordeMemberSplineRate`.
 */
export const HORDE_SPLINE_RATES: readonly number[] = [
  0.05, 0.05, 0.06, 0.08, 0.075,
];

/**
 * `g_horde_shot_delay` — `0x0055E534`, `s8 [5][10]`: a member walking its
 * spline cannot be killed until `obj+0x1330` reaches this. Formations 0..2
 * have no delay (`-1` or `0`).
 */
export const HORDE_SHOT_DELAY: readonly number[] = [
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  -1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  10, 8, 10, 8, 10, 8, 10, 8, 0, 0,
  22, 21, 15, 22, 21, 15, 22, 21, 0, 0,
];

/** `g_horde_wander_origin` — `0x0055E568`, `s8 {x, z} [5]`. */
export const HORDE_WANDER_ORIGIN: readonly number[] = [
  -30, 0, 0, 20, 0, 0, 0, 0, 0, 15,
];

/** `g_horde_wander_cell` — `0x0055E574`, `s8 {x, z} [5]`. */
export const HORDE_WANDER_CELL: readonly number[] = [
  6, 1, 2, 4, 4, 3, 2, 3, 2, 2,
];

/**
 * `g_submodel_bone_slots` — `0x004E1F88`, `s16 [row][10]` by bone number.
 * `SubModelStoreRestBone` (`FUN_0040EC50`) reads row `obj+0x1350`. Row 0 is
 * exactly `mol.bin`'s own skeleton slots; row 1 is the odd parts beside them,
 * the second skin formations 1 and 2 wear. Only these two rows are read.
 */
export const SUBMODEL_BONE_SLOTS: readonly (readonly number[])[] = [
  [0, 4978, 4980, 4982, 4984, 4986, 4988, 4974, 4992, 4990],
  [0, 4979, 4981, 4983, 4985, 4987, 4989, 4975, 4993, 4991],
];

/**
 * `g_emerge_prop_rim_points` — `0x00592688`, `f32 {x, y} [4]`, in the prop's
 * own frame with `z = 0`: the corners it lands on.
 */
export const EMERGE_PROP_RIM_POINTS: readonly (readonly [number, number])[] = [
  [-5.623476982116699, -3.766335964202881],
  [-5.623476982116699, 3.766335964202881],
  [5.623476982116699, -3.766335964202881],
  [5.623476982116699, 3.766335964202881],
];

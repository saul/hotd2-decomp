/**
 * A fixture with no side effects, so `tools/checks/original_mode.ts` can hold
 * it to the install without running a test.
 */
import type { OriginalModeJson } from "../../src/bundle/stage";

/**
 * `script.json`'s `original_mode` block as the exporter writes it from the
 * shipped `Hod2.exe` (`ExeTables.originalModeTables`). A fixture, and held
 * to the install by `web/tools/checks/original_mode.ts`, so a test that
 * leans on it is leaning on the exe.
 */
export const ORIGINAL_MODE: OriginalModeJson = {
  weapon_records: [
    [6, 0, 0, 3, 1], [2, 1, 1, 6, 1], [6, 2, 2, 3, 1], [3, 3, 3, 7, 4],
    [6, 0, 0, 3, Math.fround(1.2)], [6, 0, 0, 4, 1.5], [6, 0, 0, 5, 2],
    [6, 0, 4, 3, -1], [8, 0, 0, 3, 1], [10, 0, 0, 3, 1], [14, 0, 0, 3, 1],
    [-1, 0, 0, 3, 1], [12, 0, 5, 3, 1], [6, 0, 6, 3, 1], [6, 0, 7, 3, 1],
  ].map(([magazine, kind, sound, flags, damage]) =>
    ({ magazine, kind, sound, flags, damage })),
  fire_params: [
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 3, 0, 0, 1, 3, 2],
    [0, 0, 0, 0, 0, 1, 0, 2], [0, 0, 0, 0, 0, 0, 0, 4],
    ...Array.from({ length: 10 }, () => [0, 0, 0, 0, 0, 0, 0, 0]),
  ],
  ammo_hud_rows: [
    [0xa74, 0, 0], [0xa79, 5, -12], [0xa78, 0, -10], [0xa76, 20, -18],
    ...Array.from({ length: 8 }, () => [0xa74, 0, 0]),
    [0xa75, -2, 24], [0xa77, 0, -12],
  ].map(([sprite, spacing, dy]) => ({ sprite, spacing, dy })),
  item_category: [0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 4, 5, 5, 6, 6, 6, 6,
                  7, 7, 8, 8, 8, 8, 8, 8, 8, 9, 10, 11, 12],
  item_compat: [
    0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
    0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
  ],
  cursor_colours: [[1, 0, 0], [0, 0, 1]],
  list_sprites: [
    0x5f9, 0x5fa, 0x5fb, 0x5fc, 0x5fd, 0x5fe, 0x5ff, 0x600, 0x601, 0x602,
    0x603, 0x60a, 0x60b, 0x60c, 0x604, 0x605, 0x606, 0x607, 0x608, 0x609,
    0x60d, 0x60e, 0x60f, 0x610, 0x614, 0x612, 0x611, 0x615, 0x613, 0x61a,
    0x617, 0x618, 0x619,
  ],
  gunshot_ids: [0, 0x1600a9, 0xe00a9, 0xb00a9, 0xd00a9, 0x900a9, 0x600a9,
                0x1500a9],
  reload_ids: [0, 0, 0, 0xc00a9, 0, 0xa00a9, 0, 0],
};


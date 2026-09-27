/**
 * Class 0x45's `.rdata` -- every table the stage-3 boss reads, as the bytes
 * say, and the asset and sprite ids its draws name.
 *
 * A leaf on purpose: `hod2lib/bundle.ts` imports the slot and sprite lists so
 * the exporter carries what `render/` will draw, and the exporter must not
 * pull the class's behaviour in with them. Every value was read with
 * `read_memory` and decoded in `docs/re/boss-tower.md`; the address is on each.
 */

/**
 * `g_boss3_sounds_st3` -- `0x00588EA4` -- and `g_boss3_sounds_st6` --
 * `0x00588EC0`: `Boss3PlayStageSound` (`FUN_004207D0`)'s two tables,
 * `STAGE3_SE\BOSS3_n.wav` and `STAGE6_SE\BOSS3_n.wav`. Entry 0 of the stage-3
 * table is the tail of a string and is never indexed.
 */
export const BOSS3_SOUNDS_ST3: readonly number[] = [
  0, 0x241aa9, 0x251aa9, 0x261aa9, 0x271aa9, 0x281aa9, 0x281aa9, 0x2a1aa9,
];
export const BOSS3_SOUNDS_ST6: readonly number[] = [
  0, 0x3e25a9, 0x3f25a9, 0x4025a9, 0x4125a9, 0x4225a9, 0x4225a9, 0x4425a9,
];

/** `g_boss3_idle_motions_a` -- `0x00588EE0`, s16[12]. */
export const BOSS3_IDLE_MOTIONS_A: readonly number[] = [
  93, 94, 95, 96, 97, 93, 94, 95, 96, 97, 98, 0,
];
/** `g_boss3_idle_motions_b` -- `0x00588EF8`, s16[12]. */
export const BOSS3_IDLE_MOTIONS_B: readonly number[] = [
  80, 81, 82, 83, 83, 80, 81, 82, 83, 83, 84, 0,
];
/** `g_boss3l_idle_motions` -- `0x00588F10`, s16[6]. */
export const BOSS3L_IDLE_MOTIONS: readonly number[] = [67, 68, 69, 70, 71, 72];

/** One `{motion, hit frame}` pair of an attack table. */
export interface Boss3Attack { motion: number; hitFrame: number }

/** `g_boss3_attacks_a` -- `0x00588F1C`. */
export const BOSS3_ATTACKS_A: readonly Boss3Attack[] = [
  { motion: 74, hitFrame: 68 }, { motion: 75, hitFrame: 61 },
  { motion: 74, hitFrame: 68 }, { motion: 75, hitFrame: 61 },
];
/** `g_boss3_attacks_b` -- `0x00588F2C`. */
export const BOSS3_ATTACKS_B: readonly Boss3Attack[] = [
  { motion: 77, hitFrame: 70 }, { motion: 77, hitFrame: 70 },
  { motion: 78, hitFrame: 61 }, { motion: 78, hitFrame: 61 },
];
/** `g_boss3l_attacks` -- `0x00588F3C`. */
export const BOSS3L_ATTACKS: readonly Boss3Attack[] = [
  { motion: 64, hitFrame: 50 }, { motion: 64, hitFrame: 50 },
  { motion: 64, hitFrame: 50 },
];

/**
 * `g_boss3_hurt_motions` -- `0x00588F48`, s16[4]. Indexed three ways, and all
 * three are the exe's: `Boss3FightHeadInit` by **dword** stride
 * (`[EAX*4 + 0x588F48]`, so set A 99 and set B 85), the hit path by
 * `NextRand(1) + set*2`, and `Boss3FightHeadSwapIdleSet` by `NextRand(1)` or
 * `NextRand(1) + 1` -- which for set B is the window `{100, 85}` at
 * `0x00588F4A`, not `{85, 86}`.
 */
export const BOSS3_HURT_MOTIONS: readonly number[] = [99, 100, 85, 86];
/** `g_boss3_swap_motions` -- `0x00588F50`, s16[2]. */
export const BOSS3_SWAP_MOTIONS: readonly number[] = [92, 79];

/** One `{path slot, from, to}` row of a body path or camera table. */
export interface Boss3PathSeg { path: number; from: number; to: number }

/** `g_boss3_body_obj_paths_a` -- `0x00588F54`, the `op_st3` segments. */
export const BOSS3_BODY_OBJ_PATHS_A: readonly Boss3PathSeg[] = [
  { path: 354, from: -245, to: 0 }, { path: 355, from: 0, to: 180 },
  { path: 356, from: 40, to: 500 }, { path: 357, from: 330, to: 619 },
  { path: 358, from: 530, to: 870 }, { path: 359, from: 750, to: 1000 },
  { path: 360, from: 859, to: 1150 }, { path: 361, from: 1050, to: 1300 },
];
/** `g_boss3_body_obj_paths_b` -- `0x00588F84`. */
export const BOSS3_BODY_OBJ_PATHS_B: readonly Boss3PathSeg[] = [
  { path: 362, from: 0, to: 180 }, { path: 363, from: 180, to: 460 },
  { path: 364, from: 200, to: 480 }, { path: 365, from: 320, to: 619 },
  { path: 366, from: 410, to: 739 }, { path: 367, from: 600, to: 880 },
  { path: 368, from: 679, to: 1000 }, { path: 369, from: 829, to: 1100 },
  { path: 370, from: 900, to: 1000 },
];
/** `g_boss3_body_cam_paths_a` -- `0x00588FBC`, the `cp_st3` segments. */
export const BOSS3_BODY_CAM_PATHS_A: readonly Boss3PathSeg[] = [
  { path: 137, from: 0, to: 245 }, { path: 138, from: 0, to: 180 },
  { path: 139, from: 40, to: 500 }, { path: 140, from: 330, to: 619 },
  { path: 141, from: 530, to: 870 }, { path: 142, from: 750, to: 1000 },
  { path: 143, from: 859, to: 1150 }, { path: 144, from: 1050, to: 1300 },
];
/** `g_boss3_body_cam_paths_b` -- `0x00588FEC`: 150..158, the obj ranges. */
export const BOSS3_BODY_CAM_PATHS_B: readonly Boss3PathSeg[] =
  BOSS3_BODY_OBJ_PATHS_B.map((s, i) => ({ path: 150 + i, from: s.from,
                                          to: s.to }));

/** One `{start, end}` surfacing window of the body's path cursor. */
export interface Boss3BodyEvent { start: number; end: number }

/**
 * `g_boss3_body_events_a` -- `0x00589024`, `{s16 unread, start, end}[7]`. The
 * unread word holds 354..360 and no instruction reads it. The last row's end,
 * 336, is below its start: event 6 closes when the cursor has wrapped.
 */
export const BOSS3_BODY_EVENTS_A: readonly Boss3BodyEvent[] = [
  { start: 210, end: 331 }, { start: 687, end: 775 },
  { start: 1027, end: 1057 }, { start: 1327, end: 1402 },
  { start: 1554, end: 1636 }, { start: 1884, end: 1965 },
  { start: 2240, end: 336 },
];
/** `g_boss3_body_events_b` -- `0x00589050`. */
export const BOSS3_BODY_EVENTS_B: readonly Boss3BodyEvent[] = [
  { start: 320, end: 365 }, { start: 540, end: 632 },
  { start: 868, end: 965 }, { start: 1210, end: 1280 },
  { start: 1472, end: 1550 }, { start: 1825, end: 1886 },
  { start: 2019, end: 2117 },
];

/** `g_boss3_body_attack_motions_b` -- `0x0058907C`, s16[7]. */
export const BOSS3_BODY_ATTACK_MOTIONS_B: readonly number[] = [
  62, 59, 62, 62, 59, 59, 62,
];

/** One of `g_boss3_path_effects`' four 0x14-byte rows. */
export interface Boss3PathEffectRow {
  start: number;
  end: number;
  /** `+0x04` -- skipped on the path's first lap. */
  skipFirstLap: number;
  x: number; y: number; z: number;
}

/** `g_boss3_path_effects` -- `0x00589090`. */
export const BOSS3_PATH_EFFECTS: readonly Boss3PathEffectRow[] = [
  { start: 320, end: 367, skipFirstLap: 0,
    x: Math.fround(-1602), y: Math.fround(-12.4), z: Math.fround(-4006) },
  { start: 594, end: 633, skipFirstLap: 1,
    x: Math.fround(-1619.5), y: -12, z: Math.fround(-3914.3) },
  { start: 955, end: 964, skipFirstLap: 1,
    x: Math.fround(-1826.3), y: -12, z: Math.fround(-4006.7) },
  { start: 1246, end: 1278, skipFirstLap: 0,
    x: Math.fround(-1662.9), y: -12, z: Math.fround(-3975.7) },
];

/** One `{base, spread}` row of the attack-delay table. */
export interface Boss3Delay { base: number; spread: number }

/** `g_boss3_attack_delay_by_rank` -- `0x005890E0`, sixteen rows. */
export const BOSS3_ATTACK_DELAY_BY_RANK: readonly Boss3Delay[] = [
  [160, 50], [160, 40], [160, 30], [150, 40], [150, 30], [140, 30],
  [130, 30], [120, 30], [110, 30], [100, 30], [90, 30], [80, 30],
  [70, 30], [60, 30], [50, 30], [50, 20],
].map(([base, spread]) => ({ base, spread }));

/**
 * `g_boss3_card_piece_slots` -- `0x00589120`, u32[8]: `etc_2.bin[2]` for the
 * first, `etc_2.bin[3]` for the backs, and `boss3.bin[5]` for the seventh --
 * the boss's own card.
 */
export const BOSS3_CARD_PIECE_SLOTS: readonly number[] = [
  0x7ed, 0x7ee, 0x7ee, 0x7ee, 0x7ee, 0x7ee, 0x1851, 0x7ee,
];

/**
 * The two screen sprites `Boss3IntroCardUpdate` (`FUN_00424900`) fades in,
 * `SpriteDrawCheckedBank` ids `0xBC` and `0xCA`, at `(344, 96)` and
 * `(492, 96)` -- `scr_bosmater_st3` entries 0 and 1, 256x64 each. Exported
 * and looked at: `0xBC` is the gold-on-black **"TOWER"** plate and `0xCA`
 * the **"Type 8000"** line beside it -- the boss's name and number, as the
 * shared banner shows the other bosses' ("JUDGMENT / Type 28").
 */
export const BOSS3_CARD_SPRITES: readonly number[] = [0xbc, 0xca];

/** `Boss3SparkUpdate` (`FUN_004246F0`): `common.bin` cels `0xE25`..`0xE33`. */
export const BOSS3_SPARK_FIRST_SLOT = 0xe25;
export const BOSS3_SPARK_LAST_CEL = 0xe;
/** `Boss3SpawnSplashAt` (`FUN_004248B0`): the two flipbooks and their ends. */
export const BOSS3_SPLASH_KIND0_FIRST = 0x1339;
export const BOSS3_SPLASH_KIND0_END = 0x1356;
export const BOSS3_SPLASH_KIND1_FIRST = 0x94;
export const BOSS3_SPLASH_KIND1_END = 0xa2;
/** `Boss3PathEffectUpdate` (`FUN_00424E10`): `eff_boss3.bin` cels, 15 of them. */
export const BOSS3_PATH_EFFECT_FIRST_SLOT = 0x1987;
export const BOSS3_PATH_EFFECT_CELS = 15;
/** `Boss3MeshBulgeUpdate` (`FUN_00424C10`): the one model and the ten pieces. */
export const BOSS3_BULGE_SLOT = 0x1850;
export const BOSS3_BULGE_PIECE_FIRST_SLOT = 0x183e;
export const BOSS3_BULGE_PIECES = 10;
/** `Boss3DrawBoneParts` (`FUN_004219E0`): the bite flash's two flipbooks. */
export const BOSS3_FLASH_A_FIRST_SLOT = 0x97a;
export const BOSS3_FLASH_A_CELS = 0x27;
export const BOSS3_FLASH_B_FIRST_SLOT = 0x199c;
export const BOSS3_FLASH_B_CELS = 32;
/** ...and the body's wake, `car_pl.bin` cels `0x8CE + g_frame_counter % 24`. */
export const BOSS3_WAKE_FIRST_SLOT = 0x8ce;
export const BOSS3_WAKE_CELS = 24;
/** `Boss3OpeningBystanderUpdate`'s ground disc, `common.bin[200]`. */
export const BOSS3_BYSTANDER_SHADOW_SLOT = 0x10d0;

/** A run of `n` asset slots from `first`. */
function run(first: number, n: number): number[] {
  return Array.from({ length: n }, (_u, i) => first + i);
}

/**
 * Every asset slot class 0x45's draws name that is not a bone of its own
 * skeletons -- what the exporter must put in the effect template so
 * `render/` can draw them. `[port-only]` as a list; each run is the
 * routine's own.
 */
export const BOSS3_EFFECT_SLOTS: readonly number[] = [
  ...new Set([
    ...BOSS3_CARD_PIECE_SLOTS,
    ...run(BOSS3_SPARK_FIRST_SLOT, BOSS3_SPARK_LAST_CEL + 1),
    ...run(BOSS3_SPLASH_KIND0_FIRST,
           BOSS3_SPLASH_KIND0_END - BOSS3_SPLASH_KIND0_FIRST),
    ...run(BOSS3_SPLASH_KIND1_FIRST,
           BOSS3_SPLASH_KIND1_END - BOSS3_SPLASH_KIND1_FIRST),
    ...run(BOSS3_PATH_EFFECT_FIRST_SLOT, BOSS3_PATH_EFFECT_CELS),
    BOSS3_BULGE_SLOT, ...run(BOSS3_BULGE_PIECE_FIRST_SLOT, BOSS3_BULGE_PIECES),
    ...run(BOSS3_FLASH_A_FIRST_SLOT, BOSS3_FLASH_A_CELS),
    ...run(BOSS3_FLASH_B_FIRST_SLOT, BOSS3_FLASH_B_CELS),
    ...run(BOSS3_WAKE_FIRST_SLOT, BOSS3_WAKE_CELS),
    BOSS3_BYSTANDER_SHADOW_SLOT,
  ]),
];

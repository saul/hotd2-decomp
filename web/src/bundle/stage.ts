/**
 * What one stage's two JSON files add up to.
 *
 * Part of the bundle the exporter writes; see docs/formats/ for each block.
 *
 * **Declarations only.** This file is one of the sources the schema digest is
 * taken over, so anything here that is not a description of the bundle's shape
 * makes the digest move for a reason a bundle cannot be wrong about. How these
 * are fetched, and which bundles are refused, is `load.ts`.
 */

import type { CamJson } from "./cameras";
import type { StageEntry } from "./manifest";
import type { CharactersJson } from "./characters";
import type { BackdropJson, BreakablesJson, RainJson, RigsJson,
              CiviliansJson, HumanoidProgramJson, SetPieceParamsJson,
              SoundJson } from "./scene";
import type { BlockJson, ColiJson, RegionEntryJson } from "./script";
import type { BgmJson } from "./sound";

export interface ScriptJson {
  /**
   * `BUNDLE_FORMAT` at the time this file was written — see
   * {@link StageEntry.format}. Absent in a stage written before format 3.
   */
  format?: number;
  scene: number;
  stage: number | null;
  /** `g_GameMode` as the exe numbers it — see `game/game_mode.ts`. */
  game_mode: number;
  evt_file: string;
  /** {@link ScriptJson.entries}`[0]` -- the entry a fresh run gets. */
  entry_block: number;
  /** Which step of the entry block runs first; the game picks it by mode. */
  entry_step: number;
  /**
   * Every block this scene can be entered at, ascending.
   *
   * A stage does not choose where it starts; the stage *before* it does. A
   * terminal route record's `next[0]` is the block it hands the next scene,
   * `EvtAdvanceStepOrRoute` (`FUN_0045F000`) writes that into
   * `g_evt_block_index`, and nothing in the scene load touches it again.
   *
   * **Stage 3 can be entered at block 0 or block 7, and stage 4 at block 0 or
   * block 4.** Every other stage has exactly one. See {@link ScriptJson.exits}
   * for the other end of the same fact.
   */
  entries: number[];
  /**
   * Where this scene can end, and the block each ending hands the next scene.
   *
   * Only the terminal records this scene can actually reach: the shipped
   * tables carry unreachable ones too, four in stage 2 where two are live.
   */
  exits: { block: number; entry: number }[];
  routes: { kind: string; next: number[] }[];
  blocks: BlockJson[];
  regions: RegionEntryJson[][];
  cam_slots_used: number[];
  bgm?: BgmJson;
  sound?: SoundJson;
  backdrop?: BackdropJson;
  rigs?: RigsJson;
  characters?: CharactersJson;
  breakables?: BreakablesJson;
  /** Class 0x24's parameter tail, keyed by spawn address. */
  set_pieces?: Record<string, SetPieceParamsJson>;
  /** Class 0x25's decoded bytecode, keyed by spawn address. */
  humanoids?: Record<string, HumanoidProgramJson>;
  /** Class 0x10's civilians: the exe's scripts, and who runs which. */
  civilians?: CiviliansJson;
  /**
   * The screen sprites the game draws, by `DrawScreenSprite` id in decimal:
   * the in-play HUD's lives, bullets and RELOAD prompt, and the game-over
   * screen's logo and route-map tiles. Absent in a bundle written before
   * them, which draws none.
   */
  screen_sprites?: Record<string, HudSpriteImage>;
  /**
   * The game-over screen's `.rdata` -- see `ExeTables.gameOverTables` in the
   * exporter for where each field is read from.
   */
  game_over?: GameOverJson;
  /**
   * The options screen's `.rdata` -- see `ExeTables.optionsTables` in the
   * exporter. Absent in a bundle written before it, which draws the screen
   * with no text.
   */
  options?: OptionsJson;
  /**
   * `g_subtitle_glyphs` (`0x0055E054`), s16[128]: the screen sprite
   * `DrawTextCentred` (`FUN_00436850`) draws for each character code, 0 for
   * none. Absent in a bundle written before it, which draws no subtitles.
   */
  subtitle_glyphs?: number[];
  /**
   * Original Mode's `.rdata` -- the weapon records, fire and ammo-readout
   * rows, and the trunk's tables. See `ExeTables.originalModeTables` in the
   * exporter. Absent in a bundle written before it, which arms every item as
   * the bare gun and opens an empty trunk.
   */
  original_mode?: OriginalModeJson;
  /**
   * Class 0x19's `.rdata` -- the stage-4 boss's seven tables. See
   * `ExeTables.boss4Tables` in the exporter for where each is read from.
   */
  boss4?: Boss4TablesJson;
  /**
   * Class 0x2D's `.rdata` -- the stage-6 boss's tables. See
   * `ExeTables.class2dTables` in the exporter. Absent in a bundle written
   * before it, which gives the boss no waypoints to fight from.
   */
  class2d?: Class2DTablesJson;
  /**
   * `g_carrier2_door_yaw` (`0x005926D0`), s16[59]: the swing class 0x13's
   * carrier routine 2 steps its two doors through.
   */
  carrier_door_yaw?: number[];
  /**
   * The result card's `.rdata` -- see `ExeTables.resultCardTables` in the
   * exporter. Absent in a bundle written before it, which stands no figure
   * and awards no life.
   */
  result_card?: ResultCardJson;
  /**
   * The chapter card's `.rdata` -- see `ExeTables.chapterCardTables` in the
   * exporter. Absent in a bundle written before it, in which Boss Mode's card
   * draws no backdrop and holds, and app state 0x0B's draws nothing.
   */
  chapter_card?: ChapterCardJson;
  rain?: RainJson;
  /** The `coli/` blobs this scene loads — see {@link ColiJson}. */
  coli?: ColiJson;
  warnings: string[];
}

export interface StageBundle {
  entry: StageEntry;
  script: ScriptJson;
  cam: CamJson;
  geometryUrl: string;
}

/**
 * One screen sprite: its texture's size in the game's 640x480 pixels, and the
 * texture as a PNG data URL, already the right way up (the game's quad draws
 * texture row 0 at the bottom -- see `docs/formats/texbank.md`).
 */
/** One `g_boss4_held_props` record (`0x005704F8`, 0x20 bytes). */
export interface Boss4HeldPropJson {
  /** `+0x00` f32[3], the draw offset on its bone. */
  offset: number[];
  /** `+0x0C` s32 rx, ry, rz -- drawn `RotZ; RotY; RotX`. */
  rot: number[];
  /** `+0x18`..`+0x1E` s16: the bone, the throw clip, and its two frames. */
  bone: number;
  clip: number;
  take: number;
  throw: number;
}

/** One `g_boss4_camera_cues` record (`0x00570538`, 12 bytes). */
export interface Boss4CameraCueJson {
  start: number;
  end: number;
  /** f32, frames a game frame. */
  step: number;
  /** The `cp_` slot. */
  path: number;
}

/** `script.json`'s `boss4` block -- class 0x19's `.rdata`. */
/**
 * The result card's `.rdata` (`docs/re/stage-end.md`), one block for the whole
 * game, as `game_over` is.
 */
export interface ResultCardJson {
  /**
   * The address {@link bytes} starts at: `g_result_figure_records`,
   * `0x0055DD80`.
   */
  base: number;
  /**
   * `0x0055DD80..0x0055E074`, hex: the figure records, the six list
   * pointers, `g_result_figure_attachments`, the four glyph strings and
   * `g_result_life_bonus`, as one span -- because `ResultCardInstall` reads a
   * scene's records with no bound, and a scene with more rescues than records
   * reads whatever follows them.
   */
  bytes: string;
  /** `g_result_figure_lists`, `0x0055DF50`: six addresses, one per scene. */
  lists: number[];
  /** `g_accuracy_bonus_table`, `0x00567990`: s16[11]. */
  accuracy_bonus: number[];
}

/**
 * The chapter card's `.rdata`: the four tables its two variant arms index,
 * one block for the whole game, as `result_card` is. The story card itself
 * reads no table -- its sprite ids and anchor points are immediates.
 */
export interface ChapterCardJson {
  /**
   * `g_boss_mode_backdrop_sprites`, `0x0055DD50`, s16[6]: per scene, the
   * first of `BossModeChapterCardUpdate`'s twenty backdrop sprites.
   */
  boss_mode_backdrop_sprites: number[];
  /**
   * `g_boss_mode_backdrop_flags`, `0x0055DD5C`, u8[6]: per scene, the
   * `g_script_flags` index the backdrop holds until.
   */
  boss_mode_backdrop_flags: number[];
  /**
   * `g_attract11_card_frames`, `0x0055DD64`, s16[5]: the first sprite of each
   * of `AttractScene11ChapterCardUpdate`'s five 5x15-tile frames.
   */
  attract11_frames: number[];
  /**
   * `g_attract11_card_flash_frames`, `0x0055DD70`, s16[5]: the frames it
   * draws instead while its dwell is 60..72.
   */
  attract11_flash_frames: number[];
}

export interface Boss4TablesJson {
  /** `g_boss4_phase_hp_fraction`, `0x00570490`, f32[18]. */
  phase_hp_fraction: number[];
  /** `g_boss4_head_damage`, `0x005704D7`, s8[33]. */
  head_damage: number[];
  /** `g_boss4_held_props`, `0x005704F8`, two records. */
  held_props: Boss4HeldPropJson[];
  /** `g_boss4_camera_cues`, `0x00570538`, 22 records. */
  camera_cues: Boss4CameraCueJson[];
  /** `g_boss4_phase_arenas`, `0x00570640`: `[phase][6] = [x, z]`. */
  phase_arenas: number[][][];
  /** `g_boss4_head_slot_by_bar`, `0x005709A0`, s16[9]. */
  head_slot_by_bar: number[];
  /** `g_boss4_approach_picks`, `0x005709B4`: `[rank][9]`. */
  approach_picks: number[][];
}

/** One `g_class2d_path_segments` row (`0x0055D060`, 0x18 bytes). */
export interface Class2DPathSegmentJson {
  /** `+0x00` f32 -- frames of object path a game frame. */
  step: number;
  /** `+0x04` f32 -- past this frame the boss moves on to the next path. */
  advance: number;
  /** `+0x08` f32 -- the strike frame. */
  strike: number;
  /** `+0x0C` f32 -- the end frame, where the hits are counted. */
  end: number;
  /**
   * `+0x10` s16[4] -- `[0]` the glide's frames when the hits stop it, `[1]`
   * and `[2]` the hits it takes with one and with two players in play.
   */
  words: number[];
}

/**
 * `script.json`'s `class2d` block -- class 0x2D's `.rdata`, the stage-6
 * boss's tables. See `ExeTables.class2dTables` in the exporter for where each
 * is read from, and `docs/re/boss-emperor.md` for the readings.
 */
export interface Class2DTablesJson {
  /** `g_class2d_charge_arrive_dist`, `0x0055CCD4`, f32. */
  charge_arrive_dist: number;
  /** `g_class2d_hit_damage`, `0x0055CCD6`, s16[3] by `g_players_in_play`. */
  hit_damage: number[];
  /** `g_class2d_waypoints`, `0x0055CCE0`, vec3[5]. */
  waypoints: number[][];
  /** `g_class2d_attack_picks`, `0x0055CD1C`, s32[16][10] by rank. */
  attack_picks: number[][];
  /** `g_class2d_stagger_hits`, `0x0055CF9A`, s16[3] by `g_players_in_play`. */
  stagger_hits: number[];
  /** `g_class2d_charge_steps`, `0x0055CFA0`, s16[16] by rank. */
  charge_steps: number[];
  /** `g_class2d_child_kind_picks`, `0x0055CFC0`, s32[4][10]. */
  child_kind_picks: number[][];
  /** `g_class2d_path_segments`, `0x0055D060`, eight rows. */
  path_segments: Class2DPathSegmentJson[];
  /** `g_class2d_child_offsets`, `0x0055D120`, vec3[5] by kind. */
  child_offsets: number[][];
  /** `g_class2d_launch_gap`, `0x0055D1B8`, s16[16] by rank. */
  launch_gap: number[];
  /** `g_class2d_flight_frames`, `0x0055D1D8`, s16[16] by rank. */
  flight_frames: number[];
  /** `g_class2d_pair_flight_frames`, `0x0055D1F8`, s16[16] by rank. */
  pair_flight_frames: number[];
  /** `g_class2d_child0_path_start`, `0x0055D234`, s16[2]. */
  child0_path_start: number[];
  /** `g_class2d_child_bone_satellite`, `0x0055D238`, u8[16] by bone. */
  child_bone_satellite: number[];
  /** `g_class2d_child2_approach`, `0x0055D248`, s16[16] by rank. */
  child2_approach: number[];
  /** `g_class2d_child2_bone_satellite`, `0x0055D268`, u8[28] by bone. */
  child2_bone_satellite: number[];
  /** `g_class2d_child3_approach`, `0x0055D284`, s16[16] by rank. */
  child3_approach: number[];
}

/** One row of the options list: `g_options_rows[i]`'s record. */
export interface OptionsRowJson {
  /** `+0x00` s8: the column, in 16-pixel characters. */
  col: number;
  /** `+0x01` s8: the line, in 24-pixel lines. */
  row: number;
  /** `+0x04`: the label. */
  label: string;
}

/**
 * `script.json`'s `options` block -- the options screen's `.rdata`. See
 * `ExeTables.optionsTables` in the exporter for where each is read from.
 */
export interface OptionsJson {
  /** `0x005696E0`: the eleven rows, through their pointers. */
  rows: OptionsRowJson[];
  /** `0x00569758 + v*10`: "Very Easy" .. "Very Hard". */
  difficulty_labels: string[];
  /** `0x00569738 + d*2`: "0".."9". */
  digits: string[];
  /** `0x0056974C + v*6`: "  Red", "Green". */
  blood_labels: string[];
  /** `0x005971F8`: "Free Play". */
  free_play: string;
  /** `0x00597204`: "No.". */
  number: string;
  /** `0x0056AF10`, s16[96]: the glyph sprite of each character 0x20..0x7F. */
  glyphs: number[];
  /** `0x00579F58`, s16[8]: the crosshair sprite, `[setting + player*4]`. */
  crosshair_sprites: number[];
  /** `0x00569798`, stride 8: the SE test's 751 sound ids. */
  se_test: number[];
  /** `0x0056979C`, stride 8: the pack each loads first, -1 for none. */
  se_test_packs: number[];
  /** `0x005970C4`, u32[19]: the music test's sound ids. */
  music_test: number[];
  /** `0x0056AFE0`, s16[4]: the Sight Speed knobs, then its two sliders. */
  sight_speed_sprites: number[];
}

/** One row of `g_original_weapon_records` (`0x004EC928`, 8 bytes). */
export interface OriginalWeaponRecordJson {
  /** `+0`, s8: the magazine, the block's `+0x08`; -1 is the unlimited one. */
  magazine: number;
  /** `+1`, s8: the weapon kind, `+0x09`. */
  kind: number;
  /** `+2`, s8: the sound kind, `+0x0A`. */
  sound: number;
  /** `+3`, s8: the block's `+0x0B`. */
  flags: number;
  /** `+4`, f32: the damage scale, `+0x0C`; -1.0 is the doubling one. */
  damage: number;
}

/** One row of `g_original_ammo_hud_rows` (`0x004ECA20`, 12 bytes). */
export interface OriginalAmmoHudRowJson {
  /** `+0`, s16: the bullet sprite. */
  sprite: number;
  /** `+4`, f32: extra spacing between bullets. */
  spacing: number;
  /** `+8`, f32: the row's height from 364. */
  dy: number;
}

/**
 * `script.json`'s `original_mode` block -- Original Mode's `.rdata`. See
 * `ExeTables.originalModeTables` in the exporter for each table's readers.
 */
export interface OriginalModeJson {
  /** `0x004EC928`: fifteen rows, by item id + 1. */
  weapon_records: OriginalWeaponRecordJson[];
  /** `0x00579ED8`: eight bytes a fire mode, fourteen modes. */
  fire_params: number[][];
  /** `0x004ECA20`: the ammo readout's row a fire mode, fourteen. */
  ammo_hud_rows: OriginalAmmoHudRowJson[];
  /** `0x0056AFF0`: each item's category, 0..12. */
  item_category: number[];
  /** `0x0056B014`: may these two be carried together, `[cat_new*13 + cat_held]`. */
  item_compat: number[];
  /** `0x0056B0C0`: each player's cursor light colour, r g b. */
  cursor_colours: number[][];
  /** `0x0059721C`: each item's label sprite in the trunk's list. */
  list_sprites: number[];
  /** `0x004EC9A0`: the gunshot by sound kind; 0 falls back to the player's. */
  gunshot_ids: number[];
  /** `0x004EC9C0`: the reload by sound kind; 0 falls back to `RELOAD1_44`. */
  reload_ids: number[];
}

/** `script.json`'s `game_over` block. */
export interface GameOverJson {
  /** `0x00579F50`: each player's body character type. */
  body_char_types: number[];
  /** `0x004EC8A4`: the motion a body is made on. */
  body_start_motions: number[];
  /** `0x004EC8B4`: the motion it falls on in app state 7. */
  fall_motions: number[];
  /** `0x004EC8C4`: with two players, the path frame each starts falling at. */
  fall_frames: number[];
  /** `0x00579EA8`: `[x, z]` by `p - 2 + players * 2`. */
  body_offsets: number[][];
  /** `0x005679FC`: the first sprite id of each of the map's four screens. */
  route_tiles: number[];
  /** `0x00567A04`: `[stage][block][waypoint] = [x, y]`, x -1 ends a list. */
  route_waypoints: number[][][][];
  /** `0x0059351C`: `[stage][16]` blocks, -1 ending each. */
  default_route: number[][];
  /** `0x00579E98`: a body's x in the eye's frame, by `p + attackers * 2 - 2`. */
  entity_offsets: number[];
  /** `g_st1_vehicle_seat_x`, `0x004EC8D8`: by `p + players * 2`. */
  seat_x: number[];
  /** `g_player_stand_points`, `0x004EC8F0`: `[x, y, z]` by `p - 2 + players * 2`. */
  stand_points: number[][];
  /** `g_player_stand_motions`, `0x004EC91C`: by `p + players * 2`. */
  stand_motions: number[];
}

export interface HudSpriteImage {
  w: number;
  h: number;
  png: string;
}

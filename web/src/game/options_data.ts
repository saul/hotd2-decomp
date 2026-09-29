/**
 * The options screen's and the profile's constants, as data.
 *
 * A declarations-and-constants file with no import and no module-scope side
 * effect, for the reason `hud_sprites.ts` is one: `globals.ts` builds its
 * literal from the factory tables here at module load (L56 -- a leaf cannot
 * be caught half-built by an import cycle), and the exporter imports the
 * sprite lists to know which textures to put in the bundle. The code is
 * `options/` and `profile.ts`.
 *
 * The tables here are `.data` the exe **copies** (the factory reset's
 * sources) and the sprite ids it **pushes** as immediates; the `.rdata` the
 * screen reads as it draws -- its rows, labels, glyphs and sound-test lists --
 * travels in the bundle (`ExeTables.optionsTables`, `T.options`).
 * `tools/verify_options.py` holds every number here to the image.
 */

/**
 * `g_options_factory` — `0x004C42A0`, four bytes `FUN_00401130` copies: the
 * difficulty, the life setting, the credit setting and the sight graphic.
 */
export const OPTIONS_FACTORY = {
  /** `0x004C42A0`, into `g_option_difficulty`: "Normal". */
  difficulty: 2,
  /** `0x004C42A1`, into `g_option_lives`: three lives. */
  lives: 2,
  /** `0x004C42A2`, into `g_option_credits`: five continues, six credits. */
  credits: 5,
  /** `0x004C42A3`, into each player's sight graphic. */
  sightGraphic: 0,
} as const;

/** `g_sight_speed_factory` — `0x004C42A4`, f32: each player's sight speed. */
export const SIGHT_SPEED_FACTORY = 0.5;

/** `g_option_9F28_factory` — `0x004C4368`, the byte `FUN_00401130` copies. */
export const OPTION_9F28_FACTORY = 0;

/**
 * `g_input_bindings_default` — `0x004C42A8`, `u32[2][4][5]`: per player, per
 * binding set (`PlayerInputBindingSet`: gun, controller, pad kinds 1 and 2),
 * the pad masks for the trigger, the reload, the fast crosshair, the recentre
 * and a fifth word. Player 1's are player 0's shifted up 16 -- except the
 * gun's fifth, which only player 0 has. `FUN_00401130` copies all forty
 * dwords into `g_player_input_bindings`.
 */
export const INPUT_BINDINGS_DEFAULT: readonly (readonly (readonly number[])[])[] = [
  [
    [0x4, 0, 0, 0, 0x2],
    [0x4, 0x4002, 0x400, 0x8000, 0],
    [0x4, 0x2, 0x1, 0x400, 0],
    [0x4, 0x2, 0, 0, 0],
  ],
  [
    [0x40000, 0, 0, 0, 0],
    [0x40000, 0x40020000, 0x4000000, 0x80000000, 0],
    [0x40000, 0x20000, 0x10000, 0x4000000, 0],
    [0x40000, 0x20000, 0, 0, 0],
  ],
];

/**
 * `g_gun_calibration_factory` — `0x004C4348`, eight dwords `FUN_00401130`
 * copies to each player's `+0x58`: two `{s16 lo, s16 hi}` rectangles, the
 * same twice.
 */
export const GUN_CALIBRATION_FACTORY: readonly number[] = [
  0x01400000, 0x280, 0xf00000, 0x1e0, 0x01400000, 0x280, 0xf00000, 0x1e0,
];

/**
 * `g_start_lives_by_option` — `0x004D0EDC`, s16[5]: the lives each life
 * setting gives. `ProfileApplyToRun` (`FUN_0040AB50`) loads `g_start_lives`
 * from it.
 */
export const START_LIVES_BY_OPTION: readonly number[] = [1, 2, 3, 4, 5];

/**
 * The sprites the options screen pushes as immediates. Each is an index into
 * `g_screen_sprite_bank` (`0x0057A5BC`) and `g_screen_sprite_tex_slot`
 * (`0x0057D448`), named by what its texture shows, decoded and looked at.
 */
export enum OptionsSprite {
  /** "OPTIONS", 256x64, `scr_dc_option.bin`: `PUSH 0xB31` at `0x00486E21`. */
  Options = 0xb31,
  /** "EXIT", boxed, 128x64: `PUSH 0x803` at `0x004871FB`. */
  Exit = 0x803,
  /** A tilde glyph, 16x32, `scr_opt_moji01.bin`: `PUSH 0x7F2` at `0x00487E64`. */
  Tilde = 0x7f2,
  /** "1P", 32x32, `scr_common.bin`: `PUSH 0x5B9` at `0x0048767D`. */
  Tag1P = 0x5b9,
  /** "2P": `PUSH 0x5BA` at `0x0048774C`. */
  Tag2P = 0x5ba,
  /** "OPTIONS/", 256x64: `PUSH 0xB32` at `0x00488494`. */
  OptionsSlash = 0xb32,
  /** "Sight Speed", 256x64: `PUSH 0xB33` at `0x004884BB`. */
  SightSpeed = 0xb33,
  /** "(A) ...... SLOW", 256x64: `PUSH 0xA7B` at `0x004887B7`. */
  ASlow = 0xa7b,
  /** "(B) ...... FAST", 256x64: `PUSH 0xA7C` at `0x004887DE`. */
  BFast = 0xa7c,
  /**
   * "PRESS START TO ENTER YOUR SELECTION/ RETURN TO OPTIONS", 512x128:
   * `PUSH 0x829` at `0x00488808`.
   */
  PressStartToEnter = 0x829,
}

/**
 * `OptionsDrawBackground`'s three screens (`FUN_00488090`): twenty 128x128
 * tiles each, five across and four down, from these ids -- `MOV ESI, 0x7A`
 * (`scr_back2.bin`), `0xA7D` (`scr_back4.bin`) and `0x8E` (`scr_back3.bin`),
 * by the argument 0, 1, 2.
 */
export const OPTIONS_BACKGROUND_BASES: readonly number[] = [0x7a, 0xa7d, 0x8e];
/** Tiles in one background: `CMP ESI, base + 0x14`. */
export const OPTIONS_BACKGROUND_TILES = 20;

/**
 * Every sprite the options screen can draw by an immediate: the exporter's
 * list, beside the ids it reads out of the screen's own tables.
 */
export const OPTIONS_SCREEN_SPRITES: readonly number[] = [
  OptionsSprite.Options, OptionsSprite.Exit, OptionsSprite.Tilde,
  OptionsSprite.Tag1P, OptionsSprite.Tag2P, OptionsSprite.OptionsSlash,
  OptionsSprite.SightSpeed, OptionsSprite.ASlow, OptionsSprite.BFast,
  OptionsSprite.PressStartToEnter,
  ...OPTIONS_BACKGROUND_BASES.flatMap((b) =>
    Array.from({ length: OPTIONS_BACKGROUND_TILES }, (_u, i) => b + i)),
];

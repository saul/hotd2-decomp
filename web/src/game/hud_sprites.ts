/**
 * The screen sprites the in-play readouts draw, as data.
 *
 * A declarations-and-constants file with no module-scope side effect, for the
 * same reason as `class25/state.ts`: the exporter imports the id list from
 * here to know which textures to put in the bundle, and it has no business
 * pulling the engine in with it. `hud_readout.ts` is the code.
 */

/**
 * The sprite ids these routines draw, by what the texture shows. Each is an
 * index into `g_screen_sprite_bank` (`0x0057A5BC`) and
 * `g_screen_sprite_tex_slot` (`0x0057D448`); every one resolves to
 * `tex/scr_common.bin`.
 */
export enum HudSprite {
  /** Digits `0`..`9` are this plus the digit. */
  Digit0 = 0x59,
  /** The glyph after `9`; drawn beside `Times` to read "unlimited". */
  Glyph63 = 0x63,
  /** `x`. */
  Times = 0x65,
  /** "HOLD YOUR FIRE!" */
  HoldYourFire = 0x5b8,
  /** "1P" */
  Tag1P = 0x5b9,
  /** "2P" */
  Tag2P = 0x5ba,
  /** Player 1's life lamp; seven flame cels follow it. */
  Lamp1P = 0x6c2,
  /** Player 2's life lamp; seven cels. */
  Lamp2P = 0x6ca,
  /** "RELOAD", boxed. */
  Reload = 0xa27,
  /** "PRESS THE RELOAD BUTTON" -- the second line for a controller. */
  PressReloadButton = 0xa28,
  /** "SHOOT OUTSIDE OF THE SCREEN!" -- the second line for a gun. */
  ShootOutside = 0xa29,
  /** One round: the arcade bullet. */
  Bullet = 0xa74,
}

/** The seven cels of a life lamp's flame. */
export const LAMP_CELS = 7;

/**
 * `g_original_ammo_hud_rows` — `0x004ECA20`, twelve bytes per
 * `g_original_fire_mode`: `{s16 sprite; f32 extra spacing; f32 dy}`. Only
 * Original Mode reads it; rows 4..7 repeat row 0.
 */
export const ORIGINAL_AMMO_HUD_ROWS: readonly {
  sprite: number; spacing: number; dy: number;
}[] = [
  { sprite: 0xa74, spacing: 0, dy: 0 },
  { sprite: 0xa79, spacing: 5, dy: -12 },
  { sprite: 0xa78, spacing: 0, dy: -10 },
  { sprite: 0xa76, spacing: 20, dy: -18 },
];

/**
 * Every sprite id `hud_readout.ts` can draw -- the list the exporter puts in
 * the bundle.
 */
export const HUD_READOUT_SPRITES: readonly number[] = [
  ...Array.from({ length: 10 }, (_, d) => HudSprite.Digit0 + d),
  HudSprite.Glyph63, HudSprite.Times, HudSprite.HoldYourFire, HudSprite.Tag1P,
  HudSprite.Tag2P,
  ...Array.from({ length: LAMP_CELS }, (_, c) => HudSprite.Lamp1P + c),
  ...Array.from({ length: LAMP_CELS }, (_, c) => HudSprite.Lamp2P + c),
  HudSprite.Reload, HudSprite.PressReloadButton, HudSprite.ShootOutside,
  ...ORIGINAL_AMMO_HUD_ROWS.map((r) => r.sprite),
];

/**
 * The boss health bar's four sprites, as `BossHpBarUpdate` (`FUN_00435C80`)
 * pushes them. All four resolve to `tex/scr_bosmater.bin` (entries 0..3):
 * three 16x16 tiles the bar stretches along its track, and the 256x32 frame.
 */
export enum BossHpBarSprite {
  /** The hit points the bar shows, `PUSH 0xB5` at `0x00435E0B`. */
  Fill = 0xb5,
  /** The empty track past the trail, `PUSH 0xB6` at `0x00435D87`. */
  Empty = 0xb6,
  /** The hit points just lost, draining, `PUSH 0xB7` at `0x00435DD0`. */
  Trail = 0xb7,
  /** The frame, `PUSH 0xB8` at `0x00435E32`. */
  Frame = 0xb8,
}

/** Every sprite `BossHpBarUpdate` can draw -- the exporter's list. */
export const BOSS_HP_BAR_SPRITES: readonly number[] = [
  BossHpBarSprite.Fill, BossHpBarSprite.Empty, BossHpBarSprite.Trail,
  BossHpBarSprite.Frame,
];

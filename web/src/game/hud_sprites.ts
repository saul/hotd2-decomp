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
 * Every sprite id `hud_readout.ts` can draw -- the list the exporter puts in
 * the bundle. Original Mode's other bullets are not here: they are
 * `original_mode.ammo_hud_rows`' sprites, `.rdata` the exporter reads for an
 * Original stage (see `ExeTables.originalModeTables`). **The Arcade bullet
 * is**, and has to be named here: it is that table's row 0 as well, and while
 * it came into the bundle only through the table, every Arcade stage shipped
 * without it and drew no bullets at all.
 */
export const HUD_READOUT_SPRITES: readonly number[] = [
  HudSprite.Bullet,
  ...Array.from({ length: 10 }, (_, d) => HudSprite.Digit0 + d),
  HudSprite.Glyph63, HudSprite.Times, HudSprite.HoldYourFire, HudSprite.Tag1P,
  HudSprite.Tag2P,
  ...Array.from({ length: LAMP_CELS }, (_, c) => HudSprite.Lamp1P + c),
  ...Array.from({ length: LAMP_CELS }, (_, c) => HudSprite.Lamp2P + c),
  HudSprite.Reload, HudSprite.PressReloadButton, HudSprite.ShootOutside,
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

/**
 * The sprites of the continue screen and of the credit line under it, as
 * the routines in `continue_readout.ts`, `credit_prompt.ts` and
 * `RunPhaseContinueCountdown` (`FUN_00460530`) push them. Every one resolves
 * to `tex/scr_common.bin` -- the bank `hud_readout.ts`'s sprites are in -- and
 * each is named for what its texture shows, decoded and looked at.
 */
export enum ContinueSprite {
  /** "CONTINUE?", 512x64. `PUSH 0x22C` at `0x00460617` and `0x004168A6`. */
  Continue = 0x22c,
  /**
   * The countdown's digits `0`..`9`, 64x128 each, are this plus the digit:
   * `ADD EAX, 0x4F` at `0x0046064A` and `ADD ECX, 0x4F` at `0x004168F0`.
   * Not {@link HudSprite.Digit0}'s 16x32 set, which the credit count uses.
   */
  BigDigit0 = 0x4f,
  /** "CREDIT(S)", 128x32: `g_credit_count_layout[0]`. */
  Credits = 0x22e,
  /** "FREE PLAY", 128x32: `g_credit_count_layout[1]`. */
  FreePlay = 0x332,
  /** "GAME OVER", 512x64: `PUSH 0x43E` at `0x00416924`. */
  GameOver = 0x43e,
  /** "INSERT COIN(S)", 256x32: `g_credit_prompt_messages[0]`. */
  InsertCoins = 0x5bb,
  /** "INSERT MORE COIN(S)", 256x32: `g_credit_prompt_messages[1]`. */
  InsertMoreCoins = 0x5bc,
  /** "PRESS START BUTTON", 128x16: `g_credit_prompt_messages[3]`. */
  PressStart = 0x8ff,
  /**
   * "PRESS START BUTTON", 512x32, the attract screens' larger copy:
   * `MOV [0x005A4CE8], 0x900` at `0x00406842`, in `CreditBlinkTick`.
   */
  PressStartAttract = 0x900,
}

/** One row of `g_credit_prompt_messages`, or of `g_credit_count_layout`. */
export interface CreditPromptRow {
  /** Added to the line's x and y. */
  dx: number;
  dy: number;
  /** Both of the record's scales. */
  scale: number;
  /** The sprite id; 0 in rows whose id is not read. */
  id: number;
}

/**
 * `g_credit_prompt_messages` — `0x004C4B10`, four `{f32 dx, f32 dy, f32
 * scale, u32 id}` indexed by `CreditPromptMessageIndex`: no credit, not
 * enough, the caption-mode blink (a row whose id is 0 and which no call can
 * reach -- see `CreditPromptMessageIndex`), and enough. `[proved]` read out of
 * the image; `web/tools/checks/continue_screen.ts` reads it again.
 */
export const CREDIT_PROMPT_MESSAGES: readonly CreditPromptRow[] = [
  { dx: 24, dy: 0, scale: 0.85, id: ContinueSprite.InsertCoins },
  { dx: 0, dy: 0, scale: 0.85, id: ContinueSprite.InsertMoreCoins },
  { dx: 0, dy: 0, scale: 0.85, id: 0 },
  { dx: -8, dy: 0, scale: 1.4, id: ContinueSprite.PressStart },
];

/**
 * `g_credit_count_layout` — `0x004C4A40`, the same record shape, read by
 * `CreditPromptDrawCount` (`FUN_00406920`) at its own fixed offsets: row 0
 * "CREDIT(S)" and row 1 "FREE PLAY" whole; rows 2 and 3 only for their dx,
 * the step to the tens digit and on to the units. `[proved]`
 */
export const CREDIT_COUNT_LAYOUT: readonly CreditPromptRow[] = [
  { dx: 32, dy: 15, scale: 0.85, id: ContinueSprite.Credits },
  { dx: 34, dy: 15, scale: 0.85, id: ContinueSprite.FreePlay },
  { dx: 82, dy: 0, scale: 0.85, id: 0 },
  { dx: 12, dy: 0, scale: 0.85, id: 0 },
];

/**
 * Every sprite the continue screen, the player's GAME OVER and the credit
 * line can draw -- the exporter's list. The credit count's digits are
 * {@link HudSprite.Digit0}'s, already in {@link HUD_READOUT_SPRITES}.
 */
export const CONTINUE_SCREEN_SPRITES: readonly number[] = [
  ContinueSprite.Continue,
  ...Array.from({ length: 10 }, (_, d) => ContinueSprite.BigDigit0 + d),
  ContinueSprite.Credits, ContinueSprite.FreePlay, ContinueSprite.GameOver,
  ContinueSprite.InsertCoins, ContinueSprite.InsertMoreCoins,
  ContinueSprite.PressStart, ContinueSprite.PressStartAttract,
];

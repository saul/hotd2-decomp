/**
 * The credit line: "PRESS START BUTTON" (or "INSERT COIN(S)") over
 * "CREDIT(S) 5", blinking, in a player's corner of the screen.
 *
 * Two routines ask for it, and both through `CreditPromptDraw`:
 *
 * * `PlayerContinueCountdown` (`FUN_00414280`), every frame a player is on
 *   their continue -- so it is under the run's CONTINUE? too.
 * * `PlayerPollStart` (`FUN_00414600`), every frame a player is out (state 9)
 *   in app state 6 while `g_screen_furniture_flags` bit 1 is up -- which is
 *   player 2's corner for the whole of a one-player game.
 *
 * `CreditBlinkTick` (`FUN_004067D0`), at the end of every
 * `AppStateDispatch`, steps the clock the blink reads.
 *
 * What is drawn is `SpriteDrawCheckedBank` (`FUN_0041C630`) on one static
 * record at `0x005A4CE8`, `g_credit_prompt_sprite`, which the routines here
 * rewrite field by field before each draw: id, x, y and the two scales. The
 * rest is what `CreditsBootReset` (`FUN_004066D0`) seeds at boot and nothing
 * rewrites -- depth `0x3F7FF972`, UVs 0..1, alpha 1.0, flags 5 -- so each
 * draw is recorded here as a whole `ScreenSprite` with those words in it.
 * Flags 5 is anchor `(1, 1)`: `(x, y)` is the top-left. `[proved]`
 *
 * All of it is recorded into `G.g_screen_sprite_draws`, like every screen
 * sprite, and `hud/` draws the list.
 */
import { AppState, G } from "./globals";
import { CAPTION_MODE, CAPTION_MODE_CAPTIONED } from "./caption_mode";
import { CreditCount, CreditTiersUpdate } from "./credits";
import { GameMode } from "./game_mode";
import {
  CREDIT_COUNT_LAYOUT, CREDIT_PROMPT_MESSAGES, ContinueSprite, HudSprite,
} from "./hud_sprites";
import { PlayerState } from "./player_state";
import type { ScreenSprite } from "./screen_sprite";

/**
 * `g_credit_prompt_sprite`'s depth, `0x3F7FF972`, as `CreditsBootReset`
 * (`FUN_004066D0`) seeds it.
 */
export const CREDIT_PROMPT_DEPTH = Math.fround(0.9999);
/** ...and its flags word, 5: anchor `(1, 1)`, the top-left. */
export const CREDIT_PROMPT_FLAGS = 5;

/**
 * `g_credit_prompt_pos` — `0x00577620`, `{f32 x, f32 y}` per player: where
 * each player's line starts. `[proved]`
 */
export const CREDIT_PROMPT_POS: readonly { x: number; y: number }[] = [
  { x: 50, y: 412 },
  { x: 392, y: 412 },
];

/**
 * `g_credit_prompt_drawers` — `0x00577640`, three routines `CreditPromptDraw`
 * picks between by what a spend costs. Only the first is reached in this
 * build: `g_credits_to_start` and `g_credits_to_continue` are written by
 * `CreditsBootReset` (`FUN_004066D0`) alone (`0x004066D7`, `0x004066DC`),
 * both 1, so neither "costs more than one" arm ever selects entry 1
 * (`0x00406AA0`) or entry 2 (`0x00406BC0`). `[proved]` from every writer of
 * the two words.
 */
export enum CreditPromptDrawer {
  /** `CreditPromptDrawSingle` (`FUN_00406860`). */
  Single = 0,
  /** `0x00406AA0`, a start costing more than one credit. Unreached. */
  StartCostsMore = 1,
  /** `0x00406BC0`, a continue costing more than one. Unreached. */
  ContinueCostsMore = 2,
}

/**
 * `CreditPromptMessageIndex` — `FUN_00406D60`. Which row of
 * `g_credit_prompt_messages` the line shows, from the prompted player's
 * credit tier (`CreditTiersUpdate`): 0 "INSERT COIN(S)" at no credit, 1
 * "INSERT MORE COIN(S)" at not enough, 3 "PRESS START BUTTON" at enough and
 * in free play. With a non-zero argument, caption mode 1 and bit 6 of the
 * blink clock it answers 2 instead of 1 -- but its only caller passes 0.
 */
export function CreditPromptMessageIndex(blinkArm: number): number {
  const tier = G.g_free_play === 1
    ? 2 : G.g_credit_tier[G.g_credit_prompt_player] ?? 0;
  if (tier === 0) return 0;
  if (tier === 1) {
    if (blinkArm !== 0 && CAPTION_MODE === CAPTION_MODE_CAPTIONED
        && (G.g_credit_blink_clock & 0x40) !== 0) return 2;
    return 1;
  }
  if (tier === 2) return 3;
  return blinkArm;
}

/** One draw off `g_credit_prompt_sprite`. `[port-only]` as a function. */
function CreditPromptSprite(id: number, x: number, y: number,
                            scale: number): ScreenSprite {
  return { id, x, y, depth: CREDIT_PROMPT_DEPTH, sx: scale, sy: scale,
           alpha: 1, flags: CREDIT_PROMPT_FLAGS };
}

/**
 * `CreditPromptDrawCount` — `FUN_00406920`. Under the message, at the line's
 * `(x, y)` as whole pixels: "FREE PLAY" in free play; otherwise "CREDIT(S)",
 * then the count's tens digit if it is not 0 and its units, 82 and 94 pixels
 * on, in the 16x32 digits at the record's 0.85. `[proved]`
 */
export function CreditPromptDrawCount(x: number, y: number,
                                      player: number): void {
  const count = CreditCount(player);
  const draws = G.g_screen_sprite_draws;
  if (G.g_free_play === 1) {
    const r = CREDIT_COUNT_LAYOUT[1];
    draws.push(CreditPromptSprite(r.id, x + r.dx, y + r.dy, r.scale));
    return;
  }
  const r = CREDIT_COUNT_LAYOUT[0];
  let cx = x + r.dx;
  const cy = y + r.dy;
  draws.push(CreditPromptSprite(r.id, cx, cy, r.scale));
  // `IMUL 0x66666667; SAR 2`: count / 10, toward zero, then `% 10`.
  const tens = Math.trunc(count / 10) % 10;
  cx += CREDIT_COUNT_LAYOUT[2].dx;
  if (tens !== 0) {
    draws.push(CreditPromptSprite(tens + HudSprite.Digit0, cx, cy, r.scale));
  }
  cx += CREDIT_COUNT_LAYOUT[3].dx;
  draws.push(CreditPromptSprite(count % 10 + HudSprite.Digit0, cx, cy,
                                r.scale));
}

/**
 * `CreditPromptDrawMessage` — `FUN_004068A0`. The message row
 * `CreditPromptMessageIndex(0)` names, at `(x + dx, y + dy)` and its own
 * scale, then the count at `(x, y)` truncated to whole pixels (two
 * `__ftol`s). `[proved]`
 */
export function CreditPromptDrawMessage(x: number, y: number,
                                        player: number): void {
  const row = CREDIT_PROMPT_MESSAGES[CreditPromptMessageIndex(0)];
  G.g_screen_sprite_draws.push(
    CreditPromptSprite(row.id, x + row.dx, y + row.dy, row.scale));
  CreditPromptDrawCount(Math.trunc(x), Math.trunc(y), player);
}

/**
 * `CreditPromptDrawSingle` — `FUN_00406860`, `g_credit_prompt_drawers[0]`.
 * The line at the player's `g_credit_prompt_pos`, except while
 * `(g_credit_blink_clock >> 5) % 3 == 2`: 64 frames on, 32 off. `[proved]`
 */
export function CreditPromptDrawSingle(player: number): void {
  if (((G.g_credit_blink_clock >> 5) % 3) === 2) return;
  const p = CREDIT_PROMPT_POS[player];
  CreditPromptDrawMessage(p.x, p.y, player);
}

/**
 * `CreditPromptDraw` — `FUN_00406CE0`. Nothing in app state 6 in Training
 * or Boss mode. Otherwise: whose tier to read (`g_credit_prompt_player`, the
 * player when counts are per player), which drawer -- by whether the spend
 * this player would make, a continue at state 4 and a start otherwise, costs
 * more than one credit, and entry 0 in free play -- and that drawer. Its
 * callers push a second argument that it never reads. `[proved]`
 */
export function CreditPromptDraw(player: number): void {
  if (G.g_app_state === AppState.InPlay
      && G.g_GameMode >= GameMode.Training
      && G.g_GameMode <= GameMode.Boss) return;
  G.g_credit_prompt_player = G.g_credits_per_player !== 0 ? player : 0;
  let drawer: CreditPromptDrawer;
  if (G.g_player_state[player] === PlayerState.Continue) {
    drawer = G.g_credits_to_continue > 1
      ? CreditPromptDrawer.ContinueCostsMore : CreditPromptDrawer.Single;
  } else {
    drawer = G.g_credits_to_start > 1
      ? CreditPromptDrawer.StartCostsMore : CreditPromptDrawer.Single;
  }
  if (G.g_free_play === 1) drawer = CreditPromptDrawer.Single;
  // Entries 1 and 2 cannot be selected in this build (see the enum); there
  // is nothing of theirs to run.
  if (drawer === CreditPromptDrawer.Single) CreditPromptDrawSingle(player);
}

/**
 * `g_app_state_press_start` — `0x004C4B90`, four bytes an app state, of
 * which `CreditBlinkTick` reads the first s16: the screens that show the
 * attract PRESS START. 3, 5 and 9..11 -- the pre-title screen, the attract
 * demo and its three scenes; never 6 or 7. `[proved]`
 */
export const APP_STATE_PRESS_START: readonly number[] = [
  0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0,
];

/**
 * `CreditBlinkTick` — `FUN_004067D0`, the last call of every
 * `AppStateDispatch` (`FUN_004608A0`). The blink clock takes the frames
 * `g_input_frame` has moved since it last looked -- one a frame -- and on
 * the screens `g_app_state_press_start` marks, from their fourth frame and on
 * the half of every 64 where bit 5 is clear, "PRESS START BUTTON" `0x900` at
 * `(160, 334)`, scale 1. `[proved]`
 */
export function CreditBlinkTick(): void {
  const seen = G.g_credit_blink_seen;
  G.g_credit_blink_seen = G.g_input_frame;
  G.g_credit_blink_clock = (G.g_credit_blink_clock
    + (G.g_input_frame - seen)) | 0;
  if ((APP_STATE_PRESS_START[G.g_app_state] ?? 0) === 0) return;
  // `CMP [0x009A5C44], 4; JC` -- unsigned.
  if ((G.g_screen_frames >>> 0) < 4) return;
  if ((G.g_credit_blink_clock & 0x20) !== 0) return;
  G.g_screen_sprite_draws.push(
    CreditPromptSprite(ContinueSprite.PressStartAttract, 160, 334, 1));
}

/**
 * `[port-only]` -- the half of `InputReadFrame` (`FUN_0040D590`) the port
 * has: `g_input_frame` up one and `CreditTiersUpdate`. The pad read and the
 * gun poll between them are the page's -- a pull is a shot request, START a
 * pad bit -- and `GameUpdate` calls this where `GameFrameTick`
 * (`FUN_0040E730`) reads the input: ahead of any screen, so the tiers a spend
 * left behind are fresh when the credit line reads them.
 */
export function InputReadFrameCounters(ticks: number): void {
  G.g_input_frame = (G.g_input_frame + ticks) | 0;
  CreditTiersUpdate();
}

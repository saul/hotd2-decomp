/**
 * What a player's own task draws when it is not in play: the small CONTINUE?
 * and its digit, the small GAME OVER, and -- behind a code nobody can enter
 * in the port -- the score. And the crosshair's decision: the in-play task
 * draws it and the continue does not, which is the other half of what the
 * continue screen looks like.
 *
 * The run's own CONTINUE?, the large one a one-player game shows, is not
 * here: `RunPhaseContinueCountdown` (`FUN_00460530`) draws it itself, and
 * while it does (run phase 4) the per-player countdown draws neither of its
 * own. So this file's CONTINUE? is the two-player one -- one player continuing
 * in their half of the screen while the other plays on.
 *
 * ```
 *                         x          y     scale        how
 * CONTINUE?  0x22C     48 / 368     170   0.6 x 0.8   layered, layer 2
 * digit      0x4F+d   260 / 580     160   0.6 x 0.8   layered, layer 2
 * GAME OVER  0x43E     45 / 365     170   0.6 x 0.7   direct
 * ```
 *
 * `[proved]` from the pushes; `tools/verify_continue.py` reads them again.
 */
import { AppState, G } from "./globals";
import { ContinueSprite, HudSprite } from "./hud_sprites";
import { DrawScreenSprite, DrawScreenSpriteLayered } from "./screen_sprite";

/** `g_continue_prompt_x` — `0x00579F68`, f32 per player. */
export const CONTINUE_PROMPT_X: readonly number[] = [48, 368];
/** The small CONTINUE?'s y, `PUSH 0x432A0000` at `0x004168A0`. */
export const CONTINUE_PROMPT_Y = 170;
/** Its digit sits this far right of it: `FADD [0x004ECB6C]` at `0x004168D1`. */
export const CONTINUE_DIGIT_DX = 212;
/** ...and at this y, `PUSH 0x43200000` at `0x004168E6`. */
export const CONTINUE_DIGIT_Y = 160;
/** Both scale to 0.6 by 0.8: `PUSH 0x3F19999A`, `PUSH 0x3F4CCCCD`. */
export const CONTINUE_PROMPT_SX = Math.fround(0.6);
export const CONTINUE_PROMPT_SY = Math.fround(0.8);
/** The queue layer both are pushed on, `PUSH 0x2`. */
export const CONTINUE_PROMPT_LAYER = 2;

/** `g_player_game_over_x` — `0x00579F70`, f32 per player. */
export const PLAYER_GAME_OVER_X: readonly number[] = [45, 365];
/** The small GAME OVER's y, `PUSH 0x432A0000` at `0x0041691E`. */
export const PLAYER_GAME_OVER_Y = 170;
/** ...and its scale, 0.6 by 0.7: `PUSH 0x3F19999A`, `PUSH 0x3F333333`. */
export const PLAYER_GAME_OVER_SX = Math.fround(0.6);
export const PLAYER_GAME_OVER_SY = Math.fround(0.7);

/**
 * `HudDrawContinuePrompt` — `FUN_00416880`. The small "CONTINUE?" in the
 * player's half, through the layered queue. `[proved]`
 */
export function HudDrawContinuePrompt(player: number): void {
  DrawScreenSpriteLayered(ContinueSprite.Continue, CONTINUE_PROMPT_X[player],
                          CONTINUE_PROMPT_Y, 1, CONTINUE_PROMPT_SX,
                          CONTINUE_PROMPT_SY, 0, CONTINUE_PROMPT_LAYER);
}

/**
 * `HudDrawContinueDigit` — `FUN_004168C0`. The countdown's digit beside it,
 * sprite `0x4F + digit`. `[proved]`
 */
export function HudDrawContinueDigit(player: number, digit: number): void {
  DrawScreenSpriteLayered(ContinueSprite.BigDigit0 + digit,
                          Math.fround(CONTINUE_PROMPT_X[player]
                                      + CONTINUE_DIGIT_DX),
                          CONTINUE_DIGIT_Y, 1, CONTINUE_PROMPT_SX,
                          CONTINUE_PROMPT_SY, 0, CONTINUE_PROMPT_LAYER);
}

/**
 * `HudDrawPlayerGameOver` — `FUN_00416900`. The small "GAME OVER" in the
 * player's half, drawn directly: by `PlayerStateArmGameOver` and by every
 * frame of `PlayerGameOverWait`'s 120 but the last, outside the game-over
 * screen. `[proved]`
 */
export function HudDrawPlayerGameOver(player: number): void {
  DrawScreenSprite(ContinueSprite.GameOver, PLAYER_GAME_OVER_X[player],
                   PLAYER_GAME_OVER_Y, 1, PLAYER_GAME_OVER_SX,
                   PLAYER_GAME_OVER_SY, 0);
}

/** `g_score_cheat`'s value while the code has been entered. */
export const SCORE_CHEAT_ON = 7;
/** Where each player's score starts: `PUSH 0x42A00000` / `0x43F40000`. */
export const SCORE_CHEAT_X: readonly number[] = [80, 488];
/** ...and its y, `PUSH 0x42100000` at `0x00413FC6`. */
export const SCORE_CHEAT_Y = 36;
/** The score's digits sit this far apart: `FADD [0x004D1D20]`. */
export const SCORE_DIGIT_STEP = 12;
/** The score record's depth, `0x3F7D70A4`. */
export const SCORE_DIGIT_DEPTH = Math.fround(0.99);

/**
 * `HudDrawScoreDigits` — `FUN_00413FF0`. A player's score in the 16x32
 * digits, leading zeroes dropped, six digits at most, from `(x, y)` rightward
 * 12 pixels a digit; a record of its own at depth 0.99, scale 1, flags 0.
 *
 * Its words `+0x20`/`+0x24` are 0 where every other screen sprite's are 1.0
 * -- if they are the UV extent, as `DrawScreenSprite`'s 0..1 suggests, the
 * quad samples one texel. The port's record carries no UVs, so it would draw
 * the whole digit; what the exe shows is `[open]`, and nothing the port runs
 * can reach the call (see `g_score_cheat`).
 */
export function HudDrawScoreDigits(player: number, x: number,
                                   y: number): void {
  const score = G.g_player_score[player];
  const draw = (id: number, at: number) =>
    G.g_screen_sprite_draws.push({ id, x: at, y, depth: SCORE_DIGIT_DEPTH,
                                   sx: 1, sy: 1, alpha: 1, flags: 0 });
  let cx = x;
  // Each place is drawn once the score reaches it, and every place after the
  // first is 12 pixels on from the one before.
  if (score > 99999) {
    draw(HudSprite.Digit0 + Math.trunc(score / 100000) % 10, cx);
  }
  for (const div of [10000, 1000, 100, 10]) {
    if (score > div - 1) {
      cx = Math.fround(cx + SCORE_DIGIT_STEP);
      draw(HudSprite.Digit0 + Math.trunc(score / div) % 10, cx);
    }
  }
  cx = Math.fround(cx + SCORE_DIGIT_STEP);
  draw(HudSprite.Digit0 + score % 10, cx);
}

/**
 * `HudDrawScoreCheat` — `FUN_00413FB0`. In app state 6 with `g_score_cheat`
 * at 7, the player's score top left or top right. Called at the end of
 * `PlayerUpdateInPlay` and from `PlayerContinueCountdown`. `[proved]`
 */
export function HudDrawScoreCheat(player: number): void {
  if (G.g_score_cheat !== SCORE_CHEAT_ON
      || G.g_app_state !== AppState.InPlay) return;
  // `TEST EAX, EAX; JNZ`: any player but 0 is drawn as player 1.
  const p = player === 0 ? 0 : 1;
  HudDrawScoreDigits(p, SCORE_CHEAT_X[p], SCORE_CHEAT_Y);
}

/** `GetPlayerInputModes`' answers that make `HudDrawCrosshair` draw at once. */
const CROSSHAIR_MOUSE_MODES: readonly number[] = [5, 6];

/**
 * `HudDrawCrosshair` — `FUN_004169C0`, the decision half. The engine draws
 * the crosshair sprite when all of: app state 6; a gun whose aim is on the
 * screen, or input mode 5 or 6 (the mouse); a life; and the firing gate up.
 * It is called only from `PlayerUpdateInPlay`, so a player on the continue or
 * out of the game has none.
 *
 * `[port-only]` in what it draws: the reticle is the page's, following the
 * pointer between ticks, so the decision is recorded in
 * `G.g_crosshair_drawn` and the sprite (`0x00579F58` by binding set) and
 * its position (`FUN_0041E280`, the mouse) are left to it.
 */
export function HudDrawCrosshair(player: number): void {
  const mode = G.g_input_mode[player] ?? 0;
  const mouse = CROSSHAIR_MOUSE_MODES.includes(mode);
  if (G.g_app_state === AppState.InPlay
      && ((G.g_player_input_is_gun[player] !== 1
           && G.g_aim_on_screen[player] !== 0) || mouse)
      && G.g_player_lives[player] > 0 && G.g_nFiringGate !== 0) {
    G.g_crosshair_drawn[player] = 1;
  }
}

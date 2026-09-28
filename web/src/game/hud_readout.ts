/**
 * The in-play readouts: the bullets left, the RELOAD prompt, and the lives.
 *
 * Both are called from the HUD branch of `PlayerUpdateInPlay`
 * (`FUN_00413E90`), which runs only for a player with a life and outside the
 * attract screens (app states 5 and 9):
 *
 * ```
 * if (g_nFiringGate) HudDrawAmmoAndReloadPrompt(task);   FUN_004177D0
 * HudDrawLives(task);                                    FUN_004174A0
 * ```
 *
 * They are draw routines that also keep state -- the RELOAD prompt's timer,
 * the readout's slide-in counter, the "RELOAD!" voice -- so they are the
 * engine's and live here. What they draw goes through {@link DrawScreenSprite}
 * into `G.g_screen_sprite_draws`, and `hud/` puts those on the screen; it decides
 * nothing.
 *
 * ## The screen they draw on
 *
 * `DrawScreenSprite` (`FUN_0041C6D0`) takes the **top-left** corner in the
 * 640x480 screen, y down, and draws the texture at `width * sx` by
 * `height * sy` pixels (`DrawSpriteQuadCommand`, `FUN_004A7AB0`, and its
 * corner table `g_sprite_quad_corners`). Every sprite here is a texture of
 * `tex/scr_common.bin`; the bundle carries them as images, already turned the
 * right way up (see `docs/formats/texbank.md`).
 *
 * ## When they are hidden
 *
 * * The bullets and the prompt: only while the firing gate is up, and then
 *   only in shutter state 2 (open) or 1 (opening, when the bullets grow from
 *   1.5x down to 1x over 40 frames). So a cutscene takes them away.
 * * The lives: only in shutter state 2. In state 4 -- the letterbox shut --
 *   the same routine blinks "HOLD YOUR FIRE!" instead, unless a result card
 *   has the screen (`g_screen_furniture_flags` bit `0x10`).
 * * Neither for a player out of lives: the continue countdown has its own
 *   screen, which the port does not draw.
 */
import type { Events } from "../core/events";
import { GameMode } from "./game_mode";
import { G, ScreenFurniture } from "./globals";
import { HudSprite, LAMP_CELS, ORIGINAL_AMMO_HUD_ROWS } from "./hud_sprites";
import { DrawScreenSprite } from "./screen_sprite";

/** `ETC\vo_RELOAD_16.wav` -- the dry trigger's voice. */
export const RELOAD_VOICE = 0x000115a9;
/** `ETC\vo_SHOOT_16.wav` -- the same, to a gun, after 120 frames. */
export const SHOOT_VOICE = 0x000215a9;

/** Frames before the RELOAD prompt's second line, and the voice change. */
export const RELOAD_PROMPT_SECOND_LINE = 120;

/**
 * The magazine readout, at scale `s` -- one arm of
 * `HudDrawAmmoAndReloadPrompt`, which writes it out twice, once for each
 * shutter state it draws in. `[port-only]` as a function.
 */
function DrawAmmoReadout(player: number, s: number): void {
  const original = G.g_GameMode === GameMode.Original;
  const row = original
    ? ORIGINAL_AMMO_HUD_ROWS[G.g_original_fire_mode[player]]
      ?? ORIGINAL_AMMO_HUD_ROWS[0]
    : ORIGINAL_AMMO_HUD_ROWS[0];
  const ammo = G.g_player_ammo[player];
  const y = row.dy + 364;
  // Player 1 counts rightwards from 24; player 2 leftwards from 592. The
  // Original readouts sit at 24/36/48/60 and 568/580/592/604.
  const left = player === 0;
  const bx = left ? 24 : 568;
  if (original) {
    if (G.g_player_magazine_size[player] === -1) {
      DrawScreenSprite(row.sprite, bx, y, 1, s, s);
      DrawScreenSprite(HudSprite.Times, bx + 12, 372, 0.98, s, s);
      DrawScreenSprite(HudSprite.Glyph63, bx + 26, 373, 0.98, s, s);
      return;
    }
    if (ammo >= 7) {
      DrawScreenSprite(row.sprite, bx, y, 1, s, s);
      DrawScreenSprite(HudSprite.Times, bx + 12, 372, 0.98, s, s);
      DrawScreenSprite(HudSprite.Digit0 + Math.trunc(ammo / 10), bx + 24, 372,
                       0.98, s, s);
      DrawScreenSprite(HudSprite.Digit0 + ammo % 10, bx + 36, 372, 0.98, s, s);
      return;
    }
  }
  for (let i = 0; i < ammo; i++) {
    const step = i * (row.spacing + 24) * s;
    DrawScreenSprite(row.sprite, left ? step + 24 : 592 - step, y, 1, s, s);
  }
}

/**
 * `HudDrawAmmoAndReloadPrompt` — `FUN_004177D0`. One player's bullets, and
 * the RELOAD prompt while the gun is empty.
 *
 * The bullets are drawn in shutter state 2 at their own size, and in state 1
 * -- the letterbox opening -- at `(40 - g_hud_ammo_slide) * 0.0125 + 1`,
 * the slide counting up a frame at a time; any other state resets the count
 * and draws nothing at all, prompt included.
 *
 * The prompt needs the empty latch and the gate (tested again, at
 * `0x00418001`): "RELOAD" on the first 45 of every 60 frames of the prompt's
 * timer, and from the 120th frame a second line under it -- "SHOOT OUTSIDE OF
 * THE SCREEN!" for a gun, "PRESS THE RELOAD BUTTON" for a controller. A pull
 * with the aim on the screen while it is up plays the "RELOAD!" voice, or
 * "SHOOT" for a gun past 120 frames. The timer steps once a call and folds
 * back to 120 once past 600.
 */
export function HudDrawAmmoAndReloadPrompt(player: number,
                                           events?: Events): void {
  const state = G.g_bHudShutterState;
  if (state === 2) {
    DrawAmmoReadout(player, 1);
    G.g_hud_ammo_slide[player] = 0;
  } else if (state === 1) {
    DrawAmmoReadout(player, (40 - G.g_hud_ammo_slide[player]) * 0.0125 + 1);
    G.g_hud_ammo_slide[player] += 1;
  } else {
    G.g_hud_ammo_slide[player] = 0;
  }
  if (state !== 2 && state !== 1) return;
  if (G.g_player_magazine_empty[player] === 0) return;
  if (G.g_nFiringGate === 0) return;
  const t = G.g_player_reload_prompt_timer[player];
  const gun = G.g_player_input_is_gun[player] === 1;
  if (t % 60 <= 44) {
    if (player === 0) {
      DrawScreenSprite(HudSprite.Reload, 24, 260, 1, 1.5, 1);
      if (t >= RELOAD_PROMPT_SECOND_LINE) {
        DrawScreenSprite(gun ? HudSprite.ShootOutside
                             : HudSprite.PressReloadButton, 16, 325);
      }
    } else {
      DrawScreenSprite(HudSprite.Reload, 432, 260, 1, 1.5, 1);
      if (t >= RELOAD_PROMPT_SECOND_LINE) {
        if (gun) DrawScreenSprite(HudSprite.ShootOutside, 424, 325);
        else DrawScreenSprite(HudSprite.PressReloadButton, 384, 325);
      }
    }
  }
  if (t !== 0 && G.g_trigger_down[player] !== 0
      && G.g_aim_on_screen[player] !== 0) {
    events?.emit("sound.play", {
      id: t < RELOAD_PROMPT_SECOND_LINE || !gun ? RELOAD_VOICE : SHOOT_VOICE,
    });
  }
  G.g_player_reload_prompt_timer[player] = t + 1;
  if (t > 600) G.g_player_reload_prompt_timer[player] = RELOAD_PROMPT_SECOND_LINE;
}

/**
 * `HudDrawLives` — `FUN_004174A0`. The "1P"/"2P" tag and one lamp a life,
 * in shutter state 2 only; "HOLD YOUR FIRE!" blinking in state 4.
 *
 * Each lamp is a seven-cel flame on `g_frame_counter`, three frames a cel and
 * four frames out of step with the lamp before it, so a row of them flickers
 * rather than pulses. Original Mode with more than five lives draws one lamp,
 * `x` and the count instead.
 */
export function HudDrawLives(player: number): void {
  const state = G.g_bHudShutterState;
  const lives = G.g_player_lives[player];
  const frame = G.g_frame_counter >>> 0;
  const lamp = player === 0 ? HudSprite.Lamp1P : HudSprite.Lamp2P;
  if (state === 2) {
    DrawScreenSprite(player === 0 ? HudSprite.Tag1P : HudSprite.Tag2P,
                     player === 0 ? 28 : 584, 412);
    if (G.g_GameMode === GameMode.Original && lives > 5) {
      const x = player === 0 ? 60 : 524;
      DrawScreenSprite(lamp + Math.trunc(frame / 3) % LAMP_CELS, x, 412);
      DrawScreenSprite(HudSprite.Times, x + 24, 412, 0.98);
      DrawScreenSprite(HudSprite.Digit0 + lives, x + 36, 412, 0.98);
      return;
    }
    for (let i = 0; i < lives; i++) {
      const cel = Math.trunc(((frame + i * 4) >>> 0) / 3) % LAMP_CELS;
      DrawScreenSprite(lamp + cel, player === 0 ? 60 + 32 * i : 548 - 32 * i,
                       412);
    }
    return;
  }
  if (state === 4
      && (G.g_screen_furniture_flags & ScreenFurniture.ResultCard) === 0
      && frame % 60 < 45) {
    DrawScreenSprite(HudSprite.HoldYourFire, player === 0 ? 32 : 416, 422,
                     0.98, 1.5, 1);
  }
}

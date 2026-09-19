/**
 * The per-player shell: how a player gets into play, stays there, runs out,
 * continues, and leaves.
 *
 * Each player is a 0x38-byte task, allocated by `PlayerTasksCreate` whenever a
 * task list is built, whose routine is whatever the player's state installed.
 * `PlayerSetState` writes `g_player_state` and, asked to, installs
 * `g_player_state_handlers[state]`. Four of those handlers -- states 0 to 3 --
 * are one call each, to `PlayerEnterPlay` with their own index, and that is the
 * only way a player gets to state 5: every row 0..3 of
 * `g_player_enter_play_modes` carries it, and `PlayerEnterPlay` installs
 * `PlayerUpdateInPlay` itself (state 5's handler entry is null). The other two
 * stores into `g_player_state` the image has write 0, not 5:
 * `NetworkModeRunPhase` at `0x0049F4E4` (the `EBX` it also stores to
 * `g_GameMode` as Arcade) and the Boss-mode name-entry exit at `0x00481F3C`
 * (`EDI`, pushed beside it as a 0.0 translation and compared against a
 * countdown it decrements to zero). `[proved]` for the first, `[likely]` for
 * the second's register.
 *
 * ```
 *   9 Out ──start (title)──▶ 0 EnterNewGame ─┐
 *   9 Out ──start (in play)─▶ 3 EnterJoinIn ─┤ PlayerEnterPlay ──▶ 5 InPlay
 *   5 ──AdvanceToNextScene─▶ 2 SceneReentry ─┤          │ lives reach 0
 *   4 ──start + a credit──▶ 1 EnterContinue ─┘          ▼
 *                                              4 Continue: 0x9FFF, -0x2D a frame
 *                                                       │ runs out
 *                                                       ▼
 *                                 9 Out ◀── 120 frames ── 6 GameOver
 * ```
 *
 * ## What the port leaves out
 *
 * `[diverges]` **The draws.** The `+0x80` hook places the player's entity on
 * the view (`PlacePlayerEntityFromViewPose`, `FUN_004159A0`), `PlayerHookDrawBody`
 * draws the body, and every handler draws its own HUD -- crosshair, the
 * continue digit, "GAME OVER", "PRESS START". Those are the renderer's and
 * the HUD's and read the state this module writes. The damage overlay's state
 * half is ported (`effects/damage_overlay.ts`) and runs from here, and so are
 * the lives, the bullets and the RELOAD prompt (`hud_readout.ts`), which keep
 * state of their own and record what they draw.
 * `PlayerEnterPlay`'s crosshair zeroing is left out: the engine re-polls the
 * aim the next frame, and the port's aim is written on pointer moves only, so
 * zeroing it would park the gun light in the middle of the
 * screen until the mouse moved.
 */
import type { Events } from "../core/events";
import { CommitAppState, RequestAppState } from "./app_state";
import { FirstDueShotRequest } from "./combat/shot";
import { HudDrawAmmoAndReloadPrompt, HudDrawLives } from "./hud_readout";
import {
  OriginalWeaponLoadFireParams, PlayerFireAndReloadUpdate,
  PlayerFireOriginalModeWeapon,
} from "./player_gun";
import { ScoreAddForPlayer } from "./combat/score";
import { DamageOverlayClear, DamageOverlayUpdateAndDraw, PlayerCameraHook,
  PlayerRunCameraHook, UpdateScreenShake } from "./effects/damage_overlay";
import { CreditCount, CreditTrySpend, CreditsAvailable, ModeStartCounterValue,
  SetBothPlayerCounters } from "./credits";
import { GameMode } from "./game_mode";
import { AppState, G, RestoreGameGlobals } from "./globals";
import { PlayerState, PlayerTask, RunPhase } from "./player_state";
import { NULL_HOST, type GameHost } from "./host";
import { Rng } from "../core/rng";
import { clonePlain } from "../core/snapshot";

/** What a player task needs from the frame. */
export interface PlayerFrame {
  host: GameHost;
  rng: Rng;
  events?: Events;
}

// -- the two tables ----------------------------------------------------------

/**
 * `g_player_state_handlers` — `0x00579CD0`, 0x14 bytes a state: the routine
 * `PlayerSetState` installs, then four flag dwords. Only the first flag is
 * read by anything the port runs -- `RunPhaseInPlay` and the continue screen
 * test it at `0x00579CD4` -- and it is 1 exactly for states 4 and 9, the two
 * a player is *out* in.
 */
export const g_player_state_handlers: readonly {
  task: PlayerTask; out: 0 | 1;
}[] = [
  { task: PlayerTask.EnterNewGame, out: 0 },       // 0  0x00413DB0
  { task: PlayerTask.EnterContinue, out: 0 },      // 1  0x00413DE0
  { task: PlayerTask.ReenterAfterScene, out: 0 },  // 2  0x00413E40
  { task: PlayerTask.EnterJoinIn, out: 0 },        // 3  0x00413E50
  { task: PlayerTask.ArmContinue, out: 1 },        // 4  0x00414200
  { task: PlayerTask.None, out: 0 },               // 5  null
  { task: PlayerTask.ArmGameOver, out: 0 },        // 6  0x00414420
  { task: PlayerTask.Idle, out: 0 },               // 7  0x00414520
  { task: PlayerTask.ArmNameEntry, out: 0 },       // 8  0x00414540
  { task: PlayerTask.Out, out: 1 },                // 9  0x004145C0
  { task: PlayerTask.ArmPendingStart, out: 0 },    // 10 0x00414680
  { task: PlayerTask.FireOnly, out: 0 },           // 11 0x00414740
];

/** The flag bits of a `g_player_enter_play_modes` row. */
export enum EnterPlayFlag {
  /** Lives (and the shown copy) from `g_start_lives`. */
  ResetLives = 0x01,
  /** `g_player_score = 0`. */
  ClearScore = 0x04,
  /** Set in every row; `PlayerEnterPlay` never tests it. `[open]` */
  Unread = 0x08,
  /** `g_players_in_play += 1`. */
  CountPlayer = 0x10,
  /** `g_max_attackers += 1`. */
  CountAttacker = 0x20,
}

/**
 * `g_player_enter_play_modes` — `0x00579DE8`, 0x18 bytes a row:
 * `{flags, state, invulnerable frames, hook, hook, update}`. The hooks are
 * draw callbacks (see the file comment) and the update is
 * `PlayerUpdateInPlay` in rows 0..5. Row 4 is the attract demo's entry and
 * leaves the player at **9**; row 6 (state 12, update `0x00420810`) has no
 * caller the image reaches -- its only thunk, `0x00414730`, has no xref.
 */
export const g_player_enter_play_modes: readonly {
  flags: number; state: number; invuln: number; hook: PlayerCameraHook;
}[] = [
  // `PlayerCameraHook` spelled as its values (2 draw body, 1 overlay): this
  // table is built at load, and `effects/damage_overlay.ts` may not be yet.
  { flags: 0x3d, state: PlayerState.InPlay, invuln: 90, hook: 2 },   // 0 new game
  { flags: 0x19, state: PlayerState.InPlay, invuln: 180, hook: 1 },  // 1 continue
  { flags: 0x08, state: PlayerState.InPlay, invuln: 90, hook: 2 },   // 2 next scene
  { flags: 0x3d, state: PlayerState.InPlay, invuln: 180, hook: 1 },  // 3 join in
  { flags: 0x3c, state: PlayerState.Out, invuln: 90, hook: 2 },      // 4 attract
  { flags: 0x3d, state: PlayerState.Out, invuln: 90, hook: 2 },      // 5
];

/**
 * `0x004D0EDC`, s16[5]: the lives each setting of the options' life count
 * gives. `FUN_0040AB50` loads `g_start_lives` from it.
 */
export const START_LIVES_BY_OPTION: readonly number[] = [1, 2, 3, 4, 5];

/**
 * `0x009C9F21`, the options' life setting, at its factory value: the reset
 * `FUN_00401130` writes 2, which is **three** lives. The port has no options
 * screen and no saved options, so the factory value is the one it can claim.
 * (The bundle's `start_lives` said 2; nothing in the image read it.)
 */
export const OPTION_LIVES = 2;

/** `PlayerStateArmContinue`'s start value for the continue countdown. */
const CONTINUE_TIMER_START = 0x9fff;
/** ...and what one frame takes off it: ten digits in about 910 frames. */
const CONTINUE_TIMER_STEP = 0x2d;
/** `PlayerStateArmGameOver`'s wait before a player is out: 0x78 frames. */
const GAME_OVER_FRAMES = 0x78;
/** `PlayerStateFireOnly`'s ammo. */
const FIRE_ONLY_AMMO = 6;
/** The Arcade magazine `PlayerEnterPlay` loads. */
const ARCADE_AMMO = 6;

/**
 * `g_pad_state` bits `PadStartPressed` tests. Off the title a player's START
 * is `8` (player 0) or `0x80000` (player 1); on it, `0xC` or `0xC0000`.
 */
export enum PadBit {
  Continue0 = 0x4,
  Start0 = 0x8,
  Continue1 = 0x40000,
  Start1 = 0x80000,
}

// -- the transitions ----------------------------------------------------------

/**
 * `PlayerSetState` — `FUN_00415080`. `g_player_state = state`, and with
 * `install` the task's routine becomes `g_player_state_handlers[state]`. The
 * routine is not called: it runs on the task's next turn.
 */
export function PlayerSetState(state: number, install: number,
                               player: number): void {
  G.g_player_state[player] = state;
  if (install !== 0) {
    G.g_player_task[player] =
      g_player_state_handlers[state]?.task ?? PlayerTask.None;
  }
}

/**
 * `PlayerTasksCreate` — `FUN_00414ED0`. One task a player, running the
 * handler of whatever state that player is in. Every task list the engine
 * builds -- the title's, each scene's, the network screen's -- calls it, which
 * is why `AdvanceToNextScene` parks an in-play player at 2 first: state 5's
 * entry is null.
 */
export function PlayerTasksCreate(): void {
  for (let p = 0; p < 2; p++) {
    G.g_player_task[p] =
      g_player_state_handlers[G.g_player_state[p]]?.task ?? PlayerTask.None;
  }
}

/**
 * `PlayerEnterPlay` — `FUN_00414770`. Put a player into play by row `mode`.
 *
 * `[diverges]` Two of its Original Mode arms are left out: `FUN_00416420`
 * copies the carried weapon's magazine table into the player's block, and
 * modes 1 and 3 take the lives from the Original Mode life stock at
 * `0x009A2244` (`FUN_00416340`, `FUN_004163D0`) -- a per-item count the port
 * has no model of. The ammo half of each is transcribed. Arcade, which is every
 * mode but Original, is whole.
 */
export function PlayerEnterPlay(player: number, mode: number,
                                f: PlayerFrame): void {
  const row = g_player_enter_play_modes[mode];
  if (!row) return;
  if (G.g_GameMode < GameMode.Training || G.g_GameMode > 3) {
    if (row.flags & EnterPlayFlag.ResetLives) {
      G.g_player_lives[player] = G.g_start_lives;
      G.g_player_lives_shown[player] = G.g_start_lives;
    }
  } else {
    G.g_player_lives[player] = G.g_start_lives;
    G.g_player_lives_shown[player] = G.g_start_lives;
  }
  if (row.flags & EnterPlayFlag.ClearScore) G.g_player_score[player] = 0;
  // The `+0x7C` hook the row carries: `PlayerInstallDrawBodyHook`
  // (`FUN_004150C0`) or `PlayerInstallDamageOverlayHook` (`FUN_004150E0`).
  // The `+0x80` hook is the renderer's (`PlacePlayerEntityFromViewPose`).
  G.g_player_camera_hook[player] = row.hook;
  if (row.flags & EnterPlayFlag.CountPlayer) G.g_players_in_play += 1;
  if (row.flags & EnterPlayFlag.CountAttacker) G.g_max_attackers += 1;
  // The overlay's `active` and `frames` words, `0x009A26C0/C4 + player*0x14`.
  G.g_damage_overlays[player].active = 0;
  G.g_damage_overlays[player].frames = 0;
  G.g_player_invuln_frames[player] = row.invuln;
  G.g_player_continue_timer[player] = 0;
  // `+0x1E` and `+0x20` of the player block: the empty latch and the RELOAD
  // prompt's timer.
  G.g_player_magazine_empty[player] = 0;
  G.g_player_reload_prompt_timer[player] = 0;
  // The six slots of each shot-effect ring this player owns, and the cursor.
  const ring = G.g_shot_tracer_ring.length / 2;
  for (let i = 0; i < ring; i++) {
    const t = G.g_shot_tracer_ring[player * ring + i];
    const fl = G.g_shot_flash_ring[player * ring + i];
    if (t) t.live = false;
    if (fl) fl.live = false;
  }
  G.g_shot_effect_cursor[player] = 0;
  if (G.g_GameMode === GameMode.Original) {
    G.g_player_ammo[player] = G.g_player_magazine_size[player];
    OriginalWeaponLoadFireParams(player);
  } else {
    G.g_player_ammo[player] = ARCADE_AMMO;
  }
  if (G.g_GameMode === GameMode.Original) {
    // `FUN_00416340` / `FUN_00416390` / `FUN_004163D0`: ammo from the
    // magazine size, 6 when it is -1. See the divergence above for lives.
    if (mode >= 1 && mode <= 3) {
      const m = G.g_player_magazine_size[player];
      G.g_player_ammo[player] = m !== -1 ? m : ARCADE_AMMO;
    }
  } else {
    // `0x009A2247 = 0` and the dword `0x3000006` over `+0x08..+0x0B`: magazine
    // 6, weapon kind 0, sound kind 0, `+0x0B` 3; `+0x0C` 1.0.
    G.g_player_magazine_size[player] = ARCADE_AMMO;
    G.g_original_weapon_kind[player] = 0;
    G.g_original_fire_mode[player] = 0;
  }
  PlayerSetState(row.state, 0, player);
  G.g_player_task[player] = PlayerTask.InPlay;
  PlayerUpdateInPlay(player, f);
}

/**
 * `PlayerTryStartPress` — `FUN_00414FC0`. A START that finds a credit puts the
 * player into `state`; off the play screen it also requests it. Returns 1 if
 * it took.
 *
 * `+0x12C` bit 1, which it clears on every call, is `[open]` and not kept.
 */
export function PlayerTryStartPress(player: number, state: number): number {
  let took = 0;
  if (PadStartPressed(player) !== 0
      && G.g_app_state !== AppState.GameOver
      && (G.g_screen_furniture_flags & 2) !== 0
      && CreditTrySpend(player,
                        G.g_player_state[player] === PlayerState.Continue
                          ? 1 : 0) !== 0) {
    took = 1;
    if (G.g_app_state !== AppState.InPlay) {
      RequestAppState(AppState.InPlay);
      G.g_screen_furniture_flags |= 1;
    }
    if ((G.g_screen_furniture_flags & 1) === 0) {
      G.g_player_pending_state[player] = state;
      state = PlayerState.PendingStart;
    }
    PlayerSetState(state, 1, player);
  }
  return took;
}

/**
 * `PadStartPressed` — `FUN_00413230`. Player 0's START is bit 8, player 1's
 * `0x80000`; on the title either bit of `0xC` / `0xC0000` counts.
 */
export function PadStartPressed(player: number): number {
  if (G.g_app_state !== AppState.Title) {
    if (player === 0) return G.g_pad_state & PadBit.Start0;
    if (player !== 1) return 0;
    return G.g_pad_state & PadBit.Start1;
  }
  if (player === 0) return G.g_pad_state & (PadBit.Start0 | PadBit.Continue0);
  if (player !== 1) return 0;
  return G.g_pad_state & (PadBit.Start1 | PadBit.Continue1);
}

/**
 * `IsDemoRun` — `FUN_00413280`. True on the attract screens (5, 9, 0x0A,
 * 0x0B) and in play only at run phase 8. `PlayerUpdateInPlay` polls for a
 * start press only then; `ResetDamageRank` uses rank 2 then.
 */
export function IsDemoRun(): boolean {
  switch (G.g_app_state) {
    case AppState.Attract: case 9: case 0x0a: case 0x0b: return true;
    case AppState.InPlay: return G.g_nRunPhase === 8;
    default: return false;
  }
}

// -- the handlers --------------------------------------------------------------

/** `PlayerStateEnterNewGame` — `FUN_00413DB0`. */
export function PlayerStateEnterNewGame(player: number, f: PlayerFrame): void {
  // `0x009C6EF0` and `0x007C211C` are zeroed here; neither is modelled.
  PlayerEnterPlay(player, 0, f);
}

/**
 * `PlayerStateEnterContinue` — `FUN_00413DE0`. A continue: one point on the
 * score (`ScoreAddForPlayer(player, 1)`, the continue tally in the last
 * digit), the damage rank down one, floored at 0, then row 1.
 */
export function PlayerStateEnterContinue(player: number, f: PlayerFrame): void {
  if (G.g_damage_overlays[player].active !== 0) DamageOverlayClear(player);
  ScoreAddForPlayer(player, 1, f.events);
  G.g_damage_rank -= 1;
  if (G.g_damage_rank < 0) G.g_damage_rank = 0;
  PlayerEnterPlay(player, 1, f);
}

/**
 * `PlayerStateReenterAfterScene` — `FUN_00413E40`. Nothing but row 2: no
 * lives, no counters, 90 frames of invulnerability.
 */
export function PlayerStateReenterAfterScene(player: number,
                                             f: PlayerFrame): void {
  PlayerEnterPlay(player, 2, f);
}

/**
 * `PlayerStateEnterJoinIn` — `FUN_00413E50`. The combo, shot and hit counts
 * go, then row 3. The shot count (`0x009A5C84`) is not in `G`.
 */
export function PlayerStateEnterJoinIn(player: number, f: PlayerFrame): void {
  G.g_head_combo_bonus[player] = 0;
  G.g_player_hit_count[player] = 0;
  PlayerEnterPlay(player, 3, f);
}

/**
 * `PlayerStateArmContinue` — `FUN_00414200`. Seeds the countdown and the
 * credit counts it watches, and installs `PlayerContinueCountdown` for the
 * next turn.
 */
export function PlayerStateArmContinue(player: number): void {
  G.g_player_continue_timer[player] = CONTINUE_TIMER_START;
  const seen = G.g_player_credit_seen[player];
  seen[0] = CreditCount(0);
  seen[1] = CreditCount(1);
  seen[2] = 0;
  seen[3] = 0;
  G.g_player_task[player] = PlayerTask.ContinueCountdown;
}

/**
 * `PlayerContinueCountdown` — `FUN_00414280`. The continue digit
 * (`timer >> 12`, 9 down to 0) falls by `0x2D` a frame; the trigger knocks it
 * to the bottom of its digit; a new credit restarts it; no credit at all ends
 * it at once. START with a credit is state 1. Run out, and the player gives up
 * their attacker slot and is game over.
 *
 * While the run is on its own continue screen (phase 4) this timer stands
 * still: that screen counts for everybody.
 */
export function PlayerContinueCountdown(player: number,
                                        f: PlayerFrame): void {
  DamageOverlayUpdateAndDraw(player, f.rng, f.events);
  const seen = G.g_player_credit_seen[player];
  if (seen[0] !== CreditCount(0) || seen[1] !== CreditCount(1)
      || seen[2] !== 0 || seen[3] !== 0) {
    seen[0] = CreditCount(0);
    seen[1] = CreditCount(1);
    G.g_player_continue_timer[player] = CONTINUE_TIMER_START;
    seen[2] = 0;
    seen[3] = 0;
  }
  if (CreditsAvailable() === 0) G.g_player_continue_timer[player] = 1;
  let expired = false;
  if (G.g_nRunPhase !== RunPhase.ContinueCountdown) {
    if (G.g_trigger_down[player] !== 0
        && G.g_player_continue_timer[player] < 0x8000) {
      G.g_player_continue_timer[player] =
        (G.g_player_continue_timer[player] & ~0xfff) + 1;
    }
    G.g_player_continue_timer[player] -= CONTINUE_TIMER_STEP;
    expired = G.g_player_continue_timer[player] < 1;
  }
  if (PlayerTryStartPress(player, PlayerState.EnterContinue) === 0
      && expired) {
    G.g_player_continue_timer[player] = 0;
    G.g_max_attackers -= 1;
    PlayerSetState(PlayerState.GameOver, 1, player);
  }
}

/**
 * `PlayerContinueRearm` — `FUN_00414250`, which `PlayerResumeContinue`
 * installs when the run's continue screen hands back: a fresh countdown, then
 * the countdown itself, this frame.
 */
export function PlayerContinueRearm(player: number, f: PlayerFrame): void {
  G.g_player_continue_timer[player] = CONTINUE_TIMER_START;
  G.g_player_task[player] = PlayerTask.ContinueCountdown;
  PlayerContinueCountdown(player, f);
}

/**
 * `PlayerResumeContinue` — `FUN_004141D0`. A player still at 4 when the run's
 * continue screen ends goes back to their own countdown.
 */
export function PlayerResumeContinue(player: number): void {
  if (G.g_player_state[player] === PlayerState.Continue) {
    G.g_player_task[player] = PlayerTask.ContinueRearm;
  }
}

/**
 * `PlayerStateArmGameOver` — `FUN_00414420`. The draws and the entity pose
 * aside, a 120-frame wait, then `PlayerGameOverWait` this frame.
 */
export function PlayerStateArmGameOver(player: number): void {
  G.g_player_gameover_timer[player] = GAME_OVER_FRAMES;
  G.g_player_task[player] = PlayerTask.GameOverWait;
  PlayerGameOverWait(player);
}

/**
 * `PlayerGameOverWait` — `FUN_004144C0`. On the game-over screen it only runs
 * the draw hook; otherwise it counts down and puts the player out.
 */
export function PlayerGameOverWait(player: number): void {
  if (G.g_app_state === AppState.GameOver) return;
  G.g_player_gameover_timer[player] -= 1;
  if (G.g_player_gameover_timer[player] === 0) {
    PlayerSetState(PlayerState.Out, 1, player);
  }
}

/**
 * `PlayerStateOut` — `FUN_004145C0`. In the attract demo the player enters by
 * row 4 at once (and stays at 9); anywhere else the task polls for START.
 */
export function PlayerStateOut(player: number, f: PlayerFrame): void {
  if (G.g_app_state === AppState.Attract) {
    PlayerEnterPlay(player, 4, f);
    return;
  }
  G.g_player_task[player] = PlayerTask.PollStart;
  PlayerPollStart(player);
}

/**
 * `PlayerPollStart` — `FUN_00414600` (behind the `0x004145F0` thunk). A START
 * off the play screen is a new game (0); on it, a join (3).
 */
export function PlayerPollStart(player: number): void {
  PlayerTryStartPress(player, G.g_app_state !== AppState.InPlay
    ? PlayerState.EnterNewGame : PlayerState.EnterJoinIn);
  // `0x009C6EF0 = 1` for a join, and "PRESS START" for a player at 9 -- the
  // flag is not modelled and the message is the HUD's.
}

/** `PlayerStateArmPendingStart` — `FUN_00414680`. */
export function PlayerStateArmPendingStart(player: number): void {
  G.g_player_task[player] = PlayerTask.PendingStart;
}

/**
 * `PlayerPendingStart` — `FUN_00414690`. Once `g_screen_furniture_flags` bit 0
 * is up, the held state and its handler, this frame.
 */
export function PlayerPendingStart(player: number, f: PlayerFrame): void {
  if ((G.g_screen_furniture_flags & 1) === 0) return;
  const state = G.g_player_pending_state[player];
  G.g_player_state[player] = state;
  G.g_player_task[player] =
    g_player_state_handlers[state]?.task ?? PlayerTask.None;
  PlayerTaskRun(player, f);
}

/** `PlayerStateFireOnly` — `FUN_00414740`. Six rounds and the trigger. */
export function PlayerStateFireOnly(player: number, f: PlayerFrame): void {
  G.g_player_ammo[player] = FIRE_ONLY_AMMO;
  PlayerFireAndReloadUpdate(player, f);
}

/**
 * `PlayerUpdateInPlay` — `FUN_00413E90`. One player's frame in play.
 *
 * The attract demo pins lives at 1; lives are floored at 0; with a life the
 * trigger is polled (`PlayerFireAndReloadUpdate`, or the Original Mode twin);
 * and outside states 5 and 9 of the app, **the frame lives reach 0** the player
 * leaves play: `g_players_in_play` drops and state 4, the continue, is
 * installed -- or, in Training, `g_training_out` is raised instead. A
 * player with lives gets the HUD -- the bullets and the RELOAD prompt while
 * the firing gate is up (`0x00413F63`), the lives always -- and takes the
 * shown copy. Then, only in a demo run, a start press can join.
 *
 * `HudDrawCrosshair` (`FUN_004169C0`) and `PlayerShotEffectsThink`
 * (`FUN_00416B00`) sit between the trigger and the HUD; the crosshair is the
 * UI's reticle and the shot rings are stepped by `ShotEffectsTick`.
 */
export function PlayerUpdateInPlay(player: number, f: PlayerFrame): void {
  // The `+0x80` hook (`PlacePlayerEntityFromViewPose`) is the renderer's.
  // Then the `+0x7C` hook, which is where a hit becomes its damage overlay.
  PlayerRunCameraHook(player, f.events);
  if (G.g_app_state === AppState.Attract) G.g_player_lives[player] = 1;
  if (!(G.g_player_lives[player] > 0)) G.g_player_lives[player] = 0;
  if (G.g_player_lives[player] !== 0) {
    if (G.g_GameMode === GameMode.Original) {
      PlayerFireOriginalModeWeapon(player, f);
    } else {
      PlayerFireAndReloadUpdate(player, f);
    }
  }
  if (G.g_app_state !== 9 && G.g_app_state !== AppState.Attract) {
    if (G.g_player_lives[player] === 0) {
      if (G.g_GameMode === GameMode.Training) {
        G.g_training_out = 1;
      } else {
        G.g_players_in_play -= 1;
        PlayerSetState(PlayerState.Continue, 1, player);
      }
    } else {
      if (G.g_nFiringGate !== 0) HudDrawAmmoAndReloadPrompt(player, f.events);
      HudDrawLives(player);
      G.g_player_lives_shown[player] = G.g_player_lives[player];
    }
  }
  DamageOverlayUpdateAndDraw(player, f.rng, f.events);
  if (IsDemoRun()) PlayerPollStart(player);
}

/**
 * `[port-only]` — the task walk's call through `task+0`: run whichever
 * routine this player's task holds.
 */
export function PlayerTaskRun(player: number, f: PlayerFrame): void {
  switch (G.g_player_task[player]) {
    case PlayerTask.EnterNewGame: PlayerStateEnterNewGame(player, f); break;
    case PlayerTask.EnterContinue: PlayerStateEnterContinue(player, f); break;
    case PlayerTask.ReenterAfterScene:
      PlayerStateReenterAfterScene(player, f); break;
    case PlayerTask.EnterJoinIn: PlayerStateEnterJoinIn(player, f); break;
    case PlayerTask.ArmContinue: PlayerStateArmContinue(player); break;
    case PlayerTask.ContinueCountdown:
      PlayerContinueCountdown(player, f); break;
    case PlayerTask.ContinueRearm: PlayerContinueRearm(player, f); break;
    case PlayerTask.InPlay: PlayerUpdateInPlay(player, f); break;
    case PlayerTask.ArmGameOver: PlayerStateArmGameOver(player); break;
    case PlayerTask.GameOverWait: PlayerGameOverWait(player); break;
    case PlayerTask.Out: PlayerStateOut(player, f); break;
    case PlayerTask.PollStart: PlayerPollStart(player); break;
    case PlayerTask.ArmPendingStart: PlayerStateArmPendingStart(player); break;
    case PlayerTask.PendingStart: PlayerPendingStart(player, f); break;
    case PlayerTask.FireOnly: PlayerStateFireOnly(player, f); break;
    // `NoOpStub`, and name entry: `PlayerStateArmNameEntry` (`FUN_00414540`)
    // is set only by `FUN_00480D90` after the ending, which the port does not
    // reach, and its rank test `FUN_004157F0` is not ported.
    case PlayerTask.Idle: case PlayerTask.ArmNameEntry: case PlayerTask.None:
      break;
  }
}

/**
 * `[port-only]` — both player tasks, in the order `PlayerTasksCreate`
 * allocates them, which puts them at the head of every scene's task list, and
 * the `SelectAttackablePlayer` task allocated after them.
 * The trigger bit is derived from the shot queue first; see
 * {@link G.g_trigger_down}. So is the aim's on-screen bit, for the one frame
 * a pull off the screen stands for: `MouseGunResolvePull` (`FUN_0041EB30`)
 * puts the mouse-gun at `(0xFFFF, 0xFFFF)` for the frame of a right click
 * and the next frame reads the mouse again, which the port's pointer always
 * has on the screen. The frame's screen sprites start empty here, because
 * the player tasks are what draw them.
 */
export function PlayerTasksRun(f: PlayerFrame): void {
  G.g_screen_sprites = [];
  const offscreen = [false, false];
  for (let p = 0; p < 2; p++) {
    const r = FirstDueShotRequest(p);
    G.g_trigger_down[p] = r ? 1 : 0;
    if (r && r.onScreen === 0) {
      G.g_aim_on_screen[p] = 0;
      offscreen[p] = true;
    }
  }
  for (let p = 0; p < 2; p++) PlayerTaskRun(p, f);
  for (let p = 0; p < 2; p++) if (offscreen[p]) G.g_aim_on_screen[p] = 1;
  SelectAttackablePlayer();
}

/**
 * `[port-only]` -- the screen sprites of a world no frame has been run on.
 *
 * The engine draws the readouts every frame (`HudDrawAmmoAndReloadPrompt`,
 * `HudDrawLives`), so any picture of it has them. The port can build a world
 * without running a frame -- a seek replays the script and stops -- and would
 * then show the reset's empty `G.g_screen_sprites`: a seek into a fight,
 * paused, had no bullets and no lives on it.
 *
 * So this runs the next frame's player turn, {@link PlayerTasksRun}, and
 * throws it away: `G` is copied first and written back after, keeping only
 * the sprites. Nothing is heard (no events), the world's generator is not
 * drawn from (a scratch one), and nothing is asked of the renderer
 * (`NULL_HOST`). There is no invented "does this player have a HUD" test:
 * the routines that draw the readouts decide, from a player task that is
 * often not yet `InPlay` after a seek -- the enter-play states run
 * `PlayerUpdateInPlay` on their own first frame.
 *
 * The turn runs on a deep copy swapped into `G`, and the live references are
 * swapped back after, so every object the world holds -- the actors a
 * renderer is keyed on among them -- is the same object, untouched, and no
 * resync is owed.
 */
export function PlayerTasksDrawWithoutAFrame(): void {
  const live = { ...G };
  RestoreGameGlobals(clonePlain(G));
  PlayerTasksRun({ host: NULL_HOST, rng: new Rng(0) });
  const sprites = G.g_screen_sprites;
  RestoreGameGlobals(live);
  G.g_screen_sprites = sprites;
}

/**
 * `SelectAttackablePlayer` — `FUN_00414F40`, the task `FUN_00414FB0`
 * allocates on the line after every `PlayerTasksCreate` -- so it runs after
 * both player tasks in the walk, which is what lets a player's own update see
 * `g_player_was_hit` before `UpdateScreenShake` clears it. `[proved]` from the
 * call order at `0x00460729`/`0x0046072E` and `ActorAlloc` appending.
 *
 * Then `g_active_player`: -1 with nobody in play; with one, player 0 if its
 * state is 5 or 7 and player 1 otherwise; with two, 2 (and `0x007C211C = 1`,
 * not carried).
 */
export function SelectAttackablePlayer(): void {
  UpdateScreenShake();
  if (G.g_players_in_play === 0) {
    G.g_active_player = -1;
  } else if (G.g_players_in_play === 1) {
    const s = G.g_player_state[0];
    G.g_active_player = s !== PlayerState.InPlay && s !== PlayerState.Idle
      ? 1 : 0;
  } else if (G.g_players_in_play === 2) {
    G.g_active_player = 2;
  }
}

// -- entering a stage --------------------------------------------------------

/**
 * `[port-only]` -- the boot slice of the player block, from three routines:
 * `FUN_0040A920` zeroes the data segment and writes 9 to both players
 * (`0x0040AA3D`); `FUN_004066D0` sets the credit costs; `FUN_0040AB50` loads
 * the start lives from the options.
 */
export function PlayerBlockBoot(): void {
  G.g_player_state = [PlayerState.Out, PlayerState.Out];
  G.g_player_task = [PlayerTask.None, PlayerTask.None];
  G.g_player_lives = [0, 0];
  G.g_player_lives_shown = [0, 0];
  G.g_player_score = [0, 0];
  G.g_player_invuln_frames = [0, 0];
  G.g_player_ammo = [0, 0];
  G.g_player_magazine_size = [ARCADE_AMMO, ARCADE_AMMO];
  G.g_player_magazine_empty = [0, 0];
  G.g_player_reload_prompt_timer = [0, 0];
  G.g_hud_ammo_slide = [0, 0];
  G.g_original_fire_mode = [0, 0];
  G.g_original_fire_latches = [[0, 0, 0, 0], [0, 0, 0, 0]];
  G.g_player_continue_timer = [0, 0];
  G.g_player_credit_seen = [[0, 0, 0, 0], [0, 0, 0, 0]];
  G.g_player_gameover_timer = [0, 0];
  G.g_player_pending_state = [0, 0];
  G.g_player_no_damage = [0, 0];
  G.g_players_in_play = 0;
  G.g_max_attackers = 0;
  G.g_credits = [0, 0];
  G.g_credit_tier = [0, 0];
  G.g_credit_is_continue = [0, 0];
  G.g_free_play = 0;
  G.g_credits_per_player = 0;
  G.g_credits_to_start = 1;
  G.g_credits_to_continue = 1;
  G.g_title_start_armed = 0;
  G.g_pad_state = 0;
  G.g_trigger_down = [0, 0];
  G.g_training_out = 0;
  G.g_screen_furniture_flags = 0;
  G.g_app_state_pending = -1;
  G.g_continue_timer = 0;
  G.g_continue_credit_seen = [0, 0, 0, 0];
  G.g_no_continue_frames = 0;
  G.g_start_lives = START_LIVES_BY_OPTION[OPTION_LIVES];
}

/**
 * `[port-only]` — **a game started from the title**, which is what every page
 * load and every seek stands for: the title (app state 4) with its mode
 * confirmed, player 0's START, the commit into play, and the scene's task
 * list. Every step is a ported routine; only the sequence is the port's.
 * Entering the title goes through `CommitAppState` like any screen change,
 * which is what raises `g_screen_furniture_flags` bit 1 -- `PlayerTryStartPress`
 * refuses without it.
 *
 * `TitleMenuUpdateAndSelect`'s (`FUN_00496960`) confirm arm is the part that
 * matters here: it arms the title (`g_title_start_armed = 1`) and seeds the
 * credits with `SetBothPlayerCounters(ModeStartCounterValue(cursor))`. Then
 * the title's player task -- state 9, so `PlayerStateOut` then
 * `PlayerPollStart` -- sees START, spends the first credit, requests app
 * state 6 and puts the player at 0. `CommitAppState` applies it at the end of
 * the frame; `ResetGameOnStart` (`0x0045FEF0`) is run phase 0 and leaves
 * phase 2; and the scene's `PlayerTasksCreate` gives player 0 the state-0
 * handler, which is `PlayerEnterPlay(0)` on its first turn -- taken here, so
 * that the scene-state installers a deep link's replay runs afterwards land
 * on top of the hook `PlayerEnterPlay` writes, as they do in a game started at
 * the entry (`[likely]`: the player tasks are allocated before the scene's
 * script starts entering scene states).
 */
export function PlayerStartGameFromTitle(mode: number,
                                         f: PlayerFrame = TITLE_FRAME): void {
  RequestAppState(AppState.Title);
  CommitAppState();
  G.g_title_start_armed = 1;
  SetBothPlayerCounters(ModeStartCounterValue(mode));
  PlayerTasksCreate();
  G.g_pad_state = PadBit.Start0;
  PlayerTaskRun(0, f);
  G.g_pad_state = 0;
  CommitAppState();
  G.g_nRunPhase = RunPhase.InPlay;
  PlayerTasksCreate();
  PlayerTasksRun(f);
}

/**
 * `[port-only]` -- the new scene's first player turn after a stage step,
 * taken at the reset for the same reason as in
 * {@link PlayerStartGameFromTitle}: row 2's hook goes in before the walker
 * enters the new scene's first scene state.
 */
export function PlayerTasksRunFirstTurn(): void {
  PlayerTasksRun(TITLE_FRAME);
}

/**
 * `AdvanceToNextScene` — `FUN_0045FFF0`, the player half: every player at 5
 * is parked at 2 for the load. `LoadSceneAndReset` and the phase step are the
 * app's (`app/main.ts`), and `PlayerTasksCreate` runs when the new scene's
 * task list is built.
 */
export function AdvanceToNextScene(): void {
  for (let p = 0; p < 2; p++) {
    if (G.g_player_state[p] === PlayerState.InPlay) {
      G.g_player_state[p] = PlayerState.SceneReentry;
    }
  }
}

/**
 * The title's frame. Nothing on the title's path draws from the generator or
 * asks the host anything -- a start press is a credit and a state -- so a
 * fixed one keeps the port's reset free of the caller's.
 */
const TITLE_FRAME: PlayerFrame = { host: NULL_HOST, rng: new Rng(1) };

/** Everything in `G` the player block and the credits are. */
export interface PlayerBlock {
  [key: string]: unknown;
}

/** The fields that survive a scene load: the engine never resets them. */
const PLAYER_BLOCK_FIELDS = [
  "g_player_state", "g_player_task", "g_player_lives",
  "g_player_lives_shown", "g_player_score", "g_player_invuln_frames",
  "g_player_ammo", "g_player_magazine_size", "g_player_continue_timer",
  "g_player_credit_seen", "g_player_gameover_timer",
  "g_player_pending_state", "g_player_no_damage", "g_players_in_play",
  "g_max_attackers", "g_credits", "g_credit_tier", "g_credit_is_continue",
  "g_free_play", "g_credits_per_player", "g_credits_to_start",
  "g_credits_to_continue", "g_title_start_armed", "g_screen_furniture_flags",
  "g_start_lives", "g_app_state", "g_nRunPhase", "g_original_weapon_kind",
  "g_player_magazine_empty", "g_player_reload_prompt_timer", "g_hud_ammo_slide",
  "g_player_input_is_gun", "g_player_pad_kind", "g_player_infinite_ammo",
  "g_original_fire_mode", "g_original_fire_latches",
] as const;

/**
 * `[port-only]` — the port reloads a stage by resetting the whole of `G`, and
 * the engine's scene load does not touch the player block. So the stage step
 * takes a copy first and puts it back after.
 */
export function PlayerBlockCapture(): PlayerBlock {
  const out: PlayerBlock = {};
  const g = G as unknown as Record<string, unknown>;
  for (const k of PLAYER_BLOCK_FIELDS) {
    out[k] = JSON.parse(JSON.stringify(g[k]));
  }
  return out;
}

/** `[port-only]` — see {@link PlayerBlockCapture}. */
export function PlayerBlockRestore(block: PlayerBlock): void {
  const g = G as unknown as Record<string, unknown>;
  for (const k of PLAYER_BLOCK_FIELDS) {
    if (k in block) g[k] = JSON.parse(JSON.stringify(block[k]));
  }
}

/**
 * The run's own phases while a stage is played: the in-play phase and the
 * continue screen it falls into when nobody is left in play.
 *
 * `RunPhaseDispatch` (`FUN_0045FEE0`) calls `g_pfnRunPhaseHandlers[phase]`
 * once a frame. Every phase here runs `RunSceneTasksAndTimers`, so the scene
 * keeps moving under the continue screen -- actors, script and all -- and the
 * only thing that differs is what happens around it. The stage-to-stage step
 * (phases 0, 1, 5, 6) and the ending (7, 8) are the app's; see `app/main.ts`.
 */
import { RequestAppState } from "./app_state";
import { CreditCount, CreditsAvailable } from "./credits";
import { GameMode } from "./game_mode";
import { AppState, G } from "./globals";
import { PlayerState, RunPhase } from "./player_state";
import { IsDemoRun, PlayerResumeContinue, g_player_state_handlers }
  from "./player_shell";
import { ContinueSprite } from "./hud_sprites";
import { DrawScreenSprite } from "./screen_sprite";
import { T } from "./tables";

/** `g_continue_timer`'s start, and what a frame takes off it. */
const CONTINUE_TIMER_START = 0x9fff;
const CONTINUE_TIMER_STEP = 0x2d;
/** `RunPhaseNoContinue` requests the game-over screen after this many. */
const NO_CONTINUE_FRAMES = 1;

/**
 * Where `RunPhaseContinueCountdown` draws "CONTINUE?" -- `PUSH 0x43000000`,
 * `PUSH 0x43480000` at `0x00460612` / `0x0046060D` -- and its digit, 64x128,
 * beside the question mark: `PUSH 0x43F10000`, `PUSH 0x433C0000` at
 * `0x0046064D` / `0x00460645`. Both at depth 1.0, scale 1, flags 0: `(x, y)`
 * is the top-left. `[proved]`
 */
export const RUN_CONTINUE_X = 128;
export const RUN_CONTINUE_Y = 200;
export const RUN_CONTINUE_DIGIT_X = 482;
export const RUN_CONTINUE_DIGIT_Y = 188;

/**
 * The continue countdown's digit: `timer >> 12`, rounding toward zero
 * (`CDQ; AND EDX, 0xFFF; ADD EAX, EDX; SAR EAX, 0xC`). 9 at `0x9FFF`, and the
 * digit changes every `0x1000 / 0x2D` -- 91 -- frames. `[port-only]` as a
 * function; it is the same three instructions at each draw.
 */
export function ContinueDigit(timer: number): number {
  return Math.trunc(timer / 0x1000);
}

/** The `out` flag of `g_player_state_handlers[state]`, at `0x00579CD4`. */
function StateIsOut(state: number): boolean {
  return (g_player_state_handlers[state]?.out ?? 0) !== 0;
}

/** Both players out: at 4 (continuing) or 9 (not playing). */
function NobodyInPlay(): boolean {
  return StateIsOut(G.g_player_state[0]) && StateIsOut(G.g_player_state[1]);
}

/**
 * `RunSceneTasksAndTimers` — `FUN_004606D0`. The task walk, then
 * `UpdateDamageRank`, the rank clock while it runs, and both players'
 * invulnerability counted down, floored at 0.
 */
export function RunSceneTasksAndTimers(walk: () => void): void {
  walk();
  UpdateDamageRank();
  if (G.g_rank_clock_on !== 0) G.g_rank_clock += 1;
  for (let p = 0; p < 2; p++) {
    G.g_player_invuln_frames[p] -= 1;
    if (G.g_player_invuln_frames[p] < 0) G.g_player_invuln_frames[p] = 0;
  }
}

/** `0x708` -- 1800 frames, 30 seconds, between the rank clock's ticks. */
const RANK_CLOCK_PERIOD = 0x708;
/** Lives a lone player must hold for a clock tick to count double. */
const RANK_LIVES_ONE = 4;
/** ...and the two players' lives together. */
const RANK_LIVES_TWO = 7;
/** A player joining moves the rank by this. */
const RANK_PER_PLAYER = 4;
/** The rank's range. */
const RANK_MAX = 0xf;

/**
 * `UpdateDamageRank` — `FUN_004607B0`. The adaptive difficulty, once a frame:
 *
 * ```
 * r = rank + (players_in_play - players_seen) * 4   // a join: +4, a drop: -4
 * if (clock % 0x708 == 0) {                          // every 30 s of clock
 *   r += 1;
 *   if (lone player with >= 4 lives, or both with >= 7 between them) r += 1;
 * }
 * r += pending; pending = 0; clamp to 0..15
 * if (r < rank) clock = 0;                           // a fall restarts the clock
 * rank = r; players_seen = players_in_play; attackers_seen = max_attackers
 * ```
 *
 * "Lone player" is `g_active_player` 0 or 1 reading that player's lives;
 * `g_active_player` 2 reads both; -1 (nobody) takes only the +1. `[proved]`
 */
export function UpdateDamageRank(): void {
  let r = G.g_damage_rank
    + (G.g_players_in_play - G.g_rank_players_seen) * RANK_PER_PLAYER;
  if (G.g_rank_clock % RANK_CLOCK_PERIOD === 0) {
    r += 1;
    const a = G.g_active_player;
    let bonus = false;
    if (a === 0 || a === 1) {
      bonus = !(G.g_player_lives[a] < RANK_LIVES_ONE);
    } else if (a === 2) {
      bonus = !(G.g_player_lives[0] + G.g_player_lives[1] < RANK_LIVES_TWO);
    }
    if (bonus) r += 1;
  }
  r += G.g_damage_rank_pending;
  G.g_damage_rank_pending = 0;
  if (r < 0) r = 0;
  else if (r > RANK_MAX) r = RANK_MAX;
  if (!(G.g_damage_rank <= r)) G.g_rank_clock = 0;
  G.g_rank_players_seen = G.g_players_in_play;
  G.g_rank_attackers_seen = G.g_max_attackers;
  G.g_damage_rank = r;
}

/**
 * `ResetDamageRank` — `FUN_00460770`. The rank a game starts at:
 * `g_initial_damage_rank[difficulty]` -- index 2 in a demo run -- **not
 * clamped** (the table holds -3); the clock on and at 1, nothing pending.
 * `UpdateDamageRank` clamps it on the same frame.
 */
export function ResetDamageRank(): void {
  const idx = IsDemoRun() ? 2 : G.g_difficulty;
  G.g_damage_rank = T.chars?.difficulty?.initial_rank?.[idx] ?? 0;
  G.g_rank_clock_on = 1;
  G.g_damage_rank_pending = 0;
  G.g_rank_clock = 1;
}

/**
 * `ResetGameOnStart` — `FUN_0045FEF0`, run phase 0, the rank half.
 *
 * `[diverges]` The rest of the routine -- the scene and block index, the
 * Original Mode loadout, the civilian and route tallies, `LoadSceneAndReset`
 * -- is the app's stage load, which the port has already done by the time the
 * first frame runs. The engine spends this frame on the load and runs the
 * tasks on the next; the port runs phase 2 on the same frame, so a game's
 * first frame is the one it always was.
 */
export function ResetGameOnStart(walk: () => void): void {
  ResetDamageRank();
  G.g_nRunPhase = RunPhase.InPlay;
  RunPhaseInPlay(walk);
}

/**
 * `RunPhaseInPlay` — `FUN_004601D0`, phase 2. With both players out it hands
 * the run to the continue screen -- phase 3 -- or, in Arcade or Original with
 * no credit to continue on, to phase 11. Then the frame, and
 * `g_screen_frames` up one (`0x00460244`).
 */
export function RunPhaseInPlay(walk: () => void): void {
  if (NobodyInPlay()) {
    if (G.g_app_state === AppState.InPlay) {
      if ((G.g_GameMode < GameMode.Training || G.g_GameMode > 3)
          && CreditsAvailable() !== 0) {
        G.g_nRunPhase = RunPhase.ContinueArm;
      } else {
        G.g_nRunPhase = RunPhase.NoContinue;
      }
    } else {
      G.g_nRunPhase = RunPhase.ContinueArm;
    }
  }
  RunSceneTasksAndTimers(walk);
  G.g_screen_frames = (G.g_screen_frames + 1) | 0;
}

/**
 * `RunPhaseContinueArm` — `FUN_004604E0`, phase 3. The frame, then the
 * countdown and the credits it watches.
 */
export function RunPhaseContinueArm(walk: () => void): void {
  RunSceneTasksAndTimers(walk);
  G.g_continue_timer = CONTINUE_TIMER_START;
  G.g_continue_credit_seen = [CreditCount(0), CreditCount(1), 0, 0];
  G.g_nRunPhase += 1;
}

/**
 * `RunPhaseContinueCountdown` — `FUN_00460530`, phase 4, the screen a
 * one-player game shows when the last life goes: the scene runs on under it,
 * and over it "CONTINUE?" and a 64x128 digit, 9 down to 0. The per-player
 * countdown defers to this one in this phase and draws neither of its own.
 *
 * A credit change restarts it. Pad bit `0x4` of a player at 4 -- the A
 * button, the trigger of a pad or of the keyboard -- knocks it to the bottom
 * of its digit. Then the two draws, with the knocked timer and before this
 * frame's step. As soon as anybody is back in play the run returns to phase
 * 2 and a player still at 4 gets their own countdown back; otherwise `0x2D`
 * comes off, and at under 1 the game-over screen is asked for. `[proved]`
 *
 * A click does not hurry it in the port, and `[likely]` does not in the game
 * either with the mouse in input mode 5, which is what the port's pointer
 * is: `InputMapDevicesToMaple` (`FUN_0041E530`) gives mode 5 the gun's pull
 * flags and writes nothing into the device's button word, which is what
 * `PadReadMapleDevices` builds `g_pad_state` from -- only mode 6 ORs the
 * mouse's buttons (left `0x4`) into it. `FUN_0041EA80`, which mode 5 also
 * calls, is unread; that is what stands between this and a proof.
 */
export function RunPhaseContinueCountdown(walk: () => void): void {
  RunSceneTasksAndTimers(walk);
  const seen = G.g_continue_credit_seen;
  if (seen[0] !== CreditCount(0) || seen[1] !== CreditCount(1)
      || seen[2] !== 0 || seen[3] !== 0) {
    G.g_continue_credit_seen = [CreditCount(0), CreditCount(1), 0, 0];
    G.g_continue_timer = CONTINUE_TIMER_START;
  }
  let pressed = G.g_player_state[0] === PlayerState.Continue
    ? G.g_pad_state & 4 : 0;
  if (G.g_player_state[1] === PlayerState.Continue) {
    pressed |= G.g_pad_state & 0x40000;
  }
  if (pressed !== 0 && G.g_continue_timer < 0x8000) {
    G.g_continue_timer = (G.g_continue_timer & ~0xfff) + 1;
  }
  DrawScreenSprite(ContinueSprite.Continue, RUN_CONTINUE_X, RUN_CONTINUE_Y);
  DrawScreenSprite(ContinueSprite.BigDigit0 + ContinueDigit(G.g_continue_timer),
                   RUN_CONTINUE_DIGIT_X, RUN_CONTINUE_DIGIT_Y);
  if (!NobodyInPlay()) {
    G.g_nRunPhase = RunPhase.InPlay;
    PlayerResumeContinue(0);
    PlayerResumeContinue(1);
  } else {
    G.g_continue_timer -= CONTINUE_TIMER_STEP;
    if (G.g_continue_timer < 1) {
      // `0x0046069F`: how many bodies the game-over screen stands up.
      G.g_game_over_players = G.g_max_attackers;
      RequestAppState(AppState.GameOver);
    }
  }
}

/**
 * `RunPhaseNoContinue` — `FUN_00460250`, phase 11. Turns the fog red (the
 * renderer's, not carried), zeroes the frame count, steps to phase 12 and
 * falls straight into it.
 */
export function RunPhaseNoContinue(walk: () => void): void {
  G.g_no_continue_frames = 0;
  G.g_nRunPhase += 1;
  RunPhaseNoContinueWait(walk);
}

/**
 * `RunPhaseNoContinueWait` — `FUN_00460350`, phase 12. The frame, and on the
 * second one the game-over screen.
 */
export function RunPhaseNoContinueWait(walk: () => void): void {
  RunSceneTasksAndTimers(walk);
  G.g_no_continue_frames += 1;
  if (G.g_no_continue_frames > NO_CONTINUE_FRAMES) {
    // `0x00460375`, the same copy as the continue screen's.
    G.g_game_over_players = G.g_max_attackers;
    RequestAppState(AppState.GameOver);
  }
}

/**
 * `RunPhaseDispatch` — `FUN_0045FEE0`, for the phases the port runs. Any other
 * phase is the app's business and the frame just runs.
 */
export function RunPhaseDispatch(walk: () => void): void {
  switch (G.g_nRunPhase) {
    case RunPhase.ResetGameOnStart: ResetGameOnStart(walk); break;
    case RunPhase.InPlay: RunPhaseInPlay(walk); break;
    case RunPhase.ContinueArm: RunPhaseContinueArm(walk); break;
    case RunPhase.ContinueCountdown: RunPhaseContinueCountdown(walk); break;
    case RunPhase.NoContinue: RunPhaseNoContinue(walk); break;
    case RunPhase.NoContinueWait: RunPhaseNoContinueWait(walk); break;
    default: RunSceneTasksAndTimers(walk); break;
  }
}

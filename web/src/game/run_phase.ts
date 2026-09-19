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
import { PlayerResumeContinue, g_player_state_handlers } from "./player_shell";

/** `g_continue_timer`'s start, and what a frame takes off it. */
const CONTINUE_TIMER_START = 0x9fff;
const CONTINUE_TIMER_STEP = 0x2d;
/** `RunPhaseNoContinue` requests the game-over screen after this many. */
const NO_CONTINUE_FRAMES = 1;

/** The `out` flag of `g_player_state_handlers[state]`, at `0x00579CD4`. */
function StateIsOut(state: number): boolean {
  return (g_player_state_handlers[state]?.out ?? 0) !== 0;
}

/** Both players out: at 4 (continuing) or 9 (not playing). */
function NobodyInPlay(): boolean {
  return StateIsOut(G.g_player_state[0]) && StateIsOut(G.g_player_state[1]);
}

/**
 * `RunSceneTasksAndTimers` — `FUN_004606D0`. The task walk, then the frame's
 * timers: both players' invulnerability counts down, floored at 0.
 *
 * `[diverges]` `UpdateDamageRank` (`FUN_004607B0`), which runs between the two,
 * is not ported, and neither is the `0x009C8A7C` frame count it reads: the
 * port applies `PlayerTakeDamage`'s rank change at once instead of through
 * `g_damage_rank_pending` (see `combat/player.ts`). Porting it moves the rank
 * on every join and every 1800 frames, which changes every stage's damage
 * and wants its own tests.
 */
export function RunSceneTasksAndTimers(walk: () => void): void {
  walk();
  for (let p = 0; p < 2; p++) {
    G.g_player_invuln_frames[p] -= 1;
    if (G.g_player_invuln_frames[p] < 0) G.g_player_invuln_frames[p] = 0;
  }
}

/**
 * `RunPhaseInPlay` — `FUN_004601D0`, phase 2. With both players out it hands
 * the run to the continue screen -- phase 3 -- or, in Arcade or Original with
 * no credit to continue on, to phase 11. Then the frame.
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
 * `RunPhaseContinueCountdown` — `FUN_00460530`, phase 4. The run's continue
 * digit, which the per-player countdown defers to in this phase. The continue
 * button of a player at 4 knocks it to the bottom of its digit. As soon as
 * anybody is back in play the run returns to phase 2 and a player still at 4
 * gets their own countdown back; if it runs out first, the game-over screen.
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
  if (!NobodyInPlay()) {
    G.g_nRunPhase = RunPhase.InPlay;
    PlayerResumeContinue(0);
    PlayerResumeContinue(1);
  } else {
    G.g_continue_timer -= CONTINUE_TIMER_STEP;
    if (G.g_continue_timer < 1) RequestAppState(AppState.GameOver);
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
    RequestAppState(AppState.GameOver);
  }
}

/**
 * `RunPhaseDispatch` — `FUN_0045FEE0`, for the phases the port runs. Any other
 * phase is the app's business and the frame just runs.
 */
export function RunPhaseDispatch(walk: () => void): void {
  switch (G.g_nRunPhase) {
    case RunPhase.InPlay: RunPhaseInPlay(walk); break;
    case RunPhase.ContinueArm: RunPhaseContinueArm(walk); break;
    case RunPhase.ContinueCountdown: RunPhaseContinueCountdown(walk); break;
    case RunPhase.NoContinue: RunPhaseNoContinue(walk); break;
    case RunPhase.NoContinueWait: RunPhaseNoContinueWait(walk); break;
    default: RunSceneTasksAndTimers(walk); break;
  }
}

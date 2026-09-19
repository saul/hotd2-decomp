/**
 * The screen request and its commit.
 *
 * The engine never changes `g_app_state` where it decides to: a routine calls
 * `RequestAppState` and the end of the frame's tick applies it through
 * `CommitAppState`, which is also what zeroes the two player counters and puts
 * both players out on every screen but the two a game runs in. The player
 * shell (`player_shell.ts`) and the continue screen (`run_phase.ts`) are the
 * port's two requesters.
 */
import { AppState, G } from "./globals";
import { PlayerState } from "./player_state";

/** `RequestAppState` — `FUN_0040E850`. `g_app_state_pending = state`. */
export function RequestAppState(state: number): void {
  G.g_app_state_pending = state;
}

/**
 * `CommitAppState` — `FUN_0040E860`. Applies a pending request, if any.
 *
 * Everything else the engine does here is the shell's and has no port: the
 * job-queue drains (`AssetDrainAllJobs`, `FUN_004A7310`, `FUN_0041D510`,
 * `FUN_0041D540`), the attract flag `0x009C71C4`, the view reset
 * `FUN_00419490(320, 240)`, and the words `0x009CA120`, and `0x009A5E00`.
 *
 * Note it clears `g_player_was_hit` for **player 0 only**: the store is to
 * `0x009A5CD0` itself.
 */
export function CommitAppState(): void {
  if (G.g_app_state_pending < 0) return;
  G.g_screen_furniture_flags = (G.g_screen_furniture_flags & 0xffffffc7) | 2;
  G.g_max_attackers = 0;
  G.g_players_in_play = 0;
  G.g_rank_attackers_seen = 0;
  G.g_rank_players_seen = 0;
  // `0x009C8E8C`, `g_screen_shake_frames`.
  G.g_screen_shake_frames = 0;
  G.g_player_was_hit[0] = 0;
  G.g_title_start_armed = 0;
  G.g_app_state = G.g_app_state_pending;
  G.g_nRunPhase = 0;
  if (G.g_app_state_pending < AppState.InPlay
      || G.g_app_state_pending > AppState.GameOver) {
    G.g_player_state[0] = PlayerState.Out;
    G.g_player_state[1] = PlayerState.Out;
  }
  G.g_app_state_pending = -1;
}

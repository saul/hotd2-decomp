/**
 * What a shot is worth, and who it is worth it to.
 *
 * One function, because the engine has one: every award and every penalty in
 * the game goes through `ScoreAddForPlayer`, and the two callers that made
 * this necessary are class 0x10's — a civilian pays **+400** when its captors
 * are killed and **-100** when the civilian itself is shot.
 */
import type { Events } from "../../core/events";
import { G } from "../globals";

/**
 * `ScoreAddForPlayer` — `FUN_004156C0`. Add `points` to one player's running
 * total, `g_player_score` (`0x009A5C6C`), **floored at zero**: a penalty
 * never takes a score below 0.
 *
 * `[diverges]` In Original Mode the engine doubles `points` while the byte at
 * `0x009A2243 + player*0x14` is 2 -- the fourth byte of the Original Mode
 * block `g_original_item_slots` starts, which the port does not carry. The
 * score popup it also drives is the HUD's.
 */
export function ScoreAddForPlayer(player: number, points: number,
                                  events?: Events): void {
  if (player < 0 || player >= G.g_player_score.length) return;
  G.g_player_score[player] += points;
  if (G.g_player_score[player] < 0) G.g_player_score[player] = 0;
  events?.emit("player.score", {
    player, points, score: G.g_player_score[player],
  });
}

/*
 * `ScoreResetAll` used to be here: a `[port-only]` reset the player's own
 * button called, added so that `render/shooting.ts` would not write
 * `g_player_score` itself. Nothing calls it any more. Both callers of
 * `Shooting.reset` — the seek and the stage load — run `ResetGameGlobals`
 * around it, which zeroes the score and `g_head_combo_bonus` exactly as
 * `ResetSceneOnEnter` (`FUN_0045EDD0`) does, so the extra entry point was one
 * more way for the data segment to be cleared and one more thing to keep in
 * step with the real reset.
 */

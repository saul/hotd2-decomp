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
 * total.
 *
 * [diverges] The engine also drives the on-screen score popup from here and
 * clamps at the display's digit count; neither is modelled. The total itself
 * is `g_player_score`, whose offset within the +player*0x98 block is still
 * `[open]` — see `globals.ts`.
 */
export function ScoreAddForPlayer(player: number, points: number,
                                  events?: Events): void {
  if (player < 0 || player >= G.g_player_score.length) return;
  G.g_player_score[player] += points;
  events?.emit("player.score", {
    player, points, score: G.g_player_score[player],
  });
}

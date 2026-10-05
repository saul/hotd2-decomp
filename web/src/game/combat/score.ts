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
import { GameMode } from "../game_mode";

/**
 * `ScoreAddForPlayer` — `FUN_004156C0`. Add `points` to one player's running
 * total, `g_player_score` (`0x009A5C6C`), **floored at zero**: a penalty
 * never takes a score below 0.
 *
 * In Original Mode `points` is doubled first while the player's
 * `g_original_score_multiplier` (`0x009A2243 + player*0x14`) is 2 -- DOUBLE
 * SCORE's -- penalties included, since the test is on the byte and not the
 * sign.
 */
export function ScoreAddForPlayer(player: number, points: number,
                                  events?: Events): void {
  if (player < 0 || player >= G.g_player_score.length) return;
  if (G.g_GameMode === GameMode.Original
      && G.g_original_score_multiplier[player] === 2) {
    points = points * 2;
  }
  G.g_player_score[player] += points;
  if (G.g_player_score[player] < 0) G.g_player_score[player] = 0;
  events?.emit("player.score", {
    player, points, score: G.g_player_score[player],
  });
}

/**
 * The score floors `ScoreRankForPlayer` steps down through: `CMP EAX, imm`
 * at `0x0043621C`, `26`, `33`, `40`, `4D` and `5A`, each a `JL` past its
 * rank, and the last rank's `CMP EAX, 0x5DC0` / `SETL` at `0x00436269`.
 */
const SCORE_RANK_FLOORS = [80000, 72000, 64000, 56000, 46000, 36000] as const;
const SCORE_RANK_LAST_FLOOR = 24000;

/**
 * `ScoreRankForPlayer` — `FUN_00436200`. A player's score as a rank, 0 the
 * best: one rank for each of {@link SCORE_RANK_FLOORS} the score is not below,
 * then 6, or 7 below {@link SCORE_RANK_LAST_FLOOR}. Signed compares.
 *
 * `mode` is the routine's second argument and the routine does test it
 * (`CMP ECX, 0x1` at `0x00436211`), but its two arms, `0x0043621C` and
 * `0x00436277`, are the same seven compares against the same seven
 * immediates, instruction for instruction -- so it changes nothing and the
 * port has one copy of them. Kept as a parameter because both callers pass it.
 */
export function ScoreRankForPlayer(player: number, _mode: number): number {
  const score = G.g_player_score[player];
  for (let rank = 0; rank < SCORE_RANK_FLOORS.length; rank++) {
    if (score >= SCORE_RANK_FLOORS[rank]) return rank;
  }
  return SCORE_RANK_FLOORS.length + (score < SCORE_RANK_LAST_FLOOR ? 1 : 0);
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

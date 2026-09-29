/**
 * The accuracy grade: the bonus the last step of a boss block pays, and the
 * switch that keeps a boss fight's shots out of it.
 *
 * Two evt opcodes, both in every result block's step 1 (`docs/re/
 * stage-end.md`, section 6): `suppress_accuracy_stats 1` before the fight and
 * `award_accuracy_bonus` after it. The counters they read are
 * `g_player_shot_count` -- counted at the pull, `combat/shot.ts` -- and
 * `g_player_hit_count`, counted where each class pays for a hit.
 */
import type { Events } from "../../core/events";
import { AccuracyBonusAt } from "../class61/rdata";
import { G } from "../globals";
import { PlayerState } from "../player_state";
import { ScoreAddForPlayer } from "./score";

/** `CMP CX, 0x14; JL` at `0x0045FE53`: twenty shots before a grade counts. */
export const ACCURACY_MIN_SHOTS = 0x14;

/**
 * `EvtOpSuppressAccuracyStats2F` — `FUN_0045FE20`. Opcode `0x2F`'s s16 at
 * `+4` into `g_accuracy_stats_suppressed`; `ip += 8` is the walker's.
 */
export function EvtOpSuppressAccuracyStats2F(value: number): void {
  G.g_accuracy_stats_suppressed = (value << 16) >> 16;
}

/**
 * `EvtOpAwardAccuracyBonus2B` — `FUN_0045FE40`, opcode `0x2B`.
 *
 * ```
 * for (p = 0; p < 2; p++)
 *   if (g_player_state[p] == 5 && g_player_shot_count[p] >= 0x14)
 *     ScoreAddForPlayer(p, g_accuracy_bonus_table[
 *         (g_player_hit_count[p] * 100 / g_player_shot_count[p]) / 10]);
 * ```
 *
 * Both divisions are `IDIV`, truncating; the counts are s16 (`MOVSX`). The
 * index is not bounded: a player whose hits outrun his counted shots -- hits
 * on a boss's summons while the shots are suppressed -- reads past the
 * table's eleven entries, and the bundle carries what the exe reads there
 * (`AccuracyBonusAt`). `[proved]`
 */
export function EvtOpAwardAccuracyBonus2B(events?: Events): void {
  for (let p = 0; p < 2; p++) {
    if (G.g_player_state[p] !== PlayerState.InPlay) continue;
    const shots = (G.g_player_shot_count[p] << 16) >> 16;
    if (shots < ACCURACY_MIN_SHOTS) continue;
    const hits = (G.g_player_hit_count[p] << 16) >> 16;
    const pct = Math.trunc((hits * 100) / shots);
    ScoreAddForPlayer(p, AccuracyBonusAt(Math.trunc(pct / 10)), events);
  }
}

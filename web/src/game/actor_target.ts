/**
 * Which player an attack is aimed at.
 */
import type { Rng } from "../core/rng";
import { G } from "./globals";

/**
 * `ActorPickTargetPlayer` — `FUN_00426170`. The player an actor's attack goes
 * for, which the engine writes into `obj+0x121` (`MOV byte ptr [ESI + 0x121],
 * ...`); the port returns it and each caller stores it in its own `+0x121`
 * field -- an actor's `attackPermit`, a carried prop's `player` -- because the
 * two are different records in the port and one byte in the engine.
 *
 * ```
 * obj+0x121 = 0
 * switch (g_players_in_play) {
 * case 1: obj+0x121 = (u8)g_active_player; break
 * case 2:
 *     if (g_player_invuln_frames[1]) { obj+0x121 = 0; break }
 *     if (g_player_invuln_frames[0]) { obj+0x121 = 1; break }
 *     more = lives[0] > lives[1] ? 0 : 1;  other = more ^ 1
 *     obj+0x121 = rand() % (lives[more] - lives[other] + 2) == 0 ? other : more
 * }
 * ```
 *
 * So with two players the one who is **ahead** on lives is chosen more often
 * -- `(n+1)/(n+2)` of the time for a lead of `n` -- and on equal lives it is a
 * coin toss. A player still flashing from a hit is never picked while the
 * other is not. `[proved]` from `0x00426176`..`0x00426228`; the annotation
 * said the one behind was preferred, which is the other arm of the division.
 */
export function ActorPickTargetPlayer(rng: Rng): number {
  switch (G.g_players_in_play) {
    case 1:
      // `MOV AL, [0x009C7000]` -- the low byte of `g_active_player`.
      return (G.g_active_player << 24) >> 24;
    case 2: {
      if (G.g_player_invuln_frames[1] !== 0) return 0;
      if (G.g_player_invuln_frames[0] !== 0) return 1;
      const l0 = G.g_player_lives[0] ?? 0;
      const l1 = G.g_player_lives[1] ?? 0;
      const more = l0 > l1 ? 0 : 1;
      const other = more ^ 1;
      const span = (G.g_player_lives[more] ?? 0) - (G.g_player_lives[other] ?? 0)
        + 2;
      return rng.int(span) === 0 ? other : more;
    }
    default:
      return 0;
  }
}

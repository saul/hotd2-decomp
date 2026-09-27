/**
 * `ActorPickTargetPlayer` — `FUN_00426170`: which player a boss's next attack
 * is aimed at, written to `obj+0x121`.
 *
 * Five callers, all bosses: `Class14StateHunt` (`0x00478B62`) and
 * `Class14StateScriptedBreak` (`0x0047B213`) for the stage-2 boss, and three
 * stage-4 boss states (`0x00493F06`, `0x00494EC4`, `0x00495267`). The attacks
 * that follow read `obj+0x121` as the player `PlayerTakeDamage` hurts and, with
 * two players, the camera-space offset they aim at.
 */
import type { Rng } from "../core/rng";
import type { Actor } from "./actor";
import { G } from "./globals";

/**
 * `ActorPickTargetPlayer` — `FUN_00426170`. `[proved]`, the whole routine:
 *
 * ```c
 * obj+0x121 = 0;
 * if (g_players_in_play == 1) { obj+0x121 = g_active_player; return; }
 * if (g_players_in_play != 2) return;
 * if (g_player_invuln_frames[1]) { obj+0x121 = 0; return; }
 * if (g_player_invuln_frames[0]) { obj+0x121 = 1; return; }
 * more = g_player_lives[0] <= g_player_lives[1];       // the one with more
 * r = rand();
 * obj+0x121 = (r % (lives[more] - lives[!more] + 2) == 0) ? !more : more;
 * ```
 *
 * So with two players it avoids one who is still flashing from a hit, and
 * otherwise leans toward the player with **more** lives: `lives[more] -
 * lives[!more]` is that player's lead (0 on a tie, when player 1 counts as
 * the one with more), so the modulus is 2 plus the lead and the other player
 * is picked only once in that many. With one player there is no draw at all.
 */
export function ActorPickTargetPlayer(obj: Actor, rng: Rng): void {
  obj.attackPermit = 0;
  if (G.g_players_in_play === 1) {
    obj.attackPermit = G.g_active_player;
    return;
  }
  if (G.g_players_in_play !== 2) return;
  if ((G.g_player_invuln_frames[1] ?? 0) !== 0) {
    obj.attackPermit = 0;
    return;
  }
  if ((G.g_player_invuln_frames[0] ?? 0) !== 0) {
    obj.attackPermit = 1;
    return;
  }
  const l0 = G.g_player_lives[0] ?? 0;
  const l1 = G.g_player_lives[1] ?? 0;
  const more = l0 <= l1 ? 1 : 0;
  const lives = [l0, l1];
  // `_rand() % (lives[more] - lives[!more] + 2)` -- `CDQ; IDIV`, a signed
  // remainder of a non-negative `rand()`, so `Rng.int` of the modulus (L46).
  const m = lives[more] - lives[more ^ 1] + 2;
  const r = rng.int(m);
  obj.attackPermit = r === 0 ? (more ^ 1) : more;
}

/**
 * Which players' marks a shot handler resolves, and in what order.
 *
 * `MarkActorShot` (`FUN_00404DB0`) raises one bit per shooter on the actor,
 * and the class's own handler resolves them later in its update. Before any
 * handler walks those bits it asks this routine for the order, and in a
 * two-player game the order is a coin: a frame on which both players hit the
 * same enemy pays whichever the coin puts first.
 */
import type { Rng } from "../../core/rng";
import { G } from "../globals";

/**
 * `ChooseHitPlayerOrder` — `FUN_004093C0`. `[proved]` from the listing:
 *
 * ```c
 * g_hit_player_order[0] = g_hit_player_order[1] = -1;
 * if (g_active_player == 0) g_hit_player_order[0] = 0;
 * else if (g_active_player == 1) g_hit_player_order[0] = 1;
 * else if (g_active_player == 2) {
 *     if (rand() % 2) { [0] = 0; [1] = 1; } else { [0] = 1; [1] = 0; }
 * }
 * ```
 *
 * The draw is taken **only with both players in**, so a one-player run's
 * random stream does not move here. `DispatchHit` (`FUN_004092F0`) opens with
 * it; the port's `DispatchHit` resolves one queued request at a time and
 * does not (`combat/resolve_hit.ts` says why). `FrogAwardKillAndEnterDeath`
 * (`FUN_0043A2E0`) calls it on the frame a frog dies and then never reads the
 * order -- the call stays, because in a two-player game it is a draw.
 */
export function ChooseHitPlayerOrder(rng: Rng): void {
  const order = G.g_hit_player_order;
  order[0] = -1;
  order[1] = -1;
  if (G.g_active_player === 0) {
    order[0] = 0;
  } else if (G.g_active_player === 1) {
    order[0] = 1;
  } else if (G.g_active_player === 2) {
    if (rng.int(2) !== 0) {
      order[0] = 0;
      order[1] = 1;
    } else {
      order[0] = 1;
      order[1] = 0;
    }
  }
}

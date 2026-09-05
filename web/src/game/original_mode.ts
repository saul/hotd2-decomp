/**
 * Original Mode's two-slot inventory, and the one query the branch triggers
 * make of it.
 *
 * Three of the sixteen writers of `g_script_branch_var` do not open their
 * route on a shot alone — they open it on a shot **while the player is
 * carrying the right key**. `PropUpdateType73` wants item 5, 6 or 0x0C,
 * `PropUpdateType76` wants 0, 2 or 0x0B, and `StoryModeSwitchUpdate` wants
 * any of the four ids its descriptor names. That is the whole reason this
 * file exists: without the query those three routes read as unconditional,
 * which is a different game.
 */
import { G } from "./globals";

/**
 * `PlayerHoldsOriginalItem` — `FUN_00461C70`.
 *
 * ```c
 * if (g_players_in_play == 1) {
 *     if (g_original_item_slots[g_active_player][0] != id
 *      && g_original_item_slots[g_active_player][1] != id) return 0;
 * } else if (g_players_in_play == 2) {
 *     if (g_original_item_slots[0][0] != id
 *      && g_original_item_slots[1][0] != id) return 0;
 * } else return 0;
 * return 1;
 * ```
 *
 * **The two-player arm reads a different pair of slots**, not the same two:
 * one player checks both of its own slots, two players check slot 0 of each.
 * Folding that into "is `id` anywhere in the inventory" would let a
 * two-player run open a route on a key sitting in a second slot the engine
 * never looks at.
 *
 * The second slot is read as a **signed byte** in the engine
 * (`(char)(&DAT_009A2241)[...]`) and the first as a byte, which is why an
 * empty slot of -1 can never match a real id.
 */
export function PlayerHoldsOriginalItem(id: number): boolean {
  if (G.g_players_in_play === 1) {
    const slots = G.g_original_item_slots[G.g_active_player];
    if (!slots) return false;
    return slots[0] === id || slots[1] === id;
  }
  if (G.g_players_in_play === 2) {
    return (G.g_original_item_slots[0]?.[0] === id)
      || (G.g_original_item_slots[1]?.[0] === id);
  }
  return false;
}

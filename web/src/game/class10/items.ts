/**
 * Ops 0x13, 0x14 and 0x15 — what a civilian is holding.
 *
 * Three routines of their own in the engine and three here, because that is
 * what they are: `CivilianRunScript` (`FUN_0048B9E0`) calls out to each rather
 * than growing the array itself. All three are **drawing** in the end —
 * `CivilianDrawHeldItems` (`FUN_0048CD10`) puts each model on the bone the
 * character's attach set names, and that is `syncHeldItems` in
 * `render/characters.ts` — but *which* item is drawn is state, drawn from
 * `ctx.rng`, and so it is this side's.
 */
import type { CivilianCmdJson } from "../../bundle/scene";
import type { Rng } from "../../core/rng";
import type { CivilianState } from "./state";

/**
 * `CivilianAddHeldItem` — `FUN_0048CAE0`.
 *
 * Grows the array by one and appends. The engine's second operand is the
 * pair's other half, which only the per-item callback reads and nothing here
 * does.
 */
export function CivilianAddHeldItem(sub: CivilianState,
                                    c: CivilianCmdJson): void {
  if ((c.item ?? -1) >= 0) sub.items.push(c.item!);
}

/**
 * `CivilianAddPickedItem` — `FUN_0048CB60`. The same, with whatever
 * {@link CivilianPickHeldItem} last chose.
 */
export function CivilianAddPickedItem(sub: CivilianState): void {
  if (sub.pickedItem >= 0) sub.items.push(sub.pickedItem);
}

/**
 * `CivilianPickHeldItem` — `FUN_0048CBF0`.
 *
 * Sums the weights, takes `rand() % total`, and walks the list subtracting
 * until it goes negative. Drawn from `ctx.rng` — `Math.random` would break the
 * snapshot, and which bottle a civilian is holding is state.
 *
 * [diverges] The engine also preloads the chosen record's two assets, the
 * second through a per-kind table at 0x0056B0F4. Loading is the renderer's.
 */
export function CivilianPickHeldItem(sub: CivilianState, c: CivilianCmdJson,
                                     rng?: Rng): void {
  const tbl = c.itemTable ?? [];
  const total = tbl.reduce((n, e) => n + e[0], 0);
  if (total <= 0 || !rng) return;
  let r = rng.int(total) - (tbl[0]?.[0] ?? 0);
  let i = 0;
  while (r >= 0 && i + 1 < tbl.length) { i += 1; r -= tbl[i][0]; }
  sub.pickedItem = tbl[i]?.[1] ?? -1;
}

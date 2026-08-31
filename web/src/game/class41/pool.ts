/**
 * The container pool's frame, and the dispatch that stands in for the engine
 * calling each object through its own entry point.
 *
 * This lives apart from `prop.ts` on purpose. All three update routines need
 * `ActorDespawnProp` and `BreakablePropAwardHit`, which are in `prop.ts`, so
 * putting the dispatch there too made `prop -> container -> prop` a cycle.
 * Both directions happened to be call-time rather than load-time and so it
 * worked — but this project has now lost an hour twice to an ESM cycle
 * resolving a table to `undefined`, and a third was not worth the risk.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { FallingContainerUpdate } from "../class44/container";
import { GENERIC_ORIGINAL_MODE_ONLY } from "./generic";
import { KindedPropUpdate } from "./kinded";
import { PropExpireByBlockLifetime } from "./lifetime";
import { ActorDespawnProp, BreakablePropUpdate } from "./prop";
import { PropFamily, type BreakableProp } from "./prop_state";
import { LiftUpdate } from "./lift";

/**
 * Every live container, once a frame.
 *
 * `PropFamily` is the routine `ActorAlloc` was handed, so switching on it here
 * is the call the engine makes indirectly. `Generic` is the arm with no
 * behaviour behind it — those objects are placed and drawn and otherwise do
 * nothing, which is declared in `class41/generic.ts` — but it is **not** an
 * empty arm: twenty-five of the routines it stands for open with
 * `PropExpireByBlockLifetime`, and a prop that never expires is a prop that
 * stands in the level for the rest of the stage.
 */
export function BreakablePropPoolUpdate(rng: Rng, events?: Events): void {
  for (const p of G.g_breakable_props) {
    if (p.dead) continue;
    switch (p.family) {
      case PropFamily.Kinded: KindedPropUpdate(p, rng, events); break;
      case PropFamily.Falling: FallingContainerUpdate(p, rng, events); break;
      case PropFamily.Lift: LiftUpdate(p, events); break;
      case PropFamily.Generic: GenericPropUpdate(p); break;
      default: BreakablePropUpdate(p, rng, events); break;
    }
  }
  if (G.g_breakable_props.some((p) => p.dead)) {
    G.g_breakable_props = G.g_breakable_props.filter((p) => !p.dead);
  }
}

/**
 * The two lines every unported generic routine still owes the level.
 *
 * Not a function in the exe — it is the head of thirty of them, and the two
 * things they all do before whatever else they do. A prop that runs neither
 * is a prop that stands in the stage for ever.
 */
function GenericPropUpdate(p: BreakableProp): void {
  // `if (g_GameMode != 1) { ActorDespawn(obj); return; }` — Original Mode's
  // collectibles, gone on their first frame in Arcade.
  if (GENERIC_ORIGINAL_MODE_ONLY.has(p.kind) && G.g_GameMode !== 1) {
    ActorDespawnProp(p);
    return;
  }
  PropExpireByBlockLifetime(p);
}

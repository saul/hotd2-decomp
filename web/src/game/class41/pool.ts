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
import { KindedPropUpdate } from "./kinded";
import { BreakablePropUpdate } from "./prop";
import { PropFamily } from "./prop_state";

/**
 * Every live container, once a frame.
 *
 * `PropFamily` is the routine `ActorAlloc` was handed, so switching on it here
 * is the call the engine makes indirectly. `Generic` is the one arm with no
 * routine behind it: those objects are placed and drawn and do nothing, which
 * is declared in `class41/generic.ts`.
 */
export function BreakablePropPoolUpdate(rng: Rng, events?: Events): void {
  for (const p of G.g_breakable_props) {
    if (p.dead) continue;
    switch (p.family) {
      case PropFamily.Kinded: KindedPropUpdate(p, rng, events); break;
      case PropFamily.Falling: FallingContainerUpdate(p, rng, events); break;
      case PropFamily.Generic: break;
      default: BreakablePropUpdate(p, rng, events); break;
    }
  }
  if (G.g_breakable_props.some((p) => p.dead)) {
    G.g_breakable_props = G.g_breakable_props.filter((p) => !p.dead);
  }
}

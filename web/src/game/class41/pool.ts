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
import {
  ChainSegmentUpdate, OriginalItemPropUpdate, StoryModeSwitchUpdate,
  PropUpdateType14,
  PropUpdateType19, PropUpdateType25, PropUpdateType40, PropUpdateType56,
  PropUpdateType69, PropUpdateType73, PropUpdateType76,
} from "./branch";
import { GENERIC_ORIGINAL_MODE_ONLY } from "./generic";
import { KindedPropUpdate } from "./kinded";
import { PropExpireByStepLifetime } from "./lifetime";
import { ActorDespawnProp, BreakablePropUpdate } from "./prop";
import { HIT_FLAG_MASK, PropFamily, type BreakableProp }
  from "./prop_state";
import { LiftUpdate } from "./lift";

/**
 * Every live container, once a frame.
 *
 * `PropFamily` is the routine `ActorAlloc` was handed, so switching on it here
 * is the call the engine makes indirectly. `Generic` is the arm with no
 * behaviour behind it — those objects are placed and drawn and otherwise do
 * nothing, which is declared in `class41/generic.ts` — but it is **not** an
 * empty arm: twenty-five of the routines it stands for open with
 * `PropExpireByStepLifetime`, and a prop that never expires is a prop that
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
      case PropFamily.StoryModeSwitch: StoryModeSwitchPoolUpdate(p); break;
      default: BreakablePropUpdate(p, rng, events); break;
    }
  }
  if (G.g_breakable_props.some((p) => p.dead)) {
    G.g_breakable_props = G.g_breakable_props.filter((p) => !p.dead);
  }
}

/**
 * `g_class41_updates[type]`, for the types that have a port.
 *
 * This table **is** the engine's indirect call: `ActorAlloc` was handed
 * `g_class41_updates[obj->+0x130C]` and the object calls through it every
 * frame, so switching on the type here is that call written out. Nine of the
 * ten entries are branch triggers — see `class41/branch.ts` — because a route
 * the stage takes is worth more than a swing.
 *
 * A type absent here is placed, drawn and otherwise inert, which is the
 * standing divergence `class41/generic.ts` declares.
 */
const GENERIC_UPDATE: Partial<Record<number, (p: BreakableProp) => void>> = {
  14: PropUpdateType14,
  19: PropUpdateType19,
  25: PropUpdateType25,
  40: PropUpdateType40,
  56: PropUpdateType56,
  69: PropUpdateType69,
  70: OriginalItemPropUpdate,
  71: OriginalItemPropUpdate,
  73: PropUpdateType73,
  76: PropUpdateType76,
};

/**
 * The two lines every unported generic routine still owes the level, and then
 * whatever that type's own routine does.
 *
 * The prologue is not a function in the exe — it is the head of thirty of
 * them, and the two things they all do before whatever else they do. A prop
 * that runs neither is a prop that stands in the stage for ever.
 *
 * **The hit bits are cleared here**, after the type's routine has read them.
 * Every one of these routines masks `obj+0x34` itself, and a prop whose hit
 * bit survived the frame would answer its branch on every frame afterwards.
 */
function GenericPropUpdate(p: BreakableProp): void {
  // `if (g_GameMode != 1) { ActorDespawn(obj); return; }` — Original Mode's
  // collectibles, gone on their first frame in Arcade.
  if (GENERIC_ORIGINAL_MODE_ONLY.has(p.kind) && G.g_GameMode !== 1) {
    ActorDespawnProp(p);
    return;
  }
  if (PropExpireByStepLifetime(p)) return;
  if (p.chainGroup > 0) {
    ChainSegmentUpdate(p, ChainSegmentZero(p.chainGroup));
  } else {
    GENERIC_UPDATE[p.kind]?.(p);
  }
  p.flags &= ~HIT_FLAG_MASK;
}

/**
 * `StoryModeSwitchUpdate`'s own frame — its removal flag, then its route.
 *
 * It does **not** run `PropExpireByStepLifetime`: `PlaceStoryModeSwitch`
 * writes `obj+0x11C` as a literal 1, so that word is not a lifetime here and
 * counting against it would retire every switch in the game one step boundary
 * after it was placed.
 *
 * [port-only] as a *function*: the head of `StoryModeSwitchUpdate`, split from
 * the branch arm so the pool has one call to make.
 */
function StoryModeSwitchPoolUpdate(p: BreakableProp): void {
  // `if (obj->+0x2A4 >= 0 && g_script_flags[obj->+0x2A4] == 1) ActorDespawn;`
  if (p.removeFlag >= 0 && (G.g_script_flags[p.removeFlag] ?? 0) === 1) {
    ActorDespawnProp(p);
    return;
  }
  // `if (g_scene_index == 1 && g_script_flags[0x77]) ActorDespawn;` — the
  // scene-1 sweep every prop family answers.
  if (G.g_scene_index === 1 && (G.g_script_flags[0x77] ?? 0) !== 0) {
    ActorDespawnProp(p);
    return;
  }
  StoryModeSwitchUpdate(p);
  p.flags &= ~HIT_FLAG_MASK;
}

/**
 * Segment 0 of a chain group — where `ChainSegmentUpdate` keeps the latch
 * that stops twenty links opening one route twenty times.
 *
 * `g_chain_segments[group * 0x14 + 0]`, by prop id, because the port's pool
 * is a list and the engine's is an array of pointers.
 */
function ChainSegmentZero(group: number): BreakableProp | undefined {
  const id = G.g_chain_segments[group * 0x14];
  if (!id) return undefined;
  return G.g_breakable_props.find((q) => q.id === id);
}

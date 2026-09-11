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
import { RisingDoorUpdate } from "../class44/rising_door";
import { ScriptFlagEffectUpdate } from "../class44/script_flag_effect";
import {
  ChainSegmentUpdate, OriginalItemPropUpdate, StoryModeSwitchUpdate,
  PropUpdateType14,
  PropUpdateType19, PropUpdateType25, PropUpdateType40, PropUpdateType56,
  PropUpdateType69, PropUpdateType73, PropUpdateType76,
  STORY_SWITCH_FLAG_AT, STORY_SWITCH_SCRIPT_FLAG,
} from "./branch";
import { PropUpdateType75 } from "./flag_prop";
import {
  PropDrawOnlyType31, PropDrawOnlyType53, PropDrawOnlyType54,
} from "./draw_only";
import { GENERIC_ORIGINAL_MODE_ONLY } from "./generic";
import { KindedPropUpdate } from "./kinded";
import { PropExpireByStepLifetime } from "./lifetime";
import {
  ClearPropShotTestList, GenericPropRegisterForShotTest, PropRegisterAtOrigin,
} from "./shot_test";
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
  // `DAT_005A4C80 = 0` — `ProcessPlayerShots` empties the registration list at
  // the end of its pass, so every object has to publish itself again. That is
  // what makes a prop which returned early this frame unshootable for exactly
  // as long as the engine makes it. See `class41/shot_test.ts`.
  ClearPropShotTestList();
  for (const p of G.g_breakable_props) {
    if (p.dead) continue;
    switch (p.family) {
      case PropFamily.Kinded: KindedPropUpdate(p, rng, events); break;
      case PropFamily.Falling: FallingContainerUpdate(p, rng, events); break;
      case PropFamily.Lift: LiftUpdate(p, events); break;
      case PropFamily.Generic: GenericPropUpdate(p); break;
      case PropFamily.StoryModeSwitch: StoryModeSwitchPoolUpdate(p); break;
      case PropFamily.ScriptFlagEffect:
        ScriptFlagEffectUpdate(p, events); break;
      // No prologue and no shot-test tail around this one either:
      // `RisingDoorUpdate` has no `PropExpireByStepLifetime`, no `AND` on
      // `obj+0x34` and no `RegisterForShotTest` in it. Its remove flag is its
      // whole lifetime.
      case PropFamily.RisingDoor: RisingDoorUpdate(p); break;
      // No `p.flags &= ~HIT_FLAG_MASK` and no `PropExpireByStepLifetime`
      // around this one: `PropUpdateType75` inlines its own variant of the
      // prologue and has no `AND` on `obj+0x34` anywhere in it. Adding either
      // here would be two lines the engine does not run.
      case PropFamily.Type75: PropUpdateType75(p, rng, events); break;
      // Neither of these calls `PropExpireByStepLifetime` — 53 inlines its
      // own variant of it and 54 has no lifetime at all — so neither can ride
      // the generic arm, which runs that prologue before it dispatches.
      // Neither masks `obj+0x34` and neither registers a shot sphere either.
      case PropFamily.DrawOnlyType53: PropDrawOnlyType53(p); break;
      case PropFamily.DrawOnlyType54: PropDrawOnlyType54(p); break;
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
  // 31 *does* open with `PropExpireByStepLifetime`, so unlike 53 and 54 it
  // rides the generic arm and only owes its camera cue and its strip cursor.
  31: PropDrawOnlyType31,
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
  // The tail thirty of these routines share: publish the sphere. A chain
  // segment registers its own link's origin; everything else goes through the
  // per-type offset table.
  if (p.chainGroup > 0) PropRegisterAtOrigin(p);
  else GenericPropRegisterForShotTest(p);
}

/**
 * `StoryModeSwitchUpdate`'s own frame — its removal flag, the script flag its
 * head raises, then its route.
 *
 * It does **not** run `PropExpireByStepLifetime`: `PlaceStoryModeSwitch`
 * writes `obj+0x11C` as a literal 1, so that word is not a lifetime here and
 * counting against it would retire every switch in the game one step boundary
 * after it was placed.
 *
 * [port-only] as a *function*: the head of `StoryModeSwitchUpdate`
 * (`FUN_00474F30`), split from the branch arm so the pool has one call to
 * make. **The split is between the two despawn tests and the mode gate**, at
 * `0x00474FB4`, which is exactly where the engine's `CMP g_GameMode, 1` is —
 * so everything in here runs in Arcade and everything in
 * {@link StoryModeSwitchUpdate} does not.
 */
function StoryModeSwitchPoolUpdate(p: BreakableProp): void {
  // `if (obj->+0x2A4 >= 0 && g_script_flags[obj->+0x2A4] == 1) ActorDespawn;`
  if (p.removeFlag >= 0 && (G.g_script_flags[p.removeFlag] ?? 0) === 1) {
    ActorDespawnProp(p);
    return;
  }
  // ```c
  // if (g_scene_index == 1) {
  //     if (g_script_flags[0x77] != 0) { ActorDespawn(obj); return; }
  // } else if (g_scene_index == 2 && g_evt_block_index == 2
  //            && obj->+0x192 == 0) {
  //     g_script_flags[0x15] = 1;                       // 0x00474FA6
  // }
  // ```
  //
  // An `if`/`else if`, and the `else` is load-bearing: the second arm is not a
  // separate test the engine also makes. The scene-1 arm is the sweep every
  // prop family answers; the scene-2 arm is the flag stage 3's block 2 waits
  // on, raised **every frame** while the switch is unthrown and with no
  // reference to `g_GameMode` — see `STORY_SWITCH_SCRIPT_FLAG`.
  if (G.g_scene_index === 1) {
    if ((G.g_script_flags[0x77] ?? 0) !== 0) {
      ActorDespawnProp(p);
      return;
    }
  } else if (G.g_scene_index === STORY_SWITCH_FLAG_AT[0]
             && G.g_evt_block_index === STORY_SWITCH_FLAG_AT[1]
             // `obj+0x192`, and for this family that word is the branch latch
             // — `L3`. Unthrown is what the write is gated on: once the switch
             // has been shot it is the *second* write, behind the mode gate
             // and the item spawn, that raises the flag instead.
             && !p.branchLatched) {
    G.g_script_flags[STORY_SWITCH_SCRIPT_FLAG] = 1;
  }
  StoryModeSwitchUpdate(p);
  p.flags &= ~HIT_FLAG_MASK;
  PropRegisterAtOrigin(p);
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

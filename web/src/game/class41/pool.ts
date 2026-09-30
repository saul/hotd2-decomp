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
import { FallingContainerFragmentUpdate }
  from "../class44/container_fragment";
import type { GameHost } from "../host";
import { PropShattersTick, type ShatterCamera } from "./shatter";
import { RisingDoorUpdate } from "../class44/rising_door";
import { RiseToHeightUpdate } from "../class44/rise_to_height";
import { PropDrawOnlySelector14 } from "../class44/draw_only";
import { ScriptFlagEffectUpdate } from "../class44/script_flag_effect";
import {
  ChainSegmentUpdate, StoryModeSwitchUpdate,
  STORY_SWITCH_FLAG_AT, STORY_SWITCH_SCRIPT_FLAG,
} from "./branch";
import {
  PropDrawOnlyType33, PropDrawOnlyType53, PropDrawOnlyType54,
} from "./draw_only";
import { GENERIC_ROUTINES } from "./generic_routines";
import { OriginalItemBannersTick } from "./item_banner";
import { PropUpdateType13 } from "./type13";
import { OriginalItemDropUpdate } from "./type07";
import { Type8MountedPartUpdate } from "./type08";
import { Type67MountedPartUpdate } from "./type67";
import { PropUpdateType43 } from "./type43";
import { PropUpdateType48FlickerLight } from "./type48";
import { KindedPropUpdate } from "./kinded";
import { PropExpireByStepLifetime } from "./lifetime";
import { ClearPropShotTestList, PropRegisterAtOrigin } from "./shot_test";
import { ActorDespawnProp, BreakablePropUpdate } from "./prop";
import { HIT_FLAG_MASK, PropFamily, type BreakableProp }
  from "./prop_state";
import { LiftUpdate } from "./lift";
import { PropUpdateType38 } from "./type38";
import { PropUpdateType39 } from "./type39";
import { PropUpdateType40 } from "./type40";
import { PropUpdateType44 } from "./type44";
import { PropUpdateType66 } from "./type66";
import { PropDrawOnlyType12 } from "./type12";

/**
 * Every live container, once a frame.
 *
 * `PropFamily` is the routine `ActorAlloc` was handed, so switching on it here
 * is the call the engine makes indirectly. `Generic` is `g_class41_updates`
 * itself, one row per type (see {@link GenericPropUpdate}).
 */
export function BreakablePropPoolUpdate(rng: Rng, events?: Events,
                                        host?: GameHost): void {
  // `DAT_005A4C80 = 0` — `ProcessPlayerShots` empties the registration list at
  // the end of its pass, so every object has to publish itself again. That is
  // what makes a prop which returned early this frame unshootable for exactly
  // as long as the engine makes it. See `class41/shot_test.ts`.
  ClearPropShotTestList();
  // Last frame's final draws have been shown; this frame makes its own.
  G.g_prop_final_draws = [];
  // The view the group props' draw blocks compose onto this frame -- what
  // `MatrixStore(obj+0x2E4)` keeps under the model, and what the shatter's
  // `MatrixInvert(0)` takes back off. Null with no camera.
  const w2v: number[] = new Array(16).fill(0);
  const v2w: number[] = new Array(16).fill(0);
  const cam: ShatterCamera | null =
    host?.cameraMatrices?.(w2v, v2w) ? { w2v, v2w } : null;
  // `for...of` over the live array on purpose: `ActorAlloc` appends to the
  // task list the walk is on, so the two pieces a falling container throws
  // take their first step on the frame they are thrown, after everything
  // that was already there.
  for (const p of G.g_breakable_props) {
    if (p.dead) continue;
    switch (p.family) {
      case PropFamily.Kinded: KindedPropUpdate(p, rng, events); break;
      case PropFamily.Falling: FallingContainerUpdate(p, rng, events); break;
      // No prologue, no hit arm, no shot test: the routine is a lifetime, a
      // tumble and a landing. See `class44/container_fragment.ts`.
      case PropFamily.ContainerFragment:
        FallingContainerFragmentUpdate(p, rng, events); break;
      case PropFamily.Lift: LiftUpdate(p, events); break;
      case PropFamily.Generic: GenericPropUpdate(p, rng, events); break;
      case PropFamily.StoryModeSwitch: StoryModeSwitchPoolUpdate(p); break;
      case PropFamily.ScriptFlagEffect:
        ScriptFlagEffectUpdate(p, events); break;
      // No prologue and no shot-test tail around this one either:
      // `RisingDoorUpdate` has no `PropExpireByStepLifetime`, no `AND` on
      // `obj+0x34` and no `RegisterForShotTest` in it. Its remove flag is its
      // whole lifetime.
      case PropFamily.RisingDoor: RisingDoorUpdate(p); break;
      // Nor around selector 13's: its remove flag and a camera cue are its
      // lifetime, and its shot-test call is its own, behind `obj+0x14C`.
      case PropFamily.RiseToHeight: RiseToHeightUpdate(p); break;
      // Selector 14 opens on the prologue itself and registers nothing.
      case PropFamily.DrawOnlySelector14: PropDrawOnlySelector14(p); break;
      // Neither of these calls `PropExpireByStepLifetime` — 53 inlines its
      // own variant of it and 54 has no lifetime at all — so neither can ride
      // the generic arm, which runs that prologue before it dispatches.
      // Neither masks `obj+0x34` and neither registers a shot sphere either.
      case PropFamily.DrawOnlyType53: PropDrawOnlyType53(p); break;
      case PropFamily.DrawOnlyType54: PropDrawOnlyType54(p); break;
      // It draws, steps and kills; the draw is recorded where it is made,
      // so it runs in the walk like the rest. See `class41/draw_only.ts`.
      case PropFamily.DrawOnlyType33: PropDrawOnlyType33(p); break;
      // The Original Mode item `SpawnOriginalItemDrop` releases.
      case PropFamily.OriginalItemDrop:
        OriginalItemDropUpdate(p, rng, events); break;
      // The two mounted-part objects: their own lifetimes, hit arms and
      // spheres, drawn on the parent's stored matrix.
      case PropFamily.Type8Piece: Type8MountedPartUpdate(p, rng, events); break;
      case PropFamily.Type67Piece:
        Type67MountedPartUpdate(p, rng, events, cam); break;
      // Its own lifetime, its own hit arms, its own shot-test tail. Nothing
      // the generic arm supplies belongs to it.
      case PropFamily.Type43: PropUpdateType43(p, rng, events); break;
      // Each of these four has its own lifetime head, hit arm and shot-test
      // tail, so none of them can ride the generic arm either.
      case PropFamily.Type38: PropUpdateType38(p, rng, events); break;
      case PropFamily.Type39: PropUpdateType39(p, rng, events); break;
      case PropFamily.Type40: PropUpdateType40(p, rng, events); break;
      case PropFamily.Type44: PropUpdateType44(p, rng, events); break;
      // Its own inlined lifetime (step count before the sweep, `ActorKill`
      // rather than `ActorDespawn`), no `AND` on `obj+0x34` and no
      // `RegisterForShotTest`. See `class41/type13.ts`.
      case PropFamily.Type13: PropUpdateType13(p, events); break;
      // Its own constructor, its own lifetime, its own light. See
      // `class41/type48.ts`.
      case PropFamily.Type48: PropUpdateType48FlickerLight(p, rng, events); break;
      // `PlaceTable66Props`' objects: their own lifetime, ending in
      // `ActorKill`, and their own hit arm and sphere. See `class41/type66.ts`.
      case PropFamily.Type66: PropUpdateType66(p, rng, events); break;
      // `PlaceTable50Props` hands `ActorAlloc` this routine itself, so the
      // routine runs and nothing of the generic arm's lookup does. See
      // `class41/type50.ts`.
      case PropFamily.DrawOnlyType12: PropDrawOnlyType12(p, rng, events); break;
      default: BreakablePropUpdate(p, rng, events, cam); break;
    }
  }
  if (G.g_breakable_props.some((p) => p.dead)) {
    // A routine that drew and then died this frame had its draw submitted
    // before the object went: keep it for the renderer. See
    // `g_prop_final_draws`.
    for (const p of G.g_breakable_props) {
      if (p.dead && p.draws?.length) {
        G.g_prop_final_draws.push({ id: p.id, draws: p.draws });
      }
    }
    G.g_breakable_props = G.g_breakable_props.filter((p) => !p.dead);
  }
  // The shatter objects the walk above allocated, and the ones still flying
  // from earlier frames. Each is its own task in the engine, appended behind
  // the prop that made it, so a new one steps on the frame it is made.
  PropShattersTick();
  // ...and the banners a taken collectible raises, allocated the same way.
  OriginalItemBannersTick();
}

/**
 * The pool's generic arm: `g_class41_updates[type]` for the objects
 * `PlaceGenericProp` (`FUN_00461CF0`) builds with no family of their own, and
 * `ChainSegmentUpdate` for the twenty links `PlaceChainSegments` builds.
 *
 * Every class-0x41 generic routine is transcribed whole and is a
 * `GENERIC_ROUTINES` row (`class41/generic_routines.ts`): it brings its own
 * head and tail, and nothing here is its. Switching on the type is the
 * engine's indirect call written out -- `ActorAlloc` was handed
 * `g_class41_updates[obj->+0x130C]` and the object calls through it every
 * frame.
 *
 * What is left below is a chain link (type 0, which has no row): the shared
 * `PropExpireByStepLifetime` head, its branch arm (`class41/branch.ts`), the
 * mask of the four hit bits and its sphere at its own link.
 */
function GenericPropUpdate(p: BreakableProp, rng: Rng,
                           events?: Events): void {
  const routine = GENERIC_ROUTINES[p.kind];
  if (routine) {
    routine(p, rng, events);
    return;
  }
  if (PropExpireByStepLifetime(p)) return;
  if (p.chainGroup > 0) {
    ChainSegmentUpdate(p, ChainSegmentZero(p.chainGroup));
  }
  p.flags &= ~HIT_FLAG_MASK;
  PropRegisterAtOrigin(p);
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

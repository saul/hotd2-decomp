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
import { SlideOnFlagUpdate } from "../class44/slide_on_flag";
import { FlagLiftedPropUpdate } from "../class44/flag_lifted";
import { PropUpdateType47 } from "./type47";
import { PropDrawOnlySelector14 } from "../class44/draw_only";
import { HingeUpdate } from "../class44/hinge";
import {
  FlagSlotEffectUpdate, ScaledSlotEffectUpdate,
} from "../class44/slot_effect";
import { EffectHandoffUpdate } from "../class44/effect_handoff";
import { SwingThenBreakUpdate } from "../class44/swing_then_break";
import { EffectCollapseUpdate } from "../class44/effect_collapse";
import { ScriptFlagEffectUpdate } from "../class44/script_flag_effect";
import { StoryModeSwitchUpdate } from "../class44/story_switch";
import { ChainSegmentUpdate } from "./chain";
import {
  PropDrawOnlyType31, PropDrawOnlyType33, PropDrawOnlyType53,
  PropDrawOnlyType54,
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
import { ClearPropShotTestList } from "./shot_test";
import { BreakablePropUpdate } from "./prop";
import { PropFamily, type BreakableProp }
  from "./prop_state";
import { LiftUpdate } from "./lift";
import { PropUpdateType38 } from "./type38";
import { PropUpdateType39 } from "./type39";
import { PropUpdateType40 } from "./type40";
import { PropUpdateType44 } from "./type44";
import { PropUpdateType66 } from "./type66";
import { PropDrawOnlyType12 } from "./type12";
import { PropUpdateType16, Type16DropStripUpdate } from "./type16";
import { PropUpdateType17 } from "./type17";
import { PropUpdateType29 } from "./type29";
import { PropUpdateType37 } from "./type37";
import { PropDrawOnlyType42 } from "./type42";
import { PropUpdateType55Particles } from "./type55";
import { PropUpdateType65Particles } from "./type65";

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
      // The whole routine, with its own despawn tests, its own shot-test
      // registration and no `AND` on `obj+0x34`: the hit bits a shot leaves
      // stay up. See `class44/story_switch.ts`.
      case PropFamily.StoryModeSwitch:
        StoryModeSwitchUpdate(p, rng, events); break;
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
      // ...and selectors 12 and 9: each its own remove flag and no prologue.
      case PropFamily.SlideOnFlag: SlideOnFlagUpdate(p); break;
      case PropFamily.FlagLifted: FlagLiftedPropUpdate(p); break;
      // Constructor 47's task: a flag and a step index are its lifetime.
      case PropFamily.Type47: PropUpdateType47(p); break;
      // Selector 14 opens on the prologue itself and registers nothing.
      case PropFamily.DrawOnlySelector14: PropDrawOnlySelector14(p); break;
      // The class-0x44 hinges and their neighbours: each its own remove flag
      // and sweep, no prologue, and its own shot-test tail where it has one.
      case PropFamily.Hinge: HingeUpdate(p, events); break;
      case PropFamily.FlagSlotEffect: FlagSlotEffectUpdate(p, rng, events); break;
      case PropFamily.EffectHandoff: EffectHandoffUpdate(p, rng); break;
      case PropFamily.SwingThenBreak: SwingThenBreakUpdate(p, rng); break;
      case PropFamily.ScaledSlotEffect: ScaledSlotEffectUpdate(p, rng); break;
      case PropFamily.EffectCollapse: EffectCollapseUpdate(p, rng); break;
      // Selector 10's object: `PropDrawOnlyType31` itself, with the step
      // lifetime it opens on.
      case PropFamily.DrawOnlyType31: PropDrawOnlyType31(p, rng, events); break;
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
      // A chain link: its own byte-wide lifetime, its own hit arm and swing,
      // and its shot sphere at its own foot. See `class41/chain.ts`.
      case PropFamily.ChainSegment: ChainSegmentUpdate(p, rng, events); break;
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
      // Constructors 16, 17, 29 and 37 hand `ActorAlloc` their own routines,
      // each with its own head and tail; 16's landing allocates the strip,
      // which steps this frame for the reason the falling container's pieces
      // do. See `class41/type16.ts` and its siblings.
      case PropFamily.Type16: PropUpdateType16(p, rng, events); break;
      case PropFamily.Type16DropStrip: Type16DropStripUpdate(p); break;
      case PropFamily.Type17: PropUpdateType17(p, rng, events); break;
      case PropFamily.Type29: PropUpdateType29(p); break;
      case PropFamily.Type37: PropUpdateType37(p, rng, events); break;
      // Constructors 42, 55 and 65 hand `ActorAlloc` routines of their own,
      // each with its own way out and no prologue, sphere or counter. See
      // `class41/type42.ts`, `type55.ts` and `type65.ts`.
      case PropFamily.Type42: PropDrawOnlyType42(p); break;
      case PropFamily.Type55: PropUpdateType55Particles(p, rng); break;
      case PropFamily.Type65: PropUpdateType65Particles(p); break;
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
 * `PlaceGenericProp` (`FUN_00461CF0`) builds with no family of their own.
 *
 * Every class-0x41 generic routine is transcribed whole and is a
 * `GENERIC_ROUTINES` row (`class41/generic_routines.ts`): it brings its own
 * head and tail, and nothing here is its. Switching on the type is the
 * engine's indirect call written out -- `ActorAlloc` was handed
 * `g_class41_updates[obj->+0x130C]` and the object calls through it every
 * frame.
 *
 * A type with no row has no routine and does nothing -- neither draws nor
 * registers -- as a class with no `g_class_handlers` entry does nothing. The
 * last object that reached this arm without a row was the chain link, which
 * has its own family now (`class41/chain.ts`); no shipped placement does.
 */
function GenericPropUpdate(p: BreakableProp, rng: Rng,
                           events?: Events): void {
  const routine = GENERIC_ROUTINES[p.kind];
  if (routine) routine(p, rng, events);
}


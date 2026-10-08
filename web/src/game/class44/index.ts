/**
 * Class 0x44 — the prop placer, and the falling container behind selector 16.
 *
 * Same shape as class 0x41: `PropPlacerDispatch44` (`FUN_00472B10`) is two
 * instructions —
 *
 * ```c
 * (*g_class44_subtypes[obj->+0x11C])(obj);
 * ActorKill();
 * ```
 *
 * — so the placer is a transient stub that never survives its first frame. The
 * one difference from 0x41 is the field it dispatches on: `+0x11C`, the word
 * that is hit points for a combat actor and the *group id* for a class-0x41
 * placer. Three classes, three meanings, one offset.
 *
 * Eighteen builders, and every one is read and ported: selector 0, the
 * animated effect tree stage 1's window is made of; the hinges 1, 2 and 4,
 * which swing on a flag through a baked curve (`hinge.ts`); 3 and 7, effect
 * trees drawn as one slot (`slot_effect.ts`); 5, which plays an effect and
 * hands itself to a hinge; 6, which swings and then breaks; 8, an effect that
 * falls apart; 9, 11, 12 and 13, which lift or slide on a flag; 10, class
 * 0x41 type 31's strip loop from a class-0x44 descriptor; 14, a model at a
 * scale; 15, class 0x41 type 4's kinded prop with an Original Mode gate; 16,
 * which hands out items and is the only one that shares
 * `g_item_set_countdown` with class 0x41; and 17, the branch writer.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import {
  registerClass, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { T } from "../tables";
import { PlaceFallingContainer } from "./container";
import { PropBuildRisingDoor } from "./rising_door";
import { PropBuildRiseToHeight } from "./rise_to_height";
import { PropBuildSlideOnFlag } from "./slide_on_flag";
import { PropBuildFlagLiftedProp } from "./flag_lifted";
import { PropBuildDrawOnlySelector14, PropBuildSlotStripLoop }
  from "./draw_only";
import { PropBuildHinge, PropBuildHingeScaled, PropBuildVanDoors }
  from "./hinge";
import { PropBuildFlagSlotEffect, PropBuildScaledSlotEffect }
  from "./slot_effect";
import { PropBuildEffectHandoff } from "./effect_handoff";
import { PropBuildSwingThenBreak } from "./swing_then_break";
import { PropBuildEffectCollapse } from "./effect_collapse";
import { PropBuildKindedProp } from "./kinded_prop";
import type { BreakablePlacement } from "../../bundle";
import { PropBuildScriptFlagEffect } from "./script_flag_effect";
import { PlaceStoryModeSwitch } from "./story_switch";

/**
 * `obj+0x11C` for this class — the builder index.
 *
 * Every member has a port, and each is named for what its builder builds.
 */
export enum Class44Selector {
  /**
   * `PropBuildScriptFlagEffect` (`FUN_00472B30`) — the animated effect tree
   * that plays on a script flag. Two spawns, both stage 1's window halves.
   */
  ScriptFlagEffect = 0,
  /** `PropBuildHinge` (`FUN_00472BD0`) — a hinge. See `class44/hinge.ts`. */
  Hinge = 1,
  /** `PropBuildVanDoors` (`FUN_00472C90`) — the van's two rear doors. */
  VanDoors = 2,
  /**
   * `PropBuildFlagSlotEffect` (`FUN_00472E00`) — effect 0xB drawn as one
   * slot. See `class44/slot_effect.ts`.
   */
  FlagSlotEffect = 3,
  /** `PropBuildHingeScaled` (`FUN_00472EB0`) — a hinge with a scale. */
  HingeScaled = 4,
  /**
   * `PropBuildEffectHandoff` (`FUN_00472F80`) — an effect on flag 0x62, then
   * a hinge. See `class44/effect_handoff.ts`.
   */
  EffectHandoff = 5,
  /**
   * `PropBuildSwingThenBreak` (`FUN_00473060`). See
   * `class44/swing_then_break.ts`.
   */
  SwingThenBreak = 6,
  /**
   * `PropBuildScaledSlotEffect` (`FUN_00473170`) — effect 0xF drawn as its
   * descriptor's slot at a scale. See `class44/slot_effect.ts`.
   */
  ScaledSlotEffect = 7,
  /**
   * `PropBuildEffectCollapse` (`FUN_00473260`). See
   * `class44/effect_collapse.ts`.
   */
  EffectCollapse = 8,
  /**
   * `PropBuildRisingDoor` (`FUN_00473410`) — a door that slides straight up on
   * a script flag. Two spawns: stage 3's roller shutter and stage 5's.
   *
   * **Not a hinge and not the HUD shutter.** Selectors 1, 2 and 4 are the
   * hinges, and `script/state/shutter.ts` is the letterbox. This one is
   * scenery that translates. See `class44/rising_door.ts`.
   */
  /**
   * `PropBuildFlagLiftedProp` (`FUN_00473300`) — one slot that rises to y 10
   * on a script flag. Stage 3's one. See `class44/flag_lifted.ts`.
   */
  FlagLifted = 9,
  /**
   * `PropBuildSlotStripLoop` (`FUN_00473370`) — `PropDrawOnlyType31`'s object
   * from a class-0x44 descriptor. See `class44/draw_only.ts`.
   */
  SlotStripLoop = 10,
  RisingDoor = 11,
  /**
   * `PropBuildSlideOnFlag` (`FUN_004734A0`) — an object that slides a set
   * distance on a script flag. Stage 6's doors. See `class44/slide_on_flag.ts`.
   */
  SlideOnFlag = 12,
  /**
   * `PropBuildRiseToHeight` (`FUN_00473640`) — an object that rises a unit a
   * frame on a script flag to a whole-number height above its spawn. Stage
   * 5's gate behind JUDGMENT and twelve in stage 6. See
   * `class44/rise_to_height.ts`.
   */
  RiseToHeight = 13,
  /**
   * `PropBuildDrawOnlySelector14` (`FUN_004736D0`) — a model its descriptor
   * names at the spawn's pose and the descriptor's scale, for a lifetime in
   * steps. Twelve spawns over stages 2, 3 and 4. See `class44/draw_only.ts`.
   */
  DrawOnly = 14,
  /**
   * `PropBuildKindedProp` (`FUN_00473770`) — a `KindedPropUpdate` object,
   * five of nine built only in Original Mode. See `class44/kinded_prop.ts`.
   */
  KindedProp = 15,
  /** `PlaceFallingContainer` (`FUN_00473940`) — the item container. */
  FallingContainer = 16,
  /**
   * `PlaceStoryModeSwitch` (`FUN_00473A70`) — the **route-branch trigger with
   * the widest reach**: nine spawns over four stages, and five of the game's
   * sixteen branch records are answered by one. See `class44/story_switch.ts`.
   */
  StoryModeSwitch = 17,
}

/** What one class-0x44 builder does. `undefined` where none is ported. */
export type Class44Builder = (obj: Actor, f: ClassFrame) => void;

/**
 * `g_class44_subtypes` — 0x00595AB8, 18 entries indexed by `obj+0x11C`.
 *
 * Sparse for the same reason `g_class_handlers` is: a selector with no entry
 * does nothing, and that is structural rather than an `if`.
 *
 * Filled in **here**, not from `container.ts`. Registering from the other side
 * makes `index -> container -> index` a cycle, and `export *` evaluates the
 * dependency first — so the builder would run its registration against a
 * `const` that has not been initialised yet. That is the same cycle that left
 * `g_class_handlers[0x41]` empty and cost an hour; once is enough.
 */
/**
 * `[port-only]` This placer's placement under *container*, which the exporter
 * decoded from the same descriptor the builder reads.
 */
function Class44Placement(obj: Actor, container: string):
    BreakablePlacement | undefined {
  return T.breakables?.placements?.find(
    (q) => q.at === obj.descAt && q.container === container);
}

export const g_class44_subtypes: Partial<Record<number, Class44Builder>> = {
  [Class44Selector.Hinge]: (obj) => {
    const pl = Class44Placement(obj, "hinge");
    if (pl) G.g_breakable_props.push(PropBuildHinge(pl));
  },
  [Class44Selector.VanDoors]: (obj) => {
    const pl = Class44Placement(obj, "van_doors");
    if (pl) G.g_breakable_props.push(...PropBuildVanDoors(pl));
  },
  [Class44Selector.FlagSlotEffect]: (obj) => {
    const pl = Class44Placement(obj, "flag_slot_effect");
    if (pl) G.g_breakable_props.push(PropBuildFlagSlotEffect(pl));
  },
  [Class44Selector.HingeScaled]: (obj) => {
    const pl = Class44Placement(obj, "hinge_scaled");
    if (pl) G.g_breakable_props.push(PropBuildHingeScaled(pl));
  },
  [Class44Selector.EffectHandoff]: (obj) => {
    const pl = Class44Placement(obj, "effect_handoff");
    if (pl) G.g_breakable_props.push(PropBuildEffectHandoff(pl));
  },
  [Class44Selector.SwingThenBreak]: (obj) => {
    const pl = Class44Placement(obj, "swing_then_break");
    if (pl) G.g_breakable_props.push(PropBuildSwingThenBreak(pl));
  },
  [Class44Selector.ScaledSlotEffect]: (obj) => {
    const pl = Class44Placement(obj, "scaled_slot_effect");
    if (pl) G.g_breakable_props.push(PropBuildScaledSlotEffect(pl));
  },
  [Class44Selector.EffectCollapse]: (obj) => {
    const pl = Class44Placement(obj, "effect_collapse");
    if (pl) G.g_breakable_props.push(PropBuildEffectCollapse(pl));
  },
  [Class44Selector.SlotStripLoop]: (obj) => {
    const pl = Class44Placement(obj, "slot_strip_loop");
    if (pl) G.g_breakable_props.push(PropBuildSlotStripLoop(pl));
  },
  [Class44Selector.KindedProp]: (obj, f) => {
    const pl = Class44Placement(obj, "kinded_44");
    const p = pl ? PropBuildKindedProp(pl, f.rng) : null;
    if (p) G.g_breakable_props.push(p);
  },
  [Class44Selector.ScriptFlagEffect]: (obj, f) => {
    void f;
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.descAt && q.container === "script_flag_effect");
    const p = pl ? PropBuildScriptFlagEffect(pl) : null;
    if (p) G.g_breakable_props.push(p);
  },
  [Class44Selector.StoryModeSwitch]: (obj, f) => {
    void f;
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.descAt && q.container === "story_switch");
    if (!pl) return;
    G.g_breakable_props.push(PlaceStoryModeSwitch(pl));
  },
  [Class44Selector.RisingDoor]: (obj, f) => {
    void f;
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.descAt && q.container === "rising_door");
    if (!pl) return;
    G.g_breakable_props.push(PropBuildRisingDoor(pl));
  },
  [Class44Selector.RiseToHeight]: (obj, f) => {
    void f;
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.descAt && q.container === "rise_to_height");
    if (!pl) return;
    G.g_breakable_props.push(PropBuildRiseToHeight(pl));
  },
  [Class44Selector.SlideOnFlag]: (obj, f) => {
    void f;
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.descAt && q.container === "slide_on_flag");
    if (!pl) return;
    G.g_breakable_props.push(PropBuildSlideOnFlag(pl));
  },
  [Class44Selector.FlagLifted]: (obj, f) => {
    void f;
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.descAt && q.container === "flag_lifted");
    if (!pl) return;
    G.g_breakable_props.push(PropBuildFlagLiftedProp(pl));
  },
  [Class44Selector.DrawOnly]: (obj, f) => {
    void f;
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.descAt && q.container === "draw_only_14");
    if (!pl) return;
    G.g_breakable_props.push(PropBuildDrawOnlySelector14(pl));
  },
  [Class44Selector.FallingContainer]: (obj, f) => {
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.descAt && q.container === "falling");
    if (!pl) return;
    G.g_breakable_props.push(PlaceFallingContainer(
      obj.descAt, pl.kind ?? 0, pl.item_set ?? 0, pl.story_item ?? -1,
      pl.set_size ?? 0, pl.lifetime_evt_steps,
      obj.pos.x, obj.pos.y, obj.pos.z, obj.yaw, f.rng));
  },
};

/**
 * `PropPlacerDispatch44` — `FUN_00472B10`. Dispatch, then die.
 *
 * The `ActorKill` is the line after the call and is not conditional, so a
 * selector with no builder still disappears on its first frame rather than
 * sitting in the level.
 */
export function PropPlacerDispatch44(obj: Actor, f: ClassFrame): void {
  g_class44_subtypes[obj.hp]?.(obj, f);
  ActorKillClass44Placer(obj);
}

/** The placer's end, as `ActorKill` (`FUN_004A7040`) delivers it. */
export function ActorKillClass44Placer(obj: Actor): void {
  obj.dead = true;
  obj.visible = false;
}

/** There is no `Init` in the engine; this only marks the actor live. */
export function Class44PlacerInit(obj: Actor): void {
  obj.visible = true;
}

export const Class44PlacerHandler: ClassHandler = {
  init: Class44PlacerInit,
  update: PropPlacerDispatch44,
};

export * from "./container";
export * from "./rising_door";
export * from "./rise_to_height";
export * from "./slide_on_flag";
export * from "./flag_lifted";
export * from "./draw_only";
export * from "./script_flag_effect";
export * from "./hinge";
export * from "./slot_effect";
export * from "./effect_handoff";
export * from "./swing_then_break";
export * from "./effect_collapse";
export * from "./kinded_prop";
export * from "./story_switch";

/**
 * The same shape: a placer that builds and dies. All eighteen selectors have
 * a builder — see {@link g_class44_subtypes}.
 */
registerClass(SpawnClass.PropPlacer, Class44PlacerHandler);

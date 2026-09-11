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
 * Eighteen builders. Four are read and ported: selector 16, which hands out
 * items and is the only one that shares `g_item_set_countdown` with class
 * 0x41; selector 17, the branch writer; selector 0, the animated effect tree
 * stage 1's window is made of; and selector 11, the door that slides up out of
 * the way of the zombies behind it. The rest keep their slot and do nothing,
 * for the same reason class 0x41's other 78 do — an unimplemented selector
 * running the wrong builder is the bug that had the cat walking at the player.
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
import { PropBuildScriptFlagEffect } from "./script_flag_effect";
import { PlaceStoryModeSwitch } from "../class41/triggers";

/**
 * `obj+0x11C` for this class — the builder index.
 *
 * Only the members with a port are named. A selector the stages place but that
 * has not been read is a bare number on purpose: naming it would claim a
 * reading that has not happened.
 */
export enum Class44Selector {
  /**
   * `PropBuildScriptFlagEffect` (`FUN_00472B30`) — the animated effect tree
   * that plays on a script flag. Two spawns, both stage 1's window halves.
   */
  ScriptFlagEffect = 0,
  /**
   * `PropBuildRisingDoor` (`FUN_00473410`) — a door that slides straight up on
   * a script flag. Two spawns: stage 3's roller shutter and stage 5's.
   *
   * **Not a hinge and not the HUD shutter.** Selectors 1, 2 and 4 are the
   * hinges, and `script/state/shutter.ts` is the letterbox. This one is
   * scenery that translates. See `class44/rising_door.ts`.
   */
  RisingDoor = 11,
  /** `PlaceFallingContainer` (`FUN_00473940`) — the item container. */
  FallingContainer = 16,
  /**
   * `PlaceStoryModeSwitch` (`FUN_00473A70`) — the **route-branch trigger with
   * the widest reach**: twelve spawns over four stages, and five of the game's
   * sixteen branch records are answered by one. See `game/class41/branch.ts`.
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
export const g_class44_subtypes: Partial<Record<number, Class44Builder>> = {
  [Class44Selector.ScriptFlagEffect]: (obj, f) => {
    void f;
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.at && q.container === "script_flag_effect");
    if (!pl) return;
    G.g_breakable_props.push(...PropBuildScriptFlagEffect(
      obj.at, pl.effect ?? 0, pl.capture_bone ?? 0, pl.motion ?? 0));
  },
  [Class44Selector.StoryModeSwitch]: (obj, f) => {
    void f;
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.at && q.container === "story_switch");
    if (!pl) return;
    G.g_breakable_props.push(PlaceStoryModeSwitch(pl));
  },
  [Class44Selector.RisingDoor]: (obj, f) => {
    void f;
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.at && q.container === "rising_door");
    if (!pl) return;
    G.g_breakable_props.push(PropBuildRisingDoor(pl));
  },
  [Class44Selector.FallingContainer]: (obj, f) => {
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.at && q.container === "falling");
    if (!pl) return;
    G.g_breakable_props.push(PlaceFallingContainer(
      obj.at, pl.kind ?? 0, pl.item_set ?? 0, pl.story_item ?? -1,
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
export * from "./script_flag_effect";

/**
 * The same shape: a placer that builds and dies. Four of the eighteen
 * selectors have a builder — see {@link g_class44_subtypes}; the rest run
 * nothing, which is what the sparse table is for.
 */
registerClass(SpawnClass.PropPlacer, Class44PlacerHandler);

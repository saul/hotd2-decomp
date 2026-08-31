/**
 * Class 0x41 — the breakable-prop / item-container placer.
 *
 * `PropContainerPlacerUpdate` (`FUN_00461CD0`) is three instructions:
 *
 * ```c
 * (*g_class41_constructors[obj->+0x130C])(obj);
 * ActorKill();
 * ```
 *
 * so the placer is a *transient stub*. It is never drawn, never damaged, and
 * never survives its first frame — what the script places is a constructor
 * call, and what stays behind is whatever that constructor built. 441 spawns
 * across the six stages go through it, which is more than any other class.
 *
 * The 79 constructors are a grab-bag: the retail stages reach 74 of them, and
 * exactly one — type 0, `PlaceBreakableGroup` — is the container mechanism the
 * class is named for. The rest are single-prop builders that were not read
 * here; each keeps its slot in the table and does nothing, because an
 * unimplemented type that silently ran the *wrong* constructor is the same
 * bug that had the cat running the zombie's state machine.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import type { ClassFrame, ClassHandler } from "../registry";
import { SpawnClass } from "../spawn_class";
import { T } from "../tables";
import { PlaceBreakableGroup } from "./group";
import { PlaceKindedProp } from "./kinded";
import { PlaceGenericProp } from "./generic";
import { PlaceFallingContainer } from "../class44/container";

/**
 * `obj+0x130C` for this class — the constructor index, **not** the body
 * condition the field means for a combat actor. The port's `Actor.condition`
 * carries it, which is the polymorphic-field trap made explicit.
 *
 * Only the members with a port are named. A type placed by a shipped stage but
 * not read is a number here on purpose: naming it would claim a reading that
 * has not happened.
 */
export enum PropContainerType {
  /** `PlaceBreakableGroup` (`FUN_00462A80`) — a group of breakable props. */
  BreakableGroup = 0,
  /** `PlaceKindedProp` (`FUN_00462E10`) — one prop, kind from `obj+0x6C`. */
  KindedProp = 4,
  /**
   * `PlaceGenericProp` case 0x22 — a falling container, the same object class
   * 0x44 selector 16 places. Twelve spawns across stages 1, 3, 4 and 5, and
   * they seed item countdowns, so leaving them out left those stages' item
   * sets paying out on the wrong break.
   */
  FallingContainer = 34,
}

/** What one class-0x41 constructor does. `undefined` where none is ported. */
export type PropContainerConstructor = (obj: Actor, f: ClassFrame) => void;

/**
 * `g_class41_constructors` — 0x00593580, 79 entries indexed by `obj+0x130C`.
 *
 * A sparse record rather than an array with 77 holes, for the same reason
 * `g_class_handlers` is one: a type with no entry does nothing, and that is
 * structural instead of an `if`.
 */
export const g_class41_constructors:
    Partial<Record<number, PropContainerConstructor>> = {
  [PropContainerType.BreakableGroup]: (obj, f) => {
    // `+0x11C` is the group id here, not hit points, and `+0x1F4` is the
    // lifetime in evt blocks, not a character type. Both fields are
    // polymorphic and both have already misled this project once.
    PlaceBreakableGroup(obj.hp, obj.charType, f.rng);
  },
  [PropContainerType.FallingContainer]: (obj, f) => {
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.at && q.container === "falling");
    if (!pl) return;
    G.g_breakable_props.push(PlaceFallingContainer(
      obj.at, 0, pl.item_set ?? 0, -1, pl.set_size ?? 0,
      pl.lifetime_evt_blocks, obj.pos.x, obj.pos.y, obj.pos.z, obj.yaw,
      f.rng));
  },
  [PropContainerType.KindedProp]: (obj, f) => {
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.at && q.container === "kinded");
    if (!pl) return;
    G.g_breakable_props.push(PlaceKindedProp(
      obj.at, pl.kind ?? 0, pl.item_set ?? 0, pl.set_size ?? 0,
      pl.lifetime_evt_blocks, obj.pos.x, obj.pos.y, obj.pos.z, obj.yaw,
      f.rng));
  },
};

/**
 * `PropContainerPlacerUpdate` — `FUN_00461CD0`.
 *
 * Dispatch, then die. The `ActorKill` is not conditional and not in the
 * constructors: it is the line after the call, so a type with no constructor
 * still disappears on its first frame rather than sitting in the level.
 */
export function PropContainerPlacerUpdate(obj: Actor, f: ClassFrame): void {
  const ctor = g_class41_constructors[obj.condition];
  if (ctor) ctor(obj, f);
  else PlaceGenericPropFor(obj, f);
  ActorKillPlacer(obj);
}

/**
 * The fallback for the 44 types `PlaceGenericProp` builds.
 *
 * A table entry each would be 44 identical closures; the exporter has already
 * decided which types this constructor serves, so a placement tagged
 * `generic` *is* the table lookup, and a type with no placement is a type this
 * stage does not use.
 */
function PlaceGenericPropFor(obj: Actor, f: ClassFrame): void {
  const pl = T.breakables?.placements?.find(
    (q) => q.at === obj.at && q.container === "generic");
  if (!pl) return;
  G.g_breakable_props.push(PlaceGenericProp(pl, f.rng));
}

/**
 * The placer's end, as `ActorKill` (`FUN_004A7040`) delivers it: the object is
 * unlinked from the pool and does not come back. Named for the caller rather
 * than the callee because the engine's `ActorKill` operates on the pool's
 * current object and takes no argument.
 */
export function ActorKillPlacer(obj: Actor): void {
  obj.dead = true;
  obj.visible = false;
}

/**
 * The placer's `Init`. There is none in the engine — the spawn allocator
 * writes `+0x130C` and `+0x1F4` inline and the handler runs on the next frame
 * — so this only marks the actor live for the director.
 */
export function PropContainerPlacerInit(obj: Actor): void {
  obj.visible = true;
}

export const PropContainerPlacerHandler: ClassHandler = {
  init: PropContainerPlacerInit,
  update: PropContainerPlacerUpdate,
};

/**
 * Put the breakable state back to "nothing placed", for a seek.
 *
 * A seek replays the script from the entry block, so the spawn list is rebuilt
 * and the bridge will place every group again. Without this the old placers
 * are still in the pool — dead, so `ActorByAt` finds them and refuses to
 * re-spawn — and the props from before the seek are left standing at whatever
 * state they were in, which is neither where you came from nor where you went.
 */
export function ResetPropContainers(): void {
  G.g_breakable_props = [];
  G.g_breakable_members = [];
  G.g_item_set_countdown = [];
  G.g_breakable_next_id = 1;
  G.g_object_list = G.g_object_list.filter(
    (o) => o.cls !== SpawnClass.PropContainerPlacer);
}

export { PlaceBreakableGroup };
export * from "./kinded";
export * from "./generic";
export * from "./prop_state";
export * from "./prop";
export * from "./items";
export * from "./lift";
export * from "./lifetime";
export {
  BreakableGroupMembers, BreakableMemberSlot, BreakablePropAt,
  BreakableGroupFloor, MsvcRand, PROP_TARGET_SETS, MEMBERS_PER_GROUP,
} from "./group";

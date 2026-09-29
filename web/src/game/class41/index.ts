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
 * class is named for. Fifty are `PlaceGenericProp`, five are `NoOpStub`, and
 * of the other twenty-four the ones below are ported; the thirteen that are
 * not, with the spawns that place each, are listed in `docs/formats/spawns.md`
 * (*Class 0x41's constructors: which are ported*). An unported type keeps its
 * slot in the table and does nothing, because an unimplemented type that
 * silently ran the *wrong* constructor is the same bug that had the cat
 * running the zombie's state machine.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import {
  registerClass, type ClassFrame, type ClassHandler, type SpawnRecord,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { T } from "../tables";
import { PlaceBreakableGroup } from "./group";
import { PlaceKindedProp } from "./kinded";
import { PlaceGenericProp } from "./generic";
import { PlaceChainSegments } from "./triggers";
import { PlaceFragmentProps } from "./type40";
import { PlaceTable38Props } from "./type38";
import { PlaceTable39Stacks } from "./type39";
import { PlaceTable44Props } from "./type44";
import { PlaceTable50Props } from "./type50";
import { PlaceTable66Props } from "./type66";
import { PROP75_SCRIPT_FLAG, PROP75_TYPE } from "./flag_prop";
import { FLICKER_LIGHT_TYPE, PlaceFlickerLightProp48 } from "./type48";
import { PlaceWaterSurface } from "./water";

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
  /**
   * `PlaceWaterSurface` (`FUN_00462F70`) — the task that draws and ripples a
   * canal water tile. Not a prop: nothing is shot, nothing is placed at the
   * spawn's position. See `class41/water.ts`.
   */
  WaterSurface = 1,
  /** `PlaceKindedProp` (`FUN_00462E10`) — one prop, kind from `obj+0x6C`. */
  KindedProp = 4,
  /**
   * `PlaceGenericProp` case 0x22 — a falling container, the object class 0x44
   * selector 16 places, running the same `FallingContainerUpdate`. Twelve
   * spawns across stages 1, 3, 4 and 5, and they seed item countdowns.
   *
   * **Not a constructor of its own**: `g_class41_constructors[34]` is
   * `PlaceGenericProp` (`FUN_00461CF0`), so the object is built by that
   * routine's prologue and its arm (`PlaceGenericPropType34` in
   * `class44/container.ts`), and keeps the placer's pitch and roll, which
   * class 0x44's constructor does not write. The port used to route it
   * through class 0x44's constructor and dropped both.
   */
  FallingContainer = 34,
  /**
   * `PlaceChainSegments` (`FUN_00463160`) — twenty hanging links. Group 1 is a
   * **route-branch trigger**: shooting any link in event block 0x16 opens
   * stage 2 block 22's second road.
   */
  ChainSegments = 24,
  /**
   * `PlaceFragmentProps` (`FUN_004636A0`) — a row of objects that burst into
   * forty pieces. Sub-kind 9 is a **route-branch trigger** and takes both of
   * the pair.
   */
  FragmentProps = 40,
  /** `PlaceTable38Props` (`FUN_00463420`) — nine objects from a table. */
  Table38Props = 38,
  /** `PlaceTable39Stacks` (`FUN_00463510`) — eight stacks from a table. */
  Table39Stacks = 39,
  /** `PlaceTable44Props` (`FUN_004639F0`) — seven chairs from a table. */
  Table44Props = 44,
  /**
   * `PlaceTable50Props` (`FUN_00463BA0`) — one of six tables of scenery, the
   * placer's `+0x1F4` picking which. Stage 1's bin-scene crate and stage 2
   * block 17's furniture among them.
   */
  Table50Props = 50,
  /**
   * `PlaceTable66Props` (`FUN_00464500`) — twenty or twenty-nine
   * `komono_kanban.bin` and `komono_uemiti.bin` models from one of two tables.
   */
  Table66Props = 66,
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
  [PropContainerType.ChainSegments]: (obj, f) => {
    void f;
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.at && q.container === "chain");
    if (!pl) return;
    G.g_breakable_props.push(...PlaceChainSegments(pl));
  },
  [PropContainerType.FragmentProps]: (obj, f) => {
    void f;
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.at && q.container === "fragment");
    if (!pl) return;
    G.g_breakable_props.push(...PlaceFragmentProps(pl));
  },
  // `PlaceFlickerLightProp48` (`FUN_00463B20`) -- the lamp with a light.
  [FLICKER_LIGHT_TYPE]: (obj, f) => {
    void f;
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.at && q.container === "flicker_light");
    if (!pl) return;
    G.g_breakable_props.push(PlaceFlickerLightProp48(
      pl, obj.pos.x, obj.pos.y, obj.pos.z, obj.yaw));
  },
  // The three table constructors copy the placer's `+0x11C` into every object
  // they build as its step lifetime; nothing else of the descriptor is read.
  [PropContainerType.Table38Props]: (obj) => {
    G.g_breakable_props.push(...PlaceTable38Props(obj.at, obj.hp));
  },
  [PropContainerType.Table39Stacks]: (obj, f) => {
    G.g_breakable_props.push(...PlaceTable39Stacks(obj.at, obj.hp, f.rng));
  },
  [PropContainerType.Table44Props]: (obj) => {
    G.g_breakable_props.push(...PlaceTable44Props(obj.at, obj.hp));
  },
  // These two read `+0x1F4` as well: the table to build from. `+0x11C` is the
  // step lifetime every object copies, as for the three above.
  [PropContainerType.Table50Props]: (obj) => {
    G.g_breakable_props.push(
      ...PlaceTable50Props(obj.at, obj.charType, obj.hp));
  },
  [PropContainerType.Table66Props]: (obj) => {
    G.g_breakable_props.push(
      ...PlaceTable66Props(obj.at, obj.charType, obj.hp));
  },
  // The canal water. `+0x1F4` is a table index and `+0x11C` a lifetime in
  // step changes; the position is never read.
  [PropContainerType.WaterSurface]: (obj) => {
    PlaceWaterSurface(obj);
  },
  [PropContainerType.KindedProp]: (obj, f) => {
    const pl = T.breakables?.placements?.find(
      (q) => q.at === obj.at && q.container === "kinded");
    if (!pl) return;
    G.g_breakable_props.push(PlaceKindedProp(
      obj.at, pl.kind ?? 0, pl.item_set ?? 0, pl.set_size ?? 0,
      pl.lifetime_evt_steps, obj.pos.x, obj.pos.y, obj.pos.z, obj.yaw,
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
  // `ActorAlloc` appends the prop to the task list **before** its arm
  // allocates anything, so the objects cases 8 and 0x43 hang off it come
  // after it in the walk and draw on the matrix it stored that frame. The
  // arm pushes them as it makes them; the prop goes in ahead of them.
  const at = G.g_breakable_props.length;
  const p = PlaceGenericProp(pl, f.rng);
  G.g_breakable_props.splice(at, 0, p);
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

/**
 * `PropUpdateType75` (`FUN_004710C0`) raises `g_script_flags[20]` — but only
 * the objects **one** of the 79 constructors builds do, so the answer is per
 * spawn record and not per class.
 *
 * The lookup is the same one `PlaceGenericPropFor` makes: the exporter has
 * already decided which container a placement is, so a `generic` placement of
 * type 75 at this record's address *is* the dispatch through
 * `g_class41_constructors` and `g_class41_updates`, done ahead of time. A
 * class-wide number here would have told every stage with a prop in it that
 * flag 20 was on its way; 441 of the six stages' spawns go through this class
 * and exactly one of them is this object.
 *
 * [port-only] There is no such routine in the engine, and there could not be:
 * it answers a question only a partial port has, which is *whether this client
 * is able to open a gate at all*. See `script/waits/flag.ts`.
 */
export function PropContainerRaisesScriptFlag(
    rec: SpawnRecord): number | undefined {
  if (rec.at === undefined) return undefined;
  const pl = T.breakables?.placements?.find(
    (q) => q.at === rec.at && q.container === "generic");
  return pl?.type === PROP75_TYPE ? PROP75_SCRIPT_FLAG : undefined;
}

/**
 * The generic types whose arm of `PlaceGenericProp` raises an enemy counter:
 * case 0x0E `g_enemies_alive`, cases 0x13 and 0x19 `g_enemies_present`. Their
 * routines give it back -- see `class41/type14.ts`, `type19.ts`, `type25.ts`.
 */
export const GENERIC_ENEMY_COUNTING_TYPES: ReadonlySet<number> =
  new Set([14, 19, 25]);

/**
 * Whether the class-0x41 object this record places is one of
 * {@link GENERIC_ENEMY_COUNTING_TYPES}: the answer
 * `ClassHandler.countsForEnemyGate` wants, read off the placement the way
 * {@link PropContainerRaisesScriptFlag} reads it.
 *
 * [port-only] There is no such routine in the engine: it answers a replay's
 * question, which is what an enemy gate stepped over has taken away.
 */
export function PropContainerCountsForEnemyGate(rec: SpawnRecord): boolean {
  if (rec.at === undefined) return false;
  const pl = T.breakables?.placements?.find(
    (q) => q.at === rec.at && q.container === "generic");
  return pl?.type !== undefined && GENERIC_ENEMY_COUNTING_TYPES.has(pl.type);
}

export const PropContainerPlacerHandler: ClassHandler = {
  init: PropContainerPlacerInit,
  update: PropContainerPlacerUpdate,
  raisesScriptFlag: PropContainerRaisesScriptFlag,
  countsForEnemyGate: PropContainerCountsForEnemyGate,
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
  G.g_prop_final_draws = [];
  G.g_prop67_by_index = [0, 0, 0];
  G.g_object_list = G.g_object_list.filter(
    (o) => o.cls !== SpawnClass.PropContainerPlacer);
}

export { PlaceBreakableGroup };
export * from "./kinded";
export * from "./generic";
export * from "./branch";
export * from "./triggers";
export * from "./type38";
export * from "./type39";
export * from "./type40";
export * from "./water";
export * from "./water_slots";
export * from "./type44";
export * from "./type50";
export * from "./type66";
export * from "./prop_state";
export * from "./prop";
export * from "./items";
export * from "./lift";
export * from "./lifetime";
export * from "./flag_prop";
export * from "./original_item";
export * from "./item_banner";
export * from "./type72";
export * from "./type74";
export * from "./type76";
export * from "./type77";
export {
  BreakableGroupMembers, BreakableMemberSlot, BreakablePropAt,
  BreakableGroupFloor, MsvcRand, PROP_TARGET_SETS, MEMBERS_PER_GROUP,
} from "./group";

/**
 * A placer, not an actor: it builds its children and kills itself on its
 * first frame. It draws nothing, so it needs no renderer.
 */
registerClass(SpawnClass.PropContainerPlacer, PropContainerPlacerHandler);

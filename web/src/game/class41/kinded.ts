/**
 * `PlaceKindedProp` and `KindedPropUpdate` — class 0x41 **type 4**.
 *
 * 70 spawns, the most-placed constructor in the game, and **37 of them hide an
 * item** — more than the group placer accounts for. It is the only container
 * family in stages 3, 4 and 6.
 *
 * It is a different shape from the group props in three ways worth holding on
 * to before reading the code:
 *
 * * **One prop per spawn, not a table.** The group placer builds a whole group
 *   from records compiled into the exe; this builds one prop from the spawn
 *   descriptor. An item *set* is therefore N separate spawns sharing an item-
 *   set id, and the set size rides in the spawn's own orientation word.
 * * **Most take one shot.** Only a prop wearing the group props' crate model
 *   (`0x19E8`) takes two; every other kind is destroyed by the first.
 * * **The lifetime is in `+0x11C`**, the field that is hit points for a combat
 *   actor and the group id for the placer. `KindedPropUpdate` never reads it
 *   as a shot count at all.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { T } from "../tables";
import { MsvcRand } from "./group";
import { ReleaseHiddenItem } from "./items";
import {
  BreakableFlag, BreakableSlot, BreakableState, HIT_FLAG_MASK, ItemSet,
  makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";

/**
 * The asset slot each object kind draws, from the chain of `if`s in
 * `PlaceKindedProp`. A kind with no entry gets `0xFFFF` — nothing is drawn,
 * which is what the engine's `-1` means.
 */
export const KIND_SLOT: Partial<Record<number, number>> = {
  2: 0x17a9,
  3: BreakableSlot.Default,      // 0x19E8, the same crate the groups use
  8: 0x17aa,
  9: 0x17ab,
};

/** `AssetDrawSlot(0x10D1)` — the smaller ground shadow kinds 4 and 5 get. */
export const SHADOW_SLOT_SMALL = 0x10d1;

/** The kinds that draw a shadow at all, and which one. */
export const KIND_SHADOW: Partial<Record<number, number>> = {
  0: 0x10d0, 3: 0x10d0, 6: 0x10d0, 7: 0x10d0, 10: 0x10d0,
  4: SHADOW_SLOT_SMALL, 5: SHADOW_SLOT_SMALL,
};

/** The slot a cracked `0x19E8` kinded prop swaps to: nothing at all. */
export const SLOT_NONE = 0xffff;

/** Item set 6 releases 0.5 higher for these kinds; set 7 by 0.9 for `0x17AB`. */
const SET6_RAISED_KINDS = [2, 8, 9];
const SET6_RISE = 0.5;
const SET7_RISE = 0.9;

/**
 * `PlaceKindedProp` — `FUN_00462E10`. One prop, from the spawn descriptor.
 *
 * The *orientation* words carry the payload: `obj+0x6C` is the object kind and
 * `obj+0x64` the item-set size. That is why `docs/formats/spawns.md` warns
 * that the class-0x41 orientation triple must never be read as angles.
 */
export function PlaceKindedProp(at: number, kind: number, itemSet: number,
                                setSize: number, lifetime: number,
                                x: number, y: number, z: number, yaw: number,
                                rng: Rng): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.Kinded;
  p.at = at;
  p.kind = kind;
  p.itemSet = itemSet;
  // `+0x11C` is the lifetime in evt blocks here, not a shot count.
  p.lifetime = lifetime;
  p.spawnBlock = G.g_evt_block_counter;
  p.blocksElapsed = 0;
  p.x = x;
  p.y = y;
  p.z = z;
  p.yaw = yaw;
  p.flags = 0x80000000 | BreakableFlag.Live;
  p.state = BreakableState.Standing;
  p.slot = KIND_SLOT[kind] ?? SLOT_NONE;
  p.storyItem = -1;

  const params = T.breakables?.kinds?.[kind];
  p.effect = params?.effect ?? 0;
  p.effectVariant = params?.effect_variant ?? 0;

  // The countdown is seeded per *spawn*, so the last of a set to be placed is
  // the one whose draw decides which break pays out. Groups 6 and 7 of the
  // table placer have the same quirk.
  if (itemSet > 0) {
    G.g_item_set_countdown[itemSet] =
      setSize > 1 ? (MsvcRand(rng) % setSize) + 1 : 1;
  }
  return p;
}

/**
 * `KindedPropUpdate` — `FUN_00465FB0`. One prop, one 60 Hz frame.
 */
export function KindedPropUpdate(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  // `FUN_00466640`: the same evt-block lifetime the other families have, but
  // measured against `+0x11C`.
  if (G.g_evt_block_counter !== p.spawnBlock) {
    p.blocksElapsed += 1;
    if (p.blocksElapsed > p.lifetime) { ActorDespawnProp(p); return; }
    p.spawnBlock = G.g_evt_block_counter;
  }

  // `+0x32C` is the break effect's frame counter; once it is running the prop
  // has been destroyed and takes no more shots.
  if (p.effectFrames === 0 && (p.flags & BreakableFlag.Hit) !== 0) {
    if (p.slot === BreakableSlot.Default) {
      // The crate model is the only kind that survives a shot. No score — the
      // engine passes 0 — and the model is hidden rather than swapped, so what
      // is left standing is the shadow and the shake.
      BreakablePropAwardHit(p.flags, false, rng);
      p.slot = SLOT_NONE;
      p.shake = 1.0;
      events?.emit("prop.cracked", { id: p.id, sound: SFX_KINDED_CRACK });
    } else {
      BreakablePropAwardHit(p.flags, true, rng);
      p.effectFrames = 1;
      const params = T.breakables?.kinds?.[p.kind];
      events?.emit("prop.broken",
                   { id: p.id, sound: params?.sound ?? SFX_KINDED_CRACK });
      ReleaseKindedItem(p, events);
    }
  }
  p.flags &= ~HIT_FLAG_MASK;

  if (p.shake > 0.01) p.shake *= 0.85;

  // The break effect runs for as long as its own animation, then the prop
  // goes — unless its item set is 0 or 4, which the engine leaves standing.
  if (p.effectFrames > 0) {
    p.effectFrames += 1;
    const frames = EffectFrames(p.effectVariant);
    if (p.effectFrames > frames) {
      if (p.itemSet !== ItemSet.None && p.itemSet !== ItemSet.NoRelease) {
        ActorDespawnProp(p);
        return;
      }
      p.effectFrames = frames;
    }
  }
}

/** `PlaySoundId(0x1D16A9)` — the crack, shared with the group props. */
export const SFX_KINDED_CRACK = 0x1d16a9;

/**
 * How long a break effect plays: `DAT_004E07D0[variant] - 2` frames.
 *
 * [diverges] That table is the shared effect-animation length table and is not
 * in the bundle; nothing else in the port reads it. The port uses the group
 * props' own 0x48, which is the right order of magnitude and only decides when
 * a destroyed prop stops being drawn.
 */
function EffectFrames(_variant: number): number {
  return 0x48;
}

/**
 * The item release, with the two height tweaks this family has and the others
 * do not: set 6 lifts the drop by 0.5 for kinds 2, 8 and 9, and set 7 by 0.9
 * when the prop is wearing `0x17AB`.
 */
function ReleaseKindedItem(p: BreakableProp, events?: Events): void {
  let rise = 0;
  if (p.itemSet === 6 && SET6_RAISED_KINDS.includes(p.kind)) rise = SET6_RISE;
  else if (p.itemSet === 7 && p.slot === 0x17ab) rise = SET7_RISE;
  ReleaseHiddenItem(p, events, rise);
}

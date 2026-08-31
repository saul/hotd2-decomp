/**
 * `PlaceGenericProp` — `FUN_00461CF0`, the constructor 44 of class 0x41's 79
 * types share, and **173 of its 316 spawns**.
 *
 * It is the reason so many `c65` markers had nothing under them: everything it
 * builds was absent from the player entirely.
 *
 * ## How one constructor serves forty-four objects
 *
 * There are **two** 79-entry tables, back to back. `g_class41_constructors`
 * (0x00593580) says which constructor a type uses; the one immediately after
 * it at 0x005936BC says which routine the object that constructor allocates
 * then *runs*:
 *
 * ```c
 * obj = ActorAlloc(g_class41_entries[type], 0x378);
 * ```
 *
 * So `PlaceGenericProp` is one function that builds thirty different objects,
 * and a `switch` on the type afterwards applies whatever that particular one
 * needs — an asset slot, a hit radius, a shot count, an effect id.
 *
 * ## `+0x11C` is the asset slot
 *
 * The prologue does `obj+0x28C = placer+0x11C`, so for this family the word
 * that is hit points for a combat actor, the group id for the table placer and
 * the lifetime for a kinded prop is the **model to draw**. A spawn marker
 * reading `hp5949` is a prop wearing slot `0x173D`. Four meanings, one offset;
 * this is the fourth the project has found.
 *
 * ## What is ported here, and what is not
 *
 * The constructor is transcribed. Of the objects it builds, only **type 34**
 * has its update routine ported — it is a `FallingContainerUpdate`, the same
 * object class 0x44 selector 16 places, and it seeds an item countdown, so
 * leaving it out was leaving twelve item containers out of stages 1, 3, 4
 * and 5.
 *
 * [diverges] Every other type is placed and **drawn where the script put it,
 * with no behaviour** — `PropFamily.Generic`. Their thirty update routines are
 * unread: `FUN_00467E50` (type 12, 36 spawns), `FUN_004717A0` (77, 24),
 * `FUN_004675A0` (70/71, 20), `FUN_0046EB20` (51, 11), `FUN_0046CEA0` (43, 7),
 * `FUN_0046A1C0` (31, 6) and the rest of a long tail. Some of them are not
 * props at all: cases 0x13 and 0x19 increment `g_enemies_present` and case
 * 0x0E `g_enemies_alive`, so a few of these are enemies standing still. A
 * static model in the right place is better information than nothing, but it
 * is not a port, and the count of them is the honest measure of what is left.
 */
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import type { BreakablePlacement } from "../../bundle";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "./prop_state";

/**
 * The per-type hit radius the switch sets, in the cases that set one. `+0x124`
 * is the shot-test radius, so a type missing here is not shootable at all.
 */
export const GENERIC_RADIUS: Partial<Record<number, number>> = {
  7: 12, 0x49: 12, 0x0b: 2, 0x3c: 2, 0x0e: 2, 0x14: 7, 0x19: 12,
  0x13: 1.5, 0x38: 1.5, 0x29: 7, 0x31: 5, 0x39: 5, 0x3a: 3, 0x4b: 3,
  0x45: 4, 0x46: 3, 0x47: 3, 0x48: 3, 0x4a: 9, 0x4c: 3, 0x4d: 6,
};

/** The types whose switch arm overrides the slot the prologue took. */
export const GENERIC_SLOT: Partial<Record<number, number>> = {
  6: 0x1032, 10: 0x10c4, 0x0d: 0x1a4a, 0x13: 0x10d3, 0x38: 0x10d3,
};

/** The types whose switch arm sets a shot count. */
export const GENERIC_HP: Partial<Record<number, number>> = {
  6: 1, 10: 2,
};

/**
 * `PlaceGenericProp` — `FUN_00461CF0`.
 *
 * The prologue, which every type gets, plus the arms of the switch that set
 * something the port or the renderer reads. The arms that seed a routine's own
 * working state — the eight-fragment loop of case 8, the three velocities of
 * case 0x24, the sub-object lists of cases 0x43 and 0x2B — are left out on
 * purpose: nothing runs the routines that would read them back, and inventing
 * their state would be inventing behaviour.
 */
export function PlaceGenericProp(pl: BreakablePlacement,
                                 rng: Rng): BreakableProp {
  const type = pl.type ?? 0;
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.Generic;
  p.at = pl.at;
  p.kind = type;
  p.state = BreakableState.Standing;
  p.flags = 0x80000000 | BreakableFlag.Live;
  p.spawnBlock = G.g_evt_block_counter;
  p.blocksElapsed = 0;
  // The lifetime is not read for this family: the prologue writes the block
  // counter but no generic arm sets `+0x199`, and the routines that expire
  // themselves are the unported ones.
  p.lifetime = 0;

  p.x = pl.pos?.[0] ?? 0;
  p.y = pl.pos?.[1] ?? 0;
  p.z = pl.pos?.[2] ?? 0;
  // All three orientation words are real angles here, unlike the kinded props
  // — the prologue copies them straight to `+0x1CC`/`+0x1D0`/`+0x1D4`.
  p.pitch = pl.pitch ?? 0;
  p.yaw = pl.yaw ?? 0;
  p.roll = pl.roll ?? 0;

  // `obj+0x28C = placer+0x11C` — the slot, from the word that means something
  // different in every other family.
  p.slot = GENERIC_SLOT[type] ?? pl.slot ?? 0;
  p.hp = GENERIC_HP[type] ?? 0;

  // Case 0x20 stands the object up and faces it a quarter turn; the only arm
  // that overrides the orientation the descriptor gave it.
  if (type === 0x20) {
    p.yaw = 0x4000;
    p.pitch = 0;
  }
  void rng;
  return p;
}

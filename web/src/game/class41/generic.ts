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
 * obj = ActorAlloc(g_class41_updates[type], 0x378);
 * ```
 *
 * So `PlaceGenericProp` is one function that builds thirty different objects,
 * and a `switch` on the type afterwards applies whatever that particular one
 * needs — an asset slot, a hit radius, a shot count, an effect id.
 *
 * ## `+0x11C` is a lifetime, and *sometimes also* an asset slot
 *
 * The prologue writes the placer's `+0x11C` into **two** fields:
 *
 * ```c
 * obj->+0x28C = placer->+0x11C;     // the asset slot
 * obj->+0x11C = placer->+0x11C;     // the lifetime, in event steps
 * ```
 *
 * One number in the script, read as two different things — and which one it
 * really is depends on the type, because only three of the routines ever draw
 * `obj+0x28C`. Everything else hardcodes its model, so for those types the
 * number is a lifetime and nothing else.
 *
 * The port used to export it as a slot unconditionally. That resolved 46 of
 * stage 2's 67 generic props to `char_adv03.bin`, `eff_boss4.bin` and
 * `bg_adv10.bin` — characters and effects standing in for scenery, which is
 * what "a lot of the props aren't rendering" looked like from the outside.
 *
 * The measurement that says the two meanings never overlap: the distinct
 * `+0x11C` values stage 2 places are **0, 1, 2, 3, 4, 5 and then 0x1D8
 * upwards, with nothing in between**, and the three types carrying the high
 * values are exactly {@link GENERIC_DESCRIPTOR_SLOT}. A reading that had
 * these mixed up would have to explain a prop with a lifetime of 5949 blocks
 * in a 42-block stage, or a model at asset slot 2.
 *
 * ## What is ported here, and what is not
 *
 * The constructor is transcribed, and so is the lifetime prologue every one
 * of these objects opens with (`PropExpireByStepLifetime`, `class41/
 * lifetime.ts`) — without it a prop the script placed for one block stands
 * there for the rest of the stage.
 *
 * Two types have their behaviour ported: **34**, a `FallingContainerUpdate`
 * and therefore an item container, and **32**, the lift
 * (`class41/lift.ts`).
 *
 * [diverges] The rest are placed, drawn with the right model, and **do
 * nothing**. Their routines have been read for what they draw — that is
 * {@link GENERIC_DRAW_SLOT} — but not transcribed, so a type that flips its
 * model on a script flag, swings, falls, or animates through a strip of slots
 * shows its first frame and holds it. The largest are `FUN_00467E50`
 * (type 12, 36 spawns), `FUN_004717A0` (77, 24), `FUN_004675A0` (70/71, 20),
 * `FUN_0046EB20` (51, 11) and `FUN_0046CEA0` (43, 7).
 *
 * Some of them are not props at all: cases 0x13 and 0x19 increment
 * `g_enemies_present` and case 0x0E `g_enemies_alive`, so a few of these are
 * enemies standing still.
 */
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { GENERIC_BRANCH_SEED } from "./branch";
import type { BreakablePlacement } from "../../bundle";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "./prop_state";
import {
  LIFT_FAR_CLOSED, LIFT_NEAR_CLOSED, LIFT_PANEL_CLOSED,
} from "./lift";

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
 * The three types whose update routine draws `obj+0x28C`, so that the spawn
 * descriptor's `+0x11C` really is the model.
 *
 * * 5 — `FUN_00466820`, a static prop the script can clear with flag 0x13.
 * * 12 — `FUN_00467E50`, scaled and z-offset, removed at cam path 0x2F
 *   frame 0x96.
 * * 33 — `FUN_00472950`, which draws `+0x28C + n` and dies when `n` passes
 *   `+0x2A4`: a strip of slots played as an animation.
 *
 * Every other type's `+0x11C` is a lifetime. See the module comment.
 */
export const GENERIC_DESCRIPTOR_SLOT: ReadonlySet<number> = new Set([5, 12,
                                                                     33]);

/**
 * What each read type actually draws — the first `AssetDrawSlot` literal in
 * its update routine, or `null` where it draws no static model at all.
 *
 * A type absent from this table has not been read; the renderer falls back to
 * `obj+0x28C`, which is right for {@link GENERIC_DESCRIPTOR_SLOT} and a guess
 * for anything else.
 *
 * Only the *first* slot is here. Several of these routines draw two or three
 * parts, or step through a strip — `FUN_004694A0` draws `0x132F + frame % 10`
 * and `FUN_00467C80` alternates `0x1CF`/`0x1D0` — and none of that motion is
 * ported, so the model shown is the one the routine's first frame draws.
 */
export const GENERIC_DRAW_SLOT: Partial<Record<number, number | null>> = {
  6: 0x1032,        // ctor arm; `FUN_004668A0` steps it upward from there
  8: 0x1a36,        // `FUN_00467080`, `0x1A36 - obj+0x290`, and +0x290 is 0
  10: 0x10c4,       // ctor arm; same routine as 6
  11: 0x01cf,       // `FUN_00467C80`, `0x1CF + (frame & 1)`
  13: 0x1a4a,       // `FUN_00467F50`, from the ctor arm
  14: 0x10d2,       // `FUN_00468180`
  18: null,         // `FUN_00468E50` — an effect at +0x324 and nothing else
  19: 0x01ce,       // `FUN_00468F00`, body; the arm's 0x10D3 is a sub-part
  20: 0x01e2,       // `FUN_00469380`
  21: 0x132f,       // `FUN_004694A0`, `0x132F + frame % 10`
  25: null,         // `FUN_00469AE0` — effect only
  27: 0x17a9,       // `FUN_00469E60`
  28: null,         // `FUN_00469F50` — effect only
  30: 0x01df,       // `FUN_0046A0F0`
  32: 0x197a,       // `LiftUpdate`; the leaves and ramp are its own draw
  35: 0x1812,       // `FUN_0046B320`, at fixed world coordinates
  49: 0x01d2,       // `FUN_0046E6E0`
  56: 0x10d3,       // ctor arm 0x38
  58: 0x01d1,       // `FUN_0046F580`
  60: 0x01d8,       // `FUN_0046F840`
  64: 0x1a39,       // `FUN_0046FBE0`
  77: 0x10ab,       // `FUN_004717A0`, Original Mode only
};

/**
 * Class 0x41 type 32. Not in `PropContainerType`, which names the types that
 * have their *own* constructor; this one shares `PlaceGenericProp`.
 */
const PropContainerType32 = 32;

/**
 * The types whose update routine's **first line** is
 * `if (g_GameMode != 1) { ActorDespawn(obj); return; }`.
 *
 * They are Original Mode's collectibles — `FUN_004675A0` (70, 71),
 * `FUN_00470750` (72) and `FUN_004717A0` (77), which also wants item 0x1F in
 * the inventory and otherwise plays a refusal sound on its way out. Arcade
 * Mode places them and they vanish on their first frame, so in the port they
 * have to vanish too: without this they stand in the level for ever wearing
 * whatever `obj+0x28C` happens to hold, which for these is a lifetime rather
 * than a slot and draws `eff_3.bin`.
 *
 * [open] `FUN_00470E20` (74), `FUN_004710C0` (75) and `FUN_00471330` (76) are
 * probably the same family and are not read, so they are not in here.
 */
export const GENERIC_ORIGINAL_MODE_ONLY: ReadonlySet<number> =
  new Set([70, 71, 72, 77]);

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
  p.family = type === PropContainerType32 ? PropFamily.Lift
                                          : PropFamily.Generic;
  p.at = pl.at;
  p.kind = type;
  p.state = BreakableState.Standing;
  p.flags = 0x80000000 | BreakableFlag.Live;
  p.lastStepIndex = G.g_evt_step_index;
  p.stepsElapsed = 0;
  // `obj+0x11C` — the lifetime `PropExpireByStepLifetime` counts down. The
  // same word the slot came from, and for most types the *only* meaning it
  // has. `+0x199` is not involved: this family measures against `+0x11C`.
  p.lifetime = pl.lifetime_evt_steps ?? 0;
  // `ActorAlloc` zeroes the object, and no arm the port covers writes
  // `+0x2A0` — which for the lift is its panel's frame counter and so
  // has to start at zero rather than at the group props' -1.
  p.storyItem = 0;

  p.x = pl.pos?.[0] ?? 0;
  p.y = pl.pos?.[1] ?? 0;
  p.z = pl.pos?.[2] ?? 0;
  // All three orientation words are real angles here, unlike the kinded props
  // — the prologue copies them straight to `+0x1CC`/`+0x1D0`/`+0x1D4`.
  p.pitch = pl.pitch ?? 0;
  p.yaw = pl.yaw ?? 0;
  p.roll = pl.roll ?? 0;

  // `obj+0x28C = placer+0x11C` — carried for every type, because that is what
  // the engine writes; whether it means anything is `GENERIC_DRAW_SLOT`'s
  // business, not this function's.
  p.slot = GENERIC_SLOT[type] ?? pl.slot ?? 0;
  p.hp = GENERIC_HP[type] ?? 0;

  // **Three of the switch arms write `g_script_branch_var` at spawn time.**
  // Cases 0x0E and 0x13 write the descriptor's own `+0x11C` and case 0x19
  // writes 0, and their update routines write `1 - +0x11C` on the first hit —
  // so the descriptor names the DEFAULT route and shooting the prop takes the
  // other one. See `class41/branch.ts`.
  //
  // The same three arms also increment `g_enemies_alive` (0x0E) or
  // `g_enemies_present` (0x13 and 0x19), and those are **deliberately not
  // here**: the give-back lives in the update routines, which are ported only
  // as far as their branch arm. Counting an enemy in with no way to count it
  // out is how a `wait_enemies_alive` gate deadlocks a stage, and this port
  // has a file of those.
  const seed = GENERIC_BRANCH_SEED[type];
  if (seed !== undefined) {
    G.g_script_branch_var = seed === null ? p.lifetime : seed;
  }

  // Case 0x20 is the lift. These are not the prop's orientation: they
  // are its three hinge angles at rest, and `LiftUpdate` swings each one
  // from exactly this value — which is how its sound cues, written as
  // equalities, fire once and only on the first frame of a swing.
  if (type === PropContainerType32) {
    p.yaw = LIFT_NEAR_CLOSED;
    p.hingeB = LIFT_FAR_CLOSED;
    p.pitch = LIFT_PANEL_CLOSED;
  }
  void rng;
  return p;
}

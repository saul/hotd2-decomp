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
 * `PropDrawOnlyType51` (51, 11) and `FUN_0046CEA0` (43, 7).
 *
 * Type 51 is the one of those five that needs nothing else: the routine's
 * whole body is the lifetime prologue and one `AssetDrawSlot`, both of which
 * this file already has. It drew nothing for as long as it did because it was
 * missing from {@link GENERIC_DESCRIPTOR_SLOT} — a table about the exporter,
 * two layers away from the placement — and that is the shape to watch for in
 * the other four.
 *
 * `[open]` **The renderer poses all forty-four of these as `Ry·Rz·Rx`**, which
 * is `PropDrawOnlyType51`'s order and not the family's: types 5, 12, 31, 33,
 * 53 and 54 compose `Rz·Ry·Rx`. Fifteen shipped spawns have two or more
 * non-zero angles and so are posed wrongly — four type-5s and five type-12s in
 * stage 2, five type-12s in stage 4, one type-33 in stage 2 — plus stage 3's
 * three type-31s once those are carried. Not fixed here; it wants its own arm
 * in `render/breakables.ts` and its own render check.
 *
 * Some of them are not props at all: cases 0x13 and 0x19 increment
 * `g_enemies_present` and case 0x0E `g_enemies_alive`, so a few of these are
 * enemies standing still.
 */
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { GENERIC_BRANCH_SEED } from "./branch";
import { PROP75_TYPE } from "./flag_prop";
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
 * The types whose update routine draws `obj+0x28C`, so that the spawn
 * descriptor's `+0x11C` really is the model.
 *
 * * 5 — `PropDrawOnlyType5` (`FUN_00466820`), a static prop the script can
 *   clear with flag 0x13.
 * * 12 — `FUN_00467E50`, scaled and z-offset, removed at cam path 0x2F
 *   frame 0x96.
 * * 33 — `FUN_00472950`, which draws `+0x28C + n` and dies when `n` passes
 *   `+0x2A4`: a strip of slots played as an animation.
 * * 51 — `PropDrawOnlyType51` (`FUN_0046EB20`): `PropExpireByStepLifetime`,
 *   then `Translate(x, y, z + obj+0x1C8); RotY; RotZ; RotX;
 *   AssetDrawSlot((s16)obj+0x28C)` and nothing else at all.
 *
 * Every other type's `+0x11C` is a lifetime. See the module comment.
 *
 * **51 is here because the stage 5 van was drawn with only its rear doors.**
 * The doors are a class-0x44 selector-2 hinge pair at slots `0x1794`/`0x1795`;
 * the body is a type-51 placement at the same position and yaw drawing
 * `0x1793`, the model immediately before them in `char_adv04.bin`. This set is
 * read by `hod2lib/bundle.ts`'s `breakableSlotEntry` to decide which slots'
 * geometry travels in the bundle, so leaving 51 out meant `DrawSlotFor`
 * returned `0x1793` every frame and the renderer had nothing to clone for it.
 * A placement with no model and a placement that was never exported look
 * exactly the same from the level.
 *
 * `[open]` **The set is seven types, not four.** The routines that pass
 * `obj+0x28C` to `AssetDrawSlot` are 5, 12, **31**, 33, 51, **53** and **54**
 * — all seven read and annotated: `PropDrawOnlyType31` (`FUN_0046A1C0`, 6
 * spawns, slots `0xB3F`/`0xD01`/`0x1874`), `PropDrawOnlyType53`
 * (`FUN_0046EBD0`, 2 spawns, slot `0x2B`) and `PropDrawOnlyType54`
 * (`FUN_0046EDC0`, 2 spawns, slot `0x18A1`). They are not here because adding
 * a type makes its model travel *and* draw, and these three's own arms are
 * unported — 54's drift is authored, identical for every spawn, and would be
 * visibly static. **Ten more spawns of scenery are missing for the reason the
 * van was.** `tools/verify_prop_slots.py` holds whatever this set says, so the
 * way to close it is one type at a time with its retirement rule read.
 */
export const GENERIC_DESCRIPTOR_SLOT: ReadonlySet<number> =
  new Set([5, 12, 33, 51]);

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
  75: 0x0a6b,       // `PropUpdateType75`, riding object path 0x178
  77: 0x10ab,       // `FUN_004717A0`, Original Mode only
};

/**
 * The types whose switch arm writes the placer's `+0x1F4` over `obj+0x11C`,
 * so their lifetime is **not** the word their asset slot came from.
 *
 * ```
 * case 0xC: case 0x1F: case 0x33: case 0x35:
 *     *(u16 *)(obj + 0x11C) = *(u16 *)(placer + 0x1F4);
 * ```
 *
 * `obj+0x1F4` is the **signed byte at `desc+0x24`**, widened by
 * `FUN_004088A0`; the bundle carries it as `field_1f4`. Without this the four
 * types that both draw `obj+0x28C` and overwrite `obj+0x11C` are given their
 * own asset slot as a lifetime, which is 6057 event steps for stage 2's crates
 * and 6035 for the stage 5 van — no shipped stage has that many step changes,
 * so `PropExpireByStepLifetime` never retires them and every one of them
 * stands in the level until the stage ends.
 *
 * **[proved] across the shipped data.** All 55 spawns of these four types
 * carry 0..7 in `desc+0x24` and a real asset slot in `+0x11C`: type 12's 36
 * run 0-7, type 31's six are 1 and 4, type 51's eleven are 4 and 6, type 53's
 * two are 6. A reading with these the other way round would have to explain a
 * prop with a 6057-step life in a 42-block stage.
 *
 * `[open]` Types **6**, **10** and **34** also overwrite `obj+0x11C`, with the
 * literals 1, 2 and 2. {@link GENERIC_HP} reads those as a shot count and this
 * port keeps that reading; which of the two `FUN_004668A0` and
 * `FallingContainerUpdate` mean by the field has not been read here, and the
 * two meanings would give 6 and 10 a one- and two-step life.
 */
export const GENERIC_LIFETIME_FROM_1F4: ReadonlySet<number> =
  new Set([12, 31, 51, 53]);

/**
 * Class 0x41 type 32. Not in `PropContainerType`, which names the types that
 * have their *own* constructor; this one shares `PlaceGenericProp`.
 */
const PropContainerType32 = 32;

/**
 * The generic types whose object runs a routine of its own rather than the
 * shared prologue, and so gets its own {@link PropFamily}.
 *
 * A table and not two `if`s because the difference between these and the
 * other forty-two is *which routine `ActorAlloc` was handed* — the same fact
 * `g_class41_updates` holds — and a table is what that looks like. Every type
 * absent from it is `Generic`, which is the pool arm that supplies the
 * prologue those routines really do open with.
 */
export const GENERIC_FAMILY: Partial<Record<number, PropFamily>> = {
  [PropContainerType32]: PropFamily.Lift,
  [PROP75_TYPE]: PropFamily.Type75,
};

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
 * `PropUpdateType75` (`FUN_004710C0`, type 75) **is** gated on the same test
 * and is deliberately *not* in here: its arm raises `g_script_flags[20]`
 * before it despawns, and a plain despawn would hold stage 4's block-2 gate
 * shut for the whole of Arcade Mode. It has its own family — see
 * `class41/flag_prop.ts`. `FUN_00470E20` (74) and `PropUpdateType76`
 * (`FUN_00471330`, 76) are still `[open]`.
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
  p.family = GENERIC_FAMILY[type] ?? PropFamily.Generic;
  p.at = pl.at;
  p.kind = type;
  p.state = BreakableState.Standing;
  p.flags = 0x80000000 | BreakableFlag.Live;
  p.lastStepIndex = G.g_evt_step_index;
  p.stepsElapsed = 0;
  // `obj+0x11C` — the lifetime `PropExpireByStepLifetime` counts down. For
  // most types it is the same word the slot came from and the *only* meaning
  // that word has; for the four in {@link GENERIC_LIFETIME_FROM_1F4} the
  // switch arm replaces it with the placer's `+0x1F4`. `+0x199` is not
  // involved: this family measures against `+0x11C`.
  p.lifetime = GENERIC_LIFETIME_FROM_1F4.has(type)
    ? (pl.field_1f4 ?? 0)
    : (pl.lifetime_evt_steps ?? 0);
  // `ActorAlloc` zeroes the object, and no arm the port covers writes
  // `+0x2A0` — which for the lift is its panel's frame counter and so
  // has to start at zero rather than at the group props' -1.
  p.storyItem = 0;
  // Same argument for `+0x2A4`: `PropUpdateType75` counts step changes up
  // from zero in it, and the struct's default is the story switch's -1.
  if (p.family === PropFamily.Type75) p.removeFlag = 0;

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
  // `obj+0x124` — the switch's own per-type hit radius, and the whole of what
  // makes a generic prop shootable. A type missing from the table is a type
  // the engine never registers a sphere for.
  p.hitRadius = GENERIC_RADIUS[type] ?? 0;

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

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
 * **The renderer used to pose every one of these `Ry·Rz·Rx`**, which is
 * `PropDrawOnlyType51`'s order and not the family's. It now reads
 * {@link GENERIC_POSE_ORDER}, which `tools/verify_prop_pose.py` derives from
 * the EXE per type and is the authority on the count.
 *
 * The count that went with the `[open]` note was fifteen, and it was the wrong
 * measure twice over. **The order only matters when yaw and roll are both
 * non-zero** — `Rx` is last in every one of these compositions, so all an
 * order can disagree about is whether `Ry` or `Rz` comes first, and with
 * either angle at zero the two matrices are equal. That is why type 5's four
 * stage-2 spawns, which carry a pitch and a yaw and no roll, were never
 * misplaced at all. And the fifteen was counted over six stages rather than
 * the twelve bundles. What the check measures is 20 spawns posed differently,
 * **four of them by more than a degree and all four `PropDrawOnlyType12`** —
 * stage 4's blocks 4, 7, 12 and 13, the worst by 19.65°. The other sixteen are
 * fifths of a degree, because for types 31 and 33 the "roll" is a strip
 * length.
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
 * The composition a class-0x41 generic type's routine applies the spawn
 * descriptor's three orientation words in, before it draws.
 *
 * `[port-only]` as a *table*: the engine enumerates nothing here, each of the
 * fifty routines simply has its own sequence of `MatrixRotate*` calls. It is
 * an enum rather than three booleans because the *order* is the fact, and the
 * member's value is the order — `"ZYX"` is `MatrixRotateZ` then `Y` then `X`,
 * read left to right as the engine calls them, which for a pre-multiplying
 * matrix stack composes as `Rz·Ry·Rx`.
 *
 * `tools/verify_prop_pose.py` reads these values straight out of the EXE and
 * fails on any that disagrees, which is what stops the table becoming the
 * second source `L16` is about.
 */
export enum PoseOrder {
  /** `MatrixRotateZ(roll); MatrixRotateY(yaw); MatrixRotateX(pitch)`. */
  RollYawPitch = "ZYX",
  /** `MatrixRotateY(yaw); MatrixRotateZ(roll); MatrixRotateX(pitch)`. */
  YawRollPitch = "YZX",
  /** One rotation, about Y, and the descriptor's other two words unused. */
  YawOnly = "Y",
  /** One rotation, about Z. */
  RollOnly = "Z",
  /** `MatrixRotateZ(roll); MatrixRotateX(pitch)` — no yaw at all. */
  RollPitch = "ZX",
  /** `MatrixRotateY(yaw); MatrixRotateX(pitch)` — no roll. */
  YawPitch = "YX",
  /**
   * The routine applies **none** of the three words: it draws at the spawn's
   * position and whatever orientation the model was authored with. Nine
   * types, and no shipped spawn of any of them carries an angle at all.
   */
  NoRotation = "",
  /**
   * `[open]` — the routine rotates from something the scanner cannot attribute
   * to a descriptor word. Two types: **75** poses from the object path it
   * rides (`PropUpdateType75`, `FUN_004710C0`), and **41**
   * (`FUN_0046CC50`) takes its Z from a register the read did not follow.
   * The renderer leaves these on the family default rather than guess.
   */
  Unread = "?",
}

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
 * * 12 — `PropDrawOnlyType12` (`FUN_00467E50`), scaled, and removed when
 *   `g_active_cam_path` is 0x2F at frame 0x96.
 * * 31 — `PropDrawOnlyType31` (`FUN_0046A1C0`), an effect strip that wraps.
 * * 33 — `PropDrawOnlyType33` (`FUN_00472950`), which draws `+0x28C + n` and
 *   dies when `n` passes `+0x2A4`: a strip of slots played once.
 * * 51 — `PropDrawOnlyType51` (`FUN_0046EB20`): `PropExpireByStepLifetime`,
 *   then `Translate(x, y, z + obj+0x1C8); RotY; RotZ; RotX;
 *   AssetDrawSlot((s16)obj+0x28C)` and nothing else at all.
 * * 53 — `PropDrawOnlyType53` (`FUN_0046EBD0`), with its own inline lifetime.
 * * 54 — `PropDrawOnlyType54` (`FUN_0046EDC0`), which drifts on a flag.
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
 * **The set is seven types, and all seven are here.** The routines that pass
 * `obj+0x28C` to `AssetDrawSlot` are 5, 12, 31, 33, 51, 53 and 54, and the
 * last three used to be held out because adding a type makes its model travel
 * *and* draw, so a type whose own arm was unported would have arrived wearing
 * the right geometry and doing the wrong thing. Their arms are ported now —
 * `class41/draw_only.ts` — which is what let them in:
 *
 * * **31** — `PropDrawOnlyType31` (`FUN_0046A1C0`), 6 spawns. An **effect
 *   strip**: `eff_1.bin[8..46]` in stage 1, `eff_taki.bin[0..9]` in stage 3
 *   and `eff_taki.bin[30..59]` in stage 4, one frame a tick, wrapping. See
 *   {@link GENERIC_SLOT_STRIP}.
 * * **53** — `PropDrawOnlyType53` (`FUN_0046EBD0`), 2 spawns, slot `0x2B` =
 *   `char_adv04.bin[0]`, with its own inline lifetime.
 * * **54** — `PropDrawOnlyType54` (`FUN_0046EDC0`), 2 spawns, slot `0x18A1` =
 *   `st5_02b.bin[6]`, which drifts for 300 frames on `g_script_flags[12]`
 *   and then kills itself. Ten shipped spawns of scenery in total, missing
 *   for exactly the reason the van's body was.
 *
 * `tools/verify_prop_slots.py` holds whatever this set says, and
 * `tools/verify_prop_pose.py` holds the order each of them is drawn in.
 */
export const GENERIC_DESCRIPTOR_SLOT: ReadonlySet<number> =
  new Set([5, 12, 31, 33, 51, 53, 54]);

/**
 * The two types whose routine plays `obj+0x28C` as a **strip of slots** and
 * takes the strip's length from `obj+0x2A4`.
 *
 * ```
 * AssetDrawSlot((s16)obj+0x28C + (s32)obj+0x2A0)
 * obj+0x2A0++;  if (obj+0x2A0 > obj+0x2A4)  ...
 * ```
 *
 * Type 31 wraps the cursor back to 0 there; type 33 `ActorKill`s. **Neither
 * tail is in the decompilation** — `MatrixStackPop` is marked no-return, so
 * Ghidra ends both function bodies at that `CALL` and the pseudocode of each
 * is a bare draw of `obj+0x28C + obj+0x2A0` with nothing stepping the cursor
 * (`L37`). `disassemble_bytes` past `0x004729B3` and `0x0046A333` is what
 * found them.
 *
 * `PlaceGenericProp`'s arms at `0x0046205E` (type 31) and `0x004620BE`
 * (type 33) both write `obj+0x2A4` from the placer's `+0x6C` — **the spawn
 * descriptor's third orientation word**. So for these two types that word is a
 * frame count *and* a roll: the prologue copies it to `obj+0x1D4` as well and
 * the routine applies it, which for the shipped values (9, 0x1D, 0x26, 0x3B)
 * is a fifth of a degree. Both readings are the engine's and the port makes
 * both.
 *
 * `[open]` Type 33's strip and its death are not ported: its single stage-2
 * spawn plays 60 frames of `eff_shop.bin` and then kills itself, and the port
 * draws frame 0 and holds it — the standing divergence this module declares.
 * It is in this table so the exporter carries the strip either way, because
 * what travels is decided by the routine and not by how far the port has got.
 */
export const GENERIC_SLOT_STRIP: ReadonlySet<number> = new Set([31, 33]);

/**
 * The order a generic type's routine applies the spawn descriptor's three
 * orientation words, and the whole of what {@link PoseOrder} is for.
 *
 * `render/breakables.ts` composed `Ry·Rz·Rx` for all fifty of these, which is
 * `PropDrawOnlyType51`'s order and **only** its order: twenty-two of the
 * family compose `Rz·Ry·Rx`, five `Ry·Rz·Rx`, twelve rotate about Y alone, one
 * about Z alone, one `Rz·Rx` with no yaw at all, six apply none of the three
 * words, and three are `[open]`. Twenty shipped spawns came out in the wrong
 * place, four of them by more than a degree and the worst by 19.65° — all four
 * `PropDrawOnlyType12`, in stage 4's blocks 4, 7, 12 and 13.
 *
 * `tools/verify_prop_pose.py` derives this table from the EXE and fails on any
 * row that disagrees, so it is a mirror and not a second source. Its two
 * measurements are worth keeping in view:
 *
 * * **The order only matters when yaw and roll are both non-zero.** With
 *   either at zero the two compositions are the same matrix, which is why
 *   type 5's four stage-2 spawns — pitch and yaw, roll 0 — were never
 *   misplaced despite carrying two non-zero angles.
 * * **No shipped spawn carries a non-zero angle on an axis its routine does
 *   not rotate.** So the Y-only and no-rotation rows cost nothing today, and
 *   they are still here because that is a fact about the shipped data and not
 *   about the engine.
 */
export const GENERIC_POSE_ORDER: Partial<Record<number, PoseOrder>> = {
  5: PoseOrder.RollYawPitch,  // 0x466820
  6: PoseOrder.YawOnly,  // 0x4668a0
  7: PoseOrder.RollPitch,  // 0x466930
  8: PoseOrder.YawRollPitch,  // 0x467080
  9: PoseOrder.NoRotation,  // 0x472830
  10: PoseOrder.YawOnly,  // 0x4668a0
  11: PoseOrder.YawOnly,  // 0x467c80
  12: PoseOrder.RollYawPitch,  // 0x467e50
  13: PoseOrder.NoRotation,  // 0x467f50
  14: PoseOrder.YawRollPitch,  // 0x468180
  18: PoseOrder.RollYawPitch,  // 0x468e50; also Y<-lit 0xc000
  19: PoseOrder.RollYawPitch,  // 0x468f00; also Y<-lit 0xc000
  20: PoseOrder.YawOnly,  // 0x469380
  21: PoseOrder.YawOnly,  // 0x4694a0
  25: PoseOrder.YawOnly,  // 0x469ae0
  27: PoseOrder.YawOnly,  // 0x469e60
  28: PoseOrder.RollYawPitch,  // 0x469f50
  30: PoseOrder.RollYawPitch,  // 0x46a0f0
  31: PoseOrder.RollYawPitch,  // 0x46a1c0
  32: PoseOrder.NoRotation,  // 0x46a360
  33: PoseOrder.RollYawPitch,  // 0x472950
  34: PoseOrder.RollYawPitch,  // 0x46a580
  35: PoseOrder.YawOnly,  // 0x46b320
  36: PoseOrder.NoRotation,  // 0x46b480
  41: PoseOrder.Unread,  // 0x46cc50; also Y<-yaw, Z<-?, X<-pitch
  43: PoseOrder.RollYawPitch,  // 0x46cea0
  45: PoseOrder.NoRotation,  // 0x46dab0; also Y<-lit 0x3c4d
  49: PoseOrder.YawRollPitch,  // 0x46e6e0
  51: PoseOrder.YawRollPitch,  // 0x46eb20
  53: PoseOrder.RollYawPitch,  // 0x46ebd0
  54: PoseOrder.RollYawPitch,  // 0x46edc0
  56: PoseOrder.RollYawPitch,  // 0x46f090; also Y<-lit 0x6b00
  57: PoseOrder.NoRotation,  // 0x46f350; also Y<-lit 0xfffff500
  58: PoseOrder.RollYawPitch,  // 0x46f580
  59: PoseOrder.RollYawPitch,  // 0x46f750
  60: PoseOrder.RollYawPitch,  // 0x46f840
  62: PoseOrder.YawOnly,  // 0x46fa10
  63: PoseOrder.YawOnly,  // 0x46fb50
  64: PoseOrder.YawOnly,  // 0x46fbe0
  67: PoseOrder.YawRollPitch,  // 0x470080
  69: PoseOrder.RollYawPitch,  // 0x470500
  70: PoseOrder.RollYawPitch,  // 0x4675a0
  71: PoseOrder.RollYawPitch,  // 0x4675a0
  72: PoseOrder.RollYawPitch,  // 0x470750
  73: PoseOrder.RollYawPitch,  // 0x470b70
  74: PoseOrder.RollYawPitch,  // 0x470e20
  75: PoseOrder.Unread,  // 0x4710c0; also Z<-?, Y<-?, X<-?
  76: PoseOrder.RollOnly,  // 0x471330; also Y<-lit 0xffffde98, Y<-obj+0x1e8, X<-obj+0x1e4
  77: PoseOrder.Unread,  // 0x4717a0; also Y<-yaw, Y<-obj+0x1dc
  78: PoseOrder.YawOnly,  // 0x471ba0
};


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

/** Class 0x41 types 53 and 54, which have update routines of their own. */
const TYPE53 = 53;
const TYPE54 = 54;

/**
 * `PlaceGenericProp` case 0x36's five literals — the whole of type 54's drift,
 * and the reason it could not be added to {@link GENERIC_DESCRIPTOR_SLOT}
 * without being ported.
 *
 * Read out of the disassembly rather than the pseudocode, because these are
 * `MOV dword ptr [ESI + disp], imm32` of float bit patterns and the decompiler
 * shows them as integers (`L1`'s neighbour):
 *
 * ```
 * 00462436  MOV dword ptr [ESI + 0x1c0], 0x40a00000   ;  5.0
 * 00462447  MOV dword ptr [ESI + 0x1c4], 0x3fc00000   ;  1.5
 * 00462451  MOV dword ptr [ESI + 0x1c8], 0xc0800000   ; -4.0
 * 0046245b  MOV dword ptr [ESI + 0x1d8], 0x300
 * 00462465  MOV dword ptr [ESI + 0x1dc], 0xfffffc00   ; -0x400
 * ```
 *
 * Identical for every spawn, which is what makes the drift *authored*: both
 * shipped type-54 props travel the same five units right, one and a half up
 * and four back a frame, tumbling `0x300` in pitch and `-0x400` in yaw.
 */
const TYPE54_DRIFT_VX = 5.0;
const TYPE54_DRIFT_VY = 1.5;
const TYPE54_DRIFT_VZ = -4.0;
const TYPE54_DRIFT_PITCH = 0x300;
const TYPE54_DRIFT_YAW = -0x400;

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
  // Both of these open with their own lifetime rule instead of
  // `PropExpireByStepLifetime`, which is what earns a family rather than a
  // `GENERIC_UPDATE` row: the pool's generic arm runs that prologue before it
  // dispatches, and neither routine has it. See `class41/draw_only.ts`.
  [TYPE53]: PropFamily.DrawOnlyType53,
  [TYPE54]: PropFamily.DrawOnlyType54,
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
  // `MOV EDX,[EBP+0x6c]; MOV [ESI+0x2a4],EDX` — the arms at 0x0046205E and
  // 0x004620BE give types 31 and 33 the placer's third orientation word as
  // the length of the slot strip their routine plays. The same word is also
  // the roll below, and both readings are the engine's.
  if (GENERIC_SLOT_STRIP.has(type)) p.removeFlag = pl.roll ?? 0;
  // Case 0x36's five literals. Without them a type-54 prop stands still with
  // its script flag raised, which is the one thing the engine never does with
  // it -- and then never retires, because the 300-frame drift is its only
  // exit. See `class41/draw_only.ts`.
  if (type === TYPE54) {
    p.vx = TYPE54_DRIFT_VX;
    p.vy = TYPE54_DRIFT_VY;
    p.vz = TYPE54_DRIFT_VZ;
    p.spin = TYPE54_DRIFT_PITCH;
    p.yawSpin = TYPE54_DRIFT_YAW;
  }

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

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
 * The constructor is transcribed, prologue and switch: the prologue here, and
 * each type's arm in the file of the routine it seeds, looked up through
 * `GENERIC_PLACE_ARMS` (`class41/generic_routines.ts`).
 *
 * **All fifty routines are transcribed whole** — every type it builds,
 * from 5 to 78 — each in its own file under its Ghidra name, with its own
 * head (the shared `PropExpireByStepLifetime`, an inline variant with a
 * literal limit or an `ActorKill`, a mode test, or no lifetime at all), its
 * hit arms, its sounds, its shot sphere where and if it registers one, and
 * its draws recorded where it makes them (`class41/prop_draw.ts`). Most run as `GENERIC_ROUTINES` rows
 * in the pool's generic arm; 13, 33, 53 and 54 run as families of their own,
 * and so do 32 (`LiftUpdate`), 34 (`FallingContainerUpdate`, class 0x44
 * selector 16's routine too) and 43. Four of them allocate objects of their
 * own: the item type 7's first hit drops in Original Mode and the parts types
 * 8 and 67 carry on their stored matrix, which run as families, and the
 * story item types 74 and 75 hand out (`SpawnStoryModeItem`), which is the
 * collectible 70 and 71 are and runs as their row.
 *
 * **The renderer used to pose every one of these `Ry·Rz·Rx`**, which is
 * `PropDrawOnlyType51`'s order and not the family's. It then read
 * {@link GENERIC_POSE_ORDER}, which `tools/verify_prop_pose.py` derives from
 * the EXE per type; a routine that records its draws composes its own
 * matrices and never reaches that table, and every generic routine records
 * its draws now. The table stays as the check's reading of the EXE.
 *
 * The count that went with the old open question was fifteen, and was the wrong
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
 * Some of them are not props at all: the arms of types 14, 19 and 25 raise
 * `g_enemies_alive` or `g_enemies_present`, and their routines give the count
 * back, so a few of these are enemies standing still.
 */
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import type { BreakablePlacement } from "../../bundle";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "./prop_state";
import {
  LIFT_FAR_CLOSED, LIFT_NEAR_CLOSED, LIFT_PANEL_CLOSED,
} from "./lift";
import { PlaceGenericPropType43 } from "./type43";
import { GENERIC_PLACE_ARMS } from "./generic_routines";

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
   * The routine rotates from something `tools/verify_prop_pose.py`'s scan
   * cannot attribute to a descriptor word, so the table claims no order.
   * **75** poses from the object path it rides (`PropUpdateType75`,
   * `FUN_004710C0`). **41** is `RotY(yaw); RotZ((s16)obj+0x200);
   * RotX(pitch)` for each of its two panels, the Z being the panel's own
   * hinge angle — read as `LEA EBP,[ESI+0x200]` at `0x0046CDBD` and `MOVSX
   * EAX,word [EBP]` at `0x0046CDF1`, a form the scan does not follow — and
   * its routine records its own draws (`class41/type41.ts`). The renderer
   * leaves an unread row on the family default rather than guess.
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
 * `tools/verify_prop_pose.py` **derives the set itself** out of the EXE and
 * the shipped scripts, and fails either copy of it — the port's here and the
 * exporter's in `hod2lib/bundle.ts`. Fourteen of the fifty routines pass
 * `obj+0x28C` to their first draw, and four clauses cut that down to seven:
 *
 * 1. the routine's first draw takes `obj+0x28C`;
 * 2. its arm of `PlaceGenericProp`'s switch does not overwrite that field with
 *    a **literal** — nine such writes across seven arms, and they are what
 *    rule out **13** (`0x1A4A`), **34** (`0x0A50`) and **67** (`0x1A36`,
 *    `0x1A35`, `0x1A0F`) — **nor call `PickOriginalModeItem`**
 *    (`FUN_004629C0`), which writes the chosen item's model over it and
 *    rules out the Original Mode collectibles **70**, **71** and **72**. A
 *    `MOV word ptr [ESI+0x28C], r16` is *not* an overwrite: those arms
 *    re-write the value the prologue already put there, out of the placer's
 *    own `+0x11C`;
 * 3. the descriptor's `+0x11C` is not *also* being charged as this type's
 *    lifetime — either the arm replaces `obj+0x11C` with the placer's `+0x1F4`
 *    ({@link GENERIC_LIFETIME_FROM_1F4}) or the routine never ages that field
 *    at all. This is what rules out **43**, which inlines a variant of
 *    `PropExpireByStepLifetime` that tests `obj+0x11C`;
 * 4. and the shipped data agrees. Across all twelve scenes a class-0x41
 *    generic descriptor's `+0x11C` is one of **0, 1, 2, 3, 4, 5, 7** or one of
 *    **0x2B..0x18BF**, with nothing in the band between — 54 words below and
 *    43 above. Below the band it is a lifetime in event steps; above it, an
 *    asset slot. The check asserts the band is still empty, because the rule
 *    is unsound the moment it is not.
 *
 * **Type 72 used to pass all three code clauses and fail the fourth**, and
 * was carried as an open question — does its one shipped spawn, whose
 * `+0x11C` is 1, draw slot 1? It does not. `PropUpdateType72` (`FUN_00470750`)
 * does draw `obj+0x28C`, but its arm calls `PickOriginalModeItem`, which
 * overwrites the field with the item record's model before the routine ever
 * runs; the check had looked for a literal store and not for a call. Clause 2
 * now counts the call, for 70, 71 and 72 alike, and `tools/verify_prop_pose.py`
 * with it. See `class41/original_item.ts`.
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
 * Type 33's strip and its death are ported: its single stage-2 spawn plays 60
 * frames of `eff_shop.bin` and then kills itself — `PropDrawOnlyType33` in
 * `class41/draw_only.ts`, its own family because the routine has no lifetime
 * prologue. Until that was read the port drew frame 0 and held it for the rest
 * of the stage.
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
 * words, and three the scan cannot read. Twenty shipped spawns came out in the wrong
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
 *
 * **Only the Original Mode half reads it now.** Every routine transcribed
 * whole records its own matrices, so for those types a row here is the scan's
 * reading and nothing else, and several are known to be the scan's limits
 * rather than the routine: the scan stops at the first `AssetDrawSlot` and
 * does not count an effect tree's draw, so 18, 28, 59, 62 and 63 — which draw
 * an effect or nothing — are read out of the routine after them; and it takes
 * `obj+0x64`/`+0x68` for the descriptor's pitch and yaw, which `PlaceGenericProp`
 * never writes there, so 20 and 27 name a yaw that is really the object's own
 * turning word. The routines' files say what each one really composes.
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
 * Only the *first* slot is here, and only the Original Mode half reads it: a
 * routine transcribed whole records every `AssetDrawSlot` it makes
 * (`class41/prop_draw.ts`) and the renderer draws exactly those, strips and
 * second parts included. For those types a row here is what the first frame
 * draws, kept as a reading.
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
 * Types **6**, **10** and **34** also overwrite `obj+0x11C`, with the
 * literals 1, 2 and 2, and they mean two different things by it `[proved]`:
 *
 * * **6 and 10: a step lifetime.** `PropUpdateType6` (`FUN_004668A0`)
 *   charges its step changes against the word through
 *   `PropExpireByStepLifetime` and reads it nowhere else; neither arm gives
 *   the object a radius and the routine never looks at a hit. So a type-6
 *   prop lives until the second step change after it is placed and a type-10
 *   until the third, whatever its descriptor carries. The port used to read
 *   the two literals as shot counts and keep the descriptor's word as the
 *   lifetime, which is the reading the arm had just overwritten.
 * * **34: two shots, and nothing else.** `FallingContainerUpdate`
 *   (`FUN_0046A580`) never calls `PropExpireByStepLifetime`; its lifetime is
 *   an inline count against the s8 at `obj+0x199`, which the arm fills from
 *   the placer's `+0x11C`, and all four of its reads of `obj+0x11C` are the
 *   shot count (`0x0046A633`, `0x0046A63F`, `0x0046A712`, `0x0046AC9D`).
 */
export const GENERIC_LIFETIME_FROM_1F4: ReadonlySet<number> =
  new Set([12, 31, 51, 53]);

/**
 * Class 0x41 type 32. Not in `PropContainerType`, which names the types that
 * have their *own* constructor; this one shares `PlaceGenericProp`.
 */
const PropContainerType32 = 32;

/** Class 0x41 types 43, 53 and 54, which have update routines of their own. */
const TYPE43 = 43;
/** Class 0x41 type 13, which has its own lifetime and so its own family. */
const TYPE13 = 13;
/** Class 0x41 type 34, the falling container. */
const TYPE34 = 34;
/** Class 0x41 type 33, the slot strip played once. See `class41/draw_only.ts`. */
const TYPE33 = 33;
const TYPE53 = 53;
const TYPE54 = 54;

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
  // Both of these open with their own lifetime rule instead of
  // `PropExpireByStepLifetime`, which earned them a family when the pool's
  // generic arm ran that prologue before it dispatched, and neither routine
  // has it. See `class41/draw_only.ts`.
  [TYPE53]: PropFamily.DrawOnlyType53,
  [TYPE54]: PropFamily.DrawOnlyType54,
  // Its own routine, its own lifetime, and its own everything: the third
  // object built from `g_prop_kind_params`. See `class41/type43.ts`.
  [TYPE43]: PropFamily.Type43,
  // Inlines its own lifetime and registers no sphere: the part that drops
  // out of stage 2's clock tower. See `class41/type13.ts`.
  [TYPE13]: PropFamily.Type13,
  // `g_class41_updates[34]` is `FallingContainerUpdate`, the routine class
  // 0x44 selector 16's object runs too. See `class44/container.ts`.
  [TYPE34]: PropFamily.Falling,
  // No prologue and no shot-test tail: a draw, a step and a kill. See
  // `class41/draw_only.ts`.
  [TYPE33]: PropFamily.DrawOnlyType33,
};

/**
 * `PlaceGenericProp` — `FUN_00461CF0`.
 *
 * The prologue, which every type gets, then the arm of the switch for the
 * type — the tables above for the ones that only set a radius, and
 * `GENERIC_PLACE_ARMS` for every type whose routine is transcribed, which is
 * where the arms that seed a routine's own working state live: case 8's three
 * parts, case 0x24's three sub-parts, case 0x43's boat and its load, the
 * branch seeds and enemy counts of cases 0x0E, 0x13 and 0x19.
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
  // `ActorClearGameFields` (`FUN_004A73D0`) zeroes the object from `+0x34`
  // up, so `+0x2A0` and `+0x2A4` start at zero for every one of these; the
  // struct's own defaults are the group props' and the story switch's -1.
  // An arm that wants anything else writes it below.
  p.storyItem = 0;
  p.removeFlag = 0;

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
  p.slot = pl.slot ?? 0;
  // `obj+0x124` — the switch's own per-type hit radius, and the whole of what
  // makes a generic prop shootable. A type missing from the table is a type
  // the engine never registers a sphere for.
  p.hitRadius = GENERIC_RADIUS[type] ?? 0;

  // Case 0x20 is the lift. These are not the prop's orientation: they
  // are its three hinge angles at rest, and `LiftUpdate` swings each one
  // from exactly this value — which is how its sound cues, written as
  // equalities, fire once and only on the first frame of a swing.
  // Case 0x2B's arm, last because it overwrites four of the fields above it:
  // the kind and the item set off the descriptor, the kind table's radius,
  // effect and variant, the bob's centre and its rand()-seeded motion, and
  // the two-case kind switch on the slot. All of it in `class41/type43.ts`.
  if (type === TYPE43) PlaceGenericPropType43(p, pl, rng);

  if (type === PropContainerType32) {
    p.yaw = LIFT_NEAR_CLOSED;
    p.hingeB = LIFT_FAR_CLOSED;
    p.pitch = LIFT_PANEL_CLOSED;
  }
  // The arms of the types whose routine is transcribed whole, each in its
  // routine's own file. See `class41/generic_routines.ts`.
  GENERIC_PLACE_ARMS[type]?.(p, pl, rng);
  return p;
}

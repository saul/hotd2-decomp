/**
 * `PropUpdateType43` — `FUN_0046CEA0`, class 0x41 type 43.
 *
 * **The third object built from `g_prop_kind_params`**, and the reason stage 3
 * looked like it carried no scenery: seven spawns, all in scene 2, placed as
 * inert generics by a port that had read the type only as far as "its first
 * draw takes `obj+0x28C`". It is not scenery. It is a **shootable prop that
 * bobs, tumbles, breaks in one or two shots depending on its kind, and hands
 * out a life or an Original Mode item when the wreckage is shot again.**
 *
 * `PlaceKindedProp` (`FUN_00462E10`) and `PropBuildKindedProp`
 * (`FUN_00473770`) build the other two objects from that table and
 * `KindedPropUpdate` (`FUN_00465FB0`) runs theirs. This one has its own
 * routine and its own rules, and the differences are the whole reason it needs
 * a module rather than a row in a table:
 *
 * * `KindedPropUpdate` **hides** the crate on the first shot (`obj+0x28C` to
 *   `0xFFFF`); this one **swaps the model** to `0x19E6` and turns it to face
 *   the camera.
 * * `KindedPropUpdate` releases its item at the break; this one releases on a
 *   **second shot into the wreckage**.
 * * `KindedPropUpdate` leaves the shot test the frame its puff starts; this
 *   one keeps registering, because that second shot is how the item comes out.
 * * `KindedPropUpdate` despawns after the puff **unless** its item set is 0 or
 *   4; this one despawns **only** when its set is 0.
 * * and this one bobs on a sine and tumbles on a damped spring, re-seeding
 *   both from `rand()` every time the bob phase crosses a whole turn.
 *
 * ## The descriptor's third orientation word is the KIND
 *
 * `PlaceGenericProp`'s arm at `0x00462250`, reached through
 * `g_place_generic_prop_arms` so the mapping is read and not guessed:
 *
 * ```
 * 00462250  MOV DX,[EBP+0x6c]        ; the descriptor's THIRD orientation word
 * 00462254  MOV [ESI+0x290],DX       ; ...is the prop kind
 * 0046225b  MOV AL,[EBP+0x1f4]       ; the s8 at desc+0x24
 * 00462261  MOV [ESI+0x194],AL       ; ...is the item set
 * 00462270  MOVSX ECX,[EAX+0x593dc0] ; g_prop_kind_params[kind].radius
 * 0046227f  FSTP [ESI+0x124]         ; ...widened to a float
 * 00462285  MOVSX EDX,[EAX+0x593db8] ; .effect          -> obj+0x324
 * 00462292  MOVSX EAX,[EAX+0x593dba] ; .effect_variant  -> obj+0x328
 * 0046229f  MOV ECX,[EBP+0x44]       ; the descriptor's Y
 * 004622a2  MOV [ESI+0x1ac],ECX      ; ...is the bob's centre
 * 0046231c  MOV DX,[ESI+0x290] / SUB DX,3 / NEG DX / SBB EDX,EDX
 * 00462332  AND EDX,0xffffe617 / ADD EDX,0x19e8
 * 0046233e  MOV [ESI+0x28C],DX       ; kind == 3 ? 0x19E8 : 0xFFFF
 * 00462345  MOV [ESI+0x1cc],EBX      ; EBX is 0 from the prologue's XOR at
 * 0046234b  MOV [ESI+0x1d4],EBX      ; 0x00461D73 -- pitch and roll are DROPPED
 * ```
 *
 * So that word carries a **third** meaning in this family: a frame count for
 * {@link GENERIC_SLOT_STRIP}, a roll for most types, and here the prop kind.
 * The arm then zeroes `obj+0x1CC` and `obj+0x1D4`, so the descriptor's pitch
 * and roll are discarded and only its yaw survives as a pose angle — until the
 * tumble starts driving all three.
 *
 * That branchless `SBB` is also why this type once misclassified itself into
 * {@link GENERIC_DESCRIPTOR_SLOT}: it writes `obj+0x28C` from a **register**
 * holding a computed value, and a detector looking only for an immediate read
 * that as "the arm left the descriptor's slot alone". It is the same two-case
 * kind switch `PlaceKindedProp` spells out with branches.
 *
 * ## What the seven are
 *
 * Kind 3 for four of them and kind 2 for three, and the two kinds are
 * different props — the table rows decide everything:
 *
 * | kind | `obj+0x28C` | effect | variant | sound | radius | rise |
 * |---|---|---|---|---|---|---|
 * | 2 | `0xFFFF` | 7 | 469 | `0x1D16A9` | 6 | 6 |
 * | 3 | `0x19E8` | 0 | 473 | `0x1A16A9` | 5 | 5 |
 *
 * A **kind 3** wears `0x19E8` = `komono_2.bin[2]`, takes the crack arm because
 * its effect id is 0, swaps to `0x19E6` = `komono_2.bin[0]` and needs a second
 * shot to destroy. A **kind 2** draws no body — its `obj+0x28C` is `0xFFFF` —
 * and instead draws `0x17A9` = `komono_1.bin[114]` lifted 0.8, because its
 * effect id is 7; with a non-zero effect id the first shot goes straight to
 * the destroy arm, so a kind 2 bursts in one.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import { T } from "../tables";
import { BAMS_TO_RAD } from "../../core/bams";
import { MsvcRand } from "./group";
import { GrantExtraLife } from "./items";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import { PropRegisterForShotTest } from "./shot_test";
import { SLOT_NONE } from "./kinded";
import {
  BreakableFlag, BreakableSlot, HIT_FLAG_MASK, type BreakableProp,
} from "./prop_state";

/** The one kind whose `obj+0x28C` is a model rather than `0xFFFF`. */
export const TYPE43_CRATE_KIND = 3;

/**
 * `CMP CX,-1` on `obj+0x290` — the kind the routine refuses to take a shot
 * for. Read as a word, so `0xFFFF`; named for the field rather than borrowed
 * from {@link SLOT_NONE}, which is the same number about a different thing.
 */
export const KIND_NONE = 0xffff;

/**
 * The item sets `obj+0x194` names, as this routine's `CMP` arms read it.
 *
 * **Not {@link ItemSet}, and not `obj+0x195`.** The kinded and group props
 * keep their set in the byte above this one and run it through
 * `g_item_set_countdown`; type 43's arm writes `desc+0x24` into `obj+0x194`
 * and the routine compares it against 1 and 2 directly, with no countdown
 * anywhere in it. One offset apart and a different mechanism — `L3`.
 */
export enum Type43ItemSet {
  /** Nothing hidden — and the only set whose wreck is taken away. */
  None = 0,
  /** `GrantExtraLife`: the life, and the only set that pays outside Original Mode. */
  ExtraLife = 1,
  /** An Original Mode item, chosen by `PickOriginalModeItem`. */
  OriginalItem = 2,
}

/** `PlaySoundId(0x3616A9)` — the pickup, on the shot that takes it. */
export const SFX_TYPE43_PICKUP = 0x3616a9;

/**
 * The pickup the wreckage becomes: `obj+0x28C = 0x116A + 50 * player` and
 * `obj+0x2A4 = 0x1256 + player`, from `LEA EAX,[EDI+EDI*4]` /
 * `LEA EAX,[EAX+EAX*4]` / `LEA ECX,[EAX+EAX+0x116a]`. `common.bin[203]` and
 * `common.bin[253]`.
 */
export const TYPE43_PICKUP_SLOT = 0x116a;
export const TYPE43_PICKUP_SLOT_STRIDE = 50;
export const TYPE43_PICKUP_TAG = 0x1256;

/** The piece a kind-2 prop draws, lifted 0.8, while it is still whole. */
export const TYPE43_EFFECT7_SLOT = 0x17a9;
export const TYPE43_EFFECT7_RISE = 0.8;
/** The `g_prop_kind_params[kind].effect` that takes the one-shot arm. */
export const TYPE43_BURST_EFFECT = 7;

/** `FSUB qword [0x00569100]` — how far a destroyed wreck drops. */
export const TYPE43_WRECK_DROP = 7.540295;
/** `MOV [ESI+0x124], 0x40A00000` beside it — the wreck's new shot radius. */
export const TYPE43_WRECK_RADIUS = 5.0;
/** `FADD qword [0x004C4CA8]` — the rise an Original Mode item is given. */
export const TYPE43_ITEM_RISE = 4.0;

/** The scale `FUN_004666B0` is handed on the first hit. */
export const TYPE43_HIT_EFFECT_SCALE = 1.5;

/**
 * The bob and the tumble seeds, from `PlaceGenericProp`'s arm and again from
 * the routine's own wrap branch — the same four `rand()` calls in the same
 * order in both places, which is why it is one function here.
 *
 * ```
 * 0046d268  edi = 0x90 - ((rand() & 1) << 8) - rand() %% 0x21   -> obj+0x1D8
 * 0046d298  the same again                                      -> obj+0x1E0
 * 0046d2c8  obj+0x2C0 = rand() %% 0x33 * 0.01 + 0.25
 * ```
 *
 * `0x004D5464` is `0.01` and `0x004C4C58` is `0.25`; both were read out of the
 * image rather than guessed, and the first guess for that scale — `1/256`,
 * from the symbol `g_wave_circular_falloff` sitting at the address — was
 * wrong.
 */
export const TYPE43_SPIN_BASE = 0x90;
export const TYPE43_SPIN_SIGN_STEP = 0x100;
export const TYPE43_SPIN_JITTER = 0x21;
export const TYPE43_BOB_JITTER = 0x33;
export const TYPE43_BOB_SCALE = 0.01;
export const TYPE43_BOB_BASE = 0.25;

/** `IMUL 0x2AAAAAAB; SAR 3` with the sign fixup is a signed divide by 48. */
export const TYPE43_SPRING_DIVISOR = 48;

/**
 * `MOV dword ptr [ESI+0x1dc], 0x200` at `0x004622D1` — the bob's step, in
 * BAMS per frame, so one whole swing takes 128 frames.
 *
 * Seeded **once**, in the arm, and not re-seeded with the two spin rates and
 * the amplitude: the phase's speed is fixed and only what it drives changes.
 */
export const TYPE43_BOB_STEP = 0x200;

/**
 * `PlaceGenericProp` case 0x2B's own arm, split out so the constructor reads
 * as one line per type.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00462250`,
 * reached by the switch and not called.
 */
export function PlaceGenericPropType43(
    p: BreakableProp,
    pl: { roll?: number; field_1f4?: number },
    rng: Rng): void {
  p.kind = pl.roll ?? 0;
  p.group = pl.field_1f4 ?? 0;
  const params = T.breakables?.kinds?.[p.kind];
  p.hitRadius = params?.radius ?? 0;
  p.effect = params?.effect ?? 0;
  p.effectVariant = params?.effect_variant ?? 0;
  // The bob's centre is kept apart from `obj+0x1A0` because the sine
  // overwrites that one every frame.
  p.restY = p.y;
  p.yawSpin = TYPE43_BOB_STEP;
  Type43ReseedMotion(p, rng);
  // The prologue put all three orientation words on the object; this arm
  // throws two of them away.
  p.pitch = 0;
  p.roll = 0;
  p.slot = p.kind === TYPE43_CRATE_KIND ? BreakableSlot.Default : SLOT_NONE;
}

/** The two spin rates and the bob amplitude, drawn from `rand()`. */
function Type43ReseedMotion(p: BreakableProp, rng: Rng): void {
  p.spin = Type43SpinRate(rng);
  p.rollSpin = Type43SpinRate(rng);
  p.shake = (MsvcRand(rng) % TYPE43_BOB_JITTER) * TYPE43_BOB_SCALE
    + TYPE43_BOB_BASE;
}

/**
 * `0x90 - ((rand() & 1) << 8) - rand() % 0x21`.
 *
 * The `AND 0x80000001` / `DEC` / `OR 0xFFFFFFFE` / `INC` sequence around the
 * first draw is MSVC's sign-preserving `% 2`; `rand()` is non-negative, so the
 * term is the low bit and the fixup is unreachable.
 */
function Type43SpinRate(rng: Rng): number {
  const flip = MsvcRand(rng) & 1;
  return TYPE43_SPIN_BASE - flip * TYPE43_SPIN_SIGN_STEP
    - (MsvcRand(rng) % TYPE43_SPIN_JITTER);
}

/**
 * `PropUpdateType43` — `FUN_0046CEA0`. One prop, one 60 Hz frame.
 */
export function PropUpdateType43(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  // The inline lifetime: the shared prologue's arithmetic with the scene-1
  // sweep left out, and `ActorDespawn` rather than `ActorKill`. Written out
  // rather than reused because the routine does not call
  // `PropExpireByStepLifetime` -- all seven spawns are in scene 2, where that
  // sweep could not fire, and collapsing a test because its outcome looks
  // settled is what `L27` is about.
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.lifetime < p.stepsElapsed) { ActorDespawnProp(p); return; }
    p.lastStepIndex = G.g_evt_step_index;
  }

  // `if ((obj+0x34 & 8) && !(obj+0x34 & 0x40000000) && obj+0x290 != -1)`
  if ((p.flags & BreakableFlag.Hit) !== 0 && !p.branchLatched
      && p.kind !== KIND_NONE) {
    // `AND AL,0xF7` -- the hit bit is cleared inside the arm, not in the
    // pool's tail, so a frame that does not reach here keeps the bit.
    p.flags &= ~BreakableFlag.Hit;
    if (p.effectFrames === 0) Type43FirstHit(p, rng, events);
    else Type43ReleaseOnSecondHit(p, rng, events);
  }
  // `AND EDX,0xFFFFFFF9` at 0x0046D1DE -- both player bits, every frame.
  p.flags &= ~HIT_FLAG_MASK;

  // `+0x32C` is the break effect's cursor *and* the destroyed latch.
  if (p.effectFrames >= 1) {
    p.effectFrames += 1;
    if (p.effectFrames > Type43EffectFrames(p)
        && p.group === Type43ItemSet.None) {
      // Only a prop hiding nothing is taken away; one that still owes a life
      // or an item stays standing for the second shot.
      ActorDespawnProp(p);
      return;
    }
  }

  Type43Bob(p, rng);
  Type43Tumble(p);

  // `RegisterForShotTest` at the tail, at the kind's own rise. A destroyed
  // prop keeps registering -- unlike the kinded prop, which leaves the shot
  // test the frame its puff starts -- because the second shot into the
  // wreckage is how the item comes out.
  const rise = T.breakables?.kinds?.[p.kind]?.y_offset ?? 0;
  PropRegisterForShotTest(p, p.x, p.y + rise, p.z);
}

/**
 * `g_motion_play_length[obj+0x328] - 2`, the puff's length.
 *
 * [diverges] That table is the shared effect-animation length table and is not
 * in the bundle; `KindedPropUpdate`'s port makes the same substitution for the
 * same reason, and it only decides when a destroyed prop stops being drawn.
 */
function Type43EffectFrames(p: BreakableProp): number {
  void p;
  return 0x48;
}

/**
 * The first shot: the kind's sound, the scaled impact effect, and then either
 * the crack or the destroy depending on whether this kind has an effect id.
 */
function Type43FirstHit(p: BreakableProp, rng: Rng, events?: Events): void {
  const params = T.breakables?.kinds?.[p.kind];
  // `PlaySoundId(g_prop_kind_params[kind].sound)` -- the kind's own sound, and
  // the two kinds have different ones: 0x1D16A9 for kind 2 and 0x1A16A9 for
  // kind 3, which are the crack and the break the other families share.
  //
  // `[open]` `SpawnPropHitEffectScaled(obj, player, 1.5f)`
  // (`FUN_004666B0`) beside it: effect id 0xE25 at the crosshair, unprojected
  // to the prop's depth. The port does not spawn it. The spark the crack arm
  // also asks for is already covered -- `combat/shot.ts` spawns
  // `SpawnPropHitSpark` for every prop a shot lands on.
  events?.emit("prop.cracked", { id: p.id, sound: params?.sound ?? 0 });

  if (p.effect === 0 && p.slot === BreakableSlot.Default) {
    // The crack: award 0, so no points. Swap the model, turn it to face the
    // camera, and spark.
    BreakablePropAwardHit(p.flags, false, rng);
    p.slot = BreakableSlot.Broken;
    // `obj+0x1D0 = *(g_camera_blocks + g_camera_index * 0x1A4 + 0x90)`.
    //
    // `[open]` That word is `0x009A60D0` and the port does not carry it.
    // `g_camera_yaw_bams` (`0x009C71F0`) is the camera's heading as this port
    // knows it -- `app/systems.ts` writes it from the live view every frame,
    // and class 0x31's states already turn to face the camera with it -- but
    // the engine keeps two camera yaws at two addresses and whether they hold
    // the same number has not been read.
    p.yaw = G.g_camera_yaw_bams;
    return;
  }
  // The destroy: award 1, ten points, and the puff starts.
  BreakablePropAwardHit(p.flags, true, rng);
  p.effectFrames = 1;
  if (p.slot === BreakableSlot.Broken) {
    // A wreck that is destroyed drops and widens.
    p.y -= TYPE43_WRECK_DROP;
    p.hitRadius = TYPE43_WRECK_RADIUS;
    // `[open]` `obj+0x1B8 = 1.5f` beside these two. Nothing read so far reads
    // that field back, so the port does not carry it.
  }
  if (p.group === Type43ItemSet.OriginalItem
      && G.g_GameMode === GameMode.Original) {
    // `PickOriginalModeItem(obj, 0)` chooses the item into `obj+0x290` and
    // the prop rises 4.0. `[open]` The port does not run the weighted draw
    // here: `obj+0x290` is this family's *kind* and overwriting it would swap
    // the prop's model and radius, which is the one thing the engine can do
    // and the port cannot read back yet.
    p.y += TYPE43_ITEM_RISE;
  }
}

/**
 * The shot into the wreckage, which is where the item comes out.
 *
 * `if (obj+0x194 >= 1 && !(obj+0x34 & 0x40000000))`: latch it, then pay. With
 * both players' bits set the engine draws `rand() & 1` for who gets it; with
 * one, that player.
 */
function Type43ReleaseOnSecondHit(p: BreakableProp, rng: Rng,
                                  events?: Events): void {
  if (p.group < Type43ItemSet.ExtraLife) return;
  p.branchLatched = true;
  const both = (p.flags & BreakableFlag.HitByPlayer0) !== 0
    && (p.flags & BreakableFlag.HitByPlayer1) !== 0;
  const who = both
    ? (MsvcRand(rng) & 1)
    : ((p.flags & BreakableFlag.HitByPlayer0) !== 0 ? 0 : 1);

  if (p.group === Type43ItemSet.ExtraLife) {
    events?.emit("prop.pickup",
                 { id: p.id, player: who, sound: SFX_TYPE43_PICKUP });
    p.storyItem = 1;
    GrantExtraLife(who);
    p.slot = TYPE43_PICKUP_SLOT + TYPE43_PICKUP_SLOT_STRIDE * who;
    p.removeFlag = TYPE43_PICKUP_TAG + who;
    return;
  }
  // `obj+0x194 >= 2`: the Original Mode item, and only in Original Mode.
  if (G.g_GameMode !== GameMode.Original) return;
  events?.emit("prop.pickup",
               { id: p.id, player: who, sound: SFX_TYPE43_PICKUP });
  p.storyItem = 1;
  // `[open]` `g_original_items_taken[obj+0x290]++`, capped at 0x63, and the
  // award `FUN_00475E40(g_original_item_records[id].pickup)`. Neither is
  // ported; the port shows the pickup's model and records the shot.
  p.slot = TYPE43_PICKUP_SLOT + TYPE43_PICKUP_SLOT_STRIDE * who;
}

/**
 * The bob: `obj+0x1E8` is a phase stepped by `obj+0x1DC`, and
 * `y = obj+0x1AC + sin(phase) * obj+0x2C0`.
 *
 * The sine takes the phase **before** the step — the engine saves it to the
 * stack and `FILD`s the copy — and the re-seed fires when the stepped phase's
 * low sixteen bits come out zero, which is once a whole turn.
 */
function Type43Bob(p: BreakableProp, rng: Rng): void {
  const phase = p.hingeB;
  p.hingeB = phase + p.yawSpin;
  p.y = p.restY + Math.sin(phase * BAMS_TO_RAD) * p.shake;
  if ((p.hingeB & 0xffff) === 0) Type43ReseedMotion(p, rng);
}

/**
 * The tumble: a damped spring on pitch and roll, in integers and with no
 * floats anywhere in it.
 *
 * ```
 * rate  -= trunc((angle + rate) / 48)
 * angle += rate
 * ```
 *
 * The divisor is MSVC's `IMUL 0x2AAAAAAB; SAR 3` with the `SHR 31` sign
 * fixup, which is a signed divide by 48 truncated toward zero — so
 * `Math.trunc`, not a shift.
 */
function Type43Tumble(p: BreakableProp): void {
  const pitchRate = p.spin
    - Math.trunc((p.pitch + p.spin) / TYPE43_SPRING_DIVISOR);
  const rollRate = p.rollSpin
    - Math.trunc((p.roll + p.rollSpin) / TYPE43_SPRING_DIVISOR);
  p.spin = pitchRate;
  p.rollSpin = rollRate;
  p.pitch = pitchRate + p.pitch;
  p.roll = rollRate + p.roll;
}

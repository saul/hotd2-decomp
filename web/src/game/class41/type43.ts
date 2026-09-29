/**
 * Class 0x41 type 43 — stage 3's seven shootable props that bob, tumble,
 * break in one or two shots depending on their kind, and hand out a life (or
 * an Original Mode item) when the wreckage is shot again.
 *
 * `PlaceKindedProp` (`FUN_00462E10`) and `KindedPropUpdate` (`FUN_00465FB0`)
 * build and run the other object made from `g_prop_kind_params`
 * (`0x00593DB8`, twelve bytes a kind: `+0` effect, `+2` motion, `+4` sound,
 * `+8` radius, `+0xA` rise). This one has its own routine, and every rule in
 * it differs: the crate's model is swapped rather than hidden, the item comes
 * out on a **second** shot into the wreckage rather than at the break, the
 * wreck keeps registering for the shot test, and only a wreck hiding nothing
 * is taken away when its break effect ends.
 *
 * ## The arm, `PlaceGenericProp` case 0x2B at `0x00462250` `[proved]`
 *
 * ```
 * 00462250  obj+0x290 = (s16)placer+0x6C        ; the descriptor's THIRD word: the kind
 * 0046225b  obj+0x194 = (s8)placer+0x1F4        ; desc+0x24: the item set
 * 00462270  obj+0x124 = (float)kinds[kind].radius
 * 00462285  obj+0x324 = kinds[kind].effect ; obj+0x328 = kinds[kind].motion
 * 0046229f  obj+0x1AC = placer+0x44             ; the bob's centre
 * 004622a8  edi = 0x60 - (rand() & 1) * 0xA0    ; LEA [EAX+EAX*4] ; SHL 5
 * 004622d1  obj+0x1DC = 0x200                   ; the bob's step, once
 * 004622df  obj+0x1D8 = edi - rand() % 0x21
 * 004622e5  obj+0x1E0 = 0x60 - (rand() & 1) * 0xA0 - rand() % 0x21
 * 0046230e  obj+0x2C0 = 1.5                     ; MOV imm 0x3FC00000 -- not a rand()
 * 0046231c  obj+0x28C = kind == 3 ? 0x19E8 : 0xFFFF   ; SUB 3 ; NEG ; SBB ; AND ; ADD
 * 00462345  obj+0x1CC = obj+0x1D4 = 0           ; EBX, zero since 0x00461D73
 * 00462351  obj+0x1B8 = (float)kinds[(s8)placer+0x131B].rise
 * 00462371  if (g_GameMode == 1 && byte [0x009C88AA]) obj+0x194 = 1
 * ```
 *
 * **The arm draws four `rand()`s and the routine's re-seed draws five**, and
 * the two are different sums: `0x60 - 0xA0b - r` here, `0x90 - 0x100b - r`
 * there, and a literal 1.5 amplitude here against `rand() % 0x33 * 0.01 +
 * 0.25` there. The port used to run the re-seed for both, one draw too many
 * for every spawn.
 *
 * The shot sphere's rise, `obj+0x1B8`, is indexed by **`(s8)placer+0x131B`,
 * not by the kind** `[proved]` (`MOVSX EAX, byte [EBP+0x131b]` at
 * `0x00462351`). Nothing in the class-0x41 placer's life writes that byte:
 * `EvtOpSpawnPlaced09` (`FUN_004088A0`) clears the placer with
 * `ActorClearGameFields` and writes `+0x1F4`, `+0x130C`, `+0x11C`/`+0x11E`,
 * the position and the three angles, `PropContainerPlacerUpdate`
 * (`FUN_00461CD0`) writes nothing, and every writer of `+0x131B` a search of
 * the listing finds belongs to another class. So it is 0 and the rise is kind
 * 0's `[likely]` — 6.0 in the shipped table, where the port used the kind's
 * own (5 for a kind 3).
 *
 * ## The routine, `0x0046CEA0`..`0x0046D849` `[proved]`
 *
 * ```
 * 0046cea9  the inline lifetime: (s8)++obj+0x197 > (s16)obj+0x11C -> ActorDespawn
 * 0046cef0  if ((f & 8) && !(f & 0x40000000) && (s16)obj+0x290 != -1) {
 * 0046cf1d    obj+0x34 = f & ~8
 * 0046cf24    if (obj+0x32C == 0) {
 * 0046cf38      PlaySoundId(kinds[kind].sound)
 * 0046cf53      SpawnPropHitEffectScaled(obj, (f & 2) ? 0 : 1, 1.5)
 * 0046cf65      if (obj+0x324 == 0 && (s16)obj+0x28C == 0x19E8) {    // the crack
 * 0046cf76        BreakablePropAwardHit(f, 0); obj+0x28C = 0x19E6
 * 0046cf9c        obj+0x1D0 = g_camera_block_yaw_bams
 * 0046cfb3        SpawnPropHitSpark(obj, (f & 2) ? 0 : 1)
 *               } else {                                               // the break
 * 0046cfda        BreakablePropAwardHit(f, 1); obj+0x32C = 1
 * 0046cfe2        if ((s16)obj+0x28C == 0x19E6)
 *                   { y -= 7.540295; obj+0x124 = 5.0; obj+0x1B8 = 1.5 }
 * 0046d019        if ((s8)obj+0x194 == 2 && g_GameMode == 1)
 *                   { PickOriginalModeItem(obj, 0); y += 4.0 }
 *               }
 *             } else if ((s8)obj+0x194 >= 1 && !(f & 0x40000000)) {   // the wreck
 * 0046d06e      obj+0x34 |= 0x40000000
 * 0046d07f      set 1: PlaySoundId(0x3616A9); obj+0x2A0 = 1; GrantExtraLife(who);
 *                      obj+0x2A4 = 0x1256 + who; obj+0x28C = 0x116A + 50 * who
 * 0046d12f      set 2+, Original Mode only: PlaySoundId(0x3616A9); obj+0x2A0 = 1;
 *                      g_original_items_taken[obj+0x290]++ (to 0x63);
 *                      SpawnOriginalItemBanner(g_original_item_records[obj+0x290].sprite);
 *                      obj+0x28C = 0x116A + 50 * who
 *             }
 *           }
 * 0046d1de  obj+0x34 &= ~6
 * 0046d1e1  if (obj+0x32C >= 1 && ++obj+0x32C > g_motion_play_length[motion] - 2
 *               && obj+0x194 == 0) { ActorDespawn; return }
 * 0046d21e  the bob, and at 0x0046D262 its re-seed; 0x0046D2EF the tumble
 * 0046d35a  if (g_motion_slots[motion].state == 2 && obj+0x32C < len - 2) {
 *             T(x, y, z) . Rz . Ry . Rx
 * 0046d393    if (obj+0x324 == 0 && obj+0x28C == 0x19E8) AssetDrawSlot(0x19E8)
 * 0046d451    else if (obj+0x32C == 0 && obj+0x324 == 7) { T(0, 0.8, 0); AssetDrawSlot(0x17A9) }
 * 0046d473    else EffectDrawUnlit(obj+0x324)
 *           }                               ; both arms JMP to 0x0046D486, no RET
 * 0046d486  if ((s16)obj+0x290 == -1) return
 *           if (obj+0x194 >= 1 && obj+0x32C > 0) {
 * 0046d4ba    set 1: T(x, y + 3, z) . Rz . Ry . Rx . S(3); AssetDrawSlot(0x10C3)
 * 0046d573    set 2+ in Original Mode: obj+0x1F4 += 0x400;
 *               T . Rz . Ry(obj+0x1F4) . Rx . S(obj+0x2C4); AssetDrawSlot(obj+0x28C);
 * 0046d649      if (obj+0x28E != -1) T . ClearRotation . T(0, 0, 1.5) . S(obj+0x2C4);
 *                                    AssetDrawSlot(obj+0x28E)
 * 0046d6fa    if (obj+0x2A0 > 0) {
 * 0046d711      set 1: T(x, y + 4, z) . ClearRotation . S(1.5); AssetDrawSlot(obj+0x2A4)
 * 0046d777      T(x, y, z) . Ry; AssetDrawSlot(obj+0x28C + obj+0x2A0 - 1)
 *             }
 * 0046d7c5    if (obj+0x2A0 > 0 && ++obj+0x2A0 > 0x31) { ActorDespawn; return }
 *           }
 * 0046d7ea  if ((s16)obj+0x290 != -1)
 *             RegisterForShotTest(obj) at (x, y + obj+0x1B8, z)
 * ```
 *
 * The break's `y -= 7.540295` and the Original item's `y += 4.0` do not show:
 * the bob's `FSTP [ESI+0x1a0]` at `0x0046D253` rewrites `y` from `+0x1AC`
 * later in the same frame, unconditionally. They are transcribed because the
 * routine makes them.
 *
 * Every draw above ends at a `MatrixStackPop` Ghidra marks no-return, so the
 * pseudocode stops at the first one and shows none of the pickup section, the
 * `+0x2A0` count or the registration (`L35`). From `obj+0x2A0 >= 0x19` the
 * heart and both Original item models go through `AssetDrawSlotWithAlpha`
 * (`FUN_004185A0`) at `1.0 - obj+0x2A0 * 0.02f` (`0x0046D532`, `0x0046D600`,
 * `0x0046D6B1`), and fade out over the strip's last 25 frames.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { SpawnPropHitEffectScaled, SpawnPropHitSpark } from "../effects/sprite";
import { G } from "../globals";
import { CameraBlockYaw } from "../camera/view";
import { GameMode } from "../game_mode";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale, MatrixTranslate,
  type Mat,
} from "../matrix";
import { T } from "../tables";
import { GrantExtraLife } from "./items";
import { SpawnOriginalItemBanner } from "./item_banner";
import {
  ORIGINAL_ITEMS_TAKEN_CAP, PickOriginalModeItem,
} from "./original_item";
import { PropStepLifetimeInline } from "./lifetime";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import {
  PropDrawBegin, PropDrawEffect, PropDrawSlot, PropDrawSlotWithAlpha,
  PropMatrixClearRotation, PropMatrixPush,
  PropMatrixTRzRyRx,
} from "./prop_draw";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";
import {
  BreakableFlag, BreakableSlot, type BreakableProp,
} from "./prop_state";

/**
 * The words of the 0x378 object this routine keeps that no shared field
 * carries, by offset. See `class41/words.ts`.
 */
export interface Type43Words {
  /**
   * `obj+0x290` (s16) — the prop's kind, the row of `g_prop_kind_params`; `-1`
   * turns the prop off (no hit, no pickup draw, no shot sphere). After an
   * Original Mode break `PickOriginalModeItem` (`FUN_004629C0`) writes the item
   * id here, which is why the wreck arm indexes `g_original_items_taken` with
   * it.
   */
  o290: number;
  /** `obj+0x194` (s8) — the item set: 0 nothing, 1 a life, 2+ an Original item. */
  o194: number;
  /** `obj+0x28E` (s16) — the Original item's second model, `-1` for none. */
  o28e: number;
  /** `obj+0x2C4` (f32) — the Original item's draw scale. */
  o2c4: number;
  /** `obj+0x1F4` (s32) — the Original item's spin, `+= 0x400` a frame. */
  o1f4: number;
}

/** `ActorClearGameFields` (`FUN_004A73D0`) left every one of them at zero. */
export const TYPE43_WORDS_ZERO: Type43Words = {
  o290: 0, o194: 0, o28e: 0, o2c4: 0, o1f4: 0,
};

/** The one kind whose `obj+0x28C` is a model rather than `0xFFFF`. */
export const TYPE43_CRATE_KIND = 3;

/**
 * `CMP CX,-1` on `(s16)obj+0x290` — the kind that turns the prop off. The
 * word is kept signed here, so it is `-1` and not `0xFFFF`.
 */
export const KIND_NONE = -1;

/**
 * The item sets `obj+0x194` names, as this routine's `CMP` arms read it.
 *
 * **Not {@link ItemSet}, and not `obj+0x195`.** The kinded and group props
 * keep their set in the byte above and run it through `g_item_set_countdown`;
 * type 43's arm writes `desc+0x24` into `obj+0x194` and the routine compares
 * it against 0, 1 and 2 directly, with no countdown anywhere in it (`L3`).
 */
export enum Type43ItemSet {
  /** Nothing hidden — and the only set whose wreck is taken away. */
  None = 0,
  /** `GrantExtraLife`: the life, and the only set that pays outside Original Mode. */
  ExtraLife = 1,
  /** An Original Mode item, chosen by `PickOriginalModeItem` at the break. */
  OriginalItem = 2,
}

/**
 * `obj+0x34` bit 30 — the wreck has been shot for its item. Set by the wreck
 * arm (`OR EAX,0x40000000` at `0x0046D06E`) and tested by the hit gate, so the
 * item comes out once.
 */
export const TYPE43_FLAG_TAKEN = 0x40000000;

/** `PlaySoundId(0x3616A9)` — the pickup, on the shot that takes it. */
export const SFX_TYPE43_PICKUP = 0x3616a9;

/**
 * The pickup strip the wreck becomes: `obj+0x28C = 0x116A + 50 * player`
 * (`LEA EAX,[EDI+EDI*4]` / `LEA EAX,[EAX+EAX*4]` / `LEA ECX,[EAX+EAX+0x116a]`),
 * drawn as `obj+0x28C + obj+0x2A0 - 1` for `obj+0x2A0` = 1..0x31 — 0x116A..
 * 0x119A for player 0 and 0x119C..0x11CC for player 1 — and the tag
 * `obj+0x2A4 = 0x1256 + player` beside it.
 */
export const TYPE43_PICKUP_SLOT = 0x116a;
export const TYPE43_PICKUP_SLOT_STRIDE = 50;
export const TYPE43_PICKUP_TAG = 0x1256;
/** `CMP EAX,0x31 ; JLE` after the increment at `0x0046D7D0`: the strip's last count. */
export const TYPE43_PICKUP_LAST = 0x31;

/** `PUSH 0x17A9` at `0x0046D464` — what a kind 2 (effect 7) draws while whole. */
export const TYPE43_EFFECT7_SLOT = 0x17a9;
/** `PUSH 0x3F4CCCCD` — 0.8, the lift of that piece. */
export const TYPE43_EFFECT7_RISE = Math.fround(0.8);
/** `CMP dword [EDI],7` at `0x0046D451` — the effect id that draws the piece. */
export const TYPE43_BURST_EFFECT = 7;

/** `FSUB double [0x00569100]` — how far a destroyed crate wreck drops. */
export const TYPE43_WRECK_DROP = 7.540295;
/** `MOV [ESI+0x124],0x40A00000` beside it — the wreck's new shot radius, 5.0. */
export const TYPE43_WRECK_RADIUS = 5.0;
/** `MOV [ESI+0x1B8],0x3FC00000` beside that — the wreck's shot rise, 1.5. */
export const TYPE43_WRECK_RISE = 1.5;
/** `FADD double [0x004C4CA8]` — the rise an Original Mode item is given, 4.0. */
export const TYPE43_ITEM_RISE = 4.0;

/** `PUSH 0x3FC00000` — the scale `SpawnPropHitEffectScaled` is handed, 1.5. */
export const TYPE43_HIT_EFFECT_SCALE = 1.5;

/**
 * The arm's seeds (`0x004622A8`): `0x60 - (rand() & 1) * 0xA0 - rand() % 0x21`
 * for each spin, and the literal amplitude `0x3FC00000`.
 */
export const TYPE43_ARM_SPIN_BASE = 0x60;
export const TYPE43_ARM_SPIN_SIGN_STEP = 0xa0;
export const TYPE43_ARM_BOB = 1.5;

/**
 * The routine's re-seed (`0x0046D268`): `0x90 - ((rand() & 1) << 8) -
 * rand() % 0x21` for each spin, then `rand() % 0x33 * 0.01 + 0.25` for the
 * amplitude — `0x004D5464` is 0.01 (`0x3C23D70A`) and `0x004C4C58` is 0.25
 * (`0x3E800000`).
 */
export const TYPE43_SPIN_BASE = 0x90;
export const TYPE43_SPIN_SIGN_STEP = 0x100;
export const TYPE43_SPIN_JITTER = 0x21;
export const TYPE43_BOB_JITTER = 0x33;
export const TYPE43_BOB_SCALE = Math.fround(0.01);
export const TYPE43_BOB_BASE = 0.25;

/** `IMUL 0x2AAAAAAB; SAR 3` with the sign fixup is a signed divide by 48. */
export const TYPE43_SPRING_DIVISOR = 48;

/**
 * `MOV dword ptr [ESI+0x1dc], 0x200` at `0x004622D1` — the bob's step, in
 * BAMS per frame, so one whole swing takes 128 frames. Seeded once, in the
 * arm; the re-seed changes only what the phase drives.
 */
export const TYPE43_BOB_STEP = 0x200;

/**
 * `g_motion_play_length` (`0x004E07D0`) for the two motions type 43's kinds
 * name, read out of `.data`: 469 at `0x004E0B7A` and 473 at `0x004E0B82`, both
 * `0x4A`. The break effect draws while `obj+0x32C < 0x4A - 2` and a wreck
 * hiding nothing goes when it passes that.
 */
export const TYPE43_MOTION_PLAY_LENGTH: Readonly<Record<number, number>> = {
  469: 0x4a,
  473: 0x4a,
};

/**
 * `(s8)placer+0x131B`, the row the arm reads the shot rise from — zero, see
 * the file comment. `[likely]`
 */
export const TYPE43_RISE_ROW = 0;

/** The pickup draws. `0x10C3` is the heart set 1 floats above the wreck. */
export const TYPE43_HEART_SLOT = 0x10c3;
/** `FADD float [0x004C49C0]` (3.0) and `PUSH 0x40400000` x3 — its lift and scale. */
export const TYPE43_HEART_RISE = 3.0;
export const TYPE43_HEART_SCALE = 3.0;
/** `FADD double [0x004C4CA8]` (4.0) and `PUSH 0x3FC00000` x3 — the tag's. */
export const TYPE43_TAG_RISE = 4.0;
export const TYPE43_TAG_SCALE = 1.5;
/** `PUSH 0x3FC00000 ; PUSH 0 ; PUSH 0` at `0x0046D67C` — the second model's z. */
export const TYPE43_ITEM_SECOND_Z = 1.5;
/** `ADD EDX,0x400` at `0x0046D588` — the Original item's spin a frame. */
export const TYPE43_ITEM_SPIN = 0x400;

/** `g_prop_kind_params[kind]`, as the bundle carries it. */
function Type43KindRow(kind: number) {
  return kind >= 0 ? T.breakables?.kinds?.[kind] : undefined;
}

/**
 * `g_motion_play_length[motion]`: the bundle's effect record when the stage
 * carries this prop's effect on this motion, and otherwise `.data`'s value for
 * the two motions the kinds name ({@link TYPE43_MOTION_PLAY_LENGTH}).
 */
function Type43PlayLength(p: BreakableProp): number {
  const def = T.breakables?.effects?.[String(p.effect)];
  if (def && def.motion === p.effectVariant) return def.play_length;
  return TYPE43_MOTION_PLAY_LENGTH[p.effectVariant] ?? 0;
}

/**
 * `PlaceGenericProp` case 0x2B's own arm.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00462250`
 * of `PlaceGenericProp`'s switch, reached through
 * `g_place_generic_prop_arms` and not called. Everything it writes, in its
 * order; the prologue has already put the placer's pitch, yaw and roll on
 * `+0x1CC..+0x1D4`, and this throws two of them away.
 */
export function PlaceGenericPropType43(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  const w = PropWords(p, TYPE43_WORDS_ZERO);
  w.o290 = ((pl.roll ?? 0) << 16) >> 16;
  w.o194 = ((pl.field_1f4 ?? 0) << 24) >> 24;
  const row = Type43KindRow(w.o290);
  p.hitRadius = row?.radius ?? 0;
  p.effect = row?.effect ?? 0;
  p.effectVariant = row?.effect_variant ?? 0;
  // `MOV ECX,[EBP+0x44]` -- the placer's y, which the prologue also put in
  // `+0x1A0`; kept apart because the sine overwrites that one every frame.
  p.restY = p.y;
  p.spin = TYPE43_ARM_SPIN_BASE - rng.int(2) * TYPE43_ARM_SPIN_SIGN_STEP
    - rng.int(TYPE43_SPIN_JITTER);
  p.yawSpin = TYPE43_BOB_STEP;
  p.rollSpin = TYPE43_ARM_SPIN_BASE - rng.int(2) * TYPE43_ARM_SPIN_SIGN_STEP
    - rng.int(TYPE43_SPIN_JITTER);
  p.shake = TYPE43_ARM_BOB;
  p.slot = w.o290 === TYPE43_CRATE_KIND ? BreakableSlot.Default : 0xffff;
  p.pitch = 0;
  p.roll = 0;
  p.restHeight = T.breakables?.kinds?.[TYPE43_RISE_ROW]?.y_offset ?? 0;
  // `if (g_GameMode == 1 && byte [0x009C88AA] != 0) obj+0x194 = 1` at
  // `0x00462371`. [diverges] `G` has no such byte and nothing in the port
  // writes one, so the override never fires -- as it would not in a game
  // with the byte clear. What sets it is the question `ReleaseHiddenItem`
  // (`class41/items.ts`) asks.
}

/**
 * `PropUpdateType43` — `FUN_0046CEA0`. `g_class41_updates[43]`
 * (`0x00593768`). One prop, one 60 Hz frame, transcribed whole: see the file
 * comment for the listing.
 */
export function PropUpdateType43(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  // The inline lifetime at `0x0046CEA9`: the prologue's arithmetic against
  // `(s16)obj+0x11C`, no scene-1 sweep, and `ActorDespawn`.
  if (PropStepLifetimeInline(p)) return;
  const w = PropWords(p, TYPE43_WORDS_ZERO);

  const f = p.flags;
  if ((f & BreakableFlag.Hit) !== 0 && (f & TYPE43_FLAG_TAKEN) === 0
      && w.o290 !== KIND_NONE) {
    // `AND AL,0xF7` -- the hit bit is cleared here and nowhere else.
    p.flags = f & ~BreakableFlag.Hit;
    if (p.effectFrames === 0) Type43FirstHits(p, w, rng, events);
    else Type43WreckHit(p, w, rng, events);
  }
  // `AND EDX,0xFFFFFFF9` at `0x0046D1DE` -- both player bits, every frame.
  p.flags &= ~(BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1);

  // `+0x32C` is the break effect's cursor *and* the destroyed latch.
  if (p.effectFrames >= 1) {
    p.effectFrames += 1;
    if (p.effectFrames > Type43PlayLength(p) - 2
        && w.o194 === Type43ItemSet.None) {
      ActorDespawnProp(p);
      return;
    }
  }

  Type43Bob(p, rng);
  Type43Tumble(p);
  Type43DrawBody(p, rng);

  if (w.o290 === KIND_NONE) return;
  if (w.o194 >= Type43ItemSet.ExtraLife && p.effectFrames > 0) {
    if (w.o194 === Type43ItemSet.ExtraLife) {
      const m = PropMatrixPush();
      PropMatrixTRzRyRx(m, p.x, Math.fround(p.y + TYPE43_HEART_RISE), p.z,
                        p.pitch, p.yaw, p.roll);
      MatrixScale(m, TYPE43_HEART_SCALE, TYPE43_HEART_SCALE,
                  TYPE43_HEART_SCALE);
      // `NoOpStub(3.0)` (`0x0041EBB0`) here does nothing.
      Type43DrawMaybeFaded(p, m, TYPE43_HEART_SLOT);
    } else if (G.g_GameMode === GameMode.Original) {
      Type43DrawOriginalItem(p, w);
    }
    if (p.storyItem > 0) {
      if (w.o194 === Type43ItemSet.ExtraLife) {
        const m = PropMatrixPush();
        // `FLD float; FADD double; FSTP float [ESP]` -- a float argument.
        MatrixTranslate(m, p.x, Math.fround(p.y + TYPE43_TAG_RISE), p.z);
        PropMatrixClearRotation(m);
        MatrixScale(m, TYPE43_TAG_SCALE, TYPE43_TAG_SCALE, TYPE43_TAG_SCALE);
        PropDrawSlot(p, m, p.removeFlag);
      }
      // No `JMP` after the tag's pop at `0x0046D774`: every set draws the
      // strip once `obj+0x2A0` is running.
      const m = PropMatrixPush();
      MatrixTranslate(m, p.x, p.y, p.z);
      MatrixRotateY(m, p.yaw);
      PropDrawSlot(p, m, ((p.slot << 16) >> 16) + p.storyItem - 1);
    }
    if (p.storyItem > 0) {
      p.storyItem += 1;
      if (p.storyItem > TYPE43_PICKUP_LAST) {
        ActorDespawnProp(p);
        return;
      }
    }
  }

  // `RegisterForShotTest` at `0x0046D83C`, after `obj+0x70..0x78` is the
  // point through the view; the port publishes it in world space. A wreck
  // keeps registering -- the second shot is how its item comes out.
  PropRegisterForShotTest(p, p.x, Math.fround(p.restHeight + p.y), p.z);
}

/**
 * The shot arms while `obj+0x32C` is 0: the kind's sound and the scaled impact
 * on every one, then the crack or the break.
 *
 * `[port-only]` as a function: `0x0046CF2A`..`0x0046D04F`, inline in the
 * routine. A kind 3 takes two of these — the first cracks it (its effect id is
 * 0 and its model 0x19E8), the second finds `0x19E6` and breaks it; a kind 2
 * has effect 7 and breaks on the first.
 */
function Type43FirstHits(p: BreakableProp, w: Type43Words, rng: Rng,
                         events?: Events): void {
  const row = Type43KindRow(w.o290);
  events?.emit("sound.play", { id: row?.sound ?? 0 });
  // `SpawnPropHitEffectScaled(obj, player, 1.5f)` (`FUN_004666B0`) at the
  // point the shot was aimed, which `combat/shot.ts` left on the prop.
  if (p.hitAim) {
    SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                             TYPE43_HIT_EFFECT_SCALE);
  }

  if (p.effect === 0 && ((p.slot << 16) >> 16) === BreakableSlot.Default) {
    // The crack: award 0, so no points; the broken model, turned to the
    // camera block's heading (`g_camera_block_yaw_bams`, `0x0046CF9C`).
    BreakablePropAwardHit(p.flags, false, rng);
    p.slot = BreakableSlot.Broken;
    p.yaw = CameraBlockYaw(G.g_camera_index);
    // `SpawnPropHitSpark(obj, player)` (`FUN_00465860`) -- on the crack only.
    if (p.hitAim) SpawnPropHitSpark(p.hitAim.x, p.hitAim.y, p.z);
    return;
  }
  // The break: award 1, ten points, and the effect's cursor starts.
  BreakablePropAwardHit(p.flags, true, rng);
  p.effectFrames = 1;
  if (((p.slot << 16) >> 16) === BreakableSlot.Broken) {
    // `FLD float; FSUB double; FSTP float`.
    p.y = Math.fround(p.y - TYPE43_WRECK_DROP);
    p.hitRadius = TYPE43_WRECK_RADIUS;
    p.restHeight = TYPE43_WRECK_RISE;
  }
  if (w.o194 === Type43ItemSet.OriginalItem
      && G.g_GameMode === GameMode.Original) {
    // `PickOriginalModeItem(obj, 0)` (`FUN_004629C0`): one `rand()` against
    // `g_original_item_tables[g_scene_index]` row 0, and the item id goes
    // over the kind in `obj+0x290` -- with `-1` for "nothing", which turns
    // the wreck off -- and its models and scale into `+0x28C`, `+0x28E` and
    // `+0x2C4`. One shipped spawn reaches it: stage 3 evt `0xD94`, whose
    // scene-2 row is ids 17, 20, 28 or nothing at weights 2:1:1:1.
    PickOriginalModeItem(p, 0, rng);
    p.y = Math.fround(p.y + TYPE43_ITEM_RISE);
  }
}

/**
 * The shot into the wreckage, which is where the item comes out.
 *
 * `[port-only]` as a function: `0x0046D054`..`0x0046D1CC`, inline in the
 * routine. The latch bit is set before the set is tested, so a set-2 wreck
 * shot outside Original Mode is latched and pays nothing.
 */
function Type43WreckHit(p: BreakableProp, w: Type43Words, rng: Rng,
                        events?: Events): void {
  if (w.o194 < Type43ItemSet.ExtraLife) return;
  if ((p.flags & TYPE43_FLAG_TAKEN) !== 0) return;
  p.flags |= TYPE43_FLAG_TAKEN;
  const f = p.flags;
  const both = (f & BreakableFlag.HitByPlayer0) !== 0
    && (f & BreakableFlag.HitByPlayer1) !== 0;

  if (w.o194 === Type43ItemSet.ExtraLife) {
    events?.emit("sound.play", { id: SFX_TYPE43_PICKUP });
    p.storyItem = 1;
    // Both bits: `rand() & 1` picks. One: player 0 if its bit is set.
    const who = both ? rng.int(2)
      : (f & BreakableFlag.HitByPlayer0) !== 0 ? 0 : 1;
    GrantExtraLife(who, events);
    p.removeFlag = TYPE43_PICKUP_TAG + who;
    p.slot = TYPE43_PICKUP_SLOT + TYPE43_PICKUP_SLOT_STRIDE * who;
    events?.emit("prop.pickup",
                 { id: p.id, player: who, sound: SFX_TYPE43_PICKUP });
    return;
  }
  if (G.g_GameMode !== GameMode.Original) return;
  events?.emit("sound.play", { id: SFX_TYPE43_PICKUP });
  p.storyItem = 1;
  // `g_original_items_taken[(s16)obj+0x290]++`, capped at 0x63
  // (`0x0046D15A`), and `SpawnOriginalItemBanner(g_original_item_records
  // [obj+0x290].sprite)` (`0x0046D17F`) -- the collectible's own pickup.
  const id = w.o290;
  const n = G.g_original_items_taken[id] ?? 0;
  if (n < ORIGINAL_ITEMS_TAKEN_CAP) G.g_original_items_taken[id] = n + 1;
  SpawnOriginalItemBanner(
    T.breakables?.original_items?.records[String(id)]?.sprite ?? 0);
  const who = both ? rng.int(2)
    : (f & BreakableFlag.HitByPlayer0) !== 0 ? 0 : 1;
  p.slot = TYPE43_PICKUP_SLOT + TYPE43_PICKUP_SLOT_STRIDE * who;
  events?.emit("prop.pickup",
               { id: p.id, player: who, sound: SFX_TYPE43_PICKUP });
}

/**
 * The bob: `obj+0x1E8` is a phase stepped by `obj+0x1DC`, and
 * `y = obj+0x1AC + sin(phase) * obj+0x2C0`.
 *
 * The sine takes the phase **before** the step — the engine saves it to the
 * stack and `FILD`s the copy (`0x0046D22A`) — and multiplies it by the double
 * at `0x004C4370` (`0x3F1921FB54442D18`, 2pi/65536). The re-seed fires when the
 * stepped phase's low sixteen bits come out zero (`AND 0x8000FFFF` with the
 * sign fixup), which is once a whole turn.
 */
function Type43Bob(p: BreakableProp, rng: Rng): void {
  const phase = p.hingeB;
  p.hingeB = (phase + p.yawSpin) | 0;
  p.y = Math.fround(Math.sin(phase * BAMS_TO_RAD_F64) * p.shake + p.restY);
  if ((p.hingeB & 0xffff) === 0) {
    p.spin = TYPE43_SPIN_BASE - rng.int(2) * TYPE43_SPIN_SIGN_STEP
      - rng.int(TYPE43_SPIN_JITTER);
    p.rollSpin = TYPE43_SPIN_BASE - rng.int(2) * TYPE43_SPIN_SIGN_STEP
      - rng.int(TYPE43_SPIN_JITTER);
    p.shake = Math.fround(rng.int(TYPE43_BOB_JITTER) * TYPE43_BOB_SCALE
                          + TYPE43_BOB_BASE);
  }
}

/**
 * The tumble: a damped spring on pitch and roll, in integers.
 *
 * ```
 * rate  -= trunc((angle + rate) / 48)
 * angle += rate
 * ```
 *
 * MSVC's `IMUL 0x2AAAAAAB; SAR 3` with the `SHR 31` fixup is a signed divide
 * by 48 truncated toward zero — so `Math.trunc`, not a shift.
 */
function Type43Tumble(p: BreakableProp): void {
  const pitchRate = p.spin
    - Math.trunc((p.pitch + p.spin) / TYPE43_SPRING_DIVISOR);
  const rollRate = p.rollSpin
    - Math.trunc((p.roll + p.rollSpin) / TYPE43_SPRING_DIVISOR);
  p.spin = pitchRate;
  p.rollSpin = rollRate;
  p.roll = (rollRate + p.roll) | 0;
  p.pitch = (pitchRate + p.pitch) | 0;
}

/**
 * The first draw block, `0x0046D34D`..`0x0046D483`: the crate, the kind-2
 * piece, or the effect tree, while the break has frames left to show.
 *
 * `[likely]` the motion is resident (`g_motion_slots[motion].state == 2`,
 * `CMP word [0x009A37E4 + motion*8],2`): the stage loads the pol file the
 * effect belongs to before the script places the prop, and the port has no
 * residency — the same reading `CarriedPropBreakUpdate`'s port makes.
 *
 * A cracked kind 3 (`0x19E6`, `obj+0x32C` still 0) is **not** drawn as
 * `0x19E6`: it fails the first test and draws effect 0 on motion 473 at frame
 * 0, and the break then plays that tree. `0x19E6` is only a state here.
 */
function Type43DrawBody(p: BreakableProp, rng: Rng): void {
  if (p.effectFrames >= Type43PlayLength(p) - 2) return;
  const m = PropMatrixPush();
  PropMatrixTRzRyRx(m, p.x, p.y, p.z, p.pitch, p.yaw, p.roll);
  if (p.effect === 0 && ((p.slot << 16) >> 16) === BreakableSlot.Default) {
    PropDrawSlot(p, m, p.slot);
    return;
  }
  if (p.effectFrames === 0 && p.effect === TYPE43_BURST_EFFECT) {
    MatrixTranslate(m, 0, TYPE43_EFFECT7_RISE, 0);
    PropDrawSlot(p, m, TYPE43_EFFECT7_SLOT);
    return;
  }
  // `EffectDrawUnlit(obj+0x324)` (`FUN_0040DD90`): `{effect, motion,
  // obj+0x32C, obj+0x330}`.
  PropDrawEffect(p, m, rng);
}

/**
 * The Original Mode item a set-2 wreck shows, `0x0046D580`..`0x0046D6F7`: the
 * spinning model and, when it has one, its second model billboarded in front
 * — both as `PickOriginalModeItem` left them at the break.
 */
function Type43DrawOriginalItem(p: BreakableProp, w: Type43Words): void {
  w.o1f4 = (w.o1f4 + TYPE43_ITEM_SPIN) | 0;
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateZ(m, p.roll);
  MatrixRotateY(m, w.o1f4);
  MatrixRotateX(m, p.pitch);
  MatrixScale(m, w.o2c4, w.o2c4, w.o2c4);
  Type43DrawMaybeFaded(p, m, p.slot);
  if (w.o28e === -1) return;
  const s = PropMatrixPush();
  MatrixTranslate(s, p.x, p.y, p.z);
  PropMatrixClearRotation(s);
  MatrixTranslate(s, 0, 0, TYPE43_ITEM_SECOND_Z);
  MatrixScale(s, w.o2c4, w.o2c4, w.o2c4);
  Type43DrawMaybeFaded(p, s, w.o28e);
}

/** `CMP EAX,0x19; JGE` — from this pickup frame the models fade. */
export const TYPE43_FADE_FROM = 0x19;
/** `FMUL float [0x004E3100]` — `0x3CA3D70A`, the fade's step a frame. */
export const TYPE43_FADE_STEP = Math.fround(0.02);

/**
 * `AssetDrawSlot` (`FUN_00418560`) while `obj+0x2A0 < 0x19`, and from there
 * `AssetDrawSlotWithAlpha` (`FUN_004185A0`) at `1.0 - obj+0x2A0 * 0.02f`,
 * stored as a float on its way to the call. The routine writes this branch
 * out three times.
 *
 * `[port-only]` as a function.
 */
function Type43DrawMaybeFaded(p: BreakableProp, m: Mat, slot: number): void {
  if (p.storyItem < TYPE43_FADE_FROM) {
    PropDrawSlot(p, m, slot);
    return;
  }
  PropDrawSlotWithAlpha(p, m, slot,
                        Math.fround(1.0 - p.storyItem * TYPE43_FADE_STEP));
}


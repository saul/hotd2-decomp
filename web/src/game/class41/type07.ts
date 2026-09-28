/**
 * Class 0x41 type 7 — a model hung from its own origin that swings when it is
 * shot, and in Original Mode drops an item the first time.
 *
 * One shipped spawn: stage 1 block 1 step 2 (evt `0x196C`), placed at
 * `(0, 102, -54)` with a descriptor `+0x11C` of 2. The model is `0x1736`,
 * `komono_st1.bin[8]`. What it depicts is `[open]`; what the code says is that
 * its **origin is the pivot**: the draw rotates about it, and the shot sphere
 * sits 57 units below it with a radius of 12, so the part a player can hit
 * hangs well beneath the point it swings from.
 *
 * The whole routine, `0x00466930`..`0x00466B39`:
 *
 * ```c
 * if ((s16)g_evt_step_index != (s8)obj->+0x196) {          // inline lifetime
 *     if (++(s8)obj->+0x197 > 4) { ActorDespawn(obj); return; }   // a LITERAL 4
 *     obj->+0x196 = g_evt_step_index;
 * }
 * if (obj->+0x34 & 8) {
 *     BreakablePropAwardHit(obj->+0x34, 0);
 *     obj->+0x34 &= ~8;
 *     PlaySoundId(0xE16A9);
 *     SpawnPropHitEffectScaled(obj, (obj->+0x34 & 2) ? 0 : 1, 1.5f);
 *     obj->+0x1D8 = rand() % 0x201;                 // pitch rate,   0 .. 512
 *     obj->+0x1E0 = rand() % 0x401 - 0x200;         // roll rate, -512 .. 512
 *     if (obj->+0x2A0 == 0 && g_GameMode == 1) {
 *         obj->+0x2A0 = 1;
 *         SpawnOriginalItemDrop(38.0f, 0, obj);        // 0x00466B40
 *     }
 * }
 * obj->+0x34 &= ~6;
 * obj->+0x1D8 -= (obj->+0x1CC + obj->+0x1D8) / 48;  // a damped spring on
 * obj->+0x1E0 -= (obj->+0x1E0 + obj->+0x1D4) / 48;  // pitch and on roll
 * obj->+0x1CC += obj->+0x1D8 / 4;
 * obj->+0x1D4 += obj->+0x1E0 / 4;
 * Push; Translate(x, y, z); RotZ(+0x1D4); RotX(+0x1CC); AssetDrawSlot(0x1736); Pop;
 * obj->+0x70.. = view(x, y - 57.0, z); RegisterForShotTest(obj);
 * ```
 *
 * Read off the disassembly and not the pseudocode, which stops at the first
 * `PlaySoundId` and again at the `MatrixStackPop` (both marked no-return in
 * the database) — so the effect, the two random rates, the Original Mode
 * drop and the shot registration are all invisible there (`L35`, `L37`). The
 * two routines after it in the image, `0x00466B40` and `0x00466BE0` (up to
 * `0x00467076`, the `RET` before type 8's `0x00467080`), are the drop's maker
 * and the drop's own update, ported below: separate functions that type 7
 * calls and allocates, not more of its body.
 *
 * **The lifetime is a literal, not `obj+0x11C`** (`CMP AL,0x4` at
 * `0x00466959`) `[proved]`, and there is no scene-1 sweep. The descriptor's 2
 * is read only by the drop, which copies it and adds 2. The port's generic arm
 * used to run `PropExpireByStepLifetime` on this type and retire it after two
 * step changes rather than four.
 *
 * Every constant is from the instruction stream (`L1`): the shot drop
 * `FSUB double [0x00569078]` is `0x404C800000000000` = 57.0, the effect scale
 * `PUSH 0x3FC00000` = 1.5, the drop height `PUSH 0x42180000` = 38.0, and the
 * divisors are `IMUL 0x2AAAAAAB; SAR 3` with the sign fixup (a truncating
 * signed divide by 48) and `CDQ; AND EDX,3; ADD; SAR 2` (by 4).
 *
 * No `SetDrawLayerNibble`, no alpha, one draw, and the hit bits are masked by
 * the routine itself.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale, MatrixTranslate,
} from "../matrix";
import { T } from "../tables";
import { SpawnOriginalItemBanner } from "./item_banner";
import { PropExpireByStepLifetime } from "./lifetime";
import {
  ORIGINAL_ITEM_NONE, OriginalItemDrawMaybeFaded,
  ORIGINAL_ITEM_PICKUP_FRAMES, ORIGINAL_ITEM_PICKUP_SLOT,
  ORIGINAL_ITEM_PICKUP_SLOT_P1, ORIGINAL_ITEM_PICKUP_SLOT_STRIDE,
  ORIGINAL_ITEM_SHOT_RISE, ORIGINAL_ITEM_TAKEN, ORIGINAL_ITEMS_TAKEN_CAP,
  PICKED_ITEM_WORDS_ZERO, PickOriginalModeItem, SFX_ORIGINAL_ITEM_PICKUP,
} from "./original_item";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import {
  PropDrawBegin, PropDrawSlot, PropMatrixClearRotation, PropMatrixPush,
} from "./prop_draw";
import {
  BreakableFlag, makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";

/** `0x1736` — `komono_st1.bin[8]`, the one model the routine draws. */
export const TYPE07_SLOT = 0x1736;

/** `CMP AL,0x4; JLE` at `0x00466959` — step changes it survives. */
export const TYPE07_LIFETIME_STEPS = 4;

/** `MOV [ESI+0x124], 0x41400000` at `0x00462874` — the arm's radius. */
export const TYPE07_HIT_RADIUS = 12.0;

/** `FSUB double [0x00569078]` — how far below the origin the sphere sits. */
export const TYPE07_SHOT_DROP = 57.0;

/** `COMMON\BULLET_MET1_16.WAV`, on every hit. */
export const SFX_TYPE07_HIT = 0xe16a9;

/** `PUSH 0x3FC00000` — `SpawnPropHitEffectScaled`'s size. */
const TYPE07_HIT_EFFECT_SCALE = 1.5;

/** `rand() % 0x201` — the pitch rate a hit sets, 0 .. 0x200. */
const TYPE07_PITCH_KICK = 0x201;
/** `rand() % 0x401 - 0x200` — the roll rate a hit sets, -0x200 .. 0x200. */
const TYPE07_ROLL_KICK = 0x401;
const TYPE07_ROLL_KICK_BIAS = 0x200;

/** The spring: `rate -= (angle + rate) / 48; angle += rate / 4`. */
const TYPE07_SPRING_DIVISOR = 48;
const TYPE07_SPRING_STEP_DIVISOR = 4;

/** `PUSH 0x42180000` at `0x00466A06` — the world height the drop starts at. */
export const TYPE07_ITEM_DROP_Y = 38.0;
/** `PUSH 0x0` at `0x00466A04` — the item set the drop picks from. */
export const TYPE07_ITEM_DROP_SET = 0;

/** `AND AL,0xF9` at `0x00466A28` — both players' hit bits, every frame. */
const HIT_PLAYER_BITS = BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1;

/**
 * `PlaceGenericProp` case 7's own arm (it shares it with case 0x49).
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00462874`
 * of `PlaceGenericProp`'s switch, and it is one instruction:
 * `MOV dword ptr [ESI+0x124], 0x41400000` — the radius, 12.0.
 */
export function PlaceGenericPropType7(p: BreakableProp,
                                      _pl: BreakablePlacement,
                                      _rng: Rng): void {
  p.hitRadius = TYPE07_HIT_RADIUS;
}

/**
 * `PropUpdateType7` — `FUN_00466930`. One prop, one 60 Hz frame.
 *
 * `+0x1D8` is {@link BreakableProp.spin} (the pitch rate), `+0x1E0`
 * {@link BreakableProp.rollSpin} (the roll rate), `+0x1CC`/`+0x1D4`
 * {@link BreakableProp.pitch}/{@link BreakableProp.roll}, and `+0x2A0`
 * {@link BreakableProp.storyItem} — "the drop has been made", set once and
 * never cleared.
 */
export function PropUpdateType7(p: BreakableProp, rng: Rng,
                                events?: Events): void {
  PropDrawBegin(p);
  // The inline lifetime: the step count against the literal 4, no scene-1
  // sweep, and `ActorDespawn` (`CALL 0x00409CC0` at `0x0046695E`).
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.stepsElapsed > TYPE07_LIFETIME_STEPS) {
      ActorDespawnProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }

  if ((p.flags & BreakableFlag.Hit) !== 0) {
    // Award 0: the hit counts for accuracy and pays no points.
    BreakablePropAwardHit(p.flags, false, rng);
    p.flags &= ~BreakableFlag.Hit;
    events?.emit("sound.play", { id: SFX_TYPE07_HIT });
    // `SpawnPropHitEffectScaled(obj, (obj+0x34 & 2) ? 0 : 1, 1.5f)`
    // (`FUN_004666B0`) at the point `combat/shot.ts` left on the prop.
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE07_HIT_EFFECT_SCALE);
    }
    p.spin = rng.int(TYPE07_PITCH_KICK);
    p.rollSpin = rng.int(TYPE07_ROLL_KICK) - TYPE07_ROLL_KICK_BIAS;
    if (p.storyItem === 0 && G.g_GameMode === GameMode.Original) {
      p.storyItem = 1;
      SpawnOriginalItemDrop(TYPE07_ITEM_DROP_Y, TYPE07_ITEM_DROP_SET, p, rng);
    }
  }
  p.flags &= ~HIT_PLAYER_BITS;

  // Both divides truncate toward zero -- MSVC's multiply-and-shift with the
  // sign fixup, and `CDQ; AND EDX,3` before the `SAR 2` -- so `Math.trunc`.
  // The rate is stepped from the OLD angle, and the angle from the NEW rate.
  const pitchRate = p.spin
    - Math.trunc((p.pitch + p.spin) / TYPE07_SPRING_DIVISOR);
  p.spin = pitchRate;
  const rollRate = p.rollSpin
    - Math.trunc((p.rollSpin + p.roll) / TYPE07_SPRING_DIVISOR);
  p.rollSpin = rollRate;
  p.pitch = Math.trunc(pitchRate / TYPE07_SPRING_STEP_DIVISOR) + p.pitch;
  p.roll = Math.trunc(rollRate / TYPE07_SPRING_STEP_DIVISOR) + p.roll;

  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateZ(m, p.roll);
  MatrixRotateX(m, p.pitch);
  PropDrawSlot(p, m, TYPE07_SLOT);

  // `FLD [ESI+0x1A0]; FSUB double 57.0; FSTP float`, through
  // `MatrixTransformPoint` after the pop -- the view, which the port leaves
  // off (see `class41/shot_test.ts`).
  PropRegisterForShotTest(p, p.x, Math.fround(p.y - TYPE07_SHOT_DROP), p.z);
}

// -- the Original Mode item a shot knocks loose --------------------------------

/** `obj+0x192` as {@link OriginalItemDropUpdate} switches on it. */
export enum OriginalItemDropPhase {
  /** Falling from where it was dropped, until it is 1.0 above the floor. */
  Fall = 0,
  /** One bounce, drifting in X and Z, until it reaches the floor. */
  Bounce = 1,
  /** On the floor. Only the yaw still turns. */
  Rest = 2,
}

/** `MOV [ESI+0x124], 0x40400000` at `0x00466BC2` — the drop's radius. */
export const ORIGINAL_ITEM_DROP_RADIUS = 3.0;
/** `FADD double [0x004ECB70]` — 1.0: the drop starts this far in +Z. */
const ORIGINAL_ITEM_DROP_Z = 1.0;
/** `ADD CX,0x2` at `0x00466B71` — its lifetime is its parent's `+0x11C` + 2. */
const ORIGINAL_ITEM_DROP_EXTRA_STEPS = 2;

/** `FSUB [0x0055D2CC]` — `0x3D273D5C`, the drop's gravity. */
const ORIGINAL_ITEM_GRAVITY = Math.fround(0.04083);
/** `FADD [0x004C4380]` — 1.0 above the floor is where it bounces. */
const ORIGINAL_ITEM_BOUNCE_RISE = 1.0;
/** `MOV [ESI+0x2C0], 0x3F333333` — the bounce's upward speed, 0.7. */
const ORIGINAL_ITEM_BOUNCE_SPEED = Math.fround(0.7);
/** `FADD [0x004C4C88]` / `FADD [0x0055CB50]` — the bounce's drift a frame. */
const ORIGINAL_ITEM_DRIFT_X = Math.fround(0.05);
const ORIGINAL_ITEM_DRIFT_Z = Math.fround(0.08);
/** `CMP AX,0x10` / `CMP AX,0x11` — the two ids that land turned half round. */
const ORIGINAL_ITEM_TURNED_A = 0x10;
const ORIGINAL_ITEM_TURNED_B = 0x11;
const ORIGINAL_ITEM_HALF_TURN = 0x8000;
/** `ADD EAX,0x400` at `0x00466E14` — the idle spin, BAMS a frame. */
const ORIGINAL_ITEM_SPIN = 0x400;

/** `0x10D0` — `common.bin[200]`, the shadow, `Scale(3, 1, 3)`. */
export const ORIGINAL_ITEM_SHADOW_SLOT = 0x10d0;
/** `FADD [0x004D1D24]` — `0x3E4CCCCD`, the shadow's height over the floor. */
const ORIGINAL_ITEM_SHADOW_RISE = Math.fround(0.2);
const ORIGINAL_ITEM_SHADOW_SCALE_XZ = 3.0;
const ORIGINAL_ITEM_SHADOW_SCALE_Y = 1.0;

/**
 * `SpawnOriginalItemDrop` — `FUN_00466B40`.
 *
 * ```c
 * obj = ActorAlloc(0x00466BE0, 0x378); ActorClearGameFields(obj);
 * obj->+0x34  = 0x80000001;
 * obj->+0x11C = parent->+0x11C + 2;          // a word add
 * obj->+0x19C = parent->+0x19C;  obj->+0x1A0 = y;  obj->+0x1A4 = parent->+0x1A4 + 1.0;
 * obj->+0x197 = parent->+0x197;  obj->+0x196 = parent->+0x196;
 * obj->+0x124 = 3.0f;
 * PickOriginalModeItem(obj, set);
 * ```
 *
 * `y` is a **world height**, not an offset: type 7 passes 38.0 for a prop
 * placed at 102. The one other maker of this object, `0x004699C0`
 * (`ChainSegmentUpdate`'s), builds it inline with its own position rule and is
 * not ported here.
 *
 * The object is appended to the pool, which the pool's walk reaches on the
 * frame it is made — as `ActorAlloc`'s append to the task list does.
 *
 * Its family, `PropFamily.OriginalItemDrop`, is the object's own routine,
 * {@link OriginalItemDropUpdate}.
 */
export function SpawnOriginalItemDrop(y: number, set: number,
                                      parent: BreakableProp,
                                      rng: Rng): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  // `ActorClearGameFields`: everything from `+0x34` is zero, including the
  // words `makeBreakableProp` seeds to -1 for the families that read them.
  p.storyItem = 0;
  p.removeFlag = 0;
  p.key0 = p.key1 = p.key2 = p.key3 = 0;
  p.family = PropFamily.OriginalItemDrop;
  p.at = parent.at;
  p.flags = 0x80000000 | BreakableFlag.Live;
  p.lifetime = ((parent.lifetime + ORIGINAL_ITEM_DROP_EXTRA_STEPS) << 16) >> 16;
  p.x = parent.x;
  p.y = y;
  p.z = Math.fround(parent.z + ORIGINAL_ITEM_DROP_Z);
  p.stepsElapsed = parent.stepsElapsed;
  p.lastStepIndex = parent.lastStepIndex;
  p.hitRadius = ORIGINAL_ITEM_DROP_RADIUS;
  PickOriginalModeItem(p, set, rng);
  G.g_breakable_props.push(p);
  return p;
}

/**
 * `OriginalItemDropUpdate` — `FUN_00466BE0`. The dropped item, one frame.
 *
 * ```c
 * PropExpireByStepLifetime(obj);
 * if (obj->+0x2A0 > 0 && ++obj->+0x2A0 > 0x31) { ActorDespawn(obj); return; }
 * if ((s16)obj->+0x290 == -1) { ActorDespawn(obj); return; }
 * if (!(obj->+0x34 & 0x40000000) && (obj->+0x34 & 8)) {
 *     BreakablePropAwardHit(obj->+0x34, 0);
 *     obj->+0x34 |= 0x40000000;
 *     if (g_original_items_taken[id] < 0x63) g_original_items_taken[id]++;
 *     SpawnOriginalItemBanner(g_original_item_records[id].banner);   // 0x00475E40
 *     PlaySoundId(0x3616A9);
 *     obj->+0x2A0 = 1;
 *     obj->+0x2A4 = both players' bits ? 0x116A + 50 * (rand() % 2)
 *                 : (bit 1 ? 0x116A : 0x119C);
 * }
 * switch ((s8)obj->+0x192) {
 * case 0: y += +0x2C0; +0x2C0 -= 0.04083;
 *         if (y < floor + 1.0) { +0x2C0 = 0.7; phase = 1; y = floor + 1.0; } break;
 * case 1: x += 0.05; z += 0.08; y += +0x2C0; +0x2C0 -= 0.04083;
 *         if (y <= floor) { y = floor; pitch = roll = 0; phase = 2;
 *                           if (id == 0x10 || id == 0x11) yaw += 0x8000; } break;
 * }
 * yaw += 0x400;
 * Push; T(x,y,z); RotY(yaw); RotZ(roll); Scale(s,s,s); Draw(+0x28C) or faded; Pop;
 * if (+0x28E != -1) { Push; T(x,y,z); MatrixClearRotation; Scale(s,s,s); Draw(+0x28E) or faded; Pop; }
 * if (+0x2A0 > 0) { Push; T(x,y,z); RotY(yaw); Draw(+0x2A4 + +0x2A0 - 1); Pop; }
 * Push; T(x, floor + 0.2, z); Scale(3, 1, 3); Draw(0x10D0); Pop;
 * obj->+0x70.. = view(x, y + 1.5, z); RegisterForShotTest(obj);
 * ```
 *
 * `floor` is `g_camera_fixed_eye_y` (`0x009C8E58`, the ground plane the
 * script sets). The prologue's result is not tested in the listing, but
 * `ActorDespawn` ends in `ActorKill` and does not return, so a retired item
 * stops there. The routine **never clears a hit bit**: the `0x40000000` latch
 * is what keeps the pickup to one. `+0x2C0` is
 * {@link BreakableProp.shake} (the vertical speed, for this object), `+0x2A0`
 * {@link BreakableProp.storyItem} (the pickup frame), `+0x2A4`
 * {@link BreakableProp.removeFlag} (the pickup strip's base) and `+0x192`
 * {@link BreakableProp.routinePhase}.
 *
 * From frame 25 the two item models go through `AssetDrawSlotWithAlpha`
 * (`FUN_004185A0`) at `1.0 - frame * 0.02`. The pickup is the collectible's
 * own -- the tally into `g_original_items_taken` and the banner -- and so is
 * the item it picks (`class41/original_item.ts`).
 */
export function OriginalItemDropUpdate(p: BreakableProp, rng: Rng,
                                       events?: Events): void {
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;
  const w = PropWords(p, PICKED_ITEM_WORDS_ZERO);

  if (p.storyItem > 0) {
    p.storyItem += 1;
    if (p.storyItem > ORIGINAL_ITEM_PICKUP_FRAMES) {
      ActorDespawnProp(p);
      return;
    }
  }
  if (w.o290 === ORIGINAL_ITEM_NONE) {
    ActorDespawnProp(p);
    return;
  }

  if ((p.flags & ORIGINAL_ITEM_TAKEN) === 0
      && (p.flags & BreakableFlag.Hit) !== 0) {
    BreakablePropAwardHit(p.flags, false, rng);
    p.flags |= ORIGINAL_ITEM_TAKEN;
    const id = w.o290;
    const n = G.g_original_items_taken[id] ?? 0;
    if (n < ORIGINAL_ITEMS_TAKEN_CAP) G.g_original_items_taken[id] = n + 1;
    SpawnOriginalItemBanner(
      T.breakables?.original_items?.records[String(id)]?.sprite ?? 0);
    events?.emit("sound.play", { id: SFX_ORIGINAL_ITEM_PICKUP });
    p.storyItem = 1;
    const p0 = (p.flags & BreakableFlag.HitByPlayer0) !== 0;
    const p1 = (p.flags & BreakableFlag.HitByPlayer1) !== 0;
    if (p0 && p1) {
      // `AND EAX,0x80000001` and the fixup: MSVC's signed `% 2` on a
      // non-negative `rand()`, so the draw is 0 or 1; then `LEA` x3 is
      // `0x116A + 50 * r`.
      p.removeFlag = ORIGINAL_ITEM_PICKUP_SLOT
        + ORIGINAL_ITEM_PICKUP_SLOT_STRIDE * rng.int(2);
    } else if (p0) {
      p.removeFlag = ORIGINAL_ITEM_PICKUP_SLOT;
    } else {
      p.removeFlag = ORIGINAL_ITEM_PICKUP_SLOT_P1;
    }
  }

  const floor = G.g_camera_fixed_eye_y;
  switch (p.routinePhase as OriginalItemDropPhase) {
    case OriginalItemDropPhase.Fall:
      p.y = Math.fround(p.y + p.shake);
      p.shake = Math.fround(p.shake - ORIGINAL_ITEM_GRAVITY);
      // `FLD floor; FADD 1.0; FCOMP y; TEST AH,0x41; JNZ` -- the bounce is
      // taken while `floor + 1.0 > y`.
      if (floor + ORIGINAL_ITEM_BOUNCE_RISE > p.y) {
        p.shake = ORIGINAL_ITEM_BOUNCE_SPEED;
        p.routinePhase = OriginalItemDropPhase.Bounce;
        p.y = Math.fround(floor + ORIGINAL_ITEM_BOUNCE_RISE);
      }
      break;
    case OriginalItemDropPhase.Bounce:
      p.x = Math.fround(p.x + ORIGINAL_ITEM_DRIFT_X);
      p.z = Math.fround(p.z + ORIGINAL_ITEM_DRIFT_Z);
      p.y = Math.fround(p.y + p.shake);
      p.shake = Math.fround(p.shake - ORIGINAL_ITEM_GRAVITY);
      // `FLD y; FCOMP floor; TEST AH,0x41; JZ` -- it lands at `y <= floor`.
      if (p.y <= floor) {
        p.y = floor;
        p.pitch = 0;
        p.roll = 0;
        p.routinePhase = OriginalItemDropPhase.Rest;
        if (w.o290 === ORIGINAL_ITEM_TURNED_A
            || w.o290 === ORIGINAL_ITEM_TURNED_B) {
          p.yaw = (p.yaw + ORIGINAL_ITEM_HALF_TURN) | 0;
        }
      }
      break;
    case OriginalItemDropPhase.Rest:
      break;
  }
  p.yaw = (p.yaw + ORIGINAL_ITEM_SPIN) | 0;

  const s = w.o2c4;
  let m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, p.yaw);
  MatrixRotateZ(m, p.roll);
  MatrixScale(m, s, s, s);
  // `NoOpStub(s)` (`FUN_0041EBB0`) here and below: an empty function.
  OriginalItemDrawMaybeFaded(p, m, p.slot);

  if (w.o28e !== -1) {
    m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    PropMatrixClearRotation(m);
    MatrixScale(m, s, s, s);
    OriginalItemDrawMaybeFaded(p, m, w.o28e);
  }

  if (p.storyItem > 0) {
    m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    MatrixRotateY(m, p.yaw);
    PropDrawSlot(p, m, p.removeFlag + p.storyItem - 1);
  }

  m = PropMatrixPush();
  MatrixTranslate(m, p.x, Math.fround(floor + ORIGINAL_ITEM_SHADOW_RISE), p.z);
  MatrixScale(m, ORIGINAL_ITEM_SHADOW_SCALE_XZ, ORIGINAL_ITEM_SHADOW_SCALE_Y,
              ORIGINAL_ITEM_SHADOW_SCALE_XZ);
  PropDrawSlot(p, m, ORIGINAL_ITEM_SHADOW_SLOT);

  PropRegisterForShotTest(p, p.x, Math.fround(p.y + ORIGINAL_ITEM_SHOT_RISE),
                          p.z);
}

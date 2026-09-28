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
  type Mat,
} from "../matrix";
import { PropExpireByStepLifetime } from "./lifetime";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import {
  PropDrawBegin, PropDrawSlot, PropDrawSlotWithAlpha, PropMatrixPush,
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

/**
 * `g_original_item_records` — `0x005957D8`, one `0xC`-byte record per Original
 * Mode item id: `{u16 model, u16 second model (0xFFFF for none), f32 draw
 * scale, u16 banner id}`. All 33 of them, ids 0..32, which is every id the
 * tables below can name (the largest is 32).
 *
 * Exe data, read with `read_memory` and not guessed. `[port-only]` as a TS
 * table; it belongs with the inventory in `game/original_mode.ts`, and lives
 * here only because this is the first routine ported that reads it.
 */
export const ORIGINAL_ITEM_RECORDS: readonly (readonly [number, number, number,
                                                       number])[] = [
  [0x109e, -1, 1.0, 0x5bd], [0x109b, -1, 1.0, 0x5be],
  [0x1087, -1, 1.0, 0x5bf], [0x10a5, 0x10a6, 1.0, 0x5c0],
  [0x10a7, 0x10a8, 1.0, 0x5c1], [0x10a9, 0x10aa, 1.0, 0x5c2],
  [0x10a3, 0x10a4, 1.0, 0x5c3], [0x107e, 0x107f, 1.0, 0x5c4],
  [0x1080, 0x1081, 1.0, 0x5c5], [0x1082, 0x1083, 1.0, 0x5c6],
  [0x107c, 0x107d, 1.0, 0x5c7], [0x1084, -1, 1.0, 0x5ce],
  [0x1085, -1, 1.0, 0x5cf], [0x109c, -1, 1.0, 0x5d0],
  [0x109a, 0x1098, 1.0, 0x5c8], [0x109a, 0x1099, 1.0, 0x5c9],
  [0x108e, 0x108c, 1.0, 0x5ca], [0x108e, 0x108d, 1.0, 0x5cb],
  [0x108e, 0x108b, 1.0, 0x5cc], [0x108e, 0x108a, 1.0, 0x5cd],
  [0x1086, -1, 1.5, 0x5d1], [0x1096, -1, 1.5, 0x5d2],
  [0x108f, -1, 1.0, 0x5d3], [0x1090, -1, 1.0, 0x5d4],
  [0x1092, -1, 1.0, 0x5d8], [0x1092, -1, 1.0, 0x5d6],
  [0x108f, -1, 1.0, 0x5d5], [0x1092, -1, 1.0, 0x5d9],
  [0x1094, -1, 1.0, 0x5d7], [0x109f, -1, 1.0, 0x5de],
  [0x1097, -1, 1.0, 0x5db], [0x10ab, -1, 1.0, 0x5dc],
  [0x1088, -1, 1.0, 0x5dd],
];

/**
 * `g_original_item_tables` — `0x00595AA0`: one pointer per scene index to
 * that scene's item sets, eight bytes a set — four signed item ids (-1 for
 * none) and four cumulative `rand()` weights, the last of which is the total.
 *
 * Six scenes, the pointers at `0x00595968`, `0x00595988`, `0x005959E0`,
 * `0x00595A18`, `0x00595A68` and `0x00595A80`; the seventh word is code, so
 * the training scene has no table (and no Original Mode). How many sets each
 * scene has is `[likely]` from where the next scene's table starts — the
 * index is the caller's set number, and nothing bounds it. `[port-only]` as a
 * TS table; see {@link ORIGINAL_ITEM_RECORDS}.
 */
export const ORIGINAL_ITEM_TABLES: readonly (readonly (readonly number[])[])[] = [
  [ // scene 0, 0x00595968
    [3, 4, 16, 17, 6, 7, 13, 14], [14, 16, 20, 21, 6, 10, 12, 13],
    [7, 8, 3, 4, 5, 9, 14, 15], [7, 8, 11, -1, 10, 12, 13, 21],
  ],
  [ // scene 1, 0x00595988
    [1, 28, 14, 3, 1, 2, 4, 7], [30, 0, 17, 18, 1, 4, 6, 9],
    [22, 23, 14, 15, 1, 2, 4, 6], [22, 28, 3, 15, 1, 2, 4, 5],
    [15, 18, 11, -1, 3, 4, 6, 6], [7, 8, 14, -1, 2, 3, 4, 6],
    [3, 5, 31, 21, 2, 3, 4, 6], [16, 17, 11, -1, 2, 3, 4, 6],
    [1, 14, 15, -1, 1, 4, 6, 6], [8, 9, 16, -1, 2, 3, 5, 5],
    [13, 13, 13, 13, 1, 2, 3, 4],
  ],
  [ // scene 2, 0x005959E0
    [17, 20, 28, -1, 2, 3, 4, 5], [17, 20, 28, -1, 1, 2, 3, 3],
    [2, 29, 12, -1, 1, 2, 4, 4], [8, 9, 4, -1, 1, 2, 3, 4],
    [25, 6, 12, -1, 1, 2, 5, 5], [0, 2, 4, 5, 1, 2, 5, 6],
    [9, 18, 32, -1, 1, 2, 5, 5],
  ],
  [ // scene 3, 0x00595A18
    [8, 9, 17, -1, 1, 2, 3, 5], [0, 10, 30, -1, 2, 3, 5, 5],
    [1, 25, 21, -1, 1, 2, 4, 4], [23, 4, 5, -1, 1, 3, 4, 4],
    [0, 1, -1, -1, 1, 2, 3, 3], [3, 4, 5, -1, 1, 2, 3, 3],
    [16, 17, 18, -1, 1, 2, 3, 3], [15, 21, 26, -1, 1, 3, 4, 4],
    [9, 14, 23, -1, 1, 2, 3, 3], [17, 18, 29, -1, 2, 4, 5, 5],
  ],
  [ // scene 4, 0x00595A68
    [32, 13, 31, -1, 1, 2, 3, 3], [8, 9, 10, -1, 1, 2, 3, 3],
    [17, 18, 19, -1, 1, 2, 3, 3],
  ],
  [ // scene 5, 0x00595A80
    [5, 6, -1, -1, 2, 3, 3, 3], [10, 11, 12, -1, 1, 2, 3, 4],
    [19, 19, 19, 19, 1, 2, 3, 4], [26, 26, 26, 26, 1, 2, 3, 4],
  ],
];

/** `obj+0x290 == -1` — the table chose nothing. */
export const ORIGINAL_ITEM_NONE = -1;

/**
 * The words `PickOriginalModeItem` writes and the drop's routine reads.
 * Keyed by offset (`class41/words.ts`), so any other object that calls
 * `PickOriginalModeItem` reads the same three through the same keys.
 */
type OriginalItemWords = {
  /** `obj+0x28E` — the second model, drawn facing the camera; -1 for none. */
  o28e: number;
  /** `obj+0x290` — the item id; -1 when the table chose nothing. */
  o290: number;
  /** `obj+0x2C4` — the record's draw scale. */
  o2c4: number;
};
const ORIGINAL_ITEM_WORDS_ZERO: OriginalItemWords = { o28e: 0, o290: 0, o2c4: 0 };

/**
 * `PickOriginalModeItem` — `FUN_004629C0`.
 *
 * ```c
 * tbl = g_original_item_tables[g_scene_index];
 * r = rand() % (s8)tbl[set*8 + 7];               // the total weight
 * for (i = 0; tbl[set*8 + 4 + i] <= r && i < 3; i++) ;
 * obj->+0x290 = (s8)tbl[set*8 + i];
 * if (obj->+0x290 == -1) { obj->+0x28C = 0; obj->+0x28E = 0; obj->+0x2C4 = 1.0; return; }
 * obj->+0x28C = rec.model; obj->+0x28E = rec.model2; obj->+0x2C4 = rec.scale;
 * ```
 *
 * One `rand()`, taken before the table is walked; the modulus is recomputed
 * on each test in the engine and is the same number every time.
 */
export function PickOriginalModeItem(p: BreakableProp, set: number,
                                     rng: Rng): void {
  const w = PropWords(p, ORIGINAL_ITEM_WORDS_ZERO);
  const row = ORIGINAL_ITEM_TABLES[G.g_scene_index]?.[set];
  const r = rng.int(row?.[7] ?? 0);
  let i = 0;
  while (i < 3 && (row?.[4 + i] ?? 0) <= r) i++;
  const id = row?.[i] ?? ORIGINAL_ITEM_NONE;
  w.o290 = id;
  const rec = ORIGINAL_ITEM_RECORDS[id];
  if (id === ORIGINAL_ITEM_NONE || !rec) {
    p.slot = 0;
    w.o28e = 0;
    w.o2c4 = 1.0;
    return;
  }
  p.slot = rec[0];
  w.o28e = rec[1];
  w.o2c4 = rec[2];
}

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

/** `obj+0x34 |= 0x40000000` — taken; the pickup arm does not run again. */
export const ORIGINAL_ITEM_TAKEN = 0x40000000;
/** `COMMON\ITEM_22.WAV`, when it is taken. */
export const SFX_ORIGINAL_ITEM_PICKUP = 0x3616a9;
/** `CMP EAX,0x31` — the pickup animation runs to frame 49, then it despawns. */
const ORIGINAL_ITEM_PICKUP_LAST = 0x31;
/** `CMP EAX,0x19` — from frame 25 the models are drawn faded. */
const ORIGINAL_ITEM_FADE_FROM = 0x19;
/** `FMUL [0x004E3100]; FSUBR [0x004C4380]` — `1.0 - frame * 0.02`. */
const ORIGINAL_ITEM_FADE_STEP = Math.fround(0.02);
/**
 * The pickup strip: `0x116A + 50 * player`, `common.bin[203]` and
 * `common.bin[253]`, drawn at `+ frame - 1` for frames 1..49.
 */
export const ORIGINAL_ITEM_PICKUP_SLOT = 0x116a;
export const ORIGINAL_ITEM_PICKUP_SLOT_P1 = 0x119c;
const ORIGINAL_ITEM_PICKUP_STRIDE = 50;
/** `0x10D0` — `common.bin[200]`, the shadow, `Scale(3, 1, 3)`. */
export const ORIGINAL_ITEM_SHADOW_SLOT = 0x10d0;
/** `FADD [0x004D1D24]` — `0x3E4CCCCD`, the shadow's height over the floor. */
const ORIGINAL_ITEM_SHADOW_RISE = Math.fround(0.2);
const ORIGINAL_ITEM_SHADOW_SCALE_XZ = 3.0;
const ORIGINAL_ITEM_SHADOW_SCALE_Y = 1.0;
/** `FADD double [0x0055D7D0]` — 1.5: the sphere sits this far above it. */
const ORIGINAL_ITEM_SHOT_RISE = 1.5;

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
 * (`FUN_004185A0`) at `1.0 - frame * 0.02`. Two things the pickup arm does
 * have nothing to land on in the port, the tally and the award, and each is
 * declared where the arm makes it.
 */
export function OriginalItemDropUpdate(p: BreakableProp, rng: Rng,
                                       events?: Events): void {
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;
  const w = PropWords(p, ORIGINAL_ITEM_WORDS_ZERO);

  if (p.storyItem > 0) {
    p.storyItem += 1;
    if (p.storyItem > ORIGINAL_ITEM_PICKUP_LAST) {
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
    // [diverges] `g_original_items_taken[id]++`, capped at 0x63: the tally
    // (`0x009C90C0`) is not in `G`, so it is not kept.
    // [diverges] `SpawnOriginalItemBanner(g_original_item_records[id]
    // .banner)` (`0x00475E40`) is unported -- it is the award, and the
    // inventory with it -- so the port emits `prop.pickup` below in its
    // place, as `PropUpdateType43` does.
    events?.emit("sound.play", { id: SFX_ORIGINAL_ITEM_PICKUP });
    p.storyItem = 1;
    const p0 = (p.flags & BreakableFlag.HitByPlayer0) !== 0;
    const p1 = (p.flags & BreakableFlag.HitByPlayer1) !== 0;
    let who: number;
    if (p0 && p1) {
      // `AND EAX,0x80000001` and the fixup: MSVC's signed `% 2` on a
      // non-negative `rand()`, so the draw is 0 or 1; then `LEA` x3 is
      // `0x116A + 50 * r`.
      who = rng.int(2);
      p.removeFlag = ORIGINAL_ITEM_PICKUP_SLOT
        + ORIGINAL_ITEM_PICKUP_STRIDE * who;
    } else if (p0) {
      who = 0;
      p.removeFlag = ORIGINAL_ITEM_PICKUP_SLOT;
    } else {
      who = 1;
      p.removeFlag = ORIGINAL_ITEM_PICKUP_SLOT_P1;
    }
    events?.emit("prop.pickup",
                 { id: p.id, player: who, sound: SFX_ORIGINAL_ITEM_PICKUP });
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
  const fade = p.storyItem >= ORIGINAL_ITEM_FADE_FROM
    ? Math.fround(1.0 - p.storyItem * ORIGINAL_ITEM_FADE_STEP) : null;
  let m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, p.yaw);
  MatrixRotateZ(m, p.roll);
  MatrixScale(m, s, s, s);
  // `NoOpStub(s)` (`FUN_0041EBB0`) here and below: an empty function.
  OriginalItemDrawMaybeFaded(p, m, p.slot, fade);

  if (w.o28e !== -1) {
    m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    PropMatrixClearRotation(m);
    MatrixScale(m, s, s, s);
    OriginalItemDrawMaybeFaded(p, m, w.o28e, fade);
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

/**
 * `AssetDrawSlot` (`FUN_00418560`) while `+0x2A0 < 0x19`, and
 * `AssetDrawSlotWithAlpha` (`FUN_004185A0`) at `alpha` from there on
 * (`CMP EAX,0x19; JGE` at `0x00466E7F`, and `FILD; FMUL [0x004E3100];
 * FSUBR [0x004C4380]; FSTP float` for the alpha).
 *
 * `[port-only]` as a function: the engine writes the branch out twice.
 */
function OriginalItemDrawMaybeFaded(p: BreakableProp, m: Mat, slot: number,
                                    alpha: number | null): void {
  if (alpha === null) PropDrawSlot(p, m, slot);
  else PropDrawSlotWithAlpha(p, m, slot, alpha);
}

/**
 * `MatrixClearRotation` (`FUN_004A9F70`) for a matrix recorded in world space.
 *
 * The engine writes the identity over the top's 3x3, which on its stack — the
 * camera's world-to-view times the translate — leaves the model at its point
 * and square to the screen. The port's matrices are the view one with the
 * camera taken back off (`class41/prop_draw.ts`), and the same result there is
 * the camera's own view-to-world rotation under the translate:
 * `[I | t_view] * view_to_world = [R_v2w | pos]`.
 *
 * `[port-only]` as a function. `g_camera_view_to_world` is the one
 * `UpdateSceneViewAndLight` (`FUN_00401F40`) left this tick (see
 * `game/camera/view.ts`), which is the view the engine's draw is under.
 */
function PropMatrixClearRotation(m: Mat): void {
  const v2w = G.g_camera_view_to_world;
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 4; k++) m[r * 4 + k] = v2w[r * 4 + k];
  }
}

/**
 * Class 0x41 type 57 — a shootable two-part fitting in stage 1 that
 * **shudders when it is shot** and does nothing else: no score, no break,
 * no item.
 *
 * One shipped spawn, in the spawn list stage 1 block 4 step 3 op 3 places
 * (descriptor `0x3B3C`), at the origin with a four-step lifetime. Neither
 * word is read: the routine draws at world literals and has **no lifetime
 * at all** — its only exit is a camera cue, camera path `0x2F` at frame
 * `0x96`.
 *
 * What it is, from the asset slots and nothing else: `0x0D43` and `0x0D44`
 * are `komono_st1b.bin[3]` and `[4]`, the second drawn 5.68 above the first
 * in the first's frame. `[open]` beyond that.
 *
 * The whole routine, `0x0046F350`..`0x0046F57F`. The pseudocode stops at the
 * hit arm's `PlaySoundId`, which Ghidra marks no-return (`L37`), so the arm's
 * other four lines and the shot-test tail are the disassembly's:
 *
 * ```c
 * float a = 0, b = 0, c = 0, d = 0;                     // [ESP+4..0x10]
 * if (g_active_cam_path == 0x2F && g_cam_path_frame == 0x96) {
 *     ActorDespawn(obj); return;                        // 0x0046F38E
 * }
 * if (obj->+0x34 & 8) {                                 // 0x0046F39F
 *     PlaySoundId(0x1516A9);
 *     obj->+0x34 &= ~8;                                 // AND ECX,0xFFFFFFF7
 *     SpawnPropHitSpark(obj, obj->+0x34 & 2 ? 0 : 1);   // 0x0046F3C8
 *     obj->+0x1A4 = -529.244;                           // MOV 0xC4044F9E
 *     obj->+0x2C0 = 1.0;                                // MOV 0x3F800000
 * }
 * obj->+0x34 &= ~6;                                     // AND AL,0xF9
 * if (obj->+0x2C0 > 0.01f) {                            // [0x004C4CC0]
 *     a = (rand() % 101 - 50.0f) * obj->+0x2C0 * 0.01f; // x of part 1
 *     b = (rand() % 101 - 50.0f) * obj->+0x2C0 * 0.01f; // z of part 1
 *     c = (rand() % 101 - 50.0f) * obj->+0x2C0 * 0.01f; // x of part 2
 *     d = (rand() % 101 - 50.0f) * obj->+0x2C0 * 0.01f; // z of part 2
 *     obj->+0x2C0 *= 0.85f;                             // [0x00564534]
 * }
 * MatrixStackPush(0);
 * MatrixTranslate(a - 697.042, -12.701, b - 529.244);   // doubles 0x00569120/28
 * MatrixRotateY(-0xB00);                                // PUSH 0xFFFFF500
 * AssetDrawSlot(0xD43);
 * MatrixTranslate(c - a, 5.68, d - b);                  // PUSH 0x40B5C28F
 * AssetDrawSlot(0xD44);
 * MatrixStackPop(1);
 * obj->+0x70..0x78 = MatrixTransformPoint(-697.042, -9.861, -529.244);
 * RegisterForShotTest(obj);                             // 0x0046F573
 * ```
 *
 * So a hit sets the shudder to 1.0 and it decays by 0.85 a frame; while it
 * is above 0.01 both parts jitter up to ±0.5 × shudder in X and Z, the
 * second part by its own two draws **relative to the first** and inside the
 * first's yaw — the constant `(c - a, d - b)` differences are what keep its
 * world jitter its own. The hit frame itself jitters. `rand()` is
 * `0x004ABE60`, four draws a frame for as long as it shudders.
 *
 * `[proved]` that `obj+0x1A4` is written **after** the spark is spawned, and
 * `SpawnPropHitSpark` takes the spark's z from that word: the first hit on
 * the shipped spawn, placed at the origin, puts its spark at `z = 0`, and
 * every later one at -529.244. That is the exe, and it is transcribed.
 *
 * The shot sphere: radius 5.0 from the arm, centred on the world literal the
 * `PROP_SHOT_OFFSET` row in `shot_test.ts` already carries — which was right,
 * `(0xC42E42B0, 0xC11DC6A8, 0xC4044F9E)`, and is registered every frame the
 * prop lives. `MatrixTransformPoint` (`FUN_004A8A80`) runs on the stack top
 * after the pop, which is the camera's view, so the engine's `obj+0x70` is
 * that literal in view space and the port's is the literal itself.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitSpark } from "../effects/sprite";
import { G } from "../globals";
import { MatrixRotateY, MatrixTranslate } from "../matrix";
import { ActorDespawnProp } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";

/** `g_active_cam_path` and `g_cam_path_frame` at which it removes itself. */
export const TYPE57_DESPAWN_CAM_PATH = 0x2f;
export const TYPE57_DESPAWN_CAM_FRAME = 0x96;

/** `0x0D43` — `komono_st1b.bin[3]`, the lower part. */
export const TYPE57_LOWER_SLOT = 0x0d43;
/** `0x0D44` — `komono_st1b.bin[4]`, drawn above it. */
export const TYPE57_UPPER_SLOT = 0x0d44;

/** `PlaySoundId(0x1516A9)` — `COMMON\BULLET_WOD1_16.WAV`, on every hit. */
export const SFX_TYPE57_HIT = 0x1516a9;

/** `MOV dword [ESI+0x124], 0x40A00000` — the arm's shot radius. */
export const TYPE57_RADIUS = 5.0;

/** `FSUB double [0x00569120]` / `[0x00569128]` — the draw's X and Z, negated. */
export const TYPE57_BASE_X = 697.042;
export const TYPE57_BASE_Z = 529.244;
/** `PUSH 0xC14B374C` — the lower part's Y. */
export const TYPE57_BASE_Y = Math.fround(-12.701);
/** `PUSH 0x40B5C28F` — the upper part's rise above the lower, in its frame. */
export const TYPE57_UPPER_RISE = Math.fround(5.68);
/** `PUSH 0xFFFFF500` — the yaw both parts are drawn at. */
export const TYPE57_YAW = -0xb00;

/**
 * `MOV dword [ESP+0x30..0x38], 0xC42E42B0 / 0xC11DC6A8 / 0xC4044F9E` — the
 * shot-test centre, a world point, and the Z the hit arm writes into
 * `obj+0x1A4` (the same `0xC4044F9E`).
 */
export const TYPE57_SHOT_X = Math.fround(-697.042);
export const TYPE57_SHOT_Y = Math.fround(-9.861);
export const TYPE57_SHOT_Z = Math.fround(-529.244);

/** `MOV dword [ESI+0x2C0], 0x3F800000` — the shudder a hit starts. */
export const TYPE57_SHUDDER = 1.0;
/** `FCOMP [0x004C4CC0]` — the shudder runs while it is above this. */
export const TYPE57_SHUDDER_EPS = Math.fround(0.01);
/** `FMUL [0x00564534]` — what the shudder is multiplied by each frame. */
export const TYPE57_SHUDDER_DECAY = Math.fround(0.85);
/** `rand() % 0x65` — the jitter draw's range, centred by `FSUB [0x0055D2AC]`. */
export const TYPE57_JITTER_SPREAD = 0x65;
export const TYPE57_JITTER_CENTRE = 50.0;
/** `FMUL [0x004D5464]` — the jitter's unit, per unit of shudder. */
export const TYPE57_JITTER_STEP = Math.fround(0.01);

/**
 * `PlaceGenericProp` case 0x39's own arm.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x004623EC`
 * of `PlaceGenericProp`'s switch (entry 27 of `g_place_generic_prop_arms`),
 * reached by the switch and not called. One line and a return:
 *
 * ```
 * 004623ec  MOV dword ptr [ESI+0x124], 0x40a00000   ; 5.0
 * 004623f6  POP EDI ; POP ESI ; POP EBP ; POP EBX ; RET
 * ```
 *
 * `GENERIC_RADIUS` in `generic.ts` carries the same 5.0 for `0x39`; setting
 * it here as well is what makes the arm whole.
 */
export function PlaceGenericPropType57(p: BreakableProp,
                                       _pl: BreakablePlacement,
                                       _rng: Rng): void {
  p.hitRadius = TYPE57_RADIUS;
}

/** One of the four jitter draws: `(rand() % 101 - 50.0f) * s * 0.01f`. */
function Type57Jitter(rng: Rng, shudder: number): number {
  return Math.fround((rng.int(TYPE57_JITTER_SPREAD) - TYPE57_JITTER_CENTRE)
                     * shudder * TYPE57_JITTER_STEP);
}

/**
 * `PropUpdateType57` — `FUN_0046F350`. One prop, one 60 Hz frame.
 *
 * `+0x2C0` is {@link BreakableProp.shake} (the shudder), `+0x1A4`
 * {@link BreakableProp.z} (written by the hit and read only by the spark)
 * and `+0x34` {@link BreakableProp.flags}.
 *
 * The spark's player argument, `obj+0x34 & 2 ? 0 : 1`, picks whose
 * crosshair `SpawnPropHitSpark` unprojects; the port resolved that ray at
 * shot time and left the point in {@link BreakableProp.hitAim}, which is
 * the shooter's.
 */
export function PropUpdateType57(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  if (G.g_active_cam_path === TYPE57_DESPAWN_CAM_PATH
      && G.g_cam_path_frame === TYPE57_DESPAWN_CAM_FRAME) {
    ActorDespawnProp(p);
    return;
  }
  if ((p.flags & BreakableFlag.Hit) !== 0) {
    events?.emit("sound.play", { id: SFX_TYPE57_HIT });
    p.flags &= ~BreakableFlag.Hit;
    // `SpawnPropHitSpark` (`FUN_00465860`) reads `obj+0x1A4` for the spark's
    // z, and the line below has not written it yet.
    if (p.hitAim) SpawnPropHitSpark(p.hitAim.x, p.hitAim.y, p.z);
    p.z = TYPE57_SHOT_Z;
    p.shake = TYPE57_SHUDDER;
  }
  // `AND AL,0xF9` -- the two player bits, every frame. Bit 3 went above.
  p.flags &= ~(BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1);

  let a = 0, b = 0, c = 0, d = 0;
  if (p.shake > TYPE57_SHUDDER_EPS) {
    a = Type57Jitter(rng, p.shake);
    b = Type57Jitter(rng, p.shake);
    c = Type57Jitter(rng, p.shake);
    d = Type57Jitter(rng, p.shake);
    p.shake = Math.fround(p.shake * TYPE57_SHUDDER_DECAY);
  }

  const m = PropMatrixPush();
  // `FLD float; FSUB double; FSTP float` for X and Z.
  MatrixTranslate(m, Math.fround(a - TYPE57_BASE_X), TYPE57_BASE_Y,
                  Math.fround(b - TYPE57_BASE_Z));
  MatrixRotateY(m, TYPE57_YAW);
  PropDrawSlot(p, m, TYPE57_LOWER_SLOT);
  MatrixTranslate(m, Math.fround(c - a), TYPE57_UPPER_RISE,
                  Math.fround(d - b));
  PropDrawSlot(p, m, TYPE57_UPPER_SLOT);
  // `MatrixStackPop(1)`.

  PropRegisterForShotTest(p, TYPE57_SHOT_X, TYPE57_SHOT_Y, TYPE57_SHOT_Z);
}

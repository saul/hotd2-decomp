/**
 * Class 0x41 type 8 — a model that bobs and rocks in place, carrying three
 * shootable parts that fall off it when shot and are gone in a splash.
 *
 * Five shipped descriptors, all stage 2 and all at `y = -26.25`, below the
 * walkway's ground plane (-9 and -8.5 where they are placed): evt `0x539C`,
 * `0x53C4`, `0x53EC` (block 9 step 4, again in block 27 step 1) and `0x8B0C`,
 * `0x8B34` (block 15 step 1, again in blocks 16 and 21). The object draws
 * `0x1A36`, which is `komono_boat.bin[1]` — the same slot stage 2's carrier
 * boat rides (`docs/formats/spawns.md`) — so the likely reading is a boat on
 * the canal. `[likely]`, from the slot's file and the splash sound; nothing in
 * the code names it. What the parts (`0x1AAA`) are is `[open]`.
 *
 * ## The object — `PropUpdateType8`, `0x00467080`..`0x00467289`
 *
 * `[proved]` from `disassemble_bytes` over the whole routine. The pseudocode
 * ends at the first `MatrixStackPop` (`0x004671BE`); the draw, the
 * `MatrixStore` the parts need and the second pop are all past it (`L35`):
 *
 * ```c
 * if (g_evt_step_index != (s8)obj->+0x196) {             // inlined lifetime
 *     if ((s8)++obj->+0x197 > 0xB) { ActorKill(); return; }   // a LITERAL 11
 *     obj->+0x196 = g_evt_step_index;
 * }
 * obj->+0x298 += 0x180; obj->+0x1D8 += 0x100; obj->+0x1E0 += 0x100;
 * dx = sin(+0x298) * 0.15f; dz = cos(+0x298) * 0.15f;      // stored as floats
 * obj->+0x1CC = ftol(sin(+0x1D8) * 384.0);                  // pitch
 * obj->+0x1D4 = ftol(cos(+0x1E0) * 384.0);                  // roll
 * Push; Identity; RotY(+0x1D0); RotZ(+0x1D4); RotX(+0x1CC);
 * o = MatrixTransformPoint((dx, 0, dz)); Pop;               // 0x004671B7
 * Push; Translate(x + dx, y, z + dz); RotY; RotZ; RotX;     // 0x004671C3..
 * Translate(-o.x, -o.y, -o.z); Scale(2.5, 2.5, 2.5); NoOpStub(2.5);
 * AssetDrawSlot(0x1A36 - (s16)obj->+0x290);                 // 0x0046726A
 * MatrixStore(obj + 0x2E4);                                 // 0x00467276
 * Pop;
 * ```
 *
 * It sways on a 0.15-unit circle every 171 frames and rocks up to 384 BAMS
 * (2.1°) in pitch and roll on two further phases, all three seeded at random
 * by the arm. **Its step lifetime is the literal 11**, not `obj+0x11C`: the
 * descriptors' 0 and 1 are never read, and every type-8 object lives for
 * eleven step changes and dies on the twelfth — by `ActorKill`, with no
 * scene-1 sweep. No hit arm, no radius, no `RegisterForShotTest`: the object
 * itself cannot be shot. `obj+0x290` is never written for this type — not by
 * the arm (`0x00461DD7`..`0x00461ED2`) nor by the routine — so the slot is
 * `0x1A36`.
 *
 * ## The arm — three parts, not eight
 *
 * `PlaceGenericProp`'s arm at `0x00461DD7` seeds the three phases from
 * `rand()` and then allocates **three** 0x1C0-byte objects running
 * `0x00467290`: the loop is `CMP EBX, 0x5946DC; JL` over the 12-byte records
 * from `0x005946B8`, so the count is `0x24 / 0xC = 3`, read and not found
 * (`L6`).
 *
 * ## The parts — `0x00467290`..`0x004674B2`
 *
 * A separate object with its **own layout**: position at `+0x194`, angles at
 * `+0x1AC..+0x1B4`, the parent pointer at `+0x1BC`. Every one of those offsets
 * means something else in the 0x378 object, so the part keeps them in
 * {@link BreakableProp.words} (`Type8PartWords`) and uses the shared fields
 * only where the meaning is the shared one: `+0x34`
 * {@link BreakableProp.flags}, `+0x40..+0x48` {@link BreakableProp.hitPos} (the
 * world position, which is what those actor words are), `+0x124`
 * {@link BreakableProp.hitRadius} and `+0x70..+0x78` the shot point.
 *
 * ```c
 * parent = obj->+0x1BC;
 * if (g_evt_step_index != (s8)obj->+0x1BA) {
 *     if ((s8)++obj->+0x1BB > 0xB) { ActorDespawn(obj); return; }
 *     obj->+0x1BA = g_evt_step_index;
 * }
 * if (obj->+0x34 & 8) {
 *     BreakablePropAwardHit(obj->+0x34, 1);  obj->+0x34 &= ~8;   // bit 3 only
 *     PlaySoundId(0x1D16A9);                                    // the crack
 *     0x004674C0(obj->+0x78, obj->+0x48, obj->+0x34 & 2 ? 0 : 1, 1.0);
 *     obj->+0x1B9 = 1;                                          // it falls
 * }
 * if (obj->+0x1B9 == 1) {
 *     obj->+0x1A4 -= 0.006805; obj->+0x1B4 -= 0x200; obj->+0x198 += obj->+0x1A4;
 * }
 * Push; MatrixStackSetTopFromArray(g_camera_blocks + g_camera_index * 0x1A4);
 * MatrixMultiply(parent + 0x2E4);
 * Translate(+0x194, +0x198, +0x19C); RotZ(+0x1B4); RotY(+0x1B0); RotX(+0x1AC);
 * MatrixGetTranslation(&obj->+0x40); MatrixStore(local); Pop;
 * Push; MatrixMultiply(local); AssetDrawSlot(0x1AAA); Pop;     // 0x0046741E
 * if (obj->+0x44 < -25.0) {                                    // 0x00467434
 *     0x00472A50(obj->+0x40, obj->+0x44, obj->+0x48);          // the splash
 *     PlaySoundId(0x4316A9);  ActorKill();                     // no return
 * }
 * obj->+0x70 = view * obj->+0x40; RegisterForShotTest(obj);    // 0x004674A5
 * ```
 *
 * `+0x1B9` is written by the part's own hit arm and by nothing else that can
 * reach it: the arm stores the object in the part (`+0x1BC`), never the part
 * in the object, so no other routine holds a pointer to a part `[likely]`. A
 * shot knocks it loose, and every later shot pays again (the arm is not
 * latched). Its fall
 * is in the parent's **model** space, which carries the parent's 2.5 scale and
 * tilt, so 0.006805 a frame there is 0.017 in the world.
 *
 * ### The part's matrix, and why the port's is the parent's world matrix
 *
 * `g_camera_blocks` (`0x009A6040`) is the camera block's **second** matrix,
 * `+0x40` — the **view-to-world**. `UpdateSceneViewAndLight` (`FUN_00401F40`)
 * builds it as the inverse of the world-to-view at `+0x00` from the same eye
 * and angles, and `SpawnPropHitEffectScaled` (`FUN_004666B0`) uses the same
 * address to take a view-space point back to the world. The parent's
 * `MatrixStore` saved `W2V . T . R . T(-o) . S` — composed on the view the
 * stack starts every task with. So the part's product is
 * `V2W . W2V . ParentModel . Part = ParentModel . Part`, a **world** matrix,
 * and every use of it agrees: its translation (`+0x40`) is then put through
 * the view for the shot point and compared against a world height, and the
 * draw pushes the view back on before multiplying it in.
 *
 * `[proved]` that the instructions compose exactly that; `[likely]` that
 * `V2W . W2V` is the identity to float precision, from the annotation of the
 * routine that builds both and from the fact that nothing else would make the
 * `-25.0` test mean anything. The port records world matrices from the
 * identity, so the part composes on the parent's recorded
 * {@link BreakableProp.drawMatrix} — the same product with the view already
 * cancelled. Both are this frame's: the parent is allocated first and so runs
 * first in the task walk, and the port's pool must keep that order.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { PROP_SPARK_KIND, SpawnPropHitEffectScaled } from "../effects/sprite";
import { G } from "../globals";
import {
  MatrixGetTranslation, MatrixLoadIdentity, MatrixMultiply, MatrixRotateX,
  MatrixRotateY, MatrixRotateZ, MatrixScale, MatrixTransformPoint,
  MatrixTranslate,
} from "../matrix";
import { vec3 } from "../vec";
import { MsvcRand } from "./group";
import {
  ActorDespawnProp, ActorKillProp, BreakablePropAwardHit, SFX_PROP_CRACK,
} from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import {
  BreakableFlag, makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";

// ---- the object -------------------------------------------------------------

/** The words of the 0x378 object `PropUpdateType8` keeps that no field carries. */
export interface Type8Words {
  /** `obj+0x298` — the sway's phase, BAMS; `rand()` from the arm, `+0x180` a frame. */
  o298: number;
}
const TYPE8_WORDS_ZERO: Type8Words = { o298: 0 };

/** `CMP AL, 0xB; JLE` — the step changes it survives; the twelfth kills it. */
export const TYPE8_STEP_LIMIT = 0xb;
/** `ADD EAX, 0x180` on `+0x298` — the sway, BAMS a frame: 171 frames a turn. */
export const TYPE8_SWAY_STEP = 0x180;
/** `MOV EAX, 0x100` added to `+0x1D8` and `+0x1E0` — the two rocking phases. */
export const TYPE8_ROCK_STEP = 0x100;
/** `FMUL float [0x004C4D08]` — `0x3E19999A`, the sway's radius. */
export const TYPE8_SWAY_RADIUS = Math.fround(0.15);
/** `FMUL double [0x00569080]` — `0x4078000000000000`, the rock's amplitude in BAMS. */
export const TYPE8_ROCK_BAMS = 384.0;
/** `PUSH 0x40200000` x3 — the draw's `MatrixScale(2.5, 2.5, 2.5)`. */
export const TYPE8_SCALE = 2.5;
/** `MOV EAX, 0x1A36; SUB EAX, EDX` — `komono_boat.bin[1]`, less `(s16)obj+0x290`. */
export const TYPE8_SLOT = 0x1a36;
/**
 * `rand() & 0x8000FFFF` with the sign fix-up, three times: `rand() % 0x10000`.
 * The engine's `rand()` is fifteen bits, so the modulus never bites and each
 * phase is `rand()` itself — which is why this is `MsvcRand` and not
 * `rng.int(0x10000)`, whose range is twice the engine's (`L46`).
 */
export const TYPE8_PHASE_WRAP = 0x10000;

/**
 * `PropUpdateType8` — `FUN_00467080`. `g_class41_updates[8]`. One object, one
 * 60 Hz frame.
 *
 * `obj+0x196`/`+0x197` are {@link BreakableProp.lastStepIndex} and
 * {@link BreakableProp.stepsElapsed}; `obj+0x1D8` ({@link BreakableProp.spin})
 * and `obj+0x1E0` ({@link BreakableProp.rollSpin}) are, for this routine, the
 * **phases** of the pitch and roll rock, not rates (`L3`); `obj+0x2E4` is
 * {@link BreakableProp.drawMatrix}, world space here.
 */
export function PropUpdateType8(p: BreakableProp, rng: Rng,
                                events?: Events): void {
  void rng; void events;
  PropDrawBegin(p);
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.stepsElapsed > TYPE8_STEP_LIMIT) {
      ActorKillProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }
  const w = PropWords(p, TYPE8_WORDS_ZERO);
  w.o298 += TYPE8_SWAY_STEP;
  p.spin += TYPE8_ROCK_STEP;
  p.rollSpin += TYPE8_ROCK_STEP;
  // One `FMUL double` product, `FSIN` and `FCOS` of it, each times the float
  // 0.15 and stored as a float (`[ESP+4]`, `[ESP+0x2C]`).
  const sway = w.o298 * BAMS_TO_RAD_F64;
  const dx = Math.fround(Math.sin(sway) * TYPE8_SWAY_RADIUS);
  const dz = Math.fround(Math.cos(sway) * TYPE8_SWAY_RADIUS);
  p.pitch = Math.trunc(Math.sin(p.spin * BAMS_TO_RAD_F64) * TYPE8_ROCK_BAMS);
  p.roll = Math.trunc(Math.cos(p.rollSpin * BAMS_TO_RAD_F64) * TYPE8_ROCK_BAMS);

  // The sway offset put through the rock alone, from the identity.
  const r = PropMatrixPush();
  MatrixLoadIdentity(r);
  MatrixRotateY(r, p.yaw);
  MatrixRotateZ(r, p.roll);
  MatrixRotateX(r, p.pitch);
  const o = vec3();
  MatrixTransformPoint(r, vec3(dx, 0, dz), o);
  const ox = Math.fround(o.x);
  const oy = Math.fround(o.y);
  const oz = Math.fround(o.z);

  const m = PropMatrixPush();
  MatrixTranslate(m, Math.fround(dx + p.x), p.y, Math.fround(dz + p.z));
  MatrixRotateY(m, p.yaw);
  MatrixRotateZ(m, p.roll);
  MatrixRotateX(m, p.pitch);
  MatrixTranslate(m, -ox, -oy, -oz);
  MatrixScale(m, TYPE8_SCALE, TYPE8_SCALE, TYPE8_SCALE);
  // `NoOpStub(2.5)` (`FUN_0041EBB0`) at `0x00467256`: a bare `RET`.
  PropDrawSlot(p, m, TYPE8_SLOT);
  // `MatrixStore(obj + 0x2E4)` — what the three parts compose on.
  p.drawMatrix = m.slice(0, 16);
}

// ---- the arm ------------------------------------------------------------------

/**
 * The parts' positions in the object's model space: `0x005946B8`, three
 * `{f32 x, y, z}` records.
 */
export const TYPE8_PART_POSITIONS: ReadonlyArray<readonly [number, number, number]> = [
  [Math.fround(3.3746), Math.fround(2.8066), Math.fround(6.2586)],   // 0x4057F972 0x40339F56 0x40C84674
  [Math.fround(3.7102), Math.fround(2.6641), 0],                      // 0x406D73EB 0x402A809D 0
  [Math.fround(3.5059), Math.fround(2.8066), Math.fround(-6.3211)],  // 0x406060AA 0x40339F56 0xC0CA4674
];
/**
 * The parts' angles: `0x005946E0`, three `{s16 x, y, z}` records, BAMS. They
 * land in `+0x1AC`, `+0x1B0` and `+0x1B4`, which the draw applies as
 * `RotZ(+0x1B4); RotY(+0x1B0); RotX(+0x1AC)`.
 */
export const TYPE8_PART_ANGLES: ReadonlyArray<readonly [number, number, number]> = [
  [-1043, -855, 0],
  [-1043, 0, 0],
  [1150, 917, 0],
];
/** `MOV dword ptr [EDI+0x124], 0x40200000` — each part's radius. */
export const TYPE8_PART_RADIUS = 2.5;
/** `MOV dword ptr [EDI+0x34], 0x80000001`. */
export const TYPE8_PART_FLAGS = 0x80000001;

/**
 * `PlaceGenericProp` case 8's arm, `0x00461DD7`..`0x00461ED2`.
 *
 * ```c
 * obj->+0x298 = rand() % 0x10000; obj->+0x1D8 = rand() % 0x10000;
 * obj->+0x1E0 = rand() % 0x10000;
 * for (i = 0, rec = 0x5946B8, ang = 0x5946E0; rec < 0x5946DC; i++) {
 *     part = ActorAlloc(0x00467290, 0x1C0); ActorClearGameFields(part);
 *     part->+0x1BA = g_evt_step_index; part->+0x1BB = 0;
 *     part->+0x34 = 0x80000001; part->+0x1B8 = i; part->+0x1BC = obj;
 *     part->+0x194/198/19C = rec[0..2];
 *     part->+0x1B4 = ang[2]; part->+0x1B0 = ang[1]; part->+0x1AC = ang[0];
 *     part->+0x124 = 2.5;
 * }
 * ```
 *
 * No radius for the object itself, and no write to `obj+0x290`.
 *
 * **The parts are appended to `G.g_breakable_props` here, before the caller
 * appends the object**, where the engine's `ActorAlloc` order is the object
 * first (at `PlaceGenericProp`'s head) and its parts after. Each part reads
 * the matrix the object stored *this* frame, so the pool must run the object
 * first: the caller has to insert the object ahead of whatever its arm
 * appended. (Type 67's arm, the same shape, asks the same.)
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00461DD7`
 * of `PlaceGenericProp`'s switch.
 */
export function PlaceGenericPropType8(p: BreakableProp,
                                      pl: BreakablePlacement,
                                      rng: Rng): void {
  void pl;
  const w = PropWords(p, TYPE8_WORDS_ZERO);
  w.o298 = MsvcRand(rng) % TYPE8_PHASE_WRAP;
  p.spin = MsvcRand(rng) % TYPE8_PHASE_WRAP;
  p.rollSpin = MsvcRand(rng) % TYPE8_PHASE_WRAP;
  for (let i = 0; i < TYPE8_PART_POSITIONS.length; i++) {
    const q = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
    q.family = PropFamily.Type8Piece;
    q.at = p.at;
    // The 0x1C0 object has no `+0x28C`: nothing to draw until it runs.
    q.slot = 0;
    q.draws = [];
    const qw = PropWords(q, TYPE8_PART_WORDS_ZERO);
    qw.o1BA = G.g_evt_step_index;
    qw.o1BB = 0;
    q.flags = TYPE8_PART_FLAGS;
    qw.o1B8 = i;
    qw.o1BC = p.id;
    const at = TYPE8_PART_POSITIONS[i];
    qw.o194 = at[0];
    qw.o198 = at[1];
    qw.o19C = at[2];
    const a = TYPE8_PART_ANGLES[i];
    qw.o1B4 = a[2];
    qw.o1B0 = a[1];
    qw.o1AC = a[0];
    q.hitRadius = TYPE8_PART_RADIUS;
    G.g_breakable_props.push(q);
  }
}

// ---- the parts ----------------------------------------------------------------

/**
 * The 0x1C0-byte part's own words, keyed by offset. **Its layout is not the
 * 0x378 object's**: the same offsets there are `group`, `contact`, `x`, `z`,
 * `restY`.., and none of those meanings apply (`L3`).
 */
export interface Type8PartWords {
  /** `+0x194`/`+0x198`/`+0x19C` — the position in the object's model space. */
  o194: number;
  o198: number;
  o19C: number;
  /** `+0x1A4` — the fall's velocity along the model's Y, per frame. */
  o1A4: number;
  /** `+0x1AC`/`+0x1B0`/`+0x1B4` — X, Y, Z angles, BAMS; the fall turns Z. */
  o1AC: number;
  o1B0: number;
  o1B4: number;
  /** `+0x1B8` — which of the three, 0..2. Written by the arm, read by nothing. */
  o1B8: number;
  /** `+0x1B9` — 1 once shot: it falls. Zero until the part's own hit arm. */
  o1B9: number;
  /** `+0x1BA` — the `g_evt_step_index` it last saw. */
  o1BA: number;
  /** `+0x1BB` — step changes counted, a `char`. */
  o1BB: number;
  /** `+0x1BC` — the object, a pointer in the engine and its prop id here. */
  o1BC: number;
}
const TYPE8_PART_WORDS_ZERO: Type8PartWords = {
  o194: 0, o198: 0, o19C: 0, o1A4: 0, o1AC: 0, o1B0: 0, o1B4: 0,
  o1B8: 0, o1B9: 0, o1BA: 0, o1BB: 0, o1BC: 0,
};

/** `AssetDrawSlot(0x1AAA)` at `0x0046741E` — the part. */
export const TYPE8_PART_SLOT = 0x1aaa;
/** `FSUB float [0x00569088]` — `0x3BDEFC7A`, the fall's gravity in model units. */
export const TYPE8_PART_GRAVITY = Math.fround(0.006805);
/** `ADD dword ptr [ESI+0x1B4], 0xFFFFFE00` — the fall's turn, BAMS a frame. */
export const TYPE8_PART_FALL_TURN = -0x200;
/** `FCOMP float [0x0055D2C8]` — `0xC1C80000`: below this world height it is gone. */
export const TYPE8_PART_SPLASH_Y = -25.0;
/** `SpawnPropHitEffectAtDepth` (`FUN_004674C0`)'s fourth argument, `PUSH 0x3F800000`. */
export const TYPE8_PART_HIT_EFFECT_SCALE = 1.0;
/** `PlaySoundId(0x4316A9)` — `COMMON\SIBUKI4_16.WAV`, the splash. */
export const SFX_TYPE8_PART_SPLASH = 0x4316a9;

/**
 * `SpawnPropSplash`'s splash: a 0x50-byte task running `PropSplashUpdate`,
 * which draws
 * `+0x48` at `Translate(pos); RotY(+0x40); Scale(8, 8, 8)` and then steps it,
 * killing itself past `0x903`. `+0x48` starts at `0x8F8`, so the frames seen
 * are `0x8F8..0x903` — the strip `SpawnSpriteEffectFromParams` draws for
 * impact kind 5 — and `+0x40` is `g_camera_block_yaw_bams` at the moment it
 * is made, so it faces where the camera looked then and does not follow it.
 */
export const TYPE8_SPLASH_FIRST_SLOT = 0x08f8;
export const TYPE8_SPLASH_LAST_SLOT = 0x0903;
/** `PUSH 0x41000000` x3 in `PropSplashUpdate`. */
export const TYPE8_SPLASH_SCALE = 8.0;

const ZERO_MATRIX: readonly number[] = new Array(16).fill(0);

/**
 * `SpawnPropSplash` — `FUN_00472A50`, with its task's per-frame body,
 * `PropSplashUpdate` (`FUN_00472AA0`), left to the sprite pool.
 *
 * `[port-only]` as a *record*: the engine's task is its own renderer, and the
 * port's sprite pool (`effects/sprite.ts`) steps and draws it instead. The
 * kind is the pool's "not a kind in the engine's switch" sentinel, which
 * plays no sound and takes no distance law, as this task does not.
 */
export function SpawnPropSplash(x: number, y: number, z: number): void {
  G.g_sprite_effects.push({
    id: G.g_sprite_effect_seq++,
    kind: PROP_SPARK_KIND,
    pos: vec3(x, y, z),
    pitch: 0,
    yaw: G.g_camera_block_yaw_bams,
    roll: 0,
    scale: vec3(TYPE8_SPLASH_SCALE, TYPE8_SPLASH_SCALE, TYPE8_SPLASH_SCALE),
    slot: TYPE8_SPLASH_FIRST_SLOT,
    lastSlot: TYPE8_SPLASH_LAST_SLOT,
  });
}

/**
 * `Type8MountedPartUpdate` — `FUN_00467290`. The update of the three 0x1C0
 * objects `PlaceGenericProp`'s case 8 allocates, named for the one thing
 * that distinguishes it: it poses itself on its parent's stored matrix.
 *
 * Runs as {@link PropFamily.Type8Piece}. It is its own object and not a
 * generic prop: no `PropExpireByStepLifetime`, no scene-1 sweep, its own
 * lifetime at `+0x1BA`/`+0x1BB` that ends in `ActorDespawn`, its own hit arm,
 * and its own shot registration at its world position with radius 2.5.
 *
 * The hit arm clears **bit 3 only**: bits 1 and 2 stay set after a hit, so a
 * second player's later shot finds both player bits and
 * `BreakablePropAwardHit` picks the payee at random. That is the routine.
 *
 * The engine draws the part on the frame it falls below -25.0 and then kills
 * it; that draw was queued before the object went, and the pool keeps it for
 * the renderer in `g_prop_final_draws`.
 */
export function Type8MountedPartUpdate(p: BreakableProp, rng: Rng,
                                           events?: Events): void {
  PropDrawBegin(p);
  const w = PropWords(p, TYPE8_PART_WORDS_ZERO);
  // `MOV EDI, [ESI+0x1BC]` before anything else. The object dies on the same
  // step change as its parts and runs first, so a part never reads a dead
  // object's matrix; the zeros stand for `ActorClearGameFields`' `+0x2E4` if
  // it ever did.
  const parent = G.g_breakable_props.find((q) => q.id === w.o1BC);
  if (G.g_evt_step_index !== w.o1BA) {
    w.o1BB += 1;
    if (w.o1BB > TYPE8_STEP_LIMIT) {
      ActorDespawnProp(p);
      return;
    }
    w.o1BA = G.g_evt_step_index;
  }

  if ((p.flags & BreakableFlag.Hit) !== 0) {
    BreakablePropAwardHit(p.flags, true, rng);
    p.flags &= ~BreakableFlag.Hit;
    events?.emit("sound.play", { id: SFX_PROP_CRACK });
    // `SpawnPropHitEffectAtDepth(obj+0x78, obj+0x48, player, 1.0)` -- `SpawnPropHitEffectScaled`'s
    // body with the depth and the world `z` passed in -- the crosshair
    // unprojected to the part's own depth, `z` its world `+0x48`.
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.hitPos.z,
                               TYPE8_PART_HIT_EFFECT_SCALE);
    }
    w.o1B9 = 1;
  }
  if (w.o1B9 === 1) {
    // `FLD; FSUB; FST [+0x1A4]; FADD [+0x198]; FSTP`: the sum takes the
    // unrounded velocity.
    const vy = w.o1A4 - TYPE8_PART_GRAVITY;
    w.o1B4 += TYPE8_PART_FALL_TURN;
    w.o1A4 = Math.fround(vy);
    w.o198 = Math.fround(vy + w.o198);
  }

  // `MatrixStackSetTopFromArray(view-to-world); MatrixMultiply(parent+0x2E4)`
  // -- the view cancels, and what is left is the parent's world matrix, which
  // is what the port recorded. See the file comment.
  const m = PropMatrixPush();
  const pm = parent && parent.drawMatrix.length === 16
    ? parent.drawMatrix : ZERO_MATRIX;
  MatrixMultiply(m, pm);
  MatrixTranslate(m, w.o194, w.o198, w.o19C);
  MatrixRotateZ(m, w.o1B4);
  MatrixRotateY(m, w.o1B0);
  MatrixRotateX(m, w.o1AC);
  const at = vec3();
  MatrixGetTranslation(m, at);
  p.hitPos = {
    x: Math.fround(at.x), y: Math.fround(at.y), z: Math.fround(at.z),
  };
  const local = m.slice(0, 16);

  const draw = PropMatrixPush();
  MatrixMultiply(draw, local);
  PropDrawSlot(p, draw, TYPE8_PART_SLOT);

  if (p.hitPos.y < TYPE8_PART_SPLASH_Y) {
    SpawnPropSplash(p.hitPos.x, p.hitPos.y, p.hitPos.z);
    events?.emit("sound.play", { id: SFX_TYPE8_PART_SPLASH });
    ActorKillProp(p);
    return;
  }
  PropRegisterForShotTest(p, p.hitPos.x, p.hitPos.y, p.hitPos.z);
}

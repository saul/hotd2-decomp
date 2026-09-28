/**
 * Class 0x41 type 67 — Training's three `komono_boat.bin` models on object
 * paths, each carrying three shootable things.
 *
 * ## Where it is placed
 *
 * **No stage bundle has one.** Three shipped spawns, all in `trnevtbl.bin`
 * (scene 6, the Training scene, which no bundle is exported for): block 5
 * program 1 op 15, one `spawn_placed` naming the descriptors at evt offsets
 * `0x20D4`, `0x20FC` and `0x2124`. All three are placed at the origin with no
 * angles and `+0x11C == 0`, and their `desc+0x24` bytes — the placer's
 * `+0x1F4`, the bundle's `field_1f4` — are **0, 1 and 2**: one of each index
 * this type has. `[proved]` by `tools/hod2lib/evt.py` over every scene's evt
 * file. Op 15 runs after `wait_script_flag 0xF1` in that program. Which
 * lesson block 5 is, is `[open]`.
 *
 * ## What it is
 *
 * The object is `komono_boat.bin[1]` (`0x1A36`), or `komono_boat.bin[0]`
 * (`0x1A35`) for index 2, drawn at two and a half times its size, riding
 * `op_train.bin`'s object path `0x196 + index` one frame a tick and rocking
 * on it. That a *boat* is what the model shows is `[likely]` from the file's
 * own name and the rocking, and nothing in the code says so.
 *
 * Its three **cargo** objects are separate 0x378 objects, allocated by the
 * arm, which draw in the boat's frame (see {@link Type67MountedPartUpdate}): a
 * Training **target** — `komono_2.bin[41]` (`0x1A0F`), one shot, the same
 * model `PlaceBreakableGroup` gives the members `g_training_lesson` turns into
 * one-shot targets — or a **crate**, `komono_2.bin[2]` (`0x19E8`), which
 * cracks to `komono_2.bin[0]` (`0x19E6`) on the first shot and bursts on the
 * second. Which of the three are crates depends on the index and on
 * `g_training_lesson`; see {@link Type67CargoIsCrate}.
 *
 * ## The arm, `0x0046252A`..`0x00462714`
 *
 * Reached through `g_place_generic_prop_arm_index` byte `0x3D` = 0x20 and
 * `g_place_generic_prop_arms[0x20]`; no other type reaches it. `EBX` is the
 * prologue's zero (`XOR EBX,EBX` at `0x00461D73`) and is the loop counter.
 * It returns out of `PlaceGenericProp` with its own `POP`s and `RET`.
 *
 * ```
 * 0046252a  obj+0x298 = rand() % 0x10000      ; three draws, in this order
 * 00462543  obj+0x1D8 = rand() % 0x10000
 * 0046255c  obj+0x1E0 = rand() % 0x10000
 * 00462575  n = (s16)placer+0x1F4
 * 0046257f  obj+0x1D0 = 0xC000
 * 0046258d  obj+0x290 = n
 * 00462594  obj+0x28C = 0x1A36;  if (n == 2) obj+0x28C = 0x1A35
 * 004625ab  table_7DCD08[n] = obj
 * 004625b2  if (placer+0x1F4 == 0) obj+0x1D0 = 0x4000
 * for (i = 0; i < 3; i++) {
 *   004625cf  c = ActorAlloc(0x004702E0, 0x378);  ActorClearGameFields(c)
 *   004625e5  c+0x196 = (u8)g_evt_step_index;  c+0x290 = obj+0x290
 *   00462605  c+0x19C/1A0/1A4 = (s8)offsets_595780[3n + i][0..2] * 0.25
 *   0046266a  c+0x11C = 1;  c+0x124 = 5.0;  c+0x324 = 6;  c+0x328 = 0x1D9
 *   00462695  c+0x28C = 0x1A0F;  c+0x34 = 1
 *   004626aa  obj+0x34 |= 0x80000000             ; every pass; already set
 *   004626b0  if (crate(i, n, (s8)g_training_lesson))
 *   004626ea      { c+0x324 = 0;  c+0x11C = 2;  c+0x28C = 0x19E8; }
 * }
 * ```
 *
 * ## The routine, `0x00470080`..`0x004702D7`
 *
 * Ghidra's pseudocode stops at the first `MatrixStackPop` it has marked
 * no-return, so the draw below `0x00470204` is read from the listing (L35):
 *
 * ```
 * 00470088  if ((s16)g_evt_step_index != (s8)obj+0x196)
 *               { ++(s8)obj+0x197; ActorKill(); }        // no lifetime test
 * 004700cf  CamEvalObjectPath6(paths_595778[(s16)obj+0x290], obj+0x2C0, &at)
 *           obj+0x19C/1A0/1A4 = at.x/y/z;  obj+0x2C0 += 1.0
 * 004700f4  obj+0x298 += 0x180;  obj+0x1D8 += 0x100;  obj+0x1E0 += 0x100
 *           sx = sin(obj+0x298) * 0.15;  sz = cos(obj+0x298) * 0.15
 * 0047017e  obj+0x1CC = ftol(sin(obj+0x1D8) * 640.0)
 * 0047019b  obj+0x1D4 = ftol(cos(obj+0x1E0) * 640.0)
 * 004701a8  Push; LoadIdentity; RotY(+0x1D0); RotZ(+0x1D4); RotX(+0x1CC)
 * 004701f8      out = TransformPoint((sx, 0, sz));  Pop
 * 00470206  Push; Translate(x + sx, y, z + sz); RotY; RotZ; RotX
 * 00470279      Translate(-out.x, -out.y, -out.z); Scale(2.5); NoOpStub(2.5)
 * 004702a4      AssetDrawSlot((s16)obj+0x28C); Scale(0.4)
 * 004702c4      MatrixStore(obj+0x2E4);  Pop
 * ```
 *
 * No hit arm, no `AND` on `obj+0x34`, and no `RegisterForShotTest`: the boat
 * itself cannot be shot, and its arm gives it no radius. `[proved]`
 *
 * **The lifetime is any step change at all**: the count is incremented and
 * `ActorKill` called with no comparison between them (`0x004700A1`'s
 * `MOV AL,CL` is loaded and never tested). So the boat and its cargo last
 * exactly as long as the step they were placed in. No scene-1 sweep either.
 *
 * Every float constant was read out of the image (`L1`): `1.0` at
 * `0x004C4380` (`0x3F800000`), `0.15` at `0x004C4D08` (`0x3E19999A`),
 * `640.0` at `0x00569138` (double `0x4084000000000000`), 2π/65536 at
 * `0x004C4370` (double `0x3F1921FB54442D18`), and the two `PUSH imm32`s
 * `0x40200000` (2.5) and `0x3ECCCCCD` (0.4).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { PropEvalObjectPath6 } from "./object_path";
import {
  MatIdentity, MatrixGetTranslation, MatrixLoadIdentity, MatrixMultiply,
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
  MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { SpawnPropHitSpark } from "../effects/sprite";
import { vec3 } from "../vec";
import { MsvcRand } from "./group";
import {
  ActorDespawnProp, ActorKillProp, BreakablePropAwardHit, SFX_PROP_BREAK,
} from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import {
  BreakableFlag, makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";
import {
  BreakablePropSpawnShatter, SHATTER_NO_FLOOR_GROUP, type ShatterCamera,
} from "./shatter";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";

/**
 * The words `PropUpdateType67` keeps that no shared field carries.
 *
 * `+0x1D8` and `+0x1E0` are {@link BreakableProp.spin} and
 * {@link BreakableProp.rollSpin} by offset, but to this routine they are the
 * **phases** of the pitch and roll rocking, not rates; and `+0x2C0`
 * ({@link BreakableProp.shake}) is the object-path frame cursor.
 */
export interface Type67Words {
  /** `obj+0x290` — the index, `(s16)placer+0x1F4`: which path, which slot
   *  of the parent table, which three cargo offsets. */
  o290: number;
  /** `obj+0x298` — the sway phase, BAMS, `rand()`-seeded, `+0x180` a tick. */
  o298: number;
}
const TYPE67_WORDS_ZERO: Type67Words = { o290: 0, o298: 0 };

/** The words {@link Type67MountedPartUpdate} keeps. */
export interface Type67CargoWords {
  /** `obj+0x290` — its boat's index, copied from the boat's `+0x290`. */
  o290: number;
}
const TYPE67_CARGO_WORDS_ZERO: Type67CargoWords = { o290: 0 };

/**
 * The s16 table at `0x00595778`, indexed by `obj+0x290`: the `op_` object path
 * each boat rides. `op_train.bin`'s three. The word after them is `0` and is
 * followed at once by the cargo offsets, so three entries is all the table
 * has room for (`L6`); an index past 2 is not reachable from the shipped
 * data.
 */
export const TYPE67_OBJECT_PATHS: readonly number[] = [0x196, 0x197, 0x198];

/**
 * The s8 table at `0x00595780`, `[3 * index + i]` for cargo `i` of boat
 * `index`: its position in the boat's frame, in quarter units. Twenty-seven
 * bytes and a zero pad. `[proved]` by `read_memory`.
 */
export const TYPE67_CARGO_OFFSETS: readonly (readonly number[])[] = [
  [-11, 32, 40], [14, 32, 21], [-5, 32, -4],       // index 0
  [1, 32, 47], [14, 32, 7], [-12, 32, 4],          // index 1
  [7, 44, 17], [-3, 44, -30], [-8, 50, -68],       // index 2
];
/** `FMUL [0x004C4C58]`, `0x3E800000` — the offsets are quarters. */
export const TYPE67_CARGO_OFFSET_SCALE = 0.25;

/** `0x1A36` — `komono_boat.bin[1]`; the arm's slot. */
export const TYPE67_SLOT = 0x1a36;
/** `0x1A35` — `komono_boat.bin[0]`, which index 2 draws instead. */
export const TYPE67_SLOT_INDEX2 = 0x1a35;
/** `MOV [ESI+0x1D0], 0xC000` — the boat's yaw, and index 0's `0x4000`. */
export const TYPE67_YAW = 0xc000;
export const TYPE67_YAW_INDEX0 = 0x4000;

/** `FADD [0x004C4380]` — the path frame's step, a float. */
export const TYPE67_PATH_STEP = 1.0;
/** `ADD EAX, 0x180` — the sway phase's step, BAMS a tick. */
export const TYPE67_SWAY_STEP = 0x180;
/** `MOV EAX, 0x100` — both rocking phases' step. */
export const TYPE67_ROCK_STEP = 0x100;
/** `FMUL float [0x004C4D08]`, `0x3E19999A` — the sway circle's radius. */
export const TYPE67_SWAY = Math.fround(0.15);
/** `FMUL double [0x00569138]` — the rocking amplitude, BAMS (about 3.5°). */
export const TYPE67_ROCK = 640.0;
/** `PUSH 0x40200000` x3 — the draw's scale. */
export const TYPE67_DRAW_SCALE = 2.5;
/**
 * `PUSH 0x3ECCCCCD` x3 — scaled again after the draw and before
 * `MatrixStore`, so the matrix the cargo rides is the boat's at unit scale.
 */
export const TYPE67_STORE_SCALE = Math.fround(0.4);

/** `CMP EBX, 0x3` — three cargo objects a boat. */
export const TYPE67_CARGO_COUNT = 3;
/** `0x1A0F` — `komono_2.bin[41]`, the Training target. One shot. */
export const TYPE67_CARGO_TARGET_SLOT = 0x1a0f;
/** `0x19E8` — `komono_2.bin[2]`, the crate. Two shots. */
export const TYPE67_CARGO_CRATE_SLOT = 0x19e8;
/** `0x19E6` — `komono_2.bin[0]`, the crate once cracked. */
export const TYPE67_CARGO_CRACKED_SLOT = 0x19e6;
/** `MOV [EDI+0x124], 0x40A00000` — the cargo's shot radius, 5.0. */
export const TYPE67_CARGO_RADIUS = 5.0;
/**
 * `obj+0x324` = 6 for a target and 0 for a crate. The cargo never draws an
 * effect: the one reader is `BreakablePropSpawnShatter`'s `obj+0x36`, which
 * picks the fragment slot table — `_b` for a target, `_a` for a crate.
 */
export const TYPE67_CARGO_EFFECT = 6;
/** `obj+0x328` = `0x1D9`. Nothing in either routine reads it back. */
export const TYPE67_CARGO_EFFECT_VARIANT = 0x1d9;
/** `FADD [0x0055D2B4]`, `0x40A00000` — the sphere sits 5.0 above the piece. */
export const TYPE67_CARGO_SHOT_RISE = 5.0;
/** `ADD EDX, 0x8000` — a cracked crate turns half round from its boat. */
export const TYPE67_CARGO_CRACK_TURN = 0x8000;
/**
 * `PlaySoundId(0x1A16A9)` — the crack and the burst alike; the same id the
 * group props break with.
 */
export const SFX_TYPE67_CARGO_HIT = SFX_PROP_BREAK;

/** `(s16)` — the engine's word reads. */
function S16(v: number): number { return (v << 16) >> 16; }
/** `(s8)` — the engine's byte reads. */
function S8(v: number): number { return (v << 24) >> 24; }

/**
 * `PlaceGenericProp` case 0x43's arm: the boat's three phases, its index,
 * slot and yaw, its entry in the parent table, and its three cargo objects.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x0046252A`
 * of `PlaceGenericProp`'s switch.
 *
 * **The cargo is appended to `G.g_breakable_props` here, before the caller
 * appends the boat**, where the engine's `ActorAlloc` order is the boat first
 * (at `PlaceGenericProp`'s head) and its cargo after. The cargo reads the
 * matrix the boat stored *this* frame, so the pool must run the boat first:
 * the caller has to insert the boat ahead of whatever its arm appended.
 */
export function PlaceGenericPropType67(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  const w = PropWords(p, TYPE67_WORDS_ZERO);
  // `AND EAX, 0x8000FFFF` and MSVC's sign fixup: `rand() % 0x10000`, which
  // for a 15-bit `rand()` is the draw itself.
  w.o298 = MsvcRand(rng) % 0x10000;
  p.spin = MsvcRand(rng) % 0x10000;
  p.rollSpin = MsvcRand(rng) % 0x10000;
  // `MOV DX, word ptr [EBP+0x1F4]`: the placer's s8 at `desc+0x24`, widened.
  const n = S16(pl.field_1f4 ?? 0);
  p.yaw = TYPE67_YAW;
  w.o290 = n;
  p.slot = TYPE67_SLOT;
  if (n === 2) p.slot = TYPE67_SLOT_INDEX2;
  // `MOV [EAX*4 + 0x7DCD08], ESI`. The port keeps prop ids, not pointers.
  G.g_prop67_by_index[n] = p.id;
  if (n === 0) p.yaw = TYPE67_YAW_INDEX0;

  for (let i = 0; i < TYPE67_CARGO_COUNT; i++) {
    const c = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
    // `ActorClearGameFields`: everything from `+0x34` is zero, including the
    // words `makeBreakableProp` seeds to -1 for the families that read them.
    c.storyItem = 0;
    c.removeFlag = 0;
    c.key0 = c.key1 = c.key2 = c.key3 = 0;
    c.family = PropFamily.Type67Piece;
    // `MOV CL, byte ptr [g_evt_step_index]; MOV [EDI+0x196], CL`.
    c.lastStepIndex = G.g_evt_step_index;
    const cw = PropWords(c, TYPE67_CARGO_WORDS_ZERO);
    cw.o290 = w.o290;
    // [diverges] Past index 2 the engine reads the table's zero pad and
    // then whatever `.rdata` holds after it; the port reads zeros. No
    // shipped spawn has an index past 2 (see `TYPE67_OBJECT_PATHS`).
    const off = TYPE67_CARGO_OFFSETS[3 * n + i] ?? [0, 0, 0];
    c.x = off[0] * TYPE67_CARGO_OFFSET_SCALE;
    c.y = off[1] * TYPE67_CARGO_OFFSET_SCALE;
    c.z = off[2] * TYPE67_CARGO_OFFSET_SCALE;
    c.hp = 1;
    c.hitRadius = TYPE67_CARGO_RADIUS;
    c.effect = TYPE67_CARGO_EFFECT;
    c.effectVariant = TYPE67_CARGO_EFFECT_VARIANT;
    c.slot = TYPE67_CARGO_TARGET_SLOT;
    c.flags = BreakableFlag.Live;
    p.flags |= 0x80000000;
    if (Type67CargoIsCrate(i, S16(pl.field_1f4 ?? 0))) {
      c.effect = 0;
      c.hp = 2;
      c.slot = TYPE67_CARGO_CRATE_SLOT;
    }
    G.g_breakable_props.push(c);
  }
}

/**
 * Whether cargo `i` of boat `n` is a crate rather than a target: the branch
 * nest at `0x004626B0`..`0x004626E8`.
 *
 * ```
 * 004626b0  CMP EBX, EAX (1)        ; JZ crate
 * 004626b7  CL = (s8)g_training_lesson
 *           CMP CL, 1 ; JNZ 004626da
 * 004626c1      CX = word placer+0x1F4   ; re-read from the placer
 *               if (CX == 1 && EBX == 2) crate;  if (CX == 2) crate;  next
 * 004626da  CMP CL, 2 ; JNZ 004626e5 ;  if (EBX == 0) crate;  next
 * 004626e5  CMP CL, 3 ; JL next     ; signed: lesson >= 3 is all crates
 * ```
 *
 * So the middle one is always a crate; lesson 1 makes all of boat 2's and
 * boat 1's third crates; lesson 2 makes each boat's first a crate; lesson 3
 * and up make every one a crate; and lesson 0 leaves only the middle ones.
 *
 * `[port-only]` as a *function*.
 */
export function Type67CargoIsCrate(i: number, n: number): boolean {
  if (i === 1) return true;
  const lesson = S8(G.g_training_lesson);
  if (lesson === 1) return (n === 1 && i === 2) || n === 2;
  if (lesson === 2) return i === 0;
  return lesson >= 3;
}

/**
 * `PropUpdateType67` — `FUN_00470080`.
 *
 * `CamEvalObjectPath6` (`FUN_004042D0`) is `PropEvalObjectPath6`
 * (`class41/object_path.ts`), on the stage's own object paths. A bundle with
 * no such path leaves the boat where it is, the port's convention for a
 * missing path (`PropSeatOnObjectPath` in `class13/`); the frame cursor steps
 * regardless, as the engine's does.
 *
 * The matrix it stores in {@link BreakableProp.drawMatrix} (`obj+0x2E4`) is
 * the one its cargo draws on top of. World space here, as every recorded
 * matrix is; the engine's has the camera's world-to-view under it, which the
 * cargo takes back off (see {@link Type67MountedPartUpdate}).
 */
export function PropUpdateType67(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  void rng; void events;
  PropDrawBegin(p);
  const w = PropWords(p, TYPE67_WORDS_ZERO);
  if (S16(G.g_evt_step_index) !== S8(p.lastStepIndex)) {
    p.stepsElapsed = S8(p.stepsElapsed + 1);
    ActorKillProp(p);
    return;
  }

  // `PUSH [ESI+0x2C0]`: the frame as it was, and the step after the call.
  // [diverges] Past index 3 the engine reads the cargo offsets as a path
  // number (index 3 is the zero word, which the port's 0 matches); the port
  // reads 0. No shipped spawn has an index past 2.
  const at = PropEvalObjectPath6(TYPE67_OBJECT_PATHS[w.o290] ?? 0, p.shake);
  if (at) {
    p.y = Math.fround(at.y);
    p.x = Math.fround(at.x);
    p.z = Math.fround(at.z);
  }
  p.shake = Math.fround(p.shake + TYPE67_PATH_STEP);

  const sway = (w.o298 + TYPE67_SWAY_STEP) | 0;
  w.o298 = sway;
  const rock = (p.spin + TYPE67_ROCK_STEP) | 0;
  p.spin = rock;
  const roll = (p.rollSpin + TYPE67_ROCK_STEP) | 0;
  p.rollSpin = roll;
  // `FILD; FMUL double [0x004C4370]; FLD ST0; FSIN` -- the product stays on
  // the FPU, so the double constant; each result is stored as a float.
  const a = sway * BAMS_TO_RAD_F64;
  const sx = Math.fround(Math.sin(a) * TYPE67_SWAY);
  const sz = Math.fround(Math.cos(a) * TYPE67_SWAY);
  // `__ftol` (`0x004ACF50`) truncates toward zero into a dword.
  p.pitch = Math.trunc(Math.sin(rock * BAMS_TO_RAD_F64) * TYPE67_ROCK);
  p.roll = Math.trunc(Math.cos(roll * BAMS_TO_RAD_F64) * TYPE67_ROCK);

  // The sway offset turned by the boat's own rotation, under the identity.
  const r = PropMatrixPush();
  MatrixLoadIdentity(r);
  MatrixRotateY(r, p.yaw);
  MatrixRotateZ(r, p.roll);
  MatrixRotateX(r, p.pitch);
  const out = vec3();
  MatrixTransformPoint(r, vec3(sx, 0, sz), out);
  out.x = Math.fround(out.x);
  out.y = Math.fround(out.y);
  out.z = Math.fround(out.z);

  const m = PropMatrixPush();
  MatrixTranslate(m, Math.fround(sx + p.x), p.y, Math.fround(sz + p.z));
  MatrixRotateY(m, p.yaw);
  MatrixRotateZ(m, p.roll);
  MatrixRotateX(m, p.pitch);
  MatrixTranslate(m, -out.x, -out.y, -out.z);
  MatrixScale(m, TYPE67_DRAW_SCALE, TYPE67_DRAW_SCALE, TYPE67_DRAW_SCALE);
  // `NoOpStub(2.5)` (`FUN_0041EBB0`) — a bare `RET`.
  PropDrawSlot(p, m, p.slot);
  MatrixScale(m, TYPE67_STORE_SCALE, TYPE67_STORE_SCALE, TYPE67_STORE_SCALE);
  p.drawMatrix = m.slice(0, 16);
}

/**
 * `Type67MountedPartUpdate` — `FUN_004702E0` (to `0x004704FB`): one of
 * {@link PropUpdateType67}'s three objects, each drawn on its parent's stored
 * matrix as `Type8MountedPartUpdate` (`FUN_00467290`) draws type 8's.
 *
 * ```
 * 004702ff  boat = table_7DCD08[(s16)obj+0x290]    ; read first, used after
 * 004702f8  if ((s16)g_evt_step_index != (s8)obj+0x196)
 *               { ++(s8)obj+0x197; ActorKill(); }
 * 00470326  if (obj+0x34 & 8) {
 * 00470335      SpawnPropHitSpark(obj, (obj+0x34 & 2) ? 0 : 1);
 * 00470344      if ((s16)obj+0x11C == 1) {                 // 0x004704CB
 *                   obj+0x194 = 0x63;  PlaySoundId(0x1A16A9);
 *                   BreakablePropSpawnShatter(obj);
 *                   BreakablePropAwardHit(obj+0x34, 0);  ActorDespawn(obj);
 *               }
 * 0047034b      if ((s16)obj+0x11C == 2) {
 *                   obj+0x34 &= ~8;  PlaySoundId(0x1A16A9);  obj+0x11C--;
 *                   obj+0x28C = 0x19E6;  obj+0x1D0 = boat+0x1D0 + 0x8000;
 *               }
 *           }
 * 00470386  obj+0x34 &= ~6
 *           Push; SetTopFromArray(g_camera_blocks[g_camera_index]);
 * 004703bf      Multiply(boat+0x2E4); Translate(+0x19C..); RotZ; RotY; RotX
 * 00470407      obj+0x40 = GetTranslation();  MatrixStore(local);  Pop
 * 00470434  Push; Multiply(local); NoOpStub(1.0);
 * 00470455      AssetDrawSlot((s16)obj+0x28C);  MatrixStore(obj+0x2E4);  Pop
 * 00470479  if (obj+0x32C == 0) {
 *               obj+0x70 = TransformPoint(obj+0x40 + (0, 5.0, 0));
 * 004704bd      RegisterForShotTest(obj);
 *           }
 * ```
 *
 * The decompile ends each hit arm at its `PlaySoundId`, which is marked
 * no-return; everything after them is from the listing (`L37`).
 *
 * **`g_camera_blocks` (`0x009A6040`) is the view-to-world** and the boat's
 * `obj+0x2E4` is its model on top of the world-to-view, so the first matrix
 * is the boat's model in world space: the two views are the same frame's and
 * cancel. That is why `obj+0x40` is a world point here where it is a view
 * point in most classes, and why the port, whose recorded matrices carry no
 * view, starts from the identity and multiplies the boat's
 * {@link BreakableProp.drawMatrix} straight on. The sphere is then put back
 * through the view, which the port leaves off (`class41/shot_test.ts`).
 *
 * * `SpawnPropHitSpark` (`FUN_00465860`) is called here, where the routine
 *   calls it, at the point the shot was aimed (`combat/shot.ts` leaves that on
 *   the prop) with `z` the object's own `obj+0x1A4` — which for a cargo
 *   object is its offset on the boat, exactly as the engine reads it. The
 *   stand-in spark in `combat/shot.ts` stays off every prop whose routine
 *   records its own draws.
 * * The hit bit `8` is cleared only by the crack. A hit on a piece whose
 *   `+0x11C` is neither 1 nor 2 keeps it, and would spark every frame; the
 *   arm only ever writes 1 or 2 and the crack takes 2 to 1, so that is not
 *   reachable.
 * * `obj+0x194 = 0x63` is {@link SHATTER_NO_FLOOR_GROUP}: the burst's pieces
 *   never land.
 * * `obj+0x32C` is never written for a cargo object, so it always registers.
 *
 * `cam` is the pool's camera pair, for the burst: the shatter takes the view
 * the piece was last drawn under back off with the one on the stack now.
 */
export function Type67MountedPartUpdate(p: BreakableProp, rng: Rng,
                                      events?: Events,
                                      cam?: ShatterCamera | null): void {
  PropDrawBegin(p);
  const w = PropWords(p, TYPE67_CARGO_WORDS_ZERO);
  const boat = Type67Boat(w.o290);
  if (S16(G.g_evt_step_index) !== S8(p.lastStepIndex)) {
    p.stepsElapsed = S8(p.stepsElapsed + 1);
    ActorKillProp(p);
    return;
  }

  if ((p.flags & BreakableFlag.Hit) !== 0) {
    if (p.hitAim) SpawnPropHitSpark(p.hitAim.x, p.hitAim.y, p.z);
    const shots = S16(p.hp);
    if (shots === 1) {
      p.group = SHATTER_NO_FLOOR_GROUP;
      events?.emit("sound.play", { id: SFX_TYPE67_CARGO_HIT });
      BreakablePropSpawnShatter(p, rng, cam ?? null, events);
      BreakablePropAwardHit(p.flags, false, rng);
      ActorDespawnProp(p);
      return;
    }
    if (shots === 2) {
      p.flags &= ~BreakableFlag.Hit;
      events?.emit("sound.play", { id: SFX_TYPE67_CARGO_HIT });
      p.hp = S16(p.hp - 1);
      p.slot = TYPE67_CARGO_CRACKED_SLOT;
      p.yaw = ((boat?.yaw ?? 0) + TYPE67_CARGO_CRACK_TURN) | 0;
    }
  }
  // `AND EDX, 0xFFFFFFF9` -- the two player bits only, not bit 3.
  p.flags &= ~(BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1);

  // `MatrixStackSetTopFromArray(g_camera_blocks + g_camera_index * 0x1A4)`,
  // the view-to-world, is the identity here: see above.
  const m = PropMatrixPush();
  MatrixMultiply(m, boat && boat.drawMatrix.length === 16
    ? boat.drawMatrix : MatIdentity());
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateZ(m, p.roll);
  MatrixRotateY(m, p.yaw);
  MatrixRotateX(m, p.pitch);
  const at = vec3();
  MatrixGetTranslation(m, at);
  p.hitPos.x = Math.fround(at.x);
  p.hitPos.y = Math.fround(at.y);
  p.hitPos.z = Math.fround(at.z);
  const local = m.slice(0, 16);

  // `MatrixStackPush(0)` duplicates the view the pool started from.
  const d = PropMatrixPush();
  MatrixMultiply(d, local);
  // `NoOpStub(1.0)` (`FUN_0041EBB0`) — a bare `RET`.
  PropDrawSlot(p, d, p.slot);
  p.drawMatrix = d.slice(0, 16);
  p.drawView = cam ? cam.w2v.slice(0, 16) : [];

  if (p.effectFrames === 0) {
    PropRegisterForShotTest(p, p.hitPos.x,
                            Math.fround(p.hitPos.y + TYPE67_CARGO_SHOT_RISE),
                            p.hitPos.z);
  }
}

/**
 * `table_7DCD08[n]` as a prop: the boat the arm last placed with index `n`.
 *
 * `[port-only]` The engine holds a pointer and dereferences it whatever it
 * points at. A boat and its cargo die on the same step change, the boat
 * first in the walk, and the cargo reaches its own step test before it uses
 * the pointer — so a cargo object never draws with its boat gone, and the
 * `undefined` this can return is a port-only case the callers answer with the
 * identity and a zero yaw.
 */
function Type67Boat(n: number): BreakableProp | undefined {
  const id = G.g_prop67_by_index[n];
  if (!id) return undefined;
  return G.g_breakable_props.find((q) => q.id === id);
}

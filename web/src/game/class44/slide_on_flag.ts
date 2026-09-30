/**
 * Class 0x44 selector 12 — an object that slides a set distance along a fixed
 * heading when a script flag is raised.
 *
 * Eight spawns in the game, all in stage 6 and all in pairs that slide apart:
 *
 * * `0x0B00`/`0x0B48`, slots `0x189B`/`0x189D` (`st5_02b.bin[0]`/`[2]`), at
 *   `(560, -51.3, -9158.6)` and `(600, ...)`, speeds `-1` and `+1`, 21 units,
 *   flag 5 -- and the only two with a collision blob;
 * * `0x0B90`/`0x0BD8`, slots `0x18C2`/`0x18C3`, the same pair 187 units on;
 * * `0x0C20`/`0x0C68` and `0x1838`/`0x1880`, slots `0xAFC`/`0xAFD`, 6 units
 *   each way on flags 3 and 4 -- the elevator car's own doors, which is why
 *   the constructor moves them (below).
 *
 * `[likely]` sliding doors, on the models (two 20-by-40 leaves hinged at
 * opposite edges) and the pairs that part.
 *
 * ## The two routines `[proved]`
 *
 * The constructor at `0x004734A0`, from its disassembly:
 *
 * ```c
 * obj = ActorAlloc(SlideOnFlagUpdate, 0x378); ActorClearGameFields(obj);
 * obj->+0x19C..0x1A4 = desc->+0x40..0x48;
 * obj->+0x1D0 = obj->+0x68 = 0;  obj->+0x34 |= 0x51;
 * obj->+0x28C = (u16)tail->+0x04;  obj->+0x14C = tail->+0x08;
 * obj->+0x1C0 = sin(PI/2) * (int)tail->+0x10;     // f32
 * obj->+0x1C8 = cos(PI/2) * (int)tail->+0x10;     // f32
 * obj->+0x1A8 = (float)(int)tail->+0x14;          // the slide length
 * obj->+0x2A0 = (s8)tail->+0x20;  obj->+0x2A4 = (s8)tail->+0x21;
 * obj->+0x2A8 = 0;
 * if ((u32)tail->+0x04 is 0xAFC, 0xAFD, 0xAFE or 0xAFF) {
 *     Push(0); LoadIdentity();
 *     Translate(557.5, g_evt_block_index == 0 ? -57.8 : 2492.2, -9880.2);
 *     RotY(0x7555);
 *     Translate(obj->+0x19C, obj->+0x1A0, obj->+0x1A4);
 *     MatrixGetTranslation(&obj->+0x19C);  Pop(1);
 *     obj->+0x68 = obj->+0x1D0 = 0x7555;
 *     obj->+0x1C0 = sin(B) * (int)tail->+0x10;  obj->+0x1C8 = cos(B) * ...;
 * }
 * ```
 *
 * where `PI/2` is the double at `0x00564410` and `B` the double at
 * `0x00569168`, `0x7555` in radians plus a quarter turn. So the elevator
 * doors' descriptors are in the **car's** frame, and the constructor puts
 * them where `FUN_0048F560` parks the car on paths `0xDC`/`0xEC` -- at the
 * bottom of the shaft in block 0, at the top in any other. The slide is the
 * car's own x axis.
 *
 * `SlideOnFlagUpdate` (`FUN_004755B0`):
 *
 * ```c
 * if (g_script_flags[obj->+0x2A4] == 1) {
 *     if (obj->+0x14C != -1) { ActorDespawn(obj); return; }
 *     ActorKill(); return;
 * }
 * if (g_active_cam_path == 0xDD && g_cam_path_frame == 0x35C) { ActorKill(); return; }
 * if (g_script_flags[obj->+0x2A0] == 1) {
 *     d = sqrt(vz*vz + vx*vx) + obj->+0x2C0;  obj->+0x2C0 = (float)d;
 *     if (d < 0) d = -d;
 *     if (d < obj->+0x1A8) { obj->+0x19C += vx; obj->+0x1A4 += vz; }
 * }
 * if (slot record +9 & 0x80 && obj->+0x2A8 == 0) { ...patch the model...; obj->+0x2A8 = 1; }
 * SetDrawLayerNibble(9);
 * Push; Translate(x, y, z); RotY(obj->+0x1D0); AssetDrawSlot(slot); MatrixStore(obj->+0x150);
 * if (slot == 0x189C) { ...a second draw, below... }
 * Pop; SetDrawLayerNibble(8);
 * if (obj->+0x14C != -1) RegisterForShotTest(obj);
 * ```
 *
 * **The distance is summed before it is tested**, and the test reads the
 * FPU's wide sum rather than the `f32` it just stored, so a door moves on
 * every frame whose running total, this frame's step included, is still
 * short of the length: a 21-unit door at one unit a frame moves 20 times.
 *
 * ## What the port does not carry
 *
 * * **The model patch.** Once the slot is resident (`TEST byte ptr
 *   [slot*16 + 0x9A66AD], 0x80`) and `obj+0x2A8` is still 0, the routine walks
 *   the resident model's mesh chain and rewrites the first strip-control word
 *   after every mesh header to `(w & 0x3FFFFFFF) | 0x40000000`, then latches
 *   `obj+0x2A8`. `WalkMeshChainAndDraw` (`0x004A7EF0`) reads bits 0-8 and 31
 *   of that word and no instruction found reads bit 30, so what it changes is
 *   `[open]`. The port has no residency (every slot is resident from load), so
 *   the latch goes up on the first update, which the port keeps; the model
 *   bytes are the exporter's and the port writes none.
 * * **The collision blob.** `0x0B00` and `0x0B48` name one, so in the engine
 *   the two doors stop a bullet and take part in both collision passes. The
 *   port's prop pool has no mesh shot test (the story-mode switch is the
 *   other object waiting on one, `class41/shot_test.ts`); the registration
 *   is transcribed and files a sphere of radius 0, which nothing can hit.
 * * **`SetRenderLightColour(0, 0.01, 0.01)`** around the second draw. That
 *   arm is taken only for slot `0x189C`, which no selector-12 spawn names --
 *   `web/tools/checks/flag_props.ts` holds all eight to it -- so it is
 *   transcribed for its matrices and its `0x1730` and nothing else.
 */
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import {
  MatrixGetTranslation, MatrixRotateY, MatrixScale,
  MatrixTranslate,
} from "../matrix";
import { ActorDespawnProp, ActorKillProp } from "../class41/prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush }
  from "../class41/prop_draw";
import {
  BreakableState, makeBreakableProp, PropFamily, type BreakableProp,
} from "../class41/prop_state";
import { PropRegisterForShotTest } from "../class41/shot_test";
import { PropWords } from "../class41/words";
import { SLIDE_SECOND_DRAW_SLOT, SLIDE_SECOND_SLOT } from "./slide_slots";

/** `FLD double ptr [0x00564410]` — `PI/2`: the slide's heading, unturned. */
export const SLIDE_HEADING = 1.5707963267948966;
/**
 * `FLD double ptr [0x00569168]` — the heading of an elevator door: `0x7555`
 * BAMS in radians plus a quarter turn.
 */
export const SLIDE_HEADING_CAR = 4.450557634652459;

/** `CMP EAX, 0xAFC` .. `0xAFF` at `0x00473555`: the car's four door slots. */
export const SLIDE_CAR_SLOTS: readonly number[] = [0xafc, 0xafd, 0xafe, 0xaff];

/** `PUSH 0x440B6000` / `0xC61A60CD` — where the car parks, x and z. */
export const SLIDE_CAR_X = 557.5;
export const SLIDE_CAR_Z = Math.fround(-9880.2);
/** `PUSH 0xC2673333` with `g_evt_block_index == 0`, `0x451BC333` otherwise. */
export const SLIDE_CAR_Y_BLOCK0 = Math.fround(-57.8);
export const SLIDE_CAR_Y_OTHER = Math.fround(2492.2);
/** `MOV EBX, 0x7555` — the parked car's yaw, and so the doors'. */
export const SLIDE_CAR_YAW = 0x7555;

/** `CMP [0x009A2D78], 0xDD` and `CMP [0x009A6110], 0x35C` — the kill cue. */
export const SLIDE_KILL_PATH = 0xdd;
export const SLIDE_KILL_FRAME = 0x35c;

/** `PUSH 0x9` / `PUSH 0x8` around the draw — `SetDrawLayerNibble`. */
export const SLIDE_DRAW_LAYER = 9;


/** `obj+0x34 \|= 0x51`. */
const SLIDE_FLAGS = 0x51;

/** The words of the object this family keeps that no field carries. */
export interface SlideOnFlagWords {
  /** `obj+0x14C` — tail `+0x08`: a collision blob, or `-1`. */
  o14c: number;
  /** `obj+0x1A8` — tail `+0x14` as a float: how far the object slides. */
  o1a8: number;
  /** `obj+0x2C0` — how far it has slid, summed a step at a time. */
  o2c0: number;
  /** `obj+0x2A8` — the model patch's one-way latch. */
  o2a8: number;
}

/** `ActorClearGameFields` (`FUN_004A73D0`) leaves every one at zero. */
const SLIDE_WORDS: SlideOnFlagWords = { o14c: 0, o1a8: 0, o2c0: 0, o2a8: 0 };

/**
 * `PropBuildSlideOnFlag` — `FUN_004734A0`. `g_class44_subtypes[12]`.
 *
 * `speed` is the tail's `+0x10` as the `int` the `FIMUL`s read, and `words`
 * the tail's `+0x04` as the dword the car test compares.
 */
export function PropBuildSlideOnFlag(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  const w = PropWords(p, SLIDE_WORDS);
  p.family = PropFamily.SlideOnFlag;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  p.flags = SLIDE_FLAGS;
  p.x = Math.fround(pl.pos?.[0] ?? 0);
  p.y = Math.fround(pl.pos?.[1] ?? 0);
  p.z = Math.fround(pl.pos?.[2] ?? 0);
  // `obj+0x1D0` and `obj+0x68`, both written 0.
  p.yaw = 0;
  p.slot = pl.slot ?? 0;
  w.o14c = pl.coli ?? -1;
  const speed = pl.speed ?? 0;
  // `FSIN; FIMUL [EDI+0x10]; FSTP [ESI+0x1C0]` and the `FCOS` beside it.
  p.vx = Math.fround(Math.sin(SLIDE_HEADING) * speed);
  p.vz = Math.fround(Math.cos(SLIDE_HEADING) * speed);
  // `FILD [EDI+0x14]; FSTP [ESI+0x1A8]`.
  w.o1a8 = Math.fround(pl.travel ?? 0);
  p.storyItem = pl.open_flag ?? 0;
  p.removeFlag = pl.remove_flag ?? -1;
  w.o2a8 = 0;
  if (SLIDE_CAR_SLOTS.includes(pl.slot_word ?? pl.slot ?? 0)) {
    const m = PropMatrixPush();
    const y = G.g_evt_block_index === 0 ? SLIDE_CAR_Y_BLOCK0 : SLIDE_CAR_Y_OTHER;
    MatrixTranslate(m, SLIDE_CAR_X, y, SLIDE_CAR_Z);
    MatrixRotateY(m, SLIDE_CAR_YAW);
    MatrixTranslate(m, p.x, p.y, p.z);
    const at = { x: 0, y: 0, z: 0 };
    MatrixGetTranslation(m, at);
    p.x = Math.fround(at.x);
    p.y = Math.fround(at.y);
    p.z = Math.fround(at.z);
    p.yaw = SLIDE_CAR_YAW;
    p.vx = Math.fround(Math.sin(SLIDE_HEADING_CAR) * speed);
    p.vz = Math.fround(Math.cos(SLIDE_HEADING_CAR) * speed);
  }
  p.hitRadius = 0;
  return p;
}

/**
 * `SlideOnFlagUpdate` — `FUN_004755B0`. One object, one 60 Hz frame.
 *
 * Called by the pool directly: no lifetime prologue, and its own shot-test
 * call, behind `obj+0x14C`.
 */
export function SlideOnFlagUpdate(p: BreakableProp): void {
  const w = PropWords(p, SLIDE_WORDS);
  if (G.g_script_flags[p.removeFlag] === 1) {
    // `CMP [ESI+0x14C], -1; JZ` to the `ActorKill` at 0x004755F0.
    if (w.o14c === -1) ActorKillProp(p);
    else ActorDespawnProp(p);
    return;
  }
  if (G.g_active_cam_path === SLIDE_KILL_PATH
      && G.g_cam_path_frame === SLIDE_KILL_FRAME) {
    ActorKillProp(p);
    return;
  }
  if (G.g_script_flags[p.storyItem] === 1) {
    // `FSQRT; FADD [ESI+0x2C0]; FST [ESI+0x2C0]`, the wide sum kept on the
    // stack for the two compares that follow.
    let d = Math.sqrt(p.vz * p.vz + p.vx * p.vx) + w.o2c0;
    w.o2c0 = Math.fround(d);
    if (d < 0) d = -d;
    if (d < w.o1a8) {
      p.x = Math.fround(p.vx + p.x);
      p.z = Math.fround(p.vz + p.z);
    }
  }
  // The model patch -- see the file comment. Every slot is resident here.
  if (w.o2a8 === 0) w.o2a8 = 1;
  PropDrawBegin(p);
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, p.yaw);
  PropDrawSlot(p, m, p.slot, SLIDE_DRAW_LAYER);
  if (p.slot === SLIDE_SECOND_DRAW_SLOT) {
    // `PUSH 0xBED2CA58; PUSH 0x41DBFE5D; PUSH 0x4196F3EB` and
    // `PUSH 0x3F28F5C3; PUSH 0x3F800000; PUSH 0x3C11D14E`.
    MatrixTranslate(m, Math.fround(18.8691), Math.fround(27.4992),
                    Math.fround(-0.4117));
    MatrixScale(m, Math.fround(0.0089), 1.0, Math.fround(0.66));
    PropDrawSlot(p, m, SLIDE_SECOND_SLOT, SLIDE_DRAW_LAYER);
  }
  if (w.o14c !== -1) PropRegisterForShotTest(p, p.shotX, p.shotY, p.shotZ);
}

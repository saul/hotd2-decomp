/**
 * Class 0x44 selectors 3 and 7 — an animated effect tree played on a script
 * flag, **every node drawn as one slot**.
 *
 * Both hand their state block to an effect draw with a slot override
 * (`DAT_007C178C`): `EffectDrawWithCapture` (`FUN_0040DFD0`) for selector 3,
 * `EffectDrawWithSlot` (`FUN_0040E010`) for selector 7. `EffectDrawNode`
 * (`FUN_0040DE50`) then poses each node from the effect's motion as usual and
 * draws the override where it would have drawn the node's own model, so the
 * tree is a skeleton that moves one model about.
 *
 * * **Selector 3** — `PropBuildFlagSlotEffect` (`FUN_00472E00`), effect 0xB
 *   on motion 0x1D6, the slot a literal by scene: `0x17EE` in scene 0,
 *   `0x197C` in every other. Two spawns: stage 1's `0x3ACC` (block 4) and
 *   stage 2's `0xD400` (block 18). The draw translates by the descriptor's
 *   position, which the builder copies to `obj+0x40` -- not to the
 *   `+0x19C` its neighbours use.
 * * **Selector 7** — `PropBuildScaledSlotEffect` (`FUN_00473170`), effect 0xF
 *   on motion 0x1CA, the descriptor's own slot, under the hinges' pose and a
 *   descriptor scale. One spawn: stage 2's `0xBD38` (block 17, slot `0x1737`).
 *
 * ## The routines `[proved]`
 *
 * ```c
 * PropBuildFlagSlotEffect (0x00472E00):
 *   obj = ActorAlloc(FlagSlotEffectUpdate, 0x378); ActorClearGameFields(obj);
 *   obj->+0x34 |= 0x51;  obj->+0x324 = 0xB;  obj->+0x40..0x48 = desc->+0x40..0x48;
 *   obj->+0x2A0 = (s8)tail->+0x20;  obj->+0x2A4 = (s8)tail->+0x21;
 *   obj->+0x328 = 0x1D6;  obj->+0x32C = obj->+0x330 = 0;
 *   obj->+0x14C = tail->+0x08;  obj->+0x124 = 5.0f;
 *   obj->+0x28C = g_scene_index == 0 ? 0x17EE : 0x197C;
 *
 * FlagSlotEffectUpdate (0x00474120):
 *   if (g_script_flags[obj->+0x2A4] == 1) { obj->+0x14C != -1 ? ActorDespawn(obj) : ActorKill(); return; }
 *   if (g_script_flags[obj->+0x2A0] == 1 && obj->+0x32C < g_motion_play_length[obj->+0x328] - 2)
 *       obj->+0x32C++;
 *   if (obj->+0x32C is 0x41, 0x58, 100 or 0x6E) PlaySoundId(0x1116A9);
 *   if (g_motion_slots[0x1D6].state == 2) {                 // the word at 0x009A4694
 *       Push; Translate(obj->+0x40, +0x44, +0x48);
 *       EffectDrawWithCapture(obj + 0x324, 1, (s16)obj->+0x28C); Pop;
 *       rot = EffectFrameRotations(obj + 0x324, obj->+0x32C);
 *       memcpy(obj + 0x150, obj + 0x338, 64);               // the captured matrix
 *       obj->+0x64/+0x68/+0x6C = rot[obj->+0x2A0 - 1];      // three s16
 *       RegisterForShotTest(obj);
 *   }
 *
 * PropBuildScaledSlotEffect (0x00473170):
 *   obj = ActorAlloc(ScaledSlotEffectUpdate, 0x378); ActorClearGameFields(obj);
 *   obj->+0x19C..0x1A4 = desc pos;  obj->+0x1D0 = desc->+0x68;  obj->+0x68 = 0;  obj->+0x192 = 0;
 *   obj->+0x34 |= 0x51;  obj->+0x28C = (u16)tail->+0x04;  obj->+0x14C = tail->+0x08;
 *   obj->+0x1DC = tail->+0x0C;  obj->+0x290 = (u16)tail->+0x00;
 *   obj->+0x2A0 = (s8)tail->+0x10;  obj->+0x2A4 = (s8)tail->+0x11;  obj->+0x2A8 = 0;
 *   obj->+0x2AC = (s8)tail->+0x12;  obj->+0x2C0 = 1.0f;  obj->+0x1A8..0x1B0 = tail->+0x14..0x1C;
 *   obj->+0x324 = 0xF;  obj->+0x328 = 0x1CA;
 *
 * ScaledSlotEffectUpdate (0x00474770):
 *   if (g_script_flags[obj->+0x2A4] == 1) { obj->+0x14C != -1 ? ActorDespawn(obj) : ActorKill(); return; }
 *   if (g_scene_index == 1 && g_script_flags[0x77]) { ActorDespawn(obj); return; }
 *   if (g_script_flags[obj->+0x2A0] == 1 && obj->+0x32C < g_motion_play_length[obj->+0x328] - 2)
 *       obj->+0x32C++;
 *   if (g_motion_slots[obj->+0x328].state == 2) {
 *       Push; Translate(pos); RotY(+0x1D0); RotZ(+0x6C); RotY(+0x68); RotX(+0x64);
 *       Scale(+0x1A8, +0x1AC, +0x1B0);  MaxOfThreeToNoOpStub(...);
 *       EffectDrawWithSlot(obj + 0x324, (s16)obj->+0x28C);
 *       MatrixStore(obj + 0x150); Pop;
 *   }
 *   if (obj->+0x14C != -1) RegisterForShotTest(obj);
 * ```
 *
 * Selector 3 has **no scene-1 sweep**: stage 2's is not removed by flag 0x77.
 * Both remove-flag reads are unguarded (`MOV EAX,[ESI+0x2A4]; CMP byte
 * [EAX+0x9C7200],1`), and the sound on selector 3 is on equality, so a
 * cursor parked on one of the four frames plays it every frame.
 *
 * ## What the port does not carry
 *
 * * **The mesh shot test.** `obj+0x34 |= 0x51` sends both to `ShotTestMesh`
 *   (`FUN_00404A00`), the test on `obj+0x14C` and the matrix at `obj+0x150`,
 *   which the prop pool does not have (`class41/shot_test.ts`). Everything
 *   either routine writes only for it -- selector 3's captured matrix and its
 *   `obj+0x64..0x6C`, selector 7's `MatrixStore` -- is not carried, and
 *   `RegisterForShotTest` files a sphere of radius 0. Selector 3's builder
 *   writes `obj+0x124 = 5.0f`, which only `ShotTestSphere` (`FUN_00404630`)
 *   reads and bit `0x10` keeps this object from; the port's pool has only the
 *   sphere, so `hitRadius` carries 0 rather than a radius the engine never
 *   tests with.
 * * `[port-only]` **The residency tests** on `g_motion_slots` (`0x009A37E0`)
 *   are not modelled: the bundle bakes the motion, so it is always resident
 *   here -- the answer `ScriptFlagEffectUpdate` (`FUN_00473B90`) and
 *   `PropUpdateType44` (`FUN_0046D850`) give theirs.
 * * `MaxOfThreeToNoOpStub` (`FUN_00461C20`) ends in a bare `RET`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale, MatrixTranslate,
} from "../matrix";
import { EffectMotionPlayLength } from "../effect_draw";
import { ActorDespawnProp, ActorKillProp } from "../class41/prop";
import { PropDrawBegin, PropDrawEffect, PropMatrixPush }
  from "../class41/prop_draw";
import {
  BreakableState, makeBreakableProp, PropFamily, type BreakableProp,
} from "../class41/prop_state";
import { PropRegisterForShotTest } from "../class41/shot_test";
import { PropWords } from "../class41/words";
import { HINGE_FLAGS, HINGE_WORDS, PROP_SWEEP_FLAG, PROP_SWEEP_SCENE }
  from "./hinge";

/** `obj+0x324`/`+0x328` from `PropBuildFlagSlotEffect`: effect 0xB, motion 0x1D6. */
export const FLAG_SLOT_EFFECT = 0xb;
export const FLAG_SLOT_EFFECT_MOTION = 0x1d6;
/** `CMP word [0x009A1A08],AX; JNZ` -- scene 0's slot, and everyone else's. */
export const FLAG_SLOT_EFFECT_SLOT_SCENE0 = 0x17ee;
export const FLAG_SLOT_EFFECT_SLOT = 0x197c;
/**
 * `EffectDrawWithCapture(obj + 0x324, 1, ...)` -- the capture bone, whose
 * matrix only the mesh shot test reads (see the file comment).
 */
export const FLAG_SLOT_EFFECT_CAPTURE = 1;
/** `PlaySoundId(0x1116A9)` on these four effect frames. */
export const SFX_FLAG_SLOT_EFFECT = 0x1116a9;
export const FLAG_SLOT_EFFECT_CUES: readonly number[] = [0x41, 0x58, 100, 0x6e];

/** `obj+0x324`/`+0x328` from `PropBuildScaledSlotEffect`: effect 0xF, motion 0x1CA. */
export const SCALED_SLOT_EFFECT = 0xf;
export const SCALED_SLOT_EFFECT_MOTION = 0x1ca;

/**
 * The words selector 3's object keeps: its position is at `obj+0x40`, not
 * at the `+0x19C` the prop fields name, and nothing else of the hinge
 * layout is its.
 */
export interface FlagSlotEffectWords {
  /** `obj+0x40`/`+0x44`/`+0x48` -- the descriptor's position. */
  o40: number;
  o44: number;
  o48: number;
  /** `obj+0x14C` -- the collision blob, or -1. */
  o14c: number;
}

const FLAG_SLOT_EFFECT_WORDS: FlagSlotEffectWords = {
  o40: 0, o44: 0, o48: 0, o14c: 0,
};

/** `PropBuildFlagSlotEffect` — `FUN_00472E00`. `g_class44_subtypes[3]`. */
export function PropBuildFlagSlotEffect(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.FlagSlotEffect;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  p.flags = HINGE_FLAGS;
  const w = PropWords(p, FLAG_SLOT_EFFECT_WORDS);
  w.o40 = Math.fround(pl.pos?.[0] ?? 0);
  w.o44 = Math.fround(pl.pos?.[1] ?? 0);
  w.o48 = Math.fround(pl.pos?.[2] ?? 0);
  p.storyItem = pl.open_flag ?? 0;
  p.removeFlag = pl.remove_flag ?? -1;
  p.effect = FLAG_SLOT_EFFECT;
  p.effectVariant = FLAG_SLOT_EFFECT_MOTION;
  p.effectFrames = 0;
  p.effectPrevFrame = 0;
  w.o14c = pl.coli ?? -1;
  // `obj+0x124 = 5.0f`, which only the sphere test reads -- see the file
  // comment for why the port's sphere is 0.
  p.hitRadius = 0;
  p.slot = G.g_scene_index === 0 ? FLAG_SLOT_EFFECT_SLOT_SCENE0
                                 : FLAG_SLOT_EFFECT_SLOT;
  return p;
}

/** `FlagSlotEffectUpdate` — `FUN_00474120`. One object, one 60 Hz frame. */
export function FlagSlotEffectUpdate(p: BreakableProp, rng: Rng,
                                     events?: Events): void {
  const w = PropWords(p, FLAG_SLOT_EFFECT_WORDS);
  PropDrawBegin(p);
  if ((G.g_script_flags[p.removeFlag] ?? 0) === 1) {
    if (w.o14c !== -1) ActorDespawnProp(p);
    else ActorKillProp(p);
    return;
  }
  const len = EffectMotionPlayLength(p.effectVariant);
  if ((G.g_script_flags[p.storyItem] ?? 0) === 1 && len !== null
      && p.effectFrames < len - 2) {
    p.effectFrames += 1;
  }
  if (FLAG_SLOT_EFFECT_CUES.includes(p.effectFrames)) {
    events?.emit("sound.play", { id: SFX_FLAG_SLOT_EFFECT });
  }
  const m = PropMatrixPush();
  MatrixTranslate(m, w.o40, w.o44, w.o48);
  // `EffectDrawWithCapture(obj + 0x324, 1, (s16)obj->+0x28C)`; the capture
  // (bone 1's matrix into `obj+0x338`, copied to `obj+0x150`) is the mesh
  // shot test's.
  PropDrawEffect(p, m, rng, (p.slot << 16) >> 16);
  PropRegisterForShotTest(p, p.shotX, p.shotY, p.shotZ);
}

/** `PropBuildScaledSlotEffect` — `FUN_00473170`. `g_class44_subtypes[7]`. */
export function PropBuildScaledSlotEffect(
    pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.ScaledSlotEffect;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  p.flags = HINGE_FLAGS;
  p.x = Math.fround(pl.pos?.[0] ?? 0);
  p.y = Math.fround(pl.pos?.[1] ?? 0);
  p.z = Math.fround(pl.pos?.[2] ?? 0);
  p.yaw = pl.yaw ?? 0;
  const w = PropWords(p, HINGE_WORDS);
  w.o68 = 0;
  p.slot = pl.slot ?? 0;
  w.o14c = pl.coli ?? -1;
  w.o1dc = pl.side ?? 0;
  w.o290 = pl.curve ?? 0;
  p.storyItem = pl.open_flag ?? 0;
  p.removeFlag = pl.remove_flag ?? -1;
  w.o2a8 = 0;
  w.o2ac = pl.field_2ac ?? 0;
  w.o2c0 = 1.0;
  p.restX = Math.fround(pl.scale?.[0] ?? 0);
  p.restY = Math.fround(pl.scale?.[1] ?? 0);
  p.restZ = Math.fround(pl.scale?.[2] ?? 0);
  p.effect = SCALED_SLOT_EFFECT;
  p.effectVariant = SCALED_SLOT_EFFECT_MOTION;
  p.hitRadius = 0;
  return p;
}

/** `ScaledSlotEffectUpdate` — `FUN_00474770`. One object, one 60 Hz frame. */
export function ScaledSlotEffectUpdate(p: BreakableProp, rng: Rng): void {
  const w = PropWords(p, HINGE_WORDS);
  PropDrawBegin(p);
  if ((G.g_script_flags[p.removeFlag] ?? 0) === 1) {
    if (w.o14c !== -1) ActorDespawnProp(p);
    else ActorKillProp(p);
    return;
  }
  if (G.g_scene_index === PROP_SWEEP_SCENE
      && (G.g_script_flags[PROP_SWEEP_FLAG] ?? 0) !== 0) {
    ActorDespawnProp(p);
    return;
  }
  const len = EffectMotionPlayLength(p.effectVariant);
  if ((G.g_script_flags[p.storyItem] ?? 0) === 1 && len !== null
      && p.effectFrames < len - 2) {
    p.effectFrames += 1;
  }
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, p.yaw);
  MatrixRotateZ(m, w.o6c);
  MatrixRotateY(m, w.o68);
  MatrixRotateX(m, w.o64);
  MatrixScale(m, p.restX, p.restY, p.restZ);
  PropDrawEffect(p, m, rng, (p.slot << 16) >> 16);
  if (w.o14c !== -1) PropRegisterForShotTest(p, p.shotX, p.shotY, p.shotZ);
}

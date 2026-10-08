/**
 * Class 0x44 selector 6 — a model that swings on its flag like a hinge, and
 * on script flag 0x63 spins away as a strip of models and two effects.
 *
 * One spawn: stage 2's `0x100A4` (slot `0x1DC`, placed in block 23 and again
 * in block 26). While flag 0x63 is down it swings through
 * `g_pHingeCurvesYaw[1]` on its own flag and draws its slot lit, half a turn
 * round and 10.88 along; once flag 0x63 is up it draws the strip
 * `0x170`..`0x174` a model a frame with effects 0xD and 0xE over it, turning
 * on its yaw by a spin that decays by 0.85 a frame, and when flag 0x64 rises
 * it restarts on effect 0xF alone.
 *
 * ## The two routines `[proved]`
 *
 * ```c
 * PropBuildSwingThenBreak (0x00473060):
 *   obj = ActorAlloc(SwingThenBreakUpdate, 0x378); ActorClearGameFields(obj);
 *   obj->+0x19C..0x1A4 = desc pos;  obj->+0x1D0 = desc->+0x68;  obj->+0x68 = 0;  obj->+0x192 = 0;
 *   obj->+0x34 |= 0x51;  obj->+0x28C = (u16)tail->+0x04;  obj->+0x14C = tail->+0x08;
 *   obj->+0x1DC = tail->+0x0C;  obj->+0x290 = (u16)tail->+0x00;
 *   obj->+0x2A0 = (s8)tail->+0x10;  obj->+0x2A4 = (s8)tail->+0x11;  obj->+0x2A8 = 0;
 *   obj->+0x2AC = (s8)tail->+0x12;  obj->+0x2C0 = 1.0f;  obj->+0x1A8..0x1B0 = tail->+0x14..0x1C;
 *   obj->+0x324 = 0xD;  obj->+0x328 = 0x1C7;
 *   g_script_flags[placer->+0x1330] = 0;  g_script_flags[placer->+0x1334] = 0;
 *   g_script_flags[0x63] = 0;
 *
 * SwingThenBreakUpdate (0x00474470):
 *   if (g_script_flags[obj->+0x2A4] == 1) { obj->+0x14C != -1 ? ActorDespawn(obj) : ActorKill(); return; }
 *   if (g_scene_index == 1 && g_script_flags[0x77]) { ActorDespawn(obj); return; }
 *   if (g_script_flags[obj->+0x2A0] == 1 && !g_script_flags[0x63]) {
 *       f = obj->+0x2A8;
 *       if (f >= 0x3C) goto draw;
 *       yaw = ftol((u16)g_pHingeCurvesYaw[1][f] * obj->+0x2C0);
 *       obj->+0x68 = obj->+0x1DC > 0 ? yaw : -yaw;  obj->+0x2A8 = f + 1;
 *   }
 *   if (g_script_flags[0x63] == 1) {
 *       if (obj->+0x32C == 0) obj->+0x28C = 0x170;
 *       if (obj->+0x32C < g_motion_play_length[obj->+0x328] - 2) {
 *           obj->+0x32C++;
 *           if (obj->+0x1DC == 0 && !(obj->+0x34 & 0x40000000))
 *               { obj->+0x34 |= 0x40000000;  obj->+0x1DC = 0x100; }
 *           else { obj->+0x1D0 += obj->+0x1DC;  obj->+0x1DC = ftol(obj->+0x1DC * 0.85f); }
 *       }
 *       if (g_script_flags[0x64] == 1 && !(obj->+0x34 & 0x4000000))
 *           { obj->+0x34 |= 0x4000000;  obj->+0x328 = 0x1C7;  obj->+0x32C = 0; }
 *   }
 * draw:
 *   if (g_motion_slots[obj->+0x328].state == 2) {
 *       Push; Translate(pos); RotY(+0x1D0); RotZ(+0x6C); RotY(+0x68); RotX(+0x64);
 *       if (!g_script_flags[0x63]) {
 *           RotY(0x8000); Translate(-10.876867, 0, 0);
 *           SubmitSlotWithSceneLightArray((s16)obj->+0x28C);  MatrixStore(obj + 0x150);
 *       } else if (g_script_flags[0x63] == 1) {
 *           RotY(0x8000);
 *           if (!g_script_flags[0x64]) {
 *               AssetDrawSlot((s16)obj->+0x28C);
 *               if (obj->+0x28C < 0x174) obj->+0x28C++;
 *               MatrixStore(obj + 0x150);
 *               obj->+0x328 = 0x1C7;  obj->+0x324 = 0xD;  EffectDrawSceneLit(obj + 0x324);
 *               obj->+0x324 = 0xE;  obj->+0x328 = 0x1C8;  EffectDrawSceneLit(obj + 0x324);
 *           } else {
 *               obj->+0x328 = 0x1CA;  obj->+0x324 = 0xF;  EffectDrawSceneLit(obj + 0x324);
 *               MatrixStore(obj + 0x150);
 *           }
 *       }
 *       Pop;
 *   }
 *   if (obj->+0x14C != -1) RegisterForShotTest(obj);
 * ```
 *
 * Worth holding on to:
 *
 * * **The swing's `goto`** at `0x004744E5`: once the curve has run out, the
 *   routine jumps straight to the draw and skips the flag-0x63 block for that
 *   frame -- but only while flag 0x63 is down, which is the swing's own gate,
 *   so the block it skips could not have run anyway.
 * * **`obj+0x1DC` is three things.** The builder's value is the swing's
 *   side, tested for its sign; once the spin starts it is the spin, in BAMS
 *   a frame, turned into `obj+0x1D0` and decayed; and it is armed at `0x100`
 *   only when it is zero. The shipped spawn's is -1, so its spin is -1
 *   decayed by 0.85 -- `ftol(-0.85)` is 0 -- and the arm sets `0x100` on the
 *   next frame.
 * * **The block's effect and motion are rewritten by the draw**, so the
 *   frame steps against the play length of whatever motion the last draw
 *   left there (`EffectMotionPlayLength`).
 * * **The placer's `+0x1330` and `+0x1334`** are never written:
 *   `SpawnFromDescriptor` (`FUN_00408A20`) builds the placer and
 *   `ActorClearGameFields` (`FUN_004A73D0`) zeroes it, and class 0x44 has no
 *   Init. So the two writes clear `g_script_flags[0]`.
 *
 * ## What the port does not carry
 *
 * `[port-only]` The residency test is not modelled: the bundle bakes the
 * motions. The three `MatrixStore`s keep the matrix built on the identity,
 * as the hinges' do (`class44/hinge.ts`), for the mesh shot test and the
 * moving-object passes the `obj+0x34 |= 0x51` and a blob would put it in;
 * the one shipped spawn's `obj+0x14C` is `-1`, so it never registers.
 */
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTranslate,
} from "../matrix";
import { T } from "../tables";
import { EffectMotionPlayLength } from "../effect_draw";
import { ActorDespawnProp, ActorKillProp } from "../class41/prop";
import {
  PropDrawBegin, PropDrawEffect, PropDrawSlot, PropMatrixPush,
} from "../class41/prop_draw";
import {
  BreakableState, makeBreakableProp, PropFamily, type BreakableProp,
} from "../class41/prop_state";
import { PropRegisterForShotTestAsIs } from "../class41/shot_test";
import { ColiStoreObjectMatrix } from "../coli";
import { PropWords } from "../class41/words";
import {
  HINGE_FLAGS, HINGE_FRAMES, HINGE_WORDS, PROP_SWEEP_FLAG,
  PROP_SWEEP_SCENE, type HingeWords,
} from "./hinge";

/** `g_script_flags[0x63]` breaks it, `[0x64]` restarts it on effect 0xF. */
export const SWING_THEN_BREAK_FLAG = 0x63;
export const SWING_THEN_BREAK_RESTART_FLAG = 0x64;
/** `MOV EAX,[0x005960CC]` -- `g_pHingeCurvesYaw[1]`, by a literal. */
export const SWING_THEN_BREAK_CURVE = 1;
/** The block's three effects and their motions. */
export const SWING_THEN_BREAK_EFFECT_A = 0xd;
export const SWING_THEN_BREAK_MOTION_A = 0x1c7;
export const SWING_THEN_BREAK_EFFECT_B = 0xe;
export const SWING_THEN_BREAK_MOTION_B = 0x1c8;
export const SWING_THEN_BREAK_EFFECT_C = 0xf;
export const SWING_THEN_BREAK_MOTION_C = 0x1ca;
/** `MOV word [ESI+0x28C],0x170` and `CMP AX,0x174` -- the strip. */
export const SWING_THEN_BREAK_STRIP_FIRST = 0x170;
export const SWING_THEN_BREAK_STRIP_LAST = 0x174;
/** `MOV dword [ESI+0x1DC],0x100` -- the spin, armed. */
const SWING_THEN_BREAK_SPIN = 0x100;
/** `FMUL float [0x00564534]` -- 0.85f, the spin's decay a frame. */
const SWING_THEN_BREAK_DECAY = Math.fround(0.85);
/**
 * `obj+0x34` bit 30 -- the spin has been armed. The bit `HingeUpdate` runs
 * its wobble on; this routine has no wobble and reads it only for this.
 */
const SWING_THEN_BREAK_SPIN_ARMED = 0x40000000;
/** `obj+0x34` bit 26 -- the flag-0x64 restart has been made. */
const SWING_THEN_BREAK_RESTARTED = 0x4000000;
/** `PUSH 0x8000` -- half a turn, before either draw. */
const SWING_THEN_BREAK_TURN = 0x8000;
/** `PUSH 0xC12E07A6` -- -10.876867, the whole model's offset. */
const SWING_THEN_BREAK_OFFSET = Math.fround(-10.876867);

/** The hinge's words, and `obj+0x192`, which only the builder writes. */
export interface SwingThenBreakWords extends HingeWords {
  o192: number;
}

const SWING_THEN_BREAK_WORDS: SwingThenBreakWords = { ...HINGE_WORDS, o192: 0 };

/**
 * `PropBuildSwingThenBreak` — `FUN_00473060`. `g_class44_subtypes[6]`.
 *
 * The placer's `+0x1330`/`+0x1334` are zero (see the file comment), so the
 * first two flag writes are to `g_script_flags[0]`.
 */
export function PropBuildSwingThenBreak(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.SwingThenBreak;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  p.flags = HINGE_FLAGS;
  p.x = Math.fround(pl.pos?.[0] ?? 0);
  p.y = Math.fround(pl.pos?.[1] ?? 0);
  p.z = Math.fround(pl.pos?.[2] ?? 0);
  p.yaw = pl.yaw ?? 0;
  const w = PropWords(p, SWING_THEN_BREAK_WORDS);
  w.o68 = 0;
  w.o192 = 0;
  p.slot = pl.slot ?? 0;
  w.o14c = pl.coli ?? -1;
  p.coliBlob = pl.coli_blob ?? null;
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
  p.effect = SWING_THEN_BREAK_EFFECT_A;
  p.effectVariant = SWING_THEN_BREAK_MOTION_A;
  p.hitRadius = 0;
  const placer1330 = 0;
  const placer1334 = 0;
  G.g_script_flags[placer1330] = 0;
  G.g_script_flags[placer1334] = 0;
  G.g_script_flags[SWING_THEN_BREAK_FLAG] = 0;
  return p;
}

/** `SwingThenBreakUpdate` — `FUN_00474470`. One object, one 60 Hz frame. */
export function SwingThenBreakUpdate(p: BreakableProp, rng: Rng): void {
  const w = PropWords(p, SWING_THEN_BREAK_WORDS);
  PropDrawBegin(p);
  const flag = (i: number): number => G.g_script_flags[i] ?? 0;
  if (flag(p.removeFlag) === 1) {
    if (w.o14c !== -1) ActorDespawnProp(p);
    else ActorKillProp(p);
    return;
  }
  if (G.g_scene_index === PROP_SWEEP_SCENE && flag(PROP_SWEEP_FLAG) !== 0) {
    ActorDespawnProp(p);
    return;
  }
  let skip = false;
  if (flag(p.storyItem) === 1 && flag(SWING_THEN_BREAK_FLAG) === 0) {
    const f = w.o2a8;
    if (f >= HINGE_FRAMES) {
      skip = true;
    } else {
      const k = T.breakables?.hinge_curves_yaw?.[String(SWING_THEN_BREAK_CURVE)];
      const yaw = Math.trunc(((k?.[f] ?? 0) & 0xffff) * w.o2c0) | 0;
      w.o68 = w.o1dc > 0 ? yaw : -yaw | 0;
      w.o2a8 = f + 1;
    }
  }
  if (!skip && flag(SWING_THEN_BREAK_FLAG) === 1) {
    if (p.effectFrames === 0) p.slot = SWING_THEN_BREAK_STRIP_FIRST;
    const len = EffectMotionPlayLength(p.effectVariant);
    if (len !== null && p.effectFrames < len - 2) {
      p.effectFrames += 1;
      const spin = w.o1dc;
      if (spin === 0 && (p.flags & SWING_THEN_BREAK_SPIN_ARMED) === 0) {
        p.flags = (p.flags | SWING_THEN_BREAK_SPIN_ARMED) >>> 0;
        w.o1dc = SWING_THEN_BREAK_SPIN;
      } else {
        p.yaw = (p.yaw + spin) | 0;
        w.o1dc = Math.trunc(spin * SWING_THEN_BREAK_DECAY) | 0;
      }
    }
    if (flag(SWING_THEN_BREAK_RESTART_FLAG) === 1
        && (p.flags & SWING_THEN_BREAK_RESTARTED) === 0) {
      p.flags = (p.flags | SWING_THEN_BREAK_RESTARTED) >>> 0;
      p.effectVariant = SWING_THEN_BREAK_MOTION_A;
      p.effectFrames = 0;
    }
  }
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, p.yaw);
  MatrixRotateZ(m, w.o6c);
  MatrixRotateY(m, w.o68);
  MatrixRotateX(m, w.o64);
  const broken = flag(SWING_THEN_BREAK_FLAG);
  if (broken === 0) {
    MatrixRotateY(m, SWING_THEN_BREAK_TURN);
    MatrixTranslate(m, SWING_THEN_BREAK_OFFSET, 0, 0);
    PropDrawSlot(p, m, p.slot);
    // `MatrixStore(obj+0x150)` at `0x0047468D`.
    ColiStoreObjectMatrix(p, m);
    p.coliMatrixDrawn = true;
  } else if (broken === 1) {
    MatrixRotateY(m, SWING_THEN_BREAK_TURN);
    if (flag(SWING_THEN_BREAK_RESTART_FLAG) === 0) {
      PropDrawSlot(p, m, p.slot);
      if (((p.slot << 16) >> 16) < SWING_THEN_BREAK_STRIP_LAST) {
        p.slot = (p.slot + 1) & 0xffff;
      }
      // `MatrixStore(obj+0x150)` at `0x004746E1`, before the two effects.
      ColiStoreObjectMatrix(p, m);
      p.coliMatrixDrawn = true;
      p.effectVariant = SWING_THEN_BREAK_MOTION_A;
      p.effect = SWING_THEN_BREAK_EFFECT_A;
      PropDrawEffect(p, m, rng);
      p.effect = SWING_THEN_BREAK_EFFECT_B;
      p.effectVariant = SWING_THEN_BREAK_MOTION_B;
      PropDrawEffect(p, m, rng);
    } else {
      p.effectVariant = SWING_THEN_BREAK_MOTION_C;
      p.effect = SWING_THEN_BREAK_EFFECT_C;
      PropDrawEffect(p, m, rng);
      // `MatrixStore(obj+0x150)` at `0x00474742`, after the effect.
      ColiStoreObjectMatrix(p, m);
      p.coliMatrixDrawn = true;
    }
  }
  if (w.o14c !== -1) PropRegisterForShotTestAsIs(p);
}

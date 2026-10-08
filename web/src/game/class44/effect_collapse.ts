/**
 * Class 0x44 selector 8 — an effect tree that plays on a script flag and
 * then falls apart: its 72 parts drop, bounce and tumble on their own.
 *
 * Two spawns, both stage 2's: `0x69D0` (block 11, flag 0x15) and `0xD448`
 * (block 18, flag 0x66), each a lifetime of 3 steps and effect 0x10 on motion
 * 0x1D3. While the flag is down the object draws a literal model for its
 * block -- `0x173B` at a fixed point in block 11, `0x197E` in block 18 -- and
 * nothing of the tree; once it is up the tree plays to frame 0x23, at which
 * point the parts are let go with the velocity of their last two keys and
 * fall for another 44 frames.
 *
 * ## The two routines `[proved]`
 *
 * ```c
 * PropBuildEffectCollapse (0x00473260):
 *   obj = ActorAlloc(EffectCollapseUpdate, 0xD14); ActorClearGameFields(obj);
 *   obj->+0x194..0x19C = desc->+0x40..0x48;  obj->+0x1B0 = desc->+0x68;
 *   obj->+0x1E4 = 0x10;  obj->+0x1E8 = 0x1D3;  obj->+0x1EC = obj->+0x1F0 = 0;
 *   obj->+0x1C0 = (s8)tail->+0x10;                     // the flag
 *   obj->+0x1A0..0x1A8 = tail->+0x14..0x1C;            // the scale
 *   obj->+0x11C = (s16)(s8)tail->+0x11;                // the lifetime, in steps
 *
 * EffectCollapseUpdate (0x004748C0):
 *   if (g_scene_index == 1 && g_script_flags[0x77]) { ActorDespawn(obj); return; }
 *   if ((s8)obj->+0x1BB != g_evt_step_index) {
 *       if ((s8)++obj->+0x1BC > obj->+0x11C) { ActorDespawn(obj); return; }
 *       obj->+0x1BB = g_evt_step_index;
 *   }
 *   if (block == 0xB) { Push; Translate(-869.2, 12.0, -810.0);
 *                       AssetDrawSlot(g_script_flags[flag] ? 0x173C : 0x173B); Pop; }
 *   else if (block == 0x12 && !g_script_flags[flag]) AssetDrawSlot(0x197E);
 *   if (obj->+0x1EC == 0x22)
 *       for (k = 0; k < 0x49; k++) { pos[k] = T(0x22)[k]; rot[k] = R(0x22)[k]; }
 *   if (obj->+0x1EC == 0x23)
 *       for (k = 0; k < 0x49; k++) {
 *           vel[k] = T(0x23)[k] - pos[k];  spin[k] = R(0x23)[k] - rot[k];
 *           pos[k] = T(0x23)[k];  rot[k] = R(0x23)[k];
 *       }
 *   if (g_script_flags[flag] == 1) obj->+0x1EC++;
 *   if (g_motion_slots[obj->+0x1E8].state == 2 && g_script_flags[flag] == 1
 *       && obj->+0x1EC <= 0x23) {
 *       Push; Translate(+0x194, +0x198, +0x19C); RotY(+0x1B0); Scale(+0x1A0, +0x1A4, +0x1A8);
 *       for each child of g_effect_trees[obj->+0x1E4]: EffectCollapseWalkNode(obj, child);
 *       obj->+0x1F0 = obj->+0x1EC;  Pop;  return;
 *   }
 *   if (obj->+0x1EC < 0x50) {
 *       floor = ftol((g_camera_fixed_eye_y - obj->+0x198) + obj->+0x1A4 * 5.0f);
 *       if (block == 0x12) floor = ftol(floor - 2.0);
 *       Push; Translate(+0x194, +0x198, +0x19C); RotY(+0x1B0); Scale(+0x1A0, +0x1A4, +0x1A8);
 *       for (k = 1; k <= 0x48; k++) {
 *           vel[k].y -= 0.02722f;  pos[k] += vel[k];  rot[k] += spin[k];
 *           if (pos[k].y < (float)floor) {
 *               pos[k].y = floor;  vel[k].y *= -0.9f;
 *               spin[k].x += rand() % 0x401 - 0x200;  (and .y, .z)
 *           }
 *           Push; Translate(pos[k]); RotZ(rot[k].z); RotY(rot[k].y); RotX(rot[k].x);
 *           AssetDrawSlotWithAlpha((s16)slot[k], 0.95f); Pop;
 *       }
 *       Pop;
 *   }
 *
 * EffectCollapseWalkNode (0x00474E00):
 *   Push;
 *   if (node->bone > 0) { EffectPoseNode(obj + 0x1E4, node);
 *                         AssetDrawSlotWithAlpha(node->slot, 0.95f);
 *                         slot[node->bone] = (u16)node->slot; }
 *   for each child: EffectCollapseWalkNode(obj, child);
 *   Pop;
 * ```
 *
 * `pos`, `vel`, `rot`, `spin` and `slot` are `obj+0x238`, `+0x5A4`, `+0x910`,
 * `+0xAC6` and `+0xC7C` -- the layout `PropUpdateType40`'s pieces use, so they
 * travel as {@link BreakableProp.burst}.
 *
 * Four things in it are not what they look like, and all four are the
 * routine's:
 *
 * * **The parts run before the flag does.** The physics arm is the `else` of
 *   "flag up and frame at most 0x23", so while the flag is down all 72 parts
 *   fall from the origin, reach the floor, and bounce -- each bounce three
 *   `rand()`s from the game's generator -- drawing `slot[k]`, which is 0 until
 *   the tree has been walked once, so nothing is seen.
 * * **Entry `k` is drawn with bone `k`'s model at bone `k + 1`'s key.** The
 *   motion's arrays are indexed by `bone - 1` and the slots by the bone, and
 *   the physics loop uses one `k` for both, starting at 1.
 * * **Effect 0x10 has 72 bones and the routine copies 73 entries**, so entry
 *   72 is read out of the key's rotation shorts (as a translation) and the
 *   next key's first translation (as a rotation). The exporter reads the two
 *   keys at the routine's own addresses and they travel raw
 *   (`collapse_keys`); a translation that lands on shorts may not be a
 *   number, and the floor test is `FCOMP; TEST AH,1`, which takes an
 *   unordered compare as "below".
 * * **Block 0x12's `0x197E` is drawn under the bare stack** -- no push, no
 *   translate -- so it stands at the world's origin, as the matrix the draw
 *   is recorded under says.
 *
 * `[port-only]` The residency test on `g_motion_slots` is not modelled: the
 * bundle bakes the motion. `MaxOfThreeToNoOpStub` (`FUN_00461C20`) ends in a
 * bare `RET`. No `RegisterForShotTest`: it is not shootable.
 */
import type { Rng } from "../../core/rng";
import type { BreakablePlacement, EffectDefJson } from "../../bundle";
import { G } from "../globals";
import {
  MatrixRotateY, MatrixScale, MatrixTranslate, type Mat,
} from "../matrix";
import { T } from "../tables";
import { EffectDefFor } from "../effect_draw";
import { MsvcRand } from "../class41/group";
import { ActorDespawnProp } from "../class41/prop";
import {
  PropDrawBegin, PropDrawSlot, PropDrawSlotWithAlpha, PropMatrixPush,
  PropMatrixTRzRyRx,
} from "../class41/prop_draw";
import {
  BreakableState, makeBreakableProp, PropFamily, type BreakableProp,
  type BurstPiece,
} from "../class41/prop_state";
import { PropWords } from "../class41/words";
import { EffectSampleNode, type EffectNodePose } from "./script_flag_effect";
import { PROP_SWEEP_FLAG, PROP_SWEEP_SCENE } from "./hinge";

/** `obj+0x1E4`/`+0x1E8`: effect 0x10 on motion 0x1D3. */
export const EFFECT_COLLAPSE_EFFECT = 0x10;
export const EFFECT_COLLAPSE_MOTION = 0x1d3;
/** `CMP [ESI+0x1EC],0x22` / `0x23` -- the two keys it lets the parts go on. */
export const EFFECT_COLLAPSE_KEY_A = 0x22;
export const EFFECT_COLLAPSE_KEY_B = 0x23;
/** `MOV [ESP+0x10],0x49` -- the entries it copies. */
export const EFFECT_COLLAPSE_ENTRIES = 0x49;
/** `MOV [ESP+0x14],0x48` -- the parts it moves and draws, from entry 1. */
export const EFFECT_COLLAPSE_PARTS = 0x48;
/** `CMP [ESI+0x1EC],0x50; JGE` -- the fall's last frame is one short. */
export const EFFECT_COLLAPSE_END = 0x50;
/** `FSUB float [0x0055CB10]` -- 0.02722f, gravity a frame. */
const EFFECT_COLLAPSE_GRAVITY = Math.fround(0.02722);
/** `FMUL float [0x00569180]` -- -0.9f, a bounce. */
const EFFECT_COLLAPSE_BOUNCE = Math.fround(-0.9);
/** `FMUL float [0x0055D2B4]` -- 5.0f, the floor's height in scale units. */
const EFFECT_COLLAPSE_FLOOR_SCALE = 5.0;
/** `FSUB double [0x0055CAF8]` -- 2.0, block 0x12's floor is this lower. */
const EFFECT_COLLAPSE_FLOOR_DROP = 2.0;
/** `rand() % 0x401 - 0x200` -- a bounce's spin, per axis. */
const EFFECT_COLLAPSE_SPIN_SPREAD = 0x401;
const EFFECT_COLLAPSE_SPIN_BIAS = 0x200;
/** `PUSH 0x3F733333` -- 0.95f, every part's alpha. */
const EFFECT_COLLAPSE_ALPHA = Math.fround(0.95);

/** The blocks with a literal model, and what each draws. */
export const EFFECT_COLLAPSE_BLOCK_B = 0xb;
export const EFFECT_COLLAPSE_BLOCK_12 = 0x12;
export const EFFECT_COLLAPSE_SLOT_B_DOWN = 0x173b;
export const EFFECT_COLLAPSE_SLOT_B_UP = 0x173c;
export const EFFECT_COLLAPSE_SLOT_12 = 0x197e;
/** `PUSH 0xC44A8000; PUSH 0x41400000; PUSH 0xC4594CCD`. */
const EFFECT_COLLAPSE_AT_B: readonly [number, number, number] =
  [Math.fround(-869.2), 12.0, -810.0];

/**
 * The words of the 0xD14-byte object. **Its layout is its own** (`L3`):
 * `+0x19C` is the position's z here, not the x a 0x378-byte prop keeps
 * there, so nothing of it goes through the shared position fields.
 */
export interface EffectCollapseWords {
  /** `obj+0x194`/`+0x198`/`+0x19C` -- the descriptor's position. */
  o194: number;
  o198: number;
  o19c: number;
  /** `obj+0x1A0`/`+0x1A4`/`+0x1A8` -- the scale. */
  o1a0: number;
  o1a4: number;
  o1a8: number;
  /** `obj+0x1B0` -- the yaw. */
  o1b0: number;
  /** `obj+0x1BB` -- the step index last seen, a byte. */
  o1bb: number;
  /** `obj+0x1BC` -- steps counted, a byte. */
  o1bc: number;
  /** `obj+0x1C0` -- the script flag that plays it. */
  o1c0: number;
  /** `obj+0x1E4`..`+0x1F0` -- the effect's state block. */
  o1e4: number;
  o1e8: number;
  o1ec: number;
  o1f0: number;
}

const EFFECT_COLLAPSE_WORDS: EffectCollapseWords = {
  o194: 0, o198: 0, o19c: 0, o1a0: 0, o1a4: 0, o1a8: 0, o1b0: 0, o1bb: 0,
  o1bc: 0, o1c0: 0, o1e4: 0, o1e8: 0, o1ec: 0, o1f0: 0,
};

/** `(s16)` -- the angles and spins are 16-bit words. */
function S16(v: number): number {
  return (v << 16) >> 16;
}

const f32Bits = new Float32Array(1);
const u32Bits = new Uint32Array(f32Bits.buffer);

/** A 32-bit pattern read as the `float` the routine loads it as. */
function FloatFromBits(bits: number): number {
  u32Bits[0] = bits >>> 0;
  return f32Bits[0];
}

/** `PropBuildEffectCollapse` — `FUN_00473260`. `g_class44_subtypes[8]`. */
export function PropBuildEffectCollapse(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.EffectCollapse;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  const w = PropWords(p, EFFECT_COLLAPSE_WORDS);
  w.o194 = Math.fround(pl.pos?.[0] ?? 0);
  w.o198 = Math.fround(pl.pos?.[1] ?? 0);
  w.o19c = Math.fround(pl.pos?.[2] ?? 0);
  w.o1b0 = pl.yaw ?? 0;
  w.o1e4 = EFFECT_COLLAPSE_EFFECT;
  w.o1e8 = EFFECT_COLLAPSE_MOTION;
  w.o1ec = 0;
  w.o1f0 = 0;
  w.o1c0 = pl.open_flag ?? 0;
  w.o1a0 = Math.fround(pl.scale?.[0] ?? 0);
  w.o1a4 = Math.fround(pl.scale?.[1] ?? 0);
  w.o1a8 = Math.fround(pl.scale?.[2] ?? 0);
  p.lifetime = S16(pl.lifetime_evt_steps);
  p.hitRadius = 0;
  // No slot word in this layout: `ActorClearGameFields`' zero, and not the
  // group props' default the pool's record starts with.
  p.slot = 0;
  // `ActorClearGameFields` leaves all 73 entries and every slot at zero.
  p.burst = Array.from({ length: EFFECT_COLLAPSE_ENTRIES }, (): BurstPiece => ({
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0,
    sx: 0, sy: 0, sz: 0, slot: 0,
  }));
  return p;
}

/**
 * `[port-only]` The raw key *key* `EffectFrameTranslations` (`FUN_0040E040`)
 * and `EffectFrameRotations` (`FUN_0040E070`) hand the routine, out of the
 * placement the exporter wrote it on (see the file comment).
 */
function EffectCollapseKey(p: BreakableProp, key: number):
    { t_bits: number[]; r: number[] } | null {
  const pl = T.breakables?.placements?.find(
    (q) => q.at === p.at && q.container === "effect_collapse");
  return pl?.collapse_keys?.find((k) => k.key === key) ?? null;
}

/** `EffectCollapseUpdate` — `FUN_004748C0`. One object, one 60 Hz frame. */
export function EffectCollapseUpdate(p: BreakableProp, rng: Rng): void {
  const w = PropWords(p, EFFECT_COLLAPSE_WORDS);
  PropDrawBegin(p);
  const flag = (i: number): number => G.g_script_flags[i] ?? 0;
  if (G.g_scene_index === PROP_SWEEP_SCENE && flag(PROP_SWEEP_FLAG) !== 0) {
    ActorDespawnProp(p);
    return;
  }
  if (((w.o1bb << 24) >> 24) !== S16(G.g_evt_step_index)) {
    w.o1bc = (w.o1bc + 1) & 0xff;
    if (((w.o1bc << 24) >> 24) > S16(p.lifetime)) {
      ActorDespawnProp(p);
      return;
    }
    w.o1bb = G.g_evt_step_index & 0xff;
  }
  const block = S16(G.g_evt_block_index);
  if (block === EFFECT_COLLAPSE_BLOCK_B) {
    const m = PropMatrixPush();
    MatrixTranslate(m, ...EFFECT_COLLAPSE_AT_B);
    PropDrawSlot(p, m, flag(w.o1c0) === 0 ? EFFECT_COLLAPSE_SLOT_B_DOWN
                                          : EFFECT_COLLAPSE_SLOT_B_UP);
  } else if (block === EFFECT_COLLAPSE_BLOCK_12 && flag(w.o1c0) === 0) {
    PropDrawSlot(p, PropMatrixPush(), EFFECT_COLLAPSE_SLOT_12);
  }
  if (w.o1ec === EFFECT_COLLAPSE_KEY_A) {
    const k = EffectCollapseKey(p, EFFECT_COLLAPSE_KEY_A);
    if (k) {
      p.burst.forEach((b, i) => {
        b.x = FloatFromBits(k.t_bits[i * 3]);
        b.y = FloatFromBits(k.t_bits[i * 3 + 1]);
        b.z = FloatFromBits(k.t_bits[i * 3 + 2]);
        b.rx = k.r[i * 3];
        b.ry = k.r[i * 3 + 1];
        b.rz = k.r[i * 3 + 2];
      });
    }
  }
  if (w.o1ec === EFFECT_COLLAPSE_KEY_B) {
    const k = EffectCollapseKey(p, EFFECT_COLLAPSE_KEY_B);
    if (k) {
      p.burst.forEach((b, i) => {
        const x = FloatFromBits(k.t_bits[i * 3]);
        const y = FloatFromBits(k.t_bits[i * 3 + 1]);
        const z = FloatFromBits(k.t_bits[i * 3 + 2]);
        b.vx = Math.fround(x - b.x);
        b.vy = Math.fround(y - b.y);
        b.vz = Math.fround(z - b.z);
        b.sx = S16(k.r[i * 3] - b.rx);
        b.sy = S16(k.r[i * 3 + 1] - b.ry);
        b.sz = S16(k.r[i * 3 + 2] - b.rz);
        b.x = x;
        b.y = y;
        b.z = z;
        b.rx = k.r[i * 3];
        b.ry = k.r[i * 3 + 1];
        b.rz = k.r[i * 3 + 2];
      });
    }
  }
  if (flag(w.o1c0) === 1) w.o1ec += 1;
  const def = EffectDefFor(w.o1e4, w.o1e8);
  if (flag(w.o1c0) === 1 && w.o1ec <= EFFECT_COLLAPSE_KEY_B) {
    const m = PropMatrixPush();
    MatrixTranslate(m, w.o194, w.o198, w.o19c);
    MatrixRotateY(m, w.o1b0);
    MatrixScale(m, w.o1a0, w.o1a4, w.o1a8);
    const pose: EffectNodePose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
    for (const c of def?.nodes[0]?.children ?? []) {
      EffectCollapseWalkNode(p, w, def!, c, m, pose);
    }
    w.o1f0 = w.o1ec;
    return;
  }
  if (w.o1ec >= EFFECT_COLLAPSE_END) return;
  // `FLD [0x009C8E58]; FSUB [ESI+0x198]; FLD [ESI+0x1A4]; FMUL 5.0f; FADDP;
  // CALL __ftol`.
  let floor = Math.trunc((G.g_camera_fixed_eye_y - w.o198)
                         + w.o1a4 * EFFECT_COLLAPSE_FLOOR_SCALE) | 0;
  if (block === EFFECT_COLLAPSE_BLOCK_12) {
    floor = Math.trunc(floor - EFFECT_COLLAPSE_FLOOR_DROP) | 0;
  }
  const floorF = Math.fround(floor);
  const m = PropMatrixPush();
  MatrixTranslate(m, w.o194, w.o198, w.o19c);
  MatrixRotateY(m, w.o1b0);
  MatrixScale(m, w.o1a0, w.o1a4, w.o1a8);
  for (let k = 1; k <= EFFECT_COLLAPSE_PARTS; k++) {
    const b = p.burst[k];
    b.vy = Math.fround(b.vy - EFFECT_COLLAPSE_GRAVITY);
    b.x = Math.fround(b.vx + b.x);
    b.y = Math.fround(b.y + b.vy);
    b.z = Math.fround(b.vz + b.z);
    b.rx = S16(b.rx + b.sx);
    b.ry = S16(b.ry + b.sy);
    b.rz = S16(b.rz + b.sz);
    // `FCOMP; FNSTSW AX; TEST AH,1` -- C0, set for "below" and for an
    // unordered compare alike.
    if (!(b.y >= floorF)) {
      b.y = floorF;
      b.vy = Math.fround(b.vy * EFFECT_COLLAPSE_BOUNCE);
      b.sx = S16(b.sx + (MsvcRand(rng) % EFFECT_COLLAPSE_SPIN_SPREAD
                         - EFFECT_COLLAPSE_SPIN_BIAS));
      b.sy = S16(b.sy + (MsvcRand(rng) % EFFECT_COLLAPSE_SPIN_SPREAD
                         - EFFECT_COLLAPSE_SPIN_BIAS));
      b.sz = S16(b.sz + (MsvcRand(rng) % EFFECT_COLLAPSE_SPIN_SPREAD
                         - EFFECT_COLLAPSE_SPIN_BIAS));
    }
    const pm = PropMatrixPush(m);
    PropMatrixTRzRyRx(pm, b.x, b.y, b.z, b.rx, b.ry, b.rz);
    PropDrawSlotWithAlpha(p, pm, S16(b.slot ?? 0), EFFECT_COLLAPSE_ALPHA);
  }
}

/**
 * `EffectCollapseWalkNode` — `FUN_00474E00`. One node of the tree and its
 * children, under *parent*.
 */
export function EffectCollapseWalkNode(p: BreakableProp,
                                       w: EffectCollapseWords,
                                       def: EffectDefJson, i: number,
                                       parent: Mat,
                                       pose: EffectNodePose): void {
  const node = def.nodes[i];
  if (!node) return;
  const m = PropMatrixPush(parent);
  if (node.bone > 0) {
    // `EffectPoseNode(obj + 0x1E4, node)` -- the frame and the previous one
    // are the block's `+0x1EC` and `+0x1F0`.
    if (def.frames && EffectSampleNode(def, i, w.o1ec, w.o1f0, pose)) {
      PropMatrixTRzRyRx(m, pose.x, pose.y, pose.z, pose.pitch, pose.yaw,
                        pose.roll);
    }
    PropDrawSlotWithAlpha(p, m, node.slot, EFFECT_COLLAPSE_ALPHA);
    const piece = p.burst[node.bone];
    if (piece) piece.slot = node.slot & 0xffff;
  }
  for (const c of node.children) {
    EffectCollapseWalkNode(p, w, def, c, m, pose);
  }
}

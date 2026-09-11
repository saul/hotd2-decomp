/**
 * `OwlDrawBodyChain` — `FUN_00447C20`. Class 0x43's whole renderer.
 *
 * **No skeleton and no character type.** The owl is sixteen `AssetDrawSlot`
 * calls in one hand-built matrix chain, so it cannot go through
 * `render/characters.ts` the way a zombie does, and `render/slotmodels.ts`'s
 * one-node-per-actor shape is not enough for it either: the body, a
 * thirty-frame wing beat, a head on a sixteen-frame ping-pong and four limb
 * chains are all drawn at different matrices under one root. Drawn with only
 * the body, an owl is a blob that does not flap.
 *
 * ⚠ Ghidra's function body ends at `0x00447D40` on a `MatrixStackPop` it has
 * marked no-return; the routine really runs to `0x00447FA4` and three of its
 * four limb chains are in no decompilation. Everything below was read with
 * `disassemble_bytes` over the whole range, and the push/pop depth balances at
 * zero on both the live and the dead path — fifteen against fifteen.
 *
 * ## The chain
 *
 * Each `push` is a node and each transform post-multiplies, so a node's local
 * matrix is the product of its calls in the order they are made. The
 * translations are the exe's own floats; the angles come off the actor.
 *
 * ```
 * root        T(pos)          Ry(obj+0x68) Rz(obj+0x6C) Rx(obj+0x64)
 *   body                      Rz(0x4007)   Ry(0xDEC8)   Rx(0x3FF9)
 *     · body slot        0xBBF alive, 0xBC0 dead
 *     · beat slot        0xBC1 + obj+0x240, the thirty-frame run
 *     head      T(-0.5781, -0.4205, 0.0036)
 *                                Rz(0x8863 - sin(obj+0x214) * -2500)
 *                                Ry(0xFFC0)   Rx(0xFFF2)
 *       · head slot      0xBF8 + ping
 *     inner     T(1.8173, 0, 0)  Rz(obj+0x208) Ry(obj+0x20C)   [alive only]
 *       · 0xBF1
 *       childA  T(0.0897, 0.4358, -0.0120) Rz(0) Ry(0xC041) Rx(obj+0x210+0xD494)
 *         · 0xBF4
 *       childB  T(0.0927, 0.4366, -0.0120) Rz(0) Ry(0xC041) Rx(obj+0x214+0x4EE0)
 *         · 0xBF2
 *   outer+x   T(0.3321, -0.0836, -0.0065) Rz(0xC000) Ry(obj+0x218+0x03C0) Rx(0xC000)
 *     · 0xBF6 ; then T(0.6652,0,0) Rz(0xDB13) · 0xBBE ; then T(0.6810,0,0)
 *     · 0xC08 + obj+0x21C % 15
 *   outer-x   T(-0.3321, -0.0836, -0.0065) ...the mirror, 0xBF5 / 0xBBD /
 *     · 0xC18 + obj+0x21C % 15
 * ```
 *
 * The two outer chains are **siblings of the body, not children**: the body's
 * pop happens before their pushes, so they hang off the root. And the dead
 * path skips the inner chain alone — `if (obj+0x34 & 0x1000000) goto tail` —
 * so a corpse keeps its beat slot, its head and both outer limbs.
 *
 * `[open]` what the limbs anatomically are. The mirrored pair sharing one
 * angle is `[likely]` the wings and the chain under the body `[likely]` the
 * talons; the slot table names files, not parts, and nothing in the code says.
 */
import { Matrix4 } from "three";
import { BAMS_TO_RAD } from "../core/bams";
import type { Actor } from "../game/actor";
import { ActorFlag } from "../game/actor";
import { OwlState } from "../game/class43/state";
import { G } from "../game/globals";

/** `owl.bin` 2 and 3 — the body alive and dead. */
const BODY = 0xbbf;
const BODY_DEAD = 0xbc0;
/** `owl.bin` 4..33, indexed by the wing beat. */
const BEAT = 0xbc1;
/** `owl.bin` 59..74 — the head's sixteen-frame ping-pong. */
const HEAD = 0xbf8;
/** The inner chain: `owl.bin` 52, 55 and 53. */
const INNER = 0xbf1;
const INNER_A = 0xbf4;
const INNER_B = 0xbf2;
/** The mirrored outer pair: roots, mid segments and fifteen-frame tips. */
const OUTER_R = 0xbf6;
const OUTER_L = 0xbf5;
const OUTER_MID_R = 0xbbe;
const OUTER_MID_L = 0xbbd;
const OUTER_TIP_R = 0xc08;
const OUTER_TIP_L = 0xc18;
const OUTER_TIP_FRAMES = 15;
/** The beat's period, and the head's, which is the same thirty halved. */
const BEAT_FRAMES = 30;
const HEAD_HALF = 14;

/** One drawn slot and the matrix it is drawn at, relative to the actor root. */
export interface OwlPart {
  slot: number;
  m: Matrix4;
}

const _t = new Matrix4();
const _r = new Matrix4();

/** `MatrixTranslate` then `MatrixRotateZ`, `Y`, `X` in the order given. */
function node(out: Matrix4, parent: Matrix4,
              x: number, y: number, z: number,
              order: readonly ("x" | "y" | "z")[],
              ax: number, ay: number, az: number): Matrix4 {
  out.copy(parent).multiply(_t.makeTranslation(x, y, z));
  for (const axis of order) {
    const a = axis === "x" ? ax : axis === "y" ? ay : az;
    out.multiply(axis === "x" ? _r.makeRotationX(a * BAMS_TO_RAD)
               : axis === "y" ? _r.makeRotationY(a * BAMS_TO_RAD)
                              : _r.makeRotationZ(a * BAMS_TO_RAD));
  }
  return out;
}

/** BAMS to radians is applied inside {@link node}; these are raw BAMS. */
const ZYX = ["z", "y", "x"] as const;
const ZY = ["z", "y"] as const;

/**
 * The sixteen draws of one owl, flattened.
 *
 * Flat rather than a node tree because the engine's stack *is* a flattening:
 * a slot is drawn at whatever the matrix is when `AssetDrawSlot` runs, and
 * composing the product here is the same arithmetic in the same order. The
 * caller places one cloned model per entry under a group at the actor.
 *
 * The root transform is **not** included — the caller puts the group at the
 * actor's position and orientation, which is `MatrixTranslate(pos)` and
 * `Ry(obj+0x68) Rz(obj+0x6C) Rx(obj+0x64)`.
 */
export function OwlBodyChain(a: Actor, out: OwlPart[]): OwlPart[] {
  out.length = 0;
  if (a.cls !== 0x43) return out;
  const o = a.owl;
  const dead = (a.flags & ActorFlag.Dead) !== 0;

  const push = (slot: number, m: Matrix4) => {
    out.push({ slot, m: m.clone() });
  };

  // The body's own fixed model correction, and the two slots drawn at it.
  const body = node(new Matrix4(), new Matrix4(), 0, 0, 0, ZYX,
                    0x3ff9, 0xdec8, 0x4007);
  push(dead ? BODY_DEAD : BODY, body);
  push(BEAT + (o.beat % BEAT_FRAMES), body);

  // The head. `g_frame_counter % 30` folded into a ping-pong, frozen at 0
  // once the owl is dead — `if (obj+0x220 == 6) ping = 0`.
  const flap = Math.trunc(G.g_frame_counter) % BEAT_FRAMES;
  const ping = o.state === OwlState.Dead ? 0
    : flap > HEAD_HALF ? BEAT_FRAMES - flap : flap;
  const headRz = 0x8863
    - Math.trunc(Math.sin(o.limbD * BAMS_TO_RAD) * -2500.0);
  push(HEAD + ping, node(new Matrix4(), body, -0.5781, -0.4205, 0.0036,
                         ZYX, 0xfff2, 0xffc0, headRz));

  // The inner chain, which the dead path skips outright.
  if (!dead) {
    const inner = node(new Matrix4(), body, 1.8173, 0, 0, ZY,
                       0, o.limbB, o.limbA);
    push(INNER, inner);
    push(INNER_A, node(new Matrix4(), inner, 0.0897, 0.4358, -0.0120, ZYX,
                       o.limbC + 0xd494, 0xc041, 0));
    push(INNER_B, node(new Matrix4(), inner, 0.0927, 0.4366, -0.0120, ZYX,
                       o.limbD + 0x4ee0, 0xc041, 0));
  }

  // The mirrored outer pair, siblings of the body. Each is three models in
  // one push: the root, a mid segment 0.6652 along, and a tip 0.6810 past it
  // whose fifteen-frame run is stepped by the dive alone.
  const tip = ((o.diveFrame % OUTER_TIP_FRAMES) + OUTER_TIP_FRAMES)
    % OUTER_TIP_FRAMES;
  for (const side of [1, -1]) {
    const root = node(new Matrix4(), new Matrix4(),
                      0.3321 * side, -0.0836, -0.0065, ZYX,
                      0xc000, o.limbE + 0x03c0, 0xc000);
    push(side > 0 ? OUTER_R : OUTER_L, root);
    const mid = node(new Matrix4(), root, 0.6652, 0, 0, ZYX, 0, 0, 0xdb13);
    push(side > 0 ? OUTER_MID_R : OUTER_MID_L, mid);
    const end = new Matrix4().copy(mid).multiply(
      _t.makeTranslation(0.6810, 0, 0));
    push((side > 0 ? OUTER_TIP_R : OUTER_TIP_L) + tip, end);
  }
  return out;
}

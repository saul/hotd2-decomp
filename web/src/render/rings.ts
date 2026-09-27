/**
 * The two ring effects, drawn: the one a body leaves on the ground as it
 * sinks (`game/effects/ground_ring.ts`) and the flat one a class-0x30 actor
 * leaves on water (`game/effects/water_ring.ts`).
 *
 * Nothing here is state. Each routine's draw half is transcribed as the
 * matrix it builds -- call order is product order, as in `boss3_effects.ts` --
 * from the record `game/` left, and `update` and `resync` are the same call.
 *
 * * **ground ring, growing** (`RingEffectSpread`, `FUN_00407E30`):
 *   `T(pos) Ry(yaw)`, then the ring `S(sx, s, sx)` with
 *   `sx = cos(a) * s * 4`, and four cels at `T(+-d, 0, +-2d) S(s * 0.5)`
 *   with `d = sin(a) * s * 2` and `a = ftol(n * 136.53334)` BAMS.
 * * **ground ring, held** (`RingEffectHold`, `FUN_00408100`): the ring
 *   `S(4s, s, 4s)`, one cel `S(s * 0.3)`.
 * * **ground ring, fading** (`RingEffectFadeOut`, `FUN_00408220`): the ring
 *   `S(cos(b) * s * 4, s, ...)` with `b = ftol(m * 409.6)`, and the one cel,
 *   both through `AssetDrawSlotWithAlpha`.
 * * **water ring** (`WaterRingUpdate`, `FUN_00456880`): `T(pos) S(s, 0.2, s)`
 *   through `AssetDrawSlotWithAlpha`.
 *
 * The ground ring's routines raise draw layer 0xC for their draws, which is
 * the effects' own `renderOrder`; the water ring's sets no layer and draws in
 * the world's.
 */
import { type Group, Matrix4, type Object3D, Quaternion, Vector3 }
  from "three";
import { BAMS_TO_RAD, BAMS_TO_RAD_F64 } from "../core/bams";
import { G } from "../game/globals";
import {
  GROUND_RING_CENTRE_CEL_SCALE, GROUND_RING_FADE_BAMS, GROUND_RING_GROW_BAMS,
  GROUND_RING_GROW_CEL_SCALE, GROUND_RING_SLOT, GROUND_RING_STRIP_FRAMES,
  GROUND_RING_STRIP_PHASES, GROUND_RING_STRIP_SLOT, GROUND_RING_WIDTH,
  GroundRingDrawnBy, GroundRingStep, type GroundRingEffect,
} from "../game/effects/ground_ring";
import { WATER_RING_HEIGHT } from "../game/effects/water_ring";
import { setSlotAlpha } from "./boss3_effects";

/** What this needs of the effect layer. */
export interface RingEffectHost {
  /** A node for `key` at `slot` under `parent`, re-cloned when the slot moves. */
  node(key: string, slot: number, parent: Group): Object3D | null;
  /** World-space effects. */
  world: Group;
}

const AY = new Vector3(0, 1, 0);
const _base = new Matrix4();
const _m = new Matrix4();
const _b = new Matrix4();
const _q = new Quaternion();

/** The world's own translucent layer, 8: the water ring sets none. */
const WORLD_LAYER_ORDER = 0;

function place(node: Object3D, m: Matrix4): void {
  node.matrixAutoUpdate = false;
  node.matrix.copy(m);
  node.matrixWorldNeedsUpdate = true;
}

/** `T(pos) Ry(yaw)` — the outer push every ground-ring routine opens with. */
function groundRingBase(e: GroundRingEffect, out: Matrix4): Matrix4 {
  out.makeTranslation(e.pos.x, e.pos.y, e.pos.z);
  return out.multiply(_b.makeRotationFromQuaternion(
    _q.setFromAxisAngle(AY, e.yaw * BAMS_TO_RAD)));
}

/** `0x15E4 + (g_blink_frame_counter + k) % 30` — `XOR EDX, EDX; DIV ECX`. */
function stripCel(phase: number): number {
  return GROUND_RING_STRIP_SLOT
    + ((G.g_blink_frame_counter + phase) >>> 0) % GROUND_RING_STRIP_FRAMES;
}

function drawPart(h: RingEffectHost, seen: Set<string>, key: string,
                  slot: number, m: Matrix4, alpha: number | null): void {
  const node = h.node(key, slot, h.world);
  if (!node) return;
  seen.add(key);
  place(node, m);
  if (alpha !== null) setSlotAlpha(node, alpha);
}

function drawGroundRing(h: RingEffectHost, seen: Set<string>,
                        e: GroundRingEffect): void {
  const drawn = GroundRingDrawnBy(e);
  if (drawn === null) return;
  const base = groundRingBase(e, _base);
  const s = e.size;
  const key = `gr${e.id}`;

  if (drawn === GroundRingStep.Spread) {
    // `FILD; FMUL [136.53334]; __ftol`, then `FMUL double; FCOS` with no store
    // between -- the double constant, not the float one.
    const a = Math.trunc(e.frames * GROUND_RING_GROW_BAMS) * BAMS_TO_RAD_F64;
    const sx = Math.fround(Math.cos(a) * s * GROUND_RING_WIDTH);
    drawPart(h, seen, `${key}r`, GROUND_RING_SLOT,
             _m.copy(base).multiply(_b.makeScale(sx, s, sx)), null);
    // `FSIN; FMUL [+0x118]; FADD ST0, ST0; FSTP` -- d, then 2d, -d and -2d.
    const d = Math.fround(Math.sin(a) * s * 2);
    const k = Math.fround(s * GROUND_RING_GROW_CEL_SCALE);
    const at: readonly (readonly [number, number])[] =
      [[d, 2 * d], [-d, 2 * d], [d, -2 * d], [-d, -2 * d]];
    at.forEach(([x, z], i) => {
      _m.copy(base).multiply(_b.makeTranslation(x, 0, z))
        .multiply(_b.makeScale(k, k, k));
      drawPart(h, seen, `${key}c${i}`, stripCel(GROUND_RING_STRIP_PHASES[i]),
               _m, null);
    });
    return;
  }

  const k = Math.fround(s * GROUND_RING_CENTRE_CEL_SCALE);
  let sx: number;
  let alpha: number | null = null;
  if (drawn === GroundRingStep.Hold) {
    sx = Math.fround(s * GROUND_RING_WIDTH);
  } else {
    const b = Math.trunc(e.fadeFrames * GROUND_RING_FADE_BAMS)
      * BAMS_TO_RAD_F64;
    sx = Math.fround(Math.cos(b) * s * GROUND_RING_WIDTH);
    alpha = e.alpha;
  }
  drawPart(h, seen, `${key}r`, GROUND_RING_SLOT,
           _m.copy(base).multiply(_b.makeScale(sx, s, sx)), alpha);
  drawPart(h, seen, `${key}c0`, stripCel(0),
           _m.copy(base).multiply(_b.makeScale(k, k, k)), alpha);
}

/** Every ring of the frame, as keys into `seen`. */
export function drawRingEffects(h: RingEffectHost, seen: Set<string>): void {
  for (const e of G.g_ground_rings) drawGroundRing(h, seen, e);
  for (const w of G.g_water_rings) {
    const key = `wr${w.id}`;
    const node = h.node(key, w.slot, h.world);
    if (!node) continue;
    seen.add(key);
    place(node, _m.makeTranslation(w.pos.x, w.pos.y, w.pos.z)
      .multiply(_b.makeScale(w.size, WATER_RING_HEIGHT, w.size)));
    node.renderOrder = WORLD_LAYER_ORDER;
    setSlotAlpha(node, w.alpha);
  }
}

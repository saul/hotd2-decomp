/**
 * Class 0x42's draws -- the worm, every one an `AssetDrawSlot` out of
 * `buyo.bin` through `WormAssetDrawSlot` (`FUN_00430B90`).
 *
 * Each returns world-space matrices, one per draw the routine made this frame,
 * as the product the engine's matrix stack holds at that call -- the same
 * flattening `render/horde.ts` does, read by the same chain arm of
 * `render/slotmodels.ts`. Nothing is decided here: `game/class42/` writes down
 * which draws ran and what each one read (`drawnBody`, `drawnStrip`,
 * `drawnHalves`), because two of the three routines step what they draw from
 * after drawing it.
 */
import { Matrix4 } from "three";
import { BAMS_TO_RAD } from "../core/bams";
import type { Actor } from "../game/actor";
import {
  WormBodyDraw, WormState, type WormHalfDraw, type WormTail,
} from "../game/class42/state";
import { SpawnClass } from "../game/spawn_class";

/** One draw: a slot, the matrix it is drawn under, its alpha. */
export interface WormPart {
  slot: number;
  m: Matrix4;
  /** `AssetDrawSlotWithAlpha`'s second argument; absent for `AssetDrawSlot`. */
  alpha?: number;
}

/** `buyo.bin` 0 -- the worm. */
export const WORM_BODY_SLOT = 0x85a;
/** `buyo.bin` 1 -- its shadow, drawn flattened on the ground at half alpha. */
export const WORM_SHADOW_SLOT = 0x85b;
/** `buyo.bin` 2..26 -- the landing splat, `+ obj+0x1EC`; the lone drop is its first frame. */
export const WORM_SPLAT_SLOT = 0x85c;
/** `buyo.bin` 27 and 28 -- the two halves, `+ half`. */
export const WORM_HALF_SLOT = 0x875;
/** `buyo.bin` 29 -- the cut, drawn under each half's matrix after the half. */
export const WORM_CUT_SLOT = 0x877;
/** `buyo.bin` 32..53 -- the death strip, `+ obj+0x1E8`. */
export const WORM_DEATH_SLOT = 0x87a;
/** `FMUL double ptr [0x004E3108]` and `PUSH 0x3F19999A` -- every draw's 0.6. */
const DRAW_SCALE = 0.6;
/** `FADD float ptr [0x004C4380]` -- the body is drawn a unit up. */
const BODY_LIFT = 1.0;
/** `FADD float ptr [0x004E30F0]` -- the shadow two above the ground... */
const SHADOW_LIFT = 2.0;
/** ...`MatrixScale(1.0, 0.1, 1.0)` on it... */
const SHADOW_FLATTEN = 0.1;
/** ...and `WormAssetDrawSlotWithAlpha(0x85B, 0x3F000000)`. */
const SHADOW_ALPHA = 0.5;

function T(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeTranslation(x, y, z);
}
function RY(b: number): Matrix4 { return new Matrix4().makeRotationY(b * BAMS_TO_RAD); }
function RX(b: number): Matrix4 { return new Matrix4().makeRotationX(b * BAMS_TO_RAD); }
function RZ(b: number): Matrix4 { return new Matrix4().makeRotationZ(b * BAMS_TO_RAD); }
function S(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeScale(x, y, z);
}

function tailOf(a: Actor): WormTail | null {
  return a.cls === SpawnClass.Worm ? a.worm : null;
}

/**
 * One half: `T(pos) Ry(yaw)`, then the track -- or, landed,
 * `T(0, -y, 0) T(t.x, halfY, t.z)` -- then `Rz Ry Rx` by the track's angles
 * and `S(0.6)`. `WormDeathUpdate` (`0x00430D8E`..`0x00430E2A`) and
 * `WormLoneDropUpdate` (`0x004310FB`..`0x00431159`) build the same product.
 */
function halfMatrix(h: WormHalfDraw): Matrix4 {
  const m = T(h.x, h.y, h.z).multiply(RY(h.yaw));
  if (h.landed) {
    m.multiply(T(0, -h.y, 0)).multiply(T(h.t[0], h.halfY, h.t[2]));
  } else {
    m.multiply(T(h.t[0], h.t[1], h.t[2]));
  }
  return m.multiply(RZ(h.r[2])).multiply(RY(h.r[1])).multiply(RX(h.r[0]))
    .multiply(S(DRAW_SCALE, DRAW_SCALE, DRAW_SCALE));
}

/**
 * The draws of one class-0x42 object this frame, or an empty list.
 *
 * * **A member** -- `WormUpdate` (`FUN_0042FCA0`), `0x00430044`..`0x00430A66`:
 *   `M = Ry(yaw) Rx(pitch) S(0.6 * scale)`, bracketed in the splat by
 *   `T(0, 0, -obj+0x1E0)`; the body at `T(x, y + 1, z) M` and the shadow at
 *   `T(x, ground + 2, z) S(1, 0.1, 1) M`.
 * * **The lone drop, whole** -- `WormLoneDropUpdate` (`FUN_00431000`):
 *   `0x85C` at `T(pos) Ry(yaw)`.
 * * **The death strip** -- `WormDeathUpdate` (`FUN_00430C80`):
 *   `0x87A + n` at `T(x, y + 1, z) Ry Rx S(0.6)`.
 * * **The halves** -- both of those routines: see {@link halfMatrix}, two
 *   slots under each.
 */
export function WormDrawParts(a: Actor, out: WormPart[]): WormPart[] {
  out.length = 0;
  const t = tailOf(a);
  if (!t) return out;
  if (t.drawnBody === WormBodyDraw.Member) {
    const splat = t.state === WormState.Splat;
    const k = DRAW_SCALE;
    const m = new Matrix4();
    if (splat) m.multiply(T(0, 0, -t.splatPull));
    m.multiply(RY(a.yaw)).multiply(RX(a.pitch))
      .multiply(S(t.scale.x * k, t.scale.y * k, t.scale.z * k));
    if (splat) m.multiply(T(0, 0, -t.splatPull));
    out.push({
      slot: splat ? WORM_SPLAT_SLOT + t.timer : WORM_BODY_SLOT,
      m: T(a.pos.x, a.pos.y + BODY_LIFT, a.pos.z).multiply(m),
    });
    out.push({
      slot: WORM_SHADOW_SLOT,
      m: T(a.pos.x, t.ground + SHADOW_LIFT, a.pos.z)
        .multiply(S(1, SHADOW_FLATTEN, 1)).multiply(m),
      alpha: SHADOW_ALPHA,
    });
  } else if (t.drawnBody === WormBodyDraw.Lone) {
    out.push({ slot: WORM_SPLAT_SLOT,
               m: T(a.pos.x, a.pos.y, a.pos.z).multiply(RY(a.yaw)) });
  }
  if (t.drawnStrip >= 0) {
    out.push({
      slot: WORM_DEATH_SLOT + t.drawnStrip,
      m: T(a.pos.x, a.pos.y + BODY_LIFT, a.pos.z).multiply(RY(a.yaw))
        .multiply(RX(a.pitch)).multiply(S(DRAW_SCALE, DRAW_SCALE, DRAW_SCALE)),
    });
  }
  for (const h of t.drawnHalves) {
    const m = halfMatrix(h);
    out.push({ slot: WORM_HALF_SLOT + h.half, m });
    out.push({ slot: WORM_CUT_SLOT, m: m.clone() });
  }
  return out;
}

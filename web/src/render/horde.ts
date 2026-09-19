/**
 * Class 0x40's asset-slot draws: the member's ground shadow, the emerge prop,
 * and the splash a member leaves when it dies. The member itself is a
 * skeleton and is `render/characters/horde.ts`'s.
 *
 * Each returns world-space matrices, one per `AssetDrawSlot` the routine
 * makes, as the product the engine's matrix stack holds at that call -- the
 * same flattening `render/owl.ts` does, and read by the same chain arm of
 * `render/slotmodels.ts`. Everything is read off the tail; nothing is decided
 * here that the routine did not leave there.
 */
import { Matrix4 } from "three";
import { BAMS_TO_RAD } from "../core/bams";
import type { Actor } from "../game/actor";
import { G } from "../game/globals";
import {
  EmergePropState, HordeKind, type HordeTail,
} from "../game/class40/state";
import { EMERGE_PROP_RIM_POINTS } from "../game/class40/tables";
import { SpawnClass } from "../game/spawn_class";

/** One draw of a chain: a slot, the matrix it is drawn under, its alpha. */
export interface HordePart {
  slot: number;
  m: Matrix4;
  /** `AssetDrawSlotWithAlpha`'s second argument; 1 for a plain draw. */
  alpha: number;
}

/** `komono_st1b.bin` 12, the prop. */
export const EMERGE_PROP_SLOT = 0x17cc;
/** `common.bin` 200, the member's shadow. */
export const HORDE_SHADOW_SLOT = 0x10d0;
/** `common.bin` 371 and 338..367: the ripple and the splash strip. */
export const HORDE_RIPPLE_SLOT = 0x1a38;
export const HORDE_SPLASH_SLOT = 0x15e4;
export const HORDE_SPLASH_FRAMES = 30;
/** `FILD frame; FMUL 136.53334` -- `0x4000 / 120`. */
const SPLASH_BAMS_PER_FRAME = 136.53334;
/** The prop's lift: drawn three units up its own y while it is flat or lifting. */
const PROP_LIFT_Y = 3.0;
/** The prop's second half: `MatrixScale(1, 1.25, 1)`. */
const PROP_HALF_STRETCH = 1.25;

const _r = new Matrix4();

function T(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeTranslation(x, y, z);
}
function RY(b: number): Matrix4 { return _r.clone().makeRotationY(b * BAMS_TO_RAD); }
function RX(b: number): Matrix4 { return _r.clone().makeRotationX(b * BAMS_TO_RAD); }
function RZ(b: number): Matrix4 { return _r.clone().makeRotationZ(b * BAMS_TO_RAD); }
function S(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeScale(x, y, z);
}

function tailOf(a: Actor): HordeTail | null {
  return a.cls === SpawnClass.HordeSpawner ? a.horde : null;
}

/**
 * The draws of one class-0x40 object this frame, or an empty list.
 *
 * * **A member's shadow** -- `HordeMemberUpdate` (`FUN_0043C440`), after the
 *   sub-model: `T(x, shadowY, z) Ry(yaw) T(0, 0, -1) S(4, 1, 8)`.
 * * **The emerge prop** -- `HordeEmergePropUpdate` (`FUN_0043DD00`), two
 *   halves of slot `0x17CC`. At rest, lifting or falling: `T(pos) Ry Rz Rx`,
 *   three up its own y while flat or lifting, one half, then `Ry(0x8000)
 *   S(1, 1.25, 1)` and the other. Settling on a corner: `T(pivot) Ry Rz Rx
 *   T(-corner) S(1, 1.25, 1)`, one half, `Ry(0x8000)`, the other -- **both**
 *   halves stretched, which is the routine's own order.
 * * **The splash** -- `HordeDeathSplashUpdate` (`FUN_0043E540`):
 *   `a = ftol(n * 136.533)`, the ripple at `S(cos a * s * 3, 1, cos a * s * 3)`
 *   and the strip frame `g_frame_counter % 30` at `sin a * s`; then
 *   `HordeDeathRippleFade` (`FUN_0043E650`), the ripple at `3 s` with alpha
 *   `(40 - m) * 0.025`.
 */
export function HordeDrawParts(a: Actor, out: HordePart[]): HordePart[] {
  out.length = 0;
  const t = tailOf(a);
  if (!t) return out;
  if (t.kind === HordeKind.Member && t.shadow) {
    const m = T(a.pos.x, t.shadowY, a.pos.z).multiply(RY(a.yaw))
      .multiply(T(0, 0, -1)).multiply(S(4, 1, 8));
    out.push({ slot: HORDE_SHADOW_SLOT, m, alpha: 1 });
  } else if (t.kind === HordeKind.EmergeProp) {
    if (t.propState === EmergePropState.Settle) {
      const [rx, ry] = EMERGE_PROP_RIM_POINTS[t.rimPoint] ?? [0, 0];
      const base = T(t.pivotX, t.pivotY, t.pivotZ).multiply(RY(t.propYaw))
        .multiply(RZ(t.propRoll)).multiply(RX(t.propPitch))
        .multiply(T(-rx, -ry, 0)).multiply(S(1, PROP_HALF_STRETCH, 1));
      out.push({ slot: EMERGE_PROP_SLOT, m: base.clone(), alpha: 1 });
      out.push({ slot: EMERGE_PROP_SLOT, m: base.multiply(RY(0x8000)),
                 alpha: 1 });
    } else {
      const base = T(t.propX, t.propY, t.propZ).multiply(RY(t.propYaw))
        .multiply(RZ(t.propRoll)).multiply(RX(t.propPitch));
      if (t.propState === EmergePropState.Wait
          || t.propState === EmergePropState.Lift) {
        base.multiply(T(0, PROP_LIFT_Y, 0));
      }
      out.push({ slot: EMERGE_PROP_SLOT, m: base.clone(), alpha: 1 });
      out.push({ slot: EMERGE_PROP_SLOT,
                 m: base.multiply(RY(0x8000))
                   .multiply(S(1, PROP_HALF_STRETCH, 1)), alpha: 1 });
    }
  } else if (t.kind === HordeKind.Splash) {
    const ang = Math.trunc(t.frame * SPLASH_BAMS_PER_FRAME) * BAMS_TO_RAD;
    const base = T(a.pos.x, a.pos.y, a.pos.z).multiply(RY(a.yaw));
    const c = Math.cos(ang) * t.size * 3.0;
    out.push({ slot: HORDE_RIPPLE_SLOT, m: base.clone().multiply(S(c, 1, c)),
               alpha: 1 });
    const k = Math.sin(ang) * t.size;
    out.push({ slot: HORDE_SPLASH_SLOT
                 + (Math.trunc(G.g_frame_counter) % HORDE_SPLASH_FRAMES),
               m: base.multiply(S(k, k, k)), alpha: 1 });
  } else if (t.kind === HordeKind.Ripple) {
    const k = t.size * 3.0;
    const m = T(a.pos.x, a.pos.y, a.pos.z).multiply(RY(a.yaw))
      .multiply(S(k, 1, k));
    out.push({ slot: HORDE_RIPPLE_SLOT, m, alpha: (40 - t.fade) * 0.025 });
  }
  return out;
}

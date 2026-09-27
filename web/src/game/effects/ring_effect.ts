/**
 * The ring task: a flat ring that opens, holds and closes again as it fades,
 * with the thirty-frame strip standing in it.
 *
 * One 0x13F4-byte object running three routines in turn through `obj[0]`:
 *
 * | routine | frames | ring (`0x1A38`) | strip (`0x15E4 + cel`) |
 * |---|---|---|---|
 * | `RingEffectSpread` | 120 | opens, `4s * cos` of a quarter turn winding down | four of them, `s/2`, closing in from `(+-D, 0, +-2D)` |
 * | `RingEffectHold` | 30 | `4s` | one at the centre, `0.3s` |
 * | `RingEffectFadeOut` | 39 drawn | closes again, `4s * cos` of a quarter turn winding up, fading | one at the centre, `0.3s`, fading |
 *
 * all of it under `T(pos) RotY(yaw)` in draw layer `0xC`, the strip's cel
 * from `g_blink_frame_counter`.
 *
 * Two routines allocate it. `SpawnGroundRingEffect` (`FUN_00407DA0`) puts one
 * under a falling class-0x20 or class-0x30 body at scale 1; its callers are
 * not ported here. `SpawnRingEffectAtPose` takes a six-word pose and a scale,
 * and it is what a class-0x51 fish's corpse makes when it meets the water, and
 * a severed head when it meets the floor.
 *
 * Like every task this runs on the frame it is made, after its maker
 * (`game/effects/owl.ts` says why), so the pool is stepped after the actors
 * and the draw -- `render/creature_effects.ts` -- is of what the step recorded.
 */
import { AppState, G } from "../globals";

/** The engine's `9.587379924285257e-05`, BAMS to radians. */
const BAMS = (Math.PI * 2) / 65536;

/** `AssetDrawSlot(0x1A38)` -- `common.bin` 371. */
export const RING_EFFECT_RING_SLOT = 0x1a38;
/** `0x15E4 + g_blink_frame_counter % 30` -- `common.bin` 338..367. */
export const RING_EFFECT_STRIP_FIRST_SLOT = 0x15e4;
export const RING_EFFECT_STRIP_CELS = 30;
/** `+0x1330 = 0x78`: the spread's frames. */
export const RING_EFFECT_SPREAD_FRAMES = 0x78;
/** `CMP EAX, 0x1E; JNZ` -- the hold's. */
export const RING_EFFECT_HOLD_FRAMES = 0x1e;
/** `CMP EAX, 0x28; JNZ` -- the fade's, the last of which is not drawn. */
export const RING_EFFECT_FADE_FRAMES = 0x28;
/** `[0x004C4C88]` -- 0.05 on the caller's y. */
export const RING_EFFECT_LIFT = 0.05;
/** `[0x004C4CA0]` 4.0, the ring's spread, and `[0x004C4CA8]` 4.0 while it holds. */
export const RING_EFFECT_RING_SPREAD = 4.0;
/** `[0x004C4C98]` 0.5 on the spread's four strips, `[0x004C4C48]` 0.3 after. */
export const RING_EFFECT_STRIP_SPREADING = 0.5;
export const RING_EFFECT_STRIP_SETTLED = 0.3;
/** `[0x004C4C90]` -- -2.0, the far pair's z. */
export const RING_EFFECT_FAR_Z = -2.0;
/**
 * `[0x004C4CA4]` 136.53334 and `[0x004C4CB4]` 409.6: a quarter turn over the
 * spread's 120 frames and the fade's 40. The floats, because `ftol`
 * truncates the product and the exact quotients land on integers.
 */
export const RING_EFFECT_SPREAD_RATE = Math.fround(136.53334);
export const RING_EFFECT_FADE_RATE = Math.fround(409.6);
/** `[0x004C4CB0]` -- 0.025, the fade's step. */
export const RING_EFFECT_FADE_STEP = Math.fround(0.025);
/**
 * The spread's four strips: `g_blink_frame_counter + k` for each, in the
 * order they are drawn -- `(D, 2D)`, `(-D, 2D)`, `(D, -2D)`, `(-D, -2D)`.
 */
export const RING_EFFECT_SPREAD_CEL_OFFSETS = [0, 8, 0x18, 0x10] as const;

/** Which routine is in the task's `obj[0]`. */
export enum RingEffectPhase {
  /** `RingEffectSpread` (`FUN_00407E30`). */
  Spread = 0,
  /** `RingEffectHold` (`FUN_00408100`). */
  Hold = 1,
  /** `RingEffectFadeOut` (`FUN_00408220`). */
  FadeOut = 2,
}

/** One strip the frame drew: its offset in the ring's own frame, and its slot. */
export interface RingEffectStrip {
  x: number;
  z: number;
  slot: number;
}

/** The task. Plain data, so it goes into a snapshot as it is. */
export interface RingEffect {
  /** `[port-only]` -- the engine's identity is the task pointer. */
  id: number;
  /** `+0x40`, `+0x44`, `+0x48` -- world space. */
  x: number;
  y: number;
  z: number;
  /** `+0x68` -- the draw's `RotY`. */
  yaw: number;
  /** `+0x118` -- the scale. */
  scale: number;
  /** `+0x1330` -- the spread's countdown, then the hold's count. */
  count: number;
  /** `+0x1320` -- the fade's count. */
  fade: number;
  /** `+0x1370` -- the fade's alpha, 1.0 from the hold's last frame. */
  alpha: number;
  /** `obj[0]`. */
  phase: RingEffectPhase;
  /**
   * `[port-only]` -- what this frame's routine drew: the ring's x/z scale
   * (its y is always {@link scale}), the strips' scale and where they stood,
   * and the alpha both were drawn at.
   */
  drawnRing: number;
  drawnStrip: number;
  drawnStrips: RingEffectStrip[];
  drawnAlpha: number;
}

/** A pose as `SpawnRingEffectAtPose` reads one: the point and `p[4]`. */
export interface RingEffectPose {
  x: number;
  y: number;
  z: number;
  /** `p[4]`, the pose's second angle -- the yaw. */
  yaw: number;
}

/**
 * `SpawnRingEffectAtPose` — `FUN_00408370`. In app state 6 only.
 *
 * `ActorClearGameFields` zeroes the fade count and the alpha; the hold
 * writes the alpha before the fade reads it.
 */
export function SpawnRingEffectAtPose(p: RingEffectPose, scale: number): void {
  if (G.g_app_state !== AppState.InPlay) return;
  G.g_ring_effects.push({
    id: G.g_creature_effect_seq++,
    x: p.x, y: p.y + RING_EFFECT_LIFT, z: p.z, yaw: p.yaw, scale,
    count: RING_EFFECT_SPREAD_FRAMES, fade: 0, alpha: 0,
    phase: RingEffectPhase.Spread,
    drawnRing: 0, drawnStrip: 0, drawnStrips: [], drawnAlpha: 1,
  });
}

/** `0x15E4 + (g_blink_frame_counter + k) % 30`, an unsigned `DIV`. */
function StripSlot(k: number): number {
  return RING_EFFECT_STRIP_FIRST_SLOT
    + ((G.g_blink_frame_counter + k) >>> 0) % RING_EFFECT_STRIP_CELS;
}

/**
 * `RingEffectSpread` — `FUN_00407E30`.
 *
 * The count comes down first, and at zero the hold is installed -- but this
 * frame still draws the spread, at zero. The ring's x/z is
 * `cos(ftol(n * 136.53))` of the scale times four, the four strips stand at
 * `(+-D, 0, 2D)` and `(+-D, 0, -2D)` with `D = 2s * sin` of the same angle.
 */
export function RingEffectSpread(r: RingEffect): boolean {
  r.count -= 1;
  if (r.count === 0) r.phase = RingEffectPhase.Hold;
  const t = Math.trunc(r.count * RING_EFFECT_SPREAD_RATE) * BAMS;
  const d = Math.sin(t) * r.scale * 2;
  const far = d * RING_EFFECT_FAR_Z;
  const [k0, k1, k2, k3] = RING_EFFECT_SPREAD_CEL_OFFSETS;
  r.drawnRing = Math.cos(t) * r.scale * RING_EFFECT_RING_SPREAD;
  r.drawnStrip = r.scale * RING_EFFECT_STRIP_SPREADING;
  r.drawnStrips = [
    { x: d, z: d * 2, slot: StripSlot(k0) },
    { x: -d, z: d * 2, slot: StripSlot(k1) },
    { x: d, z: far, slot: StripSlot(k2) },
    { x: -d, z: far, slot: StripSlot(k3) },
  ];
  r.drawnAlpha = 1;
  return true;
}

/**
 * `RingEffectHold` — `FUN_00408100`. Thirty frames at the ring's full width;
 * on the thirtieth the fade is installed with its counter at 0 and an alpha
 * of 1, and this frame still draws the hold.
 */
export function RingEffectHold(r: RingEffect): boolean {
  r.count += 1;
  if (r.count === RING_EFFECT_HOLD_FRAMES) {
    r.phase = RingEffectPhase.FadeOut;
    r.count = 0;
    r.alpha = 1.0;
  }
  r.drawnRing = r.scale * RING_EFFECT_RING_SPREAD;
  r.drawnStrip = r.scale * RING_EFFECT_STRIP_SETTLED;
  r.drawnStrips = [{ x: 0, z: 0, slot: StripSlot(0) }];
  r.drawnAlpha = 1;
  return true;
}

/**
 * `RingEffectFadeOut` — `FUN_00408220`. The count reaching forty kills the
 * task **before** anything is drawn; otherwise the alpha falls by 0.025 and
 * the ring closes as `cos(ftol(m * 409.6))` while it fades, the strip beside
 * it at the same alpha.
 */
export function RingEffectFadeOut(r: RingEffect): boolean {
  r.fade += 1;
  if (r.fade === RING_EFFECT_FADE_FRAMES) return false;
  const t = Math.trunc(r.fade * RING_EFFECT_FADE_RATE) * BAMS;
  r.alpha = Math.fround(r.alpha - RING_EFFECT_FADE_STEP);
  r.drawnRing = Math.cos(t) * r.scale * RING_EFFECT_RING_SPREAD;
  r.drawnStrip = r.scale * RING_EFFECT_STRIP_SETTLED;
  r.drawnStrips = [{ x: 0, z: 0, slot: StripSlot(0) }];
  r.drawnAlpha = r.alpha;
  return true;
}

/** `[port-only]` -- the pool, stepped after the actors that made its tasks. */
export function RingEffectsTick(): void {
  if (!G.g_ring_effects.length) return;
  G.g_ring_effects = G.g_ring_effects.filter((r) => {
    switch (r.phase) {
      case RingEffectPhase.Spread: return RingEffectSpread(r);
      case RingEffectPhase.Hold: return RingEffectHold(r);
      case RingEffectPhase.FadeOut: return RingEffectFadeOut(r);
    }
    return false;
  });
}

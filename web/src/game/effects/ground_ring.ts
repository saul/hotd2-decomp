/**
 * The ring a body leaves on the ground as it goes: `SpawnGroundRingEffect`,
 * at `0x00407DA0`.
 *
 * Nine call sites, every one of them a body on its way out of the world --
 * the first frame of class 0x30's two corpse states, class 0x31's two, class
 * 0x20's hand-over into its sink, the frog's and the freed rescue target's.
 * Only in `g_app_state` 6, play: the attract demo's bodies leave none.
 *
 * It allocates a 0x13F4-byte task at the tracked bone's `x`/`z`
 * (`obj+0x100`/`obj+0x108`, {@link Actor.lookAt}) and, for an actor whose
 * {@link MotionFlag.TraceGround} is up, the traced floor under its origin
 * (`QueryGroundHeightAt(x, y + 20, z)`) -- otherwise its own `y` -- plus
 * 0.05. Then three routines run it in turn, each installing the next into the
 * task's own `obj+0x00`:
 *
 * | routine | frames | draws (all under `T(pos) Ry(yaw)`, draw layer 0xC) |
 * |---|---|---|
 * | `RingEffectSpread`, `0x00407E30` | 120 | ring `0x1A38` at `S(cos a * 4, 1, cos a * 4)`, and four cels of `0x15E4` strip at `(+-d, 0, +-2d)`, `d = 2 sin a`, scale 0.5 |
 * | `RingEffectHold`, `0x00408100` | 30 | the ring at `S(4, 1, 4)`, one cel at the centre, scale 0.3 |
 * | `RingEffectFadeOut`, `0x00408220` | 39 | the ring shrinking by `cos`, and the centre cel, both at an alpha falling 0.025 a frame |
 *
 * `a` is `ftol(n * 136.53334)` BAMS, `0x4000 / 120`: a quarter turn at the
 * first frame and none at the last, so the ring **opens** from nothing to four
 * units while the four cels close in on the middle. The cels are
 * `0x15E4 + (g_blink_frame_counter + k) % 30` with `k` 0, 8, 0x18 and 0x10, so
 * each runs the thirty-model strip out of phase with the others. The slots are
 * `common.bin` 371 and 338..367, the same pair `HordeDeathSplashUpdate`
 * (`FUN_0043E540`) draws its splash with.
 *
 * **Each routine steps before it draws**, which is the opposite of the sprite
 * effects: `RingEffectSpread` decrements and *then* draws the ring at the
 * new count, and installs the hold on the frame the count reaches zero --
 * and still draws its own picture that frame. So the state here is the
 * routines' update halves, run after the actor walk that spawned the task
 * (`ActorAlloc` appends it to the walk, which reaches it the same frame), and
 * `render/rings.ts` draws what {@link GroundRingDrawnBy} says ran.
 *
 * A second spawner at `0x00408370` allocates the same task from a six-word
 * pose and a caller's size -- the fish's corpse and the severed head reach it
 * -- and is not this file's; its rings would take the same three routines.
 */
import { MotionFlag, type Actor } from "../actor";
import { QueryGroundHeightAt } from "../coli";
import { AppState, G } from "../globals";
import { vec3, type Vec3 } from "../vec";

/**
 * Which routine the task runs: the engine's `obj+0x00`, which each one
 * replaces with the next (`MOV [ESI], 0x408100` at `0x00407E48`,
 * `MOV [ESI], 0x408220` at `0x0040811A`).
 */
export enum GroundRingStep {
  /** `0x00407E30`, `RingEffectSpread`: what the spawner installs. */
  Spread = 0,
  /** `0x00408100`, `RingEffectHold`. */
  Hold = 1,
  /** `0x00408220`, `RingEffectFadeOut`, which ends in `ActorKill`. */
  FadeOut = 2,
}

/** One ring. Plain data: it goes into a snapshot as it is. */
export interface GroundRingEffect {
  /** `[port-only]` — the engine's identity is the task pointer. */
  id: number;
  /** `obj+0x00` — the routine that runs next. */
  step: GroundRingStep;
  /** `+0x40`/`+0x44`/`+0x48`, world space. */
  pos: Vec3;
  /** `+0x68` — the actor's yaw, BAMS. */
  yaw: number;
  /**
   * `+0x1330` — the grow counts it down from 0x78, the hold up to 0x1E, and
   * the hand-over to the fade zeroes it.
   */
  frames: number;
  /** `+0x1320` — the fade's count, up to 0x28. Zero from the allocation. */
  fadeFrames: number;
  /**
   * `+0x1370` — the fade's alpha. Zero until the hold hands over and writes
   * 1.0; nothing before the fade reads it.
   */
  alpha: number;
  /** `+0x118` — the size every scale is multiplied by. */
  size: number;
}

/** `+0x1330 = 0x78` — the grow's length. */
export const GROUND_RING_GROW_FRAMES = 0x78;
/** `CMP EAX, 0x1E` at `0x00408115` — the hold's. */
export const GROUND_RING_HOLD_FRAMES = 0x1e;
/** `CMP EAX, 0x28` at `0x00408234` — the fade's count dies at this. */
export const GROUND_RING_FADE_END = 0x28;
/** `FSUB [0x004C4CB0]` — `cdcccc3c`, 0.025f, off the alpha a fade frame. */
export const GROUND_RING_FADE_STEP = Math.fround(0.025);
/** `FADD [0x004C4C88]` — `cdcc4c3d`, 0.05f, above the floor. */
export const GROUND_RING_LIFT = Math.fround(0.05);
/** `FADD [0x004C4C8C]` — 20.0, how far above the origin the trace starts. */
export const GROUND_RING_PROBE_RISE = 20.0;
/** `+0x118 = 0x3F800000` — this spawner's size. */
export const GROUND_RING_SIZE = 1.0;

/** `PUSH 0x1A38` — `common.bin` 371, the ring. */
export const GROUND_RING_SLOT = 0x1a38;
/** `ADD EDX, 0x15E4` after `DIV 0x1E` — `common.bin` 338..367. */
export const GROUND_RING_STRIP_SLOT = 0x15e4;
export const GROUND_RING_STRIP_FRAMES = 0x1e;
/**
 * `LEA EAX, [EDX + k]` before the `DIV`: the four grow cels' phases into the
 * strip, in draw order -- `(+d, +2d)`, `(-d, +2d)`, `(+d, -2d)`, `(-d, -2d)`.
 */
export const GROUND_RING_STRIP_PHASES: readonly number[] = [0, 8, 0x18, 0x10];
/** `FMUL [0x004C4CA4]` — `89880843`, 136.53334f, BAMS per grow frame. */
export const GROUND_RING_GROW_BAMS = Math.fround(136.53334);
/** `FMUL [0x004C4CB4]` — `cdcccc43`, 409.6f, BAMS per fade frame. */
export const GROUND_RING_FADE_BAMS = Math.fround(409.6);
/** `FMUL [0x004C4CA0]` — 4.0f, the ring's full width over its size. */
export const GROUND_RING_WIDTH = 4.0;
/** `FMUL double [0x004C4C98]` — 0.5, the grow cels' scale over the size. */
export const GROUND_RING_GROW_CEL_SCALE = 0.5;
/** `FMUL double [0x004C4C48]` — 0.3, the centre cel's. */
export const GROUND_RING_CENTRE_CEL_SCALE = 0.3;

/**
 * `SpawnGroundRingEffect` — `FUN_00407DA0`.
 *
 * The ring goes at `obj+0x100`/`obj+0x108`, the tracked bone's world `x` and
 * `z`, and **not** at the origin: a body lying on its back has its torso some
 * way from its feet, and the ring is under the torso. The height comes from
 * the origin, though, and only through the trace when the actor's
 * {@link MotionFlag.TraceGround} says so.
 */
export function SpawnGroundRingEffect(obj: Actor): void {
  if (G.g_app_state !== AppState.InPlay) return;
  const y = (obj.motionFlags & MotionFlag.TraceGround)
    ? QueryGroundHeightAt(obj.pos.x, obj.pos.y + GROUND_RING_PROBE_RISE,
                          obj.pos.z)
    : obj.pos.y;
  G.g_ground_rings.push({
    id: G.g_ground_ring_seq++,
    step: GroundRingStep.Spread,
    pos: vec3(obj.lookAt.x, Math.fround(y + GROUND_RING_LIFT), obj.lookAt.z),
    yaw: obj.yaw,
    frames: GROUND_RING_GROW_FRAMES,
    fadeFrames: 0,
    alpha: 0,
    size: GROUND_RING_SIZE,
  });
}

/**
 * `RingEffectSpread` — `FUN_00407E30`. `+0x1330 -= 1`, and on the frame
 * it reaches zero the hold is installed for the next one.
 */
export function RingEffectSpread(e: GroundRingEffect): boolean {
  e.frames -= 1;
  if (e.frames === 0) e.step = GroundRingStep.Hold;
  return true;
}

/**
 * `RingEffectHold` — `FUN_00408100`. `+0x1330 += 1`; at thirty the fade
 * is installed, the count zeroed and the alpha set to 1.0 for it.
 */
export function RingEffectHold(e: GroundRingEffect): boolean {
  e.frames += 1;
  if (e.frames === GROUND_RING_HOLD_FRAMES) {
    e.step = GroundRingStep.FadeOut;
    e.frames = 0;
    e.alpha = 1.0;
  }
  return true;
}

/**
 * `RingEffectFadeOut` — `FUN_00408220`. `+0x1320 += 1`, and at forty the
 * task is killed **before** it draws; otherwise the alpha falls by 0.025.
 * Returns false when the task is gone.
 */
export function RingEffectFadeOut(e: GroundRingEffect): boolean {
  e.fadeFrames += 1;
  if (e.fadeFrames === GROUND_RING_FADE_END) return false;
  e.alpha = Math.fround(e.alpha - GROUND_RING_FADE_STEP);
  return true;
}

/**
 * `[port-only]` — which routine drew this frame, read off the record.
 *
 * The engine needs no such question: the routine that stepped is the one
 * that draws, in the same call. The port steps in `game/` and draws in
 * `render/`, and the step may already have installed the next routine -- the
 * grow's last frame leaves `step` on the hold with the count at zero, and
 * the hold's last leaves it on the fade with the fade's count at zero. Both
 * of those are states the successor never draws in (the hold's first frame
 * has counted to one, the fade's likewise), so the counts say which picture
 * the frame was. `null` for a ring that has not run yet.
 */
export function GroundRingDrawnBy(e: GroundRingEffect): GroundRingStep | null {
  switch (e.step) {
    case GroundRingStep.Spread:
      return e.frames < GROUND_RING_GROW_FRAMES ? GroundRingStep.Spread : null;
    case GroundRingStep.Hold:
      return e.frames === 0 ? GroundRingStep.Spread : GroundRingStep.Hold;
    case GroundRingStep.FadeOut:
      return e.fadeFrames === 0 ? GroundRingStep.Hold : GroundRingStep.FadeOut;
  }
  return null;
}

/**
 * `[port-only]` — the task walk's turn for the rings, run after the actors
 * that allocate them. See the file comment for why after.
 */
export function GroundRingsTick(): void {
  const live = G.g_ground_rings;
  if (!live.length) return;
  G.g_ground_rings = live.filter((e) => {
    switch (e.step) {
      case GroundRingStep.Spread: return RingEffectSpread(e);
      case GroundRingStep.Hold: return RingEffectHold(e);
      case GroundRingStep.FadeOut: return RingEffectFadeOut(e);
    }
    return false;
  });
}

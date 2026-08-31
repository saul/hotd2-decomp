/**
 * The arc — how a class-0x31 actor moves.
 *
 * Nothing in this class walks. Every move it makes is a **ballistic arc to a
 * named point over a named number of frames**, with a three-stage motion
 * script laid over it: a windup played on the spot, a flight, and a landing.
 * The pounce, the leap onto a wall, the leap back out of your face and the
 * scripted drop are all the same machine with different destinations and
 * different scripts.
 *
 * The arc itself is a closed form rather than an integrator, which is worth
 * knowing because it means the actor cannot drift: `ActorArcInterpolate`
 * computes the absolute position for frame *n* from the endpoints every time.
 */
import type { ArcStage } from "../../bundle/characters";
import type { Actor } from "../actor";
import { GAME_HZ } from "../class30/states";
import { MotionOf } from "../tables";
import { dist2d, vec3, type Vec3 } from "../vec";
import {
  ARC_MIN_FRAMES, ARC_MIN_FRAMES_FAST, ARC_SPEED_UNITS,
} from "./states";

/**
 * Half the gravity `ThrowerStateFallAndLand` puts in `obj+0x5C`, and the
 * literal `ActorArcInterpolate` carries. Confirmed from the disassembly at
 * `0x00565E1C`: `23 01 df 3c` = `0x3CDF0123`.
 */
export const ARC_GRAVITY_HALF = 0.027222222;

/** `ActorArcBegin` — `FUN_0044DC10`. Record an arc of a known length. */
export function ActorArcBegin(obj: Actor, dest: Vec3, frames: number): void {
  obj.arcFrom = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
  obj.arcTo = { x: dest.x, y: dest.y, z: dest.z };
  obj.arcFrames = 0;
  obj.arcTotal = Math.max(1, Math.trunc(frames));
}

/**
 * `ActorArcBeginTo` — `FUN_0044DC70`. An arc whose length comes from the
 * **2D** distance: `n = (int)(dist2d * step)`, duration `n - n % step`.
 *
 * `step` is the arc's parameter-advance rate, not its kind — see `PathPoint`.
 * Ghidra drops the FPU argument to `__ftol` here and shows the distance as
 * nothing at all.
 */
export function ActorArcBeginTo(obj: Actor, dest: Vec3, step: number): void {
  const n = Math.trunc(dist2d(obj.pos, dest) * step);
  ActorArcBegin(obj, dest, Math.max(step, n - (n % step)));
}

/**
 * `ActorArcBeginToAtSpeed` — `FUN_0044DB50`. The variant character type 0x19
 * takes, and the one that gives `zstin` its pace.
 *
 * The duration is the horizontal distance at a fixed **30 world units per
 * `minFrames`** — 2.0 units a frame ordinarily, 3.0 in the fast case —
 * clamped up to `minFrames`, so a short hop still takes a quarter of a second
 * and a long one is not instant. The divisor 30.0 is `0x0055CCD4`.
 */
export function ActorArcBeginToAtSpeed(obj: Actor, dest: Vec3,
                                       fast = false): void {
  const min = fast ? ARC_MIN_FRAMES_FAST : ARC_MIN_FRAMES;
  const n = Math.trunc(dist2d(obj.pos, dest) / (ARC_SPEED_UNITS / min));
  ActorArcBegin(obj, dest, Math.max(min, n));
}

/**
 * `InstallArcMotionScript` — `FUN_0044DA60`.
 *
 * The engine copies the twelve dwords into `g_arc_scripts[obj+0x3C]`, one slot
 * per enemy slot. It copies rather than points, so the script is per-actor
 * state; the port keeps it on the actor, which is what puts it in a snapshot.
 */
export function InstallArcMotionScript(obj: Actor,
                                       script: ArcStage[] | null): void {
  obj.arcScript = script && script.length ? script : null;
}

/**
 * `ActorArcBeginToWaypoint` — `FUN_0044D780`.
 *
 * Begins the arc and installs the script in one call. Character type 0x19
 * takes `ActorArcBeginToAtSpeed` and ignores `step` entirely; everything else
 * takes `ActorArcBeginTo`.
 *
 * A **null** script is the engine's `&DAT_007DCC70` sentinel — sixty-four zero
 * bytes meaning "no script". In that case the caller wants a fresh attack
 * instead, which `pickAttack` supplies; that is how `ThrowerStateLeapDown`
 * chooses which swing the pounce is.
 */
export function ActorArcBeginToWaypoint(obj: Actor, dest: Vec3,
                                        script: ArcStage[] | null,
                                        step: number,
                                        pickAttack?: () => void): void {
  if (obj.charType === 0x19) ActorArcBeginToAtSpeed(obj, dest);
  else ActorArcBeginTo(obj, dest, step);
  if (script) InstallArcMotionScript(obj, script);
  else pickAttack?.();
  obj.arcPhase = ArcPhase.Windup;
}

/**
 * `ActorArcInterpolate` — `FUN_0044DD00`. The position at frame *n*, exactly.
 *
 * ```
 * x = src.x + (dst.x - src.x) / T * n
 * z = src.z + (dst.z - src.z) / T * n
 * y = src.y + (T*T*g2 + 2*dy) * n / (2T)  -  g2 * n * n * 0.5
 * ```
 *
 * Flat on x and z, a parabola on y that arrives exactly on time. Returns false
 * once the arc is over, which is how the leap states know they have landed.
 */
export function ActorArcInterpolate(obj: Actor, step: number): boolean {
  const T = obj.arcTotal;
  const n = obj.arcFrames;
  if (n >= T + step) return false;
  const dy = obj.arcTo.y - obj.arcFrom.y;
  obj.pos.x = obj.arcFrom.x + ((obj.arcTo.x - obj.arcFrom.x) / T) * n;
  obj.pos.z = obj.arcFrom.z + ((obj.arcTo.z - obj.arcFrom.z) / T) * n;
  obj.pos.y = obj.arcFrom.y
            + ((T * T * ARC_GRAVITY_HALF + dy + dy) * n) / (T * 2)
            - n * n * ARC_GRAVITY_HALF * 0.5;
  obj.arcFrames = n + step;
  return true;
}

/**
 * `ActorArcVelocity` — `FUN_0044DE80`. The same arc as a velocity, for the
 * states that integrate rather than interpolate.
 *
 * `vel.y = -g2*n + (T*T*g2 + 2*dy) / (2*T)` is the derivative of the y term
 * above, which is why the two agree.
 */
export function ActorArcVelocity(obj: Actor): void {
  const T = obj.arcTotal;
  const n = obj.arcFrames;
  const dy = obj.arcTo.y - obj.arcFrom.y;
  obj.vel.x = (obj.arcTo.x - obj.arcFrom.x) / T;
  obj.vel.z = (obj.arcTo.z - obj.arcFrom.z) / T;
  obj.vel.y = -ARC_GRAVITY_HALF * n
            + (T * T * ARC_GRAVITY_HALF + dy + dy) / (T * 2);
}

/** `ActorArcStep`'s five phases, at `obj+0x1360`. */
export enum ArcPhase {
  /** Play stage 0 and hold: the windup happens on the spot. */
  Windup = 0,
  /** Stage 0 is running; the actor has not left the ground. */
  Crouched = 1,
  /** Stage 1, and the flight. */
  Flight = 2,
  /** Stage 2, and the rest of the flight. */
  Landing = 3,
  /** Down. Waiting for the clip to finish. */
  Settled = 4,
}

/**
 * `obj+0x19C` — the clip's frame counter, **at the engine's 60 Hz**, or -1
 * when no one-shot is running.
 *
 * This is the unit every threshold in this class is written in: the attack
 * entries' hit frames, the arc script's stage thresholds, and the clip lengths
 * in `g_anim_frame_counts`. `mot/` is authored at 30 Hz, so the baked clip's
 * own frame index is half of it — reading the baked index here is why the
 * pounce never connected: attack 0's hit frame is 62 and clip 303 bakes to 34
 * keys, so the test could never come true.
 */
export function ActorClipFrame(obj: Actor): number {
  return obj.action ? obj.action.t * GAME_HZ : -1;
}

/** ...and the same clip's length, in the same units. */
export function ActorClipLength(obj: Actor, motion: number): number {
  const m = MotionOf(obj, motion);
  return m ? (m.frames / Math.max(1, m.fps)) * GAME_HZ : 0;
}

function playStage(obj: Actor, stage: ArcStage | undefined): void {
  if (!stage || stage.motion <= 0) return;
  if (!MotionOf(obj, stage.motion)) return;
  obj.action = { motion: stage.motion, t: stage.start / GAME_HZ, loop: false };
  obj.rootActionFrame = -1;
}

/**
 * `ActorArcStep` — `FUN_0044D860`. One frame of an arc, script and all.
 * Returns false once the whole thing — flight *and* clip — is over.
 *
 * [diverges] The engine runs the script's stage timings through a fitter
 * first (`FUN_0044D5F0`, or `FUN_0044E140` for character type 0x19), which
 * rewrites the middle and last stages' start frames, fades and thresholds so
 * the three stages span `obj+0x1334` exactly. The exact arithmetic of those
 * two is `[open]`; here the clip runs at its own rate and the phase advances
 * when the arc does, which puts the landing stage on the landing either way.
 */
export function ActorArcStep(obj: Actor, _step: number,
                             dt: number): boolean {
  const script = obj.arcScript;
  if (!script?.length) return false;
  const frames = dt * GAME_HZ;

  if (obj.arcPhase === ArcPhase.Windup) {
    playStage(obj, script[0]);
    obj.arcPhase = ArcPhase.Crouched;
    return true;
  }
  if (obj.arcPhase === ArcPhase.Crouched) {
    if (ActorClipFrame(obj) < script[0].until) return true;
    playStage(obj, script[1]);
    obj.arcPhase = ArcPhase.Flight;
  }
  if (obj.arcPhase === ArcPhase.Flight) {
    if (!ActorArcInterpolate(obj, frames)) obj.arcPhase = ArcPhase.Settled;
    else if (ActorClipFrame(obj) >= script[1].until) {
      playStage(obj, script[2]);
      obj.arcPhase = ArcPhase.Landing;
    }
    return true;
  }
  if (obj.arcPhase === ArcPhase.Landing) {
    if (ActorArcInterpolate(obj, frames)) return true;
    obj.arcPhase = ArcPhase.Settled;
    // Snap to the point the arc named rather than to wherever the last
    // partial frame left it.
    obj.pos.x = obj.arcTo.x;
    obj.pos.y = obj.arcTo.y;
    obj.pos.z = obj.arcTo.z;
    obj.vel.x = obj.vel.y = obj.vel.z = 0;
    return true;
  }
  // Settled: the arc is down, and the state waits for the landing clip.
  return obj.action !== null && ActorClipFrame(obj) < script[2].until;
}

/**
 * `MatrixTranslate(p); MatrixRotateY(yaw); MatrixTransformPoint(x, y, z)`.
 *
 * A yaw of `t` is the direction `(sin t, 0, cos t)` — the same convention
 * `VecToAngles` inverts — so `(0, 0, d)` is `d` units *forward*.
 */
export function ActorLocalPoint(p: Vec3, yaw: number, x: number, y: number,
                                z: number, out: Vec3): Vec3 {
  const a = (yaw * Math.PI * 2) / 65536;
  const c = Math.cos(a), s = Math.sin(a);
  out.x = p.x + x * c + z * s;
  out.y = p.y + y;
  out.z = p.z - x * s + z * c;
  return out;
}

/** A scratch destination, so the arc helpers allocate nothing per frame. */
export const arcScratch: Vec3 = vec3();

/**
 * The clock: the 60 Hz accumulator, `speed`, and `freeze`, in one place.
 *
 * Every system used to apply its own `dt * speed` at its own call site, and
 * three of them disagreed about what `freeze` meant. This owns all of it and
 * hands out a `Tick` that is already correct.
 */
import type { Tick } from "../core/system";

/** The engine's frame. Motion, hit frames and timers are all counted in it. */
export const TICK = 1 / 60;

/** Runaway guard: a tab that was backgrounded for a minute must not simulate it. */
const MAX_CATCHUP_FRAMES = 600;

export class Loop {
  speed = 1;
  freeze = false;
  /** False while the script is parked at a branch or the player is paused. */
  running = false;

  private accum = 0;
  private last = 0;

  start(now: number): void {
    this.last = now;
  }

  /**
   * Wall time since the last call, clamped. Kept separate from game time
   * because impact sprites and the crosshair are feedback for a click rather
   * than part of the script's clock, and they keep moving while paused.
   */
  wallDelta(now: number): number {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    return dt;
  }

  /**
   * Drain the accumulator, calling `step` once per 60 Hz frame, and return the
   * tick that describes what happened. `step` returns false to stop early —
   * the walker does that when it hits a branch point.
   */
  advance(wall: number, step: () => boolean): Tick {
    if (this.freeze || !this.running) {
      return { dt: 0, frames: 0, wall, frozen: true };
    }
    this.accum += wall * this.speed;
    let frames = 0;
    while (this.accum >= TICK && frames < MAX_CATCHUP_FRAMES) {
      this.accum -= TICK;
      frames++;
      if (!step()) break;
    }
    return { dt: frames * TICK, frames, wall, frozen: false };
  }

  /** A tick that advances nothing — for the frozen and free-roam paths. */
  idle(wall: number): Tick {
    return { dt: 0, frames: 0, wall, frozen: true };
  }
}

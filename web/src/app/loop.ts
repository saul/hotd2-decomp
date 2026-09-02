/**
 * How the player paces ticks and frames.
 *
 * ## The rule
 *
 * **The simulation advances in whole 60 Hz ticks, and a tick is never
 * skipped.** The engine's frame is fixed — `obj+0x19C` counts up by exactly
 * one per game frame, and both camera drivers end on
 * `g_cam_path_frame = __ftol(...)`, an integer that steps by one, which is why
 * an exact-frame cue is safe in the exe. A port that advances by a *fraction*
 * of a frame, or that quietly drops frames when the browser is busy, is not
 * running the same game.
 *
 * It used to do both. `Player.gameTick` handed the port
 * `frames: wall * speed * 60` straight off the rAF delta, so every timer and
 * motion clock integrated a browser-dependent amount, and the same stage on
 * the same seed played four different ways over five runs —
 * `docs/PLAYER_HANGS.md` item 8.
 *
 * ## A tick is not a frame
 *
 * * A **tick** is 1/60 s of game time. The walker, the port, and everything
 *   they own advance only here, and only by exactly one.
 * * A **frame** is one `requestAnimationFrame`: one drawing of the scene. A
 *   display may want 144 of them a second, or 30.
 *
 * One frame runs however many whole ticks the accumulator owes — usually one
 * on a 60 Hz display, usually zero and sometimes one on 144 Hz, several after
 * a stall. Nothing is interpolated between ticks, so a fast display redraws
 * the same simulated state more than once. That is a visual nicety and is
 * deliberately not done yet; the decoupling is what correctness needed, and
 * interpolation would put a second copy of every pose above the engine line.
 *
 * ## A frame that owes no tick must not do part of one
 *
 * The corollary, and it has already cost a bug. `Player.tickStopped` runs the
 * **whole tick order** on `idle`, because the layers that ride wall time —
 * the impact sprites, the crosshair — have to keep moving while the clock is
 * stopped. Every system in that order therefore has to decide for itself
 * whether it has anything to do on a tick with no time in it, and a system
 * that is *half* of a game-time job must answer no.
 *
 * `CameraSeatSystem` did not. It writes the camera block from the rail and
 * `CameraTrackEnemiesTick` eases that block onto the fight, the two either
 * side of the game phase — so on every frame that owed no tick the block went
 * back on the rail, the ease was skipped, and the un-eased aim was drawn. At
 * 60 Hz there are no such frames and nothing showed. At 120 Hz there is one
 * every other frame, and the camera flickered between two aims by up to ten
 * degrees. `test/camera.test.ts` is the guard.
 *
 * ## Owed time is spread, never dropped
 *
 * `wallDelta` is **not** clamped, and the per-frame cap does not discard: a
 * burst larger than `MAX_TICKS_PER_FRAME` leaves the remainder in the
 * accumulator and the next frame runs it. Catch-up is *spread*, never
 * *skipped* — the cap exists only so that one rAF callback cannot block the
 * tab while it simulates a minute.
 *
 * The clamp that used to live in `wallDelta` — `Math.min(0.1, ...)` — was a
 * silent skip. A 500 ms stall lost 400 ms of game time and nothing said so.
 *
 * ## A debt worth dropping is never allowed to form
 *
 * Which is the only reason the previous point is affordable. The clock stops
 * instead of accruing, and `Player` owns both halves:
 *
 * * **the tab is hidden** — the loop stops, and `resume` is called when it
 *   comes back so the time spent in the background is not owed. A backgrounded
 *   tab does not get its minute simulated in one lurch, because it never
 *   banked one.
 * * **paused, or in free roam** — there is no game time to owe, and `Player`
 *   stops asking for frames at all rather than running an empty loop.
 *
 * ## `speed`
 *
 * Scales what goes *into* the accumulator, never the size of a tick. Half
 * speed is half as many ticks a second, each of them still exactly 1/60 s of
 * game time. There is no such thing as a short tick.
 */
import type { Tick } from "../core/system";

/** The engine's frame. Motion, hit frames and timers are all counted in it. */
export const TICK = 1 / 60;

/**
 * The most ticks one frame will run before handing the rest to the next.
 *
 * Not a discard: whatever is left stays in the accumulator. Four seconds of
 * catch-up in one callback is already more than a tab should do at once, and
 * anything past that is a stall we are recovering from rather than a rate.
 */
const MAX_TICKS_PER_FRAME = 240;

export class Loop {
  speed = 1;
  freeze = false;
  /** False whenever game time is not advancing — paused, free roam, no stage. */
  running = false;

  private accum = 0;
  private last = 0;

  start(now: number): void {
    this.last = now;
    this.accum = 0;
  }

  /**
   * The clock was stopped and is starting again.
   *
   * Moves `last` up to now **without** banking the gap, which is what makes
   * "never skip a tick" affordable: the ticks that would have to be skipped
   * are the ones that were never owed. Called when the tab becomes visible
   * again, and whenever the loop wakes from idle.
   */
  resume(now: number): void {
    this.last = now;
  }

  /**
   * Wall time since the last call, unclamped.
   *
   * Kept separate from game time because the impact sprites and the crosshair
   * are feedback for a click rather than part of the script's clock: they
   * keep moving while the transport is paused, and they are the reason a
   * stopped player still asks for frames.
   */
  wallDelta(now: number): number {
    const dt = (now - this.last) / 1000;
    this.last = now;
    return dt;
  }

  /** Whole ticks currently owed. Diagnostic — the sidebar shows it. */
  get owed(): number {
    return Math.floor(this.accum / TICK);
  }

  /**
   * Run every tick this frame owes, calling `step` once per whole 60 Hz tick,
   * and return what happened. `step` returns false to stop early — the walker
   * does that when it finishes a stage.
   *
   * `wall` is the tick's own `wall` when ticks ran: the click feedback that
   * rides wall time is then frame-paced along with everything else, and over
   * any second the two agree because that is what an accumulator is for. When
   * no tick ran, `Player` sends the wall-time systems an `idle` tick carrying
   * the real delta instead, so a paused player's impact sprites still fly.
   */
  advance(wall: number, step: () => boolean): Tick {
    if (this.freeze || !this.running) {
      return { dt: 0, frames: 0, wall, frozen: true };
    }
    this.accum += wall * this.speed;
    let frames = 0;
    while (this.accum >= TICK && frames < MAX_TICKS_PER_FRAME) {
      this.accum -= TICK;
      frames++;
      if (!step()) break;
    }
    return { dt: frames * TICK, frames, wall: frames * TICK, frozen: false };
  }

  /** A tick that advances no game time — for the stopped and frozen paths. */
  idle(wall: number): Tick {
    return { dt: 0, frames: 0, wall, frozen: true };
  }
}

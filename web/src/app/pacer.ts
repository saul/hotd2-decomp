/**
 * The other half of `app/loop.ts`: **who asks for frames, and when.**
 *
 * `loop.ts` is the rule — whole 60 Hz ticks, never skipped, owed time spread
 * rather than dropped. It is a pure accumulator with no idea that a browser
 * exists. This is the machinery that rule needs to be true of a real page: the
 * `requestAnimationFrame` driving, the sleep and the waking, the tab going
 * into the background, and the one place a driver may take the clock over.
 *
 * Read the two together. The division is that **`Loop` decides how much game
 * time a frame owes and `Pacer` decides whether there is a frame at all** —
 * and the second half is the risky one, because a loop that sleeps has to be
 * woken by everything that changes what is on screen, and a waker that is
 * missing does not throw, does not fail a type check and does not fail any
 * headless test. `web/tools/pacing.mjs` drives the real page and asserts the
 * four properties this file is responsible for; it is the only check that can
 * see a missing `wake`.
 *
 * ## A debt worth dropping is never allowed to form
 *
 * Which is the whole reason `Loop` can afford not to clamp. Both halves live
 * here:
 *
 * * **the tab is hidden** — `stopFrames` cancels the outstanding request, and
 *   `wake` calls `Loop.resume` on the way back so the minutes spent in the
 *   background are not owed. A backgrounded tab does not get its minute
 *   simulated in one lurch, because it never banked one.
 * * **paused, or in free roam** — `wantsFrame` answers no and the loop simply
 *   stops asking. There is no empty rAF turning over with nothing in it.
 *
 * ## One clock, and the harness is on it
 *
 * `?drive=1` (`app/harness.ts`) replaces the wall as the thing the accumulator
 * is fed from and changes nothing else: the same `stepOneFrame`, through the
 * same rAF, the same draw and the same publish. That is why the harness is
 * owned here rather than by the composition root — *what the accumulator is
 * fed from* is a pacing question, and it is the only one the URL cannot name.
 *
 * ## What is not here
 *
 * Everything a frame *does*. The scene, the projection, the free-roam camera
 * and the port itself belong to `app/main.ts`, and reach this file as the
 * `PacerHost` hooks below. The split is not by line count: it is that nothing
 * in this file knows what a stage, an actor or a panel is.
 */
import { Loop, TICK } from "./loop";
import { install as installHarness, type DriveTarget, type Harness }
  from "./harness";
import type { Tick } from "../core/system";
import type { PlayerState } from "./urlstate";

/**
 * How often the playing address may be written back to the URL.
 *
 * Safari throttles `history.replaceState` to about one call every 300 ms and
 * throws once a page exceeds it, so this stays comfortably the safe side.
 */
const URL_SYNC_MS = 500;

/**
 * What one driven frame is worth.
 *
 * Whole, and `wall` is `dt`: under the driven clock there is no wall time to
 * be had, so the feedback that rides it — the impact sprites — advances by the
 * same amount as everything else instead of by however long the browser took.
 */
export const DRIVEN_TICK: Tick =
  { dt: TICK, frames: 1, wall: TICK, frozen: false };

/**
 * The same frame with **no game time in it**: the transport is stopped.
 *
 * `Loop.idle(TICK)` by value. A stopped player still runs the whole tick
 * order — the layers that ride wall time have to keep moving — and under the
 * fixed tick the wall it hands them is the tick itself rather than however
 * long the browser took.
 *
 * Shared, like `DRIVEN_TICK`: a `Tick` is a value a system reads and no system
 * writes.
 */
export const STOPPED_TICK: Tick =
  { dt: 0, frames: 0, wall: TICK, frozen: true };

/**
 * What the pacer needs of the player, and nothing else.
 *
 * The three hooks are the three things a frame is made of, in order, and they
 * are named for that rather than for what they happen to contain today. It
 * extends `DriveTarget` because the driven clock and the wall clock reach the
 * same object: `Harness.pump` calls `stepOneFrame` directly, and `Loop.advance`
 * calls the same method through the accumulator.
 */
export interface PacerHost extends DriveTarget {
  /** `?freeze=1` — one frame by definition, and no game time in it. */
  readonly frozen: boolean;
  /** The transport's multiplier. Scales the accumulator's input, never a tick. */
  readonly speed: number;
  /** Is there game time to advance at all? False when paused or in free roam. */
  readonly gameRunning: boolean;
  /** The frame has begun; `wall` is the unclamped delta since the last one. */
  beginFrame(wall: number): void;
  /** One whole 60 Hz tick. False stops the drain — the stage has finished. */
  stepOneFrame(): boolean;
  /** The tick order, with a tick that carries no game time. */
  idleTick(t: Tick): void;
  /** Draw, then publish. Every frame, whether or not it owed a tick. */
  endFrame(): void;
  /** Is there anything for another frame to do? */
  wantsFrame(): boolean;
}

export class Pacer {
  private readonly loop = new Loop();
  /**
   * Who owns the game clock — `app/harness.ts`.
   *
   * Null unless `?drive=1`, and every driven branch below tests it, so the
   * ordinary player has exactly the loop it always had.
   */
  private drive: Harness | null = null;

  /**
   * The frame that has been asked for and not yet run, if there is one.
   *
   * `null` means the loop is asleep. It sleeps whenever nothing wants a frame
   * — paused with no sprites out, or the tab in the background — and anything
   * that changes what is on screen has to `wake` it. That is a real
   * obligation, so the wakers are few and they are all chokepoints:
   * `runCommand`, the keydown handler, `popstate`, `setLoading`, `fail`, a
   * shot, the harness, and the tab becoming visible.
   */
  private rafId: number | null = null;
  /** The rAF timestamp of the frame being run. Only the URL throttle reads it. */
  private frameNow = 0;
  /** The address last written to the URL, and when — see `mayWriteUrl`. */
  private urlSyncKey = "";
  private urlSyncAt = 0;

  constructor(private readonly host: PacerHost) {}

  /**
   * Start the clock, before anything is awaited.
   *
   * Order matters twice. `Loop.start` comes first or the first frame's delta
   * is however long the page took to get here; the harness comes before the
   * first frame, because the first frame is the first one the driver may have
   * to be given.
   *
   * **The tab going into the background stops the clock rather than banking
   * it.** Chrome stops delivering rAF to a hidden tab, so the alternative is
   * one enormous delta on the way back and a lurch of catch-up that never
   * happened to the player. `Loop.resume`, in `wake`, is what makes it not
   * owed.
   */
  start(state: PlayerState): void {
    this.loop.start(performance.now());
    this.drive = installHarness(state, this.host);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stopFrames();
      else this.wake();
    });
    this.wake();
  }

  /**
   * Ask for a frame.
   *
   * Idempotent, and it resumes the clock rather than banking the time the
   * loop spent asleep — a player that was paused for a minute must not
   * simulate the minute when it starts again.
   */
  wake(): void {
    if (this.rafId !== null || document.hidden) return;
    this.loop.resume(performance.now());
    this.rafId = requestAnimationFrame(this.frame);
  }

  /**
   * May the address be written to the URL now?
   *
   * The throttle, and only the throttle: *what* goes in the URL is the
   * composition root's, and this is the half that is about clocks. `key` is
   * the address, so an address that has not moved is not rewritten however
   * long it has been.
   *
   * Driven runs count their own milliseconds and an interactive one uses the
   * rAF timestamp. Nothing reads either back as game time — but a driven run
   * that consulted `performance.now()` for anything at all would have a second
   * clock again, and the whole point of the flag is that it does not.
   */
  mayWriteUrl(key: string): boolean {
    const nowMs = this.drive
      ? this.drive.driven * (TICK * 1000)
      : this.frameNow;
    if (key === this.urlSyncKey || nowMs - this.urlSyncAt < URL_SYNC_MS) {
      return false;
    }
    this.urlSyncKey = key;
    this.urlSyncAt = nowMs;
    return true;
  }

  /**
   * One drawn frame: the ticks it owes, then the draw, then the publish.
   *
   * A frame may run **no** ticks: on a 144 Hz display most of them do not, and
   * a paused player never does. It still draws and still publishes, because
   * the crosshair, the impact sprites and the whole of the UI are answers to a
   * click rather than to a tick.
   */
  private frame = (now: number): void => {
    this.rafId = null;
    this.frameNow = now;
    const wall = this.loop.wallDelta(now);

    this.loop.freeze = this.host.frozen;
    this.loop.speed = this.host.speed;
    this.loop.running = this.host.gameRunning;

    this.host.beginFrame(wall);

    // **One clock, and the harness is on it.** `?drive=1` replaces the wall
    // as the thing the accumulator is fed from and changes nothing else: the
    // ticks below are the same `stepOneFrame`, through the same rAF, the same
    // draw and the same publish. A harness that stepped the world down a path
    // of its own would be proving that path, and the player does not have it.
    const ran = this.drive
      ? this.drive.pump()
      : this.loop.advance(wall, () => this.host.stepOneFrame()).frames;

    // No tick ran, so the systems that ride wall time have not had their
    // frame. The impact sprites are the reason this exists: they are feedback
    // for a click and they must keep flying while the transport is stopped.
    //
    // Never under the drive flag. There is no wall time in a driven run —
    // admitting real milliseconds here would put a browser-dependent number
    // back into exactly the loop the flag exists to take it out of.
    if (!this.drive && ran === 0) this.host.idleTick(this.loop.idle(wall));

    this.host.endFrame();
    // Last, so that what the frame did decides whether there is another one.
    this.schedule();
  };

  /** Keep going only while something wants it. Called at the end of a frame. */
  private schedule(): void {
    if (this.rafId !== null || document.hidden || !this.wantsFrame()) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  /** Stop asking. The tab going into the background is the only caller. */
  private stopFrames(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /**
   * Is there anything for another frame to do?
   *
   * The harness owns the clock, so under the flag it owns the question:
   * between two `advance` calls a driven run is genuinely idle, which is one
   * fewer thing that can happen while a driver is dispatching a click.
   * Otherwise the player answers, and the answer is no more often than it
   * looks.
   */
  private wantsFrame(): boolean {
    if (this.drive) return this.drive.wants;
    return this.host.wantsFrame();
  }
}

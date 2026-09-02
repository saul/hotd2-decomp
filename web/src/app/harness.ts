/**
 * The drive seam: who owns the game clock.
 *
 * `tools/shot.mjs` nominated this file before it existed — *"if one is ever
 * needed for a state the URL cannot name, it goes in `app/harness.ts` and it
 * may do nothing a `UiCommand` cannot."* This is that state, and it is the one
 * the URL genuinely cannot name: **when the next frame happens.**
 *
 * ## Why
 *
 * The player once had two clocks that disagreed about what a frame is, and a
 * playthrough that fired its shots after N *milliseconds* fired them on a
 * different game frame every run: the same stage on the same seed played four
 * different ways over five runs, `docs/PLAYER_HANGS.md` item 8. Both halves
 * are fixed. The simulation is a fixed 60 Hz tick that is never skipped
 * (`app/loop.ts`), and this is the other half — **what the accumulator is fed
 * from.**
 *
 * Ordinarily that is the wall clock. Under `?drive=1` it is the driver, and
 * nothing else changes:
 *
 * * the ticks are the same `Player.stepOneFrame`, through the same rAF, the
 *   same draw and the same publish. The page is the page — the real UI, the
 *   real shot path, the real everything. Nothing is stubbed and nothing is
 *   re-implemented beside it.
 * * **Game time advances only when something calls `advance`**, in whole 60 Hz
 *   ticks, the walker and the port stepping together.
 * * A driver therefore schedules its input by **frame number**. Between two
 *   `advance` calls the game is stopped — and, since `Player.wantsFrame` asks
 *   this harness whether it owes anything, genuinely idle rather than merely
 *   not advancing. A pointer event dispatched there lands at an exact frame
 *   boundary: JS is single-threaded and a pump is one synchronous loop inside
 *   one rAF callback, so nothing can interleave with it.
 *
 * ## What it may do
 *
 * Nothing the UI cannot. Stepping frames is the app's existing Step mode with
 * the count made explicit; reading state is the existing projection plus the
 * same globals the sidebar already shows. It grants no power over the game —
 * there is no "place this actor", no "set this flag", no way in at all. It is
 * a metronome and a tap.
 *
 * ## Inert by default
 *
 * `install` returns null unless `state.drive` is set, `Player` holds null, and
 * every driven branch in `app/main.ts` is `if (this.drive)`. With the flag
 * absent there is no global and no trace buffer, and the loop is fed by the
 * wall exactly as it is for a player.
 */
import { G } from "../game/globals";
import type { Walker } from "../script/walker";
import type { Rng } from "../core/rng";
import type { PlayerState } from "./urlstate";

/** The name the harness answers to on `window`. */
export const DRIVE_GLOBAL = "__hotd2Drive";

/** Bumped when the shape below changes, so a stale tool says so instead of lying. */
export const DRIVE_VERSION = 2;

/**
 * One frame of **game state** and nothing else.
 *
 * No render state, no audio, no wall time — a trace has to be comparable
 * between two runs on two different machines at two different frame rates, and
 * anything derived from drawing is not.
 */
export interface TraceRow {
  /** Driven frames since the harness started counting. */
  f: number;
  /** The walker's address: block, step, instruction index. */
  a: string;
  /** `ctx.rng.state`. The whole generator — see `core/rng.ts`. */
  r: number;
  /** `G.g_frame`, rounded. Fractional here is itself the bug. */
  g: number;
  /** The gate counters, in the order the wait words read them. */
  c: string;
  /** One digest per live actor, sorted by `at` so the pool's order cannot lie. */
  o: string[];
}

/**
 * Position quantisation: 1/4096 of a world unit.
 *
 * Fine enough that a divergence cannot hide behind it for long — an actor that
 * integrates one extra frame of walk moves far more than this — and coarse
 * enough that the trace is a diffable string rather than seventeen digits of
 * float noise.
 */
const Q = 4096;

const q = (v: number): number => Math.round(v * Q);

/** What the harness needs from the player. Deliberately three things. */
export interface DriveTarget {
  /** Advance exactly one whole 60 Hz frame: walker and port together. */
  stepOneFrame(): void;
  /** Ask the loop for a frame. It sleeps when nothing wants one. */
  wake(): void;
  readonly walker: Walker | null;
  readonly rng: Rng;
}

/**
 * The metronome.
 *
 * `advance` does not run the frames itself — it puts them on the counter and
 * waits. `Player.frame` is what drains it, so a driven frame goes through the
 * same rAF, the same render and the same publish an ordinary one does. A
 * harness that stepped the world directly would be testing a code path the
 * player does not have.
 */
export class Harness {
  /** Frames asked for and not yet run. */
  private pending = 0;
  /** Driven frames run since the page loaded. */
  private count = 0;
  private tracing = false;
  private rows: TraceRow[] = [];
  private waiters: Array<() => void> = [];

  /**
   * The most frames one rAF will run.
   *
   * A pump is synchronous, so this is the only thing standing between a
   * driver that asks for a thousand frames and a browser that stops answering.
   * It costs nothing in fidelity: the leftover is run by the next rAF and the
   * driver's promise simply resolves a frame later.
   */
  private static readonly MAX_PER_RAF = 64;

  constructor(private readonly target: DriveTarget) {}

  /** Driven frames run so far — `Player.drivenMs` is the one reader. */
  get driven(): number { return this.count; }

  /**
   * Does the loop owe this harness a frame?
   *
   * `Player.wantsFrame` asks, and between two `advance` calls the answer is
   * no: a driven run is genuinely idle while the driver is dispatching a
   * click, which is one fewer thing that can happen underneath it.
   */
  get wants(): boolean { return this.pending > 0; }

  /** How many frames one rAF owes. Public so a test can read the cap. */
  take(): number {
    return Math.min(this.pending, Harness.MAX_PER_RAF);
  }

  /**
   * Run this rAF's share of what has been asked for. Returns how many.
   *
   * The whole of what `Player.frame` does under the flag, in one call: take,
   * step, trace, book, settle. It lives here rather than in the loop so that
   * the loop cannot get the order wrong and so that this file can be driven
   * headlessly by `test:state`.
   */
  pump(): number {
    const n = this.take();
    this.pending -= n;
    for (let i = 0; i < n; i++) {
      this.target.stepOneFrame();
      // Booked one at a time, and **before** the row is taken: a row is the
      // state frame `f` left behind, so `f` has to be that frame's number and
      // not the number the pump started on. Booking `n` at the end gave every
      // row in one pump the same `f`, which a diff by index survives and a
      // human reading the trace does not.
      this.count += 1;
      if (this.tracing) this.rows.push(this.snapshot());
    }
    // After the frames and before the render, so the promise a driver is
    // waiting on settles a macrotask after this frame's publish.
    this.settle();
    return n;
  }

  /**
   * Everything the driver has been waiting for, if it has all happened.
   *
   * Resolved from a macrotask rather than here: `Player.frame` publishes the
   * projection after the frames run, React commits it on its own schedule, and
   * a driver that reads the HUD the instant the promise settles would race
   * that commit. One `setTimeout` is the cheapest thing that is after it.
   */
  settle(): void {
    if (this.pending > 0 || !this.waiters.length) return;
    const due = this.waiters;
    this.waiters = [];
    setTimeout(() => { for (const w of due) w(); }, 0);
  }

  /**
   * Book `n` frames, and wait for the loop to have run them.
   *
   * Public because `test:state` drives it directly — the gate on the whole
   * seam is `install`, which answers null without the flag, not the reach of
   * one method.
   */
  advance(n: number): Promise<number> {
    const frames = Math.max(0, Math.floor(n));
    this.pending += frames;
    // The loop sleeps when nothing wants a frame, and what this just booked
    // is exactly that. Without it a driver's first `advance` after an idle
    // stretch would wait for a frame nobody was going to ask for.
    this.target.wake();
    return new Promise((ok) => {
      this.waiters.push(() => ok(this.count));
      // Nothing was asked for and nothing is outstanding: settle on the spot,
      // or a driver that asked for zero would wait for a pump that never comes.
      if (this.pending === 0) this.settle();
    });
  }

  /** The current game state, as a row. */
  private snapshot(): TraceRow {
    const w = this.target.walker;
    const live = G.g_object_list.filter((o) => !o.despawned);
    // By `at`, not by pool position. The pool is compacted in place and two
    // runs that despawned in a different order would otherwise diff on the
    // ordering rather than on the state, which is a difference that means
    // nothing and hides one that does.
    live.sort((a, b) => a.at - b.at);
    return {
      f: this.count,
      a: w ? `${w.block}/${w.step}/${w.opIndex}` : "-",
      r: this.target.rng.state >>> 0,
      g: Math.round(G.g_frame),
      c: `e${G.g_enemies_alive} p${G.g_enemies_present} `
       + `v${G.g_civilians_alive} s${G.g_player_score[0]} `
       + `k${G.g_attack_permits.join(",")} t${G.g_attack_committed}`,
      o: live.map((o) =>
        `${o.at} c${o.cls} s${o.state}.${o.sub} h${o.hp}`
        + ` @${q(o.pos.x)},${q(o.pos.y)},${q(o.pos.z)}`
        + ` y${Math.round(o.yaw)}${o.dead ? " dead" : ""}`
        + `${o.visible ? "" : " hidden"}`),
    };
  }

  /** The object a driver talks to. Everything on it is read or "run frames". */
  private get api() {
    return {
      version: DRIVE_VERSION,
      /** Run `n` whole game frames. Resolves with the driven frame count. */
      advance: (n: number) => this.advance(n),
      /** Driven frames run so far. */
      frames: () => this.count,
      /** Start or stop recording a row per driven frame. */
      trace: (on: boolean) => {
        this.tracing = on;
        if (!on) this.rows = [];
      },
      /** Take everything recorded since the last drain. */
      drain: (): TraceRow[] => {
        const out = this.rows;
        this.rows = [];
        return out;
      },
      /** One row for right now, whether or not tracing is on. */
      now: (): TraceRow => this.snapshot(),
    };
  }

  /** Publish it. Only ever called from `install`, only ever under the flag. */
  expose(): void {
    (globalThis as Record<string, unknown>)[DRIVE_GLOBAL] = this.api;
  }
}

/**
 * The whole of the gate.
 *
 * Null unless `?drive=1`, and `Player` stores exactly that — so the driven
 * path is unreachable in ordinary play rather than merely unused.
 */
export function install(state: PlayerState, target: DriveTarget): Harness | null {
  if (!state.drive) return null;
  const h = new Harness(target);
  h.expose();
  return h;
}

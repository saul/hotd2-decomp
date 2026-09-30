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
 * different ways over five runs. Both halves
 * are fixed. The simulation is a fixed 60 Hz tick that is never skipped
 * (`app/loop.ts`), and this is the other half — **what the accumulator is fed
 * from.** `app/pacer.ts` chooses between the two and owns this object; nothing
 * above it knows which clock is running.
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
 *   `advance` calls the game is stopped — and, since `Pacer.wantsFrame` asks
 *   this harness whether it owes anything, genuinely idle rather than merely
 *   not advancing. A pointer event dispatched there lands at an exact frame
 *   boundary: JS is single-threaded and a pump is one synchronous loop inside
 *   one rAF callback, so nothing can interleave with it.
 *
 * ## What it may do
 *
 * Nothing the UI cannot. Stepping frames is Play and Pause with the count
 * made explicit; reading state is the existing projection plus the
 * same globals the sidebar already shows. `advance`'s optional stop
 * condition is Pause pressed on the frame something happened rather than on
 * the next multiple of a driver's stride: it is asked, and it only reads. It
 * grants no power over the game —
 * there is no "place this actor", no "set this flag", no way in at all. It is
 * a metronome and a tap.
 *
 * ## Inert by default
 *
 * `install` returns null unless `state.drive` is set, `Pacer` holds null, and
 * every driven branch in `app/pacer.ts` is `if (this.drive)`. With the flag
 * absent there is no global and no trace buffer, and the loop is fed by the
 * wall exactly as it is for a player.
 */
import { G } from "../game/globals";
import { ShotTestPickedHere } from "../game/combat/shot_test";
import type { Walker } from "../script/walker";
import type { Rng } from "../core/rng";
import type { PlayerState } from "./urlstate";

/** The name the harness answers to on `window`. */
export const DRIVE_GLOBAL = "__hotd2Drive";

/** Bumped when the shape below changes, so a stale tool says so instead of lying. */
export const DRIVE_VERSION = 4;

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
  /**
   * Advance exactly one whole 60 Hz frame: walker and port together. False
   * says the stage has finished, which ends this rAF's share early -- see
   * {@link Harness.pump}.
   */
  stepOneFrame(): boolean | void;
  /** Ask the loop for a frame. It sleeps when nothing wants one. */
  wake(): void;
  readonly walker: Walker | null;
  readonly rng: Rng;
  /**
   * A world point through the camera the trigger casts through, in normalised
   * device coordinates (`x`, `y` in -1..1 across the viewport, `z` < 1 in
   * front of the lens). Optional: a target with no camera answers nothing,
   * and {@link Harness.shotTargets} is then empty.
   */
  projectWorld?(p: { x: number; y: number; z: number }):
    { x: number; y: number; z: number } | null;
}

/**
 * One entry of the shot-test list, where it is on the screen: `at` and the
 * class, and `obj+0x70..0x78` (`Actor.shotCentre`) through the camera in
 * normalised device coordinates. What a driver aims a pull at.
 */
export interface ShotTarget {
  at: number;
  cls: number;
  x: number;
  y: number;
  /** Depth, NDC: in front of the lens and inside the far plane when < 1. */
  z: number;
  /**
   * A thrown weapon, by its id in `g_thrown_weapons`, rather than an actor.
   * `at` is then its thrower and `cls` is -1: the weapon has no class.
   */
  thrown?: number;
}

/**
 * The metronome.
 *
 * `advance` does not run the frames itself — it puts them on the counter and
 * waits. `Pacer.frame` is what drains it, so a driven frame goes through the
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
   * `[port-only]` The driver's stop condition, asked after every frame a pump
   * runs; true drops whatever is still owed. See {@link Harness.advance}.
   */
  private until: (() => boolean) | null = null;

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

  /** Driven frames run so far — `Pacer.mayWriteUrl` is the one reader. */
  get driven(): number { return this.count; }

  /**
   * Does the loop owe this harness a frame?
   *
   * `Pacer.wantsFrame` asks, and between two `advance` calls the answer is
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
   * The whole of what `Pacer.frame` does under the flag, in one call: take,
   * step, trace, book, settle. It lives here rather than in the loop so that
   * the loop cannot get the order wrong and so that this file can be driven
   * headlessly by `test:state`.
   */
  pump(): number {
    const n = this.take();
    this.pending -= n;
    let ran = 0;
    for (let i = 0; i < n; i++) {
      const more = this.target.stepOneFrame();
      ran += 1;
      // Booked one at a time, and **before** the row is taken: a row is the
      // state frame `f` left behind, so `f` has to be that frame's number and
      // not the number the pump started on. Booking `n` at the end gave every
      // row in one pump the same `f`, which a diff by index survives and a
      // human reading the trace does not.
      this.count += 1;
      if (this.tracing) this.rows.push(this.snapshot());
      // The frame it stops on is the one this rAF then draws and publishes,
      // so a driver that stops on a moment reads -- and screenshots -- that
      // moment as the page rendered it.
      if (this.until && this.stopHere(this.until)) {
        this.pending = 0;
        break;
      }
      // A finished stage ends the rAF's share, as it ends the accumulator's
      // drain undriven (`Loop.advance`): the next stage's load starts from
      // the page between two rAFs, and a pump that ran on through a
      // finished stage would step it in a world the player never has. The
      // rest stays owed, so the driver's count is still the count it gets.
      if (more === false) {
        this.pending += n - ran;
        break;
      }
    }
    if (this.pending === 0) this.until = null;
    // After the frames and before the render, so the promise a driver is
    // waiting on settles a macrotask after this frame's publish.
    this.settle();
    return ran;
  }

  /**
   * Ask a stop condition. One that throws stops the run and says so on the
   * console, where every driver counts a fault: thrown out of here it would
   * take the rAF callback with it, and the driver would wait for ever on a
   * promise nothing settles.
   */
  private stopHere(until: () => boolean): boolean {
    try {
      return until();
    } catch (e) {
      console.error(`drive: the stop condition threw: ${String(e)}`);
      return true;
    }
  }

  /**
   * Everything the driver has been waiting for, if it has all happened.
   *
   * Resolved from a macrotask rather than here: `Pacer.frame` publishes the
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
   * Book `n` frames, and wait for the loop to have run them -- or, given
   * `until`, for the first frame after which it answers true, whichever
   * comes first.
   *
   * `until` is for a driver that must act on the frame something happens --
   * a pull when the aim is on a bone, a screenshot when a draw first appears
   * -- so that it can book frames by the hundred rather than two at a time.
   * Each frame is the same `stepOneFrame` either way; what it saves is the
   * rAF a short stride pays for every stride, which was the whole of a boss
   * fight's wall time (`tools/boss5_page.mjs`). One condition at a time: the
   * latest `advance` sets it, and a run that ends clears it.
   *
   * Public because `test:state` drives it directly — the gate on the whole
   * seam is `install`, which answers null without the flag, not the reach of
   * one method.
   */
  advance(n: number, until?: () => boolean): Promise<number> {
    const frames = Math.max(0, Math.floor(n));
    this.pending += frames;
    this.until = frames > 0 ? until ?? null : null;
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
       + `k${G.g_attack_permits.join(",")} t${G.g_attack_committed}`
       // `b` is the creatures `znjoe` has released. They are not actors and
       // so are in none of `o` below, while `e` and `p` above **count them**
       // -- so without this a driven run reads a live enemy it cannot see and
       // a room that will not clear for a reason nothing in the row explains.
       + ` b${G.g_body_creatures.length}`
       // `cp` is the props state-37 zombies carry: routine, hit points and the
       // view depth of the shot point, for the same reason -- a pool the actor
       // rows below cannot show. See `game/carried_prop.ts`.
       + ` cp[${G.g_carried_props.map((p) =>
           `${p.routine}:${p.hp}:${Math.round(p.shotPoint.z)}`).join(",")}]`,
      o: live.map((o) =>
        `${o.at} c${o.cls} s${o.state}.${o.sub} h${o.hp}`
        + ` @${q(o.pos.x)},${q(o.pos.y)},${q(o.pos.z)}`
        + ` y${Math.round(o.yaw)}${o.dead ? " dead" : ""}`
        + `${o.visible ? "" : " hidden"}`),
    };
  }

  /**
   * `G.g_shot_test_list`, on the screen.
   *
   * The list is what the engine's shot test walks (`RegisterForShotTest`,
   * `FUN_00405160`): an object on it is one a pull *can* hit this frame, at
   * the point its class published at `obj+0x70`. A driver that cannot see the
   * actors sprays a grid and walks past a boss's handful of spheres; this is
   * the same information the game itself uses, read, not a new decision.
   * Every registered object is on the list -- the crowd push reads it too --
   * but only the ones the port's own pick tests (`ShotTestPickedHere`) are
   * offered here, so a driver aims at the same set it always has.
   */
  shotTargets(): ShotTarget[] {
    const out: ShotTarget[] = [];
    const project = this.target.projectWorld?.bind(this.target);
    if (!project) return out;
    for (const e of G.g_shot_test_list) {
      if (e.thrown !== undefined) {
        const w = G.g_thrown_weapons.find((x) => x.id === e.thrown);
        const p = w ? project(w.pos) : null;
        if (!p) continue;
        out.push({ at: e.at, cls: -1, x: p.x, y: p.y, z: p.z,
                   thrown: e.thrown });
        continue;
      }
      const obj = G.g_object_list.find((o) => o.at === e.at);
      if (!obj || !ShotTestPickedHere(obj)) continue;
      const p = project(obj.shotCentre);
      if (!p) continue;
      out.push({ at: obj.at, cls: obj.cls, x: p.x, y: p.y, z: p.z });
    }
    return out;
  }

  /** The object a driver talks to. Everything on it is read or "run frames". */
  private get api() {
    return {
      version: DRIVE_VERSION,
      /**
       * Run `n` whole game frames, or fewer when `until`, asked after each,
       * answers true. Resolves with the driven frame count.
       */
      advance: (n: number, until?: () => boolean) => this.advance(n, until),
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
      /** Where every registered shot-test object is on screen. */
      shotTargets: (): ShotTarget[] => this.shotTargets(),
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
 * Null unless `?drive=1`, and `Pacer` stores exactly that — so the driven
 * path is unreachable in ordinary play rather than merely unused.
 */
export function install(state: PlayerState, target: DriveTarget): Harness | null {
  if (!state.drive) return null;
  const h = new Harness(target);
  h.expose();
  return h;
}

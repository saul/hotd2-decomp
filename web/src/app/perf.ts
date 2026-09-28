/**
 * The perf meter: what a frame costs, measured on the device it runs on.
 *
 * Written because the player was close to unplayable on an iPhone 17 Pro
 * Max -- a phone faster than the desktop it plays well on -- and nothing a
 * desktop browser could measure said why. So the meter runs where the problem
 * is, shows itself over the game, and in a dev build reports what it saw back
 * to the dev server, where it can be read without the phone in hand.
 *
 * It answers one question first: **is the time ours, the GPU's, or
 * neither?**
 *
 * * `busy` is the page's own work in a frame, from the top of the frame
 *   callback to the end of the publish. High busy is JavaScript, and the
 *   sections say where: the script, the game systems, the render systems, the
 *   HUD (the world's four phases, summed over the frame's ticks, with the
 *   costliest systems named), the matrix walk, `renderer.render` -- which is
 *   WebGL submission, CPU side -- and the UI publish.
 * * `gpu≈` is a wait for the GPU to finish a frame, sampled now and then by
 *   reading one pixel back after the render -- **only with `?gpu=1`**. It
 *   stalls the frame it samples, and on an iPhone the first readings showed
 *   a frame four times a second arriving 80 ms late on a page drawing
 *   nothing, at about the rate the sample ran: a probe that may be making the
 *   stutter it measures does not run by default.
 * * **Low fps with both small** is neither: the browser's compositor, CSS
 *   effects over the canvas, or the display's own cap (Low Power Mode holds
 *   iOS at 30).
 *
 * The A/B switches are URL parameters, so a phone can try one without a
 * rebuild: `?perf=1` turns the meter on, `aa=0` drops MSAA, `shadows=0` the
 * gun lights' shadow maps, `blur=0` every `backdrop-filter` over the game,
 * `gpu=1` turns the GPU sample on. They are experiments, not settings: nothing saves
 * them, and the meter says which are on.
 */
import type { Phase, SystemProbe } from "../core/world";
import type { PerfProjection } from "../ui/projection";

/** How long one readout covers. */
const WINDOW_MS = 500;
/** A gap longer than this is the loop asleep, not a slow frame. */
const ASLEEP_MS = 250;
/** Frames this far apart or more count as long. */
const LONG_MS = 25;
/** One GPU sample every this many frames. */
const GPU_EVERY = 20;
/** Sections, in loop order. The four phases come from the world's probe. */
const SECTIONS = ["script", "game", "render", "hud", "matrices", "draw",
                  "publish", "other"] as const;
export type Section = typeof SECTIONS[number];

/** The A/B switches read off the URL. See the note above. */
export interface Experiments {
  perf: boolean;
  aa: boolean;
  shadows: boolean;
  blur: boolean;
  gpu: boolean;
}

export function readExperiments(search: string): Experiments {
  const q = new URLSearchParams(search);
  const off = (k: string) => q.get(k) === "0";
  return {
    perf: q.get("perf") === "1",
    aa: !off("aa"), shadows: !off("shadows"), blur: !off("blur"),
    gpu: q.get("gpu") === "1",
  };
}

function describeExperiments(e: Experiments): string {
  return [...(["aa", "shadows", "blur"] as const)
    .filter((k) => !e[k]).map((k) => `${k}=0`), ...(e.gpu ? ["gpu=1"] : [])]
    .join(" ");
}

const round = (ms: number) => Math.round(ms * 10) / 10;

function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export class PerfMeter implements SystemProbe {
  private on = false;
  readonly experiments: Experiments;

  // -- this frame -----------------------------------------------------------
  private frameAt = 0;
  private lastFrameAt = 0;
  private ticksNow = 0;
  private gpuNow = 0;
  private readonly secNow = new Map<Section, number>();
  private readonly sysNow = new Map<string, number>();

  // -- this window ----------------------------------------------------------
  private windowAt = 0;
  private frames = 0;
  private ticks = 0;
  private readonly intervals: number[] = [];
  private readonly busy: number[] = [];
  private readonly secSum = new Map<Section, number>();
  private readonly secMax = new Map<Section, number>();
  private readonly sysSum = new Map<string, number>();
  private gpuMs: number | null = null;
  private sinceGpu = 0;
  /** Texture and program counts at the last frame, for the uploads. */
  private lastTextures = -1;
  private lastPrograms = -1;
  private texNew = 0;
  private progNew = 0;
  /** The frame with the most work in the window, said in one line. */
  private worstBusy = 0;
  private worst = "";

  /** The latest readout, replaced once a window. */
  snapshot: PerfProjection | null = null;
  /** Called with each new readout. `app/` posts them to the dev server. */
  onSnapshot: ((p: PerfProjection) => void) | null = null;

  constructor(experiments: Experiments) {
    this.experiments = experiments;
  }

  get enabled(): boolean { return this.on; }

  setEnabled(on: boolean): void {
    this.on = on;
    this.snapshot = null;
    this.resetWindow(performance.now());
    this.lastFrameAt = 0;
  }

  now = (): number => performance.now();

  /** `SystemProbe`: one system's update, filed under its phase. */
  took(id: string, phase: Phase, ms: number): void {
    this.sysNow.set(id, (this.sysNow.get(id) ?? 0) + ms);
    this.secNow.set(phase, (this.secNow.get(phase) ?? 0) + ms);
  }

  /** Time spent in one section this frame. */
  add(section: Section, ms: number): void {
    this.secNow.set(section, (this.secNow.get(section) ?? 0) + ms);
  }

  tick(): void {
    this.ticksNow += 1;
  }

  beginFrame(): void {
    const t = performance.now();
    if (this.lastFrameAt) {
      const gap = t - this.lastFrameAt;
      if (gap < ASLEEP_MS) this.intervals.push(gap);
    }
    this.lastFrameAt = t;
    this.frameAt = t;
    this.ticksNow = 0;
    this.gpuNow = 0;
    this.secNow.clear();
    this.sysNow.clear();
  }

  /** Should this frame be the one that waits for the GPU? */
  wantsGpuSample(): boolean {
    if (!this.experiments.gpu) return false;
    this.sinceGpu += 1;
    if (this.sinceGpu < GPU_EVERY) return false;
    this.sinceGpu = 0;
    return true;
  }

  gpu(ms: number): void {
    this.gpuNow = ms;
    this.gpuMs = this.gpuMs === null ? ms : this.gpuMs * 0.6 + ms * 0.4;
  }

  endFrame(gl: PerfProjection["gl"], view: () => string): void {
    const t = performance.now();
    // What this frame uploaded: a texture is created on the GPU the first
    // time something drawn uses it, and a program the first time a material
    // is drawn -- both synchronous, both in `draw`.
    const tex = this.lastTextures < 0 ? 0 : Math.max(0, gl[3] - this.lastTextures);
    const prog = this.lastPrograms < 0 ? 0 : Math.max(0, gl[2] - this.lastPrograms);
    this.lastTextures = gl[3];
    this.lastPrograms = gl[2];
    this.texNew += tex;
    this.progNew += prog;
    const busy = t - this.frameAt - this.gpuNow;
    let known = 0;
    for (const v of this.secNow.values()) known += v;
    this.secNow.set("other", Math.max(0, busy - known));
    this.frames += 1;
    this.ticks += this.ticksNow;
    this.busy.push(busy);
    if (busy > this.worstBusy) {
      this.worstBusy = busy;
      let top: [string, number] = ["other", 0];
      for (const [k, v] of this.secNow) if (v > top[1]) top = [k, v];
      this.worst = `${round(busy)} ms, ${top[0]} ${round(top[1])}`
        + (tex ? ` · +${tex} tex` : "") + (prog ? ` · +${prog} prog` : "")
        + (this.ticksNow > 1 ? ` · ×${this.ticksNow} ticks` : "");
    }
    for (const [k, v] of this.secNow) {
      this.secSum.set(k, (this.secSum.get(k) ?? 0) + v);
      this.secMax.set(k, Math.max(this.secMax.get(k) ?? 0, v));
    }
    for (const [k, v] of this.sysNow) {
      this.sysSum.set(k, (this.sysSum.get(k) ?? 0) + v);
    }
    if (t - this.windowAt >= WINDOW_MS) {
      this.snapshot = this.readout(t, gl, view());
      this.onSnapshot?.(this.snapshot);
      this.resetWindow(t);
    }
  }

  private readout(t: number, gl: PerfProjection["gl"],
                  view: string): PerfProjection {
    const n = Math.max(1, this.frames);
    const iv = [...this.intervals].sort((a, b) => a - b);
    const awake = iv.reduce((s, v) => s + v, 0);
    const busy = [...this.busy].sort((a, b) => a - b);
    return {
      fps: Math.round(awake > 0 ? (iv.length * 1000) / awake
                                : (this.frames * 1000) / (t - this.windowAt)),
      frame: [round(quantile(iv, 0.5)), round(quantile(iv, 0.95)),
              round(iv[iv.length - 1] ?? 0)],
      long: iv.filter((v) => v > LONG_MS).length,
      busy: [round(busy.reduce((s, v) => s + v, 0) / n),
             round(busy[busy.length - 1] ?? 0)],
      ticks: round(this.ticks / n),
      sections: SECTIONS.map((s) => [s, round((this.secSum.get(s) ?? 0) / n),
                                     round(this.secMax.get(s) ?? 0)] as const),
      systems: [...this.sysSum]
        .map(([id, ms]) => [id, round(ms / n)] as const)
        .sort((a, b) => b[1] - a[1]).slice(0, 5),
      gpu: this.gpuMs === null ? null : round(this.gpuMs),
      uploads: [this.texNew, this.progNew],
      worst: this.worst,
      gl, view,
      experiments: describeExperiments(this.experiments),
    };
  }

  private resetWindow(t: number): void {
    this.windowAt = t;
    this.frames = 0;
    this.ticks = 0;
    this.intervals.length = 0;
    this.busy.length = 0;
    this.secSum.clear();
    this.secMax.clear();
    this.sysSum.clear();
    this.texNew = 0;
    this.progNew = 0;
    this.worstBusy = 0;
    this.worst = "";
  }
}

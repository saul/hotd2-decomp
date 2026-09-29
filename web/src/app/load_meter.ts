/**
 * How far a stage load has got, for the loading screen.
 *
 * A load is four steps: the download (the stage glTF, its script and its
 * cameras, fifty to ninety megabytes, all three at once), three.js's parse of
 * the glTF, building the stage's layers from it, and compiling the shaders.
 * Only the download can count as it goes; the parse holds the main thread
 * throughout, and the last two are short. So the bar moves with the bytes,
 * waits through the parse, and finishes.
 *
 * Each step's share of the bar is a compromise, not a measurement of any one
 * device. Stage 1 in Chrome throttled to a phone's CPU and 40 Mbit/s spent
 * 29% of its load downloading, 68% parsing, 2% building and 1% compiling;
 * unthrottled on a LAN the download is 13%. A phone's own Wi-Fi puts more on
 * the download than either, and a bar that crawls through the part it can
 * count and then sits reads better than the reverse. It never goes backwards.
 */
import type { LoadingProjection } from "../ui/projection";

export type LoadStep = "download" | "unpack" | "build" | "shaders";

const STEPS: Record<LoadStep, { label: string; from: number; share: number }> = {
  download: { label: "Downloading", from: 0, share: 0.5 },
  unpack: { label: "Unpacking the stage", from: 0.5, share: 0.4 },
  build: { label: "Building the stage", from: 0.9, share: 0.07 },
  shaders: { label: "Compiling shaders", from: 0.97, share: 0.03 },
};

const mb = (bytes: number): string => (bytes / 1e6).toFixed(1);

export class LoadMeter {
  private step: LoadStep = "download";
  private shown = 0;

  constructor(private readonly title: string,
              private readonly show: (p: LoadingProjection) => void) {}

  /** A step begins, with no figures yet. */
  begin(step: LoadStep): void {
    this.step = step;
    // Where the shares come from: `load:<step>` marks on the page's timeline.
    performance.mark(`load:${step}`);
    this.report(0, STEPS[step].label);
  }

  /** The load is over: the last mark, for measuring the one before it. */
  done(): void {
    performance.mark("load:done");
  }

  /** The download's bytes: `total` is 0 until every file has said its size. */
  bytes(loaded: number, total: number): void {
    const label = STEPS[this.step].label;
    this.report(total ? loaded / total : 0, total
      ? `${label} · ${mb(loaded)} of ${mb(total)} MB` : `${label} · ${mb(loaded)} MB`);
  }

  private report(fraction: number, detail: string): void {
    const s = STEPS[this.step];
    const f = Math.min(1, Math.max(0, fraction));
    this.shown = Math.max(this.shown, s.from + s.share * f);
    this.show({ text: this.title, failed: false, progress: this.shown, detail });
  }
}

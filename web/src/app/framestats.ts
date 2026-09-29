/**
 * The FPS badge's numbers: every drawn frame's interval and the page's own
 * work in it, over the last second.
 *
 * Always on, because it is two numbers a frame into a ring -- unlike the perf
 * meter (`perf.ts`), which times every section of a frame and runs only when
 * asked. The badge reads a summary at most twice a second, so turning it on
 * does not make the UI publish a new projection every frame.
 */
import type { FpsProjection } from "../ui/projection";

/** Frames kept: two seconds at 120 Hz. */
const SIZE = 240;
/** What a summary covers. */
const WINDOW_MS = 1000;
/** A gap longer than this is the loop asleep, not a slow frame. */
const ASLEEP_MS = 250;
/** How often the summary is remade. */
const REFRESH_MS = 500;

export class FrameStats {
  private readonly at = new Float64Array(SIZE);
  private readonly gap = new Float64Array(SIZE);
  private readonly work = new Float64Array(SIZE);
  private next = 0;
  private filled = 0;
  private last = NaN;
  private summary: FpsProjection | null = null;
  private summaryAt = -Infinity;

  /** One drawn frame: its rAF time and the page's work in it, ms. */
  add(now: number, work: number): void {
    const gap = now - this.last;
    this.last = now;
    // The first frame after a sleep says nothing about the frame rate.
    if (!(gap > 0) || gap > ASLEEP_MS) return;
    this.at[this.next] = now;
    this.gap[this.next] = gap;
    this.work[this.next] = work;
    this.next = (this.next + 1) % SIZE;
    if (this.filled < SIZE) this.filled++;
  }

  /**
   * The last second, remade at most every {@link REFRESH_MS}. `net` is the
   * netplay tick cost to show beside it, when there is a session.
   */
  read(now: number, net: number | null): FpsProjection | null {
    if (this.summary && now - this.summaryAt < REFRESH_MS
        && this.summary.net === net) return this.summary;
    let n = 0, gapSum = 0, low = Infinity, high = 0, workSum = 0, workHigh = 0;
    for (let k = 0; k < this.filled; k++) {
      const i = (this.next - 1 - k + SIZE) % SIZE;
      if (now - this.at[i] > WINDOW_MS) break;
      const g = this.gap[i];
      n++;
      gapSum += g;
      if (g < low) low = g;
      if (g > high) high = g;
      workSum += this.work[i];
      if (this.work[i] > workHigh) workHigh = this.work[i];
    }
    this.summaryAt = now;
    if (n === 0) {
      this.summary = null;
      return null;
    }
    const avg = gapSum / n;
    this.summary = {
      fps: Math.round(1000 / avg),
      frame: [round(low), round(avg), round(high)],
      work: [round(workSum / n), round(workHigh)],
      net,
      // Late: a frame more than twice the average's time, or work that cannot
      // fit a 60 Hz frame.
      level: high > 50 || avg > 25 ? "bad" : high > 2 * avg + 4 || workHigh > 16 ? "warn" : "ok",
    };
    return this.summary;
  }
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

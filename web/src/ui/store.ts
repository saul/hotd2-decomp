/**
 * The one thing React subscribes to.
 *
 * `app/` calls `publish` with a fresh projection whenever the frame produced a
 * different one; React reads it through `useSyncExternalStore`, which is the
 * hook that exists precisely for state living outside React. The player's
 * clock stays the render loop's — this does not schedule anything, it only
 * says "there is a new value".
 *
 * The `revision` on the projection is what decides whether to notify at all.
 * A 60 Hz redraw of a sidebar that has not changed is the cost this avoids,
 * and it is why `app/` builds the projection cheaply and compares rather than
 * letting React diff a few hundred rows sixty times a second.
 */
import type { UiProjection } from "./projection";
import type { Dispatch, UiCommand } from "./commands";

/**
 * The slices that are expensive enough to be worth not building.
 *
 * A closed set, because each one is a real cost with a name: `globals` walks
 * every global and every actor and formats them all, `actors` groups the pool
 * by class, `wait` resolves what the script is blocked on. Everything else in
 * the projection is a handful of fields and is always built.
 */
export type UiSlice = "wait" | "actors" | "globals";

export class UiStore {
  private current: UiProjection | null = null;
  private readonly listeners = new Set<() => void>();
  private handler: Dispatch = () => {};
  private readonly demands = new Map<UiSlice, number>();

  /** `app/` installs the one thing that knows what a command means. */
  onCommand(h: Dispatch): void {
    this.handler = h;
  }

  dispatch: Dispatch = (c: UiCommand) => {
    this.handler(c);
  };

  /** New projection. Cheap when nothing changed: same object, no notify. */
  publish(next: UiProjection): void {
    if (this.current && this.current.revision === next.revision) return;
    this.current = next;
    for (const l of this.listeners) l();
  }

  // -- demand -------------------------------------------------------------

  /**
   * "Something is showing this slice." Returns the release.
   *
   * Counted rather than a flag, because two panels may want the same slice
   * and because strict mode mounts an effect twice on purpose — a flag would
   * be cleared by the first unmount and the slice would go dark under a panel
   * that is still open.
   *
   * Call this from an effect. Called during render it is taken twice and
   * released once, and the count never returns to zero: `app/` then builds an
   * expensive slice for a panel nobody has open, for the rest of the session,
   * silently.
   */
  demand(slice: UiSlice): () => void {
    this.demands.set(slice, (this.demands.get(slice) ?? 0) + 1);
    return () => {
      const left = (this.demands.get(slice) ?? 1) - 1;
      if (left > 0) this.demands.set(slice, left);
      else this.demands.delete(slice);
    };
  }

  /** What `app/` asks instead of asking the document. */
  wants = (slice: UiSlice): boolean => (this.demands.get(slice) ?? 0) > 0;

  // -- the useSyncExternalStore contract ---------------------------------

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };

  /**
   * Must return the **same reference** while nothing has changed, or React
   * loops for ever. That is why `publish` swaps the object rather than
   * mutating it.
   */
  getSnapshot = (): UiProjection | null => this.current;
}

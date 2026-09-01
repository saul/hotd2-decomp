/**
 * The one thing React subscribes to.
 *
 * `app/` calls `publish` with a fresh projection whenever the frame produced a
 * different one; React reads it through `useSyncExternalStore`, which is the
 * hook that exists precisely for state living outside React. The player's
 * clock stays the render loop's — this does not schedule anything, it only
 * says "there is a new value".
 *
 * Whether to notify at all is decided by **identity**. `app/` runs each frame's
 * projection through `stabilise` (`app/projection/stable.ts`), which returns
 * the previous value unchanged when nothing moved and otherwise keeps every
 * slice that did not — so this handles both cases with one `===`.
 *
 * What the listeners do with that is `ui/useSlice.ts`'s business: each one is a
 * component reading the single field it draws, and a field whose content has
 * not moved is the same object it was last frame, so React finds nothing to do
 * for it. That is why there is one `publish` and no per-slice notification
 * here — the fan-out is the projection's reference stability, not a second
 * subscription table this would have to keep in step.
 *
 * What this replaces is a `revision` counter over a `JSON.stringify` of the
 * whole projection. That was all-or-nothing: one field moving re-rendered
 * every panel, because every slice was a fresh object.
 */
import type { UiProjection } from "./projection";
import type { Dispatch, UiCommand } from "./commands";

/**
 * The slices that are expensive enough to be worth not building.
 *
 * A closed set, because each one is a real cost with a name: `globals` walks
 * every global and every actor and formats them all, `actors` groups the pool
 * by class, `wait` resolves what the script is blocked on, `rigs` walks every
 * instance in the stage — 335 of them in stage 2. Everything else in
 * the projection is a handful of fields and is always built.
 */
export type UiSlice = "wait" | "actors" | "globals" | "rigs";

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
    if (this.current === next) return;
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

  /**
   * The same value, for a render with no browser behind it.
   *
   * `useSyncExternalStore` asks for this separately because a server has no
   * subscription to fall back on. There is no server here — what uses it is
   * `web/test/ui.test.tsx`, which renders the chrome to a string and is the
   * only check that the page has the shape the stylesheet expects.
   */
  getServerSnapshot = (): UiProjection | null => this.current;
}

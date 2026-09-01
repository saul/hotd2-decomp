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

export class UiStore {
  private current: UiProjection | null = null;
  private readonly listeners = new Set<() => void>();
  private handler: Dispatch = () => {};

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

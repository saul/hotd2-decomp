/**
 * The action ring: `g_queued_events_pending` and the `cam_play` that owns it.
 *
 * `queue_event` (0x30) adds one for every action it queues and every action
 * handler takes it back when it completes. `wait_queued_events_done` (0x40)
 * blocks while the count is non-zero, so a leak here parks the script for
 * good — which is exactly what happened before `supersede` existed.
 *
 * The count and the outstanding `cam_play` are one mechanism and not two. The
 * engine runs the ring **one action at a time**: a second `cam_play` queued
 * behind a first does not start until the first retires. This client runs an
 * action the moment it is queued, so a shot being replaced *is* the previous
 * action completing, and a shot reaching its end frame is too. Keeping the
 * flag next to the count is what makes those two facts impossible to write
 * down inconsistently.
 */

/** What the ring needs to know about the shot the camera is on. */
export interface RingCamera {
  done: boolean;
  isStatic: boolean;
}

export class ActionRing {
  /** `g_queued_events_pending` — `0x009A2C8C`. */
  pending = 0;
  /** Whether the outstanding action is a `cam_play` still playing. */
  camPending = false;

  reset(): void {
    this.pending = 0;
    this.camPending = false;
  }

  /** `queue_event` (0x30): one more action outstanding. */
  queued(): void {
    this.pending += 1;
  }

  /** The shot the ring is now driving. */
  claimCamera(): void {
    this.camPending = true;
  }

  /**
   * One action handler completing: the `pending--` every one of them ends on.
   *
   * The engine lets this go negative and `wait_queued_events_done` tests
   * `!= 0`, so a negative count there would park for ever. It cannot happen in
   * the shipped scripts, but a skipped `queue_event` does not queue while its
   * `goto_scene_state` still retires — so the floor is kept.
   */
  retire(): void {
    if (this.pending > 0) this.pending -= 1;
  }

  /** `set_action_drain_mode`'s signed `pending += delta`. */
  add(delta: number): void {
    if (delta < 0) {
      // A negative delta is the script retiring an action by hand, and the one
      // it means is the `cam_play` still playing -- 0x33 is what cuts a shot
      // short so the `finish_sequence` queued behind it can start.
      this.camPending = false;
    }
    this.pending = Math.max(0, this.pending + delta);
  }

  /**
   * Retire an outstanding `cam_play` because something has taken the camera
   * off it.
   *
   * Without this the count leaks, and it leaks precisely where nothing is
   * ticking — `seek` and `stepOnce` run instructions without a clock, so a
   * block's worth of `cam_play`s all set `camPending` and only the last can
   * ever be retired. A reload into such an address then parked for ever on
   * the next `wait_queued_events_done`.
   */
  supersede(): void {
    if (!this.camPending) return;
    this.camPending = false;
    this.retire();
  }

  /**
   * Retire the `cam_play` whose path has just finished.
   *
   * `CamAdvancePathFrame` does this itself on the frame the path ends, so it
   * has to happen wherever the camera can reach its end — the clock in `tick`,
   * and the skip, which ends the move where it stands.
   */
  settle(cam: RingCamera | null): void {
    if (!this.camPending) return;
    if (!cam || cam.done || cam.isStatic) {
      this.camPending = false;
      this.retire();
    }
  }

  /** A block change abandons whatever the ring still owed. */
  abandon(): boolean {
    const leaked = this.pending !== 0;
    this.pending = 0;
    this.camPending = false;
    return leaked;
  }
}

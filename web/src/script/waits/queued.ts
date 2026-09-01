/**
 * `wait_queued_events_done` (0x40).
 *
 * `EvtOpWaitQueuedEventsDone40` is `g_queued_events_pending == 0`, and the
 * port keeps that count for real. It used to resolve on "the camera move
 * ended", which is the same answer in the common shape — a lone `cam_play`
 * followed by this wait — but not when a `finish_sequence` is outstanding
 * behind the shot.
 */
import type { WaitPolicy } from "../walker";
import type { WaitContext, WaitRule } from "./types";

export const waitQueuedEvents: WaitRule = {
  ops: [0x40],
  skippable: true,
  enter(_op, ctx: WaitContext): WaitPolicy {
    ctx.settleCameraAction();
    return ctx.queuedEventsPending === 0
      ? { kind: "passed", why: "the action ring is empty" }
      : { kind: "queued" };
  },
  satisfied(_policy, _op, ctx: WaitContext): boolean {
    ctx.settleCameraAction();
    return ctx.queuedEventsPending === 0;
  },
};

/**
 * `wait_queued_events_done` (0x40).
 *
 * `EvtOpWaitQueuedEventsDone40` is `g_queued_events_pending == 0`, and the
 * port keeps that count for real. It used to resolve on "the camera move
 * ended", which is the same answer in the common shape — a lone `cam_play`
 * followed by this wait — but not when a `finish_sequence` is outstanding
 * behind the shot.
 *
 * **It reads the count; it does not retire anything.** Both arms below used to
 * call `settleCameraAction` first, which made the gate fall through on the very
 * frame the camera path ended — and the engine cannot do that, because the
 * retirement happens in `EvtRunQueuedActions`, a task that runs *after*
 * `EvtInterpreterLoop`. Retiring from inside the wait put the next `cam_play`
 * on the camera before `syncPortGlobals` had published the frame the last one
 * ended on, and every class-0x30 entrance whose cue is that exact frame waited
 * for the rest of the stage. `Walker.tick` settles the action after the
 * interpreter, which is where the engine settles it.
 */
import type { WaitPolicy } from "../walker";
import type { WaitContext, WaitRule } from "./types";

export const waitQueuedEvents: WaitRule = {
  ops: [0x40],
  skippable: true,
  enter(_op, ctx: WaitContext): WaitPolicy {
    return ctx.queuedEventsPending === 0
      ? { kind: "passed", why: "the action ring is empty" }
      : { kind: "queued" };
  },
  satisfied(_policy, _op, ctx: WaitContext): boolean {
    return ctx.queuedEventsPending === 0;
  },
};

/**
 * `wait_queued_events_done` (0x40).
 *
 * `EvtOpWaitQueuedEventsDone40` (`FUN_0045FA80`):
 *
 * ```c
 * if (!skip) {
 *     if (g_queued_events_pending != 0) { g_evt_yield = 1; return; }
 *     if (!g_evt_gameplay_live) return;
 * }
 * pc += 4;
 * ```
 *
 * The one wait with no first-visit yield: an empty ring passes on the frame
 * it is reached. It reads the count and retires nothing -- the actions retire
 * themselves in `EvtRunQueuedActions`, inside `CameraActorTick`, a task after
 * the interpreter's, so a shot that ends this frame lets the wait through on
 * the next. And it needs `g_evt_gameplay_live`: with nothing pending it still
 * returns without advancing while the gate is shut, which is the continue
 * screen holding the script here. `[proved]`
 */
import type { WaitPolicy } from "../walker";
import type { WaitContext, WaitRule } from "./types";

export const waitQueuedEvents: WaitRule = {
  ops: [0x40],
  skippable: true,
  drainsQueuedActions: true,
  enter(_op, ctx: WaitContext): WaitPolicy {
    return ctx.queuedEventsPending === 0 && ctx.gameplayLive()
      ? { kind: "passed", why: "the action ring is empty" }
      : { kind: "queued" };
  },
  satisfied(_policy, _op, ctx: WaitContext): boolean {
    return ctx.queuedEventsPending === 0 && ctx.gameplayLive();
  },
};

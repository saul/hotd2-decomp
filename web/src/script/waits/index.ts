/**
 * The wait rules, by opcode.
 *
 * A wait with no rule here does not block — `passedBecause` says why, from
 * `WAIT_NOTES`. That is the honest default: an unread wait is one this client
 * cannot evaluate, and pretending to wait for it would stall playback on a
 * condition nothing can satisfy.
 */
import type { WaitRule } from "./types";
import { waitCameraPathFrame, waitFrames } from "./frames";
import { waitQueuedEvents } from "./queued";
import { waitEnemiesAlive, waitScriptedActors } from "./enemies";
import { waitScriptFlag } from "./flag";

const RULES: readonly WaitRule[] = [
  waitFrames, waitCameraPathFrame, waitQueuedEvents,
  waitEnemiesAlive, waitScriptedActors, waitScriptFlag,
];

/**
 * The rules by opcode, with the same duplicate check `ops/` and
 * `state/camera_action.ts` carry: `new Map(entries)` keeps the last of two
 * entries for one key and says nothing, and two rules claiming one wait is a
 * gate evaluated by the rule that happens to be listed second.
 */
export const WAIT_RULES: ReadonlyMap<number, WaitRule> = (() => {
  const byOp = new Map<number, WaitRule>();
  for (const rule of RULES) {
    for (const op of rule.ops) {
      if (byOp.has(op)) {
        throw new Error(`duplicate wait rule for opcode 0x${op.toString(16)}`);
      }
      byOp.set(op, rule);
    }
  }
  return byOp;
})();

export { passedBecause, WAIT_NOTES } from "./types";
export type { WaitContext, WaitRule } from "./types";

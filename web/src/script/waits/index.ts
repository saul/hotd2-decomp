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

export const WAIT_RULES: ReadonlyMap<number, WaitRule> = new Map(
  RULES.flatMap((r) => r.ops.map((op) => [op, r] as const)),
);

export { passedBecause, WAIT_NOTES } from "./types";
export type { WaitContext, WaitRule } from "./types";

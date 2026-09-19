/**
 * `wait_targets_clear` (0x47) — the camera has nothing left to look at.
 *
 * ```c
 * // EvtOpWaitTargetsClear47 — FUN_0045FD20
 * if (g_evt_yield == 0) { g_evt_yield = 1; return; }
 * if (g_evt_gameplay_live
 *     && (g_camera_settled || g_camera_free)
 *     && g_camera_candidate_count == 0) {
 *   g_evt_yield = 0; pc += 4;
 * }
 * ```
 *
 * `g_camera_candidate_count` (`0x009CA93C`) is how many objects called
 * `RegisterForCameraTracking` (`FUN_00408EC0`) this frame, which is every
 * committed enemy **and every carried prop in the air or on the lens**
 * (`game/carried_prop.ts`). So the gate holds while anything is still coming
 * at the player — stage 3 block 3 step 6's second drum-thrower is still
 * waiting for the permit the first drum holds when the camera reaches the end
 * of its shot, and this is what keeps the camera on the bridge until it has
 * thrown.
 *
 * It used to pass on sight (`WAIT_NOTES` said "needs the runtime"), and the
 * script left for block 4 with a zombie still standing on the bridge holding
 * its drum.
 *
 * `g_evt_gameplay_live` (`0x007DCCA4`) is not modelled, for the reason
 * `waits/flag.ts` gives. `[open]`
 */
import type { OpJson } from "../../bundle";
import { G } from "../../game/globals";
import type { WaitPolicy } from "../walker";
import { passedBecause, type WaitContext, type WaitRule } from "./types";

/**
 * The condition itself, off the port's globals: what the player's walker host
 * answers `cameraTargetsClear` with.
 */
export function CameraTargetsClear(): boolean {
  return (G.g_camera_settled !== 0 || G.g_camera_free !== 0)
    && G.g_camera_candidate_count === 0;
}

export const waitTargetsClear: WaitRule = {
  ops: [0x47],
  enter(op: OpJson, ctx: WaitContext): WaitPolicy {
    // A host with no camera and no pool cannot answer, and passes -- the same
    // contract the enemy gates keep for the walker-only harnesses.
    if ((ctx.host.cameraTargetsClear?.() ?? null) === null) {
      return passedBecause(op);
    }
    // The first-visit yield: the condition is not read on this frame.
    return { kind: "targets" };
  },
  satisfied(_policy, _op: OpJson, ctx: WaitContext): boolean {
    return ctx.host.cameraTargetsClear?.() ?? true;
  },
};

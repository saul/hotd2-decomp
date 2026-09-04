/**
 * The two waits that count down: `wait_frames` (0x42) and
 * `wait_camera_path_frame` (0x41).
 *
 * Both produce a `frames` policy, because both are answered by the same
 * clock — the difference is only where the count comes from.
 */
import type { OpJson } from "../../bundle";
import type { WaitPolicy } from "../walker";
import type { WaitContext, WaitRule } from "./types";

export const waitFrames: WaitRule = {
  ops: [0x42],
  skippable: true,
  enter(op: OpJson): WaitPolicy {
    return { kind: "frames", framesLeft: op.arg ?? 0 };
  },
  satisfied(policy: WaitPolicy): boolean {
    return policy.kind !== "frames" || policy.framesLeft <= 0;
  },
};

export const waitCameraPathFrame: WaitRule = {
  ops: [0x41],
  skippable: true,
  // Stepping past this one is a claim about where the camera is. See
  // `WaitRule.skipRunsCameraOn`.
  skipRunsCameraOn: true,
  enter(op: OpJson, ctx: WaitContext): WaitPolicy {
    // Operand 0 means "to the end of the path"; otherwise wait until the path
    // frame passes the operand.
    const arg = op.arg ?? 0;
    const target = arg === 0 ? ctx.cam?.endFrame ?? 0 : arg;
    const left = ctx.cam ? Math.max(0, target - ctx.cam.frame) : 0;
    return { kind: "frames", framesLeft: left };
  },
  satisfied: waitFrames.satisfied,
};

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
    // frame **passes** the operand, and passes is strict.
    //
    // `EvtOpWaitCameraPathFrame41` (`FUN_0045FAC0`), the two arms:
    //
    // ```
    // 0045fadb  MOV  EAX,[0x009c7108]        ; the instruction
    // 0045fae0  MOV  EAX,[EAX + 4]           ; ...its operand
    // 0045fae3  CMP  EAX,ECX / JZ 0045fb03   ; operand 0 -> the other arm
    // 0045fae7  CMP  dword ptr [0x009a6110],EAX
    // 0045faed  JLE  0045fb29                ; frame <= operand: keep waiting
    //
    // 0045fb03  CMP  dword ptr [0x009c6f28],ECX
    // 0045fb09  JG   0045fb29                ; frames left > 0: keep waiting
    // ```
    //
    // So the operand form needs `g_cam_path_frame > operand` — frame
    // `operand + 1` — and `runCameraOnPast` already says so for the seek's
    // half of the same rule (`Math.min(arg + 1, ...)`). This read the
    // operand itself, so the live wait released one frame before the seek's
    // postcondition put the camera, and the instructions behind it ran a
    // frame early. Stage 2's block 9 is what that cost: the step's
    // `wait_camera_path_frame 384` let `finish_sequence 4` freeze the camera
    // on 384, so frame **385** — a stashed play's last, and the cue a
    // civilian's killed stream waits on with an equality — was never
    // published, and `wait_script_flag 3` behind it held for ever.
    //
    // Measured before transcribing, because a strict wait that cannot be
    // satisfied is a hang: across the shipped scripts, of the
    // `wait_camera_path_frame <n>` sites that have a play in force, **none**
    // names the last frame its own play publishes.
    const arg = op.arg ?? 0;
    const target = arg === 0 ? ctx.cam?.endFrame ?? 0 : arg + 1;
    const left = ctx.cam ? Math.max(0, target - ctx.cam.frame) : 0;
    return { kind: "frames", framesLeft: left };
  },
  satisfied: waitFrames.satisfied,
};

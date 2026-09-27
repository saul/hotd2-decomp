/**
 * The two clock waits: `wait_frames` (0x42) and
 * `wait_camera_path_frame` (0x41).
 *
 * `wait_frames` counts its own frames; `wait_camera_path_frame` reads the
 * camera's words in `G` every frame, as the engine's does.
 */
import type { OpJson } from "../../bundle";
import { G } from "../../game/globals";
import type { WaitPolicy } from "../walker";
import type { WaitRule } from "./types";

/**
 * `EvtOpWaitFrames42` — `FUN_0045FB30`:
 *
 * ```c
 * if (skip) { pc += 8; return; }
 * if (g_evt_yield == 0) { counter = operand; g_evt_yield = 1; return; }     // the first visit
 * if ((counter < 0 || --counter < 0) && g_evt_gameplay_live) { g_evt_yield = 0; pc += 8; }
 * ```
 *
 * The counter is loaded on the visit that yields and decremented *before* it
 * is tested, so the instruction behind `wait_frames n` runs `n + 1` frames
 * after the one the wait was reached on. `[proved]`
 */
export const waitFrames: WaitRule = {
  ops: [0x42],
  skippable: true,
  enter(op: OpJson): WaitPolicy {
    return { kind: "frames", framesLeft: (op.arg ?? 0) + 1 };
  },
  satisfied(policy: WaitPolicy): boolean {
    return policy.kind !== "frames" || policy.framesLeft <= 0;
  },
};

/**
 * `EvtOpWaitCameraPathFrame41` — `FUN_0045FAC0`:
 *
 * ```c
 * if (!skip) {
 *     if (g_evt_yield == 0) { g_evt_yield = 1; return; }       // the first visit
 *     if (g_evt_gameplay_live) {
 *         if (operand == 0) { if (g_cam_path_frames_left < 1) goto pass; }
 *         else if (operand < g_cam_path_frame) goto pass;
 *     }
 *     return;
 * }
 * pass: g_evt_yield = 0; pc += 8;
 * ```
 *
 * Operand 0 is "the shot's last frame is out", anything else "the path has
 * **passed** the operand", strictly. Both read the camera's words as the
 * camera tasks left them on the frame before -- the interpreter runs first --
 * and neither is read on the frame the wait is reached. `[proved]`
 *
 * Measured before transcribing, because a strict wait that cannot be
 * satisfied is a hang: across the shipped scripts, of the
 * `wait_camera_path_frame <n>` sites that have a play in force, **none**
 * names the last frame its own play publishes.
 */
export const waitCameraPathFrame: WaitRule = {
  ops: [0x41],
  skippable: true,
  // Stepping past this one is a claim about where the camera is. See
  // `WaitRule.skipRunsCameraOn`.
  skipRunsCameraOn: true,
  enter(op: OpJson): WaitPolicy {
    return { kind: "camera", arg: op.arg ?? 0 };
  },
  satisfied(policy: WaitPolicy): boolean {
    if (policy.kind !== "camera") return true;
    return policy.arg === 0
      ? G.g_cam_path_frames_left < 1
      : G.g_cam_path_frame > policy.arg;
  },
};

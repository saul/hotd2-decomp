/**
 * `[port-only]` A harness's invented camera, put where the game reads one.
 *
 * `GameUpdate` used to be handed an eye, and every class measured to it. It
 * is not any more: a routine reads the eye its instruction names from `G` --
 * `g_camera_eye` (`0x009C71E0`), the gameplay eye the scene state's hook
 * writes, or a camera block's (`0x009A60C0`, or the block `g_camera_index`
 * names). A harness that runs no camera path has neither written, so it puts
 * its one point in all of them before each frame, as the eye it used to pass
 * stood in for all of them. A hook or a camera driver the harness does run
 * overwrites them inside the frame, which is the engine's precedence.
 *
 * Harness-only: nothing under `src/` may call this. A test that means to
 * check which eye a routine reads drives the camera's own hooks instead.
 */
import { G } from "../../src/game/globals";

export function SeatHarnessEye(eye: { x: number; y: number; z: number }): void {
  for (const e of [G.g_camera_eye, G.g_camera_block_eye, G.g_camera_block2_eye]) {
    e.x = eye.x;
    e.y = eye.y;
    e.z = eye.z;
  }
}

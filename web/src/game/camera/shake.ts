/**
 * The screen shake's nod: the first block of `UpdateSceneViewAndLight`
 * (`FUN_00401F40`), which is where the engine turns `g_screen_shake_pitch`
 * into a camera that looks somewhere else.
 *
 * ```
 * if (block == g_camera_index) {
 *   MatrixLoadIdentity()
 *   MatrixTranslate(block.eye)
 *   MatrixRotateY(block.yaw); MatrixRotateX(block.pitch)     -- no roll
 *   p = M * (0, (float)g_screen_shake_pitch, -1000)
 *   CamBlockSetAnglesFromLookAt(block, p, block.roll)        -- FUN_00403AC0
 * }
 * ...then the view matrix is built from the block's (new) angles.
 * ```
 *
 * So the camera is re-aimed at a point a thousand units ahead of it and
 * `pitch` units up **in its own un-rolled frame**, keeping its roll. The shake
 * is a vertical nod of `atan(pitch / 1000)`: 47 units at its first frame is
 * 2.7 degrees, decaying linearly and swinging every 10.7 frames
 * (`UpdateScreenShake`, `FUN_00415270`).
 *
 * ## It does not accumulate, where a hit can happen `[proved]`
 *
 * The routine overwrites the block's **angles** and leaves its eye and its
 * look-at target alone. Every camera routine that runs during play re-derives
 * the angles from eye and target each frame with the same
 * `CamBlockSetAnglesFromLookAt`: `CameraTrackEnemiesTick` (at `0x00402964`,
 * unconditionally), `CamAdvancePathFrame` (`0x0040363E`),
 * `CameraStepRailTick` (`0x0040C812`) and `CameraPlayStashedPath`
 * (`0x0040C932`). So each frame's nod is applied to an un-nodded aim, and
 * the port -- whose block *is* eye and target, from which the draw builds the
 * orientation every frame -- is the same statement. A strike needs scene
 * state 2 (`IsPlayerAttackable`), and under row 2 one of those routines owns
 * the camera.
 *
 * `[open]` Under a camera that does *not* re-derive the angles -- a row-1
 * view-angle turn, or the no-op hook -- a shake still running would compound
 * frame on frame. That needs a scene change inside the 47 frames after a hit
 * and is not modelled: the port has no separate angle store to compound in.
 *
 * Run by the engine at the end of `GameUpdate` ({@link SceneViewApplyShake})
 * and only read by the draw, so a no-tick frame (the 120 Hz draw between two
 * game ticks) shows exactly what the tick before it left.
 */
import { G } from "../globals";
import type { Vec3 } from "../vec";

/** `MOV [ESP+0x34], 0xC47A0000` — the look distance, -1000 on the camera's z. */
export const SHAKE_LOOK_DISTANCE = 1000.0;

/**
 * `[port-only]` — the nodded look-at point for a camera at `eye` looking at
 * `target`, written into `out`. With `pitch` 0 it is the direction of
 * `target` itself, a thousand units out.
 *
 * The un-rolled frame is the one `MatrixRotateY` then `MatrixRotateX` build
 * with +Y up and -Z forward, which is `Matrix4.lookAt(eye, target, +Y)`'s
 * frame too: right = forward x up, up' = right x forward. Straight up or down
 * the frame is undefined; this takes +Z as up there, which is the fallback
 * `render/campath.ts`'s `applyPose` uses, so the nod and the draw agree.
 *
 * The camera's own +Y is screen-up in the exe as in three.js: `BuildShotRay`
 * (`FUN_00406110`) unprojects `(g_crosshair_x, g_crosshair_y, -640.21)`, and
 * `g_crosshair_y` counts up from the centre of the screen (the crosshair is
 * drawn at `240 - g_crosshair_y`). So a positive pitch lifts the aim.
 */
export function ShakeNodLookAt(eye: Vec3, target: Vec3, pitch: number,
                               out: Vec3): Vec3 {
  let fx = target.x - eye.x, fy = target.y - eye.y, fz = target.z - eye.z;
  const n = Math.hypot(fx, fy, fz);
  if (n < 1e-9) { fx = 0; fy = 0; fz = -1; } else { fx /= n; fy /= n; fz /= n; }
  // right = f x up, with up = +Y, or +Z when looking straight up or down.
  let rx: number, ry: number, rz: number;
  if (Math.abs(fy) > 0.9999) {
    rx = fy * 1 - fz * 0; ry = fz * 0 - fx * 1; rz = fx * 0 - fy * 0;
  } else {
    rx = -fz; ry = 0; rz = fx;
  }
  const rn = Math.hypot(rx, ry, rz) || 1;
  rx /= rn; ry /= rn; rz /= rn;
  // up' = right x f.
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  const s = Math.fround(pitch);
  out.x = eye.x + fx * SHAKE_LOOK_DISTANCE + ux * s;
  out.y = eye.y + fy * SHAKE_LOOK_DISTANCE + uy * s;
  out.z = eye.z + fz * SHAKE_LOOK_DISTANCE + uz * s;
  return out;
}

/**
 * `[port-only]` — the shake block of `UpdateSceneViewAndLight`
 * (`FUN_00401F40`), run where the engine runs it: after the camera routines
 * have written the block for this frame, before anything draws. The port's
 * end of `GameUpdate` is that point.
 *
 * The engine writes the result into the block's **angles**; the port's block
 * has none, so the result goes beside it, as the look-at point those angles
 * would face, in `g_camera_block_view_target`. The draw aims there while
 * `g_screen_shake_pitch` is non-zero and at the block's own target otherwise,
 * so a reset (which zeroes the pitch) can never leave a stale aim behind, and
 * a frame that runs no tick draws what the last tick left.
 */
export function SceneViewApplyShake(): void {
  ShakeNodLookAt(G.g_camera_block_eye, G.g_camera_block_target,
                 G.g_screen_shake_pitch, G.g_camera_block_view_target);
}

/**
 * The view the frame is drawn with: the camera half of
 * `UpdateSceneViewAndLight` (`FUN_00401F40`), the last thing
 * `CameraActorTick` does.
 *
 * ```
 * for each of the four camera blocks b:
 *   if (b == g_camera_index) {                          -- the shake's nod
 *     LoadIdentity; Translate(b.eye); RotateY(b.yaw); RotateX(b.pitch)
 *     p = M * (0, (float)g_screen_shake_pitch, -1000)
 *     CamBlockSetAnglesFromLookAt(b, p, b.roll)
 *   }
 *   LoadIdentity; Translate(b.eye); RotateY(b.yaw); RotateX(b.pitch); RotateZ(b.roll)
 *   MatrixStore(b + 0x40)                                -- g_camera_blocks, view to world
 *   MatrixGetAngles(&b.pitch, &b.yaw, &b.roll);  b.eye = MatrixGetTranslation()
 *   LoadIdentity; RotateZ(-roll); RotateX(-pitch); RotateY(-yaw); Translate(-eye)
 *   MatrixStore(b + 0x00)                                -- g_camera_world_to_view
 * SetTop(g_camera_world_to_view[g_camera_index]); ...the scene light...
 * g_scene_state_major_entered = g_scene_state_major;  g_scene_state_minor_entered = g_scene_state_minor;
 * g_screen_furniture_flags bit 0 = !(major == 1 && app state != 5 && !(flags & 0x30));
 * ```
 *
 * **The view is the block's angles, not its look-at.** Every driver re-derives
 * the angles from the eye and the look-at before this runs, and this re-derives
 * them once more through the nod -- so a camera that does not re-derive them
 * (`EvtActionHoldCameraPreset20`, which writes angles and not a look-at, or a
 * parked slot) is drawn from whatever angles the block holds. The nod runs
 * every frame, pitch or none; with no shake it re-aims the block down its own
 * axis.
 *
 * The shake's nod is a vertical turn of `atan(pitch / 1000)`: 47 units at its
 * first frame is 2.7 degrees, decaying linearly and swinging every 10.7 frames
 * (`UpdateScreenShake`, `FUN_00415270`). It does not accumulate where a hit
 * can happen: under row 2 a driver re-derives the angles from eye and look-at
 * every frame, so each frame's nod lands on an un-nodded aim. `[proved]`
 *
 * The two matrices are what the port's frame reads the camera through -- the
 * host's `viewSpaceOf`, `viewPoint`, `aimPoint` and `cameraMatrices` -- and
 * what the draw places the three.js camera from. Built here, inside the camera
 * actor's task, they are the view of **this** frame for every task after it,
 * as the engine's are. Only block 0 is modelled: `g_camera_index` is written
 * 0 by every shipped writer.
 */
import { AppState, G } from "../globals";
import { FtolS16, MatIdentity, MatCopy, MatrixGetTranslation,
         MatrixLoadIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
         MatrixTransformPoint, MatrixTransformVector, MatrixTranslate,
         RADIANS_TO_BAMS } from "../matrix";
import { vec3, VecToAngles } from "../vec";
import { CameraUpdateHook } from "./driver";
import { CamBlockSetAnglesFromLookAt, CamEvalPath7, CameraPoseBlock }
  from "./path";

/** `MOV [ESP+0x34], 0xC47A0000` — the look distance, -1000 on the camera's z. */
export const SHAKE_LOOK_DISTANCE = 1000.0;

const _m = MatIdentity();
const _r = MatIdentity();
const _p = vec3();
const _q = vec3();
const _u = vec3();
const _v = vec3();
const X_AXIS = { x: 1, y: 0, z: 0 };
const Z_AXIS = { x: 0, y: 0, z: 1 };

/**
 * `MatrixGetAngles` — `FUN_004018E0`. The pitch, yaw and roll that rebuild the
 * rotation of `m` as `RotateY(yaw); RotateX(pitch); RotateZ(roll)`:
 *
 * ```
 * v = M * (0, 0, 1) as a vector;  (pitch, yaw) = VecToAngles(v)
 * u = M * (1, 0, 0);  u = Rx(-pitch) Ry(-yaw) * u;  roll = (s16)ftol(atan2(u.y, u.x) * B)
 * ```
 *
 * Each angle truncated to whole BAMS, so the round trip can lose one. `[proved]`
 */
export function MatrixGetAngles(m: ArrayLike<number>):
    { pitch: number; yaw: number; roll: number } {
  MatrixTransformVector(m, Z_AXIS, _v);
  const a = VecToAngles(_v.x, _v.y, _v.z);
  const pitch = FtolS16(a.pitch);
  const yaw = FtolS16(a.yaw);
  MatrixTransformVector(m, X_AXIS, _u);
  MatrixLoadIdentity(_r);
  MatrixRotateX(_r, -pitch);
  MatrixRotateY(_r, -yaw);
  MatrixTransformVector(_r, _u, _v);
  const roll = FtolS16(Math.atan2(_v.y, _v.x) * RADIANS_TO_BAMS);
  return { pitch, yaw, roll };
}

/**
 * The camera half of `UpdateSceneViewAndLight` — `FUN_00401F40`, for camera
 * block 0. See the head of this file. The light half -- the scene light's
 * direction pushed through the view -- is the walker's light blocks and
 * `render/`'s.
 */
export function UpdateSceneViewAndLight(): void {
  const e = G.g_camera_block_eye;
  const m = _m;
  // The nod, on the block `g_camera_index` names.
  MatrixLoadIdentity(m);
  MatrixTranslate(m, e.x, e.y, e.z);
  MatrixRotateY(m, G.g_camera_block_yaw_bams);
  MatrixRotateX(m, G.g_camera_block_pitch_bams);
  _p.x = 0;
  _p.y = Math.fround(G.g_screen_shake_pitch);
  _p.z = -SHAKE_LOOK_DISTANCE;
  MatrixTransformPoint(m, _p, _q);
  CamBlockSetAnglesFromLookAt(CameraPoseBlock.Camera, _q,
                              G.g_camera_block_roll_bams);
  CameraBuildView();
  // The stamp every unstamped scene-state entry waits for.
  G.g_scene_state_major_entered = G.g_scene_state_major;
  G.g_scene_state_minor_entered = G.g_scene_state_minor;
  if (G.g_scene_state_major === 1 && G.g_app_state !== AppState.Attract
      && (G.g_screen_furniture_flags & 0x30) === 0) {
    G.g_screen_furniture_flags &= ~1;
  } else {
    G.g_screen_furniture_flags |= 1;
  }
}

/**
 * `[port-only]` as a function -- the per-block body of
 * `UpdateSceneViewAndLight` after the nod: view-to-world built from the
 * block's eye and angles, the angles and eye read back out of it
 * (`MatrixGetAngles`, `MatrixGetTranslation`), and world-to-view built from
 * those. See the head of this file.
 */
export function CameraBuildView(): void {
  const e = G.g_camera_block_eye;
  const m = _m;
  MatrixLoadIdentity(m);
  MatrixTranslate(m, e.x, e.y, e.z);
  MatrixRotateY(m, G.g_camera_block_yaw_bams);
  MatrixRotateX(m, G.g_camera_block_pitch_bams);
  MatrixRotateZ(m, G.g_camera_block_roll_bams);
  MatCopy(G.g_camera_view_to_world, m);
  const a = MatrixGetAngles(m);
  G.g_camera_block_pitch_bams = a.pitch;
  G.g_camera_block_yaw_bams = a.yaw;
  G.g_camera_block_roll_bams = a.roll;
  MatrixGetTranslation(m, e);
  MatrixLoadIdentity(m);
  MatrixRotateZ(m, -G.g_camera_block_roll_bams);
  MatrixRotateX(m, -G.g_camera_block_pitch_bams);
  MatrixRotateY(m, -G.g_camera_block_yaw_bams);
  MatrixTranslate(m, -e.x, -e.y, -e.z);
  MatCopy(G.g_camera_world_to_view, m);
}

/**
 * `[port-only]` -- put the camera block where the camera words say, and build
 * its view, for a seek, the frame scrubber, a reset or a stage opening at an
 * address: the places the player moves the script without running the frames
 * that would have written the block. The engine has no seek, so there is no
 * routine to cite; each half is the routine that would have written the block
 * had the frames run -- the path at `g_cam_path_frame` into the block as
 * `CamAdvancePathFrame` writes it, or, with the stashed rail installed, the
 * rail's frame into the deferred pose block and that copied across as
 * `CameraDriverFromDeferredPose` copies it.
 */
export function CameraReseatFromFrame(): void {
  const slot = G.g_active_cam_path;
  if (slot < 0) return;
  const hook = G.g_camera_update_hook as CameraUpdateHook;
  if (hook === CameraUpdateHook.StepRail
      || hook === CameraUpdateHook.DeferredRailInstall
      || hook === CameraUpdateHook.PlayStashedPath) {
    const roll = CamEvalPath7(slot, G.g_rail_frame, G.g_cam_path_eye,
                              G.g_cam_path_target);
    CamBlockSetAnglesFromLookAt(CameraPoseBlock.Path, G.g_cam_path_target, roll);
    const e = G.g_camera_block_eye, pe = G.g_cam_path_eye;
    e.x = pe.x; e.y = pe.y; e.z = pe.z;
    const t = G.g_camera_block_target, pt = G.g_cam_path_target;
    t.x = pt.x; t.y = pt.y; t.z = pt.z;
    G.g_camera_block_pitch_bams = G.g_cam_path_pitch_bams;
    G.g_camera_block_yaw_bams = G.g_cam_path_yaw_bams;
    G.g_camera_block_roll_bams = G.g_cam_path_roll_bams;
  } else {
    const roll = CamEvalPath7(slot, G.g_cam_path_frame, G.g_camera_block_eye,
                              G.g_camera_block_target);
    CamBlockSetAnglesFromLookAt(CameraPoseBlock.Camera,
                                G.g_camera_block_target, roll);
  }
  CameraBuildView();
}

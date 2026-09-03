/**
 * A camera pose, drawn.
 *
 * The Hermite evaluation that *produces* the pose is not here any more: it is
 * `game/camera/curve.ts`, over `Vec3`, because it is plain maths over bundle
 * keys and the port needs it to seat the camera block without a renderer
 * attached. What is left is the half that genuinely is three.js — turning an
 * eye/target/roll triple into a camera quaternion — plus the `path.y - 15` eye
 * rule, which is a property of the *draw* rather than of the block.
 *
 * Reference: docs/formats/cam.md.
 */

import { Matrix4, Quaternion, Vector3 } from "three";
import type { CamPose } from "../game/camera/curve";

/**
 * The pose as the renderer holds it: three.js vectors, so `applyPose` and the
 * rail overlay can copy straight out of it.
 *
 * `Vector3` satisfies `Vec3` structurally, so this is assignable to the port's
 * {@link CamPose} and `CamPath.pose` fills it in place.
 */
export interface CameraPose extends CamPose {
  eye: Vector3;
  target: Vector3;
  roll: number;
}

/**
 * The `path.y - 15` camera eye rule: **recorded, deliberately not applied.**
 *
 * Every camera hook that plays a path contains this line, and it is not
 * ambiguous -- `CameraSnapToPathEye`, `CameraPathWithImpulseShake` and
 * `CameraStepDeferredRailWithFrameExport` all have it:
 *
 * ```c
 * if (g_camera_use_fixed_y == 1) eye.y = g_camera_fixed_eye_y;
 * else                           eye.y = path.y - 15.0f;
 * ```
 *
 * Applying it to the `cp_` curve's eye Y is nevertheless wrong, and the data
 * says so loudly. Measured over all 201 camera paths in stages 1-6, the mean
 * height of the eye above its own look-at target is:
 *
 * ```
 *   stage  paths   raw      with -15
 *     1     23    + 5.37    - 9.63
 *     2     66    +12.66    - 2.34
 *     3     42    + 4.21    -10.79
 *     4     40    + 1.89    -13.11
 *     5     14    -21.06    -36.06
 *     6     16    +32.21    +17.21
 * ```
 *
 * With the drop, **173 of 201 paths would have the camera looking upward at
 * its own aim point** -- on stage 2's opening path the eye lands at y = -1.2
 * while the target sits at 13.4, which is below the floor. That is not a
 * camera. The raw curve value also matches the established-good oracle: the
 * glTF cameras `hod2lib.gltf` exports use it unmodified, and rendering
 * `cp_st2_50` frame 90 through one produces the recognisable Venice plaza
 * shot the format work was validated against.
 *
 * So the line is real but something compensates for it that has not been
 * found -- most likely `g_camera_eye_y` is not the final world-space eye, or
 * the block `CameraPathWithImpulseShake` reads x and z from (`0x009A60C0`) is
 * a different pose from the `cp_` curve output it takes y from
 * (`0x009C70C4`). Until that is traced, the measurement wins over the
 * disassembly.
 *
 * `g_camera_use_fixed_y` is written only by evt opcode `0x36`, which **never
 * occurs in any shipped script** -- 0 uses across all twelve stage bundles --
 * so the fixed-height branch is unreachable from the data either way.
 *
 * Flip `APPLY_EYE_Y_RULE` to re-enable it for a comparison.
 */
export const EYE_Y_DROP = 15.0;
export const APPLY_EYE_Y_RULE = false;

/** The eye height a camera hook would use, given the script's state. */
export function cameraEyeY(
  pose: CamPose,
  useFixedY: boolean,
  fixedY: number,
): number {
  if (!APPLY_EYE_Y_RULE) return pose.eye.y;
  return useFixedY ? fixedY : pose.eye.y - EYE_Y_DROP;
}

// -- pose -> three.js ------------------------------------------------------

const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);
const _altUp = new Vector3(0, 0, 1);
const _fwd = new Vector3();
const _eye = new Vector3();
const _target = new Vector3();
const _axis = new Vector3();
const _rollQ = new Quaternion();

/**
 * The rotation a three.js camera needs to sit at `eye` looking at `target`.
 *
 * three.js cameras look down -Z with +Y up, which is also glTF's convention,
 * so this is the same construction `hod2lib.gltf._look_at_quat` uses for the
 * exported cameras -- deliberately, so the browser and a Blender render of
 * the same glTF are comparable.
 */
export function applyPose(
  obj: { position: Vector3; quaternion: Quaternion },
  pose: CamPose,
  eyeY?: number,
): void {
  _eye.set(pose.eye.x, pose.eye.y, pose.eye.z);
  _target.set(pose.target.x, pose.target.y, pose.target.z);
  _fwd.copy(_target).sub(_eye);
  if (_fwd.lengthSq() < 1e-12) _fwd.set(0, 0, -1);
  _fwd.normalize();
  const up = Math.abs(_fwd.y) > 0.9999 ? _altUp : _up;
  _m.lookAt(_eye, _target, up);
  obj.position.copy(_eye);
  // Applied after the orientation, never before it -- see cameraEyeY.
  if (eyeY !== undefined) obj.position.y = eyeY;
  obj.quaternion.setFromRotationMatrix(_m);
  if (pose.roll !== 0) {
    _axis.copy(_fwd);
    _rollQ.setFromAxisAngle(_axis, -pose.roll);
    obj.quaternion.premultiply(_rollQ);
  }
}

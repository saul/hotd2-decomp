/**
 * A camera pose, drawn.
 *
 * The Hermite evaluation that *produces* the pose is not here any more: it is
 * `game/camera/curve.ts`, over `Vec3`, because it is plain maths over bundle
 * keys and the port needs it to seat the camera block without a renderer
 * attached. What is left is the half that genuinely is three.js — turning an
 * eye/target/roll triple into a camera quaternion, for the views that draw a
 * path straight off its curve (`?slot=`, the authored-shot toggle).
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
 * **The `path.y - 15` rule is not the camera's.** Every path hook has the line
 *
 * ```c
 * if (g_camera_use_fixed_y == 1) eye.y = g_camera_fixed_eye_y;
 * else                           eye.y = pose.y - 15.0f;
 * ```
 *
 * and the `eye` it writes is `g_camera_eye` (`0x009C71E0`) -- the **gameplay**
 * eye the enemies measure to, beside the three angle words the players' bodies
 * are placed by. The drawn camera is the camera block (`0x009A60C0`), which
 * `UpdateSceneViewAndLight` builds the view from and which the path hooks
 * never write at all. `[proved]` -- see `game/camera/rail.ts` and
 * `game/camera/hooks.ts`.
 *
 * That is what the measurement this note used to carry was saying: with the
 * drop applied to the draw, 173 of 201 paths would look up at their own aim
 * point. The raw curve eye is the camera -- which is also what the glTF
 * cameras `hod2lib/gltf.ts` exports use -- and the fifteen units are the height
 * of the player's body below it.
 */

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
 * three.js cameras look down -Z with +Y up, which is also glTF's convention:
 * the camera's -Z is set to `normalize(target - eye)`, +Y up (+Z when the view
 * is all but vertical), and the roll is applied about the view axis.
 */
export function applyPose(
  obj: { position: Vector3; quaternion: Quaternion },
  pose: CamPose,
): void {
  _eye.set(pose.eye.x, pose.eye.y, pose.eye.z);
  _target.set(pose.target.x, pose.target.y, pose.target.z);
  _fwd.copy(_target).sub(_eye);
  if (_fwd.lengthSq() < 1e-12) _fwd.set(0, 0, -1);
  _fwd.normalize();
  const up = Math.abs(_fwd.y) > 0.9999 ? _altUp : _up;
  _m.lookAt(_eye, _target, up);
  obj.position.copy(_eye);
  obj.quaternion.setFromRotationMatrix(_m);
  if (pose.roll !== 0) {
    _axis.copy(_fwd);
    _rollQ.setFromAxisAngle(_axis, -pose.roll);
    obj.quaternion.premultiply(_rollQ);
  }
}

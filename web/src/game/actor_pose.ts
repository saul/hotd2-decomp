/**
 * Reading a clip's frame from the port's own copy of the motion bank, for the
 * routines that do arithmetic on a pose rather than drawing it.
 *
 * `MotionFrameAddress` (`FUN_00412F50`) hands back a pointer to one frame of a
 * character type's motion: the root translation, three floats at `+0x00`, then
 * three BAMS shorts per skeleton record from `+0x0C` -- the root record's, then
 * each bone's. The bundle bakes exactly that per clip (`BakedMotion.root` and
 * `.rot`, bone 0 first), so `game/` can read the same numbers without asking
 * the renderer.
 */
import type { Actor } from "./actor";
import type { GameHost } from "./host";
import {
  MatIdentity, MatrixGetTranslation, MatrixRotateX, MatrixRotateY,
  MatrixRotateZ, MatrixTranslate,
} from "./matrix";
import { SkeletonShiftToHoldBone1Position } from "./skeleton";
import { CharacterTypeOf, MotionOf, MotionPlayFrame } from "./tables";
import { vec3, type Vec3 } from "./vec";

/** One frame as `MotionFrameAddress` lays it out. */
export interface MotionFrame {
  /** `+0x00..+0x08` -- the root translation. */
  root: Vec3;
  /** `+0x0C + record*6` -- `(rx, ry, rz)` BAMS for record `n`, root first. */
  rot(record: number): [number, number, number];
}

/**
 * `[port-only]` -- `MotionFrameAddress(char type, motion, frame)` over the
 * baked clip. `frame` is the **authored** frame, which is what the engine
 * passes (`play cursor / 2`, `CDQ; SUB EAX, EDX; SAR EAX, 1`). Null for a clip
 * the bundle did not bake.
 */
export function MotionFrameOf(obj: Actor, motion: number,
                              frame: number): MotionFrame | null {
  const m = MotionOf(obj, motion);
  const t = CharacterTypeOf(obj);
  if (!m || !t || m.frames <= 0) return null;
  const f = Math.max(0, Math.min(m.frames - 1, frame));
  const n = t.bone_count;
  const base = f * n * 3;
  return {
    root: vec3(m.root[f * 3], m.root[f * 3 + 1], m.root[f * 3 + 2]),
    rot: (record: number) => [
      m.rot[base + record * 3] ?? 0,
      m.rot[base + record * 3 + 1] ?? 0,
      m.rot[base + record * 3 + 2] ?? 0,
    ],
  };
}

const _p1 = vec3();
const _p2 = vec3();

/**
 * `ActorShiftToHoldBone1Position` — `FUN_0045CE70`. Called where a state has
 * just swapped the clip at `obj+0x1B4`, and it moves `obj+0x40..0x48` so that
 * bone 1 does not jump.
 *
 * ```
 * f = MotionFrameAddress(obj+0x1F4, obj+0x1B4, obj+0x19C / 2)
 * P1 = translation(g_camera_blocks · bone 1's record)         -- where bone 1 was drawn
 * P2 = translation(T(pos) RotX(pitch) RotZ(roll) RotY(yaw)
 *                  T(f.root) RotZ(f+0x10) RotY(f+0x0E) RotX(f+0x0C)
 *                  T(skeleton node 0's offset))              -- where the new clip puts it
 * pos += P1 - P2;  obj+0x200..0x208 = f.root
 * ```
 *
 * Both points are **world** space -- P1 is the camera block's view-to-world
 * times the bone's view-space record, P2 is built from `MatrixLoadIdentity`
 * with the actor's own world pose -- so the difference is a world offset,
 * which settles the `[open]` its annotation carried. `obj+0x200` is the root
 * motion's baseline; the port's is reset by the blended clip change every
 * caller makes next, which re-seeds it from the same frame.
 *
 * `GameHost.boneWorld` is P1; without a posed skeleton -- headless -- there is
 * no drawn bone to hold, and the actor is left where it is. An actor that
 * carries the engine's model block (`Actor.skel`, class 0x14) has its bone-1
 * record in the game, as the engine does, and takes P1 and the frame from
 * there: `SkeletonShiftToHoldBone1Position`.
 */
export function ActorShiftToHoldBone1Position(obj: Actor,
                                              host: GameHost): void {
  if (obj.skel) {
    SkeletonShiftToHoldBone1Position(obj);
    return;
  }
  const t = CharacterTypeOf(obj);
  const f = MotionFrameOf(obj, obj.motion, MotionPlayFrame(obj) >> 1);
  if (!t || !f) return;
  if (!host.boneWorld(obj.at, 1, _p1)) return;
  const node = t.bones[0]?.offset ?? [0, 0, 0];
  const m = MatIdentity();
  MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
  MatrixRotateX(m, obj.pitch);
  MatrixRotateZ(m, obj.roll);
  MatrixRotateY(m, obj.yaw);
  MatrixTranslate(m, f.root.x, f.root.y, f.root.z);
  const r = f.rot(0);
  MatrixRotateZ(m, r[2]);
  MatrixRotateY(m, r[1]);
  MatrixRotateX(m, r[0]);
  MatrixTranslate(m, node[0], node[1], node[2]);
  MatrixGetTranslation(m, _p2);
  obj.pos.x = Math.fround(_p1.x - _p2.x + obj.pos.x);
  obj.pos.y = Math.fround(_p1.y - _p2.y + obj.pos.y);
  obj.pos.z = Math.fround(_p1.z - _p2.z + obj.pos.z);
}

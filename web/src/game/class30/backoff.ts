/**
 * `ZombieStateBackOff` — `FUN_00455C30`.
 *
 * After a strike the actor **keeps the permit** and retreats, playing the
 * back-away clip from its motion row, until it is back outside the inner ring
 * or 240 frames have passed — and only then releases it.
 *
 * That retreat *is* the pause between attacks. There is no cooldown timer for
 * an ordinary zombie: `ZombieStateHoldAtRange` forces `obj+0x133C` to zero
 * unless `obj+0x1368` bit 0 is set. It is also the reason nothing walks into
 * the camera, and why the enemies take turns at all.
 */
import type { Actor } from "../actor";
import { ReleaseAttackSlot } from "../combat/permits";
import { CharacterTypeOf, MotionOf, MotionRowOf } from "../tables";
import { dist2d, type Vec3 } from "../vec";
import { ActorAdvanceTowardCamera } from "./move";
import { ApproachInnerRadius } from "./ring";
import { GAME_HZ, ZombieState } from "./states";

/** `obj+0x1334 > 0xF0` — the retreat gives up after 240 frames. */
const BACKOFF_MAX_FRAMES = 240;

export function ZombieStateBackOff(obj: Actor, eye: Vec3, dt: number): void {
  if (obj.sub === 0) {
    const row = MotionRowOf(obj);
    const m = row[CharacterTypeOf(obj)?.backoff_index ?? 4];
    if (m !== undefined && MotionOf(obj, m)) {
      obj.action = { motion: m, t: 0, loop: true };
    }
    obj.backoffFrames = 0;
    obj.sub = 1;
  }

  ActorAdvanceTowardCamera(obj, eye, dt, true);
  obj.backoffFrames += dt * GAME_HZ;

  if (dist2d(obj.pos, eye) > ApproachInnerRadius(obj)
      || obj.backoffFrames > BACKOFF_MAX_FRAMES) {
    obj.action = null;
    ReleaseAttackSlot(obj);            // only now is the next enemy free
    obj.state = ZombieState.Approach;
    obj.sub = 0;
  }
}

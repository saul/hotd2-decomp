/**
 * Closing the distance.
 *
 * [diverges] as a whole — see `CLOSING_SPEED`. The rule it enforces is not
 * invented, though: **never closer than the state's own floor**. For the
 * approach and the attack run that floor is the inner ring: band 1 is strike
 * range and neither state walks past it — `ZombieStateAttackRun` stops there
 * and hands to the strike. Without that an actor with no attack state, of
 * which stage 2 alone has 161, walks straight through the camera.
 *
 * The **lunge is the exception**, and getting that wrong is worth a note. An
 * attack entry names its own distance and `ZombieStateStrike` closes to it,
 * and `znchain`'s entries name distances inside the 25-unit inner ring — so
 * clamping the lunge at the ring leaves the actor lunging for ever, swinging
 * at nothing. It passes the attack's distance as the floor instead.
 */
import type { Actor } from "../actor";
import type { Vec3 } from "../vec";
import { ApproachInnerRadius } from "./ring";
import { CLOSING_SPEED } from "./states";

export function ActorAdvanceTowardCamera(obj: Actor, eye: Vec3, dt: number,
                                         away = false,
                                         minRange?: number): void {
  const v = CLOSING_SPEED * dt;
  if (v <= 0) return;
  let dx = eye.x - obj.pos.x;
  let dz = eye.z - obj.pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) return;
  dx /= len;
  dz /= len;
  const floor = minRange ?? ApproachInnerRadius(obj);
  const room = away ? v : Math.max(0, len - floor);
  if (room <= 0) return;
  const step = (away ? -1 : 1) * Math.min(v, room);
  obj.pos.x += dx * step;
  obj.pos.z += dz * step;
}

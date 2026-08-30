/**
 * `ActorAbortAttackAndLeave` — `FUN_0045D9F0`.
 *
 * Give the permit up and go back to approaching without striking. Every path
 * out of an attack goes through here, which is the point: an actor that is
 * left holding a permit in a state nothing advances blocks every other enemy
 * for good.
 */
import type { Actor } from "../actor";
import { ReleaseAttackSlot } from "../combat/permits";
import { ZombieState } from "./states";

export function ActorAbortAttackAndLeave(obj: Actor): void {
  obj.action = null;
  obj.hasStrikeAnchor = false;
  ReleaseAttackSlot(obj);
  // Back to the hub, which is where the engine's own release path lands.
  obj.state = ZombieState.HoldAtRange;
  obj.sub = 0;
}

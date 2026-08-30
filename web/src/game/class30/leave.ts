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
import { STATE_APPROACH } from "./states";

export function ActorAbortAttackAndLeave(obj: Actor): void {
  obj.action = null;
  ReleaseAttackSlot(obj);
  obj.state = STATE_APPROACH;
  obj.sub = 0;
}

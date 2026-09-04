/**
 * `ThrowerStrikeConnect` — `FUN_0044CE60`. The stab.
 *
 * Worth stating plainly because it is the opposite of what you would write:
 * **it tests no range at all.** The hit lands when the attack clip reaches the
 * frame the attack entry names, and the only other condition is the cancel
 * mask — if every zone the attack needs has been shot off, the swing whiffs.
 * That is the same design as the zombie's strike and as the thrown weapon's
 * expiry: this engine *times* its hits, it does not test them.
 *
 * Which makes the leap the aiming: `ThrowerStateLeapDown` arcs the actor onto
 * a point in front of the camera and runs this every frame of the flight, so
 * the stab connects because the arc put the actor there on that frame.
 */
import type { Events } from "../../core/events";
import { ThrowerFlag, type ThrowerActor } from "../actor";
import { PlayerTakeDamage } from "../combat/player";
import { ArcPhase } from "./arc";
import { ActorClipFrame } from "./arc";
import { ThrowerAttackOf } from "./tables";

/**
 * A hit frame of `-1` means "when the arc reaches its landing phase" rather
 * than on a numbered frame — `obj+0x1360 == 4`.
 */
const HIT_ON_LANDING = -1;

/**
 * Run the connect for this frame. Returns true if it landed.
 *
 * The engine reads the stance out of `obj+0x1364`, which the leap latched when
 * it began, **not** out of the live flags — so an actor that arrives on a wall
 * mid-pounce still uses the row its swing was drawn against.
 */
export function ThrowerStrikeConnect(obj: ThrowerActor,
                                     events?: Events): boolean {
  // `obj+0x136C & 0x400` sends character type 0x17 to `g_class31_throws`
  // instead; nothing this port runs sets that bit.
  if (obj.flags2 & ThrowerFlag.UseThrowTable) return false;
  if (obj.flags2 & ThrowerFlag.Struck) return false;
  const e = ThrowerAttackOf(obj, obj.thr.stance, obj.attack);
  if (!e) return false;

  const frame = ActorClipFrame(obj);
  const due = e.hit_frame === HIT_ON_LANDING
    ? obj.arcPhase >= ArcPhase.Settled
    : frame >= e.hit_frame;
  if (!due) return false;

  // "If every zone this attack names is destroyed it whiffs." 1 head, 2 right
  // arm, 4 left arm; mask 8 is outside the three-bit zone mask, so it never
  // cancels.
  const mask = e.cancel_mask;
  if ((obj.zones & mask & 7) === mask) return false;

  obj.flags2 |= ThrowerFlag.Struck;
  if (obj.attackPermit < 0) return false;
  return PlayerTakeDamage(obj.attackPermit, obj, e.player_motion, events,
                          "strike", obj.attack);
}

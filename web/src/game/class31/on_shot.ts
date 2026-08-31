/**
 * What happens to a thrower when you shoot it.
 *
 * Class 0x31 does **not** use the shared stagger and the shared directional
 * death. `ThrowerOnShot` runs at the top of its own update, reads the result
 * the shared `ResolveHit` left, and picks a *state* — the stumble, the
 * knockdown, or the tumble — and the death goes through its own three-state
 * chain rather than through a clip chosen by which way you shot it from.
 *
 * That is the bug this file fixes: before it, a `zstin` died face-down in
 * `zom.bin`'s directional death, which is a different creature's animation.
 */
import { ActorFlag, ThrowerFlag, type Actor } from "../actor";
import { HitResultCode } from "../combat/resolve_hit";
import { ReleaseAttackSlot } from "../combat/permits";
import { ThrowerState } from "./states";

/** The character type that tumbles instead of stumbling. */
const CHAR_ZSLMAN = 0x18;
/** The bone the head is on: a hit there is what can decapitate. */
const HEAD_BONE = 2;

/**
 * `ThrowerShotFeedback` — `FUN_00449B20`, the half of it that is gameplay.
 *
 * [diverges] The engine's routine also picks the blood scale, the ricochet
 * sound and the impact sprite; the port's `ResolveHit` already does all three
 * generically. What only this routine does is **latch the decapitation**: a
 * result-1 hit on bone 2 that swaps the head model raises `obj+0x136C` bits
 * `0x6000000`, and bit `0x4000000` of that pair is what later routes the
 * stumble and the knockdown into the get-up instead of straight back to the
 * hub. Without it state 17 is unreachable.
 */
export function ThrowerShotFeedback(obj: Actor, bone: number,
                                    result: number): void {
  if (result === HitResultCode.Damaged && bone === HEAD_BONE) {
    obj.flags2 |= ThrowerFlag.KnockedDown | 0x2000000;
  }
}

/**
 * `ThrowerOnShot` — `FUN_004499A0`.
 *
 * Three things worth keeping straight, because they are all easy to get
 * backwards:
 *
 * * **It applies no damage.** `ResolveHit` already did, inside `DispatchHit`.
 *   This only chooses the reaction.
 * * **`obj+0x1368` is the bone index here**, where class 0x30 puts a bitfield
 *   of special-death arms in the same word. One offset, two meanings.
 * * **`obj+0x34` bit 0x2000 vetoes the reaction entirely** — an actor that has
 *   already spent two knockback arcs takes further shots without flinching.
 */
export function ThrowerOnShot(obj: Actor): void {
  const hit = obj.pendingHit;
  if (!hit) return;
  obj.pendingHit = null;
  // Bone 0 is the root; a hit there never reacts.
  if (hit.bone <= 0) return;

  obj.reactBone = hit.bone;
  ThrowerShotFeedback(obj, hit.bone, hit.result);

  // Downed, so the shot only ricochets; the result was forced to 5.
  if (obj.flags & ActorFlag.ShotImmune) return;
  if (hit.result === HitResultCode.NoEffect) return;
  // The death reaction is chosen once and only once.
  if (obj.flags2 & ThrowerFlag.DeathLatched) return;

  obj.flags2 &= ~(ThrowerFlag.Pouncing | ThrowerFlag.BandLatched | 0x200);
  obj.flags &= ~(ActorFlag.BackingOff | 0x10000000);
  if (obj.attackPermit >= 0) ReleaseAttackSlot(obj);

  if (obj.dead) {
    obj.flags2 |= ThrowerFlag.DeathLatched;
    obj.sub = 0;
    obj.state = ThrowerState.FallAndLand;
    return;
  }
  if (obj.flags & ActorFlag.ArcSpent) return;

  // A second shot while a reaction is already running is a *re-entry*: the
  // clip hard-cuts and the knockback counter goes up instead of resetting.
  if (obj.flags & ActorFlag.Reacting) obj.flags2 |= ThrowerFlag.ReactReentry;
  obj.flags |= ActorFlag.Reacting;
  obj.sub = 0;
  obj.state = obj.charType === CHAR_ZSLMAN ? ThrowerState.KnockedTumbling
    : (obj.state === ThrowerState.StandAndDecide
       && !(obj.flags2 & ThrowerFlag.OffGround))
      ? ThrowerState.HitReaction
      : ThrowerState.FallAndLand;
}

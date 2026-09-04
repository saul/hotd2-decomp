/**
 * What a thrower does next, and why it looks like it is thinking.
 *
 * `ThrowerStateStandAndDecide` does not choose an action. It asks
 * `ThrowerPickNextState`, which measures one number — the ground distance to
 * the camera — turns it into a **band**, and draws a candidate state id at
 * random out of `g_class31_action_picks[set][band]`. `ThrowerTryEnterState`
 * then refuses it if the actor cannot do that right now, and on a refusal the
 * actor goes back to standing and tries again next frame.
 *
 * So the repertoire is data, not code, and for `zstin` it reads:
 *
 * ```
 * d <= 30            -> state 8, wait for a permit and then pounce
 * 40 < d <= 50       -> 14 / 15 / 16 nine times in ten -- onto the wall
 *                       beside it or the ceiling above it -- else 12, pounce
 * everything else    -> stand, one time in ten pounce (13)
 * ```
 *
 * which is exactly the thing you see: it circles the walls at middle range and
 * comes at you when you let it close.
 */
import type { Rng } from "../../core/rng";
import { ThrowerFlag, type ThrowerActor } from "../actor";
import { ThrowerTryClaimAttackSlot } from "../combat/permits";
import type { GameHost } from "../host";
import { dist2d, type Vec3 } from "../vec";
import { ThrowerFindCeilingAbove, ThrowerFindWallBeside } from "./surface";
import {
  BAND_NEAR_MAX, BAND_NEAR_MIN, CLOSE_RANGE, ThrowerBand, ThrowerState,
} from "./states";
import { ThrowerPickState } from "./tables";

/** Character type 0x18 is the one the two pounce picks refuse. */
const CHAR_ZSLMAN = 0x18;
/** ...and 0x16 and 0x18 are the only two that carry a weapon. */
const CHAR_ZSASS = 0x16;

/**
 * The destroyed-zone bits an arm going bare sets — the same two the cancel
 * mask reads, which is the whole trick: a thrown arm and a shot-off arm are
 * the same state.
 *
 * [diverges] The engine tests the hands' **draw slots** rather than the zone
 * mask, because a slot distinguishes "armed", "thrown" and "shot off" where
 * the mask conflates the last two. `SpawnThrownWeapon` sets the zone bit as
 * well, so the two agree for every case the port can reach; the port has no
 * per-bone slot to test against without going through the host.
 */
enum ThrowerArm { Right = 2, Left = 4 }

/** `ThrowerHasBareHand` — `FUN_0044F720`. One hand has thrown and not re-armed. */
export function ThrowerHasBareHand(obj: ThrowerActor): boolean {
  if (obj.charType !== CHAR_ZSASS && obj.charType !== CHAR_ZSLMAN) return false;
  return (obj.zones & (ThrowerArm.Right | ThrowerArm.Left)) !== 0;
}

/** `ThrowerBothHandsArmed` — `FUN_0044F5D0`. A weapon is still in a hand. */
export function ThrowerBothHandsArmed(obj: ThrowerActor): boolean {
  if (obj.charType !== CHAR_ZSASS && obj.charType !== CHAR_ZSLMAN) return false;
  return (obj.zones & (ThrowerArm.Right | ThrowerArm.Left))
       !== (ThrowerArm.Right | ThrowerArm.Left);
}

/**
 * `ThrowerTryEnterState` — `FUN_0044AFB0`.
 *
 * The gate. Given a candidate state id, decide whether the actor may be in it
 * this frame; enter it and return true if so. Note the shape of case 8: it
 * enters the wait state only when the permit claim **fails**, because state 8
 * is what an actor does while it has not got one.
 */
export function ThrowerTryEnterState(obj: ThrowerActor, state: number, rng: Rng,
                                     host: GameHost): boolean {
  if (state === obj.state) return false;
  const enter = () => { obj.state = state; obj.sub = 0; return true; };

  switch (state) {
    case ThrowerState.StandAndDecide:
      return enter();
    case ThrowerState.WaitForPermit:
      // Not reachable from the pick tables in the shipped data -- the router
      // reaches state 8 through its own close-range short-circuit -- but the
      // gate is here as the engine writes it.
      return ThrowerTryClaimAttackSlot(obj, host) ? false : enter();
    case ThrowerState.Pounce:
      return ThrowerTryClaimAttackSlot(obj, host) ? enter() : false;
    case ThrowerState.PounceNear:
    case ThrowerState.PounceFar:
      if (obj.charType === CHAR_ZSLMAN) return false;
      return ThrowerTryClaimAttackSlot(obj, host) ? enter() : false;
    case ThrowerState.LeapToWallB:
      if (obj.flags2 & ThrowerFlag.OffGround) return false;
      return ThrowerFindWallBeside(obj, -1, rng) ? enter() : false;
    case ThrowerState.LeapToWallA:
      if (obj.flags2 & ThrowerFlag.OffGround) return false;
      return ThrowerFindWallBeside(obj, 1, rng) ? enter() : false;
    case ThrowerState.LeapToCeiling:
      if (obj.flags2 & ThrowerFlag.OffGround) return false;
      return ThrowerFindCeilingAbove(obj) ? enter() : false;
    case ThrowerState.Rearm:
    case ThrowerState.RestoreBothHands:
      if (obj.state !== ThrowerState.StandAndDecide) return false;
      return ThrowerHasBareHand(obj) ? enter() : false;
    case ThrowerState.Throw:
      if (!ThrowerBothHandsArmed(obj)) return false;
      return ThrowerTryClaimAttackSlot(obj, host) ? enter() : false;
    // `[open]` state 0x20 additionally requires the ground surface under the
    // actor to be 0x35, a collision material the bundle does not carry. Only
    // character type 0x17 can reach it and nothing ported is that type.
    default:
      return false;
  }
}

/**
 * `ThrowerPickNextState` — `FUN_0044ADB0`.
 *
 * The band is 1 only in the 40..50 window and 2 everywhere else — including
 * *inside* 40, which is why an actor at 35 units stands rather than climbing.
 * Band 0 exists in the table and is unreachable.
 *
 * The `BandLatched` bit is what stops it re-rolling every frame: once a
 * candidate is accepted the band is remembered, and the actor only asks again
 * when the band changes.
 */
export function ThrowerPickNextState(obj: ThrowerActor, eye: Vec3, rng: Rng,
                                     host: GameHost): void {
  const d = dist2d(obj.pos, eye);
  const band = d > BAND_NEAR_MIN && d <= BAND_NEAR_MAX
    ? ThrowerBand.Near : ThrowerBand.Far;

  // `[diverges]` Character type 0x17's threshold is 15.0 and is conditional on
  // the surface under it being 0x35; nothing ported is that type.
  if (d <= CLOSE_RANGE) {
    if (obj.state !== ThrowerState.WaitForPermit) {
      obj.state = ThrowerState.WaitForPermit;
      obj.sub = 0;
    }
    return;
  }

  if (obj.flags2 & ThrowerFlag.BandLatched) {
    if (band === obj.thr.moveBand) return;
    obj.flags2 &= ~ThrowerFlag.BandLatched;
    return;
  }

  const pick = ThrowerPickState(obj, band, rng.int(10));
  if (pick !== undefined && ThrowerTryEnterState(obj, pick, rng, host)) {
    obj.thr.moveBand = band;
    obj.flags2 |= ThrowerFlag.BandLatched;
    return;
  }
  if (obj.state !== ThrowerState.StandAndDecide) {
    obj.state = ThrowerState.StandAndDecide;
    obj.sub = 0;
  }
}

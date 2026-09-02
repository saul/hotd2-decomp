/**
 * The attack permit — `g_attack_permits`, one per player.
 *
 * Winning one is what lets an actor attack *and* what puts it on camera: the
 * permit index lives in `obj+0x121`, and `RegisterForCameraTracking` keys off
 * the same commitment. One byte doing two jobs is the whole trick.
 */
import { ActorFlag, ThrowerFlag, ZombieFlag2, type Actor } from "../actor";
import { G } from "../globals";
import { IsPlayerAttackable } from "./player";
import type { GameHost } from "../host";
import { vec3 } from "../vec";

/**
 * `g_projection_distance_px` — 0x009A2D70, and a 640x480 frame.
 *
 * `ActorIsOnScreen` tests against `+/-g_projection_distance_px * 0.5`
 * horizontally and `+/-240` vertically, which is how the half-height is known
 * to be 240; the same constant appears in the frustum test at `FUN_0045CA60`
 * with a literal 320 for the half-width.
 */
const SCREEN_HALF_H = 240;
const PROJECTION_DISTANCE_PX = 640.2;

const _view = vec3();

/**
 * `ActorIsOnScreen` — `FUN_00409C10`.
 *
 * Projects the actor's tracked point and asks whether it lands inside the
 * frame. Both claim functions call it — but **not to refuse the claim**. See
 * {@link TryClaimAttackSlot}.
 */
export function ActorIsOnScreen(obj: Actor, host: GameHost): boolean {
  if (!host.viewSpaceOf(obj.at, _view)) return true;   // not posed: no opinion
  if (_view.z === 0) return false;
  const x = (PROJECTION_DISTANCE_PX * _view.x) / _view.z;
  const y = (PROJECTION_DISTANCE_PX * _view.y) / _view.z;
  const halfW = PROJECTION_DISTANCE_PX * 0.5;
  return x >= -halfW && x <= halfW && y >= -SCREEN_HALF_H && y <= SCREEN_HALF_H;
}

/**
 * `TryClaimAttackSlot` — `FUN_00455DE0`. Take a free permit, or fail.
 *
 * Note what it does **not** do: there is no queue-rank test here. That lives
 * in `ZombieStateApproach`, before the call.
 *
 * **Being off screen does not refuse the claim.** This port used to read it
 * that way and it was wrong in a way you could watch: an enemy that ended up
 * level with the camera — which happens whenever the rail carries the camera
 * into one — was refused a permit for ever, so it never attacked, never ran
 * the state that retreats, and simply stood in your face. `zsass` shows it
 * most because its whole cycle is *close in, pounce, leap back to fifty*, and
 * without the permit it never gets past the first step.
 *
 * What the engine actually does is grant the permit and raise a **global
 * latch**, `g_attack_committed`: one enemy may be attacking from off screen,
 * and while one is, nobody else may claim at all. That is the rule this
 * enforces now, on both halves.
 */
export function TryClaimAttackSlot(obj: Actor, host?: GameHost,
                                   offScreenBit: number =
                                     ZombieFlag2.OffScreenPermit): boolean {
  // The latch is read first and gives up before a player is even picked.
  if (G.g_attack_committed !== 0) return false;
  for (let i = 0; i < G.g_max_attackers; i++) {
    // `obj+0x121` is a **player index**, not a slot: the engine picks which
    // player to come for and then **voids the choice** when
    // `IsPlayerAttackable` (`FUN_00409DC0`) says no —
    // `if (!IsPlayerAttackable(obj+0x121)) obj+0x121 = -1;`, and the claim
    // below only happens if the pick survived. It does not try the other
    // player afterwards, so a refusal fails the whole claim.
    //
    // This gate used to be left out on purpose, and the reason was good at the
    // time: the port's `IsPlayerAttackable` tested `g_player_lives` alone, so
    // wiring it here would have stopped every enemy attacking once a player
    // was out of lives — a divergence rather than a fix. Two things have
    // changed. `g_player_lives` floors at one, so that clause can no longer
    // fail; and the function now tests the **scene state**, which is the
    // clause that matters here — no enemy may claim while the follow camera or
    // a scripted view-angle turn is driving.
    if (G.g_attack_permits[i] === -1) {
      if (!IsPlayerAttackable(i)) return false;
      // Granted either way; off screen it also latches, so this actor is the
      // only one that may be attacking unseen.
      if (host && !ActorIsOnScreen(obj, host)) {
        obj.flags2 |= offScreenBit;
        G.g_attack_committed = 1;
      }
      G.g_attack_permits[i] = obj.at;
      obj.attackPermit = i;                    // +0x121
      obj.flags &= ~ActorFlag.NoCameraTrack;      // the camera may now see it
      return true;
    }
  }
  return false;
}

/**
 * `ThrowerTryClaimAttackSlot` — `FUN_0044CA40`.
 *
 * Byte-for-byte `TryClaimAttackSlot`, and it exists as its own function
 * because class 0x31 reaches it from its own state machine. Kept separate for
 * the same reason: gating the thrower on the zombie's rank test is why the
 * elevated ones never threw — they are far away by design, so their distance
 * rank is always high.
 */
export function ThrowerTryClaimAttackSlot(obj: Actor,
                                          host?: GameHost): boolean {
  // The one thing that is not byte-for-byte: the off-screen latch is recorded
  // in a different bit of the same word, because class 0x30 already uses
  // `0x20000` for something else on its own actors.
  return TryClaimAttackSlot(obj, host, ThrowerFlag.OffScreenPermit);
}

/**
 * `ReleaseAttackSlot` — `FUN_00456520`, and `ThrowerReleaseAttackPermit`
 * (`FUN_0044CFB0`) is the same function with the other bit.
 *
 * Releasing an off-screen permit is the **only** thing that lifts
 * `g_attack_committed`, so forgetting it here would stall every enemy in the
 * scene rather than just this one.
 */
export function ReleaseAttackSlot(obj: Actor,
                                  offScreenBit: number =
                                    ZombieFlag2.OffScreenPermit): void {
  if (obj.attackPermit >= 0) G.g_attack_permits[obj.attackPermit] = -1;
  obj.attackPermit = -1;
  obj.flags |= ActorFlag.NoCameraTrack;
  if (obj.flags2 & offScreenBit) {
    obj.flags2 &= ~offScreenBit;
    G.g_attack_committed = 0;
  }
}

/** `ThrowerReleaseAttackPermit` — `FUN_0044CFB0`. */
export function ThrowerReleaseAttackPermit(obj: Actor): void {
  ReleaseAttackSlot(obj, ThrowerFlag.OffScreenPermit);
}

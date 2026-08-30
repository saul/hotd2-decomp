/**
 * Class 0x31, the thrower.
 *
 * `EnemyThrowerInit` (`FUN_00449620`) gives subtype 0x16 (`zsass.bin`) an item
 * in each hand and puts it somewhere you cannot walk to — stage 2 block 5
 * spawns two at y = 87, above the street. So it never walks: it turns to face
 * you, waits for the attack permit, and throws.
 *
 * It competes for the **same permit** as the zombies, through its own copy of
 * the claim, and — this is the part that was got wrong — `ThrowerTryClaimAttackSlot`
 * tests **no queue rank**. That test lives in `ZombieStateApproach`, before
 * the call, and class 0x31's throw state does not have it. Gating the thrower
 * on rank is why the elevated ones never threw: they are far away by design,
 * so their distance rank is always high.
 *
 * Its full 30-state machine is `[open]`; four states are ported.
 */
import type { Events } from "../../core/events";
import type { ThrowHandJson } from "../../bundle";
import { DamageZone, type Actor } from "../actor";
import { TurnActorTowardCamera } from "../actor_turn";
import { ReleaseAttackSlot, ThrowerTryClaimAttackSlot } from "../combat/permits";
import { G } from "../globals";
import type { GameHost } from "../host";
import { CharacterTypeOf, MotionOf, ThrowHandsOf } from "../tables";
import { vec3, type Vec3 } from "../vec";
import { GAME_HZ } from "../class30/states";
import { ThrowSub } from "./states";

/** Hands whose arm has not been shot off. `ThrowerStateThrow` refuses the rest. */
function usableHands(obj: Actor): ThrowHandJson[] {
  return ThrowHandsOf(obj)
    .filter((h) => (obj.zones & DamageZone.All & h.cancel_mask) !== h.cancel_mask);
}

/**
 * `AimThrownWeapon` — `FUN_004503D0`. A point `aim_ahead` in front of the
 * camera; the camera looks down its own local -Z, which is where the player is.
 */
export function AimThrownWeapon(obj: Actor, host: GameHost, eye: Vec3,
                                out: Vec3): void {
  const cfg = CharacterTypeOf(obj)?.throw;
  host.aimPoint(cfg?.aim_ahead ?? 0, out);
  out.y = eye.y;
}

/**
 * `SpawnThrownWeapon` — `FUN_004504E0`. The hand goes bare and the weapon
 * takes off.
 */
export function SpawnThrownWeapon(obj: Actor, hand: ThrowHandJson,
                                  host: GameHost, eye: Vec3,
                                  events?: Events): void {
  const cfg = CharacterTypeOf(obj)?.throw;
  if (!cfg) return;
  const from = vec3();
  if (!host.boneWorld(obj.at, hand.bone, from)) return;

  host.setBoneSlot(obj.at, hand.bone, hand.bare);
  obj.zones |= hand.cancel_mask & DamageZone.All;

  const target = vec3();
  AimThrownWeapon(obj, host, eye, target);
  const d = Math.hypot(target.x - from.x, target.y - from.y,
                       target.z - from.z);
  const ttl = Math.max(1, d / cfg.speed);
  G.g_thrown_weapons.push({
    id: G.g_thrown_next_id++,
    from: obj.at,
    slot: hand.projectile,
    pos: from,
    vel: vec3((target.x - from.x) / ttl, (target.y - from.y) / ttl,
              (target.z - from.z) / ttl),
    ttl,
    // Which hand it left decides which way it tumbles.
    spin: hand.bone === 5 ? cfg.spin : -cfg.spin,
    yaw: 0,
    after: 0,
    hit: false,
    stickFrames: cfg.stick_frames,
    blinkFrames: cfg.blink_frames,
    visible: true,
  });
  events?.emit("enemy.threw", { at: obj.at, who: obj.name });
}

/** `ThrowerStateRearm` — `FUN_0044F7A0`. The hand gets its weapon back. */
export function ThrowerStateRearm(obj: Actor, hand: ThrowHandJson,
                                  host: GameHost): void {
  if (hand.held) host.setBoneSlot(obj.at, hand.bone, hand.held);
  obj.zones &= ~(hand.cancel_mask & DamageZone.All);
}

/**
 * `ThrowerStateThrow` — `FUN_0044FAF0`. Play the clip, let go on the exact
 * frame the hand names, then re-arm and give the permit up so the next enemy —
 * or this one — can take a turn.
 */
export function ThrowerStateThrow(obj: Actor, host: GameHost, eye: Vec3,
                                  events?: Events): void {
  const hands = usableHands(obj);
  if (!hands.length) {
    if (obj.attackPermit >= 0) ReleaseAttackSlot(obj);
    return;
  }
  if (obj.attackPermit < 0) {
    if (!ThrowerTryClaimAttackSlot(obj)) return;
    obj.sub = ThrowSub.Draw;
  }

  const hand = hands[Math.min(Math.max(0, obj.attack), hands.length - 1)];
  if (obj.sub === ThrowSub.Draw) {
    obj.attack = hands.indexOf(hand);
    obj.action = { motion: hand.motion, t: 0, loop: false };
    obj.sub = ThrowSub.Winding;
    return;
  }

  const m = MotionOf(obj, hand.motion);
  if (!obj.action || !m) {
    if (obj.sub === ThrowSub.Thrown) ThrowerStateRearm(obj, hand, host);
    ReleaseAttackSlot(obj);
    obj.sub = ThrowSub.Draw;
    obj.attack = (obj.attack + 1) % hands.length;
    return;
  }
  if (obj.sub === ThrowSub.Winding && obj.action.t * GAME_HZ >= hand.release_frame) {
    obj.sub = ThrowSub.Thrown;
    SpawnThrownWeapon(obj, hand, host, eye, events);
  }
}

/** `EnemyThrowerUpdate` — `FUN_00449910`. Class 0x31's per-frame dispatch. */
export function EnemyThrowerUpdate(obj: Actor, eye: Vec3, dt: number,
                                   host: GameHost, events?: Events): void {
  TurnActorTowardCamera(obj, eye, dt);
  ThrowerStateThrow(obj, host, eye, events);
}

/** `EnemyThrowerInit` — `FUN_00449620`. */
export function EnemyThrowerInit(obj: Actor): void {
  obj.sub = ThrowSub.Draw;
  obj.attack = 0;
  obj.attackPermit = -1;
}

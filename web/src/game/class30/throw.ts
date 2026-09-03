/**
 * The weapon a class-0x30 zombie throws.
 *
 * `ZombieThrowHandWeapon` (`FUN_0045A240`) allocates a **classless** object:
 * its update, `ZombieThrownWeaponUpdate` (`FUN_0045A4F0`), is referenced
 * exactly once in the whole binary — by that allocation — and appears in
 * `g_class_handlers` nowhere. So it gets no `SpawnClass` here either; it goes
 * into `G.g_thrown_weapons`, the pool class 0x31's projectile already uses,
 * because the two behave the same once they are in the air.
 *
 * Two differences from class 0x31's, and both are carried on the record:
 *
 * * **the axe flies flat and everything else arcs.** The choice is by
 *   projectile slot, not by character: `0x249` is `znonoo.bin` part 0, the
 *   axe, which char types 0x13 (`tutorial.bin`) and 0x14 (`znonoopa.bin`)
 *   both throw. Char type 1 lobs parts of its own model with `±0.009` of
 *   gravity on whichever of X and Z `ZombieThrownWeaponBeginArc` picks.
 * * **the damage kind.** `PlayerTakeDamage(player, 1, 4)` for the flat throw
 *   and `6` for the arc, where class 0x31's passes 0.
 *
 * [open] `ZombieThrownWeaponStateShotDown` (`FUN_00459D20`) is not ported.
 * The weapon registers for the shot test every frame — you are meant to be
 * able to shoot the axe out of the air, and in the tutorial that is the whole
 * lesson — but `g_thrown_weapons` is a pool of plain records and the port's
 * shot test walks actors. Wiring the pool into it is a change to the shot
 * path, not to this state, so it is named here rather than half-done.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { ZombieActor } from "../actor";
import { G } from "../globals";
import type { GameHost } from "../host";
import { CharacterTypeOf } from "../tables";
import { vec3, type Vec3 } from "../vec";
import { STAND_THROW_CONDITION } from "./stand_throw";

/**
 * `ZombieThrownWeaponAimAtCamera` — `FUN_0045A070`. Where the weapon is aimed.
 *
 * A point in camera space: `aim_ahead` in front of the eye, `aim_drop` below
 * it for the axe, and offset sideways by `aim_side` toward the player whose
 * permit the weapon inherited — so in two-player each is thrown at rather than
 * both at the midpoint between them.
 */
export function ZombieThrownWeaponAimAtCamera(obj: ZombieActor, host: GameHost,
                                              eye: Vec3, out: Vec3): void {
  const k = CharacterTypeOf(obj)?.zombie_throw;
  host.aimPoint(k?.aim_ahead ?? 4, out);
  out.y = eye.y - (k?.aim_drop ?? 0);
  // `(obj+0x121 * -2 + 1) * -0.6`: permit 0 gives +0.6 and permit 1 gives
  // -0.6.
  //
  // The gate is `obj+0x1360 != 1`, and `ZombieThrowHandWeapon` sets that field
  // from **`g_max_attackers`** one line before it calls this — not from the
  // player count, which is a different counter incremented off a different
  // slot bit. So the offset appears exactly when the game is running two
  // permits, and reading the source global here is the same value the engine
  // latched: the latch and the aim happen in the same call.
  if (G.g_max_attackers !== 1) {
    const side = (obj.attackPermit * -2 + 1) * -(k?.aim_side ?? 0.6);
    const a = G.g_camera_yaw_bams * ((Math.PI * 2) / 65536);
    out.x += Math.cos(a) * side;
    out.z -= Math.sin(a) * side;
  }
}

/**
 * `ZombieThrowHandWeapon` — `FUN_0045A240`. The weapon leaves the hand.
 *
 * The hand's draw slot becomes the bare variant **and the bone the weapon
 * hangs off is cleared** — leaving that one drawn leaves an axe floating in an
 * empty fist. The projectile inherits the thrower's attack permit and the
 * thrower's is cleared, so the weapon holds the slot until it lands.
 */
export function SpawnZombieThrownWeapon(obj: ZombieActor, bone: number, eye: Vec3,
                                        host: GameHost, rng: Rng,
                                        events?: Events): void {
  const kit = CharacterTypeOf(obj)?.zombie_throw;
  const hand = kit?.hands.find((h) => h.bone === bone);
  if (!kit || !hand) return;

  obj.boneSlot[String(hand.bone)] = hand.bare;
  host.setBoneSlot(obj.at, hand.bone, hand.bare);
  obj.boneSlot[String(hand.weapon_bone)] = 0;
  host.setBoneSlot(obj.at, hand.weapon_bone, 0);

  const from = vec3();
  if (!host.boneWorld(obj.at, hand.bone, from)) {
    from.x = obj.pos.x; from.y = obj.pos.y + 4; from.z = obj.pos.z;
  }
  const target = vec3();
  ZombieThrownWeaponAimAtCamera(obj, host, eye, target);

  // `obj+0x1370`: the stationary thrower's weapon is the faster of the two.
  const speed = obj.condition === STAND_THROW_CONDITION
    ? kit.speed_standing : kit.speed;
  const dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z;
  const ttl = Math.max(1, Math.hypot(dx, dy, dz) / speed);

  const acc = vec3();
  let vel: Vec3;
  if (kit.straight) {
    vel = vec3(dx / ttl, dy / ttl, dz / ttl);
  } else {
    // `ZombieThrownWeaponBeginArc`: the curve bends along whichever of X and Z
    // the throw heads down, and that axis solves `(2*d - g*t*t) / (2*t)`.
    const g = hand.bone === 5 ? kit.arc_gravity : -kit.arc_gravity;
    const alongZ = Math.abs(dz) >= Math.abs(dx);
    if (alongZ) {
      acc.z = g;
      vel = vec3(dx / ttl, dy / ttl, (2 * dz - g * ttl * ttl) / (2 * ttl));
    } else {
      acc.x = g;
      vel = vec3((2 * dx - g * ttl * ttl) / (2 * ttl), dy / ttl, dz / ttl);
    }
  }

  G.g_thrown_weapons.push({
    id: G.g_thrown_next_id++,
    from: obj.at,
    slot: hand.projectile,
    pos: from,
    vel,
    acc,
    ttl,
    // Which hand it left decides which way it tumbles, as class 0x31's does.
    spin: (hand.bone === 5 ? 1 : -1) * (0x100 + rng.int(0x200)),
    spinAngle: 0,
    after: 0,
    hit: false,
    hitKind: kit.hit_kind,
    stickFrames: kit.stick_frames,
    blinkFrames: kit.blink_frames,
    visible: true,
  });
  events?.emit("enemy.threw", { at: obj.at, who: obj.name });
}

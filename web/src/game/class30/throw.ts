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
import type { ZombieActor } from "../actor";
import { G } from "../globals";
import type { GameHost } from "../host";
import { CharacterTypeOf } from "../tables";
import { vec3, type Vec3 } from "../vec";
import { STAND_THROW_CONDITION } from "./stand_throw";
import { THROWN_SPIN_RATE } from "../class31/projectile";

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
 * The hand's draw slot becomes the bare variant and the projectile inherits
 * the thrower's attack permit, the thrower's being cleared, so the weapon
 * holds the slot until it lands.
 *
 * **The second write is not another bone.** The routine also does
 * `*(bone * 0x90 + 0x284 + obj) = 0` — `899f54050000` for bone 5 at
 * 0x0045A2B2 and `899f04070000` for bone 8 at 0x0045A2DB, with `EBX` zeroed —
 * and `0x284` is the bone record's own `+0x78`, not the base of another
 * record. `SkeletonWalkNode` (`FUN_004107E0`) writes that field every frame as
 * `obj+0x1300 * PTR_DAT_004D032C[type][bone].radius`, so it is **the bone's
 * hit-sphere radius**, and zeroing it makes the hand it just emptied
 * unshootable. `SpawnThrownWeapon` (`FUN_004504E0`) does the identical write
 * for class 0x31 at 0x00450540.
 *
 * The bundle's `weapon_bone` is that address read as `0x20C + bone * 0x90`
 * and rounded — `0x554` is bone **5.83**, not bone 6 — and this file used to
 * clear `boneSlot[weapon_bone]`, which named the *left upper arm* while the
 * *right* hand threw. It was inert, because `swapGore` returns false for a
 * zero slot, and it is gone rather than left as a wrong claim.
 *
 * `[diverges]` The hit sphere is **not** cleared here. `render/characters.ts`
 * tests `type.bones[].hit_radius` from the static table, so the port has no
 * per-bone radius on the actor to zero — the same gap makes a bone whose
 * model has been swapped for a damaged one keep the sphere the engine drops
 * (`SkeletonWalkNode` zeroes it whenever the record's slot stops matching the
 * table's). Both want the same one field, and adding it is a change to the
 * shot path rather than to this routine.
 */
export function SpawnZombieThrownWeapon(obj: ZombieActor, bone: number, eye: Vec3,
                                        host: GameHost,
                                        events?: Events): void {
  const kit = CharacterTypeOf(obj)?.zombie_throw;
  const hand = kit?.hands.find((h) => h.bone === bone);
  if (!kit || !hand) return;

  obj.boneSlot[String(hand.bone)] = hand.bare;
  host.setBoneSlot(obj.at, hand.bone, hand.bare);

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
    // `ZombieThrownWeaponStateStraight` (`FUN_00459690`) at `0x00459731`:
    // `obj+0x64 += obj+0x135C`, into the **X** term, with **no sign test on
    // the hand** -- unlike class 0x31, which negates for bone 8. This used to
    // be `(hand.bone === 5 ? 1 : -1) * (0x100 + rng.int(0x200))`, a hand-signed
    // random rate on Y, which is neither the engine's axis nor its sign; the
    // random part looks like the *landing* kick at `0x004597xx` read as a
    // flight rate. The rate is the port's -- see `ThrownWeapon.spinAngle`.
    spin: THROWN_SPIN_RATE,
    axis: "x",
    spinAngle: 0,
    // `ZombieThrowHandWeapon` (`FUN_0045A240`) writes the model and the
    // position and nothing else, so class 0x30's projectile has no `obj+0x1364`
    // tilt.
    tilt: 0,
    after: 0,
    hit: false,
    hitKind: kit.hit_kind,
    stickFrames: kit.stick_frames,
    blinkFrames: kit.blink_frames,
    visible: true,
  });
  events?.emit("enemy.threw", { at: obj.at, who: obj.name });
}

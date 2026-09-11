/**
 * The weapon in flight.
 *
 * A straight line at a constant `speed` units per frame with
 * `ttl = distance / speed`, tumbling **about its own Y axis** — the flight
 * adds the rate into `obj+0x68`, which is the draw's Y term — and on expiry it
 * calls
 * `PlayerTakeDamage` outright: **the hit is timed, not tested**, exactly like
 * the melee strike's hit frame. Afterwards it sticks facing the camera for
 * `stick_frames` and blinks for `blink_frames` before going away.
 */
import type { Events } from "../../core/events";
import { ActorByAt, G } from "../globals";
import { PlayerTakeDamageTimed } from "../combat/player";

/**
 * The tumble rate the port gives every thrown weapon, in BAMS per frame.
 *
 * `[diverges]` **The engine has no authored value.** The projectile's
 * `obj+0x135C` is never written by either launcher — `SpawnThrownWeapon`
 * (`FUN_004504E0`) writes the model and `obj+0x1364`, `ZombieThrowHandWeapon`
 * (`FUN_0045A240`) the model and the position — and the allocator does not
 * clear it: `FUN_004A6FA0` zeroes exactly the first 0xD dwords, the task
 * header, and `FUN_004A7400` is a free-list split that returns the block as it
 * stands. So the rate the engine tumbles at is whatever the previous occupant
 * of that arena block left behind, which is a thing a port with no arena
 * cannot reproduce and should not pretend to.
 *
 * It is also, on that reading, why the report said *the spin depends on which
 * zombie is throwing the axe*.
 *
 * `0x200` is the middle of the range `class30/throw.ts` used to draw at
 * random, so a weapon tumbles at about the speed it always has.
 */
export const THROWN_SPIN_RATE = 0x200;


/**
 * `ThrownWeaponFlyToTarget` — `FUN_0044FD40`. One weapon, one frame.
 * Returns false once it should be removed from the pool.
 */
export function ThrownWeaponFlyToTarget(i: number, frames: number,
                                        events?: Events): boolean {
  const p = G.g_thrown_weapons[i];
  if (p.ttl > 0) {
    // Class 0x30's arced throw is the only one with an acceleration:
    // `ZombieThrownWeaponStateArc` adds it into the velocity first, then
    // steps, which is what makes the curve land where the solve put it.
    if (p.acc) {
      p.vel.x += p.acc.x * frames;
      p.vel.y += p.acc.y * frames;
      p.vel.z += p.acc.z * frames;
    }
    p.pos.x += p.vel.x * frames;
    p.pos.y += p.vel.y * frames;
    p.pos.z += p.vel.z * frames;
    p.spinAngle += p.spin * frames;
    p.ttl -= frames;
    if (p.ttl <= 0 && !p.hit) {
      p.hit = true;
      PlayerTakeDamageTimed(0, ActorByAt(p.from) ?? null, p.hitKind ?? 0,
                            events);
    }
    return true;
  }
  // Stuck in view, then blinking, then gone.
  p.after += frames;
  p.visible = p.after <= p.stickFrames
    || Math.floor(p.after - p.stickFrames) % 2 === 0;
  return p.after < p.stickFrames + p.blinkFrames;
}

/** `ThrownWeaponUpdate` — `FUN_00450780`. The whole pool, back to front. */
export function ThrownWeaponUpdate(frames: number, events?: Events): void {
  for (let i = G.g_thrown_weapons.length - 1; i >= 0; i--) {
    if (!ThrownWeaponFlyToTarget(i, frames, events)) {
      G.g_thrown_weapons.splice(i, 1);
    }
  }
}

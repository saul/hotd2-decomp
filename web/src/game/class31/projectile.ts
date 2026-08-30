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
 * `ThrownWeaponFlyToTarget` — `FUN_0044FD40`. One weapon, one frame.
 * Returns false once it should be removed from the pool.
 */
export function ThrownWeaponFlyToTarget(i: number, frames: number,
                                        events?: Events): boolean {
  const p = G.g_thrown_weapons[i];
  if (p.ttl > 0) {
    p.pos.x += p.vel.x * frames;
    p.pos.y += p.vel.y * frames;
    p.pos.z += p.vel.z * frames;
    p.spinAngle += p.spin * frames;
    p.ttl -= frames;
    if (p.ttl <= 0 && !p.hit) {
      p.hit = true;
      PlayerTakeDamageTimed(0, ActorByAt(p.from) ?? null, 0, events);
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

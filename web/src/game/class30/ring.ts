/**
 * `TestApproachRing` — `FUN_00456650`.
 *
 * Every enemy measures its distance **to the camera** — not to a player, the
 * camera *is* the player here — and the ring it falls in yields a number:
 *
 * ```
 * d >  outer        base + mid_add + outer_add     (2 + 3 + 4 = 9)
 * mid  < d <= outer base + mid_add                 (2 + 3     = 5)
 * d <= mid          base                           (2)
 * d <= inner        band 1: in strike range
 * ```
 *
 * That number is **not a step count**. It is how deep in the distance queue an
 * actor may sit and still be allowed to press an attack, so the ring table is
 * a crowd throttle: far out a deeper slice of the queue may come at you, close
 * in only the nearest couple.
 *
 * The radii are `{25, 38, 51}` for most characters and `{37, 48, 51}` for
 * character type 0, copied from `g_approach_ring_defaults` (0x004C4CD0) by the
 * scene reset. No stage script uses evt `0x0E`, the opcode that would override
 * them.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import { dist2d, type Vec3 } from "../vec";

/** The band: 1 strike range, 2 inside mid, 3 inside outer, 4 beyond. */
export type RingBand = 1 | 2 | 3 | 4;

/** The inner radius of this actor's ring set. */
export function ApproachInnerRadius(obj: Actor): number {
  return G.g_enemy_approach_rings[obj.ringSet]
      ?? G.g_enemy_approach_rings[0] ?? 0;
}

/**
 * Returns the band **and writes `obj+0x1358`** on the way through, which is
 * how `ZombieStateHoldAtRange` refreshes the allowance by calling it and
 * ignoring the result.
 */
export function TestApproachRing(obj: Actor, eye: Vec3): RingBand {
  const inner = ApproachInnerRadius(obj);
  const mid = G.g_enemy_approach_ring_mid[obj.ringSet]
           ?? G.g_enemy_approach_ring_mid[0] ?? inner;
  const outer = G.g_enemy_approach_ring_outer[obj.ringSet]
             ?? G.g_enemy_approach_ring_outer[0] ?? mid;
  const base = G.g_enemy_approach_steps;
  // The game measures on the ground plane only -- x and z.
  const d = dist2d(obj.pos, eye);
  if (d <= inner) { obj.allowance = base; return 1; }
  if (d <= mid) { obj.allowance = base; return 2; }
  if (d <= outer) {
    obj.allowance = base + G.g_enemy_approach_steps_mid;
    return 3;
  }
  obj.allowance = base + G.g_enemy_approach_steps_mid
                + G.g_enemy_approach_steps_outer;
  return 4;
}

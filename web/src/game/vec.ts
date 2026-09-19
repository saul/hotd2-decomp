/**
 * The port's own vector type.
 *
 * Plain `{x, y, z}` and free functions, because `game/` may not import three
 * and — the sharper reason — a snapshot is `structuredClone` of the state, so
 * anything with a prototype or a method in it would not survive the round
 * trip. See docs/PLAYER_ARCHITECTURE.md, rule 2 of the save state.
 */

export interface Vec3 { x: number; y: number; z: number }

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

/** 65536 BAMS to the turn. */
export const BAMS = 65536 / (Math.PI * 2);

/** Ground-plane distance. Every range test in the enemy code is x/z only. */
export function dist2d(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function dist3d(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * `VecToAngles` — `FUN_004016B0`. A direction as a BAMS angle pair.
 *
 * ```
 * yaw   = (s16) atan2(dx, dz)
 * h     = |yaw + 0x2000| & 0x4000 ? dx / sin(yaw) : dz / cos(yaw)
 * pitch = -(s16) atan2(dy, h)
 * ```
 *
 * `h` is the horizontal length whichever way it is divided out, so the pitch
 * is `-atan2(dy, hypot(dx, dz))` — **negative looking up**, which is the sign
 * `MatrixRotateX` needs for `BuildEntitySpotlightArray` to rotate `(0,0,1)`
 * back onto the vector. `[proved]` from the decompile, read for the gun
 * lights; this used to return the opposite sign, written "the obvious way"
 * and unread. The s16 truncation is not modelled: `yaw` feeds the
 * eased turns in `actor_turn.ts`, where it has never been the question.
 */
export function VecToAngles(dx: number, dy: number, dz: number):
    { pitch: number; yaw: number } {
  return {
    yaw: Math.atan2(dx, dz) * BAMS,
    pitch: -Math.atan2(dy, Math.hypot(dx, dz)) * BAMS,
  };
}

/**
 * The angle helpers live in `core/bams.ts` and are re-exported here.
 *
 * There is one definition of a BAMS turn in the player, and `core/` is where
 * it is. These stay reachable from `../vec` because that is where forty call
 * sites already look for them, and moving those would be churn for nothing.
 */
export { bamsDelta, bamsWrap } from "../core/bams";

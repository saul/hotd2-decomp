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
 * Only `yaw` is exercised by the ported code; `pitch` is written the obvious
 * way and has not been checked against the exe's own, so nothing reads it yet.
 */
export function VecToAngles(dx: number, dy: number, dz: number):
    { pitch: number; yaw: number } {
  return {
    yaw: Math.atan2(dx, dz) * BAMS,
    pitch: Math.atan2(dy, Math.hypot(dx, dz)) * BAMS,
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

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
 * `yaw = atan2(dx, dz)`, and `pitch = -atan2(dy, h)` with `h` the horizontal
 * length recovered as `dz / cos(yaw)` or `dx / sin(yaw)` by the same
 * `(yaw + 0x2000) & 0x4000` choice `VecAimXAxisYThenZ` makes -- **negative
 * upward**, which is what `MatrixRotateX(pitch)` needs to tip +Z onto the
 * vector. `[proved]` from the decompilation (the pitch used to be written
 * positive upward, unchecked, and had no reader until `CarriedPropHitTargetSphere`).
 * The engine truncates both to s16; the port hands back the floats and a
 * caller that needs the truncation applies it.
 */
export function VecToAngles(dx: number, dy: number, dz: number):
    { pitch: number; yaw: number } {
  const yaw = Math.atan2(dx, dz) * BAMS;
  const y16 = Math.trunc(yaw);
  const a = y16 / BAMS;
  const h = ((y16 + 0x2000) & 0x4000) === 0 ? dz / Math.cos(a) : dx / Math.sin(a);
  return { yaw, pitch: -Math.atan2(dy, h) * BAMS };
}

/**
 * `LerpWeighted` — `FUN_00401E60`. `(den * a + num * b) / (num + den)`.
 *
 * ```
 * 00401e60  FILD [den]; FMUL [a]; FILD [num]; FMUL [b]; FADDP
 * 00401e80  FIDIV [num + den]                ; returned in ST0
 * ```
 *
 * `num` and `den` are ints. The camera eases call it with `(1, 15)`; class
 * 0x22's glides call it with `(1, 60 - n)`, and on the frame `n` reaches 61
 * the divisor is zero and the x87 hands back an infinity -- which the same
 * frame's snap overwrites. The port divides the way the FPU does, so it does
 * too. The caller stores the result as a float.
 */
export function LerpWeighted(a: number, b: number, num: number,
                             den: number): number {
  return (den * a + num * b) / ((num + den) | 0);
}

/**
 * The angle helpers live in `core/bams.ts` and are re-exported here.
 *
 * There is one definition of a BAMS turn in the player, and `core/` is where
 * it is. These stay reachable from `../vec` because that is where forty call
 * sites already look for them, and moving those would be churn for nothing.
 */
export { bamsDelta, bamsWrap } from "../core/bams";

/**
 * BAMS: the engine's angle unit. 65536 is a full turn.
 *
 * One definition, because there were nine and they did not agree. Seven files
 * spelled the constant `(Math.PI * 2) / 65536` and two spelled it
 * `9.58738e-5`, which differ in the sixth significant figure — small enough
 * never to be noticed and large enough to make two layers disagree about where
 * the same object is pointing.
 *
 * ## Which of the three is right
 *
 * The exe's rotators hold the constant as a **float32**: Ghidra prints it
 * `9.58738e-05`, and `docs/re/session-log.md` records it as 2π/65536,
 * confirming BAMS. So the faithful value is 2π/65536 rounded to float32, which
 * is what `Math.fround` says — not the double, and not the six-digit literal
 * that was a decompiler's rendering of the float in the first place.
 *
 * The three differ by about one part in 10^8, which is a ten-millionth of a
 * degree over a full turn. This is not a fix for a visible problem; it is
 * having one answer instead of three.
 *
 * `bamsEuler` is **not** here: it returns a three.js `Euler`, and `core/` does
 * not import three. It lives in `render/bams.ts`, one layer up.
 */

/** Radians per BAMS unit. `Math.fround` because the exe's constant is a float. */
export const BAMS_TO_RAD = Math.fround((Math.PI * 2) / 65536);

/** BAMS units per radian. */
export const RAD_TO_BAMS = 65536 / (Math.PI * 2);

/** BAMS to radians. */
export function bamsToRad(a: number): number {
  return a * BAMS_TO_RAD;
}

/**
 * Radians to BAMS, rounded and wrapped.
 *
 * Rounded because BAMS are integers everywhere the engine stores one —
 * `g_camera_yaw_bams` and `obj+0x68` among them — and a fractional angle makes
 * every `===` against a stored one a coin toss.
 */
export function radToBams(r: number): number {
  return bamsWrap(Math.round(r * RAD_TO_BAMS));
}

/** Wrap into [0, 65536). */
export function bamsWrap(a: number): number {
  return ((a % 65536) + 65536) % 65536;
}

/** Shortest signed difference, in (-32768, 32768]. */
export function bamsDelta(to: number, from: number): number {
  return ((to - from) % 65536 + 98304) % 65536 - 32768;
}

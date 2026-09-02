/**
 * The hinge's angles, alone: the pose block of `HingeUpdate`
 * (`FUN_00473CF0`), and nothing else.
 *
 * Split out of `props.ts` because it is the only part of that file that is a
 * *transcription*: pure integer BAMS arithmetic, no three.js, no node, no
 * bundle. That makes it the part worth asserting on, and `test/port.test.ts`
 * does. The rest of `props.ts` — binding names to glTF nodes, quaternions,
 * the overlay — is the renderer's own work and has no counterpart in the exe.
 *
 * It is also the shape the routine would have to be in to move into `game/`,
 * where the layering says it belongs; see `docs/PLAYER_PROGRESS.md`.
 */

/** `obj+0x1DC` decides which way a hinge swings, and *only* by its sign. */
export interface HingeMirror {
  /**
   * `obj+0x1DC`. The exe reads this field twice: `TEST EAX,EAX; JLE` at
   * `0x00473EE6`, which picks between `ADD`/`SUB` on the X angle and a `NEG`
   * on the yaw; and `IMUL EAX,[ESI+0x1DC]` at `0x00473FB5`, the amplitude of
   * the wobble a prop does when it is **shot**. Nothing multiplies the pose by
   * it, and four of the game's 56 hinges carry a magnitude in the hundreds.
   */
  side: number;
}

/** `obj+0x64`, `obj+0x68`, `obj+0x6C` — the angles the draw consumes. */
export interface HingeAngles {
  /** `obj+0x64` — `base_rx ± curve.rx`. */
  rx: number;
  /** `obj+0x68` — `±ftol(curve.ry * obj+0x2C0)`, and that scale is 1.0. */
  ry: number;
  /** `obj+0x6C` — `base_rz + curve.rz`, never mirrored. */
  rz: number;
}

/**
 * One frame of the hinge's pose, from one `[rx, ry, rz]` curve key.
 *
 * `base_rx` (`obj+0x1CC`) and `base_rz` (`obj+0x1D4`) are omitted because no
 * constructor of this family writes either: `PropBuildHinge` (`FUN_00472BD0`),
 * `PropBuildVanDoors` (`FUN_00472C90`) and `PropBuildHingeScaled`
 * (`FUN_00472EB0`) all leave them at the pool's zero, and `HingeUpdate` only
 * reads them. So is the `FMUL float ptr [ESI+0x2C0]` on the yaw: all three
 * seed `obj+0x2C0` with `1.0f`. Both `[proved]`.
 */
export function HingePose(h: HingeMirror, key: readonly number[]): HingeAngles {
  const mirror = h.side <= 0 ? -1 : 1;
  return { rx: mirror * key[0], ry: mirror * key[1], rz: key[2] };
}

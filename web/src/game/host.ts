/**
 * The three things the port cannot work out on its own.
 *
 * [diverges] The engine reads a bone's world matrix straight out of the
 * actor's own draw records at `obj+0x20C + bone*0x90`, and builds the aim
 * point in the camera's matrix, which it also owns. Here the skeleton and the
 * camera live in three.js, and `game/` may not import it. So the renderer
 * supplies these three answers and the port asks for them by name — a seam,
 * declared, rather than three.js leaking across the boundary.
 *
 * Nothing here returns state: every answer is derived from this frame's pose,
 * so none of it is in a snapshot.
 */
import type { Vec3 } from "./vec";

export interface GameHost {
  /** World position of one bone on one actor. False if it is not posed. */
  boneWorld(at: number, bone: number, out: Vec3): boolean;
  /** A point `ahead` units in front of the camera, at the eye's height. */
  aimPoint(ahead: number, out: Vec3): void;
  /**
   * A point in the camera's own space, in world coordinates. The engine builds
   * these by unprojecting a screen offset at a depth — see
   * `ThrowerPickLandingPoint`.
   */
  viewPoint(x: number, y: number, z: number, out: Vec3): void;
  /** Swap the asset drawn for one bone — a hand going bare, or gore. */
  setBoneSlot(at: number, bone: number, slot: number): void;
}

/** A host that knows nothing, for headless runs. */
export const NULL_HOST: GameHost = {
  boneWorld: () => false,
  aimPoint: () => {},
  viewPoint: () => {},
  setBoneSlot: () => {},
};

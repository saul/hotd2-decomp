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
  /**
   * `CamEvalObjectPath6` — a point on an `op_` object path at a frame.
   *
   * Class 0x25's actors ride these, and the curves live in the bundle's camera
   * block, which `game/` cannot reach: evaluating a Hermite spline is the
   * renderer's job and its result is three.js's. Optional, because a host with
   * no camera paths is a valid host — the port then leaves the actor where it
   * was, which is what a missing path should look like.
   */
  objectPath?(slot: number, frame: number):
    { x: number; y: number; z: number; yaw?: number } | null;

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
  /**
   * The actor's tracked point in the camera's own space — `obj+0x70/74/78`,
   * which `ActorRegisterCameraPoint` fills each frame. `ActorIsOnScreen` needs
   * it to decide whether the actor may take an attack permit at all.
   */
  viewSpaceOf(at: number, out: Vec3): boolean;
  /** Swap the asset drawn for one bone — a hand going bare, or gore. */
  setBoneSlot(at: number, bone: number, slot: number): void;
}

/*
 * `QueryGroundHeightAt`, `QueryGroundSurfaceAt` and `ColiTraceSegmentAllSets`
 * used to be host methods, answered off the *drawn* geometry.
 *
 * They are not any more. The bundle carries the game's own `coli/` sets, so
 * `game/coli.ts` answers them itself — which means the wall search, the ground
 * height and the surface material all work headlessly, against the same quads
 * the engine tests, with the material ids that only `coli/` has. A seam that
 * could only see the resident region and had to report 0 for every surface was
 * the wrong shape for the question.
 */

/** A host that knows nothing, for headless runs. */
export const NULL_HOST: GameHost = {
  boneWorld: () => false,
  aimPoint: () => {},
  viewPoint: () => {},
  viewSpaceOf: () => false,
  setBoneSlot: () => {},
};

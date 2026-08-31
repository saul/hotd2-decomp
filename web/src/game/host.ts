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
  /**
   * `ColiTraceSegmentAllSets` — does the level get in the way between these
   * two points, and where?
   *
   * The engine traces against the `coli/` sets, which are simplified meshes
   * loaded beside the geometry; the bundle does not carry them, so the host
   * answers from whatever it has. Optional, and a host that cannot answer is a
   * valid host: `ThrowerFindWallBeside` and `ThrowerFindCeilingAbove` return
   * false on a miss, and the engine does exactly the same thing when there is
   * no wall — the actor simply does not take that action.
   */
  traceSegment?(from: Vec3, to: Vec3, out: Vec3): boolean;
  /**
   * `QueryGroundSurfaceAt` (`FUN_00409D80`). The **material id** under a
   * point, not its height: a vertical trace from 1000 units below, returning
   * `g_coli_hit_surface`.
   *
   * Only one thing in the port asks — `ThrowerStateWaitForPermit`, deciding
   * whether a `zskamere` is perched on surface `0x35` — and a host that cannot
   * answer reports 0, which sends it to the standing strike instead. That is
   * the same branch it takes on any other surface.
   */
  groundSurfaceAt?(x: number, y: number, z: number): number;
}

/**
 * `QueryGroundHeightAt` — `FUN_00409D40`. A vertical trace from 1000 units
 * below the point up to it, returning the height of what it hit.
 *
 * [diverges] The engine's is a real query against the collision sets and
 * returns 0 for a miss; here a host with no collision has no answer at all, so
 * this reports `null` and every caller falls back to something the engine
 * itself falls back to.
 */
export function QueryGroundHeightAt(host: GameHost, x: number, y: number,
                                    z: number, out: Vec3): number | null {
  if (!host.traceSegment) return null;
  return host.traceSegment({ x, y: y - GROUND_PROBE, z }, { x, y, z }, out)
    ? out.y : null;
}

/** `FUN_00409D40`'s own reach. */
const GROUND_PROBE = 1000;

/** A host that knows nothing, for headless runs. */
export const NULL_HOST: GameHost = {
  boneWorld: () => false,
  aimPoint: () => {},
  viewPoint: () => {},
  viewSpaceOf: () => false,
  setBoneSlot: () => {},
};

/**
 * `ThrowerPickLandingPoint` — `FUN_0044CBA0`. Where a leap ends up.
 *
 * It is not a place in the world. It is a place on the **screen**: a pixel
 * offset divided by `g_projection_distance_px` and unprojected at a fixed
 * depth, so the actor always arrives the same distance in front of the camera
 * and the same distance below it however the camera happens to be pointing.
 *
 * That is the whole reason a pounce lands on you rather than near you, and it
 * is also why `ThrowerStrikeConnect` needs no range test: the flight has
 * already put the actor where the swing will reach.
 */
import type { Actor } from "../actor";
import type { GameHost } from "../host";
import { CharacterTypeOf } from "../tables";
import type { Vec3 } from "../vec";

/** `local_10` — the depth the landing point is unprojected at. */
const LANDING_DEPTH = -15.5;
/** `fVar2` — the vertical pixel offset, by character type. */
const LANDING_PX_ZSASS = 390;
const LANDING_PX_OTHER = 320;
/**
 * `g_projection_distance_px` — 0x009A2D70.
 *
 * [likely] Not read out of the binary; derived from `SetupSceneProjection`,
 * which builds the projection from 41.100 degrees vertical over 4:3. For a
 * 480-line frame that is `240 / tan(41.1/2)` = 640.2. Only the ratio
 * `px / this` matters, and it puts the landing point 9.4 units below the eye.
 */
const PROJECTION_DISTANCE_PX = 640.2;

export function ThrowerPickLandingPoint(obj: Actor, host: GameHost,
                                        out: Vec3): void {
  // [diverges] Seeded with the actor's own position so that a host which
  // cannot answer -- `NULL_HOST`, or a headless run with no camera -- yields a
  // zero-length arc and the actor stays put. The engine has no such case: it
  // always has a camera matrix, and an unseeded `out` here sent the pounce off
  // toward the world origin at two units a frame.
  out.x = obj.pos.x; out.y = obj.pos.y; out.z = obj.pos.z;
  const px = CharacterTypeOf(obj)?.type === 0x16
    ? LANDING_PX_ZSASS : LANDING_PX_OTHER;
  // The sideways offset is +/-160px per player and zero with one attacker,
  // which is the only case this port has.
  host.viewPoint(0, (px * LANDING_DEPTH) / PROJECTION_DISTANCE_PX,
                 LANDING_DEPTH, out);
}

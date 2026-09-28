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
import { G } from "../globals";
import type { GameHost } from "../host";
import type { Vec3 } from "../vec";
import { ThrowerState } from "./states";

/** `local_10` — the depth the landing point is unprojected at. */
const LANDING_DEPTH = -15.5;
/** `MOV [ESP+0x10], 0xc0c00000` at `0x0044CBDA`: state 23's, much nearer. */
const LANDING_DEPTH_DELAYED_POUNCE = -6.0;
/** `fVar1` — the vertical pixel offset, by character type... */
const LANDING_PX_ZSASS = 390;
const LANDING_PX_OTHER = 320;
/** ...and from states 22 and 23, whatever the type: `0x00565E08`. */
const LANDING_PX_SCRIPTED = -350;
/** `fVar2` — the sideways pixel offset, `+` for player 0 and `-` for 1. */
const LANDING_PX_SIDE = 160;
const CHAR_ZSASS = 0x16;
/**
 * `g_projection_distance_px` — 0x009A2D70.
 *
 * [likely] Not read out of the binary; derived from `SetupSceneProjection`,
 * which builds the projection from 41.100 degrees vertical over 4:3. For a
 * 480-line frame that is `240 / tan(41.1/2)` = 640.2. Only the ratio
 * `px / this` matters, and it puts the landing point 9.4 units below the eye.
 */
const PROJECTION_DISTANCE_PX = 640.2;

/**
 * `[proved]`, from the listing -- every constant is an `FLD` the pseudocode
 * shows only as its value:
 *
 * ```
 * 0044cba9  depth = -15.5                              ; 0xc1780000
 * 0044cbb1  switch (obj+0x1310)                        ; the STATE
 *   0x16    vert = -350.0                              ; [0x00565E08]
 *   0x17    depth = -6.0; vert = -350.0                ; 0xc0c00000
 *   else    vert = obj+0x1F4 == 0x16 ? 390.0 : 320.0   ; [0x00565E0C]/[0x004C49CC]
 * 0044cbe8  side = obj+0x121 == 0 ? 160.0 : == 1 ? -160.0 : 0.0
 * 0044cc0d  if (g_max_attackers == 1) side = 0.0
 * 0044cc1f  p = (side * depth / g_projection_distance_px,
 *                vert * depth / g_projection_distance_px, depth)
 * 0044cc3d  MatrixStackPush; top = g_camera_blocks[g_camera_index] (view -> world)
 * 0044cc86  MatrixTransformPoint(p) -> out
 * ```
 *
 * The switch is on `obj+0x1310`, the state -- so `ThrowerStateLeapStrike`
 * (22) and `ThrowerStateDelayedPounce` (23) land *above* the line of sight
 * rather than below it, and 23 at six units rather than fifteen and a half.
 * This used to take the type's offset at -15.5 for every caller and no
 * sideways offset at all, which put state 23's pounce 9.5 units short of
 * where the engine lands it.
 */
export function ThrowerPickLandingPoint(obj: Actor, host: GameHost,
                                        out: Vec3): void {
  // [diverges] Seeded with the actor's own position so that a host which
  // cannot answer -- `NULL_HOST`, or a headless run with no camera -- yields a
  // zero-length arc and the actor stays put. The engine has no such case: it
  // always has a camera matrix, and an unseeded `out` here sent the pounce off
  // toward the world origin at two units a frame.
  out.x = obj.pos.x; out.y = obj.pos.y; out.z = obj.pos.z;
  let depth = LANDING_DEPTH;
  let vert: number;
  if (obj.state === ThrowerState.LeapStrike
      || obj.state === ThrowerState.DelayedPounce) {
    if (obj.state === ThrowerState.DelayedPounce) {
      depth = LANDING_DEPTH_DELAYED_POUNCE;
    }
    vert = LANDING_PX_SCRIPTED;
  } else {
    vert = obj.charType === CHAR_ZSASS ? LANDING_PX_ZSASS : LANDING_PX_OTHER;
  }
  // `obj+0x121` -- the permit the actor holds, as a signed byte.
  let side = obj.attackPermit === 0 ? LANDING_PX_SIDE
    : obj.attackPermit === 1 ? -LANDING_PX_SIDE : 0;
  if (G.g_max_attackers === 1) side = 0;
  host.viewPoint((side * depth) / PROJECTION_DISTANCE_PX,
                 (vert * depth) / PROJECTION_DISTANCE_PX, depth, out);
}

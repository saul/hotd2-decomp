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
import { PROJECTION_DISTANCE_PX } from "../combat/permits";
import { G } from "../globals";
import type { GameHost } from "../host";
import { MatIdentity, MatrixRotateY, MatrixTransformPoint, MatrixTranslate }
  from "../matrix";
import type { Vec3 } from "../vec";
import { ThrowerState } from "./states";

/** `local_10` — the depth the landing point is unprojected at. */
const LANDING_DEPTH = -15.5;
/** `MOV [ESP+0x10], 0xc0c00000` at `0x0044CBDA`: state 23's, much nearer. */
const LANDING_DEPTH_DELAYED_POUNCE = -6.0;
/**
 * `fVar1` — the vertical pixel offset, by character type: `float ptr
 * [0x00565E0C]` = 390.0 for 0x16 and `[0x004C49CC]` = 320.0 otherwise...
 */
const LANDING_PX_ZSASS = 390;
const LANDING_PX_OTHER = 320;
/** ...and from states 22 and 23, whatever the type: `0x00565E08`. */
const LANDING_PX_SCRIPTED = -350;
/** `fVar2` — the sideways pixel offset, `+` for player 0 and `-` for 1. */
const LANDING_PX_SIDE = 160;
const CHAR_ZSASS = 0x16;
// `g_projection_distance_px` is {@link PROJECTION_DISTANCE_PX}, the shared
// constant, which is `[proved]` 640.2079 from `SetupSceneProjection`'s
// listing; this file used to carry its own rounded copy of it, 640.2.

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
  if (obj.charType === CHAR_ZSLMAN) ThrowerPickLandingPointZslman(obj, out);
}

/** `CMP word ptr [ESI+0x1F4], 0x18` at `0x0044CCAD`. */
const CHAR_ZSLMAN = 0x18;
/** `[0x00565DFC]` = -1.2f and `[0x0055D79C]` = -5.0f: the two side scales. */
const ZSLMAN_SIDE_FLOOR = Math.fround(-1.2);
const ZSLMAN_SIDE_WALL = -5.0;
/** `MOV [ESP+0x38], 0xC1200000` at `0x0044CE10`: ten units ahead. */
const ZSLMAN_AHEAD = -10.0;

/**
 * `ThrowerPickLandingPoint`'s tail for character type 0x18, `zslman`
 * (`0x0044CCAD`..`0x0044CE38`, past the end of Ghidra's function body): the
 * screen point just picked is **thrown away** and the landing re-picked in
 * the gameplay camera's own frame, by the surface the actor is on:
 *
 * ```c
 * side = (g_max_attackers != 1 && permit != -1) ? (1 - 2*permit) * -1.2 : 0;
 * switch (bit8*3 + bit7*2 + bit6 of obj+0x136C) {     // table at 0x0044CE44
 *   0 (floor):   y = 4.5;
 *   1 (WallA):   side = two && permit ? (1 - 2*permit) * -5.0 : -3.0; y = 15.5;
 *   2 (WallB):   side = two && permit ? (1 - 2*permit) * -5.0 :  3.0; y = 15.5;
 *   3 (ceiling): y = 27.0;
 * }
 * MatrixLoadIdentity(); MatrixTranslate(g_camera_eye);
 * MatrixRotateY(g_camera_yaw_bams + 0x8000);
 * *out = MatrixTransformPoint((side, y, -10.0));
 * ```
 *
 * `[proved]`. Both camera words are the gameplay ones (`0x009C71E0`..`E8` at
 * `0x0044CDCD`, `0x009C71F0` at `0x0044CDE6`). A selector past 3 needs two
 * surface bits at once, which no writer raises; the engine would read its
 * `y` from a stack slot holding the `out` pointer, and the port leaves it on
 * the floor's.
 */
function ThrowerPickLandingPointZslman(obj: Actor, out: Vec3): void {
  const two = G.g_max_attackers !== 1 && obj.attackPermit !== -1;
  let side = two ? Math.fround((1 - 2 * obj.attackPermit) * ZSLMAN_SIDE_FLOOR)
    : 0;
  const f = obj.flags2;
  const sel = ((f >> 8) & 1) * 3 + ((f >> 7) & 1) * 2 + ((f >> 6) & 1);
  let y = 4.5;
  if (sel === 1 || sel === 2) {
    side = two ? (1 - 2 * obj.attackPermit) * ZSLMAN_SIDE_WALL
      : sel === 1 ? -3.0 : 3.0;
    y = 15.5;
  } else if (sel === 3) {
    y = 27.0;
  }
  const m = MatIdentity();
  const e = G.g_camera_eye;
  MatrixTranslate(m, e.x, e.y, e.z);
  MatrixRotateY(m, G.g_camera_yaw_bams + 0x8000);
  const p = { x: side, y, z: ZSLMAN_AHEAD };
  MatrixTransformPoint(m, p, p);
  out.x = Math.fround(p.x);
  out.y = Math.fround(p.y);
  out.z = Math.fround(p.z);
}

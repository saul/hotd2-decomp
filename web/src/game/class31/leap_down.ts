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
 *
 * **Except for `zslman`**, character type 0x18, whose tail throws the screen
 * point away and lands ten units in front of the gameplay eye,
 * `g_camera_eye` -- see the tail of {@link ThrowerPickLandingPoint}.
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
  // `CMP word ptr [ESI+0x1f4], 0x18; JNZ` at `0x0044CCAD`: every type but
  // `zslman` is done. The rest was past a `MatrixStackPop` Ghidra marks
  // no-return (`L35`), so the port never had it.
  if (obj.charType !== CHAR_ZSLMAN) return;
  // The tail for `zslman`, `0x0044CCBB`..`0x0044CE3B`:
  // the screen point is thrown away and the landing is taken off the
  // **gameplay eye** instead, ten units down its heading. `[proved]`:
  //
  // ```
  // 0044ccbb  one = (word)g_max_attackers == 1 || (s8)obj+0x121 == -1
  //           x = one ? 0.0 : (1 - 2 * permit) * -1.2          ; [0x00565DFC]
  // 0044ccfa  stance = bit6 + 2*bit7 + 3*bit8 of obj+0x136C
  // 0044cd20  if (stance > 3) goto T                           ; table 0x0044CE44
  //   0  y = 4.5                                               ; 0x0044CD30
  //   1  x = one ? -3.0 : (1 - 2 * permit) * -5.0; y = 15.5     ; 0x0044CD47
  //   2  x = one ?  3.0 : (1 - 2 * permit) * -5.0; y = 15.5     ; 0x0044CD81
  //   3  y = 27.0                                              ; 0x0044CD3D
  // T 0044cdc1  Push; LoadIdentity; Translate(g_camera_eye)      ; 0x009C71E0..E8
  // 0044cde6  RotateY(g_camera_yaw_bams + 0x8000)               ; 0x009C71F0
  // 0044ce18  out = M * (x, y, -10.0); Pop
  // ```
  //
  // `x` and `y` live in the routine's own argument slots, `[ESP+0x24]` (the
  // actor pointer) and `[ESP+0x28]` (the `out` pointer), which the body reuses
  // once it has both in registers. So the stance > 3 arm, which writes no `y`,
  // turns the `out` pointer's bits into a float. `[likely]` every address the
  // engine hands it is below `0x10000000`, under `1e-28` as a float, which
  // vanishes against the eye's height in the sum -- the port's 0 is that
  // value to float precision; and no shipped spawn has two surface bits (see
  // `EnemyThrowerUpdate`'s note in `thrower.ts`). `g_camera_yaw_bams` is the
  // scene-state hook's heading, turned half round here, so the `-10` is in
  // front of the camera.
  const one = G.g_max_attackers === 1 || obj.attackPermit === -1;
  const facing = 1 - 2 * obj.attackPermit;
  let x = one ? 0 : Math.fround(facing * ZSLMAN_SIDE_GROUND);
  let y = 0;
  const f = obj.flags2;
  const stance = ((f >> 6) & 1) + 2 * ((f >> 7) & 1) + 3 * ((f >> 8) & 1);
  switch (stance) {
    case 0: y = ZSLMAN_RISE_GROUND; break;
    case 1:
      x = one ? -ZSLMAN_SIDE_WALL_ONE : Math.fround(facing * ZSLMAN_SIDE_WALL);
      y = ZSLMAN_RISE_WALL;
      break;
    case 2:
      x = one ? ZSLMAN_SIDE_WALL_ONE : Math.fround(facing * ZSLMAN_SIDE_WALL);
      y = ZSLMAN_RISE_WALL;
      break;
    case 3: y = ZSLMAN_RISE_CEILING; break;
  }
  const m = MatIdentity();
  MatrixTranslate(m, G.g_camera_eye.x, G.g_camera_eye.y, G.g_camera_eye.z);
  MatrixRotateY(m, G.g_camera_yaw_bams + 0x8000);
  MatrixTransformPoint(m, { x, y, z: ZSLMAN_AHEAD }, out);
  out.x = Math.fround(out.x);
  out.y = Math.fround(out.y);
  out.z = Math.fround(out.z);
}

const CHAR_ZSLMAN = 0x18;
/** `[0x00565DFC]` = -1.2 (`9a9999bf`): the sideways step on the ground. */
const ZSLMAN_SIDE_GROUND = -1.2000000476837158;
/** `[0x0055D79C]` = -5.0 (`0000a0c0`): the sideways step on a wall. */
const ZSLMAN_SIDE_WALL = -5.0;
/** `0xc0400000` / `0x40400000`: a wall's step with no permit to go by. */
const ZSLMAN_SIDE_WALL_ONE = 3.0;
/** `0x40900000`, `0x41780000`, `0x41d80000`: the height, by stance. */
const ZSLMAN_RISE_GROUND = 4.5;
const ZSLMAN_RISE_WALL = 15.5;
const ZSLMAN_RISE_CEILING = 27.0;
/** `MOV [ESP+0x38], 0xc1200000` at `0x0044CE10`: ten in front. */
const ZSLMAN_AHEAD = -10.0;

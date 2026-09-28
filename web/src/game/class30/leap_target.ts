/**
 * Where a class-0x30 leap comes down -- the routine two states share.
 *
 * The routine at `0x0045A690` has two callers, and they are its two modes: state 28's pounce (`0x0045880B`, mode 1 when the descriptor
 * names a point and 0 when it does not) and the condition-4 leap strike at
 * `0x0045E480` (mode 0). It rewrites the point it is handed.
 *
 * `[proved]` from the listing, `0x0045A690`..`0x0045A87D`:
 *
 * ```
 * 0045a6a3  CMP  word ptr [g_max_attackers], 0x1 / JZ   ; x = 0
 * 0045a6ad  MOVSX EAX, byte [EDI+0x121]; SHL 1; 1 - EAX ; FILD; FADD ST0,ST0
 * 0045a6d9  DEC  mode / JZ 0x0045a7b6                   ; 1 is "from the point"
 * 0045a6fd  MatrixStackSetTopFromArray(g_camera_blocks + g_camera_index*0x1A4 + 0x40)
 * 0045a70b  CMP  obj+0x130C, 4 / JZ                     ; condition 4 is its own
 * 0045a722  (x, -12.0, -12.0)    c1400000 twice
 * 0045a776  (-x, -3.0, -12.5)    c0400000, c1480000
 * 0045a7b6  MatrixLoadIdentity; MatrixTranslate(point); MatrixRotateY(g_camera_yaw_bams)
 * 0045a7e9  (x, 0, 12.0)         41400000
 * 0045a837  (-x, 0, 12.5)        41480000
 * ```
 *
 * each arm ending `MatrixTransformPoint` into the point and `MatrixStackPop`.
 *
 * `[port-only]` as a module: the routine is shared by two states, so it sits
 * apart from both and neither has to import the other: state 28 is
 * `class30/pounce.ts`, and the condition-4 leap strike,
 * `g_class30_states[0x34]` at `0x0045E330`, is a port of its own.
 */
import type { ZombieActor } from "../actor";
import { ActorLocalPoint } from "../class31/arc";
import { G } from "../globals";
import type { GameHost } from "../host";
import { vec3, type Vec3 } from "../vec";

/** `ZombieLeapStrikeTarget`'s third argument. `DEC EAX; JZ` at `0x0045A6D9`. */
export enum LeapTargetMode {
  /** In the camera block's own `+0x40` matrix. Anything but 1 takes it. */
  CameraSpace = 0,
  /** From the point itself, turned by `g_camera_yaw_bams`. */
  FromPoint = 1,
}

/** `CMP dword ptr [EDI + 0x130C], 0x4` at `0x0045A70B` and `0x0045A7E4`. */
const LEAP_TARGET_OWN_CONDITION = 4;
/** `(float)(1 - 2 * obj+0x121)`, doubled by `FADD ST0, ST0`. */
const LEAP_SIDE = 2;
/** `c1400000` at `0x0045A722` and `0x0045A72A`: 12 down, 12 in front. */
const LEAP_DROP = -12.0;
const LEAP_DEPTH = -12.0;
/** `c0400000` and `c1480000` at `0x0045A776`/`0x0045A77E`. */
const LEAP_DROP_OWN = -3.0;
const LEAP_DEPTH_OWN = -12.5;
/** `41400000` at `0x0045A803` and `41480000` at `0x0045A853`. */
const LEAP_AHEAD = 12.0;
const LEAP_AHEAD_OWN = 12.5;

const _from = vec3();

/**
 * `ZombieLeapStrikeTarget` — `FUN_0045A690`. Rewrites `point` as the place a
 * leap lands.
 *
 * ```
 * x = g_max_attackers == 1 ? 0 : 2 * (1 - 2 * obj+0x121)
 * mode != 1:  point = camera_block[+0x40] . (cond 4 ? (-x, -3, -12.5)
 *                                                   : (x, -12, -12))
 * mode 1:     point = T(point) Ry(g_camera_yaw_bams) . (cond 4 ? (-x, 0, 12.5)
 *                                                           : (x, 0, 12))
 * ```
 *
 * `x` reads the permit as a signed byte, so an actor holding none (`0xFF`)
 * lands six units to the side, not two. `GameHost.viewPoint` is the `+0x40`
 * matrix's seam, as it is for state 9's landing point; a host with no camera
 * leaves the point where it was, which only a headless run can see.
 */
export function ZombieLeapStrikeTarget(obj: ZombieActor, point: Vec3,
                                       mode: LeapTargetMode,
                                       host: GameHost): void {
  const x = G.g_max_attackers === 1
    ? 0 : LEAP_SIDE * (1 - 2 * obj.attackPermit);
  const own = obj.condition === LEAP_TARGET_OWN_CONDITION;
  if (mode !== LeapTargetMode.FromPoint) {
    if (own) host.viewPoint(-x, LEAP_DROP_OWN, LEAP_DEPTH_OWN, point);
    else host.viewPoint(x, LEAP_DROP, LEAP_DEPTH, point);
    return;
  }
  _from.x = point.x; _from.y = point.y; _from.z = point.z;
  const yaw = G.g_camera_yaw_bams;
  if (own) ActorLocalPoint(_from, yaw, -x, 0, LEAP_AHEAD_OWN, point);
  else ActorLocalPoint(_from, yaw, x, 0, LEAP_AHEAD, point);
}

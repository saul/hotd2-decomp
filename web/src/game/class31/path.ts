/**
 * `ThrowerStatePathFollow` — `FUN_0044EE00`, class 0x31 state 26.
 *
 * A spawn that walks a route before it fights. The descriptor carries a delay
 * and then a list of waypoints, and the actor **leaps** to each in turn: every
 * leg is an `ActorArcStep` arc with a three-stage arc motion script over it,
 * the same machine as the pounce and the drop.
 *
 * Two spawns in the game take it, both `zsass` in stage 2: block 3's, which
 * waits 30 frames and climbs to y = 100, 110 and 115 before it throws, and
 * block 14's, which waits 45 and then jumps the rooftops -- one leg at step 1
 * and four at step 3 -- before it drops on the player.
 *
 * `[proved]`, the whole routine (`0x0044EE00`..`0x0044EF79`, jump table at
 * `0x0044EF7C`; the arms fall into each other):
 *
 * ```
 * 0  0044ee29  obj+0x1394 = desc + 8        ; the first waypoint
 *              obj+0x1330 = desc+4          ; the delay
 *              obj+0x34 |= 0x100            ; OR AH, 0x1
 *              sub++, on into 1
 * 1  0044ee52  if (--obj+0x1330 > 0) return
 *              sub++, on into 2
 * 2  0044ee70  type 0x17: ActorArcBeginToWaypoint(obj, wp+4, 0x00565E28, wp.step)
 *              else      : script by wp+2 -- 1: 0x00565E58, 2: 0x00565E88,
 *                          else 0x00565EB8 -- copied to the stack, then
 *                          ActorArcBeginToWaypoint(obj, wp+4, copy, wp.step)
 *    0044eee1  sub++, on into 3
 * 3  0044eeee  if (ActorArcStep(obj, wp.step) == 1) return
 *    0044eefb  PlaySoundId(0x2916A9)
 *              obj+0x1394 += 0x10
 *              next.step == -1:  obj+0x34 &= ~0x100
 *                                type 0x17: state 7, sub 0
 *                                else: ThrowerTryClaimAttackSlot; state 9, sub 0
 *              else sub = 2
 * ```
 *
 * The waypoint is `{s16 step, s16 style, f32 x, y, z}`. **The step is handed
 * to both `ActorArcBeginTo` and `ActorArcStep`**, and that is the whole of the
 * pace: the duration is `dist2d * step` parameter frames and the arc is flown
 * `step` of them a frame, so a leg lasts about one frame per unit whatever its
 * step, and a bigger step only makes the hop higher.
 *
 * The port used to fly the arc one parameter frame a game frame through
 * `ActorArcVelocity`, with no script: the same parabola, but the four step-3
 * legs over stage 2's rooftops took three times as long as the engine's --
 * 25, 49, 46 and 37 frames against 10, 18, 17 and 14 -- in whatever pose the
 * actor had been standing in, with no windup or landing between legs. That is
 * the "moves quite slowly" of `docs/NEW-BUGS-2.md`.
 */
import type { Events } from "../../core/events";
import type { ArcStage } from "../../bundle/characters";
import { ActorFlag, type ThrowerActor } from "../actor";
import { ThrowerTryClaimAttackSlot } from "../combat/permits";
import type { GameHost } from "../host";
import { SecondsToTicks } from "../tables";
import { vec3 } from "../vec";
import { ActorArcBeginToWaypoint, ActorArcStep } from "./arc";
import { ThrowerState } from "./states";
import { ThrowerArcScript } from "./tables";

/** `obj+0x1312` — the four arms of the jump table at `0x0044EF7C`. */
export enum PathSub {
  /** `0x0044EE29`: point at the route, arm the delay, raise the shot bit. */
  Begin = 0,
  /** `0x0044EE52`: count the delay down. */
  Delay = 1,
  /** `0x0044EE70`: begin the leg to the current waypoint. */
  StartLeg = 2,
  /** `0x0044EEE8`: fly it. */
  Travelling = 3,
}

/**
 * `PlaySoundId(0x2916A9)` at `0x0044EEFB` — `COMMON\ENE_WALK6_22.WAV`, the
 * footfall at the end of every leg. The same id `ThrowerStateLeapToPoint`
 * plays when it lands.
 */
export const SND_PATH_LEG_LANDED = 0x2916a9;

/**
 * `CMP word ptr [EBX + 0x1F4], 0x17` at `0x0044EE70` and again at
 * `0x0044EF25`: `zskamere` leaps on its own script and stands at the end of
 * the route instead of pouncing. No shipped route is walked by one.
 */
export const PATH_OWN_SCRIPT_TYPE = 0x17;

/**
 * `[port-only]` — which of the bundle's scripts a leg installs.
 *
 * The engine spells the choice inline (`0x0044EE70`..`0x0044EEA4`). The type
 * 0x17 arm pushes `0x00565E28`, `g_class31_arc_path_c17`, which is the same
 * twelve dwords `ThrowerStateLeapToPoint` takes for that type -- one address,
 * so one key in the bundle: `drop_zskamere`. The three styles are
 * `g_class31_arc_path_style0` (`0x00565EB8`), `..._style1` (`0x00565E58`)
 * and `..._style2` (`0x00565E88`), tested as `DEC EAX / JZ` twice on the
 * sign-extended style word, so anything but 1 and 2 -- stage 2's first leg
 * carries a 3 -- takes style 0.
 */
export function PathLegScriptName(obj: ThrowerActor, style: number): string {
  if (obj.charType === PATH_OWN_SCRIPT_TYPE) return "drop_zskamere";
  if (style === 1) return "path_style1";
  if (style === 2) return "path_style2";
  return "path_style0";
}

const _dest = vec3();

export function ThrowerStatePathFollow(obj: ThrowerActor, dt: number,
                                       events?: Events,
                                       host?: GameHost): void {
  const path = obj.path;
  // `[port-only]` The engine walks whatever the descriptor holds;
  // `ThrowerEntryState` only sends an actor here when the bundle decoded a
  // route for it, so this is a stale save rather than a shipped case.
  if (!path) {
    obj.state = ThrowerState.StandAndDecide;
    obj.sub = 0;
    return;
  }

  if (obj.sub === PathSub.Begin) {
    obj.thr.pathLeg = 0;
    obj.thr.pathDelay = path.delay;
    obj.flags |= ActorFlag.ShotImmune;
    obj.sub = PathSub.Delay;
  }

  if (obj.sub === PathSub.Delay) {
    // `DEC ECX` / `TEST EAX, EAX` / `JG` — one a frame, and on at zero.
    obj.thr.pathDelay -= SecondsToTicks(dt);
    if (obj.thr.pathDelay > 0) return;
    obj.sub = PathSub.StartLeg;
  }

  if (obj.sub === PathSub.StartLeg) {
    // `[port-only]` The bundle's list stops before the `step == -1`
    // terminator, so running off its end is the terminator; the engine only
    // ever arrives here with a real waypoint under the cursor.
    const wp = path.points[obj.thr.pathLeg];
    if (!wp) { PathFollowEnd(obj, host); return; }
    _dest.x = wp.dest[0];
    _dest.y = wp.dest[1];
    _dest.z = wp.dest[2];
    // A null script here is a bundle exported before the path scripts were;
    // the loader's builder stamp names it stale.
    const script: ArcStage[] | null =
      ThrowerArcScript(PathLegScriptName(obj, wp.motion_set));
    ActorArcBeginToWaypoint(obj, _dest, script, wp.step);
    obj.sub = PathSub.Travelling;
  }

  // A sub-state past 3 is the jump table's `JA 0x0044ef74`: nothing.
  if (obj.sub !== PathSub.Travelling) return;
  const wp = path.points[obj.thr.pathLeg];
  if (!wp) { PathFollowEnd(obj, host); return; }
  if (ActorArcStep(obj, wp.step, dt, host, events)) return;
  events?.emit("sound.play", { id: SND_PATH_LEG_LANDED });
  obj.thr.pathLeg++;
  if (obj.thr.pathLeg >= path.points.length) {
    PathFollowEnd(obj, host);
    return;
  }
  obj.sub = PathSub.StartLeg;
}

/**
 * `[port-only]` as a function: the terminator arm at `0x0044EF1F`, inline in
 * the engine. The shot bit the route raised comes down, then character type
 * 0x17 goes to state 7 and everything else claims an attack permit and goes to
 * state 9, `ThrowerStateLeapDown` (`FUN_0044B670`), which brings it off the
 * roof and into shot. The claim's result is not tested (`CALL 0x0044ca40`,
 * then the state write), so the pounce happens with or without a permit.
 */
function PathFollowEnd(obj: ThrowerActor, host?: GameHost): void {
  obj.flags &= ~ActorFlag.ShotImmune;
  obj.sub = 0;
  if (obj.charType === PATH_OWN_SCRIPT_TYPE) {
    obj.state = ThrowerState.StandAndDecide;
    return;
  }
  ThrowerTryClaimAttackSlot(obj, host);
  obj.state = ThrowerState.Pounce;
}

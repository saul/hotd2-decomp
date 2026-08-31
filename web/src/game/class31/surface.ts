/**
 * Climbing — how a `zstin` gets onto a wall, and what that changes.
 *
 * This is the half of class 0x31 that makes it read as an animal rather than a
 * corpse. At middle range the router offers it states 14, 15 and 16; each one
 * first *looks* for a surface — a horizontal trace 60 units to one side, or a
 * vertical one straight up — and then arcs onto it. On arrival the actor sets
 * one of three bits in `obj+0x136C`, and those bits are the **stance**, which
 * re-points its whole motion set and its whole attack row. So a wall-clinging
 * thrower is not a special case bolted on: it is the same state machine
 * reading a different row.
 *
 * `ThrowerFindWallBeside` failing is not an error. The engine's answer to "no
 * wall there" is to refuse the state, and the actor stands instead — which is
 * exactly what a host with no collision data gets.
 */
import type { Rng } from "../../core/rng";
import { ThrowerFlag, type Actor } from "../actor";
import { QueryGroundHeightAt, type GameHost } from "../host";
import { G } from "../globals";
import { bamsDelta, vec3 } from "../vec";
import {
  ActorArcBeginToAtSpeed, ActorArcStep, ActorLocalPoint, InstallArcMotionScript,
} from "./arc";
import {
  CEILING_PROBE_REACH, ThrowerState, WALL_FACING_TOLERANCE, WALL_PROBE_REACH,
  WALL_PROBE_RISE, WALL_PROBE_SPREAD, WALL_STANDOFF,
} from "./states";
import { ThrowerArcScript } from "./tables";

const _a = vec3();
const _b = vec3();
const _hit = vec3();

/**
 * `ThrowerFindWallBeside` — `FUN_0044BEF0`. Is there something to climb?
 *
 * Traces horizontally from 60 units to the actor's own left (`-1`) or right
 * (`+1`) back to the actor, at the ground height under it plus a random 9 to
 * 29 units, and on a hit records a point 4.5 units short of the wall as the
 * leap's destination. It refuses outright unless the actor is already facing
 * within 0x2000 — 45° — of the camera, which is what stops it climbing away.
 */
export function ThrowerFindWallBeside(obj: Actor, side: -1 | 1, rng: Rng,
                                      host: GameHost): boolean {
  if (Math.abs(bamsDelta(G.g_camera_yaw_bams, obj.yaw)) > WALL_FACING_TOLERANCE) {
    return false;
  }
  if (obj.flags2 & ThrowerFlag.NoWallLeap) return false;
  if (!host.traceSegment) return false;

  const ground = QueryGroundHeightAt(host, obj.pos.x, obj.pos.y + WALL_STANDOFF,
                                     obj.pos.z, _hit);
  if (ground === null) return false;
  const y = ground + rng.int(WALL_PROBE_SPREAD) + WALL_PROBE_RISE;

  ActorLocalPoint(obj.pos, obj.yaw, side * WALL_PROBE_REACH, 0, 0, _a);
  _a.y = y;
  _b.x = obj.pos.x; _b.y = y; _b.z = obj.pos.z;
  if (!host.traceSegment(_a, _b, _hit)) return false;

  // ...and stand off the face of it, in the actor's own frame.
  ActorLocalPoint(_hit, obj.yaw, -side * WALL_STANDOFF, 0, 0, obj.strikeStart);
  return true;
}

/**
 * `ThrowerFindCeilingAbove` — `FUN_0044C0B0`. The same question, upward: a
 * trace from 1000 units above the actor **in its own frame** back down to it.
 */
export function ThrowerFindCeilingAbove(obj: Actor, host: GameHost): boolean {
  if (!host.traceSegment) return false;
  ActorLocalPoint(obj.pos, obj.yaw, 0, CEILING_PROBE_REACH, 0, _a);
  if (!host.traceSegment(_a, obj.pos, _hit)) return false;
  obj.strikeStart.x = _hit.x;
  obj.strikeStart.y = _hit.y;
  obj.strikeStart.z = _hit.z;
  return true;
}

/** Which flag each of the three leaps sets on arrival, and which script it plays. */
const SURFACES: Record<number, { flag: ThrowerFlag; script: string }> = {
  [ThrowerState.LeapToWallB]:   { flag: ThrowerFlag.WallB, script: "wall_left" },
  [ThrowerState.LeapToWallA]:   { flag: ThrowerFlag.WallA, script: "wall_right" },
  [ThrowerState.LeapToCeiling]: { flag: ThrowerFlag.Ceiling, script: "ceiling" },
};

/**
 * `ThrowerStateLeapToSurface` — `FUN_0044C170`, class 0x31 states 14, 15
 * and 16.
 *
 * One handler for three states, branching on **its own state id** to choose
 * both the arc script and the bit it sets — which is why the three are
 * separate ids at all. The bit is set at the *end*, two frames before the clip
 * runs out, together with `OffGround`; from that frame on the actor is a
 * different creature as far as every table is concerned.
 */
export function ThrowerStateLeapToSurface(obj: Actor, dt: number): void {
  const s = SURFACES[obj.state];
  if (!s) { obj.state = ThrowerState.StandAndDecide; obj.sub = 0; return; }

  if (obj.sub === 0) {
    // Clear whatever surface it was on: an actor may only be on one.
    obj.flags2 &= ~(ThrowerFlag.Surface | ThrowerFlag.OffGround);
    ActorArcBeginToAtSpeed(obj, obj.strikeStart);
    InstallArcMotionScript(obj, ThrowerArcScript(s.script));
    obj.arcPhase = 0;
    obj.sub = 1;
  }

  if (ActorArcStep(obj, 1, dt)) return;

  obj.flags2 |= s.flag | ThrowerFlag.OffGround;
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
}

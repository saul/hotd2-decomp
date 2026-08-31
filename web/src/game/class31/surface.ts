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
import {
  ColiLoaded, ColiTraceSegmentAllSets, QueryGroundHeightAt,
} from "../coli";
import { G } from "../globals";
import { bamsDelta, bamsWrap, vec3, type Vec3 } from "../vec";
import {
  ActorArcBeginToAtSpeed, ActorArcStep, ActorLocalPoint,
  ActorLocalPointPitched, InstallArcMotionScript,
} from "./arc";
import {
  CEILING_PROBE_REACH, ThrowerState, WALL_FACING_TOLERANCE, WALL_PROBE_REACH,
  WALL_PROBE_RISE, WALL_PROBE_SPREAD, WALL_STANDOFF,
} from "./states";
import { ThrowerArcScript } from "./tables";

const _a = vec3();
const _b = vec3();
const _hit = vec3();
const _c = vec3();

/**
 * `ThrowerFindWallBeside` — `FUN_0044BEF0`. Is there something to climb?
 *
 * Traces horizontally from 60 units to the actor's own left (`-1`) or right
 * (`+1`) back to the actor, at the ground height under it plus a random 9 to
 * 29 units, and on a hit records a point 4.5 units short of the wall as the
 * leap's destination. It refuses outright unless the actor is already facing
 * within 0x2000 — 45° — of the camera, which is what stops it climbing away.
 */
export function ThrowerFindWallBeside(obj: Actor, side: -1 | 1,
                                      rng: Rng): boolean {
  if (Math.abs(bamsDelta(G.g_camera_yaw_bams, obj.yaw)) > WALL_FACING_TOLERANCE) {
    return false;
  }
  if (obj.flags2 & ThrowerFlag.NoWallLeap) return false;

  const ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y + WALL_STANDOFF,
                                     obj.pos.z);
  const y = ground + rng.int(WALL_PROBE_SPREAD) + WALL_PROBE_RISE;

  ActorLocalPoint(obj.pos, obj.yaw, side * WALL_PROBE_REACH, 0, 0, _a);
  _a.y = y;
  if (!ColiTraceSegmentAllSets(_a.x, y, _a.z, obj.pos.x, y, obj.pos.z)) {
    return false;
  }
  _hit.x = G.g_coli_hit_x; _hit.y = G.g_coli_hit_y; _hit.z = G.g_coli_hit_z;
  // ...and stand off the face of it, in the actor's own frame.
  ActorLocalPoint(_hit, obj.yaw, -side * WALL_STANDOFF, 0, 0, obj.strikeStart);
  return true;
}

/**
 * `ThrowerFindCeilingAbove` — `FUN_0044C0B0`. The same question, upward: a
 * trace from 1000 units above the actor **in its own frame** back down to it.
 */
export function ThrowerFindCeilingAbove(obj: Actor): boolean {
  ActorLocalPoint(obj.pos, obj.yaw, 0, CEILING_PROBE_REACH, 0, _a);
  if (!ColiTraceSegmentAllSets(_a.x, _a.y, _a.z,
                               obj.pos.x, obj.pos.y, obj.pos.z)) return false;
  obj.strikeStart.x = G.g_coli_hit_x;
  obj.strikeStart.y = G.g_coli_hit_y;
  obj.strikeStart.z = G.g_coli_hit_z;
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

/**
 * The cardinal the actor's yaw snaps to, and the two perpendiculars.
 *
 * `TraceActorSurfaceContactPoint` and `SelectActorGravityAxis` both begin by
 * quantising the yaw with four `FUN_0040A040(yaw, C, 0x2000)` tests against
 * `0x8000`, `0`, `0x4000` and `0xC000` — 45° either side of each cardinal, so
 * one always matches.
 */
function CardinalYaw(yaw: number): number {
  return (Math.round(bamsWrap(yaw) / 0x4000) & 3) * 0x4000;
}

/** How far the surface probe reaches, and how far past the actor it ends. */
const SURFACE_PROBE_REACH = 1000;
const SURFACE_PROBE_REACH_CEILING = 1500;
const SURFACE_PROBE_OVERSHOOT = 20;
/** Within this of the actor, the contact counts; 15 on the ceiling. */
const SURFACE_CONTACT_RANGE = 10;
const SURFACE_CONTACT_RANGE_CEILING = 15;

/**
 * `TraceActorSurfaceContactPoint` — `FUN_0044C370`.
 *
 * Where the surface an actor is stuck to actually *is*. The probe is built in
 * the actor's own frame with a pitch as well as a yaw, so the same routine
 * answers for the floor, either wall and the ceiling: it traces a thousand
 * units in along the attach axis (fifteen hundred for the ceiling) to a point
 * twenty units past the actor on the other side.
 *
 * Its miss behaviour is not uniform, and the asymmetry is the engine's:
 * clinging to a wall and missing returns **false with the output untouched**,
 * where standing on the ground and missing still answers — with the actor's
 * own x and z at `g_camera_fixed_eye_y`, the script's ground plane.
 */
export function TraceActorSurfaceContactPoint(obj: Actor,
                                              out: Vec3): boolean {
  const onCeiling = (obj.flags2 & ThrowerFlag.Ceiling) !== 0;
  const offGround = (obj.flags2 & ThrowerFlag.OffGround) !== 0;
  const cardinal = CardinalYaw(obj.yaw);

  let rx = 0x4000;                       // the floor: probe straight down
  let ry = 0;
  if (obj.flags2 & ThrowerFlag.WallB) { rx = 0; ry = cardinal - 0x4000; }
  else if (obj.flags2 & ThrowerFlag.WallA) { rx = 0; ry = cardinal + 0x4000; }
  if (onCeiling) { rx = 0xc000; ry = 0; }

  const reach = onCeiling ? SURFACE_PROBE_REACH_CEILING : SURFACE_PROBE_REACH;
  ActorLocalPointPitched(obj.pos, rx, ry, 0, 0, reach, _a);
  ActorLocalPointPitched(obj.pos, rx, ry + 0x8000, 0, 0,
                         SURFACE_PROBE_OVERSHOOT, _b);

  const hit = ColiTraceSegmentAllSets(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z);
  _hit.x = G.g_coli_hit_x; _hit.y = G.g_coli_hit_y; _hit.z = G.g_coli_hit_z;
  if (!onCeiling && offGround) {
    if (!hit) return false;
    out.x = _hit.x; out.y = obj.pos.y; out.z = _hit.z;
    return true;
  }
  if (hit) {
    out.x = _hit.x; out.y = _hit.y; out.z = _hit.z;
    return true;
  }
  if (onCeiling) return false;
  out.x = obj.pos.x;
  out.y = G.g_camera_fixed_eye_y;
  out.z = obj.pos.z;
  return true;
}

/**
 * `ThrowerSnapToSurface` — `FUN_0044C600`, and the routine it wraps,
 * `ThrowerFindSurfaceUnderfoot` (`FUN_0044C640`), which decides where the
 * surface is and what to do when there is not one.
 *
 * **This is what holds a wall-crawler on its wall.** `ThrowerPushOutOfWorld`
 * runs it every frame, but only in states 7 and 8 — so an actor that has
 * arrived somewhere is kept there while it stands and waits, and the moment
 * the surface goes out from under it the same call is what sends it falling.
 *
 * [diverges] One function here for the engine's two, because the caller is
 * three lines and adds nothing; and the engine's own contact test measures
 * against a point it builds from the same probe, where this measures against
 * the actor. The threshold and both exits are the engine's.
 */
export function ThrowerSnapToSurface(obj: Actor): void {
  // A bundle with no collision at all is a headless fixture, not a level with
  // no floor: answering "you have fallen off the world" to every actor is not
  // the engine's behaviour, it is the absence of the data the engine has.
  if (!ColiLoaded()) return;
  if (!TraceActorSurfaceContactPoint(obj, _c)) {
    ThrowerLoseSurface(obj);
    return;
  }
  const range = (obj.flags2 & ThrowerFlag.Ceiling)
    ? SURFACE_CONTACT_RANGE_CEILING : SURFACE_CONTACT_RANGE;
  if (Math.hypot(_c.x - obj.pos.x, _c.y - obj.pos.y, _c.z - obj.pos.z) > range) {
    ThrowerLoseSurface(obj);
    return;
  }
  obj.pos.x = _c.x;
  obj.pos.y = _c.y;
  obj.pos.z = _c.z;
}

/**
 * Nothing under it any more: an actor on the ground goes to state 11 and falls,
 * and one still attached re-perches through state 8.
 */
function ThrowerLoseSurface(obj: Actor): void {
  if (!(obj.flags2 & ThrowerFlag.OffGround)) {
    // The engine exempts states 0x13..0x16 and 0x1A, which ride free of the
    // ground; none of them can be current here, because the snap runs only in
    // states 7 and 8.
    if (obj.state !== ThrowerState.FallToSurface) {
      obj.sub = 0;
      obj.state = ThrowerState.FallToSurface;
    }
    return;
  }
  if (obj.state !== ThrowerState.WaitForPermit) {
    obj.state = ThrowerState.WaitForPermit;
    obj.sub = 0;
  }
}

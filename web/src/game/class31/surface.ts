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
const _s = vec3();

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

/**
 * How far `TraceActorSurfaceContactPoint`'s probe reaches, and how far past
 * the actor it ends — `0x447A0000` and `0x40900000`, so **4.5**, not the 20 an
 * earlier pass wrote.
 */
const SURFACE_PROBE_REACH = 1000;
const SURFACE_PROBE_REACH_CEILING = 1500;
const SURFACE_PROBE_OVERSHOOT = 4.5;

/**
 * `ThrowerFindSurfaceUnderfoot`'s own probe, which is a different one: ten
 * units each side of the actor, fifteen on the ceiling. The near distance and
 * the contact range are the same local in the exe (`fStack_28`), so they are
 * the same constant here.
 */
const UNDERFOOT_REACH = 10;
const UNDERFOOT_REACH_CEILING = 15;
/** ...and the far end is always ten. */
const UNDERFOOT_BACK = 10;
/**
 * **How far off the wall a clinging thrower actually stands.**
 *
 * The engine does not put the actor's origin on the surface it found: for a
 * wall it re-places it 6.5 units back along the probe's own return direction,
 * and only then tests the range. Without it the origin sits *in* the wall
 * plane, the body sphere is centred there — `ThrowerPlaceCollisionSphere`
 * leaves y alone for a wall stance — and half the actor is inside the
 * geometry. That is what "the bbox is still intersecting the wall massively"
 * looks like, and no amount of pushing the sphere out fixes it, because this
 * runs *after* the push and puts it back.
 */
const PERCH_STANDOFF = 6.5;
/** The miss answers: a wall that is not there, and a ceiling that is not. */
const NO_WALL = 1000;
const NO_CEILING_Y = -1000;

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
 * `ThrowerFindSurfaceUnderfoot` — `FUN_0044C640`.
 *
 * Where the surface a thrower is attached to is, and **where the actor should
 * stand relative to it** — which is the part that is not the same question.
 *
 * It is not `TraceActorSurfaceContactPoint` above, and conflating the two is
 * what left wall-crawlers standing inside walls. Three things differ:
 *
 * * the probe is **ten units each side of the actor** (fifteen on the
 *   ceiling), not a thousand;
 * * on a **wall** the point it returns is the hit re-placed
 *   {@link PERCH_STANDOFF} units back along the probe's return direction, so
 *   the actor stands *off* the surface rather than in its plane;
 * * missing has answers rather than a bare `false`: a wall that is not there
 *   returns `(1000, y, 1000)`, which fails the range test below and sends the
 *   actor to state 8; a floor that is not there returns the script's ground
 *   plane and a ceiling `-1000`, both of which fail it and send the actor to
 *   state 11.
 *
 * The near probe distance and the range the contact has to be within are the
 * same local in the exe, `fStack_28`, which is why one constant serves both.
 */
export function ThrowerFindSurfaceUnderfoot(obj: Actor, out: Vec3): boolean {
  const onCeiling = (obj.flags2 & ThrowerFlag.Ceiling) !== 0;
  const offGround = (obj.flags2 & ThrowerFlag.OffGround) !== 0;
  const onWall = offGround && !onCeiling;
  const cardinal = CardinalYaw(obj.yaw);

  let rx = 0x4000;                       // the floor: probe straight down
  let ry = 0;
  if (obj.flags2 & ThrowerFlag.WallB) { rx = 0; ry = cardinal - 0x4000; }
  else if (obj.flags2 & ThrowerFlag.WallA) { rx = 0; ry = cardinal + 0x4000; }
  if (onCeiling) { rx = 0xc000; ry = 0; }

  const reach = onCeiling ? UNDERFOOT_REACH_CEILING : UNDERFOOT_REACH;
  ActorLocalPointPitched(obj.pos, rx, ry, 0, 0, reach, _a);
  ActorLocalPointPitched(obj.pos, rx, ry + 0x8000, 0, 0, UNDERFOOT_BACK, _b);
  const hit = ColiTraceSegmentAllSets(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z);

  let px: number, py: number, pz: number;
  if (onWall) {
    py = obj.pos.y;                      // a wall never moves the actor's y
    px = hit ? G.g_coli_hit_x : NO_WALL;
    pz = hit ? G.g_coli_hit_z : NO_WALL;
  } else if (hit) {
    px = G.g_coli_hit_x; py = G.g_coli_hit_y; pz = G.g_coli_hit_z;
  } else {
    px = obj.pos.x;
    pz = obj.pos.z;
    py = onCeiling ? NO_CEILING_Y : G.g_camera_fixed_eye_y;
  }

  if (onWall) {
    // The standoff, built from the hit rather than from the actor.
    _hit.x = px; _hit.y = py; _hit.z = pz;
    ActorLocalPointPitched(_hit, rx, ry + 0x8000, 0, 0, PERCH_STANDOFF, _c);
    px = _c.x;
    pz = _c.z;
    py = obj.pos.y;
  } else {
    // The floor and the ceiling move the actor's y and nothing else.
    px = obj.pos.x;
    pz = obj.pos.z;
  }

  if (Math.hypot(px - obj.pos.x, py - obj.pos.y, pz - obj.pos.z) <= reach) {
    out.x = px; out.y = py; out.z = pz;
    return true;
  }

  // Nothing there any more. An actor still attached re-perches through state
  // 8; one on the ground falls, unless it is in a state that rides free of it
  // — 0x13..0x16 and 0x1A — or is already falling.
  if (!offGround) {
    const st = obj.state;
    if ((st < 0x13 || (st > 0x16 && st !== 0x1a))
        && st !== ThrowerState.FallToSurface) {
      obj.sub = 0;
      obj.state = ThrowerState.FallToSurface;
    }
  } else if (obj.state !== ThrowerState.WaitForPermit) {
    obj.state = ThrowerState.WaitForPermit;
    obj.sub = 0;
  }
  return false;
}

/**
 * `ThrowerSnapToSurface` — `FUN_0044C600`. Three lines in the exe and three
 * here: ask, and move only on a yes.
 *
 * **This is what holds a wall-crawler on its wall.** `ThrowerPushOutOfWorld`
 * runs it every frame, but only in states 7 and 8 — so an actor that has
 * arrived somewhere is kept there while it stands and waits, and the moment
 * the surface goes out from under it the same call is what sends it falling.
 */
export function ThrowerSnapToSurface(obj: Actor): void {
  // A bundle with no collision at all is a headless fixture, not a level with
  // no floor: answering "you have fallen off the world" to every actor is not
  // the engine's behaviour, it is the absence of the data the engine has.
  // [diverges]
  if (!ColiLoaded()) return;
  if (!ThrowerFindSurfaceUnderfoot(obj, _s)) return;
  obj.pos.x = _s.x;
  obj.pos.y = _s.y;
  obj.pos.z = _s.z;
}

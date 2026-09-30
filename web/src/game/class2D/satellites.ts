/**
 * Class 0x2D's eight satellites: `Class2DSatelliteInit` and the nine states
 * of `g_class2d_satellite_states` (`0x00589908`), with their orbit, draw and
 * shot registration. `Class2DClassHandler` allocates all eight
 * (`ActorAlloc(Class2DSatelliteInit, 0x13F4)`, `+0x131B` the index,
 * `+0x1394` the boss) and nothing else makes them.
 *
 * Every state reads the boss's cue word, `parent+0x136C`, and its sub,
 * `parent+0x1312`, to know which of the boss's moves it is part of; what a
 * satellite tells the boss back goes through its record in
 * `g_class2d_satellite_records` -- `+1` "out on a move", which the boss's
 * `Class2DSatellitesAllIdle` waits on. See `docs/re/boss-emperor.md`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { type EmperorActor } from "../actor";
import { CameraBlockViewToWorld, CameraBlockWorldToView } from "../camera/view";
import { PlaySoundId } from "../class45/rand";
import { PlayerTakeDamageIfOnScreen } from "../combat/player";
import { RegisterForShotTest } from "../combat/shot_test";
import { ActorDespawn } from "../despawn";
import { ActorByAt, G } from "../globals";
import type { GameHost } from "../host";
import {
  MatCopy, MatIdentity, MatrixGetTranslation, MatrixLoadIdentity,
  MatrixMultiply, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
  MatrixTransformPoint, MatrixTranslate, Vec3Normalize,
} from "../matrix";
import type { ClassFrame } from "../registry";
import { ActorSpawn } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { LerpWeighted, VecToAngles, vec3, type Vec3 } from "../vec";
import { Class2DAdjustRank } from "./boss";
import {
  CLASS2D_FLARE_CELS, CLASS2D_WEAK_POINT_X, CLASS2D_WEAK_POINT_Y,
  Class2DCameraLight, Class2DPushDraw,
} from "./draw";
import {
  Class2DFlightFrames, Class2DLaunchGap, Class2DPairFlightFrames,
} from "./tables";
import {
  Class2DSatelliteSpawnHitSpark, Class2DSatelliteSpawnTrail,
} from "./tasks";
import {
  Class2DChildAt, Class2DCue, Class2DRoutine, Class2DSatelliteState,
  CLASS2D_AT_SATELLITE0, makeClass2DSatelliteWords,
  type Class2DSatelliteWords, type Class2DTail,
} from "./state";

/** `obj+0x70..+0x78` -- the view-space point the satellite last wrote. */
function View(obj: EmperorActor): Vec3 {
  return obj.class2d.sat!.view;
}

/**
 * `[port-only]` -- `ActorAlloc(Class2DSatelliteInit, 0x13F4)`,
 * `ActorClearGameFields`, `+0x131B = i` and `+0x1394 = boss`, the handler's
 * loop at `0x00426B57`, as the port's pool makes an object.
 */
export function Class2DSpawnSatellite(boss: EmperorActor, index: number,
                                      rng?: Rng, events?: Events): void {
  const tail: Class2DTail = {
    routine: Class2DRoutine.SatelliteInit, boss: null,
    sat: makeClass2DSatelliteWords(index), child: null, drawLight: null,
  };
  ActorSpawn(Class2DChildAt(boss.at, CLASS2D_AT_SATELLITE0 + index),
             SpawnClass.Emperor, -1, `satellite ${index}`,
             { class2d: tail, targetAt: boss.at, visible: true, flags: 0 },
             rng, events);
}

/** `[port-only]` -- the satellite's words and its boss. */
function Parts(obj: EmperorActor):
    { s: Class2DSatelliteWords; parent: EmperorActor | null } {
  const s = obj.class2d.sat!;
  const p = ActorByAt(obj.targetAt);
  const parent = p && p.cls === SpawnClass.Emperor ? p as EmperorActor : null;
  return { s, parent };
}

/** `[port-only]` -- `parent+0x136C`, 0 with no parent (the engine always has one). */
function ParentCue(parent: EmperorActor | null): number {
  return parent?.class2d.boss?.cue ?? 0;
}

/** `[port-only]` -- `parent+0x1324`, the rank. */
function ParentRank(parent: EmperorActor | null): number {
  return parent?.class2d.boss?.rank ?? 0;
}

/** `[port-only]` -- the satellite's record, `&g_class2d_satellite_records[index]`. */
function Record(s: Class2DSatelliteWords) {
  return G.g_class2d_satellite_records[(s.index << 24) >> 24];
}

/** `MOV [ESI+0x124], 0x3FE66666` -- 1.8, the satellite's shot sphere. */
const SAT_RADIUS = Math.fround(1.8);
/** `MOV [ESI+0x124], 0x402CCCCD` -- 2.7, the pair's while it flies. */
const PAIR_RADIUS = Math.fround(2.7);

/**
 * `Class2DSatelliteInit` — `FUN_00429D00`. `obj+0x34 = 1; obj+0x124 = 1.8;
 * state = 0; Class2DSatelliteUpdate(obj)`, and it installs the update.
 * `[proved]`
 */
export function Class2DSatelliteInit(obj: EmperorActor, f: ClassFrame): void {
  obj.flags = 1;
  obj.hitRadius = SAT_RADIUS;
  obj.radius = SAT_RADIUS;
  obj.state = 0;
  Class2DSatelliteUpdate(obj, f);
  obj.class2d.routine = Class2DRoutine.SatelliteUpdate;
}

/**
 * `Class2DSatelliteUpdate` — `FUN_00429D30`.
 * `g_class2d_satellite_states[(s16)obj+0x1310](obj)`, nine entries read out
 * of `0x00589908` (`g_bat_body_motions` follows the ninth). `[proved]`
 */
export function Class2DSatelliteUpdate(obj: EmperorActor, f: ClassFrame): void {
  switch (((obj.state << 16) >> 16) as Class2DSatelliteState) {
    case Class2DSatelliteState.WaitForParent:
      Class2DSatelliteWaitForParent(obj, f); break;
    case Class2DSatelliteState.Appear: Class2DSatelliteAppear(obj, f); break;
    case Class2DSatelliteState.OrbitAndPick:
      Class2DSatelliteOrbitAndPick(obj, f); break;
    case Class2DSatelliteState.FlyAtCamera:
      Class2DSatelliteFlyAtCamera(obj, f); break;
    case Class2DSatelliteState.PairBeam: Class2DSatellitePairBeam(obj, f); break;
    case Class2DSatelliteState.AbsorbAtBone5:
      Class2DSatelliteAbsorbAtBone5(obj, f); break;
    case Class2DSatelliteState.RideChild: Class2DSatelliteRideChild(obj, f); break;
    case Class2DSatelliteState.OrbitWithTrail:
      Class2DSatelliteOrbitWithTrail(obj, f); break;
    case Class2DSatelliteState.Despawn: Class2DSatelliteDespawn(obj); break;
  }
}

/** `PUSH 0xC1700000` -- every orbit is 15 units out, along -z of the ring's frame. */
const ORBIT_DISTANCE = -15.0;
/** `FMUL [0x004C4C58]` 0.25, `FMUL [0x0055D228]` 1.75, `[0x0055D22C]` 4096.0. */
const ORBIT_TILT_A = 0.25;
const ORBIT_TILT_B = 1.75;
const ORBIT_TILT_BASE = 4096.0;

/**
 * `Class2DSatelliteOrbitPoint` — `FUN_0042BCD0`. `(obj, d)`, returns `y2`:
 *
 * ```
 * P = translation of view_to_world * parent+0x2C4 * Translate(2.3121, 0.1097, 0)
 * Push; Identity; Translate(P); RotY(parent yaw); RotX(parent pitch)
 * a = ((index << 4) + +0x1350) << 9; RotZ(a)
 * y2 = (a < 0x4000 && a >= 0xC000) ? ftol((a + 0x4000) * 0.25 - 4096.0)
 *                                   : ftol((a - 0x4000) * 1.75 + 4096.0)
 * RotY(y2); +0x13C0 = top * (0, 0, d); Pop; return y2
 * ```
 *
 * `[proved]`. The first arm's test is the two compares as they stand
 * (`JGE` past 0x4000, `JL` below 0xC000 to the second arm), which no `a`
 * passes; it is transcribed as the test it is. `parent+0x2C4` is bone 1's
 * record, which the port holds in the world already: the camera block's
 * matrix, which the engine multiplies in to get there, is not applied twice.
 */
export function Class2DSatelliteOrbitPoint(obj: EmperorActor,
                                           d: number): number {
  const { s, parent } = Parts(obj);
  const W1 = parent?.skel?.bones[1]?.mat;
  const P = vec3();
  if (W1) {
    const m = MatCopy(MatIdentity(), W1);
    MatrixTranslate(m, CLASS2D_WEAK_POINT_X, CLASS2D_WEAK_POINT_Y, 0);
    MatrixGetTranslation(m, P);
  }
  const m = MatIdentity();
  MatrixLoadIdentity(m);
  MatrixTranslate(m, P.x, P.y, P.z);
  MatrixRotateY(m, parent?.yaw ?? 0);
  MatrixRotateX(m, parent?.pitch ?? 0);
  const a = ((((s.index << 24) >> 24) << 4) + s.orbit) << 9;
  MatrixRotateZ(m, a);
  const y2 = (a < 0x4000 && a >= 0xc000)
    ? Math.trunc(((a + 0x4000) | 0) * ORBIT_TILT_A - ORBIT_TILT_BASE)
    : Math.trunc(((a - 0x4000) | 0) * ORBIT_TILT_B + ORBIT_TILT_BASE);
  MatrixRotateY(m, y2);
  const out = vec3();
  MatrixTransformPoint(m, { x: 0, y: 0, z: d }, out);
  s.target.x = Math.fround(out.x);
  s.target.y = Math.fround(out.y);
  s.target.z = Math.fround(out.z);
  return y2;
}

/** `[port-only]` -- `pos = +0x13C0`. */
function SeatOnTarget(obj: EmperorActor, s: Class2DSatelliteWords): void {
  obj.pos.x = s.target.x;
  obj.pos.y = s.target.y;
  obj.pos.z = s.target.z;
}

/**
 * `Class2DSatelliteRegisterShot` — `FUN_0042BB80`.
 * `obj+0x34 &= ~0xE; +0x70 = g_camera_world_to_view[g_camera_index] * pos;
 * RegisterForShotTest(obj)`. `[proved]`. The port files the point in the
 * world (`Actor.shotCentre`), as every class's is, and keeps the view-space
 * one the class's own routines read.
 */
export function Class2DSatelliteRegisterShot(obj: EmperorActor,
                                             host: GameHost): void {
  obj.flags &= ~0xe;
  MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index), obj.pos,
                       View(obj));
  obj.shotCentre.x = obj.pos.x;
  obj.shotCentre.y = obj.pos.y;
  obj.shotCentre.z = obj.pos.z;
  RegisterForShotTest(obj, host);
}

/** `PUSH 0x72C` -- the satellite; `SHL EAX, 8` -- its spin. */
const SAT_SLOT = 0x72c;
const SPIN_SHIFT = 8;

/**
 * `Class2DSatelliteDraw` — `FUN_0042BC10`. `LightsUseCustomSet(1.0, camera
 * block pitch/yaw, 1, 1, 1); Push; Translate(pos); RotY(g_frame_counter <<
 * 8); Scale(+0x1340); NoOpStub; UVs(0x72C); AssetDrawSlot(0x72C); Pop;
 * LightsRestoreScene`. `[proved]`
 */
export function Class2DSatelliteDraw(obj: EmperorActor): void {
  const { s } = Parts(obj);
  const m = MatIdentity();
  MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
  MatrixRotateY(m, (G.g_frame_counter << SPIN_SHIFT) | 0);
  MatrixScale(m, s.scale, s.scale, s.scale);
  Class2DPushDraw(SAT_SLOT, m, false, null, true, Class2DCameraLight());
}

/**
 * `Class2DSatelliteWaitForParent` — `FUN_00429D50`. Once `parent+0x136C` is
 * not 0: `+0x1350 = +0x1330 = +0x1340 = 0`, the orbit point at -15 and
 * `pos` on it, state 1. `[proved]`
 */
export function Class2DSatelliteWaitForParent(obj: EmperorActor,
                                              _f: ClassFrame): void {
  const { s, parent } = Parts(obj);
  if (ParentCue(parent) === 0) return;
  s.orbit = 0;
  s.count = 0;
  s.scale = 0;
  Class2DSatelliteOrbitPoint(obj, ORBIT_DISTANCE);
  SeatOnTarget(obj, s);
  obj.state += 1;
}

/** `Class2DSatelliteAppear`'s windows and cels. */
const APPEAR_FLASH_FROM = 0xa;
const APPEAR_END = 0xf0;
const APPEAR_FLASH_LAST = 0x19bc;
const APPEAR_FLASH_CELS = 0x21;
const APPEAR_FLASH_SCALE = 0.5;
const APPEAR_BEAM_FROM = 0xc8;
const APPEAR_BEAM_UNTIL = 0xe6;
export const CLASS2D_BEAM_FIRST = 0x1633;
const BEAM_CELS = 0x18;
const BEAM_W = Math.fround(0.4);
const BEAM_H = 4.0;
/** `FADD [0x004C4C88]` -- 0.05, the grow a frame, to `[0x004C4380]` 1.0. */
const APPEAR_GROW = Math.fround(0.05000000074505806);

/**
 * `Class2DSatelliteAppear` — `FUN_00429DB0`.
 *
 * ```
 * n = ++obj+0x1330; +0x70 = view point
 * if (10 <= n < 240) { Push; Identity; Translate(+0x70); Scale(0.5)
 *                      AssetDrawSlot(0x19BC - n % 33); Pop }
 * if (200 <= n < 230) { Push; Identity; Translate(+0x70); Scale(0.4, 4, 0.4)
 *                       AssetDrawSlot(0x1633 + n % 24); Pop }
 * if (n >= 200) { if (+0x1340 < 1.0) +0x1340 += 0.05; Class2DSatelliteDraw }
 * if (n >= 240) { state++; sub = 0 }
 * ```
 *
 * `[proved]`. Not in the shot test.
 */
export function Class2DSatelliteAppear(obj: EmperorActor, _f: ClassFrame): void {
  const { s } = Parts(obj);
  s.count += 1;
  const n = s.count;
  const v = View(obj);
  MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index), obj.pos, v);
  if (n >= APPEAR_FLASH_FROM && n < APPEAR_END) {
    const m = MatIdentity();
    MatrixTranslate(m, v.x, v.y, v.z);
    MatrixScale(m, APPEAR_FLASH_SCALE, APPEAR_FLASH_SCALE, APPEAR_FLASH_SCALE);
    Class2DPushDraw(APPEAR_FLASH_LAST - (n % APPEAR_FLASH_CELS), m, true, null,
                    false, null);
  }
  if (n >= APPEAR_BEAM_FROM && n < APPEAR_BEAM_UNTIL) {
    const m = MatIdentity();
    MatrixTranslate(m, v.x, v.y, v.z);
    MatrixScale(m, BEAM_W, BEAM_H, BEAM_W);
    Class2DPushDraw(CLASS2D_BEAM_FIRST + (n % BEAM_CELS), m, true, null, false,
                    null);
  }
  if (s.count >= APPEAR_BEAM_FROM) {
    if (s.scale < 1.0) s.scale = Math.fround(s.scale + APPEAR_GROW);
    Class2DSatelliteDraw(obj);
  }
  if (s.count >= APPEAR_END) {
    obj.state += 1;
    obj.sub = 0;
  }
}

/** `PUSH 0x1116A9` -- a satellite's ricochet. */
const SND_SAT_HIT = 0x1116a9;

/** `[port-only]` -- the head of five states: a hit (`obj+0x34 & 8`) sparks and sounds. */
function SparkIfShot(obj: EmperorActor, events?: Events): boolean {
  if (!(obj.flags & 8)) return false;
  Class2DSatelliteSpawnHitSpark(View(obj));
  PlaySoundId(SND_SAT_HIT, events);
  return true;
}

/**
 * `Class2DSatelliteOrbitAndPick` — `FUN_00429F70`.
 *
 * ```
 * if (obj+0x34 & 8) { Class2DSatelliteSpawnHitSpark(obj); PlaySoundId(0x1116A9) }
 * +0x1350++; Class2DSatelliteOrbitPoint(-15); pos = +0x13C0
 * Class2DSatelliteDraw; Class2DSatelliteRegisterShot
 * if (parent+0x136C == 2) switch (parent sub) {   // five entries, sub 1..5
 *   1: rec = {index, 0, 0, +0x78}; +0x1330 = 0; state 3; sub 0
 *   2: rec = {index, 0, 0, +0x78}; state 4; sub 0
 *   3: rec = {index, 0, 0, +0x78}; state 5; sub 0
 *   4: state 6; sub 0
 *   5: +0x1330 = 0; state 7; sub 0 }
 * else if (parent+0x136C == 4) { state 8; sub 0 }
 * ```
 *
 * `[proved]`.
 */
export function Class2DSatelliteOrbitAndPick(obj: EmperorActor,
                                             f: ClassFrame): void {
  const { s, parent } = Parts(obj);
  SparkIfShot(obj, f.events);
  s.orbit += 1;
  Class2DSatelliteOrbitPoint(obj, ORBIT_DISTANCE);
  SeatOnTarget(obj, s);
  Class2DSatelliteDraw(obj);
  Class2DSatelliteRegisterShot(obj, f.host);
  const cue = ParentCue(parent);
  if (cue === Class2DCue.Attack) {
    const psub = ((parent?.sub ?? 0) << 16) >> 16;
    const rec = Record(s);
    const reset = (): void => {
      rec.index = (s.index << 24) >> 24;
      rec.active = 0;
      rec.order = 0;
      rec.viewZ = View(obj).z;
    };
    switch (psub) {
      case 1: reset(); s.count = 0; obj.state = 3; obj.sub = 0; break;
      case 2: reset(); obj.state = 4; obj.sub = 0; break;
      case 3: reset(); obj.state = 5; obj.sub = 0; break;
      case 4: obj.state = 6; obj.sub = 0; break;
      case 5: s.count = 0; obj.state = 7; obj.sub = 0; break;
    }
  } else if (cue === Class2DCue.Gone) {
    obj.state = 8;
    obj.sub = 0;
  }
}

/** `FMUL qword [0x0055D220]` -2.5 -- the screen plane the flights aim at. */
const AIM_PLANE = -2.5;
/** `MOV [ESI+0x13C8], 0xC0200000` -- the same, as a float. */
const AIM_PLANE_F = Math.fround(-2.5);
/** `FMUL [0x004C43AC]` 0.5 and `FMUL [0x0055D218]` 1/3 -- a flight's spread. */
const SPREAD_HALF = 0.5;
const SPREAD_THIRD = Math.fround(0.3333333432674408);
/** `FMUL [0x004C4C58]` -- 0.25, the pair's vertical spread. */
const SPREAD_QUARTER = 0.25;
/** `PUSH 7`, `PUSH 1` -- `PlayerTakeDamageIfOnScreen(point, 1, 7)`. */
const SAT_STRIKE_LATCH = 1;
const SAT_STRIKE_MOTION = 7;
/** `PUSH -3` -- the rank a satellite's hit costs the boss. */
const STRIKE_RANK = -3;
/** `CMP [+0x1330], 0x1E` -- the flight home's thirty frames. */
const HOME_FRAMES = 0x1e;
/** `PUSH 0x1125A9` -- a launch. */
const SND_LAUNCH = 0x1125a9;

/**
 * `[port-only]` -- the aim a launch takes: the satellite's view point
 * carried along its own ray to the plane `z = -2.5`, `(x * -2.5 / z,
 * y * -2.5 / z, -2.5)` (`FMUL qword [0x0055D220]; FDIV [ESI+0x78]`).
 */
function AimAtScreenPlane(obj: EmperorActor, s: Class2DSatelliteWords): void {
  const v = View(obj);
  s.target.x = Math.fround(v.x * AIM_PLANE / v.z);
  s.target.y = Math.fround(v.y * AIM_PLANE / v.z);
  s.target.z = AIM_PLANE_F;
}

/**
 * `[port-only]` -- the step a flight takes, inline in four arms: `W` the
 * camera-frame point `(n * tx * kx, n * ty * ky, tz)` (or the orbit point's
 * view image scaled by `(n * kx + 1, n * ky + 1, 1)` flying home), `N =
 * Vec3Normalize(W - pos)`, `vel = N * |pos - W| / n`, `pos += vel`.
 */
function FlyStep(obj: EmperorActor, W: Vec3, n: number): void {
  const d = vec3(Math.fround(W.x - obj.pos.x), Math.fround(W.y - obj.pos.y),
                 Math.fround(W.z - obj.pos.z));
  const N = vec3();
  Vec3Normalize(d, N);
  const dx = obj.pos.x - W.x;
  const dy = obj.pos.y - W.y;
  const dz = obj.pos.z - W.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  obj.vel.x = Math.fround(dist / n * N.x);
  obj.vel.y = Math.fround(dist / n * N.y);
  obj.vel.z = Math.fround(dist / n * N.z);
  obj.pos.x = Math.fround(obj.vel.x + obj.pos.x);
  obj.pos.y = Math.fround(obj.vel.y + obj.pos.y);
  obj.pos.z = Math.fround(obj.vel.z + obj.pos.z);
}

/** `[port-only]` -- a flight toward the screen plane, `n` frames left. */
function FlyTowardScreen(obj: EmperorActor, s: Class2DSatelliteWords, n: number,
                         kx: number, ky: number): void {
  const v = vec3(Math.fround(n * s.target.x * kx),
                 Math.fround(n * s.target.y * ky), s.target.z);
  const W = vec3();
  MatrixTransformPoint(CameraBlockViewToWorld(G.g_camera_index), v, W);
  FlyStep(obj, W, n);
}

/** `[port-only]` -- a flight home to the orbit point, `n` frames left. */
function FlyHome(obj: EmperorActor, s: Class2DSatelliteWords, n: number): void {
  Class2DSatelliteOrbitPoint(obj, ORBIT_DISTANCE);
  const V = vec3();
  MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index), s.target, V);
  const v = vec3(Math.fround((n * SPREAD_HALF + 1.0) * V.x),
                 Math.fround((n * SPREAD_THIRD + 1.0) * V.y), V.z);
  const W = vec3();
  MatrixTransformPoint(CameraBlockViewToWorld(G.g_camera_index), v, W);
  FlyStep(obj, W, n);
}

/**
 * `Class2DSatelliteFlyAtCamera` — `FUN_0042A100`. The boss's attack 1.
 * `hit` is `obj+0x34 & 8`, sparked on the way in. `+0x1350++`. By sub (six
 * entries at `0x0042A6D0`):
 *
 * * **0** -- on `parent+0x136C == 3`: an active record (`+1 == 1`) takes
 *   `+0x1330 = 0`, `+0x1338 = g_class2d_launch_gap[rank]`, sub 1; any other,
 *   sub 5;
 * * **1** -- at `+0x1330 / +0x1338 == record +2` it launches: the screen-plane
 *   aim, `+0x1330 = 0`, `+0x1334 = g_class2d_flight_frames[rank]`, the
 *   trail, `PlaySoundId(0x1125A9)`, sub 2;
 * * **2** -- a hit: `+0x1330 = 0`, sub 4. At `+0x1334 - 2`:
 *   `PlayerTakeDamageIfOnScreen(+0x70, 1, 7)`, the boss's rank -3, `+0x1330 =
 *   0`, `+0x1368 = 1` (the trail goes), sub 3. Otherwise a flight step;
 * * **3** -- at `+0x1330 >= +0x1338 / 3`: `+0x1330 = 0`, a trail, sub 4;
 * * **4** -- home over 30 frames, then record `+1 = 0`, `+0x1368 = 1`,
 *   sub 5;
 * * **5** -- the orbit point, and on `parent+0x136C == 1` state 2.
 *
 * Every frame ends `Class2DSatelliteDraw`, `Class2DSatelliteRegisterShot`,
 * `+0x1330++`. `[proved]`
 */
export function Class2DSatelliteFlyAtCamera(obj: EmperorActor,
                                            f: ClassFrame): void {
  const { s, parent } = Parts(obj);
  const hit = SparkIfShot(obj, f.events);
  s.orbit += 1;
  const rec = Record(s);
  switch ((obj.sub << 16) >> 16) {
    case 0:
      if (ParentCue(parent) !== Class2DCue.Go) break;
      if (rec.active === 1) {
        s.count = 0;
        s.gap = Class2DLaunchGap(ParentRank(parent));
        obj.sub += 1;
      } else {
        obj.sub = 5;
      }
      break;
    case 1:
      if (Math.trunc(s.count / s.gap) === ((rec.order << 24) >> 24)) {
        AimAtScreenPlane(obj, s);
        s.count = 0;
        s.flight = Class2DFlightFrames(ParentRank(parent));
        Class2DSatelliteSpawnTrail(obj);
        PlaySoundId(SND_LAUNCH, f.events);
        obj.sub += 1;
      }
      break;
    case 2:
      if (hit) {
        s.count = 0;
        obj.sub = 4;
        break;
      }
      if (s.count >= s.flight - 2) {
        PlayerTakeDamageIfOnScreen(View(obj), SAT_STRIKE_LATCH,
                                   SAT_STRIKE_MOTION, f.events);
        if (parent) Class2DAdjustRank(parent, STRIKE_RANK);
        s.count = 0;
        s.trailOff = 1;
        obj.sub = 3;
        break;
      }
      FlyTowardScreen(obj, s, s.flight - s.count, SPREAD_HALF, SPREAD_THIRD);
      break;
    case 3:
      if (s.count >= Math.trunc(s.gap / 3)) {
        s.count = 0;
        Class2DSatelliteSpawnTrail(obj);
        obj.sub = 4;
      }
      break;
    case 4:
      if (s.count >= HOME_FRAMES) {
        rec.active = 0;
        s.trailOff = 1;
        obj.sub = 5;
        break;
      }
      FlyHome(obj, s, HOME_FRAMES - s.count);
      break;
    case 5:
      Class2DSatelliteOrbitPoint(obj, ORBIT_DISTANCE);
      SeatOnTarget(obj, s);
      if (ParentCue(parent) === Class2DCue.Resume) obj.state = 2;
      break;
  }
  Class2DSatelliteDraw(obj);
  Class2DSatelliteRegisterShot(obj, f.host);
  s.count += 1;
}

/** `ADD EAX, 0x72D` -- the beam's 41 cels; `FMUL [0x0055CBB8]` 0.05 its reach. */
export const CLASS2D_PAIR_BEAM_FIRST = 0x72d;
const PAIR_BEAM_STEP = Math.fround(0.05000000074505806);
const PAIR_BEAM_FRAMES = 0x28;
/** `PUSH 0x4000` -- the beam stands along the aim. */
const PAIR_BEAM_TILT = 0x4000;
/** `CMP EAX, 7` -- the odd satellite's ten-frame join, over eight. */
const PAIR_JOIN_FRAMES = 0xa;
const PAIR_JOIN_LAST = 7;
/** `PUSH 0x754` -- the pair's model. */
const PAIR_SLOT = 0x754;
/** `PUSH 0xE25A9` -- the pair's launch. */
const SND_PAIR_LAUNCH = 0xe25a9;

/**
 * `Class2DSatellitePairBeam` — `FUN_0042A6F0`. The boss's attack 2: the
 * satellites pair off, even with the odd after it (`index % 2`, `AND
 * 0x80000001` with the sign fix). `hit` as before; `+0x1350++`. By sub (eight
 * entries at `0x0042B208`):
 *
 * * **0** -- `+0x133C = 0`; the orbit point, `pos` and the record's point on
 *   it; the odd one targets its partner's (record `index - 1`) point; sub 1,
 *   `+0x1330 = 0`. (A test of the orbit's `y2` against `0x2000`/`0xE000`
 *   stands before the last three and passes every value.)
 * * **1** -- even: once the partner's record `+2` is set, its own, sub 2.
 *   Odd: the partner's point again and a `LerpWeighted` glide over 10 frames;
 *   after 8, record `+2 = 1`, sub 2.
 * * **2** -- odd: once the partner's `+2` is set, sub 3. Even: the beam,
 *   `0x72D + +0x1330`, from its own position aimed at the partner's
 *   (`VecToAngles` of the difference, `RotY(yaw) RotX(pitch) RotX(0x4000)
 *   Translate(0, (40 - n) * 0.05, 0)`, UVs from normals); after 40 frames
 *   `+0x124 = 2.7`, record `+1 = 1`, sub 3; `+0x133C = 1`.
 * * **3** -- odd: on cue 3, sub 4; `+0x133C = 1`. Even: on cue 3, the
 *   screen-plane aim, `+0x1330 = 0`, `+0x1334 =
 *   g_class2d_pair_flight_frames[rank]`, `PlaySoundId(0xE25A9)`, sub 4;
 *   `+0x133C = 2`.
 * * **4** -- odd: once the partner's `+2` is clear, back at the partner's
 *   point with `+0x124 = 1.8`, sub 6. Even: a hit clears the record's `+2`,
 *   `+0x124 = 1.8`, sub 6; at `+0x1334 - 2` `PlayerTakeDamageIfOnScreen(1,
 *   7)`, rank -3, sub 5; otherwise a flight step (spread 1/3, 1/4).
 * * **5** -- after `+0x1338 / 3` frames `+0x124 = 1.8`, record `+2 = 0`,
 *   sub 6.
 * * **6** -- home over 30 frames, then record `+1 = 0`, sub 7.
 * * **7** -- the orbit point; cue 1, state 2.
 *
 * The draw by `+0x133C`: 0 the satellite and `Class2DSatelliteRegisterShot`;
 * 1 nothing and `obj+0x34 &= ~0xE`; 2 the pair (`0x754`, spinning, UVs) and
 * the registration. `[proved]`
 */
export function Class2DSatellitePairBeam(obj: EmperorActor,
                                         f: ClassFrame): void {
  const { s, parent } = Parts(obj);
  const hit = SparkIfShot(obj, f.events);
  s.orbit += 1;
  const rec = Record(s);
  const idx = (s.index << 24) >> 24;
  const odd = (idx % 2) !== 0;
  const prev = G.g_class2d_satellite_records[idx - 1];
  const next = G.g_class2d_satellite_records[idx + 1];
  const sub = (obj.sub << 16) >> 16;
  switch (sub) {
    case 0: {
      s.drawMode = 0;
      const y2 = Class2DSatelliteOrbitPoint(obj, ORBIT_DISTANCE);
      SeatOnTarget(obj, s);
      rec.point.x = s.target.x;
      rec.point.y = s.target.y;
      rec.point.z = s.target.z;
      if (y2 >= 0x2000 || !(y2 >= 0xe000)) {
        if (odd) {
          s.target.x = prev.point.x;
          s.target.y = prev.point.y;
          s.target.z = prev.point.z;
        }
        obj.sub += 1;
        s.count = 0;
      }
      break;
    }
    case 1:
      if (!odd) {
        if (next.order !== 0) {
          rec.order = 1;
          obj.sub += 1;
        }
      } else {
        s.target.x = prev.point.x;
        s.target.y = prev.point.y;
        s.target.z = prev.point.z;
        obj.pos.x = Math.fround(LerpWeighted(obj.pos.x, s.target.x, 1,
                                             PAIR_JOIN_FRAMES - s.count));
        obj.pos.y = Math.fround(LerpWeighted(obj.pos.y, s.target.y, 1,
                                             PAIR_JOIN_FRAMES - s.count));
        obj.pos.z = Math.fround(LerpWeighted(obj.pos.z, s.target.z, 1,
                                             PAIR_JOIN_FRAMES - s.count));
        const n = s.count;
        s.count += 1;
        if (n > PAIR_JOIN_LAST) {
          rec.order = 1;
          obj.sub += 1;
        }
      }
      break;
    case 2:
      if (odd) {
        if (prev.order !== 0) obj.sub += 1;
        s.drawMode = 0;
      } else {
        Class2DPairBeamDraw(obj, s, next.point);
        const n = s.count;
        s.count += 1;
        if (n > PAIR_BEAM_FRAMES) {
          obj.hitRadius = PAIR_RADIUS;
          obj.radius = PAIR_RADIUS;
          rec.active = 1;
          obj.sub += 1;
        }
        s.drawMode = 1;
      }
      break;
    case 3:
      if (odd) {
        if (ParentCue(parent) === Class2DCue.Go) obj.sub += 1;
        s.drawMode = 1;
      } else {
        if (ParentCue(parent) === Class2DCue.Go) {
          MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index),
                               obj.pos, View(obj));
          AimAtScreenPlane(obj, s);
          s.count = 0;
          s.flight = Class2DPairFlightFrames(ParentRank(parent));
          PlaySoundId(SND_PAIR_LAUNCH, f.events);
          obj.sub += 1;
        }
        s.drawMode = 2;
      }
      break;
    case 4:
      if (odd) {
        if (prev.order === 0) {
          obj.pos.x = prev.point.x;
          obj.pos.y = prev.point.y;
          obj.pos.z = prev.point.z;
          obj.hitRadius = SAT_RADIUS;
          obj.radius = SAT_RADIUS;
          s.count = 0;
          obj.sub = 6;
        }
        s.drawMode = 1;
        s.count += 1;
      } else {
        if (hit) {
          obj.hitRadius = SAT_RADIUS;
          obj.radius = SAT_RADIUS;
          rec.order = 0;
          s.count = 0;
          obj.sub = 6;
        } else if (s.count >= s.flight - 2) {
          PlayerTakeDamageIfOnScreen(View(obj), SAT_STRIKE_LATCH,
                                     SAT_STRIKE_MOTION, f.events);
          if (parent) Class2DAdjustRank(parent, STRIKE_RANK);
          s.count = 0;
          obj.sub = 5;
        } else {
          FlyTowardScreen(obj, s, s.flight - s.count, SPREAD_THIRD,
                          SPREAD_QUARTER);
        }
        s.drawMode = 2;
        s.count += 1;
      }
      break;
    case 5:
      if (s.count >= Math.trunc(s.gap / 3)) {
        obj.hitRadius = SAT_RADIUS;
        obj.radius = SAT_RADIUS;
        s.count = 0;
        rec.order = 0;
        obj.sub = 6;
      }
      s.drawMode = 2;
      s.count += 1;
      break;
    case 6:
      if (s.count >= HOME_FRAMES) {
        rec.active = 0;
        obj.sub = 7;
      } else {
        FlyHome(obj, s, HOME_FRAMES - s.count);
      }
      s.drawMode = 0;
      s.count += 1;
      break;
    case 7:
      Class2DSatelliteOrbitPoint(obj, ORBIT_DISTANCE);
      SeatOnTarget(obj, s);
      if (ParentCue(parent) === Class2DCue.Resume) obj.state = 2;
      s.drawMode = 0;
      break;
  }
  switch (s.drawMode) {
    case 0:
      Class2DSatelliteDraw(obj);
      Class2DSatelliteRegisterShot(obj, f.host);
      break;
    case 1:
      obj.flags &= ~0xe;
      break;
    case 2: {
      const m = MatIdentity();
      MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
      MatrixRotateY(m, (G.g_frame_counter << SPIN_SHIFT) | 0);
      MatrixScale(m, s.scale, s.scale, s.scale);
      Class2DPushDraw(PAIR_SLOT, m, false, null, true, Class2DCameraLight());
      Class2DSatelliteRegisterShot(obj, f.host);
      break;
    }
  }
}

/**
 * `[port-only]` -- the beam's draw, `0x0042A96C..0x0042AA73`, inline in sub
 * 2 of `Class2DSatellitePairBeam`: `VecToAngles(partner - pos, &pitch,
 * &yaw); LightsUseCustomSet(...); Push; Translate(pos); RotY(yaw);
 * RotX(pitch); RotX(0x4000); Translate(0, (0x28 - n) * 0.05, 0); UVs(0x72D +
 * n); AssetDrawSlot(0x72D + n); LightsRestoreScene; Pop`.
 */
function Class2DPairBeamDraw(obj: EmperorActor, s: Class2DSatelliteWords,
                             partner: Vec3): void {
  const a = VecToAngles(Math.fround(partner.x - obj.pos.x),
                         Math.fround(partner.y - obj.pos.y),
                         Math.fround(partner.z - obj.pos.z));
  const m = MatIdentity();
  MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
  MatrixRotateY(m, (Math.trunc(a.yaw) << 16) >> 16);
  MatrixRotateX(m, (Math.trunc(a.pitch) << 16) >> 16);
  MatrixRotateX(m, PAIR_BEAM_TILT);
  MatrixTranslate(m, 0,
                  Math.fround((PAIR_BEAM_FRAMES - s.count) * PAIR_BEAM_STEP), 0);
  Class2DPushDraw(CLASS2D_PAIR_BEAM_FIRST + s.count, m, false, null, true,
                  Class2DCameraLight());
}

/**
 * `Class2DSatelliteAbsorbAtBone5` — `FUN_0042B230`. The boss's attack 3.
 * `+0x1350++`. By sub (five at `0x0042B634`):
 *
 * * **0** -- `+0x133C = 0`; the orbit point and `pos` on it; (the `y2` test
 *   again); `+0x13C0` = bone 5's world point (`view_to_world *
 *   parent+0x504`); sub 1, `+0x1330 = 0`.
 * * **1** -- bone 5's point again, a 40-frame glide to it; past 40 `pos` on
 *   it, record `+1 = 1`, sub 2.
 * * **2** -- `+0x133C = 1`; on cue 1, `+0x1330 = 0`, sub 3.
 * * **3** -- `+0x133C = 1`; when `+0x1330 / 3` (before the step) is its
 *   index, `pos` on bone 5's point, sub 4, `+0x1330 = 0`.
 * * **4** -- the orbit point, a 40-frame glide to it; past 40 `pos` on it and
 *   state 2; `+0x133C = 0`.
 *
 * `+0x133C` 0 draws and registers; anything else only clears
 * `obj+0x34 & 0xE`. `[proved]`
 */
export function Class2DSatelliteAbsorbAtBone5(obj: EmperorActor,
                                              f: ClassFrame): void {
  const { s, parent } = Parts(obj);
  SparkIfShot(obj, f.events);
  s.orbit += 1;
  const rec = Record(s);
  switch ((obj.sub << 16) >> 16) {
    case 0: {
      s.drawMode = 0;
      const y2 = Class2DSatelliteOrbitPoint(obj, ORBIT_DISTANCE);
      SeatOnTarget(obj, s);
      if (y2 >= 0x2000 || !(y2 >= 0xe000)) {
        Bone5Point(parent, s.target);
        obj.sub += 1;
        s.count = 0;
      }
      break;
    }
    case 1: {
      Bone5Point(parent, s.target);
      GlideToward(obj, s, GLIDE_FRAMES - s.count);
      const n = s.count;
      s.count += 1;
      if (n > GLIDE_FRAMES) {
        SeatOnTarget(obj, s);
        rec.active = 1;
        obj.sub += 1;
      }
      break;
    }
    case 2:
      if (ParentCue(parent) === Class2DCue.Resume) {
        s.count = 0;
        obj.sub += 1;
      }
      s.drawMode = 1;
      break;
    case 3: {
      const n = s.count;
      s.count += 1;
      if (Math.trunc(n / 3) === ((s.index << 24) >> 24)) {
        Bone5Point(parent, s.target);
        SeatOnTarget(obj, s);
        obj.sub += 1;
        s.count = 0;
      }
      s.drawMode = 1;
      break;
    }
    case 4: {
      Class2DSatelliteOrbitPoint(obj, ORBIT_DISTANCE);
      GlideToward(obj, s, GLIDE_FRAMES - s.count);
      const n = s.count;
      s.count += 1;
      if (n > GLIDE_FRAMES) {
        SeatOnTarget(obj, s);
        obj.state = 2;
      }
      s.drawMode = 0;
      break;
    }
  }
  if (s.drawMode === 0) {
    Class2DSatelliteDraw(obj);
    Class2DSatelliteRegisterShot(obj, f.host);
  } else {
    obj.flags &= ~0xe;
  }
}

/** `CMP EAX, 0x28` -- forty frames. */
const GLIDE_FRAMES = 0x28;

/** `[port-only]` -- the three `LerpWeighted(pos, +0x13C0, 1, n)`. */
function GlideToward(obj: EmperorActor, s: Class2DSatelliteWords,
                     n: number): void {
  obj.pos.x = Math.fround(LerpWeighted(obj.pos.x, s.target.x, 1, n));
  obj.pos.y = Math.fround(LerpWeighted(obj.pos.y, s.target.y, 1, n));
  obj.pos.z = Math.fround(LerpWeighted(obj.pos.z, s.target.z, 1, n));
}

/**
 * `[port-only]` -- bone 5's world point, `Push; SetTop(camera block);
 * MatrixMultiply(parent+0x504); MatrixGetTranslation; Pop`: the port's bone
 * record is the world matrix already.
 */
function Bone5Point(parent: EmperorActor | null, out: Vec3): void {
  const W5 = parent?.skel?.bones[5]?.mat;
  if (!W5) return;
  const m = MatIdentity();
  MatrixMultiply(m, W5);
  MatrixGetTranslation(m, out);
}

/** `CMP [+0x1330], 0xA` / `0x14` -- the two glides. */
const RIDE_OUT_FRAMES = 0xa;
const RIDE_HOME_FRAMES = 0x14;

/**
 * `Class2DSatelliteRideChild` — `FUN_0042B650`. The boss's state 4, with a
 * child out. `+0x1350++`. By sub (six at `0x0042B9B0`):
 *
 * * **0** -- `+0x133C = 0`; the orbit point and `pos`; (the `y2` test);
 *   `+0x13C0` = the record's point, sub 1, `+0x1330 = 0`.
 * * **1** -- a 10-frame glide to it; past 10 `pos` on it, record `+1 = 0`,
 *   sub 2.
 * * **2** -- on cue 3, sub 3.
 * * **3** -- `+0x133C = 1`; once `g_class2d_child_busy` is 0: `+0x13C0` =
 *   bone 5's point, `pos` = the record's point (the child's bone, as it last
 *   drew), sub 4, `+0x1330 = 0`.
 * * **4** -- the orbit point, a 20-frame glide to it; past 20 `pos` on it,
 *   record `+1 = 0`, sub 5; `+0x133C = 0`.
 * * **5** -- the orbit point and `pos`; on cue 1, state 2; `+0x133C = 0`.
 *
 * `[proved]`. The record's point is written by the child's node hook
 * (`Class2DChildNodeDrawHook`) for the bone that carries this satellite.
 */
export function Class2DSatelliteRideChild(obj: EmperorActor,
                                          f: ClassFrame): void {
  const { s, parent } = Parts(obj);
  SparkIfShot(obj, f.events);
  s.orbit += 1;
  const rec = Record(s);
  switch ((obj.sub << 16) >> 16) {
    case 0: {
      s.drawMode = 0;
      const y2 = Class2DSatelliteOrbitPoint(obj, ORBIT_DISTANCE);
      SeatOnTarget(obj, s);
      if (y2 >= 0x2000 || !(y2 >= 0xe000)) {
        s.target.x = rec.point.x;
        s.target.y = rec.point.y;
        s.target.z = rec.point.z;
        obj.sub += 1;
        s.count = 0;
      }
      break;
    }
    case 1: {
      GlideToward(obj, s, RIDE_OUT_FRAMES - s.count);
      const n = s.count;
      s.count += 1;
      if (n > RIDE_OUT_FRAMES) {
        SeatOnTarget(obj, s);
        rec.active = 0;
        obj.sub += 1;
      }
      break;
    }
    case 2:
      if (ParentCue(parent) === Class2DCue.Go) obj.sub += 1;
      break;
    case 3:
      if (G.g_class2d_child_busy === 0) {
        Bone5Point(parent, s.target);
        obj.pos.x = rec.point.x;
        obj.pos.y = rec.point.y;
        obj.pos.z = rec.point.z;
        obj.sub += 1;
        s.count = 0;
      }
      s.drawMode = 1;
      break;
    case 4: {
      Class2DSatelliteOrbitPoint(obj, ORBIT_DISTANCE);
      GlideToward(obj, s, RIDE_HOME_FRAMES - s.count);
      const n = s.count;
      s.count += 1;
      if (n > RIDE_HOME_FRAMES) {
        SeatOnTarget(obj, s);
        rec.active = 0;
        obj.sub += 1;
      }
      s.drawMode = 0;
      break;
    }
    case 5:
      Class2DSatelliteOrbitPoint(obj, ORBIT_DISTANCE);
      SeatOnTarget(obj, s);
      if (ParentCue(parent) === Class2DCue.Resume) obj.state = 2;
      s.drawMode = 0;
      break;
  }
  if (s.drawMode === 0) {
    Class2DSatelliteDraw(obj);
    Class2DSatelliteRegisterShot(obj, f.host);
  } else {
    obj.flags &= ~0xe;
  }
}

/** `ADD EDX, 0x199C` -- the warning flare's 24 cels, Scale 0.8. */
const WARN_FIRST = 0x199c;
const WARN_SCALE = Math.fround(0.800000011920929);

/**
 * `Class2DSatelliteOrbitWithTrail` — `FUN_0042B9D0`. The boss's last round.
 *
 * ```
 * if (obj+0x34 & 8) { spark; PlaySoundId(0x1116A9) }
 * if (sub == 0) { Class2DSatelliteSpawnTrail(obj); sub++ }
 * switch (parent+0x136C) { 2: +0x1350 += 2; 3: +0x1350 += 1
 *                          4: state 8; +0x1368 = 1 }
 * the orbit point and pos; Class2DSatelliteDraw
 * if (parent+0x1358) { Push; Identity; Translate(+0x70); Scale(0.8)
 *                      AssetDrawSlot(0x199C + g_blink_frame_counter % 24); Pop }
 * if (parent+0x135C) { Push; Identity; Translate(+0x70); Scale(0.4, 4, 0.4)
 *                      AssetDrawSlot(0x1633 + g_blink_frame_counter % 24); Pop }
 * Class2DSatelliteRegisterShot
 * ```
 *
 * `[proved]`. The flares are drawn at `+0x70` before this frame's
 * registration writes it: last frame's view point.
 */
export function Class2DSatelliteOrbitWithTrail(obj: EmperorActor,
                                               f: ClassFrame): void {
  const { s, parent } = Parts(obj);
  SparkIfShot(obj, f.events);
  if (((obj.sub << 16) >> 16) === 0) {
    Class2DSatelliteSpawnTrail(obj);
    obj.sub += 1;
  }
  switch (ParentCue(parent)) {
    case Class2DCue.Attack: s.orbit += 2; break;
    case Class2DCue.Go: s.orbit += 1; break;
    case Class2DCue.Gone:
      obj.state = 8;
      s.trailOff = 1;
      break;
  }
  Class2DSatelliteOrbitPoint(obj, ORBIT_DISTANCE);
  SeatOnTarget(obj, s);
  Class2DSatelliteDraw(obj);
  const b = parent?.class2d.boss;
  const v = View(obj);
  if (b && b.warn !== 0) {
    const m = MatIdentity();
    MatrixTranslate(m, v.x, v.y, v.z);
    MatrixScale(m, WARN_SCALE, WARN_SCALE, WARN_SCALE);
    Class2DPushDraw(WARN_FIRST + ((G.g_blink_frame_counter >>> 0)
                                  % CLASS2D_FLARE_CELS),
                    m, true, null, false, null);
  }
  if (b && b.struck !== 0) {
    const m = MatIdentity();
    MatrixTranslate(m, v.x, v.y, v.z);
    MatrixScale(m, BEAM_W, BEAM_H, BEAM_W);
    Class2DPushDraw(CLASS2D_BEAM_FIRST + ((G.g_blink_frame_counter >>> 0)
                                          % BEAM_CELS),
                    m, true, null, false, null);
  }
  Class2DSatelliteRegisterShot(obj, f.host);
}

/**
 * `Class2DSatelliteDespawn` — `FUN_0042BB60`. `obj+0x1368 = 1;
 * ActorDespawn(obj)`. `[proved]`
 */
export function Class2DSatelliteDespawn(obj: EmperorActor): void {
  const { s } = Parts(obj);
  s.trailOff = 1;
  ActorDespawn(obj);
}

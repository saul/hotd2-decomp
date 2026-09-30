/**
 * The four children `Class2DState4` builds, one at a time, while the boss
 * holds its second round open -- `ActorAlloc(init, 0x13F4)` through the table
 * at `0x004283E4` by `+0x1320` (entries 3 and 4 are both kind 3's init) --
 * and kind 0's wing:
 *
 * | kind | init / update | model | clip | what it does |
 * |---|---|---|---|---|
 * | 0 | `Class2DChildKind0Init` / `Update` | `b6boss1z` (0x4D), wing `0x4E` | `0x40C`, wing `0xF` | rides object path `0x192 + rand() % 2` in front of the eye; a hit past frame 15 of the ride hurts the boss, the path's end hurts the player |
 * | 1 | `Class2DChildKind1Init` / `Update` | `b6boss2` (0x4F) | `0x33` | thrown at the camera on cursor `0x23`; its weak point hurts the boss, falling below the eye hurts the player |
 * | 2 | `Class2DChildKind2Init` / `Update` | `b6boss3` (0x50) | `0x3B` | glides at the eye; bone 24 hurts the boss from cursor `0x12`, cursor `0x32` hurts the player |
 * | 3 | `Class2DChildKind3Init` / `Update` | `b6boss4` (0x51) | `0x79` | glides at the eye; bone 2 hurts the boss, cursor `0x2C` hurts the player |
 *
 * Every kind waits for the boss's cue 3, then takes `g_attack_permits[0]`
 * and an enemy slot; every kind ends the same way: `parent+0x34 &= ~0x10000`,
 * the permit back, `g_class2d_child_busy = 0`, `ActorDespawn`. A hit on the
 * boss through a child costs `g_class2d_hit_damage[g_players_in_play]` and
 * raises the rank by 1; a strike on the player lowers it by 3. See
 * `docs/re/boss-emperor.md`.
 */
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import type { Events } from "../../core/events";
import { ActorFlag, type EmperorActor } from "../actor";
import { CameraBlockWorldToView } from "../camera/view";
import { RegisterEnemySlot } from "../camera/slots";
import { ActorRegisterCameraPoint } from "../camera/track";
import { CrtRand, PlaySoundId } from "../class45/rand";
import { ActorDespawn } from "../despawn";
import { ActorByAt, G, HIT_SLOT_NONE } from "../globals";
import type { GameHost } from "../host";
import {
  MatCopy, MatIdentity, MatrixClearRotation, MatrixGetTranslation,
  MatrixLoadIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixScale, MatrixToEulerZYX, MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import type { ClassFrame } from "../registry";
import { ActorBuildSkinnedModel, ActorSpawn } from "../spawn";
import { DrawSkinnedModelAndShadow, MakeSkeletonModel } from "../skeleton";
import { SpawnClass } from "../spawn_class";
import { CharacterTypeOf, MotionPlayLength } from "../tables";
import { LerpWeighted, VecToAngles, vec3, type Vec3 } from "../vec";
import { ActorRunNodeDrawHooks } from "../model_draw";
import {
  Class2DAdjustRank, Class2DAnglesBetween, Class2DStrikePlayers,
  Class2DViewRayReachesPoint,
} from "./boss";
import { CLASS2D_FLARE_CELS, Class2DCameraLight, Class2DPushDraw } from "./draw";
import {
  Class2DBoneSatellite, Class2DChild0PathStart, Class2DChild2Approach,
  Class2DChild3Approach, Class2DHitDamage, g_class2d_child0_path_end,
} from "./tables";
import {
  CLASS2D_AT_KIND0, CLASS2D_AT_WING, Class2DChildAt, Class2DCue,
  Class2DRoutine, makeClass2DChildWords, type Class2DChildWords,
  type Class2DLight,
} from "./state";

const s16 = (v: number): number => (v << 16) >> 16;

/** `[port-only]` -- the child's words and its boss (`obj+0x1394`). */
function Parts(obj: EmperorActor):
    { c: Class2DChildWords; parent: EmperorActor | null } {
  const c = obj.class2d.child!;
  const p = ActorByAt(obj.targetAt);
  const parent = p && p.cls === SpawnClass.Emperor ? p as EmperorActor : null;
  return { c, parent };
}

/** `[port-only]` -- `parent+0x136C`. */
function ParentCue(parent: EmperorActor | null): number {
  return parent?.class2d.boss?.cue ?? 0;
}

/** `[port-only]` -- `parent+0x1324`. */
function ParentRank(parent: EmperorActor | null): number {
  return parent?.class2d.boss?.rank ?? 0;
}

/** `[port-only]` -- the model block's play cursor, `char+0x08`. */
function Cursor(obj: EmperorActor): number {
  return obj.skel?.cursor ?? 0;
}

/** `[port-only]` -- `char+0x00 += 1`. */
function StepCounter(obj: EmperorActor): void {
  if (obj.skel) obj.skel.counter += 1;
}

/**
 * `[port-only]` -- `parent+0x11C -= g_class2d_hit_damage[g_players_in_play]`
 * and `Class2DAdjustRank(parent, 1)`, inline in all four kinds.
 */
function HurtParent(parent: EmperorActor | null): void {
  if (!parent) return;
  parent.hp = s16(parent.hp - Class2DHitDamage(G.g_players_in_play));
  Class2DAdjustRank(parent, RANK_ON_HIT);
}

/** `PUSH 1` / `PUSH -3` to `Class2DAdjustRank`. */
const RANK_ON_HIT = 1;
const RANK_ON_STRIKE = -3;
/** `PUSH 1` -- every strike's latch. */
const STRIKE_LATCH = 1;

/**
 * `[port-only]` -- the four inits by kind: the table at `0x004283E4`
 * (derived here rather than at load, L56).
 */
function ChildInit(kind: number): Class2DRoutine {
  switch (kind) {
    case 0: return Class2DRoutine.ChildKind0Init;
    case 1: return Class2DRoutine.ChildKind1Init;
    case 2: return Class2DRoutine.ChildKind2Init;
    // Entries 3 and 4 of the table; `Class2DState4` hands 4 over as 3.
    default: return Class2DRoutine.ChildKind3Init;
  }
}

/**
 * `[port-only]` -- `0x004282C5..0x00428365`, the allocation `Class2DState4`
 * makes: `ActorAlloc(init, 0x13F4)`, `ActorClearGameFields`, `+0x34 |= 1`,
 * `pos`, `+0x1394 = boss`, `+0x64 = pitch`, `+0x68 = yaw`, `+0x6C = 0`. The
 * init runs on the object's first frame, from the walk.
 */
export function Class2DSpawnChild(parent: EmperorActor, kind: number,
                                  pos: Vec3, pitch: number, yaw: number,
                                  f: ClassFrame): void {
  ActorSpawn(Class2DChildAt(parent.at, CLASS2D_AT_KIND0 + kind),
             SpawnClass.Emperor, -1, `emperor child ${kind}`,
             {
               class2d: {
                 routine: ChildInit(kind), boss: null, sat: null,
                 child: makeClass2DChildWords(kind),
               },
               targetAt: parent.at, flags: 1, visible: true,
               pos: vec3(pos.x, pos.y, pos.z), pitch, yaw, roll: 0,
             },
             f.rng, f.events);
}

/**
 * `[port-only]` -- what every child's init does before its own lines:
 * `g_cur_actor = obj`, state and sub 0, no hit slot, no enemy slot, the
 * character type and first clip on the model block, `ActorBuildSkinnedModel`,
 * the order 5, `model+0x64 |= 4`, the counter, `+0x124 =
 * g_actor_radius_by_char[type]`, `+0x1320 = +0x1324 = 0`. The four inits are
 * the same lines with their own type, clip, hook and counter.
 */
function ChildInitModel(obj: EmperorActor, type: number, clip: number,
                        counter: number): void {
  const c = obj.class2d.child!;
  G.g_cur_actor = obj.at;
  obj.state = 0;
  obj.sub = 0;
  obj.hitSlot = HIT_SLOT_NONE;
  obj.cameraSlot = -1;
  obj.charType = type;
  const t = CharacterTypeOf(obj);
  obj.skel = MakeSkeletonModel(t?.bone_count ?? 0, MODEL_ORDER);
  obj.skel.motion = clip;
  obj.motion = clip;
  ActorBuildSkinnedModel(obj);
  obj.skel.order = MODEL_ORDER;
  obj.motionFlags |= MODEL_FLAG_4;
  obj.skel.counter = counter;
  obj.radius = t?.actor_radius ?? 0;
  obj.hitRadius = obj.radius;
  c.animate = 0;
  c.shown = 0;
}

/** `MOV byte ptr [EDI + 0x68], 5`; `OR AL, 4` into `model+0x64`. */
const MODEL_ORDER = 5;
const MODEL_FLAG_4 = 4;

/** Kind 0: `b6boss1z.bin` on `0x40C`, its wing `0x4E` on `0xF`. */
const KIND0_TYPE = 0x4d;
const KIND0_CLIP = 0x40c;
const WING_TYPE = 0x4e;
const WING_CLIP = 0xf;

/**
 * `Class2DChildKind0Init` — `FUN_0042C0B0`.
 *
 * ```
 * (the child's model: 0x4D, 0x40C, hook Class2DChildNodeDrawHook, counter 0)
 * wing = ActorAllocSub(0x13F4); +0x13B0 = wing; g_cur_actor = wing
 * wing+0x3C = -1; wing+0x120 = 0xFF; wing char 0x4E, clip 0xF
 * ActorBuildSkinnedModel(wing); wing model+0x68 = 5; wing+0x34 |= 0x88000
 * Class2DChildKind0Update(obj); obj+0x00 = Class2DChildKind0Update
 * ```
 *
 * `[proved]`. The wing is a block the child owns, not a task: nothing
 * updates it, and `Class2DChildKind0Draw` places, poses and draws it. The
 * port makes it an object so the renderer can bind a skeleton to it
 * ({@link Class2DRoutine.Wing}).
 */
export function Class2DChildKind0Init(obj: EmperorActor, f: ClassFrame): void {
  const c = obj.class2d.child!;
  ChildInitModel(obj, KIND0_TYPE, KIND0_CLIP, 0);
  const at = Class2DChildAt(obj.targetAt, CLASS2D_AT_WING);
  const wing = ActorSpawn(at, SpawnClass.Emperor, -1, "emperor child 0 wing",
                          {
                            class2d: {
                              routine: Class2DRoutine.Wing, boss: null,
                              sat: null, child: null,
                            },
                            targetAt: obj.at, flags: 0, visible: true,
                          }, f.rng, f.events) as EmperorActor;
  c.wingAt = wing.at;
  G.g_cur_actor = wing.at;
  wing.hitSlot = HIT_SLOT_NONE;
  wing.cameraSlot = -1;
  wing.charType = WING_TYPE;
  const t = CharacterTypeOf(wing);
  wing.skel = MakeSkeletonModel(t?.bone_count ?? 0, MODEL_ORDER);
  wing.skel.motion = WING_CLIP;
  wing.motion = WING_CLIP;
  ActorBuildSkinnedModel(wing);
  wing.skel.order = MODEL_ORDER;
  // `OR EDX, 0x88000` -- no shadow, not in the shot test.
  wing.flags |= ActorFlag.NoShadow | ActorFlag.NoShotTest;
  Class2DChildKind0Update(obj, f);
  obj.class2d.routine = Class2DRoutine.ChildKind0Update;
}

/** `ADD EAX, 0x192` -- object paths 402 and 403. */
const KIND0_PATH_BASE = 0x192;
/** `CMP EAX, 0x1E` -- the glide onto the path. */
const KIND0_GLIDE_FRAMES = 0x1e;
/** `SUB EDX, 4` -- the strike, four frames before the path's end. */
const KIND0_STRIKE_EARLY = 4;
/** `CMP ECX, 0xF` -- a shot counts after fifteen frames on the path. */
const KIND0_SHOT_AFTER = 0xf;
/** `PUSH 7` -- kind 0's strike motion. */
const KIND0_STRIKE_MOTION = 7;
/** `PUSH 0x40000000` -- 2.0 over the camera point. */
const KIND0_CAMERA_RISE = 2.0;
/** `PUSH 0x4417A9` -- onto the path; `PUSH 0x3425A9` -- shot. */
const SND_KIND0_ON_PATH = 0x4417a9;
const SND_KIND0_SHOT = 0x3425a9;

/**
 * `Class2DChildKind0Update` — `FUN_0042C1A0`. Four subs (`0x0042C47C`):
 *
 * * **0** -- on cue 3: `+0x1320 = +0x1324 = 1`, `r = rand() % 2` into
 *   `+0x1350`, `+0x1334 = g_class2d_child0_path_start[r]`, `+0x1330 = 0`,
 *   the target on path `0x192 + r` at that frame, the permit, the enemy
 *   slot, sub 1;
 * * **1** -- a 30-frame glide to it, then `pos` on it,
 *   `PlaySoundId(0x4417A9)`, `+0x1330 = +0x1334` (the path frame),
 *   `+0x1334 = 0`, sub 2;
 * * **2** -- on the path at `+0x1330`, `+0x1330++`, `+0x1334++`; at
 *   `g_class2d_child0_path_end[r] - 4` the strike (`1, 7`) and the rank -3,
 *   sub 3; else past fifteen frames a shot (`obj+0x34 & 8`) sounds
 *   `0x3425A9`, hurts the boss, sub 3;
 * * **3** -- the end.
 *
 * Every frame but the last: `Class2DChildKind0Draw`, the counter if
 * `+0x1320`, `obj+0x34 &= ~0xE`, and unless `obj+0x34 & 0x100`
 * `ActorRegisterCameraPoint(2.0)`. `[proved]`
 */
export function Class2DChildKind0Update(obj: EmperorActor,
                                        f: ClassFrame): void {
  const { c, parent } = Parts(obj);
  G.g_cur_actor = obj.at;
  switch (s16(obj.sub)) {
    case 0:
      if (ParentCue(parent) !== Class2DCue.Go) break;
      c.animate = 1;
      c.shown = 1;
      c.path = (CrtRand(f.rng) % 2) | 0;
      c.span = Class2DChild0PathStart(c.path);
      c.count = 0;
      Class2DChildKind0TargetOnPath(obj, KIND0_PATH_BASE + c.path,
                                    Math.fround(c.span), f.host);
      TakePermit(obj);
      RegisterEnemySlot(obj);
      obj.sub += 1;
      break;
    case 1: {
      Glide(obj, c, KIND0_GLIDE_FRAMES - c.count);
      const n = c.count;
      c.count += 1;
      if (n > KIND0_GLIDE_FRAMES) {
        SeatOnTarget(obj, c);
        PlaySoundId(SND_KIND0_ON_PATH, f.events);
        c.count = c.span;
        c.span = 0;
        obj.sub += 1;
      }
      break;
    }
    case 2:
      Class2DChildKind0TargetOnPath(obj, KIND0_PATH_BASE + c.path,
                                    Math.fround(c.count), f.host);
      SeatOnTarget(obj, c);
      c.count += 1;
      c.span += 1;
      if (c.count
          === (g_class2d_child0_path_end[c.path] ?? 0) - KIND0_STRIKE_EARLY) {
        Class2DStrikePlayers(STRIKE_LATCH, KIND0_STRIKE_MOTION, f.events);
        if (parent) Class2DAdjustRank(parent, RANK_ON_STRIKE);
        obj.sub += 1;
      } else if (c.span > KIND0_SHOT_AFTER && (obj.flags & ActorFlag.Hit)) {
        PlaySoundId(SND_KIND0_SHOT, f.events);
        HurtParent(parent);
        obj.sub += 1;
      }
      break;
    case 3:
      ChildLeave(obj, parent, null);
      return;
  }
  Class2DChildKind0Draw(obj, f);
  if (c.animate !== 0) StepCounter(obj);
  RegisterUnlessImmune(obj, f.host, KIND0_CAMERA_RISE);
}

/**
 * `[port-only]` -- `MOV dword ptr [g_attack_permits], 1`: player 0's permit
 * taken. The engine stores 1; the port's taken permit holds an address
 * (`G.g_attack_permits`), so it holds the child's.
 */
function TakePermit(obj: EmperorActor): void {
  G.g_attack_permits[0] = obj.at;
}

/**
 * `[port-only]` -- the tail every kind's update ends on: `obj+0x34 &= ~0xE`,
 * and `ActorRegisterCameraPoint(rise)` unless `obj+0x34 & 0x100`.
 */
function RegisterUnlessImmune(obj: EmperorActor, host: GameHost,
                              rise: number): void {
  obj.flags &= ~0xe;
  if (!(obj.flags & ActorFlag.ShotImmune)) {
    ActorRegisterCameraPoint(obj, host, rise);
  }
}

/**
 * `[port-only]` -- every kind's last sub: `parent+0x34 &= ~0x10000`,
 * `g_attack_permits[0] = 0`, `g_class2d_child_busy = 0`, `ActorDespawn(obj)`
 * -- kind 3 sounds `0x4E17A9` between the first two. Kind 0's wing goes
 * with it: it is the child's `ActorAllocSub` block, which has no task of its
 * own and is freed with the child.
 */
function ChildLeave(obj: EmperorActor, parent: EmperorActor | null,
                    sound: { id: number; events?: Events } | null): void {
  if (parent) parent.flags &= ~ActorFlag.NoCameraTrack;
  if (sound) PlaySoundId(sound.id, sound.events);
  G.g_attack_permits[0] = -1;
  G.g_class2d_child_busy = 0;
  ActorDespawn(obj);
  const wingAt = obj.class2d.child?.wingAt ?? -1;
  if (wingAt !== -1) {
    const wing = ActorByAt(wingAt);
    if (wing && wing.cls === SpawnClass.Emperor) ActorDespawn(wing);
  }
}

/** `[port-only]` -- the three `LerpWeighted(pos, +0x13C0, 1, n)`. */
function Glide(obj: EmperorActor, c: Class2DChildWords, n: number): void {
  obj.pos.x = Math.fround(LerpWeighted(obj.pos.x, c.target.x, 1, n));
  obj.pos.y = Math.fround(LerpWeighted(obj.pos.y, c.target.y, 1, n));
  obj.pos.z = Math.fround(LerpWeighted(obj.pos.z, c.target.z, 1, n));
}

/** `[port-only]` -- `pos = +0x13C0`. */
function SeatOnTarget(obj: EmperorActor, c: Class2DChildWords): void {
  obj.pos.x = c.target.x;
  obj.pos.y = c.target.y;
  obj.pos.z = c.target.z;
}

/** `PUSH 0xC1200000` -- ten units back from the eye. */
const KIND0_PATH_BACK = -10.0;

/**
 * `Class2DChildKind0TargetOnPath` — `FUN_0042C490`. `(obj, path, frame)`:
 *
 * ```
 * VecToAngles(g_camera_eye - parent.pos, &pitch, &yaw)   ; each & 0xFFFF
 * p = CamEvalObjectPath6(path, frame).pos
 * Push; Identity; Translate(g_camera_eye); RotY(yaw); RotX(pitch)
 * Translate(0, 0, -10); +0x13C0 = top * p; Pop
 * ```
 *
 * `[proved]`: the path's point in a frame at the eye, turned to face along
 * the boss-to-eye line and pulled ten back.
 */
export function Class2DChildKind0TargetOnPath(obj: EmperorActor, path: number,
                                              frame: number,
                                              host: GameHost): void {
  const { c, parent } = Parts(obj);
  const eye = G.g_camera_eye;
  const pp = parent?.pos ?? vec3();
  const a = VecToAngles(Math.fround(eye.x - pp.x), Math.fround(eye.y - pp.y),
                        Math.fround(eye.z - pp.z));
  const yaw = s16(Math.trunc(a.yaw)) & 0xffff;
  const pitch = s16(Math.trunc(a.pitch)) & 0xffff;
  const q = host.objectPath?.(path, frame) ?? null;
  const p = vec3(Math.fround(q?.x ?? 0), Math.fround(q?.y ?? 0),
                 Math.fround(q?.z ?? 0));
  const m = MatIdentity();
  MatrixLoadIdentity(m);
  MatrixTranslate(m, eye.x, eye.y, eye.z);
  MatrixRotateY(m, yaw);
  MatrixRotateX(m, pitch);
  MatrixTranslate(m, 0, 0, KIND0_PATH_BACK);
  const out = vec3();
  MatrixTransformPoint(m, p, out);
  c.target.x = Math.fround(out.x);
  c.target.y = Math.fround(out.y);
  c.target.z = Math.fround(out.z);
}

/**
 * `Class2DChildKind0Draw` — `FUN_0042C5A0`.
 *
 * ```
 * LightsUseCustomSet(1.0, camera block pitch/yaw, 1, 1, 1)
 * g_cur_actor = obj; DrawSkinnedModelAndShadow(obj)
 * if (+0x1324) {
 *   wing = +0x13B0
 *   Push; SetTop(camera block); Multiply(obj+0x2C4)       ; bone 1, in the world
 *   wing.pos = translation; MatrixToEulerZYX(&wing+0x64, &wing+0x68, &wing+0x6C)
 *   Pop; g_cur_actor = wing; DrawSkinnedModelAndShadow(wing)
 *   if (+0x1320) wing counter++
 * }
 * LightsRestoreScene; g_cur_actor = obj
 * ```
 *
 * `[proved]`. The wing rides bone 1 and takes its turn; the child's own
 * nodes draw through {@link Class2DChildNodeDrawHook}.
 */
export function Class2DChildKind0Draw(obj: EmperorActor, f: ClassFrame): void {
  const c = obj.class2d.child!;
  const light = Class2DCameraLight();
  G.g_cur_actor = obj.at;
  DrawSkinnedModelAndShadow(obj);
  RunChildHook(obj, false, light, f);
  if (c.shown !== 0) {
    const wing = ActorByAt(c.wingAt);
    const W1 = obj.skel?.bones[1]?.mat;
    if (wing && wing.cls === SpawnClass.Emperor && W1) {
      MatrixGetTranslation(W1, wing.pos);
      const e = MatrixToEulerZYX(W1);
      wing.pitch = e.rx;
      wing.yaw = e.ry;
      wing.roll = e.rz;
      G.g_cur_actor = wing.at;
      DrawSkinnedModelAndShadow(wing);
      if (c.animate !== 0 && wing.skel) wing.skel.counter += 1;
    }
  }
  G.g_cur_actor = obj.at;
}

/** `[port-only]` -- the walk's hook, for the child's own hook routine. */
function RunChildHook(obj: EmperorActor, kind2: boolean,
                      light: Class2DLight, f: ClassFrame): void {
  ActorRunNodeDrawHooks(obj, (o, bone, slot) => {
    if (kind2) Class2DChildKind2NodeDrawHook(o as EmperorActor, bone, slot, light);
    else Class2DChildNodeDrawHook(o as EmperorActor, bone, slot, light);
  }, f);
}

/** `ADD EDX, 0x199C` with `% 0x18` -- the hidden child's flare. */
const HIDDEN_FLARE_FIRST = 0x199c;
/** `PUSH 0x41200000` -- 10.0; `PUSH 0x8000` -- turned over. */
const HIDDEN_FLARE_SCALE = 10.0;
const HIDDEN_FLARE_TURN = 0x8000;
/** `CMP CX, 1` / `CMP CX, 0x16` -- the bone that carries the flare. */
const HIDDEN_FLARE_BONE = 1;
const HIDDEN_FLARE_BONE_KIND2 = 0x16;

/**
 * `Class2DChildNodeDrawHook` — `FUN_0042C6D0`, kinds 0, 1 and 3's hook.
 * `(node)`, `bone = node+0x14`, with `g_cur_actor` the child:
 *
 * ```
 * if (g_cur_actor+0x1324) { UVs(rec.slot); AssetDrawSlot(rec.slot) }
 * else if (bone == 1) { Push; MatrixClearRotation; RotZ(0x8000); Scale(10)
 *                       AssetDrawSlot(0x199C + g_blink_frame_counter % 24); Pop }
 * s = g_class2d_child_bone_satellite[bone]
 * if (s != 0xFF && bone != 0)
 *   g_class2d_satellite_records[s].point = translation(camera block * top)
 * ```
 *
 * `[proved]`: shown, the model; hidden, a flare where it will be; and either
 * way the satellites' seats on its bones. The node's matrix is the world
 * one here, so the seat is its translation, and the flare -- built on the
 * view matrix with its rotation cleared -- is drawn in the camera's space at
 * the node's view point.
 */
export function Class2DChildNodeDrawHook(obj: EmperorActor, bone: number,
                                         slot: number,
                                         light: Class2DLight): void {
  ChildHook(obj, bone, slot, light, HIDDEN_FLARE_BONE, false);
}

/**
 * `Class2DChildKind2NodeDrawHook` — `FUN_0042D330`, kind 2's hook: the same
 * as {@link Class2DChildNodeDrawHook} with the flare on bone `0x16` and the
 * seats from `g_class2d_child2_bone_satellite`. `[proved]`
 */
export function Class2DChildKind2NodeDrawHook(obj: EmperorActor, bone: number,
                                              slot: number,
                                              light: Class2DLight): void {
  ChildHook(obj, bone, slot, light, HIDDEN_FLARE_BONE_KIND2, true);
}

const _np = vec3();
const _nv = vec3();

/** `[port-only]` -- the two hooks' one body, by their two differences. */
function ChildHook(obj: EmperorActor, bone: number, slot: number,
                   light: Class2DLight, flareBone: number,
                   kind2: boolean): void {
  const c = obj.class2d.child!;
  const node = obj.skel?.bones[bone]?.mat;
  if (!node) return;
  if (c.shown !== 0) {
    Class2DPushDraw(slot, node, false, null, true, light);
  } else if (bone === flareBone) {
    MatrixGetTranslation(node, _np);
    MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index), _np, _nv);
    const m = MatIdentity();
    MatrixTranslate(m, _nv.x, _nv.y, _nv.z);
    MatrixClearRotation(m);
    MatrixRotateZ(m, HIDDEN_FLARE_TURN);
    MatrixScale(m, HIDDEN_FLARE_SCALE, HIDDEN_FLARE_SCALE, HIDDEN_FLARE_SCALE);
    Class2DPushDraw(HIDDEN_FLARE_FIRST
                    + ((G.g_blink_frame_counter >>> 0) % CLASS2D_FLARE_CELS),
                    m, true, null, false, light);
  }
  const s = Class2DBoneSatellite(kind2, bone);
  if (s !== 0xff && bone !== 0) {
    const rec = G.g_class2d_satellite_records[(s << 24) >> 24];
    if (rec) MatrixGetTranslation(node, rec.point);
  }
}

/** Kind 1: `b6boss2.bin` on `0x33`. */
const KIND1_TYPE = 0x4f;
const KIND1_CLIP = 0x33;

/**
 * `Class2DChildKind1Init` — `FUN_0042C830`. The child's model (`0x4F`,
 * `0x33`, `Class2DChildNodeDrawHook`, counter 0), then
 * `Class2DChildKind1Update(obj)` and its install. `[proved]`
 */
export function Class2DChildKind1Init(obj: EmperorActor, f: ClassFrame): void {
  ChildInitModel(obj, KIND1_TYPE, KIND1_CLIP, 0);
  Class2DChildKind1Update(obj, f);
  obj.class2d.routine = Class2DRoutine.ChildKind1Update;
}

/** `CMP ECX, 0x1E` -- the wait; `CMP EAX, 0x32` -- the shot's grace. */
const KIND1_WAIT = 0x1e;
const KIND1_SHOT_AFTER = 0x32;
/** Cursors `0x23` (the throw), `0x41` and `0x55` (the hold). */
const KIND1_THROW_CURSOR = 0x23;
const KIND1_HOLD_CURSOR = 0x41;
const KIND1_STOP_CURSOR = 0x55;
/** `MOV [ESI+0x50], 0x40800000` 4.0 up; `MOV [ESI+0x5C], 0xBD8B60B6` the fall. */
const KIND1_THROW_UP = 4.0;
const KIND1_GRAVITY = Math.fround(-0.06805559992790222);
/** `FSUB [0x004C43A4]` 10.0, `FMUL [0x0055D2A4]` -1/130 -- the throw's speed. */
const KIND1_THROW_NEAR = 10.0;
const KIND1_THROW_SCALE = Math.fround(-0.0076923076994717121);
/** `FADD [0x0055CAD8]` -- 22.0 over the eye: below it, the strike. */
const KIND1_STRIKE_HEIGHT = 22.0;
/** `PUSH 6` -- kind 1's strike motion. */
const KIND1_STRIKE_MOTION = 6;
/** `PUSH 0x41700000` -- 15.0 over the camera point (kinds 1 and 3). */
const KIND13_CAMERA_RISE = 15.0;
/** `PUSH 0x2A16A9` -- the throw. */
const SND_KIND1_THROW = 0x2a16a9;

/**
 * `Class2DChildKind1Update` — `FUN_0042C8D0`. Six subs (`0x0042CB84`):
 *
 * * **0** -- on cue 3: `+0x1320 = 0`, `+0x1324 = 1`, `+0x1330 = 0`, the
 *   permit, the enemy slot, sub 1;
 * * **1** -- thirty frames, then `+0x1330 = +0x1334 = 0`, `+0x1320 = 1`, sub 2;
 * * **2** -- `+0x1334++`; past `0x32` a shot that reaches the weak point
 *   ends it (sub 5). On cursor `0x23` the throw: `vel.y = 4.0`, `+0x5C =
 *   -0.0680556`, the speed `(d - 10) * -1/130` of the flat distance `d` to
 *   the eye along the yaw (`vel.x = sin`, `vel.z = cos`), `PlaySoundId(
 *   0x2A16A9)`, sub 3;
 * * **3** -- a weak-point shot ends it (sub 5, and the frame still moves);
 *   cursor `0x41` stops the counter, falling (`vel.y < 0`) starts it, cursor
 *   `0x55` stops it and moves to sub 4; then the flight;
 * * **4** -- a weak-point shot, or below `eye.y + 22`: the strike (`1, 6`) and
 *   the rank -3; either way sub 5; then the flight;
 * * **5** -- the end.
 *
 * The flight: `pos += vel`, `vel.y += +0x5C`. Every frame but the last: the
 * yaw and pitch from the eye to it on the flat
 * (`Class2DAnglesBetween((x, 0, z), (eye.x, 0, eye.z), &+0x68, &+0x64)`),
 * `Class2DChildDraw`, the counter if `+0x1320`, and the tail with rise 15.
 * `[proved]`
 */
export function Class2DChildKind1Update(obj: EmperorActor,
                                        f: ClassFrame): void {
  const { c, parent } = Parts(obj);
  G.g_cur_actor = obj.at;
  const eye = G.g_camera_eye;
  switch (s16(obj.sub)) {
    case 0:
      if (ParentCue(parent) !== Class2DCue.Go) break;
      c.animate = 0;
      c.shown = 1;
      c.count = 0;
      TakePermit(obj);
      RegisterEnemySlot(obj);
      obj.sub += 1;
      break;
    case 1: {
      const n = c.count;
      c.count += 1;
      if (n > KIND1_WAIT) {
        obj.sub += 1;
        c.count = 0;
        c.span = 0;
        c.animate = 1;
      }
      break;
    }
    case 2:
      c.span += 1;
      if (c.span > KIND1_SHOT_AFTER && Class2DChildKind1ResolveShot(obj, f) !== 0) {
        obj.sub = 5;
        break;
      }
      if (Cursor(obj) === KIND1_THROW_CURSOR) {
        obj.vel.y = KIND1_THROW_UP;
        obj.accY = KIND1_GRAVITY;
        const dz = obj.pos.z - eye.z;
        const dx = obj.pos.x - eye.x;
        const d = Math.sqrt(dx * dx + dz * dz);
        const speed = (d - KIND1_THROW_NEAR) * KIND1_THROW_SCALE;
        // `FILD [ESI+0x68]; FMUL qword [0x004C4370]` -- `g_bams_to_rad`,
        // the double.
        const a = obj.yaw * BAMS_TO_RAD_F64;
        obj.vel.x = Math.fround(Math.sin(a) * speed);
        obj.vel.z = Math.fround(Math.cos(a) * speed);
        PlaySoundId(SND_KIND1_THROW, f.events);
        obj.sub += 1;
      }
      break;
    case 3:
      if (Class2DChildKind1ResolveShot(obj, f) !== 0) {
        obj.sub = 5;
      } else {
        if (Cursor(obj) === KIND1_HOLD_CURSOR) c.animate = 0;
        if (obj.vel.y < 0) c.animate = 1;
        if (Cursor(obj) === KIND1_STOP_CURSOR) {
          c.animate = 0;
          obj.sub += 1;
        }
      }
      Class2DChildKind1Fly(obj);
      break;
    case 4:
      if (Class2DChildKind1ResolveShot(obj, f) !== 0) {
        obj.sub += 1;
      } else if (eye.y + KIND1_STRIKE_HEIGHT > obj.pos.y) {
        Class2DStrikePlayers(STRIKE_LATCH, KIND1_STRIKE_MOTION, f.events);
        if (parent) Class2DAdjustRank(parent, RANK_ON_STRIKE);
        obj.sub += 1;
      }
      Class2DChildKind1Fly(obj);
      break;
    case 5:
      ChildLeave(obj, parent, null);
      return;
  }
  const a = Class2DAnglesBetween(vec3(obj.pos.x, 0, obj.pos.z),
                                 vec3(eye.x, 0, eye.z));
  obj.yaw = a.yaw;
  obj.pitch = a.pitch;
  Class2DChildDraw(obj, f);
  if (c.animate !== 0) StepCounter(obj);
  RegisterUnlessImmune(obj, f.host, KIND13_CAMERA_RISE);
}

/**
 * `[port-only]` -- `0x0042CB33..0x0042CB54`, kind 1's flight: `pos += vel`,
 * then `vel.y += +0x5C`.
 */
function Class2DChildKind1Fly(obj: EmperorActor): void {
  obj.pos.x = Math.fround(obj.vel.x + obj.pos.x);
  obj.pos.y = Math.fround(obj.vel.y + obj.pos.y);
  obj.pos.z = Math.fround(obj.vel.z + obj.pos.z);
  obj.vel.y = Math.fround(obj.accY + obj.vel.y);
}

/** `PUSH 0x1117A9` -- a hit; `PUSH 0x1116A9` -- a ricochet. */
const SND_KIND1_HIT = 0x1117a9;
const SND_CHILD_RICOCHET = 0x1116a9;

/**
 * `[port-only]` -- the loop every child's shot routine runs over the two
 * players, `0x0042CC10..0x0042CCA6` and its two twins: the bone the shot
 * marked (`obj+0x190 + p`), then that byte zeroed and the player's bit
 * cleared. `test` answers for one player's bone, and returns whether it hit.
 */
function ChildShotLoop(obj: EmperorActor, first: number, last: number,
                       test: (bone: number, p: number) => boolean): number {
  let hit = 0;
  const sub = s16(obj.sub);
  if (sub < first || sub > last || !(obj.flags & ActorFlag.Hit)
      || (obj.flags & ActorFlag.Reacting)) {
    return 0;
  }
  for (let p = 0; p < 2; p++) {
    const bone = (obj.shotBones[p] << 24) >> 24;
    if (test(bone, p)) hit = 1;
    obj.shotBones[p] = 0;
    obj.flags &= ~(1 << (p + 1));
  }
  return hit;
}

/** `PUSH 0x3F800000; PUSH 0x40800000; PUSH 0` -- (0, 4, 1) on bone 1, radius 3.5. */
const KIND1_WEAK_POINT: Vec3 = { x: 0, y: 4.0, z: 1.0 };
const KIND1_WEAK_RADIUS = 3.5;

/**
 * `Class2DChildKind1ResolveShot` — `FUN_0042CBA0`. In subs 2..4, a marked
 * shot (`obj+0x34 & 8`, not `0x40000000`), for each player: bone 1 in reach
 * of the weak point hurts the boss and sounds `0x1117A9`; bone 1 out of
 * reach, or any other bone, sounds `0x1116A9`; bone 0 nothing. Returns 1
 * when it hurt the boss. `[proved]`
 */
export function Class2DChildKind1ResolveShot(obj: EmperorActor,
                                             f: ClassFrame): number {
  const { parent } = Parts(obj);
  return ChildShotLoop(obj, 2, 4, (bone, p) => {
    if (bone === 1) {
      if (Class2DChildKind1WeakPointInReach(obj, p, f.host)) {
        HurtParent(parent);
        PlaySoundId(SND_KIND1_HIT, f.events);
        return true;
      }
      PlaySoundId(SND_CHILD_RICOCHET, f.events);
    } else if (bone !== 0) {
      PlaySoundId(SND_CHILD_RICOCHET, f.events);
    }
    return false;
  });
}

/**
 * `Class2DChildKind1WeakPointInReach` — `FUN_0042CCC0`. `(obj, player)`:
 * `Push; SetTop(obj+0x2C4); Translate(0, 4, 1); P = translation; Pop;
 * return RayTestSphere(player, P, 3.5) >= 0`. `[proved]`
 */
export function Class2DChildKind1WeakPointInReach(obj: EmperorActor,
                                                  player: number,
                                                  host: GameHost): boolean {
  return Class2DViewRayReachesPoint(obj, 1, KIND1_WEAK_POINT,
                                    KIND1_WEAK_RADIUS, player, host);
}

/** Kind 2: `b6boss3.bin` on `0x3B`, its counter from 11. */
const KIND2_TYPE = 0x50;
const KIND2_CLIP = 0x3b;
const KIND2_COUNTER = 0xb;

/**
 * `Class2DChildKind2Init` — `FUN_0042CD30`. The child's model (`0x50`,
 * `0x3B`, `Class2DChildKind2NodeDrawHook`, counter 11), then
 * `Class2DChildKind2Update(obj)` and its install. `[proved]`
 */
export function Class2DChildKind2Init(obj: EmperorActor, f: ClassFrame): void {
  ChildInitModel(obj, KIND2_TYPE, KIND2_CLIP, KIND2_COUNTER);
  Class2DChildKind2Update(obj, f);
  obj.class2d.routine = Class2DRoutine.ChildKind2Update;
}

/** `CMP EAX, 0x1E` -- the wait. */
const KIND2_WAIT = 0x1e;
/** `FCOMP [0x0055D2A8]` -- 130.0: this near the eye it stops and swings. */
const KIND2_NEAR = 130.0;
/** `CMP EAX, 0x32` -- the swing's strike cursor. */
const KIND2_STRIKE_CURSOR = 0x32;
/** `PUSH 9` -- kind 2's strike motion. */
const KIND2_STRIKE_MOTION = 9;
/** Bone 24's record, `obj+0xFB4` -- the bone that is shot and flashes. */
const KIND2_BONE = 0x18;
/** `PUSH 0` -- no rise over the camera point. */
const KIND2_CAMERA_RISE = 0.0;
/** The swing's flash: `Translate(7, -4.5, 0) RotY(0x4000) RotX(0x2000) Scale(1.5)`. */
const KIND2_FLASH_X = 7.0;
const KIND2_FLASH_Y = -4.5;
const KIND2_FLASH_YAW = 0x4000;
const KIND2_FLASH_PITCH = 0x2000;
const KIND2_FLASH_SCALE = 1.5;
/** `ADD EDX, 0x97A` with `% 0x27`; `AND EDX, 0x1F; ADD EDX, 0x199C`. */
const KIND2_FLASH_FIRST = 0x97a;
const KIND2_FLASH_CELS = 0x27;
const KIND2_SPARK_FIRST = 0x199c;
const KIND2_SPARK_MASK = 0x1f;
/** `PUSH 0x3F25A9` -- the approach; `PUSH 0x4125A9` -- near. */
const SND_KIND2_APPROACH = 0x3f25a9;
const SND_KIND2_NEAR = 0x4125a9;

/**
 * `Class2DChildKind2Update` — `FUN_0042CDD0`. Five subs (`0x0042D200`):
 *
 * * **0** -- on cue 3: `+0x1330 = 0`, `+0x1324 = 1`, the permit, the enemy
 *   slot, sub 1;
 * * **1** -- thirty frames, then `+0x13C0` = the eye, `+0x1330 = 0`,
 *   `+0x1334 = g_class2d_child2_approach[rank]`, `PlaySoundId(0x3F25A9)`,
 *   sub 2;
 * * **2** -- a shot on bone 24 ends it (sub 4). Otherwise one
 *   `LerpWeighted(pos, eye, 1, +0x1334 - +0x1330)` step (`+0x1330` stays 0),
 *   and within 130 of the eye `+0x1320 = 1`, `PlaySoundId(0x4125A9)`, sub 3;
 * * **3** -- before cursor `0x32` the flash on bone 24 and the shot; at
 *   `0x32` the strike (`1, 9`) and the rank -3, sub 4; past it, at the
 *   clip's last frame, sub 4;
 * * **4** -- the end.
 *
 * Every frame but the last: bone 24's world point into `obj+0x100` and its
 * view point into `obj+0x10C` (from the record the last draw left),
 * `Class2DChildDraw`, the counter if `+0x1320`, and the tail with rise 0.
 * `[proved]`
 */
export function Class2DChildKind2Update(obj: EmperorActor,
                                        f: ClassFrame): void {
  const { c, parent } = Parts(obj);
  G.g_cur_actor = obj.at;
  switch (s16(obj.sub)) {
    case 0:
      if (ParentCue(parent) !== Class2DCue.Go) break;
      c.count = 0;
      c.shown = 1;
      TakePermit(obj);
      RegisterEnemySlot(obj);
      obj.sub += 1;
      break;
    case 1: {
      const n = c.count;
      c.count += 1;
      if (n > KIND2_WAIT) {
        c.target.x = G.g_camera_eye.x;
        c.target.y = G.g_camera_eye.y;
        c.target.z = G.g_camera_eye.z;
        c.count = 0;
        c.span = Class2DChild2Approach(ParentRank(parent));
        PlaySoundId(SND_KIND2_APPROACH, f.events);
        obj.sub += 1;
      }
      break;
    }
    case 2:
      if (Class2DChildKind2ResolveShot(obj, f) !== 0) {
        obj.sub = 4;
        break;
      }
      if (ApproachStep(obj, c) <= KIND2_NEAR) {
        c.animate = 1;
        PlaySoundId(SND_KIND2_NEAR, f.events);
        obj.sub += 1;
      }
      break;
    case 3: {
      const cur = Cursor(obj);
      if (cur < KIND2_STRIKE_CURSOR) {
        const W = obj.skel?.bones[KIND2_BONE]?.mat;
        if (W) {
          const m = MatCopy(MatIdentity(), W);
          MatrixTranslate(m, KIND2_FLASH_X, KIND2_FLASH_Y, 0);
          MatrixRotateY(m, KIND2_FLASH_YAW);
          MatrixRotateX(m, KIND2_FLASH_PITCH);
          MatrixScale(m, KIND2_FLASH_SCALE, KIND2_FLASH_SCALE,
                      KIND2_FLASH_SCALE);
          Class2DPushDraw(KIND2_FLASH_FIRST
                          + ((G.g_frame_counter >>> 0) % KIND2_FLASH_CELS),
                          m, false, null, false, null);
          Class2DPushDraw(KIND2_SPARK_FIRST
                          + ((G.g_frame_counter >>> 0) & KIND2_SPARK_MASK),
                          m, false, null, false, null);
        }
        if (Class2DChildKind2ResolveShot(obj, f) !== 0) obj.sub = 4;
      } else if (cur === KIND2_STRIKE_CURSOR) {
        Class2DStrikePlayers(STRIKE_LATCH, KIND2_STRIKE_MOTION, f.events);
        if (parent) Class2DAdjustRank(parent, RANK_ON_STRIKE);
        obj.sub += 1;
      } else if (cur === MotionPlayLength(obj, obj.skel?.motion ?? 0) - 1) {
        obj.sub += 1;
      }
      break;
    }
    case 4:
      ChildLeave(obj, parent, null);
      return;
  }
  const W24 = obj.skel?.bones[KIND2_BONE]?.mat;
  if (W24) {
    MatrixGetTranslation(W24, obj.lookAt);
    MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index), obj.lookAt,
                         c.lookAtView);
  }
  Class2DChildDraw(obj, f);
  if (c.animate !== 0) StepCounter(obj);
  RegisterUnlessImmune(obj, f.host, KIND2_CAMERA_RISE);
}

/**
 * `[port-only]` -- `0x0042CFBC..0x0042D05D`, kinds 2 and 3's approach: one
 * `LerpWeighted(pos, +0x13C0, 1, +0x1334 - +0x1330)` step, and the distance
 * left, `|pos - +0x13C0|`.
 */
function ApproachStep(obj: EmperorActor, c: Class2DChildWords): number {
  Glide(obj, c, c.span - c.count);
  const dz = obj.pos.z - c.target.z;
  const dy = obj.pos.y - c.target.y;
  const dx = obj.pos.x - c.target.x;
  return Math.sqrt(dz * dz + dx * dx + dy * dy);
}

/** `CMP [ESI+0x19C], 0x12` -- bone 24 counts from cursor 18. */
const KIND2_SHOT_FROM = 0x12;
/** `PUSH 0x3E25A9` -- kind 2's hit. */
const SND_KIND2_HIT = 0x3e25a9;

/**
 * `Class2DChildKind2ResolveShot` — `FUN_0042D220`. In subs 2 and 3, a marked
 * shot, for each player: bone 24 from cursor `0x12` hurts the boss and
 * sounds `0x3E25A9`; bone 24 before it, or any other bone, sounds
 * `0x1116A9`; bone 0 nothing. Returns 1 when it hurt the boss. `[proved]`
 */
export function Class2DChildKind2ResolveShot(obj: EmperorActor,
                                             f: ClassFrame): number {
  const { parent } = Parts(obj);
  return ChildShotLoop(obj, 2, 3, (bone) => {
    if (bone === KIND2_BONE) {
      if (Cursor(obj) >= KIND2_SHOT_FROM) {
        HurtParent(parent);
        PlaySoundId(SND_KIND2_HIT, f.events);
        return true;
      }
      PlaySoundId(SND_CHILD_RICOCHET, f.events);
    } else if (bone !== 0) {
      PlaySoundId(SND_CHILD_RICOCHET, f.events);
    }
    return false;
  });
}

/** Kind 3: `b6boss4.bin` on `0x79`. */
const KIND3_TYPE = 0x51;
const KIND3_CLIP = 0x79;

/**
 * `Class2DChildKind3Init` — `FUN_0042D490`. The child's model (`0x51`,
 * `0x79`, `Class2DChildNodeDrawHook`, counter 0), then
 * `Class2DChildKind3Update(obj)` and its install. `[proved]`
 */
export function Class2DChildKind3Init(obj: EmperorActor, f: ClassFrame): void {
  ChildInitModel(obj, KIND3_TYPE, KIND3_CLIP, 0);
  Class2DChildKind3Update(obj, f);
  obj.class2d.routine = Class2DRoutine.ChildKind3Update;
}

/** `CMP EAX, 0x1E` -- the wait; cursor `0xD` of clip `0x79` holds it. */
const KIND3_WAIT = 0x1e;
const KIND3_HOLD_CURSOR = 0xd;
/** `FCOMP [0x0055D2AC]` -- 50.0. */
const KIND3_NEAR = 50.0;
/** `CMP EAX, 0x2C` -- the strike cursor. */
const KIND3_STRIKE_CURSOR = 0x2c;
/** `PUSH 8` -- kind 3's strike motion. */
const KIND3_STRIKE_MOTION = 8;
/** `PUSH 0x4D17A9` -- out; `PUSH 0x4E17A9` -- gone. */
const SND_KIND3_OUT = 0x4d17a9;
const SND_KIND3_GONE = 0x4e17a9;

/**
 * `Class2DChildKind3Update` — `FUN_0042D530`. Five subs (`0x0042D804`):
 *
 * * **0** -- on cue 3: `+0x1320 = +0x1324 = 1`, `+0x1330 = 0`, the permit,
 *   the enemy slot, `PlaySoundId(0x4D17A9)`, sub 1;
 * * **1** -- on clip `0x79` cursor `0xD` the counter stops; after thirty
 *   frames `+0x13C0` = the eye, `+0x1330 = 0`, `+0x1334 =
 *   g_class2d_child3_approach[rank]`, sub 2;
 * * **2** -- a shot on bone 2 ends it (sub 4); otherwise the approach step,
 *   and within 50 `+0x1320 = 1`, sub 3;
 * * **3** -- before cursor `0x2C` the shot; at `0x2C` the strike (`1, 8`)
 *   and the rank -3, sub 4; past it, at the clip's last frame, sub 4;
 * * **4** -- `PlaySoundId(0x4E17A9)` and the end.
 *
 * Every frame but the last: `Class2DChildDraw`, the counter if `+0x1320`,
 * and the tail with rise 15. `[proved]`
 */
export function Class2DChildKind3Update(obj: EmperorActor,
                                        f: ClassFrame): void {
  const { c, parent } = Parts(obj);
  G.g_cur_actor = obj.at;
  switch (s16(obj.sub)) {
    case 0:
      if (ParentCue(parent) !== Class2DCue.Go) break;
      c.animate = 1;
      c.shown = 1;
      c.count = 0;
      TakePermit(obj);
      RegisterEnemySlot(obj);
      PlaySoundId(SND_KIND3_OUT, f.events);
      obj.sub += 1;
      break;
    case 1: {
      if (obj.skel?.motion === KIND3_CLIP && Cursor(obj) === KIND3_HOLD_CURSOR) {
        c.animate = 0;
      }
      const n = c.count;
      c.count += 1;
      if (n > KIND3_WAIT) {
        c.target.x = G.g_camera_eye.x;
        c.target.y = G.g_camera_eye.y;
        c.target.z = G.g_camera_eye.z;
        c.count = 0;
        c.span = Class2DChild3Approach(ParentRank(parent));
        obj.sub += 1;
      }
      break;
    }
    case 2:
      if (Class2DChildKind3ResolveShot(obj, f) !== 0) {
        obj.sub = 4;
        break;
      }
      if (ApproachStep(obj, c) <= KIND3_NEAR) {
        c.animate = 1;
        obj.sub += 1;
      }
      break;
    case 3: {
      const cur = Cursor(obj);
      if (cur < KIND3_STRIKE_CURSOR) {
        if (Class2DChildKind3ResolveShot(obj, f) !== 0) obj.sub = 4;
      } else if (cur === KIND3_STRIKE_CURSOR) {
        Class2DStrikePlayers(STRIKE_LATCH, KIND3_STRIKE_MOTION, f.events);
        if (parent) Class2DAdjustRank(parent, RANK_ON_STRIKE);
        obj.sub += 1;
      } else if (cur === MotionPlayLength(obj, obj.skel?.motion ?? 0) - 1) {
        obj.sub += 1;
      }
      break;
    }
    case 4:
      ChildLeave(obj, parent, { id: SND_KIND3_GONE, events: f.events });
      return;
  }
  Class2DChildDraw(obj, f);
  if (c.animate !== 0) StepCounter(obj);
  RegisterUnlessImmune(obj, f.host, KIND13_CAMERA_RISE);
}

/** `PUSH 0x316A9` -- kind 3's hit. */
const SND_KIND3_HIT = 0x316a9;
/** `CMP EDI, 2` -- the bone that counts. */
const KIND3_BONE = 2;

/**
 * `Class2DChildKind3ResolveShot` — `FUN_0042D820`. In subs 2 and 3, a marked
 * shot, for each player: bone 2 hurts the boss and sounds `0x316A9`; any
 * other bone but 0 sounds `0x1116A9`. Returns 1 when it hurt the boss.
 * `[proved]`
 */
export function Class2DChildKind3ResolveShot(obj: EmperorActor,
                                             f: ClassFrame): number {
  const { parent } = Parts(obj);
  return ChildShotLoop(obj, 2, 3, (bone) => {
    if (bone === KIND3_BONE) {
      HurtParent(parent);
      PlaySoundId(SND_KIND3_HIT, f.events);
      return true;
    }
    if (bone !== 0) PlaySoundId(SND_CHILD_RICOCHET, f.events);
    return false;
  });
}

/**
 * `Class2DChildDraw` — `FUN_0042D930`, kinds 1, 2 and 3's draw:
 * `LightsUseCustomSet(1.0, camera block pitch/yaw, 1, 1, 1)`; the first
 * part's visible byte (`model+0x40`, record 0, `+1`) = `+0x1324 == 1`;
 * `DrawSkinnedModelAndShadow`; `LightsRestoreScene`. `[proved]`
 */
export function Class2DChildDraw(obj: EmperorActor, f: ClassFrame): void {
  const c = obj.class2d.child!;
  const light = Class2DCameraLight();
  if (obj.partVisible.length > 0) obj.partVisible[0] = c.shown === 1 ? 1 : 0;
  DrawSkinnedModelAndShadow(obj);
  RunChildHook(obj, c.kind === 2, light, f);
}

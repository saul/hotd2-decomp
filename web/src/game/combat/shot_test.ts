/**
 * The engine's shot test: who is a candidate, the sphere or the collision
 * mesh each is measured against, and the fork into the bones.
 *
 * ## How the engine does it
 *
 * ```c
 * // a class's own update, at its tail, every frame it wants to be shootable:
 * obj+0x70..0x78 = <a point, in view space>;
 * RegisterForShotTest(obj);            // 0x00405160
 *
 * // ProcessPlayerShots (0x00404570), a task of its own, once a frame:
 * for (player = 0; player < 2; player++) {
 *     g_coli_candidate_count = 0;  g_shot_hit_something[player] = 0;
 *     if (!fired[player]) continue;
 *     for (i = 0; i < g_shot_test_count; i++)
 *         (list[i].obj+0x34 & 0x10) ? ShotTestMesh(obj, player)
 *                                   : ShotTestSphere(obj, player);
 *     ShotTestWorld(player);
 *     if (g_coli_candidate_count > 0) { MarkActorShot(player); hit = 1; }
 * }
 * ColiPublishDynamicList();  g_shot_test_count = 0;
 * ```
 *
 * `ProcessPlayerShots` is a **task**, created by `0x00404480` from the scene's
 * task list (`0x00460751`), and a task runs in creation order. The two player
 * tasks come first, so the trigger has been read and `BuildShotRay` has run;
 * every actor is allocated after the scene list is built, so every actor runs
 * **after** it. The list it tests is therefore the one the actors registered
 * during the previous frame's walk, and the draw records it reads are the
 * ones that walk drew. `[proved]`: `0x00460710`..`0x00460751` create the
 * tasks in that order and `TaskRunTree` (`FUN_004A71A0`) walks them the same
 * way. The port keeps that order: `FireShotRequest` runs inside the player
 * task, and {@link ShotTestListReset} runs straight after it, before the
 * actors.
 *
 * ## Who registers
 *
 * `get_xrefs_to 0x00405160` returns 53 callers. A scan of the whole image for
 * `E8`/`E9` rel32 whose target is `0x00405160` finds **95**, and a byte search
 * for the address as an absolute pointer finds none, so those 95 are the whole
 * set. The 42 Ghidra does not list are in bytes it has not disassembled,
 * most of them past a `MatrixStackPop` it has marked no-return (`L35`), and
 * one of them is the one that matters most: `ActorRegisterCameraPoint`
 * (`FUN_00409B70`) ends `CALL MatrixStackPop / PUSH ESI / CALL 0x00405160` at
 * `0x00409BE7`..`0x00409BED`. Its seventeen call sites are the registration
 * of classes 0x10, 0x11, 0x14, 0x19, 0x2D and 0x32, and one of the routes of
 * 0x22, 0x23, 0x30 and 0x31.
 *
 * ## Which classes the port runs through here
 *
 * **Every class that registers is in the list**, because the list has a
 * second reader: `ColiPublishDynamicList` (`FUN_00405360`) copies it for the
 * crowd push, `ColiTestSphereAgainstActors` (`FUN_00405B10`), which can only
 * find what registered. So `ActorRegisterCameraPoint` files every caller, as
 * the engine's does.
 *
 * **The pick is the part that migrates, a class at a time**
 * ({@link ShotTestPickedHere}): a class that has set
 * {@link ClassHandler.registersForShotTest} is tested through
 * {@link G.g_shot_test_list} and nothing else, and every other class's entry
 * is passed over here because `render/characters.ts` still picks it the way
 * it did before this file existed. `docs/formats/combat.md`, "The shot test",
 * lists what moving each of them across would take.
 *
 * ## The two tests, and the one list they share
 *
 * An entry whose object carries `obj+0x34` bit `0x10` is tested against its
 * own collision mesh ({@link ShotTestMesh}) and every other against its sphere
 * ({@link ShotTestSphere}). Both push into the same candidate list and the
 * same depth sort decides between them, so a mesh nearer the eye than an
 * actor's sphere takes the shot, and one behind it does not.
 */
import { ActorFlag, type Actor } from "../actor";
import type { BreakableProp } from "../class41/prop_state";
import type { CharacterBone } from "../../bundle/characters";
import { ActorByAt, G } from "../globals";
import { g_class_handlers } from "../registry";
import type { GameHost, ShotRay } from "../host";
import {
  ColiSegmentVsMesh, ColiTraceSegmentInObjectSpace, type ColiHit,
  type ColiObject,
} from "../coli";
import {
  MatCopy, MatrixInvert, MatrixLoadIdentity, MatrixRotateX, MatrixRotateY,
  MatrixRotateZ, MatrixTransformPoint, MatrixTransformVector, type Mat,
} from "../matrix";
import { BoneHitRadius, CharacterTypeOf, T } from "../tables";
import { VecToAngles, type Vec3 } from "../vec";

/**
 * One entry of `g_shot_test_list` — `0x0059D8E8`, five dwords a stride:
 * `{obj, obj+0x34, obj+0x12C, obj+0x130, obj+0x134}`, written at
 * `0x004051E3`..`0x00405212`.
 *
 * The object and its flags word are what the shot test reads. The last three
 * are the **body** sphere's centre, which only the list's second reader wants:
 * `ColiPublishDynamicList` (`FUN_00405360`) copies the list for
 * `ColiTestSphereAgainstActors` (`FUN_00405B10`), the crowd push. They are
 * carried because they are the record, not because anything here reads them.
 */
export interface ShotTestEntry {
  /** The object, by the port's identity for it. */
  at: number;
  /** `obj+0x34` as it was when the object registered. */
  flags: number;
  /** `obj+0x12C/0x130/0x134` — {@link Actor.sphereCentre}. */
  x: number;
  y: number;
  z: number;
  /**
   * `[port-only]` A thrown weapon registered this entry, by its id in
   * `G.g_thrown_weapons`, and `at` is its thrower. The engine's entry holds
   * the object pointer whatever the object is; the port's weapons are a pool
   * of their own (`game/thrown_weapon.ts`), so the entry says which pool.
   */
  thrown?: number;
  /**
   * `[port-only]` A class-0x44 prop shot through its own mesh registered this
   * entry, by its id in `G.g_breakable_props`; `at` is its placer's address.
   * The engine's entry holds the object whatever pool the port keeps it in.
   * Only `RegisterForShotTest`'s bit-0x10 arm files one
   * (`PropRegisterForShotTestMesh`, `class41/shot_test.ts`); the prop pool's
   * spheres are still picked by `render/breakables.ts`. The moving-object
   * collision passes resolve it by this too (`coli.ts`).
   */
  prop?: number;
}

/**
 * `[0x004C436C]`, read as `00000000`: `0.0`. `RegisterForShotTest` compares
 * `obj+0x78` against it and `ShotTestBoneSphere` compares the bone's radius.
 */
const SHOT_TEST_ZERO = 0.0;

/**
 * `[0x004C43A4]`, read as `00002041`: `10.0`. Every candidate's sort key is
 * `__ftol(-z * 10.0)` — the view-space depth in tenths of a unit.
 */
export const SHOT_CANDIDATE_KEY_SCALE = 10.0;

/**
 * The flags word a bone's draw record carries at `+0x74`.
 *
 * `SkeletonWalkNode` (`FUN_004107E0`) writes `rec+0x74 = 0x21` for every node
 * as the skeleton is built. One `Init` raises `0x10` afterwards: `Boss4Init`
 * (`FUN_004917E0`, `0x00491956`) ORs `0x51` into the record of every bone its
 * descriptor gives a collision mesh, and writes that mesh to `rec+0x88` --
 * the port's {@link Actor.boneColi}. Those bones take `ShotTestBoneTree`'s
 * mesh arm; every other bone of every character takes the sphere arm.
 * `MarkActorShot` (`FUN_00404DB0`) ORs the shooter's bits into it and tests
 * `0x10` to decide whether to throw a world impact as well.
 */
export enum BoneRecordFlag {
  /** Test this bone as its collision mesh (`ShotTestBoneMesh`). */
  Mesh = 0x10,
  /** The candidate is a bone — the bit `MarkActorShot` forks on. */
  Bone = 0x20,
}
const BONE_RECORD_BUILT = 0x21;

/**
 * One entry of `g_coli_candidates` — `0x0059F4D0`, stride `0x3C` — in the
 * shape the port needs: which object, which bone, and whether it was hit
 * whole, with the sort key `g_coli_candidate_sort_keys` (`0x0059ECD8`) holds
 * beside it.
 */
export interface ShotCandidate {
  /** `__ftol(-z * 10.0)`, and only its low sixteen bits are ever sorted. */
  key: number;
  at: number;
  /** The node's `+0x14` for a bone; 0 for an object hit whole. */
  bone: number;
  /**
   * Hit whole: `ShotTestSphere`'s else arm, or a mesh object
   * ({@link ShotPushMeshObjectCandidate}). `MarkActorShot` records `1` in
   * `obj+0x190 + player` for it rather than a bone index.
   */
  whole: boolean;
  /** Where, in world space — the port's effects need the point. */
  point: Vec3;
  /** `[port-only]` The candidate is a thrown weapon, by id. See {@link ShotTestEntry.thrown}. */
  thrown?: number;
  /** `[port-only]` The candidate is a prop, by id. See {@link ShotTestEntry.prop}. */
  prop?: number;
  /**
   * A hit on a collision mesh -- a bone's ({@link ShotTestBoneMesh}) or an
   * object's ({@link ShotTestMesh}): the surface code and the face's normal
   * the segment test found, which {@link ShotPushColiHitCandidate} puts at
   * `+0x30` and `+0x18..0x20` with `+0x2C` bit `0x10`, and `MarkActorShot`
   * hands to the world impact. Absent for a sphere hit.
   */
  mesh?: { surface: number; normal: Vec3 };
  /**
   * The sphere's radius for a sphere candidate, whose {@link point} is its
   * centre: `obj+0x124` hit whole, `rec+0x78` for a bone. `MarkActorShot`
   * reads it back for GRENADE's blast. Absent for a collision-mesh hit.
   */
  radius?: number;
  /**
   * `[port-only]` The distance along the shot to {@link point}. The engine
   * has one list and needs no second measure; the port merges this list's
   * winner with the classes `render/` still picks the old way, and that pick
   * is ordered by distance along the ray.
   */
  t: number;
}

/**
 * The four numbers `BuildShotRay` (`FUN_00406110`) leaves in the shot record
 * for `RayTestSphere`: `+0x38 = sin(-pitch)`, `+0x3C = cos(-pitch)`,
 * `+0x40 = sin(-yaw)`, `+0x44 = cos(-yaw)`, the angles being `VecToAngles` of
 * the normalised crosshair vector in view space.
 */
export interface ShotRayAngles {
  sinPitch: number;
  cosPitch: number;
  sinYaw: number;
  cosYaw: number;
}

/** `9.587379924285257e-05`, BuildShotRay's BAMS-to-radians factor. */
const BAMS_TO_RADIANS = (Math.PI * 2) / 65536;

/** A value truncated to the `s16` `VecToAngles` stores. */
const s16 = (v: number): number => (Math.trunc(v) << 16) >> 16;

/**
 * The angle half of `BuildShotRay` (`FUN_00406110`): the view-space shot
 * direction as the four sines and cosines `RayTestSphere` reads.
 *
 * `[port-only]` as a function. The engine computes these once per trigger
 * pull into the shot record; the port's ray arrives in world space, so the
 * caller hands in its view-space direction and this does the rest in the
 * engine's order — `VecToAngles`, then `param_2 = -pitch`, `param_3 = -yaw`,
 * then `fsin`/`fcos` of each times `9.587379924285257e-05`.
 *
 * The order of `VecToAngles`' two outputs is settled by a case, not by the
 * decompiler's names: for a shot straight along `+x` only "first is pitch"
 * makes `RayTestSphere` measure the distance from the x axis.
 */
export function ShotRayAnglesFromView(dir: Vec3): ShotRayAngles {
  const { pitch, yaw } = VecToAngles(dir.x, dir.y, dir.z);
  const p = -s16(pitch) * BAMS_TO_RADIANS;
  const y = -s16(yaw) * BAMS_TO_RADIANS;
  return { sinPitch: Math.sin(p), cosPitch: Math.cos(p),
           sinYaw: Math.sin(y), cosYaw: Math.cos(y) };
}

/**
 * `RayTestSphere` — `FUN_004062A0`. Is a view-space point within `r` of the
 * shot's line?
 *
 * Transcribed operation for operation from `0x004062A0`..`0x0040630E`:
 *
 * ```
 * u = -(cx * cos(-yaw)) - cz * sin(-yaw)
 * v = cz * cos(-yaw) * sin(-pitch) - (cx * sin(-yaw) * sin(-pitch) + cy * cos(-pitch))
 * return sqrt(u*u + v*v) <= r ? 1 : -1       // FCOMP; TEST AH,0x41
 * ```
 *
 * It is the distance from a **line** through the eye, not a ray: nothing here
 * asks whether the point is in front. What keeps an object behind the camera
 * out is `RegisterForShotTest`'s own depth test. `TEST AH,0x41` is true for
 * "less", "equal" and "unordered", so a NaN distance counts as a hit, and
 * `!(d > r)` is that.
 */
export function RayTestSphere(a: ShotRayAngles, cx: number, cy: number,
                              cz: number, r: number): number {
  const u = -(cx * a.cosYaw) - cz * a.sinYaw;
  const v = cz * a.cosYaw * a.sinPitch
          - (cx * a.sinYaw * a.sinPitch + cy * a.cosPitch);
  return !(Math.sqrt(u * u + v * v) > r) ? 1 : -1;
}

/**
 * `__ftol(-z * 10.0)` — the sort key `ShotTestSphere`, `ShotTestBoneSphere`
 * and the world's candidate push (`0x00404D09`..`0x00404D1B`) all compute from
 * a candidate's view-space depth. `-z` is in front, so nearer is smaller.
 *
 * `[port-only]` as a function; the three sites inline it. `__ftol` truncates.
 */
export function ShotCandidateKey(z: number): number {
  return Math.trunc(-z * SHOT_CANDIDATE_KEY_SCALE) | 0;
}

/**
 * `ColiSortHitCandidatesByDistance` — `FUN_00405080`. The candidates,
 * nearest first.
 *
 * An LSD radix sort, two passes of eight bits over `key & 0xFFFF`: count into
 * 256 buckets, prefix-sum them, then place **from the last entry back**, which
 * is what makes each pass stable. So two candidates whose keys agree in their
 * low sixteen bits keep the order they were pushed in — the registration
 * order, and within one actor the bone tree's order — and a key beyond
 * 6553.5 units, or a negative one from a point behind the eye, wraps.
 * `MarkActorShot` then takes element 0.
 */
export function ColiSortHitCandidatesByDistance<C extends { key: number }>(
    candidates: readonly C[]): C[] {
  let src = candidates.slice();
  for (let shift = 0; shift < 16; shift += 8) {
    const count = new Array<number>(256).fill(0);
    for (const c of src) count[(c.key >>> shift) & 0xff]++;
    for (let i = 1; i < 256; i++) count[i] += count[i - 1];
    const out = new Array<C>(src.length);
    for (let i = src.length - 1; i >= 0; i--) {
      const b = (src[i].key >>> shift) & 0xff;
      out[--count[b]] = src[i];
    }
    src = out;
  }
  return src;
}

const _view = { x: 0, y: 0, z: 0 };

/**
 * `RegisterForShotTest` — `FUN_00405160`. Put this object in the frame's shot
 * test.
 *
 * ```
 * 00405165  MOV EAX,[EDI+0x34]; TEST AH,0x80; JNZ out     ; bit 0x8000: never
 * 00405171  MOV ECX,EAX; AND ECX,0x10; JNZ take            ; a mesh: always
 * 00405178  FLD [EDI+0x78]; FCOMP [0x004C436C]             ; view z against 0.0
 * 00405181  FNSTSW AX; TEST AH,0x41; JZ out                ; z > 0: behind, out
 *           ...bit 0x10: obj+0x150 = camera block * obj+0x150 ...
 * 004051D7  list[g_shot_test_count++] = {obj, obj+0x34, obj+0x12C..0x134}
 * ```
 *
 * The caller has already written the point: `obj+0x70..0x78` is not this
 * routine's to fill, and every caller writes it on the lines above the call.
 * The port holds that point in world space ({@link Actor.shotCentre}), so the
 * depth the engine reads out of `obj+0x78` is taken here, through the camera
 * the port's frame reads. `TEST AH,0x41` passes on "less", "equal" and
 * "unordered", so only a depth that is strictly positive is refused.
 *
 * `[port-only]` in one respect: with no camera to measure against — a
 * headless run — there is no depth to test, and the object is taken, as an
 * unordered comparison would take it. Nothing picks in a headless run.
 *
 * The mesh arm's matrix product is not transcribed, because the port has
 * nothing for it to undo. It is `Push; SetTop(g_camera_blocks[g_camera_index]
 * + 0x40); MatrixMultiply(obj+0x150); MatrixStore(obj+0x150); Pop`
 * (`0x00405190`..`0x004051CE`): the class's draw stored `obj+0x150` with the
 * view under it, and this multiplies the camera block's `+0x40` matrix in on
 * top, which `[likely]` takes the view back out -- {@link ShotTestMesh} and
 * the two collision passes trace **world** points through the result, which is
 * only meaningful if it does ({@link Actor.coliMatrix}). A class here stores
 * {@link Actor.coliMatrix} built on the identity instead of on the view, which
 * is the matrix that product leaves.
 */
export function RegisterForShotTest(obj: Actor, host: GameHost): void {
  const flags = obj.flags;
  if (flags & ActorFlag.NoShotTest) return;
  if (!(flags & ActorFlag.ShotTestMesh)) {
    if (host.viewSpaceOfPoint?.(obj.shotCentre, _view)
        && _view.z > SHOT_TEST_ZERO) {
      return;
    }
  }
  G.g_shot_test_list.push({
    at: obj.at, flags,
    x: obj.sphereCentre.x, y: obj.sphereCentre.y, z: obj.sphereCentre.z,
  });
}

/**
 * `[port-only]` Whether this pick, rather than `render/characters.ts`', tests
 * the object: a class that has moved across
 * ({@link ClassHandler.registersForShotTest}), or an actor that carries the
 * engine's own model block. Every registered object is in
 * {@link G.g_shot_test_list} either way -- the crowd push reads it too -- so
 * the migration boundary is here, at the pick, and not at the registration.
 * It goes when the last class moves across.
 */
export function ShotTestPickedHere(obj: Actor): boolean {
  return !!obj.skel || !!g_class_handlers[obj.cls]?.registersForShotTest;
}

/**
 * The end of `ProcessPlayerShots`' pass: `MOV [0x005A4C80], EBP` at
 * `0x0040461E` — nothing is registered any more until an update registers it
 * again.
 *
 * `[port-only]` as a function: one store in the engine. It runs where that
 * task runs, after the player tasks and before the actors — see the file
 * comment for why that position is the engine's.
 */
export function ShotTestListReset(): void {
  G.g_shot_test_list = [];
}

const _o = { x: 0, y: 0, z: 0 };
const _e = { x: 0, y: 0, z: 0 };
const _c = { x: 0, y: 0, z: 0 };
const _w = { x: 0, y: 0, z: 0 };

/**
 * `[port-only]` The half of `ProcessPlayerShots` (`FUN_00404570`) that walks
 * the list, and the sort `MarkActorShot` (`FUN_00404DB0`) opens with: every
 * registered object tested, the candidates sorted, the nearest returned.
 *
 * `0x004045A0`..`0x004045C9` is the loop:
 *
 * ```
 * 004045A9  TEST byte ptr [obj+0x34], 0x10    ; the object's LIVE word
 * 004045AD  JNZ -> 004045B6 CALL ShotTestMesh  ; a collision mesh
 * 004045AF  CALL ShotTestSphere                 ; everything else
 * ```
 *
 * The fork reads the object, not the word the entry recorded, so a bit
 * raised or dropped since registration counts. Of the classes whose pick is
 * here, one raises it: class 0x12, whose stage-1 door (`0x3D88`) carries
 * `0x10` in its record and files itself every frame until its strip starts
 * (`game/class12/`), so a shot at the boarded doorway stops on the boards;
 * and class 0x44's props with a blob, which the pool files here by
 * {@link ShotTestEntry.prop}: the story-mode switch, so a shot at a gate's
 * door kicks it open (`class44/story_switch.ts`), and the hinges and
 * selectors 6, 7, 12 and 13, so a shot at a door stops on it
 * (`class44/hinge.ts`). Selectors 0 and 3 raise it and are not filed yet --
 * see `docs/formats/combat.md`, "The shot test".
 *
 * What is not here is `ShotTestWorld` (`FUN_00404B80`). In the engine the
 * static collision's hits are candidates in the same list, which is what
 * lets a wall stop a bullet; the port still traces the world only when
 * nothing was picked. See `ShotHitWorld` in `combat/shot.ts`.
 *
 * The ray is taken into view space through the same camera the port's frame
 * reads — the one the last draw used, which is the one the click was
 * unprojected through — and every point is measured from the eye, where the
 * engine's line starts.
 */
export function ProcessPlayerShotsTestList(ray: ShotRay, host: GameHost):
    ShotCandidate | null {
  if (!G.g_shot_test_list.length) return null;
  const toView = host.viewSpaceOfPoint;
  if (!toView) return null;
  if (!toView(ray.origin, _o)) return null;
  _w.x = ray.origin.x + ray.dir.x;
  _w.y = ray.origin.y + ray.dir.y;
  _w.z = ray.origin.z + ray.dir.z;
  if (!toView(_w, _e)) return null;
  const dx = _e.x - _o.x, dy = _e.y - _o.y, dz = _e.z - _o.z;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0)) return null;
  const shot: ShotTest = {
    angles: ShotRayAnglesFromView({ x: dx / len, y: dy / len, z: dz / len }),
    eye: { x: _o.x, y: _o.y, z: _o.z },
    ray, host,
  };
  const out: ShotCandidate[] = [];
  for (const entry of G.g_shot_test_list) {
    if (entry.thrown !== undefined) {
      ShotTestSphereThrownWeapon(entry.thrown, shot, out);
      continue;
    }
    if (entry.prop !== undefined) {
      // The fork on the object's live word, as for an actor. A prop is filed
      // here only by the mesh arm, and the bit that sent it is never cleared
      // by the families that file; the sphere props are `render/`'s.
      const p = G.g_breakable_props.find((q) => q.id === entry.prop);
      if (p && (p.flags & ActorFlag.ShotTestMesh)) {
        ShotTestMesh(PropShotMeshObject(p), shot, out);
      }
      continue;
    }
    const obj = ActorByAt(entry.at);
    if (!obj) continue;
    if (!ShotTestPickedHere(obj)) continue;
    if (obj.flags & ActorFlag.ShotTestMesh) ShotTestMesh(obj, shot, out);
    else ShotTestSphere(obj, shot, out);
  }
  if (!out.length) return null;
  return ColiSortHitCandidatesByDistance(out)[0];
}

/** What one trigger pull's test carries from object to object. */
interface ShotTest {
  angles: ShotRayAngles;
  /** The eye in view space — the origin the engine's line runs through. */
  eye: Vec3;
  ray: ShotRay;
  host: GameHost;
}

/** Along the shot to a world point, for {@link ShotCandidate.t}. */
function alongShot(ray: ShotRay, p: Vec3): number {
  return (p.x - ray.origin.x) * ray.dir.x + (p.y - ray.origin.y) * ray.dir.y
       + (p.z - ray.origin.z) * ray.dir.z;
}

/**
 * `ShotTestSphere` — `FUN_00404630`. The sphere first, and then the fork.
 *
 * ```
 * 0040463A  RayTestSphere(player, obj+0x70, obj+0x74, obj+0x78, obj+0x124)
 * 00404656  TEST EAX,EAX; JLE out                         ; outside: nothing
 * 0040465E  TEST byte [obj+0x34],0x80; JZ whole           ; not per bone
 * 00404665  CMP word [g_character_skeletons[obj+0x1F4]+0x16],0; JLE whole
 * 0040467A  TEST AH,0x80; JNZ whole                       ; bit 0x8000
 * 0040467F  ShotTestSkeleton(obj, player); return
 * 0040468C  whole: key = __ftol(-obj+0x78 * 10.0); the object is one candidate
 * ```
 *
 * **The sphere at `obj+0x124` is the broad phase for every object this arm
 * takes**, per-bone or not: a shot that would clip a bone lying outside it
 * finds nothing, because the bone walk is never reached. Bit `0x80` is what
 * `SkeletonBuildAndPose` (`FUN_00410590`) raises for every actor whose
 * skeleton has nodes as its `Init` builds it; without it, or with `0x8000`,
 * the object is hit whole and `MarkActorShot` records bone byte 1.
 *
 * `obj+0x70..0x78` is {@link Actor.shotCentre} here, taken into view space
 * now; see {@link RegisterForShotTest} for why the port keeps it in world
 * space.
 */
function ShotTestSphere(obj: Actor, shot: ShotTest, out: ShotCandidate[]):
    void {
  if (!shot.host.viewSpaceOfPoint?.(obj.shotCentre, _c)) return;
  if (RayTestSphere(shot.angles, _c.x - shot.eye.x, _c.y - shot.eye.y,
                    _c.z - shot.eye.z, obj.hitRadius) <= 0) {
    return;
  }
  if ((obj.flags & ActorFlag.ShootPerBone) && SkeletonHasNodes(obj)
      && !(obj.flags & ActorFlag.NoShotTest)) {
    ShotTestSkeleton(obj, shot, out);
    return;
  }
  const p = obj.shotCentre;
  out.push({ key: ShotCandidateKey(_c.z), at: obj.at, bone: 0, whole: true,
             point: { x: p.x, y: p.y, z: p.z }, t: alongShot(shot.ray, p),
             radius: obj.hitRadius });
}

/**
 * `ShotTestSphere`'s whole-object arm (`0x0040468C`), for a thrown weapon.
 *
 * The weapon's `obj+0x34` is `0x80000001` and never gains bit `0x80`, so the
 * fork never goes to the skeleton: `RayTestSphere(player, obj+0x70, obj+0x74,
 * obj+0x78, obj+0x124)` and, on a hit, the whole weapon is one candidate keyed
 * on its depth. `obj+0x70..0x78` is the view point the weapon's own draw left,
 * which is the engine's arrangement exactly -- the draw that registered it is
 * the draw that wrote it. `[port-only]` as a separate function, because the
 * weapons are a pool of their own; see `game/thrown_weapon.ts`.
 */
function ShotTestSphereThrownWeapon(id: number, shot: ShotTest,
                                    out: ShotCandidate[]): void {
  const w = G.g_thrown_weapons.find((x) => x.id === id);
  if (!w) return;
  const c = w.view;
  if (RayTestSphere(shot.angles, c.x - shot.eye.x, c.y - shot.eye.y,
                    c.z - shot.eye.z, w.hitRadius) <= 0) {
    return;
  }
  const p = w.pos;
  out.push({ key: ShotCandidateKey(c.z), at: w.from, bone: 0, whole: true,
             point: { x: p.x, y: p.y, z: p.z }, t: alongShot(shot.ray, p),
             thrown: w.id, radius: w.hitRadius });
}

/**
 * `g_character_skeletons[obj+0x1F4]->+0x16 > 0` (`0x00404665`): the skeleton
 * has root nodes. The bundle's bones carry their parents, and a skeleton with
 * any bone has a root.
 */
function SkeletonHasNodes(obj: Actor): boolean {
  return (CharacterTypeOf(obj)?.bones ?? []).some((b) => b.parent === null);
}

/**
 * `ShotTestSkeleton` — `FUN_00404700`. Walk the character's skeleton from
 * each of its root nodes (`skel+0x18`, `skel+0x16` of them), in order.
 *
 * It also sets `g_cur_actor` to the object (`0x0040470F`), which is how the
 * tree walk below finds the draw records; the port passes the object.
 */
function ShotTestSkeleton(obj: Actor, shot: ShotTest, out: ShotCandidate[]):
    void {
  const bones = CharacterTypeOf(obj)?.bones ?? [];
  for (let i = 0; i < bones.length; i++) {
    if (bones[i].parent === null) ShotTestBoneTree(obj, bones, i, shot, out);
  }
}

/**
 * The draw record's `+0x00`, the slot the bone is drawing now.
 *
 * `RemoveBoneSubtree` (`FUN_00409AF0`) zeroes it for a severed bone and every
 * bone under it — the port lists all of them in {@link Actor.removed} — and
 * `ActorSwapDamagedPart` (`FUN_004098E0`) replaces it with a damaged part.
 */
function BoneDrawSlot(obj: Actor, b: CharacterBone): number {
  if (obj.removed.includes(b.bone)) return 0;
  return obj.boneSlot[b.bone] ?? b.slot;
}

/**
 * `ShotTestBoneTree` — `FUN_00404750`. One node, then its children.
 *
 * ```
 * 00404772  CMP [rec+0x00],0; JZ children      ; drawing nothing: no test
 * 00404777  TEST byte [rec+0x74],0x10; JNZ mesh
 * 0040477F  ShotTestBoneSphere(node, player)
 * 00404786  mesh: if (rec+0x88 != -1) ShotTestBoneMesh(node, player)
 * 00404799  children: for each of node+0x16, ShotTestBoneTree(child, player)
 * ```
 *
 * The children are walked **whether or not the node was tested**, which is
 * the order a candidate list's ties are broken in. A severed bone's children
 * are severed with it, so in practice a zero slot is a zero subtree.
 *
 * The bundle's bones are the exe's nodes in this same depth-first order, each
 * naming its parent by **index** into the list (`hod2lib/exetab.ts`,
 * `characterSkeleton`), so a node's children are the entries whose `parent`
 * is its own index, in list order.
 */
function ShotTestBoneTree(obj: Actor, bones: readonly CharacterBone[],
                          node: number, shot: ShotTest,
                          out: ShotCandidate[]): void {
  const b = bones[node];
  if (BoneDrawSlot(obj, b) !== 0) {
    const mesh = obj.boneColi[String(b.bone)];
    if (!(BoneRecordFlags(obj, b) & BoneRecordFlag.Mesh)) {
      ShotTestBoneSphere(obj, b, shot, out);
    } else if (mesh !== undefined) {
      // `CMP dword [rec+0x88], -1; JZ` -- a flagged record with no mesh
      // tests nothing. `Boss4Init` never makes one.
      ShotTestBoneMesh(obj, b, mesh, shot, out);
    }
  }
  for (let i = 0; i < bones.length; i++) {
    if (bones[i].parent === node) {
      ShotTestBoneTree(obj, bones, i, shot, out);
    }
  }
}

/**
 * `rec+0x74` for one bone: `0x21` as the skeleton builds it, `| 0x51` where
 * `Boss4Init` gave the bone a mesh. `[port-only]` as a function: the engine
 * reads the word; the port keeps the one fact that varies,
 * {@link Actor.boneColi}.
 */
function BoneRecordFlags(obj: Actor, b: CharacterBone): number {
  return obj.boneColi[String(b.bone)] !== undefined
    ? BONE_RECORD_BUILT | 0x51 : BONE_RECORD_BUILT;
}

/**
 * `[0x004C49C4]`, read as `00007a44`: `1000.0`. The shot segment's length,
 * which the routine at `0x00404AD0` multiplies the shot record's direction by.
 */
const SHOT_SEGMENT_LENGTH = 1000;

const _bm = new Array<number>(16).fill(0);
const _inv = new Array<number>(16).fill(0);
const _far = { x: 0, y: 0, z: 0 };
const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };
const _hit: ColiHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, surface: 0,
                        distSq: 0 };
const _rot: Mat = new Array<number>(16).fill(0);

/**
 * `ShotBuildSegment` — `FUN_00404AD0`. The shot, traced against the object's
 * own collision mesh.
 *
 * ```
 * 00404ADD  origin = shot record +0x18..0x20            ; 0x009A2CA0 + p*0x68
 * 00404AEC  far    = origin + (+0x24..0x2C) * [0x004C49C4]   ; 1000.0
 * 00404B3B  ColiTraceSegmentInObjectSpace(&far, &origin)
 * ```
 *
 * **The far end first**: `ColiSegmentVsMesh` (`FUN_004AAA40`) keeps the hit
 * nearest its second endpoint, so the quad nearest the eye wins, and a quad
 * is crossed only from its front -- the side the eye is on. The trace runs
 * through the inverse of `g_coli_dynamic_matrix` against
 * `g_coli_dynamic_blob`, which the caller has just set: here the object's
 * {@link Actor.coliMatrix} and {@link Actor.coliBlob}, which is what the port's
 * `ColiTraceSegmentInObjectSpace` reads in their place. It writes
 * `g_coli_hit_surface`, 0 for a miss, and the hit into `out`.
 *
 * The routine's other caller, {@link ShotTestBoneMesh}, traces the same
 * segment inline, because the matrix it sets is the host's posed bone, in the
 * matrix stack's own layout rather than {@link Actor.coliMatrix}'s.
 */
function ShotBuildSegment(obj: ColiObject, ray: ShotRay, out: ColiHit):
    void {
  const o = ray.origin, d = ray.dir;
  ColiTraceSegmentInObjectSpace(obj,
                                o.x + d.x * SHOT_SEGMENT_LENGTH,
                                o.y + d.y * SHOT_SEGMENT_LENGTH,
                                o.z + d.z * SHOT_SEGMENT_LENGTH,
                                o.x, o.y, o.z, out);
}

/**
 * What `ShotTestMesh` reads off a registered object: `obj+0x14C` and
 * `obj+0x150` ({@link ColiObject}), the three angle words `obj+0x64`,
 * `+0x68` and `+0x6C` it turns the normal by, and who it is. An `Actor` is
 * one as it stands; a prop is one through {@link PropShotMeshObject}.
 */
export interface ShotMeshObject extends ColiObject {
  /** The object, by its address -- a prop's placer's. */
  at: number;
  /** `obj+0x64`. */
  pitch: number;
  /** `obj+0x68`. */
  yaw: number;
  /** `obj+0x6C`. */
  roll: number;
  /**
   * `[port-only]` A prop, by id: which pool the candidate names. (Not
   * `prop`, which an `Actor` of class 0x24 carries as its tail.)
   */
  propId?: number;
}

/**
 * `[port-only]` A prop as {@link ShotMeshObject}: its `+0x14C`/`+0x150`
 * fields, and `obj+0x64..0x6C` out of {@link BreakableProp.words}, where every
 * family that keeps them names them `o64`, `o68` and `o6c` (the hinge's and
 * the story switch's swings). The prop's own `pitch`/`yaw`/`roll` are
 * `+0x1CC..0x1D4`, which `ShotTestMesh` does not read.
 */
export function PropShotMeshObject(p: BreakableProp): ShotMeshObject {
  return {
    coliBlob: p.coliBlob, coliMatrix: p.coliMatrix, at: p.at, propId: p.id,
    pitch: p.words.o64 ?? 0, yaw: p.words.o68 ?? 0, roll: p.words.o6c ?? 0,
  };
}

/**
 * `ShotTestMesh` — `FUN_00404A00`. One registered object against its own
 * collision mesh: `ProcessPlayerShots`' arm for an object whose `obj+0x34`
 * has bit `0x10` ({@link ActorFlag.ShotTestMesh}).
 *
 * ```
 * 00404A0F  g_coli_dynamic_matrix = obj+0x150       ; REP MOVSD, sixteen dwords
 * 00404A20  g_coli_dynamic_blob   = obj+0x14C
 * 00404A2C  ShotBuildSegment(player)
 * 00404A31  CMP g_coli_hit_surface, 0; JZ out       ; nothing crossed
 * 00404A41  Push; LoadIdentity; RotZ(obj+0x6C); RotY(obj+0x68); RotX(obj+0x64)
 * 00404A8F  normal = MatrixTransformPoint(normal); Pop
 * 00404AB9  ShotPushMeshObjectCandidate(obj)
 * ```
 *
 * `[proved]`, from the disassembly. No sphere, no radius and no registered
 * point: `obj+0x70..0x78` and `obj+0x124` are not read, and the object is a
 * candidate only where the shot crosses a quad of its mesh. A blob of `-1`
 * is refused inside the trace (`0x00404FDA`), which is
 * {@link Actor.coliBlob} `null`.
 *
 * **The normal is turned by the object's angles, not by its matrix**, and in
 * `Z`, `Y`, `X` order whatever order the class draws in -- class 0x12 draws
 * `RotX; RotZ; RotY`. It goes through `MatrixTransformPoint` on a matrix built
 * from the identity, so no translation reaches it, and it is not
 * renormalised. What reads it is `SpawnWorldImpact`, through the candidate.
 */
function ShotTestMesh(obj: ShotMeshObject, shot: ShotTest,
                      out: ShotCandidate[]): void {
  ShotBuildSegment(obj, shot.ray, _hit);
  if (G.g_coli_hit_surface === 0) return;
  MatrixLoadIdentity(_rot);
  MatrixRotateZ(_rot, obj.roll);
  MatrixRotateY(_rot, obj.yaw);
  MatrixRotateX(_rot, obj.pitch);
  const normal = { x: 0, y: 0, z: 0 };
  MatrixTransformPoint(_rot, { x: _hit.nx, y: _hit.ny, z: _hit.nz }, normal);
  ShotPushMeshObjectCandidate(obj, { x: _hit.x, y: _hit.y, z: _hit.z },
                              normal, _hit.surface, shot, out);
}

/**
 * `ShotPushMeshObjectCandidate` — `FUN_00404B50`. The mesh object's half of
 * the candidate record, and on into the push.
 *
 * ```
 * 00404B65  candidate[n]+0x2C = obj+0x34
 * 00404B6B  candidate[n]+0x24 = obj
 * 00404B71  candidate[n]+0x2C |= 0x40
 * 00404B78  JMP ShotPushColiHitCandidate           ; which ORs 0x10 in
 * ```
 *
 * So the record's flags are the object's own word with `0x50` raised, and
 * `MarkActorShot` (`FUN_00404DB0`) reads them as **the object, whole**:
 * bit `0x20` is clear (no `obj+0x34` of a mesh object carries it), and `0x10`
 * with `0x40` takes the whole-object arm -- `obj+0x34 |= shooter | 8`,
 * `obj+0x190 + p = 1` -- and then, for the `0x10`, `SpawnWorldImpact`
 * (`FUN_00405260`) at the quad. The object is at `+0x24`, where a bone
 * candidate keeps its node.
 */
function ShotPushMeshObjectCandidate(obj: ShotMeshObject, point: Vec3,
                                     normal: Vec3, surface: number,
                                     shot: ShotTest,
                                     out: ShotCandidate[]): void {
  ShotPushColiHitCandidate(obj.at, 0, true, point, normal, surface, shot,
                           out, obj.propId);
}

/**
 * `ShotPushColiHitCandidate` — `FUN_00404CB0`. A collision hit as a
 * candidate, keyed on its depth.
 *
 * ```
 * 00404CB4  Push; SetTop(g_camera_blocks[g_camera_index])   ; world to view
 * 00404D04  MatrixTransformPoint(g_coli_hit point)
 * 00404D09  key = __ftol(-z * 10.0)
 * 00404D45  +0x00..0x08 = the world point; +0x18..0x20 = g_coli_hit normal
 * 00404D87  +0x30 = g_coli_hit_surface; +0x2C |= 0x10; n++; Pop
 * ```
 *
 * The caller has written `+0x24..0x2C` -- which object, which node, which
 * flags -- and this completes the record. `+0x2C` bit `0x10` is
 * {@link ShotCandidate.mesh}: the candidate `MarkActorShot` throws a world
 * impact for. The port's view space is the host's camera, as for every other
 * candidate here.
 */
function ShotPushColiHitCandidate(at: number, bone: number, whole: boolean,
                                  point: Vec3, normal: Vec3, surface: number,
                                  shot: ShotTest, out: ShotCandidate[],
                                  prop?: number): void {
  if (!shot.host.viewSpaceOfPoint?.(point, _c)) return;
  out.push({ key: ShotCandidateKey(_c.z), at, bone, whole, point,
             mesh: { surface, normal }, t: alongShot(shot.ray, point),
             ...(prop !== undefined ? { prop } : {}) });
}

/**
 * `ShotTestBoneMesh` — `FUN_004048A0`. One bone's collision mesh.
 *
 * ```
 * 004048A6  Push; SetTop(g_camera_blocks[block]); Multiply(rec+0x28)     ; the bone, world
 * 004048F4  g_coli_dynamic_matrix = top; Pop; [0x005A4C88] = rec+0x88   ; the blob
 * 00404935  ShotBuildSegment(player)            ; the shot against the mesh, in its frame
 * 0040493A  [0x009CAC40] == 0: out              ; no surface: no hit
 * 0040494A  normal [0x009CAC64..6C] = g_coli_dynamic_matrix rotation * normal
 * 004049C2  candidate +0x24 = node, +0x28 = obj, +0x2C = rec+0x74 | 0x40
 * 004049E8  ShotPushColiHitCandidate()          ; key = __ftol(-view z * 10.0), point, normal,
 *                                               ; surface at +0x30, +0x2C |= 0x10
 * ```
 *
 * `g_coli_dynamic_matrix` is the bone's world matrix -- `GameHost.boneMatrix`,
 * the pose three.js last drew. The segment ({@link ShotBuildSegment}'s: the
 * crosshair's origin to a thousand units along it) goes through its inverse
 * into the bone's frame -- inline here, because the matrix is the host's and
 * in the stack's layout -- `ColiSegmentVsMesh` (`FUN_004AAA40`) finds the quad
 * nearest the eye by testing **from the far end back**, as the world trace
 * does, and the point comes back through the matrix and the normal through its
 * rotation (`MatrixTransformVector` at `0x00404982`, not renormalised).
 * {@link ShotPushColiHitCandidate} then keys it on the point's depth.
 */
function ShotTestBoneMesh(obj: Actor, node: CharacterBone, mesh: string,
                          shot: ShotTest, out: ShotCandidate[]): void {
  const blob = T.coli?.blobs?.[mesh];
  if (!blob || !shot.host.boneMatrix?.(obj.at, node.bone, _bm)) return;
  MatCopy(_inv, _bm);
  MatrixInvert(_inv);
  const o = shot.ray.origin, d = shot.ray.dir;
  _far.x = o.x + d.x * SHOT_SEGMENT_LENGTH;
  _far.y = o.y + d.y * SHOT_SEGMENT_LENGTH;
  _far.z = o.z + d.z * SHOT_SEGMENT_LENGTH;
  MatrixTransformPoint(_inv, _far, _a);
  MatrixTransformPoint(_inv, o, _b);
  if (!ColiSegmentVsMesh(blob, _a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _hit,
                         false)) {
    return;
  }
  if (_hit.surface === 0) return;
  const point = { x: 0, y: 0, z: 0 };
  const normal = { x: 0, y: 0, z: 0 };
  MatrixTransformPoint(_bm, _hit, point);
  MatrixTransformVector(_bm, { x: _hit.nx, y: _hit.ny, z: _hit.nz }, normal);
  // `+0x24 = node, +0x28 = obj, +0x2C = rec+0x74 | 0x40`: a bone, bit 0x20.
  ShotPushColiHitCandidate(obj.at, node.bone, false, point, normal,
                           _hit.surface, shot, out);
}

/**
 * `ShotTestBoneSphere` — `FUN_004047D0`. One bone's hit sphere.
 *
 * ```
 * 004047E6  FLD [rec+0x78]; FCOMP [0x004C436C]; TEST AH,0x40; JNZ out ; r == 0
 * 0040481F  RayTestSphere(player, rec+0x68, rec+0x6C, rec+0x70, r)
 * 0040482B  key = __ftol(-rec+0x70 * 10.0); push {rec+0x68.., node, obj, rec+0x74}
 * ```
 *
 * `rec+0x68..0x70` is the sphere's centre in view space, which
 * `SkeletonEmitNode` (`FUN_004114C0`) writes as it draws the bone — and only
 * while `obj+0x34` bit `0x8000` is clear (`0x00411682`..`0x004116C9`, past a
 * `MatrixStackPop` the decompiler stops at). The port asks the renderer for
 * the posed centre and the radius, and takes the centre into view space
 * here.
 */
function ShotTestBoneSphere(obj: Actor, node: CharacterBone, shot: ShotTest,
                            out: ShotCandidate[]): void {
  // An actor that carries the engine's model block has the record itself:
  // `rec+0x68` is what its own `SkeletonEmitNode` wrote this frame from
  // `Actor.boneCentre`, and `rec+0x78` is `Actor.boneRadius`: the build's
  // (the row's radius times the model's size, where the row's slot is the
  // node's), or what a routine has written over it since. See
  // `game/skeleton.ts` and `ActorBuildSkinnedModel` in `game/spawn.ts`.
  const rec = obj.skel?.bones[node.bone];
  if (rec) {
    _w.x = rec.hit[0]; _w.y = rec.hit[1]; _w.z = rec.hit[2];
  }
  const r = rec ? BoneHitRadius(obj, node)
    : shot.host.boneSphere?.(obj.at, node.bone, _w) ?? null;
  if (r === null || r === SHOT_TEST_ZERO) return;
  if (!shot.host.viewSpaceOfPoint?.(_w, _c)) return;
  if (RayTestSphere(shot.angles, _c.x - shot.eye.x, _c.y - shot.eye.y,
                    _c.z - shot.eye.z, r) <= 0) {
    return;
  }
  out.push({ key: ShotCandidateKey(_c.z), at: obj.at, bone: node.bone,
             whole: false, point: { x: _w.x, y: _w.y, z: _w.z },
             t: alongShot(shot.ray, _w), radius: r });
}

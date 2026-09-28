/**
 * The engine's shot test: who is a candidate, the sphere every candidate is
 * measured against first, and the fork into the bones.
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
 * Only those that say so, with {@link ClassHandler.registersForShotTest}: the
 * class calls {@link RegisterForShotTest} -- or `ActorRegisterCameraPoint`,
 * which calls it -- from its own update at the exe's call sites, and the pick
 * tests it through {@link G.g_shot_test_list} and nothing else. Every other
 * class is still picked by `render/characters.ts` the way it was before this
 * file existed. `docs/formats/combat.md`, "The shot test", lists what moving
 * each of them across would take.
 */
import { ActorFlag, type Actor } from "../actor";
import type { CharacterBone } from "../../bundle/characters";
import { ActorByAt, G } from "../globals";
import type { GameHost, ShotRay } from "../host";
import { ColiSegmentVsMesh, type ColiHit } from "../coli";
import {
  MatCopy, MatrixInvert, MatrixTransformPoint, MatrixTransformVector,
} from "../matrix";
import { BoneHitRadius, CharacterTypeOf, T } from "../tables";
import { g_class_handlers } from "../registry";
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
   * Hit as one sphere, `ShotTestSphere`'s else arm. `MarkActorShot` records
   * `1` in `obj+0x190 + player` for it rather than a bone index.
   */
  whole: boolean;
  /** Where, in world space — the port's effects need the point. */
  point: Vec3;
  /** `[port-only]` The candidate is a thrown weapon, by id. See {@link ShotTestEntry.thrown}. */
  thrown?: number;
  /**
   * A bone hit on its collision mesh (`ShotTestBoneMesh`): the surface code
   * and the face's normal the segment test found, which the candidate record
   * carries at `+0x30` and `+0x18..0x20` and `MarkActorShot` hands to the
   * world impact. Absent for a sphere hit.
   */
  mesh?: { surface: number; normal: Vec3 };
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
 * The mesh arm's matrix copy is not transcribed. It rebuilds `obj+0x150` for
 * `ShotTestMesh`, which no class that registers here reaches, and the port's
 * {@link Actor.coliMatrix} is already the world matrix it produces.
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
 * `0x004045A0`..`0x004045C9` is the loop. An object with `obj+0x34` bit `0x10`
 * goes to `ShotTestMesh` (`FUN_00404A00`), which the port has not got for an
 * actor: no class that registers here raises the bit, and the one family
 * that does — the story switch — is `class41/shot_test.ts`'s. The mesh arm is
 * therefore skipped, and says so rather than falling into the sphere.
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
    const obj = ActorByAt(entry.at);
    if (!obj) continue;
    if (obj.flags & ActorFlag.ShotTestMesh) continue;
    ShotTestSphere(obj, shot, out);
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
 * **The sphere at `obj+0x124` is the broad phase for every object**, per-bone
 * or not: a shot that would clip a bone lying outside it finds nothing,
 * because the bone walk is never reached. Bit `0x80` is what
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
             point: { x: p.x, y: p.y, z: p.z }, t: alongShot(shot.ray, p) });
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
             thrown: w.id });
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

/** `ShotBuildSegment` (`FUN_00404AD0`): the crosshair's line, this long. */
const SHOT_SEGMENT_LENGTH = 1000;

const _bm = new Array<number>(16).fill(0);
const _inv = new Array<number>(16).fill(0);
const _far = { x: 0, y: 0, z: 0 };
const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };
const _hit: ColiHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, surface: 0,
                        distSq: 0 };

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
 * the pose three.js last drew. The segment (`ShotBuildSegment`,
 * `FUN_00404AD0`: the crosshair's origin to a thousand units along it) goes
 * through its inverse into the bone's frame, `ColiSegmentVsMesh`
 * (`FUN_004AAA40`) finds the quad nearest the eye by testing **from the far
 * end back**, as the world trace does, and the point comes back through the
 * matrix and the normal through its rotation (`MatrixTransformVector` at
 * `0x00404982`, not renormalised). The key is taken from the point, as
 * `ShotPushColiHitCandidate` (`FUN_00404CB0`) takes it.
 */
function ShotTestBoneMesh(obj: Actor, node: CharacterBone, mesh: string,
                          shot: Pick<ShotTest, "ray" | "host">,
                          out: ShotCandidate[]): void {
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
  if (!shot.host.viewSpaceOfPoint?.(point, _c)) return;
  out.push({ key: ShotCandidateKey(_c.z), at: obj.at, bone: node.bone,
             whole: false, point, mesh: { surface: _hit.surface, normal },
             t: alongShot(shot.ray, point) });
}

/**
 * The mesh arm of `ShotTestBoneTree` (`FUN_00404750`) for the classes
 * `render/` still picks, nearest along the shot.
 *
 * `[port-only]` A class that registers for the shot test gets its bone meshes
 * tested in {@link ProcessPlayerShotsTestList}, through the same tree walk as
 * the engine's. One that does not is picked by `render/characters.ts`, which
 * tests bone spheres and passes a bone with a mesh by -- the mesh is the
 * game's data, and the renderer answers geometric questions rather than
 * running the engine's tests. So this runs `ShotTestBoneMesh` over every such
 * bone of every such actor, and `ResolveShot` merges the answer with the other
 * two the way it merges those. Class 0x30's weapon hands
 * (`EnemyZombieInitByCharType`, `FUN_00452FD0`) are the only bones it finds
 * in the shipped game. It goes when class 0x30 registers; see
 * `docs/formats/combat.md`, "What converting the rest takes".
 */
export function ShotTestPickedBoneMeshes(ray: ShotRay,
                                         host: GameHost): ShotCandidate | null {
  const out: ShotCandidate[] = [];
  const shot = { ray, host };
  for (const obj of G.g_object_list) {
    if (!obj.visible || obj.dead || obj.despawned) continue;
    if (g_class_handlers[obj.cls]?.registersForShotTest) continue;
    if (obj.flags & ActorFlag.NoShotTest) continue;
    const bones = CharacterTypeOf(obj)?.bones ?? [];
    for (const b of bones) {
      const mesh = obj.boneColi[String(b.bone)];
      if (mesh === undefined || BoneDrawSlot(obj, b) === 0) continue;
      ShotTestBoneMesh(obj, b, mesh, shot, out);
    }
  }
  let best: ShotCandidate | null = null;
  for (const c of out) if (c.t > 0 && (!best || c.t < best.t)) best = c;
  return best;
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
             t: alongShot(shot.ray, _w) });
}

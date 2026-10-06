/**
 * The game's own collision — `coli/`, not the drawn mesh.
 *
 * This is the level as the *engine* sees it: a few dozen blobs of quads with a
 * plane, a dominant axis and a material id each, loaded two files at a time
 * (`coli0.bin` for every scene plus `coli<scene+1>.bin`) and selected into two
 * active sets by the event script. Opcode `0x10` names the **full** set, which
 * both the segment and the sphere test consult; `0x11` names a **ray-only**
 * set — `[likely]` scenery that stops a bullet but not movement.
 *
 * It lives in `game/` rather than behind `GameHost` on purpose. The queries are
 * plain arithmetic over plain arrays, so nothing about them needs three.js, and
 * putting them here means the port answers its own collision questions
 * headlessly — the wall search, the ground height and the surface material all
 * work in `npm run test:port` with no renderer at all. An earlier pass answered
 * them off the *drawn* geometry through the host, which could only see the
 * resident region and had no material ids; that seam is gone.
 *
 * The whole of stage 2's collision is 785 quads. There is no spatial index and
 * none is warranted.
 */
import type { ColiBlob, ColiJson } from "../bundle";
import type { Actor, ActorRef } from "./actor";
import { ColiSortHitCandidatesByDistance } from "./combat/shot_test";
import { ActorByAt, G } from "./globals";
import {
  FtolS16, MatrixLoadIdentity, MatrixRotateX, MatrixRotateY,
  MatrixTransformPoint, MatrixTranslate, Vec3Normalize,
} from "./matrix";
import { T } from "./tables";
import { VecToAngles, type Vec3 } from "./vec";

/** Which of a quad's two in-plane components the dominant axis leaves. */
const PLANE_AXES: readonly (readonly [number, number])[] =
  [[1, 2], [0, 2], [0, 1]];

/** `ColiTraceSegmentAllSets`' answer, and the globals it leaves behind. */
export interface ColiHit {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  surface: number;
  /** Squared distance from the segment's start, which is how nearest is judged. */
  distSq: number;
}

const _hit: ColiHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, surface: 0,
                        distSq: 0 };

/** The blobs the script has selected into a set, resolved to their geometry. */
function blobsOf(keys: readonly string[]): ColiBlob[] {
  const all = T.coli?.blobs;
  if (!all) return [];
  const out: ColiBlob[] = [];
  for (const k of keys) {
    const b = all[k];
    if (b) out.push(b);
  }
  return out;
}

/**
 * One quad against one segment — the inner half of `ColiSegmentVsMesh`
 * (`FUN_004AAA40`).
 *
 * Three details that are easy to get almost right:
 *
 * * **The accepted sign combination is `d0 <= 0 && d1 > 0`** — the first point
 *   behind or on the plane and the second strictly in front. The mirror case
 *   is the *back-face* crossing, gated on `g_coli_allow_backface`
 *   (0x009CAC5C), which nothing in the program writes — so it never happens.
 *   Accepting "opposite signs" would make every quad two-sided.
 * * **The winding test wants all four cross products, times the dominant
 *   normal component, `>= 0`** — not merely to agree with each other. Folding
 *   `n[axis]` in is what makes it independent of the quad's winding.
 * * **Nearest is measured from the segment's *second* endpoint.** Every caller
 *   puts the actor there — `QueryGroundHeightAt` traces from `y - 1000` **up
 *   to** the actor — so that is what picks the ground nearest under your feet
 *   rather than the lowest floor in the level.
 */
function quadVsSegment(b: ColiBlob, i: number,
                       ax: number, ay: number, az: number,
                       bx: number, by: number, bz: number,
                       out: ColiHit): boolean {
  const p = i * 4;
  const nx = b.plane[p], ny = b.plane[p + 1], nz = b.plane[p + 2];
  const d = b.plane[p + 3];
  const d0 = nx * ax + ny * ay + nz * az + d;
  if (d0 > 0) return false;                    // back-facing: never accepted
  const d1 = nx * bx + ny * by + nz * bz + d;
  if (d1 <= 0) return false;
  // `P = (|d1|*P0 + |d0|*P1) / (|d0| + |d1|)`, which this is.
  const t = d0 / (d0 - d1);
  const hx = ax + (bx - ax) * t;
  const hy = ay + (by - ay) * t;
  const hz = az + (bz - az) * t;

  const axis = b.axis[i];
  const [u, v] = PLANE_AXES[axis] ?? PLANE_AXES[1];
  // The sign factor is the normal's dominant component -- **negated on Y**.
  //
  // Each edge term is the 3D `edge x (P - vertex)` dotted with the normal,
  // written in the two components the dominant axis leaves. Dropping to two
  // dimensions picks up the handedness of `u_hat x v_hat`, which is `+x` for
  // axis 0 and `+z` for axis 2 but **`-y`** for axis 1, because `x_hat x z_hat`
  // points down. One global polarity therefore cannot serve all three, and that
  // is exactly the shape of the bug this replaced: floors (axis 1) passed and
  // every wall in the game was rejected.
  const w = axis === 0 ? nx : axis === 1 ? -ny : nz;
  const q = i * 12;
  const hu = u === 0 ? hx : u === 1 ? hy : hz;
  const hv = v === 0 ? hx : v === 1 ? hy : hz;
  for (let k = 0; k < 4; k++) {
    const a0 = q + k * 3;
    const a1 = q + ((k + 1) & 3) * 3;
    const u0 = b.verts[a0 + u], v0 = b.verts[a0 + v];
    const u1 = b.verts[a1 + u], v1 = b.verts[a1 + v];
    // Every edge term must be non-negative, and the two cases that settle the
    // expression and the sign factor together are both in the data:
    // `coli2.bin:13864` quad 0 is a floor at y = 40.1 spanning x -776..-742,
    // z -1796..-1707 with stage 2's `17/5/1` standing on it at
    // (-742, 40.1, -1725), and `coli2.bin:15760` is the wall at x = -717.8 that
    // the same stage's spawn at (-741.3, 47.0, -823.6) leaps onto. Both come
    // out positive on all four edges; either sign factor on its own rejects
    // one of the two.
    if (((v1 - v0) * (u0 - hu) - (v0 - hv) * (u1 - u0)) * w < 0) return false;
  }

  out.x = hx; out.y = hy; out.z = hz;
  out.nx = nx; out.ny = ny; out.nz = nz;
  out.surface = b.surface[i];
  const dx = hx - bx, dy = hy - by, dz = hz - bz;
  out.distSq = dx * dx + dy * dy + dz * dz;
  return true;
}

/**
 * `ColiSegmentVsMesh` — `FUN_004AAA40`. One blob, nearest hit.
 *
 * The AABB reject comes first, and the box is stored **max then min**: reading
 * it the other way round gives an inverted box that rejects everything. The
 * exporter writes it back out as an honest `min`/`max` pair.
 */
export function ColiSegmentVsMesh(b: ColiBlob,
                       ax: number, ay: number, az: number,
                       bx: number, by: number, bz: number,
                       best: ColiHit, found: boolean): boolean {
  if (Math.min(ax, bx) > b.max[0] || b.min[0] > Math.max(ax, bx)) return found;
  if (Math.min(ay, by) > b.max[1] || b.min[1] > Math.max(ay, by)) return found;
  if (Math.min(az, bz) > b.max[2] || b.min[2] > Math.max(az, bz)) return found;

  for (let i = 0; i < b.n; i++) {
    if (!quadVsSegment(b, i, ax, ay, az, bx, by, bz, _hit)) continue;
    // The engine's "have I a hit yet" guard is the **surface id**, not a
    // boolean, so a quad whose surface is 0 reads as a miss *and* does not
    // occlude anything tested after it. Five quads in the corpus are like
    // that; they are effectively transparent.
    if (_hit.surface === 0) continue;
    if (found && _hit.distSq >= best.distSq) continue;
    best.x = _hit.x; best.y = _hit.y; best.z = _hit.z;
    best.nx = _hit.nx; best.ny = _hit.ny; best.nz = _hit.nz;
    best.surface = _hit.surface;
    best.distSq = _hit.distSq;
    found = true;
  }
  return found;
}

const _best: ColiHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, surface: 0,
                         distSq: 0 };
const _dyn: ColiHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, surface: 0,
                        distSq: 0 };

/**
 * The `obj+0x34` bits both moving-object passes demand — `0x10` and `0x40` —
 * and the two that refuse one, `0x80008000`. Tested at `0x00405853`..
 * `0x0040586B` in `ColiTestSphereAgainstFullSet` and the same way in
 * `ColiTraceSegmentAllSets`. Class 0x26 subtype 2 raises the first pair with
 * its `obj+0x34 |= 0x51`; class 0x33 selector 1 raises them too (`|= 0x50`)
 * but carries `0x80000000` from the same routine, so it never takes part.
 */
const DYNAMIC_COLI_NEED = 0x10 | 0x40;
const DYNAMIC_COLI_REFUSE = 0x80008000;

/**
 * The objects the moving-object passes test, in `g_coli_dynamic_list`'s
 * place.
 *
 * [diverges] The engine walks `g_coli_dynamic_list` (`0x005A3098`), which
 * {@link ColiPublishDynamicList} copies from what `RegisterForShotTest`
 * collected, at the end of `ProcessPlayerShots` -- a task that runs before
 * every actor -- so both of these passes see the objects that registered on
 * the **previous** frame, whichever actor asks. The port walks the pool and
 * takes the matrix each object holds now. An object with a blob does
 * register every frame it draws: its `0x10` bit sends `RegisterForShotTest`
 * past the depth test (`0x00405176`), through the matrix rebuild and on into
 * the append at `0x004051D7` `[proved]`. So the set is the same and the
 * difference is the frame: a moving object is met a frame ahead of where the
 * engine meets it. `ColiTestSphereAgainstActors` already walks the published
 * list; moving these two passes onto it needs every blob-carrying class to
 * register at its exe site, which class 0x26's boat does not yet.
 */
function ColiDynamicObjects(): Actor[] {
  const out: Actor[] = [];
  for (const o of G.g_object_list) {
    if (o.despawned || !o.coliBlob || !o.coliMatrix) continue;
    if (o.at === G.g_cur_actor) continue;
    if (o.flags & DYNAMIC_COLI_REFUSE) continue;
    if ((o.flags & DYNAMIC_COLI_NEED) !== DYNAMIC_COLI_NEED) continue;
    out.push(o);
  }
  return out;
}

/**
 * `MatrixStore(obj+0x150)` (`MatrixStore`, `FUN_004A8CA0`) for a draw that
 * builds its matrix on `game/matrix.ts`' stack top: the sixteen floats in the
 * stack's row-vector layout, into {@link Actor.coliMatrix}'s row-major 3x4.
 *
 * `[port-only]` as a function, and in the layout it converts to. The engine
 * stores the top as it stands and every reader takes it as it was stored; the
 * port's 3x4 is the transpose of the top's first three columns, so a point is
 * `R·p + t` either way.
 */
export function ColiStoreObjectMatrix(obj: ColiObject,
                                      top: ArrayLike<number>): void {
  const m = obj.coliMatrix ?? (obj.coliMatrix = new Array(12).fill(0));
  m[0] = top[0]; m[1] = top[4]; m[2] = top[8]; m[3] = top[12];
  m[4] = top[1]; m[5] = top[5]; m[6] = top[9]; m[7] = top[13];
  m[8] = top[2]; m[9] = top[6]; m[10] = top[10]; m[11] = top[14];
}

/**
 * What a moving-object pass reads off an object: `obj+0x14C` and `obj+0x150`.
 * An `Actor` is one, and so is a class-0x44 prop shot through its mesh
 * (`class41/prop_state.ts`); the engine's two are one 0x378-byte layout.
 */
export interface ColiObject {
  coliBlob: string | null;
  coliMatrix: number[] | null;
}

/**
 * `R^-1 (p - t)`: a world point into the object's space, through the
 * **general** inverse, as `MatrixInvert` (`FUN_004A8D20`) takes it -- not the
 * transpose, which is the inverse only of a rotation and a translation. The
 * story-mode switch's draw scales by the descriptor's `+0x14..0x1C` before
 * its `MatrixStore` -- (1.02, 1.04, 1) in stage 1, (0.8878, 0.8197, 1) and
 * (0.77, 0.7154, 1) in stage 2 -- and class 0x12's by its tail's scale when
 * that is not 1.0 (every shipped door with a blob has 1.0). A singular
 * matrix, which no shipped object stores, maps every point to `NaN`, where
 * the engine's maps it to its `3.4e38`s; both miss every quad.
 */
function ColiToObject(m: readonly number[], x: number, y: number, z: number,
                      out: { x: number; y: number; z: number }): void {
  const dx = x - m[3], dy = y - m[7], dz = z - m[11];
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  out.x = (A * dx + (c * h - b * i) * dy + (b * f - c * e) * dz) / det;
  out.y = (B * dx + (a * i - c * g) * dy + (c * d - a * f) * dz) / det;
  out.z = (C * dx + (b * g - a * h) * dy + (a * e - b * d) * dz) / det;
}

/** `R p + t` — `MatrixTransformPoint` (`FUN_004A8A80`). */
function ColiToWorldPoint(m: readonly number[], x: number, y: number,
                          z: number,
                          out: { x: number; y: number; z: number }): void {
  out.x = m[0] * x + m[1] * y + m[2] * z + m[3];
  out.y = m[4] * x + m[5] * y + m[6] * z + m[7];
  out.z = m[8] * x + m[9] * y + m[10] * z + m[11];
}

/** `R v` — `MatrixTransformVector` (`FUN_004A8AF0`), no translation. */
function ColiToWorldVector(m: readonly number[], x: number, y: number,
                           z: number,
                           out: { x: number; y: number; z: number }): void {
  out.x = m[0] * x + m[1] * y + m[2] * z;
  out.y = m[4] * x + m[5] * y + m[6] * z;
  out.z = m[8] * x + m[9] * y + m[10] * z;
}

const _oa = { x: 0, y: 0, z: 0 };
const _ob = { x: 0, y: 0, z: 0 };
const _w = { x: 0, y: 0, z: 0 };

/**
 * `ColiTraceSegmentInObjectSpace` — `FUN_00404F60`.
 *
 * Both endpoints through the inverse of `g_coli_dynamic_matrix`
 * (`MatrixStackSetTopFromArray`, `MatrixInvert(0)`, two
 * `MatrixTransformPoint`s), then `ColiSegmentVsMesh` on
 * `g_coli_dynamic_blob`, and on a hit the **point** goes back through the
 * matrix itself. `g_coli_hit_surface` is zeroed first and is the answer. The
 * decompilation stops at the `MatrixStackPop` before the trace (`L35`); the
 * trace and the transform back are at `0x00404FDA`..`0x00405074`.
 */
export function ColiTraceSegmentInObjectSpace(
    obj: ColiObject, ax: number, ay: number, az: number,
    bx: number, by: number, bz: number, out: ColiHit): boolean {
  G.g_coli_hit_surface = 0;
  const blob = obj.coliBlob ? T.coli?.blobs?.[obj.coliBlob] : undefined;
  const m = obj.coliMatrix;
  if (!blob || !m) return false;
  ColiToObject(m, ax, ay, az, _oa);
  ColiToObject(m, bx, by, bz, _ob);
  if (!ColiSegmentVsMesh(blob, _oa.x, _oa.y, _oa.z, _ob.x, _ob.y, _ob.z,
                         out, false)) {
    return false;
  }
  ColiToWorldPoint(m, out.x, out.y, out.z, _w);
  out.x = _w.x; out.y = _w.y; out.z = _w.z;
  G.g_coli_hit_surface = out.surface;
  return true;
}

/**
 * `ColiTraceSegmentVsObjectBlob` — `FUN_00405550`. One moving object's pass.
 *
 * Copies `obj+0x150` to `g_coli_dynamic_matrix` and `obj+0x14C` to
 * `g_coli_dynamic_blob`, runs {@link ColiTraceSegmentInObjectSpace}, and on a
 * hit turns the normal back into world space and pushes the hit as a
 * candidate with `ColiPushObjectHitCandidate` (`FUN_00405620`), measured from
 * the segment's **second** endpoint like every other candidate
 * (`0x0059D8D8`..`0x0059D8E0` are loaded from it at `0x004055F2`).
 *
 * **The normal goes through `MatrixTransformPoint`, not
 * `MatrixTransformVector`** — `CALL 0x004a8a80` at `0x004055C9`, where the
 * sphere pass uses `0x004a8af0` for the same job. So an object hit reports its
 * normal *plus the object's position*. Transcribed as read: the ground probes
 * this matters to read only the hit's height, and a reader of this normal gets
 * what the engine's gets.
 *
 * The blob test ranks by its distance in the **object's** space, which is the
 * world distance only for an object drawn without a scale -- every shipped
 * object in this pass; the scaled story-mode switch is a prop and never in
 * it (see {@link ColiDynamicObjects}, which walks actors).
 */
export function ColiTraceSegmentVsObjectBlob(
    obj: Actor, ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    best: ColiHit, found: boolean): boolean {
  if (!ColiTraceSegmentInObjectSpace(obj, ax, ay, az, bx, by, bz, _dyn)) {
    return found;
  }
  if (found && _dyn.distSq >= best.distSq) return found;
  ColiToWorldPoint(obj.coliMatrix!, _dyn.nx, _dyn.ny, _dyn.nz, _w);
  best.x = _dyn.x; best.y = _dyn.y; best.z = _dyn.z;
  best.nx = _w.x; best.ny = _w.y; best.nz = _w.z;
  best.surface = _dyn.surface;
  best.distSq = _dyn.distSq;
  return true;
}

/**
 * `ColiTraceSegmentAllSets` — `FUN_004053B0`.
 *
 * Both script-selected sets, **nearest to the second endpoint** wins, and a
 * hit in the first does not short-circuit the second. It writes
 * `g_coli_hit_surface`, `g_coli_hit_x/y/z` and the normal, which is how every
 * caller reads the answer: the return value only says whether there *was* one.
 *
 * **Three passes, and the first is over moving objects.** Every object in
 * the frame's registration list with a blob at `obj+0x14C` and `obj+0x34`
 * bits `0x10 | 0x40` is traced in its own space
 * ({@link ColiTraceSegmentVsObjectBlob}), and its hit competes with the two
 * static sets' on the same distance. That is what makes stage 3's boat a
 * floor. This said the port had no per-actor blobs and so nothing to put in
 * the pass, which was true, and it was the bug: a zombie that leapt onto the
 * boat found the canal under it.
 *
 * [diverges] The engine keys its nearest-of-all pass on `trunc(distance * 10)`
 * and radix-sorts **only the low sixteen bits**, so a hit beyond 6553.5 units
 * wraps and can win spuriously. This compares the distances directly; nothing
 * in the shipped data traces that far.
 *
 * Opcode `0x11` never appears in any shipped script, so the ray-only pass is
 * dead in practice — it is here because the opcode is real, not because
 * anything uses it.
 */
export function ColiTraceSegmentAllSets(ax: number, ay: number, az: number,
                                        bx: number, by: number, bz: number):
                                        boolean {
  G.g_coli_hit_surface = 0;
  let found = false;
  for (const o of ColiDynamicObjects()) {
    found = ColiTraceSegmentVsObjectBlob(o, ax, ay, az, bx, by, bz, _best,
                                         found);
  }
  for (const b of blobsOf(G.g_coli_full_set)) {
    found = ColiSegmentVsMesh(b, ax, ay, az, bx, by, bz, _best, found);
  }
  for (const b of blobsOf(G.g_coli_ray_set)) {
    found = ColiSegmentVsMesh(b, ax, ay, az, bx, by, bz, _best, found);
  }
  if (!found) return false;
  G.g_coli_hit_x = _best.x;
  G.g_coli_hit_y = _best.y;
  G.g_coli_hit_z = _best.z;
  G.g_coli_hit_normal = [_best.nx, _best.ny, _best.nz];
  G.g_coli_hit_surface = _best.surface;
  return true;
}

/** How far `QueryGroundHeightAt` and `QueryGroundSurfaceAt` reach down. */
const GROUND_PROBE = 1000;

/**
 * `QueryGroundHeightAt` — `FUN_00409D40`. A vertical segment from 1000 units
 * below the point up to it; the height of what it hit, or the script's own
 * ground plane when it hits nothing.
 */
export function QueryGroundHeightAt(x: number, y: number, z: number): number {
  return ColiTraceSegmentAllSets(x, y - GROUND_PROBE, z, x, y, z)
    ? G.g_coli_hit_y : G.g_camera_fixed_eye_y;
}

/**
 * `QueryGroundSurfaceAt` — `FUN_00409D80`. The same trace, reporting the
 * **material** rather than the height. 0 is a miss.
 */
export function QueryGroundSurfaceAt(x: number, y: number, z: number): number {
  ColiTraceSegmentAllSets(x, y - GROUND_PROBE, z, x, y, z);
  return G.g_coli_hit_surface;
}

/**
 * `ColiPublishDynamicList` — `FUN_00405360`. The frame's registrations become
 * the list the crowd push walks.
 *
 * `ProcessPlayerShots` (`FUN_00404570`) ends
 *
 * ```
 * 00404612  CALL 0x00405360                 ; this: g_shot_test_list -> g_coli_dynamic_list
 * 00404617  MOV  EDX, [0x005a4c80]           ; g_shot_test_count
 * 0040461E  MOV  [0x005a4c80], EBP           ; ...= 0
 * 00404626  MOV  [0x0059d8e4], EDX           ; g_coli_dynamic_count = the old count
 * ```
 *
 * and it is a task that runs before every actor, so for the whole of a frame's
 * actor walk `ColiTestSphereAgainstActors` tests what the actors registered
 * during the **previous** one: each object's `obj+0x12C..0x134` as its own
 * class had left it when it called `RegisterForShotTest` (`FUN_00405160`), not
 * where the object is now. `[proved]`
 *
 * The copy is five dwords an entry. The port's list carries its count as its
 * length, so the store at `0x00404626` is the copy's length, and a frame with
 * nothing registered publishes an empty list -- as the engine's loop, which
 * copies nothing, does with a count of zero.
 */
export function ColiPublishDynamicList(): void {
  G.g_coli_dynamic_list = G.g_shot_test_list.map((e) => ({ ...e }));
}

/**
 * What a hole in `G.g_coli_dynamic_list` names: `-1`, the port's
 * spelling of the null pointer {@link ColiDynamicListRemove} stores at the
 * entry's `+0x00` (`ActorRef`'s own convention).
 */
export const COLI_DYNAMIC_HOLE = -1;

/**
 * Which object a {@link ColiDynamicListRemove} looks for: the identity its
 * registration wrote into the entry -- an actor's `at` alone, or the `at` and
 * the id of a thrown weapon or a class-0x44 prop, the pools the port keeps
 * apart (`ShotTestEntry.thrown`, `ShotTestEntry.prop`). `[port-only]`: the
 * engine compares the object pointer, which is one word whatever the object.
 */
export interface ColiDynamicKey { at: number; thrown?: number; prop?: number }

/**
 * `ColiDynamicListRemove` — `FUN_00405220`. `ActorDespawn` (`FUN_00409CC0`)
 * calls it at `0x00409CD3`, straight after its `obj+0x34` write, to take the
 * object out of last frame's published list:
 *
 * ```
 * 00405220  MOV EDX, [0x0059d8e4]          ; g_coli_dynamic_count
 * 00405229  TEST EDX, EDX / JLE ret
 * 00405231  MOV ECX, 0x5a3098              ; the first entry's +0x00
 * 00405236  CMP ESI, [ECX] / JZ found      ; the object pointer
 * 0040523a  INC EAX / ADD ECX, 0x14 / CMP EAX, EDX / JL 00405236
 * 00405244  found: [entry + 0x04] = 0      ; the flags copy
 * 00405254         [entry + 0x00] = 0      ; the object
 * ```
 *
 * The **first** match only, and the count is left as it was, so the entry
 * stays in the list as a hole: the three passes that walk the list each test
 * `+0x00` for zero before anything else and step over it --
 * `ColiTraceSegmentAllSets` at `0x00405405`, `ColiTestSphereAgainstFullSet`
 * at `0x00405832` and {@link ColiTestSphereAgainstActors} at `0x00405B60`.
 * The sphere centre at `+0x08..0x10` is left where it was. `[proved]`
 *
 * What it guards is the pointer: `ActorKill` (`FUN_004A7040`), the next call
 * but one, puts the block on the free list, and an `ActorAlloc` later in the
 * same walk can hand it out again, so an entry left naming it would name
 * whatever is built there. The port's `at` is not reused that way, and a
 * despawned actor stays in the pool, flagged, until the next frame's prune --
 * so the hole is what keeps the rest of this frame's actors from reading the
 * despawned one back out of the list, as it is in the engine.
 */
export function ColiDynamicListRemove(obj: ColiDynamicKey): void {
  const list = G.g_coli_dynamic_list;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.at !== obj.at || e.thrown !== obj.thrown || e.prop !== obj.prop) {
      continue;
    }
    e.flags = 0;
    e.at = COLI_DYNAMIC_HOLE;
    delete e.thrown;
    delete e.prop;
    return;
  }
}

/**
 * One record of `g_coli_candidates` (`0x0059F4D0`, stride `0x3C`) and its
 * sort key, as far as {@link ColiSelectNearestHitCandidate} copies it out.
 * Which quantity sits in `distSq` and `depth` is each caller's own business --
 * see `ColiTestSphereAgainstActors`.
 */
export interface ColiCandidate {
  /** `g_coli_candidate_sort_keys` (`0x0059ECD8`): the radix sort's key. */
  key: number;
  /** `+0x00..0x08` → `g_coli_hit_x/y/z`. */
  x: number; y: number; z: number;
  /** `+0x18..0x20` → `g_coli_hit_normal_x/y/z`. */
  nx: number; ny: number; nz: number;
  /** `+0x24` → `g_coli_hit_object`, by spawn address; `-1` for none. */
  obj: ActorRef;
  /** `+0x30` → `g_coli_hit_surface`. */
  surface: number;
  /** `+0x34` → `g_coli_hit_dist_sq`. */
  distSq: number;
  /** `+0x38` → `g_coli_hit_depth`. */
  depth: number;
}

/**
 * `ColiSelectNearestHitCandidate` — `FUN_00405760`. Sort the candidates and
 * copy the first one out into the `g_coli_hit_*` globals.
 *
 * `ColiSortHitCandidatesByDistance` (`FUN_00405080`) is a stable radix sort
 * on the low sixteen bits of each key, so equal keys keep the order they were
 * pushed in, and the record at the head of its index list is copied, fifteen
 * dwords, into the ten globals below. `[proved]`
 */
export function ColiSelectNearestHitCandidate(
    candidates: readonly ColiCandidate[]): ColiCandidate {
  const c = ColiSortHitCandidatesByDistance(candidates)[0];
  G.g_coli_hit_x = c.x;
  G.g_coli_hit_y = c.y;
  G.g_coli_hit_z = c.z;
  G.g_coli_hit_normal = [c.nx, c.ny, c.nz];
  G.g_coli_hit_surface = c.surface;
  G.g_coli_hit_dist_sq = c.distSq;
  G.g_coli_hit_depth = c.depth;
  G.g_coli_hit_object = c.obj;
  return c;
}

/**
 * The `obj+0x34` bits that keep an object out of the crowd push:
 * `TEST EAX, 0x80008000` at `0x00405B77` and `TEST AL, 0x10` at `0x00405B82`
 * -- the second is {@link ActorFlag.ShotTestMesh} -- both on the object's
 * **live** flags, not the word the entry recorded. A literal, not the enum
 * member: this module is inside `actor.ts`'s import cycle, and a top-level
 * read of another module's export there is a page that does not start (L56).
 */
const ACTOR_PUSH_REFUSE = 0x80008000 | 0x10;
/**
 * `[0x004C43A4]`, `10.0`: a candidate's key is `__ftol(distance * 10.0)`,
 * centre to centre in tenths of a unit (`0x00405D59`..`0x00405D7B`).
 */
const ACTOR_PUSH_KEY_SCALE = 10.0;
/**
 * `MOV dword ptr [ESI + 0x59f500], 0x1` at `0x00405E01`: record `+0x30`,
 * which `ColiSelectNearestHitCandidate` hands to `g_coli_hit_surface`. An
 * actor has no material, and every hit this routine makes reads as one.
 */
const ACTOR_PUSH_SURFACE = 1;

const _m: number[] = new Array(16).fill(0);
const _v = { x: 0, y: 0, z: 0 };
const _pSelf = { x: 0, y: 0, z: 0 };
const _pOther = { x: 0, y: 0, z: 0 };
const _n = { x: 0, y: 0, z: 0 };

/** `x*x + y*y + z*z`, in the engine's order. `[port-only]` as a function. */
function sq3(x: number, y: number, z: number): number {
  return x * x + y * y + z * z;
}

/**
 * The point `radius` out from `(ox, oy, oz)` toward `(dx, dy, dz)`, the way
 * `ColiTestSphereAgainstActors` finds it twice over: `VecToAngles`
 * (`FUN_004016B0`) of the direction, truncated to BAMS as `__ftol` and the
 * `MOVSX` leave it, then `MatrixLoadIdentity`, `MatrixTranslate(o)`,
 * `MatrixRotateY(yaw)`, `MatrixRotateX(pitch)` and `MatrixTransformPoint` of
 * `(0, 0, radius)`. `[port-only]` as a function; the routine writes the
 * sequence out at `0x00405C1C` and again at `0x00405CBF`.
 */
function SphereSurfacePointToward(ox: number, oy: number, oz: number,
                                  dx: number, dy: number, dz: number,
                                  radius: number, out: Vec3): void {
  const a = VecToAngles(dx, dy, dz);
  MatrixLoadIdentity(_m);
  MatrixTranslate(_m, ox, oy, oz);
  MatrixRotateY(_m, FtolS16(a.yaw));
  MatrixRotateX(_m, FtolS16(a.pitch));
  _v.x = 0; _v.y = 0; _v.z = radius;
  MatrixTransformPoint(_m, _v, out);
}

/**
 * `ColiTestSphereAgainstActors` — `FUN_00405B10`. The actor-versus-actor test,
 * which every crowd in the game is separated by.
 *
 * **What it walks is last frame's registrations**, `g_coli_dynamic_list`
 * (`0x005A3098`), which {@link ColiPublishDynamicList} copies out of
 * `g_shot_test_list` before any actor runs. So an object is a candidate only
 * if its class called `RegisterForShotTest` (`FUN_00405160`) on the previous
 * frame -- in front of the eye, or a mesh, and without `obj+0x34` bit
 * `0x8000` -- and it is measured at the sphere centre that call recorded, not
 * at its position now. This walked the pool and re-derived every sphere from
 * where the actor stood, which tested actors behind the camera that never
 * register, tested every other object in the pool at a sphere made from its
 * position -- cut-scene figures that never register, and props whose classes
 * never write `obj+0x12C` and so register, `[likely]`, at the world origin
 * (a search for stores to `[reg + 0x12c]` finds classes 0x10, 0x30, 0x31 and
 * 0x33, the player block and one task, and misses the frog's, so it is a
 * floor rather than a census) -- and measured each pusher a frame ahead of
 * where the
 * engine measures it. `[proved]`: the list base at `0x00405B4F`, the count at
 * `0x00405B31`, and `ColiPublishDynamicList`'s only caller at `0x00404612`.
 *
 * Per entry, in order (`0x00405B5D`..`0x00405E6F`):
 *
 * * skipped if it is the caller (`g_cur_actor` at `0x00405B68` -- the port
 *   passes the caller), or if its **live** `obj+0x34` carries `0x80008000` or
 *   `0x10`;
 * * `obj+0x128`, if zero, is filled from `obj+0x124` and **stored back**
 *   (`0x00405BB7`), before the distance is known;
 * * a candidate if `|centre - entry| <= r + obj+0x128` -- `TEST AH, 0x41`,
 *   so a NaN distance is one too;
 * * then **two surface points**: this sphere's point toward the other and the
 *   other's toward this one ({@link SphereSurfacePointToward}), both past a
 *   `MatrixStackPop` Ghidra calls no-return, `0x00405CBF`..`0x00405E56`
 *   (`L35`). The record keeps this sphere's point as the hit, `other's point
 *   - this point` as the normal, `|centre - other's point|` in the slot
 *   `ColiSelectNearestHitCandidate` hands to `g_coli_hit_dist_sq`, and
 *   `|this point - other's point|` in the one it hands to `g_coli_hit_depth`;
 *   the key is `__ftol(distance * 10.0)`.
 *
 * Then the nearest -- by that key, stably, so a tie goes to the object that
 * registered first -- and the depth is re-derived from the two slots:
 *
 * ```
 * 00405E8A  FLD [g_coli_hit_depth]; FCOMP [obj+0x128]; TEST AH,0x41; JNZ
 * 00405E9D  depth = g_coli_hit_dist_sq + r        ; the gap is wider than R
 * 00405EA9  depth = r - g_coli_hit_dist_sq        ; otherwise
 * ```
 *
 * which is `r + R - d` whenever the two radii are equal and something else
 * when they are not -- transcribed as it stands. Then **a sum, not a length**:
 * `nz + ny + nx` of the unnormalised normal compared with `0.0`
 * (`0x00405EB9`..`0x00405ED6`), and exactly zero is a miss with nothing
 * written onto anybody. Otherwise `Vec3Normalize` (`FUN_004AAA00`), and the
 * **opposite** push goes onto the object found -- `obj+0x138` the caller,
 * `obj+0x13C` the depth, `obj+0x140..0x148` the reversed normal -- which it
 * applies on its own next update, so one test per actor separates a crowd.
 * `[proved]`
 *
 * A thrown weapon registers too, and never qualifies: both launchers write
 * `obj+0x34 = 0x80000001` (`THROWN_WEAPON_SPAWN_FLAGS`) and nothing clears bit
 * 31, which is `0x80008000`'s half. The port's weapons are not `Actor`s, so
 * their entries are passed over by that fact rather than by reading the flag.
 */
export function ColiTestSphereAgainstActors(self: Actor, cx: number, cy: number,
                                            cz: number, r: number): boolean {
  G.g_coli_hit_surface = 0;
  const candidates: ColiCandidate[] = [];
  for (const e of G.g_coli_dynamic_list) {
    // `MOV EBX, [ECX-8]; TEST EBX, EBX; JZ` at `0x00405B5D`: a hole
    // `ColiDynamicListRemove` left is passed over before anything is read.
    if (e.at === COLI_DYNAMIC_HOLE) continue;
    if (e.thrown !== undefined) continue;
    // A prop the port files is one shot through its mesh, filed by
    // `RegisterForShotTest`'s bit-0x10 arm, and bit `0x10` of its live
    // `obj+0x34` is half of what `TEST AL, 0x10` at `0x00405B82` refuses.
    // Its `at` is its placer's, which is in the pool under the same address,
    // so it is passed over by the entry and never looked up as an actor.
    if (e.prop !== undefined) continue;
    const o = ActorByAt(e.at);
    if (!o || o === self) continue;
    if (o.flags & ACTOR_PUSH_REFUSE) continue;
    // `[proved]`, and it is a **store**, not a local substitution:
    //
    //     00405b8a  FLD   float ptr [EBX + 0x128]
    //     00405bb1  MOV   EAX, dword ptr [EBX + 0x124]
    //     00405bb7  MOV   dword ptr [EBX + 0x128], EAX
    //
    // so the object keeps the filled-in radius and every later reader -- the
    // class's own push, the debug marker -- sees it too. `test/port/`'s
    // "engine fallback" assertion is on the field after the call.
    if (o.bodyRadius === 0) o.bodyRadius = o.radius;
    const dx = cx - e.x, dy = cy - e.y, dz = cz - e.z;
    const dist = Math.sqrt(sq3(dx, dy, dz));
    if (dist > r + o.bodyRadius) continue;
    // `entry - centre` subtracted afresh (`0x00405C1C`..`0x00405C42`), not
    // `-(centre - entry)`: on two coincident centres that is +0 where the
    // negation is -0, and `VecToAngles` turns -0 into half a turn.
    SphereSurfacePointToward(cx, cy, cz, e.x - cx, e.y - cy, e.z - cz, r,
                             _pSelf);
    SphereSurfacePointToward(e.x, e.y, e.z, dx, dy, dz, o.bodyRadius, _pOther);
    candidates.push({
      key: Math.trunc(dist * ACTOR_PUSH_KEY_SCALE) | 0,
      x: _pSelf.x, y: _pSelf.y, z: _pSelf.z,
      nx: _pOther.x - _pSelf.x, ny: _pOther.y - _pSelf.y,
      nz: _pOther.z - _pSelf.z,
      obj: o.at,
      surface: ACTOR_PUSH_SURFACE,
      // `0x00405DE1`..`0x00405E1B` and `0x00405E21`..`0x00405E51`: each the
      // square root of a sum of three squares, stored as a float.
      distSq: Math.sqrt(sq3(cx - _pOther.x, cy - _pOther.y, cz - _pOther.z)),
      depth: Math.sqrt(sq3(_pSelf.x - _pOther.x, _pSelf.y - _pOther.y,
                           _pSelf.z - _pOther.z)),
    });
  }
  if (!candidates.length) return false;
  ColiSelectNearestHitCandidate(candidates);
  const hit = ActorByAt(G.g_coli_hit_object)!;
  G.g_coli_hit_depth = G.g_coli_hit_depth <= hit.bodyRadius
    ? r - G.g_coli_hit_dist_sq
    : G.g_coli_hit_dist_sq + r;
  const [nx, ny, nz] = G.g_coli_hit_normal;
  if (nz + ny + nx === 0) return false;
  _n.x = nx; _n.y = ny; _n.z = nz;
  Vec3Normalize(_n, _n);
  G.g_coli_hit_normal = [_n.x, _n.y, _n.z];
  hit.pushedBy = self.at;
  hit.pushDepth = G.g_coli_hit_depth;
  hit.pushNormal.x = -_n.x;
  hit.pushNormal.y = -_n.y;
  hit.pushNormal.z = -_n.z;
  return true;
}

/**
 * `ColiTestSphereAgainstFullSet` — `FUN_004057F0`. The **full set only**, which
 * is the difference between the two sets: a bullet is stopped by scenery a body
 * walks through.
 *
 * **The test is sign-blind, and that is the whole of it.** `ColiSphereVsMesh`
 * (`FUN_004AAFF0`) compares `distance²` against `radius²` and never asks which
 * side of the quad the centre is on — `local_38 = fVar6² / |n|²`, with no test
 * on `fVar6`. What the sign decides is what the *caller* does with it:
 *
 * ```c
 * g_coli_hit_depth = fVar6;                              // signed, in the mesh test
 * ...
 * if (0.0 <= g_coli_hit_depth) g_coli_hit_depth = radius - sqrt(dist_sq);
 * else                         g_coli_hit_depth = sqrt(dist_sq) + radius;
 * ```
 *
 * So a body whose centre has gone **past** the surface is pushed `radius +
 * distance` — all the way back out — rather than not at all. This port
 * rejected that case outright (`if (d < 0) continue`), which is exactly a
 * thrower standing well inside a wall with nothing objecting: its origin was
 * outside, its sphere centre was not.
 *
 * **The direction does not change with the side, and that is the point.** In
 * the face case — the centre projects inside the quad — `ColiSphereVsMesh`
 * falls through to its store with `fVar1`, `param_5` and `local_48` still
 * holding `nx, ny, nz` as they were loaded at the top of the quad loop, so the
 * normal is the quad's own. (The `centre − closest` form the same three
 * variables carry is the *edge* branches', which this does not model.) So a
 * body that has got behind a wall is pushed `radius + distance` **along the
 * wall's outward normal** — back out the front and left exactly tangent —
 * rather than shoved further in. Reading the store without tracing which
 * branch reached it says the opposite, and the opposite drives it deeper.
 *
 * Nearest wins, not deepest: `ColiSphereVsMesh` keeps the candidate with the
 * smallest `dist²` and `ColiSelectNearestHitCandidate` does the same across
 * meshes. Those agree while every hit is in front and diverge the moment one
 * is behind, because then a *larger* distance is a *larger* depth.
 *
 * [diverges] The engine clamps to the nearest point on an *edge* when the
 * centre projects outside the quad and reports `centre - that point` as the
 * normal; this takes the face case alone, which is exact for a sphere resting
 * on a face and an approximation near an edge. It is also the one case that
 * still gets no push at all: a centre behind a wall whose projection has left
 * the quad.
 */
export function ColiTestSphereAgainstFullSet(cx: number, cy: number,
                                             cz: number, r: number): boolean {
  G.g_coli_hit_surface = 0;
  _sph.hit = false;
  _sph.distSq = Infinity;
  // The moving objects first, at `0x0040582A`: the centre goes into the
  // object's space through the inverse of `obj+0x150`, the blob is tested
  // there, and a hit comes back with its point through the matrix and its
  // normal through `MatrixTransformVector` (`FUN_004A8AF0`, `0x00405972`) —
  // the sphere pass rotates the normal properly, unlike the segment pass.
  for (const o of ColiDynamicObjects()) {
    const blob = T.coli?.blobs?.[o.coliBlob!];
    const m = o.coliMatrix!;
    if (!blob) continue;
    ColiToObject(m, cx, cy, cz, _oa);
    const before = _sph.distSq;
    ColiSphereVsBlob(blob, _oa.x, _oa.y, _oa.z, r, _sph);
    if (_sph.distSq < before) {
      ColiToWorldVector(m, _sph.nx, _sph.ny, _sph.nz, _w);
      _sph.nx = _w.x; _sph.ny = _w.y; _sph.nz = _w.z;
    }
  }
  for (const b of blobsOf(G.g_coli_full_set)) {
    ColiSphereVsBlob(b, cx, cy, cz, r, _sph);
  }
  if (!_sph.hit) return false;
  G.g_coli_hit_depth = _sph.depth;
  // Normalised as `ColiTestSphereAgainstFullSet` does before it returns.
  // Unsigned: the side is already in the depth.
  const l = Math.hypot(_sph.nx, _sph.ny, _sph.nz) || 1;
  G.g_coli_hit_normal = [_sph.nx / l, _sph.ny / l, _sph.nz / l];
  G.g_coli_hit_surface = _sph.surface;
  return true;
}

/** The nearest sphere hit so far, across every blob the query tests. */
interface SphereHit {
  hit: boolean;
  distSq: number;
  depth: number;
  nx: number; ny: number; nz: number;
  surface: number;
}
const _sph: SphereHit = { hit: false, distSq: Infinity, depth: 0,
                          nx: 0, ny: 0, nz: 0, surface: 0 };

/**
 * `ColiSphereVsMesh` (`FUN_004AAFF0`) — one blob, the nearest face hit, kept
 * in `acc` when it beats what is there. The face case only -- the divergence
 * declared on {@link ColiTestSphereAgainstFullSet}.
 */
function ColiSphereVsBlob(b: ColiBlob, cx: number, cy: number, cz: number,
                          r: number, acc: SphereHit): void {
  if (cx + r < b.min[0] || b.max[0] < cx - r) return;
  if (cy + r < b.min[1] || b.max[1] < cy - r) return;
  if (cz + r < b.min[2] || b.max[2] < cz - r) return;
  for (let i = 0; i < b.n; i++) {
    const p = i * 4;
    const nx = b.plane[p], ny = b.plane[p + 1], nz = b.plane[p + 2];
    // `fVar6`, the **signed** plane distance, unnormalised — the engine
    // divides by `|n|²` rather than assuming a unit normal.
    const s = nx * cx + ny * cy + nz * cz + b.plane[p + 3];
    const nl2 = nx * nx + ny * ny + nz * nz;
    if (nl2 === 0) continue;
    const distSq = (s * s) / nl2;
    if (distSq > r * r) continue;
    // ...and the centre must project inside the quad, or a sphere beside a
    // wall would be pushed by the plane the wall lies in.
    const [u, v] = PLANE_AXES[b.axis[i]] ?? PLANE_AXES[1];
    const q = i * 12;
    const cu = u === 0 ? cx : u === 1 ? cy : cz;
    const cv = v === 0 ? cx : v === 1 ? cy : cz;
    let sign = 0;
    let inside = true;
    for (let k = 0; k < 4 && inside; k++) {
      const a0 = q + k * 3, a1 = q + ((k + 1) & 3) * 3;
      const cross = (b.verts[a1 + u] - b.verts[a0 + u]) * (cv - b.verts[a0 + v])
                  - (b.verts[a1 + v] - b.verts[a0 + v]) * (cu - b.verts[a0 + u]);
      if (cross === 0) continue;
      const sg = cross > 0 ? 1 : -1;
      if (sign === 0) sign = sg;
      else if (sg !== sign) inside = false;
    }
    if (!inside) continue;
    if (distSq >= acc.distSq) continue;
    acc.distSq = distSq;
    acc.hit = true;
    const dist = Math.sqrt(distSq);
    // `radius - dist` in front of the surface, `radius + dist` behind it.
    acc.depth = s >= 0 ? r - dist : r + dist;
    // The quad's own normal. `ColiTestSphereAgainstFullSet` normalises it.
    acc.nx = nx; acc.ny = ny; acc.nz = nz;
    acc.surface = b.surface[i];
  }
}

/** Whether this bundle carries any collision at all. */
export function ColiLoaded(): boolean {
  return !!T.coli?.blobs && Object.keys(T.coli.blobs).length > 0;
}

/** `ColiLoadForScene` — the two files a scene loads, for the inspector. */
export function ColiFiles(): string[] {
  return T.coli?.files ?? [];
}

export type { ColiJson };

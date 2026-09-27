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
import { ActorUpdateBoundingSphere, type Actor } from "./actor";
import { G } from "./globals";
import { g_class_handlers } from "./registry";
import { T } from "./tables";

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
 * `[port-only]` as a *list*: the engine walks `g_coli_dynamic_list`
 * (`0x005A3098`), which `ColiPublishDynamicList` (`FUN_00405360`) copies from
 * what `RegisterForShotTest` collected, once a frame, from inside
 * `ProcessPlayerShots`' task. The port walks the pool, which holds the same
 * objects — an object with a blob registers every frame it draws, because its
 * `0x10` bit makes `RegisterForShotTest` take it whatever its depth — and
 * takes the matrix each one stored this frame or last. Which of the two a
 * given query sees in the engine depends on where in the task walk it runs,
 * and that ordering is `[open]`.
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

/** `R^T (p - t)`: a world point into the object's space. The matrix is rigid. */
function ColiToObject(m: readonly number[], x: number, y: number, z: number,
                      out: { x: number; y: number; z: number }): void {
  const dx = x - m[3], dy = y - m[7], dz = z - m[11];
  out.x = m[0] * dx + m[4] * dy + m[8] * dz;
  out.y = m[1] * dx + m[5] * dy + m[9] * dz;
  out.z = m[2] * dx + m[6] * dy + m[10] * dz;
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
    obj: Actor, ax: number, ay: number, az: number,
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
 * The object-space distance the blob test ranks by is the world distance,
 * because the matrix is a rotation and a translation and nothing else.
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
 * [open] The engine keys its nearest-of-all pass on `trunc(distance * 10)`
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
 * `[port-only]` `ClassHandler.ownsSphereCentre`, asked about one actor.
 */
function ColiActorOwnsSphere(o: Actor): boolean {
  const owns = g_class_handlers[o.cls]?.ownsSphereCentre;
  return typeof owns === "function" ? owns(o) : owns === true;
}

/**
 * `ColiTestSphereAgainstActors` — `FUN_00405B10`. The actor-versus-actor test.
 *
 * The engine walks `g_coli_dynamic_list` (`0x005A3098`, counted by
 * `g_coli_dynamic_count`, `0x0059D8E4`): what `RegisterForShotTest`
 * (`FUN_00405160`) collected during the **previous** frame's actor walk,
 * copied by `ColiPublishDynamicList` (`FUN_00405360`) at the end of
 * `ProcessPlayerShots`' task. Each entry is the object and **a copy of its
 * `obj+0x12C..0x134` taken when it registered** — the centre is read out of
 * the entry at `0x00405B96`..`0x00405BA3` — while the flags and the body
 * radius are read live off the object (`0x00405B74`, `0x00405B8A`).
 *
 * [diverges] The port walks `g_object_list`, because most classes do not
 * register yet: only a class with `ClassHandler.registersForShotTest` calls
 * `RegisterForShotTest` at its own sites, and walking the list today would
 * take every zombie out of the push. What that costs, all of it here:
 *
 * * **Membership.** The engine's list holds what registered last frame: not
 *   an actor whose `obj+0x78` put it behind the camera, not one with `0x8000`
 *   up as it registered, not a class that never registers, not one that has
 *   yet to run its first update. The pool holds every placed actor.
 * * **Timing.** The engine measures every candidate where it stood when it
 *   registered last frame; the port measures the sphere as it is now, which
 *   for an actor that has already run this frame is this frame's.
 * * **Whose sphere.** A class that has not set `ownsSphereCentre` is
 *   re-derived with `ActorUpdateBoundingSphere` (`FUN_00454AC0`) — class
 *   0x30's own writer, and a stand-in for every class whose writer is unread.
 *   One that has set it is measured at the point its routine wrote, and one of
 *   those that has not run yet is measured wherever its sphere is, where the
 *   engine would not have it at all.
 *
 * What clears it is the registration half of the shot-test conversion
 * (`docs/formats/combat.md`, "What converting the rest takes"): once every
 * class that registers does so at its site, this walks the list
 * `ShotTestListReset` publishes, and the three bullets go with it.
 *
 * Everything else is transcribed:
 *
 * * the caller itself is skipped, as are actors carrying `obj+0x34` bits
 *   `0x80008000` or `0x10`;
 * * a body radius of zero is lazily filled in from the shot radius at
 *   `obj+0x124`, which is the engine's own fallback for an actor whose class
 *   never set one;
 * * the overlap test is centre-to-centre against the **sum** of the radii, and
 *   the nearest of the candidates wins;
 * * and the hit is reported as a normal along the line between the centres,
 *   with the depth as the overlap.
 *
 * It also writes the **opposite** push onto the actor it found — `obj+0x138`
 * and the vector at `+0x140` — rather than moving it. That actor applies it on
 * its own next frame, so one test per actor separates a whole crowd.
 */
export function ColiTestSphereAgainstActors(self: Actor, cx: number, cy: number,
                                            cz: number, r: number): boolean {
  G.g_coli_hit_surface = 0;
  let best: Actor | null = null;
  let bestDist = Infinity;
  for (const o of G.g_object_list) {
    if (o === self || o.despawned || !o.visible) continue;
    if (o.flags & (0x80008000 | 0x10)) continue;
    // `if (obj+0x128 == 0) obj+0x128 = obj+0x124` -- the engine's own lazy
    // default, kept because it is what gives a class that never set a body
    // radius one at all.
    //
    // `[proved]`, and it is a **store**, not a local substitution:
    //
    //     00405b8a  FLD   float ptr [EBX + 0x128]
    //     00405bb1  MOV   EAX, dword ptr [EBX + 0x124]
    //     00405bb7  MOV   dword ptr [EBX + 0x128], EAX
    //
    // so the actor keeps the filled-in radius afterwards and every later
    // reader -- the class's own push, the debug marker -- sees it too. Writing
    // it back is the behaviour, not a shortcut; `port.test.ts`'s
    // "engine fallback" assertion is on the field after the call, for that
    // reason.
    if (o.bodyRadius === 0) o.bodyRadius = o.radius;
    // The engine reads the centre its list copied at registration; the port
    // reads the actor's own `obj+0x12C` -- as its class wrote it when the
    // class says so, and otherwise re-derived with class 0x30's formula. See
    // the divergence declared above.
    if (!ColiActorOwnsSphere(o)) ActorUpdateBoundingSphere(o);
    const dx = cx - o.sphereCentre.x;
    const dy = cy - o.sphereCentre.y;
    const dz = cz - o.sphereCentre.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > r + o.bodyRadius) continue;
    if (d >= bestDist) continue;
    bestDist = d;
    best = o;
  }
  if (!best) return false;

  const dx = cx - best.sphereCentre.x;
  const dy = cy - best.sphereCentre.y;
  const dz = cz - best.sphereCentre.z;
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return false;                    // exactly co-located: no way out
  const nx = dx / len, ny = dy / len, nz = dz / len;
  G.g_coli_hit_normal = [nx, ny, nz];
  G.g_coli_hit_depth = r + best.bodyRadius - len;
  G.g_coli_hit_x = best.sphereCentre.x;
  G.g_coli_hit_y = best.sphereCentre.y;
  G.g_coli_hit_z = best.sphereCentre.z;
  // The deferred half: the other actor is told which way it was pushed and by
  // how much, and moves itself next frame.
  best.pushedBy = self.at;
  best.pushDepth = G.g_coli_hit_depth;
  best.pushNormal.x = -nx;
  best.pushNormal.y = -ny;
  best.pushNormal.z = -nz;
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
 * the quad. `[open]`
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
 * in `acc` when it beats what is there. The face case only; see the
 * `[diverges]` on {@link ColiTestSphereAgainstFullSet}.
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

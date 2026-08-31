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

/**
 * `ColiTraceSegmentAllSets` — `FUN_004053B0`.
 *
 * Both script-selected sets, **nearest to the second endpoint** wins, and a
 * hit in the first does not short-circuit the second. It writes
 * `g_coli_hit_surface`, `g_coli_hit_x/y/z` and the normal, which is how every
 * caller reads the answer: the return value only says whether there *was* one.
 *
 * [diverges] The engine runs a **third** pass, first, over dynamic actors'
 * own collision blobs, each traced in that actor's object space. The port has
 * no per-actor blobs, so it has nothing to put in that pass.
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
 * `ColiTestSphereAgainstActors` — `FUN_00405B10`. The actor-versus-actor test.
 *
 * The engine walks a per-frame list of registered body spheres; the port walks
 * `g_object_list`, which is the same set — an actor is in that list exactly
 * while it is alive and placed. Everything else is transcribed:
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
    if (o.bodyRadius === 0) o.bodyRadius = o.radius;
    // The engine tests a list every actor registers into once a frame; the
    // port derives the sphere from the position instead, so an actor that has
    // not ticked yet is still measured where it actually is.
    ActorUpdateBoundingSphere(o);
    const dx = cx - o.camPoint.x;
    const dy = cy - o.camPoint.y;
    const dz = cz - o.camPoint.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > r + o.bodyRadius) continue;
    if (d >= bestDist) continue;
    bestDist = d;
    best = o;
  }
  if (!best) return false;

  const dx = cx - best.camPoint.x;
  const dy = cy - best.camPoint.y;
  const dz = cz - best.camPoint.z;
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return false;                    // exactly co-located: no way out
  const nx = dx / len, ny = dy / len, nz = dz / len;
  G.g_coli_hit_normal = [nx, ny, nz];
  G.g_coli_hit_depth = r + best.bodyRadius - len;
  G.g_coli_hit_x = best.camPoint.x;
  G.g_coli_hit_y = best.camPoint.y;
  G.g_coli_hit_z = best.camPoint.z;
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
 * The depth is `radius - sqrt(distance²)` — how far the sphere must move along
 * `g_coli_hit_normal` to be exactly tangent — and its callers apply **all** of
 * it. The `depth * 0.1` an earlier note here mentioned belongs to a different
 * hook: `ColiTestSphereAgainstActors`, the actor-versus-actor test, which also
 * pushes on X and Z only.
 *
 * [diverges] The engine clamps to the nearest point on an *edge* when the
 * centre projects outside the quad and reports `centre - that point` as the
 * normal; this takes the face case alone, which is exact for a sphere resting
 * on a face and an approximation near an edge.
 */
export function ColiTestSphereAgainstFullSet(cx: number, cy: number,
                                             cz: number, r: number): boolean {
  G.g_coli_hit_surface = 0;
  let best = -Infinity;
  let hit = false;
  for (const b of blobsOf(G.g_coli_full_set)) {
    if (cx + r < b.min[0] || b.max[0] < cx - r) continue;
    if (cy + r < b.min[1] || b.max[1] < cy - r) continue;
    if (cz + r < b.min[2] || b.max[2] < cz - r) continue;
    for (let i = 0; i < b.n; i++) {
      const p = i * 4;
      const nx = b.plane[p], ny = b.plane[p + 1], nz = b.plane[p + 2];
      const d = nx * cx + ny * cy + nz * cz + b.plane[p + 3];
      if (d < 0 || d >= r) continue;
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
        const s = cross > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (s !== sign) inside = false;
      }
      if (!inside) continue;
      const depth = r - d;
      if (depth <= best) continue;
      best = depth;
      hit = true;
      G.g_coli_hit_normal = [nx, ny, nz];
      G.g_coli_hit_surface = b.surface[i];
      G.g_coli_hit_depth = depth;
    }
  }
  return hit;
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

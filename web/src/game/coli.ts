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
 * Signed plane distances at both ends; a hit needs **opposite signs**, so a
 * segment that starts and ends on the same side of the plane cannot hit it.
 * The intersection is the distance-weighted blend of the endpoints, and the
 * point-in-quad test is four 2D cross products in the plane the dominant axis
 * drops.
 */
function quadVsSegment(b: ColiBlob, i: number,
                       ax: number, ay: number, az: number,
                       bx: number, by: number, bz: number,
                       out: ColiHit): boolean {
  const p = i * 4;
  const nx = b.plane[p], ny = b.plane[p + 1], nz = b.plane[p + 2];
  const d = b.plane[p + 3];
  const da = nx * ax + ny * ay + nz * az + d;
  const db = nx * bx + ny * by + nz * bz + d;
  if ((da > 0) === (db > 0)) return false;
  const t = da / (da - db);
  const hx = ax + (bx - ax) * t;
  const hy = ay + (by - ay) * t;
  const hz = az + (bz - az) * t;

  const [u, v] = PLANE_AXES[b.axis[i]] ?? PLANE_AXES[1];
  const q = i * 12;
  const hu = u === 0 ? hx : u === 1 ? hy : hz;
  const hv = v === 0 ? hx : v === 1 ? hy : hz;
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const a0 = q + k * 3;
    const a1 = q + ((k + 1) & 3) * 3;
    const u0 = b.verts[a0 + u], v0 = b.verts[a0 + v];
    const u1 = b.verts[a1 + u], v1 = b.verts[a1 + v];
    const cross = (u1 - u0) * (hv - v0) - (v1 - v0) * (hu - u0);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }

  out.x = hx; out.y = hy; out.z = hz;
  out.nx = nx; out.ny = ny; out.nz = nz;
  out.surface = b.surface[i];
  const dx = hx - ax, dy = hy - ay, dz = hz - az;
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
 * Both script-selected sets, nearest hit wins. Writes `g_coli_hit_surface`,
 * `g_coli_hit_x/y/z` and the normal, which is how every caller reads the
 * answer: the return value only says whether there *was* one.
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
 * `ColiTestSphereAgainstFullSet` — `FUN_004057F0`. The **full set only**, which
 * is the difference between the two sets: a bullet is stopped by scenery a body
 * walks through.
 *
 * [diverges] The engine's own test and its penetration depth are `[open]` —
 * this is a plane-distance test against each quad of each full-set blob, which
 * gives the same answer for a sphere resting on a face and an approximate one
 * near an edge. `g_coli_hit_depth` is how far inside the sphere's centre is,
 * which is what `ThrowerPushOutOfWorld` multiplies by 0.1.
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

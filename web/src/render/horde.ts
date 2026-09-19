/**
 * Class 0x40's asset-slot draws: the member's ground shadow, the emerge prop,
 * and the splash a member leaves when it dies. The member itself is a
 * skeleton and is `render/characters/horde.ts`'s.
 *
 * Each returns world-space matrices, one per `AssetDrawSlot` the routine
 * makes, as the product the engine's matrix stack holds at that call -- the
 * same flattening `render/owl.ts` does, and read by the same chain arm of
 * `render/slotmodels.ts`. Everything is read off the tail; nothing is decided
 * here that the routine did not leave there.
 */
import { Matrix4, Vector3, type BufferGeometry, type Mesh, type Object3D }
  from "three";
import { BAMS_TO_RAD } from "../core/bams";
import type { Actor } from "../game/actor";
import { G } from "../game/globals";
import {
  EmergePropState, HordeKind, type HordeTail,
} from "../game/class40/state";
import { EMERGE_PROP_RIM_POINTS } from "../game/class40/tables";
import { SpawnClass } from "../game/spawn_class";

/** One draw of a chain: a slot, the matrix it is drawn under, its alpha. */
export interface HordePart {
  slot: number;
  m: Matrix4;
  /** `AssetDrawSlotWithAlpha`'s second argument; 1 for a plain draw. */
  alpha: number;
  /**
   * The sheet: this part's geometry is its own copy, and
   * {@link deformHordeSheet} rewrites it.
   */
  deform?: boolean;
}

/** `komono_st1b.bin` 12, the prop. */
export const EMERGE_PROP_SLOT = 0x17cc;
/** `common.bin` 200, the member's shadow. */
export const HORDE_SHADOW_SLOT = 0x10d0;
/** `common.bin` 371 and 338..367: the ripple and the splash strip. */
export const HORDE_RIPPLE_SLOT = 0x1a38;
export const HORDE_SPLASH_SLOT = 0x15e4;
export const HORDE_SPLASH_FRAMES = 30;
/** `komono_room.bin` 2, stage 2 block 0x19's sheet. */
export const HORDE_SHEET_SLOT = 0x10cf;
/** `FILD frame; FMUL 136.53334` -- `0x4000 / 120`. */
const SPLASH_BAMS_PER_FRAME = 136.53334;
/** The prop's lift: drawn three units up its own y while it is flat or lifting. */
const PROP_LIFT_Y = 3.0;
/** The prop's second half: `MatrixScale(1, 1.25, 1)`. */
const PROP_HALF_STRETCH = 1.25;

const _r = new Matrix4();

function T(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeTranslation(x, y, z);
}
function RY(b: number): Matrix4 { return _r.clone().makeRotationY(b * BAMS_TO_RAD); }
function RX(b: number): Matrix4 { return _r.clone().makeRotationX(b * BAMS_TO_RAD); }
function RZ(b: number): Matrix4 { return _r.clone().makeRotationZ(b * BAMS_TO_RAD); }
function S(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeScale(x, y, z);
}

function tailOf(a: Actor): HordeTail | null {
  return a.cls === SpawnClass.HordeSpawner ? a.horde : null;
}

/**
 * The draws of one class-0x40 object this frame, or an empty list.
 *
 * * **A member's shadow** -- `HordeMemberUpdate` (`FUN_0043C440`), after the
 *   sub-model: `T(x, shadowY, z) Ry(yaw) T(0, 0, -1) S(4, 1, 8)`.
 * * **The emerge prop** -- `HordeEmergePropUpdate` (`FUN_0043DD00`), two
 *   halves of slot `0x17CC`. At rest, lifting or falling: `T(pos) Ry Rz Rx`,
 *   three up its own y while flat or lifting, one half, then `Ry(0x8000)
 *   S(1, 1.25, 1)` and the other. Settling on a corner: `T(pivot) Ry Rz Rx
 *   T(-corner) S(1, 1.25, 1)`, one half, `Ry(0x8000)`, the other -- **both**
 *   halves stretched, which is the routine's own order.
 * * **The splash** -- `HordeDeathSplashUpdate` (`FUN_0043E540`):
 *   `a = ftol(n * 136.533)`, the ripple at `S(cos a * s * 3, 1, cos a * s * 3)`
 *   and the strip frame `g_frame_counter % 30` at `sin a * s`; then
 *   `HordeDeathRippleFade` (`FUN_0043E650`), the ripple at `3 s` with alpha
 *   `(40 - m) * 0.025`.
 */
export function HordeDrawParts(a: Actor, out: HordePart[]): HordePart[] {
  out.length = 0;
  const t = tailOf(a);
  if (!t) return out;
  if (t.kind === HordeKind.Member && t.shadow) {
    const m = T(a.pos.x, t.shadowY, a.pos.z).multiply(RY(a.yaw))
      .multiply(T(0, 0, -1)).multiply(S(4, 1, 8));
    out.push({ slot: HORDE_SHADOW_SLOT, m, alpha: 1 });
  } else if (t.kind === HordeKind.EmergeProp) {
    if (t.propState === EmergePropState.Settle) {
      const [rx, ry] = EMERGE_PROP_RIM_POINTS[t.rimPoint] ?? [0, 0];
      const base = T(t.pivotX, t.pivotY, t.pivotZ).multiply(RY(t.propYaw))
        .multiply(RZ(t.propRoll)).multiply(RX(t.propPitch))
        .multiply(T(-rx, -ry, 0)).multiply(S(1, PROP_HALF_STRETCH, 1));
      out.push({ slot: EMERGE_PROP_SLOT, m: base.clone(), alpha: 1 });
      out.push({ slot: EMERGE_PROP_SLOT, m: base.multiply(RY(0x8000)),
                 alpha: 1 });
    } else {
      const base = T(t.propX, t.propY, t.propZ).multiply(RY(t.propYaw))
        .multiply(RZ(t.propRoll)).multiply(RX(t.propPitch));
      if (t.propState === EmergePropState.Wait
          || t.propState === EmergePropState.Lift) {
        base.multiply(T(0, PROP_LIFT_Y, 0));
      }
      out.push({ slot: EMERGE_PROP_SLOT, m: base.clone(), alpha: 1 });
      out.push({ slot: EMERGE_PROP_SLOT,
                 m: base.multiply(RY(0x8000))
                   .multiply(S(1, PROP_HALF_STRETCH, 1)), alpha: 1 });
    }
  } else if (t.kind === HordeKind.Splash) {
    const ang = Math.trunc(t.frame * SPLASH_BAMS_PER_FRAME) * BAMS_TO_RAD;
    const base = T(a.pos.x, a.pos.y, a.pos.z).multiply(RY(a.yaw));
    const c = Math.cos(ang) * t.size * 3.0;
    out.push({ slot: HORDE_RIPPLE_SLOT, m: base.clone().multiply(S(c, 1, c)),
               alpha: 1 });
    const k = Math.sin(ang) * t.size;
    out.push({ slot: HORDE_SPLASH_SLOT
                 + (Math.trunc(G.g_frame_counter) % HORDE_SPLASH_FRAMES),
               m: base.multiply(S(k, k, k)), alpha: 1 });
  } else if (t.kind === HordeKind.Sheet) {
    // `HordeDeformedPropUpdate`: `MatrixTranslate(+0x194)`, no rotation.
    out.push({ slot: HORDE_SHEET_SLOT, m: T(t.propX, t.propY, t.propZ),
               alpha: 1, deform: true });
  } else if (t.kind === HordeKind.Ripple) {
    const k = t.size * 3.0;
    const m = T(a.pos.x, a.pos.y, a.pos.z).multiply(RY(a.yaw))
      .multiply(S(k, 1, k));
    out.push({ slot: HORDE_RIPPLE_SLOT, m, alpha: (40 - t.fade) * 0.025 });
  }
  return out;
}

// -- the sheet ----------------------------------------------------------------

/** The reshape's constants, `HordeDeformedPropUpdate` (`FUN_0043F010`). */
const SHEET_REACH = 5.0;
const SHEET_ARC_BAMS = 3276.8;
const SHEET_LIFT = 1.2;
const SHEET_EDGE_X = -540.0;
const SHEET_EDGE_BIAS = 545.0;
const SHEET_FALLOFF = 0.2;
const SHEET_X_LIMIT = 11.5;
const SHEET_CORPSE_FRAMES = 60.0;
const SHEET_CORPSE_RATE = 0.016666668;
/** `obj+0x34 & 0x8000000` on a member: it is skipped. */
const MEMBER_LANDED = 0x8000000;
/** `obj+0x1310 == 6`. */
const MEMBER_DEAD = 6;
/** `VertexMapAverageFaceNormalsXZ4` weights x and z by this. */
const NORMAL_XZ_WEIGHT = 4.0;

/**
 * `HordeDeformedPropUpdate` (`FUN_0043F010`)'s reshape, on the sheet's own
 * copy of `komono_room.bin` 2, and then its two normal passes.
 *
 * For each vertex, in the model's own space (the sheet is drawn at `+0x194`
 * with no rotation): the members in `g_horde_members[0..2]`, in slot order,
 * each relative to the sheet; the first within five units in x and z sets
 *
 * ```
 * a = ftol((5 - d) * 3276.8)                    ; 0x4000 at the member
 * s = sin(a) * 1.2
 * if (dx < -540) s = (dx + 545) * s * 0.2       ; dx: member x - sheet x
 * s = max(s, 0)
 * y = min(1, (5 - |dz'|) * 0.2) * s             ; dz': vertex z - member dz
 * if (member x > 11.5) y *= 11.5 / obj+0x40     ; the sheet's own +0x40
 * if (member state == 6) y *= (60 - n) / 60     ; a corpse lets it down
 * ```
 *
 * and stops looking; a member that is present and not within five sets
 * `y = 0` and the search goes on; an empty slot or a landed member is
 * skipped, so with none of the three about the vertex keeps the y it had.
 * The copy lives on the node, so that last case keeps last frame's shape.
 *
 * Then the normals: each face's `normalize((v0 - v1) x (v1 - v2))`
 * (`VertexMapRebuildFaceNormals`, `FUN_0043F2E0`), and each vertex the sum of
 * its faces' with x and z weighted by four (`VertexMapAverageFaceNormalsXZ4`,
 * `FUN_0043F3E0`). A logical vertex is a position: every copy the engine's
 * vertex map lists sits at the same point, so grouping the glTF's vertices by
 * position is the same grouping. The engine's face records name their own
 * winding and the glTF's triangles theirs, so each normal is kept on the side
 * the model's own normal points to.
 */
export function deformHordeSheet(node: Object3D, a: Actor): void {
  const t = tailOf(a);
  if (!t || t.kind !== HordeKind.Sheet || !t.drawn) return;
  const members: Actor[] = [];
  for (let j = 0; j < 3; j += 1) {
    const at = G.g_horde_members[j] ?? 0;
    const m = at ? G.g_object_list.find((o) => o.at === at && !o.despawned)
      : undefined;
    members.push(m as Actor);
  }
  node.traverse((o) => {
    const mesh = o as Mesh;
    const geo = mesh.geometry as BufferGeometry | undefined;
    if (!geo?.attributes?.position) return;
    // Model space is the node's own; a mesh below it may carry a transform.
    const toModel = new Matrix4();
    for (let p: Object3D | null = mesh; p && p !== node; p = p.parent) {
      p.updateMatrix();
      toModel.premultiply(p.matrix);
    }
    const toMesh = toModel.clone().invert();
    const pos = geo.attributes.position;
    const v = new Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toModel);
      for (const m of members) {
        if (!m) continue;
        if (m.flags & MEMBER_LANDED) continue;
        const dx = m.pos.x - t.propX;
        const dzm = m.pos.z - t.propZ;
        const ez = v.z - dzm;
        const ex = v.x - dx;
        const d = Math.sqrt(ex * ex + ez * ez);
        if (!(d < SHEET_REACH)) {
          v.y = 0;
          continue;
        }
        const ang = Math.trunc((SHEET_REACH - d) * SHEET_ARC_BAMS);
        let s = Math.sin(ang * BAMS_TO_RAD) * SHEET_LIFT;
        if (dx < SHEET_EDGE_X) s = (dx + SHEET_EDGE_BIAS) * s * SHEET_FALLOFF;
        if (s < 0) s = 0;
        let f = (SHEET_REACH - Math.abs(ez)) * SHEET_FALLOFF;
        if (f > 1.0) f = 1.0;
        let y = f * s;
        if (m.pos.x > SHEET_X_LIMIT) y = (SHEET_X_LIMIT / a.pos.x) * y;
        const mt = tailOf(m);
        if (mt && mt.state === MEMBER_DEAD) {
          y = (SHEET_CORPSE_FRAMES - mt.counter) * y * SHEET_CORPSE_RATE;
        }
        v.y = y;
        break;
      }
      v.applyMatrix4(toMesh);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    rebuildSheetNormals(geo);
  });
}

/** The two normal passes; see {@link deformHordeSheet}. */
function rebuildSheetNormals(geo: BufferGeometry): void {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  if (!nrm) return;
  const index = geo.index;
  const tris = index ? index.count / 3 : pos.count / 3;
  const key = (i: number) =>
    `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const sums = new Map<string, Vector3>();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  for (let f = 0; f < tris; f += 1) {
    const i0 = index ? index.getX(f * 3) : f * 3;
    const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
    const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    // `Vec3Cross(v0 - v1, v1 - v2)`, normalized.
    n.crossVectors(a.clone().sub(b), b.clone().sub(c)).normalize();
    for (const i of [i0, i1, i2]) {
      const k = key(i);
      const sum = sums.get(k) ?? new Vector3();
      sum.add(n);
      sums.set(k, sum);
    }
  }
  const old = new Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    const sum = sums.get(key(i));
    if (!sum) continue;
    n.set(sum.x * NORMAL_XZ_WEIGHT, sum.y, sum.z * NORMAL_XZ_WEIGHT)
      .normalize();
    old.fromBufferAttribute(nrm, i);
    if (n.dot(old) < 0) n.negate();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  nrm.needsUpdate = true;
}

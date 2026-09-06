/**
 * glTF 2.0 writer for HOTD2 levels. The port of `tools/hod2lib/gltf.py`.
 *
 * Emits a `.glb`, or a `.gltf` + `.bin` + PNG set. The raw PowerVR2
 * render-state words are preserved verbatim in each material's `extras.pvr2`
 * so a target engine can implement exact behaviour rather than relying on the
 * approximate PBR mapping.
 *
 * glTF is right-handed, Y-up, -Z forward, which matches the NaomiLib
 * convention closely enough that positions pass through unchanged. UV V is
 * written as stored: the Blender addon flips it because Blender's UV origin is
 * bottom-left, and Blender's glTF importer applies that same flip on load, so
 * writing the raw value round-trips.
 */

import { BAMS_TO_RAD } from "./bams";
import { Writer, utf8 } from "./bytes";
import { CP_CHANNELS, OP_CHANNELS } from "./cam";
import type { CamFile, Path as CamPath } from "./cam";
import type { BundleSink, Deflate } from "./io";
import * as nl1 from "./nl1";
import type { Mesh, Model } from "./nl1";
import { encodeRgba } from "./png";
import { dumpsIndented, dumpsTight } from "./pyjson";
import type { PartModels, RigInstance, RigPart, Vec3 } from "./rigs";
import { pairKey } from "./stage";
import { bankDecode } from "./texbank";
import type { Bank } from "./texbank";

// glTF constants
const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const TRIANGLES = 4;
const LINE_STRIP = 3;

const NEAREST = 9728;
const LINEAR = 9729;
const REPEAT = 10497;
const CLAMP_TO_EDGE = 33071;
const MIRRORED_REPEAT = 33648;

type Doc = Record<string, unknown>;

class Buf {
  readonly w = new Writer(1 << 20);
  readonly views: Doc[] = [];
  readonly accessors: Doc[] = [];

  private align(n = 4): void {
    while (this.w.length % n) this.w.u8(0);
  }

  add(raw: Uint8Array, target: number | null = null): number {
    this.align();
    const off = this.w.length;
    this.w.bytes(raw);
    const v: Doc = { buffer: 0, byteOffset: off, byteLength: raw.length };
    if (target !== null) v.target = target;
    this.views.push(v);
    return this.views.length - 1;
  }

  get length(): number { return this.w.length; }

  vec3(vals: readonly (readonly number[])[]): number {
    const raw = new Writer(vals.length * 12 + 16);
    for (const v of vals) { raw.f32(v[0]); raw.f32(v[1]); raw.f32(v[2]); }
    const view = this.add(raw.view(), ARRAY_BUFFER);
    // Spelled as a loop rather than `Math.min(...xs)`: a strip may carry up to
    // 0x10000 vertices and a spread that wide overflows the argument stack.
    const lo = [0.0, 0.0, 0.0];
    const hi = [0.0, 0.0, 0.0];
    if (vals.length) {
      for (let k = 0; k < 3; k++) { lo[k] = vals[0][k]; hi[k] = vals[0][k]; }
      for (const v of vals) {
        for (let k = 0; k < 3; k++) {
          if (v[k] < lo[k]) lo[k] = v[k];
          if (v[k] > hi[k]) hi[k] = v[k];
        }
      }
    }
    this.accessors.push({
      bufferView: view, componentType: FLOAT, count: vals.length,
      type: "VEC3", min: lo, max: hi,
    });
    return this.accessors.length - 1;
  }

  vec2(vals: readonly (readonly number[])[]): number {
    const raw = new Writer(vals.length * 8 + 16);
    for (const v of vals) { raw.f32(v[0]); raw.f32(v[1]); }
    const view = this.add(raw.view(), ARRAY_BUFFER);
    this.accessors.push({
      bufferView: view, componentType: FLOAT, count: vals.length,
      type: "VEC2",
    });
    return this.accessors.length - 1;
  }

  vec4(vals: readonly (readonly number[])[]): number {
    const raw = new Writer(vals.length * 16 + 16);
    for (const v of vals) {
      raw.f32(v[0]); raw.f32(v[1]); raw.f32(v[2]); raw.f32(v[3]);
    }
    const view = this.add(raw.view(), ARRAY_BUFFER);
    this.accessors.push({
      bufferView: view, componentType: FLOAT, count: vals.length,
      type: "VEC4",
    });
    return this.accessors.length - 1;
  }

  scalarF32(vals: readonly number[]): number {
    const raw = new Writer(vals.length * 4 + 16);
    for (const v of vals) raw.f32(v);
    const view = this.add(raw.view());
    let lo = vals.length ? vals[0] : 0;
    let hi = lo;
    for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
    this.accessors.push({
      bufferView: view, componentType: FLOAT, count: vals.length,
      type: "SCALAR", min: [lo], max: [hi],
    });
    return this.accessors.length - 1;
  }

  indices(idx: readonly number[]): number {
    const raw = new Writer(idx.length * 4 + 16);
    for (const v of idx) raw.u32(v);
    const view = this.add(raw.view(), ELEMENT_ARRAY_BUFFER);
    // `min(idx)` over a few hundred thousand indices, without the spread: the
    // argument-count limit is a few tens of thousands and `Math.min(...idx)`
    // throws long before a stage's largest primitive is reached.
    let lo = 0;
    let hi = 0;
    if (idx.length) {
      lo = idx[0]; hi = idx[0];
      for (const v of idx) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    this.accessors.push({
      bufferView: view, componentType: UNSIGNED_INT, count: idx.length,
      type: "SCALAR", min: [lo], max: [hi],
    });
    return this.accessors.length - 1;
  }
}

/**
 * The game's projection, recovered from `SetupSceneProjection` (0x004184C0).
 *
 * `BuildPerspectiveProjection` takes the FULL vertical FOV in BAMS, halves it
 * through `__ftol` (so it truncates), and builds a left-handed D3D matrix with
 * `m11 = cot(half)`. There are exactly two call sites and both pass 0x1D3B, so
 * the FOV is a compile-time constant for the whole game -- there is no zoom
 * and no per-camera FOV.
 *
 *     0x1D3B = 7483 BAMS   half = (int)3741.5 = 3741
 *     yfov = 2 * 3741 * tau/65536 = 0.7173277659 rad = 41.100 deg
 */
export const CAM_FOV_BAMS = 0x1d3b;
export const CAM_YFOV =
  2.0 * Math.trunc(CAM_FOV_BAMS * 0.5) * BAMS_TO_RAD;
export const CAM_ASPECT = 4.0 / 3.0;
export const CAM_ZNEAR = 0.8;
export const CAM_ZFAR = 8000.0;

/** Kept as the old name so nothing silently reverts to the 60-degree guess. */
export const DEFAULT_YFOV = CAM_YFOV;

// `cam/` roll is stored as an integer and is read through `__ftol`, like every
// other angle in the game, so it is treated as BAMS. Only cp_st3 uses it at
// all, peaking at ~876 = 4.8 deg, which is a plausible camera tilt. The
// constant itself is `bams.ts`'s -- see the note there on why it is not
// `core/bams.ts`'s.

type V3 = [number, number, number];

function norm(v: V3): V3 {
  const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return n > 1e-9 ? [v[0] / n, v[1] / n, v[2] / n] : [0.0, 0.0, -1.0];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]];
}

/**
 * Rotation putting a glTF camera at *eye* looking at *target*.
 *
 * glTF cameras look down -Z with +Y up, so the camera's local Z axis is the
 * backward direction. Roll is applied about the view axis.
 */
function lookAtQuat(eye: V3, target: V3, rollBams = 0.0):
    [number, number, number, number] {
  const fwd = norm([target[0] - eye[0], target[1] - eye[1],
                    target[2] - eye[2]]);
  const zax: V3 = [-fwd[0], -fwd[1], -fwd[2]];
  let up: V3 = [0.0, 1.0, 0.0];
  if (Math.abs(fwd[1]) > 0.9999) up = [0.0, 0.0, 1.0];  // straight up/down
  let xax = norm(cross(up, zax));
  let yax = cross(zax, xax);

  if (rollBams) {
    const a = rollBams * BAMS_TO_RAD;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const xr: V3 = [xax[0] * c + yax[0] * s, xax[1] * c + yax[1] * s,
                    xax[2] * c + yax[2] * s];
    const yr: V3 = [yax[0] * c - xax[0] * s, yax[1] * c - xax[1] * s,
                    yax[2] * c - xax[2] * s];
    xax = xr;
    yax = yr;
  }

  // rotation matrix (columns are the basis vectors) -> quaternion
  const m00 = xax[0], m01 = yax[0], m02 = zax[0];
  const m10 = xax[1], m11 = yax[1], m12 = zax[1];
  const m20 = xax[2], m21 = yax[2], m22 = zax[2];
  const tr = m00 + m11 + m22;
  let w: number, x: number, y: number, z: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1.0) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const n = Math.sqrt(x * x + y * y + z * z + w * w) || 1.0;
  return [x / n, y / n, z / n, w / n];
}

/** Sample a `cam/` path on a fixed frame grid, always including the end. */
function samplePath(path: CamPath, channels: readonly string[],
                    step: number): [number, number[]][] {
  const curves = channels.map((c) => path.channels.get(c));
  if (curves.some((c) => c === undefined)) return [];
  const keys = curves[0]!.keys;
  if (keys.length < 2) {
    const t0 = keys.length ? keys[0].time : 0.0;
    return [[t0, curves.map((c) => c!.evaluate(t0))]];
  }
  const t0 = keys[0].time;
  const t1 = keys[keys.length - 1].time;
  const times: number[] = [];
  let t = t0;
  while (t < t1) { times.push(t); t += step; }
  times.push(t1);
  return times.map((tt) => [tt, curves.map((c) => c!.evaluate(tt))]);
}

/**
 * PVR2 clamp/flip -> D3D7 texture address, as `FUN_004A7780` does it.
 *
 * The game indexes a 4-entry table with `(clamp << 1) | flip`:
 *
 *     0 neither  -> D3DTADDRESS_WRAP
 *     1 flip     -> D3DTADDRESS_MIRROR
 *     2 clamp    -> D3DTADDRESS_CLAMP
 *     3 both     -> D3DTADDRESS_MIRROR      <- mirror wins, not clamp
 *
 * That last row is not what "clamp overrides everything" would predict, and it
 * is reachable: 157 mesh-axes set clamp+flip on U and 90 on V.
 */
function wrapMode(clampBit: boolean, flipBit: boolean): number {
  if (clampBit && flipBit) return MIRRORED_REPEAT;
  if (clampBit) return CLAMP_TO_EDGE;
  if (flipBit) return MIRRORED_REPEAT;
  return REPEAT;
}

/**
 * UV diagnostic texture: a checkerboard with per-axis colour bias.
 *
 * Red increases along u, blue along v, so a stretched or rotated face is
 * obvious at a glance.
 */
function checker(size = 128, cells = 8): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const step = Math.floor(size / cells);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dark = ((Math.floor(x / step) + Math.floor(y / step)) & 1) !== 0;
      const base = dark ? 60 : 200;
      const o = (y * size + x) * 4;
      px[o] = Math.min(255, base + Math.floor(x * 55 / size));
      px[o + 1] = base;
      px[o + 2] = Math.min(255, base + Math.floor(y * 55 / size));
      px[o + 3] = 255;
    }
  }
  // solid border lines each cell, to make shear visible too
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x % step === 0 || y % step === 0) {
        const o = (y * size + x) * 4;
        px[o] = px[o + 1] = px[o + 2] = 255;
      }
    }
  }
  return px;
}

/**
 * The engine's object rotation triple as a glTF quaternion `(x, y, z, w)`.
 *
 * The order is not a guess. Every object that follows an `op_` path is drawn
 * by the same chain: `MatrixTranslate(pos); MatrixRotateZ; MatrixRotateY;
 * MatrixRotateX`. The matrix stack is column-major and `MatrixMultiply`
 * computes `top = top * M`, i.e. exactly `glMultMatrix` -- so the composite is
 * `T * Rz * Ry * Rx` acting on column vectors, and **Rx is applied to the
 * vertex first**. In quaternion terms that is `qZ * qY * qX`.
 */
export function bamsEulerToQuat(rx: number, ry: number, rz: number):
    [number, number, number, number] {
  const hx = (rx * BAMS_TO_RAD) / 2;
  const hy = (ry * BAMS_TO_RAD) / 2;
  const hz = (rz * BAMS_TO_RAD) / 2;
  const cx = Math.cos(hx), sx = Math.sin(hx);
  const cy = Math.cos(hy), sy = Math.sin(hy);
  const cz = Math.cos(hz), sz = Math.sin(hz);
  // qZ * qY * qX
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

/**
 * How a frame is ordered, recorded so a target renderer can reproduce it
 * rather than guess. Proved from `RenderFlushCommandList` (0x004A88E0) and its
 * qsort comparator (0x004A8A20).
 */
export const DRAW_ORDER: Doc = {
  passes: ["opaque", "translucent"],
  opaque: "drawn at submission time by RenderEnqueueCommand, in submission "
    + "order -- not sorted",
  translucent: "drawn by RenderFlushCommandList after sorting the whole "
    + "command list",
  sort_key: "(draw_layer ASC, sort_depth DESC)",
  sort_comparator: "0x004A8A20: layer = flags & 0xF compared ascending; on a "
    + "tie, sort_depth compared descending, i.e. farthest first "
    + "(back-to-front painter's order)",
  sort_depth: "command +0x04: seeded from the world matrix _43 and refined to "
    + "the nearest mesh Z by the walker",
  within_a_command: "meshes are walked in chain (file) order; meshes "
    + "belonging to the other pass are skipped",
  pass_selector: "(tsp & 0x180000) == 0x80000 -> opaque; anything else is "
    + "translucent. NOT the list type.",
  default_draw_layer: 8,
  note: "glTF cannot express render order, so primitives are emitted "
    + "opaque-first then translucent, each in chain order, and every "
    + "primitive carries hod2_pass and hod2_chain_index in its extras.",
};

/** Per-primitive draw-order data, for a renderer that can honour it. */
function drawOrderExtras(mesh: Mesh, chainIndex: number): Doc {
  return {
    hod2_pass: mesh.opaquePass ? "opaque" : "translucent",
    hod2_chain_index: chainIndex,
  };
}

/**
 * Opaque primitives first, then translucent, each in chain order.
 *
 * A stable sort on the pass alone, so the engine's within-pass chain order
 * survives. This does not make a viewer correct -- glTF has no render-order
 * concept -- but it makes the order deterministic and equal to the engine's.
 */
function orderedPrims(prims: Doc[]): Doc[] {
  const key = (p: Doc) =>
    (p.extras as Doc).hod2_pass !== "opaque" ? 1 : 0;
  // `Array.prototype.sort` is stable in every engine this runs on, which is
  // what `sorted(key=...)` relies on here.
  return prims.slice().sort((a, b) => key(a) - key(b));
}

/**
 * `"%g"`, which is how Python spells a bias tag.
 *
 * Six significant digits, trailing zeros stripped, and an exponent only
 * outside `[1e-4, 1e6)`. Written out because a tag has to be stable across the
 * two implementations, and `toString` is not `%g`.
 */
function formatG(v: number): string {
  if (v === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(v)));
  if (exp < -4 || exp >= 6) {
    let s = v.toExponential(5);
    const [m, e] = s.split("e");
    const mm = m.includes(".") ? m.replace(/0+$/, "").replace(/\.$/, "") : m;
    const sign = e[0];
    const digits = e.slice(1).padStart(2, "0");
    return `${mm}e${sign}${digits}`;
  }
  const s = v.toPrecision(6);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** A short, filename-safe tag naming a pose bias. */
function biasTag(bias: readonly number[]): string {
  return bias.map((v) => formatG(v).replace(/-/g, "n").replace(/\./g, "p"))
    .join("_");
}

/**
 * Add camera/object paths to a glTF document under three parent nodes.
 *
 * Produces, per `cp_` path, a two-polyline mesh -- the eye rail and the
 * look-at rail -- plus an animated perspective camera; and per `op_` path a
 * rail polyline **and an animated node**. `op_` paths carry a BAMS Euler
 * triple rather than a look-at, and the triple's meaning and application order
 * come from the draw chain every path-following object shares.
 *
 * Returns the node indices to add to the scene.
 */
function emitPaths(camFiles: readonly CamFile[], buf: Buf, nodes: Doc[],
                   meshes: Doc[], materials: Doc[], cameras: Doc[],
                   animations: Doc[], fps = 60.0, step = 2.0,
                   objBiases: Map<string, number[][]> | null = null): number[] {
  const lineMaterial = (rgba: number[], mname: string): number => {
    for (let i = 0; i < materials.length; i++) {
      if (materials[i].name === mname) return i;
    }
    materials.push({
      name: mname,
      pbrMetallicRoughness: {
        baseColorFactor: [...rgba], metallicFactor: 0.0, roughnessFactor: 1.0,
      },
      emissiveFactor: rgba.slice(0, 3),
      doubleSided: true,
    });
    return materials.length - 1;
  };

  const polyline = (points: readonly number[][], material: number): Doc => ({
    attributes: { POSITION: buf.vec3(points) },
    indices: buf.indices([...points.keys()]),
    material,
    mode: LINE_STRIP,
  });

  const mEye = lineMaterial([0.15, 0.85, 1.0, 1.0], "hod2_cam_rail");
  const mAim = lineMaterial([1.0, 0.55, 0.1, 1.0], "hod2_cam_aim");
  const mObj = lineMaterial([0.3, 1.0, 0.35, 1.0], "hod2_object_rail");

  const railNodes: number[] = [];
  const camNodes: number[] = [];
  const objNodes: number[] = [];

  for (const cf of camFiles) {
    const stem = cf.name.endsWith(".bin") ? cf.name.slice(0, -4) : cf.name;

    if (cf.isObjectPath) {
      for (const path of cf.paths) {
        const samples = samplePath(path, OP_CHANNELS, step);
        if (samples.length < 2) continue;
        const times = samples.map(([t]) => t / fps);
        const pts = samples.map(([, v]) => [v[0], v[1], v[2]]);
        const quats = samples.map(([, v]) => bamsEulerToQuat(v[3], v[4], v[5]));
        const extras: Doc = {
          hod2_kind: "object_path", hod2_file: stem, hod2_path: path.index,
          hod2_duration_frames: path.duration,
        };

        const nm = `${stem}_${String(path.index).padStart(2, "0")}`;
        meshes.push({ name: nm + "_rail", primitives: [polyline(pts, mObj)] });
        nodes.push({ mesh: meshes.length - 1, name: nm + "_rail",
                     extras: { ...extras } });
        objNodes.push(nodes.length - 1);

        // the moving node: parent a model under this to watch it run
        nodes.push({
          name: nm + "_obj",
          translation: [...pts[0]], rotation: [...quats[0]],
          extras: { ...extras, hod2_kind: "object" },
        });
        const objNode = nodes.length - 1;
        objNodes.push(objNode);

        const tIn = buf.scalarF32(times);
        animations.push({
          name: nm,
          samplers: [
            { input: tIn, output: buf.vec3(pts), interpolation: "LINEAR" },
            { input: tIn, output: buf.vec4(quats), interpolation: "LINEAR" },
          ],
          channels: [
            { sampler: 0, target: { node: objNode, path: "translation" } },
            { sampler: 1, target: { node: objNode, path: "rotation" } },
          ],
        });

        // Some routines bias the path *position* before applying the pose
        // rotations: `Translate(p.x, p.y + 2.0, p.z); RotZ; RotY; RotX`. That
        // is T(p+b).R, which a child node with translation b cannot express --
        // it would give T(p).R.T(b). So each distinct bias gets its own anchor
        // with shifted samples.
        for (const bias of objBiases?.get(nm) ?? []) {
          const bpts = pts.map((p) =>
            [p[0] + bias[0], p[1] + bias[1], p[2] + bias[2]]);
          nodes.push({
            name: `${nm}_obj_b${biasTag(bias)}`,
            translation: [...bpts[0]], rotation: [...quats[0]],
            extras: { ...extras, hod2_kind: "object",
                      hod2_pose_bias: [...bias] },
          });
          const bnode = nodes.length - 1;
          objNodes.push(bnode);
          animations.push({
            name: `${nm}_b${biasTag(bias)}`,
            samplers: [
              { input: tIn, output: buf.vec3(bpts), interpolation: "LINEAR" },
              { input: tIn, output: buf.vec4(quats), interpolation: "LINEAR" },
            ],
            channels: [
              { sampler: 0, target: { node: bnode, path: "translation" } },
              { sampler: 1, target: { node: bnode, path: "rotation" } },
            ],
          });
        }
      }
      continue;
    }

    for (const path of cf.paths) {
      const samples = samplePath(path, CP_CHANNELS, step);
      if (samples.length < 2) continue;
      const eyes = samples.map(([, v]) => [v[0], v[1], v[2]]);
      const aims = samples.map(([, v]) => [v[3], v[4], v[5]]);
      const times = samples.map(([t]) => t / fps);
      const quats = samples.map(([, v], i) =>
        lookAtQuat(eyes[i] as V3, aims[i] as V3, v[6]));

      const nm = `${stem}_${String(path.index).padStart(2, "0")}`;

      // visible rail: eye polyline + aim polyline in one mesh
      meshes.push({
        name: nm + "_rail",
        primitives: [polyline(eyes, mEye), polyline(aims, mAim)],
      });
      nodes.push({
        mesh: meshes.length - 1, name: nm + "_rail",
        extras: { hod2_kind: "camera_rail", hod2_file: stem,
                  hod2_path: path.index,
                  hod2_duration_frames: path.duration },
      });
      railNodes.push(nodes.length - 1);

      // animated camera
      cameras.push({
        type: "perspective", name: nm + "_cam",
        perspective: { yfov: CAM_YFOV, aspectRatio: CAM_ASPECT,
                       znear: CAM_ZNEAR, zfar: CAM_ZFAR },
      });
      nodes.push({
        camera: cameras.length - 1, name: nm + "_cam",
        translation: [...eyes[0]], rotation: [...quats[0]],
        extras: { hod2_kind: "camera", hod2_file: stem, hod2_path: path.index,
                  hod2_duration_frames: path.duration,
                  hod2_fov_bams: CAM_FOV_BAMS,
                  hod2_yfov_deg: CAM_YFOV * 180 / Math.PI },
      });
      const camNode = nodes.length - 1;
      camNodes.push(camNode);

      const tIn = buf.scalarF32(times);
      animations.push({
        name: nm,
        samplers: [
          { input: tIn, output: buf.vec3(eyes), interpolation: "LINEAR" },
          { input: tIn, output: buf.vec4(quats), interpolation: "LINEAR" },
        ],
        channels: [
          { sampler: 0, target: { node: camNode, path: "translation" } },
          { sampler: 1, target: { node: camNode, path: "rotation" } },
        ],
      });
    }
  }

  const out: number[] = [];
  for (const [children, label] of [[railNodes, "camera_rails"],
                                   [camNodes, "cameras"],
                                   [objNodes, "object_paths"]] as
       [number[], string][]) {
    if (children.length) {
      nodes.push({ name: label, children, extras: { hod2_kind: label } });
      out.push(nodes.length - 1);
    }
  }
  return out;
}

const GLB_MAGIC = 0x46546c67;          // 'glTF'
const GLB_CHUNK_JSON = 0x4e4f534a;     // 'JSON'
const GLB_CHUNK_BIN = 0x004e4942;      // 'BIN\0'

/**
 * Wrap a glTF document and its buffer in the binary container.
 *
 * 12-byte header, then a JSON chunk padded with spaces and a BIN chunk padded
 * with zeros -- both to a 4-byte boundary, as the spec requires.
 */
function packGlb(doc: Doc, blob: Uint8Array): Uint8Array {
  const js = utf8(dumpsTight(doc));
  const jsPad = (-js.length % 4 + 4) % 4;
  const binPad = (-blob.length % 4 + 4) % 4;
  const jsLen = js.length + jsPad;
  const binLen = blob.length ? blob.length + binPad : 0;

  const out = new Writer(12 + 8 + jsLen + (binLen ? 8 + binLen : 0));
  const total = 12 + 8 + jsLen + (binLen ? 8 + binLen : 0);
  out.u32(GLB_MAGIC); out.u32(2); out.u32(total);
  out.u32(jsLen); out.u32(GLB_CHUNK_JSON);
  out.bytes(js);
  for (let i = 0; i < jsPad; i++) out.u8(0x20);
  if (binLen) {
    out.u32(binLen); out.u32(GLB_CHUNK_BIN);
    out.bytes(blob);
    for (let i = 0; i < binPad; i++) out.u8(0);
  }
  return out.take();
}

export interface ModelRegionInfo {
  regions: number[];
  draw_mode: number;
  slot: number | null;
  entry: number;
}

export interface ExportOptions {
  collision?: [string, number[][], number[][]][] | null;
  rigs?: RigInstance[] | null;
  spawns?: Doc[] | null;
  writeTextures?: boolean;
  uvCheck?: boolean;
  /**
   * Delete triangles that are collinear in UV space -- see
   * `nl1.dropCollapsedUvTriangles`, which says why the answer is no.
   *
   * **Off, and it used to be on.** It was spelled `keepCollapsedUv` and
   * defaulted to dropping, so every bundle the player has ever loaded was
   * short 3-5% of its triangles, some of them whole faces. The game draws
   * them; `WalkMeshChainAndDraw` has no per-triangle test. This is here for an
   * export aimed at a modelling tool, and it is the caller's to ask for.
   */
  dropCollapsedUv?: boolean;
  camFiles?: CamFile[] | null;
  camStep?: number;
  unlit?: boolean;
  modelRegions?: Map<string, ModelRegionInfo> | null;
  foldMirrorUv?: boolean;
  glb?: boolean;
  /**
   * Is this `(pol stem, texture id)` one of the game's **blood** textures?
   *
   * `tex/scr_blood_red.bin` and `tex/scr_blood_green.bin` hold the same 39
   * images at the same global texture slots as the banks that ship them, and
   * the game's own Blood Color option loads one over the other. A material
   * that draws one of those slots is therefore recolourable, and is marked
   * `extras.hod2_blood` so the client can offer the choice. See
   * `docs/formats/texbank.md`.
   *
   * Absent means "mark nothing", which is what a caller with no exe tables
   * has to do.
   */
  isBloodTexture?: (part: string, texId: number) => boolean;
}

export interface ExportInfo {
  gltf: string;
  glb: boolean;
  dropped_collapsed_uv: number;
  folded_mirror_uv: number;
  nodes: number;
  meshes: number;
  materials: number;
  textures: number;
  buffer_bytes: number;
  cameras: number;
  animations: number;
  paths: number;
  rigs: number;
  spawns: number;
  rig_counts: Record<string, number>;
}

/**
 * Write one or more parts to `<outDir>/<name>.gltf` plus `.bin` and
 * `textures/`, or, with *glb*, into a single self-contained `<name>.glb`.
 *
 * A whole stage is around 1300 separate texture files, and a browser fetching
 * them one at a time is the slowest part of loading a bundle; one file removes
 * the fetch storm entirely.
 *
 * `parts` is a list of `[partName, models, bank]`. Texture IDs are numbered
 * per bank, so tex 0 of st2_01 is unrelated to tex 0 of st2_02, and everything
 * keyed by texture is therefore keyed by `(partName, textureId)`.
 */
export async function exportLevel(
    name: string, parts: [string, Model[], Bank | null][],
    outDir: string, sink: BundleSink, deflate: Deflate,
    opts: ExportOptions = {}): Promise<ExportInfo> {
  const glb = opts.glb ?? false;
  const uvCheck = opts.uvCheck ?? false;
  const unlit = opts.unlit ?? false;
  const writeTextures = opts.writeTextures ?? true;
  const modelRegions = opts.modelRegions ?? null;

  const buf = new Buf();
  const images: Doc[] = [];
  const samplers: Doc[] = [];
  const textures: Doc[] = [];
  const materials: Doc[] = [];
  const meshes: Doc[] = [];
  const nodes: Doc[] = [];
  const sceneNodes: number[] = [];

  const imgWritten = new Map<string, number>();   // part/tex/opaque -> image
  const texWritten = new Map<string, number>();   // image + sampler -> texture
  const samplerCache = new Map<string, number>();
  const matCache = new Map<string, number>();

  /**
   * Decode a texture to a PNG and return its glTF *image* index.
   *
   * ARGB1555/ARGB4444 textures are also used on meshes whose TSP sets
   * IgnoreTexAlpha, where the hardware discards the alpha channel. Emitting
   * the stored alpha for those would punch spurious holes, so they get a
   * separate fully-opaque image variant.
   *
   * Note this returns an **image**, not a texture. In glTF a texture is an
   * (image, sampler) pair, and the same image is routinely used by meshes with
   * different TSP addressing bits -- so images and textures must be cached
   * separately.
   */
  const getImage = async (part: string, bank: Bank | null, texId: number,
                          stripAlpha: boolean): Promise<number | null> => {
    const key = `${part} ${texId} ${stripAlpha}`;
    const hit = imgWritten.get(key);
    if (hit !== undefined) return hit;
    if (bank === null) return null;
    const got = bankDecode(bank, texId);
    if (got === null) return null;
    let { width: w, height: h, pixels } = got;
    if (uvCheck) {
      w = h = 128;
      pixels = checker();
    }
    if (stripAlpha) {
      pixels = pixels.slice();
      for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0xff;
    }
    const sub = `textures/${part}`;
    const suffix = uvCheck ? "_uvcheck" : (stripAlpha ? "_opaque" : "");
    const fn = `${sub}/tex_${String(texId).padStart(3, "0")}${suffix}.png`;
    if (glb) {
      // In a GLB the image is a buffer view, not a file. The name is kept so a
      // material can still be traced back to its bank slot.
      const view = buf.add(await encodeRgba(w, h, pixels, deflate));
      images.push({ bufferView: view, mimeType: "image/png",
                    name: `${part}/tex_${String(texId).padStart(3, "0")}${suffix}` });
    } else {
      if (writeTextures) {
        await sink.write(`${outDir}/${fn}`,
                         await encodeRgba(w, h, pixels, deflate));
      }
      images.push({ uri: fn });
    }
    imgWritten.set(key, images.length - 1);
    return images.length - 1;
  };

  const getSampler = (mesh: Mesh): number => {
    const clamp = mesh.clampUv;
    const flip = mesh.flipUv;
    // bit 1 of clamp/flip is U, bit 0 is V
    const wrapS = wrapMode(Boolean(clamp & 2), Boolean(flip & 2));
    const wrapT = wrapMode(Boolean(clamp & 1), Boolean(flip & 1));
    const filt = mesh.filterMode === 0 ? NEAREST : LINEAR;
    const key = `${wrapS} ${wrapT} ${filt}`;
    if (!samplerCache.has(key)) {
      samplers.push({ magFilter: filt, minFilter: filt,
                      wrapS, wrapT });
      samplerCache.set(key, samplers.length - 1);
    }
    return samplerCache.get(key)!;
  };

  /**
   * glTF texture = (image, sampler) for this mesh's TSP addressing bits.
   *
   * Deduplicating on the image alone and then stamping the sampler onto the
   * shared texture is wrong, and was a real bug: every material sharing an
   * image ended up with the addressing modes of whichever mesh happened to be
   * written last. One clamped mesh anywhere in a segment retroactively clamped
   * every other mesh using that image, smearing a single row or column of
   * texels across whole walls.
   */
  const getTexture = async (part: string, bank: Bank | null, mesh: Mesh,
                            stripAlpha: boolean): Promise<number | null> => {
    const img = await getImage(part, bank, mesh.textureId, stripAlpha);
    if (img === null) return null;
    const smp = getSampler(mesh);
    const key = `${img} ${smp}`;
    if (!texWritten.has(key)) {
      textures.push({ source: img, sampler: smp });
      texWritten.set(key, textures.length - 1);
    }
    return texWritten.get(key)!;
  };

  const getMaterial = async (part: string, bank: Bank | null,
                             mesh: Mesh): Promise<number> => {
    const key = [part, mesh.textureId, mesh.tsp, mesh.textureControl,
                 mesh.parameterControl, mesh.ispTsp, mesh.shading].join(" ");
    const hit = matCache.get(key);
    if (hit !== undefined) return hit;

    const stripAlpha = mesh.ignoreTextureAlpha;
    const texIdx = mesh.textured
      ? await getTexture(part, bank, mesh, stripAlpha) : null;

    const [a, r, g, b] = mesh.baseColour;
    const clamp01 = (v: number) => Math.min(Math.max(v, 0.0), 1.0);
    const pbr: Doc = {
      baseColorFactor: [clamp01(r), clamp01(g), clamp01(b), clamp01(a)],
      metallicFactor: 0.0,
      roughnessFactor: 1.0,
    };
    if (texIdx !== null) {
      pbr.baseColorTexture = { index: texIdx };
      // glTF multiplies baseColorTexture by baseColorFactor, which is exactly
      // what D3DTOP_MODULATE does. The per-mesh base colour is this game's
      // baked static lighting -- 32% of stage meshes carry a value below 0.95,
      // down to 0.0 -- so forcing it to white flattens all of that away.
      //
      // This applies to EVERY shading mode. The port's translation sets
      // COLOROP = MODULATE unconditionally and only varies the alpha op, so
      // PowerVR2 "decal" does not replace the colour here.
      if (uvCheck) {
        pbr.baseColorFactor = [1.0, 1.0, 1.0,
                               (pbr.baseColorFactor as number[])[3]];
      }
    }

    const mat: Doc = {
      name: `${part}_tex${mesh.textureId}_${mesh.shadingModeName}`,
      pbrMetallicRoughness: pbr,
      doubleSided: mesh.doubleSided,
    };
    // Blood, and therefore recolourable at run time -- the flipbook, the gore
    // stumps every zombie swaps in, and the decals. 27 pol files carry some.
    const blood = mesh.textured
      && (opts.isBloodTexture?.(part, mesh.textureId) ?? false);

    // Alpha mode follows the PowerVR2 *list type*, which is what selects the
    // hardware's blending pass. It must not depend on the TSP UseAlpha bit:
    // that governs whether the vertex/base colour alpha participates, not
    // whether blending happens. Keying on it marked every translucent mesh
    // with UseAlpha=0 as opaque -- 8554 meshes in this game, including most of
    // the glass and foliage.
    if (mesh.punchThrough) {
      mat.alphaMode = "MASK";
      mat.alphaCutoff = 0.5;
    } else if (mesh.translucent) {
      mat.alphaMode = "BLEND";
    } else {
      mat.alphaMode = "OPAQUE";
    }

    const hex8 = (v: number) =>
      `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
    // Raw hardware state, so a target engine can be exact.
    mat.extras = {
      ...(blood ? { hod2_blood: true } : {}),
      pvr2: {
        texture_id: mesh.textureId,
        parameter_control: hex8(mesh.parameterControl),
        isp_tsp_instruction: hex8(mesh.ispTsp),
        tsp_instruction: hex8(mesh.tsp),
        texture_control: hex8(mesh.textureControl),
        list_type: mesh.listType,
        shading_mode: mesh.shadingModeName,
        src_blend: mesh.srcBlend,
        dst_blend: mesh.dstBlend,
        // src_alpha / one. glTF has no additive alphaMode, so this is exported
        // as BLEND and flagged for the target engine.
        additive: mesh.additive,
        texture_alpha_used: mesh.textured && !stripAlpha,
        clamp_uv: mesh.clampUv,
        flip_uv: mesh.flipUv,
        filter_mode: mesh.filterMode,
        pixel_format: mesh.pixelFormatName,
        vq_compressed: mesh.vqCompressed,
        twiddled: mesh.twiddled,
        use_alpha: mesh.useAlpha,
        ignore_texture_alpha: mesh.ignoreTextureAlpha,
        gouraud: mesh.gouraud,
        // TSP bit 23 -> D3DRENDERSTATE_FOGENABLE, inverted. The colour and
        // range are scene state, not per-mesh; see evt 0x20-0x27.
        fog_enabled: mesh.fogEnabled,
        fog_control: mesh.fogControl,
        texture_shading: ["decal", "modulate", "decal_alpha",
                          "modulate_alpha"][mesh.textureShading],
      },
    };
    if (unlit) {
      // HOTD2 does no runtime lighting on level geometry: illumination is
      // baked into the textures and the per-mesh base colour, and the levels
      // ship with no light sources at all. KHR_materials_unlit is therefore
      // the faithful model, not a shortcut -- and it is what stops a Rendered
      // view from coming out black.
      const ext = (mat.extensions ??= {}) as Doc;
      ext.KHR_materials_unlit = {};
    }

    materials.push(mat);
    matCache.set(key, materials.length - 1);
    return materials.length - 1;
  };

  // ---- geometry ------------------------------------------------------
  let droppedTris = 0;
  let foldedUvs = 0;
  for (const [partName, models, bank] of parts) {
    for (const model of models) {
      for (const mesh of model.meshes) {
        // Off by default: the fold is the game's fallback for devices without
        // D3DTADDRESS_MIRROR, and applying it to a target that mirrors
        // correctly destroys texturing.
        if (opts.foldMirrorUv) foldedUvs += nl1.applyMirrorUvFold(mesh);
      }
    }
    if (opts.dropCollapsedUv) {
      for (const model of models) {
        for (const mesh of model.meshes) {
          droppedTris += nl1.dropCollapsedUvTriangles(mesh);
        }
      }
    }
    const childNodes: number[] = [];
    for (let mi = 0; mi < models.length; mi++) {
      const model = models[mi];
      let prims: Doc[] = [];
      for (const mesh of model.meshes) {
        if (!mesh.triangles.length || !mesh.vertices.length) continue;
        const pos = mesh.vertices.map((v) => v.pos);
        const nrm = mesh.vertices.map((v) => v.normal);
        const uv = mesh.vertices.map((v) => v.uv);
        const idx: number[] = [];
        for (const tri of mesh.triangles) idx.push(tri[0], tri[1], tri[2]);

        const attrs: Doc = { POSITION: buf.vec3(pos) };
        if (nrm.some((c) => c.some((x) => x))) attrs.NORMAL = buf.vec3(nrm);
        attrs.TEXCOORD_0 = buf.vec2(uv);
        if (mesh.vertices[0].colour !== null) {
          attrs.COLOR_0 = buf.vec4(
            mesh.vertices.map((v) => v.colour ?? [1, 1, 1, 1]));
        }

        prims.push({
          attributes: attrs,
          indices: buf.indices(idx),
          material: await getMaterial(partName, bank, mesh),
          mode: TRIANGLES,
          extras: drawOrderExtras(mesh, prims.length),
        });
      }

      prims = orderedPrims(prims);
      if (prims.length) {
        const meshName = `${partName}_model_${String(mi).padStart(3, "0")}`;
        meshes.push({ name: meshName, primitives: prims });
        const node: Doc = { mesh: meshes.length - 1, name: meshName };
        // Which streaming regions draw this model. Consecutive regions
        // overlap, so a whole-stage export shows geometry the game never
        // displays together; this is how to tell them apart.
        if (modelRegions) {
          const info = modelRegions.get(pairKey(partName, mi));
          if (info !== undefined) {
            node.extras = {
              hod2_regions: info.regions,
              // 0 default, 1 lit by the scene light array when the opcode-0x14
              // toggle is on, 2 drawn in an earlier layer
              hod2_draw_mode: info.draw_mode,
              // The asset slot this model occupies. A model with an empty
              // region list is not scenery any region draws -- it is pulled in
              // by the script with opcode 0x50.
              hod2_slot: info.slot,
              hod2_entry: info.entry,
            };
          }
        }
        nodes.push(node);
        childNodes.push(nodes.length - 1);
      }
    }

    if (childNodes.length) {
      // One parent per part, so a stage segment can be shown or hidden as a
      // unit. Segment streaming order lives in evt/ and cam/.
      nodes.push({ name: partName, children: childNodes,
                   extras: { hod2_part: partName } });
      sceneNodes.push(nodes.length - 1);
    }
  }

  // ---- collision -----------------------------------------------------
  for (const [cname, verts, tris] of opts.collision ?? []) {
    if (!tris.length) continue;
    const idx: number[] = [];
    for (const t of tris) idx.push(...t);
    const prim: Doc = {
      attributes: { POSITION: buf.vec3(verts) },
      indices: buf.indices(idx),
      mode: TRIANGLES,
    };
    meshes.push({ name: cname, primitives: [prim] });
    nodes.push({ mesh: meshes.length - 1, name: cname,
                 extras: { hod2_kind: "collision" } });
    sceneNodes.push(nodes.length - 1);
  }

  // ---- camera and object paths ---------------------------------------
  const cameras: Doc[] = [];
  const animations: Doc[] = [];
  let nPaths = 0;
  if (opts.camFiles && opts.camFiles.length) {
    // A rig whose routine biases the path pose needs its own anchor.
    const biases = new Map<string, number[][]>();
    for (const entry of opts.rigs ?? []) {
      for (const [base, b] of Object.entries(entry.biases ?? {})) {
        let list = biases.get(base);
        if (!list) { list = []; biases.set(base, list); }
        const bb = b as number[];
        if (!list.some((x) => x.join() === bb.join())) list.push(bb);
      }
    }
    sceneNodes.push(...emitPaths(opts.camFiles, buf, nodes, meshes, materials,
                                 cameras, animations, 60.0,
                                 opts.camStep ?? 2.0, biases));
    nPaths = opts.camFiles.reduce((n, c) => n + c.paths.length, 0);
  }

  // ---- identified spawns ----------------------------------------------
  //
  // A node per spawn the event script places, carrying what the thing IS.
  // These carry no geometry: a consumer should draw a marker.
  let nSpawns = 0;
  if (opts.spawns && opts.spawns.length) {
    const spawnNodes: number[] = [];
    for (const sp of opts.spawns) {
      const rot = sp.rot as number[];
      const node: Doc = {
        name: `spawn_${(sp.at as number).toString(16).padStart(6, "0")}`
          + `_${sp.label}`,
        translation: [...(sp.pos as number[])],
        rotation: [...bamsEulerToQuat(rot[0], rot[1], rot[2])],
        extras: {
          hod2_kind: "spawn",
          hod2_class: sp.class,
          hod2_evt_offset: sp.at,
          hod2_opcode: sp.opcode,
        },
      };
      for (const k of ["char_type", "asset_file", "node_count", "note"]) {
        const v = sp[k];
        if (v !== null && v !== undefined && v !== "" && v !== 0) {
          (node.extras as Doc)["hod2_" + k] = v;
        }
      }
      nodes.push(node);
      spawnNodes.push(nodes.length - 1);
      nSpawns += 1;
    }
    if (spawnNodes.length) {
      nodes.push({ name: "spawns", children: spawnNodes,
                   extras: { hod2_kind: "spawn_root" } });
      sceneNodes.push(nodes.length - 1);
    }
  }

  // ---- hand-coded object rigs -----------------------------------------
  //
  // An object that follows an op_ path is not one model: its draw routine
  // walks the matrix stack pushing a transform per part. There is no rig data
  // in the assets, so `hod2lib/rigs` transcribes the routine and this
  // instantiates it as a node hierarchy under the animated path node.
  //
  // Parts are siblings, not a chain -- MatrixStackPush(0) duplicates the top,
  // so each part's transform is relative to the object root.
  let nRigs = 0;
  const rigCounts: Record<string, number> = {};
  for (const entry of opts.rigs ?? []) {
    const rig = entry.rig;
    const byName = new Map<string, number>();
    nodes.forEach((n, i) => { if (n.name !== undefined) byName.set(n.name as string, i); });
    // A rig reaches the scene four ways: parented to the animated node of a
    // route it follows, placed at a pose the routine hardcodes, placed at
    // every spawn descriptor of its class, or -- for a routine that draws
    // straight off the view matrix with no root push -- left in world space
    // with the part transforms already absolute.
    const anchors = (entry.anchors ?? {}) as Record<string, string | null>;
    const targets: [string, Doc | null, string | null][] =
      Object.keys(anchors).map(Number).sort((a, b) => a - b).map((slot) =>
        [String(slot).padStart(3, "0"), null, anchors[String(slot)] ?? null]);
    (entry.placements ?? []).forEach((sp, i) =>
      targets.push([`spawn${String(i).padStart(3, "0")}`, sp as Doc, null]));
    (entry.fixed ?? []).forEach((fp, i) =>
      targets.push([`fixed${String(i).padStart(3, "0")}`,
                    fp as unknown as Doc, null]));
    if (rig.worldSpace && entry.world) targets.push(["world", null, null]);

    for (const [tag, spawn, anchor] of targets) {
      if (anchor !== null && !byName.has(anchor)) continue;
      const partNodes: number[] = [];
      const nodeByPart = new Map<string, number>();
      for (const [part, models] of entry.parts as PartModels[]) {
        let prims: Doc[] = [];
        for (const [model, bank, label] of models) {
          for (const mesh of model.meshes) {
            if (!mesh.triangles.length || !mesh.vertices.length) continue;
            const attrs: Doc = {
              POSITION: buf.vec3(mesh.vertices.map((v) => v.pos)),
              TEXCOORD_0: buf.vec2(mesh.vertices.map((v) => v.uv)),
            };
            const nrm = mesh.vertices.map((v) => v.normal);
            if (nrm.some((c) => c.some((x) => x))) attrs.NORMAL = buf.vec3(nrm);
            const idx: number[] = [];
            for (const tri of mesh.triangles) idx.push(tri[0], tri[1], tri[2]);
            prims.push({
              attributes: attrs,
              indices: buf.indices(idx),
              material: await getMaterial(label, bank, mesh),
              mode: TRIANGLES,
              extras: drawOrderExtras(mesh, prims.length),
            });
          }
        }
        prims = orderedPrims(prims);
        if (!prims.length) continue;
        const meshName = `${rig.name}_${tag}_${part.name}`;
        meshes.push({ name: meshName, primitives: prims });
        const tr = part.translation ?? [0.0, 0.0, 0.0];
        const rb = part.rotation_bams ?? [0, 0, 0];
        const node: Doc = {
          mesh: meshes.length - 1, name: meshName,
          translation: [...tr],
          rotation: [...bamsEulerToQuat(rb[0], rb[1], rb[2])],
          extras: {
            hod2_kind: "rig_part",
            hod2_rig: rig.name, hod2_routine: rig.routine,
            hod2_part: part.name,
            hod2_slots: part.slots.map((x) =>
              `0x${x.toString(16).toUpperCase().padStart(4, "0")}`),
          },
        };
        const sc = part.scale;
        if (sc && !(sc[0] === 1.0 && sc[1] === 1.0 && sc[2] === 1.0)) {
          node.scale = [...sc];
        }
        const ex = node.extras as Doc;
        if (part.drawLayer !== undefined && part.drawLayer !== null) {
          ex.hod2_draw_layer = part.drawLayer;
        }
        if (part.condition) ex.hod2_condition = part.condition;
        if (part.hiddenUnless) {
          // The machine-readable half of `condition`: the client can act on
          // this one rather than only showing it.
          ex.hod2_hidden_unless = part.hiddenUnless;
        }
        if (part.pathRotation !== undefined && part.pathRotation !== null) {
          const pr = part.pathRotation;
          ex.hod2_path_rotation = {
            slot: pr.slot, channel: pr.channel, axis: pr.axis,
            scale: pr.scale ?? 1.0, offset_bams: pr.offsetBams ?? 0,
            frame_offset: pr.frameOffset ?? 0.0,
            frame_lo: pr.frameLo ?? null, frame_hi: pr.frameHi ?? null,
            frame_default: pr.frameDefault ?? null,
            cam_paths: [...(pr.camPaths ?? [])],
            condition: pr.condition ?? "", note: pr.note ?? "",
          };
        }
        if (part.animated) {
          // Recorded, never baked: these are runtime-driven and the export has
          // no frame to bake from.
          ex.hod2_animated = part.animated;
        }
        if (part.note) ex.hod2_note = part.note;
        nodes.push(node);
        const idxNode = nodes.length - 1;
        nodeByPart.set(part.name, idxNode);
        // A part is normally a sibling of the object root, because
        // MatrixStackPush(0) duplicates the top. A routine that nests a push
        // inside another without popping makes a real chain.
        if (part.parent && nodeByPart.has(part.parent)) {
          const parentNode = nodes[nodeByPart.get(part.parent)!];
          ((parentNode.children ??= []) as number[]).push(idxNode);
          ex.hod2_parent = part.parent;
        } else {
          partNodes.push(idxNode);
        }
      }

      if (partNodes.length) {
        const root: Doc = {
          name: `${rig.name}_${tag}`,
          children: partNodes,
          extras: { hod2_kind: "rig", hod2_rig: rig.name,
                    hod2_routine: rig.routine, hod2_note: rig.note ?? "" },
        };
        const rex = root.extras as Doc;
        if (spawn !== null && spawn.kind === "fixed") {
          // A pose the routine hardcodes instead of evaluating a path --
          // already a full BAMS Euler triple, so it is applied as one.
          const rb = spawn.rotation_bams as number[];
          root.translation = [...(spawn.translation as number[])];
          root.rotation = [...bamsEulerToQuat(rb[0], rb[1], rb[2])];
          rex.hod2_placement = "fixed_pose";
          rex.hod2_cam_paths = spawn.cam_paths;
          if (spawn.note) rex.hod2_note_pose = spawn.note;
        } else if (spawn !== null) {
          // Placed instance: position and BAMS yaw from the spawn descriptor.
          // The other two orientation words are NOT confirmed to be angles, so
          // they are carried raw only.
          root.translation = [...(spawn.pos as number[])];
          root.rotation = [...bamsEulerToQuat(
            0, (spawn.orient as number[])[1], 0)];
          rex.hod2_spawn_class = spawn.class;
          rex.hod2_spawn_at = spawn.at;
          rex.hod2_spawn_hp = spawn.hp;
          rex.hod2_spawn_orient = spawn.orient;
        } else if (tag === "world") {
          // The routine draws with no root push, so the part transforms are
          // already absolute world coordinates.
          rex.hod2_placement = "world_space";
        } else {
          rex.hod2_path_slot = parseInt(tag, 10);
        }
        nodes.push(root);
        if (anchor !== null) {
          // parent under the animated object-path node so it rides
          const host = nodes[byName.get(anchor)!];
          ((host.children ??= []) as number[]).push(nodes.length - 1);
        } else {
          sceneNodes.push(nodes.length - 1);
        }
        nRigs += 1;
        rigCounts[rig.name] = (rigCounts[rig.name] ?? 0) + 1;
      }
    }
  }

  // ---- assemble ------------------------------------------------------
  const binName = `${name}.bin`;
  if (!glb) await sink.write(`${outDir}/${binName}`, buf.w.view());

  const doc: Doc = {
    asset: {
      version: "2.0",
      generator: "hod2lib (hotd2-decomp)",
      // The engine's frame ordering, so a renderer that can honour it does not
      // have to rediscover it from the primitive extras.
      extras: { hod2_draw_order: DRAW_ORDER },
    },
    scene: 0,
    scenes: [{ nodes: sceneNodes, name }],
    nodes,
    meshes,
    materials,
    accessors: buf.accessors,
    bufferViews: buf.views,
    // A GLB's single buffer is the BIN chunk and carries no URI.
    buffers: glb ? [{ byteLength: buf.length }]
                 : [{ uri: binName, byteLength: buf.length }],
  };
  if (images.length) {
    doc.images = images;
    doc.textures = textures;
  }
  if (samplers.length) doc.samplers = samplers;
  if (cameras.length) doc.cameras = cameras;
  if (animations.length) doc.animations = animations;
  if (unlit) doc.extensionsUsed = ["KHR_materials_unlit"];

  let outPath: string;
  if (glb) {
    outPath = `${name}.glb`;
    await sink.write(`${outDir}/${outPath}`, packGlb(doc, buf.w.view()));
  } else {
    outPath = `${name}.gltf`;
    await sink.write(`${outDir}/${outPath}`, dumpsIndented(doc));
  }

  return {
    gltf: outPath,
    glb,
    dropped_collapsed_uv: droppedTris,
    folded_mirror_uv: foldedUvs,
    nodes: nodes.length,
    meshes: meshes.length,
    materials: materials.length,
    textures: textures.length,
    buffer_bytes: buf.length,
    cameras: cameras.length,
    animations: animations.length,
    paths: nPaths,
    rigs: nRigs,
    spawns: nSpawns,
    rig_counts: rigCounts,
  };
}

export type { Vec3, RigPart };

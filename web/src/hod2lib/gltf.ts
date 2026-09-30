/**
 * glTF 2.0 writer for HOTD2 levels.
 *
 * Emits one self-contained `.glb`. The raw PowerVR2 render-state words are
 * preserved verbatim in each material's `extras.pvr2` so a target engine can
 * implement exact behaviour rather than relying on the approximate PBR
 * mapping.
 *
 * glTF is right-handed, Y-up, -Z forward, which matches the NaomiLib
 * convention closely enough that positions pass through unchanged. UV V is
 * written as stored: the Blender addon flips it because Blender's UV origin is
 * bottom-left, and Blender's glTF importer applies that same flip on load, so
 * writing the raw value round-trips.
 */

import { BAMS_TO_RAD } from "./bams";
import { Writer, utf8 } from "./bytes";
import { bundleJson } from "./io";
import type { BundleSink, Deflate } from "./io";
import * as nl1 from "./nl1";
import type { Mesh, Model } from "./nl1";
import { encodeRgba } from "./png";
import type { PartModels, RigInstance, RigPart, RigSkin,
              Vec3 } from "./rigs";
import { pairKey } from "./stage";
import { bankDecode } from "./texbank";
import type { Bank } from "./texbank";

// glTF constants
const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const UNSIGNED_SHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const TRIANGLES = 4;

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

  /**
   * `JOINTS_0` — one joint per vertex, the other three slots zero.
   *
   * `UNSIGNED_SHORT` rather than `UNSIGNED_BYTE`: a byte would do for every
   * part the game ships, and glTF allows both, but a four-byte VEC4 needs
   * padding to a four-byte stride anyway and the short costs nothing while
   * removing a limit nobody would remember was there.
   */
  joints(js: readonly number[]): number {
    const raw = new Writer(js.length * 8 + 16);
    for (const j of js) { raw.u16(j); raw.u16(0); raw.u16(0); raw.u16(0); }
    const view = this.add(raw.view(), ARRAY_BUFFER);
    this.accessors.push({
      bufferView: view, componentType: UNSIGNED_SHORT, count: js.length,
      type: "VEC4",
    });
    return this.accessors.length - 1;
  }

  /** `WEIGHTS_0` — `(1, 0, 0, 0)`, *n* times. The engine has no weights. */
  weights(n: number): number {
    const raw = new Writer(n * 16 + 16);
    for (let k = 0; k < n; k++) {
      raw.f32(1.0); raw.f32(0.0); raw.f32(0.0); raw.f32(0.0);
    }
    const view = this.add(raw.view(), ARRAY_BUFFER);
    this.accessors.push({
      bufferView: view, componentType: FLOAT, count: n, type: "VEC4",
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
 * rather than guess. Proved from `RenderFlushCommandList` (0x004A88E0), its
 * qsort comparator `RenderCommandCompare` (0x004A8A20), `WalkMeshChainAndDraw`
 * (0x004A7EF0) and `TranslatePvr2StateToD3D` (0x004A7780). `render/
 * draw_order.ts` is the player's implementation of all of it.
 *
 * The depth is **eye-space z in the matrix stack's convention, where the
 * camera looks down -z**: `RenderInitStates` (0x004A7630) installs a VIEW
 * transform of diag(1, 1, -1, 1) under the left-handed projection
 * `BuildPerspectiveProjection` builds, so a point in front of the camera has a
 * negative z on the stack. The key is the *least* such z, which is the
 * farthest point, and the sort is descending -- nearest first. An earlier
 * version of this record read the same code with +z forward and called it
 * "farthest first (back-to-front painter's order)"; the arithmetic was right
 * and the direction was not.
 */
export const DRAW_ORDER: Doc = {
  passes: ["opaque", "translucent"],
  opaque: "drawn at submission time by RenderEnqueueCommand, in submission "
    + "order -- not sorted; ALPHABLENDENABLE off (0x004A7A10 clears it when "
    + "the command list is opened), no alpha test",
  translucent: "drawn by RenderFlushCommandList after sorting the whole "
    + "command list; ALPHABLENDENABLE on, blend factors from TSP 31-26, "
    + "alpha test on (ALPHAREF 1, GREATEREQUAL), z-write from ISP bit 26 -- "
    + "which no mesh in the game sets, so translucent meshes write depth",
  sort_key: "(draw_layer ASC, sort_depth DESC)",
  sort_comparator: "0x004A8A20: layer = flags & 0xF compared ascending; on a "
    + "tie, sort_depth compared descending. Eye z is negative in front of "
    + "the camera, so descending is nearest first",
  sort_depth: "command +0x04: seeded from the modelview matrix _43 (the "
    + "model origin's eye z) and lowered by pass 0 of the walker to the "
    + "least eye z of the sphere centre of every mesh it skips -- each "
    + "translucent mesh, and each opaque one whose sphere is outside the "
    + "frustum. The least z is the farthest of those points",
  within_a_command: "meshes are walked in chain (file) order; meshes "
    + "belonging to the other pass are skipped",
  pass_selector: "(tsp & 0x180000) == 0x80000 -> opaque; anything else is "
    + "translucent. NOT the list type.",
  default_draw_layer: 8,
  note: "glTF cannot express render order, so primitives are emitted "
    + "opaque-first then translucent, each in chain order, and every "
    + "primitive carries in its extras hod2_pass, hod2_chain_index, "
    + "hod2_model (which of the glTF mesh's NL1 models it belongs to: one "
    + "draw command each) and hod2_sphere (the mesh header's centroid and "
    + "radius, +0x10 and +0x1C, in model space); and hod2_env_uv on a mesh "
    + "whose UVs ModelUVsFromViewNormals rewrites from its normals when its "
    + "slot is drawn after AssetSlotUVsFromViewNormals.",
};

/**
 * Per-primitive draw-order data, for a renderer that can honour it.
 *
 * `model` is the NL1 model the mesh came from, counted within the one glTF
 * mesh being built: a level model is always one (0), and a rig part that
 * draws several slots is several `AssetDrawSlot` calls, each its own command
 * to the sort. `hod2_sphere` is what `WalkMeshChainAndDraw` tests against the
 * frustum and transforms for the sort depth -- the header's own sphere, which
 * for one mesh in ten is not the centre of the vertices' bounding box.
 */
function drawOrderExtras(mesh: Mesh, chainIndex: number, model = 0,
                         envUv = false): Doc {
  return {
    hod2_pass: mesh.opaquePass ? "opaque" : "translucent",
    hod2_chain_index: chainIndex,
    hod2_model: model,
    hod2_sphere: [mesh.centroid[0], mesh.centroid[1], mesh.centroid[2],
                  mesh.radius],
    ...(envUv ? { hod2_env_uv: true } : {}),
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
  // `Array.prototype.sort` is stable in every engine this runs on, which the
  // chain order relies on here.
  return prims.slice().sort((a, b) => key(a) - key(b));
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
  const js = utf8(bundleJson(doc));
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
  rigs?: RigInstance[] | null;
  modelRegions?: Map<string, ModelRegionInfo> | null;
  foldMirrorUv?: boolean;
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
  /** The file written, relative to *outDir*: `<name>.glb`. */
  gltf: string;
  folded_mirror_uv: number;
  nodes: number;
  meshes: number;
  materials: number;
  textures: number;
  buffer_bytes: number;
  rigs: number;
  rig_counts: Record<string, number>;
}

/**
 * Write one or more parts into a single self-contained `<outDir>/<name>.glb`,
 * textures included.
 *
 * A whole stage is around 1300 textures, and a browser fetching them one file
 * at a time is the slowest part of loading a bundle; one file removes the
 * fetch storm entirely.
 *
 * `parts` is a list of `[partName, models, bank]`. Texture IDs are numbered
 * per bank, so tex 0 of st2_01 is unrelated to tex 0 of st2_02, and everything
 * keyed by texture is therefore keyed by `(partName, textureId)`.
 */
export async function exportLevel(
    name: string, parts: [string, Model[], Bank | null][],
    outDir: string, sink: BundleSink, deflate: Deflate,
    opts: ExportOptions = {}): Promise<ExportInfo> {
  const modelRegions = opts.modelRegions ?? null;

  const buf = new Buf();
  const images: Doc[] = [];
  const samplers: Doc[] = [];
  const textures: Doc[] = [];
  const materials: Doc[] = [];
  const meshes: Doc[] = [];
  const skins: Doc[] = [];
  const nodes: Doc[] = [];
  const sceneNodes: number[] = [];

  const imgWritten = new Map<string, number>();   // part/tex -> image
  const texWritten = new Map<string, number>();   // image + sampler -> texture
  const samplerCache = new Map<string, number>();
  const matCache = new Map<string, number>();

  /**
   * Decode a texture to a PNG and return its glTF *image* index.
   *
   * **One image per texture, with the alpha the bank stores**, because that is
   * the one surface the game makes of it. `BindModelTextureHandles`
   * (`FUN_004AC980`) decodes each bank texture once, into its global slot,
   * from the bank entry and its data alone -- no mesh word is an input -- and
   * `DecodeTextureToSurface` (`FUN_004AC270`) copies every texel verbatim into
   * a surface whose format keeps the alpha (ARGB1555 goes to the `A1R5G5B5`
   * slot of `g_texture_formats`, not the `X1R5G5B5` one). `IgnoreTexAlpha` is
   * read by nothing on that path: the D3D translation uses TSP bit 19 only as
   * half of the pass selector. Where the texture's alpha does not show -- the
   * opaque pass, blend and alpha test both off -- that is the *draw state's*
   * doing, which the material carries, not the image's.
   *
   * This used to write a second, alpha-stripped `_opaque` variant for every
   * `IgnoreTexAlpha` mesh. It changed nothing in the opaque pass and took the
   * alpha away from the 101 translucent-pass meshes that set the bit and
   * blend by it -- `zslman`'s and `zndina`'s additive blades among them, which
   * drew as solid bars -- and from every opaque mesh a faded draw blends.
   *
   * Note this returns an **image**, not a texture. In glTF a texture is an
   * (image, sampler) pair, and the same image is routinely used by meshes with
   * different TSP addressing bits -- so images and textures must be cached
   * separately.
   */
  const getImage = async (part: string, bank: Bank | null,
                          texId: number): Promise<number | null> => {
    const key = `${part}\u0000${texId}`;
    const hit = imgWritten.get(key);
    if (hit !== undefined) return hit;
    if (bank === null) return null;
    const got = bankDecode(bank, texId);
    if (got === null) return null;
    const { width: w, height: h, pixels } = got;
    // The image is a buffer view, not a file. The name is kept so a material
    // can still be traced back to its bank slot.
    const view = buf.add(await encodeRgba(w, h, pixels, deflate));
    images.push({ bufferView: view, mimeType: "image/png",
                  name: `${part}/tex_${String(texId).padStart(3, "0")}` });
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
  const getTexture = async (part: string, bank: Bank | null,
                            mesh: Mesh): Promise<number | null> => {
    const img = await getImage(part, bank, mesh.textureId);
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
    const [a, r, g, b] = mesh.baseColour;
    const clamp01 = (v: number) => Math.min(Math.max(v, 0.0), 1.0);
    const factor = [clamp01(r), clamp01(g), clamp01(b), clamp01(a)];
    // **Everything the material carries is in the key.** `WalkMeshChainAndDraw`
    // (`FUN_004A7EF0`) calls `SetMaterial` for every mesh from its own header
    // (`+0x2C..+0x38`), so two meshes with the same texture and words but a
    // different base colour are two materials. The key used to leave the
    // colour and the culling out, and about a fifth of the game's meshes were
    // drawn with the first matching mesh's material -- nearly all of them
    // with another mesh's baked lighting and base alpha, among them the
    // stage-2 car's door shells, which took the black of the body's inner
    // copies. `web/tools/checks/texture_alpha.ts` holds every primitive of a
    // bundle to its own mesh's colour and culling.
    const key = [part, mesh.textureId, mesh.tsp, mesh.textureControl,
                 mesh.parameterControl, mesh.ispTsp, mesh.shading,
                 ...factor, mesh.doubleSided].join(" ");
    const hit = matCache.get(key);
    if (hit !== undefined) return hit;

    const texIdx = mesh.textured ? await getTexture(part, bank, mesh) : null;

    const pbr: Doc = {
      baseColorFactor: factor,
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

    // Alpha mode is the **pass** the PC port draws the mesh in, the TSP pair
    // `WalkMeshChainAndDraw` (`FUN_004A7EF0`) tests,
    // `(tsp & 0x180000) != 0x80000` -- not the PowerVR2 list type, which
    // `TranslatePvr2StateToD3D` never reads, and not `UseAlpha` alone, which
    // marked 8554 translucent meshes opaque when it was tried. `OPAQUE` is
    // also what that pass does with the texture's alpha: blend and alpha test
    // are both off there, and a glTF viewer ignores alpha under `OPAQUE`.
    // Over every mesh in `pol/` the list type agrees with the pass except the
    // untextured list-2 meshes of `zndina` (4) and `zslman` (1), which the
    // port draws opaque; `web/tools/checks/texture_alpha.ts` holds that.
    // The player does not read this: `render/draw_order.ts` rebuilds the
    // state from the words in `extras.pvr2`.
    mat.alphaMode = mesh.opaquePass ? "OPAQUE" : "BLEND";

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
        // Whether a plain draw lets the texture's alpha show: the translucent
        // pass blends and alpha-tests it, the opaque pass does neither. A
        // faded draw blends it in either pass.
        texture_alpha_used: mesh.textured && !mesh.opaquePass,
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
    // HOTD2 does no runtime lighting on level geometry: illumination is
    // baked into the textures and the per-mesh base colour, and the levels
    // ship with no light sources at all. KHR_materials_unlit is therefore the
    // faithful model, not a shortcut -- and it is what stops a Rendered view
    // from coming out black. `render/lighting.ts` swaps in a Lambert twin of a
    // material when the player draws the scene light.
    mat.extensions = { KHR_materials_unlit: {} };

    materials.push(mat);
    matCache.set(key, materials.length - 1);
    return materials.length - 1;
  };

  // ---- geometry ------------------------------------------------------
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
          extras: drawOrderExtras(mesh, prims.length, 0,
                                  nl1.envUvRewritten(model, mesh)),
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

  // ---- hand-coded object rigs -----------------------------------------
  //
  // An object that follows an op_ path is not one model: its draw routine
  // walks the matrix stack pushing a transform per part. There is no rig data
  // in the assets, so `hod2lib/rigs` transcribes the routine and this
  // instantiates it as a node hierarchy, one root per route the client drives
  // from the raw `op_` curve.
  //
  // Parts are siblings, not a chain -- MatrixStackPush(0) duplicates the top,
  // so each part's transform is relative to the object root.
  let nRigs = 0;
  const rigCounts: Record<string, number> = {};
  for (const entry of opts.rigs ?? []) {
    const rig = entry.rig;
    // A rig reaches the scene four ways: at the root of a route it follows,
    // tagged with the path slot the client drives it along; placed at a pose
    // the routine hardcodes; placed at every spawn descriptor of its class; or
    // -- for a routine that draws straight off the view matrix with no root
    // push -- left in world space with the part transforms already absolute.
    const slots = [...new Set(entry.routes.map((r) => r.slot))]
      .sort((a, b) => a - b);
    const targets: [string, Doc | null][] =
      slots.map((slot) => [String(slot).padStart(3, "0"), null]);
    (entry.placements ?? []).forEach((sp, i) =>
      targets.push([`spawn${String(i).padStart(3, "0")}`, sp as Doc]));
    (entry.fixed ?? []).forEach((fp, i) =>
      targets.push([`fixed${String(i).padStart(3, "0")}`,
                    fp as unknown as Doc]));
    if (rig.worldSpace && entry.world) targets.push(["world", null]);

    for (const [tag, spawn] of targets) {
      const partNodes: number[] = [];
      const nodeByPart = new Map<string, number>();
      /** `[node index, skin]` for every vertex-blended part in this rig. */
      const skinned: [number, RigSkin][] = [];
      for (const [part, models] of entry.parts as PartModels[]) {
        let prims: Doc[] = [];
        let meshIndex = 0;
        for (let k = 0; k < models.length; k++) {
          const [model, bank, label] = models[k];
          for (const mesh of model.meshes) {
            const mi = meshIndex++;
            if (!mesh.triangles.length || !mesh.vertices.length) continue;
            // A vertex-blended part draws its **own** geometry, from the exe,
            // not the pol model's: the model supplies the topology, the UVs
            // and the material, and `DeformCharacterPartGroup` overwrites
            // every position and normal every frame. See `charbuild.skinFor`.
            const sk = part.skin;
            const pos = sk ? sk.positions[mi] : mesh.vertices.map((v) => v.pos);
            const attrs: Doc = {
              POSITION: buf.vec3(pos),
              TEXCOORD_0: buf.vec2(mesh.vertices.map((v) => v.uv)),
            };
            const nrm = sk ? sk.normals[mi] : mesh.vertices.map((v) => v.normal);
            if (nrm.some((c) => c.some((x) => x))) attrs.NORMAL = buf.vec3(nrm);
            if (sk) {
              // One joint, weight 1. The engine has no weights at all: every
              // vertex belongs to exactly one of the four groups, measured
              // over the shipped parts with no row claimed twice and none
              // claimed by nothing.
              attrs.JOINTS_0 = buf.joints(sk.joints[mi]);
              attrs.WEIGHTS_0 = buf.weights(sk.joints[mi].length);
            }
            const idx: number[] = [];
            for (const tri of mesh.triangles) idx.push(tri[0], tri[1], tri[2]);
            prims.push({
              attributes: attrs,
              indices: buf.indices(idx),
              material: await getMaterial(label, bank, mesh),
              mode: TRIANGLES,
              extras: drawOrderExtras(mesh, prims.length, k,
                                      nl1.envUvRewritten(model, mesh)),
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
        if (part.drawnOnCamPaths?.length) {
          // ...and the camera-path test, the other half the client acts on.
          ex.hod2_drawn_on_cam_paths = [...part.drawnOnCamPaths];
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
        if (part.skin) skinned.push([idxNode, part.skin]);
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

      // **The joints are proxies, not the bone nodes themselves.**
      // `GLTFLoader` turns any node a skin names into a `Bone` and re-parents
      // its mesh underneath, which would change the class of every bone node
      // in every character -- and the gore swap, the severed head and the
      // attachments all key off whether a bone node is a `Mesh` or a `Group`.
      // An empty child with no transform has the same `matrixWorld` as its
      // parent, so the skin gets what it needs and nothing else moves.
      for (const [meshNode, skin] of skinned) {
        const joints: number[] = [];
        for (let j = 0; j < skin.bones.length; j++) {
          const host = nodeByPart.get(skin.jointParts[j]);
          if (host === undefined) { joints.length = 0; break; }
          nodes.push({
            name: `${rig.name}_${tag}_joint${String(skin.bones[j])
              .padStart(2, "0")}`,
            extras: { hod2_kind: "rig_joint", hod2_rig: rig.name,
                      hod2_bone: skin.bones[j] },
          });
          const jn = nodes.length - 1;
          ((nodes[host].children ??= []) as number[]).push(jn);
          joints.push(jn);
        }
        if (!joints.length) continue;
        // No `inverseBindMatrices`: the exe's source vertices are already in
        // their bone's local space, so the inverse bind is the identity, and
        // glTF says an omitted accessor means exactly that.
        skins.push({ joints });
        nodes[meshNode].skin = skins.length - 1;
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
        sceneNodes.push(nodes.length - 1);
        nRigs += 1;
        rigCounts[rig.name] = (rigCounts[rig.name] ?? 0) + 1;
      }
    }
  }

  // ---- assemble ------------------------------------------------------
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
    buffers: [{ byteLength: buf.length }],
  };
  // Omitted when empty: `skins: []` is invalid glTF, and a stage with no
  // vertex-blended character has none.
  if (skins.length) doc.skins = skins;
  if (images.length) {
    doc.images = images;
    doc.textures = textures;
  }
  if (samplers.length) doc.samplers = samplers;
  doc.extensionsUsed = ["KHR_materials_unlit"];

  const outPath = `${name}.glb`;
  await sink.write(`${outDir}/${outPath}`, packGlb(doc, buf.w.view()));

  return {
    gltf: outPath,
    folded_mirror_uv: foldedUvs,
    nodes: nodes.length,
    meshes: meshes.length,
    materials: materials.length,
    textures: textures.length,
    buffer_bytes: buf.length,
    rigs: nRigs,
    rig_counts: rigCounts,
  };
}

export type { Vec3, RigPart };

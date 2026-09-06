/**
 * NaomiLib NL1 model parser. The port of `tools/hod2lib/nl1.py`.
 *
 * See docs/formats/nl1.md for the format specification.
 *
 * Written from the spec rather than ported from the Blender addon, and it
 * deliberately fixes four defects present there:
 *
 *   1. mesh end is `hdr + 0x50 + mesh_data_size` uniformly (the addon uses
 *      `size + 0x64` for mesh 0, four bytes short)
 *   2. the texture_control address mask is 0x1FFFFFF (the addon uses decimal 23)
 *   3. bump vertices are 56 bytes, not 32
 *   4. bit 0 of vertex x, vertex v and tex_ambient are flags, not float data,
 *      and produce denormals if read naively
 */

import { asU32, f32, i32, u32 } from "./bytes";
import type { Container } from "./container";
import * as degraded from "./degraded";

export class NL1Error extends Error {
  override name = "NL1Error";
}

const OBJ_HEADER = 0x18;
const MESH_HEADER = 0x50;

/** Shading modes (mesh header +0x24). */
export const SHADE_VERTEX_COLOUR = -3;
export const SHADE_BUMP = -2;
export const SHADE_CONSTANT = -1;

export const PIXFMT = ["ARGB1555", "RGB565", "ARGB4444", "YUV422", "BUMP",
                       "PAL4", "PAL8", "RESERVED"];

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

/**
 * Read an f32, clamping denormals to zero.
 *
 * Bit 0 of some fields is used as a flag, which turns +0.0 into 0x00000001 --
 * a denormal. Left alone these propagate as absurd 1e-45 values.
 */
function rf32(b: Uint8Array, off: number): number {
  const v = f32(b, off);
  if (v !== 0.0 && Math.abs(v) < 1e-30) return 0.0;
  return v;
}

function vec3(b: Uint8Array, off: number): Vec3 {
  return [rf32(b, off), rf32(b, off + 4), rf32(b, off + 8)];
}

/** Packed signed byte to float, per the NaomiLib convention. */
function s8f(n: number): number {
  return n > 0x7f ? (n - 0x100) / 128.0 : n / 127.0;
}

export interface Vertex {
  pos: Vec3;
  normal: Vec3;
  uv: [number, number];
  colour: Vec4 | null;
}

export interface Strip {
  flags: number;
  culling: number;
  isTriangleList: boolean;
  vertexSlots: number[];
}

export function envMapped(s: Strip): boolean {
  return (s.flags & 0x100) !== 0;
}

/**
 * One mesh of a model, with its PowerVR2 render state decoded.
 *
 * A class rather than a record because the reference implementation's `Mesh`
 * is twenty-odd `@property` accessors over four dwords, every one of them read
 * by the glTF writer, and copying the bit arithmetic to each call site is how
 * two of them come to disagree.
 */
export class Mesh {
  vertices: Vertex[] = [];
  /**
   * The byte offset each vertex was read from, **relative to the model's own
   * start**, parallel to {@link Mesh.vertices}.
   *
   * The vertex-blended parts address the model by these: the exe's per-part
   * vertex map is a list of *record offsets*, so mapping one of its rows onto
   * a parsed vertex needs the offset the vertex came from and nothing else
   * will do. A back-reference adds no entry, because it adds no vertex.
   */
  offsets: number[] = [];
  strips: Strip[] = [];
  triangles: [number, number, number][] = [];

  constructor(
    readonly offset: number,
    readonly parameterControl: number,
    readonly ispTsp: number,
    readonly tsp: number,
    readonly textureControl: number,
    readonly centroid: Vec3,
    readonly radius: number,
    readonly textureId: number,
    readonly shading: number,
    readonly baseColour: Vec4,          // A R G B
    readonly offsetColour: Vec4,
  ) {}

  get textureWidth(): number { return 8 << ((this.tsp >> 3) & 7); }
  get textureHeight(): number { return 8 << (this.tsp & 7); }
  get pixelFormat(): number { return (this.textureControl >>> 27) & 7; }
  get pixelFormatName(): string { return PIXFMT[this.pixelFormat]; }
  get vqCompressed(): boolean { return ((this.textureControl >>> 30) & 1) !== 0; }
  get mipmapped(): boolean { return ((this.textureControl >>> 31) & 1) !== 0; }
  get twiddled(): boolean { return ((this.textureControl >>> 26) & 1) === 0; }

  get textured(): boolean {
    return this.textureId >= 0 && (this.parameterControl & 0x08) !== 0;
  }

  /** 0 opaque, 1 opaque mod-vol, 2 translucent, 3 trans mod-vol, 4 punch-through. */
  get listType(): number { return (this.parameterControl >>> 24) & 7; }
  get punchThrough(): boolean { return this.listType === 4; }
  get translucent(): boolean { return this.listType === 2 || this.listType === 3; }

  /**
   * Whether this mesh is drawn in the renderer's *opaque* pass.
   *
   * `RenderEnqueueCommand` calls `WalkMeshChainAndDraw(cmd, 0)` and
   * `RenderFlushCommandList` calls it again with `1`; each walk draws only the
   * meshes belonging to its pass and skips the rest by `mesh_data_size`. The
   * selector is **the TSP bits, not the list type**:
   *
   *     is_translucent = (tsp & 0x180000) != 0x80000
   *
   * so a mesh is opaque only when `IgnoreTexAlpha` (bit 19) is set *and*
   * `UseAlpha` (bit 20) is clear. The two usually agree with
   * {@link translucent}, but the pass is what actually decides draw order,
   * which is why it is spelled out separately.
   */
  get opaquePass(): boolean { return (this.tsp & 0x180000) === 0x80000; }

  get gouraud(): boolean { return (this.parameterControl & 0x02) !== 0; }
  get useAlpha(): boolean { return ((this.tsp >>> 20) & 1) !== 0; }
  get ignoreTextureAlpha(): boolean { return ((this.tsp >>> 19) & 1) !== 0; }

  /** TSP bits 22-23: 0 LUT, 1 per-vertex, 2 none, 3 LUT mode 2. */
  get fogControl(): number { return (this.tsp >>> 22) & 3; }

  /**
   * Whether this mesh is fogged.
   *
   * The PC port maps TSP bit 23 to `D3DRENDERSTATE_FOGENABLE` **inverted** --
   * the PowerVR2 bit means *disable*, so fog is on when it is clear.
   * `ModelForceFogControlNone` (0x00419300) exploits exactly that, ORing
   * 0x00800000 into four asset slots' meshes at load to force fog control to
   * 2 = none.
   *
   * The fog colour and near/far it uses are not per-mesh: they live in the
   * scene light block and are set by evt opcodes 0x20-0x27, channels 0-5.
   */
  get fogEnabled(): boolean { return ((this.tsp >>> 23) & 1) === 0; }

  get srcBlend(): number { return (this.tsp >>> 29) & 7; }
  get dstBlend(): number { return (this.tsp >>> 26) & 7; }

  /**
   * TSP bits 6-7: 0 decal, 1 modulate, 2 decal-alpha, 3 modulate-alpha.
   *
   * Under modulate the hardware multiplies the texture by the polygon's base
   * colour, which is how this game bakes its static lighting.
   */
  get textureShading(): number { return (this.tsp >>> 6) & 3; }

  /**
   * Always true on the PC port.
   *
   * PowerVR2 has four texture-shading modes and "decal" is supposed to replace
   * the colour outright. The D3D7 translation (`FUN_004A7780`) does not
   * implement that: it sets `D3DTSS_COLOROP = D3DTOP_MODULATE` for **every**
   * mode and varies only the alpha op. So on this port the base colour always
   * multiplies the texture, including for the 1111 mode-0 meshes.
   *
   * Kept rather than deleted because it documents a real divergence between
   * the arcade hardware and the port.
   */
  get modulatesBaseColour(): boolean { return true; }

  /**
   * True when the alpha op ignores the material alpha.
   *
   * `FUN_004A7780` sets `D3DTSS_ALPHAOP = D3DTOP_SELECTARG1` for shading mode
   * 1 and `D3DTOP_MODULATE` for 0, 2 and 3. Mode 1 is by far the most common
   * (33,429 of 41,463 meshes).
   */
  get textureAlphaOnly(): boolean { return this.textureShading === 1; }

  /** src_alpha / one -- additive blending, used for glows and effects. */
  get additive(): boolean {
    return this.translucent && this.srcBlend === 4 && this.dstBlend === 1;
  }

  get clampUv(): number { return (this.tsp >>> 15) & 3; }
  get flipUv(): number { return (this.tsp >>> 17) & 3; }
  get filterMode(): number { return (this.tsp >>> 13) & 3; }

  get shadingModeName(): string {
    if (this.shading === SHADE_VERTEX_COLOUR) return "vertex_colour";
    if (this.shading === SHADE_BUMP) return "bump";
    if (this.shading === SHADE_CONSTANT) return "constant";
    return "lambert";
  }

  /** Culling comes from the strips, not the mesh header. */
  get doubleSided(): boolean {
    return this.strips.some((s) => s.culling === 0 || s.culling === 1);
  }

  /** PAL4/PAL8 meshes overload offset-colour-alpha with a palette index. */
  get paletteIndex(): number | null {
    if (this.pixelFormat === 5 || this.pixelFormat === 6) {
      return asU32(this.offsetColour[0]);
    }
    return null;
  }
}

export class Model {
  meshes: Mesh[] = [];

  constructor(
    readonly objFormat: number,
    readonly globalFlag: number,
    readonly centroid: Vec3,
    readonly radius: number,
  ) {}

  get vertexCount(): number {
    return this.meshes.reduce((n, m) => n + m.vertices.length, 0);
  }

  get triangleCount(): number {
    return this.meshes.reduce((n, m) => n + m.triangles.length, 0);
  }

  get textureIds(): Set<number> {
    const s = new Set<number>();
    for (const m of this.meshes) if (m.textureId >= 0) s.add(m.textureId);
    return s;
  }
}

export function isModel(b: Uint8Array, off = 0): boolean {
  if (off + OBJ_HEADER > b.length) return false;
  const obj = u32(b, off);
  const flag = u32(b, off + 4);
  return (obj === 0 || obj === 1) && (flag & 1) !== 0 && (flag & ~0x1f) === 0;
}

/** Returns `[vertex, bytes consumed]`. */
function readVertex(b: Uint8Array, pos: number,
                    shading: number): [Vertex, number] {
  if (shading === SHADE_VERTEX_COLOUR) {
    // 32 bytes: pos, packed s8 normal, two ARGB colours, uv
    const bb = b[pos + 0x10], gg = b[pos + 0x11];
    const rr = b[pos + 0x12], aa = b[pos + 0x13];
    return [{
      pos: vec3(b, pos),
      normal: [s8f(b[pos + 0x0e]), s8f(b[pos + 0x0d]), s8f(b[pos + 0x0c])],
      uv: [rf32(b, pos + 0x18), rf32(b, pos + 0x1c)],
      colour: [rr / 255.0, gg / 255.0, bb / 255.0, aa / 255.0],
    }, 32];
  }

  if (shading === SHADE_BUMP) {
    // 56 bytes: pos, normal, tangent, binormal, uv
    return [{
      pos: vec3(b, pos),
      normal: vec3(b, pos + 0x0c),
      uv: [rf32(b, pos + 0x30), rf32(b, pos + 0x34)],
      colour: null,
    }, 56];
  }

  // 32 bytes: pos, normal, uv
  return [{
    pos: vec3(b, pos),
    normal: vec3(b, pos + 0x0c),
    uv: [rf32(b, pos + 0x18), rf32(b, pos + 0x1c)],
    colour: null,
  }, 32];
}

/**
 * Convert a strip to triangles wound counter-clockwise (glTF front face).
 *
 * Winding was settled empirically against the stored per-vertex normals: for
 * each candidate rule, compare the geometric normal (b-a) x (c-a) against the
 * summed vertex normals and take the rule that agrees.
 *
 * Both primitive types share the same base winding -- the first two indices
 * are swapped -- and reversal keys on culling mode 3 ("rclock", i.e. reversed
 * clockwise), not mode 2. Measured over the whole corpus:
 *
 *     triangle lists  base (b,a,c)  100.0% agreement (cull 1 and 2)
 *     strips          swap on even   99.6% agreement with reverse-on-cull-3
 *                                    (77.8% with no reversal at all)
 */
function emitTriangles(strip: Strip,
                       tris: [number, number, number][]): void {
  const s = strip.vertexSlots;
  const reverse = strip.culling === 3;

  if (strip.isTriangleList) {
    for (let i = 0; i + 2 < s.length; i += 3) {
      const a = s[i], b = s[i + 1], c = s[i + 2];
      tris.push(reverse ? [a, b, c] : [b, a, c]);
    }
    return;
  }

  for (let j = 0; j + 2 < s.length; j++) {
    const a = s[j], b = s[j + 1], c = s[j + 2];
    const swap = (j % 2 === 0) !== reverse;
    tris.push(swap ? [b, a, c] : [a, b, c]);
  }
}

function uvArea(a: Vertex, b: Vertex, c: Vertex): number {
  return 0.5 * Math.abs((b.uv[0] - a.uv[0]) * (c.uv[1] - a.uv[1])
                        - (c.uv[0] - a.uv[0]) * (b.uv[1] - a.uv[1]));
}

/**
 * Remove triangles whose UV area is ~zero. Returns how many were dropped.
 *
 * **The game draws these. Do not run this on a bundle the player loads.**
 * `WalkMeshChainAndDraw` (`FUN_004A7EF0`) submits every strip whole --
 * `DrawPrimitive(D3DPT_TRIANGLESTRIP|LIST, FVF 0x112, verts, count, 0)` -- and
 * makes no per-triangle test of any kind on the way there. The vertices are
 * copied eight dwords at a time, UVs verbatim at dwords 6-7. There is nothing
 * in the walk, and nothing in D3D7, that rejects a polygon for being collinear
 * in texture space. [proved]
 *
 * Such a triangle has all three vertices on one line in UV space, so a single
 * row or column of texels is smeared across its whole 2D extent. On screen
 * that is a hard directional streak, and it is what makes affected faces look
 * stretched -- or solid black when the sampled texels happen to be dark. That
 * is what this function was written to remove, on the reasoning that a face
 * carrying no displayable texture information could only be improved by
 * deleting it.
 *
 * The reasoning was wrong, and the counter-example is a hole. On stage 1 the
 * filter takes 1,577 of 35,637 triangles (4.4%), median 3 square units but up
 * to 3,849, and two of them are the paving of the piazza: from the rooftops
 * north of the square the shipped bundle has a pair of triangular holes
 * straight through the world. A streaked roof is the game; a hole is not.
 *
 * They are strip-boundary artifacts: measured across st2_07 they are 4.9% of
 * first triangles and 4.8% of last triangles in a strip, but only 1.1% of
 * middle ones. Only 8.6% involve a back-reference, so this is not a
 * vertex-reuse fault. Whatever authored them, the game renders them.
 *
 * Kept, and reachable through `ExportOptions.dropCollapsedUv`, because an
 * export headed for a modelling tool rather than for the player may genuinely
 * want them gone. Nothing in `hod2lib/bundle.ts` asks for it.
 *
 * **Untextured meshes are exempt.** A mesh with `textureId === -1` stores all
 * its UVs as literal zero, so every one of its triangles has zero UV area and
 * this filter would delete the mesh entirely. It samples no texture at all --
 * it is drawn in its flat base colour -- so UV area carries no information
 * about it.
 */
export function dropCollapsedUvTriangles(mesh: Mesh, eps = 1e-7): number {
  if (mesh.textureId < 0) return 0;
  const keep = mesh.triangles.filter(
    (t) => uvArea(mesh.vertices[t[0]], mesh.vertices[t[1]],
                  mesh.vertices[t[2]]) >= eps);
  const dropped = mesh.triangles.length - keep.length;
  mesh.triangles = keep;
  return dropped;
}

/** Parse one NL1 model starting at *off*. */
export function parse(b: Uint8Array, off = 0, strict = false): Model {
  if (!isModel(b, off)) {
    throw new NL1Error(`no NL1 header at 0x${off.toString(16)}`);
  }

  const model = new Model(u32(b, off), u32(b, off + 4),
                          vec3(b, off + 8), rf32(b, off + 0x14));

  let pos = off + OBJ_HEADER;
  for (;;) {
    if (pos + 4 > b.length) break;
    if (u32(b, pos) === 0) break;                       // end of mesh chain
    if (pos + MESH_HEADER > b.length) {
      if (strict) throw new NL1Error(`truncated mesh header at 0x${pos.toString(16)}`);
      break;
    }

    const hdr = pos;
    const pcw = u32(b, hdr);
    const isp = u32(b, hdr + 4);
    const tsp = u32(b, hdr + 8);
    const tct = u32(b, hdr + 12);
    const texId = i32(b, hdr + 0x20);
    const shading = i32(b, hdr + 0x24);
    const size = u32(b, hdr + 0x4c);

    if (size === 0 || hdr + MESH_HEADER + size > b.length) {
      if (strict) {
        throw new NL1Error(`implausible mesh size ${size} at 0x${hdr.toString(16)}`);
      }
      break;
    }

    const mesh = new Mesh(
      hdr, pcw, isp, tsp, tct,
      vec3(b, hdr + 0x10), rf32(b, hdr + 0x1c), texId, shading,
      [0, 1, 2, 3].map((i) => rf32(b, hdr + 0x2c + 4 * i)) as Vec4,
      [0, 1, 2, 3].map((i) => rf32(b, hdr + 0x3c + 4 * i)) as Vec4,
    );

    pos = hdr + MESH_HEADER;
    const meshEnd = pos + size;
    const offsetToIndex = new Map<number, number>();

    while (pos < meshEnd) {
      if (pos + 8 > meshEnd) break;
      const gflag = u32(b, pos);
      const count = u32(b, pos + 4);
      pos += 8;

      const isTris = (gflag & 0x08) !== 0;
      const n = isTris ? count * 3 : count;
      if (n === 0 || n > 0x10000) break;

      const strip: Strip = {
        flags: gflag, culling: gflag & 3, isTriangleList: isTris,
        vertexSlots: [],
      };

      let ok = true;
      for (let k = 0; k < n; k++) {
        if (pos + 4 > meshEnd) { ok = false; break; }
        const w0 = u32(b, pos);

        if ((w0 >>> 20) === 0x5ff) {
          // back-reference: reuse an earlier vertex in this mesh
          if (pos + 8 > meshEnd) { ok = false; break; }
          const rel = i32(b, pos + 4);
          const target = pos + 8 + rel;
          const idx = offsetToIndex.get(target);
          if (idx === undefined) { ok = false; break; }
          strip.vertexSlots.push(idx);
          pos += 8;
        } else {
          if (pos + 32 > meshEnd) { ok = false; break; }
          const [v, consumed] = readVertex(b, pos, shading);
          offsetToIndex.set(pos, mesh.vertices.length);
          strip.vertexSlots.push(mesh.vertices.length);
          mesh.offsets.push(pos - off);
          mesh.vertices.push(v);
          pos += consumed;
        }
      }

      if (strip.vertexSlots.length) {
        mesh.strips.push(strip);
        emitTriangles(strip, mesh.triangles);
      }
      if (!ok) break;
    }

    pos = meshEnd;
    model.meshes.push(mesh);
  }

  return model;
}

/** Parse every model in a {@link Container}. */
export function parseContainer(c: Container): Model[] {
  const out: Model[] = [];
  c.models.forEach(([start, end], i) => {
    try {
      out.push(parse(c.data.subarray(0, end), start));
    } catch (exc) {
      if (!(exc instanceof NL1Error)) throw exc;
      // Carrying on is right -- one damaged model should not cost the whole
      // file -- but it was silent, and a parser regression here produced a
      // container with zero models, exit 0, and a stage that simply had no
      // geometry in it.
      degraded.note("hod2lib.nl1.parse_container",
                    `model ${i} of this NaomiLib container`,
                    "that model is not in the export", exc);
    }
  });
  return out;
}

/**
 * Reproduce the CPU-side UV fold in `WalkMeshChainAndDraw`.
 *
 * Before submitting a strip whose control word has bit 5 set, the game walks
 * its vertices and folds any UV outside [-1, 1] on an axis whose D3D texture
 * address mode came out as `D3DTADDRESS_MIRROR`:
 *
 *     frac = u - trunc(u)
 *     u    = (frac >= 0 ? 1.0 : -1.0) - frac
 *
 * This is **not** the same as letting the hardware mirror an out-of-range
 * coordinate. Hardware mirroring is a period-2 triangle wave, so 4.7 maps to
 * 0.7; this fold always produces `1 - frac`, so 4.7 maps to 0.3.
 *
 * **Do not apply this by default.** The game guards it with
 * `(DAT_007DE6B0 & 2) == 0`: when that capability bit *is* set it takes a
 * plain copy and lets the hardware address mode do the work. Folding is
 * therefore a fallback for devices that cannot do `D3DTADDRESS_MIRROR`, not
 * the normal path.
 *
 * Kept because it is a real, reachable code path worth documenting, and
 * because reproducing a specific machine's output may matter later.
 *
 * Returns the number of coordinates changed.
 */
export function applyMirrorUvFold(mesh: Mesh): number {
  // The address table is indexed (clamp << 1) | flip and reads WRAP, MIRROR,
  // CLAMP, MIRROR -- so an axis is mirrored whenever its flip bit is set,
  // regardless of clamp.
  const fu = (mesh.flipUv >> 1) & 1;
  const fv = mesh.flipUv & 1;
  const mu = fu !== 0;
  const mv = fv !== 0;
  if (!mu && !mv) return 0;

  let changed = 0;
  for (const v of mesh.vertices) {
    let [u, w] = v.uv;
    if (mu && Math.abs(u) > 1.0) {
      const frac = u - Math.trunc(u);
      u = (frac >= 0.0 ? 1.0 : -1.0) - frac;
      changed += 1;
    }
    if (mv && Math.abs(w) > 1.0) {
      const frac = w - Math.trunc(w);
      w = (frac >= 0.0 ? 1.0 : -1.0) - frac;
      changed += 1;
    }
    v.uv = [u, w];
  }
  return changed;
}

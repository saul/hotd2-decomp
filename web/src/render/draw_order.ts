/**
 * The two passes the engine draws a model in, and the order of the second.
 *
 * Every NL1 model the game draws is one **draw command**: `AssetDrawSlot`
 * (`FUN_00418560`) hands the model and the top of the matrix stack to
 * `RenderSubmitModelDefaultLight` (`FUN_004AA2B0`), which builds a 0x1D-dword
 * command and gives it to `RenderEnqueueCommand` (`FUN_004A7E50`). That walks
 * the model's mesh chain **twice**, with `WalkMeshChainAndDraw`
 * (`FUN_004A7EF0`):
 *
 * * **Pass 0, at submission.** Only the meshes whose TSP word says opaque --
 *   `(tsp & 0x180000) == 0x80000`, `IgnoreTexAlpha` set and `UseAlpha` clear
 *   -- are drawn, with `ALPHABLENDENABLE` off: `RenderBeginCommandList`
 *   (`FUN_004A7A10`) clears it when the frame's list is opened. Every other
 *   mesh is skipped, and so is an opaque one whose sphere is outside the
 *   frustum; each skipped mesh lowers the command's sort depth to its own
 *   sphere centre's eye z if that is less. If anything was skipped the command
 *   is copied into the queue.
 * * **Pass 1, at the end of the frame.** `RenderFlushCommandList`
 *   (`FUN_004A88E0`) qsorts the queue with `RenderCommandCompare`
 *   (`FUN_004A8A20`), turns `ALPHABLENDENABLE` **on**, and walks every queued
 *   command again drawing only its translucent meshes, in chain order.
 *
 * Per mesh, `TranslatePvr2StateToD3D` (`FUN_004A7780`) sets the device state
 * from the mesh header's words. The four that decide how it composites are
 * `ZFUNC` (ISP 31-29 through `g_ZFuncTable`), `ZWRITEENABLE` (ISP bit 26,
 * inverted), `SRCBLEND`/`DESTBLEND` (TSP 31-29 and 28-26 through
 * `g_SrcBlendTable` and `g_DstBlendTable`), and **`ALPHATESTENABLE`**, which is
 * on exactly for the translucent pass, against `RenderInitStates`'
 * (`FUN_004A7630`) `ALPHAREF 1` and `ALPHAFUNC GREATEREQUAL`.
 *
 * ## What the port had instead, and what it cost
 *
 * `GLTFLoader` turned every `alphaMode: BLEND` material into
 * `transparent: true, depthWrite: false`, and three.js sorted each glTF
 * *primitive* on its own bounding sphere, far first. Both are wrong for this
 * engine, and together they took the stage-2 car apart: its body is three
 * translucent shells in chain order 0-2 and three black inner copies at 7-9,
 * and without the outer shell's depth write the far side's black insides
 * painted straight over the near side's bodywork.
 *
 * * **No mesh in the game disables the depth write.** Over all 82,494 meshes
 *   in `pol/` the ISP word's bit 26 is clear and its compare mode is 4, which
 *   `g_ZFuncTable` makes `LESSEQUAL`. So a translucent mesh writes depth, and
 *   the order translucent meshes are drawn in decides which of them survive.
 * * **The order is by command, then by chain.** The sort never looks at a
 *   single mesh; it moves whole commands, and a command draws its translucent
 *   meshes in the order the file lists them.
 * * **Nearest first.** The depth is eye-space z with the camera looking down
 *   -z -- `RenderInitStates` installs `VIEW = diag(1, 1, -1, 1)` under the
 *   left-handed projection `BuildPerspectiveProjection` builds, so a point in
 *   front of the camera is negative on the matrix stack, exactly as it is in
 *   three.js's view space. The command's key is the **least** z among its
 *   origin and its skipped meshes, which is its farthest point, and the
 *   comparator sorts descending: the command whose farthest point is nearest
 *   goes first.
 *
 * ## What this module is
 *
 * {@link applyPvr2DrawState} puts the four states on each exported material,
 * once, when the stage loads; {@link RenderCommandOrder} is the transparent
 * sort the renderer is given. The command is the glTF node that carries the
 * model (`hod2_model` splits the rare rig part that draws two slots), its
 * meshes are the primitives under it, and each primitive's sphere is the mesh
 * header's own, exported as `hod2_sphere`.
 */

import {
  AddEquation,
  AlwaysDepth,
  CustomBlending,
  DstAlphaFactor,
  DstColorFactor,
  EqualDepth,
  Frustum,
  GreaterDepth,
  GreaterEqualDepth,
  LessDepth,
  LessEqualDepth,
  Matrix4,
  NeverDepth,
  NormalBlending,
  NotEqualDepth,
  OneFactor,
  OneMinusDstAlphaFactor,
  OneMinusDstColorFactor,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  Sphere,
  SrcAlphaFactor,
  SrcColorFactor,
  Vector3,
  ZeroFactor,
  type BlendingDstFactor,
  type BlendingSrcFactor,
  type Camera,
  type DepthModes,
  type Material,
  type Mesh,
  type Object3D,
  type RenderItem,
} from "three";

/** TSP bits 20-19, `UseAlpha` and `IgnoreTexAlpha`: the pass selector. */
export const TSP_PASS_MASK = 0x180000;
/** ...and the one value of them that draws in the opaque pass. */
export const TSP_OPAQUE_PASS = 0x80000;
/** ISP bit 26: `ZWRITEENABLE`, inverted -- the PowerVR2 bit is *disable*. */
export const ISP_ZWRITE_DISABLE = 1 << 26;

/**
 * `D3DRENDERSTATE_ALPHAREF`, which `RenderInitStates` (`FUN_004A7630`) sets
 * to 1 under `ALPHAFUNC` 7, `D3DCMP_GREATEREQUAL`, and nothing changes: the
 * only immediate pushes of state 0x18/0x19 in the image are there and in
 * `InitD3DDeviceAndTextureStages`, with the same values. A texel passes when
 * its alpha byte is at least 1.
 */
export const ALPHA_REF = 1;

/**
 * `g_ZFuncTable` -- `0x00598B00`: the ISP compare mode (bits 31-29) to a
 * `D3DCMPFUNC`. PowerVR2 compares 1/w, so its "greater" is D3D's "less".
 */
export const G_ZFUNC_TABLE = [1, 7, 3, 5, 4, 6, 2, 8] as const;
/** `g_SrcBlendTable` -- `0x00598AB0`: TSP 31-29 to a `D3DBLEND`. */
export const G_SRC_BLEND_TABLE = [1, 2, 9, 10, 5, 6, 7, 8] as const;
/** `g_DstBlendTable` -- `0x00598AD0`: TSP 28-26 to a `D3DBLEND`. */
export const G_DST_BLEND_TABLE = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** `D3DCMPFUNC` (1-8) as three.js's depth mode. Same sense: less is nearer. */
const D3DCMP_TO_DEPTH: Record<number, DepthModes> = {
  1: NeverDepth, 2: LessDepth, 3: EqualDepth, 4: LessEqualDepth,
  5: GreaterDepth, 6: NotEqualDepth, 7: GreaterEqualDepth, 8: AlwaysDepth,
};

/**
 * `D3DBLEND` (1-10) as three.js's factor. `DESTALPHA` reads a back buffer the
 * player creates without alpha (`WebGLRenderer`'s default), so it is 1, as it
 * is on a 16-bit colour target; no mesh in the game uses it either way.
 */
const D3DBLEND_TO_FACTOR: Record<number, BlendingSrcFactor> = {
  1: ZeroFactor, 2: OneFactor, 3: SrcColorFactor, 4: OneMinusSrcColorFactor,
  5: SrcAlphaFactor, 6: OneMinusSrcAlphaFactor, 7: DstAlphaFactor,
  8: OneMinusDstAlphaFactor, 9: DstColorFactor, 10: OneMinusDstColorFactor,
};

/** The two words `TranslatePvr2StateToD3D` reads for these states. */
export interface Pvr2Words {
  isp: number;
  tsp: number;
}

/** A material's ISP and TSP words, from the `extras.pvr2` the exporter keeps. */
export function pvr2Words(mat: Material): Pvr2Words | null {
  const p = (mat.userData as { pvr2?: Record<string, unknown> })?.pvr2;
  if (!p) return null;
  const isp = typeof p.isp_tsp_instruction === "string"
    ? Number.parseInt(p.isp_tsp_instruction, 16) : NaN;
  const tsp = typeof p.tsp_instruction === "string"
    ? Number.parseInt(p.tsp_instruction, 16) : NaN;
  if (Number.isNaN(isp) || Number.isNaN(tsp)) return null;
  return { isp, tsp };
}

/** `WalkMeshChainAndDraw`'s selector: is this mesh drawn in pass 0? */
export function isOpaquePass(tsp: number): boolean {
  return (tsp & TSP_PASS_MASK) === TSP_OPAQUE_PASS;
}

/**
 * The composite-deciding half of `TranslatePvr2StateToD3D` (`FUN_004A7780`),
 * on a three.js material.
 *
 * * `transparent` is the pass: three.js draws every non-transparent object
 *   before every transparent one, which is `RenderEnqueueCommand` drawing pass
 *   0 at submission and `RenderFlushCommandList` drawing pass 1 at the end.
 * * Pass 0 has blending off; three.js already turns `NormalBlending` off for a
 *   material that is not transparent, and it is left as `NormalBlending` so
 *   that a later fade (`applyForcedAlphaBlend`) only has to flip the pass.
 *   It is also what makes pass 0 ignore the **texture's alpha**, which the
 *   exporter keeps as the bank stores it (`DecodeTextureToSurface`,
 *   `FUN_004AC270`, copies it into the device's texture and nothing on the
 *   D3D path drops it): with `transparent` false and `NormalBlending`,
 *   `WebGLPrograms` compiles `#define OPAQUE`, whose chunk sets the fragment's
 *   alpha to 1 -- as D3D's pass 0, with `ALPHABLENDENABLE` and
 *   `ALPHATESTENABLE` both off, writes the texel's colour whatever its alpha.
 * * Pass 1 blends with the TSP's own factors, and alpha-tests at
 *   `ALPHA_REF / 255`: three.js discards `a < alphaTest`, D3D keeps
 *   `a * 255 >= ALPHAREF`.
 * * Depth test and write are the ISP's, in both passes.
 *
 * Not here, because the port does them elsewhere: `FOGENABLE` is
 * `render/fog.ts`', the texture address and filter are the exporter's
 * sampler, and the alpha op -- `SELECTARG1` for shading mode 1, `MODULATE`
 * otherwise, with `ALPHAARG1` the texture and `ALPHAARG2` the diffuse
 * (`InitD3DDeviceAndTextureStages`, `FUN_004A4DA0`) -- is `MeshBasicMaterial`'s
 * texel-times-opacity, which agrees because every translucent mode-1 mesh in
 * the game has a base alpha of 1.
 */
export function applyPvr2DrawState(mat: Material, w: Pvr2Words): void {
  const translucent = !isOpaquePass(w.tsp);
  mat.transparent = translucent;
  mat.depthTest = true;
  mat.depthWrite = (w.isp & ISP_ZWRITE_DISABLE) === 0;
  mat.depthFunc = D3DCMP_TO_DEPTH[G_ZFUNC_TABLE[(w.isp >>> 29) & 7]];
  if (translucent) {
    mat.blending = CustomBlending;
    mat.blendEquation = AddEquation;
    mat.blendSrc = D3DBLEND_TO_FACTOR[G_SRC_BLEND_TABLE[(w.tsp >>> 29) & 7]];
    mat.blendDst = D3DBLEND_TO_FACTOR[
      G_DST_BLEND_TABLE[(w.tsp >>> 26) & 7]] as BlendingDstFactor;
    // D3D7 has one set of factors for colour and alpha both.
    mat.blendEquationAlpha = null;
    mat.blendSrcAlpha = null;
    mat.blendDstAlpha = null;
    mat.alphaTest = ALPHA_REF / 255;
  } else {
    mat.blending = NormalBlending;
    mat.alphaTest = 0;
  }
  mat.needsUpdate = true;
}

/**
 * The forced state of `DrawModelWithForcedAlphaBlend` (`FUN_004A8440`), the
 * walker `RenderFlushCommandList` runs for a command
 * `RenderEnqueueCommandFaded` (`FUN_004A8390`) queued -- which is every draw
 * `AssetDrawSlotWithAlpha` (`FUN_004185A0`) makes.
 *
 * That command draws **nothing** in pass 0: every mesh is skipped, so the
 * whole model goes to the translucent pass. There each mesh's TSP is rewritten
 * `(tsp & 0x03FFFF7F) | 0x94000080` -- source `SRCALPHA`, destination
 * `INVSRCALPHA`, and an alpha-modulating texture mode -- and its material
 * alpha is its own base alpha times the command's (`+0x10`). Bits 19-20 are
 * kept, so the alpha test is still the mesh's own pass's, and the ISP word is
 * untouched, so it still writes depth.
 *
 * So an opaque-pass mesh's **texture alpha**, which pass 0 ignores, blends
 * here -- at any alpha, 1 included, because `AssetDrawSlotWithAlpha` takes
 * this path without testing its argument. Flipping `transparent` drops
 * three.js's `OPAQUE` define and lets the texel's alpha through, which is
 * that.
 *
 * `baseOpacity` is the unfaded material's; the port's fading draws clone the
 * template's material and record it there.
 */
export function applyForcedAlphaBlend(mat: Material, alpha: number,
                                      baseOpacity = 1): void {
  // Called every frame a draw fades; the program only has to be rebuilt the
  // first time, when `transparent` flips (three.js's OPAQUE define).
  const forced = mat.transparent && mat.blending === CustomBlending
    && mat.blendSrc === SrcAlphaFactor && mat.blendDst === OneMinusSrcAlphaFactor;
  if (!forced) {
    mat.transparent = true;
    mat.blending = CustomBlending;
    mat.blendEquation = AddEquation;
    mat.blendSrc = SrcAlphaFactor;
    mat.blendDst = OneMinusSrcAlphaFactor;
    mat.blendEquationAlpha = null;
    mat.blendSrcAlpha = null;
    mat.blendDstAlpha = null;
    mat.needsUpdate = true;
  }
  mat.opacity = baseOpacity * Math.max(0, Math.min(1, alpha));
}

/**
 * One mesh's faded draw: what it draws when it is not faded, and the clones
 * the fade drew with.
 *
 * **Per mesh, not per node**, because a character's fade is per node of its
 * skeleton and a node's own mesh has its child bones under it:
 * `setAssetDrawAlpha` on a bone would reach every bone below it. And **over
 * whatever the mesh draws now**, not over the template: three layers choose a
 * mesh's material -- the lighting view's Lambert twin (`render/lighting.ts`),
 * the gun light's (`render/gunlights.ts`) and this one -- and a faded draw is
 * the engine's draw of whichever of those the scene light and the light array
 * made it (`AssetDrawSlotWithAlphaSceneLights`, `FUN_00418620`, is the lit
 * one). So the other two set the {@link unfadedMaterial} through
 * {@link setUnfadedMaterial} and the fade is put back on top of what they
 * chose; a layer that writes `mesh.material` directly (a gore swap, a cel
 * stepping) is noticed by the next fade and taken as the new unfaded material.
 */
interface MeshFade {
  /** The alpha applied. */
  alpha: number;
  /** What the mesh draws when it is not faded. */
  under: Material | Material[];
  /** Each unfaded material's faded clone, made the first time it is faded. */
  clones: Map<Material, Material>;
}

const meshFades = new WeakMap<Mesh, MeshFade>();
/**
 * Every faded clone to the material it was cloned from, for as long as either
 * lives, so that a clone some layer saved during a fade and put back after it
 * is still seen through.
 */
const fadedFrom = new WeakMap<Material, Material>();

function isMeshNode(o: Object3D): o is Mesh {
  return (o as Mesh).isMesh === true && !!(o as Mesh).material;
}

/** The material under a faded one, or the material itself. */
function unfadedOf(m: Material): Material {
  return fadedFrom.get(m) ?? m;
}

/** One unfaded material's clone, made once, at the fade's alpha. */
function fadedClone(f: MeshFade, under: Material): Material {
  let c = f.clones.get(under);
  if (!c) {
    c = under.clone();
    // `Material.copy` carries neither, and the fog hook and the lighting
    // twins' shaders both live in them (`render/fog.ts`).
    c.onBeforeCompile = under.onBeforeCompile;
    c.customProgramCacheKey = under.customProgramCacheKey;
    c.userData.hod2BaseOpacity = under.opacity;
    fadedFrom.set(c, under);
    f.clones.set(under, c);
  }
  applyForcedAlphaBlend(c, f.alpha,
                        (c.userData.hod2BaseOpacity as number | undefined) ?? 1);
  return c;
}

function resolveFade(mesh: Mesh, f: MeshFade): void {
  const u = f.under;
  mesh.material = Array.isArray(u)
    ? u.map((m) => fadedClone(f, m)) : fadedClone(f, u);
}

/**
 * What a mesh draws when it is not faded: the material under its fade, or
 * its own when it has none.
 */
export function unfadedMaterial(mesh: Mesh): Material | Material[] {
  const f = meshFades.get(mesh);
  if (f) return f.under;
  const cur = mesh.material;
  return Array.isArray(cur) ? cur.map(unfadedOf) : unfadedOf(cur);
}

/**
 * Change what a mesh draws when it is not faded, and keep its fade on top --
 * the lighting layers' way of swapping a material. See {@link MeshFade}.
 */
export function setUnfadedMaterial(mesh: Mesh,
                                   m: Material | Material[]): void {
  const f = meshFades.get(mesh);
  if (!f) {
    mesh.material = m;
    return;
  }
  f.under = m;
  resolveFade(mesh, f);
}

/**
 * One mesh's draw: `AssetDrawSlot` (`FUN_00418560`) when `alpha` is `null`,
 * `AssetDrawSlotWithAlpha` (`FUN_004185A0`) otherwise.
 *
 * **A number is the forced state at any value, 1 and 0 included.**
 * `AssetDrawSlotWithAlpha` hands its argument to
 * `RenderSubmitModelFadedDefaultLight` (`FUN_004AA350`) untested, and
 * `DrawModelWithForcedAlphaBlend` (`FUN_004A8440`) makes each mesh's material
 * alpha its base alpha times it (`0x004A85D5`), untested too. So a draw at 1
 * is deferred, blended and alpha-modulating -- which puts an opaque-pass
 * mesh's texture alpha on screen, where the plain draw ignores it -- and a
 * draw at 0 still happens: invisible, and still writing depth for every mesh
 * the alpha test does not drop, which is every opaque-pass one (bits 19-20 are
 * kept, and they say "untested").
 */
export function setMeshDrawAlpha(mesh: Mesh, alpha: number | null): void {
  let f = meshFades.get(mesh);
  if (alpha === null) {
    if (f) {
      // What the mesh draws now, seen through the fade: a layer may have
      // written it since the last fade (a cel stepping), and that is what it
      // draws unfaded.
      const cur = mesh.material;
      mesh.material = Array.isArray(cur) ? cur.map(unfadedOf) : unfadedOf(cur);
      for (const c of f.clones.values()) c.dispose();
      meshFades.delete(mesh);
      return;
    }
    // A clone a layer saved during a fade and has put back since.
    const cur = mesh.material;
    if (Array.isArray(cur)) {
      if (cur.some((m) => fadedFrom.has(m))) mesh.material = cur.map(unfadedOf);
    } else if (fadedFrom.has(cur)) {
      mesh.material = unfadedOf(cur);
    }
    return;
  }
  const a = Math.max(0, Math.min(1, alpha));
  if (!f) {
    f = { alpha: a, under: unfadedMaterial(mesh), clones: new Map() };
    meshFades.set(mesh, f);
  } else {
    // Read back what the mesh draws: something may have written the material
    // directly since the last fade -- a gore swap, a cel stepping -- and then
    // that is its unfaded material now. Seen through a clone, it is the
    // material the clone was made from, whichever that was.
    const cur = mesh.material;
    f.under = Array.isArray(cur) ? cur.map(unfadedOf) : unfadedOf(cur);
    f.alpha = a;
  }
  resolveFade(mesh, f);
}

/** The alpha a mesh's draw is faded at, or `null` for a plain draw. */
export function meshDrawAlpha(mesh: Mesh): number | null {
  return meshFades.get(mesh)?.alpha ?? null;
}

/**
 * One cloned slot node's draw, every mesh of it: `AssetDrawSlot` when `alpha`
 * is `null`, `AssetDrawSlotWithAlpha` otherwise -- see
 * {@link setMeshDrawAlpha}. The plain draw shares the template's materials;
 * the first fade clones them, recording each one's own opacity as the base
 * the fade multiplies, and a plain draw after a fade goes back to them. The
 * layers used to skip the clone at 1, which was the same picture only while
 * the exporter stripped the texture alpha of every opaque-pass mesh; the
 * fading draws do sit at exactly 1 -- the horde ripple for thirty frames, the
 * owl ring for twenty-nine, the fish and water rings open on it.
 */
export function setAssetDrawAlpha(node: Object3D, alpha: number | null): void {
  node.traverse((o) => {
    if (isMeshNode(o)) setMeshDrawAlpha(o, alpha);
  });
}

/**
 * Put every faded mesh under `node` back to its unfaded material and free the
 * clones its fades drew with -- for a node leaving the scene for good
 * (`effects.ts`).
 */
export function releaseAssetDrawAlpha(node: Object3D): void {
  setAssetDrawAlpha(node, null);
}

/**
 * The state {@link applyPvr2DrawState} decided, carried to a material built
 * from scratch rather than cloned -- the lighting layers' Lambert twins.
 * `Material.copy` carries all of it already; a constructor call does not.
 */
export function copyDrawState(from: Material, to: Material): void {
  to.transparent = from.transparent;
  to.depthTest = from.depthTest;
  to.depthWrite = from.depthWrite;
  to.depthFunc = from.depthFunc;
  to.blending = from.blending;
  to.blendEquation = from.blendEquation;
  to.blendSrc = from.blendSrc;
  to.blendDst = from.blendDst;
  to.blendEquationAlpha = from.blendEquationAlpha;
  to.blendSrcAlpha = from.blendSrcAlpha;
  to.blendDstAlpha = from.blendDstAlpha;
  to.alphaTest = from.alphaTest;
}

/** What {@link prepareDrawCommands} needs of `GLTFLoader`'s parser. */
export interface GltfAssociations {
  get(o: Object3D): { nodes?: number } | undefined;
}

/**
 * Give every exported material its draw state, and mark the primitives that
 * are one mesh of a larger model, once, when the stage glTF has loaded.
 *
 * A glTF node whose mesh has several primitives becomes a `Group` of one
 * `Mesh` each; a node with one primitive becomes that `Mesh` itself. The
 * command is the node either way, so a primitive that is *not* a node is
 * marked `hod2Primitive` and its command is its parent. The loader's own
 * associations say which is which: only a node has `nodes`. The mark is
 * userData, so every clone the other layers make of a stage node keeps it.
 *
 * `hod2_draw_mode` 2 is `RegionDrawResidentSet` (`FUN_00401260`) drawing the
 * model between `SetDrawLayerNibble(7)` and `SetDrawLayerNibble(8)`, one layer
 * before everything else in the world. The port spells a layer as
 * `renderOrder`, the world's own layer 8 being 0. It goes on the primitives,
 * not on the node: a `Group`'s `renderOrder` becomes its descendants'
 * `groupOrder`, which three.js compares *first*, and that would put the model
 * ahead of the backdrop, whose -1000 is on its meshes.
 */
export function prepareDrawCommands(root: Object3D,
                                    associations?: GltfAssociations): void {
  const seen = new Set<Material>();
  const layer7: Object3D[] = [];
  root.traverse((o) => {
    if ((o.userData as { hod2_draw_mode?: number }).hod2_draw_mode === 2) {
      layer7.push(o);
    }
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const chain = mesh.geometry?.userData?.hod2_chain_index;
    if (chain === undefined) return;
    if (associations) {
      mesh.userData.hod2Primitive = associations.get(mesh)?.nodes === undefined;
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      const w = pvr2Words(m);
      if (w) applyPvr2DrawState(m, w);
    }
  });
  for (const node of layer7) {
    for (const p of primitivesOf(node)) p.renderOrder = DRAW_LAYER_7_ORDER;
  }
}

/**
 * Layer 7 as a `renderOrder`: before the world's translucent layer 8 (0) and
 * after the backdrop (-1000, -999).
 */
export const DRAW_LAYER_7_ORDER = -1;

/** One transparent draw's place in the sort. */
interface CommandKey {
  /** An exported model's draw, or one of the player's own meshes. */
  nl1: boolean;
  /** Which command: the node's id and `hod2_model`, packed. */
  cmd: number;
  /** The command's sort depth: eye z, negative in front. */
  depth: number;
  /** `hod2_chain_index`: the walk order inside the command. */
  chain: number;
}

const _v = new Vector3();
const _s = new Sphere();
const _m = new Matrix4();

/** The mesh header's sphere, or the geometry's for a bundle without it. */
function localSphere(mesh: Mesh, out: Sphere): Sphere {
  const s = mesh.geometry.userData.hod2_sphere as number[] | undefined;
  if (s && s.length === 4) {
    out.center.set(s[0], s[1], s[2]);
    out.radius = s[3];
    return out;
  }
  const g = mesh.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  return out.copy(g.boundingSphere!);
}

/** The command a primitive belongs to: its node. */
export function commandOf(o: Object3D): Object3D {
  return o.userData.hod2Primitive && o.parent ? o.parent : o;
}

/** The primitives of one command: the node's own mesh, or its marked children. */
function* primitivesOf(cmd: Object3D): Generator<Mesh> {
  const self = cmd as Mesh;
  if (self.isMesh && self.geometry?.userData?.hod2_chain_index !== undefined
      && !self.userData.hod2Primitive) {
    yield self;
    return;
  }
  for (const c of cmd.children) {
    if (c.userData.hod2Primitive && (c as Mesh).isMesh) yield c as Mesh;
  }
}

/**
 * The translucent pass's order: `RenderCommandCompare` (`FUN_004A8A20`) over
 * the commands `WalkMeshChainAndDraw` (`FUN_004A7EF0`) queued, as a three.js
 * transparent sort.
 *
 * The draw layer comes first, and three.js already carries it: every layer
 * the port draws is a `renderOrder` (a group's `renderOrder` arriving as the
 * item's `groupOrder`), so those two are compared exactly as three.js would.
 * Then commands by depth, descending; then a command's own meshes in chain
 * order. The engine's qsort is not stable, so equal keys fall back to ids.
 *
 * Meshes the player makes for itself -- labels, debug overlays, the deep
 * screen sprites -- are not NL1 commands and none of this applies to them:
 * they keep three.js's own order among themselves and follow the commands of
 * their layer.
 */
export class RenderCommandOrder {
  private readonly keys = new Map<Object3D, CommandKey>();
  private readonly depths = new Map<number, number>();
  private readonly frustum = new Frustum();
  private frustumReady = false;

  constructor(private readonly camera: Camera) {}

  /**
   * A new frame: every key is recomputed. Read lazily, inside the sort, which
   * three.js runs after it has updated the camera and every world matrix.
   */
  beginFrame(): void {
    this.keys.clear();
    this.depths.clear();
    this.frustumReady = false;
  }

  /** `RenderCommandCompare`, for `WebGLRenderer.setTransparentSort`. */
  readonly compare = (a: RenderItem, b: RenderItem): number => {
    if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
    if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
    const ka = this.key(a.object);
    const kb = this.key(b.object);
    if (ka.nl1 !== kb.nl1) return ka.nl1 ? -1 : 1;
    if (!ka.nl1) return a.z !== b.z ? b.z - a.z : a.id - b.id;
    if (ka.cmd !== kb.cmd) {
      if (ka.depth !== kb.depth) return kb.depth - ka.depth;
      return ka.cmd - kb.cmd;
    }
    return ka.chain !== kb.chain ? ka.chain - kb.chain : a.id - b.id;
  };

  /** The sort key of one drawn object this frame. */
  key(o: Object3D): CommandKey {
    let k = this.keys.get(o);
    if (k) return k;
    const mesh = o as Mesh;
    const chain = mesh.geometry?.userData?.hod2_chain_index as number | undefined;
    if (chain === undefined) {
      k = { nl1: false, cmd: o.id, depth: 0, chain: 0 };
    } else {
      const model = (mesh.geometry.userData.hod2_model as number | undefined) ?? 0;
      const node = commandOf(o);
      const cmd = node.id * 256 + model;
      let depth = this.depths.get(cmd);
      if (depth === undefined) {
        depth = this.commandDepth(node, model);
        this.depths.set(cmd, depth);
      }
      k = { nl1: true, cmd, depth, chain };
    }
    this.keys.set(o, k);
    return k;
  }

  /**
   * A command's `+0x04`: the eye z of the model's origin -- the modelview's
   * `_43`, which `RenderSubmitModelDefaultLight` seeds it with -- lowered to
   * the eye z of every mesh pass 0 skips. Pass 0 skips a translucent mesh
   * whatever it is, and an opaque one only when its sphere is wholly outside
   * the frustum (`ComputeSphereVisibility`'s clip-intersection bits,
   * `& 0xFFF000`). A mesh the port has hidden is not part of the draw.
   */
  commandDepth(node: Object3D, model: number): number {
    const view = this.camera.matrixWorldInverse;
    let depth = _v.setFromMatrixPosition(node.matrixWorld).applyMatrix4(view).z;
    for (const p of primitivesOf(node)) {
      if (!p.visible) continue;
      if (((p.geometry.userData.hod2_model as number | undefined) ?? 0) !== model) {
        continue;
      }
      localSphere(p, _s).applyMatrix4(p.matrixWorld);
      const mat = Array.isArray(p.material) ? p.material[0] : p.material;
      const skipped = mat?.transparent || !this.inFrustum(_s);
      if (!skipped) continue;
      const z = _v.copy(_s.center).applyMatrix4(view).z;
      if (z < depth) depth = z;
    }
    return depth;
  }

  private inFrustum(s: Sphere): boolean {
    if (!this.frustumReady) {
      this.frustum.setFromProjectionMatrix(_m.multiplyMatrices(
        this.camera.projectionMatrix, this.camera.matrixWorldInverse));
      this.frustumReady = true;
    }
    return this.frustum.intersectsSphere(s);
  }
}

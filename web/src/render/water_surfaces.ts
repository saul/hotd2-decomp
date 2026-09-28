/**
 * The canal water, drawn -- the draw half of `WaterSurfaceUpdate`
 * (`FUN_0046E3A0`), from the tasks `game/class41/water.ts` keeps.
 *
 * ```
 * AssetDrawSlot(+0x40)
 * if (+0x40 == 0x13A7) AssetDrawSlot(0x13A5)
 * if (+0x40 == 0x13A9) AssetDrawSlot(0x13AC)
 * ```
 *
 * No matrix of its own: the tiles are authored in world space, like the
 * region geometry most of them also are. So a tile the stage glTF already
 * holds is drawn **as that node** -- one model, which is what the engine has:
 * the task and `RegionDrawResidentSet` draw the same slot, and the ripple the
 * task writes into it shows in both. `StageScene` is told which of its models
 * the task drew and makes them visible if the player has them resident. A
 * tile that is nobody's region -- `komono_boss2.bin`'s and `komono_venis.bin`'s,
 * loaded whole by `asset_load_polfile` -- is cloned from the `slots_actor` rig.
 *
 * And the two things the task's vertex walk does to a model, from
 * `G.g_water_surface_uv`, on **every** node that draws the tile -- a prop can
 * draw one too (`PropDrawOnlyType12` puts `0x13B5` in the boss's blocks), and
 * in the engine that is the same rewritten model:
 *
 * * every vertex's UV moves by {@link waterUvOffset}, recomputed from the
 *   authored UVs, so it is the same call on a live frame and after a load;
 * * every mesh header's TSP word gains `0x2000`, filter mode 1, so a tile
 *   the walk has run on samples bilinearly. The exporter turned filter mode 0
 *   into `NEAREST` in the glTF sampler, and textures and materials are shared
 *   between tiles, so this is a per-mesh material clone with its own texture.
 *   The engine flips the bit on the rippled tile only: `0x13A5`, drawn beside
 *   `0x13A7` but never walked, keeps its point sampling.
 *
 * Nothing here is state a snapshot needs: `update` and `resync` are one call.
 */
import {
  Group, LinearFilter, type BufferAttribute, type BufferGeometry,
  type Material, type Mesh, type Object3D, type Texture,
} from "three";
import type { System } from "../core/system";
import { G } from "../game/globals";
import { T } from "../game/tables";
import { BAMS_TO_RAD_F64 } from "../core/bams";
import {
  WATER_PHASE_PER_UNIT, WATER_UV_STEP, WATER_Z_LIMIT, type WaterSurfaceUv,
} from "../game/class41/water";
import { WATER_SURFACE_ALSO_DRAWS } from "../game/class41/water_slots";
import type { RenderContext } from "./context";
import { prepareFogMaterial } from "./fog";
import type { StageScene } from "./stagescene";

/** What this needs of the slot-model layer: a fresh copy of a rig template. */
export interface WaterSurfaceTemplates {
  cloneTemplate(slot: number): Object3D | null;
}

/** What this needs of the texture filter: to own a texture it minted. */
export interface WaterSurfaceTextures {
  adopt(tex: Texture): void;
}

/** One geometry of a tile -- the model's own vertex data -- as authored. */
interface GeoState {
  /** The authored UVs, and each vertex's model-space x and z. */
  base: Float32Array;
  x: Float32Array;
  z: Float32Array;
  /** The walk's sums last written, so an unchanged frame writes nothing. */
  key: string;
}

/** One mesh drawing a tile: its glTF material(s), and the bilinear clone. */
interface MeshState {
  material: Material | Material[];
  linear: Material | Material[] | null;
}

/** What this needs of the breakables layer: the props drawing a slot. */
export interface WaterSurfaceProps {
  nodesForSlot(slot: number): Object3D[];
}

/**
 * The vertex half of `WaterSurfaceUpdate`'s walk, over the sums the port
 * kept (`game/class41/water.ts`, `WaterSurfaceUv`). Per full vertex, per frame
 * the walk runs:
 *
 * ```
 * 0046E5A9  CALL __ftol                          ; x, truncated
 * 0046E5AE  LEA/LEA/LEA/LEA  ECX = tick*0x180 + x*600; AND ECX, 0xFFFF
 * 0046E5C8  FMUL g_bams_to_rad; FSIN; FMUL 0.00075; FADD [u]; FSTP [u]
 * 0046E5E0  CALL __ftol                          ; z, the same way
 * 0046E610  ...FCOS; FMUL 0.00075; FADD [v]; OR 1; MOV [v]
 * ```
 *
 * `sin(t + b) = sin t cos b + cos t sin b`, so over all the frames the sum is
 * the kept `Σ sin t` and `Σ cos t` against this vertex's `b`. With index 0
 * the walk skips a vertex whose z is above -1870 (`FCOMP
 * g_water_surface_z_limit`, `0x0046E584`), and so moves it by nothing.
 */
function waterUvOffset(uv: WaterSurfaceUv, x: number, z: number,
                       out: [number, number]): [number, number] {
  if (uv.zLimited && !(Math.fround(z) <= WATER_Z_LIMIT)) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  const bx = (Math.imul(Math.trunc(x), WATER_PHASE_PER_UNIT) & 0xffff)
    * BAMS_TO_RAD_F64;
  const bz = (Math.imul(Math.trunc(z), WATER_PHASE_PER_UNIT) & 0xffff)
    * BAMS_TO_RAD_F64;
  out[0] = WATER_UV_STEP * (uv.sin * Math.cos(bx) + uv.cos * Math.sin(bx));
  out[1] = WATER_UV_STEP * (uv.cos * Math.cos(bz) - uv.sin * Math.sin(bz));
  return out;
}

/** Tags the bilinear clone; the lighting twins copy `userData`, so the tag
 * survives `render/lighting.ts` swapping the material for its lit twin. */
const LINEAR_TAG = "hod2WaterBilinear";

export class WaterSurfaceLayer implements System<RenderContext> {
  readonly id = "render.water_surfaces";
  /** The clones of tiles that are nobody's region. */
  readonly group = new Group();
  scene: StageScene | null = null;
  templates: WaterSurfaceTemplates | null = null;
  textures: WaterSurfaceTextures | null = null;
  props: WaterSurfaceProps | null = null;
  private readonly clones = new Map<number, Object3D>();
  /**
   * The ripple is keyed by **geometry**, because that is the model: a clone
   * shares its template's, and the engine's task and a prop drawing the same
   * slot draw one model. The bilinear bit is per mesh, because the material
   * is where three.js keeps the sampler.
   */
  private readonly geos = new Map<BufferGeometry, GeoState>();
  private readonly meshes = new Map<Mesh, MeshState>();
  /** Every tile this stage's placements can draw, and what it was built from. */
  private owned = new Set<number>();
  private ownedFrom: unknown = null;
  private readonly _uv: [number, number] = [0, 0];

  constructor() {
    this.group.name = "water_surfaces";
  }

  /**
   * The clones follow the stage's templates, and what this rewrote belongs to
   * the stage's models: both go back when the stage does.
   */
  attach(ctx: RenderContext): void {
    ctx.scope.child("water_surfaces").defer(() => {
      for (const [geo, g] of this.geos) restoreGeo(geo, g);
      this.geos.clear();
      for (const [mesh, m] of this.meshes) restoreMesh(mesh, m);
      this.meshes.clear();
      for (const c of this.clones.values()) c.removeFromParent();
      this.clones.clear();
      this.owned = new Set();
      this.ownedFrom = null;
    });
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;
    this.refreshOwned();
    const drawn = new Set<number>();
    for (const w of G.g_water_surfaces) for (const s of w.drawn) drawn.add(s);

    // The stage's own tiles: visibility is `StageScene`'s, which knows what
    // the script has loaded.
    const sceneDrawn = new Set<number>();
    for (const s of drawn) if (scene.nodeForSlot(s)) sceneDrawn.add(s);
    scene.setWaterSlots(this.owned, sceneDrawn);

    // The rest are clones, drawn whenever a task draws them.
    for (const s of drawn) {
      if (sceneDrawn.has(s)) continue;
      let c = this.clones.get(s);
      if (!c) {
        const made = this.templates?.cloneTemplate(s) ?? null;
        if (!made) continue;
        this.group.add(made);
        this.clones.set(s, made);
        c = made;
      }
      c.visible = true;
    }
    for (const [s, c] of this.clones) if (!drawn.has(s)) c.visible = false;

    // What the walk has done to each tile it ran on, on every node that draws
    // that tile -- and, for a model nothing is counting any more (a seek, a
    // new scene, a prop gone), the authored state back.
    const seenGeo = new Set<BufferGeometry>();
    const seenMesh = new Set<Mesh>();
    for (const uv of G.g_water_surface_uv) {
      const nodes = [scene.nodeForSlot(uv.slot), this.clones.get(uv.slot),
                     ...this.props?.nodesForSlot(uv.slot) ?? []];
      for (const node of nodes) {
        if (node) this.apply(node, uv, seenGeo, seenMesh);
      }
    }
    for (const [geo, g] of this.geos) {
      if (seenGeo.has(geo)) continue;
      restoreGeo(geo, g);
      this.geos.delete(geo);
    }
    for (const [mesh, m] of this.meshes) {
      if (seenMesh.has(mesh)) continue;
      restoreMesh(mesh, m);
      this.meshes.delete(mesh);
    }
  }

  resync(): void {
    this.update();
  }

  /** The tiles a water placement in this stage can draw. */
  private refreshOwned(): void {
    const placements = T.breakables?.placements ?? null;
    if (placements === this.ownedFrom) return;
    this.ownedFrom = placements;
    this.owned = new Set();
    for (const pl of placements ?? []) {
      if (pl.container !== "water_surface" || pl.slot === undefined) continue;
      this.owned.add(pl.slot);
      for (const s of WATER_SURFACE_ALSO_DRAWS[pl.slot] ?? []) this.owned.add(s);
    }
  }

  private apply(node: Object3D, uv: WaterSurfaceUv, seenGeo: Set<BufferGeometry>,
                seenMesh: Set<Mesh>): void {
    const key = `${uv.sin}|${uv.cos}|${uv.frames}|${uv.zLimited}`;
    node.updateMatrixWorld(true);
    const toNode = node.matrixWorld.clone().invert();
    node.traverse((o) => {
      const mesh = o as Mesh;
      const geo = mesh.geometry as BufferGeometry | undefined;
      const attr = geo?.attributes?.uv as BufferAttribute | undefined;
      const pos = geo?.attributes?.position as BufferAttribute | undefined;
      if (!mesh.isMesh || !geo || !attr || !pos) return;
      seenMesh.add(mesh);
      // Every frame, not only when the sums move: another layer may have
      // put a material back.
      if (uv.frames > 0) this.bilinear(mesh);
      seenGeo.add(geo);
      let g = this.geos.get(geo);
      if (!g) {
        // The routine reads each vertex as the model stores it: the model's
        // space is the node's, and a mesh under it may carry a transform.
        const e = toNode.clone().multiply(mesh.matrixWorld).elements;
        const x = new Float32Array(pos.count);
        const z = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++) {
          const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
          x[i] = e[0] * px + e[4] * py + e[8] * pz + e[12];
          z[i] = e[2] * px + e[6] * py + e[10] * pz + e[14];
        }
        g = { base: new Float32Array(attr.array as ArrayLike<number>), x, z,
              key: "" };
        this.geos.set(geo, g);
      }
      if (g.key === key) return;
      g.key = key;
      const a = attr.array as Float32Array;
      for (let i = 0; i < attr.count; i++) {
        const [du, dv] = waterUvOffset(uv, g.x[i], g.z[i], this._uv);
        a[i * 2] = g.base[i * 2] + du;
        a[i * 2 + 1] = g.base[i * 2 + 1] + dv;
      }
      attr.needsUpdate = true;
    });
  }

  /** TSP `|= 0x2000`, on this mesh alone. */
  private bilinear(mesh: Mesh): void {
    const cur = mesh.material;
    const first = Array.isArray(cur) ? cur[0] : cur;
    if (first?.userData?.[LINEAR_TAG]) return;
    let m = this.meshes.get(mesh);
    if (!m) {
      m = { material: cur, linear: null };
      this.meshes.set(mesh, m);
    }
    if (!m.linear) {
      const one = (x: Material): Material => {
        const c = x.clone();
        c.userData = { ...x.userData, [LINEAR_TAG]: true };
        const map = (x as { map?: Texture | null }).map;
        if (map) {
          const tex = map.clone();
          tex.minFilter = LinearFilter;
          tex.magFilter = LinearFilter;
          tex.needsUpdate = true;
          (c as { map?: Texture | null }).map = tex;
          this.textures?.adopt(tex);
        }
        // `Material.clone` drops `onBeforeCompile`; see `prepareFogMaterial`.
        prepareFogMaterial(c);
        return c;
      };
      m.linear = Array.isArray(m.material) ? m.material.map(one)
        : one(m.material);
    }
    mesh.material = m.linear;
  }
}

function restoreGeo(geo: BufferGeometry, g: GeoState): void {
  const attr = geo.attributes.uv as BufferAttribute | undefined;
  if (!attr) return;
  (attr.array as Float32Array).set(g.base);
  attr.needsUpdate = true;
}

function restoreMesh(mesh: Mesh, m: MeshState): void {
  mesh.material = m.material;
  const lin = m.linear;
  for (const x of Array.isArray(lin) ? lin : lin ? [lin] : []) {
    (x as { map?: Texture | null }).map?.dispose();
    x.dispose();
  }
  m.linear = null;
}

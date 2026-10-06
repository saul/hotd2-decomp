/**
 * The warehouse water, drawn -- the draw half of `Type26RippleUpdate`
 * (`FUN_00469C80`), class 0x41 constructor 26's task, from what
 * `game/class41/type26.ts` keeps.
 *
 * ```
 * AssetDrawSlotWithAlphaSceneLights(0x197F, 0.5)
 * ```
 *
 * No matrix of its own: `komono_souko.bin[9]` is authored in world space, so
 * the node is a clone of the `slots_actor` rig's template, as the water
 * tiles nobody's region lists are (`render/water_surfaces.ts`). It is shown
 * on a frame a task drew it -- the draw tests the slot's resident bit, which
 * the port keeps on the slot's file (`game/pol_files.ts`) -- at the forced
 * blend of 0.5, and handed to the gun lights, which are the scene light
 * array the call draws under.
 *
 * And what the walk has done to the model, from `G.g_type26_model`:
 *
 * * every vertex's height is {@link type26RippleHeight} of its own `x` and
 *   `z` and the phase of the last walk -- written whole each walk, so
 *   recomputed;
 * * every vertex's UV moves by {@link type26RippleUvOffset}, recomputed from
 *   the authored UVs;
 * * every mesh header's TSP word gains `0x2000`, bilinear, as the water's
 *   does: a per-mesh material clone with its own texture.
 *
 * Nothing here is state a snapshot needs: `update` and `resync` are one call.
 */
import {
  Group, LinearFilter, Matrix4, Vector3, type BufferAttribute,
  type BufferGeometry, type Material, type Mesh, type Object3D, type Texture,
} from "three";
import type { System } from "../core/system";
import { G } from "../game/globals";
import { BAMS_TO_RAD_F64 } from "../core/bams";
import {
  TYPE26_ALPHA, TYPE26_CENTRE_X, TYPE26_CENTRE_Z, TYPE26_HEIGHT_BASE,
  TYPE26_HEIGHT_SCALE, TYPE26_PHASE_PER_UNIT, TYPE26_RING_SCALE, TYPE26_SLOT,
  TYPE26_UV_STEP, type Type26ModelState,
} from "../game/class41/type26";
import type { RenderContext } from "./context";
import {
  setAssetDrawAlpha, setUnfadedMaterial, unfadedMaterial,
} from "./draw_order";
import { prepareFogMaterial } from "./fog";

/** What this needs of the slot-model layer: a fresh copy of a rig template. */
export interface Type26RippleTemplates {
  cloneTemplate(slot: number): Object3D | null;
}

/** What this needs of the texture filter: to own a texture it minted. */
export interface Type26RippleTextures {
  adopt(tex: Texture): void;
}

/** One geometry of the model, as authored, in the model's own space. */
interface GeoState {
  /** The authored positions and UVs. */
  pos: Float32Array;
  uv: Float32Array;
  /** Each vertex's model-space x and z, and the mesh's model-to-local. */
  x: Float32Array;
  z: Float32Array;
  toLocal: Matrix4;
  /** The model state last written, so an unchanged frame writes nothing. */
  key: string;
}

const _v = new Vector3();

/**
 * The height `Type26RippleUpdate` (`FUN_00469C80`)'s walk gives a full vertex
 * at (`x`, `z`) of the model under phase `phase`: `FLD x; FADD 472.5158; FLD
 * z; FADD 1230.6945`, squared and summed, `FMUL 400`, `FIADD +0x3C`,
 * `__ftol`, then `FILD; FMUL g_bams_to_rad; FSIN; FMUL 0.1; FSUB 4.805454;
 * FSTP` -- a float.
 */
export function type26RippleHeight(x: number, z: number, phase: number): number {
  const dx = x + TYPE26_CENTRE_X;
  const dz = z + TYPE26_CENTRE_Z;
  const b = Math.trunc((dx * dx + dz * dz) * TYPE26_RING_SCALE + phase);
  return Math.fround(Math.sin(b * BAMS_TO_RAD_F64) * TYPE26_HEIGHT_SCALE
                     - TYPE26_HEIGHT_BASE);
}

/**
 * The UV offset the walk has given a vertex at (`x`, `z`) over every frame
 * it ran, from the two sums the port keeps: `sin(t + b) = sin t cos b + cos t
 * sin b`, `b = (ftol(c) * 600) & 0xFFFF` of the vertex's own coordinate --
 * see `Type26ModelState`.
 */
export function type26RippleUvOffset(m: Type26ModelState, x: number, z: number,
                                     out: [number, number]): [number, number] {
  const bx = (Math.imul(Math.trunc(x), TYPE26_PHASE_PER_UNIT) & 0xffff)
    * BAMS_TO_RAD_F64;
  const bz = (Math.imul(Math.trunc(z), TYPE26_PHASE_PER_UNIT) & 0xffff)
    * BAMS_TO_RAD_F64;
  out[0] = TYPE26_UV_STEP * (m.sin * Math.cos(bx) + m.cos * Math.sin(bx));
  out[1] = TYPE26_UV_STEP * (m.cos * Math.cos(bz) - m.sin * Math.sin(bz));
  return out;
}

export class Type26RippleLayer implements System<RenderContext> {
  readonly id = "render.type26_ripple";
  readonly group = new Group();
  templates: Type26RippleTemplates | null = null;
  textures: Type26RippleTextures | null = null;
  private node: Object3D | null = null;
  private readonly geos = new Map<BufferGeometry, GeoState>();
  /** Mesh -> its glTF material and the bilinear clone. */
  private readonly linear = new Map<Mesh, { material: Material | Material[];
                                            clone: Material | Material[] }>();
  private readonly _uv: [number, number] = [0, 0];

  constructor() {
    this.group.name = "type26_ripple";
  }

  /** The clone follows the stage's templates, and goes with the stage. */
  attach(ctx: RenderContext): void {
    ctx.scope.child("type26_ripple").defer(() => {
      for (const [geo, g] of this.geos) restoreGeo(geo, g);
      this.geos.clear();
      for (const [mesh, l] of this.linear) {
        setUnfadedMaterial(mesh, l.material);
        for (const x of Array.isArray(l.clone) ? l.clone : [l.clone]) {
          (x as { map?: Texture | null }).map?.dispose();
          x.dispose();
        }
      }
      this.linear.clear();
      this.node?.removeFromParent();
      this.node = null;
    });
  }

  /** What the gun lights should light this frame: the drawn water. */
  litNodes(): readonly Object3D[] {
    return this.node && this.node.visible ? [this.node] : [];
  }

  update(): void {
    const drawn = G.g_type26_tasks.some((t) => t.drawn);
    if (!drawn) {
      if (this.node) this.node.visible = false;
      return;
    }
    if (!this.node) {
      const made = this.templates?.cloneTemplate(TYPE26_SLOT) ?? null;
      if (!made) return;
      this.group.add(made);
      this.node = made;
    }
    const node = this.node;
    node.visible = true;
    const m = G.g_type26_model;
    if (m) this.walk(node, m);
    // Last, over whatever the walk swapped in: the forced blend at 0.5.
    setAssetDrawAlpha(node, TYPE26_ALPHA);
  }

  /** What the walk has done to the model, on the clone. */
  private walk(node: Object3D,
               m: NonNullable<typeof G.g_type26_model>): void {
    const key = `${m.sin}|${m.cos}|${m.frames}|${m.phase}`;
    node.updateMatrixWorld(true);
    const toNode = node.matrixWorld.clone().invert();
    node.traverse((o) => {
      const mesh = o as Mesh;
      const geo = mesh.geometry as BufferGeometry | undefined;
      const pos = geo?.attributes?.position as BufferAttribute | undefined;
      const uv = geo?.attributes?.uv as BufferAttribute | undefined;
      if (!mesh.isMesh || !geo || !pos || !uv) return;
      if (m.frames > 0) this.bilinear(mesh);
      let g = this.geos.get(geo);
      if (!g) {
        // The walk reads each vertex as the model stores it: the model's
        // space is the node's, and a mesh under it may carry a transform.
        const toModel = toNode.clone().multiply(mesh.matrixWorld);
        const x = new Float32Array(pos.count);
        const z = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++) {
          _v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(toModel);
          x[i] = _v.x;
          z[i] = _v.z;
        }
        g = { pos: new Float32Array(pos.array as ArrayLike<number>),
              uv: new Float32Array(uv.array as ArrayLike<number>),
              x, z, toLocal: toModel.clone().invert(), key: "" };
        this.geos.set(geo, g);
      }
      if (g.key === key) return;
      g.key = key;
      const p = pos.array as Float32Array;
      const a = uv.array as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        const h = type26RippleHeight(g.x[i], g.z[i], m.phase);
        _v.set(g.x[i], h, g.z[i]).applyMatrix4(g.toLocal);
        p[i * 3] = _v.x;
        p[i * 3 + 1] = _v.y;
        p[i * 3 + 2] = _v.z;
        const [du, dv] = type26RippleUvOffset(m, g.x[i], g.z[i], this._uv);
        a[i * 2] = g.uv[i * 2] + du;
        a[i * 2 + 1] = g.uv[i * 2 + 1] + dv;
      }
      pos.needsUpdate = true;
      uv.needsUpdate = true;
      geo.computeBoundingSphere();
    });
  }

  resync(): void {
    this.update();
  }

  /** TSP `|= 0x2000`, on this mesh alone. */
  private bilinear(mesh: Mesh): void {
    if (this.linear.has(mesh)) return;
    const one = (x: Material): Material => {
      const c = x.clone();
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
    const material = unfadedMaterial(mesh);
    const clone = Array.isArray(material) ? material.map(one) : one(material);
    this.linear.set(mesh, { material, clone });
    setUnfadedMaterial(mesh, clone);
  }
}

function restoreGeo(geo: BufferGeometry, g: GeoState): void {
  const pos = geo.attributes.position as BufferAttribute | undefined;
  const uv = geo.attributes.uv as BufferAttribute | undefined;
  if (pos) { (pos.array as Float32Array).set(g.pos); pos.needsUpdate = true; }
  if (uv) { (uv.array as Float32Array).set(g.uv); uv.needsUpdate = true; }
}

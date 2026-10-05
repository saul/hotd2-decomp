/**
 * The stage-1 car's moving reflection, drawn -- what `Type3UvScrollInit`
 * (`FUN_004659D0`) and `Type3UvScrollUpdate` (`FUN_00465BC0`) do to the three
 * shells `char_adv00.bin[54]`, `[53]` and `[51]` (slots `0x157E`, `0x157D`,
 * `0x157B`), from `G.g_type3_slot_uv` (`game/class41/type03.ts`).
 *
 * The engine rewrites the models in place, so every node that draws one of
 * those slots shows it. Here that is the stage-1 vehicle rig's parts, which
 * carry two slots each (`hod2_slots`, the body `0x1579` + `0x157E`, the sides
 * `0x157C` + `0x157D` and `0x157A` + `0x157B`) and say which of the two each
 * primitive is (`hod2_model`). On those primitives:
 *
 * * every vertex's UV is the authored one under the slot's transform,
 *   recomputed from the authored UVs, so it is the same call on a live frame
 *   and after a load;
 * * every mesh header's TSP word gains `0x2000`, filter mode 1, and its base
 *   colour A becomes 0.5: a material clone per mesh with its own bilinear
 *   texture and opacity 0.5, as `render/water_surfaces.ts` does for the
 *   canal's TSP bit.
 *
 * A model nothing counts any more -- a new scene, a seek -- gets its authored
 * state back. Nothing here is state a snapshot needs: `update` and `resync`
 * are one call.
 */
import {
  LinearFilter, type BufferAttribute, type BufferGeometry, type Material,
  type Mesh, type Object3D, type Texture,
} from "three";
import type { System } from "../core/system";
import { G } from "../game/globals";
import { TYPE3_BASE_ALPHA, type Type3SlotUv } from "../game/class41/type03";
import type { RenderContext } from "./context";
import { prepareFogMaterial } from "./fog";

/** What this needs of the texture filter: to own a texture it minted. */
export interface UvScrollTextures {
  adopt(tex: Texture): void;
}

/** The primitives that draw one slot, found once a stage. */
interface SlotMeshes { slot: number; meshes: Mesh[] }

/** One geometry, as authored, and the transform last written to it. */
interface GeoState { base: Float32Array; key: string }

/** One mesh's glTF material(s), and the header-rewritten clone. */
interface MeshState { material: Material | Material[]; walked: Material | Material[] | null }

/** Tags the clone, so the lighting layer's twin of it is recognised too. */
const WALKED_TAG = "hod2Type3Walked";

export class UvScrollLayer implements System<RenderContext> {
  readonly id = "render.uv_scroll";
  textures: UvScrollTextures | null = null;
  private root: Object3D | null = null;
  private found: SlotMeshes[] | null = null;
  private readonly geos = new Map<BufferGeometry, GeoState>();
  private readonly meshes = new Map<Mesh, MeshState>();

  /** The stage's root; the rig parts are found under it on first use. */
  adopt(root: Object3D): void {
    this.root = root;
    this.found = null;
  }

  attach(ctx: RenderContext): void {
    ctx.scope.child("uv_scroll").defer(() => {
      for (const [geo, g] of this.geos) restoreGeo(geo, g);
      this.geos.clear();
      for (const [mesh, m] of this.meshes) restoreMesh(mesh, m);
      this.meshes.clear();
      this.root = null;
      this.found = null;
    });
  }

  update(): void {
    const seenGeo = new Set<BufferGeometry>();
    const seenMesh = new Set<Mesh>();
    if (G.g_type3_slot_uv.length && this.root) {
      this.found ??= findSlotMeshes(this.root,
                                    G.g_type3_slot_uv.map((e) => e.slot));
      for (const e of G.g_type3_slot_uv) {
        const hit = this.found.find((f) => f.slot === e.slot);
        for (const mesh of hit?.meshes ?? []) this.apply(mesh, e, seenGeo, seenMesh);
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

  private apply(mesh: Mesh, e: Type3SlotUv, seenGeo: Set<BufferGeometry>,
                seenMesh: Set<Mesh>): void {
    const geo = mesh.geometry as BufferGeometry;
    const attr = geo.attributes.uv as BufferAttribute | undefined;
    if (!attr) return;
    seenMesh.add(mesh);
    // Every frame: another layer may have put a material back.
    this.walked(mesh);
    seenGeo.add(geo);
    let g = this.geos.get(geo);
    if (!g) {
      g = { base: new Float32Array(attr.array as ArrayLike<number>), key: "" };
      this.geos.set(geo, g);
    }
    const key = `${e.uScale}|${e.uOffset}|${e.vScale}|${e.vOffset}`;
    if (g.key === key) return;
    g.key = key;
    const a = attr.array as Float32Array;
    for (let i = 0; i < attr.count; i++) {
      a[i * 2] = g.base[i * 2] * e.uScale + e.uOffset;
      a[i * 2 + 1] = g.base[i * 2 + 1] * e.vScale + e.vOffset;
    }
    attr.needsUpdate = true;
  }

  /** TSP `|= 0x2000` and base colour A 0.5, on this mesh alone. */
  private walked(mesh: Mesh): void {
    const cur = mesh.material;
    const first = Array.isArray(cur) ? cur[0] : cur;
    if (first?.userData?.[WALKED_TAG]) return;
    let m = this.meshes.get(mesh);
    if (!m) {
      m = { material: cur, walked: null };
      this.meshes.set(mesh, m);
    }
    if (!m.walked) {
      const one = (x: Material): Material => {
        const c = x.clone();
        c.userData = { ...x.userData, [WALKED_TAG]: true };
        c.opacity = TYPE3_BASE_ALPHA;
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
      m.walked = Array.isArray(m.material) ? m.material.map(one)
        : one(m.material);
    }
    mesh.material = m.walked;
  }
}

/**
 * Every primitive under a rig part that draws one of `slots`: the part names
 * its slots in order (`hod2_slots`, `"0x157E"`), and a primitive says which
 * of them it belongs to (`hod2_model`).
 */
function findSlotMeshes(root: Object3D, slots: readonly number[]): SlotMeshes[] {
  const out: SlotMeshes[] = slots.map((slot) => ({ slot, meshes: [] }));
  root.traverse((o) => {
    const x = o.userData as { hod2_kind?: string; hod2_slots?: string[] };
    if (x?.hod2_kind !== "rig_part" || !x.hod2_slots) return;
    x.hod2_slots.forEach((s, k) => {
      const hit = out.find((f) => f.slot === Number.parseInt(s, 16));
      if (!hit) return;
      o.traverse((c) => {
        const mesh = c as Mesh;
        if (!mesh.isMesh) return;
        const model = (mesh.geometry.userData.hod2_model as number | undefined) ?? 0;
        if (model === k && !hit.meshes.includes(mesh)) hit.meshes.push(mesh);
      });
    });
  });
  return out;
}

function restoreGeo(geo: BufferGeometry, g: GeoState): void {
  const attr = geo.attributes.uv as BufferAttribute | undefined;
  if (!attr) return;
  (attr.array as Float32Array).set(g.base);
  attr.needsUpdate = true;
}

function restoreMesh(mesh: Mesh, m: MeshState): void {
  mesh.material = m.material;
  const w = m.walked;
  for (const x of Array.isArray(w) ? w : w ? [w] : []) {
    (x as { map?: Texture | null }).map?.dispose();
    x.dispose();
  }
  m.walked = null;
}

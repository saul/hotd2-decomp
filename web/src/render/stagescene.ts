/**
 * The stage's geometry, and the region visibility rule that governs it.
 *
 * > *"Only one region is ever resident and drawn, so segments that
 * > interpenetrate in a whole-stage export are never on screen together."*
 * > -- docs/formats/pipeline.md
 *
 * The bundle's glTF holds every region's models at once, because that is what
 * lets free roam show the whole level. Which of them are *drawn* is decided
 * here, from `region_enter` (`0x29`) and the asset-slot opcodes, exactly as
 * `RegionDrawResidentSet` decides it in the game.
 */

import {
  Box3,
  Group,
  Mesh,
  Object3D,
  Sphere,
  Vector3,
  type Material,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ScriptJson } from "../bundle";

export interface ModelInfo {
  node: Object3D;
  /** Region ids that draw this model. Empty means no region does. */
  regions: number[];
  /** The asset slot it occupies, if the exe's tables named one. */
  slot: number | null;
  /** 0 default, 1 lit by the scene light array, 2 an earlier draw layer. */
  drawMode: number;
  /** Owning `pol/` file stem, from the node's parent group. */
  part: string;
  triangles: number;
}

export type Visibility = "region" | "all";

export class StageScene {
  readonly root = new Group();
  readonly models: ModelInfo[] = [];
  readonly bounds = new Box3();
  readonly boundingSphere = new Sphere();

  /** region id -> the models that region draws. */
  private readonly byRegion = new Map<number, ModelInfo[]>();
  /** asset slot -> its model, for the `0x50`/`0x51` streaming opcodes. */
  private readonly bySlot = new Map<number, ModelInfo>();
  /** Models no region lists: script-loaded props, keyed by slot instead. */
  private readonly unregioned: ModelInfo[] = [];

  private mode: Visibility = "region";
  private currentRegion = -1;
  private loadedSlots = new Set<number>();

  static async load(url: string, script: ScriptJson): Promise<StageScene> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new StageScene(gltf.scene, script);
  }

  private constructor(scene: Object3D, script: ScriptJson) {
    this.root.name = "stage";
    this.root.add(scene);

    scene.traverse((node) => {
      const extras = (node.userData ?? {}) as Record<string, unknown>;
      if (!("hod2_regions" in extras)) return;
      const regions = (extras.hod2_regions as number[]) ?? [];
      const slot = (extras.hod2_slot as number | null) ?? null;
      const info: ModelInfo = {
        node,
        regions,
        slot,
        drawMode: (extras.hod2_draw_mode as number) ?? 0,
        part: (node.parent?.name ?? "").replace(/_model_\d+$/, ""),
        triangles: countTriangles(node),
      };
      this.models.push(info);
      for (const r of regions) {
        let list = this.byRegion.get(r);
        if (!list) this.byRegion.set(r, (list = []));
        list.push(info);
      }
      if (slot !== null) this.bySlot.set(slot, info);
      if (regions.length === 0) this.unregioned.push(info);
    });

    // Regions the script names but the geometry set has nothing for still get
    // an entry, so "region 41 draws nothing" is visible as a fact rather than
    // as a missing key.
    for (let r = 0; r < script.regions.length; r++) {
      if (!this.byRegion.has(r)) this.byRegion.set(r, []);
    }

    this.bounds.setFromObject(this.root);
    this.bounds.getBoundingSphere(this.boundingSphere);
    this.setVisibility("region");
  }

  get regionCount(): number {
    return this.byRegion.size;
  }

  get region(): number {
    return this.currentRegion;
  }

  modelsInRegion(r: number): ModelInfo[] {
    return this.byRegion.get(r) ?? [];
  }

  /** Bounding sphere of one region, for framing the camera on it. */
  regionSphere(r: number, out = new Sphere()): Sphere {
    const box = new Box3();
    for (const m of this.modelsInRegion(r)) box.expandByObject(m.node);
    if (box.isEmpty()) return out.copy(this.boundingSphere);
    return box.getBoundingSphere(out);
  }

  setVisibility(mode: Visibility): void {
    this.mode = mode;
    this.refresh();
  }

  get visibility(): Visibility {
    return this.mode;
  }

  /**
   * `region_enter` (`0x29`). The game's own sequence is
   * `prev = cur; cur = arg; RegionUnloadDelta(prev, cur)` -- it frees what the
   * new region does not need. Here nothing is freed, only hidden.
   */
  enterRegion(r: number): void {
    this.currentRegion = r;
    this.refresh();
  }

  /** `asset_load_slot` (`0x50`) / `asset_unload_slot` (`0x51`). */
  loadSlot(slot: number): void {
    this.loadedSlots.add(slot);
    this.refresh();
  }

  unloadSlot(slot: number): void {
    this.loadedSlots.delete(slot);
    this.refresh();
  }

  resetStreaming(): void {
    this.currentRegion = -1;
    this.loadedSlots.clear();
    this.refresh();
  }

  private refresh(): void {
    const all = this.mode === "all";
    for (const m of this.models) m.node.visible = all;
    if (all) return;
    for (const m of this.byRegion.get(this.currentRegion) ?? []) {
      m.node.visible = true;
    }
    // Props the script streamed in with 0x50 are not region members; they stay
    // drawn until 0x51 takes them away.
    for (const m of this.unregioned) {
      if (m.slot !== null && this.loadedSlots.has(m.slot)) m.node.visible = true;
    }
  }

  /** Count of models currently drawn -- the cheap regression metric. */
  get visibleCount(): number {
    let n = 0;
    for (const m of this.models) if (m.node.visible) n++;
    return n;
  }

  get visibleTriangles(): number {
    let n = 0;
    for (const m of this.models) if (m.node.visible) n += m.triangles;
    return n;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mat = mesh.material as Material | Material[];
      for (const m of Array.isArray(mat) ? mat : [mat]) m?.dispose();
    });
  }
}

function countTriangles(node: Object3D): number {
  let n = 0;
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const g = mesh.geometry;
    n += (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
  });
  return Math.round(n);
}

export const WORLD_UP = new Vector3(0, 1, 0);

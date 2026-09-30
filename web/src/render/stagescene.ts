/**
 * The stage's geometry, and the region visibility rule that governs it.
 *
 * > *"Only one region is ever resident and drawn, so segments that
 * > interpenetrate in a whole-stage export are never on screen together."*
 * > -- docs/formats/pipeline.md
 *
 * The bundle's glTF holds every region's models at once, because that is what
 * lets free roam show the whole level. Which of them are *drawn* is decided
 * here, from `region_enter` (`0x29`), exactly as `RegionDrawResidentSet`
 * decides it in the game.
 *
 * ## What the stage does not draw
 *
 * A model the script streams in with opcode `0x50` and no region lists is
 * **not drawn by the stage** (`L54`): the opcode makes a slot resident, and
 * the model reaches the screen only where a routine calls `AssetDrawSlot` on
 * it, under that routine's own matrix -- a door, a hinge, an item, a boss's
 * prop, the sky. Those are drawn by the layers that run those routines, from
 * their own templates or (the sky) by taking the stage's node. This used to
 * draw every such model where its own coordinates put it, the world's
 * origin, whenever the script had loaded it: stage 5's shutter stood across
 * the tunnel it has nothing to do with, and the gate behind JUDGMENT was
 * nowhere near JUDGMENT. `docs/formats/pipeline.md` lists every model that
 * rule drew and what really draws each.
 *
 * The one exception is class 0x41's canal water, whose task draws the
 * stage's own tile while it is resident -- see {@link setWaterSlots}.
 */

import {
  Box3,
  Group,
  Mesh,
  Object3D,
  Sphere,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ScriptJson } from "../bundle";
import { prepareDrawCommands } from "./draw_order";
import { subtreeResources } from "./scope3d";

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
  /**
   * Everything drawable the glTF held when it was parsed. The layers take
   * their templates out of the tree -- a character, an effect, a prop is
   * copied from its template when it spawns -- and a shader warm-up that
   * walked only the tree missed every one of them (`Player.warmShaders`).
   */
  readonly drawables: Object3D[] = [];
  readonly bounds = new Box3();
  readonly boundingSphere = new Sphere();

  /** region id -> the models that region draws. */
  private readonly byRegion = new Map<number, ModelInfo[]>();
  /** asset slot -> its model, for the `0x50`/`0x51` streaming opcodes. */
  private readonly bySlot = new Map<number, ModelInfo>();
  private mode: Visibility = "region";
  private currentRegion = -1;
  private loadedSlots = new Set<number>();
  /**
   * The tiles class 0x41's water task draws (`render/water_surfaces.ts`):
   * every one it can, and the ones it drew this frame. See
   * {@link setWaterSlots}.
   */
  private waterOwned: ReadonlySet<number> = new Set();
  private waterDrawn: ReadonlySet<number> = new Set();

  /**
   * The stage, parsed from its glTF's bytes -- which the loader has already
   * downloaded, counting them, alongside the script.
   *
   * The parse cannot say how far it has got: it is one long run of promise
   * callbacks that holds the main thread until the scene is built, and the
   * two thousand images it decodes off the thread all report in the last
   * tenth of it. Nothing on the page repaints meanwhile, which is why the
   * loading bar's movement then is a compositor animation.
   */
  static async load(geometry: ArrayBuffer, script: ScriptJson): Promise<StageScene> {
    const gltf = await new GLTFLoader().parseAsync(geometry, "");
    // Before anything clones a node: every layer that draws a stage model
    // copies it, and the copies must carry the engine's draw state and the
    // primitive marks the translucent sort groups by. See `draw_order.ts`.
    prepareDrawCommands(gltf.scene, gltf.parser.associations);
    return StageScene.fromScene(gltf.scene, script);
  }

  /**
   * A stage from a tree that is already parsed and prepared: the half of
   * {@link load} after the glTF, which is also how `test/render.test.ts`
   * builds one out of a few nodes.
   */
  static fromScene(scene: Object3D, script: ScriptJson): StageScene {
    return new StageScene(scene, script);
  }

  private constructor(scene: Object3D, script: ScriptJson) {
    this.root.name = "stage";
    this.root.add(scene);

    scene.traverse((node) => {
      const d = node as Partial<Mesh> & { isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
      if (d.isMesh || d.isPoints || d.isLine || d.isSprite) this.drawables.push(node);
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

  /** The model at an asset slot, if the stage glTF holds one. */
  nodeForSlot(slot: number): Object3D | null {
    return this.bySlot.get(slot)?.node ?? null;
  }

  /**
   * What `WaterSurfaceUpdate` (`FUN_0046E3A0`) drew this frame, of the tiles
   * this stage holds, and every tile it could.
   *
   * A task-drawn tile shows while the player has it resident: loaded with
   * opcode 0x50, or named by the region the walker is in -- the draw is
   * `AssetDrawSlot`, which draws nothing that is not loaded. `owned` is
   * every tile the task can draw, and is kept for the debug readout.
   */
  setWaterSlots(owned: ReadonlySet<number>, drawn: ReadonlySet<number>): void {
    if (sameSet(owned, this.waterOwned) && sameSet(drawn, this.waterDrawn)) {
      return;
    }
    this.waterOwned = new Set(owned);
    this.waterDrawn = new Set(drawn);
    this.refresh();
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

  /**
   * `asset_load_slot` (`0x50`) / `asset_unload_slot` (`0x51`): residency,
   * which the water task's draw tests and nothing else here reads.
   */
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
    // A model no region lists is drawn by whatever routine draws its slot, in
    // that routine's layer -- never here, loaded or not (see the file comment).
    // The water task's tiles are the one case where that routine draws the
    // stage's own node.
    for (const slot of this.waterDrawn) {
      const m = this.bySlot.get(slot);
      if (!m) continue;
      if (this.loadedSlots.has(slot) || m.regions.includes(this.currentRegion)) {
        m.node.visible = true;
      }
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

  /**
   * Free everything the glTF brought in.
   *
   * The stage tree is loaded outside any scope -- `StageScene.load` is an
   * `await` in the middle of `stage_load.ts` and there is no scope to hang it
   * on until it exists -- so this is the hand-written half of `ownResources`,
   * and it goes through the same walk to stay the same walk. It used to be its
   * own loop over meshes, freeing geometries and materials and **never the
   * textures**, which on a stage of 2,200 materials is nearly all of the
   * memory: a stage switch handed back the cheap half.
   */
  dispose(): void {
    const { geometries, materials, textures } = subtreeResources(this.root);
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
  }
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
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

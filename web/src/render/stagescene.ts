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
 * Two routines draw such a model as the stage's own node: class 0x41's water
 * task, which draws a canal tile while it is resident (see
 * {@link setWaterSlots}), and this routine itself, which draws stage 3's
 * two canal tiles beside one region entry (see {@link RegionEntryAlsoDraws}).
 *
 * ## What `RegionDrawResidentSet` does besides walking the list
 *
 * `RegionDrawResidentSet` (`FUN_00401260`), read whole from the disassembly
 * `[proved]`:
 *
 * ```
 * if (g_screen_furniture_flags & 0x20) return;          // 0x00401268
 * for (each table index i in the current region's list) {
 *   slot = table[i].slot;  push;
 *   if (slot == 0x1828) {                                // 0x004012B7
 *     if (region == 2 || region == 3) {
 *       push; AssetDrawSlot(0x13B2); AssetDrawSlot(0x13B0); pop;
 *     }
 *   } else if (slot == 0x1918) {
 *     if (g_scene_index == 9) MatrixTranslate(0, 9, 0);
 *   } else if (slot == 0x1A56 && region == 8 && i == 0x16) {
 *     skip its own draw;
 *   }
 *   bounding sphere, frustum test, and the draw by table[i].mode; pop;
 * }
 * ```
 *
 * The port has the first two. Bit `0x20` is `ChapterCardInstall`'s
 * (`ScreenFurniture.ChapterCard`): while a chapter card is up no region model
 * is drawn ({@link setChapterCard}). And `0x1828` is `st3_08[2]`, first in
 * stage 3's regions 2 and 3, which are the boat's two canal cut scenes
 * (block 0 step 2 and block 7 step 2): the canal under the boat is
 * `st1_1[14]` and `st1_1[12]`, which no region lists and no water task draws
 * until the script has left the region. Without this arm the canal there was
 * empty.
 *
 * The other two arms do not reach the port. `0x1918` (`st6_01[14]`, stage
 * 6's regions 12 and 13) moves only under scene index 9, which no bundle
 * is. `0x1A56` (`st4_06[4]`) is listed twice in stage 4's region 8, at table
 * index `0x16` with draw mode 1 and at `0x25` with mode 0, so the arm leaves
 * one draw under the default light; the bundle carries one draw mode per
 * model (the largest of its entries'), so that model is drawn once here as
 * it is there, but in the scene light array's mode.
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
import type { System } from "../core/system";
import { G, ScreenFurniture } from "../game/globals";
import { prepareDrawCommands } from "./draw_order";
import { subtreeResources } from "./scope3d";

/**
 * The slots `RegionDrawResidentSet` (`FUN_00401260`) draws beside a region
 * entry, besides the entry's own model: `AssetDrawSlot(0x13B2)` then
 * `AssetDrawSlot(0x13B0)` -- stage 3's canal tiles `st1_1[14]` and
 * `st1_1[12]` -- for entry slot `0x1828` while the current region is 2 or 3
 * (`0x004012B7`..`0x00401333`). Not frustum-tested, and drawn whether or not
 * the entry itself is; `AssetDrawSlot` skips a slot that is not resident.
 *
 * Neither tile is ever drawn by this and by a water task on the same frame:
 * both cut scenes leave region 2 or 3 (block 0 step 2 op 40, block 7 step 2
 * op 42) before the script places the task (ops 56 and 47), in both modes'
 * scripts. So one node drawn once is the engine's picture.
 */
export function RegionEntryAlsoDraws(entrySlot: number,
                                     region: number): readonly number[] {
  if (entrySlot === 0x1828 && (region === 2 || region === 3)) {
    return [0x13b2, 0x13b0];
  }
  return [];
}

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
  /** `g_screen_furniture_flags & 0x20`, as {@link setChapterCard} last had it. */
  private chapterCard = false;

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

  /**
   * `g_screen_furniture_flags & 0x20` (`ScreenFurniture.ChapterCard`), which
   * `RegionDrawResidentSet` tests before anything else: while it is up the
   * routine returns at once and no region model is drawn. The models other
   * routines draw -- the water task's tiles -- are not this routine's.
   */
  setChapterCard(up: boolean): void {
    if (up === this.chapterCard) return;
    this.chapterCard = up;
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
   * Whether `AssetDrawSlot` (`FUN_00418560`) would find *slot* resident, as
   * far as the stage can say. It draws only a slot whose record has `0x8000`
   * and `1` set; the one traffic the player tracks is opcodes `0x50` and
   * `0x51`, and a slot this stage holds a model for and no region lists is
   * one the script streams that way -- resident while loaded, and not before
   * or after. Any other slot is taken as resident: a region's models are
   * this class's own business, and whole-file loads (`0x52`) are the
   * port's (`game/pol_files.ts`), which this does not read.
   */
  slotResident(slot: number): boolean {
    const m = this.bySlot.get(slot);
    if (!m || m.regions.length) return true;
    return this.loadedSlots.has(slot);
  }

  /**
   * `asset_load_slot` (`0x50`) / `asset_unload_slot` (`0x51`): residency,
   * which the water task's draw and {@link slotResident} read.
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
    // `RegionDrawResidentSet`: nothing while the chapter card is up; else
    // the current region's entries, and what an entry draws beside itself.
    if (!this.chapterCard) {
      for (const m of this.byRegion.get(this.currentRegion) ?? []) {
        m.node.visible = true;
        if (m.slot === null) continue;
        for (const s of RegionEntryAlsoDraws(m.slot, this.currentRegion)) {
          const also = this.bySlot.get(s);
          if (also && this.slotResident(s)) also.node.visible = true;
        }
      }
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

/**
 * `RegionDrawResidentSet`'s one per-frame input the walker does not hand the
 * scene: the chapter card's bit of `g_screen_furniture_flags`, read once a
 * frame out of `G` and given to the stage when it changes.
 */
export class RegionDrawGate implements System {
  readonly id = "render.region_draw";
  scene: StageScene | null = null;

  update(): void {
    this.scene?.setChapterCard(
      (G.g_screen_furniture_flags & ScreenFurniture.ChapterCard) !== 0);
  }

  resync(): void {
    this.update();
  }
}

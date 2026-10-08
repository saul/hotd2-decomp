/**
 * The asset slots a routine drew in the camera's own space this frame --
 * `G.g_view_slot_draws`, `game/view_slot.ts` -- drawn.
 *
 * Each record is one `MatrixLoadIdentity; MatrixTranslate(x, y, z);
 * MatrixScale(s); AssetDrawSlot(slot)`, so the node hangs off the view group,
 * as the life marker's does -- turned about y by the record's `yaw` where the
 * site calls `MatrixRotateY` between the translate and the scale (the chapter
 * card's scene-5 model), which three.js's `T R S` composes in that order. The
 * result card's glyphs and the chapter card are the list's writers today
 * (`game/class61/`, `game/class60/`). A record whose
 * slot this stage's bundle does not carry -- slot 0, which the card's first
 * string draws for its space -- has no node, as `AssetDrawSlot` draws
 * nothing for it. Nothing here is state.
 */
import type { Group, Object3D } from "three";
import { BAMS_TO_RAD } from "../core/bams";
import { G } from "../game/globals";

/** What this needs of the effect layer. */
export interface ViewSlotHost {
  /** A node for `key` at `slot` under `parent`, re-cloned when the slot moves. */
  node(key: string, slot: number, parent: Group): Object3D | null;
  /** Camera-space effects. */
  view: Group;
  /** World-space effects. */
  world: Group;
}

/** Every record of this frame's list, as keys into `seen`. */
export function drawViewSlots(h: ViewSlotHost, seen: Set<string>): void {
  G.g_view_slot_draws.forEach((d, i) => {
    if (d.slot === 0) return;
    const key = `vs${i}`;
    const node = h.node(key, d.slot, h.view);
    if (!node) return;
    seen.add(key);
    node.position.set(d.x, d.y, d.z);
    node.rotation.set(0, d.yaw * BAMS_TO_RAD, 0);
    node.scale.setScalar(d.scale);
  });
}

/** `SetDrawLayerNibble(8)`, the world's layer, which the port spells as 0. */
const WORLD_LAYER = 8;

/**
 * The asset slots a routine drew in the world this frame --
 * `G.g_world_slot_draws`, `DrawSlotInWorld` -- each at the matrix it built.
 * The matrix stack's layout is three.js's `Matrix4.elements` as it stands
 * (`game/matrix.ts`), so the node takes it whole. Original Mode's trunk, the
 * class-0x27 vehicle and every ground shadow (`game/ground_shadow.ts`) are
 * among the list's writers. A record that names its draw layer is drawn in
 * it, as the `renderOrder` the port spells a layer with -- the world's own 8
 * being 0 -- which is the shadow's `0xD`, drawn after the world it lies on.
 */
export function drawWorldSlots(h: ViewSlotHost, seen: Set<string>): void {
  G.g_world_slot_draws.forEach((d, i) => {
    if (d.slot === 0) return;
    const key = `ws${i}`;
    const node = h.node(key, d.slot, h.world);
    if (!node) return;
    seen.add(key);
    if (d.layer !== undefined) node.renderOrder = d.layer - WORLD_LAYER;
    node.matrixAutoUpdate = false;
    node.matrix.fromArray(d.m);
    node.matrixWorldNeedsUpdate = true;
  });
}

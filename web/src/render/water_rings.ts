/**
 * The flat ring a class-0x30 actor leaves on water, drawn -- the draw half of
 * `WaterRingUpdate` (`FUN_00456880`), from the record
 * `game/effects/water_ring.ts` holds:
 *
 * ```
 * Push; T(+0x40, +0x44, +0x48); Scale(+0x118, 0.2, +0x118)
 * AssetDrawSlotWithAlpha(+0x13F0, +0x1374); Pop
 * ```
 *
 * World space, no rotation, and no `SetDrawLayerNibble`: it draws in the
 * layer the task walk is in, the world's own, not over it as the effects in
 * layers 0xC and 0xE do. Nothing here is state; `update` and `resync` are the
 * same call.
 */
import { type Group, Matrix4, type Object3D } from "three";
import { G } from "../game/globals";
import { WATER_RING_HEIGHT } from "../game/effects/water_ring";
import { setSlotAlpha } from "./boss3_effects";

/** What this needs of the effect layer. */
export interface WaterRingHost {
  /** A node for `key` at `slot` under `parent`, re-cloned when the slot moves. */
  node(key: string, slot: number, parent: Group): Object3D | null;
  /** World-space effects. */
  world: Group;
}

/** The world's own translucent layer: the routine sets none. */
const WORLD_LAYER_ORDER = 0;

const _m = new Matrix4();
const _s = new Matrix4();

/** Every water ring of the frame, as keys into `seen`. */
export function drawWaterRings(h: WaterRingHost, seen: Set<string>): void {
  for (const w of G.g_water_rings) {
    const key = `wr${w.id}`;
    const node = h.node(key, w.slot, h.world);
    if (!node) continue;
    seen.add(key);
    node.matrixAutoUpdate = false;
    node.matrix.copy(_m.makeTranslation(w.pos.x, w.pos.y, w.pos.z)
      .multiply(_s.makeScale(w.size, WATER_RING_HEIGHT, w.size)));
    node.matrixWorldNeedsUpdate = true;
    node.renderOrder = WORLD_LAYER_ORDER;
    setSlotAlpha(node, w.alpha);
  }
}

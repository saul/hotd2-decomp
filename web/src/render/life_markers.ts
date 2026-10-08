/**
 * `LifeGrantedMarkerUpdate` (`FUN_0048DFE0`), drawn: the marker a civilian's
 * extra life raises.
 *
 * `MatrixLoadIdentity; MatrixTranslate(obj+0x40..0x48); MatrixScale(sub[0])`
 * and `AssetDrawSlot` -- or `AssetDrawSlotWithAlpha` over the last five
 * frames. Identity is the camera's own space, so the node hangs off the view
 * group with no turn of its own. The port steps the task and leaves what its
 * draw used on the record (`game/class10/life_marker.ts`); this places it.
 * Nothing here is state.
 */
import type { Group, Object3D } from "three";
import { G } from "../game/globals";
import { setSlotAlpha } from "./boss3_effects";

/** What this needs of the effect layer. */
export interface LifeMarkerHost {
  /** A node for `key` at `slot` under `parent`, re-cloned when the slot moves. */
  node(key: string, slot: number, parent: Group): Object3D | null;
  /** Camera-space effects. */
  view: Group;
}

/** Every live marker's draw this frame, as keys into `seen`. */
export function drawLifeMarkers(h: LifeMarkerHost, seen: Set<string>): void {
  G.g_life_granted_markers.forEach((m, i) => {
    const key = `lm${i}`;
    const node = h.node(key, m.slot, h.view);
    if (!node) return;
    seen.add(key);
    node.position.set(m.x, m.y, m.z);
    node.quaternion.identity();
    node.scale.setScalar(m.scale);
    setSlotAlpha(node, m.drawnAlpha);
  });
}

/**
 * `CivilianHitMarkerUpdate` (`FUN_0048E190`), drawn: the marker a shot
 * civilian leaves. The port re-places it in this frame's view every tick and
 * leaves the point and the draw it used on the record
 * (`game/class10/hit_marker.ts`), so the node hangs off the view group, as
 * the life marker's does: `MatrixLoadIdentity; MatrixTranslate(v);
 * MatrixScale(s)`.
 */
export function drawCivilianHitMarkers(h: LifeMarkerHost,
                                       seen: Set<string>): void {
  G.g_civilian_hit_markers.forEach((m, i) => {
    const key = `chm${i}`;
    const node = h.node(key, m.slot, h.view);
    if (!node) return;
    seen.add(key);
    node.position.set(m.drawnAt.x, m.drawnAt.y, m.drawnAt.z);
    node.quaternion.identity();
    node.scale.setScalar(m.scale);
    setSlotAlpha(node, m.drawnAlpha);
  });
}

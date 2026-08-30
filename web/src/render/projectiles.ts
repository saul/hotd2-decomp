/**
 * The weapons in flight, drawn.
 *
 * The port owns where they are — `G.g_thrown_weapons` is plain data and goes
 * in the snapshot. This owns only the nodes, keyed on the weapon's id, and
 * rebuilds the lot from that list whenever it is asked to. Which is why
 * `update` and `resync` are the same call.
 */
import { Group, Object3D, Vector3 } from "three";
import type { Context, System } from "../core/system";
import { G } from "../game/globals";

export interface SlotSource {
  cloneSlot(slot: number): Object3D | null;
}

const BAMS_TO_RAD = (Math.PI * 2) / 65536;

export class ProjectileLayer implements System {
  readonly id = "render.projectiles";
  readonly group = new Group();
  /** The character layer, which owns the per-type model templates. */
  source: SlotSource | null = null;

  private readonly nodes = new Map<number, Object3D>();
  private readonly _eye = new Vector3();

  detach(): void {
    for (const n of this.nodes.values()) n.removeFromParent();
    this.nodes.clear();
  }

  update(ctx: Context): void {
    ctx.camera.getWorldPosition(this._eye);
    const seen = new Set<number>();
    for (const w of G.g_thrown_weapons) {
      seen.add(w.id);
      let node = this.nodes.get(w.id);
      if (!node) {
        const made = this.source?.cloneSlot(w.slot);
        if (!made) continue;
        this.group.add(made);
        this.nodes.set(w.id, (node = made));
      }
      node.position.set(w.pos.x, w.pos.y, w.pos.z);
      node.visible = w.visible;
      // In flight it tumbles on its own yaw; stuck, it faces the camera.
      if (w.ttl > 0) node.rotation.set(0, 0, w.yaw * BAMS_TO_RAD);
      else node.lookAt(this._eye);
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.removeFromParent();
      this.nodes.delete(id);
    }
  }

  /** A load replaced the weapon list wholesale; rebuild against the new one. */
  resync(ctx: Context): void {
    this.detach();
    this.update(ctx);
  }
}

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
import { BAMS_TO_RAD } from "../core/bams";

export interface SlotSource {
  cloneSlot(slot: number): Object3D | null;
}

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
      if (w.ttl > 0) {
        // `ThrownWeaponFlyToTarget` accumulates the spin into `obj+0x68`, and
        // `ThrownWeaponUpdate` draws `Rz(obj+0x6C) * Ry(obj+0x68) *
        // Rx(obj+0x1364 + obj+0x64)` — so the tumble is the **Y** term, and
        // the other two are zero until it lands. This span was on Z, which
        // cartwheels the weapon sideways.
        node.rotation.set(0, w.spinAngle * BAMS_TO_RAD, 0);
      } else {
        // Landed: `AimThrownWeapon` points it back at the camera.
        node.lookAt(this._eye);
      }
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

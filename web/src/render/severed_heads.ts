/**
 * The thrown heads, drawn.
 *
 * The port owns where they are — `G.g_severed_heads` is plain data and goes in
 * the snapshot — and this owns only the nodes. Same split, same shape and the
 * same reasoning as `ProjectileLayer` next door, which is why `update` and
 * `resync` are one call.
 *
 * The model is the head bone's own asset slot, read off the actor before
 * `RemoveBoneSubtree` zeroed it, so what flies is the head that was on the
 * body — the swapped-in damaged one if it had already been shot once.
 */
import { Group, Object3D } from "three";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import { G } from "../game/globals";
import { BAMS_TO_RAD } from "../core/bams";
import type { SlotSource } from "./projectiles";

export class SeveredHeadLayer implements System<RenderContext> {
  readonly id = "render.severed_heads";
  readonly group = new Group();
  /** The character layer, which owns the per-type model templates. */
  source: SlotSource | null = null;

  private readonly nodes = new Map<number, Object3D>();

  constructor() {
    this.group.name = "severed-heads";
  }

  attach(ctx: RenderContext): void {
    this.claimSession(ctx);
  }

  /**
   * The nodes are **session** state: a seek or a load replaces the head list
   * wholesale, and a head from a future the player rewound out of must not be
   * left lying on the floor.
   */
  private claimSession(ctx: RenderContext): void {
    ctx.session.defer(() => {
      for (const n of this.nodes.values()) n.removeFromParent();
      this.nodes.clear();
    });
  }

  update(_ctx: RenderContext): void {
    const seen = new Set<number>();
    for (const h of G.g_severed_heads) {
      seen.add(h.id);
      let node = this.nodes.get(h.id);
      if (!node) {
        const made = this.source?.cloneSlot(h.slot);
        if (!made) continue;
        this.group.add(made);
        this.nodes.set(h.id, (node = made));
      }
      node.position.set(h.pos.x, h.pos.y, h.pos.z);
      // `SeveredHeadUpdate` draws under `translate * Rz(0) * Ry(+0x68) *
      // Rx(+0x64) * scale`, so the roll is fixed at zero and the tumble is the
      // other two.
      node.rotation.set(h.pitch * BAMS_TO_RAD, h.yaw * BAMS_TO_RAD, 0, "YXZ");
      node.scale.setScalar(h.scale);
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.removeFromParent();
      this.nodes.delete(id);
    }
  }

  resync(ctx: RenderContext): void {
    this.claimSession(ctx);
    this.update(ctx);
  }
}

/**
 * The weapons in flight, drawn.
 *
 * The port owns where they are and how they are turned — `G.g_thrown_weapons`
 * is plain data and goes in the snapshot, and each record carries the
 * modelview its own routine built this frame (`ThrownWeapon.draw`). This owns
 * only the nodes, keyed on the weapon's id, and rebuilds the lot from that
 * list whenever it is asked to. Which is why `update` and `resync` are the
 * same call.
 */
import { Group, Object3D } from "three";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import { G } from "../game/globals";

export interface SlotSource {
  cloneSlot(slot: number): Object3D | null;
}

export class ProjectileLayer implements System<RenderContext> {
  readonly id = "render.projectiles";
  /**
   * **Camera space.** Both weapon routines draw under the camera's matrix —
   * `MatrixStackPush(0)` on a stack whose base is `g_camera_world_to_view` —
   * so what the port hands over is a modelview, and this group carries the
   * camera's own world matrix, written once a frame, to take it back out.
   * The same arrangement `EffectLayer.viewGroup` uses for the carried props.
   */
  readonly group = new Group();
  /** The character layer, which owns the per-type model templates. */
  source: SlotSource | null = null;

  private readonly nodes = new Map<number, Object3D>();

  constructor() {
    this.group.name = "projectiles-view";
    this.group.matrixAutoUpdate = false;
  }

  /**
   * The nodes are **session** state: they track `G.g_thrown_weapons`, which a
   * seek replaces wholesale. Registering them there rather than clearing them
   * by hand is what stops a weapon from a future the player rewound out of
   * still hanging in the air.
   */
  attach(ctx: RenderContext): void {
    this.claimSession(ctx);
  }

  private claimSession(ctx: RenderContext): void {
    ctx.session.defer(() => {
      for (const n of this.nodes.values()) n.removeFromParent();
      this.nodes.clear();
    });
  }

  update(ctx: RenderContext): void {
    this.group.matrix.copy(ctx.camera.matrixWorld);
    this.group.matrixWorldNeedsUpdate = true;
    const seen = new Set<number>();
    for (const w of G.g_thrown_weapons) {
      seen.add(w.id);
      let node = this.nodes.get(w.id);
      if (!node) {
        const made = this.source?.cloneSlot(w.slot);
        if (!made) continue;
        made.matrixAutoUpdate = false;
        this.group.add(made);
        this.nodes.set(w.id, (node = made));
      }
      // `AssetDrawSlot` under the routine's own matrix, or nothing: a frame
      // the routine did not draw -- the blink's off half -- has no matrix.
      // `Rz · Ry · Rx` in the engine's order, with `obj+0x1364` in the X term
      // for class 0x31 alone; see `game/thrown_weapon.ts`.
      node.visible = w.draw !== null;
      if (w.draw) {
        node.matrix.fromArray(w.draw);
        node.matrixWorldNeedsUpdate = true;
      }
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.removeFromParent();
      this.nodes.delete(id);
    }
  }

  /**
   * A load replaced the weapon list wholesale. The previous session scope has
   * already dropped the nodes; this claims the new one and rebuilds.
   */
  resync(ctx: RenderContext): void {
    this.claimSession(ctx);
    this.update(ctx);
  }
}

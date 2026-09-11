/**
 * The weapons in flight, drawn.
 *
 * The port owns where they are — `G.g_thrown_weapons` is plain data and goes
 * in the snapshot. This owns only the nodes, keyed on the weapon's id, and
 * rebuilds the lot from that list whenever it is asked to. Which is why
 * `update` and `resync` are the same call.
 */
import { Group, Object3D, Vector3 } from "three";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import { G } from "../game/globals";
import { BAMS_TO_RAD } from "../core/bams";

export interface SlotSource {
  cloneSlot(slot: number): Object3D | null;
}

export class ProjectileLayer implements System<RenderContext> {
  readonly id = "render.projectiles";
  readonly group = new Group();
  /** The character layer, which owns the per-type model templates. */
  source: SlotSource | null = null;

  private readonly nodes = new Map<number, Object3D>();
  private readonly _eye = new Vector3();

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
        // Both draw routines emit the same product — `ThrownWeaponUpdate`
        // (`FUN_00450780`) and `ZombieThrownWeaponUpdate` (`FUN_0045A4F0`)
        // each do `Rz(obj+0x6C) * Ry(obj+0x68) * Rx(obj+0x1364 + obj+0x64)` —
        // so the order here is `ZYX`, and the X term carries the constant
        // `obj+0x1364` tilt whether or not anything is tumbling.
        //
        // **The two families tumble about different axes**, which is why this
        // reads `w.axis` rather than always filling in Y. Class 0x31
        // accumulates into `obj+0x68` and class 0x30 into `obj+0x64`; see
        // `ThrownWeapon.axis` for the two instructions. This span was on Z
        // once and then on Y for everything, and Y is right for only half of
        // the throwers — a class-0x30 axe cartwheeled.
        const turn = w.spinAngle * BAMS_TO_RAD;
        node.rotation.order = "ZYX";
        node.rotation.set(w.tilt * BAMS_TO_RAD + (w.axis === "x" ? turn : 0),
                          w.axis === "y" ? turn : 0, 0);
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

  /**
   * A load replaced the weapon list wholesale. The previous session scope has
   * already dropped the nodes; this claims the new one and rebuilds.
   */
  resync(ctx: RenderContext): void {
    this.claimSession(ctx);
    this.update(ctx);
  }
}

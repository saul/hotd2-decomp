/**
 * The fifteen pieces of a shattered stacked prop, drawn.
 *
 * `game/class41/shatter.ts` owns where they are -- `G.g_prop_shatters` is
 * plain data and goes in the snapshot -- and this owns only the nodes, fifteen
 * per shatter object, keyed on its id. Same split and the same shape as
 * `SeveredHeadLayer`, which is why `update` and `resync` are one call. The
 * draw it stands for is the inner half of `BreakablePropShatterUpdate`
 * (`FUN_004653B0`):
 *
 * ```c
 * MatrixStackPush(0);
 * MatrixTranslate(x[i], y[i], z[i]);
 * MatrixRotateZ(rz[i]); MatrixRotateY(ry[i]); MatrixRotateX(rx[i]);
 * AssetDrawSlot(obj+0x36 ? g_shatter_fragment_slots_b[i]
 *                        : g_shatter_fragment_slots_a[i]);
 * MatrixStackPop(1);
 * ```
 *
 * Which slot is the routine's decision and the port leaves it on each piece;
 * the models are the breakable rig's templates, which `render/breakables.ts`
 * adopts and lends this as a {@link SlotSource}.
 */
import { Group, type Object3D } from "three";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import { G } from "../game/globals";
import { BAMS_TO_RAD } from "../core/bams";
import type { SlotSource } from "./projectiles";

export class PropShatterLayer implements System<RenderContext> {
  readonly id = "render.prop_shatter";
  readonly group = new Group();
  /** The breakable layer, which owns the prop rig's templates. */
  source: SlotSource | null = null;

  private readonly nodes = new Map<number, Object3D[]>();

  constructor() {
    this.group.name = "prop-shatters";
  }

  attach(ctx: RenderContext): void {
    this.claimSession(ctx);
  }

  /**
   * The nodes are **session** state: a seek or a load replaces the pool
   * wholesale, and pieces from a future the player rewound out of must not be
   * left in the air.
   */
  private claimSession(ctx: RenderContext): void {
    ctx.session.defer(() => {
      for (const pieces of this.nodes.values()) {
        for (const n of pieces) n.removeFromParent();
      }
      this.nodes.clear();
    });
  }

  update(_ctx: RenderContext): void {
    const seen = new Set<number>();
    for (const s of G.g_prop_shatters) {
      seen.add(s.id);
      let pieces = this.nodes.get(s.id);
      if (!pieces) {
        pieces = s.pieces.map((q) => {
          const n = this.source?.cloneSlot(q.slot) ?? new Group();
          // `RotZ; RotY; RotX` post-multiplied: X first on the model, then Y,
          // then Z -- three.js's "ZYX" order is that product.
          n.rotation.order = "ZYX";
          this.group.add(n);
          return n;
        });
        this.nodes.set(s.id, pieces);
      }
      s.pieces.forEach((q, i) => {
        const n = pieces[i];
        if (!n) return;
        n.position.set(q.x, q.y, q.z);
        n.rotation.set(q.rx * BAMS_TO_RAD, q.ry * BAMS_TO_RAD,
                       q.rz * BAMS_TO_RAD);
      });
    }
    for (const [id, pieces] of this.nodes) {
      if (seen.has(id)) continue;
      for (const n of pieces) n.removeFromParent();
      this.nodes.delete(id);
    }
  }

  resync(ctx: RenderContext): void {
    this.claimSession(ctx);
    this.update(ctx);
  }
}

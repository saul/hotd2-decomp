/**
 * The weapons in flight, drawn.
 *
 * The port owns where they are and how they are turned — `G.g_thrown_weapons`
 * is plain data and goes in the snapshot, and each record carries the
 * modelview its own routine built this frame (`ThrownWeapon.draw`). This owns
 * only the nodes, keyed on the weapon's id, and rebuilds the lot from that
 * list whenever it is asked to. Which is why `update` and `resync` are the
 * same call.
 *
 * ## The light an afterimage is drawn under
 *
 * `zslman`'s afterimages (`ZslmanBladeAfterimageFade`, `FUN_00450A30`) call
 * `SetRenderLightColour` (`FUN_004AA0A0`) with a light that falls a fifteenth
 * a frame, and the record carries what they handed it (`lightColour`). The
 * engine lights with the fixed-function pipeline, `COLORVERTEX` off and every
 * material source the material, and `SetLightingDefaultSingle` scales *both*
 * ambient terms and the diffuse by the light colour — so the lit colour is
 * the light colour times whatever it would have been under white, and that
 * multiply is what is reproduced here, on the unlit colour this layer draws
 * everything with. `[likely]`: the scene's ambient scalar, which is the rest
 * of that product, is not applied to projectiles at all (the lighting view
 * does not reach this group), so a light of 1.0 draws as the unlit model does.
 * A light below zero draws as black — D3D clamps a lit colour to [0, 1] — and
 * the models are additive, so black adds nothing.
 *
 * It is a gamma-space multiplier, converted as `render/lighting.ts` explains:
 * `L' = L^γ`.
 *
 * `[diverges]` The engine's light colour is global state and the afterimage
 * never puts it back, so whatever the task walk draws next without a light of
 * its own is lit by the last afterimage too — a blade thrown after one of its
 * sibling's afterimages among them. The port lights nothing in this group
 * but the afterimages, and each only by its own light.
 */
import {
  Color, Group, Mesh, Object3D, SRGBColorSpace, type Material,
} from "three";
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
  /**
   * The nodes a light colour tints: each mesh's own material clone, and the
   * colour it had before the tint. Cloned the first time a record asks,
   * because the template's materials are shared with every other clone of
   * the slot.
   */
  private readonly tinted = new Map<number, { mat: Material & { color: Color };
                                              base: Color }[]>();
  private readonly tint = new Color();

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
      for (const ts of this.tinted.values()) {
        for (const t of ts) t.mat.dispose();
      }
      this.tinted.clear();
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
      if (w.draw && w.lightColour) this.applyLight(w.id, node, w.lightColour);
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.removeFromParent();
      this.nodes.delete(id);
      for (const t of this.tinted.get(id) ?? []) t.mat.dispose();
      this.tinted.delete(id);
    }
  }

  /**
   * `SetRenderLightColour(r, g, b)` for one node's draw: every mesh's colour
   * is its own times the light, clamped and taken out of gamma space.
   */
  private applyLight(id: number, node: Object3D,
                     rgb: readonly [number, number, number]): void {
    let mats = this.tinted.get(id);
    if (!mats) {
      mats = [];
      node.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const own = (m: Material): Material => {
          const c = m.clone() as Material & { color?: Color };
          if (c.color) {
            mats!.push({ mat: c as Material & { color: Color },
                         base: c.color.clone() });
          }
          return c;
        };
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(own) : own(mesh.material);
      });
      this.tinted.set(id, mats);
    }
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    this.tint.setRGB(clamp(rgb[0]), clamp(rgb[1]), clamp(rgb[2]),
                     SRGBColorSpace);
    for (const t of mats) t.mat.color.copy(t.base).multiply(this.tint);
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

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
 * The engine's light colour is global state and the afterimage never puts it
 * back; what the port does instead is declared on `applyLight`.
 *
 * ## The ground shadow
 *
 * Both weapon families also draw slot `0x10D0` under the weapon every frame
 * it is drawn (`ActorDrawGroundShadowWithSize`, `FUN_0040A600`), and the
 * record carries that matrix too (`ThrownWeapon.shadow`). The disc is not one
 * of the throwers' own models, so it comes from the `slots_actor` templates
 * the exporter emits for classes 0x30 and 0x31 (`shadows`), drawn in the
 * routine names, `0xD`, as the `renderOrder` the port spells a layer with.
 */
import {
  Color, Group, Mesh, Object3D, SRGBColorSpace, type Material,
} from "three";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import { G } from "../game/globals";
import { GROUND_SHADOW_LAYER, GROUND_SHADOW_SLOT } from "../game/ground_shadow";

export interface SlotSource {
  cloneSlot(slot: number): Object3D | null;
}

/** Where the ground shadow's model comes from: `render/slotmodels.ts`. */
export interface TemplateSource {
  cloneTemplate(slot: number): Object3D | null;
}

/** `SetDrawLayerNibble(8)`, the world's layer, which the port spells as 0. */
const WORLD_LAYER = 8;

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
  /** The slot-model layer, which owns the ground shadow's template. */
  shadows: TemplateSource | null = null;

  private readonly nodes = new Map<number, Object3D>();
  /** Each weapon's ground-shadow node, by the weapon's id. */
  private readonly shadowNodes = new Map<number, Object3D>();
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
      for (const n of this.shadowNodes.values()) n.removeFromParent();
      this.shadowNodes.clear();
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
      this.placeShadow(w.id, w.shadow);
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
    for (const [id, node] of this.shadowNodes) {
      if (seen.has(id)) continue;
      node.removeFromParent();
      this.shadowNodes.delete(id);
    }
  }

  /**
   * `AssetDrawSlot(0x10D0)` under the matrix the weapon's routine recorded,
   * in draw layer `0xD`, or nothing on a frame it drew none. A modelview,
   * like the weapon's own.
   */
  private placeShadow(id: number, m: readonly number[] | null): void {
    let node = this.shadowNodes.get(id);
    if (!node && m) {
      const made = this.shadows?.cloneTemplate(GROUND_SHADOW_SLOT) ?? null;
      if (!made) return;
      made.matrixAutoUpdate = false;
      // As `render/slotmodels.ts` spells a layer: on the node, the world's
      // own 8 being 0.
      made.renderOrder = GROUND_SHADOW_LAYER - WORLD_LAYER;
      this.group.add(made);
      this.shadowNodes.set(id, (node = made));
    }
    if (!node) return;
    node.visible = m !== null;
    if (m) {
      node.matrix.fromArray(m);
      node.matrixWorldNeedsUpdate = true;
    }
  }

  /**
   * `SetRenderLightColour(r, g, b)` for one node's draw: every mesh's colour
   * is its own times the light, clamped and taken out of gamma space.
   *
   * `[diverges]` The engine's light colour is global state, and
   * `ZslmanBladeAfterimageFade` never puts it back, so whatever the task walk
   * draws next without a light of its own is lit by the last afterimage too —
   * a blade thrown after one of its sibling's afterimages among them. This
   * tints only the node whose record set the light: the port lights nothing
   * else in this group, and the scene's own light never reaches it.
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

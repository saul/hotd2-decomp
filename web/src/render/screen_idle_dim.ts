/**
 * The shell screens' idle dimmer, drawn.
 *
 * `ScreenIdleDim` (`FUN_00413CC0`) decides it in `game/` and records the
 * alpha in `G.g_screen_idle_dim`; what it draws is asset slot `0x93E`
 * (`pol/common.bin` entry 129) under the identity -- camera space --
 * translated `(0, 0, -0.2)` and scaled `(1, 2, 1)`, through
 * `AssetDrawSlotWithAlpha`. This layer is that draw and owns nothing else: a
 * camera-riding group, one clone of the slot from the effect layer's
 * templates, and the alpha as `setAssetDrawAlpha` gives a faded asset.
 *
 * The group is kept while the stage is released (`keepOnGameOver`): the
 * screens that dim -- the options list and its sub-screens -- are exactly the
 * ones that have released it.
 */
import { Group, type Object3D } from "three";
import type { System } from "../core/system";
import { G } from "../game/globals";
import { SCREEN_IDLE_DIM_SLOT } from "../game/options_data";
import type { RenderContext } from "./context";
import { releaseAssetDrawAlpha, setAssetDrawAlpha } from "./draw_order";

/** `PUSH 0xBE4CCCCD` at `0x00413D33`: z -0.2. */
const DIM_Z = -0.2;
/** `MatrixScale(1, 2, 1)` at `0x00413D50`. */
const DIM_SCALE_Y = 2;

export class ScreenIdleDimLayer implements System<RenderContext> {
  readonly id = "render.screen_idle_dim";
  readonly group = new Group();
  /** A fresh clone of a slot's model, or null: the effect layer's. */
  cloneSlot: (slot: number) => Object3D | null = () => null;
  private node: Object3D | null = null;

  constructor() {
    this.group.name = "screen_idle_dim";
    this.group.matrixAutoUpdate = false;
    this.group.userData.keepOnGameOver = true;
  }

  update(ctx: RenderContext): void {
    const alpha = G.g_screen_idle_dim;
    if (!(alpha > 0)) {
      if (this.node) this.node.visible = false;
      return;
    }
    if (!this.node) {
      this.node = this.cloneSlot(SCREEN_IDLE_DIM_SLOT);
      if (!this.node) return;
      this.group.add(this.node);
    }
    this.group.matrix.copy(ctx.camera.matrixWorld);
    this.group.matrixWorldNeedsUpdate = true;
    const n = this.node;
    n.visible = true;
    n.position.set(0, 0, DIM_Z);
    n.quaternion.identity();
    n.scale.set(1, DIM_SCALE_Y, 1);
    setAssetDrawAlpha(n, alpha);
    // Over the 3D frame. `[open]` how it sits against the screen's 2D quads:
    // the engine draws it first and the tiles and glyphs after, at depths the
    // PVR2 compare decides; here the HUD canvas's glyphs are over the WebGL
    // canvas whatever this does, and the deep background is under it.
    n.renderOrder = 950;
  }

  resync(ctx: RenderContext): void {
    if (this.node) {
      releaseAssetDrawAlpha(this.node);
      this.node.removeFromParent();
      this.node = null;
    }
    this.update(ctx);
  }
}

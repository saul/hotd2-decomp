/**
 * Asset slots drawn in the camera's own space, recorded for the renderer.
 *
 * A routine that draws a model as screen furniture -- the result card's
 * glyphs, `ResultCardDrawScore` (`FUN_004362E0`), `ResultCardDrawAccuracy`
 * (`FUN_00436620`) -- does it with the same five calls every time:
 *
 * ```
 * MatrixStackPush(0); MatrixLoadIdentity();
 * MatrixTranslate(x, y, z); MatrixScale(s, s, s); NoOpStub(s);
 * AssetDrawSlot(slot); MatrixStackPop(1)
 * ```
 *
 * `MatrixLoadIdentity` is what puts the model in camera space: the stack's
 * base is the view, and identity on top of it is the eye's own frame, `-z`
 * ahead (`RenderInitStates` flips z into D3D's). The renderer may not call
 * into the port, so the call is recorded into `G.g_view_slot_draws` --
 * cleared at the head of every frame's player walk with the screen sprites --
 * and `render/effects.ts` draws whatever the list holds, in its camera group.
 *
 * One site turns the model between the translate and the scale: the chapter
 * card's scene-5 arm, `MatrixTranslate(0, 0, -30); MatrixRotateY(0x8000);
 * MatrixScale(2, 2, 2)` (`0x0043476C`..`0x00434793`). A turn after the
 * translate and before the scale is the node's own rotation, which is how
 * three.js composes `T R S`.
 */
import { G } from "./globals";

/**
 * One `AssetDrawSlot` under `MatrixLoadIdentity`.
 *
 * `[port-only]` as a record: the engine draws the model at once. The fields
 * are the calls' own arguments.
 */
export interface ViewSlotDraw {
  /** The asset slot `AssetDrawSlot` (`FUN_00418560`) was handed. */
  slot: number;
  /** `MatrixTranslate`'s three arguments, in the camera's space. */
  x: number;
  y: number;
  z: number;
  /** `MatrixScale`'s, one value for all three axes at every caller. */
  scale: number;
  /**
   * `MatrixRotateY`'s BAMS argument, between the translate and the scale, at
   * the one site that has one; 0 -- no call -- everywhere else.
   */
  yaw: number;
}

/**
 * The five calls above, recorded -- six with a `MatrixRotateY`, whose angle
 * is `yaw`. `[port-only]` as a function: the engine writes them out at each
 * site; every argument is the site's own.
 */
export function DrawSlotInView(slot: number, x: number, y: number, z: number,
                               scale: number, yaw = 0): void {
  G.g_view_slot_draws.push({ slot, x, y, z, scale, yaw });
}

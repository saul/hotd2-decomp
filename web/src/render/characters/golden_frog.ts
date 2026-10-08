/**
 * The golden frog, drawn: what `GoldenFrogUpdate` (`FUN_00471FA0`) draws
 * besides its skeleton, and the light it draws the skeleton under.
 *
 * The port decides both and leaves them on the frog's words
 * (`game/class41/golden_frog.ts`):
 *
 * * **The light.** The routine turns the light's direction every frame and
 *   sets it before `DrawSkinnedModelAndShadow`, and nothing else of the
 *   light: `GoldenFrogWords.drawDir`, or null where Training held it, which
 *   is the scene's. It goes on the model as `userData.hod2_light_set` with
 *   the block's ambient and colour, which `render/lighting.ts` reads.
 * * **The score strip.** `AssetDrawSlot(obj+0x13F0 + obj+0x1350)` under
 *   `T(obj+0x40) Ry(obj+0x68)`, after the model: `GoldenFrogWords.stripDraw`,
 *   the slot and the world matrix. The model is a clone off type `0x1C`'s
 *   hidden template, which the exporter gives both players' strips
 *   (`GOLDEN_FROG_STRIP_SLOTS`), hung beside the frog's root.
 *
 * The fade `GoldenFrogDrawBonePart` (`FUN_00463F90`) draws every node with
 * from the strip's 25th frame is `Actor.nodeDrawAlpha`, which
 * `draw_gates.ts` applies as it does every class's hook.
 *
 * Render bookkeeping only; the words carry everything in the snapshot.
 */
import { Matrix4, type Object3D } from "three";
import { PropContainerRoutine } from "../../game/class41/placer_state";
import { SpawnClass } from "../../game/spawn_class";
import type { Instance } from "./instance";

const _m = new Matrix4();
const _inv = new Matrix4();

/**
 * One golden frog's frame: its light, and its strip shown, moved or hidden.
 * `cloneSlot` is the character layer's. Does nothing for any other actor.
 */
export function syncGoldenFrogDraw(
    inst: Instance, cloneSlot: (slot: number) => Object3D | null): void {
  const a = inst.a;
  if (a.cls !== SpawnClass.PropContainerPlacer
      || a.placer.routine !== PropContainerRoutine.GoldenFrog) return;
  const w = a.placer.frog;
  if (!w) return;
  if (w.drawDir) {
    inst.root.userData.hod2_light_set = { ambient: null, dir: [...w.drawDir],
                                          rgb: null };
  } else {
    delete inst.root.userData.hod2_light_set;
  }
  const draw = w.stripDraw;
  let strip = inst.frogStrip;
  if (strip && (!draw || strip.slot !== draw.slot)) {
    strip.node?.removeFromParent();
    strip = inst.frogStrip = undefined;
  }
  if (!draw) return;
  if (!strip) {
    const node = cloneSlot(draw.slot);
    strip = inst.frogStrip = { slot: draw.slot, node };
    if (node) {
      node.matrixAutoUpdate = false;
      // Drawn after `SetRenderLightDirection(&g_scene_light_dir_view)` put
      // the scene's direction back: not under the frog's set, which the
      // root carries and a child would otherwise take.
      node.userData.hod2_light_colour = null;
      inst.root.add(node);
    }
  }
  if (!strip.node) return;
  // The strip is a world matrix; it hangs under the root, so the root's own
  // matrix comes back off.
  inst.root.updateMatrix();
  _inv.copy(inst.root.matrix).invert();
  _m.fromArray(draw.m);
  strip.node.matrix.multiplyMatrices(_inv, _m);
  strip.node.matrixWorldNeedsUpdate = true;
}

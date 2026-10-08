/**
 * Class 0x41 constructor 61's figures, lit.
 *
 * `Type61FigureUpdate` (`FUN_004729E0`) draws each figure between
 * `LightsUseSecondarySet` and `LightsRestoreScene`, and between the two
 * replaces block 1's direction with one of its own: `BuildSceneLightDirection
 * (0, 0x4000)`'s **world** vector handed to the device as a view one, so the
 * figures are lit from the screen's right whichever way the camera looks. The
 * port runs that in the game and leaves the direction it set on the figure,
 * `PropContainerTail.drawDir`, in the world encoding `render/lighting.ts`
 * reads (`game/class41/type61.ts`). This tags the figure's model with it as
 * `userData.hod2_light_set` -- block 1's ambient and colour, the figure's
 * direction -- which every node under the root inherits.
 *
 * Nothing here is state: the tag is rewritten from the tail every frame.
 */
import { PropContainerRoutine } from "../../game/class41/placer_state";
import { SpawnClass } from "../../game/spawn_class";
import type { Instance } from "./instance";

/**
 * Tag one constructor-61 figure's model with the light its draw was made
 * under. Returns false, and touches nothing, for any other actor.
 */
export function syncType61FigureLight(inst: Instance): boolean {
  const a = inst.a;
  if (a.cls !== SpawnClass.PropContainerPlacer
      || a.placer.routine !== PropContainerRoutine.Type61Figure) return false;
  inst.root.userData.hod2_light_set = {
    ambient: null, dir: [...a.placer.drawDir], rgb: null,
  };
  return true;
}

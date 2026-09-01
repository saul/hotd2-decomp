/**
 * The `Context`, widened for the layers that draw.
 *
 * `core/system.ts` deliberately has no scene and no camera: the engine's half
 * of the player runs headless, and a framework type that names a `Scene` makes
 * that impossible for everything downstream of it. So the renderer's view is
 * declared here instead, and `System` is generic over which of the two a layer
 * takes.
 *
 * There is still only ever **one** context object at run time. `app/` builds
 * it and names this as its type; a system that declares plain `Context` is
 * accepted by the same `World`, because a function that takes the narrow one
 * takes the wide one too. The split is entirely a matter of what each layer is
 * allowed to see.
 */
import type { PerspectiveCamera, Scene } from "three";
import type { Context } from "../core/system";

export interface RenderContext extends Context {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
}

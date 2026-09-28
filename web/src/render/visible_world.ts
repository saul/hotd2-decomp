/**
 * World matrices for what will be drawn, and nothing else.
 *
 * `WebGLRenderer.render` starts with `scene.updateMatrixWorld()`, and that
 * walks **every** node: it recomposes each local matrix and multiplies it into
 * the world, visible or not. A stage keeps all its regions in the scene and
 * shows the few the camera is in, so stage 1 is about 12,500 nodes of which
 * about 1,800 are drawn -- and on a phone slowed four times the walk was the
 * largest single cost in the frame, a quarter of it and more, spent on world
 * matrices nothing read.
 *
 * So `app/` turns the scene's automatic update off and calls this before each
 * render. It is `Object3D.updateMatrixWorld` line for line (three r169),
 * with one change: it does not descend into a child whose `visible` is false,
 * which is exactly the rule `projectObject` already uses to decide what is
 * drawn. A branch that is shown again is brought up to date on the frame it
 * appears: its own `updateMatrix` flags it, and it multiplies against a
 * parent that this same walk has just updated, since a visible node's parents
 * are all visible.
 *
 * What it gives up is a current `matrixWorld` on a hidden node **without
 * asking for one**. Every reader in this tree asks -- `getWorldPosition`,
 * `updateWorldMatrix(true, false)`, `updateMatrixWorld(true)` on the node it
 * is about to read -- and a reader added later has to as well.
 */
import { Object3D } from "three";

const BASE = Object3D.prototype.updateMatrixWorld;

export function updateVisibleMatrixWorld(o: Object3D, force = false): void {
  // A class with its own update -- a camera also refreshes its inverse -- is
  // left to it, as three's walk would have: rare, and whole-subtree.
  if (o.updateMatrixWorld !== BASE) {
    o.updateMatrixWorld(force);
    return;
  }
  if (o.matrixAutoUpdate) o.updateMatrix();
  if (o.matrixWorldNeedsUpdate || force) {
    if (o.matrixWorldAutoUpdate) {
      if (o.parent === null) o.matrixWorld.copy(o.matrix);
      else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    }
    o.matrixWorldNeedsUpdate = false;
    force = true;
  }
  const children = o.children;
  for (let i = 0, n = children.length; i < n; i++) {
    const c = children[i];
    if (c.visible) updateVisibleMatrixWorld(c, force);
  }
}

/**
 * Scope helpers for three.js.
 *
 * `core/scope.ts` knows how to undo things; this knows what needs undoing in a
 * scene graph. The test of whether these are good enough is that the nine
 * hand-written `detach()` methods in `render/` disappear — if a layer still
 * needs one after this, a helper is missing rather than the layer being
 * special.
 *
 * Note what is *not* here: nothing takes a `Scene`. A layer owns nodes and
 * resources, never the scene it hangs them in.
 */
import type { BufferGeometry, Material, Object3D, Texture } from "three";
import type { Scope } from "../core/scope";

/** Add a node to a parent now, and remove it when the scope dies. */
export function attachTo<T extends Object3D>(scope: Scope, parent: Object3D,
                                             node: T): T {
  parent.add(node);
  scope.defer(() => node.removeFromParent());
  return node;
}

/**
 * Own every unique geometry, material and texture in a subtree.
 *
 * Unique is the operative word: three.js shares both freely, and disposing a
 * geometry two meshes point at is how a stage switch empties half the next
 * stage. The `Set`s are the whole reason this is a helper and not a loop at
 * each call site.
 *
 * **Only for resources this scope created** — typically a clone. Calling it on
 * a subtree loaded from the bundle would dispose geometry the templates still
 * point at.
 */
export function ownResources(scope: Scope, root: Object3D): void {
  const geos = new Set<BufferGeometry>();
  const mats = new Set<Material>();
  const texs = new Set<Texture>();

  root.traverse((o) => {
    const m = o as Object3D & {
      geometry?: BufferGeometry; material?: Material | Material[];
    };
    if (m.geometry) geos.add(m.geometry);
    if (!m.material) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!mat) continue;
      mats.add(mat);
      // The maps a material carries are resources of their own, and the
      // material's own `dispose` does not touch them.
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
        const t = v as Texture | null;
        if (t && typeof t === "object" && (t as { isTexture?: boolean }).isTexture) {
          texs.add(t);
        }
      }
    }
  });

  for (const g of geos) scope.own(g);
  for (const m of mats) scope.own(m);
  for (const t of texs) scope.own(t);
}

/**
 * Clone a template, hang it under `parent`, and own everything the clone made
 * of its own.
 *
 * `Object3D.clone()` shares geometry and materials with the template by
 * design, so the clone itself owns nothing — which is why this only registers
 * the node's removal. Use `ownResources` on top when a caller has actually
 * duplicated a resource, as the gore swap does.
 */
export function cloneInto(scope: Scope, parent: Object3D,
                          template: Object3D): Object3D {
  return attachTo(scope, parent, template.clone());
}

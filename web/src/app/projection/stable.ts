/**
 * Structural sharing: the projection keeps the references it can.
 *
 * What this replaces is `projectionKey`, which was `JSON.stringify` of the
 * whole projection, once a frame, compared against the last string. That
 * worked, and it was a workaround for the real problem rather than a solution
 * to it: the builder allocated a fresh object for every slice on every frame,
 * so **every** `memo` in `ui/` saw new props and re-rendered, and the only
 * thing standing between that and sixty full re-renders a second was one
 * string compare at the root. All or nothing.
 *
 * The fix is to make the projection reference-stable slice by slice, so that
 * `memo` becomes the diff — a panel whose slice did not change gets the same
 * object it had last frame and does not re-render, whatever else moved.
 *
 * Three properties worth stating, because each one is load-bearing:
 *
 * * **It is generic.** A hand-listed set of fields goes stale the first time
 *   one is added, silently, in the direction of doing more work. This walks
 *   whatever is there.
 * * **It short-circuits.** `JSON.stringify` had to serialise the whole value
 *   before it could tell you the first field differed. This stops there.
 * * **It costs nothing on the big slices.** The script tree and the event feed
 *   are held by reference and replaced rather than mutated, so `Object.is`
 *   settles them before any walk begins. That is what `treeVersion` and
 *   `feedVersion` were for, and why they are gone.
 */

/**
 * Structural equality over plain data.
 *
 * The projection's own rule is that everything in it is numbers, strings,
 * booleans and arrays of them — the `structuredClone` test. So there are no
 * `Set`s, `Map`s, class instances or cycles to consider here, and a value
 * that broke that rule would already have broken the snapshot it is modelled
 * on.
 */
export function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object"
      || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.hasOwn(b as object, k)) return false;
    if (!equal((a as Record<string, unknown>)[k],
               (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

/**
 * `next`, with every unchanged slice replaced by the one `prev` already had.
 *
 * Returns **`prev` itself** when nothing changed at all, which is what lets
 * `UiStore.publish` decide whether to notify with an identity test rather than
 * a comparison of its own. One rule, applied at one place, and the whole of
 * "has the UI changed" falls out of it.
 */
export function stabilise<T extends object>(prev: T | null, next: T): T {
  if (!prev) return next;
  const out = { ...next } as Record<string, unknown>;
  const old = prev as unknown as Record<string, unknown>;
  let unchanged = true;
  for (const k of Object.keys(out)) {
    if (Object.is(old[k], out[k])) continue;
    if (equal(old[k], out[k])) out[k] = old[k];   // keep the old reference
    else unchanged = false;
  }
  // A key that `prev` has and `next` does not would be missed by the loop
  // above, so the shape is checked once rather than trusted.
  if (unchanged && Object.keys(old).length !== Object.keys(out).length) {
    unchanged = false;
  }
  return unchanged ? prev : (out as T);
}

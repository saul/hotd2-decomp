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
 * The fix is to make the projection reference-stable slice by slice, and node
 * by node inside each slice, so that `memo` becomes the diff — a panel, a
 * group or a row whose value did not change gets the same object it had last
 * frame and does not re-render, whatever else moved.
 *
 * Five properties worth stating, because each one is load-bearing:
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
 * * **It walks once.** The first version of this file asked
 *   `equal(old[k], next[k])`, threw that answer away, and then assigned
 *   `out[k] = old[k]` — a second walk over a tree the first walk had just
 *   finished describing, on every slice that had not changed, which is most of
 *   them on most frames. `share` below returns the value to keep instead of a
 *   boolean, so the answer *is* the walk's result and there is nothing left to
 *   do with it.
 * * **It shares at every depth.** Sharing used to stop at the projection's
 *   top-level keys. One actor moving out of forty made `actorPanel` a new
 *   object and every group inside it a new object too, so a `memo` on a group
 *   or a row could never bail — "`memo` is the diff" was true only at slice
 *   granularity, which is coarser than it reads. A value that genuinely
 *   differs now still hands back its unchanged children as `prev`'s objects,
 *   so a sibling that did not move keeps its identity however deep it sits.
 */

/**
 * `next`, with every child that did not change replaced by `prev`'s.
 *
 * Returns **`prev` itself** when the two are deeply equal. That single rule is
 * the whole file: "did anything change?" and "what should I keep?" are the
 * same question asked of the same call, which is why there is no second pass.
 *
 * The projection's own rule is that everything in it is numbers, strings,
 * booleans and arrays and objects of them — the `structuredClone` test. So
 * there are no `Set`s, `Map`s, class instances or cycles to consider here, and
 * a value that broke that rule would already have broken the snapshot it is
 * modelled on.
 *
 * `Object.is` rather than `===` on the leaves: a `NaN` that stayed `NaN` is
 * not a change anybody can see, and it is the only comparison that says so.
 */
function share(prev: unknown, next: unknown): unknown {
  if (Object.is(prev, next)) return prev;
  if (typeof prev !== "object" || typeof next !== "object"
      || prev === null || next === null) {
    return next;
  }
  const isArray = Array.isArray(prev);
  if (isArray !== Array.isArray(next)) return next;
  return isArray
    ? shareArray(prev as unknown[], next as unknown[])
    : shareObject(prev as Record<string, unknown>,
                  next as Record<string, unknown>);
}

/**
 * Element by element, allocating only once something has actually moved.
 *
 * An array whose length changed is a new array whatever else is true, but its
 * elements are still shared: one actor leaving a list of forty must not hand
 * the other thirty-nine to `memo` as new objects. Until the first difference
 * every element has come back as `prev`'s, so the copy made there is filled in
 * from `prev` behind the cursor rather than from `next`.
 */
function shareArray(prev: readonly unknown[], next: readonly unknown[]): unknown {
  let out: unknown[] | null = prev.length === next.length ? null : [...next];
  for (let i = 0; i < next.length; i++) {
    const child = i < prev.length ? share(prev[i], next[i]) : next[i];
    if (out) {
      out[i] = child;
    } else if (!Object.is(child, prev[i])) {
      out = [...next];
      for (let j = 0; j < i; j++) out[j] = prev[j];
      out[i] = child;
    }
  }
  return out ?? prev;
}

/**
 * Key by key, on `next`'s keys, with the two key counts compared up front.
 *
 * The count is what catches a key `prev` has and `next` does not, which a loop
 * over `next` alone would walk straight past and call unchanged. Equal counts
 * with different names are caught by `Object.hasOwn`: a key `prev` never had
 * cannot have kept its value.
 */
function shareObject(prev: Record<string, unknown>,
                     next: Record<string, unknown>): unknown {
  const keys = Object.keys(next);
  let out: Record<string, unknown> | null =
    keys.length === Object.keys(prev).length ? null : { ...next };
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const had = Object.hasOwn(prev, k);
    const child = had ? share(prev[k], next[k]) : next[k];
    if (out) {
      out[k] = child;
    } else if (!had || !Object.is(child, prev[k])) {
      out = { ...next };
      for (let j = 0; j < i; j++) out[keys[j]] = prev[keys[j]];
      out[k] = child;
    }
  }
  return out ?? prev;
}

/**
 * Structural equality over plain data.
 *
 * The same walk, asked the other question. `share` gives back `prev` itself
 * exactly when the two are deeply equal, so equality is an identity test on
 * its answer — `Object.is` and not `===`, because the one value that is not
 * `===` to itself is `NaN`, and `NaN` matching `NaN` is the answer this wants.
 */
export function equal(a: unknown, b: unknown): boolean {
  return Object.is(share(a, b), a);
}

/**
 * `next`, with every unchanged part replaced by the one `prev` already had.
 *
 * Returns **`prev` itself** when nothing changed at all, which is what lets
 * `UiStore.publish` decide whether to notify with an identity test rather than
 * a comparison of its own. One rule, applied at one place, and the whole of
 * "has the UI changed" falls out of it.
 *
 * There is no guard here for a key `prev` has and `next` does not. There used
 * to be, because the old loop ran over `next`'s keys and could not see one
 * that had gone; `shareObject` compares the two key counts before it walks, so
 * a dropped key is a changed object by the same rule as a changed value, at
 * every depth rather than only at the root.
 */
export function stabilise<T extends object>(prev: T | null, next: T): T {
  if (!prev) return next;
  return share(prev, next) as T;
}

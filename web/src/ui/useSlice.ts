/**
 * One subscription per slice, which is the whole of step 24.
 *
 * The root used to call `useSyncExternalStore` once for the entire projection,
 * so a single changed field re-rendered `App`, then the sidebar, then all seven
 * panels, before the leaf `memo`s could bail. The cost of a publish was the
 * size of the page rather than the size of the change. With this, a component
 * subscribes to what it actually reads and React re-renders exactly those
 * components whose field moved.
 *
 * **The rule: a selector returns a field of the projection, never a value it
 * builds.** `p => p?.wait ?? null` is right. `p => ({ a: p.x, b: p.y })` is
 * wrong, and it is wrong loudly: `useSyncExternalStore` calls `getSnapshot`
 * more than once per render and compares the results with `Object.is`, so a
 * freshly-built object never settles and React throws *"The result of
 * getSnapshot should be cached to avoid an infinite loop"* on the first render.
 * A component that needs three scalars calls this three times; scalars are
 * `Object.is`-stable for free, and three subscriptions cost three property
 * reads on publish. `web/tools/verify_ui.mjs`'s `selectors-return-fields` is
 * the static half of the same rule, so the mistake is caught before it runs.
 *
 * There is no `useSyncExternalStoreWithSelector` shim here and there must not
 * be one. `app/projection/stable.ts` makes every field of the projection
 * referentially stable when its content has not moved, at every depth — so a
 * selector that reaches into the projection already returns the object it
 * returned last frame, and a memoisation layer on top of that would cache
 * something that is already cached.
 */
import { useSyncExternalStore } from "react";
import type { UiProjection } from "./projection";
import { useStore } from "./store_context";

/**
 * The projection field `select` names, kept current.
 *
 * `select` is applied to the store's snapshot rather than to a value React
 * holds, which is what keeps this a *read* — the store stays the single source
 * and this adds no copy of it.
 */
export function useSlice<T>(select: (p: UiProjection | null) => T): T {
  const store = useStore();
  const get = (): T => select(store.getSnapshot());
  // `getServerSnapshot` is not optional here. `web/test/ui.test.tsx` renders
  // the page with `renderToStaticMarkup`, and React takes that third argument
  // on the server path and throws without one — so the check that the chrome
  // has the shape the stylesheet expects would fail before it rendered a tag.
  return useSyncExternalStore(store.subscribe, get, get);
}

/**
 * Whether there is a projection at all yet — the one thing the root subscribes
 * to.
 *
 * The page renders before `Player` exists, because `Player` is built from the
 * canvas React hands over in `onHost`. So "is there a projection" is a real
 * state of the page and not a null check to be tidied away: it is what decides
 * whether the sidebar, the transport and the top bar's controls are on the page
 * at all. It flips once per session and never back, so the root re-renders
 * once.
 *
 * Written over `useSyncExternalStore` directly rather than as
 * `useSlice((p) => p !== null)`, because that selector is a comparison and not
 * a field, and `selectors-return-fields` is right to reject it.
 */
export function useHasProjection(): boolean {
  const store = useStore();
  const get = (): boolean => store.getSnapshot() !== null;
  return useSyncExternalStore(store.subscribe, get, get);
}

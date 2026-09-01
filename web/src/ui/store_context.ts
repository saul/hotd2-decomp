/**
 * The store, reached by position in the tree rather than passed down it.
 *
 * Every component in this layer needs one of two things from the store: the
 * projection, which it now subscribes to for itself with `useSlice`, and
 * `dispatch`, which is how it asks the world to change. Threading both through
 * props made a panel's signature a list of what its *children* wanted — the
 * sidebar took the whole store so it could hand `dispatch` to the actor body
 * six levels down — and it made the intermediate components re-render for
 * reasons that had nothing to do with them.
 *
 * There is exactly one store per React root and it is created before the root
 * is, in `app/`, so the context never changes value after mount. That is the
 * property that makes this cheap: a context whose value moves re-renders every
 * consumer, and this one cannot move.
 *
 * `dispatch` is a bound arrow property on `UiStore`, so its identity is stable
 * for the life of the store. That matters more than it looks: it is what lets
 * `memo` bail on a row component that takes it, which is most of them.
 */
import { createContext, useContext } from "react";
import type { Dispatch } from "./commands";
import type { UiStore } from "./store";

/**
 * Null is the "no provider" case and it is deliberately not a working default.
 *
 * A default store would let a component render outside the tree and quietly
 * subscribe to a store nothing publishes to — a panel that is permanently
 * empty, with nothing anywhere saying why. The throw below names the mistake
 * at the first render instead.
 */
export const StoreContext = createContext<UiStore | null>(null);

export function useStore(): UiStore {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("ui: no StoreContext — this component is outside <App>");
  }
  return store;
}

/** What a control talks back with. See `commands.ts` for the whole union. */
export function useDispatch(): Dispatch {
  return useStore().dispatch;
}

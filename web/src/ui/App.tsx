/**
 * The UI layer's root.
 *
 * One subscription to one projection, and every panel below is a pure
 * function of it. Nothing here reaches into the engine, holds a layer, or
 * keeps a copy of game state; a control that wants something to happen
 * dispatches a `UiCommand` and `app/` decides what that means.
 *
 * Panels are being moved here one at a time — see step 11 in
 * `docs/PLAYER_ARCHITECTURE.md`. Whatever is still hand-written DOM lives in
 * `hud/` and is driven from `app/` as before; the two coexist because a
 * big-bang rewrite of the chrome would have no way to prove it changed
 * nothing.
 */
import { useSyncExternalStore } from "react";
import type { UiStore } from "./store";
import { Scopes } from "./panels/Scopes";

export function App({ store }: { store: UiStore }) {
  const p = useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (!p) return null;
  return <Scopes root={p.scopes} stageLoadedAt={p.scopeContext.stageLoadedAt} />;
}

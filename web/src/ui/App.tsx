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
import { Globals } from "./panels/Globals";
import { ActorBody, WaitBody } from "./panels/Sidebar";
import { createPortal } from "react-dom";

/**
 * Where each converted panel goes.
 *
 * The chrome is still `index.html`'s, so React renders into the existing
 * mount points through portals rather than owning the page. That is what lets
 * the panels move one at a time and be compared against the DOM version they
 * replace — step 11 finishes by inverting it, and `index.html` becomes a
 * single mount point.
 */
const MOUNTS = ["#scopes", "#globals", "#wait-body", "#wait-sub",
                "#actor-body", "#actor-sub"] as const;

export function App({ store }: { store: UiStore }) {
  const p = useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (!p) return null;
  const at = (sel: typeof MOUNTS[number]) => document.querySelector(sel);
  const scopes = at("#scopes");
  const globals = at("#globals");
  const waitBody = at("#wait-body");
  const waitSub = at("#wait-sub");
  const actorBody = at("#actor-body");
  const actorSub = at("#actor-sub");
  return (
    <>
      {scopes && createPortal(
        <Scopes root={p.scopes}
                stageLoadedAt={p.scopeContext.stageLoadedAt} />, scopes)}
      {globals && createPortal(<Globals p={p.globals} />, globals)}
      {waitSub && createPortal(<>{p.wait?.sub ?? "running"}</>, waitSub)}
      {waitBody && createPortal(<WaitBody p={p.wait} />, waitBody)}
      {actorSub && createPortal(<>{p.actorPanel?.sub ?? ""}</>, actorSub)}
      {actorBody && createPortal(
        <ActorBody p={p.actorPanel} dispatch={store.dispatch} />, actorBody)}
    </>
  );
}

/**
 * The UI layer's root.
 *
 * One subscription to one projection, and every panel below is a pure
 * function of it. Nothing here reaches into the engine, holds a layer, or
 * keeps a copy of game state; a control that wants something to happen
 * dispatches a `UiCommand` and `app/` decides what that means.
 *
 * The chrome is still `index.html`'s, so the panels are portalled into its
 * existing mount points rather than owning the page. That is what let them
 * move one at a time and be compared against the DOM version each replaced —
 * step 11 finishes by inverting it, and `index.html` becomes a single mount
 * point.
 */
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { UiStore } from "./store";
import { Scopes } from "./panels/Scopes";
import { Globals } from "./panels/Globals";
import { ActorBody, WaitBody } from "./panels/Sidebar";
import { Tree } from "./panels/Tree";
import { Feed } from "./panels/Feed";
import { HudStrip } from "./panels/HudStrip";
import { Toggles } from "./panels/Toggles";
import { Modes, StagePicker, ViewSettings } from "./panels/Topbar";
import { Transport } from "./panels/Transport";
import { SkipBar } from "./panels/SkipBar";

const at = (sel: string) => document.querySelector(sel);

export function App({ store }: { store: UiStore }) {
  const p = useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (!p) return null;

  const into = (sel: string, node: React.ReactNode) => {
    const host = at(sel);
    return host ? createPortal(node, host) : null;
  };

  return (
    <>
      {into("#stage-picker", <StagePicker p={p} dispatch={store.dispatch} />)}
      {into("#modes", <Modes mode={p.transport.mode}
                             dispatch={store.dispatch} />)}
      {into("#view-settings", <ViewSettings p={p} dispatch={store.dispatch} />)}
      {into("#transport", <Transport t={p.transport} sound={p.sound}
                                     dispatch={store.dispatch} />)}
      {into("#skipbar", <SkipBar p={p.skip} dispatch={store.dispatch} />)}
      {into("#toggles", <Toggles state={p.toggles}
                                 dispatch={store.dispatch} />)}
      {into("#tree", <Tree p={p.tree} current={p.current}
                           dispatch={store.dispatch} />)}
      {into("#feed", <Feed rows={p.feed} dispatch={store.dispatch} />)}
      {into("#inspector", <>{p.inspector}</>)}
      {into("#hud", <HudStrip rows={p.hudRows} />)}
      {into("#scopes", <Scopes root={p.scopes}
                               stageLoadedAt={p.scopeContext.stageLoadedAt} />)}
      {into("#globals", <Globals p={p.globals} />)}
      {into("#wait-sub", <>{p.wait?.sub ?? "running"}</>)}
      {into("#wait-body", <WaitBody p={p.wait} />)}
      {into("#actor-sub", <>{p.actorPanel?.sub ?? ""}</>)}
      {into("#actor-body", <ActorBody p={p.actorPanel}
                                      dispatch={store.dispatch} />)}
    </>
  );
}

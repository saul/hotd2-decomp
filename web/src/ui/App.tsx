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
import { Minimap } from "./panels/Minimap";
import { Panel } from "./panels/Panel";
import { Toggles } from "./panels/Toggles";
import { Modes, StagePicker, ViewSettings } from "./panels/Topbar";
import { Transport } from "./panels/Transport";
import { SkipBar } from "./panels/SkipBar";
import { BranchBar } from "./panels/BranchBar";
import type { UiProjection } from "./projection";

/**
 * A panel's mount point, or a loud failure.
 *
 * Returning `null` for a missing host is precisely the bug
 * `verify_player_dom.py` was written to catch, reproduced sixteen times over:
 * rename an id in `index.html` and the panel simply stops rendering, behind a
 * clean `tsc` and a clean `vite build`. These selectors are built at run time
 * and no static check can see them, so until step 16 deletes the portals
 * altogether, throwing is what stands in for one.
 */
const into = (sel: string, node: React.ReactNode) => {
  const host = document.querySelector(sel);
  if (!host) throw new Error(`ui: no mount point ${sel} in index.html`);
  return createPortal(node, host);
};

export function App({ store }: { store: UiStore }) {
  const p = useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (!p) return null;

  return (
    <>
      {into("#stage-picker", <StagePicker p={p} dispatch={store.dispatch} />)}
      {into("#modes", <Modes mode={p.transport.mode}
                             dispatch={store.dispatch} />)}
      {into("#view-settings", <ViewSettings p={p} dispatch={store.dispatch} />)}
      {into("#transport", <Transport t={p.transport} sound={p.sound}
                                     dispatch={store.dispatch} />)}
      {into("#branchbar", <BranchBar p={p.branch}
                                     dispatch={store.dispatch} />)}
      {into("#skipbar", <SkipBar p={p.skip} dispatch={store.dispatch} />)}
      {into("#toggles", <Toggles state={p.toggles}
                                 dispatch={store.dispatch} />)}
      {into("#tree", <Tree p={p.tree} current={p.current}
                           dispatch={store.dispatch} />)}
      {into("#right", <Sidebar p={p} store={store} />)}
    </>
  );
}

/**
 * The right-hand sidebar, which is now entirely React's.
 *
 * Every panel here owns its own fold and declares its own cost. Nothing in
 * `app/` asks the document what is showing, and a panel that is folded is not
 * rendered — so `wants(slice)` and "is this component mounted" are the same
 * fact rather than two that have to be kept in step.
 */
function Sidebar({ p, store }: { p: UiProjection; store: UiStore }) {
  const dispatch = store.dispatch;
  return (
    <>
      <div id="hud" className="panel"><HudStrip rows={p.hudRows} /></div>

      <Panel id="panel-wait" store={store} title="Wait" slice="wait" defaultOpen
             sub={p.wait?.sub ?? "running"}
             head={
               <label className="hl"
                      title="Box every actor keeping this wait blocked.">
                 <input type="checkbox" checked={p.waitBoxed}
                        onChange={(e) => dispatch({ kind: "boxWait",
                                                    on: e.target.checked })} />
                 {" box"}
               </label>
             }>
        <div className="scroll dbg"><WaitBody p={p.wait} /></div>
      </Panel>

      <Panel id="panel-actors" store={store} title="Actors" slice="actors"
             sub={p.actorPanel?.sub ?? ""}
             subTitle={"Every object in g_object_list, grouped by spawn class. "
               + "Each class describes its own actors — a class with a module "
               + "in g_class_handlers explains itself, one without is listed "
               + "by id and left alone. docs/formats/spawns.md is the class "
               + "table."}>
        <div className="scroll dbg">
          <ActorBody p={p.actorPanel} dispatch={dispatch} />
        </div>
      </Panel>

      <Panel id="panel-route" store={store} title="Route graph">
        <Minimap graph={p.minimap} current={p.current?.block ?? -1}
                 dispatch={dispatch} />
      </Panel>

      <Panel id="panel-feed" store={store} title="Event feed" defaultOpen grow>
        <Feed rows={p.feed} dispatch={dispatch} />
      </Panel>

      <Panel id="inspector-panel" store={store} title="Inspector">
        <div id="inspector" className="scroll">{p.inspector}</div>
      </Panel>

      <Panel id="scope-panel" store={store} title="Scopes" sub="lifetimes"
             subTitle={"The disposal tree. Every scope shows the frame it was "
               + "opened at: a child of `stage` whose frame predates the "
               + "current stage load survived a teardown, and nothing else in "
               + "the player can tell you that. Repeated names collapse into a "
               + "tallied row, so a hundred leaked effect scopes is one line "
               + "rather than a hundred."}>
        <div id="scopes" className="scroll">
          <Scopes root={p.scopes}
                  stageLoadedAt={p.scopeContext.stageLoadedAt} />
        </div>
      </Panel>

      <Panel id="globals-panel" store={store} title="Globals" slice="globals"
             sub="read-only · g_*"
             subTitle={"The port's data segment — every g_* it touches, and "
               + "the object pool. Read-only: a writable panel would be a "
               + "fourth way for state to enter the game, and nothing done "
               + "here would survive a save. Addresses are the ones cited in "
               + "web/src/game/globals.ts, checked against "
               + "ghidra/annotations/globals.tsv."}>
        <div id="globals" className="scroll"><Globals p={p.globals} /></div>
      </Panel>
    </>
  );
}

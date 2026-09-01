/**
 * The UI layer's root, and the page.
 *
 * One subscription to one projection, and every panel below is a pure
 * function of it. Nothing here reaches into the engine, holds a layer, or
 * keeps a copy of game state; a control that wants something to happen
 * dispatches a `UiCommand` and `app/` decides what that means.
 *
 * `index.html` is a mount point. The chrome used to live there and the panels
 * were portalled into sixteen ids inside it, which let them move across one at
 * a time — and left a page with two owners. A renamed id gave `createPortal` a
 * null host and the panel silently vanished; `#viewport` carried a `paused`
 * class from `app/` and a `shooting` class from `render/` while React rendered
 * neither; the mode buttons were written by React *and* by a
 * `classList.toggle` loop, and the loop won for about a frame. All three are
 * the same bug, and having one writer is the fix.
 *
 * The one thing that flows the other way is the two elements the renderer
 * needs: the canvas it draws into and the viewport it measures. React owns
 * them, so React hands them over — `onHost` fires once, after mount, and
 * `app/` builds the `Player` around them. That is why the chrome renders
 * before there is a projection at all.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { UiStore } from "./store";
import { Scopes } from "./panels/Scopes";
import { Globals } from "./panels/Globals";
import { ActorBody, WaitBody } from "./panels/Sidebar";
import { Tree } from "./panels/Tree";
import { Feed } from "./panels/Feed";
import { HudStrip } from "./panels/HudStrip";
import { Minimap } from "./panels/Minimap";
import { Panel } from "./panels/Panel";
import { Resizer } from "./panels/Resizer";
import { Toggles } from "./panels/Toggles";
import { Modes, StagePicker, ViewSettings } from "./panels/Topbar";
import { Transport } from "./panels/Transport";
import { SkipBar } from "./panels/SkipBar";
import { BranchBar } from "./panels/BranchBar";
import type { UiProjection } from "./projection";

/** The two elements the renderer needs, handed over once React has them. */
export interface UiHost {
  canvas: HTMLCanvasElement;
  viewport: HTMLElement;
}

export function App(
  { store, onHost }: { store: UiStore; onHost: (h: UiHost) => void },
) {
  const p = useSyncExternalStore(store.subscribe, store.getSnapshot,
                                store.getServerSnapshot);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);

  // Once, after the first commit. There is no projection yet and there cannot
  // be: `app/` needs these two elements to build the `Player` that produces
  // one.
  useEffect(() => {
    if (canvas.current && viewport.current) {
      onHost({ canvas: canvas.current, viewport: viewport.current });
    }
  }, [onHost]);

  const loading = p ? p.loading : { text: "loading bundle…", failed: false };

  return (
    <>
      <header id="topbar">
        <span className="brand">HOTD2 <span className="dim">stage player</span></span>
        {p && <>
          <span id="stage-picker" className="toggles">
            <StagePicker p={p} dispatch={store.dispatch} />
          </span>
          <span className="sep" />
          <div className="modes" role="tablist" id="modes">
            <Modes mode={p.transport.mode} dispatch={store.dispatch} />
          </div>
          <span className="sep" />
          <span id="toggles" className="toggles">
            <Toggles state={p.toggles} dispatch={store.dispatch} />
          </span>
          <span id="view-settings" className="toggles">
            <ViewSettings p={p} dispatch={store.dispatch} />
          </span>
        </>}
        <span className="grow" />
        <span id="status" className="dim">
          {p?.status.text ?? ""}
          {p?.status.note
            && <span className="dim" title={p.status.noteTitle}>
                 {p.status.note}
               </span>}
        </span>
      </header>

      <main id="stagearea">
        <Tree p={p?.tree ?? null} current={p?.current ?? null}
              dispatch={store.dispatch} />
        <Resizer />

        {/* `shooting` and `paused` are both this element's class, so they are
            both read from the projection. Two layers writing it imperatively
            is what left the crosshair on after the mode changed. */}
        <div id="viewport" ref={viewport}
             className={[p?.paused && "paused",
                         p?.toggles.shoot && "shooting"]
                        .filter(Boolean).join(" ")}>
          <canvas id="view" ref={canvas} />
          {p?.paused && <div id="paused-overlay"><span>PAUSED</span></div>}
          {loading && (
            <div id="loading">
              {!loading.failed && <div className="spinner" />}
              <p id="loading-text" className={loading.failed ? "err" : undefined}>
                {loading.text}
              </p>
            </div>
          )}
          {/* Anchored to the bottom of the rendered view, not a modal over it:
              a branch point is a fact about where playback has got to, so the
              script, the scrubber and free roam all stay usable. The skip bar
              sits above it on the rare frame both are live. */}
          <SkipBar p={p?.skip ?? null} dispatch={store.dispatch} />
          <BranchBar p={p?.branch ?? null} dispatch={store.dispatch}
                     onHover={(over) =>
                       store.dispatch({ kind: "branchHover", over })} />
        </div>

        {/* Fourth in source order, because `#stagearea` is a grid and grid
            auto-placement follows the DOM. */}
        <aside id="right">{p && <Sidebar p={p} store={store} />}</aside>
      </main>

      <footer id="transport">
        {p && <Transport t={p.transport} sound={p.sound}
                         dispatch={store.dispatch} />}
      </footer>
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

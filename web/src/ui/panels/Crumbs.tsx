/**
 * The breadcrumb menu: the one piece of chrome that sits over the game.
 *
 * `≡` in the top-left corner, and a press on it holds the game and opens
 * everything the page offers that is not debugging: which stage, where it
 * opens, Original Mode, a restart, the bundle screen, and the debug sidebar.
 * It replaced a top bar and a bottom bar of controls that had grown one
 * debugging need at a time, until the game was the smallest thing on the page.
 *
 * The trail used to go on -- `› Stage 2 › Block 7` -- and that is the one
 * thing the game already says itself, on its own title card, so it went; and
 * then the name went too. Over the game it is one round button, matching the
 * speaker in the other corner. The menu marks which stage is open.
 *
 * Every item is a command except two. Whether the menu is open is this
 * component's own state, and whether the debug sidebar is open belongs to
 * `App` -- neither changes anything outside `ui/`, so neither is in the
 * projection.
 *
 * The menu is rendered only while it is open. The one control that has to be
 * reachable before there is a projection -- the bundle screen, which is the
 * answer to a page with nothing to play -- is inside it, and the menu renders
 * without a projection for exactly that reason.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useStore } from "../store_context";
import { useSlice } from "../useSlice";

export interface DebugToggle {
  debugOpen: boolean;
  onToggleDebug: () => void;
  /** Open the `?` dialog. Also `App`'s, for the reason the sidebar is. */
  onShowKeys?: () => void;
}

export function Crumbs({ debugOpen, onToggleDebug, onShowKeys }: DebugToggle) {
  const [open, setOpenState] = useState(false);
  const root = useRef<HTMLElement>(null);
  const stale = useSlice((p) => p?.bundleStale) === true;
  const store = useStore();

  // **The menu holds the game while it is open**, as the `?` list does:
  // nobody chooses a stage with a zombie on them. Closing it lets go only of
  // a hold it took -- a game somebody had paused stays paused -- and an item
  // that opens something else over the game (the bundle screen, the list of
  // keys) closes it without letting go, so the game does not run on under
  // that.
  const held = useRef(false);
  const setOpen = useCallback((next: boolean, resume = true) => {
    if (next && !held.current
        && store.getSnapshot()?.transport.playing === true) {
      held.current = true;
      store.dispatch({ kind: "pause" });
    } else if (!next && held.current) {
      held.current = false;
      if (resume) store.dispatch({ kind: "play" });
    }
    setOpenState(next);
  }, [store]);

  // Dismissed by a press anywhere else, and by Escape. `pointerdown` rather
  // than `click` so that the press that closes the menu over the game is not
  // *also* a shot: the listener runs in the capture phase, before the
  // viewport's own, and stops a press that only closed the menu from going on
  // to fire.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (root.current?.contains(e.target as Node)) return;
      setOpen(false);
      e.stopPropagation();
      e.preventDefault();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [open, setOpen]);

  return (
    <nav id="crumbs" ref={root} className={open ? "open" : undefined}
         aria-label="Menu">
      <button className="crumb-trail" aria-expanded={open}
              title={stale
                ? "Menu — the bundle needs rebuilding: it was built by an older exporter"
                : "Menu: stage, bundle, debug sidebar"}
              onClick={() => setOpen(!open)}>
        <Burger />
        {stale && <span className="crumb-warn" aria-label="bundle out of date">!</span>}
      </button>
      {open && <CrumbMenu debugOpen={debugOpen}
                          onToggleDebug={onToggleDebug}
                          onShowKeys={onShowKeys}
                          onClose={(resume) => setOpen(false, resume)} />}
    </nav>
  );
}

function Burger() {
  return (
    <svg className="burger" viewBox="0 0 16 16" width="16" height="16"
         aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The menu's body. Exported for `test:ui`, which cannot click a trail open and
 * renders this directly instead.
 */
export function CrumbMenu({ debugOpen, onToggleDebug, onShowKeys, onClose }:
                          DebugToggle & {
                            /** `resume` false keeps the game held; see `Crumbs`. */
                            onClose: (resume?: boolean) => void;
                          }) {
  const dispatch = useDispatch();
  const stage = useSlice((p) => p?.stage);
  const stages = useSlice((p) => p?.stages);
  const entries = useSlice((p) => p?.entries);
  const entry = useSlice((p) => p?.entry);
  const original = useSlice((p) => p?.original);
  const stale = useSlice((p) => p?.bundleStale) === true;
  const act = (f: () => void, resume = true) => () => { f(); onClose(resume); };

  return (
    <div id="menu">
      {stages && stage !== undefined && (
        <section className="menu-stage">
          <h6>Stage</h6>
          <div className="stage-grid" id="stage-picker">
            {stages.map((n) => (
              <button key={n} data-stage={n}
                      aria-pressed={n === stage}
                      className={n === stage ? "current" : undefined}
                      title={n === stage ? `Stage ${n} again, from its entry`
                                         : `Play stage ${n}`}
                      onClick={act(() => dispatch({ kind: "setStage",
                                                    stage: n }))}>
                {n}
              </button>
            ))}
          </div>
          {/* Where the stage opens, and only when it has a choice. **A stage
              does not decide where it starts; the stage before it does** --
              the route record it walks off names the block it hands over, so
              stage 2's two endings open stage 3 at block 0 or at block 7, and
              stage 3's two open stage 4 at block 0 or at block 4. Nothing
              else has more than one, and a picker with one option would imply
              a choice that is not there. */}
          {entries && entries.length > 1 && (
            <div className="entry-row" id="entry-picker"
                 title="Where this stage opens. The stage before it decides: its last route record names the block it hands over, and two of its endings name different ones.">
              <span className="dim">Opens at</span>
              {entries.map((n) => (
                <button key={n} data-entry={n}
                        aria-pressed={n === entry}
                        className={n === entry ? "current" : undefined}
                        onClick={act(() => dispatch({ kind: "setEntry",
                                                      entry: n }))}>
                  block {n}
                </button>
              ))}
            </div>
          )}
          <label className="menu-check"
                 title="Game mode 1. Same regions; a few slots resolve to the st_org* models Arcade never draws.">
            <input type="checkbox" checked={!!original}
                   onChange={(e) => {
                     dispatch({ kind: "setOriginal", on: e.target.checked });
                     onClose();
                   }} />
            {" "}Original mode
          </label>
        </section>
      )}
      <section className="menu-actions">
        {stage !== undefined && (
          <button
                  onClick={act(() => dispatch({ kind: "restartStage" }))}>
            <span className="mi">↺</span> Restart stage
          </button>
        )}
        {/* Reachable before anything has loaded, which is when it is most
            wanted: the export screen was once reachable *only* from the
            failure path, so on every machine with a bundle none of it
            existed. `.bundle-open` is the harnesses' hold on it. */}
        <button
                className={stale ? "bundle-open stale" : "bundle-open"}
                title={stale
                  ? "Bundle needs rebuilding — it was built by an older exporter"
                  : "The bundle: which one is loaded, and build another from your copy of the game"}
                onClick={act(() => dispatch({ kind: "openBundles" }), false)}>
          <span className="mi">{stale ? "!" : "⬡"}</span> Rebuild bundle…
        </button>
        <button aria-pressed={debugOpen}
                className="debug-toggle"
                onClick={act(onToggleDebug)}>
          <span className="mi">{debugOpen ? "✓" : "⌥"}</span> Debug sidebar
          <kbd>`</kbd>
        </button>
        {/* A phone has no keys to list, so the stylesheet hides it there. */}
        {onShowKeys && (
          <button className="keys-open only-fine"
                  onClick={act(onShowKeys, false)}>
            <span className="mi">⌨</span> Keyboard shortcuts
            <kbd>?</kbd>
          </button>
        )}
      </section>
    </div>
  );
}

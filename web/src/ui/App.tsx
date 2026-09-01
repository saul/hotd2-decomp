/**
 * The UI layer's root, and the page.
 *
 * `App` is two things and nothing else: the one place the store enters the
 * tree, and the frame every region hangs off. It subscribes to a single fact —
 * whether there is a projection yet — and every panel below it subscribes to
 * the fields it actually reads, with `useSlice`. Before step 24 the root read
 * the whole projection, so one moved field re-rendered `App`, the sidebar and
 * all seven panels before a leaf `memo` could bail: the cost of a publish was
 * the size of the page. It is now the size of the change.
 *
 * Nothing here reaches into the engine, holds a layer, or keeps a copy of game
 * state; a control that wants something to happen dispatches a `UiCommand` and
 * `app/` decides what that means.
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
 * The one thing that flows the other way is the elements the layers below
 * need: the canvas the renderer draws into, the viewport it measures, the four
 * nodes `hud/` writes the shutter and the caption onto, and the crosshair
 * `render/` moves with the pointer. React owns them, so React hands them over
 * — `onHost` fires once, after mount, and `app/` builds the `Player` around
 * them. That is why the chrome renders before there is a projection at all.
 *
 * The hud layer and the crosshair are on that list from step 26. Until then
 * they were the last two elements on the page React did not render: `hud/`
 * built four divs with `document.createElement` and appended them into
 * `#viewport`, and `render/` did the same with one, so the element React
 * renders had children React had never heard of. It worked, and it worked by
 * accident — React appends its conditional overlays wherever its own last
 * child happens to be, so whether the crosshair painted over the branch bar or
 * under it depended on the order the two had first mounted in. Rule 6 is one
 * writer per pixel, and a node whose *position* has two authors is the same
 * bug as an attribute that has two.
 *
 * Every region is inside an `ErrorBoundary`, and one region is deliberately
 * not: `#viewport` and `#view` are the two elements handed across by `onHost`,
 * and the renderer holds them for the session. So the boundaries sit *inside*
 * the viewport, around the overlays, and never around the viewport itself — a
 * boundary that could unmount the canvas would leave WebGL drawing into a
 * detached element, which is a dead page that looks like a graphics bug.
 */
import { useEffect, useRef } from "react";
import type { UiStore } from "./store";
import { StoreContext } from "./store_context";
import { useHasProjection } from "./useSlice";
import { Sidebar } from "./panels/Sidebar";
import { Tree } from "./panels/Tree";
import { Resizer } from "./panels/Resizer";
import { Toggles } from "./panels/Toggles";
import { Modes, StagePicker, Status, ViewSettings } from "./panels/Topbar";
import { Transport } from "./panels/Transport";
import { SkipBar } from "./panels/SkipBar";
import { BranchBar } from "./panels/BranchBar";
import { LoadingOverlay, PausedOverlay, Viewport } from "./panels/Viewport";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * The elements the layers below need, handed over once React has them.
 *
 * Explicit and typed rather than a parent to go hunting in: a layer that found
 * its own nodes with `querySelector` would be free to find a different one
 * after a rename, and would fail by drawing nothing rather than by failing to
 * compile. Every field here is rendered unconditionally by `Viewport`, so a
 * node handed over is a node that lives as long as the session.
 */
export interface UiHost {
  canvas: HTMLCanvasElement;
  viewport: HTMLElement;
  /** `.hud-layer` and its three children; see `hud/hud.ts`. */
  hud: {
    root: HTMLElement;
    top: HTMLElement;
    bottom: HTMLElement;
    message: HTMLElement;
  };
  /** `.crosshair`; see `render/shooting.ts`. */
  crosshair: HTMLElement;
}

/**
 * The composition root's one call, and the shape `app/ui_root.ts` renders.
 *
 * It provides the store and renders the page. The split is not decoration: a
 * component cannot read a context it provides itself, and `Page` is what needs
 * to read one — `useHasProjection` and every `useSlice` below it go through
 * `StoreContext`, so the provider has to sit above the first consumer.
 */
export function App(
  { store, onHost, onError }: {
    store: UiStore;
    onHost: (h: UiHost) => void;
    onError?: (label: string, error: unknown, info?: unknown) => void;
  },
) {
  return (
    <StoreContext value={store}>
      <Page onHost={onHost} onError={onError} />
    </StoreContext>
  );
}

function Page(
  { onHost, onError }: {
    onHost: (h: UiHost) => void;
    onError?: (label: string, error: unknown, info?: unknown) => void;
  },
) {
  // The only subscription above a panel. It flips once, when `app/` publishes
  // its first projection, and never back — so this render happens twice in a
  // session and the panels below carry every frame after that.
  const ready = useHasProjection();
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  // The nodes `hud/` and `render/` write geometry onto. They are declared here
  // rather than inside `Viewport` because `onHost` is the handover and it
  // fires from here; `Viewport` renders them and takes the refs as a prop.
  const hud = useRef<HTMLDivElement>(null);
  const shutterTop = useRef<HTMLDivElement>(null);
  const shutterBottom = useRef<HTMLDivElement>(null);
  const message = useRef<HTMLDivElement>(null);
  const crosshair = useRef<HTMLDivElement>(null);

  // Once, after the first commit. There is no projection yet and there cannot
  // be: `app/` needs these elements to build the `Player` that produces one.
  //
  // The guard is not defensive padding. `onHost` builds the `WebGLRenderer`,
  // the `Hud` and the `Shooting` layer in one go, and a `UiHost` with one null
  // field would hand a layer a node it then writes to on every frame — an
  // error thrown sixty times a second from inside the tick, a long way from
  // the ref that was never attached. Every element below is rendered
  // unconditionally, so after the first commit they are all present; if that
  // ever stops being true this fires never rather than half.
  useEffect(() => {
    const [c, v, h, t, b, m, x] = [
      canvas.current, viewport.current, hud.current, shutterTop.current,
      shutterBottom.current, message.current, crosshair.current,
    ];
    if (c && v && h && t && b && m && x) {
      onHost({
        canvas: c, viewport: v, crosshair: x,
        hud: { root: h, top: t, bottom: b, message: m },
      });
    }
  }, [onHost]);

  return (
    <ErrorBoundary label="The player" onError={onError}>
      <header id="topbar">
        <ErrorBoundary label="The top bar" onError={onError}>
          <span className="brand">HOTD2 <span className="dim">stage player</span></span>
          {ready && <>
            <span id="stage-picker" className="toggles">
              <StagePicker />
            </span>
            <span className="sep" />
            <div className="modes" role="tablist" id="modes">
              <Modes />
            </div>
            <span className="sep" />
            <span id="toggles" className="toggles">
              <Toggles />
            </span>
            <span id="view-settings" className="toggles">
              <ViewSettings />
            </span>
          </>}
          <span className="grow" />
          <Status />
        </ErrorBoundary>
      </header>

      <main id="stagearea">
        <ErrorBoundary label="The script tree" onError={onError}>
          <Tree />
        </ErrorBoundary>
        <Resizer />

        {/* `#viewport` is a component because the two classes it carries are
            projection fields, and the root reading them would re-render the
            whole chrome to move one class. The canvas and the overlays are
            built here and passed through as `children`, so they are the same
            elements whatever the classes do — which is the property that keeps
            the canvas mounted for the session. The hud layer and the crosshair
            are rendered by `Viewport` itself, after these children, because
            their `hidden` is the same toggle field it already subscribes to
            for the `shooting` class. */}
        <Viewport refs={{ host: viewport, hud, shutterTop, shutterBottom,
                          message, crosshair }}>
          <canvas id="view" ref={canvas} />
          {/* The boundary goes round the overlays and never round `#viewport`
              or `#view`: `app/` was handed those two elements through `onHost`
              and the `WebGLRenderer` and the `ResizeObserver` are built on
              them for the session. Unmounting either leaves WebGL drawing into
              a detached canvas, which looks like a graphics bug and is not
              one. */}
          <ErrorBoundary label="The viewport overlays" onError={onError}>
            <PausedOverlay />
            <LoadingOverlay />
            {/* Anchored to the bottom of the rendered view, not a modal over
                it: a branch point is a fact about where playback has got to,
                so the script, the scrubber and free roam all stay usable. The
                skip bar sits above it on the rare frame both are live. */}
            <SkipBar />
            <BranchBar />
          </ErrorBoundary>
        </Viewport>

        {/* Fourth in source order, because `#stagearea` is a grid and grid
            auto-placement follows the DOM. */}
        <aside id="right">
          <ErrorBoundary label="The sidebar" onError={onError}>
            {ready && <Sidebar />}
          </ErrorBoundary>
        </aside>
      </main>

      <footer id="transport">
        <ErrorBoundary label="The transport" onError={onError}>
          {ready && <Transport />}
        </ErrorBoundary>
      </footer>
    </ErrorBoundary>
  );
}

/**
 * The UI layer's root, and the page.
 *
 * **The page is the game.** The rendered frame fills the window, pillarboxed to
 * the game's own 4:3, and everything else is either over it — the breadcrumb
 * menu, the sound button, the start and pause screen, the skip prompt, the
 * branch bar, the game-over buttons — or in a debug sidebar that is closed
 * until you ask for it. The top and bottom bars that used to frame the view
 * grew one debugging need at a time; what was worth keeping from them is in
 * the menu and the sidebar now.
 *
 * `App` is two things and nothing else: the one place the store enters the
 * tree, and the frame every region hangs off. It subscribes to a single fact —
 * whether there is a projection yet — and every panel below it subscribes to
 * the fields it actually reads, with `useSlice`. A publish costs the size of
 * the change, not the size of the page.
 *
 * Nothing here reaches into the engine, holds a layer, or keeps a copy of game
 * state; a control that wants something to happen dispatches a `UiCommand` and
 * `app/` decides what that means. **Whether the debug sidebar is open is the
 * exception that proves it**: it changes nothing outside `ui/`, so it is
 * component state here, remembered in `localStorage`, and never a command.
 *
 * `index.html` is a mount point. React renders every element on the page, the
 * canvas included, and the one thing that flows the other way is the elements
 * the layers below need: the canvas the renderer draws into, the viewport it
 * measures, the nodes `hud/` writes the shutter and the caption onto, and the
 * crosshair `render/` moves with the pointer. `onHost` hands them over once,
 * after mount, and `app/` builds the `Player` around them. That is why the
 * chrome renders before there is a projection at all.
 *
 * **Two siblings, not a parent and child.** `#viewport` holds the canvas and
 * what is drawn over it; `#overlay` holds everything that can be pressed.
 * `render/shooting.ts` hears a press on `#viewport` natively, which is before
 * any React handler runs, so a button inside it could not keep its press from
 * also being a shot. `#overlay` is `pointer-events: none` where it is empty,
 * so the game still gets every press that is not on a control.
 *
 * Every region is inside an `ErrorBoundary`, and one region is deliberately
 * not: `#viewport` and `#view` are the two elements handed across by `onHost`,
 * and the renderer holds them for the session. So no boundary sits between
 * the root and the canvas — a boundary that could unmount it would leave
 * WebGL drawing into a detached element, which is a dead page that looks like
 * a graphics bug.
 */
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type { UiStore } from "./store";
import { StoreContext } from "./store_context";
import { useHasProjection, useSlice } from "./useSlice";
import { usePersisted } from "./persist";
import { Crumbs } from "./panels/Crumbs";
import { DebugSidebar } from "./panels/DebugSidebar";
import { PauseScreen, RotateHint, SoundButton } from "./panels/Overlays";
import { SkipBar } from "./panels/SkipBar";
import { GameOver } from "./panels/GameOver";
import { BranchBar } from "./panels/BranchBar";
import { LoadingOverlay, Viewport } from "./panels/Viewport";
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
  /** `.hud-layer` and its four children; see `hud/hud.ts`. */
  hud: {
    root: HTMLElement;
    top: HTMLElement;
    bottom: HTMLElement;
    message: HTMLElement;
    screen: HTMLCanvasElement;
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

/**
 * Is the viewer typing into something?
 *
 * The backquote that opens the sidebar must not be stolen from the script
 * filter. `render/freeroam.ts` has the full version of this question; `ui/`
 * may not import it, and the narrow one is all a single printable key needs.
 */
function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT"
    && !["button", "checkbox", "radio", "range"]
      .includes((el as HTMLInputElement).type);
}

/**
 * `#overlay`, which knows one thing about the frame: whether it is boxed.
 *
 * The skip prompt, the branch bar and the game-over buttons hang off the
 * bottom of the *picture*, which is the whole stage area when the frame fills
 * it and a centred 4:3 box when it does not. A component rather than the root
 * reading the field, so the switch re-renders this element and not the page.
 */
function Overlay({ children }: { children: ReactNode }) {
  const boxed = useSlice((p) => p?.pillarbox) === true;
  return (
    <div id="overlay" className={boxed ? "boxed" : undefined}>{children}</div>
  );
}

function Page(
  { onHost, onError }: {
    onHost: (h: UiHost) => void;
    onError?: (label: string, error: unknown, info?: unknown) => void;
  },
) {
  // The only subscription above a panel. It flips once, when `app/` publishes
  // its first projection, and never back.
  const ready = useHasProjection();
  const [debugOpen, setDebugOpen] = usePersisted("debug", false);
  const toggleDebug = useCallback(() => setDebugOpen(!debugOpen),
                                  [debugOpen, setDebugOpen]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const shutterTop = useRef<HTMLDivElement>(null);
  const shutterBottom = useRef<HTMLDivElement>(null);
  const message = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLCanvasElement>(null);
  const crosshair = useRef<HTMLDivElement>(null);

  // Once, after the first commit. There is no projection yet and there cannot
  // be: `app/` needs these elements to build the `Player` that produces one.
  //
  // The guard is not defensive padding. `onHost` builds the `WebGLRenderer`,
  // the `Hud` and the `Shooting` layer in one go, and a `UiHost` with one null
  // field would hand a layer a node it then writes to on every frame. Every
  // element below is rendered unconditionally, so after the first commit they
  // are all present; if that ever stops being true this fires never rather
  // than half.
  useEffect(() => {
    const [c, v, h, t, b, m, s, x] = [
      canvas.current, viewport.current, hud.current, shutterTop.current,
      shutterBottom.current, message.current, screen.current,
      crosshair.current,
    ];
    if (c && v && h && t && b && m && s && x) {
      onHost({
        canvas: c, viewport: v, crosshair: x,
        hud: { root: h, top: t, bottom: b, message: m, screen: s },
      });
    }
  }, [onHost]);

  // The backquote opens and closes the sidebar. A key the player binds
  // nothing else to: `app/`'s handler owns Space, Enter, the digits, the
  // arrows, S and R, and free roam owns WASDQE and Shift.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code !== "Backquote" || e.repeat || typingIn(e.target)) return;
      e.preventDefault();
      toggleDebug();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [toggleDebug]);

  return (
    <ErrorBoundary label="The player" onError={onError}>
      <div id="shell" className={debugOpen ? "debug-open" : undefined}>
        <main id="stagearea">
          {/* `#viewport` is a component because the two classes it carries
              are projection fields, and the root reading them would re-render
              the whole page to move one class. The canvas is built here and
              passed through as `children`, so it is the same element whatever
              the classes do -- which is the property that keeps it mounted
              for the session. */}
          <Viewport refs={{ host: viewport, hud, shutterTop, shutterBottom,
                            message, screen, crosshair }}>
            <canvas id="view" ref={canvas} />
            {/* The boundary goes round the overlay and never round
                `#viewport` or `#view`: `app/` was handed those two for the
                session. The loading screen is in here rather than in
                `#overlay` because it is not a control, and it should cover
                the frame and nothing else. */}
            <ErrorBoundary label="The loading screen" onError={onError}>
              <LoadingOverlay />
            </ErrorBoundary>
          </Viewport>

          <Overlay>
            <ErrorBoundary label="The game overlay" onError={onError}>
              <Crumbs debugOpen={debugOpen} onToggleDebug={toggleDebug} />
              {ready && <>
                <SoundButton />
                <PauseScreen />
                {/* Anchored to the bottom of the frame, not a modal over it:
                    a branch point is a fact about where playback has got to,
                    so free roam and the sidebar stay usable. The skip prompt
                    sits above it on the rare frame both are live. */}
                <SkipBar />
                <BranchBar />
                <GameOver />
              </>}
              <RotateHint />
            </ErrorBoundary>
          </Overlay>
        </main>

        {debugOpen && (
          <aside id="debug">
            <ErrorBoundary label="The debug sidebar" onError={onError}>
              {ready && <DebugSidebar onClose={toggleDebug} />}
            </ErrorBoundary>
          </aside>
        )}
      </div>
    </ErrorBoundary>
  );
}

/**
 * `#viewport`, and the two overlays that sit over the rendered frame.
 *
 * The element itself is here rather than in `App.tsx` for one reason: it
 * carries two classes read from the projection — `paused` and `shooting`, the
 * second of them off the firing gate — and if the root read them, every change
 * to either would re-render the whole chrome to move one class on one element.
 * This subscribes to exactly those fields, and the canvas and the overlays are
 * passed through as
 * `children`, which React hands back untouched: they are the same elements
 * `App` built on its own render, so React bails on that subtree rather than
 * reconciling it.
 *
 * **Nothing here may unmount the canvas.** `app/` was handed `#viewport` and
 * `#view` through `onHost` and holds them for the session, so this component
 * renders the div unconditionally and always with the same children. A
 * conditional around either would leave WebGL drawing into a detached element,
 * which is a dead page that looks like a graphics bug.
 *
 * Both classes were once written imperatively — `paused` by `app/` and
 * `shooting` by `render/` — while React rendered neither, and the crosshair
 * stayed on after the mode changed. One writer, and the writer is the one that
 * renders the element.
 *
 * ## The hud layer and the crosshair
 *
 * Step 26 finished that job for the *children* of `#viewport`. `hud/` used to
 * build `.hud-layer` and its three divs with `document.createElement` and
 * append them here, and `render/` did the same with `.crosshair`, so the
 * element React renders held five nodes React had never heard of and their
 * position in the paint order was whatever the mount sequence happened to
 * produce. They are rendered here now, and the layers are handed the nodes
 * through `onHost` and write only *geometry* onto them: heights on the two
 * shutter bars, text and a position on the caption, a left and a top on the
 * crosshair. That is the same arrangement rule 6 already permits for the
 * script tree's highlight — a node written to by the component that rendered
 * it — with the handover made explicit because the writer is a different
 * layer.
 *
 * **`hidden` on `.hud-layer` and on `.crosshair` is React's.** It was the
 * layers', and on both it was purely a function of a toggle that is already in
 * the projection:
 * `Hud.setEnabled` was reached only from `applyToggle`'s `hud` case and
 * `Shooting.setEnabled` only from its `shoot` case, both of them driven from
 * the same `toggles` record this subscribes to. Two writers for one boolean,
 * one of them a frame behind the other. `Shooting` keeps its `enabled` field,
 * because it gates its pointer handlers and `walker_host`'s live counts on it
 * as well as the element; `Hud`'s had no job left once the DOM write went, and
 * step 28 deleted it along with the one sentence that still read it — the HUD
 * strip's shutter row, which reads `toggles.hud` in `app/projection/hud.ts`
 * now and says `"off"` from the same field this does.
 *
 * Source order here is the paint order for everything sharing a `z-index`, so
 * it is a decision rather than an accident: the canvas and the overlays come
 * first as `children`, then `.hud-layer` at `z-index: 1` — above the frame,
 * below the tool's own bars, which is what keeps a closed letterbox off the
 * skip bar — and `.crosshair` last, on top of the `z-index: 2` bars. The
 * crosshair stands in for the pointer that `#viewport.shooting { cursor: none }`
 * took away, and a pointer that disappears under the branch bar reads as the
 * mode having broken. Nothing under it becomes unclickable: `.crosshair` is
 * `pointer-events: none`.
 */
import type { ReactNode, RefObject } from "react";
import { useSlice } from "../useSlice";
import type { LoadingProjection } from "../projection";

/**
 * The nodes `app/` is handed, as the refs that fill them in.
 *
 * One prop rather than six, and named for what each node is rather than for
 * the layer that writes it: `Viewport` renders them all whatever is switched
 * on, and which layer holds which is `UiHost`'s business.
 */
export interface ViewportRefs {
  host: RefObject<HTMLDivElement | null>;
  hud: RefObject<HTMLDivElement | null>;
  shutterTop: RefObject<HTMLDivElement | null>;
  shutterBottom: RefObject<HTMLDivElement | null>;
  message: RefObject<HTMLDivElement | null>;
  crosshair: RefObject<HTMLDivElement | null>;
}

export function Viewport(
  { refs, children }: {
    /** Handed to `app/` through `onHost`; see `App`. */
    refs: ViewportRefs;
    children: ReactNode;
  },
) {
  const paused = useSlice((p) => p?.paused);
  // There is no *switch* for shooting -- it is what the game is, and
  // `render/shooting.ts` says why there is not. What there is, is the game's
  // own condition: the firing gate, read below. Both classes still wait for a
  // projection first, because before one there is no game to aim at and the
  // loading overlay is over the top of them anyway.
  //
  // Read off `paused` rather than through a second subscription: a selector
  // must *name* a field, so `(p) => p !== null` is not one -- it builds a
  // value and the subscription never settles, which `verify:ui` refuses. The
  // optional chain above already carries the answer, because `paused` is a
  // `boolean` in every projection and `undefined` only when there is none.
  const ready = paused !== undefined;
  const hud = useSlice((p) => p?.toggles.hud);
  // The crosshair follows the firing gate, because the engine's does:
  // `HudDrawCrosshair` (0x004169C0) will not draw the reticle while
  // `g_nFiringGate` is zero, and the same word is what makes the trigger dead.
  // A cutscene therefore takes the crosshair with it.
  //
  // The `shooting` class goes with it, which is a *port* decision and not the
  // engine's: the cabinet has a physical gun and nothing to hide, so hiding
  // the system cursor is this player's stand-in for one. Take the crosshair
  // away and leave `cursor: none` behind and the viewer has nothing at all to
  // point with for the length of a cutscene. So the pointer comes back exactly
  // while the game's own reticle is gone.
  const firingGate = useSlice((p) => p?.firingGate);
  const aiming = ready && firingGate === true;
  return (
    <div id="viewport" ref={refs.host}
         className={[paused && "paused", aiming && "shooting"]
                    .filter(Boolean).join(" ")}>
      {children}
      {/* Before the first projection there are no toggles and both are
          hidden. That is the state the constructors used to start in for the
          crosshair, and for the hud layer it is invisible either way: the
          loading overlay is opaque and two stacking levels above, and the bars
          have no height until `Hud.draw` runs, which cannot happen before
          `app/` exists to tick it. */}
      <div className="hud-layer" ref={refs.hud} hidden={!hud}>
        <div className="shutter shutter-top" ref={refs.shutterTop} />
        <div className="shutter shutter-bottom" ref={refs.shutterBottom} />
        {/* The caption is the one node on this subtree whose `hidden` stays
            with the layer, and it is deliberately not written here at all:
            whether there is a caption is a countdown on the walker, not a
            field of the projection, so React has nothing to render it from and
            an initial value written here would make two writers in sequence.
            `hud/` owns `hidden`, `textContent`, `left`, `top` and `fontSize`
            on this node — it sets `hidden` in its own constructor — and React
            owns its class. Nothing writes both. Between mount and the layer's
            first `draw` the div is empty, which has no box and paints
            nothing. */}
        <div className="screen-message" ref={refs.message} />
      </div>
      <div className="crosshair" ref={refs.crosshair} hidden={!aiming} />
    </div>
  );
}

export function PausedOverlay() {
  const paused = useSlice((p) => p?.paused);
  if (!paused) return null;
  return <div id="paused-overlay"><span>PAUSED</span></div>;
}

/**
 * What the page says before there is anything else to say.
 *
 * `undefined` and `null` mean different things here and the difference is the
 * point. `null` is `app/` saying the stage is up and there is nothing to
 * report; `undefined` is there being no projection at all, which is exactly the
 * state the page is in while the bundle is still coming in and the only moment
 * this text is the truth.
 */
const BOOT: LoadingProjection = { text: "loading bundle…", failed: false };

export function LoadingOverlay() {
  const loading = useSlice((p) => p?.loading);
  const shown = loading === undefined ? BOOT : loading;
  if (!shown) return null;
  return (
    <div id="loading">
      {!shown.failed && <div className="spinner" />}
      <p id="loading-text" className={shown.failed ? "err" : undefined}>
        {shown.text}
      </p>
    </div>
  );
}

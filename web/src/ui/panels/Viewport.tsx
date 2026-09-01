/**
 * `#viewport`, and the two overlays that sit over the rendered frame.
 *
 * The element itself is here rather than in `App.tsx` for one reason: it
 * carries two classes read from the projection — `paused` and `shooting` —
 * and if the root read them, every change to either would re-render the whole
 * chrome to move one class on one element. This subscribes to exactly those
 * two fields, and the canvas and the overlays are passed through as
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
 */
import type { ReactNode, RefObject } from "react";
import { useSlice } from "../useSlice";
import type { LoadingProjection } from "../projection";

export function Viewport(
  { hostRef, children }: {
    /** Handed to `app/` through `onHost`; see `App`. */
    hostRef: RefObject<HTMLDivElement | null>;
    children: ReactNode;
  },
) {
  const paused = useSlice((p) => p?.paused);
  const shooting = useSlice((p) => p?.toggles.shoot);
  return (
    <div id="viewport" ref={hostRef}
         className={[paused && "paused", shooting && "shooting"]
                    .filter(Boolean).join(" ")}>
      {children}
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

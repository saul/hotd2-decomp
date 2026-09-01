/**
 * Where React is mounted.
 *
 * `app/` is the composition root and the only layer that may see both sides,
 * so the `createRoot` call is here rather than in `ui/` — which keeps `ui/` a
 * library of components with no opinion about how it gets on the page.
 *
 * The host is `#app` and React owns everything inside it, the canvas
 * included. `onHost` is how the canvas and the viewport come back across:
 * they are React's elements, so React hands them over once it has committed
 * them, and the `Player` is built around what it is given rather than around
 * what it can find in the document.
 *
 * Errors have two readers, and they answer different questions. React 19's
 * `onCaughtError` fires for everything any boundary catches, so it is the one
 * place that sees the whole page and can say it once; the boundary's own
 * `onError` knows *which* region died, which the root option cannot tell you
 * from a component stack. Both go to `onError` below.
 *
 * `onError` is a parameter and not a fixed call to `console.error` because the
 * report has somewhere better to go: `main.ts` passes one that pushes a feed
 * row, so a panel that threw reads back in the transcript beside whatever the
 * script was doing when it did. It stays *optional*, with `console.error` as
 * the default, for the window this file cannot close — `createRoot(...).render`
 * below runs the first render before `onHost` has handed the canvas over, so
 * the `Player` the feed belongs to does not exist yet. The caller decides what
 * to do in that window; this file only guarantees that nothing is swallowed.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { App, type UiHost } from "../ui/App";
import type { UiStore } from "../ui/store";

export function mountUi(
  store: UiStore,
  onHost: (h: UiHost) => void,
  onError: (label: string, error: unknown, info?: unknown) => void =
    (label, error, info) => console.error(`ui: ${label} threw`, error, info),
): void {
  const host = document.querySelector("#app");
  if (!host) throw new Error("ui: no #app in index.html");
  // `onUncaughtError`, and deliberately not `onCaughtError`. A boundary that
  // catches already reports through its own `componentDidCatch`, with the
  // label of the region that died; adding `onCaughtError` on top would report
  // every one of those a second time under a name that says nothing. What is
  // left uncovered is the error no boundary caught -- thrown above the root
  // backstop, or from somewhere boundaries do not reach -- and that is the one
  // case where nothing else will say anything at all.
  const root = createRoot(host, {
    onUncaughtError: (error, info) => onError("the page", error, info),
  });
  root.render(createElement(App, { store, onHost, onError }));
}

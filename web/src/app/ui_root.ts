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
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { App, type UiHost } from "../ui/App";
import type { UiStore } from "../ui/store";

export function mountUi(store: UiStore, onHost: (h: UiHost) => void): void {
  const host = document.querySelector("#app");
  if (!host) throw new Error("ui: no #app in index.html");
  createRoot(host).render(createElement(App, { store, onHost }));
}

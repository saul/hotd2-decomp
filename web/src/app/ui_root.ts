/**
 * Where React is mounted.
 *
 * `app/` is the composition root and the only layer that may see both sides,
 * so the `createRoot` call is here rather than in `ui/` — which keeps `ui/`
 * a library of components with no opinion about how it gets on the page.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../ui/App";
import type { UiStore } from "../ui/store";

export function mountUi(store: UiStore): void {
  // A detached host: the panels themselves are portalled into the chrome's
  // existing mount points, so React owns their contents without owning the
  // page. Step 11 ends by turning that round.
  createRoot(document.createElement("div"))
    .render(createElement(App, { store }));
}

/**
 * The two pieces of chrome that are still hand-written DOM.
 *
 * `Minimap` is a canvas painter, which React would only get in the way of;
 * `rememberFolds` is a `localStorage` nicety over the `<details>` elements
 * the panels live in. Everything else that was here — the script tree, the
 * event feed, the inspector and the HUD strip — is now React over a
 * projection, in `ui/`.
 *
 * Neither reads anything from the engine. The minimap takes a `MinimapGraph`
 * — the route table flattened to nodes and edges — which is the last thing
 * `hud/` used to pull out of the exporter's own shape.
 */

import type { MinimapGraph } from "../ui/projection";

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

// -- route minimap ---------------------------------------------------------

/**
 * The route table as a graph. Blocks are laid out by their distance from the
 * entry block, so a branch visibly forks and the alternatives sit side by
 * side -- which is the point of drawing it at all.
 */
export class Minimap {
  private readonly canvas = $<HTMLCanvasElement>("#minimap");
  private layout: { x: number; y: number; index: number }[] = [];
  private graph: MinimapGraph | null = null;
  onSeek: (block: number) => void = () => {};

  constructor() {
    this.canvas.addEventListener("click", (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * this.canvas.width;
      const y = ((e.clientY - r.top) / r.height) * this.canvas.height;
      let best = -1;
      let bestD = 18 * 18;
      for (const n of this.layout) {
        const d = (n.x - x) ** 2 + (n.y - y) ** 2;
        if (d < bestD) { bestD = d; best = n.index; }
      }
      if (best >= 0) this.onSeek(best);
    });
  }

  build(graph: MinimapGraph): void {
    this.graph = graph;
    const by = new Map(graph.nodes.map((n) => [n.index, n]));
    const depth = new Map<number, number>();
    const queue: number[] = [graph.entry];
    depth.set(graph.entry, 0);
    while (queue.length) {
      const b = queue.shift()!;
      const route = by.get(b);
      if (!route || route.kind === "end") continue;
      for (const n of route.next) {
        if (n < 0 || depth.has(n)) continue;
        depth.set(n, (depth.get(b) ?? 0) + 1);
        queue.push(n);
      }
    }
    // Blocks the graph never reaches still get a column, so an orphan is
    // visible rather than silently missing.
    let maxDepth = 0;
    for (const v of depth.values()) maxDepth = Math.max(maxDepth, v);
    for (const b of graph.nodes) {
      if (!depth.has(b.index)) depth.set(b.index, ++maxDepth);
    }

    const byDepth = new Map<number, number[]>();
    for (const [b, d] of depth) {
      let l = byDepth.get(d);
      if (!l) byDepth.set(d, (l = []));
      l.push(b);
    }
    const cols = maxDepth + 1;
    const w = Math.max(360, cols * 26);
    this.canvas.width = w;
    const h = this.canvas.height;
    this.layout = [];
    for (const [d, list] of byDepth) {
      list.sort((a, b) => a - b);
      list.forEach((b, i) => {
        this.layout.push({
          index: b,
          x: 14 + (d * (w - 28)) / Math.max(1, cols - 1),
          y: h / 2 + (i - (list.length - 1) / 2) * 22,
        });
      });
    }
    this.draw(-1);
  }

  draw(current: number): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx || !this.graph) return;
    const by = new Map(this.graph.nodes.map((n) => [n.index, n]));
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);
    const pos = new Map(this.layout.map((n) => [n.index, n]));

    ctx.lineWidth = 1;
    for (const n of this.layout) {
      const route = by.get(n.index);
      if (!route) continue;
      for (const t of route.next) {
        const to = pos.get(t);
        if (t < 0 || !to) continue;
        ctx.strokeStyle = route.kind === "branch" ? "#5a4520" : "#28323d";
        ctx.beginPath();
        ctx.moveTo(n.x + 6, n.y);
        ctx.bezierCurveTo((n.x + to.x) / 2, n.y, (n.x + to.x) / 2, to.y,
                          to.x - 6, to.y);
        ctx.stroke();
      }
    }
    for (const n of this.layout) {
      const route = by.get(n.index);
      const isCur = n.index === current;
      ctx.fillStyle = isCur
        ? "#ffe14d"
        : route?.kind === "branch"
          ? "#ff8c1a"
          : route?.kind === "end"
            ? "#ff4d6a"
            : "#3b4a58";
      ctx.beginPath();
      ctx.arc(n.x, n.y, isCur ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      if (isCur) {
        ctx.fillStyle = "#d7dee6";
        ctx.font = "10px ui-monospace, Menlo, monospace";
        ctx.fillText(String(n.index), n.x + 9, n.y + 3);
      }
    }
  }
}

// -- panel folds ------------------------------------------------------------

/**
 * Remember which sidebar panels are open.
 *
 * There is more worth showing than fits, so the panels fold — and a layout you
 * have to rebuild after every reload is one you stop using. Per-viewer and
 * disposable by nature, so `localStorage`, wrapped: a browser set to block
 * site data throws on the accessor rather than returning null.
 */
export function rememberFolds(root = "#right"): void {
  const KEY = "hod2.folds";
  let open: Record<string, boolean> = {};
  try {
    open = JSON.parse(localStorage.getItem(KEY) ?? "{}") as typeof open;
  } catch { /* first run, private window, or site data blocked */ }

  const panels = [...document.querySelectorAll<HTMLDetailsElement>(
    `${root} details.fold[id]`)];

  // A control in the header is a control, not a fold handle. `summary`
  // toggles its `details` on any click inside it, so the `box` checkboxes and
  // the feed's `clear` button would collapse the panel they belong to.
  for (const c of document.querySelectorAll<HTMLElement>(
      `${root} summary input, ${root} summary button, ${root} summary label`)) {
    c.addEventListener("click", (e) => e.stopPropagation());
  }

  for (const d of panels) {
    if (d.id in open) d.open = open[d.id];
    d.addEventListener("toggle", () => {
      const state: Record<string, boolean> = {};
      for (const q of panels) state[q.id] = q.open;
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
    });
  }
}

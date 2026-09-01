/**
 * The route table, as a graph you can click.
 *
 * Blocks are laid out by their distance from the entry block, so a branch
 * visibly forks and the alternatives sit side by side — which is the point of
 * drawing it at all. Blocks the graph never reaches still get a column, so an
 * orphan is visible rather than silently missing.
 *
 * A canvas, so the paint is imperative; that is the one place React is not
 * the right tool and it is fenced into a single effect over a ref. What
 * matters is that the canvas is *this component's* — it used to be a
 * `document.querySelector` in `hud/ui.ts` painted from `Player.refreshUi`,
 * which made the route graph a thing the shell had to remember to redraw.
 */
import { useEffect, useMemo, useRef } from "react";
import type { MinimapGraph } from "../projection";
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";

const HEIGHT = 150;

interface Node { index: number; x: number; y: number }

/**
 * Where each block sits, and how wide the canvas has to be to hold them.
 *
 * One function because the width is a function of the column count and the
 * positions are a function of the width — splitting them is how you get a
 * layout drawn against a canvas of a different size.
 */
function layoutOf(graph: MinimapGraph): { width: number; nodes: Node[] } {
  const by = new Map(graph.nodes.map((n) => [n.index, n]));
  const depth = new Map<number, number>([[graph.entry, 0]]);
  const queue: number[] = [graph.entry];
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
  const width = Math.max(360, cols * 26);
  const nodes: Node[] = [];
  for (const [d, list] of byDepth) {
    list.sort((a, b) => a - b);
    list.forEach((b, i) => {
      nodes.push({
        index: b,
        x: 14 + (d * (width - 28)) / Math.max(1, cols - 1),
        y: HEIGHT / 2 + (i - (list.length - 1) / 2) * 22,
      });
    });
  }
  return { width, nodes };
}

const EMPTY = { width: 360, nodes: [] as Node[] };

// The block, not the whole `current` triple: the step and the op move on every
// instruction and this only draws the block, so subscribing to the field it
// paints is the difference between a canvas repaint per op and one per block.
export function Minimap() {
  const dispatch = useDispatch();
  const graph = useSlice((p) => p?.minimap);
  const block = useSlice((p) => p?.current?.block);
  const current = block ?? -1;
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width, nodes: layout } = useMemo(
    () => graph ? layoutOf(graph) : EMPTY, [graph]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || !graph) return;
    const by = new Map(graph.nodes.map((n) => [n.index, n]));
    const pos = new Map(layout.map((n) => [n.index, n]));
    ctx.clearRect(0, 0, el.width, el.height);

    ctx.lineWidth = 1;
    for (const n of layout) {
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
    for (const n of layout) {
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
  }, [graph, layout, current]);

  return (
    <canvas id="minimap" ref={canvas} width={width} height={HEIGHT}
            onClick={(e) => {
              const el = e.currentTarget;
              const r = el.getBoundingClientRect();
              const x = ((e.clientX - r.left) / r.width) * el.width;
              const y = ((e.clientY - r.top) / r.height) * el.height;
              let best = -1;
              let bestD = 18 * 18;
              for (const n of layout) {
                const d = (n.x - x) ** 2 + (n.y - y) ** 2;
                if (d < bestD) { bestD = d; best = n.index; }
              }
              if (best >= 0) dispatch({ kind: "seek", block: best, step: 0, op: 0 });
            }} />
  );
}

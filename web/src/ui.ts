/**
 * The DOM side: script tree, event feed, HUD, inspector, route minimap.
 *
 * Everything here is a view over the resolved script. The one rule it follows
 * throughout: an opcode whose meaning is still only "the global it writes"
 * shows its **raw operands**, never a guessed label. A plausible wrong name is
 * worse than a hex dword.
 */

import type { BlockJson, OpJson, ScriptJson } from "./bundle";
import type { FeedEntry } from "./walker";
import { STATUS_TITLE, opStatus } from "./opstatus";

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

/** A one-line operand summary for the tree and the feed. */
export function opSummary(op: OpJson): string {
  if (op.action === "cam_play") {
    const where = op.cam ? `${op.cam.file}[${op.cam.path}]` : `slot ${op.slot}`;
    if (op.static) return `${where} hold @${op.start}`;
    if (op.resume) return `${where} resume -> ${op.end}`;
    return `${where} ${op.start}..${op.end}`;
  }
  if (op.action) return `${op.action} ${(op.args ?? []).join(" ")}`.trim();
  if (op.region !== undefined) return `region ${op.region}`;
  if (op.slot !== undefined) {
    return `slot ${op.slot}${op.file ? ` = ${op.file}[${op.entry}]` : ""}`;
  }
  if (op.file) return op.file;
  if (op.spawns) {
    const cls = [...new Set(op.spawns.map((s) => s.class))].join(",");
    return `${op.spawns.length} x class ${cls}`;
  }
  if (op.blocks_on) return `${op.arg ?? 0} — ${op.blocks_on}`;
  if (op.channel_name !== undefined) {
    const v = op.components ? op.components.join(",") : op.value;
    return `${op.channel_name} = ${v ?? "?"}`;
  }
  if (op.track !== undefined) return `track ${op.track}`;
  if (op.sound !== undefined) return `sound ${op.sound}`;
  if (op.ground_y !== undefined) return `y = ${op.ground_y.toFixed(3)}`;
  if (op.pitch_deg !== undefined) {
    return `pitch ${op.pitch_deg.toFixed(1)}° yaw ${(op.yaw_deg ?? 0).toFixed(1)}°`;
  }
  if (op.flag !== undefined) return `flag ${op.flag}`;
  if (op.value !== undefined) return String(op.value);
  if (op.raw) return op.raw.join(" ");
  return "";
}

// -- script tree -----------------------------------------------------------

export interface TreeTarget {
  block: number;
  step: number;
  op: number;
}

export class ScriptTree {
  private readonly el = $("#tree");
  private readonly filter = $<HTMLInputElement>("#tree-filter");
  private current: HTMLElement | null = null;
  private currentBlock: HTMLElement | null = null;
  onSeek: (t: TreeTarget) => void = () => {};

  constructor() {
    this.filter.addEventListener("input", () => this.applyFilter());
    this.el.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest(".op") as HTMLElement | null;
      if (!row) return;
      this.onSeek({
        block: Number(row.dataset.b),
        step: Number(row.dataset.s),
        op: Number(row.dataset.o),
      });
    });
  }

  build(script: ScriptJson): void {
    const frag = document.createDocumentFragment();
    for (const blk of script.blocks) {
      if (blk.hole) continue;
      frag.appendChild(this.blockNode(blk));
    }
    this.el.replaceChildren(frag);
    this.current = null;
    this.currentBlock = null;
  }

  private blockNode(blk: BlockJson): HTMLElement {
    const d = document.createElement("details");
    d.className = "blk";
    d.dataset.b = String(blk.index);

    const targets = blk.route.next.filter((n) => n >= 0);
    const sum = document.createElement("summary");
    sum.title =
      `block ${blk.index} — ${blk.route.kind}` +
      `${targets.length ? " → " + targets.join(", ") : ""}, ` +
      `${blk.steps?.length ?? 0} steps`;
    sum.innerHTML =
      `<span class="bid">${blk.index}</span>` +
      `<span class="route ${blk.route.kind}">${blk.route.kind}` +
      `${targets.length ? " → " + targets.join(",") : ""}</span>` +
      `<span class="nsteps">${blk.steps?.length ?? 0}s</span>`;
    d.appendChild(sum);

    for (const step of blk.steps ?? []) {
      const s = document.createElement("div");
      s.className = "stp";
      const lbl = document.createElement("span");
      lbl.className = "lbl";
      // EvtAdvanceBlockOrRoute sets the step index to 1 on every block change,
      // so step 0 is only reached through the checkpoint path.
      lbl.textContent = step.index === 0
        ? "step 0  (checkpoint state — a block change enters at step 1)"
        : `step ${step.index}`;
      s.appendChild(lbl);
      for (const op of step.ops) {
        const summary = opSummary(op);
        const status = opStatus(op.op);
        const row = document.createElement("div");
        row.className = `op cat-${op.cat} st-${status}`;
        row.dataset.b = String(blk.index);
        row.dataset.s = String(step.index);
        row.dataset.o = String(op.i);
        row.dataset.q = `${op.name} ${op.cat} ${summary}`.toLowerCase();
        // The panel is narrow and the operand summary ellipsizes, so the whole
        // row is also its own tooltip -- and it says whether the player acts
        // on the instruction at all.
        row.title = `${op.i}  ${op.name}${summary ? "  " + summary : ""}` +
          `\n${STATUS_TITLE[status]}`;
        row.innerHTML =
          `<span class="oi">${op.i}</span>` +
          `<span class="nm">${op.name}</span>` +
          `<span class="ar">${escapeHtml(summary)}</span>`;
        s.appendChild(row);
      }
      d.appendChild(s);
    }
    return d;
  }

  private applyFilter(): void {
    const q = this.filter.value.trim().toLowerCase();
    for (const row of this.el.querySelectorAll<HTMLElement>(".op")) {
      row.style.display = !q || (row.dataset.q ?? "").includes(q) ? "" : "none";
    }
    for (const blk of this.el.querySelectorAll<HTMLDetailsElement>(".blk")) {
      const any = !q ||
        [...blk.querySelectorAll<HTMLElement>(".op")]
          .some((r) => r.style.display !== "none");
      blk.style.display = any ? "" : "none";
      if (q && any) blk.open = true;
    }
  }

  mark(block: number, step: number, op: number): void {
    this.current?.classList.remove("current");
    this.currentBlock?.classList.remove("current");
    const blk = this.el.querySelector<HTMLDetailsElement>(
      `.blk[data-b="${block}"]`,
    );
    if (blk) {
      blk.classList.add("current");
      blk.open = true;
      this.currentBlock = blk;
    }
    const row = this.el.querySelector<HTMLElement>(
      `.op[data-b="${block}"][data-s="${step}"][data-o="${op}"]`,
    );
    if (row) {
      row.classList.add("current");
      this.current = row;
      row.scrollIntoView({ block: "nearest" });
    }
  }
}

// -- event feed ------------------------------------------------------------

export class EventFeed {
  private readonly el = $("#feed");
  private readonly max = 400;
  onSeek: (t: TreeTarget) => void = () => {};

  constructor() {
    $("#feed-clear").addEventListener("click", () => this.clear());
    this.el.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest(".fe") as HTMLElement | null;
      if (!row) return;
      this.onSeek({
        block: Number(row.dataset.b),
        step: Number(row.dataset.s),
        op: Number(row.dataset.o),
      });
    });
  }

  clear(): void {
    this.el.replaceChildren();
  }

  push(e: FeedEntry): void {
    const row = document.createElement("div");
    row.className = `fe cat-${e.op.cat} st-${opStatus(e.op.op)}`;
    row.title = STATUS_TITLE[opStatus(e.op.op)];
    row.dataset.b = String(e.block);
    row.dataset.s = String(e.step);
    row.dataset.o = String(e.opIndex);
    row.innerHTML =
      `<span class="at">${e.block}.${e.step}.${e.opIndex}</span>` +
      `<span class="nm">${e.op.name}</span>` +
      `<span class="ar dim">${escapeHtml(opSummary(e.op))}</span>` +
      (e.note ? `<span class="note">${escapeHtml(e.note)}</span>` : "");
    const atBottom =
      this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 24;
    this.el.appendChild(row);
    while (this.el.childElementCount > this.max) {
      this.el.firstElementChild?.remove();
    }
    if (atBottom) this.el.scrollTop = this.el.scrollHeight;
  }
}

// -- hud -------------------------------------------------------------------

export class Hud {
  private readonly el = $("#hud");

  set(rows: [string, string, boolean?][]): void {
    this.el.replaceChildren(
      ...rows.flatMap(([k, v, hot]) => {
        const a = document.createElement("span");
        a.className = "k";
        a.textContent = k;
        const b = document.createElement("span");
        b.className = hot ? "v hot" : "v";
        b.textContent = v;
        return [a, b];
      }),
    );
  }
}

// -- inspector -------------------------------------------------------------

export class Inspector {
  private readonly el = $("#inspector");

  show(op: OpJson | null, extra?: Record<string, unknown>): void {
    if (!op) {
      this.el.textContent = "";
      return;
    }
    const body: Record<string, unknown> = {
      opcode: `0x${op.op.toString(16).toUpperCase().padStart(2, "0")}`,
      name: op.name,
      category: op.cat,
      file_offset: `0x${op.at.toString(16).toUpperCase()}`,
    };
    for (const [k, v] of Object.entries(op)) {
      if (["i", "at", "op", "name", "cat"].includes(k)) continue;
      body[k] = v;
    }
    if (extra) Object.assign(body, extra);
    this.el.textContent = JSON.stringify(body, null, 1);
  }
}

// -- route minimap ---------------------------------------------------------

/**
 * The route table as a graph. Blocks are laid out by their distance from the
 * entry block, so a branch visibly forks and the alternatives sit side by
 * side -- which is the point of drawing it at all.
 */
export class Minimap {
  private readonly canvas = $<HTMLCanvasElement>("#minimap");
  private layout: { x: number; y: number; index: number }[] = [];
  private script: ScriptJson | null = null;
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

  build(script: ScriptJson): void {
    this.script = script;
    const depth = new Map<number, number>();
    const queue: number[] = [script.entry_block];
    depth.set(script.entry_block, 0);
    while (queue.length) {
      const b = queue.shift()!;
      const route = script.routes[b];
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
    for (const b of script.blocks) {
      if (!b.hole && !depth.has(b.index)) depth.set(b.index, ++maxDepth);
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
    if (!ctx || !this.script) return;
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);
    const pos = new Map(this.layout.map((n) => [n.index, n]));

    ctx.lineWidth = 1;
    for (const n of this.layout) {
      const route = this.script.routes[n.index];
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
      const route = this.script.routes[n.index];
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

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

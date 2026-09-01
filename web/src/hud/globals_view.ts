/**
 * The data segment, on screen, read-only.
 *
 * The port keeps all its state in `G` and the actor list precisely so that a
 * snapshot can be taken of it; the same property makes it displayable. This
 * walks the object and prints it, so what the port believes is visible next to
 * what the renderer is drawing.
 *
 * Read-only on purpose. A writable globals panel would be a fourth way for
 * state to enter the game — after the script, the port and a snapshot — and
 * nothing that happens here would be reproducible from a save.
 *
 * The addresses come out of `game/globals.ts` itself, at build time, by the
 * same regex `tools/verify_port.py` uses. Retyping them here would be a second
 * source of truth for something already checked against `globals.tsv`.
 */
import globalsSrc from "../game/globals.ts?raw";
import { G } from "../game/globals";
import type { Actor } from "../game/actor";
import { SpawnClass } from "../game/spawn_class";
import { ZombieState } from "../game/class30/states";
import { g_class_handlers } from "../game/registry";

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

/** `` `g_attack_permits` — `0x009A2BA0` `` in a doc comment. */
const CITATION = /`(g_[A-Za-z0-9_]+)`\s*[-—]+\s*`?0x([0-9A-Fa-f]{6,8})`?/g;

const ADDRESSES: Map<string, string> = new Map(
  [...globalsSrc.matchAll(CITATION)].map(
    (m) => [m[1], m[2].toUpperCase().padStart(8, "0")]),
);

/** Keys rendered as their own section rather than as a value. */
const POOLS = new Set(["g_object_list", "g_thrown_weapons"]);

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const num = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(2);

function value(v: unknown): string {
  if (typeof v === "number") return num(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map((x) => value(x)).join(", ")}]`;
  if (v && typeof v === "object" && "x" in v) {
    const p = v as { x: number; y: number; z: number };
    return `(${num(p.x)}, ${num(p.y)}, ${num(p.z)})`;
  }
  return String(v);
}

/** Class 0x30 is the only class whose state indices are named. */
function stateName(a: Actor): string {
  if (a.cls !== SpawnClass.Zombie) return `state ${a.state}`;
  return ZombieState[a.state] ?? `state ${a.state}`;
}

function actorRow(a: Actor): string {
  const cls = SpawnClass[a.cls] ?? `0x${a.cls.toString(16)}`;
  const ported = g_class_handlers[a.cls] !== undefined;
  const flags = [
    a.dead ? "dead" : null,
    !a.visible ? "unloaded" : null,
    a.attackPermit >= 0 ? `permit ${a.attackPermit}` : null,
    a.zones ? `zones ${a.zones}` : null,
    ported ? null : "no module",
  ].filter(Boolean).join(" · ");
  return `<tr class="${a.dead ? "gdead" : ""}">`
    + `<td class="gk">${a.at.toString(16)}</td>`
    + `<td>${esc(cls)}</td>`
    + `<td>${esc(ported ? stateName(a) : "—")}/${a.sub}</td>`
    + `<td>hp ${a.hp}</td>`
    + `<td class="gdim">${esc(flags)}</td></tr>`;
}

export class GlobalsView {
  // The panel *is* the `<details>` now that every right-hand panel folds,
  // so there is no inner one to look up.
  private readonly panel = $<HTMLDetailsElement>("#globals-panel");
  private readonly el = $("#globals");
  private last = "";

  /** Rebuild only when something changed, and only while the panel is open. */
  update(): void {
    if (!this.panel.open) return;
    const rows: string[] = [];
    for (const [k, v] of Object.entries(G)) {
      if (POOLS.has(k)) continue;
      const addr = ADDRESSES.get(k);
      rows.push(
        `<tr><td class="gk" title="${addr ? `0x${addr}`
          : "no address cited in game/globals.ts"}">`
        + `${esc(k)}</td><td class="gv">${esc(value(v))}</td>`
        + `<td class="gaddr">${addr ? `0x${addr}` : ""}</td></tr>`);
    }
    const live = G.g_object_list.filter((a) => a.visible && !a.dead).length;
    const html =
      `<table class="gt">${rows.join("")}</table>`
      + `<div class="ghead">g_object_list · ${live} live of `
      + `${G.g_object_list.length}</div>`
      + `<table class="gt">${G.g_object_list.map(actorRow).join("")}</table>`
      + (G.g_thrown_weapons.length
        ? `<div class="ghead">g_thrown_weapons · `
          + `${G.g_thrown_weapons.length}</div>`
          + `<table class="gt">${G.g_thrown_weapons.map((w) =>
            `<tr><td class="gk">${w.id}</td><td>slot ${w.slot}</td>`
            + `<td>ttl ${num(w.ttl)}</td>`
            + `<td class="gdim">${w.hit ? "hit" : "in flight"}</td></tr>`)
            .join("")}</table>`
        : "");
    if (html === this.last) return;
    this.last = html;
    this.el.innerHTML = html;
  }
}

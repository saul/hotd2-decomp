/**
 * The disposal tree, on screen.
 *
 * A leak is invisible until it is counted. This is what makes one visible
 * without a profiler: the live scope tree, each node stamped with the frame it
 * was opened at, and repeated siblings collapsed into a tallied row.
 *
 * Three readings, and each catches a different leak:
 *
 * * **`openedAt` older than the current stage load** — a scope that survived a
 *   teardown. Nothing else in the player can tell you that, which is why the
 *   frame is on every row rather than only on the interesting ones.
 * * **A sibling tally that only grows** — `effect:thrown ×112` is a leak you
 *   can see from across the room; a hundred and twelve rows is a wall of text
 *   you scroll past.
 * * **`owned` growing under a flat tree** — something is registering into a
 *   scope that never closes.
 *
 * It reads a plain `ScopeNode[]`, built in `app/` and handed over. That is on
 * purpose: `hud/` reaching into `core/` for the live tree is what
 * `ui-reads-projection-only` counts, and this panel is the first real
 * projection — read-only, plain, cheap to diff — so it is worth designing
 * step 11's seam against.
 */

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

const esc = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

/** The shape `app/` hands over. Mirrors `core/scope.ts`'s own projection. */
export interface ScopeRow {
  name: string;
  openedAt: number;
  owned: number;
  children: ScopeRow[];
}

/** What the panel is told about the run, so it can call a row suspect. */
export interface ScopeContext {
  /** `ctx.frame` now. */
  frame: number;
  /** The frame the current stage finished loading at. */
  stageLoadedAt: number;
}

/** Siblings with the same name become one row with a count. */
interface Grouped {
  name: string;
  /** How many siblings share this name. */
  count: number;
  /** The oldest `openedAt` among them — the one worth suspecting. */
  openedAt: number;
  owned: number;
  children: ScopeRow[];
}

function group(rows: ScopeRow[]): Grouped[] {
  const by = new Map<string, Grouped>();
  for (const r of rows) {
    const g = by.get(r.name);
    if (!g) {
      by.set(r.name, { name: r.name, count: 1, openedAt: r.openedAt,
                       owned: r.owned, children: r.children });
      continue;
    }
    g.count += 1;
    g.owned += r.owned;
    // The oldest wins: if a hundred scopes share a name, the one that has been
    // open longest is the one that tells you when the leak started.
    if (r.openedAt < g.openedAt) g.openedAt = r.openedAt;
    // Only the first sibling's children are drawn. A hundred identical
    // subtrees is noise, and the tally already says there are a hundred.
    if (g.count === 2) g.children = g.children.slice(0, 0).concat(g.children);
  }
  return [...by.values()];
}

export class ScopeView {
  private readonly panel = $<HTMLDetailsElement>("#scope-panel");
  private readonly el = $("#scopes");
  private last = "";

  /** Rebuild only when something changed, and only while the panel is open. */
  update(root: ScopeRow | null, ctx: ScopeContext): void {
    if (!this.panel.open) return;
    const html = root
      ? `<div class="scope-tree">${this.rows([root], ctx, 0).join("")}</div>`
        + this.summary(root)
      : `<div class="gdim">no scopes open</div>`;
    if (html === this.last) return;
    this.last = html;
    this.el.innerHTML = html;
  }

  private rows(nodes: ScopeRow[], ctx: ScopeContext, depth: number): string[] {
    const out: string[] = [];
    for (const g of group(nodes)) {
      // A scope under the stage that predates the stage's own load frame
      // cannot have been opened by this stage.
      const stale = depth > 1 && g.openedAt < ctx.stageLoadedAt;
      // An unbounded sibling tally is the other shape a leak takes.
      const many = g.count >= 32;
      const warn = stale || many;
      out.push(
        `<div class="scope-row${warn ? " scope-warn" : ""}"`
        + ` style="padding-left:${depth * 12}px">`
        + `<span class="scope-name">${esc(g.name)}</span>`
        + (g.count > 1 ? `<span class="scope-count">×${g.count}</span>` : "")
        + `<span class="scope-frame" title="opened at frame ${g.openedAt}`
        + `${stale ? ", before this stage loaded" : ""}">f${g.openedAt}</span>`
        + `<span class="scope-owned">${g.owned}</span>`
        + (warn ? `<span class="scope-flag" title="${stale
            ? "opened before the current stage load — this scope survived a teardown"
            : "a large and growing sibling tally"}">⚠</span>` : "")
        + `</div>`);
      out.push(...this.rows(g.children, ctx, depth + 1));
    }
    return out;
  }

  private summary(root: ScopeRow): string {
    let scopes = 0;
    let owned = 0;
    const walk = (n: ScopeRow): void => {
      scopes += 1;
      owned += n.owned;
      for (const c of n.children) walk(c);
    };
    walk(root);
    this.peakScopes = Math.max(this.peakScopes, scopes);
    this.peakOwned = Math.max(this.peakOwned, owned);
    // The high-water mark is the row that catches slow growth: a tree that
    // looks fine now but has been twice this size is still leaking.
    return `<div class="ghead">${scopes} scopes · ${owned} owned `
         + `<span class="gdim">(peak ${this.peakScopes} / ${this.peakOwned})`
         + `</span></div>`;
  }

  private peakScopes = 0;
  private peakOwned = 0;

  /** A stage switch resets the marks; they measure one stage's run. */
  reset(): void {
    this.peakScopes = 0;
    this.peakOwned = 0;
    this.last = "";
  }
}

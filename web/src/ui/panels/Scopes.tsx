/**
 * The disposal tree, on screen.
 *
 * A leak is invisible until it is counted. This is what makes one visible
 * without a profiler, and three readings each catch a different leak:
 *
 * * **`openedAt` older than the current stage load** — a scope that survived a
 *   teardown. Nothing else in the player can tell you that, which is why the
 *   frame is on every row and not only the interesting ones.
 * * **A sibling tally that only grows** — `effect:thrown ×112` is a leak you
 *   can see from across the room; a hundred and twelve rows is a wall of text
 *   you scroll past.
 * * **`owned` growing under a flat tree** — something is registering into a
 *   scope that never closes.
 */
import { useMemo, useRef } from "react";
import type { ScopeRow } from "./scope_types";

/** A sibling tally past this is a leak, not a busy frame. */
const CROWD = 32;

interface Grouped {
  name: string;
  count: number;
  /** The oldest of the group — the one that says when the leak started. */
  openedAt: number;
  owned: number;
  children: ScopeRow[];
}

function group(rows: readonly ScopeRow[]): Grouped[] {
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
    if (r.openedAt < g.openedAt) g.openedAt = r.openedAt;
    // Only the first sibling's children are drawn. A hundred identical
    // subtrees is noise, and the tally already says there are a hundred.
  }
  return [...by.values()];
}

function Rows(
  { nodes, depth, stageLoadedAt }:
  { nodes: readonly ScopeRow[]; depth: number; stageLoadedAt: number },
) {
  return (
    <>
      {group(nodes).map((g) => {
        // A scope under the stage that predates the stage's own load frame
        // cannot have been opened by this stage.
        const stale = depth > 1 && g.openedAt < stageLoadedAt;
        const warn = stale || g.count >= CROWD;
        const why = stale
          ? "opened before the current stage load — this scope survived a teardown"
          : "a large and growing sibling tally";
        return (
          <div key={`${depth}:${g.name}`}>
            <div className={`scope-row${warn ? " scope-warn" : ""}`}
                 style={{ paddingLeft: depth * 12 }}>
              <span className="scope-name">{g.name}</span>
              {g.count > 1 && <span className="scope-count">×{g.count}</span>}
              <span className="scope-frame"
                    title={`opened at frame ${g.openedAt}`
                           + (stale ? ", before this stage loaded" : "")}>
                f{g.openedAt}
              </span>
              <span className="scope-owned">{g.owned}</span>
              {warn && <span className="scope-flag" title={why}>⚠</span>}
            </div>
            <Rows nodes={g.children} depth={depth + 1}
                  stageLoadedAt={stageLoadedAt} />
          </div>
        );
      })}
    </>
  );
}

export function Scopes(
  { root, stageLoadedAt }: { root: ScopeRow | null; stageLoadedAt: number },
) {
  const peak = useRef({ scopes: 0, owned: 0 });
  const totals = useMemo(() => {
    let scopes = 0;
    let owned = 0;
    const walk = (n: ScopeRow): void => {
      scopes += 1;
      owned += n.owned;
      for (const c of n.children) walk(c);
    };
    if (root) walk(root);
    return { scopes, owned };
  }, [root]);

  // The high-water mark catches slow growth: a tree that looks fine now but
  // has been twice this size is still leaking. A ref, not state — reading it
  // must not schedule another render.
  peak.current.scopes = Math.max(peak.current.scopes, totals.scopes);
  peak.current.owned = Math.max(peak.current.owned, totals.owned);

  if (!root) return <div className="gdim">no scopes open</div>;
  return (
    <>
      <div className="scope-tree">
        <Rows nodes={[root]} depth={0} stageLoadedAt={stageLoadedAt} />
      </div>
      <div className="ghead">
        {totals.scopes} scopes · {totals.owned} owned{" "}
        <span className="gdim">
          (peak {peak.current.scopes} / {peak.current.owned})
        </span>
      </div>
    </>
  );
}

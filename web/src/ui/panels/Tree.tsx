/**
 * The script panel: a filter box, and the script as a tree.
 *
 * Thousands of rows, none of which change once a stage has loaded — so the
 * whole thing is memoised on the projection's identity and re-renders only
 * when a different stage is loaded. What changes every frame is one row's
 * `current` class, and that is why the highlight is applied to the DOM
 * directly rather than as a prop: threading it through would make React
 * reconcile the whole tree to move one outline.
 *
 * The filter is the same argument. It hides rows by style, over a list React
 * has already committed, because a `useState` filter would rebuild every
 * block on each keystroke.
 *
 * Both of those writes go to nodes **this component rendered**, which is the
 * distinction that matters: "one writer per pixel" is about two layers
 * fighting over one attribute, not about a component reaching for the DOM it
 * owns when React's model is the wrong tool for the job.
 */
import { memo, useEffect, useRef, useState } from "react";
import type { TreeProjection } from "../projection";
import type { Dispatch } from "../commands";

const Block = memo(function Block(
  { b, dispatch }: { b: TreeProjection["blocks"][number]; dispatch: Dispatch },
) {
  return (
    <details className="blk" data-b={b.index}>
      <summary title={b.title}>
        <span className="bid">{b.index}</span>
        <span className={`route ${b.kind}`}>
          {b.kind}{b.targets.length ? ` → ${b.targets.join(",")}` : ""}
        </span>
        <span className="nsteps">{b.stepCount}s</span>
      </summary>
      {b.steps.map((s) => (
        <div className="stp" key={s.index}>
          <span className="lbl">{s.label}</span>
          {s.ops.map((op) => (
            <div key={op.i}
                 className={`op cat-${op.cat} st-${op.status}`}
                 data-b={b.index} data-s={s.index} data-o={op.i}
                 data-q={op.query}
                 title={op.title}
                 onClick={() => dispatch({ kind: "seek", block: b.index,
                                           step: s.index, op: op.i })}>
              <span className="oi">{op.i}</span>
              <span className="nm">{op.name}</span>
              <span className="ar">{op.summary}</span>
            </div>
          ))}
        </div>
      ))}
    </details>
  );
});

export const Tree = memo(function Tree(
  { p, current, dispatch }: {
    p: TreeProjection | null;
    current: { block: number; step: number; op: number } | null;
    dispatch: Dispatch;
  },
) {
  const host = useRef<HTMLDivElement>(null);
  // The filter changes nothing outside this panel, so it is component state.
  // It used to be an `<input>` in `index.html` that this subscribed to with a
  // `querySelector` -- a component reaching out of itself for its own control.
  const [q, setQ] = useState("");

  // The highlight, applied straight to the committed DOM. One row gains a
  // class and one loses it, sixty times a second at worst; as a prop it would
  // be a reconciliation of every block in the stage to achieve the same.
  useEffect(() => {
    const el = host.current;
    if (!el || !current) return;
    for (const n of el.querySelectorAll(".current")) {
      n.classList.remove("current");
    }
    const blk = el.querySelector<HTMLDetailsElement>(
      `.blk[data-b="${current.block}"]`);
    if (blk) {
      blk.classList.add("current");
      blk.open = true;
    }
    const row = el.querySelector<HTMLElement>(
      `.op[data-b="${current.block}"][data-s="${current.step}"]`
      + `[data-o="${current.op}"]`);
    if (row) {
      row.classList.add("current");
      row.scrollIntoView({ block: "nearest" });
    }
  }, [current, p]);

  // Same argument for the filter: hide by style over the committed list.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const needle = q.trim().toLowerCase();
    for (const row of el.querySelectorAll<HTMLElement>(".op")) {
      row.style.display =
        !needle || (row.dataset.q ?? "").includes(needle) ? "" : "none";
    }
    for (const blk of el.querySelectorAll<HTMLDetailsElement>(".blk")) {
      const any = !needle
        || [...blk.querySelectorAll<HTMLElement>(".op")]
             .some((r) => r.style.display !== "none");
      blk.style.display = any ? "" : "none";
      if (needle && any) blk.open = true;
    }
  }, [q, p]);

  return (
    <aside id="left">
      <div className="panel-head">
        <strong>Script</strong>
        <input type="search" id="tree-filter" placeholder="filter…"
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div id="tree" className="scroll" ref={host}>
        {p?.blocks.map((b) => <Block key={b.index} b={b} dispatch={dispatch} />)}
      </div>
    </aside>
  );
});

/**
 * Every instruction the script actually ran, in order.
 *
 * Append-only and capped, so a long session reads back as a transcript
 * without growing without bound. It sticks to the bottom unless you have
 * scrolled up — reading back through what happened should not be yanked away
 * by the next instruction.
 */
import { useEffect, useRef } from "react";
import type { FeedRow } from "../projection";
import type { Dispatch } from "../commands";

export function Feed(
  { rows, dispatch }: { rows: readonly FeedRow[]; dispatch: Dispatch },
) {
  const stick = useRef(true);

  // `#feed` is the scroller and it is the chrome's, not this component's --
  // the rows are portalled into it. Until `index.html` becomes a mount point
  // that is the honest way to reach it.
  useEffect(() => {
    const n = document.querySelector<HTMLElement>("#feed");
    if (!n) return;
    const on = () => {
      stick.current = n.scrollTop + n.clientHeight >= n.scrollHeight - 24;
    };
    n.addEventListener("scroll", on);
    return () => n.removeEventListener("scroll", on);
  }, []);

  useEffect(() => {
    const n = document.querySelector<HTMLElement>("#feed");
    if (n && stick.current) n.scrollTop = n.scrollHeight;
  }, [rows]);

  return (
    <>
      {rows.map((e, i) => (
        <div key={i} className={`fe cat-${e.cat} st-${e.status}`}
             title={e.title}
             onClick={() => dispatch({ kind: "seek", block: e.block,
                                       step: e.step, op: e.opIndex })}>
          <span className="at">{e.at}</span>
          <span className="nm">{e.name}</span>
          <span className="ar dim">{e.summary}</span>
          {e.note && <span className="note">{e.note}</span>}
        </div>
      ))}
    </>
  );
}

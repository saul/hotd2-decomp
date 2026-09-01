/**
 * Every instruction the script actually ran, in order.
 *
 * Append-only and capped, so a long session reads back as a transcript
 * without growing without bound. It sticks to the bottom unless you have
 * scrolled up — reading back through what happened should not be yanked away
 * by the next instruction.
 */
import { useEffect, useRef } from "react";
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";

export function Feed() {
  const dispatch = useDispatch();
  const rows = useSlice((p) => p?.feed);
  const stick = useRef(true);
  const box = useRef<HTMLDivElement>(null);

  // The scroller is this component's own element now. It used to be
  // `index.html`'s, reached by `document.querySelector` from in here, because
  // the rows were portalled into it -- a component asking the document for its
  // own container.
  useEffect(() => {
    const n = box.current;
    if (n && stick.current) n.scrollTop = n.scrollHeight;
  }, [rows]);

  return (
    <div id="feed" className="scroll" ref={box}
         onScroll={(e) => {
           const n = e.currentTarget;
           stick.current = n.scrollTop + n.clientHeight >= n.scrollHeight - 24;
         }}>
      {rows?.map((e, i) => (
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
    </div>
  );
}

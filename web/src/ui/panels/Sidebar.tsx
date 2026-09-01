/**
 * The two panels that answer "why is nothing happening".
 *
 * Pure rendering. Every string here was assembled in
 * `app/projection/sidebar.ts`, which is the only place that knows what an
 * actor is — a panel that read `G.g_object_list` itself would be a second
 * reader of engine state with its own idea of when to look, and that is how a
 * sidebar comes to disagree with the boxes drawn round the actors it lists.
 */
import type { ActorsProjection, DebugLine, WaitProjection } from "../projection";
import type { Dispatch } from "../commands";

function Lines({ lines }: { lines: readonly DebugLine[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <div key={i}
             className={l.note ? "dbg-note"
               : `dbg-row${l.hot ? " hot" : ""}${l.dead ? " dead" : ""}`}>
          {l.text}
        </div>
      ))}
    </>
  );
}

export function WaitBody({ p }: { p: WaitProjection | null }) {
  if (!p) return null;
  return <Lines lines={p.lines} />;
}

export function ActorBody(
  { p, dispatch }: { p: ActorsProjection | null; dispatch: Dispatch },
) {
  if (!p) return null;
  if (!p.groups.length) {
    return <div className="dbg-note">The object pool is empty.</div>;
  }
  return (
    <>
      {p.groups.map((g) => (
        <div key={g.cls}>
          <div className="dbg-group">
            <span className="dbg-caret"
                  onClick={() => dispatch({ kind: "foldClass", cls: g.cls,
                                            shut: g.open })}>
              {g.open ? "▾" : "▸"}
            </span>
            <span className="dbg-gname"
                  onClick={() => dispatch({ kind: "foldClass", cls: g.cls,
                                            shut: g.open })}>
              {g.name} · {g.count}{g.ported ? "" : " · no module"}
            </span>
            <span className="dbg-box"
                  title="Draw a box round every actor of this class."
                  onClick={() => dispatch({ kind: "boxClass", cls: g.cls,
                                            on: !g.boxed })}>
              {g.boxed ? "▣ box" : "▢ box"}
            </span>
          </div>
          <Lines lines={g.lines} />
        </div>
      ))}
    </>
  );
}

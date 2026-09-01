/**
 * The branch point, which playback is waiting on.
 *
 * Where the skip bar offers something, this asks a question — and the arcade
 * answers it on a countdown if you do not. Hovering the bar stops that clock,
 * because deciding is not a race; hovering one route previews its opening
 * shot, which is what the arcade does with the `store_six` operands.
 *
 * Not a modal. A branch is a fact about where playback has got to, not an
 * interruption of it.
 */
import type { Dispatch } from "../commands";
import type { BranchProjection } from "../projection";

export function BranchBar({ p, dispatch, onHover }:
  { p: BranchProjection | null; dispatch: Dispatch;
    onHover: (over: boolean) => void }) {
  if (!p) return null;
  return (
    // Deciding is not a race: hovering the bar -- to read the routes, or to
    // preview a shot -- stops the arcade countdown until the pointer leaves.
    // This used to be two `addEventListener` calls in `Player.wireUi`, on an
    // element in `index.html` that this component rendered the contents of.
    <div id="branchbar"
         onPointerEnter={() => onHover(true)}
         onPointerLeave={() => onHover(false)}>
      <span className="tag">Branch</span>
      <span className="dim">{p.sub}</span>
      <span>
        {p.options.map((o) => (
          <button key={o.target}
                  className={o.preview ? "has-preview" : undefined}
                  title={o.title}
                  onPointerEnter={() => o.preview && dispatch({
                    kind: "previewBranch", slot: o.preview.slot,
                    frame: o.preview.frame })}
                  onPointerLeave={() => o.preview
                    && dispatch({ kind: "endPreview" })}
                  onClick={() => dispatch({ kind: "takeBranch",
                                            target: o.target })}>
            {o.label}
          </button>
        ))}
      </span>
      <span className={`countdown${p.paused ? " paused" : ""}`}>
        {p.countdown}
      </span>
    </div>
  );
}

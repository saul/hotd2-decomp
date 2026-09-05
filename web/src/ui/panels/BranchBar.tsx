/**
 * The branch point, which playback is waiting on.
 *
 * **The game has already chosen**, and the marked button says which way. The
 * engine reads `g_script_branch_var` and goes with no pause at all; this bar
 * holds for a second and a half so a viewer can take the other route, and
 * then takes the game's. Hovering the bar stops that clock, because deciding
 * is not a race; hovering one route previews its opening shot, which is what
 * the arcade does with the `store_six` operands.
 *
 * It used to present every route identically with a countdown labelled
 * `picking in`, which is the opposite of what happens: the choice is the
 * game's and these buttons are an override of it.
 *
 * Not a modal. A branch is a fact about where playback has got to, not an
 * interruption of it.
 */
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";

export function BranchBar() {
  const dispatch = useDispatch();
  const p = useSlice((s) => s?.branch);
  if (!p) return null;
  return (
    // Deciding is not a race: hovering the bar -- to read the routes, or to
    // preview a shot -- stops the arcade countdown until the pointer leaves.
    // This used to be two `addEventListener` calls in `Player.wireUi`, on an
    // element in `index.html` that this component rendered the contents of.
    <div id="branchbar"
         onPointerEnter={() => dispatch({ kind: "branchHover", over: true })}
         onPointerLeave={() => dispatch({ kind: "branchHover", over: false })}>
      <span className="tag">Branch</span>
      <span className="dim">{p.sub}</span>
      {/* `routes` rather than an id: a route button is a role, and the bar is
          already identified, so `#branchbar .routes` names it without minting
          a second singleton. The class is what `has-preview` hangs off. */}
      <span className="routes">
        {p.options.map((o) => (
          <button key={o.target}
                  className={[o.chosen && "chosen",
                              o.preview && "has-preview"]
                             .filter(Boolean).join(" ") || undefined}
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

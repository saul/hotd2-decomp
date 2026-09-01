/**
 * Press Start during a skippable cutscene.
 *
 * The whole feature is live in the retail game — region, Start poll, watcher
 * task, and every consumer of the flag — and the retail build never shows it,
 * its skip being one assignment short of working. This bar appears precisely
 * where the game would have accepted a skip.
 *
 * Unlike the branch bar this is an offer, not a question: playback is not
 * waiting on it and ignoring it changes nothing.
 */
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";

export function SkipBar() {
  const dispatch = useDispatch();
  const p = useSlice((s) => s?.skip);
  if (!p) return null;
  return (
    <div id="skipbar" className={p.stacked ? "stacked" : undefined}>
      <span className="tag">Skip</span>
      <span className="dim">{p.sub}</span>
      <button disabled={!p.canSkip}
              onClick={() => dispatch({ kind: "requestSkip" })}>Skip ⏭</button>
      <kbd className="skip-key">Enter</kbd>
    </div>
  );
}

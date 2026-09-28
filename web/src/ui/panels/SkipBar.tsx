/**
 * Press Start during a skippable cutscene.
 *
 * The whole feature is live in the retail game — region, Start poll, watcher
 * task, and every consumer of the flag — and the retail build never shows it,
 * its skip being one assignment short of working. This prompt appears
 * precisely where the game would have accepted a skip, in the corner of the
 * game where a console puts its own, and it is a button because a phone has
 * no Enter key.
 *
 * Unlike the branch bar this is an offer, not a question: playback is not
 * waiting on it and ignoring it changes nothing. What it would skip is the
 * tooltip; the sentence was too long for the corner of a phone.
 */
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";

export function SkipBar() {
  const dispatch = useDispatch();
  const p = useSlice((s) => s?.skip);
  if (!p) return null;
  return (
    <div id="skipbar" className={p.stacked ? "stacked" : undefined}>
      <button disabled={!p.canSkip} title={p.sub}
              onClick={() => dispatch({ kind: "requestSkip" })}>
        Skip <span aria-hidden="true">⏭</span>
      </button>
      <kbd className="skip-key only-fine">Enter</kbd>
    </div>
  );
}

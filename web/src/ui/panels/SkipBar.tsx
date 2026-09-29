/**
 * The corner button: player 1's START, labelled for what it will do.
 *
 * **Skip** during a skippable cutscene. The whole feature is live in the
 * retail game — region, Start poll, watcher task, and every consumer of the
 * flag — and the retail build never shows it, its skip being one assignment
 * short of working. The prompt appears precisely where the game would have
 * accepted a skip, in the corner of the game where a console puts its own.
 *
 * **Continue** on the CONTINUE? countdown, where the game draws PRESS START
 * and a keyboard has Enter but a phone has nothing: without this a phone
 * could only watch the digit run out.
 *
 * One button and not two because it is one button on the pad: both labels
 * dispatch `pressStart`, which is what Enter does, and the exe reads that one
 * press for the skip and the continue alike. If the two are ever live at once,
 * Continue is the label, since a continue let run out ends the game.
 *
 * Unlike the branch bar this is an offer, not a question: playback is not
 * waiting on it and ignoring it changes nothing the game would not have done.
 * What it would do is the tooltip; the sentence was too long for the corner of
 * a phone.
 */
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";

export function SkipBar() {
  const dispatch = useDispatch();
  const skip = useSlice((s) => s?.skip);
  const offer = useSlice((s) => s?.continueOffer);
  const join = useSlice((s) => s?.joinOffer);
  const press = () => dispatch({ kind: "pressStart" });
  if (offer) {
    return (
      <div id="skipbar" className="continue">
        <button disabled={!offer.canContinue} title={offer.sub}
                onClick={press}>
          Continue <span className="continue-digit">{offer.digit}</span>
        </button>
        <kbd className="skip-key only-fine">Enter</kbd>
      </div>
    );
  }
  if (join) {
    // Player 2 out, or player 1 after a continue ran out: the game says PRESS
    // START BUTTON, and a phone has no Enter.
    return (
      <div id="skipbar" className="continue join">
        <button disabled={!join.canJoin} title={join.sub} onClick={press}>
          {join.label}
        </button>
        <kbd className="skip-key only-fine">Enter</kbd>
      </div>
    );
  }
  if (!skip) return null;
  return (
    <div id="skipbar" className={skip.stacked ? "stacked" : undefined}>
      <button disabled={!skip.canSkip} title={skip.sub} onClick={press}>
        Skip <span aria-hidden="true">⏭</span>
      </button>
      <kbd className="skip-key only-fine">Enter</kbd>
    </div>
  );
}

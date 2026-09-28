/**
 * What sits over the game and is not the game: the start and pause screen,
 * the sound button, and the phone-held-upright notice.
 *
 * All three live in `#overlay`, a sibling of `#viewport` rather than a child
 * of it, and that is load-bearing. `render/shooting.ts` listens for
 * `pointerdown` on `#viewport` natively, and React's own handlers run from the
 * root *after* the native ones have fired -- so a button inside the viewport
 * could not stop its press from also being a shot, whatever it did with the
 * event. Outside it, a press on a control never reaches the gun, and the
 * empty parts of `#overlay` are `pointer-events: none`, so a press anywhere
 * else goes straight through to the game.
 */
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";

/**
 * The start screen, and the pause screen: one element, `#paused-overlay`.
 *
 * **Before the first play it is the title card.** The page cannot start the
 * game on its own: a browser will not play sound, go fullscreen or hand over
 * the motion sensors until the viewer has pressed something, and on a phone
 * there is no Space bar and no sidebar open to press Play in. So the stage
 * waits under a Start button, and the press is the gesture all of that needs.
 *
 * **After it, it is `PAUSED` and a Resume button.** Only the button takes the
 * press on a mouse; the rest of the screen is the game, and a click on it is
 * a shot the paused clock refuses, as it always was. On a touch screen the
 * whole screen resumes, because a tap on a paused game has nothing else it
 * could usefully mean and the button is a small target for a thumb.
 */
export function PauseScreen() {
  const dispatch = useDispatch();
  const paused = useSlice((p) => p?.paused);
  const started = useSlice((p) => p?.started);
  const stage = useSlice((p) => p?.stage);
  const original = useSlice((p) => p?.original);
  if (!paused) return null;
  const go = () => dispatch({ kind: started ? "play" : "start" });
  return (
    <div id="paused-overlay" className={started ? "is-paused" : "is-start"}
         onClick={(e) => { if (e.target === e.currentTarget) go(); }}>
      <div className="title-card" onClick={(e) => {
        if (e.target === e.currentTarget) go();
      }}>
        {started
          ? <span className="title">PAUSED</span>
          : <>
              <span className="kicker">The House of the Dead 2</span>
              <span className="title">STAGE {stage}</span>
              {original && <span className="kicker">Original mode</span>}
            </>}
        <button className="start-btn" autoFocus={false} onClick={go}>
          <span aria-hidden="true">▶</span> {started ? "Resume" : "Start"}
        </button>
        <span className="hint only-fine">or press <kbd>Space</kbd></span>
        <span className="hint only-coarse">
          tap to shoot · flick the phone, or tap with a second finger, to reload
        </span>
      </div>
    </div>
  );
}

/**
 * Sound on or off, in the corner of the game.
 *
 * The one audio control a player reaches for, so it stays on screen while
 * everything else went into the menu or the sidebar; the volume is set once
 * and lives in the sidebar's Sound panel. It states what the sound *is*, and
 * `aria-pressed` is the harnesses' way of reading it.
 *
 * Not disabled while the browser is blocking audio: **a press here is what
 * lifts the block**, so a disabled button would be a control that cannot do
 * the one thing it exists for.
 */
export function SoundButton() {
  const dispatch = useDispatch();
  const sound = useSlice((p) => p?.sound);
  if (!sound) return null;
  const blocked = sound.blocked && !sound.muted;
  return (
    <button id="sound" className={`sound${blocked ? " blocked" : ""}`}
            aria-pressed={!sound.muted}
            aria-label={sound.text}
            title={`${sound.text}. ${sound.label}. Browsers block audio until the page is clicked, so this is also the press that unblocks it.`}
            onClick={() => dispatch({ kind: "toggleMute" })}>
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        <path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor" />
        {sound.muted
          ? <path d="M13.5 7.5l4 5m0-5l-4 5" stroke="currentColor"
                  strokeWidth="1.6" strokeLinecap="round" fill="none" />
          : <path d="M13 7a4 4 0 0 1 0 6m2-8.5a7.5 7.5 0 0 1 0 11"
                  stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" fill="none" />}
      </svg>
    </button>
  );
}

/**
 * "Turn your phone round", on a touch screen held upright.
 *
 * The game is 4:3 and landscape, and on a phone held upright it would be a
 * strip across the middle of the screen with a thumb over most of it. The
 * menu's Start asks the browser to lock the orientation, and Android honours
 * that in fullscreen; iOS has no such call at all, which is why this exists.
 * Always rendered, and shown only by the stylesheet's
 * `(orientation: portrait) and (pointer: coarse)` -- a media query is the
 * browser's own answer to the question, with nothing to keep in step.
 */
export function RotateHint() {
  return (
    <div id="rotate-hint" aria-hidden="true">
      <svg viewBox="0 0 48 48" width="56" height="56">
        <rect x="15" y="6" width="18" height="32" rx="3" fill="none"
              stroke="currentColor" strokeWidth="2" />
        <path d="M8 30a16 16 0 0 0 16 12" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" />
        <path d="M22 38l3 4-4 2" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Turn your phone sideways</span>
    </div>
  );
}

/**
 * The transport: the clock, the sound, and the frame slider.
 *
 * The slider is the one control here that is not simply a button. Dragging it
 * takes the camera off the script and puts it on the shot's own curve, so it
 * sends `scrubFrame` on every move and once more with `done` when the pointer
 * is released — `app/` needs both, because *while* you are dragging, the
 * camera systems must not fight you for the pose.
 */
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

// Two subscriptions and no `memo`. `camFrame` moves every frame of playback,
// so this is one of the few components that genuinely re-renders at 60 Hz --
// which is the property the step is after: the ones that re-render are the ones
// whose slice moved, and the rest of the page does not pay for them.
export function Transport() {
  const dispatch = useDispatch();
  const t = useSlice((p) => p?.transport);
  const sound = useSlice((p) => p?.sound);
  if (!t || !sound) return null;
  return (
    <>
      <button title="Back to the entry block"
              onClick={() => dispatch({ kind: "reset" })}>⏮</button>
      {/* Two different axes, side by side on purpose. `⏪` puts the world
          back where it was half a second ago, mid-fight, through the
          snapshot ring; `◀` steps the *script* back one instruction, which
          replays from the entry block and throws the fight away. */}
      <button title={`Rewind (shift+←) — ${t.rewindLabel}`}
              disabled={!t.canRewind}
              onClick={() => dispatch({ kind: "rewind" })}>⏪</button>
      <button title="Previous instruction (←)"
              onClick={() => dispatch({ kind: "stepBack" })}>◀</button>
      <button title="Play / pause (space)"
              onClick={() => dispatch({ kind: t.playing ? "pause" : "play" })}>
        {t.playing ? "⏸" : "▶"}
      </button>
      <button title="Next instruction (→)"
              onClick={() => dispatch({ kind: "stepForward" })}>▶|</button>

      <label className="speed">
        Speed{" "}
        <select value={t.speed}
                onChange={(e) => dispatch({ kind: "setSpeed",
                                            speed: Number(e.target.value) })}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </label>

      <span className="sep" />

      <button className="sound" aria-pressed={!sound.muted}
              title="Sound on / off. Browsers block audio until the page is clicked, so this is also the gesture that unblocks it."
              onClick={() => dispatch({ kind: "toggleMute" })}>
        <span>{sound.muted ? "🔇" : "🔊"}</span> <span>{sound.text}</span>
      </button>
      {/* The ids are the stylesheet's only hold on these three. Each is a
          genuine singleton — there is one volume slider, one audio status
          line, one camera label — so an id says what it is; a role that
          repeats gets a class under an identified container instead. They
          were dropped when this bar moved out of `index.html`, and the sheet
          went on styling ids nothing rendered: the frame slider reflowed on
          every frame for want of `#frame-label`'s `min-width`, and
          `#bgm-label.blocked` — the one audio state that needs a click to
          clear — had no colour to announce itself in. */}
      <input type="range" id="volume" min="0" max="100" step="1"
             value={sound.volume}
             title="BGM volume"
             onChange={(e) => dispatch({ kind: "setVolume",
                                         volume: Number(e.target.value) })} />
      <span id="bgm-label"
            className={`dim${sound.blocked && !sound.muted ? " blocked" : ""}`}>
        {sound.label}
      </span>

      <span className="sep" />

      <label className="framebar">
        <span id="frame-label" className="dim">{t.camLabel}</span>
        <input type="range" disabled={!t.hasPath}
               min={t.camFrameLo} max={t.camFrameHi} step="1"
               value={Math.round(t.camFrame)}
               onChange={(e) => dispatch({ kind: "scrubFrame",
                                           frame: Number(e.target.value),
                                           done: false })}
               // `pointerup`, not `mouseup`: a range input is dragged with a
               // finger or a pen as readily as with a mouse, and those emit no
               // mouse event -- so a touch scrub never sent `done` and the
               // camera stayed off the script until the next mouse drag ended
               // it. Pointer events cover all three devices.
               //
               // **And `pointercancel`, which is the half that was missing.**
               // A pointer that stops being a scrub -- a touch the browser
               // reinterprets as a page scroll, a pen leaving the digitiser,
               // the window losing the pointer to a system gesture -- fires
               // `pointercancel` and never `pointerup`. So `done` was never
               // sent, the camera stayed off the script, and the only way out
               // was to start another drag and finish it properly. The same
               // handler answers both: whatever ended the drag, the drag
               // ended, and the frame it ended on is the frame to settle at.
               onPointerUp={() => dispatch({ kind: "scrubFrame",
                                             frame: t.camFrame, done: true })}
               onPointerCancel={() => dispatch({ kind: "scrubFrame",
                                                 frame: t.camFrame, done: true })}
               onKeyUp={() => dispatch({ kind: "scrubFrame",
                                         frame: t.camFrame, done: true })} />
      </label>
    </>
  );
}

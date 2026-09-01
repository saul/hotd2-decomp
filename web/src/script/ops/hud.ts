/**
 * The shutter and the dialogue captions.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * `verify_player_ops.py` checks against docs/PLAYER_PROGRESS.md.
 */
import type { OpImpl } from "../walker";

/** What the feed calls each state, as `HudDrawShutterState` (`FUN_00413970`)
 *  switches on it. */
const SHUTTER_LABEL: Record<number, string> = {
  0: "closed", 1: "opening", 2: "open", 3: "closing", 4: "closed",
  5: "closed", 6: "open", 7: "restore", 8: "blackout",
};

export const OPS: Record<number, OpImpl> = {
    0x1f: {                                     // set_hud_shutter_state
      status: "done",
      // The whole transition is the walker's -- see `setShutter`. It used to
      // be split, the state here and the slide phase in `hud/`, and a snapshot
      // took only the half that lived here.
      run: (w, op, quiet) => {
        const state = op.value ?? 0;
        w.setShutter(state);
        return quiet ? undefined
          : SHUTTER_LABEL[state] ?? `shutter state ${state}`;
      },
    },
    0x2d: {                                     // play_dialogue
      status: "done",
      // EvtOpPlayDialogue2D returns before both the voice and the subtitle
      // task when the skip flag is up.
      //
      // Nothing happens on a quiet replay, and that is deliberate rather than
      // an oversight: a seek arrives at an address without having spent the
      // frames in between, so a caption started on the way would be one the
      // countdown never had a chance to expire -- and the voice would play.
      run: (w, op, quiet) => {
        if (w.skipRequested) return "not said — skipping";
        if (quiet || op.message_group === undefined) return undefined;
        const m = w.host.showMessage(op.message_group);
        if (!m) return undefined;
        w.captionGroup = op.message_group;
        w.captionFrames = m.frames;
        return m.note;
      },
    },
};

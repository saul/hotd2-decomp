/**
 * The shutter and the dialogue captions.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * `verify_player_ops.py` checks against docs/PLAYER_PROGRESS.md.
 */
import type { OpImpl } from "../walker";

export const OPS: Record<number, OpImpl> = {
    0x1f: {                                     // set_hud_shutter_state
      status: "done",
      run: (w, op, quiet) => {
        w.shutterState = op.value ?? 0;
        w.applyFiringGate(w.shutterState);
        return quiet ? undefined : w.host.setShutter(w.shutterState);
      },
    },
    0x2d: {                                     // play_dialogue
      status: "done",
      // EvtOpPlayDialogue2D returns before both the voice and the subtitle
      // task when the skip flag is up.
      run: (w, op, quiet) => {
        if (w.skipRequested) return "not said — skipping";
        return quiet || op.message_group === undefined
          ? undefined
          : w.host.showMessage(op.message_group);
      },
    },
};

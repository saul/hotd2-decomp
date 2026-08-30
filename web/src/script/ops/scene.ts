/**
 * The backdrop dome and the rain.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * `verify_player_ops.py` checks against docs/PLAYER_PROGRESS.md.
 */
import type { OpImpl } from "../walker";

export const OPS: Record<number, OpImpl> = {

    // -- scenery and HUD ---------------------------------------------------
    0x1b: {                                     // set_backdrop_preset
      status: "done",
      run: (w, op) => {
        w.backdropPreset = op.value ?? -1;
        return `dome preset ${w.backdropPreset}`;
      },
    },
    0x1c: {                                     // set_backdrop_mode
      status: "done",
      run: (w, op) => {
        w.backdropMode = op.value ?? 0;
        return op.means;
      },
    },
    0x1d: {                                     // enable_rain
      status: "done",
      run: (w, op) => {
        w.rain = !!op.value;
        return op.means;
      },
    },
};

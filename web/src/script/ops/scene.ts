/**
 * The backdrop dome and the rain.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * the script panel shows.
 */
import { G } from "../../game/globals";
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
        // `EvtOpEnableRain1D` (`FUN_0045F340`) is one store of its operand
        // into `g_rain_enabled`. The walker's flag above is what the rain's
        // own draw reads; this is the engine's word, which the zombie death
        // effects test for exactly 1 -- so the operand goes in as it is.
        G.g_rain_enabled = op.value ?? 0;
        return op.means;
      },
    },
};

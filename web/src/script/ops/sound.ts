/**
 * Sound effects, the BGM entry and the resume after a skip.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * `verify_player_ops.py` checks against docs/PLAYER_PROGRESS.md.
 */
import type { OpImpl } from "../walker";
import { Walker } from "../walker";

export const OPS: Record<number, OpImpl> = {
    0x2e: {                                     // resume_bgm_if_skipped
      // `if (skip) PlaySoundId(0x80000002)` -- restart the BGM a skipped
      // cutscene interrupted. Inert unless a skip actually happened.
      status: "done",
      run: (w, _op, quiet) => {
        if (w.skipRequested && !quiet) {
          w.host.playSound(0x80000002);
          return "BGM resumed after a skip";
        }
        return undefined;
      },
    },

    // -- audio -------------------------------------------------------------
    // 0x38/0x3A se_play, 0x39/0x3B se_play_3d. The "unless skip" pair really
    // is gated: FUN_0045F750 and FUN_0045F780 both open with
    // `if (g_nEvtSkipFlag == 0)`. That only ever mattered once the player
    // could raise the flag.
    0x38: { status: "done", run: (w, op, quiet) => Walker.playSe(w, op, quiet) },
    0x39: { status: "done", run: (w, op, quiet) => Walker.playSe(w, op, quiet) },
    0x3a: {
      status: "done",
      run: (w, op, quiet) => (w.skipRequested
        ? "silent — skipping" : Walker.playSe(w, op, quiet)),
    },
    0x3b: {
      status: "done",
      run: (w, op, quiet) => (w.skipRequested
        ? "silent — skipping" : Walker.playSe(w, op, quiet)),
    },
    0x5f: {                                     // bgm_entry_play
      status: "done",
      run: (w, op, quiet) => {
        w.bgmTrack = op.track ?? null;
        // The handler is a stop then a play, and only the third operand is
        // used. `quiet` is a replay, where re-triggering audio for every
        // instruction skipped over would be wrong.
        return quiet || op.track === undefined || op.track === null
          ? undefined
          : w.host.playSound(op.track);
      },
    },
    0x5e: { status: "none" },
};

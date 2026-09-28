/**
 * Sound effects, the BGM entry and the resume after a skip.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * `verify_player_ops.py` checks against docs/PLAYER_PROGRESS.md.
 */
import type { OpImpl } from "../walker";
import { Walker } from "../walker";

export const OPS: Record<number, OpImpl> = {
    0x2e: {                                     // stop_voice_if_skipped
      // `EvtOpStopVoiceIfSkipped2E` (`FUN_0045FE00`):
      // `if (skip) PlaySoundId(0x80000002)`. That control word is the
      // **voice's** stop -- `PlaySoundControl` (`FUN_0041D3E0`) sends it to
      // `SoundStopGroup` (`FUN_00401000`) with `g_voice_stop_group`, channel
      // 0x10 -- so this cuts the line a skipped cutscene was in the middle
      // of. It was read as "resume the BGM", and the mixer took every
      // namespace-8 id as a music stop, so a skip silenced the stage's track.
      // Inert unless a skip actually happened.
      status: "done",
      run: (w, _op, quiet) => {
        if (w.skipRequested && !quiet) {
          w.host.playSound(0x80000002);
          return "voice stopped after a skip";
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
      // `EvtOpBgmEntryPlay5F` (`FUN_0045F7C0`) → `BgmStopThenPlay`
      // (`FUN_0041D450`): `PlaySoundId(0x80000000)`, then
      // `PlaySoundId(operand[2])` -- a stop then a play, and only the third
      // operand is used. The stop is what makes `bgm_entry_play 0` silence
      // the music, which is how stages 2, 3, 4 and 6 open; the play is then
      // id 0, `PlaySoundId`'s own nothing. `quiet` is a replay, where
      // re-triggering audio for every instruction skipped over would be
      // wrong -- the walker records the channel either way.
      status: "done",
      run: (w, op, quiet) => {
        const track = op.track ?? 0;
        Walker.trackBgm(w, 0x80000000);
        Walker.trackBgm(w, track);
        if (quiet) return undefined;
        w.host.playSound(0x80000000);
        return track ? w.host.playSound(track) : "bgm stop";
      },
    },
    0x5e: { status: "none" },
};

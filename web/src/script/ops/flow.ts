/**
 * Script flow: flags, checkpoints, the halt, the skippable region, and
 * every opcode that is deliberately inert.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * `verify_player_ops.py` checks against docs/PLAYER_PROGRESS.md.
 */
import type { OpImpl } from "../walker";

export const OPS: Record<number, OpImpl> = {

    // -- the cutscene skip -------------------------------------------------
    0x2c: {                                     // set_skippable_region
      // EvtOpSetSkippableRegion2C:
      //   arg != 0 -> DAT_009A2230 = 0; DAT_009A2D7C = 1
      //   arg == 0 -> DAT_009A2D7C = 0; skip flag = 0
      // Closing always clears the flag, so a skip never carries past the
      // region it was asked for.
      status: "done",
      run: (w, op) => {
        w.skippable = op.open ?? (op.raw?.length
          ? Number.parseInt(op.raw[0], 16) !== 0 : false);
        if (!w.skippable) w.skipRequested = false;
        return op.means;
      },
    },

    // -- flow --------------------------------------------------------------
    0x48: {                                     // set_script_flag
      status: "tracked",
      run: (w, op) => {
        if (op.flag !== undefined) w.flags.add(op.flag);
        return undefined;
      },
    },
    0x4d: {                                     // checkpoint
      status: "tracked",
      run: (w) => {
        w.checkpointBlock = w.block;
        return "checkpoint";
      },
    },
    0x4e: {                                     // halt
      // The handler does not advance pc, so the VM sits here re-running it
      // forever. That is a park, not the end of the scene.
      status: "done",
      run: (w) => {
        w.parked = true;
        return "halt — the script parks here";
      },
    },
    0x4f: {                                     // end_block
      status: "done",
      run: (w, _op, quiet) => {
        w.advanceStepOrRoute(quiet);
        return undefined;
      },
    },

    // -- declared, deliberately not acted on --------------------------------
    // Proved no-ops in the game, dead opcodes, and dispatch slots nothing
    // encodes. Striking these through would suggest the player is missing
    // something; it is not.
    0x00: { status: "none" }, 0x1e: { status: "none" },
    0x2a: { status: "none" }, 0x34: { status: "none" },
    0x3c: { status: "none" }, 0x3d: { status: "none" },
    0x3e: { status: "none" }, 0x3f: { status: "none" },
    0x4c: { status: "none" }, 0x5b: { status: "none" },
    0x5c: { status: "none" }, 0x5d: { status: "none" },

    // Decoded into the feed with their operands, and nothing more. Everything
    // here is a real instruction the player does not yet honour.
    0x13: { status: "tracked" }, 0x16: { status: "tracked" },
};

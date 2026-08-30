/**
 * The spawn opcodes: what the script puts in the level.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * `verify_player_ops.py` checks against docs/PLAYER_PROGRESS.md.
 */
import type { OpImpl } from "../walker";
import { Walker } from "../walker";

export const OPS: Record<number, OpImpl> = {

    // -- spawns ------------------------------------------------------------
    // Only these four resolve to placed markers; measured over all six stage
    // scripts, no other opcode carries a resolved spawn descriptor.
    0x09: { status: "done", run: (w, op) => Walker.pushSpawns(w, op) },
    0x0b: { status: "done", run: (w, op) => Walker.pushSpawns(w, op) },
    0x0c: { status: "done", run: (w, op) => Walker.pushSpawns(w, op) },
    0x0d: {
      status: "done",
      // spawn_obj_unless_skip. FUN_00408B70 walks its -1-terminated operand
      // list either way and only calls the spawn inside `if (skip == 0)`.
      run: (w, op) => (w.skipRequested
        ? "not spawned — skipping" : Walker.pushSpawns(w, op)),
    },
};

/**
 * The waits. These are the ones that hold the interpreter, including the
 * live-enemy gates that combat actually opens.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * `verify_player_ops.py` checks against docs/PLAYER_PROGRESS.md.
 */
import type { OpImpl } from "../walker";

export const OPS: Record<number, OpImpl> = {

    // -- waits -------------------------------------------------------------
    // 0x41 and 0x42 are exact frame counts. 0x40 resolves when the current
    // camera move ends, which is an approximation of "the action ring is
    // empty"; 0x43/0x44 are paced by the combat setting; 0x45 reads a flag
    // array gameplay would write. WAIT_NOTES says which, per instruction.
    0x41: { status: "done", run: (w, op) => w.applyWait(op) },
    0x42: { status: "done", run: (w, op) => w.applyWait(op) },
    0x40: { status: "approx", run: (w, op) => w.applyWait(op) },
    // The wait ends when the enemies are dead, which is the game's own
    // condition. `approx` rather than `done` because a host may still answer
    // null -- the stubs in `test/` have no combat -- and then the combat
    // setting paces it and the feed says so. The player's host never does.
    0x43: { status: "approx", run: (w, op) => w.applyWait(op) },
    0x44: { status: "approx", run: (w, op) => w.applyWait(op) },
    0x45: { status: "approx", run: (w, op) => w.applyWait(op) },
    // 0x46 is the same instruction as 0x43 on `g_civilians_alive`, and is
    // paced exactly as the two enemy gates above are.
    0x46: { status: "approx", run: (w, op) => w.applyWait(op) },
    0x47: { status: "shown", run: (w, op) => w.applyWait(op) },
};

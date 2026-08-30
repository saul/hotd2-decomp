/**
 * The spawn opcodes: what the script puts in the level.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * `verify_player_ops.py` checks against docs/PLAYER_PROGRESS.md.
 */
import type { OpImpl } from "../walker";
import type { OpJson } from "../../bundle";
import { Walker } from "../walker";
import { G } from "../../game/globals";
import { SpawnPropContainers } from "../../game/director";

/** The `-1`-terminated operand list these three opcodes share. */
function approachOperands(op: { raw?: string[] }): number[] {
  const out: number[] = [];
  for (const r of op.raw ?? []) {
    const v = Number.parseInt(r, 16) | 0;
    if (v === -1) break;
    out.push(v);
  }
  return out;
}

/**
 * Push the descriptors, then let the classes that build something on the spot
 * build it.
 *
 * Class 0x41's placer runs and dies on the frame it is spawned, so it has to
 * enter the pool when the **instruction** runs rather than when the next frame
 * draws. That is also what makes a seek work: a replay executes instructions
 * with no frames in between, so anything that waited for a frame would never
 * happen and a reload would come back to a room with no crates in it.
 */
function pushAndPlace(w: Walker, op: OpJson): string | undefined {
  const note = Walker.pushSpawns(w, op);
  SpawnPropContainers(w.spawns);
  return note;
}

export const OPS: Record<number, OpImpl> = {

    // -- spawns ------------------------------------------------------------
    // Only these four resolve to placed markers; measured over all six stage
    // scripts, no other opcode carries a resolved spawn descriptor.
    0x09: { status: "done", run: (w, op) => pushAndPlace(w, op) },
    0x0b: { status: "done", run: (w, op) => pushAndPlace(w, op) },
    0x0c: { status: "done", run: (w, op) => pushAndPlace(w, op) },
    // -- the approach throttle ---------------------------------------------
    /**
     * `EvtOpSetApproachSteps0F` (`FUN_00408C80`): walk the operand list until
     * -1, writing consecutive ints into `g_enemy_approach_steps`, `_mid` and
     * `_outer` -- how deep into the distance queue an enemy may be and still
     * come at you, per ring. Stage 2 sets 2/3/4 in block 3, 2/2/2 in block 9
     * and 1/1/1 in blocks 14 and 18, so the crowd is tuned per encounter.
     */
    0x0f: {
      status: "done",
      run: (w, op) => {
        void w;
        const vals = approachOperands(op);
        if (!vals.length) return undefined;
        const into: (keyof typeof G)[] = ["g_enemy_approach_steps",
                                          "g_enemy_approach_steps_mid",
                                          "g_enemy_approach_steps_outer"];
        vals.slice(0, into.length).forEach((v, i) => {
          (G as unknown as Record<string, number>)[into[i] as string] = v;
        });
        return `approach steps ${vals.slice(0, 3).join("/")}`;
      },
    },
    0x0d: {
      status: "done",
      // spawn_obj_unless_skip. FUN_00408B70 walks its -1-terminated operand
      // list either way and only calls the spawn inside `if (skip == 0)`.
      run: (w, op) => (w.skipRequested
        ? "not spawned — skipping" : pushAndPlace(w, op)),
    },
};

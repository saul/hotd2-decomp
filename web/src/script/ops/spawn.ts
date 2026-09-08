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
import { SpawnPropContainers, SpawnSimpleActors } from "../../game/director";

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

/**
 * `EvtOpSpawnSimple0A` — `FUN_00408990`. The opcode for objects that place
 * themselves.
 *
 * Its operands are **not** the 0x24-byte placement descriptor the other spawn
 * opcodes take: each points at a two-word `{class, hp}` record, and the
 * handler allocates `g_class_handlers[record[0]]` at 0x13F4 bytes, runs
 * `ActorInitFlags` (`FUN_00408970`) and copies `(short)record[1]` into both
 * `obj+0x11C` and `obj+0x11E`. Nothing writes a position.
 *
 * All four records the shipped scripts name live in `comevtbl.bin`, which is
 * why every stage points at the same four addresses: classes 0x60 (the chapter
 * card), 0x61 (the stage-clear card), 0x62 (its tally) and 0x63 (the cutscene
 * skip watcher). **Two of them raise a `g_script_flags` byte the script then
 * waits on**, and until this opcode was ported those twelve
 * `wait_script_flag` gates were gates nothing could open.
 *
 * The list is `-1`-terminated the same way the other spawn opcodes' are, and
 * the exporter has already resolved it — `op.simple`.
 */
export function EvtOpSpawnSimple0A(w: Walker, op: OpJson): string | undefined {
  const note = Walker.pushSimpleSpawns(w, op);
  SpawnSimpleActors(w.simpleSpawns);
  return note;
}

/**
 * Opcodes 0x01-0x08 are the four ordinary spawn opcodes behind a player-count
 * gate and nothing else:
 *
 *     if (g_max_attackers == want) jmp g_evt_spawn_gated_handlers[opcode];
 *     else                         walk the operand list to its -1 and skip;
 *
 * `g_evt_spawn_gated_handlers` — `0x00577650` — is indexed by the opcode, and
 * holds the same four handlers twice, so 0x03 and 0x07 both forward to
 * `EvtOpSpawnObj0B` (`FUN_00408AA0`) and 0x04 and 0x08 to `EvtOpSpawnObjC0C`
 * (`FUN_00408C40`). The descriptors are the ordinary ones; `hod2lib.evt`
 * resolves them for these opcodes too.
 *
 * The gate is `g_max_attackers` — `0x009C8E84` — the count of players
 * *currently in play*, raised in `FUN_00414770` when a player enters a state
 * flagged 0x20 and lowered in `FUN_00414280`. So "mode" in the opcodes' old
 * `spawn_if_mode1_*` names was never a difficulty setting: 0x01-0x04 are the
 * one-player placements and 0x05-0x08 the two-player ones.
 *
 * The two lists overlap rather than replace each other. Stage 1 block 0
 * step 2 runs 0x07 over three class-0x30 descriptors and then 0x03 over the
 * last two of that same three, so a second player adds one zombie to the
 * opening encounter. Skipping both — which is what this client did while
 * these opcodes had no handler — is why stage 1's first zombies never came.
 */
function spawnIfPlayerCount(w: Walker, op: OpJson, want: number): string | undefined {
  if (G.g_max_attackers !== want) {
    return `not spawned — ${want} player${want === 1 ? "" : "s"} only`;
  }
  // `g_evt_spawn_gated_handlers` is indexed by the *opcode*, so 0x02 and 0x06
  // forward to `EvtOpSpawnSimple0A` and the other six to a descriptor opcode.
  // No shipped script encodes 0x02 or 0x06, but the forward is the engine's
  // and folding it away would make the gate mean something it does not.
  return op.simple !== undefined
    ? EvtOpSpawnSimple0A(w, op) : pushAndPlace(w, op);
}

/** `EvtOpSpawnIfOnePlayer` — `FUN_00408820`. Opcodes 0x01-0x04. */
export function EvtOpSpawnIfOnePlayer(w: Walker, op: OpJson): string | undefined {
  return spawnIfPlayerCount(w, op, 1);
}

/** `EvtOpSpawnIfTwoPlayers` — `FUN_00408860`. Opcodes 0x05-0x08. */
export function EvtOpSpawnIfTwoPlayers(w: Walker, op: OpJson): string | undefined {
  return spawnIfPlayerCount(w, op, 2);
}

export const OPS: Record<number, OpImpl> = {

    // -- spawns ------------------------------------------------------------
    // The ungated four. Measured over all six stage scripts, no opcode
    // outside 0x01-0x0D carries a resolved spawn descriptor.
    0x09: { status: "done", run: (w, op) => pushAndPlace(w, op) },
    0x0a: { status: "done", run: EvtOpSpawnSimple0A },
    0x0b: { status: "done", run: (w, op) => pushAndPlace(w, op) },
    0x0c: { status: "done", run: (w, op) => pushAndPlace(w, op) },
    // -- the same four, gated on the live player count ----------------------
    0x03: { status: "done", run: EvtOpSpawnIfOnePlayer },
    0x04: { status: "done", run: EvtOpSpawnIfOnePlayer },
    0x07: { status: "done", run: EvtOpSpawnIfTwoPlayers },
    0x08: { status: "done", run: EvtOpSpawnIfTwoPlayers },
    // The other four gated slots are dispatch entries no shipped file
    // encodes: 0x01/0x05 forward to `EvtOpSpawnPlaced09` and 0x02/0x06 to
    // `EvtOpSpawnSimple0A`. They run the same handlers behind the same
    // `g_max_attackers` test as their siblings above, so they are wired
    // rather than declared dead -- an opcode the engine dispatches is not a
    // hole just because no shipped file reaches it.
    0x01: { status: "done", run: EvtOpSpawnIfOnePlayer },
    0x02: { status: "done", run: EvtOpSpawnIfOnePlayer },
    0x05: { status: "done", run: EvtOpSpawnIfTwoPlayers },
    0x06: { status: "done", run: EvtOpSpawnIfTwoPlayers },
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

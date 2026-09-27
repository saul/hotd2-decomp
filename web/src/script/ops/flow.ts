/**
 * Script flow: flags, checkpoints, the halt, the skippable region, and
 * every opcode that is deliberately inert.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * `verify_player_ops.py` checks against docs/PLAYER_PROGRESS.md.
 */
import type { OpImpl } from "../walker";
import { G } from "../../game/globals";
import { CheckpointResetCamera } from "../../game/camera/actions";

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

    // -- the scene state machine -------------------------------------------
    // `goto_scene_state` is the end-of-room instruction. It trails almost
    // every step -- 548 sites, and **every one passes minor 3** -- sitting
    // between the wait that holds for the room and `advance_step`:
    //
    //     queue_event finish_sequence 4|6|7   ; a `cam/` path camera, state 2
    //     wait_enemies_alive 0                ; the room
    //     goto_scene_state 3                  ; hand the camera back, retire
    //     advance_step
    //
    // `EvtOpGotoSceneState31` (`FUN_0045F870`) enters scene state (1, minor),
    // stamps it, drops the camera mode, the override latch and the eye ease,
    // parks the action slot and takes one off `g_queued_events_pending` --
    // retiring the `0x21`, whose driver never retires itself. Cell (1,3) is
    // `CameraFromViewAngles`. All of it is `EvtGotoSceneState` in
    // `game/camera/actions.ts`; clearing bit 0 of both players' flags hides the
    // on-screen player bodies, which this client draws none of.
    0x31: {
      status: "done",
      run: (w, op) => {
        const minor = op.scene_state_minor ?? 3;
        w.gotoSceneState(minor, true);
        return `scene state 1/${minor}`;
      },
    },
    0x32: {
      // `EvtOpGotoSceneStateWhenPlayersAlive32` is 0x31 plus a park: it sets
      // the yield latch and re-runs every frame until a player is out of the
      // death -> continue -> revive chain (or still has lives), and it leaves
      // the override latch and the eye ease alone. The gate is not modelled
      // here -- it is the players', not the camera's -- so it behaves as open.
      // [diverges]
      status: "tracked",
      run: (w, op) => {
        const minor = op.scene_state_minor ?? 3;
        w.gotoSceneState(minor, false);
        return `scene state 1/${minor} -- the alive gate is always open here`;
      },
    },
    0x33: {
      // `EvtOpSetActionDrainMode33` (`FUN_0045F9F0`):
      // `g_evt_action_advance = op0; g_queued_events_pending += op1`. All 128
      // in the game carry `2, -1`: take back the `finish_sequence` in the slot
      // and let the ring dequeue what is queued behind it, first calling it on
      // the frame after.
      status: "done",
      run: (w, op) => {
        const mode = op.drain_mode ?? 0;
        const delta = (op.pending_delta ?? 0) | 0;
        w.setActionDrainMode(mode, delta);
        return `drain mode ${mode}, pending ${delta >= 0 ? "+" : ""}${delta}`;
      },
    },

    // -- flow --------------------------------------------------------------
    /**
     * `EvtOpSetScriptFlag48` (`FUN_0045FD70`), and the whole handler is
     * `g_script_flags[operand] = 1`. No yield, no test, and there is no
     * clear-flag opcode anywhere in the dispatch table: a flag stays up until
     * `ResetSceneOnEnter` (`FUN_0045EDD0`) zeroes all 0x100 bytes.
     *
     * It writes `G.g_script_flags` — 0x009C7200 — because that is the array
     * the engine writes, and the same one `CivilianRunScript`'s op 0x1C and
     * `ZombieStateTargetScriptWithFlag` write. It used to go into a `Set` on
     * the walker, which `app/systems.ts` copied into `G` once a frame,
     * clobbering everything gameplay had raised.
     */
    0x48: {                                     // set_script_flag
      status: "done",
      run: (w, op) => {
        void w;
        if (op.flag !== undefined) G.g_script_flags[op.flag] = 1;
        return undefined;
      },
    },
    0x4d: {                                     // checkpoint
      // `ResetSceneCombatState` (`FUN_0045EEC0`) ends by recording the block
      // in the run's route history -- `g_route_history[scene][count++] =
      // block`, then -1 after it -- which the game-over route map walks.
      status: "tracked",
      run: (w) => {
        w.checkpointBlock = w.block;
        // The camera half: the published frame to 0, scene state (1,3), the
        // frames-left sentinel, the override latch, the starters' reseat, the
        // eye ease, the held driver, the roll channel and the fixed eye.
        CheckpointResetCamera();
        // The walker's scene, which `G.g_scene_index` mirrors a frame
        // later: the first block's checkpoint runs before that copy.
        const row = G.g_route_history[w.script.scene ?? G.g_scene_index];
        if (row) {
          const i = G.g_route_count;
          // s8 stores: the count and the block are both bytes.
          if (i >= 0 && i < 16) row[i] = (w.block << 24) >> 24;
          if (i + 1 >= 0 && i + 1 < 16) row[i + 1] = -1;
          G.g_route_count = ((i + 1) << 24) >> 24;
        }
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
    0x4f: {                                     // advance_step
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
    0x13: { status: "tracked" },
};

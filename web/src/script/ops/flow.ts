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
    // parks the action ring's handler on a bare RET -- which is what tears
    // down the camera driver the `finish_sequence` installed -- and takes one
    // off `g_queued_events_pending`, retiring that `0x21`. Cell (1,3) is
    // `CameraFromViewAngles`: the pose stops coming from the `cam/` path and
    // starts coming from the player's own view angles at 0x009A60CC/D0/D4.
    //
    // The port draws the camera from the path, not from a view struct, so what
    // it takes from this is the state and the retirement. Three further
    // effects are read but not modelled, and are listed rather than buried:
    // clearing `g_evt_cam_override_valid` (only the row-5 hooks read it),
    // clearing `g_camera_ease_eye`, and clearing bit 0 of both players' flags,
    // which hides the on-screen player rigs -- this client draws none.
    // [diverges]
    0x31: {
      status: "tracked",
      run: (w, op) => {
        const minor = op.scene_state_minor ?? 3;
        w.enterSceneState(1, minor);
        w.retireSceneSequence();
        return `scene state 1/${minor}`;
      },
    },
    0x32: {
      // `EvtOpGotoSceneStateWhenPlayersAlive32` is 0x31 plus a park: it sets
      // the yield latch and re-runs every frame until a player is out of the
      // death -> continue -> revive chain (or still has lives). It also omits
      // two of 0x31's clears. This client has no player death, so the gate is
      // always open and the two omitted clears are ones it does not model
      // either -- it behaves as 0x31. [diverges]
      status: "tracked",
      run: (w, op) => {
        const minor = op.scene_state_minor ?? 3;
        w.enterSceneState(1, minor);
        w.retireSceneSequence();
        return `scene state 1/${minor} -- the alive gate is always open here`;
      },
    },
    0x33: {
      // `EvtOpSetActionDrainMode33`: `mode = op0; pending += op1`, a signed
      // add. All 128 in the game carry -1, so this is the *other* script-side
      // retirement -- it cuts a running `cam_play` short and lets the queued
      // `finish_sequence` behind it start. The dequeue mode itself is not
      // modelled; the ring here runs an action the moment it is queued.
      status: "tracked",
      run: (w, op) => {
        const delta = (op.pending_delta ?? 0) | 0;
        w.addQueuedEvents(delta);
        return `drain mode ${op.drain_mode ?? 0}, pending ${delta >= 0 ? "+" : ""}${delta}`;
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
    0x13: { status: "tracked" }, 0x16: { status: "tracked" },
};

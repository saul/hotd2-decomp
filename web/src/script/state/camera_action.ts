/**
 * `queue_event` (0x30)'s actions, as a table the machine looks up.
 *
 * `EvtOpQueueEvent30` reads a selector and dispatches to one action handler.
 * The port had that as a chain of `if (op.action === "…")` inside
 * `Walker.applyQueueEvent` — a hidden switch of the exact shape `ops/` was
 * built to remove, and the place the ring and camera accounting bugs have
 * historically lived, because "which branch retires the action" was a fact
 * spread over 140 lines instead of a line in each handler.
 *
 * Registered the way `script/ops/` and `script/waits/` register, and checked
 * the way neither of them was: {@link mergeTables} refuses a name two modules
 * both claim, so a handler moved to a new group cannot silently shadow the one
 * it was moved from.
 *
 * **Every handler ends the action.** `EvtOpQueueEvent30` adds one to
 * `g_queued_events_pending` for each action queued and each handler takes it
 * back when it completes — every one of them ends on the same `pending--`. The
 * exception is `finish_sequence`, which installs a persistent camera driver
 * and leaves the count standing for `goto_scene_state` to take back. An action
 * name with no entry here is one the port does not model, and the
 * {@link UNMODELLED} handler retires it, because the engine's does too.
 */
import type { OpJson } from "../../bundle";
import type { Walker } from "../walker";
import { mergeTables } from "../registry";

/**
 * One action's implementation: the walker it runs against, the instruction,
 * and a note for the feed.
 *
 * No `quiet` parameter, unlike {@link OpImpl}: nothing an action does is a
 * side effect on the outside world that a silent replay has to suppress. The
 * camera it starts is state, and `startCamera` is how the scene is told about
 * it on a reload too.
 */
export type ActionImpl = (w: Walker, op: OpJson) => string | undefined;

// -- cam_play (selector 0x40) ---------------------------------------------

const CAM_PLAY: Record<string, ActionImpl> = {
  cam_play: (w, op) => {
    const slot = op.slot ?? -1;
    const start = op.start ?? 0;
    const end = op.end ?? 0;

    // `EvtActionCamPlay40` (`FUN_00403360`) branches in this order, and the
    // order is transcribed rather than rearranged:
    //
    //     if (start == end)  CamEvalStaticPose();      // a held pose
    //     else if (flags & 2) FUN_00403490();          // stash, do not play
    //     else                CamStartPathPlayback();
    //
    // The static test comes first, so a `flags & 2` play whose start equals
    // its end would hold rather than stash. No shipped script has one — 0 of
    // the 392 deferred plays — but the port used to test the flag first, and
    // a transcription that only happens to agree with the data is not one.
    if (start !== end && ((op.flags ?? 0) & 2) !== 0) {
      // `FUN_00403490`, the stash. It is not a plain copy of the operands:
      //
      //     g_stashed_path_frame = operands[0];
      //     if (g_stashed_path_frame == -1)
      //         g_stashed_path_frame = g_cam_path_frame + 1;
      //
      // so **`start == -1` means resume here too**, from the frame the
      // camera is on plus one. The port stashed the literal -1, and the
      // `finish_sequence 6|7` that follows then set the camera to frame -1
      // — off the front of the curve — and replayed the whole path from
      // there. Four plays in the game say -1 and all four are deferred:
      // stage 1 blocks 3 and 8, in both the Arcade and Original bundles.
      // Block 8 step 4 op 23 asks to resume at frame 682 of a 685-frame
      // shot and was replaying 686 frames instead.
      //
      // The rail hook increments before it evaluates, so the first frame it
      // draws is this one plus another. That is not this branch's business —
      // it is `started: false` on the command `finish_sequence` builds below,
      // and while that was missing it was a `[diverges]` written here.
      const at = op.resume ? (w.cam ? w.cam.frame + 1 : 0) : start;
      w.stashedCam = { slot, start: at, end };
      // `FUN_00403490` stashes and returns; the action is done.
      w.ring.retire();
      return `stashed ${at}..${end} for a later scene state 6/7`;
    }

    // `CamStartPathPlayback`'s own `start == -1`: resume from the current
    // frame, with no `+ 1` — `CamAdvancePathFrame` increments after it
    // evaluates, where the rail hook increments before. No shipped script
    // takes this path (0 of the 1110 non-deferred plays name -1), but it is
    // the other half of the opcode.
    const from = op.resume && w.cam ? w.cam.frame : start;
    w.ring.supersede();
    w.cam = {
      slot,
      startFrame: from,
      endFrame: end,
      frame: from,
      flags: op.flags ?? 0,
      isStatic: !!op.static,
      deferred: false,
      file: op.cam?.file ?? null,
      pathIndex: op.cam?.path ?? null,
      done: !!op.static,
      // `CamStartPathPlayback` publishes `from` itself; the tick's own advance
      // must not step over it. See `CamCommand.started`.
      started: true,
      // A static pose is written once and its action retires on the spot, so
      // there is nothing left to publish; a playing shot still owes every
      // frame up to and including its last. See `CamCommand.retired`.
      retired: !!op.static,
    };
    w.host.startCamera(w.cam);
    if (w.cam.isStatic) {
      // `CamEvalStaticPose` writes the pose and retires; nothing is playing.
      w.ring.retire();
      return "static pose";
    }
    // `CamAdvancePathFrame` stays installed and retires on the frame the
    // path reaches its end -- `settleCameraAction` is where that lands.
    w.ring.claimCamera();
    return undefined;
  },
};

// -- the scene-state actions (selectors 0x11 and 0x21) --------------------

const SCENE: Record<string, ActionImpl> = {
  scene_state: (w, op) => {
    // Selector 0x11, `EvtActionSceneState11` -- the current major with the
    // operand as minor. Eight sites in the game, operands 1 and 3, both
    // inside row 1's live set. It retires like any other handler.
    w.enterSceneState(w.sceneState.major, op.args?.[0] ?? 0);
    w.ring.retire();
    return `scene state ${w.sceneState.major}/${w.sceneState.minor}`;
  },

  finish_sequence: (w, op) => {
    // `EvtActionFinishSequence21` is the one handler that does NOT retire
    // itself -- it installs a camera driver and pins the ring's dequeue mode
    // at "still running". `goto_scene_state` is what takes it back.
    w.enterSceneState(2, op.args?.[0] ?? 0);
    // Selector 0x21 is EvtEnterSceneState(2, minor) -- it picks a *camera
    // routine*, it does not hand control back from a path. Row 2's live
    // cells are 4, 6 and 7, and those are the only operands that occur.
    const minor = op.args?.[0];
    if (minor === 6 || minor === 7) {
      const st = w.stashedCam;
      if (!st) return "state 6/7 with nothing stashed";
      // The stashed play takes the camera over; whatever was on it is done.
      w.ring.supersede();
      w.cam = {
        slot: st.slot,
        startFrame: st.start,
        endFrame: st.end,
        frame: st.start,
        flags: 0,
        // State 7 uses `<` rather than `<=` on the end frame; one frame.
        isStatic: st.start === st.end,
        deferred: true,
        file: op.cam?.file ?? null,
        pathIndex: op.cam?.path ?? null,
        done: st.start === st.end,
        // **Not `started`, and that is the difference between the engine's
        // two ways of playing a path.**
        //
        // `CamStartPathPlayback` drives the non-deferred play through
        // `CamAdvancePathFrame` (`FUN_004035E0`), which publishes the cursor
        // and *then* increments — so the frame a shot starts on is drawn, and
        // the port's own advance must not step over it. Both routines that
        // play a **stashed** range do the opposite:
        //
        // ```
        // CameraStepRailTick (FUN_0040C790), state (2,6)'s steady body:
        //   if (g_stashed_path_end_frame <= g_stashed_path_frame) goto tail;
        //   g_stashed_path_frame += 1;                    // increment, THEN
        //   DAT_009C70BC = (float)g_stashed_path_frame;   // publish
        //   ... CamEvalPath7 at that frame ...
        // tail:
        //   g_cam_path_frames_left =
        //       g_stashed_path_end_frame - g_stashed_path_frame;
        // ```
        //
        // `CameraPlayStashedPath` (`FUN_0040C8A0`), state (2,7), is the same
        // routine with `<` in place of `<=`. So a stashed `581..660` draws
        // **582..660**, not 581..659: the start frame is stepped past and the
        // end frame is reached.
        //
        // Carrying `started` over from the other branch cost the shot its
        // last frame, and the last frame is exactly what the data times
        // entrances to. Stage 2 block 16 step 6 stashes `581..660` on path
        // 75; `0xA030`'s captor cue is frame **660** and its civilian's
        // killed script waits on frame **650**, both tested with an equality
        // the port could not satisfy from 659. That captor never turned on
        // the player, the two `znebi2` were never ordered up out of the
        // water, and `wait_enemies_alive 0` held block 16 for ever.
        started: false,
        // As above: a stashed range whose start equals its end is the static
        // case and owes nothing; anything else owes its frames.
        retired: st.start === st.end,
      };
      w.stashedCam = null;
      w.host.startCamera(w.cam);
      return `plays the stashed range ${st.start}..${st.end}`;
    }
    if (minor === 4 && w.cam) {
      // CameraSnapToPathEye: hold where the path is now.
      w.cam.done = true;
      w.cam.isStatic = true;
      // Nothing more is published: `advanceCameraPath` skips a static
      // command outright, so the retirement has to be recorded here or the
      // seat would keep re-writing the block from the rail for ever.
      w.cam.retired = true;
      w.host.startCamera(w.cam);
      return "snap to path eye";
    }
    return op.camera_state ? `camera state ${op.camera_state}` : undefined;
  },
};

// -- the arcade branch preview (selector 0x60) ----------------------------

const BRANCH: Record<string, ActionImpl> = {
  store_six: (w, op) => {
    // A `store_six` with no preview in the bundle carries nothing to keep, and
    // it is the same handler in the game either way -- so it retires and says
    // nothing, which is what the old chain's fall-through did for it.
    if (!op.branch_preview) {
      w.ring.retire();
      return undefined;
    }
    // `FUN_00403DB0` reads these back indexed by `g_script_branch_var`, so
    // they are the shot the arcade shows for each route the branch can take
    // — **and the shot a run-out camera moves to**, which is the half that was
    // missing. See `Walker.camOverrideValid`.
    w.branchPreview = op.branch_preview;
    w.camOverrideValid = true;
    w.ring.retire();
    return `${op.branch_preview.length} branch preview shots`;
  },
};

/**
 * What an action with no entry above does.
 *
 * `set_player_flag` (0x10), `set_update_routine` (0x12), `set_global` (0x14),
 * `set_flag` (0x15) and `hold_camera_preset` (0x20): none is modelled here,
 * and every one of them ends on the same `pending--`, so the ring must not be
 * left owing work for them. Leaving it owing is what parks a
 * `wait_queued_events_done` for good.
 */
export const UNMODELLED: ActionImpl = (w) => {
  w.ring.retire();
  return undefined;
};

/** Every `queue_event` action this client models, by name. */
export const ACTIONS: Record<string, ActionImpl> =
  mergeTables<Record<string, ActionImpl>>("queue_event action", [
    ["cam_play", CAM_PLAY],
    ["scene", SCENE],
    ["branch", BRANCH],
  ]);

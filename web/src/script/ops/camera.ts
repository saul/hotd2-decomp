/**
 * The camera: `queue_event` (every camera action goes through its ring), the
 * roll switch, the fixed eye height and the path-advance override.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * the script panel shows.
 */
import { G } from "../../game/globals";
import type { OpImpl } from "../walker";

export const OPS: Record<number, OpImpl> = {

    // -- camera ----------------------------------------------------------
    0x30: {
      status: "done",
      // EvtOpQueueEvent30 opens with `if (skip) { pc += operands; return; }`,
      // so a raised flag drops the action entirely rather than queueing it.
      // This is what makes a skip actually skip: with nothing queued and the
      // waits passing through, the interpreter races to the end of the region.
      run: (w, op) => (w.skipRequested
        ? "dropped — skipping"
        : w.applyQueueEvent(op)),
    },
    0x35: {                                     // enable_camera_path_roll
      // `g_cam_roll_enabled` (`0x009A21B0`): `CamEvalPath7` evaluates a
      // path's roll channel only while it is set. The checkpoint clears it.
      status: "done",
      run: (_w, op) => {
        G.g_cam_roll_enabled = op.roll_enabled ? 1 : 0;
        return op.roll_enabled ? "roll channel on" : "roll channel off";
      },
    },
    0x1a: {                                     // ground plane / fixed eye Y
      status: "tracked",
      run: (w, op) => {
        w.groundY = op.ground_y ?? null;
        // The engine's own write. Class 0x41 reads it when it places a group,
        // which happens inside the spawn opcode -- so it has to be current by
        // the time that instruction runs, not by the time the frame draws.
        G.g_camera_fixed_eye_y = op.camera_fixed_eye_y ?? op.ground_y ?? 0;
        return undefined;
      },
    },
    0x36: {                                     // pin_view_to_ground_plane
      // `g_camera_use_fixed_y` (`0x009C70F4`). At 1 the scene-state hooks put
      // the **gameplay** eye at `g_camera_fixed_eye_y` instead of fifteen
      // below the pose -- `camera/rail.ts`, `camera/hooks.ts`. It never
      // reaches the drawn camera, which is the block's eye and is not
      // lowered at all: that is why applying the rule to the draw found 173
      // of 201 paths looking up at their own target.
      status: "done",
      run: (_w, op) => {
        G.g_camera_use_fixed_y = op.use_fixed_eye_y ? 1 : 0;
        return op.use_fixed_eye_y
          ? `gameplay eye Y pinned to ${G.g_camera_fixed_eye_y}`
          : "gameplay eye Y back to pose.y - 15";
      },
    },
    0x37: {                                     // force_camera_path_advance
      // `EvtOpForceCameraPathAdvance37` (`FUN_0045FA60`): the operand into
      // `g_force_rail_advance`, which the stashed rail's gate reads -- so the
      // rail keeps stepping through a shake or with nobody in play.
      status: "done",
      run: (_w, op) => {
        G.g_force_rail_advance = op.force_path_advance ? 1 : 0;
        return undefined;
      },
    },
};

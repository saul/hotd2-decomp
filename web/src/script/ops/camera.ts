/**
 * The camera: `cam_play`, the roll switch, the fixed eye height and the
 * path-advance override.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * `verify_player_ops.py` checks against docs/PLAYER_PROGRESS.md.
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
      status: "done",
      run: (w, op) => {
        w.rollEnabled = !!op.roll_enabled;
        return w.rollEnabled ? "roll channel on" : "roll channel off";
      },
    },
    0x1a: {                                     // ground plane / fixed eye Y
      status: "tracked",
      run: (w, op) => {
        w.groundY = op.ground_y ?? null;
        w.fixedEyeY = op.camera_fixed_eye_y ?? op.ground_y ?? 0;
        // The engine's own write. Class 0x41 reads it when it places a group,
        // which happens inside the spawn opcode -- so it has to be current by
        // the time that instruction runs, not by the time the frame draws.
        G.g_camera_fixed_eye_y = w.fixedEyeY;
        return undefined;
      },
    },
    0x36: {                                     // pin_view_to_ground_plane
      // Kept and shown, not applied: `campath.cameraEyeY` has
      // APPLY_EYE_Y_RULE off, because measuring the rule against the data
      // found 173 of 201 paths would end up looking *up* at their own target.
      // Until that is resolved the honest status is `tracked`.
      status: "tracked",
      run: (w, op) => {
        w.useFixedEyeY = !!op.use_fixed_eye_y;
        return w.useFixedEyeY
          ? `camera eye Y pinned to ${w.fixedEyeY}`
          : "camera eye Y back to path.y - 15";
      },
    },
    0x37: {                                     // force_camera_path_advance
      status: "tracked",
      run: (w, op) => {
        w.forcePathAdvance = !!op.force_path_advance;
        return undefined;
      },
    },
};

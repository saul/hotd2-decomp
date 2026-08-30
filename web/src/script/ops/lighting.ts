/**
 * The light channels, the directional light and the two gates over them.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * `verify_player_ops.py` checks against docs/PLAYER_PROGRESS.md.
 */
import type { OpImpl } from "../walker";
import { Walker } from "../walker";

export const OPS: Record<number, OpImpl> = {

    // -- lighting and fog -------------------------------------------------
    // 0x18 sets, 0x17 slerps; the client takes the slerp target immediately,
    // which is the one approximation in this group.
    0x18: { status: "done", run: (w, op) => Walker.setLightDir(w, op) },
    0x17: { status: "approx", run: (w, op) => Walker.setLightDir(w, op) },
    // Light block 1 is pushed only at scene init and never reaches the
    // renderer, so these are no-ops in the game as well as here. Honouring
    // them would be wrong, not merely unimplemented.
    0x19: { status: "none", run: () => undefined },
    0x14: {                                     // set_scene_lighting
      status: "done",
      run: (w, op) => {
        w.sceneLighting = !!op.enabled;
        return undefined;
      },
    },
    0x15: {                                     // enable_entity_spotlights
      // Decoded as a raw operand: 0x15's handler only writes a global, so
      // `script.py` leaves it in `raw` rather than naming a field.
      status: "done",
      run: (w, op) => {
        w.gunLights = (op.raw?.length
          ? Number.parseInt(op.raw[0], 16) : (op.value ?? 0)) !== 0;
        return w.gunLights ? "gun lights on" : "gun lights off";
      },
    },
    // Block 0 is pushed every frame, so it is the one that shows.
    0x20: { status: "done", run: (w, op) => w.applyLightChannel(op) },
    0x21: { status: "done", run: (w, op) => w.applyLightChannel(op) },
    0x23: { status: "done", run: (w, op) => w.applyLightChannel(op) },
    // Block 1 again -- same reasoning as 0x19 above.
    0x24: { status: "none", run: () => undefined },
    0x25: { status: "none", run: () => undefined },
    0x27: { status: "none", run: () => undefined },
    0x22: { status: "shown" }, 0x26: { status: "shown" },
};

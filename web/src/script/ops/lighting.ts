/**
 * The light channels, the directional light and the two gates over them.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * the script panel shows.
 */
import type { OpImpl } from "../walker";
import { Walker } from "../walker";

export const OPS: Record<number, OpImpl> = {

    // -- lighting and fog -------------------------------------------------
    // 0x18 sets, 0x17 slerps; the client takes the slerp target immediately,
    // which is the one approximation in this group.
    0x18: { status: "done", run: (w, op) => Walker.setLightDir(w, op) },
    0x17: { status: "approx", run: (w, op) => Walker.setLightDir(w, op) },
    // Light block 1 -- the characters' light. `LightsUseSecondarySet`
    // (`FUN_0041DC70`) installs it for every character's draw, so these are
    // real. They used to be no-ops on the belief that block 1 never reached
    // the renderer.
    0x19: {                                     // set_light1_direction
      status: "done",
      run: (w, op) => {
        if (op.pitch_deg !== undefined) {
          w.lightBlock1.lightDir = {
            pitchDeg: op.pitch_deg,
            yawDeg: op.yaw_deg ?? w.lightBlock1.lightDir.yawDeg,
          };
          w.lightBlock1.lightSet = true;
        }
        return undefined;
      },
    },
    0x14: {                                     // set_scene_lighting
      status: "done",
      run: (w, op) => {
        w.sceneLighting = !!op.enabled;
        return undefined;
      },
    },
    0x15: {                                     // enable_entity_spotlights
      // Decoded as a raw operand: 0x15's handler only writes a global, so
      // `hod2lib/script.ts` leaves it in `raw` rather than naming a field.
      status: "done",
      run: (w, op) => {
        w.gunLights = (op.raw?.length
          ? Number.parseInt(op.raw[0], 16) : (op.value ?? 0)) !== 0;
        return w.gunLights ? "gun lights on" : "gun lights off";
      },
    },
    0x16: {                                     // set_ambient_light_rgb
      // `EvtOpSetAmbientLightRgb16`: three evt pointers, the floats behind
      // them into `g_light_array_ambient` r, g, b -- the ambient the scene
      // light array draws with. The exporter resolves the pointers.
      status: "done",
      run: (w, op) => {
        const [r, g, b] = op.rgb ?? [];
        if (r == null || g == null || b == null) return undefined;
        w.sceneAmbient = [r, g, b];
        return `ambient ${r.toFixed(2)} ${g.toFixed(2)} ${b.toFixed(2)}`;
      },
    },
    // Block 0 is pushed every frame, so it is the one that shows.
    0x20: { status: "done", run: (w, op) => w.applyLightChannel(op) },
    0x21: { status: "done", run: (w, op) => w.applyLightChannel(op) },
    0x23: { status: "done", run: (w, op) => w.applyLightChannel(op) },
    // Block 1's channels, the same stepper as block 0's.
    0x24: { status: "done", run: (w, op) => w.applyLightChannel(op) },
    0x25: { status: "done", run: (w, op) => w.applyLightChannel(op) },
    0x27: { status: "done", run: (w, op) => w.applyLightChannel(op) },
    0x22: { status: "shown" }, 0x26: { status: "shown" },
};

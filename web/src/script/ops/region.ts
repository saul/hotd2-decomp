/**
 * Rooms and streamed asset slots — what is loaded and what is drawn.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * `verify_player_ops.py` checks against docs/PLAYER_PROGRESS.md.
 */
import type { OpImpl } from "../walker";

export const OPS: Record<number, OpImpl> = {
    // -- regions and streaming ------------------------------------------
    0x29: {                                     // region_enter
      status: "done",
      run: (w, op) => {
        w.region = op.region ?? -1;
        w.host.enterRegion(w.region);
        return undefined;
      },
    },
    0x28: {                                     // region_load
      // Decoded and reported, but the host hook is deliberately empty: the
      // bundle holds every region's geometry from the start, so there is
      // nothing to preload. A `run` that only writes a feed note is still
      // `shown`.
      status: "shown",
      run: (w, op) => {
        if (op.region !== undefined) w.host.loadRegion(op.region);
        return "preload";
      },
    },
    0x50: {                                     // asset_load_slot
      status: "done",
      run: (w, op) => {
        if (op.slot !== undefined) {
          w.loadedSlots.add(op.slot);
          w.host.loadSlot(op.slot);
        }
        return undefined;
      },
    },
    0x51: {                                     // asset_unload_slot
      status: "done",
      run: (w, op) => {
        if (op.slot !== undefined) {
          w.loadedSlots.delete(op.slot);
          w.host.unloadSlot(op.slot);
        }
        return undefined;
      },
    },
};

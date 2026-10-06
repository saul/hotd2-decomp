/**
 * Rooms and streamed asset slots — what is loaded and what is drawn.
 *
 * Registered into `Walker.OPS` by `./index.ts`; the `status` field is what
 * the script panel shows.
 */
import type { OpImpl } from "../walker";
import {
  EvtOpAssetFreePolfile53, EvtOpAssetLoadPolfile52,
} from "../../game/pol_files";

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
      // Decoded and reported, and there is deliberately nothing to call: the
      // bundle holds every region's geometry from the start, so there is
      // nothing to preload. It used to call `host.loadRegion`, which was a
      // no-op on every implementation and had been since the streaming moved
      // into `enterRegion` -- a hook every host answers with `() => {}` is not
      // a seam. A `run` that only writes a feed note is still `shown`.
      status: "shown",
      run: () => "preload",
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
    // Whole `pol/` files: the state the engine's asset jobs leave on each,
    // which is what the resident bit of every slot in it reads. The models
    // are the bundle's from the start; what moves is the state, in `G`. See
    // `game/pol_files.ts`.
    0x52: {                                     // asset_load_polfile
      status: "done",
      run: (_w, op) => {
        if (op.pol !== undefined) EvtOpAssetLoadPolfile52(op.pol);
        return undefined;
      },
    },
    0x53: {                                     // asset_free_polfile
      status: "done",
      run: (_w, op) => {
        if (op.pol !== undefined) EvtOpAssetFreePolfile53(op.pol);
        return undefined;
      },
    },
};

/**
 * Which collision the level is using — evt `0x10` and `0x11`.
 *
 * The two sets are the whole of the engine's collision selection. `0x10` names
 * the **full** set, consulted by the segment test *and* the sphere test;
 * `0x11` names the **ray-only** set, consulted by the segment test alone —
 * `[likely]` scenery that stops a bullet but not movement. Each instruction
 * replaces the set it names rather than adding to it, so a step with an empty
 * operand list clears one.
 *
 * The operands are relocated absolute pointers into the two `coli/` load
 * buffers, and the exporter has already resolved each to the `{file, offset}`
 * pair that keys the bundle's blobs — see `docs/formats/coli.md`.
 *
 * Registered into `Walker.OPS` by `./index.ts`.
 */
import { G } from "../../game/globals";
import type { OpImpl } from "../walker";

/** `"<file>:<offset>"` — the key `ColiJson.blobs` uses. */
function blobKeys(op: { meshes?: { file?: string; offset?: number }[] }):
    string[] {
  const out: string[] = [];
  for (const m of op.meshes ?? []) {
    if (m.file !== undefined && m.offset !== undefined) {
      out.push(`${m.file}:${m.offset}`);
    }
  }
  return out;
}

export const OPS: Record<number, OpImpl> = {
  0x10: {                                     // set_collision_set_full
    status: "done",
    run: (_w, op) => {
      G.g_coli_full_set = blobKeys(op);
      return G.g_coli_full_set.length
        ? `${G.g_coli_full_set.length} meshes` : "cleared";
    },
  },
  0x11: {                                     // set_collision_set_ray_only
    status: "done",
    run: (_w, op) => {
      G.g_coli_ray_set = blobKeys(op);
      return G.g_coli_ray_set.length
        ? `${G.g_coli_ray_set.length} meshes` : "cleared";
    },
  },
};

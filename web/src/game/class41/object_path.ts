/**
 * `CamEvalObjectPath6` for the prop routines that ride an object path.
 *
 * Moved here from `class41/type73.ts`, where it was written for
 * `PropUpdateType73` (`FUN_00470B70`), so that `PropUpdateType67`
 * (`FUN_00470080`) reads its three paths the same way rather than through a
 * second evaluator on the host.
 */
import { T } from "../tables";

/** What `CamEvalObjectPath6` writes: `{float x,y,z; int rx,ry,rz}` (`L2`). */
export interface ObjectPathPose6 {
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number;
}

/**
 * `CamEvalObjectPath6` (`FUN_004042D0`) on the stage's own object paths:
 * `CamEvalHermiteCurve` on each of the six channels at frame `t`, the first
 * three stored as `float` and the last three through `__ftol`, which
 * truncates. `null` when the stage's bundle has no such path.
 *
 * `[port-only]` as a *function in `game/`*: the other riders of object paths
 * ask `GameHost.objectPath`, which hands back the three angles unrounded; a
 * prop routine has no host, and `T.camPaths` holds the same curves.
 */
export function PropEvalObjectPath6(slot: number, t: number):
    ObjectPathPose6 | null {
  const path = T.camPaths?.objectPath(slot);
  if (!path) return null;
  return {
    x: Math.fround(path.channel(0, t)),
    y: Math.fround(path.channel(1, t)),
    z: Math.fround(path.channel(2, t)),
    rx: Math.trunc(path.channel(3, t)),
    ry: Math.trunc(path.channel(4, t)),
    rz: Math.trunc(path.channel(5, t)),
  };
}

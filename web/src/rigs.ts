/**
 * Object rigs — the things that ride `op_` paths.
 *
 * An object that follows an object path is rarely one model. Its draw routine
 * walks the matrix stack, pushing a transform and calling `AssetDrawSlot` per
 * part; there is **no rig data in the assets at all**, so `hod2lib.rigs`
 * transcribes the routine and the exporter instantiates it as a node
 * hierarchy. See `docs/formats/rigs.md`.
 *
 * What the client adds is the motion. The bundle exports rig roots
 * *unparented*, tagged `hod2_path_slot`, because it ships no baked camera or
 * object animation — the same decision the camera rails are built on. So the
 * root is placed here by evaluating the `op_` curve directly, which means it
 * is correct at any frame, including while scrubbing, and can honour two
 * things a baked animation would have to approximate:
 *
 * **The frame clamp.** The routines do
 * `n = min(current_frame, CAM_PATH_LENGTH[slot])` — the object stops at the
 * end of its path rather than extrapolating along the last segment, which is
 * what the raw Hermite evaluator would otherwise do.
 *
 * **The position bias.** Some routines offset the path *position* before the
 * pose rotations: `Translate(p + b); RotZ; RotY; RotX`. That is `T(p+b)·R`,
 * which a child node with translation `b` cannot express — it would give
 * `T(p)·R·T(b)`.
 *
 * **The gate.** Routines dispatch on `g_active_cam_path` to pick a route, so
 * a rig instance is only present while the camera is on one of its `cam_paths`.
 * An instance with no gate is always present.
 */

import { Euler, Object3D, Vector3 } from "three";
import type { RigsJson, RigRoute } from "./bundle";
import type { CamPaths } from "./campath";

/** BAMS -> radians. */
const BAMS_TO_RAD = (Math.PI * 2) / 65536;

interface Instance {
  root: Object3D;
  rig: string;
  route: RigRoute | null;
  /** cp_ slots that select this instance; empty means always present. */
  gate: number[];
}

/**
 * The engine's object rotation triple as a quaternion.
 *
 * `MatrixTranslate(pos); RotateZ(rz); RotateY(ry); RotateX(rx)` on a
 * column-vector stack composes to `T · Rz · Ry · Rx`, so Rx is applied to the
 * vertex first — `qZ · qY · qX`. Three.js's `Euler` order string names the
 * axes in application order, so that is "ZYX".
 */
function bamsEuler(rx: number, ry: number, rz: number, out: Euler): Euler {
  return out.set(rx * BAMS_TO_RAD, ry * BAMS_TO_RAD, rz * BAMS_TO_RAD, "ZYX");
}

export class RigLayer {
  private instances: Instance[] = [];
  private paths: CamPaths | null = null;
  private enabled = true;
  private readonly _e = new Euler();
  private readonly _v = new Vector3();

  /** Find the rig roots the exporter emitted and bind each to its route. */
  attach(root: Object3D, json: RigsJson | undefined, paths: CamPaths): void {
    this.instances = [];
    this.paths = paths;
    if (!json) return;

    const routeBySlot = new Map<number, { rig: string; route: RigRoute }>();
    for (const rig of json.rigs) {
      for (const route of rig.routes) {
        routeBySlot.set(route.slot, { rig: rig.name, route });
      }
    }

    root.traverse((o) => {
      const x = o.userData as { hod2_kind?: string; hod2_path_slot?: number;
                               hod2_rig?: string };
      if (x?.hod2_kind !== "rig") return;
      const slot = x.hod2_path_slot;
      const bound = slot === undefined ? undefined : routeBySlot.get(slot);
      this.instances.push({
        root: o,
        rig: x.hod2_rig ?? "?",
        route: bound?.route ?? null,
        gate: bound?.route.cam_paths ?? [],
      });
    });
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) for (const i of this.instances) i.root.visible = false;
  }

  get count(): number {
    return this.instances.length;
  }

  get visibleCount(): number {
    return this.instances.filter((i) => i.root.visible).length;
  }

  /**
   * Place every instance for the current camera state.
   *
   * `camSlot` is the camera path the script is playing and `camFrame` how far
   * into it — the rig rides the *same* clock, which is the whole point of the
   * `g_active_cam_path` dispatch: object and shot run in lockstep.
   */
  update(camSlot: number | null, camFrame: number): void {
    if (!this.paths) return;
    for (const inst of this.instances) {
      const on = this.enabled &&
        (inst.gate.length === 0 ||
         (camSlot !== null && inst.gate.includes(camSlot)));
      inst.root.visible = on;
      if (!on || !inst.route) continue;

      const path = this.paths.objectPaths.get(inst.route.slot);
      if (!path) continue;

      // The routines clamp: the object stops at the end of its path instead
      // of extrapolating along the final segment.
      const t = Math.max(path.start,
                         Math.min(path.start + path.duration, camFrame));

      path.position(t, this._v);
      const b = inst.route.bias;
      // Bias is added to the position *before* the rotations, so it belongs
      // here and not on a child node.
      inst.root.position.set(this._v.x + b[0], this._v.y + b[1],
                             this._v.z + b[2]);

      const rx = path.channel(3, t);
      const ry = path.channel(4, t);
      const rz = path.channel(5, t);
      inst.root.quaternion.setFromEuler(bamsEuler(rx, ry, rz, this._e));
    }
  }

  get describe(): string {
    if (!this.instances.length) return "—";
    const live = this.visibleCount;
    const names = [...new Set(this.instances.map((i) => i.rig))].join(", ");
    return `${live}/${this.instances.length} ${names}`;
  }
}

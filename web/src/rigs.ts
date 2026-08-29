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
 * what the raw Hermite evaluator would otherwise do. Note that this is the
 * EXE's per-path play length, not the curve's own extent, and that it clamps
 * only at the **top**: `op_` slot 334's curve starts at frame 40, and the
 * game evaluates it below that, letting the evaluator extrapolate back along
 * the opening segment rather than holding the object still.
 *
 * **The position bias.** Some routines offset the path *position* before the
 * pose rotations: `Translate(p + b); RotZ; RotY; RotX`. That is `T(p+b)·R`,
 * which a child node with translation `b` cannot express — it would give
 * `T(p)·R·T(b)`.
 *
 * **The gate, and what it is not.** Routines dispatch on `g_active_cam_path`
 * to pick which `op_` path drives the pose — *not* whether the actor exists.
 * `FUN_004521B0` is the clearest case: it picks a route from the camera path,
 * and once the path runs out it replaces the think pointer with
 * `FUN_004522A0`, which never re-samples a path but **still calls the draw
 * routine every frame**. So the object does not vanish at the end of its
 * path: it holds its final pose and survives every subsequent camera change,
 * until the event script frees it.
 *
 * That is why a rig is treated as **one actor** here rather than one instance
 * per route. Exactly one root is visible at a time: the route whose gate
 * matches the current camera path, or — when none does — the one that was
 * last active and had run past its length, held in its final pose.
 *
 * `FUN_004522A0`'s despawn is `g_script_flags[0] == 1`, i.e. evt
 * `set_script_flag 0`. That is this routine's rule and not a general one, so
 * it is not applied here; a rig that freezes stays until the stage is reset.
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
  /** cp_ slots that select this route; empty means always present. */
  gate: number[];
  /** True once the path has run out and the pose is held. */
  frozen: boolean;
  /** The frame this instance is posed at. */
  frame: number;
}

/** All the roots belonging to one object, across its routes. */
interface Actor {
  rig: string;
  instances: Instance[];
  /** The instance currently drawn, if any. */
  showing: Instance | null;
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
  private actors: Actor[] = [];
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
        frozen: false,
        frame: 0,
      });
    });

    // Group by rig: the routes of one routine are one object taking different
    // paths, not several objects.
    const byRig = new Map<string, Actor>();
    for (const inst of this.instances) {
      let a = byRig.get(inst.rig);
      if (!a) byRig.set(inst.rig, (a = { rig: inst.rig, instances: [],
                                        showing: null }));
      a.instances.push(inst);
    }
    this.actors = [...byRig.values()];
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
    for (const actor of this.actors) {
      // The route the camera currently selects, if any.
      const selected = actor.instances.find(
        (i) => i.gate.length === 0 ||
               (camSlot !== null && i.gate.includes(camSlot)));

      let show: Instance | null = selected ?? null;
      if (!show) {
        // No route selected. The actor does not vanish if its think routine
        // has already flipped -- that only happens once the path has run out,
        // so a held instance keeps being drawn.
        const held = actor.showing;
        show = held && held.frozen ? held : null;
      }

      for (const inst of actor.instances) {
        inst.root.visible = this.enabled && inst === show;
      }
      actor.showing = show;
      if (!this.enabled || !show || !show.route) continue;

      // A selected route re-samples; a held one keeps the frame it stopped at.
      if (show === selected) {
        const end = show.route.length ?? Number.POSITIVE_INFINITY;
        show.frozen = camFrame > end;
        show.frame = Math.min(end, camFrame);
      }
      this.place(show, show.frame);
    }
  }

  private place(inst: Instance, t: number): void {
    if (!inst.route) return;
    const path = this.paths?.objectPaths.get(inst.route.slot);
    if (!path) return;

    path.position(t, this._v);
    const b = inst.route.bias;
    // Bias is added to the position *before* the rotations, so it belongs
    // here and not on a child node.
    inst.root.position.set(this._v.x + b[0], this._v.y + b[1],
                           this._v.z + b[2]);
    inst.root.quaternion.setFromEuler(
      bamsEuler(path.channel(3, t), path.channel(4, t), path.channel(5, t),
                this._e));
  }

  get describe(): string {
    if (!this.instances.length) return "—";
    const live = this.instances.filter((i) => i.root.visible);
    const names = [...new Set(live.map((i) => i.rig))].join(", ");
    const frozen = live.filter((i) => i.frozen).length;
    return `${live.length}/${this.instances.length}` +
      (names ? ` ${names}` : "") +
      (frozen ? ` (${frozen} at path end, pose held)` : "");
  }

  /** The visible instances, for the inspector. */
  get active(): { rig: string; slot: number | null; frozen: boolean;
                  note: string }[] {
    return this.instances.filter((i) => i.root.visible).map((i) => ({
      rig: i.rig,
      slot: i.route?.slot ?? null,
      frozen: i.frozen,
      note: i.route?.note ?? "",
    }));
  }
}

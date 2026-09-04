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

import {
  Box3, BoxGeometry, EdgesGeometry, Euler, Group, LineBasicMaterial,
  LineSegments, Object3D, Quaternion, Vector3,
} from "three";
import type { RigsJson, RigRoute } from "../bundle";
import type { Context, System } from "../core/system";
import type { CamPaths } from "../game/camera/curve";
import { OP_CHANNELS } from "../game/camera/curve";
import { BAMS_TO_RAD } from "../core/bams";

/** BAMS -> radians. */

/** `hod2_path_rotation`: a part rotation the routine drives from a path. */
interface PathRotationRule {
  slot: number;
  channel: string;
  axis: "x" | "y" | "z";
  scale: number;
  offset_bams: number;
  frame_offset: number;
  frame_lo: number | null;
  frame_hi: number | null;
  frame_default: number | null;
  cam_paths: number[];
}

/** One `rig_part` node, with the rules the routine applies to it. */
interface Part {
  node: Object3D;
  /** The pose the exporter baked, which a path rotation composes onto. */
  baked: Quaternion;
  /** `"moving"`: drawn only while the object's moving flag is set. */
  hiddenUnless: string;
  pathRotation: PathRotationRule | null;
}

interface Instance {
  root: Object3D;
  rig: string;
  /** `rig_part` descendants carrying a rule the player can act on. */
  parts: Part[];
  /**
   * Every route that names this instance's path slot.
   *
   * The exporter emits one root per **slot**, but a routine may name the same
   * slot from two different shots under different rules -- the stage-1 vehicle
   * rides `op_st1` 1 on `cp_st1` 1 and parks on it on `cp_st1` 2. Keying a
   * route by slot alone silently drops one of them.
   */
  routes: RigRoute[];
  /** The route the camera currently selects, out of {@link routes}. */
  route: RigRoute | null;
  /** cp_ slots that select any of this instance's routes; empty means always. */
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

const NO_RIGS: ReadonlySet<string> = new Set();

export class RigLayer implements System {
  readonly id = "render.rigs";
  /**
   * The outlines, and nothing else.
   *
   * The rig roots themselves are nodes of the stage's own glTF and are already
   * in the scene — this layer poses them, it does not own them. What it does
   * own is the boxes drawn round the ones the sidebar has ticked, so those go
   * in a group of this layer's own that `app/` adds to the scene.
   */
  readonly group = new Group();
  private instances: Instance[] = [];
  private actors: Actor[] = [];
  private paths: CamPaths | null = null;
  private enabled = true;
  /**
   * Which rigs to outline, by name, written by `app/`.
   *
   * The same shape and the same reasoning as `DebugBoxLayer.highlight`: the
   * composition root is the only layer that sees both the sidebar's selection
   * and this one, so it hands the answer over rather than this reaching for
   * it. Independent of the Rigs toggle — ticking a row boxes it whether or not
   * the rigs themselves are being drawn, because "where is this thing" is a
   * question worth asking about a rig that is not showing.
   */
  highlight: ReadonlySet<string> = NO_RIGS;
  private readonly boxes: LineSegments[] = [];
  private readonly unit = new EdgesGeometry(new BoxGeometry(1, 1, 1));
  private readonly boxMat =
    new LineBasicMaterial({ color: 0x6ad0ff, depthTest: false });
  private readonly _box = new Box3();
  private readonly _size = new Vector3();
  private readonly _mid = new Vector3();
  private readonly _e = new Euler();
  private readonly _v = new Vector3();
  private readonly _q = new Quaternion();

  /** Find the rig roots the exporter emitted and bind each to its route. */
  build(root: Object3D, json: RigsJson | undefined, paths: CamPaths): void {
    this.instances = [];
    this.paths = paths;
    if (!json) return;

    const routesBySlot = new Map<number, { rig: string; routes: RigRoute[] }>();
    for (const rig of json.rigs) {
      for (const route of rig.routes) {
        let e = routesBySlot.get(route.slot);
        if (!e) routesBySlot.set(route.slot, (e = { rig: rig.name, routes: [] }));
        e.routes.push(route);
      }
    }
    // **Only the rigs this block names.** `hod2_kind: "rig"` is the exporter's
    // tag for *every* transcribed hierarchy in the stage, and four layers own
    // different sets of them: the characters (`chr_`), their damaged-part
    // templates (`gore_`), the props (`prop_`), the breakable slot templates,
    // and these. Adopting all of them made this layer set `visible` on nodes
    // it does not own, once a frame, from a rule that has nothing to do with
    // them — and because a rig with no route is ungated, the *first* instance
    // of every character type was shown at its authored spawn point, in the
    // bind pose the exporter baked, before the script had spawned anything.
    // The character layer hides them at stage load and only writes visibility
    // for actors that exist, so nothing put them back. That is bug B3.
    //
    // `rigs.rigs[].name` is the index source and the only one: in the six
    // shipped stages it names 2–3 rigs against 45–335 tagged nodes.
    const owned = new Set(json.rigs.map((r) => r.name));

    root.traverse((o) => {
      const x = o.userData as { hod2_kind?: string; hod2_path_slot?: number;
                               hod2_rig?: string };
      if (x?.hod2_kind !== "rig") return;
      if (!x.hod2_rig || !owned.has(x.hod2_rig)) return;
      const slot = x.hod2_path_slot;
      const bound = slot === undefined ? undefined : routesBySlot.get(slot);
      const routes = bound?.routes ?? [];
      // The part rules live on the `rig_part` descendants of this root.
      const parts: Part[] = [];
      o.traverse((c) => {
        const px = c.userData as {
          hod2_kind?: string; hod2_hidden_unless?: string;
          hod2_path_rotation?: PathRotationRule;
        };
        if (px?.hod2_kind !== "rig_part") return;
        if (!px.hod2_hidden_unless && !px.hod2_path_rotation) return;
        parts.push({
          node: c,
          baked: c.quaternion.clone(),
          hiddenUnless: px.hod2_hidden_unless ?? "",
          pathRotation: px.hod2_path_rotation ?? null,
        });
      });
      this.instances.push({
        root: o,
        rig: x.hod2_rig ?? "?",
        parts,
        routes,
        route: routes[0] ?? null,
        // An ungated route makes the whole instance ungated; otherwise the
        // gate is the union, and `update` picks which route applies.
        gate: routes.some((r) => r.cam_paths.length === 0)
          ? [] : routes.flatMap((r) => r.cam_paths),
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
  update(ctx: Context): void {
    if (!this.paths) return;
    const cam = ctx.walker?.cam;
    const camSlot = cam ? cam.slot : null;
    const camFrame = cam ? cam.frame : 0;
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
        // Pick which of this slot's routes the current shot selects. An
        // ungated route is the fallback, then the first route at all, so a
        // slot with a single route behaves exactly as before.
        show.route = show.routes.find(
          (r) => camSlot !== null && r.cam_paths.includes(camSlot))
          ?? show.routes.find((r) => r.cam_paths.length === 0)
          ?? show.routes[0] ?? null;
        if (!show.route) continue;
        const hold = show.route.hold_frame;
        if (hold != null) {
          // The routine passes a literal time, so the object is parked on the
          // path and the camera frame does not reach it at all. Driving it
          // with camFrame instead walks the object along -- and off the front
          // of -- a curve it was never meant to ride: for the stage-1 vehicle
          // that extrapolated op_st1 2's rot_y to eleven full turns.
          show.frozen = true;
          show.frame = hold;
        } else {
          // The routine stops on its own test where it has one, and on the
          // path length otherwise. They are not the same frame: the stage-1
          // vehicle stops at 349 while op_st1 1 runs to 350, so the held pose
          // is the path at 349 and never at 350.
          const end = Math.min(show.route.stop_frame ?? Number.POSITIVE_INFINITY,
                               show.route.length ?? Number.POSITIVE_INFINITY);
          show.frozen = camFrame > end;
          show.frame = Math.min(end, camFrame);
        }
      }
      this.place(show, show.frame);
      this.applyPartRules(show, camSlot, camFrame);
    }
    this.outline();
  }

  /**
   * A box round each highlighted instance, from its world bounds.
   *
   * `setFromObject` walks the subtree, which is the only way to get this
   * right: a rig is a hierarchy of parts assembled from a transcribed draw
   * routine, and its root node carries no geometry of its own to measure.
   * Pooled, because the set changes when somebody clicks and not otherwise.
   */
  private outline(): void {
    let used = 0;
    if (this.highlight.size) {
      for (const inst of this.instances) {
        if (!inst.root.visible || !this.highlight.has(inst.rig)) continue;
        this._box.setFromObject(inst.root);
        if (this._box.isEmpty()) continue;
        this._box.getSize(this._size);
        this._box.getCenter(this._mid);
        let box = this.boxes[used];
        if (!box) {
          box = new LineSegments(this.unit, this.boxMat);
          // Drawn over the scene rather than into it: an outline that is
          // occluded by the thing it is outlining answers no question.
          box.renderOrder = 999;
          this.boxes.push(box);
          this.group.add(box);
        }
        box.position.copy(this._mid);
        box.scale.set(Math.max(this._size.x, 0.01),
                      Math.max(this._size.y, 0.01),
                      Math.max(this._size.z, 0.01));
        box.visible = true;
        used++;
      }
    }
    for (let i = used; i < this.boxes.length; i++) this.boxes[i].visible = false;
  }

  /**
   * Rebuild after a load.
   *
   * `showing` and `frozen` are the two pieces of state here that are **not** a
   * function of the camera command: they are how the object got to where it
   * is. A held instance keeps being drawn precisely because its path ran out
   * while the player was watching — and after a seek it did not, so carrying
   * them across leaves a rig posed in a way play could never produce. That is
   * the divergence this layer being outside `World` used to guarantee.
   */
  resync(ctx: Context): void {
    for (const inst of this.instances) {
      inst.frozen = false;
      inst.frame = 0;
      inst.route = inst.routes[0] ?? null;
    }
    for (const actor of this.actors) actor.showing = null;
    this.update(ctx);
  }

  /**
   * The per-part rules the routine applies at draw time.
   *
   * Two of them, both from `St1VehicleUpdate`. The dust trails sit inside
   * `if (obj+0x1320 != 0)`, so a parked or finished object does not draw them.
   * The occupants' yaw is `obj+0x1334`, which the routine fills from a *second*
   * path evaluation on its own clock -- not the camera frame, and not the
   * frame the body is posed at.
   */
  private applyPartRules(inst: Instance, camSlot: number | null,
                         camFrame: number): void {
    if (!inst.parts.length) return;
    const moving = !inst.frozen && inst.route?.hold_frame == null;
    for (const part of inst.parts) {
      if (part.hiddenUnless === "moving") part.node.visible = moving;

      const r = part.pathRotation;
      if (!r) continue;
      // The rule applies only on the shots the routine writes the field in;
      // elsewhere the field still holds whatever it was, which is zero.
      const on = r.cam_paths.length === 0
        || (camSlot !== null && r.cam_paths.includes(camSlot));
      if (!on) {
        part.node.quaternion.copy(part.baked);
        continue;
      }
      let t: number;
      if (r.frame_lo != null && r.frame_hi != null
          && (camFrame < r.frame_lo || camFrame > r.frame_hi)
          && r.frame_default != null) {
        t = r.frame_default;
      } else {
        t = camFrame + r.frame_offset;
      }
      const path = this.paths?.objectPaths.get(r.slot);
      if (!path) continue;
      const ch = OP_CHANNELS.indexOf(r.channel as typeof OP_CHANNELS[number]);
      if (ch < 0) continue;
      const bams = r.scale * (path.channel(ch, t) + r.offset_bams);
      this._e.set(0, 0, 0, "ZYX");
      this._e[r.axis] = bams * BAMS_TO_RAD;
      part.node.quaternion.copy(part.baked)
        .multiply(this._q.setFromEuler(this._e));
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

  /**
   * Every instance, for the rigs panel.
   *
   * All of them and not only the visible ones: which rigs this stage *has* is
   * the question the panel exists to answer, and a rig that is absent when you
   * expected it is the thing you are usually looking for.
   */
  get list(): { name: string; slot: number | null; visible: boolean;
                frozen: boolean; note: string }[] {
    return this.instances.map((i) => ({
      name: i.rig,
      slot: i.route?.slot ?? null,
      visible: i.root.visible,
      frozen: i.frozen,
      note: i.route?.note ?? "",
    }));
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

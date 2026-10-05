/**
 * Object rigs — the things that ride `op_` paths.
 *
 * An object that follows an object path is rarely one model. Its draw routine
 * walks the matrix stack, pushing a transform and calling `AssetDrawSlot` per
 * part; there is **no rig data in the assets at all**, so `hod2lib/rigs.ts`
 * transcribes the routine and the exporter instantiates it as a node
 * hierarchy. See `docs/formats/rigs.md`.
 *
 * **One rig is not this layer's to pose.** Stage 3's boat, class 0x26 subtype
 * 2, is a port actor (`game/class26/`) because its collision blob needs the
 * pose in the engine; its root is one per spawn, tagged `hod2_spawn_at`, and
 * {@link RigLayer} places it from that actor — see `ACTOR_POSED_CLASSES`. The
 * route table this layer used to run for it was a second transcription of
 * `Class26Subtype2Update`'s camera-path switch and is gone from the rig data.
 *
 * **Nor is stage 2's car.** `obj_452320` is drawn by `St2CarDraw`
 * (`FUN_00452320`) from a task the port runs in `game/class21/car.ts`, and
 * that task exists only once `RescueTargetInit` (`FUN_00451720`) has
 * allocated it -- class 0x21's one spawn, stage 2 block 0 step 2. This layer
 * drew it from stage load instead, off its own reading of the routes, and its
 * roots are exported at the origin: so the car stood in Goldman's office
 * through the whole of step 1's cutscene. Its roots are now placed from
 * `G.g_st2_cars` -- see {@link TASK_POSED_ROUTINES} -- and drawn exactly while
 * a car task is drawing; the routes in its rig data only name the roots. What
 * each root shows is the task's too: the draw names four asset slots out of
 * two rows (the car after the crash is the second), the parked part's turn,
 * the spin and the roll-limited frame the spun parts hang off, and
 * {@link RigLayer.applyTaskDraw} poses exactly those parts.
 *
 * **Nor are stage 1's two burning cars.** `obj_432840` is
 * `PathRidingPropDraw` (`FUN_00432840`), class 0x28's draw, and the object
 * is `game/class28/`'s: seated once on its route at a table's freeze frame,
 * thrown when camera path `0x2F` reaches it, killed at the route's length.
 * This layer drew the rig's first route root at `path(min(len, camera
 * frame))` of every camera from stage load, so the car came in from millions
 * of units away along the extrapolated path and was thrown again by the
 * post-fight cutscene's camera. Its spawn roots are now posed from the actor
 * -- see {@link ACTOR_POSED_ROUTINES} -- and its route roots are not drawn.
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
 * last active, held in the pose it last wrote.
 *
 * **A rig outside its table does not disappear.**
 * `Class26Subtype2Update` (`FUN_0048EAD0`)'s
 * `switch (g_active_cam_path)` has a `default:` that jumps *past* the whole
 * `CamEvalObjectPath6`/`obj+0x40` block straight to `MatrixStackPush(0)`, so
 * a camera path the routine does not name skips the pose and **still draws**
 * — which is what the bundle's own note on this rig has always said: "on a
 * camera path outside the table the pose is not refreshed and the object
 * draws at whatever pose it last held". `AssetDrawSlot` (`FUN_00418560`)
 * then draws nothing for a slot whose flag word lacks `0x8000` and `0x0001`,
 * so in the engine it is the *streaming* and not the shot that makes a rig
 * disappear. Holding it only while `frozen` was a second, invented rule, and
 * it left stage 3's boat undrawn for the whole opening — every shot before
 * `cp_st3` 124 — while the class-0x25 riders it carries were placed on their
 * own object paths regardless.
 *
 * [diverges] Before the *first* shot that selects a route, the pose the
 * engine holds is the spawn descriptor's, written when the spawn opcode runs;
 * the port draws the exporter's baked root pose instead. For the rigs the six
 * stages carry the two agree on *where* — each is spawned at a zero position
 * with a zero orientation, which is the baked pose. **The timing no longer
 * diverges for class 0x26's five subtypes**: the bundle's `spawn_ats` names
 * the spawns that install each routine, and such a rig is drawn only once the
 * walker has run one of them. The other rigs — the ones no spawn links to —
 * still draw from stage load rather than from the frame their opcode ran --
 * all but the stage-2 car, which the port's own task poses, and stage 1's
 * class-0x28 cars, which its actors do (both above).
 *
 * **That paragraph described the intent and not the code**, and the gap was a
 * visible object. `update` placed the fallback instance from its path at
 * frame 0 whether or not a shot had ever selected it, so stage 3's boat
 * (`Class26Subtype2Update` — `FUN_0048EAD0`, class 0x26 subtype 2) stood
 * parked on `op_st3` 342 at frame 0, at about (−920, −19, −2191), for the
 * whole canal opening. The engine's `default:` arm writes no pose at all, and
 * that spawn's descriptor — stage 3 block 0 step 2, script address 3244 — is
 * `(0, 0, 0)` with a zero orientation, so the engine has it at the origin,
 * out of every one of those shots. `Instance.posed` is the fix: no `place`
 * until a shot has selected the route.
 *
 * `FUN_004522A0`'s despawn is `g_script_flags[0] == 1`, i.e. evt
 * `set_script_flag 0`. That is this routine's rule and not a general one, so
 * it is not applied here; a rig that freezes stays until the stage is reset.
 * (That routine is the stage-2 car's, and the car's task in `game/` now
 * applies it -- the rule is where the routine is.)
 */

import { Euler, Object3D, Quaternion, Vector3 } from "three";
import type { RigsJson, RigRoute } from "../bundle";
import type { Context, System } from "../core/system";
import type { CamPaths } from "../game/camera/curve";
import { OP_CHANNELS } from "../game/camera/curve";
import { BAMS_TO_RAD, RAD_TO_BAMS } from "../core/bams";
import { G } from "../game/globals";
import { SpawnClass } from "../game/spawn_class";

/** BAMS -> radians. */

/** The axis `MatrixRotateY` turns about, for the sprites that carry only it. */
const AXIS_Y = new Vector3(0, 1, 0);

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
  /**
   * Drawn only while the camera is on one of these paths; empty for a part
   * the routine draws whatever the path (`RigPart.drawnOnCamPaths`).
   */
  drawnOnCamPaths: number[];
  pathRotation: PathRotationRule | null;
}

interface Instance {
  root: Object3D;
  /**
   * The root transform the exporter baked, kept so `resync` can put it back.
   *
   * A seek can land before the first shot that ever selects this instance's
   * route, and at that point the object is back to its spawn pose. Without
   * these the root would keep whatever pose the run being rewound out of had
   * left on it, which is exactly the "how the object got here" state the
   * `resync` note below is about.
   */
  bakedPos: Vector3;
  bakedQuat: Quaternion;
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
  /**
   * Has a shot ever selected this instance's route?
   *
   * Until one has, the routine's `default:` arm is what runs and the object
   * draws at the pose the **spawn** left in `obj+0x40`..`obj+0x6C` — so this
   * layer must not write a pose at all. The divergence declared at the top of
   * the file says why the baked root pose is that pose.
   */
  posed: boolean;
  /**
   * `hod2_spawn_at`, for a root the port's own actor poses — see
   * {@link ACTOR_POSED_CLASSES}. Such a root has no routes and is never in
   * {@link RigLayer}'s route-driven actors.
   */
  spawnAt: number | null;
  /** ...and the class that actor must be. */
  spawnClass: number | null;
  /**
   * Every `rig_part` under a root whose routine is one of
   * {@link TASK_POSED_ROUTINES}, by the asset slot it draws. The task's draw
   * list names slots, and the part that draws a slot is the part it means --
   * which is how the engine picks one too. Empty for any other rig.
   */
  slotParts: Map<number, SlotPart>;
}

/** A `rig_part` a task's draw list can name, with the pose it was baked at. */
interface SlotPart {
  node: Object3D;
  bakedPos: Vector3;
  baked: Quaternion;
}

/**
 * The spawn classes whose rig is posed **by the port's actor** rather than by
 * this layer.
 *
 * Class 0x26 subtype 2, `Class26Subtype2Update` (`FUN_0048EAD0`), is
 * `game/class26/`: the camera-path switch, the 2.0 bias and the face-camera
 * latch run there, once, because the boat's collision blob needs the pose in
 * the engine. This layer used to run its own transcription of the same switch
 * off the rig table's routes; now the root is placed from the actor's
 * `obj+0x40`/`+0x64`..`+0x6C` and drawn exactly while that actor is in the
 * pool — which is also the routine's own lifetime.
 */
const ACTOR_POSED_CLASSES: ReadonlySet<number> = new Set([SpawnClass.Vehicle]);

/**
 * The draw routines whose object is a **port actor of one class**, by the
 * `routine` the rig data names: every root of the rig the exporter placed at
 * a spawn (`hod2_spawn_at`) is drawn from the live actor of that class at
 * that address, and every other root -- one per `op_` route slot -- is the
 * exporter's route copy, which nothing draws.
 *
 * `PathRidingPropDraw` (`FUN_00432840`) is class 0x28's, and
 * `PathRidingPropUpdate` (`0x00432610`, `game/class28/`) is what poses it:
 * seated once on its route at the table's freeze frame, launched by camera
 * path `0x2F`, killed at the route's length. This layer used to be that
 * routine, badly -- the two route roots grouped as one ungated object at
 * `path(min(len, camera frame))` of whatever camera was playing, drawn from
 * stage load in every stage whose glTF carried the rig and never killed. So
 * before the throw it slid along the path's first segment extrapolated back
 * from frame 671, and every later camera move past frame 671 threw it again.
 */
const ACTOR_POSED_ROUTINES: Readonly<Record<string, SpawnClass>> = {
  FUN_00432840: SpawnClass.PathRidingProp,
};

/**
 * `PathRidingPropDraw`'s two sprite loops: the first cel's asset slot, how
 * many cels the loop has, and which one the draw names from
 * `g_frame_counter` (`0x009A32A0`) --
 *
 * ```
 * 0043292C  MOV EAX,[0x009A32A0] ; XOR EDX,EDX ; MOV ECX,0xF ; DIV ECX
 * 0043293A  ADD EDX,0x135F ; PUSH EDX ; CALL AssetDrawSlot
 * 004329A7  MOV EDX,[0x009A32A0] ; AND EDX,7
 * 004329B0  ADD EDX,0xB67  ; PUSH EDX ; CALL AssetDrawSlot
 * ```
 *
 * -- an unsigned `DIV`, hence the `>>> 0`. Not `g_scene_tick_counter`, which
 * `PropDrawOnlyType53` (`FUN_0046EBD0`) reads for the same two loops. Every
 * cel is a `rig_part` of its own (`obj_432840` in `hod2lib/rigs_data.ts`), which is
 * how the stage-2 car's rig carries both of its rows.
 *
 * Then `+5.0` (`0x0055D2B4`) and `+8.0` (`0x004C43A0`) on the object's `y`
 * before the yaw, and `T(0, 0, 12.0)` (`PUSH 0x41400000` at `0x0043297B`)
 * after it for the second. Their scales are the parts' baked ones -- `(1.5,
 * 2.0, 1.0)` and `(7, 7, 7)`, the `MatrixScale`s at `0x0043291D` and
 * `0x00432998`.
 */
const PATH_PROP_SPRITES: ReadonlyArray<{
  slot: number; cels: number; cel: (frame: number) => number;
  lift: number; ahead: number;
}> = [
  { slot: 0x135f, cels: 15, cel: (n) => (n >>> 0) % 15, lift: 5.0, ahead: 0 },
  { slot: 0xb67, cels: 8, cel: (n) => n & 7, lift: 8.0, ahead: 12.0 },
];

/**
 * A pose the port's own task wrote, in the engine's words: `obj+0x40`..`+0x48`
 * and the BAMS triple at `+0x64`/`+0x68`/`+0x6C`, and whether this frame's
 * routine drew it at all.
 */
interface TaskPose {
  pos: { x: number; y: number; z: number };
  pitch: number;
  yaw: number;
  roll: number;
  /** A pose has been written -- the port has nothing to draw at before. */
  posed: boolean;
  /** This frame's routine called the draw. */
  drawn: boolean;
  /**
   * What that draw drew, when the port computes it: one entry per
   * `AssetDrawSlot`, and the second frame some of them hang off. Absent means
   * every part of the root is drawn as baked.
   */
  draw?: TaskDrawList;
}

/**
 * The words a task's draw hands this layer -- `St2CarDrawList` in
 * `game/class21/car.ts`, which says where each field is decided.
 */
interface TaskDrawList {
  parts: readonly {
    slot: number;
    /** Hangs off {@link TaskDrawList.limited} rather than the root. */
    limited: boolean;
    /** The push's own rotations after its translation, BAMS. */
    rotY: number;
    rotX: number;
  }[];
  /** A second frame at the root's position, as `RotY; RotX; RotZ`. */
  limited: { pitch: number; yaw: number; roll: number };
}

/**
 * The draw routines whose object is **a task the port runs**, by the
 * `routine` the rig data names, and where its records are.
 *
 * `St2CarDraw` (`FUN_00452320`) is called by `St2CarRouteUpdate`
 * (`FUN_004521B0`) and `St2CarHeldUpdate` (`FUN_004522A0`), the stage-2 car's
 * two arcade routines. The camera-path switch, the parking and the
 * `g_script_flags[0]` kill are theirs, in `game/class21/car.ts`, and so is
 * what the draw decides -- its port leaves the result on each record's
 * `draw`; this layer draws one root per car task at the pose the task wrote,
 * the parts that draw names, and none while there is no task.
 */
const TASK_POSED_ROUTINES: Readonly<Record<string, () => readonly TaskPose[]>> = {
  FUN_00452320: () => G.g_st2_cars,
};

/** All the roots belonging to one object, across its routes. */
interface Actor {
  rig: string;
  instances: Instance[];
  /** The instance currently drawn, if any. */
  showing: Instance | null;
  /**
   * The script addresses of the spawns whose class handler installs this
   * routine, or `null` when the bundle links the rig to none.
   *
   * `Class26InstallSubtypeUpdate` (`FUN_0048E290`) is the whole of how a
   * class-0x26 object gets its draw routine: it runs once, on the spawn's
   * first frame, and stores the subtype's routine at `obj+0x00`. Before that
   * spawn's opcode has run there is no object and nothing draws. See
   * {@link RigLayer.update}.
   */
  spawnAts: ReadonlySet<number> | null;
  /** The port's task records this rig is drawn from, if it is one of
   * {@link TASK_POSED_ROUTINES}; its routes are then not this layer's. */
  tasks: (() => readonly TaskPose[]) | null;
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

/** How many showing instances {@link RigLayer.describe} names a pose for. */
const DESCRIBE_POSES = 4;

/**
 * The rig roots are nodes of the stage's own glTF and are already in the
 * scene — this layer poses them, it does not own them. It used to own one
 * thing, a group of outline boxes round the rigs the sidebar's rigs panel had
 * ticked; the panel went with the move to the debug sidebar, and the boxes
 * with it.
 */
export class RigLayer implements System {
  readonly id = "render.rigs";
  private instances: Instance[] = [];
  /**
   * The route roots of an {@link ACTOR_POSED_ROUTINES} rig: exported, never
   * drawn. Held so a caller that re-shows everything cannot bring them back.
   */
  private undrawn: Object3D[] = [];
  private actors: Actor[] = [];
  private paths: CamPaths | null = null;
  private enabled = true;
  private readonly _e = new Euler();
  private readonly _v = new Vector3();
  private readonly _q = new Quaternion();
  private readonly _rel = new Quaternion();
  private readonly _own = new Quaternion();

  /** Find the rig roots the exporter emitted and bind each to its route. */
  build(root: Object3D, json: RigsJson | undefined, paths: CamPaths): void {
    this.instances = [];
    this.undrawn = [];
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
    /**
     * The rigs this layer implements, by name, and **nothing else**.
     *
     * `hod2_kind: "rig"` is the exporter's word for "assembled by the rig
     * writer", and it puts every *character* through that same writer — a
     * skeleton is a tree of named parts with a bone offset and an asset slot,
     * which is a rig. So the marker is on 154 roots in stage 3, 335 in stage
     * 2, and only nine and six of those belong to a transcribed draw routine.
     *
     * Claiming the rest was not harmless. A `chr_` root carries no
     * `hod2_path_slot`, so it bound to no route, so its gate was empty, so it
     * was **always** the route the camera selected — and because the actors
     * here are grouped by rig *name*, and a name is a character skin shared by
     * up to thirty spawns, this layer wrote `visible = true` on one arbitrary
     * root of each skin and `false` on all the others, once a frame, over
     * `CharacterLayer`, which owns those nodes. The one it revealed had no
     * game object and therefore no pose: every bone offset in this engine runs
     * along its own local X, so an unposed character is a heap of parts piled
     * on the origin, which is what "the NPCs are in the wrong orientation"
     * looks like. It also un-hid one `gore_` template per stage.
     *
     * Names, not `hod2_path_slot`: six of stage 1's `obj_432840` roots and the
     * `fixed000` roots in stages 5 and 6 have no path slot and *are* this
     * layer's, because their routine hardcodes the pose.
     *
     * **Two independent reads reached this same rule**, from opposite
     * symptoms: the boat's passengers drawn unposed (B2), and civilians and
     * enemies drawn at their authored spawn points before the script had
     * spawned anything (B3). Same cause — `CharacterLayer` hides those roots
     * at stage load and only writes visibility for actors that exist, so once
     * this layer revealed one, nothing put it back. In the six shipped stages
     * `rigs.rigs[].name` names 2–10 rigs against 45–335 tagged nodes.
     */
    const mine = new Set(json.rigs.map((r) => r.name));
    const classOf = new Map(json.rigs.map((r) => [r.name, r.spawn_class]));

    root.traverse((o) => {
      const x = o.userData as { hod2_kind?: string; hod2_path_slot?: number;
                               hod2_rig?: string; hod2_spawn_at?: number };
      if (x?.hod2_kind !== "rig") return;
      if (!x.hod2_rig || !mine.has(x.hod2_rig)) return;
      const slot = x.hod2_path_slot;
      const bound = slot === undefined ? undefined : routesBySlot.get(slot);
      const routes = bound?.routes ?? [];
      // The part rules live on the `rig_part` descendants of this root.
      const parts: Part[] = [];
      o.traverse((c) => {
        const px = c.userData as {
          hod2_kind?: string; hod2_hidden_unless?: string;
          hod2_path_rotation?: PathRotationRule;
          hod2_drawn_on_cam_paths?: number[];
        };
        if (px?.hod2_kind !== "rig_part") return;
        if (!px.hod2_hidden_unless && !px.hod2_path_rotation
            && !px.hod2_drawn_on_cam_paths?.length) return;
        parts.push({
          node: c,
          baked: c.quaternion.clone(),
          hiddenUnless: px.hod2_hidden_unless ?? "",
          drawnOnCamPaths: px.hod2_drawn_on_cam_paths ?? [],
          pathRotation: px.hod2_path_rotation ?? null,
        });
      });
      const slotParts = new Map<number, SlotPart>();
      const routine = (o.userData as { hod2_routine?: string }).hod2_routine;
      const posedBy = routine !== undefined
        ? ACTOR_POSED_ROUTINES[routine] : undefined;
      // A route root of a routine a port actor draws: not this layer's to
      // pose and nobody's to draw. Hidden, and kept hidden.
      if (posedBy !== undefined && x.hod2_spawn_at === undefined) {
        o.visible = false;
        this.undrawn.push(o);
        return;
      }
      if (routine && (TASK_POSED_ROUTINES[routine] || posedBy !== undefined)) {
        o.traverse((c) => {
          const px = c.userData as { hod2_kind?: string; hod2_slots?: string[] };
          if (px?.hod2_kind !== "rig_part" || !px.hod2_slots?.length) return;
          slotParts.set(Number.parseInt(px.hod2_slots[0], 16), {
            node: c, bakedPos: c.position.clone(),
            baked: c.quaternion.clone(),
          });
        });
      }
      this.instances.push({
        root: o,
        bakedPos: o.position.clone(),
        bakedQuat: o.quaternion.clone(),
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
        posed: false,
        spawnAt: null,
        spawnClass: null,
        slotParts,
      });
      const cls = classOf.get(x.hod2_rig) ?? null;
      if (x.hod2_spawn_at !== undefined
          && (posedBy !== undefined
              || (cls !== null && ACTOR_POSED_CLASSES.has(cls)))) {
        const inst = this.instances[this.instances.length - 1];
        inst.spawnAt = x.hod2_spawn_at;
        inst.spawnClass = posedBy ?? cls;
      }
    });

    // Group by rig: the routes of one routine are one object taking different
    // paths, not several objects.
    const byRig = new Map<string, Actor>();
    for (const inst of this.instances) {
      if (inst.spawnAt !== null) continue;
      let a = byRig.get(inst.rig);
      if (!a) {
        const rig = json.rigs.find((r) => r.name === inst.rig);
        const ats = rig?.spawn_ats;
        byRig.set(inst.rig, (a = {
          rig: inst.rig, instances: [], showing: null,
          spawnAts: ats ? new Set(ats) : null,
          tasks: (rig && TASK_POSED_ROUTINES[rig.routine]) ?? null,
        }));
      }
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
    this.placeFromActors();
    if (!this.paths) return;
    const cam = ctx.walker?.cam;
    const camSlot = cam ? cam.slot : null;
    const camFrame = cam ? cam.frame : 0;
    for (const actor of this.actors) {
      if (actor.tasks) {
        this.placeFromTasks(actor, actor.tasks());
        continue;
      }
      // **No spawn, no object.** A rig whose routine is installed by a spawn
      // exists from the frame the walker runs that spawn's opcode, and not
      // from stage load: stage 4's `obj_48f050` (`FUN_0048F050`, class 0x26
      // subtype 3) is spawned in block 12, and drawing it from the start put
      // its model at the origin -- inside the desk of block 0's opening shot.
      // Hidden, and forgotten, so a seek back past the spawn starts it over.
      if (actor.spawnAts
          && !ctx.walker?.spawns.some((sp) => actor.spawnAts!.has(sp.at))) {
        for (const inst of actor.instances) inst.root.visible = false;
        if (actor.showing) {
          for (const inst of actor.instances) {
            inst.posed = false;
            inst.frozen = false;
            inst.root.position.copy(inst.bakedPos);
            inst.root.quaternion.copy(inst.bakedQuat);
          }
          actor.showing = null;
        }
        continue;
      }
      // The route the camera currently selects, if any.
      const selected = actor.instances.find(
        (i) => i.gate.length === 0 ||
               (camSlot !== null && i.gate.includes(camSlot)));

      // No route selected: the routine's `default:` draws anyway, at the pose
      // it last wrote, so the instance that was showing keeps showing. Before
      // any shot has ever selected one, that is the first root, at the pose
      // the exporter baked -- the divergence declared at the top of this file.
      // `posed` is what keeps that true: without it the fallback root was
      // placed from its *path* at frame 0, which is a pose the object never
      // holds. Stage 3's boat sat parked at `op_st3` 342 frame 0 -- in the
      // canal, a hundred units off the shot -- for the whole of the opening,
      // while the engine had it at the origin where its descriptor put it.
      const show: Instance | null =
        selected ?? actor.showing ?? actor.instances[0] ?? null;

      for (const inst of actor.instances) {
        inst.root.visible = this.enabled && inst === show;
      }
      actor.showing = show;
      if (this.enabled && show) this.applyCamPathParts(show, camSlot);
      if (!this.enabled || !show || !show.route) continue;

      // A selected route re-samples; a held one keeps the frame it stopped at.
      if (show === selected) {
        show.posed = true;
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
      // Only once a shot has written a pose. Until then the root keeps the
      // transform the exporter baked, which is the spawn descriptor's.
      if (show.posed) this.place(show, show.frame);
      this.applyPartRules(show, camSlot, camFrame);
    }
  }

  /**
   * The roots the port's actors pose: drawn while the actor is in the pool,
   * at its position under `T · Rz · Ry · Rx` of its three angles — the
   * product `Class26Subtype2Update`'s draw builds, and the one
   * {@link bamsEuler} spells. Reads engine state and writes only the nodes.
   */
  private placeFromActors(): void {
    for (const o of this.undrawn) o.visible = false;
    // **One root per actor.** The exporter places a rig once per spawn
    // *record*, and a descriptor the script spawns in three blocks is three
    // records at one address -- class 0x28's two are in blocks 5, 11 and 14
    // -- where the pool holds one object for it. Drawing every root bound to
    // it drew the object three times over itself.
    const drawn = new Set<number>();
    for (const inst of this.instances) {
      if (inst.spawnAt === null) continue;
      const a = G.g_object_list.find(
        (o) => o.at === inst.spawnAt && o.cls === inst.spawnClass
               && !o.despawned);
      const mine = !!a && !drawn.has(a.at);
      inst.root.visible = this.enabled && mine;
      if (!a || !mine) continue;
      drawn.add(a.at);
      inst.root.position.set(a.pos.x, a.pos.y, a.pos.z);
      inst.root.quaternion.setFromEuler(
        bamsEuler(a.pitch, a.yaw, a.roll, this._e));
      if (a.cls === SpawnClass.PathRidingProp) {
        this.PathRidingPropDraw(inst, a.pathProp.launched);
      }
    }
  }

  /**
   * `PathRidingPropDraw` -- `FUN_00432840`, what it draws beyond the root.
   *
   * The body is the root: `T(obj+0x40); RotZ(+0x6C); RotY(+0x68);
   * RotX(+0x64); AssetDrawSlot(obj+0x13F0)`, placed above. Then, only while
   * `obj+0x1320` is 0 (`JNZ` at `0x00432897`), two sprites that do **not**
   * carry the object's rotation: each is `T(x, y + lift, z) . RotY(yaw) .
   * [T(0, 0, 12)] . Scale`, where `yaw` is `VecToAngles` (`FUN_004016B0`) of
   * the camera block's eye less the object in `x` and `z` with a zero `y` --
   * `[g_camera_index * 0x1A4 + 0x009A60C0]` and `+ 0x009A60C8` at
   * `0x004328C0`/`0x004328CC`, so block 0's eye or, while the index is 2,
   * block 2's -- truncated to a `short` of BAMS.
   *
   * The sprites are children of the root in the scene graph, so their world
   * transform is undone through the root's rotation here. Each loop draws one
   * cel, `0x135F + g_frame_counter % 15` and `0xB67 + (g_frame_counter & 7)`
   * ({@link PATH_PROP_SPRITES}): that cel's part is shown and posed, and the
   * loop's other cels are hidden.
   *
   * **Nothing here touches a material, and that is the exe.** The routine
   * sets no render state around the sprites -- its only calls are the matrix
   * ones, `VecToAngles`, `NoOpStub` and the plain `AssetDrawSlot` -- so each
   * cel composites by its own mesh's words, which `prepareDrawCommands`
   * (`draw_order.ts`) put on its material when the stage loaded: ISP
   * `0x83000000` and TSP `0x94002453` / `0x9400241B`, the translucent pass,
   * SRCALPHA / INVSRCALPHA, alpha-tested at 1, **writing depth**. Nearest
   * first, the 0xB67 cel (12.0 nearer) draws before the 0x135F column and
   * cuts it away wherever its own texel alpha is at least 1, which is the
   * pale fringe round each flame. It is the PC exe's picture; do not
   * hand-tune it here (`render.test`, "class 0x28's sprite cels").
   */
  private PathRidingPropDraw(inst: Instance, launched: number): void {
    const eye = G.g_camera_index === 2 ? G.g_camera_block2_eye
                                       : G.g_camera_block_eye;
    const p = inst.root.position;
    // `VecToAngles`: `yaw = atan2(x, z)`, `__ftol`'d into a `short`.
    const yaw = (Math.trunc(Math.atan2(eye.x - p.x, eye.z - p.z)
                            * RAD_TO_BAMS) << 16) >> 16;
    const undo = this._rel.copy(inst.root.quaternion).invert();
    const turn = this._own.setFromAxisAngle(AXIS_Y, yaw * BAMS_TO_RAD);
    for (const s of PATH_PROP_SPRITES) {
      const drawn = launched === 0 ? s.slot + s.cel(G.g_frame_counter) : -1;
      for (let i = 0; i < s.cels; i++) {
        const cel = inst.slotParts.get(s.slot + i);
        if (cel) cel.node.visible = s.slot + i === drawn;
      }
      const part = inst.slotParts.get(drawn);
      if (!part) continue;
      // World: lift, then the yaw, then `ahead` along the turned +z.
      this._v.set(0, 0, s.ahead).applyQuaternion(turn);
      this._v.y += s.lift;
      part.node.position.copy(this._v.applyQuaternion(undo));
      part.node.quaternion.copy(undo).multiply(turn);
    }
  }

  /**
   * The roots of a rig the port's tasks pose: one per task that drew this
   * frame, at the pose it wrote, under `T · Rz · Ry · Rx` -- the product
   * `St2CarDraw` (`FUN_00452320`) builds with `MatrixTranslate(obj+0x40)`,
   * `MatrixRotateZ(obj+0x6C)`, `MatrixRotateY(obj+0x68)` and
   * `MatrixRotateX(obj+0x64)` at `0x0045233B`..`0x00452356`. Every other
   * root of the rig is hidden, and all of them are while there is no task:
   * **no task, no car**. Reads engine state and writes only the nodes.
   */
  private placeFromTasks(actor: Actor, tasks: readonly TaskPose[]): void {
    const live = this.enabled ? tasks.filter((t) => t.drawn && t.posed) : [];
    actor.instances.forEach((inst, i) => {
      const t = live[i];
      inst.root.visible = !!t;
      inst.frozen = false;
      inst.posed = !!t;
      if (!t) return;
      inst.root.position.set(t.pos.x, t.pos.y, t.pos.z);
      inst.root.quaternion.setFromEuler(
        bamsEuler(t.pitch, t.yaw, t.roll, this._e));
      if (t.draw) this.applyTaskDraw(inst, t.draw);
    });
    actor.showing = live.length ? actor.instances[0] : null;
  }

  /**
   * The parts a task's draw named, and only those, each posed as its push
   * was: `T(baked) · R(baked) · RotY · RotX` under the root -- or, for a part
   * on the second frame, under `root⁻¹ · RotY(yaw) · RotX(pitch) ·
   * RotZ(roll)` at the same position, which is `St2CarDraw`
   * (`FUN_00452320`)'s roll-limited push expressed as a child of the root it
   * is not. Every other part of the root is hidden: the car draws one of its
   * two asset rows, never both. Reads the task's record and writes only the
   * nodes.
   */
  private applyTaskDraw(inst: Instance, draw: TaskDrawList): void {
    for (const p of inst.slotParts.values()) p.node.visible = false;
    // `RotY; RotX; RotZ` is Euler order "YXZ" in three's naming.
    this._e.set(draw.limited.pitch * BAMS_TO_RAD, draw.limited.yaw * BAMS_TO_RAD,
                draw.limited.roll * BAMS_TO_RAD, "YXZ");
    const rel = this._rel.copy(inst.root.quaternion).invert()
      .multiply(this._q.setFromEuler(this._e));
    for (const d of draw.parts) {
      const p = inst.slotParts.get(d.slot);
      if (!p) continue;
      p.node.visible = true;
      this._e.set(d.rotX * BAMS_TO_RAD, d.rotY * BAMS_TO_RAD, 0, "YXZ");
      const own = this._q.copy(p.baked).multiply(this._own.setFromEuler(this._e));
      if (d.limited) {
        p.node.position.copy(p.bakedPos).applyQuaternion(rel);
        p.node.quaternion.copy(rel).multiply(own);
      } else {
        p.node.position.copy(p.bakedPos);
        p.node.quaternion.copy(own);
      }
    }
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
      // `posed` is the third piece of that state, and the root transform is
      // the visible half of it: back to the spawn pose, which is the baked
      // one, until a shot writes over it again.
      inst.posed = false;
      inst.root.position.copy(inst.bakedPos);
      inst.root.quaternion.copy(inst.bakedQuat);
    }
    for (const actor of this.actors) actor.showing = null;
    this.update(ctx);
  }

  /**
   * The parts a routine draws behind a camera-path test, on every instance
   * that shows -- a fixed-pose root as much as a routed one. Stage 6's lift
   * car (`FUN_0048F560`) draws its two pairs of doors only on the paths that
   * have them shut (`RigPart.drawnOnCamPaths`); on the others the class-0x44
   * selector-12 leaves are the doors.
   */
  private applyCamPathParts(inst: Instance, camSlot: number | null): void {
    for (const part of inst.parts) {
      if (!part.drawnOnCamPaths.length) continue;
      part.node.visible = camSlot !== null
        && part.drawnOnCamPaths.includes(camSlot);
    }
  }

  /**
   * The per-part rules the routine applies at draw time.
   *
   * Two of them, both from `St1VehicleUpdate`. The dust trails sit inside
   * `if (obj+0x1320 != 0)`, so a parked or finished object does not draw them.
   * The doors' yaw is `obj+0x1334`, which the routine fills from a *second*
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

  /**
   * The one-line readout, and it names **where** the showing instances are.
   *
   * A count and a list of names cannot answer the question this layer keeps
   * getting wrong, which is not "is it drawn" but "is it drawn *there*":
   * stage 3's boat was visible, on its own route, at a pose the object never
   * holds. `posed` is in the line for the same reason — an instance the
   * script has not selected yet is at its spawn pose, and that is a different
   * statement from being at path frame 0.
   *
   * Capped, because stage 2 shows a dozen at once and this is one row of a
   * sidebar.
   */
  get describe(): string {
    if (!this.instances.length) return "—";
    const live = this.instances.filter((i) => i.root.visible);
    const names = [...new Set(live.map((i) => i.rig))].join(", ");
    const frozen = live.filter((i) => i.frozen).length;
    const where = live.slice(0, DESCRIBE_POSES).map((i) => {
      const p = i.root.position;
      return `${i.rig} ${i.posed ? "at" : "unposed at"} `
           + `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
    });
    return `${live.length}/${this.instances.length}` +
      (names ? ` ${names}` : "") +
      (frozen ? ` (${frozen} at path end, pose held)` : "") +
      (where.length ? ` — ${where.join("; ")}` : "") +
      (live.length > DESCRIBE_POSES
        ? `; +${live.length - DESCRIBE_POSES} more` : "");
  }

  /**
   * Every instance, for a check to read.
   *
   * All of them and not only the visible ones: which rigs this stage *has* is
   * the question, and a rig that is absent when you expected it is the thing
   * you are usually looking for. `test:render` reads it; the sidebar's rigs
   * panel did, until it went.
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

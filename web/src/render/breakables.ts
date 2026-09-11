/**
 * The class-0x41 breakable props, drawn.
 *
 * The port owns where they are: `G.g_breakable_props` is plain data and goes
 * in the snapshot. This owns only the nodes, keyed on the prop's id, and
 * rebuilds the lot from that list whenever it is asked to — which is why
 * `update` and `resync` are the same call, exactly as for the thrown weapons.
 *
 * ## What the engine draws, and what is left here
 *
 * `BreakablePropUpdate` (`FUN_00464620`) interleaves its state machine with
 * its drawing. The state half is `game/class41/`; this is the other half:
 *
 * ```c
 * MatrixStackPush(0);
 * MatrixTranslate(shake.x + obj+0x19C, obj+0x1A0, shake.z + obj+0x1A4);
 * MatrixRotateY(obj+0x1D0);
 * MatrixRotateZ(obj+0x1D4);          // only once it is falling
 * MatrixRotateX(obj+0x1CC);
 * AssetDrawSlot(obj+0x28C);
 * MatrixStackPop(1);
 * ```
 *
 * plus a ground shadow at slot `0x10D0`, drawn flat at the floor for a prop
 * that is either at stack level 0 or already destroyed.
 *
 * The **shake** is the one thing that is a draw offset and not state: the
 * engine adds `(rand() % 0x97 - 75) * shake * 0.01` to x and z at draw time
 * and never writes it back, so the prop rattles without its hull or its hit
 * test moving. It is applied here for that reason, and it is the only place
 * this file draws its own random numbers — they do not reach the port, so the
 * save state is unaffected.
 */
import { Group, Object3D, Ray, Vector3 } from "three";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import { G } from "../game/globals";
import {
  BreakableState, PropFamily, type BreakableProp,
} from "../game/class41/prop_state";
import { KIND_SHADOW } from "../game/class41/kinded";
import {
  GENERIC_DRAW_SLOT, GENERIC_POSE_ORDER, GENERIC_SLOT_STRIP, PoseOrder,
} from "../game/class41/generic";
import { BAMS_TO_RAD } from "../core/bams";
import { Rng } from "../core/rng";

/** `AssetDrawSlot(0x10D0)` — the ground shadow a standing prop gets. */
const SHADOW_SLOT = 0x10d0;
/** A model slot of `0xFFFF` is the engine's `-1`: draw nothing. */
const SLOT_NONE = 0xffff;
/** The shadow sits this far above the floor, and is scaled to this width. */
const SHADOW_RISE = 0.2;
const SHADOW_SCALE = 10;

/** `(rand() % 0x97 - 75) * shake * 0.01` — the rattle, in world units. */
const SHAKE_SPREAD = 0x97;
const SHAKE_CENTRE = 75;
const SHAKE_SCALE = 0.01;
/**
 * `RisingDoorUpdate`'s (`FUN_004753F0`) own rattle, which is **not** the same
 * draw as `BreakablePropUpdate`'s: the two axes have different moduli, so a
 * waiting shutter judders four times as far across as it does in depth.
 *
 * `(rand() % 0x191 - 200) * amp * 0.01` in X and `(rand() % 0x65 - 50) * amp *
 * 0.01` in Z, and the same `0.01`. Reusing the square 0x97/75 draw here would
 * have been the one-shape-fits-all guess `L27` is about.
 */
const DOOR_SHAKE_X: readonly [number, number] = [0x191, 200];
const DOOR_SHAKE_Z: readonly [number, number] = [0x65, 50];
/** Where the rattle starts on every stage load. Any constant; one constant. */
const SHAKE_SEED = 0x52415454;

/** Templates come from the hidden `slots_breakable` rig the exporter emits. */
const SLOT_PART = /_slot_([0-9a-f]{4})$/;

/**
 * `LiftUpdate` (`FUN_0046A360`)'s draw, transcribed. The state half is
 * `game/class41/lift.ts`; this is the five `AssetDrawSlot` calls.
 *
 * ```c
 * MatrixStackPush(0);
 *   MatrixTranslate(obj+0x19C, obj+0x1A0, obj+0x1A4);
 *   AssetDrawSlot(0x197A);                          // the body
 *   MatrixStackPush(0);
 *     MatrixTranslate(9.619, 0.0451, -8.4127);
 *     MatrixRotateY(obj+0x1D0);      AssetDrawSlot(0x197B);
 *     MatrixTranslate(-6.5, 0, 0);
 *     MatrixRotateY((-0x4000 - obj+0x1D0) * 2);
 *                                    AssetDrawSlot(0x197B);
 *   MatrixStackPop(1);
 *   MatrixStackPush(0);
 *     MatrixTranslate(-3.988, 0.0451, -9.6331);
 *     MatrixRotateY(obj+0x1E8);      AssetDrawSlot(0x197B);
 *     MatrixTranslate(-6.5, 0, 0);
 *     MatrixRotateY(obj+0x1E8 * -2); AssetDrawSlot(0x197B);
 *   MatrixStackPop(1);
 *   MatrixTranslate(-3.2134, 13.0, -2.0);
 *   MatrixRotateX(obj+0x1CC);
 *   MatrixTranslate(0, 1.0, 0);
 *   AssetDrawSlot(0x1981);                          // the panel
 * MatrixStackPop(1);
 * ```
 *
 * Every constant is read back out of the disassembly rather than off the
 * decompiler, because the decompiler drops FPU arguments to these calls. The
 * root takes **no** rotation: `obj+0x1CC` and `+0x1D0` are hinge angles for
 * this type, not the prop's orientation.
 */
const LIFT_CAR_SLOT = 0x197a;
const LIFT_LEAF_SLOT = 0x197b;
const LIFT_PANEL_SLOT = 0x1981;
const LIFT_HINGE_NEAR: readonly [number, number, number] =
  [9.619, 0.0451, -8.4127];
const LIFT_HINGE_FAR: readonly [number, number, number] =
  [-3.988, 0.0451, -9.6331];
/** `MatrixTranslate(-6.5, 0, 0)` — leaf two hangs off the end of leaf one. */
const LIFT_LEAF_SPAN = -6.5;
const LIFT_PANEL_AT: readonly [number, number, number] = [-3.2134, 13.0, -2.0];
/** `MatrixTranslate(0, 1.0, 0)` after the panel's hinge. */
const LIFT_PANEL_RISE = 1.0;
/** The near pair's second leaf folds back from `-0x4000`, the far pair's from 0. */
const LIFT_NEAR_FOLD_BIAS = -0x4000;

/**
 * `Ry.Rz.Rx`, which is what this renderer composed for every prop in every
 * family until `GENERIC_POSE_ORDER` was read out of the EXE.
 *
 * `[open]` It stays the default for the families whose own routine has **not**
 * been read for its rotation order — the group props, the kinded props, the
 * break puff, the story-mode switch and `PropUpdateType75`. Keeping the
 * behaviour those four had is deliberate: changing it would be a guess in the
 * other direction. `RisingDoorUpdate` (`FUN_004753F0`) is the one that is
 * read, and it is one `MatrixRotateY` and nothing else, so it gets a row.
 */
const GENERIC_FAMILY_DEFAULT = PoseOrder.YawRollPitch;

/**
 * The order each non-generic family composes, where its routine has been read.
 *
 * * {@link PropFamily.Falling} — `FallingContainerUpdate` draws `Rz.Ry.Rx`,
 *   the same order `BreakablePropGroundContact`'s hull test uses, so box and
 *   model agree.
 * * {@link PropFamily.ScriptFlagEffect} — `EffectPoseNode` (`FUN_0040D9D0`)
 *   is `RotZ; RotY; RotX` after its translate, and the port has already
 *   resolved its three angles into `pitch`/`yaw`/`roll`, so the effect tree's
 *   nodes ride this rather than a fourth arm.
 * * {@link PropFamily.RisingDoor} — `RisingDoorUpdate` (`FUN_004753F0`) is
 *   `MatrixTranslate` then **one** `MatrixRotateY` and then its draw. Both
 *   shipped shutters carry a zero pitch and roll, because
 *   `PropBuildRisingDoor` (`FUN_00473410`) writes only `obj+0x1D0`, so this
 *   row changes no pixel today and is the routine written out rather than
 *   three rotations it does not make.
 * * The two draw-only types are `Rz.Ry.Rx`, from their own rows in
 *   {@link GENERIC_POSE_ORDER}.
 */
const FAMILY_POSE_ORDER: Partial<Record<PropFamily, PoseOrder>> = {
  [PropFamily.Falling]: PoseOrder.RollYawPitch,
  [PropFamily.ScriptFlagEffect]: PoseOrder.RollYawPitch,
  [PropFamily.RisingDoor]: PoseOrder.YawOnly,
  [PropFamily.DrawOnlyType53]: PoseOrder.RollYawPitch,
  [PropFamily.DrawOnlyType54]: PoseOrder.RollYawPitch,
};

/**
 * The order this prop's own routine applies pitch, yaw and roll in.
 *
 * A table of one per family and one per generic type, because that is what
 * the engine has: fifty class-0x41 routines each with their own sequence of
 * `MatrixRotate*` calls. A generic type with no row, or one whose source the
 * read could not attribute ({@link PoseOrder.Unread}), falls back to the
 * family default rather than guessing — see `tools/verify_prop_pose.py`, which
 * is what says the rows are right.
 */
function PoseOrderFor(p: BreakableProp): string {
  if (p.family === PropFamily.Generic) {
    const order = GENERIC_POSE_ORDER[p.kind];
    if (order !== undefined && order !== PoseOrder.Unread) return order;
    return GENERIC_FAMILY_DEFAULT;
  }
  // The two draw-only families have rows in `GENERIC_POSE_ORDER` as well --
  // they are class-0x41 types 53 and 54 -- but they are their own families
  // here, so they are read from the table by number rather than by `p.kind`,
  // which for them is the type and would work, but only by coincidence.
  const own = FAMILY_POSE_ORDER[p.family];
  return own ?? GENERIC_FAMILY_DEFAULT;
}

/**
 * Which model a prop draws.
 *
 * For everything but the generic family this is `obj+0x28C` and nothing else.
 * The generic family is where it gets interesting: `PlaceGenericProp` copies
 * the spawn descriptor's `+0x11C` into `+0x28C`, but only three of its types
 * ever draw that field — the rest hardcode a literal, which is
 * `GENERIC_DRAW_SLOT`. `null` means the routine draws no static model at all.
 */
function DrawSlotFor(p: BreakableProp): number | null {
  if (p.family === PropFamily.Lift) return LIFT_CAR_SLOT;
  // The two draw-only families each draw `obj+0x28C` and nothing else.
  if (p.family === PropFamily.DrawOnlyType53
      || p.family === PropFamily.DrawOnlyType54) return p.slot;
  // `-1` as a `u16`: the engine's "draw nothing", which `KindedPropUpdate`
  // writes over a prop it has hidden.
  if (p.slot === SLOT_NONE && p.family !== PropFamily.Generic) return null;
  if (p.family !== PropFamily.Generic) return p.slot;
  // `AssetDrawSlot((s16)obj+0x28C + (s32)obj+0x2A0)` — types 31 and 33 play a
  // strip, and `storyItem` is the cursor their routine steps. Everything else
  // in the family passes `obj+0x2A0` to nothing.
  if (GENERIC_SLOT_STRIP.has(p.kind)) return p.slot + p.storyItem;
  const drawn = GENERIC_DRAW_SLOT[p.kind];
  return drawn === undefined ? p.slot : drawn;
}

/**
 * Which ground shadow a prop casts, if any.
 *
 * A group prop always casts the large one. A kinded prop casts one only for
 * the kinds the engine's `switch` on `obj+0x290` lists, and kinds 4 and 5 get
 * the smaller `0x10D1`; every other kind casts none. The falling container
 * casts none — it spends most of its life off the ground.
 */
function ShadowSlotFor(p: BreakableProp): number | null {
  // A generic prop is whatever its slot says it is -- scenery, an effect, in a
  // few cases an enemy. Nothing in `PlaceGenericProp` draws a shadow, so
  // neither does this.
  if (p.family === PropFamily.Falling) return null;
  if (p.family === PropFamily.Generic) return null;
  // `RisingDoorUpdate` (`FUN_004753F0`) is one `AssetDrawSlot` and no second
  // draw of any kind, so a shutter casts nothing. Without this arm the default
  // below gave it the group props' 0x10D0 — a ten-unit disc on the floor under
  // a door, which is not in the routine.
  if (p.family === PropFamily.RisingDoor) return null;
  // `ScriptFlagEffectUpdate` (`FUN_00473B90`) draws the effect tree and
  // nothing else -- no second `AssetDrawSlot`, so no shadow.
  if (p.family === PropFamily.ScriptFlagEffect) return null;
  if (p.family !== PropFamily.Kinded) return SHADOW_SLOT;
  return KIND_SHADOW[p.kind] ?? null;
}

/** The five hinged sub-nodes the lift's draw composes. */
interface LiftParts {
  near: Object3D;
  nearFold: Object3D;
  far: Object3D;
  farFold: Object3D;
  panel: Object3D;
}

interface Live {
  /** The prop's model, re-cloned when the asset slot changes. */
  node: Object3D;
  shadow: Object3D | null;
  /** Which slot `node` was cloned from, so a swap is noticed. */
  slot: number;
  /** Only the lift has one; the pivots its update drives. */
  lift?: LiftParts;
}

export class BreakableLayer implements System<RenderContext> {
  readonly id = "render.breakables";
  readonly group = new Group();

  private readonly templates = new Map<number, Object3D>();
  private readonly nodes = new Map<number, Live>();
  private enabled = true;
  private readonly _c = new Vector3();
  private readonly _hit = new Vector3();
  /** Draw-time noise only — see `shake`. Reseeded by `adopt`. */
  private readonly rng = new Rng(SHAKE_SEED);

  constructor() {
    this.group.name = "breakables";
  }

  /**
   * Adopt the hidden templates. They are parts of a rig like any other, so
   * they arrive in the stage glTF already; all that is wanted is to find them
   * by slot and take them out of the draw.
   */
  adopt(root: Object3D): void {
    // A stage always rattles the same way -- see `shake`.
    this.rng.reseed(SHAKE_SEED);
    root.traverse((o) => {
      const x = o.userData as { hod2_kind?: string; hod2_rig?: string };
      if (x?.hod2_kind !== "rig_part") return;
      if (x.hod2_rig !== "slots_breakable") return;
      const m = SLOT_PART.exec(o.name);
      if (!m) return;
      this.templates.set(Number.parseInt(m[1], 16), o);
      o.visible = false;
    });
  }

  /**
   * Two lifetimes, and they are not the same one.
   *
   * The **templates** are adopted out of the stage's glTF, so they belong to
   * the stage. The **nodes** follow `G.g_breakable_props`, which a seek
   * replaces wholesale, so they belong to the session. Clearing both together
   * was why a seek left the pool's node map indexed on props that no longer
   * existed.
   */
  attach(ctx: RenderContext): void {
    ctx.scope.child("breakables.templates")
      .defer(() => this.templates.clear());
    this.claimSession(ctx);
  }

  private claimSession(ctx: RenderContext): void {
    ctx.session.defer(() => {
      for (const l of this.nodes.values()) {
        l.node.removeFromParent();
        l.shadow?.removeFromParent();
      }
      this.nodes.clear();
    });
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.group.visible = v;
  }

  private clone(slot: number): Object3D | null {
    const t = this.templates.get(slot);
    if (!t) return null;
    const c = t.clone(true);
    c.visible = true;
    c.position.set(0, 0, 0);
    c.quaternion.identity();
    c.scale.set(1, 1, 1);
    return c;
  }

  update(): void {
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    const seen = new Set<number>();

    for (const p of G.g_breakable_props) {
      if (p.dead) continue;
      const slot = DrawSlotFor(p);
      // A generic type whose routine draws only an effect has no model here,
      // and drawing `obj+0x28C` for it put a character where scenery was.
      if (slot === null) continue;
      seen.add(p.id);
      let l = this.nodes.get(p.id);
      // The first shot swaps the model to 0x19E6, so the slot is re-checked
      // every frame and a changed one re-clones rather than re-poses.
      if (l && l.slot !== slot) {
        l.node.removeFromParent();
        this.nodes.delete(p.id);
        l = undefined;
      }
      if (!l) {
        const node = this.clone(slot);
        if (!node) continue;
        this.group.add(node);
        const shadowSlot = ShadowSlotFor(p);
        const shadow = shadowSlot === null ? null : this.clone(shadowSlot);
        if (shadow) this.group.add(shadow);
        this.nodes.set(p.id, (l = { node, shadow, slot }));
        if (p.family === PropFamily.Lift) this.buildLift(l);
      }

      // A destroyed prop is a puff the port is counting down; nothing of the
      // prop itself is drawn once it is `Removed`, and a kinded prop whose
      // model has been hidden behind 0xFFFF draws nothing either.
      const gone = p.state === BreakableState.Removed
        || p.family === PropFamily.Effect
        || p.slot === SLOT_NONE
        || (p.family === PropFamily.Kinded && p.effectFrames > 0);
      l.node.visible = !gone;

      const [sx, sz] = this.shake(p);
      l.node.position.set(p.x + sx, p.y, p.z + sz);
      l.node.rotation.set(0, 0, 0);
      if (l.lift) {
        this.poseLift(l.lift, p);
      } else {
        // Each routine's own order, read out of the EXE. `PoseOrder`'s value
        // *is* the sequence of `MatrixRotate*` calls, left to right as the
        // engine makes them, so this loop is the routine's draw block.
        //
        // For the generic family that comes per type from
        // `GENERIC_POSE_ORDER` -- eighteen of them compose `Rz.Ry.Rx` and only
        // `PropDrawOnlyType51` composes `Ry.Rz.Rx`, which is the one this
        // renderer used for all fifty until `tools/verify_prop_pose.py` was
        // written. For every other family it is the family's single order:
        // `FallingContainerUpdate` and `ScriptFlagEffectUpdate` -- whose
        // nodes are posed by `EffectPoseNode` (`FUN_0040D9D0`) -- draw
        // `Rz.Ry.Rx`, which is also the order `BreakablePropGroundContact`'s
        // hull test uses, so box and model agree.
        for (const axis of PoseOrderFor(p)) {
          if (axis === "Z") l.node.rotateZ(p.roll * BAMS_TO_RAD);
          else if (axis === "Y") l.node.rotateY(p.yaw * BAMS_TO_RAD);
          else l.node.rotateX(p.pitch * BAMS_TO_RAD);
        }
      }

      if (l.shadow) {
        // `AssetDrawSlot(0x10D0)` at `g_camera_fixed_eye_y + 0.2`, flat, and
        // only while the prop is whole enough to cast one.
        l.shadow.visible = !gone;
        const floor = p.family === PropFamily.Falling
          ? p.floorY : G.g_camera_fixed_eye_y;
        l.shadow.position.set(p.x, floor + SHADOW_RISE, p.z);
        l.shadow.scale.set(SHADOW_SCALE, 1, SHADOW_SCALE);
      }
    }

    for (const [id, l] of this.nodes) {
      if (seen.has(id)) continue;
      l.node.removeFromParent();
      l.shadow?.removeFromParent();
      this.nodes.delete(id);
    }
  }

  /**
   * Hang the lift's four cage leaves and its overhead panel off the car.
   *
   * `MatrixStackPush(0)` duplicates the top of the stack, so the two hinges
   * are **siblings** under the body's translate rather than a chain — the
   * `MatrixStackPop(1)` between them is what says so. The panel comes after
   * both pops, so it composes on the body too.
   */
  private buildLift(l: Live): void {
    const pivot = (at: readonly [number, number, number]) => {
      const g = new Group();
      g.position.set(at[0], at[1], at[2]);
      return g;
    };
    const leaf = () => this.clone(LIFT_LEAF_SLOT);

    const near = pivot(LIFT_HINGE_NEAR);
    const nearFold = pivot([LIFT_LEAF_SPAN, 0, 0]);
    const far = pivot(LIFT_HINGE_FAR);
    const farFold = pivot([LIFT_LEAF_SPAN, 0, 0]);
    const panel = pivot(LIFT_PANEL_AT);

    for (const [pv, fold] of [[near, nearFold], [far, farFold]] as const) {
      const a = leaf();
      if (a) pv.add(a);
      const b = leaf();
      if (b) fold.add(b);
      pv.add(fold);
      l.node.add(pv);
    }
    const deck = this.clone(LIFT_PANEL_SLOT);
    if (deck) {
      // `MatrixTranslate(0, 1.0, 0)` sits between the hinge and the model.
      deck.position.set(0, LIFT_PANEL_RISE, 0);
      panel.add(deck);
    }
    l.node.add(panel);
    l.lift = { near, nearFold, far, farFold, panel };
  }

  /**
   * The three angles `LiftUpdate` drives, applied to the pivots.
   *
   * The second leaf of each pair counter-rotates at twice the rate, which is
   * what folds it back against the first instead of swinging it wide: the
   * near pair from `-0x4000`, the far pair from zero.
   */
  private poseLift(g: LiftParts, p: BreakableProp): void {
    g.near.rotation.y = p.yaw * BAMS_TO_RAD;
    g.nearFold.rotation.y =
      (LIFT_NEAR_FOLD_BIAS - p.yaw) * 2 * BAMS_TO_RAD;
    g.far.rotation.y = p.hingeB * BAMS_TO_RAD;
    g.farFold.rotation.y = p.hingeB * -2 * BAMS_TO_RAD;
    g.panel.rotation.x = p.pitch * BAMS_TO_RAD;
  }

  /**
   * The draw-time rattle. Not state: the engine recomputes it from `rand()`
   * every frame and never writes it back, which is why a shaking prop does not
   * drag its hull along with it.
   *
   * The draw is from this layer's own seeded generator rather than
   * `Math.random()`. Not `ctx.rng`, because a rattle nothing saves must not
   * advance the generator the port draws its attacks from — a snapshot loaded
   * twice would then diverge on whichever prop happened to be shaking. And not
   * the ambient one, because a driven run has to replay, and the whole reason
   * the engine's `rand()` is seeded is that the arcade run is reproducible.
   */
  private shake(p: BreakableProp): [number, number] {
    const draw = ([mod, centre]: readonly [number, number]) =>
      (this.rng.int(mod) - centre) * p.shake * SHAKE_SCALE;
    if (p.family === PropFamily.RisingDoor) {
      // No `> 0.01` floor on this one: the engine reseeds the amplitude at
      // 0.001 and multiplies unconditionally in between, so a floor an order
      // of magnitude higher would stop the judder a second early every burst.
      // X first, then Z, which is the order the two `rand()` calls are in.
      if (p.shake <= 0) return [0, 0];
      return [draw(DOOR_SHAKE_X), draw(DOOR_SHAKE_Z)];
    }
    if (p.shake <= 0.01) return [0, 0];
    const sq = [SHAKE_SPREAD, SHAKE_CENTRE] as const;
    return [draw(sq), draw(sq)];
  }

  /**
   * The nearest prop under *ray*, for the gun.
   *
   * The engine's own test is `RegisterForShotTest` plus a segment-versus-mesh
   * pass over the collision meshes, and those are not in the bundle — so this
   * measures against the drawn geometry's bounds instead, nearest first.
   * [diverges] declared in `characters.ts` alongside the character pick, which
   * makes the same trade.
   *
   * `id` rather than the prop: this feeds `GameHost.pickShot`, and what
   * crosses that seam is what the engine identifies an object by, not a
   * reference the port would then be free to write through. `t` is the
   * distance along a unit-length direction, so the caller can sort props and
   * bones into the one list the engine's shot test walks.
   */
  /**
   * `ShotTestSphere` (`FUN_00404630`) for the prop pool.
   *
   * **This used to be a bounding-box test on the drawn node**, which meant a
   * prop the port had no model for could not be shot at all — and the engine
   * has never needed a model. `RegisterForShotTest` (`FUN_00405160`) publishes
   * a point and `obj+0x124`, and the sphere is the whole hit test: a prop has
   * no skeleton, so it is always that routine's else-arm. Nine route-branch
   * triggers were unreachable because of the box, three of them because their
   * routine draws no static model at all.
   *
   * `game/class41/shot_test.ts` owns which props are registered and where
   * their spheres are; this owns the ray. The `t <= 0` test below is the
   * engine's `obj+0x78 <= 0` — its registration culls what is behind the
   * camera, and the port culls it here instead, because the port's point is in
   * world space rather than view space.
   */
  pickRay(ray: Ray): { id: number; point: Vector3; t: number } | null {
    if (!this.enabled) return null;
    let best: { id: number; point: Vector3; t: number } | null = null;
    for (const p of G.g_breakable_props) {
      if (p.dead || !p.shotRegistered || p.hitRadius <= 0) continue;
      this._c.set(p.shotX, p.shotY, p.shotZ);
      ray.closestPointToPoint(this._c, this._hit);
      const t = this._hit.clone().sub(ray.origin).dot(ray.direction);
      if (t <= 0) continue;                        // behind the muzzle
      if (ray.distanceSqToPoint(this._c) > p.hitRadius * p.hitRadius) continue;
      if (!best || t < best.t) {
        best = { id: p.id, point: this._c.clone(), t };
      }
    }
    return best;
  }

  /**
   * A load replaced the prop list wholesale. The previous session scope has
   * already dropped the nodes; this claims the new one and rebuilds.
   */
  resync(ctx: RenderContext): void {
    this.claimSession(ctx);
    this.update();
  }

  /**
   * What the pool is doing, and — when a prop is not drawn — *why*.
   *
   * "up (n drawn)" on its own was the least useful line in the panel: it said
   * ten props had no node and nothing about which ten, so the same question
   * had to be answered from the exporter every time. The three reasons are
   * separated here because they want different fixes: a type whose routine
   * draws no model is finished, a slot with no template is an exporter gap,
   * and anything left is a renderer bug.
   */
  get describe(): string {
    const live = G.g_breakable_props.filter((p) => !p.dead);
    if (!this.templates.size) return "no models";
    if (!live.length) return "none placed";
    const generic = live.filter((p) => p.family === PropFamily.Generic).length;
    // `+0x290` is the object kind for a kinded prop and the class-0x41 type
    // for a generic one, so the two have to be counted apart or the line
    // reports a kind as a type. Same offset, different meaning, again.
    const kinds = new Set<number>();
    const types = new Set<number>();
    let effects = 0;
    const noTemplate = new Set<number>();
    for (const p of live) {
      const slot = DrawSlotFor(p);
      if (slot !== null) {
        if (!this.templates.has(slot)) noTemplate.add(slot);
        continue;
      }
      effects++;
      (p.family === PropFamily.Generic ? types : kinds).add(p.kind);
    }
    const bits = [`${live.length} up (${this.nodes.size} drawn)`];
    if (generic) bits.push(`${generic} placed but not simulated`);
    if (effects) {
      // Not a gap in the export: `PlaceKindedProp` writes `obj+0x28C = -1`
      // for every kind but 2, 3, 8 and 9, and `KindedPropUpdate` then draws
      // `FUN_0040DD90(obj+0x324)` instead — the animated-effect system, which
      // this player has no renderer for at all.
      const who = [
        kinds.size ? `kind ${[...kinds].sort((a, b) => a - b).join(",")}` : "",
        types.size ? `type ${[...types].sort((a, b) => a - b).join(",")}` : "",
      ].filter(Boolean).join(" / ");
      bits.push(`${effects} are effects, not models (${who})`);
    }
    if (noTemplate.size) {
      bits.push(`no template for slot `
                + [...noTemplate].map((x) => `0x${x.toString(16)}`).join(","));
    }
    return bits.join(", ");
  }
}

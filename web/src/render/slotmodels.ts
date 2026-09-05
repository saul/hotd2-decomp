/**
 * Actors whose model is an **asset slot** rather than a skeleton.
 *
 * Most of the game's actors are skinned characters: a character type names a
 * skeleton, the skeleton's nodes name asset slots, and `render/characters.ts`
 * draws and hit-tests them bone by bone. A few are not. `MouseWanderUpdate`
 * (`FUN_0043F5C0`) and `MouseBranchTriggerUpdate` (`FUN_0043F720`) end in
 *
 * ```c
 * MatrixStackPush(0);
 * MatrixTranslate(obj+0x40, obj+0x44, obj+0x48);
 * MatrixRotateY(obj+0x68);
 * AssetDrawSlot(sub+0x20);
 * MatrixStackPop(1);
 * ```
 *
 * — one slot, no bones. The exporter emits those models as the hidden
 * `slots_actor` rig, and this layer clones one per live actor, which is the
 * same arrangement `render/breakables.ts` has for the props.
 *
 * ## The shot test is the point
 *
 * Class 0x52's route-branch trigger was ported and **unreachable** before this
 * file existed: with no geometry there was no node, and `pickShot` walked
 * character bones and prop boxes and could reach neither. The engine does not
 * need bones either — `ShotTestSphere` (`FUN_00404630`) is what every
 * registered object goes through first:
 *
 * ```c
 * if (RayTestSphere(player, obj+0x70, obj+0x74, obj+0x78, obj+0x124) > 0) {
 *     if ((obj+0x34 & 0x80) && g_character_skeletons[obj+0x1F4]->nodes > 0
 *         && !(obj+0x34 & 0x8000))
 *         ShotTestSkeleton(obj, player);      // descend into the bones
 *     else
 *         ...the whole actor is the candidate...
 * }
 * ```
 *
 * So an actor with no skeleton is hit as **one sphere, whole**, at radius
 * `obj+0x124`. {@link SlotModelLayer.pickSphere} is that else-arm, and it is
 * what makes the mouse shootable.
 *
 * [diverges] **The port does not test the bounding sphere first.**
 * `render/characters.ts` goes straight to the bone spheres for a skinned
 * actor, where the engine rejects the shot outright unless it is inside
 * `obj+0x124` as well. Changing that would alter every zombie hit in the game
 * and wants its own measurement, so it stays as it is and is recorded here
 * beside the routine that says otherwise.
 */
import { Group, Object3D, Ray, Vector3 } from "three";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import type { Actor } from "../game/actor";
import { G } from "../game/globals";
import { SpawnClass } from "../game/spawn_class";
import { BAMS_TO_RAD } from "../core/bams";

/** Templates come from the hidden `slots_actor` rig the exporter emits. */
const SLOT_PART = /_slot_([0-9a-f]{4})$/;
const SLOT_RIG = "slots_actor";

/**
 * Which asset slot an actor is drawing this frame, or `null` for one this
 * layer does not draw.
 *
 * There is no general "actor draw slot" in the engine either — each routine
 * draws what it likes out of its own sub-block — so this is a `switch` on the
 * class for the same reason `DrawSlotFor` in `render/breakables.ts` is one.
 * A class absent here is drawn by `render/characters.ts` or not at all.
 */
function DrawSlotFor(a: Actor): number | null {
  if (a.cls !== SpawnClass.Mouse) return null;
  // `sub+0x20` — the frame of the ten-slot strip `mouse.bin` holds.
  return a.mouse.frame || null;
}

/** One live actor's node. */
interface Live {
  node: Object3D;
  /** The slot the node was cloned for; a change re-clones it. */
  slot: number;
}

export class SlotModelLayer implements System<RenderContext> {
  readonly id = "render.slotmodels";
  readonly group = new Group();
  private readonly templates = new Map<number, Object3D>();
  private readonly nodes = new Map<number, Live>();
  private enabled = true;

  constructor() {
    this.group.name = "slotmodels";
  }

  /**
   * Adopt the hidden templates — parts of a rig like any other, so they are
   * in the stage glTF already and all that is wanted is to find them by slot
   * and take them out of the draw.
   */
  adopt(root: Object3D): void {
    root.traverse((o) => {
      const x = o.userData as { hod2_kind?: string; hod2_rig?: string };
      if (x?.hod2_kind !== "rig_part") return;
      if (x.hod2_rig !== SLOT_RIG) return;
      const m = SLOT_PART.exec(o.name);
      if (!m) return;
      this.templates.set(Number.parseInt(m[1], 16), o);
      o.visible = false;
    });
  }

  /**
   * Two lifetimes, as in `render/breakables.ts`: the **templates** belong to
   * the stage, the **nodes** follow `G.g_object_list`, which a seek replaces
   * wholesale.
   */
  attach(ctx: RenderContext): void {
    ctx.scope.child("slotmodels.templates")
      .defer(() => this.templates.clear());
    this.claimSession(ctx);
  }

  private claimSession(ctx: RenderContext): void {
    ctx.session.defer(() => {
      for (const l of this.nodes.values()) l.node.removeFromParent();
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

  /**
   * One node per live actor, placed and turned.
   *
   * `update` and `resync` are the same call: the layer owns nothing a snapshot
   * carries, so rebuilding from `G.g_object_list` is the whole of both.
   */
  update(): void {
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    const seen = new Set<number>();

    for (const a of G.g_object_list) {
      if (a.dead) continue;
      const slot = DrawSlotFor(a);
      if (slot === null) continue;
      seen.add(a.at);
      let live = this.nodes.get(a.at);
      // The strip advances every frame, so the node is re-cloned whenever the
      // slot changes -- which for a running mouse is every frame, and for a
      // waiting one is never.
      if (!live || live.slot !== slot) {
        live?.node.removeFromParent();
        const node = this.clone(slot);
        if (!node) continue;
        this.group.add(node);
        live = { node, slot };
        this.nodes.set(a.at, live);
      }
      live.node.position.set(a.pos.x, a.pos.y, a.pos.z);
      live.node.rotation.set(0, a.yaw * BAMS_TO_RAD, 0);
    }

    for (const [at, l] of this.nodes) {
      if (seen.has(at)) continue;
      l.node.removeFromParent();
      this.nodes.delete(at);
    }
  }

  resync(): void {
    this.update();
  }

  /**
   * `ShotTestSphere` (`FUN_00404630`)'s else-arm: one sphere, the whole actor.
   *
   * The engine measures in the shot's own frame — `RayTestSphere`
   * (`FUN_004062A0`) rotates the sphere centre by the precomputed sine and
   * cosine and compares the perpendicular distance to `obj+0x124`. The port
   * has the ray in world space instead, and the perpendicular distance from a
   * ray to a point is the same number either way.
   *
   * Returns the nearest hit along the ray, or `null`.
   */
  pickSphere(ray: Ray): { at: number; point: Vector3; t: number } | null {
    if (!this.enabled) return null;
    let best: { at: number; point: Vector3; t: number } | null = null;
    for (const a of G.g_object_list) {
      if (a.dead || a.hitRadius <= 0) continue;
      if (!this.nodes.has(a.at)) continue;       // not drawn, not shootable
      this._c.set(a.pos.x, a.pos.y, a.pos.z);
      ray.closestPointToPoint(this._c, this._p);
      const t = this._p.clone().sub(ray.origin).dot(ray.direction);
      if (t <= 0) continue;                      // behind the muzzle
      if (ray.distanceSqToPoint(this._c) > a.hitRadius * a.hitRadius) continue;
      if (!best || t < best.t) {
        best = { at: a.at, point: this._c.clone(), t };
      }
    }
    return best;
  }

  private readonly _c = new Vector3();
  private readonly _p = new Vector3();

  /** What the panel says when nothing is drawn, and why. */
  describe(): string {
    if (!this.templates.size) return "no slot models in this bundle";
    return `${this.nodes.size} drawn, ${this.templates.size} templates`;
  }
}

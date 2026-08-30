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
import { Box3, Group, Object3D, Raycaster, Vector3 } from "three";
import type { Context, System } from "../core/system";
import { G } from "../game/globals";
import { BreakableState, type BreakableProp } from "../game/class41/prop_state";

const BAMS_TO_RAD = (Math.PI * 2) / 65536;

/** `AssetDrawSlot(0x10D0)` — the ground shadow every standing prop gets. */
const SHADOW_SLOT = 0x10d0;
/** The shadow sits this far above the floor, and is scaled to this width. */
const SHADOW_RISE = 0.2;
const SHADOW_SCALE = 10;

/** `(rand() % 0x97 - 75) * shake * 0.01` — the rattle, in world units. */
const SHAKE_SPREAD = 0x97;
const SHAKE_CENTRE = 75;
const SHAKE_SCALE = 0.01;

/** Templates come from the hidden `slots_breakable` rig the exporter emits. */
const SLOT_PART = /_slot_([0-9a-f]{4})$/;

interface Live {
  /** The prop's model, re-cloned when the asset slot changes. */
  node: Object3D;
  shadow: Object3D | null;
  /** Which slot `node` was cloned from, so a swap is noticed. */
  slot: number;
}

export class BreakableLayer implements System {
  readonly id = "render.breakables";
  readonly group = new Group();

  private readonly templates = new Map<number, Object3D>();
  private readonly nodes = new Map<number, Live>();
  private enabled = true;
  private readonly _box = new Box3();
  private readonly _hit = new Vector3();

  constructor() {
    this.group.name = "breakables";
  }

  /**
   * Adopt the hidden templates. They are parts of a rig like any other, so
   * they arrive in the stage glTF already; all that is wanted is to find them
   * by slot and take them out of the draw.
   */
  adopt(root: Object3D): void {
    this.detachAll();
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

  detach(): void {
    this.detachAll();
  }

  private detachAll(): void {
    for (const l of this.nodes.values()) {
      l.node.removeFromParent();
      l.shadow?.removeFromParent();
    }
    this.nodes.clear();
    this.templates.clear();
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
      seen.add(p.id);
      let l = this.nodes.get(p.id);
      // The first shot swaps the model to 0x19E6, so the slot is re-checked
      // every frame and a changed one re-clones rather than re-poses.
      if (l && l.slot !== p.slot) {
        l.node.removeFromParent();
        this.nodes.delete(p.id);
        l = undefined;
      }
      if (!l) {
        const node = this.clone(p.slot);
        if (!node) continue;
        this.group.add(node);
        const shadow = this.clone(SHADOW_SLOT);
        if (shadow) this.group.add(shadow);
        this.nodes.set(p.id, (l = { node, shadow, slot: p.slot }));
      }

      // A destroyed prop is a puff the port is counting down; nothing of the
      // prop itself is drawn once it is `Removed`.
      const gone = p.state === BreakableState.Removed || p.isEffect;
      l.node.visible = !gone;

      const [sx, sz] = this.shake(p);
      l.node.position.set(p.x + sx, p.y, p.z + sz);
      // Ry * Rz * Rx, the engine's order — the same composition the hull test
      // in `BreakablePropGroundContact` uses, so the box and the model agree.
      l.node.rotation.set(0, 0, 0);
      l.node.rotateY(p.yaw * BAMS_TO_RAD);
      l.node.rotateZ(p.roll * BAMS_TO_RAD);
      l.node.rotateX(p.pitch * BAMS_TO_RAD);

      if (l.shadow) {
        // `AssetDrawSlot(0x10D0)` at `g_camera_fixed_eye_y + 0.2`, flat, and
        // only while the prop is whole enough to cast one.
        l.shadow.visible = !gone;
        l.shadow.position.set(p.x, G.g_camera_fixed_eye_y + SHADOW_RISE, p.z);
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
   * The draw-time rattle. Not state: the engine recomputes it from `rand()`
   * every frame and never writes it back, which is why a shaking prop does not
   * drag its hull along with it.
   */
  private shake(p: BreakableProp): [number, number] {
    if (p.shake <= 0.01) return [0, 0];
    const draw = () =>
      (Math.floor(Math.random() * SHAKE_SPREAD) - SHAKE_CENTRE)
      * p.shake * SHAKE_SCALE;
    return [draw(), draw()];
  }

  /**
   * The nearest prop under *ray*, for the gun.
   *
   * The engine's own test is `RegisterForShotTest` plus a segment-versus-mesh
   * pass over the collision meshes, and those are not in the bundle — so this
   * measures against the drawn geometry's bounds instead, nearest first.
   * [diverges] declared in `shooting.ts` alongside the character pick, which
   * makes the same trade.
   */
  pick(ray: Raycaster): { prop: BreakableProp; point: Vector3 } | null {
    if (!this.enabled) return null;
    let best: { prop: BreakableProp; point: Vector3; d: number } | null = null;
    for (const p of G.g_breakable_props) {
      if (p.dead || p.state === BreakableState.Removed || p.isEffect) continue;
      const l = this.nodes.get(p.id);
      if (!l || !l.node.visible) continue;
      this._box.setFromObject(l.node);
      if (this._box.isEmpty()) continue;
      if (!ray.ray.intersectBox(this._box, this._hit)) continue;
      const d = ray.ray.origin.distanceTo(this._hit);
      if (!best || d < best.d) {
        best = { prop: p, point: this._hit.clone(), d };
      }
    }
    return best && { prop: best.prop, point: best.point };
  }

  /** A load replaced the prop list wholesale; rebuild against the new one. */
  resync(_ctx: Context): void {
    for (const l of this.nodes.values()) {
      l.node.removeFromParent();
      l.shadow?.removeFromParent();
    }
    this.nodes.clear();
    this.update();
  }

  get describe(): string {
    const n = G.g_breakable_props.filter((p) => !p.dead).length;
    if (!this.templates.size) return "no models";
    if (!n) return "none placed";
    const whole = G.g_breakable_props.filter((p) => !p.dead && p.hp > 1).length;
    return `${n} up, ${n - whole} cracked`;
  }
}

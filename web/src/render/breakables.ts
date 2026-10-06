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
 * MatrixTranslate(0, -3.770148, 0);  // likewise
 * AssetDrawSlot(obj+0x28C);
 * MatrixStore(obj+0x2E4);
 * MatrixStackPop(1);
 * ```
 *
 * plus a ground shadow at slot `0x10D0`, drawn flat at the floor for a prop
 * that is either at stack level 0 or no longer standing. The stored matrix is
 * state -- a stacked prop's shatter places its pieces off it -- so for the
 * group family the port composes it (`drawMatrix`) and this places the model
 * with it. The pieces themselves are `render/prop_shatter.ts`'s.
 *
 * The **shake** is a draw offset and not state: the engine adds
 * `(rand() % 0x97 - 75) * shake * 0.01` to x and z at draw time and never
 * writes it back, so the prop rattles without its hull or its hit test
 * moving. For the group family those two `rand()`s are the game's own and are
 * drawn in `BreakablePropUpdate`; every other family's rattle is still drawn
 * here, from this layer's own generator, where it does not reach the port.
 */
import { Group, Matrix4, Object3D, Ray, Vector3 } from "three";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import { G } from "../game/globals";
import {
  BreakableState, PropFamily, type BreakableProp, type PropDrawCall,
} from "../game/class41/prop_state";
import { T } from "../game/tables";
import { KIND_SHADOW } from "../game/class41/kinded";
import {
  GENERIC_DRAW_SLOT, GENERIC_POSE_ORDER, PoseOrder,
} from "../game/class41/generic";
import {
  FLICKER_BROKEN, FLICKER_BROKEN_SCALE, FLICKER_DEBRIS_SCALE,
  FLICKER_FADE_FRAMES, FLICKER_SLOT_BROKEN, FLICKER_SLOT_DEBRIS,
  FLICKER_SLOT_WHOLE, FLICKER_WHOLE_RISE, FLICKER_WHOLE_SCALE,
} from "../game/class41/type48";
import { SpawnClass } from "../game/spawn_class";
import { PropContainerRoutine } from "../game/class41/placer_state";
import { BAMS_TO_RAD } from "../core/bams";
import { Rng } from "../core/rng";
import { COMPOSITE_FAMILIES, PropParts, type PropPart } from "./prop_parts";
import { BannerWave } from "./banner_wave";
import { releaseAssetDrawAlpha, setAssetDrawAlpha } from "./draw_order";
import { rewriteEnvUvs } from "./class2d_draws";

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

/**
 * A `SetDrawLayerNibble` layer as a `renderOrder`, for the layers a prop
 * routine draws in. The port spells the world's own layer 8 as 0 and layer 7
 * as `DRAW_LAYER_7_ORDER` (`render/draw_order.ts`); layer 9 is the one after
 * the world's, which `PropDrawOnlyType21` (`FUN_004694A0`) brackets its strip
 * with, and anything the effects put at 899 and up still goes over it.
 */
const DRAW_LAYER_ORDER: Partial<Record<number, number>> = {
  8: 0,
  9: 1,
};

/** Templates come from the hidden `slots_breakable` rig the exporter emits. */
const SLOT_PART = /_slot_([0-9a-f]{4})$/;

/**
 * `Ry.Rz.Rx`, which is what this renderer composed for every prop in every
 * family until `GENERIC_POSE_ORDER` was read out of the EXE.
 *
 * `[open]` It stays the default for the families whose own routine has **not**
 * been read for its rotation order — the group props, the kinded props and the
 * break puff. Keeping the behaviour those three had is deliberate: changing
 * it would be a guess in the other direction. (`PropUpdateType75` and
 * `StoryModeSwitchUpdate` were two more; their routines record their draws
 * now.)
 * `RisingDoorUpdate` (`FUN_004753F0`) is the one that is
 * read, and it is one `MatrixRotateY` and nothing else, so it gets a row.
 */
const GENERIC_FAMILY_DEFAULT = PoseOrder.YawRollPitch;

/**
 * The order each non-generic family composes, where its routine has been read
 * and does not record its own draws (a family that does is drawn from
 * {@link BreakableProp.draws} and never reaches this).
 *
 * * {@link PropFamily.RisingDoor} — `RisingDoorUpdate` (`FUN_004753F0`) is
 *   `MatrixTranslate` then **one** `MatrixRotateY` and then its draw. Both
 *   shipped shutters carry a zero pitch and roll, because
 *   `PropBuildRisingDoor` (`FUN_00473410`) writes only `obj+0x1D0`, so this
 *   row changes no pixel today and is the routine written out rather than
 *   three rotations it does not make.
 */
const FAMILY_POSE_ORDER: Partial<Record<PropFamily, PoseOrder>> = {
  [PropFamily.RisingDoor]: PoseOrder.YawOnly,
  // `FallingContainerFragmentUpdate` (`FUN_0046AD20`): `RotZ; RotY; RotX`
  // in both draw blocks, the container's own order.
  [PropFamily.ContainerFragment]: PoseOrder.RollYawPitch,
};

/**
 * The order this prop's own routine applies pitch, yaw and roll in.
 *
 * A table of one per family and one per generic type, because that is what
 * the engine has: fifty class-0x41 routines each with their own sequence of
 * `MatrixRotate*` calls. A generic type with no row, or one whose source the
 * read could not attribute ({@link PoseOrder.Unread}), falls back to the
 * family default rather than guessing — see `web/tools/checks/prop_pose.ts`, which
 * is what says the rows are right.
 */
function PoseOrderFor(p: BreakableProp): string {
  if (p.family === PropFamily.Generic) {
    const order = GENERIC_POSE_ORDER[p.kind];
    if (order !== undefined && order !== PoseOrder.Unread) return order;
    return GENERIC_FAMILY_DEFAULT;
  }
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
  // `PropUpdateType48FlickerLight`: the whole lamp, or once shot the broken
  // one -- which it draws for the rest of its life, pieces or no pieces.
  if (p.family === PropFamily.Type48) {
    return (p.flags & FLICKER_BROKEN) ? FLICKER_SLOT_BROKEN : FLICKER_SLOT_WHOLE;
  }
  // `-1` as a `u16`: the engine's "draw nothing", which `KindedPropUpdate`
  // writes over a prop it has hidden.
  if (p.slot === SLOT_NONE && p.family !== PropFamily.Generic) return null;
  if (p.family !== PropFamily.Generic) return p.slot;
  const drawn = GENERIC_DRAW_SLOT[p.kind];
  return drawn === undefined ? p.slot : drawn;
}

/**
 * Which ground shadow a prop casts, if any.
 *
 * A group prop always casts the large one. A kinded prop casts one only for
 * the kinds the engine's `switch` on `obj+0x290` lists, and kinds 4 and 5 get
 * the smaller `0x10D1`; every other kind casts none.
 */
function ShadowSlotFor(p: BreakableProp): number | null {
  // A generic prop is whatever its slot says it is -- scenery, an effect, in a
  // few cases an enemy. Nothing in `PlaceGenericProp` draws a shadow, so
  // neither does this.
  if (p.family === PropFamily.Generic) return null;
  // `RisingDoorUpdate` (`FUN_004753F0`) is one `AssetDrawSlot` and no second
  // draw of any kind, so a shutter casts nothing. Without this arm the default
  // below gave it the group props' 0x10D0 — a ten-unit disc on the floor under
  // a door, which is not in the routine.
  if (p.family === PropFamily.RisingDoor) return null;
  // `ScriptFlagEffectUpdate` (`FUN_00473B90`) draws the effect tree and
  // nothing else -- no second `AssetDrawSlot`, so no shadow.
  if (p.family === PropFamily.ScriptFlagEffect) return null;
  // `FallingContainerFragmentUpdate` draws its piece and nothing else.
  if (p.family === PropFamily.ContainerFragment) return null;
  // Nor does `PropUpdateType48FlickerLight`: a lamp, and three draws, none a
  // shadow.
  if (p.family === PropFamily.Type48) return null;
  if (p.family !== PropFamily.Kinded) return SHADOW_SLOT;
  return KIND_SHADOW[p.kind] ?? null;
}

interface Live {
  /** The prop's model, re-cloned when the asset slot changes. */
  node: Object3D;
  shadow: Object3D | null;
  /** Which slot `node` was cloned from, so a swap is noticed. */
  slot: number;
  /**
   * For the families `render/prop_parts.ts` draws: the slots of the parts
   * `node` holds, in order, so a change in what the routine draws rebuilds
   * the group rather than re-posing the wrong children.
   */
  parts?: string;
  /** Those parts' nodes, in list order. */
  partNodes?: Object3D[];
  /**
   * For a prop whose routine records its draws: the slot of each node in
   * `partNodes`, so `nodesForSlot` can find a canal tile drawn as one call of
   * several.
   */
  partSlots?: number[];
  /** `PropUpdateType48FlickerLight`'s thirty pieces, built on the break. */
  debris?: Object3D[];
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
  private readonly _m = new Matrix4();
  /** This frame's world-to-view, for {@link PropDrawCall.envUv}. */
  private readonly _view = new Matrix4();
  private viewValid = false;
  /** `PropUpdateType45`'s bend of the banner templates (`banner_wave.ts`). */
  private readonly banners = new BannerWave();

  constructor() {
    this.group.name = "breakables";
  }

  /**
   * A template by slot, for `render/prop_shatter.ts`: a stacked prop's fifteen
   * pieces are in the same hidden rig as the props themselves.
   */
  cloneSlot(slot: number): Object3D | null {
    return this.clone(slot);
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
      .defer(() => {
        this.templates.clear();
        this.banners.clear();
      });
    this.claimSession(ctx);
  }

  private claimSession(ctx: RenderContext): void {
    ctx.session.defer(() => {
      for (const l of this.nodes.values()) {
        l.node.removeFromParent();
        l.shadow?.removeFromParent();
        for (const d of l.debris ?? []) d.removeFromParent();
      }
      this.nodes.clear();
    });
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.group.visible = v;
  }

  /**
   * The live nodes drawing one slot. `render/water_surfaces.ts` asks, because
   * a prop can draw a canal tile -- `PropDrawOnlyType12` puts `0x13B5` in the
   * stage-2 boss's blocks -- and in the engine that is the same model the
   * water task ripples, not a copy of it.
   */
  nodesForSlot(slot: number): Object3D[] {
    const out: Object3D[] = [];
    for (const l of this.nodes.values()) {
      if (l.slot === slot && l.node.parent) out.push(l.node);
      l.partSlots?.forEach((s, i) => {
        const n = l.partNodes?.[i];
        if (s === slot && n?.parent && l.node.parent) out.push(n);
      });
    }
    return out;
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

  update(ctx?: RenderContext): void {
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    // The modelview an `AssetSlotUVsFromViewNormals` draw rewrites its UVs
    // through: the camera's world-to-view, as `render/effects.ts` takes it.
    this.viewValid = false;
    if (ctx?.camera) {
      this._view.copy(ctx.camera.matrixWorldInverse);
      this.viewValid = true;
    }
    const seen = new Set<number>();

    for (const p of G.g_breakable_props) {
      if (p.dead) continue;
      // A routine that records its own draws (`game/class41/prop_draw.ts`)
      // has already decided everything: which slots, under which matrices.
      if (p.draws) {
        seen.add(p.id);
        this.drawCalls(p.id, p.draws);
        continue;
      }
      const parts = COMPOSITE_FAMILIES.has(p.family) ? PropParts(p) : null;
      if (parts) {
        seen.add(p.id);
        this.drawParts(p.id, parts);
        continue;
      }
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
        for (const d of l.debris ?? []) d.removeFromParent();
        l.shadow?.removeFromParent();
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
      }

      // A destroyed prop is a puff the port is counting down; nothing of the
      // prop itself is drawn once it is `Removed`, and a kinded prop whose
      // model has been hidden behind 0xFFFF draws nothing either.
      const gone = p.state === BreakableState.Removed
        || p.family === PropFamily.Effect
        || p.slot === SLOT_NONE
        || (p.family === PropFamily.Kinded && p.effectFrames > 0);
      // A settled container piece skips its draw on odd counts at the end;
      // `FallingContainerFragmentUpdate` says so on the piece.
      l.node.visible = !gone && !p.drawSkipped;

      const [sx, sz] = this.shake(p);
      l.node.position.set(p.x + sx, p.y, p.z + sz);
      l.node.rotation.set(0, 0, 0);
      if (p.family === PropFamily.Group && p.drawMatrix.length === 16) {
        // `BreakablePropUpdate`'s draw blocks, which the port composes and
        // keeps -- `MatrixStore(obj+0x2E4)` is state, the shatter reads it --
        // so the model goes exactly where the routine drew it: rattle, and
        // the `Translate(0, -3.770148, 0)` a falling or settled prop is drawn
        // under, included.
        this._m.fromArray(p.drawMatrix);
        this._m.decompose(l.node.position, l.node.quaternion, l.node.scale);
      } else if (p.family === PropFamily.Type48) {
        this.poseFlicker(l, p);
      } else {
        // Each routine's own order, read out of the EXE. `PoseOrder`'s value
        // *is* the sequence of `MatrixRotate*` calls, left to right as the
        // engine makes them, so this loop is the routine's draw block.
        //
        // For the generic family that comes per type from
        // `GENERIC_POSE_ORDER` -- twenty-two of them compose `Rz.Ry.Rx` and
        // `PropDrawOnlyType51` is the only descriptor-slot type that composes
        // `Ry.Rz.Rx`, which is the one this renderer used for all fifty until
        // the prop-pose check was written.
        //
        // **The order only matters when yaw and roll are both non-zero.** `Rx`
        // is last in every one of these compositions, so all an order can
        // disagree about is whether `Ry` or `Rz` comes first, and with either
        // of those angles at zero the two are the same matrix. Anyone counting
        // how many props this moved should count that way: counting spawns
        // with two or more non-zero angles gives fifteen and the answer is
        // twenty, of which four move by more than a degree -- the rest carry a
        // "roll" that is really a slot-strip length. The check prints both.
        //
        // For every other family it is the family's single order:
        // `FallingContainerUpdate` -- whose nodes are posed by
        // `EffectPoseNode` (`FUN_0040D9D0`) -- draws `Rz.Ry.Rx`, which is
        // also the order `BreakablePropGroundContact`'s hull test uses, so
        // box and model agree.
        for (const axis of PoseOrderFor(p)) {
          if (axis === "Z") l.node.rotateZ(p.roll * BAMS_TO_RAD);
          else if (axis === "Y") l.node.rotateY(p.yaw * BAMS_TO_RAD);
          else l.node.rotateX(p.pitch * BAMS_TO_RAD);
        }
      }

      if (l.shadow) {
        // `AssetDrawSlot(0x10D0)` at `g_camera_fixed_eye_y + 0.2`, flat, and
        // only while the prop is whole enough to cast one. A group prop's
        // routine skips it for a member standing on another (`0x00464FF3`:
        // level non-zero and state 0), which is every stacked prop until it
        // falls.
        const stacked = p.family === PropFamily.Group
          && p.state === BreakableState.Standing
          && (T.breakables?.groups?.[p.group]?.[p.member]?.level ?? 0) !== 0;
        l.shadow.visible = !gone && !stacked;
        l.shadow.position.set(p.x, G.g_camera_fixed_eye_y + SHADOW_RISE, p.z);
        l.shadow.scale.set(SHADOW_SCALE, 1, SHADOW_SCALE);
      }
    }

    this.banners.apply(this.templates);

    // A prop that drew and then died this frame: its draw was submitted before
    // the object went (`g_prop_final_draws`).
    for (const f of G.g_prop_final_draws) {
      seen.add(f.id);
      this.drawCalls(f.id, f.draws);
    }

    for (const [id, l] of this.nodes) {
      if (seen.has(id)) continue;
      l.node.removeFromParent();
      l.shadow?.removeFromParent();
      for (const d of l.debris ?? []) d.removeFromParent();
      this.nodes.delete(id);
    }
  }

  /**
   * `PropUpdateType48FlickerLight`'s draw. Whole: `Translate(x, y + 2, z);
   * RotY(yaw); Scale(3)`. Broken: `Translate(x, y, z); RotY(yaw); Scale(2)`,
   * and for the first ninety frames each piece at its own position under
   * `RotZ; RotY; RotX; Scale(0.5)`, slot `0xCA5 + i`.
   */
  private poseFlicker(l: Live, p: BreakableProp): void {
    const broken = (p.flags & FLICKER_BROKEN) !== 0;
    l.node.rotation.set(0, p.yaw * BAMS_TO_RAD, 0);
    if (!broken) {
      l.node.position.set(p.x, p.y + FLICKER_WHOLE_RISE, p.z);
      l.node.scale.setScalar(FLICKER_WHOLE_SCALE);
      return;
    }
    l.node.position.set(p.x, p.y, p.z);
    l.node.scale.setScalar(FLICKER_BROKEN_SCALE);
    const f = p.flicker;
    if (!f) return;
    if (!l.debris) {
      l.debris = [];
      for (let i = 0; i < f.debris.length; i++) {
        const c = this.clone(FLICKER_SLOT_DEBRIS + i) ?? new Group();
        c.scale.setScalar(FLICKER_DEBRIS_SCALE);
        c.rotation.order = "ZYX";
        this.group.add(c);
        l.debris.push(c);
      }
    }
    const flying = f.brokenFrames < FLICKER_FADE_FRAMES;
    for (let i = 0; i < l.debris.length; i++) {
      const c = l.debris[i];
      const d = f.debris[i];
      c.visible = flying && !!d;
      if (!d) continue;
      c.position.set(d.x, d.y, d.z);
      // `RotZ(rz); RotY(ry); RotX(rx)` pre-multiplied: X first on the model,
      // then Y, then Z -- three.js's "ZYX" order is exactly that product.
      c.rotation.set(d.rx * BAMS_TO_RAD, d.ry * BAMS_TO_RAD,
                     d.rz * BAMS_TO_RAD);
    }
  }

  /**
   * One prop drawn as several `AssetDrawSlot`s, each at its own matrix — see
   * `render/prop_parts.ts`. The group is rebuilt when the list of slots
   * changes and re-posed every frame otherwise.
   */
  private drawParts(id: number, parts: PropPart[]): void {
    const key = parts.map((q) => `${q.slot}:${q.parent}`).join(",");
    let l = this.nodes.get(id);
    if (l && l.parts !== key) {
      l.node.removeFromParent();
      this.nodes.delete(id);
      l = undefined;
    }
    if (!l) {
      const root = new Group();
      const made: Object3D[] = [];
      for (const q of parts) {
        const n = (q.slot && this.clone(q.slot)) || new Group();
        (q.parent >= 0 ? made[q.parent] : root).add(n);
        made.push(n);
      }
      this.group.add(root);
      this.nodes.set(id, (l = { node: root, shadow: null, slot: -1,
                                parts: key, partNodes: made }));
    }
    const kids = l.partNodes ?? [];
    parts.forEach((q, i) => {
      const n = kids[i];
      if (!n) return;
      n.position.set(q.x, q.y, q.z);
      n.rotation.set(0, 0, 0);
      for (const axis of q.order) {
        if (axis === "Z") n.rotateZ(q.roll * BAMS_TO_RAD);
        else if (axis === "Y") n.rotateY(q.yaw * BAMS_TO_RAD);
        else if (axis === "X") n.rotateX(q.pitch * BAMS_TO_RAD);
      }
      n.scale.set(q.sx, q.sy, q.sz);
    });
  }

  /**
   * The `AssetDrawSlot` calls a transcribed routine recorded on its last
   * frame, each a clone of its slot under the matrix the routine made it
   * under. The group is rebuilt when the list of slots changes and has its
   * matrices set every frame otherwise.
   *
   * The matrix is **set**, not decomposed: a routine that scales and then
   * rotates would come out sheared, and a decomposition would quietly lose
   * that. A slot with no template draws nothing, which is what the describe
   * line reports.
   */
  private drawCalls(id: number, calls: readonly PropDrawCall[]): void {
    const key = "calls:" + calls.map((c) => c.slot).join(",");
    let l = this.nodes.get(id);
    if (l && l.parts !== key) {
      l.node.removeFromParent();
      l.shadow?.removeFromParent();
      for (const d of l.debris ?? []) d.removeFromParent();
      releaseAssetDrawAlpha(l.node);
      this.nodes.delete(id);
      l = undefined;
    }
    if (!l) {
      const root = new Group();
      const made: Object3D[] = [];
      for (const c of calls) {
        const n = this.clone(c.slot) ?? new Group();
        n.matrixAutoUpdate = false;
        root.add(n);
        made.push(n);
      }
      this.group.add(root);
      this.nodes.set(id, (l = { node: root, shadow: null, slot: -1,
                                parts: key, partNodes: made,
                                partSlots: calls.map((c) => c.slot) }));
    }
    const kids = l.partNodes ?? [];
    calls.forEach((c, i) => {
      const n = kids[i];
      if (!n) return;
      n.matrix.fromArray(c.m);
      n.matrixWorldNeedsUpdate = true;
      // `AssetDrawSlotWithAlpha`'s forced blend, or the plain draw.
      setAssetDrawAlpha(n, c.alpha ?? null);
      // `AssetSlotUVsFromViewNormals` on the same slot just before the draw.
      if (c.envUv && this.viewValid) rewriteEnvUvs(n, this._view);
      // The layer goes on the primitives, as `draw_order.ts` puts layer 7:
      // a group's order would become its children's `groupOrder`, which
      // three.js compares before anything else.
      const order = c.layer === undefined ? 0 : DRAW_LAYER_ORDER[c.layer] ?? 0;
      n.traverse((o) => { o.renderOrder = order; });
    });
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
    // `BreakablePropUpdate`'s two draws are the game's -- they come out of
    // its `rand()` stream -- so the port takes them and leaves them on the
    // prop; they are already in `drawMatrix`.
    if (p.family === PropFamily.Group) return [p.shakeX, p.shakeZ];
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
   * `ShotTestSphere` (`FUN_00404630`) for the prop pool: the nearest prop
   * under *ray*, for the gun.
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
   *
   * `id` rather than the prop: this feeds `GameHost.pickShot`, and what
   * crosses that seam is what the engine identifies an object by, not a
   * reference the port would then be free to write through. `t` is the
   * distance along a unit-length direction, so the caller can sort props and
   * bones into the one list the engine's shot test walks.
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
    if (!live.length) {
      // **"none placed" was one sentence for two situations**, and that is
      // what a report of "the browser sees no props where the port sees two"
      // turned out to be. A `spawn_placed` instruction puts a *placer* in the
      // object pool; `PropContainerPlacerUpdate` (`FUN_00461CD0`) is what
      // calls the constructor and then `ActorKill`s itself, and that is a
      // class handler — so it needs a frame of `GameUpdate`. A paused
      // transport hands `world.update` a `STOPPED_TICK` and never runs one,
      // so a seek that arrived correctly, with every placer of the step in
      // the pool, reads as though the script had placed nothing.
      //
      // The placers are counted rather than the props, because that is the
      // distinction: "the script has not placed any here" and "press play"
      // want different responses from whoever is reading the panel.
      // A class-0x41 actor is a placer unless it is one of constructor 61's
      // figures, which is a skinned actor that stays.
      const waiting = G.g_object_list.filter((o) =>
        !o.despawned && !o.dead
        && ((o.cls === SpawnClass.PropContainerPlacer
             && o.placer.routine === PropContainerRoutine.Placer)
            || o.cls === SpawnClass.PropPlacer)).length;
      return waiting
        ? `none built yet — ${waiting} placer${waiting === 1 ? "" : "s"}`
          + ` in the pool, waiting for a game frame`
        : "none placed";
    }
    // A routine that records its draws is transcribed; only the rest of the
    // generic family is still standing in for a routine it does not run.
    const generic = live.filter((p) => p.family === PropFamily.Generic
                                     && !p.draws).length;
    // `+0x290` is the object kind for a kinded prop and the class-0x41 type
    // for a generic one, so the two have to be counted apart or the line
    // reports a kind as a type. Same offset, different meaning, again.
    const kinds = new Set<number>();
    const types = new Set<number>();
    let effects = 0;
    const noTemplate = new Set<number>();
    for (const p of live) {
      if (p.draws) {
        for (const c of p.draws) {
          if (!this.templates.has(c.slot)) noTemplate.add(c.slot);
        }
        continue;
      }
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

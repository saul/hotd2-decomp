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
import { Group, Matrix4, Object3D, Ray, Vector3 } from "three";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import type { Actor, HumanoidActor } from "../game/actor";
import { HumanoidDrawVariant, HUMANOID_VARIANT3_SLOT }
  from "../game/class25/state";
import type { CamPaths } from "../game/camera/curve";
import { G } from "../game/globals";
import { ScriptedScenerySelector } from "../game/class33/state";
import { OwlBodyChain, type OwlPart } from "./owl";
import { SpawnClass } from "../game/spawn_class";
import { BAMS_TO_RAD } from "../core/bams";
import {
  CARRIER_GROUND_WAKE_DRAW, CARRIER_WAKE_PAIR, type ScriptedPropTail,
}
  from "../game/class13/state";

/**
 * The literals of the carrier routines' own draws, read off the disassembly
 * (`L1`) — see `game/class13/`.
 *
 * * `CarrierPropRoutine0` (`FUN_00440210`): the wake at
 *   `Translate(0, 0, 27.5); Scale(1, 0.15, 1)` under the boat's pose, and the
 *   splash at the fixed world point `(-1181.71, -18.908, -1508.41)`, turned
 *   `0x18E3` and scaled 0.6.
 * * `CarrierDrawGroundWake` (`FUN_00440770`): `Translate(0, 0, z)` along
 *   the heading, `Scale(1, s, s)`, and states 5/6's strip at the carrier's
 *   `Translate(0, 0, z)` — per routine, `CARRIER_GROUND_WAKE_DRAW`.
 */
const WAKE0_Z = 27.5;
const WAKE0_SCALE_Y = 0.15;
const SPLASH0_AT: readonly [number, number, number] =
  [-1181.71, -18.908, -1508.41];
const SPLASH0_YAW = 0x18e3;
const SPLASH0_SCALE = 0.6;

/** Scratch matrices for the carrier draws; the layer is single-threaded. */
const _m = new Matrix4();
const _t = new Matrix4();

/** `M = M · T(x, y, z)`. */
function mTranslate(m: Matrix4, x: number, y: number, z: number): void {
  m.multiply(_t.makeTranslation(x, y, z));
}
/** `M = M · R(axis, bams)`, the engine's `MatrixRotate*`. */
function mRotX(m: Matrix4, b: number): void {
  m.multiply(_t.makeRotationX(b * BAMS_TO_RAD));
}
function mRotY(m: Matrix4, b: number): void {
  m.multiply(_t.makeRotationY(b * BAMS_TO_RAD));
}
function mRotZ(m: Matrix4, b: number): void {
  m.multiply(_t.makeRotationZ(b * BAMS_TO_RAD));
}
function mScale(m: Matrix4, x: number, y: number, z: number): void {
  m.multiply(_t.makeScale(x, y, z));
}

/**
 * `DrawSlotFor`'s answer for a class whose draw is a **chain** of slots rather
 * than one: the placement arm builds a group instead. Class 0x43 is the only
 * one, and `render/owl.ts` is its chain.
 */
const CHAIN = -1;

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
  switch (a.cls) {
    case SpawnClass.Mouse:
      // `sub+0x20` — the frame of the ten-slot strip `mouse.bin` holds.
      return a.mouse.frame || null;
    case SpawnClass.FlyingEnemy:
      // **A chain, not a slot.** `OwlDrawBodyChain` (`FUN_00447C20`) draws
      // sixteen of them under one root; `render/owl.ts` composes the matrices
      // and the arm below places one model per entry. `-1` says so.
      return -1;
    case SpawnClass.WaterEnemy:
      // `sub+0x6E` — `fish.bin`'s twenty-frame swim strip while it is alive,
      // and entry 0 or 1 once it is a corpse. `FishDraw` (`FUN_00439860`)
      // also draws a **flattened silhouette** on the water when the fish is
      // below it and `sub+0x6A` bit 2 is set; that second draw is not here.
      return a.fish.frame || null;
    case SpawnClass.ScriptedProp:
      // `obj+0x1F4`, straight off the descriptor tail. One slot, drawn under
      // `Translate; RotX; RotZ; RotY` and an optional uniform scale --
      // `ScriptedPropUpdate13` (`FUN_0043FE90`).
      return a.prop13.slot || null;
    case SpawnClass.ScriptedScenery:
      // `obj+0x13F0`, which `ScriptedPushableUpdate33` (`FUN_00433B70`) seeds
      // from its descriptor tail and never changes. Selector 1's draw is a
      // whole chain of sprite loops and sub-models the rig writer already
      // exports, so it is deliberately not here: `a.scenery.slot` is non-zero
      // only once a selector-4 object has seeded itself.
      return a.hp === ScriptedScenerySelector.Pushable
        ? (a.scenery.slot || null) : null;
    case SpawnClass.ScriptedHumanoid:
      // Only the object-path arm. The three fixed-point arms draw at points
      // the routine hardcodes, so the rig writer already exports them as
      // parts of `obj_484ff0_props` and `RigLayer` places them.
      //
      // Off `a.hum`, not off the bundle: `ScriptedHumanoidInit` caches the
      // descriptor word on the actor precisely so this is a field read.
      // `tools/verify_layers.py`'s `render-drives-the-port` is what says a
      // render layer may not call into `game/` for an answer, and it is right
      // -- reaching for `HumanoidProgramOf` here is one refactor away from
      // reaching for a decision.
      return a.hum.drawVariant === HumanoidDrawVariant.OnObjectPath
        ? HUMANOID_VARIANT3_SLOT : null;
    default:
      return null;
  }
}

/**
 * How big the drawing routine draws it, where that is not life size.
 *
 * **A property of the routine, not of the model.** Each class's own draw sets
 * the matrix before it hands the slot to `AssetDrawSlot`, so the number lives
 * beside {@link DrawSlotFor} and for the same reason: there is no general
 * "actor scale" in the engine either.
 *
 * A class absent here draws at one, and most do — `MouseWanderUpdate`
 * (`FUN_0043F5C0`) and `OwlDrawBodyChain` (`FUN_00447C20`) make no
 * `MatrixScale` call at all, which is a fact about their code rather than an
 * omission here.
 */
function DrawScaleFor(a: Actor): number {
  switch (a.cls) {
    case SpawnClass.ScriptedProp:
      // `MatrixScale(s, s, s)` at `0x0043FF1E`, and only when the descriptor's
      // `tail+0x0C` is not 1.0 -- the engine skips the call outright
      // otherwise. Stage 2's block 16 prop is the one that is not: 2.5.
      return a.prop13.scale || 1;
    case SpawnClass.WaterEnemy:
      // `MatrixScale(0.3, 0.3, 0.3)` at `0x00439AC9`, and again at
      // `0x00439CF8` in `FishSwimAwayTick` (`FUN_00439C20`). A fish drawn at
      // one is three and a third times the size of the one in the game, which
      // is what it looked like.
      //
      // The **other** two scale calls in the class are the flattened
      // silhouette on the water — `(0.4, 0.01, 0.4)` at `0x0043994F` and
      // `0x00439A4A` — and that is a second draw of the same model at a
      // different place, which this layer has no way to express. It is
      // declared in `game/class51/`.
      return 0.3;
    default:
      return 1;
  }
}

/**
 * `ScriptedHumanoidDraw`'s (`FUN_00484FF0`) object-path arm, placed.
 *
 * ```c
 * CamEvalObjectPath6(obj+0x135C, (float)g_cam_path_frame, &p);
 * MatrixStackPush(0);
 * MatrixTranslate(p.x, p.y, p.z);
 * MatrixRotateZ(p.rz); MatrixRotateY(p.ry); MatrixRotateX(p.rx);
 * AssetDrawSlot(0x1A37);
 * MatrixStackPop(1);
 * ```
 *
 * Three things it is easy to get wrong and this does not:
 *
 * * **The frame is `g_cam_path_frame`, raw.** No `min(frame, length)` clamp —
 *   `Class26Subtype2Update` (`FUN_0048EAD0`) has one and this does not, so
 *   the curve extrapolates off both ends exactly as the evaluator does.
 * * **No `+2.0` in y.** That bias belongs to `Class26Subtype2Update`, which
 *   writes `obj+0x44 = pose.y + 2.0` before it draws; this arm uses the raw
 *   pose. (The passengers get their own `+2.0` on path slots `0x156`..`0x15C`
 *   from `PATH_SLOT_LIFT`, which is a third, separate rule.)
 * * **The composition is `T · Rz · Ry · Rx`**, which is a three.js `Euler` in
 *   `"ZYX"` order — the same argument `render/rigs.ts`'s `bamsEuler` spells
 *   out.
 *
 * [diverges] The arm also draws a **mirrored pair of wake sprites** —
 * `AssetDrawSlot(0x24A + g_frame_counter % 22)` twice, under an anchor at
 * `(p.x, -25.0, p.z)` turned by a heading `MatrixToEulerBams`
 * (`FUN_00401AE0`) takes off the composed rotation, at `x = ±1.7, z = 20.0`
 * with the second mirrored by a `(-1, 1, 1)` scale. They are not drawn here.
 * Doing it faithfully needs `MatrixToEulerBams` and `FUN_00401800`
 * transcribed — the heading is *not* `p.ry`, because the decomposition undoes
 * `rz` and `rx` from the left and `op_st3` 340's `rot_x` runs to 15,758 BAMS
 * — plus 22 more models (`char_adv06.bin` 0..21) in every bundle that carries
 * a variant-3 spawn. Left out rather than guessed at; it is a separate piece
 * of work and the user's call.
 */
function PlaceOnObjectPath(a: HumanoidActor, node: Object3D,
                           paths: CamPaths | null): void {
  const slot = a.hum.pathSlot;
  const path = slot >= 0 ? paths?.objectPath(slot) : undefined;
  if (!path) {
    // Nothing to place it from. Hide rather than leave it at the origin: an
    // object at (0,0,0) is a thing somebody has to go and explain.
    node.visible = false;
    return;
  }
  node.visible = true;
  const t = G.g_cam_path_frame;
  path.position(t, _pos);
  node.position.set(_pos.x, _pos.y, _pos.z);
  node.rotation.set(path.channel(3, t) * BAMS_TO_RAD,
                    path.channel(4, t) * BAMS_TO_RAD,
                    path.channel(5, t) * BAMS_TO_RAD, "ZYX");
}

/** Scratch for {@link PlaceOnObjectPath}; the layer is single-threaded. */
const _pos = { x: 0, y: 0, z: 0 };

/** One live actor's node. */
interface Live {
  node: Object3D;
  /**
   * The slot the node was cloned for; a change re-clones it.
   *
   * `-1` for a **chain**: class 0x43's owl is sixteen slots under one group,
   * so the group is the node and {@link Live.parts} is what re-clones.
   */
  slot: number;
  /** For a chain: the slot each child was cloned for, in order. */
  parts?: number[];
}

export class SlotModelLayer implements System<RenderContext> {
  readonly id = "render.slotmodels";
  readonly group = new Group();
  private readonly templates = new Map<number, Object3D>();
  private readonly nodes = new Map<number, Live>();
  /** The routines' extra draws, keyed by what drew them. Session state. */
  private readonly extras = new Map<string, Live>();
  /** Scratch for {@link SlotModelLayer.chain}; the layer is single-threaded. */
  private readonly _parts: OwlPart[] = [];
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
      for (const l of this.extras.values()) l.node.removeFromParent();
      this.extras.clear();
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
  update(ctx: RenderContext): void {
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    const seen = new Set<number | string>();

    for (const a of G.g_object_list) {
      if (a.dead) continue;
      const slot = DrawSlotFor(a);
      if (slot === null) continue;
      seen.add(a.at);
      let live = this.nodes.get(a.at);
      if (slot === CHAIN) {
        const chained = this.chain(a, live);
        if (!chained) continue;
        live = chained;
      } else if (!live || live.slot !== slot) {
        // The strip advances every frame, so the node is re-cloned whenever
        // the slot changes -- which for a running mouse is every frame, and
        // for a waiting one is never.
        live?.node.removeFromParent();
        const node = this.clone(slot);
        if (!node) continue;
        this.group.add(node);
        live = { node, slot };
        this.nodes.set(a.at, live);
      }
      // Where a slot model goes is the drawing routine's, not the actor's:
      // the mouse draws at `obj+0x40`/`obj+0x68`, and class 0x25's variant 3
      // draws at an object-path pose the actor never stores. Same switch as
      // {@link DrawSlotFor}, and it stays a switch for the same reason.
      const k = DrawScaleFor(a);
      live.node.scale.set(k, k, k);
      if (a.cls === SpawnClass.ScriptedHumanoid) {
        PlaceOnObjectPath(a, live.node, ctx.paths);
      } else if (a.cls === SpawnClass.ScriptedScenery) {
        // `ScriptedPushableUpdate33`'s own draw, and it is **all three**
        // rotations: `MatrixTranslate(obj+0x40, +0x44, +0x48)` then
        // `RotZ(obj+0x6C)`, `RotY(obj+0x68)`, `RotX(obj+0x64)` at
        // `0x00433C17`..`0x00433C51`. That composition is a three.js `Euler`
        // in `"ZYX"` order — the same argument `PlaceOnObjectPath` above
        // spells out. The mouse's routine is yaw-only, which is why this is a
        // second arm rather than pitch and roll added to the one below.
        live.node.visible = true;
        live.node.position.set(a.pos.x, a.pos.y, a.pos.z);
        live.node.rotation.set(a.pitch * BAMS_TO_RAD, a.yaw * BAMS_TO_RAD,
                               a.roll * BAMS_TO_RAD, "ZYX");
      } else if (a.cls === SpawnClass.ScriptedProp) {
        // `ScriptedPropUpdate13` (`FUN_0043FE90`) is
        // `MatrixTranslate(obj+0x40)` then `RotX(obj+0x64)`, `RotZ(obj+0x6C)`,
        // `RotY(obj+0x68)` at `0x0043FEE3`..`0x0043FEF9` — the product is
        // `Rx · Rz · Ry`, a three.js `Euler` in `"XZY"`. Three arms now, three
        // different orders, and each is its own routine's.
        live.node.visible = true;
        live.node.position.set(a.pos.x, a.pos.y, a.pos.z);
        live.node.rotation.set(a.pitch * BAMS_TO_RAD, a.yaw * BAMS_TO_RAD,
                               a.roll * BAMS_TO_RAD, "XZY");
      } else if (a.cls === SpawnClass.FlyingEnemy) {
        // `MatrixTranslate(pos)` then `RotY(obj+0x68) RotZ(obj+0x6C)
        // RotX(obj+0x64)` at `0x00447C49`..`0x00447C64` — the product is
        // `Ry · Rz · Rx`, which is a three.js `Euler` in `"YZX"`. The arm
        // above is `"ZYX"` because its routine rotates in the other order:
        // the order belongs to the routine, not to the engine.
        live.node.visible = true;
        live.node.position.set(a.pos.x, a.pos.y, a.pos.z);
        live.node.rotation.set(a.pitch * BAMS_TO_RAD, a.yaw * BAMS_TO_RAD,
                               a.roll * BAMS_TO_RAD, "YZX");
      } else {
        live.node.visible = true;
        live.node.position.set(a.pos.x, a.pos.y, a.pos.z);
        live.node.rotation.set(0, a.yaw * BAMS_TO_RAD, 0);
      }
    }

    this.drawCarrierEffects(seen);
    this.drawPropStrips(seen);

    for (const [key, l] of this.extras) {
      if (seen.has(key)) continue;
      l.node.removeFromParent();
      this.extras.delete(key);
    }

    for (const [at, l] of this.nodes) {
      if (seen.has(at)) continue;
      l.node.removeFromParent();
      this.nodes.delete(at);
    }
  }

  resync(ctx: RenderContext): void {
    this.update(ctx);
  }

  /**
   * A node for one of a routine's extra draws, re-cloned when its slot moves
   * on, and placed by the matrix the routine composed.
   */
  private extra(key: string, slot: number, m: Matrix4,
                seen: Set<number | string>): void {
    let live = this.extras.get(key);
    if (!live || live.slot !== slot) {
      live?.node.removeFromParent();
      const node = this.clone(slot);
      if (!node) { this.extras.delete(key); return; }
      node.matrixAutoUpdate = false;
      this.group.add(node);
      live = { node, slot };
      this.extras.set(key, live);
    }
    live.node.matrix.copy(m);
    live.node.visible = true;
    seen.add(key);
  }

  /**
   * The draws class 0x13's carrier routines make besides the prop, on the
   * frames `game/class13/` says they made them (`*Drawn`, 0 for none).
   */
  private drawCarrierEffects(seen: Set<number | string>): void {
    for (const a of G.g_object_list) {
      if (a.dead || a.despawned || a.cls !== SpawnClass.ScriptedProp) continue;
      const t = (a as { prop13?: ScriptedPropTail }).prop13;
      if (!t || t.behaviour !== 8) continue;
      if (t.selector === 0) {
        if (t.wakeDrawn) {
          // `Push; Translate(pos); RotX; RotZ; RotY; Translate(0, 0, 27.5);
          // Scale(1, 0.15, 1); AssetDrawSlot(ride->wake)`.
          _m.identity();
          mTranslate(_m, a.pos.x, a.pos.y, a.pos.z);
          mRotX(_m, a.pitch); mRotZ(_m, a.roll); mRotY(_m, a.yaw);
          mTranslate(_m, 0, 0, WAKE0_Z);
          mScale(_m, 1, WAKE0_SCALE_Y, 1);
          this.extra(`w0:${a.at}`, t.wakeDrawn, _m, seen);
        }
        if (t.splashDrawn) {
          _m.identity();
          mTranslate(_m, ...SPLASH0_AT);
          mRotY(_m, SPLASH0_YAW);
          mScale(_m, SPLASH0_SCALE, SPLASH0_SCALE, SPLASH0_SCALE);
          this.extra(`s0:${a.at}`, t.splashDrawn, _m, seen);
        }
      } else if (CARRIER_GROUND_WAKE_DRAW[t.selector]) {
        // Selectors 1 and 6: one shape of draw, their own literals.
        const lit = CARRIER_GROUND_WAKE_DRAW[t.selector];
        if (t.wakeDrawn) {
          // `CarrierDrawGroundWake` (`FUN_00440770`): on the ground, along
          // the keel, two slots under one matrix.
          _m.identity();
          mTranslate(_m, a.pos.x, t.wakeGroundY, a.pos.z);
          mRotY(_m, t.wakeYaw);
          mTranslate(_m, 0, 0, lit.wakeZ);
          mScale(_m, 1, t.wakeScale, t.wakeScale);
          this.extra(`w1:${a.at}`, t.wakeDrawn, _m, seen);
          this.extra(`w1b:${a.at}`, t.wakeDrawn + CARRIER_WAKE_PAIR, _m, seen);
        }
        if (t.stripDrawn) {
          // States 5/6: `Translate(pos); RotX; RotZ; RotY; Translate(0, 0,
          // -5); RotY(-yaw); RotZ(roll); RotX(pitch); RotY(camera yaw)`, as
          // written -- the three turns after the bow are not an inverse.
          _m.identity();
          mTranslate(_m, a.pos.x, a.pos.y, a.pos.z);
          mRotX(_m, a.pitch); mRotZ(_m, a.roll); mRotY(_m, a.yaw);
          mTranslate(_m, 0, 0, lit.stripZ);
          mRotY(_m, -a.yaw); mRotZ(_m, a.roll); mRotX(_m, a.pitch);
          mRotY(_m, G.g_camera_yaw_bams);
          this.extra(`t1:${a.at}`, t.stripDrawn, _m, seen);
        }
      }
    }
  }

  /**
   * `PropStripEffectUpdate` (`FUN_0043FBC0`)'s draw: `Translate; RotX; RotZ;
   * RotY`, and a scale only when it is not 1.0. An object that has not yet
   * run its first update (`delay` still up) has drawn nothing.
   */
  private drawPropStrips(seen: Set<number | string>): void {
    for (const e of G.g_prop_strip_effects) {
      if (e.delay !== 0) continue;
      _m.identity();
      mTranslate(_m, e.pos.x, e.pos.y, e.pos.z);
      mRotX(_m, e.pitch); mRotZ(_m, e.roll); mRotY(_m, e.yaw);
      if (e.scale !== 1) mScale(_m, e.scale, e.scale, e.scale);
      this.extra(`p:${e.id}`, e.slot, _m, seen);
    }
  }

  /**
   * One group holding every model in a **chain** class's draw, placed.
   *
   * The group is the actor root; each child carries the matrix
   * `OwlBodyChain` composed for it, which is the product the engine's matrix
   * stack has when that `AssetDrawSlot` runs. A child is re-cloned only when
   * its slot changes -- the beat's does every frame, the body's never -- and
   * the matrices are rewritten every frame either way, because the angles do.
   */
  private chain(a: Actor, live: Live | undefined): Live | null {
    const parts = OwlBodyChain(a, this._parts);
    if (!parts.length) return null;
    if (!live || live.slot !== CHAIN) {
      live?.node.removeFromParent();
      const g = new Object3D();
      this.group.add(g);
      live = { node: g, slot: CHAIN, parts: [] };
      this.nodes.set(a.at, live);
    }
    const have = live.parts ?? (live.parts = []);
    for (let i = 0; i < parts.length; i++) {
      if (have[i] !== parts[i].slot || !live.node.children[i]) {
        const c = this.clone(parts[i].slot);
        // A slot with no model in the bundle: keep whatever is at this index
        // and carry on, rather than truncating the chain from here. Every one
        // of the sixteen ships, so this is the shape of a stale export.
        if (!c) { if (!live.node.children[i]) break; continue; }
        if (live.node.children[i]) {
          live.node.remove(live.node.children[i]);
          live.node.children.splice(i, 0, c);
          c.parent = live.node;
        } else {
          live.node.add(c);
        }
        have[i] = parts[i].slot;
      }
      const c = live.node.children[i];
      c.matrixAutoUpdate = false;
      c.matrix.copy(parts[i].m);
      c.visible = true;
    }
    while (live.node.children.length > parts.length) {
      live.node.children.pop();
      have.pop();
    }
    return live;
  }

  /**
   * The node drawn for one actor, or null. For the tests: the placement and
   * the scale are the two things this layer decides, and neither is visible
   * through {@link SlotModelLayer.describe}.
   */
  nodeFor(at: number): Object3D | null {
    return this.nodes.get(at)?.node ?? null;
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

  /**
   * What the panel says when nothing is drawn, and why — **and where the
   * drawn ones are.**
   *
   * The position is here rather than merely the count because this layer's
   * whole job is to put a model somewhere the actor is not: class 0x25's
   * object-path arm draws at a pose the actor never stores, and "is the boat
   * under the passengers" is not a question any count can answer. `x, y, z`
   * is the node's own translation, and the group this layer owns is added to
   * the scene untransformed, so it is world space.
   *
   * `web/tools/stage3.mjs` reads this line back out of the sidebar and
   * compares it against the passengers' own positions.
   */
  describe(): string {
    if (!this.templates.size) return "no slot models in this bundle";
    const where = [...this.nodes].filter(([, l]) => l.node.visible)
      .map(([at, l]) => {
        const p = l.node.position;
        return `${at.toString(16).padStart(4, "0")} `
             + `slot 0x${l.slot.toString(16)} at `
             + `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
      });
    return `${this.nodes.size} drawn, ${this.templates.size} templates`
         + (where.length ? ` — ${where.join("; ")}` : "");
  }
}

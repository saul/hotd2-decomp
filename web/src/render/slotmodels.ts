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
 * The whole routine, broad phase and fork included, is
 * `game/combat/shot_test.ts`'s, for the classes that register the engine's
 * way. This layer tests the ones that do not; `CharacterLayer.pickShot` says
 * what that costs them.
 */
import {
  Group, Matrix4, Object3D, Ray, Vector3, type Mesh,
} from "three";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import { ActorFlag, MotionFlag, type Actor, type HumanoidActor }
  from "../game/actor";
import { Boss2FlipbookMatrix } from "./characters/model_block";
import { HumanoidDrawVariant, HUMANOID_VARIANT3_SLOT }
  from "../game/class25/state";
import type { CamPaths } from "../game/camera/curve";
import { G } from "../game/globals";
import { g_class_handlers } from "../game/registry";
import { ScriptedScenerySelector } from "../game/class33/state";
import { OwlBodyChain, type OwlPart } from "./owl";
import { deformHordeSheet, HordeDrawParts, type HordePart } from "./horde";
import { WormDrawParts, type WormPart } from "./worm";
import { FishDrawParts, type FishPart } from "./fish";
import { SpawnClass } from "../game/spawn_class";
import { BAMS_TO_RAD } from "../core/bams";
import {
  CARRIER2_DOOR_AT, CARRIER2_DOOR_SLOTS, CARRIER_GROUND_WAKE_DRAW,
  CARRIER_WAKE_PAIR, type ScriptedPropTail,
}
  from "../game/class13/state";
import type { VehicleTail } from "../game/class26/state";
import { Class32Routine } from "../game/class32/state";
import { setAssetDrawAlpha } from "./draw_order";

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
/** `PUSH 0x17C8` -- `boss1q.bin` 94, the walker's landing ring. */
const LANDING_RING_SLOT = 0x17c8;

/** Scratch matrices for the carrier draws; the layer is single-threaded. */
const _m = new Matrix4();
/** Scratch: the camera's +y in world space, for the stage-2 boss's draw. */
const _up = { x: 0, y: 1, z: 0 };
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
 * `AssetDrawSlotWithAlpha` (`FUN_004185A0`)'s alpha on a clone, or `null` for
 * a plain `AssetDrawSlot` (`FUN_00418560`). The state is
 * `DrawModelWithForcedAlphaBlend`'s (`FUN_004A8440`), at each mesh's own base
 * alpha times this one and at 1 as at any other value; see
 * `setAssetDrawAlpha`, which the effect layers' `setSlotAlpha` also is.
 */
function setDrawAlpha(c: Object3D, alpha: number | null): void {
  setAssetDrawAlpha(c, alpha);
}

/**
 * `DrawSlotFor`'s answer for a class whose draw is a **chain** of slots rather
 * than one: the placement arm builds a group instead. Class 0x43 is the only
 * one, and `render/owl.ts` is its chain.
 */
const CHAIN = -1;

/** `SetDrawLayerNibble(8)`, the world's layer: `renderOrder` 0. */
const WORLD_LAYER = 8;

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
      // A chain too: `FishDraw` (`FUN_00439860`) draws `sub+0x6E` -- the swim
      // strip, or a corpse -- under the sub-block's own angles, and a
      // **flattened silhouette** of it on the water when it is drawn solid
      // and below the surface. `render/fish.ts` composes both.
      return CHAIN;
    case SpawnClass.ScriptedProp:
      // `obj+0x1F4`, straight off the descriptor tail. One slot, drawn under
      // `Translate; RotX; RotZ; RotY` and an optional uniform scale --
      // `ScriptedPropUpdate13` (`FUN_0043FE90`).
      return a.prop13.slot || null;
    case SpawnClass.FlagStripProp:
      // `AssetDrawSlot(__ftol(sub+0x14))` at `0x0043FB54`..`0x0043FB5D` --
      // the cursor `ScriptedPropUpdate12` (`FUN_0043FA60`) steps, truncated
      // here because the truncation is the draw's. A half-slot step draws
      // each slot twice.
      return Math.trunc(a.prop12.cursor) || null;
    case SpawnClass.ScriptedScenery:
      // `obj+0x13F0`, which `ScriptedPushableUpdate33` (`FUN_00433B70`) seeds
      // from its descriptor tail and never changes. Selector 1's draw is a
      // fire, the model and a chain of sprite loops or sub-models, recorded
      // by `game/class33/` and placed by {@link drawCarrier33}, so it is not
      // here: `a.scenery.slot` is non-zero only once a selector-4 object has
      // seeded itself.
      return a.hp === ScriptedScenerySelector.Pushable
        ? (a.scenery.slot || null) : null;
    case SpawnClass.HordeSpawner:
      // A chain too: the member's shadow, the emerge prop's two halves, the
      // splash and its ripple -- `render/horde.ts` composes the matrices, in
      // world space. The member's own model is the character layer's.
      return -1;
    case SpawnClass.Worm:
      // A chain: the body and its shadow, the death strip, or two halves and
      // their cut -- `render/worm.ts` composes the matrices, in world space.
      return -1;
    case SpawnClass.Vehicle:
      // A chain too, and one the port composed: subtypes 6 and 7's routines
      // record every `AssetDrawSlot` they make with its world matrix
      // (`game/class26/subtype67.ts`). The boat records none -- its model is
      // `render/rigs.ts`' -- so it is not this layer's.
      return (a as { vehicle?: VehicleTail }).vehicle?.draws.length
        ? CHAIN : null;
    case SpawnClass.ScriptedHumanoid:
      // Only the object-path arm. The three fixed-point arms draw at points
      // the routine hardcodes, so the rig writer already exports them as
      // parts of `obj_484ff0_props` and `RigLayer` places them.
      //
      // Off `a.hum`, not off the bundle: `ScriptedHumanoidInit` caches the
      // descriptor word on the actor precisely so this is a field read.
      // `web/tools/repo/layers.ts`'s `render-drives-the-port` is what says a
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
    case SpawnClass.FlagStripProp:
      // The same test on `sub+0x10` at `0x0043FB2F` (`FCOMP 1.0`), and the
      // same call at `0x0043FB43`. All three shipped descriptors carry 1.0.
      return a.prop12.scale || 1;
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

/** One of class 0x26's recorded draws, as a chain part. */
interface VehiclePart {
  slot: number;
  m: Matrix4;
  /** `SetRenderLightColour`'s colour for this one draw, when it had one. */
  light?: number[];
}

/**
 * What class 0x26's routine drew this frame, as the chain arm wants it: the
 * slot, the world matrix it recorded -- `game/matrix.ts`'s layout is
 * `Matrix4.elements`' -- and the light colour. The draws are the port's;
 * this reads them and decides nothing but `AssetDrawSlot`'s own residency
 * test (`resident`): a recorded draw of a slot the script has unloaded
 * draws nothing, as in the engine.
 */
function VehicleDrawParts(a: Actor, out: VehiclePart[],
                          resident: (slot: number) => boolean): VehiclePart[] {
  const draws = (a as { vehicle?: VehicleTail }).vehicle?.draws ?? [];
  let n = 0;
  for (const d of draws) {
    if (!resident(d.slot)) continue;
    const p = out[n] ?? (out[n] = { slot: 0, m: new Matrix4() });
    p.slot = d.slot;
    p.m.fromArray(d.m);
    p.light = d.light;
    n++;
  }
  out.length = n;
  return out;
}

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
  /** Scratch for class 0x40's chain. */
  private readonly _hordeParts: HordePart[] = [];
  /** Scratch for class 0x42's chain. */
  private readonly _wormParts: WormPart[] = [];
  /** Scratch for {@link FishDrawParts}. */
  private readonly _fishParts: FishPart[] = [];
  /** Scratch for class 0x26's chain. */
  private readonly _vehicleParts: VehiclePart[] = [];
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

  /**
   * A fresh copy of one template, for a layer that draws a slot this one
   * does not -- `render/water_surfaces.ts`'s canal tiles, which ride the same
   * rig. The copy shares the template's geometry.
   */
  cloneTemplate(slot: number): Object3D | null {
    return this.clone(slot);
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
   * The stage, for `AssetDrawSlot`'s residency test (`FUN_00418560` draws
   * nothing that is not loaded): stage 4's `0x954` is unloaded by opcode
   * `0x51` at block 23 op 75, thirty ops before the class-0x13 prop that
   * draws it is despawned, and the engine draws nothing in between. Null
   * draws everything, which is what a layer with no stage can say.
   */
  residency: { slotResident(slot: number): boolean } | null = null;

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
      if (slot !== CHAIN && this.residency
          && !this.residency.slotResident(slot)) {
        continue;
      }
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
        // Whose draw this is, for the light set `render/lighting.ts` picks.
        node.userData.hod2_actor_at = a.at;
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
      } else if (a.cls === SpawnClass.ScriptedProp
                 || a.cls === SpawnClass.FlagStripProp) {
        // `ScriptedPropUpdate12` (`FUN_0043FA60`) composes the same product
        // at `0x0043FB05`..`0x0043FB20`: Translate, then RotX(+0x64),
        // RotZ(+0x6C), RotY(+0x68).
        //
        // `ScriptedPropUpdate13` (`FUN_0043FE90`) is
        // `MatrixTranslate(obj+0x40)` then `RotX(obj+0x64)`, `RotZ(obj+0x6C)`,
        // `RotY(obj+0x68)` at `0x0043FEE3`..`0x0043FEF9` — the product is
        // `Rx · Rz · Ry`, a three.js `Euler` in `"XZY"`. Three arms now, three
        // different orders, and each is its own routine's.
        live.node.visible = true;
        live.node.position.set(a.pos.x, a.pos.y, a.pos.z);
        live.node.rotation.set(a.pitch * BAMS_TO_RAD, a.yaw * BAMS_TO_RAD,
                               a.roll * BAMS_TO_RAD, "XZY");
      } else if (a.cls === SpawnClass.HordeSpawner
                 || a.cls === SpawnClass.Worm
                 || a.cls === SpawnClass.Vehicle
                 || a.cls === SpawnClass.WaterEnemy) {
        // `render/horde.ts`, `render/worm.ts` and `render/fish.ts` hand back
        // world-space matrices, scale included, and class 0x26's routines
        // recorded them.
        live.node.visible = true;
        live.node.position.set(0, 0, 0);
        live.node.rotation.set(0, 0, 0);
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
    this.drawCarrier33(seen);
    this.drawPropStrips(seen);
    this.drawBoss2Flipbooks(ctx, seen);
    this.drawLandingRings(seen);
    this.drawBoss5Draws(seen);

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
   * on, and placed by the matrix the routine composed. `alpha` is
   * `AssetDrawSlotWithAlpha`'s, and absent for `AssetDrawSlot`; `light` is
   * the colour `SetRenderLightColour` gave the draw, which
   * `render/lighting.ts` reads off the node; `layer` is the
   * `SetDrawLayerNibble` it was made in, the world's own 8 when absent.
   */
  private extra(key: string, slot: number, m: Matrix4,
                seen: Set<number | string>, alpha: number | null = null,
                light: readonly number[] | null = null,
                layer: number | null = null): void {
    if (this.residency && !this.residency.slotResident(slot)) return;
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
    setDrawAlpha(live.node, alpha);
    if (light) live.node.userData.hod2_light_colour = [...light];
    else delete live.node.userData.hod2_light_colour;
    // The port spells a layer as `renderOrder`, the world's 8 being 0 --
    // `render/draw_order.ts`. A draw in the world's own layer keeps the
    // template's, and a key is always the same routine's draw.
    if (layer !== null) live.node.renderOrder = layer - WORLD_LAYER;
    seen.add(key);
  }

  /**
   * Class 0x32's draws that are not its skeleton: each projectile's, and
   * each task's, on the frames the port says they drew -- the slot, the
   * world matrix, the light colour, the alpha and the layer the routine
   * recorded (`game/class32/projectile.ts`, `game/class32/tasks.ts`).
   *
   * * **projectile** (`Class32ProjectileDispatchAndDraw`, `FUN_0047EFA0`):
   *   `T RotZ RotY RotX Scale(p+0x118)` and `SetRenderLightColour(1, v, v)`.
   * * **afterimage**, **trail**, **hands**: `T RotZ RotY RotX`, the trail
   *   scaled, each under its own colour.
   * * **body loop**: the boss's own matrix raised 15, at `a * 0.5`, in
   *   layer 9.
   * * **death burst** and **exit effect**: no colour of their own; the
   *   record carries the one the draw before them left in the register.
   */
  private drawBoss5Draws(seen: Set<number | string>): void {
    for (const a of G.g_object_list) {
      if (a.despawned || a.cls !== SpawnClass.Boss5) continue;
      const t = a.boss5;
      if (t.routine !== Class32Routine.Projectile || !t.draw) continue;
      _m.fromArray(t.draw.m);
      this.extra(`c32p:${a.at}`, t.slot, _m, seen, null, t.draw.light);
    }
    for (const task of G.g_class32_tasks) {
      const d = task.draw;
      if (task.killed || !d) continue;
      _m.fromArray(d.m);
      this.extra(`c32t:${task.id}`, d.slot, _m, seen, d.alpha, d.light,
                 d.layer);
    }
  }

  /**
   * Class 0x33 selector 1's draws, every one of them: `ScriptedCarrierUpdate33`
   * (`FUN_004331D0`) records each `AssetDrawSlot` it makes with its world
   * matrix (`game/class33/`) -- the fire, the model at `obj+0x118`'s scale,
   * and stage 5's car parts or the two sprite loops.
   */
  private drawCarrier33(seen: Set<number | string>): void {
    for (const a of G.g_object_list) {
      if (a.despawned || a.cls !== SpawnClass.ScriptedScenery) continue;
      if (a.hp !== ScriptedScenerySelector.Carrier) continue;
      a.scenery.draws.forEach((d, i) => {
        _m.fromArray(d.m);
        this.extra(`c33:${i}:${a.at}`, d.slot, _m, seen);
      });
    }
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
      // `CarrierPropRoutine4` and `5` (`FUN_00440C20`, `FUN_00441000`) hand
      // over their draws whole -- the camera-facing strip and the effect's
      // parts, each under the matrix the routine built.
      t.draws.forEach((d, i) => {
        _m.fromArray(d.m);
        this.extra(`c${i}:${a.at}`, d.slot, _m, seen);
      });
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
      } else if (t.selector === 2 || t.selector === 9) {
        // `CarrierPropRoutine2` (`FUN_004408A0`)'s tail, every frame from the
        // one its ride block exists: under `T(pos) RotX RotZ RotY`, each door
        // at its own offset turned by its own yaw.
        if (!t.riding) continue;
        for (let i = 0; i < 2; i++) {
          _m.identity();
          mTranslate(_m, a.pos.x, a.pos.y, a.pos.z);
          mRotX(_m, a.pitch); mRotZ(_m, a.roll); mRotY(_m, a.yaw);
          mTranslate(_m, CARRIER2_DOOR_AT[i][0], CARRIER2_DOOR_AT[i][1],
                     CARRIER2_DOOR_AT[i][2]);
          mRotY(_m, i === 0 ? t.door0Yaw : t.door1Yaw);
          this.extra(`d${i}:${a.at}`, CARRIER2_DOOR_SLOTS[i], _m, seen);
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
          // written -- the three turns after the bow are not an inverse. The
          // camera yaw is the camera block's, `g_camera_block_yaw_bams`
          // (`0x009A60D0`, read at `0x004406AD` and `0x0044168D`).
          _m.identity();
          mTranslate(_m, a.pos.x, a.pos.y, a.pos.z);
          mRotX(_m, a.pitch); mRotZ(_m, a.roll); mRotY(_m, a.yaw);
          mTranslate(_m, 0, 0, lit.stripZ);
          mRotY(_m, -a.yaw); mRotZ(_m, a.roll); mRotX(_m, a.pitch);
          // `CameraBlockYaw(g_camera_index)`, read rather than called, as
          // `render/camera.ts` reads the view: the exe indexes the block
          // (`[ECX*4 + 0x9a60d0]` at `0x004406AD`).
          mRotY(_m, G.g_camera_index === 2 ? G.g_camera_block2_yaw_bams
            : G.g_camera_block_yaw_bams);
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
   * The two flipbooks the stage-2 boss draws on bone 1:
   * `AssetDrawSlot((s16)state+0x7C); AssetDrawSlot((s16)state+0x88)` under
   * bone 1's matrix, inside `Class14AdvanceMotionAndPublishPoints`'s draw
   * (`0x0047791A..`) and only while `char+0x64` bit 0 is up. The slots step
   * every frame in `game/class14/advance.ts`; B's frame is the weak point's
   * damage window, so what is drawn here is what the gate reads.
   */
  private drawBoss2Flipbooks(ctx: RenderContext,
                             seen: Set<number | string>): void {
    // `g_camera_blocks[cam]`'s row 1, the camera's up in world space. A
    // context with no camera has drawn nothing yet; world up stands in.
    const e = ctx.camera?.matrixWorld.elements;
    _up.x = e ? e[4] : 0; _up.y = e ? e[5] : 1; _up.z = e ? e[6] : 0;
    for (const a of G.g_object_list) {
      if (a.despawned || a.cls !== SpawnClass.Boss2 || !a.skel) continue;
      if (!(a.motionFlags & MotionFlag.Drawn)) continue;
      if (!Boss2FlipbookMatrix(a, _up, _m)) continue;
      const t = a.boss2;
      if (t.bookA.frame) this.extra(`bA:${a.at}`, t.bookA.frame, _m, seen);
      if (t.bookB.frame) this.extra(`bB:${a.at}`, t.bookB.frame, _m, seen);
    }
  }

  /**
   * `Class23LandingRingUpdate` (`FUN_00491700`)'s draw, on the frames
   * `game/class23/` says it drew: `T(pos) RotY(yaw) Scale(e)` and slot
   * `0x17C8` at `1.0 - fade`, all of it off the ring's record.
   */
  private drawLandingRings(seen: Set<number | string>): void {
    for (const a of G.g_object_list) {
      if (a.dead || a.cls !== SpawnClass.JudgmentCompanion) continue;
      const r = a.companion.ring;
      if (!r || !r.drawn) continue;
      _m.identity();
      mTranslate(_m, r.x, r.y, r.z);
      mRotY(_m, r.yaw);
      mScale(_m, r.scale.x, r.scale.y, r.scale.z);
      this.extra(`ring:${a.at}`, LANDING_RING_SLOT, _m, seen, 1.0 - r.fade);
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
    const resident = (slot: number): boolean =>
      !this.residency || this.residency.slotResident(slot);
    const parts: (OwlPart | HordePart | WormPart | VehiclePart | FishPart)[] =
      a.cls === SpawnClass.HordeSpawner
        ? HordeDrawParts(a, this._hordeParts)
        : a.cls === SpawnClass.Worm ? WormDrawParts(a, this._wormParts)
          : a.cls === SpawnClass.WaterEnemy
            ? FishDrawParts(a, this._fishParts, resident)
          : a.cls === SpawnClass.Vehicle
            ? VehicleDrawParts(a, this._vehicleParts, resident)
            : OwlBodyChain(a, this._parts);
    if (!parts.length) {
      // Nothing drawn this frame -- a member that is not drawing its shadow.
      // Hide what the last frame drew rather than leave it standing.
      if (live) live.node.visible = false;
      return null;
    }
    if (!live || live.slot !== CHAIN) {
      live?.node.removeFromParent();
      const g = new Object3D();
      this.group.add(g);
      live = { node: g, slot: CHAIN, parts: [] };
      this.nodes.set(a.at, live);
      g.userData.hod2_actor_at = a.at;
    }
    const have = live.parts ?? (live.parts = []);
    for (let i = 0; i < parts.length; i++) {
      if (have[i] !== parts[i].slot || !live.node.children[i]) {
        const c = this.clone(parts[i].slot);
        // A slot with no model in the bundle: keep whatever is at this index
        // and carry on, rather than truncating the chain from here. Every one
        // of the sixteen ships, so this is the shape of a stale export.
        if (!c) { if (!live.node.children[i]) break; continue; }
        // The sheet reshapes its model every frame: its own geometry, then.
        if ((parts[i] as Partial<HordePart>).deform) {
          c.traverse((o) => {
            const mesh = o as Mesh;
            if (mesh.geometry) mesh.geometry = mesh.geometry.clone();
          });
        }
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
      if ((parts[i] as Partial<HordePart>).deform) deformHordeSheet(c, a);
      // `AssetDrawSlotWithAlpha` (`FUN_004185A0`): the fading draws in a
      // chain, class 0x40's ripple and class 0x42's shadow. Every other part
      // is `AssetDrawSlot`.
      setDrawAlpha(c, (parts[i] as Partial<HordePart>).alpha ?? null);
      // A draw its routine lit with a colour of its own, which
      // `render/lighting.ts` reads off the node.
      const light = (parts[i] as Partial<VehiclePart>).light;
      if (light) c.userData.hod2_light_colour = light;
      else delete c.userData.hod2_light_colour;
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
  pickSphere(ray: Ray):
      { at: number; point: Vector3; t: number; radius: number } | null {
    if (!this.enabled) return null;
    let best: { at: number; point: Vector3; t: number; radius: number }
      | null = null;
    for (const a of G.g_object_list) {
      if (a.dead || a.hitRadius <= 0) continue;
      // A class that registers the engine's way is `game/`'s to test.
      if (g_class_handlers[a.cls]?.registersForShotTest) continue;
      // `RegisterForShotTest` (`FUN_00405160`) skips bit `0x8000`.
      if (a.flags & ActorFlag.NoShotTest) continue;
      if (!this.nodes.has(a.at)) continue;       // not drawn, not shootable
      this._c.set(a.pos.x, a.pos.y, a.pos.z);
      ray.closestPointToPoint(this._c, this._p);
      const t = this._p.clone().sub(ray.origin).dot(ray.direction);
      if (t <= 0) continue;                      // behind the muzzle
      if (ray.distanceSqToPoint(this._c) > a.hitRadius * a.hitRadius) continue;
      if (!best || t < best.t) {
        best = { at: a.at, point: this._c.clone(), t, radius: a.hitRadius };
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

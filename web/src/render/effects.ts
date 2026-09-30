/**
 * The shot effects, drawn.
 *
 * The port owns the state — `G.g_sprite_effects`, `G.g_blood_sprays` and the
 * three per-shot rings are plain records that go into a snapshot as they are —
 * and this owns only the nodes, which is the same split and the same reasoning
 * as `SeveredHeadLayer` and `SlotModelLayer` next door.
 *
 * ## Every frame is a different model
 *
 * There is no texture animation anywhere in this game. A twenty-five-frame
 * blood spray is twenty-five models in `pol/common.bin`, and
 * `AssetDrawSlot(0x3A + cel)` steps through them one per game frame. So the
 * node has to be **re-cloned whenever the slot changes**, which for a running
 * effect is every frame. That is what `SlotModelLayer` does for the mouse,
 * for the same reason.
 *
 * ## Two coordinate spaces
 *
 * The muzzle flash and the Original Mode weapon record hold a point in the
 * **camera's own space** and are drawn under `MatrixLoadIdentity`, so they
 * ride the camera. Rather than transform them every frame, they hang off a
 * group whose matrix is the camera's, which is the same statement.
 *
 * The tracer and the sprite effects are in the world. So is the blood — but
 * the blood's position is not in the record at all: `DrawBloodSpray`
 * (`FUN_00407230`) re-reads the hit bone's sphere out of the actor every time
 * it draws, at the centre with the radius added to `z`, so the spray sticks to
 * a running zombie's shoulder and sits on the face of the limb turned toward
 * the camera. {@link EffectLayer.bones} is what answers that here.
 */
import {
  type BufferGeometry, Euler, Group, Matrix4, Object3D,
  Quaternion, Ray, Vector3,
} from "three";
import { drawBoss3Effects } from "./boss3_effects";
import { releaseAssetDrawAlpha } from "./draw_order";
import { drawBatSplashes } from "./bat_splash";
import { drawLifeMarkers } from "./life_markers";
import { drawViewSlots, drawWorldSlots } from "./view_slots";
import { drawCreatureEffects } from "./creature_effects";
import { drawWaterRings } from "./water_rings";
import { BAMS_TO_RAD } from "../core/bams";
import { G } from "../game/globals";
import { BannerStep } from "../game/boss_banner";
import { BOSS4_HIT_MARK_DRAW_SLOT } from "../game/class19/hit_mark";
import {
  BLOOD_DEPTH_BASE, BLOOD_DEPTH_FAR, BLOOD_DEPTH_RATE, BLOOD_FIRST_SLOT,
  BLOOD_SCALE,
} from "../game/effects/blood";
import {
  FLASH_SCALE, FLASH_SMOKE_SCALE, FLASH_SMOKE_SCALE_KIND4,
  OriginalWeaponKind, SHOT_EFFECT_RING, TRACER_SLOT_OFFSET,
  TRACER_WEAPON5_LOOP, TRACER_WEAPON5_PATH, TRACER_WEAPON5_SLOT,
  WEAPON_FIRST_SLOT, WEAPON_SCALE,
} from "../game/effects/shot_effects";
import { POINT_BLOOD_SCALE } from "../game/effects/blood";
import { PlayerTask } from "../game/player_state";
import {
  DAMAGE_OVERLAY_OFFSETS, DAMAGE_OVERLAY_SCALES, DAMAGE_OVERLAY_SLOTS,
  DAMAGE_OVERLAY_Z,
} from "../game/effects/damage_overlay";
import type { System } from "../core/system";
import type { RenderContext } from "./context";

/** Templates come from the hidden `slots_effect` rig the exporter emits. */
const SLOT_PART = /_slot_([0-9a-f]{4})$/;
const SLOT_RIG = "slots_effect";

/**
 * `g_muzzle_flash_slots` — 0x00579F78 — and `g_muzzle_smoke_slots` — 0x579F7C.
 * Two s16 per player, read out of the exe rather than derived.
 */
const MUZZLE_FLASH_SLOTS = [0x0175, 0x017f];
const MUZZLE_SMOKE_SLOTS = [0x0b76, 0x0b84];

/** What the layer needs from the character layer, and nothing more. */
/**
 * The narrow face `render/characters.ts` needs of this layer, so the
 * dependency is a method and not the class.
 */
export interface CreatureSphereSource {
  /**
   * The nearest creature the ray meets, its `id` and the along-ray `t`, or
   * null. See `EffectLayer.pickCreature`.
   */
  pickCreature(ray: Ray):
    { id: number; t: number; point: Vector3; radius: number } | null;
  /** The same for the carried props. See `EffectLayer.pickCarried`. */
  pickCarried(ray: Ray):
    { id: number; t: number; point: Vector3; radius: number } | null;
}

export interface BoneSphereSource {
  /**
   * The world centre and radius of one bone's hit sphere — `obj + bone * 0x90
   * + 0x274` and `+0x284`, which `ShotTestBoneSphere` (`FUN_004047D0`) tests
   * and `DrawBloodSpray` draws at. Returns the radius, or null.
   */
  boneSphere(at: number, bone: number, out: Vector3): number | null;
  /**
   * One bone's world matrix as the skeleton was last posed, as sixteen
   * elements into `out`; false when the actor has no such node. Class 0x45
   * draws its bite flash and its wake on the bone's own matrix
   * (`Boss3DrawBoneParts`). Optional so a stand-in need not pose bones.
   */
  boneMatrix?(at: number, bone: number, out: number[]): boolean;
}

/**
 * Free the materials a fading draw gave its clone -- see `setSlotAlpha` in
 * `boss3_effects.ts` and `releaseAssetDrawAlpha` -- and the geometry a
 * deforming one copied (the water mound). Anything else is the template's and
 * is not ours.
 */
function disposeOwned(node: Object3D): void {
  releaseAssetDrawAlpha(node);
  const geos = node.userData.ownedGeometries as BufferGeometry[] | undefined;
  if (geos) for (const g of geos) g.dispose();
  node.userData.ownedGeometries = undefined;
}

/** One drawn node, and the slot it was cloned for. */
interface Live {
  node: Object3D;
  slot: number;
}

export class EffectLayer implements System<RenderContext> {
  readonly id = "render.effects";
  /** World-space effects: the sprite objects, the blood and the tracer. */
  readonly group = new Group();
  /** Camera-space effects: the muzzle flash and the Original Mode record. */
  readonly viewGroup = new Group();

  /** Set from `app/`, the way `CharacterLayer.breakables` is. */
  bones: BoneSphereSource | null = null;

  /**
   * Draw the muzzle flash?
   *
   * Off by default, and the reason is what the flash is **for**: it sits
   * under the crosshair rather than at a gun, because the cabinet's light gun
   * wanted something bright at the aim point. With a mouse it is a bright
   * shape over the thing you are shooting and buys nothing. The port spawns
   * the ring records either way -- this decides only whether they are drawn,
   * so a snapshot is identical with it on or off.
   */
  private muzzle = true;
  private readonly templates = new Map<number, Object3D>();
  private readonly nodes = new Map<string, Live>();
  private enabled = true;
  private readonly _c = new Vector3();
  private readonly _v = new Vector3();
  private readonly _m = new Matrix4();
  private readonly _view = new Matrix4();
  private readonly _elems: number[] = new Array<number>(16).fill(0);
  /** The camera's world rotation, for the tracer's `MatrixClearRotation`. */
  private readonly _cq = new Quaternion();
  private readonly _cp = new Vector3();
  private readonly _cs = new Vector3();
  private readonly _rq = new Quaternion();
  private readonly _e = new Euler();

  constructor() {
    this.group.name = "effects";
    this.viewGroup.name = "effects-view";
    // The camera's own matrix, written once a frame from `ctx.camera`. Its
    // children are then in camera space, which is where the engine keeps them.
    this.viewGroup.matrixAutoUpdate = false;
  }

  /** Adopt the hidden templates, exactly as `SlotModelLayer` does. */
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

  attach(ctx: RenderContext): void {
    ctx.scope.child("effects.templates").defer(() => this.templates.clear());
    this.claimSession(ctx);
  }

  /**
   * The nodes are **session** state: a seek or a load replaces every pool
   * wholesale, and an impact from a future the player rewound out of must not
   * be left hanging in the air.
   */
  private claimSession(ctx: RenderContext): void {
    ctx.session.defer(() => {
      for (const l of this.nodes.values()) {
        l.node.removeFromParent();
        disposeOwned(l.node);
      }
      this.nodes.clear();
    });
  }

  setMuzzle(v: boolean): void {
    this.muzzle = v;
  }

  get muzzleOn(): boolean { return this.muzzle; }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.group.visible = v;
    this.viewGroup.visible = v;
  }

  /**
   * A fresh copy of the model at an asset slot, from the hidden
   * `slots_effect` rig -- for another layer that draws by slot (the
   * game-over screen's discs and footprints). Null if the bundle has none.
   */
  cloneSlot(slot: number): Object3D | null {
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
    // Feedback for a click, drawn over the world it landed in: the engine
    // puts these in draw layers 0xC and 0xE, above everything solid.
    c.renderOrder = 900;
    return c;
  }

  /**
   * One node per live record, at the slot the record's cursor names.
   *
   * `update` and `resync` are the same call: the layer owns nothing a
   * snapshot carries.
   */
  update(ctx: RenderContext): void {
    this.group.visible = this.enabled;
    this.viewGroup.visible = this.enabled;
    if (!this.enabled) return;
    this.viewGroup.matrix.copy(ctx.camera.matrixWorld);
    const seen = new Set<string>();

    this.drawSpriteEffects(seen);
    drawWaterRings({
      node: (key, slot, parent) => this.node(key, slot, parent),
      world: this.group,
    }, seen);
    this.drawBlood(ctx, seen);
    this.drawPointBlood(seen);
    this.drawBodyCreatures(seen);
    this.drawCarriedProps(seen);
    this.drawBoss4Extras(seen);
    this.drawShotRings(ctx, seen);
    this.drawDamageOverlays(seen);
    this.drawBossBanners(seen);
    // The owl's and the fish's tasks, and the ring the fish's corpse leaves:
    // `render/creature_effects.ts`.
    drawCreatureEffects({
      node: (key, slot, parent) => this.node(key, slot, parent),
      world: this.group, view: this.viewGroup,
    }, seen);
    drawBatSplashes({ node: (key, slot, parent) => this.node(key, slot, parent),
                      world: this.group }, seen);
    // The marker a civilian's extra life raises: `render/life_markers.ts`.
    drawLifeMarkers({ node: (key, slot, parent) => this.node(key, slot, parent),
                      view: this.viewGroup }, seen);
    // The result card's glyphs, and anything else drawn under
    // `MatrixLoadIdentity` by slot: `render/view_slots.ts`.
    drawViewSlots({ node: (key, slot, parent) => this.node(key, slot, parent),
                    view: this.viewGroup, world: this.group }, seen);
    // ...and the ones drawn in the world under a matrix: the trunk.
    drawWorldSlots({ node: (key, slot, parent) => this.node(key, slot, parent),
                     view: this.viewGroup, world: this.group }, seen);
    if (this.bones) {
      const bones = this.bones;
      this._view.copy(ctx.camera.matrixWorldInverse);
      drawBoss3Effects({
        node: (key, slot, parent) => this.node(key, slot, parent),
        world: this.group, view: this.viewGroup, viewMatrix: this._view,
        boneSphere: (at, bone, out) => bones.boneSphere(at, bone, out),
        boneMatrix: (at, bone, out) => {
          if (!bones.boneMatrix?.(at, bone, this._elems)) return false;
          out.fromArray(this._elems);
          return true;
        },
      }, seen);
    }

    for (const [key, l] of this.nodes) {
      if (seen.has(key)) continue;
      l.node.removeFromParent();
      disposeOwned(l.node);
      this.nodes.delete(key);
    }
  }

  resync(ctx: RenderContext): void {
    this.claimSession(ctx);
    this.update(ctx);
  }

  /**
   * A node for `key` at `slot`, re-cloned when the slot moves on.
   *
   * `parent` decides which space it is in, which is the whole difference
   * between the tracer and the muzzle flash.
   */
  private node(key: string, slot: number, parent: Group): Object3D | null {
    const live = this.nodes.get(key);
    if (live && live.slot === slot && live.node.parent === parent) {
      return live.node;
    }
    live?.node.removeFromParent();
    if (live) disposeOwned(live.node);
    const node = this.clone(slot);
    if (!node) { this.nodes.delete(key); return null; }
    parent.add(node);
    this.nodes.set(key, { node, slot });
    return node;
  }

  /**
   * The boss-name banner's eight cards, `BossIntroBannerUpdate`
   * (`FUN_00437AC0`)'s draw loop:
   *
   * ```
   * CurlModelSlot3F7ByYaw(yaw); MatrixStackPush(0); MatrixLoadIdentity()
   * MatrixTranslate(x, y, z); MatrixRotateY(yaw); MatrixScale(s, s, s)
   * AssetDrawSlot(slot); MatrixStackPop(1)
   * ```
   *
   * Identity, so camera space, like the damage overlay. Only in the two steps
   * that draw -- the slide and the hold -- and straight from the banner's own
   * state, so a snapshot mid-flight draws what it says.
   */
  private drawBossBanners(seen: Set<string>): void {
    G.g_boss_banners.forEach((b, n) => {
      if (b.step !== BannerStep.Slide && b.step !== BannerStep.Hold) return;
      b.cards.forEach((c, i) => {
        const key = `bb${n}_${i}`;
        const node = this.node(key, b.slots[i], this.viewGroup);
        if (!node) return;
        seen.add(key);
        node.position.set(c.x, c.y, c.z);
        node.rotation.set(0, c.yaw * BAMS_TO_RAD, 0);
        node.scale.setScalar(c.scale);
      });
    });
  }

  /**
   * `SpriteEffectDrawAndTick` (`FUN_00407A70`): translate, then Y, then X,
   * then Z, then scale — which is Euler order YXZ for a column vector.
   */
  private drawSpriteEffects(seen: Set<string>): void {
    for (const e of G.g_sprite_effects) {
      const key = `s${e.id}`;
      const node = this.node(key, e.slot, this.group);
      if (!node) continue;
      seen.add(key);
      node.position.set(e.pos.x, e.pos.y, e.pos.z);
      node.rotation.set(e.pitch * BAMS_TO_RAD, e.yaw * BAMS_TO_RAD,
                        e.roll * BAMS_TO_RAD, "YXZ");
      node.scale.set(e.scale.x, e.scale.y, e.scale.z);
    }
  }

  /**
   * `DrawBloodSpray` (`FUN_00407230`), which is the one effect whose position
   * is not in its own record.
   *
   * The centre is the hit bone's sphere; the draw adds the sphere's radius to
   * the **camera-space** `z`, which pulls it toward the viewer onto the face
   * of the limb. Working in the camera's space is therefore not a convenience
   * here, it is what the routine does.
   */
  private drawBlood(ctx: RenderContext, seen: Set<string>): void {
    if (!G.g_blood_sprays.length) return;
    this._m.copy(ctx.camera.matrixWorldInverse);
    for (const b of G.g_blood_sprays) {
      const r = this.bones?.boneSphere(b.at, b.bone, this._c);
      if (r == null) continue;
      // `MatrixLoadIdentity` then `MatrixTranslate(x, y, z + radius)`: the
      // sprite is placed in the camera's own space and carries no rotation at
      // all, so it hangs off the same group the muzzle flash does.
      this._v.copy(this._c).applyMatrix4(this._m);
      const z = this._v.z + r;
      const depth = z < BLOOD_DEPTH_FAR
        ? 1.0 : z * BLOOD_DEPTH_RATE + BLOOD_DEPTH_BASE;
      const key = `b${b.id}`;
      const node = this.node(key, BLOOD_FIRST_SLOT + b.cel, this.viewGroup);
      if (!node) continue;
      seen.add(key);
      node.position.set(this._v.x, this._v.y, z);
      node.quaternion.identity();
      node.scale.setScalar(depth * BLOOD_SCALE * b.severity);
    }
  }

  /**
   * `BloodSprayAtPointDrawAndTick` (`FUN_00430BD0`) — the same flipbook at a
   * fixed point rather than on a bone.
   *
   * The point is in camera space, so it hangs off the same group as the
   * bone-stuck spray; the scale is the routine's own literal and not the
   * depth law, which this one does not have.
   */
  private drawPointBlood(seen: Set<string>): void {
    for (const b of G.g_point_blood_sprays) {
      const key = `pb${b.id}`;
      const node = this.node(key, b.slot, this.viewGroup);
      if (!node) continue;
      seen.add(key);
      node.position.set(b.pos.x, b.pos.y, b.pos.z);
      node.quaternion.identity();
      // `g_wCaptionMode` (0x009C911E) halves it in the captioned build and
      // the port carries no such global — the same gap
      // {@link BLOOD_SCALE_CAPTIONED} sits in beside the bone spray, and the
      // uncaptioned value is the one every shipped configuration here uses.
      node.scale.setScalar(POINT_BLOOD_SCALE);
    }
  }

  /**
   * `BodyCreatureUpdate` (`FUN_0043E880`)'s draw, which is the whole of what
   * the renderer owes it:
   *
   * ```
   * MatrixStackPush(0); MatrixLoadIdentity()
   * MatrixTranslate(obj+0x40, obj+0x44, obj+0x48)
   * MatrixRotateX(obj+0x64)
   * AssetDrawSlot(obj+0x1330 % 0x28 + 0x1D31)
   * MatrixStackPop(1)
   * ```
   *
   * Identity, a translation and **one** rotation — no yaw and no roll, which
   * is why a creature flying at the eye never turns to face it. The position
   * is already in camera space (see `game/body_creature.ts`), so this is the
   * view group without a transform of its own.
   */
  private drawBodyCreatures(seen: Set<string>): void {
    for (const c of G.g_body_creatures) {
      const key = `bc${c.id}`;
      const node = this.node(key, c.slot, this.viewGroup);
      if (!node) continue;
      seen.add(key);
      node.position.set(c.pos.x, c.pos.y, c.pos.z);
      node.rotation.set(c.pitch * BAMS_TO_RAD, 0, 0);
      node.scale.setScalar(1);
    }
  }

  /**
   * `ShotTestSphere` (`FUN_00404630`) for the creatures — the sphere at
   * `obj+0x70..0x78`, which for this object is its own position, with radius
   * `obj+0x124`.
   *
   * The ray is in world space and the creature is in the camera's, so the
   * centre goes out through the view group's matrix rather than the other way
   * round: this layer already holds that matrix, which is the reason the test
   * is here and not in `render/characters.ts` beside the bone spheres.
   *
   * `t` is the along-ray parameter, the same number `CharacterLayer.pickShot`
   * sorts on, so a creature in front of a zombie takes the bullet.
   */
  pickCreature(ray: Ray):
      { id: number; t: number; point: Vector3; radius: number } | null {
    let best: { id: number; t: number; point: Vector3; radius: number }
      | null = null;
    for (const c of G.g_body_creatures) {
      this._c.set(c.pos.x, c.pos.y, c.pos.z)
        .applyMatrix4(this.viewGroup.matrix);
      ray.closestPointToPoint(this._c, this._v);
      const t = this._v.sub(ray.origin).dot(ray.direction);
      if (t <= 0) continue;
      if (ray.distanceSqToPoint(this._c) > c.radius * c.radius) continue;
      if (!best || t < best.t) {
        best = { id: c.id, t, point: this._c.clone(), radius: c.radius };
      }
    }
    return best;
  }

  /**
   * The carried props' draw — `AssetDrawSlot(sub+0x0C)` under whatever matrix
   * the routine built, which `game/carried_prop.ts` hands over whole. Every
   * one of those routines draws a **modelview**: the held one from
   * `MatrixLoadIdentity` and the bones' view-space records, the flight under
   * `g_camera_world_to_view`, the stuck one from `MatrixLoadIdentity` again.
   * So the node hangs off the view group with the engine's matrix as its
   * local transform, and the element layouts agree (see `game/matrix.ts`).
   */
  private drawCarriedProps(seen: Set<string>): void {
    for (const c of G.g_carried_props) {
      // The break effect: one node per part, each already a world matrix --
      // `CarriedPropBreakUpdate` draws on the world-to-view top, so the
      // modelview it builds is `view . part` and the part is the world one.
      c.parts.forEach((part, i) => {
        const key = `cp${c.id}p${i}`;
        const node = this.node(key, part.slot, this.group);
        if (!node) return;
        seen.add(key);
        node.matrixAutoUpdate = false;
        node.matrix.fromArray(part.m);
        node.matrixWorldNeedsUpdate = true;
        node.renderOrder = 0;
      });
      if (!c.draw || !c.slot) continue;
      const key = `cp${c.id}`;
      const node = this.node(key, c.slot,
                             c.draw.view ? this.viewGroup : this.group);
      if (!node) continue;
      seen.add(key);
      node.matrixAutoUpdate = false;
      node.matrix.fromArray(c.draw.m);
      node.matrixWorldNeedsUpdate = true;
      // A prop is scenery, not a click effect: draw it in the world's order.
      node.renderOrder = 0;
    }
  }

  /**
   * The stage-4 boss's two draws besides his skeleton, each a world matrix
   * `game/class19/` built on a bone's: the props he carries in until he
   * throws them (`Boss4AdvanceMotionAndDrawHeldProps`, `FUN_00492620`,
   * `AssetDrawSlot(0x396)` per prop) and the marks his flesh hits leave
   * (`Boss4DrawAndAgeBoneHitMark`, `FUN_00492210`, `AssetDrawSlot(0x3CD)`).
   */
  private drawBoss4Extras(seen: Set<string>): void {
    const place = (key: string, slot: number, m: number[]): void => {
      const node = this.node(key, slot, this.group);
      if (!node) return;
      seen.add(key);
      node.matrixAutoUpdate = false;
      node.matrix.fromArray(m);
      node.matrixWorldNeedsUpdate = true;
      node.renderOrder = 0;
    };
    for (const a of G.g_object_list) {
      const b = a.boss4;
      if (!b || a.despawned || !a.visible) continue;
      b.propDraws.forEach((d, i) => place(`b4p${a.at}_${i}`, d.slot, d.m));
    }
    for (const m of G.g_boss4_hit_marks) {
      if (m.draw) place(`b4m${m.id}`, BOSS4_HIT_MARK_DRAW_SLOT, m.draw);
    }
  }

  /**
   * `ShotTestSphere` (`FUN_00404630`) for the carried props: the sphere at
   * `obj+0x70..0x78` — view space, so out through the view group's matrix —
   * with radius `obj+0x124`, for every prop `RegisterForShotTest` took this
   * frame.
   */
  pickCarried(ray: Ray):
      { id: number; t: number; point: Vector3; radius: number } | null {
    let best: { id: number; t: number; point: Vector3; radius: number }
      | null = null;
    for (const c of G.g_carried_props) {
      if (!c.shootable) continue;
      this._c.set(c.shotPoint.x, c.shotPoint.y, c.shotPoint.z)
        .applyMatrix4(this.viewGroup.matrix);
      ray.closestPointToPoint(this._c, this._v);
      const t = this._v.sub(ray.origin).dot(ray.direction);
      if (t <= 0) continue;
      if (ray.distanceSqToPoint(this._c) > c.radius * c.radius) continue;
      if (!best || t < best.t) {
        best = { id: c.id, t, point: this._c.clone(), radius: c.radius };
      }
    }
    return best;
  }

  /** The three per-shot rings — `PlayerShotEffectsThink` (`FUN_00416B00`). */
  private drawShotRings(ctx: RenderContext, seen: Set<string>): void {
    ctx.camera.matrixWorld.decompose(this._cp, this._cq, this._cs);
    for (let i = 0; i < SHOT_EFFECT_RING * 2; i++) {
      const f = G.g_shot_flash_ring[i];
      if (this.muzzle && f?.live && f.kind !== OriginalWeaponKind.Grenade) {
        const base = MUZZLE_FLASH_SLOTS[f.player] ?? MUZZLE_FLASH_SLOTS[0];
        const key = `f${i}`;
        const node = this.node(key, base + f.frame, this.viewGroup);
        if (node) {
          seen.add(key);
          node.position.set(f.pos.x, f.pos.y, f.pos.z);
          node.rotation.set(f.pitch * BAMS_TO_RAD, f.yaw * BAMS_TO_RAD, 0,
                            "YXZ");
          node.scale.setScalar(FLASH_SCALE);
        }
        // The second draw, from the other table and at its own scale. A
        // separate node because it is a separate `AssetDrawSlot` under the
        // same transform.
        const smoke = MUZZLE_SMOKE_SLOTS[f.player] ?? MUZZLE_SMOKE_SLOTS[0];
        const key2 = `fs${i}`;
        const n2 = this.node(key2, smoke + f.frame, this.viewGroup);
        if (n2) {
          seen.add(key2);
          n2.position.set(f.pos.x, f.pos.y, f.pos.z);
          n2.rotation.set(f.pitch * BAMS_TO_RAD, f.yaw * BAMS_TO_RAD, 0,
                          "YXZ");
          n2.scale.setScalar(f.kind === OriginalWeaponKind.BulletBlow
            ? FLASH_SMOKE_SCALE_KIND4 : FLASH_SMOKE_SCALE);
        }
      }

      // Both of the tracer's arms `MatrixTranslate` onto the record and then
      // call `MatrixClearRotation` (`FUN_004A9F70`), which writes the top
      // 3x3 to the identity -- the view's rotation with it -- so what follows
      // is turned in the camera's axes, not the world's: a node here takes
      // the camera's own world rotation first. This set `rotation (0, 0,
      // spin)` in world axes, a quad facing world +Z wherever the camera
      // looked.
      const t = G.g_shot_tracer_ring[i];
      if (t?.live && t.kind !== OriginalWeaponKind.BassLure) {
        const smoke = MUZZLE_SMOKE_SLOTS[t.player] ?? MUZZLE_SMOKE_SLOTS[0];
        const key = `t${i}`;
        const node = this.node(key, smoke + TRACER_SLOT_OFFSET, this.group);
        if (node) {
          seen.add(key);
          node.position.set(t.pos.x, t.pos.y, t.pos.z);
          // ...and then the roll spins it in place.
          this._e.set(0, 0, t.spin * BAMS_TO_RAD, "ZYX");
          node.quaternion.copy(this._cq)
            .multiply(this._rq.setFromEuler(this._e));
          node.scale.setScalar(1);
        }
      } else if (t?.live) {
        // Kind 5 -- Original Mode's slow round, and the only thing in the exe
        // that draws slot 0x109D: `Translate(record) · Translate(op_ 0x194 at
        // frame % 24) · MatrixClearRotation · RotZ · RotY · RotX` of that
        // pose (`0x00416D2B`..`0x00416DA6`). It was the rig `obj_416b00`,
        // drawn from stage load at the path's own pose -- in front of
        // Goldman's desk -- and skipped here.
        const path = ctx.paths?.objectPaths.get(TRACER_WEAPON5_PATH);
        const key = `t${i}`;
        const node = path ? this.node(key, TRACER_WEAPON5_SLOT, this.group)
          : null;
        if (path && node) {
          seen.add(key);
          const at = t.frame % TRACER_WEAPON5_LOOP;
          path.position(at, this._c);
          node.position.set(t.pos.x + this._c.x, t.pos.y + this._c.y,
                            t.pos.z + this._c.z);
          // `CamEvalObjectPath6` (`FUN_004042D0`) `__ftol`s the three angles
          // (L2), and they go on as `RotZ(rz); RotY(ry); RotX(rx)`.
          this._e.set(Math.trunc(path.channel(3, at)) * BAMS_TO_RAD,
                      Math.trunc(path.channel(4, at)) * BAMS_TO_RAD,
                      Math.trunc(path.channel(5, at)) * BAMS_TO_RAD, "ZYX");
          node.quaternion.copy(this._cq)
            .multiply(this._rq.setFromEuler(this._e));
          node.scale.setScalar(1);
        }
      }

      const w = G.g_shot_weapon_ring[i];
      if (this.muzzle && w?.live && w.kind === OriginalWeaponKind.BulletBlow) {
        const key = `w${i}`;
        const node = this.node(key, WEAPON_FIRST_SLOT + w.frame,
                               this.viewGroup);
        if (node) {
          seen.add(key);
          node.position.set(w.pos.x, w.pos.y, w.pos.z);
          node.rotation.set(w.pitch * BAMS_TO_RAD, w.yaw * BAMS_TO_RAD,
                            w.roll * BAMS_TO_RAD, "YXZ");
          node.scale.setScalar(WEAPON_SCALE);
        }
      }
    }
  }

  /**
   * The draw half of `DamageOverlayUpdateAndDraw` (`FUN_00417300`):
   *
   * ```
   * SetDrawLayerNibble(0xA); MatrixStackPush(0); MatrixLoadIdentity()
   * MatrixTranslate(offsets[kind].x + rec.x, offsets[kind].y, -1.02)
   * MatrixScale(scales[kind], scales[kind], scales[kind])
   * AssetDrawSlot(slots[kind][count - 1]); MatrixStackPop(1)
   * ```
   *
   * Identity, so camera space: the view group, with no rotation of its own.
   * Drawn for exactly as long as the record is active, from the record alone,
   * so a seek or a load shows whatever the restored state says and nothing a
   * frame from the old timeline left behind.
   *
   * **No alpha of its own, and none added here** `[proved]`. It is
   * `AssetDrawSlot` (`FUN_00418560`), not `AssetDrawSlotWithAlpha`, so the
   * node keeps the template's material untouched -- the translucent pass
   * `applyPvr2DrawState` gave it from TSP `0x9400041B` (`SRCALPHA /
   * INVSRCALPHA`, alpha test at 1) and the base alpha 1 -- and what blends is
   * the texture's own alpha: 255 over the body of each mark, 0 around it. A
   * fade or a forced opacity here would be a claim the exe does not make; see
   * `game/effects/damage_overlay.ts` and `tools/hurt_alpha.mjs`.
   *
   * **Drawn before the shot effects, not after** `[proved]`. Every
   * translucent draw is queued by `RenderEnqueueCommand` (`FUN_004A7E50`)
   * with the current `SetDrawLayerNibble` value OR'd into the low nibble of
   * its key, and `RenderFlushCommandList` (`FUN_004A88E0`) sorts the queue
   * with `RenderCommandCompare`: **layer ascending**, then depth descending,
   * then draws in that order. So the overlay's layer 0xA goes down after the
   * scene's translucent layer 8 and before the muzzle flash and tracer (0xC,
   * `PlayerShotEffectsThink`) and the sprite effects (0xE,
   * `SpriteEffectDrawAndTick`), which blend over it. Every effect here is at
   * `renderOrder` 900 and the world at 0, and three.js sorts transparent
   * objects by `renderOrder` first, so 899 is exactly the exe's slot.
   * Translucent meshes write depth (see `draw_order.ts`), so within a layer
   * `RenderCommandOrder` decides which of two overlapping ones survives.
   *
   * **Only while a task that draws it is the player's.** The draw is inside
   * `DamageOverlayUpdateAndDraw`, which only `PlayerUpdateInPlay` and
   * `PlayerContinueCountdown` call `[proved]`. A player the last hit put out
   * of play goes to state 6 with the record still active -- nothing clears
   * it until the next `PlayerEnterPlay` -- and the game-over screen showed
   * the splat frozen over its whole length until this test was added.
   */
  private drawDamageOverlays(seen: Set<string>): void {
    G.g_damage_overlays.forEach((o, p) => {
      if (!o.active) return;
      const task = G.g_player_task[p];
      if (task !== PlayerTask.InPlay
          && task !== PlayerTask.ContinueCountdown) return;
      const slot = DAMAGE_OVERLAY_SLOTS[o.kind]?.[o.count - 1];
      if (slot === undefined) return;
      const key = `do${p}`;
      const node = this.node(key, slot, this.viewGroup);
      if (!node) return;
      seen.add(key);
      const off = DAMAGE_OVERLAY_OFFSETS[o.kind] ?? [0, 0];
      node.position.set(off[0] + o.x, off[1], DAMAGE_OVERLAY_Z);
      node.quaternion.identity();
      node.scale.setScalar(DAMAGE_OVERLAY_SCALES[o.kind] ?? 0);
      // Layer 0xA: after the world's translucent layer 8, before 0xC/0xE.
      node.renderOrder = 899;
    });
  }

  /**
   * What the panel says, and why it says the pool counts too.
   *
   * A layer that draws nothing has three possible reasons and they need
   * different fixes: the bundle has no `slots_effect` rig (re-export), the
   * port has spawned nothing (the effect is not wired), or records exist and
   * no node came back (a slot outside the exported set). One line, all three.
   */
  get describe(): string {
    if (!this.templates.size) return "no effect models in this bundle";
    const flash = this.muzzle
      ? G.g_shot_flash_ring.filter((f) => f.live).length : 0;
    const tracer = G.g_shot_tracer_ring.filter((t) => t.live).length;
    return `${this.nodes.size} drawn · blood ${G.g_blood_sprays.length}`
      + `, sprites ${G.g_sprite_effects.length}, flash ${flash}`
      + `, tracer ${tracer}`
      + `, hurt ${G.g_damage_overlays.filter((o) => o.active).length}`
      + ` · ${this.templates.size} templates`;
  }
}

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
import { Group, Matrix4, Object3D, Ray, Vector3 } from "three";
import { BAMS_TO_RAD } from "../core/bams";
import { G } from "../game/globals";
import {
  BLOOD_DEPTH_BASE, BLOOD_DEPTH_FAR, BLOOD_DEPTH_RATE, BLOOD_FIRST_SLOT,
  BLOOD_SCALE,
} from "../game/effects/blood";
import {
  FLASH_SCALE, FLASH_SMOKE_SCALE, FLASH_SMOKE_SCALE_KIND4,
  OriginalWeaponKind, SHOT_EFFECT_RING, TRACER_SLOT_OFFSET, WEAPON_FIRST_SLOT,
  WEAPON_SCALE,
} from "../game/effects/shot_effects";
import { POINT_BLOOD_SCALE } from "../game/effects/blood";
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
  pickCreature(ray: Ray): { id: number; t: number; point: Vector3 } | null;
}

export interface BoneSphereSource {
  /**
   * The world centre and radius of one bone's hit sphere — `obj + bone * 0x90
   * + 0x274` and `+0x284`, which `ShotTestBoneSphere` (`FUN_004047D0`) tests
   * and `DrawBloodSpray` draws at. Returns the radius, or null.
   */
  boneSphere(at: number, bone: number, out: Vector3): number | null;
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
  private muzzle = false;
  private readonly templates = new Map<number, Object3D>();
  private readonly nodes = new Map<string, Live>();
  private enabled = true;
  private readonly _c = new Vector3();
  private readonly _v = new Vector3();
  private readonly _m = new Matrix4();

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
      for (const l of this.nodes.values()) l.node.removeFromParent();
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
    this.drawBlood(ctx, seen);
    this.drawPointBlood(seen);
    this.drawBodyCreatures(seen);
    this.drawShotRings(seen);

    for (const [key, l] of this.nodes) {
      if (seen.has(key)) continue;
      l.node.removeFromParent();
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
    const node = this.clone(slot);
    if (!node) { this.nodes.delete(key); return null; }
    parent.add(node);
    this.nodes.set(key, { node, slot });
    return node;
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
  pickCreature(ray: Ray): { id: number; t: number; point: Vector3 } | null {
    let best: { id: number; t: number; point: Vector3 } | null = null;
    for (const c of G.g_body_creatures) {
      this._c.set(c.pos.x, c.pos.y, c.pos.z)
        .applyMatrix4(this.viewGroup.matrix);
      ray.closestPointToPoint(this._c, this._v);
      const t = this._v.sub(ray.origin).dot(ray.direction);
      if (t <= 0) continue;
      if (ray.distanceSqToPoint(this._c) > c.radius * c.radius) continue;
      if (!best || t < best.t) {
        best = { id: c.id, t, point: this._c.clone() };
      }
    }
    return best;
  }

  /** The three per-shot rings — `PlayerShotEffectsThink` (`FUN_00416B00`). */
  private drawShotRings(seen: Set<string>): void {
    for (let i = 0; i < SHOT_EFFECT_RING * 2; i++) {
      const f = G.g_shot_flash_ring[i];
      if (this.muzzle && f?.live && f.kind !== OriginalWeaponKind.Silent) {
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
          n2.scale.setScalar(f.kind === OriginalWeaponKind.Heavy
            ? FLASH_SMOKE_SCALE_KIND4 : FLASH_SMOKE_SCALE);
        }
      }

      const t = G.g_shot_tracer_ring[i];
      if (t?.live && t.kind !== OriginalWeaponKind.Slow) {
        const smoke = MUZZLE_SMOKE_SLOTS[t.player] ?? MUZZLE_SMOKE_SLOTS[0];
        const key = `t${i}`;
        const node = this.node(key, smoke + TRACER_SLOT_OFFSET, this.group);
        if (node) {
          seen.add(key);
          node.position.set(t.pos.x, t.pos.y, t.pos.z);
          // `MatrixClearRotation` (`FUN_004A9F70`) wipes the top 3x3, which is
          // a screen-axis billboard, and then the roll spins it in place.
          node.rotation.set(0, 0, t.spin * BAMS_TO_RAD);
          node.scale.setScalar(1);
        }
      }

      const w = G.g_shot_weapon_ring[i];
      if (this.muzzle && w?.live && w.kind === OriginalWeaponKind.Heavy) {
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
      + `, tracer ${tracer} · ${this.templates.size} templates`;
  }
}

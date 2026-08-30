/**
 * Spawned characters: assembled from the EXE skeleton, posed from `mot/`.
 *
 * The exporter has already done the hard half. A skeleton is a tree of named
 * parts, each with a bone offset and an asset slot, which is exactly a rig —
 * so `hod2lib.characters` puts one through the ordinary rig writer at every
 * spawn descriptor of its class, and the glTF arrives with a full node
 * hierarchy per character, positioned and yawed. What is left for the client
 * is the part that cannot be baked: the pose.
 *
 * ## Why a bind pose is not enough
 *
 * Every bone offset runs along its own local X, so a character with zero
 * rotations is not standing still — it is a heap of parts piled on the origin.
 * A character has to be posed from a motion frame to look like anything, which
 * is why an unposed character keeps its spawn marker instead of being drawn.
 *
 * ## The transform, from `FUN_00410590`
 *
 * ```c
 * MatrixTranslate(obj.pos);          // the spawn descriptor
 * Scale(obj.scale);
 * RotX; RotY; RotZ                   // object orientation, order per obj+0x1FC
 * MatrixTranslate(frame.root);       // <- motion root translation
 * RotZ(bone0.rz); RotY(bone0.ry); RotX(bone0.rx);
 * for (node in skeleton) FUN_004107E0(node);   // each bone, recursively
 * ```
 *
 * The first three lines are baked into the instance root by the exporter. The
 * middle two are *between* the object transform and the bones, which is why
 * this inserts a group of its own rather than writing onto the instance root:
 * the motion root translation is expressed in the object's rotated frame, so
 * putting it on the root would apply it in world space and slide every
 * character sideways.
 *
 * Bone rotations are applied `RotZ; RotY; RotX` on a column-vector stack, so
 * the composite is `qZ * qY * qX` — the same convention `_bams_euler_to_quat`
 * uses in the exporter and `rigs.ts` uses for object rigs. It is written out
 * as three axis-angle quaternions here rather than as an Euler order, because
 * the equivalence is easy to get wrong and the multiplication is not.
 *
 * ## Playback
 *
 * `mot/` frames are authored at 30 Hz against the engine's 60 Hz clock (see
 * the `g_motion_play_length` note in `docs/formats/mot.md`), so the bundle
 * states the rate rather than baking it in. Motions loop: which motion an
 * actor plays next is its class's state machine — 54 states for the zombie
 * alone — and the player is told a starting motion by the exporter rather than
 * trying to derive that.
 */

import { Group, Mesh, Object3D, Quaternion, Ray, Vector3 } from "three";
import type {
  BakedMotion, CharacterPlacement, CharactersJson, CharacterType,
} from "./bundle";
import type { ActiveSpawn } from "./walker";
import type { EnemyActor } from "./enemies";

const BAMS_TO_RAD = (Math.PI * 2) / 65536;

/** The engine's frame clock. Motion clips are authored at half of it. */
const GAME_HZ = 60;

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

/**
 * The exporter names a bone's node `chr_<name>_spawn###_<part>`, where *part*
 * is `bone<NN>_<slot>`. Matching on that **suffix** matters: a glTF node whose
 * mesh has several primitives is loaded as a group with child meshes named
 * `<node name>_0`, `_1`, …, and those would match a looser pattern. Rotating a
 * primitive instead of its bone leaves the bone at bind and spins the piece
 * about the joint — which is exactly what "the parts are detached" looks like.
 */
const boneSuffix = (part: string) => `_${part}`;

/**
 * How long one cycle of an actor's walk takes — a "step" in the ring model.
 * `ZombieStateApproach` counts steps, and a step is one pass of the looping
 * motion, so the clip's own length is the answer.
 */
function stepSecondsOf(type: CharacterType, motion: number): number {
  const m = type.motions[String(motion)];
  return m && m.fps > 0 ? m.frames / m.fps : 1;
}

interface Instance {
  /** evt offset of the spawn descriptor — the identity the walker uses. */
  at: number;
  type: CharacterType;
  motion: number;
  root: Object3D;
  /** The node carrying the motion root translation and bone 0's rotation. */
  pivot: Group;
  /** Bone index (as the skeleton numbers them) to its node. */
  bones: Map<number, Object3D>;
  /** Seconds since this instance started playing, so they do not lock step. */
  clock: number;
  /** `obj+0x11C`. Reaching 0 kills; see docs/formats/combat.md. */
  hp: number;
  /** `obj+0x298 + bone*0x90` — hits already taken on each bone. */
  hits: Map<number, number>;
  /**
   * `rec+0x74 & 0x80000000` — the "this bone has reached its last stage"
   * latch. Once set, further hits on that bone still cost hit points but
   * never swap a model or advance the step.
   */
  latched: Set<number>;
  /**
   * Bones `RemoveBoneSubtree` has zeroed. A zero draw slot is invisible *and*
   * unshootable — `ShotTestBoneTree` tests `rec[0] != 0` before descending —
   * so this gates the pick as well as the display.
   */
  removed: Set<number>;
  dead: boolean;
  /** The actor's own BAMS yaw, for the directional death. */
  yaw: number;
  /**
   * The view the enemy director owns: position and facing live here so the AI
   * can move the actor without reaching into three.js nodes.
   */
  actor: EnemyActor;
  /** `obj+0x1318 & 7` — 1 head gone, 2 right arm, 4 left arm. */
  zones: number;
  /**
   * The death clip, once chosen. It plays **once and holds its last frame** —
   * `FUN_00454D20` waits for the clip to finish and then hands the body to
   * `FUN_00456740`, which is not read, so the corpse stays put rather than
   * doing something invented.
   */
  death: { motion: number; t: number } | null;
  /**
   * The stumble — `ActorPlayHitReaction`'s one-shot on the actor's **second**
   * motion track, while the walk keeps running on the first. `hard` is the
   * bone >= 9 case, which `ActorSetMotion` snaps in with no cross-fade.
   */
  react: { motion: number; t: number; blend: number; hard: boolean } | null;
  /** Damaged parts currently swapped in, so a second hit can replace them. */
  gore: Map<number, Object3D>;
  /**
   * A one-shot entrance played before the loop: state 21 of class 0x30's
   * state machine sets a motion, holds for a delay, plays it to the end and
   * only then falls through to the ordinary walk.
   */
  intro: { motion: number; delay: number } | null;
}

export class CharacterLayer {
  private instances: Instance[] = [];
  private json: CharactersJson | null = null;
  private enabled = true;
  private readonly q = new Quaternion();
  private readonly qa = new Quaternion();
  private readonly _c = new Vector3();
  private readonly _p = new Vector3();
  /** Asset slot → the template node for that damaged part. */
  private readonly goreParts = new Map<number, Object3D>();

  /** Spawn offsets that have a real character, so the marker layer can skip them. */
  readonly posed = new Set<number>();

  /**
   * Adopt every character hierarchy the stage's glTF carries.
   *
   * The exporter emits one instance per spawn descriptor, so this is a
   * traversal rather than a clone: the geometry is already in the scene at the
   * right place, and all that is missing is the pose.
   */
  attach(root: Object3D, json: CharactersJson | undefined): void {
    this.detach();
    this.json = json ?? null;
    if (!json) return;

    const motionOf = new Map<number, number>();
    const typeOf = new Map<number, number>();
    const placeOf = new Map<number, CharacterPlacement>();
    for (const p of json.placements) {
      if (p.motion === null || p.motion === undefined) continue;
      motionOf.set(p.at, p.motion);
      typeOf.set(p.at, p.char_type);
      placeOf.set(p.at, p);
    }

    // The hidden per-type templates holding the damaged parts. One copy each;
    // a swap clones from here, which shares geometry and material in three.js.
    root.traverse((o) => {
      const x = o.userData as { hod2_kind?: string; hod2_rig?: string };
      if (x?.hod2_kind !== "rig_part") return;
      const rig = x.hod2_rig ?? "";
      if (!rig.startsWith("gore_")) return;
      const m = /_gore_([0-9a-f]{4})$/.exec(o.name);
      if (m) {
        this.goreParts.set(Number.parseInt(m[1], 16), o);
        o.visible = false;
      }
    });

    const roots: Object3D[] = [];
    root.traverse((o) => {
      const x = o.userData as {
        hod2_kind?: string; hod2_rig?: string; hod2_spawn_at?: number;
      };
      if (x?.hod2_kind === "rig" && x.hod2_rig?.startsWith("chr_")
          && x.hod2_spawn_at !== undefined) {
        roots.push(o);
      }
    });

    for (const node of roots) {
      const at = (node.userData as { hod2_spawn_at: number }).hod2_spawn_at;
      const motion = motionOf.get(at);
      const ct = typeOf.get(at);
      if (motion === undefined || ct === undefined) continue;
      const type = json.types[String(ct)];
      if (!type || !type.motions[String(motion)]) continue;
      const p = placeOf.get(at);

      // The motion root translation and bone 0's rotation sit between the
      // object transform and the bones -- see the note above.
      const pivot = new Group();
      pivot.name = `${node.name}_motion`;
      for (const child of [...node.children]) pivot.add(child);
      node.add(pivot);

      // Index by the skeleton's own bone numbers, from the exporter's list,
      // rather than by anything parsed out of the scene graph.
      const bones = new Map<number, Object3D>();
      pivot.traverse((o) => {
        for (const b of type.bones) {
          if (bones.has(b.bone)) continue;
          if (o.name.endsWith(boneSuffix(b.part))) {
            bones.set(b.bone, o);
            break;
          }
        }
      });
      if (bones.size !== type.bones.length) {
        // A partial skeleton would pose some joints and leave others at bind,
        // which reads as a broken model rather than a missing feature.
        console.warn(`character ${type.name} at ${at}: matched ` +
                     `${bones.size} of ${type.bones.length} bones`);
        continue;
      }

      const intro = p?.intro && type.motions[String(p.intro.motion)]
        ? p.intro : null;
      this.instances.push({ at, type, motion, root: node, pivot, bones,
                            clock: 0, intro, hp: this.startHp(p),
                            latched: new Set<number>(),
                            removed: new Set<number>(),
                            hits: new Map(), dead: false, yaw: p?.yaw ?? 0,
                            death: null, react: null, gore: new Map(),
                            actor: {
                              at, charType: type.type,
                              ringSet: p?.ring_set ?? 0,
                              attackState: p?.attack_state ?? 0,
                              pos: node.position.clone(),
                              yaw: p?.yaw ?? 0,
                              dead: false, visible: false,
                              stepSeconds: stepSecondsOf(type, motion),
                              zones: 0, action: null, type,
                              condition: p?.body_condition ?? 0,
                              cls: p?.class ?? 0,
                            }, zones: 0 });
      this.posed.add(at);
      node.visible = false;
    }
  }

  detach(): void {
    // The nodes belong to the stage scene, which is disposed wholesale on a
    // stage change, so this only drops our references.
    this.instances = [];
    this.posed.clear();
    this.json = null;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) for (const i of this.instances) i.root.visible = false;
  }

  /**
   * Pose every character whose spawn is currently placed.
   *
   * `dt` is seconds; `live` is the walker's spawn list, which is what decides
   * whether a character is in the level at all — the same rule the markers
   * follow, so the two can never disagree about who is present.
   */
  update(live: readonly ActiveSpawn[], dt: number): void {
    if (!this.instances.length) return;
    const present = new Set<number>();
    for (const s of live) present.add(s.at);

    for (const inst of this.instances) {
      // A corpse stays: `FUN_00454D20` plays the clip out before handing the
      // body on, so removing it the instant HP hits zero would be wrong.
      const show = this.enabled && present.has(inst.at);
      inst.root.visible = show;
      inst.actor.visible = show;
      inst.actor.dead = inst.dead;
      if (!show) continue;
      // The director owns position and facing; apply what it decided. The
      // exporter baked the spawn pose into the root, and this replaces it
      // with the live one rather than composing onto it.
      inst.root.position.copy(inst.actor.pos);
      inst.root.rotation.set(0, inst.actor.yaw * BAMS_TO_RAD, 0);
      inst.yaw = inst.actor.yaw;
      if (inst.death) inst.death.t += dt;
      else {
        inst.clock += dt;
        // The reaction runs on its own track; the loop underneath keeps going,
        // which is what makes the cross-fade back land in the right place.
        if (inst.react) inst.react.t += dt;
        if (inst.actor.action) inst.actor.action.t += dt;
      }
      this.pose(inst);
    }
  }

  private pose(inst: Instance): void {
    // Dying takes over everything: the clip plays once and holds its last
    // frame, because what happens after it is `FUN_00456740`, unread.
    if (inst.death) {
      const dm = inst.type.motions[String(inst.death.motion)];
      if (dm) {
        const f = Math.min(dm.frames - 1,
                           Math.floor(inst.death.t * dm.fps));
        this.apply(inst, dm, f);
        return;
      }
    }
    // The entrance, if there is one: hold its first frame for the delay, play
    // it once, then hand over to the looping motion. `FUN_004577F0` waits for
    // `obj+0x19C` to reach the motion's length before changing state, so the
    // hand-over is at the end of the clip and not on a timer.
    let m = inst.type.motions[String(inst.motion)];
    let f = 0;
    if (inst.intro) {
      const im = inst.type.motions[String(inst.intro.motion)];
      const t = inst.clock * im.fps - inst.intro.delay;
      if (t < im.frames) {
        this.apply(inst, im, Math.max(0, Math.floor(t)));
        return;
      }
      // Restart the loop's clock from the moment the entrance ended, so the
      // walk does not begin part-way through.
      inst.clock -= (inst.intro.delay + im.frames) / im.fps;
      inst.intro = null;
      m = inst.type.motions[String(inst.motion)];
    }
    if (!m || m.frames <= 0) return;
    f = Math.floor(inst.clock * m.fps) % m.frames;

    // A strike or lunge the director started: full weight, no blend, and it
    // reports its own play position back so the hit can land on its frame.
    const act = inst.actor.action;
    if (act) {
      const am = inst.type.motions[String(act.motion)];
      if (am) {
        const af = act.t * am.fps;
        if (af < am.frames) {
          this.apply(inst, am, Math.floor(af));
          return;
        }
        if (!act.loop) { inst.actor.action = null; }
        else { act.t = 0; this.apply(inst, am, 0); return; }
      } else {
        inst.actor.action = null;
      }
    }

    // The stumble, cross-faded over the loop. `ActorPlayHitReaction` starts it
    // on track 1 with a fade length of 10 frames, or 20 when the hit severed
    // something; a hit at bone 9 or above skips the fade entirely. Fading back
    // out over the same length at the end is `[likely]` — the fade *in* is
    // what `FUN_00411B70` states.
    if (inst.react) {
      const rm = inst.type.motions[String(inst.react.motion)];
      const rf = rm ? inst.react.t * rm.fps : 0;
      if (!rm || rf >= rm.frames) {
        inst.react = null;
      } else {
        // `blend` is in **60 Hz game frames**; `rf` counts the clip's own
        // frames, which mot/ authors at 30. Comparing them directly stretched
        // the fade over twice the clip and the weight never reached 1.
        const b = inst.react.hard ? 0 : inst.react.blend * rm.fps / GAME_HZ;
        const w = b <= 0 ? 1
          : Math.min(1, Math.min(rf, rm.frames - rf) / b);
        this.applyBlend(inst, m, f, rm, Math.floor(rf), w);
        return;
      }
    }
    this.apply(inst, m, f);
  }

  /**
   * Pose from two motions at once: *w* is how much of *mB* to take.
   *
   * The engine blends by holding two motion tracks in one block and fading
   * between them (`FUN_004119F0`'s track argument is 1 for the reaction, 0 for
   * the loop). Slerping the bone quaternions is the same operation stated in
   * the units this client already works in.
   */
  private applyBlend(inst: Instance, mA: BakedMotion, fA: number,
                     mB: BakedMotion, fB: number, w: number): void {
    const ra = fA * 3;
    const rb = fB * 3;
    inst.pivot.position.set(
      mA.root[ra] + (mB.root[rb] - mA.root[ra]) * w,
      mA.root[ra + 1] + (mB.root[rb + 1] - mA.root[ra + 1]) * w,
      mA.root[ra + 2] + (mB.root[rb + 2] - mA.root[ra + 2]) * w);

    const n = inst.type.bone_count;
    const ba = fA * n * 3;
    const bb = fB * n * 3;
    inst.pivot.quaternion
      .copy(this.bams(mA.rot[ba], mA.rot[ba + 1], mA.rot[ba + 2]))
      .slerp(this.bams(mB.rot[bb], mB.rot[bb + 1], mB.rot[bb + 2]), w);

    for (const [bone, node] of inst.bones) {
      const oa = ba + bone * 3;
      const ob = bb + bone * 3;
      if (oa + 2 >= mA.rot.length || ob + 2 >= mB.rot.length) continue;
      node.quaternion
        .copy(this.bams(mA.rot[oa], mA.rot[oa + 1], mA.rot[oa + 2]))
        .slerp(this.bams(mB.rot[ob], mB.rot[ob + 1], mB.rot[ob + 2]), w);
    }
  }

  private apply(inst: Instance, m: BakedMotion, f: number): void {

    // Root translation: three floats per frame.
    const r = f * 3;
    inst.pivot.position.set(m.root[r], m.root[r + 1], m.root[r + 2]);

    // Per-bone BAMS triples: bone_count * 3 shorts per frame, bone 0 first.
    const base = f * inst.type.bone_count * 3;
    inst.pivot.quaternion.copy(
      this.bams(m.rot[base], m.rot[base + 1], m.rot[base + 2]));

    for (const [bone, node] of inst.bones) {
      const o = base + bone * 3;
      if (o + 2 >= m.rot.length) continue;
      node.quaternion.copy(this.bams(m.rot[o], m.rot[o + 1], m.rot[o + 2]));
    }
  }

  /** `qZ * qY * qX`, matching the engine's `RotZ; RotY; RotX` stack order. */
  private bams(rx: number, ry: number, rz: number): Quaternion {
    this.q.setFromAxisAngle(AXIS_Z, rz * BAMS_TO_RAD);
    this.qa.setFromAxisAngle(AXIS_Y, ry * BAMS_TO_RAD);
    this.q.multiply(this.qa);
    this.qa.setFromAxisAngle(AXIS_X, rx * BAMS_TO_RAD);
    return this.q.multiply(this.qa);
  }

  /**
   * Test a ray against every live character's per-bone hit spheres.
   *
   * `FUN_00404630` broad-phases on the actor's own sphere before descending
   * into the bones; here the bone spheres are cheap enough (fifteen per
   * character, a few dozen characters) that the broad phase would cost more
   * than it saves, so it is skipped — the answer is the same.
   *
   * The sphere is `PTR_DAT_004D032C`'s centre and radius, carried on the bone
   * and therefore moving with the animation exactly as `FUN_004107E0` makes it.
   * Nearest along the ray wins, matching `FUN_00404DB0`'s sort.
   */
  pick(ray: Ray): { inst: Instance; bone: number; point: Vector3 } | null {
    let best: { inst: Instance; bone: number; point: Vector3 } | null = null;
    let bestT = Infinity;
    for (const inst of this.instances) {
      if (!inst.root.visible || inst.dead) continue;
      for (const b of inst.type.bones) {
        if (!b.hit_radius) continue;
        // A removed bone has a zero draw slot, and `ShotTestBoneTree` never
        // descends into one -- so a blown-off arm cannot be shot again.
        if (inst.removed.has(b.bone)) continue;
        const node = inst.bones.get(b.bone);
        if (!node) continue;
        this._c.set(b.hit_centre![0], b.hit_centre![1], b.hit_centre![2]);
        node.localToWorld(this._c);
        ray.closestPointToPoint(this._c, this._p);
        const t = this._p.sub(ray.origin).dot(ray.direction);
        if (t <= 0) continue;                         // behind the muzzle
        if (ray.distanceSqToPoint(this._c) > b.hit_radius * b.hit_radius) continue;
        if (t < bestT) {
          bestT = t;
          best = { inst, bone: b.bone, point: this._c.clone() };
        }
      }
    }
    return best;
  }

  /**
   * `ActorInitHitPoints` (`FUN_0040A8B0`): the descriptor's hit points plus the
   * difficulty delta, clamped to `[1, 300]`.
   */
  private startHp(p: CharacterPlacement | undefined): number {
    const d = this.json?.difficulty;
    if (!p) return 0;
    if (!d?.hp_delta?.length) return p.hp;
    const hp = p.hp + (d.hp_delta[this.difficulty] ?? 0);
    return Math.min(d.hp_max, Math.max(d.hp_min, hp));
  }

  /** Menu difficulty 0..4. Only scales starting hit points. */
  difficulty = 2;
  /**
   * `g_damage_rank` — the adaptive 0..15 rank the per-bone damage modifier is
   * indexed by, **not** the menu difficulty. `ResetDamageRank` seeds it from
   * `initial_rank[difficulty]`; there is no adaptive state to track here, so
   * it stays at the seed.
   */
  get rank(): number {
    const r = this.json?.difficulty?.initial_rank?.[this.difficulty] ?? 0;
    return Math.min(15, Math.max(0, r));
  }

  /**
   * Charge a hit, exactly as `ResolveHit` (`FUN_00409430`) does.
   *
   * The shape that matters is the **control code**: each step reads its own
   * effect-table entry as the slot to draw and the *next* entry as a code.
   *
   * ```
   * code 0   last step: damage, swap once, latch
   * code 1   SEVER: damage, swap this bone, and remove every bone below it
   * code 2   nothing at all — no damage and no score
   * code >2  escalate: damage, swap, advance
   * ```
   *
   * An earlier revision folded 0/1/2 to "no slot" and never read them as
   * codes, so every hit reskinned the bone and nothing was ever severed —
   * which is what left a forearm animating below a destroyed upper arm.
   * For `char_adv00` the sever code sits at step 5 of the upper arms,
   * forearms, thighs and shins, so a limb comes off on the fifth hit and
   * takes everything below it with it.
   */
  hit(inst: Instance, bone: number, cameraYawBams = 0): {
    damage: number; killed: boolean; head: boolean; hp: number;
    gore: boolean; severed: boolean; result: number; death?: number;
    react?: number;
  } {
    const b = inst.type.bones.find((x) => x.bone === bone);
    const n = inst.hits.get(bone) ?? 0;
    const step = b?.steps?.[n];
    const slot = step?.[0] ?? 0;
    const code = step?.[1] ?? 0;
    const head = bone === inst.type.head_bone;
    const wasDead = inst.dead;

    // `damage = table + DamageRankModifier(bone)`, floored at zero.
    let damage = step?.[2] ?? 0;
    damage = Math.max(0, damage + (b?.damage_rank?.[this.rank] ?? 0));

    let result = 0;
    let gore = false;
    let severed = false;
    const swap = () => {
      gore = this.swapGore(inst, bone, slot) || gore;
      // `ActorSwapDamagedPart` sets the zone bit when the *next* code is 0 or
      // 1 -- that is, when this bone has reached its last stage.
      if (code === 0 || code === 1) this.markZone(inst, bone);
    };
    const sever = () => { severed = true; this.severChildren(inst, bone); };

    if (code === 0) {
      if (slot === 2) {
        result = 5;                                  // the sentinel: no effect
      } else {
        result = 2;
        inst.hp -= damage;
        if (bone === 1) {
          // The torso's last stage is the death wound: only on the hit that
          // takes it below one hit point.
          if (inst.hp < 1 && !inst.latched.has(bone)) {
            result = 3; swap(); sever(); inst.latched.add(bone);
          }
        } else if (!inst.latched.has(bone) && slot !== 0) {
          result = 1; swap();
          inst.hits.set(bone, n + 1);
          inst.latched.add(bone);
        }
      }
    } else if (code === 1) {
      result = 2;
      inst.hp -= damage;
      if (!inst.latched.has(bone)) {
        result = 3; swap(); sever(); inst.latched.add(bone);
      }
    } else if (code === 2) {
      result = 5;
    } else {
      result = 1;
      inst.hp -= damage;
      // `ResolveHit` counts the torso's real stages inline and withholds the
      // last one while the actor is alive.
      const withhold = inst.hp > 0 && bone === 1
        && inst.type.torso_stages <= n + 1;
      if (!withhold) {
        swap();
        inst.hits.set(bone, n + 1);
      }
    }
    if (result === 5) damage = 0;

    // A hit on something already dead scores nothing and cannot kill twice.
    if (wasDead && result === 2) result = 0;

    // `ZombieOnShot` only reacts while the actor is alive; the death takes
    // over otherwise.
    const survived = !wasDead && inst.hp >= 1;
    const react = survived
      ? this.startReaction(inst, bone, result) : undefined;

    let death: number | undefined;
    const killed = !wasDead && inst.hp < 1 && result !== 5;
    if (killed) {
      inst.dead = true;
      // The 1-in-4 headshot burst: `ResolveHit` swaps the head to slot 0,
      // which is `RemoveBoneSubtree`'s "gone" — the head simply leaves.
      if (head && Math.random() < 0.25) {
        this.removeBone(inst, bone);
        severed = true;
      }
      death = this.chooseDeath(inst, cameraYawBams);
      if (death !== undefined && inst.type.motions[String(death)]) {
        inst.death = { motion: death, t: 0 };
      }
    }
    return { damage, killed, head, hp: Math.max(0, inst.hp), gore, severed,
             result, death, react };
  }

  /**
   * `ActorReactToHit` -> `ActorPlayHitReaction`: the stumble.
   *
   * Which clip is a two-level lookup — the actor's **body condition**
   * (`obj+0x130C`) picks a row, and the **reaction group** of the bone that was
   * hit picks the motion within it. `DAT_004C84A8` maps the bone to one of
   * eight groups and they partition the body exactly as you would draw it:
   * head, torso, each arm, pelvis, each leg. For the common zombie that is
   * motions 977, 982, 981, 979, 974, 961, 960 — all 29 frames except the legs
   * at 39, so a leg shot staggers for longer.
   *
   * `ActorReactToHit` does **not** run it for every hit. Results 1 (damaged
   * and swapped) and 3 (severed) always react; results 2 and 5 react only for
   * character types 3 and 0x12. So a shot that merely takes hit points off a
   * zombie's pelvis does not interrupt its walk.
   *
   * Body condition is held at 0 here. `FUN_00454270` derives it from which
   * parts are gone, but through `obj+0x4DC` / `obj+0x68C`, whose meaning is
   * `[open]`. It only changes the answer at condition 3, and for every
   * character in the player's stages conditions 0, 1, 2 and 4 share one row.
   */
  private startReaction(inst: Instance, bone: number,
                        result: number): number | undefined {
    if (bone <= 0) return undefined;
    const ct = inst.type.type;
    // Results 1 and 3 always interrupt; 2 and 5 only for these two types. So
    // a plain body hit on a zombie deliberately does *not* break its stride.
    const reacts = result === 1 || result === 3
      || ((result === 2 || result === 5) && (ct === 3 || ct === 0x12));
    if (!reacts) return undefined;

    const group = this.json?.reaction_groups?.[bone];
    const motion = group === undefined
      ? undefined : inst.type.reactions?.["0"]?.[group];
    if (!motion || !inst.type.motions[String(motion)]) {
      // Say so rather than doing nothing quietly. A bundle exported before
      // the reaction tables were added has no `reaction_groups`, and a
      // silent no-op here looks exactly like "the game has no staggers".
      if (!this.warnedNoReactions) {
        this.warnedNoReactions = true;
        console.warn(
          "[characters] no hit-reaction data in this bundle — re-export it "
          + "(tools/export_player.py). Zombies will not stagger when shot.");
      }
      return undefined;
    }
    const b = this.json?.reaction_blend;
    inst.react = {
      motion,
      t: 0,
      blend: result === 3 ? (b?.sever ?? 20) : (b?.frames ?? 10),
      // `ActorSetMotion` hard-sets the leg reactions: no cross-fade.
      hard: bone >= (b?.hard_set_from_bone ?? 9),
    };
    return motion;
  }

  /** One warning per session, not one per shot. */
  private warnedNoReactions = false;

  /** Whether this bundle carries the hit-reaction tables at all. */
  get hasReactions(): boolean {
    return !!this.json?.reaction_groups?.length;
  }

  /**
   * `SeverBoneChildren` (`FUN_00409AB0`): remove every bone **below** this one.
   *
   * The severed bone itself keeps the stump model `ActorSwapDamagedPart` just
   * gave it; `RemoveBoneSubtree` then walks each *child* and zeroes its draw
   * slot, recursively. Hiding the topmost removed child is equivalent, because
   * everything under it is removed too.
   */
  private severChildren(inst: Instance, bone: number): void {
    for (const b of this.childBones(inst.type, bone)) this.removeBone(inst, b);
  }

  /** `RemoveBoneSubtree` for one bone and everything under it. */
  private removeBone(inst: Instance, bone: number): void {
    inst.removed.add(bone);
    this.markZone(inst, bone);
    const node = inst.bones.get(bone);
    if (node) node.visible = false;
    for (const b of this.childBones(inst.type, bone)) this.removeBone(inst, b);
  }

  /**
   * `RemoveBoneSubtree` and `ActorSwapDamagedPart` both set
   * `obj+0x1318 |= 1 << g_bone_damage_zone[bone]`. Only three zones are named
   * — head, right arm, left arm — and the rest map to 0xFF, which the game's
   * `& 0x1F` shift parks on bit 31 where nothing reads it.
   */
  private markZone(inst: Instance, bone: number): void {
    const z = this.json?.bone_zones?.[bone];
    if (z === undefined || z > 7) return;
    inst.zones |= 1 << z;
    inst.actor.zones = inst.zones & 7;
  }

  /**
   * Bone indices whose parent is *bone*.
   *
   * `CharacterBone.parent` is an **index into `bones`**, not a bone number —
   * the exporter flattens the EXE's node tree parents-first and records where
   * the parent sits in that list. The two happen to differ by one on a
   * humanoid, so comparing them directly is an off-by-one that mostly looks
   * right, which is exactly why it is resolved through the array here.
   */
  private childBones(type: CharacterType, bone: number): number[] {
    let kids = this.kidCache.get(type);
    if (!kids) {
      kids = new Map();
      type.bones.forEach((b) => {
        if (b.parent === null || b.parent === undefined) return;
        const p = type.bones[b.parent];
        if (!p) return;
        const list = kids!.get(p.bone) ?? [];
        list.push(b.bone);
        kids!.set(p.bone, list);
      });
      this.kidCache.set(type, kids);
    }
    return kids.get(bone) ?? [];
  }

  private readonly kidCache = new Map<CharacterType, Map<number, number[]>>();

  /**
   * `FUN_00456220`: `camera_yaw - actor_yaw` against four ±45° arcs.
   *
   * Named by angle rather than front/back — see the note in
   * `hod2lib/characters.py`, which explains why those labels depend on two
   * conventions at once and why the *data* is the reliable half.
   */
  private chooseDeath(inst: Instance, cameraYawBams: number): number | undefined {
    const d = this.json?.deaths;
    if (!d || !d.front?.length) return undefined;
    const rel = (Math.round(cameraYawBams - inst.yaw) & 0xffff);
    const inArc = (centre: number) => {
      let x = (rel - centre) & 0xffff;
      if (x > 0x8000) x -= 0x10000;
      return Math.abs(x) <= d.arc;
    };
    if (inArc(0x4000)) return d.right;
    if (inArc(0xc000)) return d.left;
    const pool = inArc(0x8000) ? d.back : d.front;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Replace a bone's mesh with its damaged variant.
   *
   * A bone node carries two different kinds of child: the primitives its own
   * mesh was split into, and the child *bones* of the skeleton. Only the first
   * may be hidden — hiding the node itself would take the rest of the limb with
   * it. Where the node is a single `Mesh` rather than a group, its geometry and
   * material are swapped instead, which leaves its children untouched.
   */
  private swapGore(inst: Instance, bone: number, slot: number): boolean {
    if (!slot) return false;
    const tmpl = this.goreParts.get(slot);
    const node = inst.bones.get(bone);
    if (!tmpl || !node) return false;

    const self = node as Mesh;
    if (self.isMesh) {
      // A single-primitive bone: swapping geometry and material replaces what
      // it draws and leaves its child bones alone. The original is kept so a
      // seek can put it back.
      const src = (tmpl as Mesh).isMesh
        ? (tmpl as Mesh)
        : (tmpl.children.find((c) => (c as Mesh).isMesh) as Mesh | undefined);
      if (!src) return false;
      if (!inst.gore.has(bone)) {
        const keep = new Mesh(self.geometry, self.material as never);
        keep.visible = false;
        inst.gore.set(bone, keep);
      }
      self.geometry = src.geometry;
      self.material = src.material;
      return true;
    }

    // A multi-primitive bone: hide the primitives, keep the child bones, and
    // hang a clone of the damaged part off the same node.
    const bones = new Set(inst.bones.values());
    const prev = inst.gore.get(bone);
    if (prev && prev.parent === node) prev.removeFromParent();
    else for (const c of node.children) {
      if (!bones.has(c)) c.visible = false;
    }
    const copy = tmpl.clone(true);
    copy.visible = true;
    copy.position.set(0, 0, 0);
    copy.quaternion.identity();
    copy.scale.set(1, 1, 1);
    node.add(copy);
    inst.gore.set(bone, copy);
    return true;
  }

  /** Revive everything — for a seek, which replays the script from the top. */
  revive(): void {
    for (const i of this.instances) {
      i.dead = false;
      i.death = null;
      i.react = null;
      i.hits.clear();
      i.latched.clear();
      for (const bone of i.removed) {
        const node = i.bones.get(bone);
        if (node) node.visible = true;
      }
      i.removed.clear();
      i.zones = 0;
      i.actor.zones = 0;
      i.actor.action = null;
      for (const [bone, g] of i.gore) {
        const node = i.bones.get(bone);
        const self = node as Mesh | undefined;
        if (self?.isMesh) {
          // The saved original, put back.
          self.geometry = (g as Mesh).geometry;
          self.material = (g as Mesh).material;
        } else {
          g.removeFromParent();
        }
      }
      i.gore.clear();
      for (const node of i.bones.values()) {
        for (const c of node.children) c.visible = true;
      }
      i.hp = this.startHp(this.json?.placements.find((x) => x.at === i.at));
    }
  }

  /**
   * A clone of the model at *slot*, from the hidden per-type template the
   * exporter emits — the same one the gore swap draws from. Used for a thrown
   * weapon, which the skeleton never names.
   */
  cloneSlot(slot: number): Object3D | null {
    const t = this.goreParts.get(slot);
    if (!t) return null;
    const c = t.clone(true);
    c.visible = true;
    c.position.set(0, 0, 0);
    c.quaternion.identity();
    c.scale.set(1, 1, 1);
    return c;
  }

  /** World position of one bone of one instance, for a spawn point. */
  boneWorld(at: number, bone: number, out: Vector3): boolean {
    const inst = this.instances.find((i) => i.at === at);
    const node = inst?.bones.get(bone);
    if (!node) return false;
    node.getWorldPosition(out);
    return true;
  }

  /** Swap one bone's drawn model — the thrower's hand going bare and back. */
  setBoneSlot(at: number, bone: number, slot: number): void {
    const inst = this.instances.find((i) => i.at === at);
    if (inst) this.swapGore(inst, bone, slot);
  }

  /** The director's view of every instance. */
  get actors(): EnemyActor[] {
    return this.instances.map((i) => i.actor);
  }

  /** Live, visible, shootable actors — what the enemy-wait opcodes count. */
  get aliveCount(): number {
    return this.instances.filter((i) => i.root.visible && !i.dead).length;
  }

  /**
   * Kill every live actor outright, the way the debug path does: drop hit
   * points to zero and start the directional death. Nothing is severed,
   * because no bone was hit.
   */
  killAll(cameraYawBams = 0): number {
    let n = 0;
    for (const i of this.instances) {
      if (!i.root.visible || i.dead) continue;
      i.hp = 0;
      i.dead = true;
      i.react = null;
      const death = this.chooseDeath(i, cameraYawBams);
      if (death !== undefined && i.type.motions[String(death)]) {
        i.death = { motion: death, t: 0 };
      }
      n++;
    }
    return n;
  }

  get describe(): string {
    if (!this.json) return "—";
    const total = this.json.placements.length;
    if (!this.instances.length) return `0 / ${total} posed`;
    const shown = this.instances.filter((i) => i.root.visible).length;
    const types = new Set(this.instances.map((i) => i.type.name)).size;
    return `${shown} of ${this.instances.length} up, ${types} types`;
  }
}

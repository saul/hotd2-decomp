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

const BAMS_TO_RAD = (Math.PI * 2) / 65536;

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
  dead: boolean;
  /** The actor's own BAMS yaw, for the directional death. */
  yaw: number;
  /**
   * The death clip, once chosen. It plays **once and holds its last frame** —
   * `FUN_00454D20` waits for the clip to finish and then hands the body to
   * `FUN_00456740`, which is not read, so the corpse stays put rather than
   * doing something invented.
   */
  death: { motion: number; t: number } | null;
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
                            clock: 0, intro, hp: p?.hp ?? 0,
                            hits: new Map(), dead: false, yaw: p?.yaw ?? 0,
                            death: null, gore: new Map() });
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
      if (!show) continue;
      if (inst.death) inst.death.t += dt;
      else inst.clock += dt;
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
    this.apply(inst, m, f);
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
   * Charge a hit, exactly as `FUN_00409430` does.
   *
   * Damage escalates with the number of hits **that bone** has already taken —
   * `damage[bone][n]` — and the last step repeats once the row runs out, since
   * the game's `next == 0` simply stops advancing. The difficulty modifier from
   * `PTR_DAT_004D0D84` needs a rank and is not applied.
   */
  hit(inst: Instance, bone: number, cameraYawBams = 0): {
    damage: number; killed: boolean; head: boolean; hp: number;
    gore: boolean; death?: number;
  } {
    const b = inst.type.bones.find((x) => x.bone === bone);
    const n = inst.hits.get(bone) ?? 0;
    const row = b?.damage ?? [];
    const damage = row.length ? row[Math.min(n, row.length - 1)] : 0;
    inst.hits.set(bone, n + 1);
    inst.hp -= damage;

    // `FUN_004098E0` writes the effect slot into record[0], which IS the slot
    // the bone draws -- so the swap is a replacement, not an addition.
    const gore = this.swapGore(inst, bone, b?.effects?.[n] ?? 0);

    const killed = inst.hp <= 0;
    let death: number | undefined;
    if (killed && !inst.dead) {
      inst.dead = true;
      death = this.chooseDeath(inst, cameraYawBams);
      if (death !== undefined
          && inst.type.motions[String(death)]) {
        inst.death = { motion: death, t: 0 };
      }
    }
    return { damage, killed, head: bone === inst.type.head_bone,
             hp: Math.max(0, inst.hp), gore, death };
  }

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
      i.hits.clear();
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
      const p = this.json?.placements.find((x) => x.at === i.at);
      i.hp = p?.hp ?? 0;
    }
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

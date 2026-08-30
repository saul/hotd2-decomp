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

import { Group, Object3D, Quaternion, Vector3 } from "three";
import type { CharactersJson, CharacterType } from "./bundle";
import type { ActiveSpawn } from "./walker";

const BAMS_TO_RAD = (Math.PI * 2) / 65536;

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

/** `chr_<name>_spawn###_bone<NN>_<slot>` — the exporter's part naming. */
const BONE_RE = /_bone(\d+)_/;

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
}

export class CharacterLayer {
  private instances: Instance[] = [];
  private json: CharactersJson | null = null;
  private enabled = true;
  private readonly q = new Quaternion();
  private readonly qa = new Quaternion();

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
    for (const p of json.placements) {
      if (p.motion === null || p.motion === undefined) continue;
      motionOf.set(p.at, p.motion);
      typeOf.set(p.at, p.char_type);
    }

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

      // The motion root translation and bone 0's rotation sit between the
      // object transform and the bones -- see the note above.
      const pivot = new Group();
      pivot.name = `${node.name}_motion`;
      for (const child of [...node.children]) pivot.add(child);
      node.add(pivot);

      const bones = new Map<number, Object3D>();
      pivot.traverse((o) => {
        const m = BONE_RE.exec(o.name);
        if (m) bones.set(Number.parseInt(m[1], 10), o);
      });
      if (!bones.size) continue;

      this.instances.push({ at, type, motion, root: node, pivot, bones,
                            clock: 0 });
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
      const show = this.enabled && present.has(inst.at);
      inst.root.visible = show;
      if (!show) continue;
      inst.clock += dt;
      this.pose(inst);
    }
  }

  private pose(inst: Instance): void {
    const m = inst.type.motions[String(inst.motion)];
    if (!m || m.frames <= 0) return;
    const f = Math.floor(inst.clock * m.fps) % m.frames;

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

  get describe(): string {
    if (!this.json) return "—";
    const total = this.json.placements.length;
    if (!this.instances.length) return `0 / ${total} posed`;
    const shown = this.instances.filter((i) => i.root.visible).length;
    const types = new Set(this.instances.map((i) => i.type.name)).size;
    return `${shown} of ${this.instances.length} up, ${types} types`;
  }
}

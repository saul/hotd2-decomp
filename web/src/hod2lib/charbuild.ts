/**
 * Assembling one character type, and the glTF rig it draws through.
 * The port of `tools/hod2lib/charbuild.py`.
 *
 * {@link Character} is a character *type* -- its skeleton, its per-bone combat
 * rows and the motions baked for it -- not an instance; `placement.Placement`
 * is the instance. {@link build} reads one out of the EXE tables and
 * {@link rigEntry} turns it into the joints and inverse binds the glTF writer
 * wants.
 *
 * **The spawn's authored yaw is used as written. There is no half turn.** An
 * earlier revision added 0x8000 on the strength of a measurement that compared
 * every class-0x30 spawn's yaw against the direction to the nearest camera
 * eye; that measurement was unsound, because the nearest sample on a rail the
 * camera travels *past* is often behind the spawn. What settles the facing is
 * the geometry: posed at motion 956 frame 0, `char_adv00`'s toe reaches world
 * `z = -2.47` against a heel at `+0.88`, so a posed character faces **-Z**,
 * and `RotY(theta)` maps `-Z` to `theta + 180`.
 */

import { composeBams, rotMatrix } from "./bams";
import { u32 } from "./bytes";
import { MOTION_ROW_BACKOFF, actorRadius, attackPicks, attackTables,
         damageRankRow, goreParts, hitReactions, hitSphere, hitSteps,
         motionRow, throwTables, torsoStageCount,
         zombieThrowTables } from "./combat";
import type { CharacterPart, ExeTables } from "./exetab";
import type { BakedMotion } from "./charmotion";
import type { Model } from "./nl1";
import { AssetCache } from "./rigs";
import type { PartModels, Rig, RigInstance, RigPart, RigSkin,
              Vec3 } from "./rigs";
import type { Stage } from "./stage";
import type { Bank } from "./texbank";

export interface CharacterBone {
  bone: number;
  part: string;
  slot: number;
  offset: number[];
  parent: number | null;
  hit_centre?: number[];
  hit_radius?: number;
  steps?: number[][];
  damage_rank?: number[];
}

/** One character type, assembled and ready to pose. */
export class Character {
  /** `{motionId: {bank, frames, root, rot}}`. */
  motions = new Map<number, BakedMotion>();
  /**
   * Asset slots this character's class-0x10 scripts can put in its hand -- ops
   * 0x13, 0x14 and 0x15. They ride the hidden gore template, which is what the
   * client clones a held model from.
   */
  heldSlots = new Set<number>();
  /**
   * Asset slots this character type's spawns ask for through their
   * **attachment lists** -- `g_actor_attachment_records`, bound by
   * `ActorBindPartList` (`FUN_00412440`) and drawn by
   * `ActorDrawAttachedParts` (`FUN_004124F0`).
   *
   * They ride the hidden gore template for the same reason the held items do:
   * the client clones by asset slot, the models live in other `pol/` files
   * (`hito_kao_*`, `etc_komono_*`), and the union over a stage is a handful of
   * models against one per instance.
   */
  attachmentSlots = new Set<number>();
  /**
   * `g_pCharacterExtraParts`, resolved -- see `ExeTables.characterParts`.
   *
   * Set by {@link build} alongside {@link Character.extras}, which is the same
   * table read for its slot list alone. A `null` entry is a part index whose
   * descriptor pointer is null, kept so the index still lines up with
   * `g_character_part_bones` and `g_character_part_drawers`.
   */
  parts: (CharacterPart | null)[] = [];

  constructor(
    readonly charType: number,
    /** pol file stem, e.g. `cat`. */
    readonly name: string,
    /** `cat.bin`. */
    readonly file: string,
    /** Motion frame stride, from the EXE. */
    readonly boneCount: number,
    /** One per skeleton node, parents first. */
    readonly bones: CharacterBone[],
    /** Asset slots the skeleton does not name -- see {@link extraParts}. */
    readonly extras: number[],
    /** `{slot: {centre, radius}}` for the damaged variants. */
    readonly gore: Map<number, Record<string, unknown>>,
    /** `ResolveHit`'s torso stage count. */
    readonly torsoStages: number,
    /**
     * `obj+0x124`, from `g_actor_radius_by_char`. This is the radius
     * `ShotTestSphere` uses for an actor that is *not* shot per bone -- which
     * is every class-0x10 civilian.
     */
    readonly actorRadius: number,
    /** `{bodyCondition: [motion per reaction group]}`. */
    readonly reactions: Map<number, number[]>,
    /** `{bodyCondition: [attack, ...]}`. */
    readonly attacks: Map<number, Map<number, Record<string, unknown>>>,
    /** `{bodyCondition: [80 pick indices]}`. */
    readonly attackPicks: Map<number, number[]>,
    /** The thrown-weapon attack, or null. */
    readonly throw_: Record<string, unknown> | null,
    /** Class 0x30's own hand kit. A different family from {@link throw_}. */
    readonly zombieThrow: Record<string, unknown> | null,
    /** `{bodyCondition: [motion, ...]}`. Index 4 is the back-away walk. */
    readonly motionRowByCond: Map<number, number[]>,
  ) {}

  toJson(): Record<string, unknown> {
    const obj = <T>(m: Map<number, T>): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [k, v] of m) out[String(k)] = v;
      return out;
    };
    const attacks: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of this.attacks) {
      const inner: Record<string, unknown> = {};
      for (const [i, a] of v) inner[String(i)] = a;
      attacks[String(k)] = inner;
    }
    let thrown: Record<string, unknown> | null = null;
    if (this.throw_) {
      thrown = { ...this.throw_ };
    }
    return {
      type: this.charType,
      name: this.name,
      file: this.file,
      bone_count: this.boneCount,
      bones: this.bones,
      extras: this.extras.map((s) =>
        `0x${s.toString(16).toUpperCase().padStart(4, "0")}`),
      // `g_pCharacterExtraParts`, as much of it as the client needs: which
      // bone each part is drawn in and which slot it draws. That is exactly
      // `SkeletonNodeDrawSuppressed`'s input -- it vetoes bone 9's own draw
      // when the slot bone 9 is showing is one of ten literals, and those ten
      // are precisely the parts whose slot equals their draw bone's.
      parts: this.parts.map((p) => p === null ? null : {
        slot: p.slot, draw_bone: p.drawBone,
        bones: p.groups.map((g) => g === null ? null : g.bone),
        deformed: [...p.deformed],
        rows: p.rows.length,
        // False for character type 0x17's part 1 and nothing else in the
        // shipped data: its drawer is `DrawCharacterPartSubparts`, which the
        // port has not read, so the part is described and not drawn.
        supported: p.supported,
      }),
      gore: obj(this.gore),
      // Bone 2 is the head on every 15-bone humanoid, and the head is what the
      // score model keys on; carried rather than assumed by the client.
      head_bone: 2,
      torso_stages: this.torsoStages,
      actor_radius: this.actorRadius,
      reactions: obj(this.reactions),
      attacks,
      attack_picks: obj(this.attackPicks),
      motion_row: obj(this.motionRowByCond),
      backoff_index: MOTION_ROW_BACKOFF,
      throw: thrown,
      zombie_throw: this.zombieThrow,
      motions: obj(this.motions),
    };
  }
}

/**
 * `PTR_DAT_0052ED08[char_type]` -> `{u32 count; u32 *descriptors[]}`, each
 * descriptor's first word an asset slot.
 *
 * These are the parts a character draws that its **skeleton does not name**,
 * and without them a humanoid has a hole where its waist should be: the torso
 * mesh stops at `y = 0.29` and the pelvis starts at `-0.98`. `char_adv00`'s
 * single extra is slot `0x1F02` -- model 99, `y -0.09..1.69` -- and dropped in
 * at the second root it closes that gap exactly.
 *
 * The split identified it: **every humanoid has one or two, and the cat has
 * none**, which is the same split as the gap.
 */
export const EXTRA_PARTS = 0x0052ed08;

/** Asset slots a character draws that its skeleton does not name. */
export function extraParts(tables: ExeTables, charType: number): number[] {
  const base = tables.v2r(EXTRA_PARTS);
  if (base === null || !(charType >= 0 && charType < 0x100)) return [];
  const blk = tables.v2r(u32(tables.data, base + charType * 4));
  if (blk === null || blk + 8 > tables.data.length) return [];
  const count = u32(tables.data, blk);
  const arr = u32(tables.data, blk + 4);
  const ao = tables.v2r(arr);
  if (ao === null || !(count > 0 && count < 16)) return [];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const d = tables.v2r(u32(tables.data, ao + i * 4));
    if (d === null || d + 4 > tables.data.length) continue;
    out.push(u32(tables.data, d));
  }
  return out;
}


export function build(tables: ExeTables, charType: number,
                      assetFile: string): Character | null {
  const skel = tables.characterSkeleton(charType);
  if (!skel.length) return null;
  const bones: CharacterBone[] = [];
  for (const n of skel) {
    const b: CharacterBone = {
      bone: n.bone,
      part: `bone${String(n.bone).padStart(2, "0")}_`
        + `${n.slot.toString(16).padStart(4, "0")}`,
      slot: n.slot,
      offset: [...n.offset],
      parent: n.parent,
    };
    const sph = hitSphere(tables, charType, n.bone);
    if (sph) {
      b.hit_centre = [...sph[0]];
      b.hit_radius = sph[1];
    }
    // `[slot, code, damage]` per step, with the control codes intact. An
    // earlier revision folded 0/1/2 to 0 and trimmed the tail, which threw
    // away the sever code entirely -- so a limb was reskinned on the first hit
    // and never came off.
    const steps = hitSteps(tables, charType, n.bone);
    while (steps.length) {
      const last = steps[steps.length - 1];
      if (last[0] === 0 && last[1] === 0 && last[2] === 0) steps.pop();
      else break;
    }
    if (steps.length) b.steps = steps;
    const rank = damageRankRow(tables, charType, n.bone);
    if (rank.some((v) => v)) b.damage_rank = rank;
    bones.push(b);
  }
  const built = new Character(
    charType,
    assetFile.endsWith(".bin") ? assetFile.slice(0, -4) : assetFile,
    assetFile,
    tables.characterBoneCount(charType),
    bones,
    extraParts(tables, charType),
    goreParts(tables, charType),
    torsoStageCount(tables, charType),
    actorRadius(tables, charType),
    hitReactions(tables, charType),
    attackTables(tables, charType) as unknown as
      Map<number, Map<number, Record<string, unknown>>>,
    attackPicks(tables, charType),
    throwTables(tables, charType),
    zombieThrowTables(charType),
    motionRow(tables, charType));
  built.parts = tables.characterParts(charType);
  return built;
}

/**
 * One vertex-blended part's skinning, or `null` when nothing can be skinned.
 *
 * Every vertex of the model is looked up in the part's row table -- the exe's
 * own list of *which display-list records are this logical vertex* -- and then
 * in the four groups' assign bytes. A row a group claims takes that group's
 * bone and that group's source position and normal, which are authored in the
 * bone's own local space.
 *
 * **A group the drawer does not deform keeps the model's stored geometry and
 * takes the draw bone.** That is not a fallback: `DrawCharacterPartGroup0`
 * (`FUN_00419E90`) really does leave the other groups alone, and it is right
 * because such a group's bone *is* the draw bone, so its transform is the
 * identity. Measured on `hito_gal`'s waist: the exe's group-2 source vertices
 * equal the pol model's stored ones to 8e-4, which is the low mantissa bit
 * `WriteCharacterPartVertexPos` (`FUN_0041A480`) sets on x.
 *
 * A vertex no row names -- there are none in the shipped data, and this says
 * so rather than guessing -- also keeps the model's geometry on the draw bone.
 *
 * This replaced `_second_root`, which hung these parts off the pelvis as rigid
 * children. That was the port's stand-in for a deform it did not have, and it
 * is why a walking civilian's waist rode the hips instead of stretching to the
 * chest.
 */
function skinFor(char: Character, cp: CharacterPart,
                 model: Model): RigSkin | null {
  const partOfBone = new Map<number, string>();
  for (const b of char.bones) partOfBone.set(b.bone, b.part);
  /** Model-relative vertex offset -> its row. */
  const rowOf = new Map<number, number>();
  cp.rows.forEach((offs, r) => { for (const o of offs) rowOf.set(o, r); });

  const bones: number[] = [];
  const jointParts: string[] = [];
  const joint = (bone: number): number | null => {
    const name = partOfBone.get(bone);
    if (name === undefined) return null;
    let k = bones.indexOf(bone);
    if (k < 0) { k = bones.length; bones.push(bone); jointParts.push(name); }
    return k;
  };
  const drawJoint = joint(cp.drawBone);
  if (drawJoint === null) return null;

  const joints: number[][] = [];
  const positions: Vec3[][] = [];
  const normals: Vec3[][] = [];
  for (const mesh of model.meshes) {
    const mj: number[] = [];
    const mp: Vec3[] = [];
    const mn: Vec3[] = [];
    mesh.vertices.forEach((v, k) => {
      const row = rowOf.get(mesh.offsets[k] ?? -1);
      let jt: number | null = null;
      let pos: Vec3 = [...v.pos] as Vec3;
      let nrm: Vec3 = [...v.normal] as Vec3;
      if (row !== undefined) {
        for (const g of cp.deformed) {
          const grp = cp.groups[g];
          if (!grp) continue;
          const a = grp.assign[row];
          if (a === undefined || a < 0 || a >= grp.verts.length) continue;
          jt = joint(grp.bone);
          if (jt !== null) {
            pos = [...grp.verts[a].pos] as Vec3;
            nrm = [...grp.verts[a].normal] as Vec3;
          }
          break;
        }
      }
      mj.push(jt ?? drawJoint);
      mp.push(pos);
      mn.push(nrm);
    });
    joints.push(mj);
    positions.push(mp);
    normals.push(mn);
  }
  return { bones, jointParts, joints, positions, normals };
}

/**
 * A `gltf.exportLevel` rig entry: the skeleton, placed at every spawn.
 *
 * *poseFrame* bakes a motion frame into the parts instead of leaving them at
 * bind. The browser poses at runtime and does not want this; a still render
 * for verification does, because bind is a heap of parts and proves nothing.
 *
 * The bake folds the frame's root translation into the root bones. That is
 * exact only while bone 0 carries no rotation -- it does not for every motion,
 * so bone 0 is composed in rather than approximated.
 */
export async function rigEntry(stage: Stage, tables: ExeTables,
                               char: Character,
                               spawns: Record<string, unknown>[],
                               poseFrame: number | null = null,
                               poseMotion: number | null = null,
                               cache: AssetCache = new AssetCache(stage)):
    Promise<RigInstance | null> {
  const [models, bank] = await cache.get(
    "hod2lib.charbuild.rig_entry", char.name, "character asset",
    `${char.name} has no model, so every spawn of it is invisible`);
  if (!models.length) return null;
  const slots = tables.assetSlots();

  let pose: Map<number, Vec3> | null = null;
  let root: number[] = [0, 0, 0];
  let R0: number[][] = rotMatrix([0, 0, 0]);
  if (poseFrame !== null && char.motions.size) {
    const mid = poseMotion !== null && char.motions.has(poseMotion)
      ? poseMotion : char.motions.keys().next().value as number;
    const m = char.motions.get(mid)!;
    const f = Math.max(0, Math.min(poseFrame, m.frames - 1));
    const n = char.boneCount;
    pose = new Map();
    for (let b = 0; b < n; b++) {
      pose.set(b, m.rot.slice(f * n * 3 + b * 3,
                              f * n * 3 + b * 3 + 3) as Vec3);
    }
    // Bone 0 sits between the object and the skeleton, and the rig writer has
    // no node there, so it is composed into each root bone -- exactly, not
    // approximated: the rotation multiplies and the root translation is
    // carried through it.
    root = m.root.slice(f * 3, f * 3 + 3);
    R0 = rotMatrix(pose.get(0)!);
  }

  const parts: PartModels[] = [];
  for (const b of char.bones) {
    let offset = [...b.offset];
    let rot: Vec3 = pose ? pose.get(b.bone) ?? [0, 0, 0] : [0, 0, 0];
    if (pose !== null && b.parent === null) {
      offset = [0, 1, 2].map((i) =>
        R0[i][0] * b.offset[0] + R0[i][1] * b.offset[1]
        + R0[i][2] * b.offset[2] + root[i]);
      rot = composeBams(pose.get(0)!, rot);
    }
    const part: RigPart = {
      name: b.part,
      slots: [b.slot],
      translation: offset as Vec3,
      // Bind pose unless a frame was asked for. The client overwrites every
      // bone from the motion each frame; this is what the file loads as.
      rotation_bams: rot,
      parent: b.parent !== null ? char.bones[b.parent].part : "",
      note: `bone ${b.bone} of character type `
        + `0x${char.charType.toString(16).padStart(2, "0")}`,
    };
    const rec = slots.get(b.slot);
    const idx = rec ? rec[1] : null;
    const model = idx !== null && idx < models.length ? models[idx] : null;
    parts.push([part, model ? [[model, bank as Bank | null, char.name]] : []]);
  }

  // The parts the skeleton does not name, **skinned**.
  //
  // `DeformCharacterPartGroup` (`FUN_00419980`) gives every vertex of one of
  // these exactly one bone and no weight, and `DrawCharacterPartSlot`
  // (`FUN_00419B40`) then draws the whole model in a fifth bone's space --
  // which the deform has already pre-cancelled, so a vertex ends up at
  // `group_bone_matrix * source_vertex` and nothing else. That is glTF
  // skinning, said exactly, so it is emitted as glTF skinning rather than as
  // a per-frame transform of our own.
  //
  // They were hung off the pelvis as rigid children before this, which is why
  // a walking civilian's waist did not move with the torso.
  char.parts.forEach((cp, i) => {
    // A drawer the port has not read draws something this table does not
    // name; emitting the table's slot instead would be inventing geometry.
    if (cp === null || !cp.supported) return;
    const rec = slots.get(cp.slot);
    const idx = rec ? rec[1] : null;
    const model = idx !== null && idx < models.length ? models[idx] : null;
    if (model === null) return;
    const skin = skinFor(char, cp, model);
    if (skin === null) return;
    parts.push([{
      name: `part${i}_${cp.slot.toString(16).padStart(4, "0")}`,
      slots: [cp.slot],
      // No parent and no transform: a skinned mesh is placed by its joints,
      // and three.js cancels the node's own world matrix in attached bind
      // mode. Hanging it off a bone would apply that bone twice.
      parent: "",
      skin,
      note: `part ${i} of character type `
        + `0x${char.charType.toString(16).padStart(2, "0")}, drawn in bone `
        + `${cp.drawBone}'s space across bones `
        + `${skin.bones.join(", ")}`,
    }, [[model, bank as Bank | null, char.name]]]);
  });

  const rig: Rig = {
    name: `chr_${char.name}`,
    routine: `character type 0x${char.charType.toString(16).padStart(2, "0")}`,
    worldSpace: false,
    spawnClass: null,
    parts: parts.map(([p]) => p),
    note: "skeleton from the EXE; posed per frame from mot/",
  };
  return { rig, routes: [], anchors: {}, biases: {}, fixed: [], world: false,
           placements: spawns, blocked: "",
           parts: parts.filter(([, m]) => m.length) };
}

/** A hidden rig holding one part per damaged variant, for the client to clone. */
export async function goreEntry(stage: Stage, tables: ExeTables,
                                char: Character,
                                cache: AssetCache = new AssetCache(stage)):
    Promise<RigInstance | null> {
  const slots = tables.assetSlots();
  const parts: PartModels[] = [];
  // The thrower's projectile and its two hand states ride in the same hidden
  // rig: the client clones by asset slot either way, and neither the held hand
  // nor the weapon in flight is named by the skeleton.
  const want = new Set<number>(char.gore.keys());
  // Class 0x10's held items ride here too, for the same reason.
  for (const s of char.heldSlots) want.add(s);
  // And the faces and accessories an attachment list names -- the
  // `hito_kao_*` head a spawn wears instead of the skeleton's, and the
  // `etc_komono_*` hair, hat, bag or shoes drawn on top of it.
  for (const s of char.attachmentSlots) want.add(s);
  // **And the head's own undamaged model**, which the skeleton *does* name --
  // but names as a bone, not by slot, and the client clones by slot.
  //
  // `ResolveHit`'s 1-in-4 headshot burst throws the head as an independent
  // object drawing `obj+0x32C`, the model the head bone is wearing. On a clean
  // headshot kill -- the common case -- that is the pristine slot, and the
  // pristine slot was in no rig the client could clone from. So the head came
  // off the body and nothing flew.
  const head = char.bones.find((b) => b.bone === 2);
  if (head && head.slot) want.add(head.slot);
  for (const hands of Object.values(
      (char.throw_?.hands as Record<string, Record<string, unknown>[]>) ?? {})) {
    for (const h of hands) {
      for (const v of [h.held, h.bare, h.projectile]) {
        if (v) want.add(v as number);
      }
    }
  }
  for (const slot of [...want].sort((a, b) => a - b)) {
    const rec = slots.get(slot);
    if (!rec) continue;
    const stem = rec[0].endsWith(".bin") ? rec[0].slice(0, -4) : rec[0];
    const [models, bank] = await cache.get(
      "hod2lib.charbuild.gore_entry", stem, "damaged-variant asset",
      `slot 0x${slot.toString(16).padStart(4, "0")} keeps its undamaged model`);
    if (rec[1] >= models.length) continue;
    const part: RigPart = {
      name: `gore_${slot.toString(16).padStart(4, "0")}`,
      slots: [slot],
      note: `damaged variant, slot 0x${slot.toString(16).padStart(4, "0")}`,
    };
    parts.push([part, [[models[rec[1]] as Model, bank as Bank | null, stem]]]);
  }
  if (!parts.length) return null;
  const rig: Rig = {
    name: `gore_${char.name}`,
    routine: `character type 0x${char.charType.toString(16).padStart(2, "0")}`,
    worldSpace: false,
    parts: parts.map(([p]) => p),
    note: "damaged parts; hidden, cloned onto a bone when hit",
  };
  return {
    rig, routes: [], anchors: {}, biases: {}, world: false, placements: [],
    blocked: "",
    fixed: [{ kind: "fixed", translation: [0.0, 0.0, 0.0],
              rotation_bams: [0, 0, 0], cam_paths: [], note: rig.note! }],
    parts,
  };
}

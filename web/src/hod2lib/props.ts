/**
 * Scripted scenery: doors, shutters, windows and the vans they hang off.
 * The port of `tools/hod2lib/props.py`.
 *
 * The zombies that lunge at you out of the back of a van in stage 2 are not
 * standing in the open waiting for the camera. They are inside a van, and the
 * doors swing apart on a script cue. That mechanism is this module.
 *
 * Two spawn classes matter, and they usually sit at the *same position*
 * because they are two halves of one set piece: **class 0x33 selector 2**
 * (`FUN_00433A10`) is a static scripted prop drawn at the spawn's own pose
 * until a script flag is set or the camera path reaches a frame -- the van
 * body is one of these -- and **class 0x44** (`FUN_00472B10`) is a prop placer
 * whose selectors 1, 2 and 4 all share the child behaviour `HingeUpdate`
 * (`FUN_00473CF0`), which is a hinge.
 *
 * `HingeUpdate` composes `Translate(pos); RotY(base_yaw); RotZ(rz);
 * RotY(swing); RotX(rx)`. The two Y rotations with a Z between them are the
 * hinge's *mounting* yaw and its *swing*, which is what lets one pair of
 * curves serve doors mounted at any angle.
 *
 * **`side` is read for its sign; its magnitude belongs to something else.**
 * `HingeUpdate` touches `obj+0x1DC` twice: a `TEST EAX,EAX; JLE` that picks
 * which way the leaf swings, and an `IMUL` that scales the damped yaw wobble
 * the prop does when it is **shot**. It is not always +/-1 -- stage 1 carries
 * +/-512 and +/-416 -- and a consumer that multiplies the pose by it rather
 * than by its sign throws those four doors through about a hundred turns.
 */

import { BAMS_TO_RAD, bamsFromMatrix, rotMatrix } from "./bams";
import { i16, u16, u32 } from "./bytes";
import type { Spawn } from "./evt";
import type { ExeTables } from "./exetab";
import type { Model } from "./nl1";
import { AssetCache } from "./rigs";
import type { PartModels, Rig, RigInstance, RigPart, Vec3 } from "./rigs";
import type { Stage } from "./stage";
import type { Bank } from "./texbank";

/** `FUN_00472B10`'s 18 builders, indexed by `obj+0x11C`. */
export const PROP_BUILDERS = 0x00595ab8;
/** 6-byte `{s16 rx, s16 ry, s16 rz}` frames, for curve selectors 0, 2 and 3. */
export const HINGE_CURVES_XYZ = 0x005960b4;
/** `u16` yaw-only frames, for the others. */
export const HINGE_CURVES_Y = 0x005960c8;
/**
 * `HingeUpdate` stops posing here -- `CMP EDI,0x82; JGE` on curve 4,
 * `CMP EDI,0x3C; JL` on the rest, so the last frame it reads is 129 or 59.
 * These are the frame *counts*.
 */
export const HINGE_FRAMES: Record<number, number> = { 4: 0x82 };
export const HINGE_FRAMES_DEFAULT = 0x3c;
/**
 * The selectors `HingeUpdate` sends to {@link HINGE_CURVES_XYZ}; every other
 * one goes to the yaw-only table. An explicit `AX == 0 / 2 / 3` switch at
 * 0x00473E8D, not a test of whether the pointer is populated.
 */
export const HINGE_CURVES_XYZ_SELECTORS = [0, 2, 3];

/**
 * The two rear doors selector 2 builds, from `PropBuildVanDoors`
 * (`FUN_00472C90`). The offsets are literals in the code and the slots are
 * `0x1794 + i`; only the van uses it.
 */
export const VAN_DOOR_SLOT = 0x1794;
export const VAN_DOOR_OFFSETS: Vec3[] =
  [[-9.29, 11.5, 22.68], [9.29, 11.5, 22.68]];

export const BAMS_TO_DEG = 360.0 / 65536.0;

/** One swinging prop -- a door leaf, a shutter, a window. */
export class Hinge {
  constructor(
    /** evt offset of the spawn that built it. */
    readonly at: number,
    /** Which child of that spawn. */
    readonly index: number,
    /** The class-0x44 builder that made it. */
    readonly selector: number,
    readonly slot: number,
    readonly pos: Vec3,
    /** BAMS, the mounting angle. */
    readonly baseYaw: number,
    /**
     * `obj+0x1DC`. Its **sign** mirrors the swing; its magnitude is the
     * shot-wobble amplitude and must never scale the pose.
     */
    readonly side: number,
    readonly curve: number,
    /** Script flag that starts the swing. */
    readonly openFlag: number,
    /** Script flag that deletes it, or -1. */
    readonly removeFlag: number,
    readonly scale: Vec3 = [1.0, 1.0, 1.0],
  ) {}

  get name(): string {
    return `prop_${this.at.toString(16).padStart(4, "0")}_${this.index}`;
  }

  toJson(): Record<string, unknown> {
    return { name: this.name, kind: "hinge", at: this.at,
             selector: this.selector, slot: this.slot, side: this.side,
             curve: this.curve, base_yaw: this.baseYaw,
             open_flag: this.openFlag, remove_flag: this.removeFlag };
  }
}

/** A class-0x33 selector-2 prop: drawn until a flag or a camera frame. */
export class StaticProp {
  constructor(
    readonly at: number,
    readonly slot: number,
    readonly pos: Vec3,
    readonly rotBams: Vec3,
    readonly removeFlag: number,
    /** `params[3]`: the camera path frame it dies on, or null when -1. */
    readonly removeFrame: number | null,
  ) {}

  get name(): string {
    return `prop_${this.at.toString(16).padStart(4, "0")}_s`;
  }

  toJson(): Record<string, unknown> {
    return { name: this.name, kind: "static", at: this.at, slot: this.slot,
             remove_flag: this.removeFlag, remove_frame: this.removeFrame };
  }
}

/**
 * One swing curve as `[[rx, ry, rz], ...]` in BAMS, frame by frame.
 *
 * Which table a selector reads is the exe's own switch, not an inference from
 * which pointer is populated. The two agree on the shipped data -- XYZ slots 1
 * and 4 are null -- but a rule that holds only by luck is the adjacent-array
 * trap waiting for the first re-authored curve.
 */
export function hingeCurve(tables: ExeTables, sel: number): Vec3[] {
  const n = HINGE_FRAMES[sel] ?? HINGE_FRAMES_DEFAULT;
  const xyz = tables.v2r(HINGE_CURVES_XYZ);
  const yon = tables.v2r(HINGE_CURVES_Y);
  if (xyz === null || yon === null || !(sel >= 0 && sel < 6)) return [];
  if (HINGE_CURVES_XYZ_SELECTORS.includes(sel)) {
    const p = tables.ru32(HINGE_CURVES_XYZ + sel * 4) ?? 0;
    const o = p ? tables.v2r(p) : null;
    if (o === null) return [];
    // Three MOVSX loads at 0x00473EC8: every component is signed.
    return Array.from({ length: n }, (_, f) =>
      [i16(tables.data, o + f * 6), i16(tables.data, o + f * 6 + 2),
       i16(tables.data, o + f * 6 + 4)] as Vec3);
  }
  const p = tables.ru32(HINGE_CURVES_Y + sel * 4) ?? 0;
  const o = p ? tables.v2r(p) : null;
  if (o === null) return [];
  // `XOR EDX,EDX; MOV DX, word ptr [EAX + EDI*2]` at 0x00473EAA -- zero
  // extended, so a yaw-only curve past 180 degrees stays past it rather than
  // folding negative. Nothing shipped reaches 0x8000, so this changes no
  // exported byte; reading it the way the exe does is what keeps it true.
  return Array.from({ length: n }, (_, f) =>
    [0, u16(tables.data, o + f * 2), 0] as Vec3);
}

/**
 * The hinge's orientation at *frame*, as one BAMS `(rx, ry, rz)` triple.
 *
 * `HingeUpdate` composes `RotY(base_yaw); RotZ(rz); RotY(swing); RotX(rx)`,
 * which is not a single Rz-Ry-Rx Euler as written -- so it is multiplied out
 * and decomposed. Used to bake a still for verification; the player applies
 * the four rotations directly and never needs this.
 */
export function posedRotBams(hinge: Hinge, curve: Vec3[],
                             frame: number): Vec3 {
  if (!curve.length) return [0, hinge.baseYaw, 0];
  const f = Math.max(0, Math.min(frame, curve.length - 1));
  const [rx, ry, rz] = curve[f];
  // `TEST EAX,EAX; JLE` -- the sign of `side`, never its magnitude.
  const mirror = hinge.side <= 0 ? -1 : 1;
  const seq = [rotMatrix([0, hinge.baseYaw, 0]),
               rotMatrix([0, 0, rz]),
               rotMatrix([0, mirror * ry, 0]),
               rotMatrix([mirror * rx, 0, 0])];
  let M: number[][] = seq[0];
  for (const N of seq.slice(1)) {
    M = [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
      M[i][0] * N[0][j] + M[i][1] * N[1][j] + M[i][2] * N[2][j]));
  }
  return bamsFromMatrix(M);
}

/** `MatrixRotateY`: `x' = c*x + s*z, z' = -s*x + c*z`. */
function rotY(bams: number, v: Vec3): Vec3 {
  const a = bams * BAMS_TO_RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

/** Just the part of a `Program` this resolver reads. */
export interface ProgramLike {
  blocks: { steps: { ops: { detail: Record<string, unknown> }[] }[] }[];
}

/** `[hinges, statics]` for every scripted prop the stage's script places. */
export function resolveForStage(prog: ProgramLike | null,
                                spawnRecords: Spawn[] | null):
    [Hinge[], StaticProp[]] {
  if (prog === null || spawnRecords === null) return [[], []];

  const byAt = new Map<number, Record<string, unknown>>();
  for (const blk of prog.blocks) {
    for (const step of blk.steps) {
      for (const op of step.ops) {
        for (const sp of (op.detail.spawns as Record<string, unknown>[]) ?? []) {
          const at = sp.at as number;
          if (!byAt.has(at)) byAt.set(at, sp);
        }
      }
    }
  }
  const recs = new Map<number, Spawn>();
  for (const r of spawnRecords) recs.set(r.offset, r);

  const hinges: Hinge[] = [];
  const statics: StaticProp[] = [];

  for (const at of [...byAt.keys()].sort((a, b) => a - b)) {
    const sp = byAt.get(at)!;
    const rec = recs.get(at);
    if (rec === undefined || !rec.hasParams) continue;
    const sel = (sp.hp as number) ?? 0;
    const pos = [...(sp.pos as number[])] as Vec3;
    const orient = sp.orient as number[];
    const yaw = orient[1] & 0xffff;

    if (sp.class === 0x33 && sel === 2) {
      const slot = rec.param(0x00, "u32");
      const frame = rec.param(0x0c, "i32");
      const flag = rec.param(0x11, "u8");
      if (slot) {
        statics.push(new StaticProp(
          at, slot, pos,
          [orient[0] & 0xffff, yaw, orient[2] & 0xffff],
          flag !== null ? flag : -1,
          frame === null || frame === -1 ? null : frame));
      }
      continue;
    }

    if (sp.class !== 0x44) continue;

    if (sel === 2) {
      // FUN_00472C90: two rear doors at literal offsets, slots 0x1794+i, the
      // second mirrored by half a turn.
      VAN_DOOR_OFFSETS.forEach((off, i) => {
        const r = rotY(yaw, off);
        hinges.push(new Hinge(
          at, i, sel, VAN_DOOR_SLOT + i,
          [pos[0] + r[0], pos[1] + r[1], pos[2] + r[2]],
          (yaw + i * 0x8000) & 0xffff,
          i === 0 ? -1 : 1, 2,
          rec.param(0x20, "i8") || 0,
          rec.param(0x21, "i8") as number));
      });
    } else if (sel === 1) {
      // FUN_00472BD0, reading the parameter tail throughout.
      hinges.push(new Hinge(
        at, 0, sel, rec.param(0x04, "u16") as number, pos, yaw,
        rec.param(0x10, "i32") || 0,
        rec.param(0x00, "u16") || 0,
        rec.param(0x20, "i8") || 0,
        rec.param(0x21, "i8") as number));
    } else if (sel === 4) {
      // FUN_00472EB0: as selector 1, but the flags move and it carries a
      // per-instance scale.
      hinges.push(new Hinge(
        at, 0, sel, rec.param(0x04, "u16") as number, pos, yaw,
        rec.param(0x0c, "i32") || 0,
        rec.param(0x00, "u16") || 0,
        rec.param(0x10, "i8") || 0,
        rec.param(0x11, "i8") as number,
        [rec.param(0x14, "f32") || 1.0,
         rec.param(0x18, "f32") || 1.0,
         rec.param(0x1c, "f32") || 1.0]));
    }
  }

  return [hinges.filter((h) => h.slot), statics];
}

/** The `props` block of `<stage>.script.json`. */
export function propsJson(tables: ExeTables, hinges: Hinge[],
                          statics: StaticProp[]): Record<string, unknown> {
  const used = [...new Set(hinges.map((h) => h.curve))].sort((a, b) => a - b);
  const curves: Record<string, Vec3[]> = {};
  for (const c of used) curves[String(c)] = hingeCurve(tables, c);
  return {
    hinges: hinges.map((h) => h.toJson()),
    statics: statics.map((s) => s.toJson()),
    // BAMS per frame, so the client can apply them exactly rather than
    // approximating a spring.
    curves,
    note: "Hinged props are class-0x44 selectors 1, 2 and 4, which share the "
      + "child behaviour FUN_00473CF0; statics are class 0x33 selector 2. A "
      + "hinge swings when its open_flag is set by set_script_flag (0x48) and "
      + "vanishes on remove_flag. The transform is Translate(pos); "
      + "RotY(base_yaw); RotZ(rz); RotY(swing); RotX(rx), with rx/rz mirrored "
      + "and the swing negated when side < 1.",
  };
}

/**
 * glTF rig entries for the prop geometry, one instance per prop.
 *
 * A prop is a single model at a pose, which is the simplest thing the rig
 * writer draws -- so it goes through that rather than a third glTF path, the
 * same reasoning as characters. One rig per prop rather than one per slot: the
 * client has to address each instance separately to swing it, and a shared rig
 * with several placements gives them all the same name.
 *
 * The models live in `komono_*` and `etc_*` files that are not part of any
 * stage's geometry set, so they are loaded here on demand and cached.
 */
export async function rigEntries(stage: Stage, hinges: Hinge[],
                                 statics: StaticProp[],
                                 openFrame: number | null = null,
                                 cache: AssetCache = new AssetCache(stage)):
    Promise<RigInstance[]> {
  const slots = stage.tables.assetSlots();
  const out: RigInstance[] = [];
  for (const p of [...hinges, ...statics]) {
    const rec = slots.get(p.slot);
    if (!rec) continue;
    const stem = rec[0].endsWith(".bin") ? rec[0].slice(0, -4) : rec[0];
    const [models, bank] = await cache.get(
      "hod2lib.props.rig_entries", stem, "prop asset",
      "every prop drawn from it is dropped");
    if (rec[1] >= models.length) continue;
    const model: Model = models[rec[1]];
    const isHinge = p instanceof Hinge;
    const rot: Vec3 = isHinge
      ? (openFrame === null ? [0, p.baseYaw, 0]
         : posedRotBams(p, hingeCurve(stage.tables, p.curve), openFrame))
      : (p as StaticProp).rotBams;
    const part: RigPart = {
      name: "body",
      slots: [p.slot],
      scale: isHinge ? p.scale : [1.0, 1.0, 1.0],
      note: `asset slot 0x${p.slot.toString(16).padStart(4, "0")}`,
    };
    const rig: Rig = {
      name: p.name,
      routine: isHinge
        ? `class 0x44 selector ${p.selector} (FUN_00473CF0)`
        : "class 0x33 selector 2",
      worldSpace: false,
      parts: [part],
      note: isHinge ? `swings on script flag ${p.openFlag}`
                    : `removed on script flag ${(p as StaticProp).removeFlag}`,
    };
    const parts: PartModels[] = [[part, [[model, bank as Bank | null, stem]]]];
    out.push({
      rig, routes: [], anchors: {}, biases: {}, world: false, placements: [],
      blocked: "",
      // A fixed pose is the rig writer's own idiom for "the routine hardcodes
      // where this goes", which is exactly the case here.
      fixed: [{ kind: "fixed", translation: [...p.pos],
                rotation_bams: [...rot], cam_paths: [], note: rig.note! }],
      parts,
    });
  }
  return out;
}

// -- the effect system, and class 0x44 selector 0 -------------------------

/**
 * `g_effect_trees` -- 0x004D5390, one root node per effect id.
 *
 * A node, and the root the table points at is one:
 *
 * ```
 * +0x00  u32  asset slot            0 draws nothing
 * +0x04  s16  bone index, 1-based   < 1 makes it a pure transform
 * +0x06  u16  child count
 * +0x08  u32  children[]
 * ```
 *
 * `g_character_skeletons`' struct minus the bind offsets, because an effect's
 * translations come per frame from its motion rather than from a rest pose.
 */
export const EFFECT_TREES = 0x004d5390;
/** `g_effect_bone_counts` -- 0x004D5404, s16 per effect: the node count. */
export const EFFECT_BONE_COUNTS = 0x004d5404;
/** `g_effect_interp_mode` -- 0x004D5440, u8 per effect. See `spawns.md`. */
export const EFFECT_INTERP_MODE = 0x004d5440;
/** The three tables are 29 long and contiguous, which is what fixes them. */
export const EFFECT_COUNT = 29;
/**
 * A bound on the walk, so a corrupt pointer cannot run away.
 *
 * It is not a guess at the data: effect 8 has **144 children under its root**
 * and 145 nodes, and a cap of 0x40 silently returned 65 of them --
 * `verify_effects.py`'s node-count check is exactly what caught that.
 */
export const EFFECT_NODE_CAP = 4096;

/** One node of an effect tree, flattened depth-first with the root first. */
export interface EffectNode {
  /** `+0x00`. `AssetDrawSlot(0)` draws nothing, so 0 is a pure transform. */
  slot: number;
  /** `+0x04`, 1-based. `EffectDrawNode` skips the pose and the draw below 1. */
  bone: number;
  /** Indices into the flattened array. */
  children: number[];
}

/**
 * One effect's node tree, flattened.
 *
 * Depth-first from the root, which is index 0 -- the order `EffectDrawNode`
 * (`FUN_0040DE50`) recurses in, so a consumer that walks the array in order
 * sees the parts in the order the engine draws them.
 */
export function effectTree(tables: ExeTables, effect: number): EffectNode[] {
  if (!(effect >= 0 && effect < EFFECT_COUNT)) return [];
  const root = tables.ru32(EFFECT_TREES + effect * 4) ?? 0;
  if (!root) return [];
  const out: EffectNode[] = [];
  const seen = new Set<number>();
  const walk = (va: number): number => {
    const r = tables.v2r(va);
    if (r === null || seen.has(va) || out.length >= EFFECT_NODE_CAP) return -1;
    seen.add(va);
    const here = out.length;
    const n = u16(tables.data, r + 6);
    out.push({ slot: u32(tables.data, r), bone: i16(tables.data, r + 4),
               children: [] });
    for (let k = 0; k < n && k < EFFECT_NODE_CAP; k++) {
      const child = u32(tables.data, r + 8 + k * 4);
      const idx = child ? walk(child) : -1;
      if (idx >= 0) out[here].children.push(idx);
    }
    return here;
  };
  walk(root);
  return out;
}

/**
 * `PropBuildScriptFlagEffect` (`FUN_00472B30`) -- class 0x44 selector 0, and
 * the literals its object is built from.
 *
 * It is the one selector whose object draws an **animated effect** rather than
 * a model at a pose: `ScriptFlagEffectUpdate` (`FUN_00473B90`) calls
 * `EffectDrawWithCapture` with the four-word state block at `obj+0x324`, and
 * nothing anywhere in the family translates by the spawn's own position --
 * the motion carries world coordinates. Stage 1's two window halves at evt
 * `0x1580` and `0x15CC` are the only two spawns in the game that reach it.
 */
export const SCRIPT_FLAG_EFFECT_MOTION = 0x1d7;
/**
 * `CMP ECX,0x13F5` at `0x00472B6C`: the dword at `tail+0x04`. Matching picks
 * effect 2 and capture bone 2, and anything else effect 3 and bone 1.
 */
export const SCRIPT_FLAG_EFFECT_SLOT_A = 0x13f5;
export const SCRIPT_FLAG_EFFECT_A = { effect: 2, captureBone: 2 };
export const SCRIPT_FLAG_EFFECT_B = { effect: 3, captureBone: 1 };
/** `g_script_flag_effect_cues_a` -- 0x005961F0, and its neighbour. */
export const SCRIPT_FLAG_EFFECT_CUES_A = 0x005961f0;
export const SCRIPT_FLAG_EFFECT_CUES_B = 0x00596204;

/** A cue list, up to and not including its `-1` terminator. */
export function effectSoundCues(tables: ExeTables, va: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 64; k++) {
    const r = tables.v2r(va + k * 2);
    if (r === null) break;
    const v = i16(tables.data, r);
    if (v === -1) break;
    out.push(v);
  }
  return out;
}

/**
 * Hand-coded object rigs, recovered from their draw routines.
 * The port of `tools/hod2lib/rigs.py` -- its code half; the table itself is
 * `rigs_data.ts`, generated from the same source.
 *
 * A `cam/` `op_` path moves *something*, but that something is rarely one
 * model. The objects that follow object paths are rigs assembled in code: a
 * draw routine walks the matrix stack, pushing a transform and calling
 * `AssetDrawSlot` for each part. There is no rig data in the asset files at
 * all -- the hierarchy only exists as instructions.
 *
 * **[proved]** There is no rig data to parse. The transforms and slot ids are
 * `PUSH imm32` in the instruction stream; 168 distinct functions call
 * `AssetDrawSlot`, where a data-driven format would have one interpreter; the
 * engine's one table-driven draw path is `RegionDrawResidentSet`, for static
 * scenery, and objects do not use it; and NL1 has no node hierarchy either.
 *
 * Conventions, all established in `docs/formats/cam.md`:
 *
 * * Translations are in level units, rotations in BAMS (65536 = a full turn).
 * * A part's transform is applied `T * Rz * Ry * Rx * S` in the engine's
 *   column-vector convention, the same order the object root uses.
 * * `MatrixStackPush(0)` duplicates the top, so every part in a routine is a
 *   **sibling** whose transform is relative to the object root -- not a chain.
 * * A part may draw more than one slot at the same transform.
 *
 * Parts whose rotation is driven at runtime carry `animated` describing the
 * rule rather than baking a frame of it in. Nothing here invents a value.
 */

import * as degraded from "./degraded";
import type { EvtFile, Spawn } from "./evt";
import type { Model } from "./nl1";
import { RIGS } from "./rigs_data";
import { loadAsset } from "./stage";
import type { Stage } from "./stage";
import type { Bank } from "./texbank";

export type Vec3 = [number, number, number];

/**
 * An object path the routine follows, and the camera paths that select it.
 *
 * Routines dispatch on `g_active_cam_path` (0x009A2D78) through a jump table
 * and pick a different `op_` slot per shot, so a rig is only present while the
 * camera is on one of `camPaths`. Those are `cp_` slots in the same 418-slot
 * space as `slot` itself, which is what makes them usable as a per-stage gate.
 */
export interface Route {
  /** `op_` slot passed to CamEvalObjectPath6. */
  slot: number;
  /** `cp_` slots that select this route. */
  camPaths?: number[];
  /** "clamped", "zero", or a rule. */
  frame?: string;
  /**
   * Evaluation time when the routine passes a **literal** rather than the
   * clamped camera frame, i.e. the object is parked at a fixed point on the
   * path. Absent means the usual `min(g_cam_path_frame, length[slot])`.
   */
  holdFrame?: number | null;
  /**
   * The frame past which the routine stops re-evaluating entirely and holds
   * the pose it last wrote -- a test in the routine, *not* the path length.
   */
  stopFrame?: number | null;
  /**
   * Added to the path *position* before the pose rotations are applied, so it
   * cannot be expressed as a child offset of the rotated anchor.
   */
  bias?: Vec3;
  note?: string;
}

/** A pose the routine hardcodes instead of evaluating a path. */
export interface FixedPose {
  translation: Vec3;
  rotation_bams?: Vec3;
  camPaths?: number[];
  note?: string;
}

/**
 * A part rotation the routine drives from an `op_` path channel.
 *
 * The angle is `scale * (channel + offsetBams)`, and the evaluation time is
 * the routine's own: `clamp(g_cam_path_frame, frameLo, frameHi) +
 * frameOffset`, or `frameDefault` when the frame falls outside that range.
 */
export interface PathRotation {
  slot: number;
  /** Which channel supplies the angle. */
  channel: string;
  /** "x", "y" or "z" -- the MatrixRotate. */
  axis: string;
  /** Applied after `offsetBams`. */
  scale?: number;
  offsetBams?: number;
  frameOffset?: number;
  frameLo?: number | null;
  frameHi?: number | null;
  frameDefault?: number | null;
  /** Shots where the rule applies. */
  camPaths?: number[];
  /** When the routine applies it at all. */
  condition?: string;
  note?: string;
}

export interface RigPart {
  name: string;
  /** AssetDrawSlot ids, drawn in order. */
  slots: number[];
  translation?: Vec3;
  /** `(rx, ry, rz)`. */
  rotation_bams?: Vec3;
  scale?: Vec3;
  /** SetDrawLayerNibble, if overridden. */
  drawLayer?: number | null;
  /** Runtime rule, not baked. */
  animated?: string;
  /** When the routine draws it at all. */
  condition?: string;
  /**
   * Machine-readable form of `condition` for the cases the player can act on.
   * `"moving"` means the routine draws the part only while the object's moving
   * flag is set, which is false whenever the route is parked or has run out.
   */
  hiddenUnless?: string;
  /** A rotation driven from a path channel rather than baked. */
  pathRotation?: PathRotation | null;
  /**
   * When the rig's class selects between prop sets with a parameter, the value
   * of that selector this part is drawn for. Absent means always.
   */
  variant?: number | null;
  /**
   * Name of the part this one hangs off, when the routine nests a push inside
   * another without popping. Empty means a child of the object root.
   */
  parent?: string;
  note?: string;
}

export interface Rig {
  name: string;
  /** The draw routine transcribed. */
  routine: string;
  /**
   * Global cam path slots the routine passes to CamEvalObjectPath6 as a
   * literal. Empty when it takes the slot from the object at runtime.
   */
  pathSlots?: number[];
  /** Routes the routine can follow, with the camera paths that select each. */
  routes?: Route[];
  /** Poses the routine hardcodes instead of evaluating a path. */
  fixedPoses?: FixedPose[];
  /**
   * True when the parts carry absolute world coordinates rather than offsets
   * from an object root.
   */
  worldSpace?: boolean;
  /**
   * Where the class's variant selector lives in the spawn parameter tail, as
   * `[offset, kind]`.
   */
  variantParam?: [number, string] | null;
  /** Where the object path slot lives in the parameter tail. */
  routeParam?: [number, string] | null;
  /** Where the object's *main* asset slot lives in the tail. */
  mainAssetParam?: [number, string] | null;
  /** Set when the rig is understood but cannot be *placed*, explaining why. */
  placementBlocked?: string;
  /**
   * Spawn class this rig belongs to, when the routine is a class handler. A
   * rig with a class can be placed at every spawn descriptor of that class.
   */
  spawnClass?: number | null;
  parts?: RigPart[];
  note?: string;
}

export { RIGS };

/** Every `op_` slot the rig can follow, from both spellings. */
export function allPathSlots(rig: Rig): number[] {
  const seen: number[] = [];
  for (const s of [...(rig.pathSlots ?? []),
                   ...(rig.routes ?? []).map((r) => r.slot)]) {
    if (!seen.includes(s)) seen.push(s);
  }
  return seen;
}

/** Every `cp_` slot that can select this rig. Empty means ungated. */
export function rigCamPaths(rig: Rig): number[] {
  const seen: number[] = [];
  for (const src of [...(rig.routes ?? []), ...(rig.fixedPoses ?? [])]) {
    for (const c of src.camPaths ?? []) if (!seen.includes(c)) seen.push(c);
  }
  return seen;
}

/** Parts in an order where a parent always precedes its children. */
export function orderedParts(rig: Rig): RigPart[] {
  const parts = rig.parts ?? [];
  const byName = new Map(parts.map((p) => [p.name, p]));
  const out: RigPart[] = [];
  const seen = new Set<string>();

  const emit = (p: RigPart, guard: Set<string>): void => {
    if (seen.has(p.name)) return;
    const parent = p.parent ? byName.get(p.parent) : undefined;
    if (parent !== undefined && !guard.has(p.parent!)) {
      emit(parent, new Set([...guard, p.name]));
    }
    seen.add(p.name);
    out.push(p);
  };

  for (const part of parts) emit(part, new Set());
  return out;
}

/** The rig that follows a given global cam path slot, if one is known. */
export function rigForSlot(pathSlot: number): Rig | null {
  for (const rig of RIGS) {
    if (allPathSlots(rig).includes(pathSlot)) return rig;
  }
  return null;
}

// ---------------------------------------------------------------------------
// resolution against a stage
// ---------------------------------------------------------------------------

export interface RigRoute {
  slot: number;
  bias: Vec3;
  cam_paths: number[];
  hold_frame: number | null;
  note: string;
  stop_frame: number | null;
}

export interface RigFixed {
  kind: string;
  translation: number[];
  rotation_bams: number[];
  cam_paths: number[];
  note: string;
}

export type PartModels = [RigPart, [Model, Bank | null, string][]];

export interface RigInstance {
  rig: Rig;
  routes: RigRoute[];
  parts: PartModels[];
  blocked: string;
  fixed: RigFixed[];
  world: boolean;
  placements: Record<string, unknown>[];
  /** Only prop rigs carry these; see `props.rigEntries`. */
  anchors?: Record<string, unknown>;
  biases?: Record<string, unknown>;
}

/** A cache of `pol/` assets shared by the rig and prop resolvers. */
export class AssetCache {
  private cache = new Map<string, [Model[], Bank | null]>();

  constructor(private readonly stage: Stage) {}

  async get(where: string, stem: string, what: string,
            lost: string): Promise<[Model[], Bank | null]> {
    const hit = this.cache.get(stem);
    if (hit) return hit;
    let got: [Model[], Bank | null];
    try {
      got = await loadAsset(this.stage.source, this.stage.tables, stem);
    } catch (exc) {
      // `where` is the caller's, spelled as Python's frame inspection would
      // have derived it: four call sites share this cache and each keeps its
      // own location in the degraded record.
      degraded.note(where, `${what} ${stem}`, lost, exc);
      got = [[], null];
    }
    this.cache.set(stem, got);
    return got;
  }
}

/** Just the part of a `Program` this resolver reads. */
export interface ProgramLike {
  blocks: { steps: { ops: { detail: Record<string, unknown> }[] }[] }[];
  evt: EvtFile | null;
}

/**
 * Which rigs this stage holds, with their part models loaded.
 *
 * A rig's parts name **asset slots**, which resolve through the EXE's slot
 * table to a pol file and an entry index -- and those files are deliberately
 * *not* in the stage geometry set, because they are spawnable actors rather
 * than placed scenery. So they are loaded here on demand.
 *
 * This lives in the library rather than in an exporter because two consumers
 * need it: the glTF exporter, which parents each rig under the baked animation
 * node of its route, and the browser player's bundle, which keeps the route as
 * a *path slot* and evaluates it at runtime.
 */
export async function resolveForStage(
    stage: Stage, prog: ProgramLike | null, spawnRecords: Spawn[] | null,
    bbox: unknown = null,
    cache: AssetCache = new AssetCache(stage)):
    Promise<[RigInstance[], Rig[]]> {
  const cp = await stage.campaths();
  const slots = stage.tables.assetSlots();
  const have = new Set<number>();
  const haveCam = new Set<number>();
  for (const r of cp.bySlot.values()) {
    (r.isObjectPath ? have : haveCam).add(r.slot);
  }

  // Spawn descriptors, grouped by class, so a rig that is a class handler can
  // be placed at every instance the event script puts in the stage.
  const placements = new Map<number, Record<string, unknown>[]>();
  // The same descriptors as `evt.Spawn` records, which can read the parameter
  // tail. **[proved]** the allocator behind spawn opcodes 0x0B/0x0C/0x0D ends
  // with `obj+0x1390 = descriptor + 0x24`, so a class handler reading
  // `obj+0x1390 + k` is reading `spawn.param(k)`.
  const raw = new Map<number, Spawn[]>();
  const wanted = new Set<number>();
  for (const r of RIGS) {
    if (r.spawnClass !== undefined && r.spawnClass !== null) {
      wanted.add(r.spawnClass);
    }
  }
  if (wanted.size && prog !== null) {
    for (const blk of prog.blocks) {
      for (const step of blk.steps) {
        for (const op of step.ops) {
          for (const sp of (op.detail.spawns as Record<string, unknown>[])
               ?? []) {
            const cls = sp.class as number;
            if (wanted.has(cls)) {
              let list = placements.get(cls);
              if (!list) { list = []; placements.set(cls, list); }
              list.push(sp);
            }
          }
        }
      }
    }
    for (const rec of spawnRecords ?? []) {
      if (wanted.has(rec.cls)) {
        let list = raw.get(rec.cls);
        if (!list) { list = []; raw.set(rec.cls, list); }
        list.push(rec);
      }
    }
  }

  const out: RigInstance[] = [];
  const blocked: Rig[] = [];
  for (const rig of RIGS) {
    const routes: RigRoute[] = [];

    const take = (slot: number | null | undefined,
                  camPaths: number[],
                  bias: Vec3 = [0.0, 0.0, 0.0],
                  holdFrame: number | null = null,
                  note = "",
                  stopFrame: number | null = null): void => {
      if (slot === null || slot === undefined || !have.has(slot)) return;
      if (camPaths.length && !camPaths.some((c) => haveCam.has(c))) return;
      // `note` and `holdFrame` travel with the route rather than being looked
      // up by slot later: a rig may ride the same op_ slot from two different
      // shots with different rules, which the stage-1 vehicle does.
      routes.push({ slot, bias: [...bias] as Vec3, cam_paths: [...camPaths],
                    hold_frame: holdFrame, note, stop_frame: stopFrame });
    };

    for (const slot of rig.pathSlots ?? []) take(slot, []);   // no cam gate
    for (const route of rig.routes ?? []) {
      take(route.slot, route.camPaths ?? [], route.bias ?? [0, 0, 0],
           route.holdFrame ?? null, route.note ?? "", route.stopFrame ?? null);
    }

    const fixed: RigFixed[] = (rig.fixedPoses ?? [])
      .filter((fp) => !(fp.camPaths ?? []).length
                      || (fp.camPaths ?? []).some((c) => haveCam.has(c)))
      .map((fp) => ({ kind: "fixed", translation: [...fp.translation],
                      rotation_bams: [...(fp.rotation_bams ?? [0, 0, 0])],
                      cam_paths: [...(fp.camPaths ?? [])],
                      note: fp.note ?? "" }));

    // Some classes select between prop sets, or pick a route, with a field of
    // the spawn parameter tail rather than a literal in the code. That field
    // is the real per-stage gate: a stage bounding box could never be one,
    // because levels span thousands of units and would accept absolute props
    // everywhere.
    const variants = new Set<number>();
    if (rig.variantParam && rig.spawnClass !== undefined
        && rig.spawnClass !== null) {
      const [at, kind] = rig.variantParam;
      for (const rec of raw.get(rig.spawnClass) ?? []) {
        const v = rec.param(at, kind as never);
        if (v) variants.add(v);
      }
    }
    if (rig.routeParam && rig.spawnClass !== undefined
        && rig.spawnClass !== null) {
      const [at, kind] = rig.routeParam;
      for (const rec of raw.get(rig.spawnClass) ?? []) {
        take(rec.param(at, kind as never), []);
      }
    }

    // A world-space rig has no root to place: its part translations are
    // already absolute, so it is emitted only when this stage actually spawns
    // a variant it draws.
    const world = Boolean(rig.worldSpace && !rig.placementBlocked
      && (rig.variantParam ? variants.size : bbox !== null));

    if (rig.placementBlocked) {
      blocked.push(rig);
      continue;
    }
    const placed = rig.spawnClass !== undefined && rig.spawnClass !== null
      ? placements.get(rig.spawnClass) ?? [] : [];
    if (!routes.length && !fixed.length && !world && !placed.length) continue;

    const parts: PartModels[] = [];
    for (const part of orderedParts(rig)) {
      if (part.variant !== undefined && part.variant !== null
          && !variants.has(part.variant)) {
        continue;
      }
      const models: [Model, Bank | null, string][] = [];
      for (const sid of part.slots) {
        const rec = slots.get(sid);
        if (!rec) continue;
        const stem = rec[0].endsWith(".bin") ? rec[0].slice(0, -4) : rec[0];
        const [ms, bank] = await cache.get(
          "hod2lib.rigs.resolve_for_stage", stem, "rig asset",
          "every rig built from it is dropped");
        if (rec[1] < ms.length) models.push([ms[rec[1]], bank, stem]);
      }
      if (models.length) parts.push([part, models]);
    }
    if (parts.length) {
      out.push({
        rig, routes, parts, blocked: rig.placementBlocked ?? "", fixed, world,
        placements: (rig.worldSpace || rig.routeParam || rig.variantParam)
          ? [] : placed,
      });
    }
  }
  return [out, blocked];
}

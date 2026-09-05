/**
 * Slot-keyed `cam/` path resolution. The port of `tools/hod2lib/campaths.py`.
 *
 * A `cam/` file numbers its paths from zero, but nothing in the game ever
 * refers to a path that way. Every consumer -- the event script's
 * `queue_event` sel `0x40`, the runtime descriptor array at `DAT_0059C9F8`,
 * the owning-file byte table at `DAT_004C479C` -- uses a **global slot id**
 * drawn from a single 0..417 space that all 23 files tile between them.
 *
 * This module is the one place that join is made. Give it a set of parsed
 * {@link CamFile} objects and an `ExeTables`, and it hands back
 * `{globalSlot: PathRef}`.
 *
 * Both the glTF exporter and the player bundle need exactly that mapping, and
 * having two copies of it is how the exported rails and the script's camera
 * events would come to disagree about which curve slot 59 is.
 *
 * Reference: docs/formats/cam.md, section *Binding*.
 */

import { CP_CHANNELS, OP_CHANNELS } from "./cam";
import type { CamFile, Curve, Path } from "./cam";

/** Just the part of `ExeTables` this module needs. */
export interface CamSlotSource {
  camSlotsFor(stem: string): number[];
}

/** One `cam/` path, addressed the way the game addresses it. */
export class PathRef {
  constructor(
    /** Global path slot id, 0..417. */
    readonly slot: number,
    /** Owning cam file stem, e.g. `cp_st2`. */
    readonly file: string,
    /** Path index within that file. */
    readonly index: number,
    /** The parsed curves. */
    readonly path: Path,
  ) {}

  get isObjectPath(): boolean {
    return this.file.startsWith("op_");
  }

  get channelNames(): string[] {
    return this.isObjectPath ? OP_CHANNELS : CP_CHANNELS;
  }

  /** Length in frames (the `cam/` timebase is 60 Hz frame numbers). */
  get duration(): number {
    return this.path.duration;
  }

  get startFrame(): number {
    for (const c of this.path.channels.values()) {
      if (c.keys.length) return c.keys[0].time;
    }
    return 0.0;
  }
}

/** The global path-slot space, resolved over a set of parsed cam files. */
export class CamPaths {
  bySlot = new Map<number, PathRef>();
  byFile = new Map<string, PathRef[]>();
  /**
   * What the parse could not make sense of, per file.
   *
   * `CamFile.warnings` -- a descriptor running past the end of the file, a
   * channel index that is not a curve start -- existed and was read by
   * `verify_phase6.py` alone, which runs over the *game directory*. Nothing on
   * the export path looked at it, so a stage whose `cam/` file had a bad
   * descriptor exported a bundle quietly missing those paths, and the camera
   * simply did not move where it should have.
   */
  warnings: string[] = [];

  constructor(tables: CamSlotSource | null, camFiles: Iterable<CamFile>) {
    for (const cf of camFiles) {
      for (const w of cf.warnings) this.warnings.push(`${cf.name}: ${w}`);
      const stem = cf.name.endsWith(".bin") ? cf.name.slice(0, -4) : cf.name;
      const slots = tables ? tables.camSlotsFor(stem) : [];
      const refs: PathRef[] = [];
      for (const path of cf.paths) {
        // The slot list is in path order; a file with no EXE entry (there are
        // none in the shipped game, but a caller may hand us a loose file)
        // simply has no global identity.
        if (path.index >= slots.length) continue;
        const slot = slots[path.index];
        if (slot < 0) continue;
        const ref = new PathRef(slot, stem, path.index, path);
        this.bySlot.set(slot, ref);
        refs.push(ref);
      }
      if (refs.length) this.byFile.set(stem, refs);
    }
  }

  get(slot: number): PathRef | undefined {
    return this.bySlot.get(slot);
  }

  has(slot: number): boolean {
    return this.bySlot.has(slot);
  }

  get size(): number {
    return this.bySlot.size;
  }

  get cameraSlots(): number[] {
    return [...this.bySlot.entries()]
      .filter(([, r]) => !r.isObjectPath).map(([s]) => s).sort((a, b) => a - b);
  }

  get objectSlots(): number[] {
    return [...this.bySlot.entries()]
      .filter(([, r]) => r.isObjectPath).map(([s]) => s).sort((a, b) => a - b);
  }

  /** One curve as `[[time, value, tangent_out, tangent_in], ...]`. */
  static channelJson(curve: Curve): number[][] {
    return curve.keys.map((k) => [k.time, k.value, k.tangent_out, k.tangent_in]);
  }

  pathJson(ref: PathRef): Record<string, unknown> {
    const keys: Record<string, number[][]> = {};
    for (const [n, c] of ref.path.channels) keys[n] = CamPaths.channelJson(c);
    const out: Record<string, unknown> = {
      file: ref.file,
      index: ref.index,
      start: ref.startFrame,
      duration: ref.duration,
      channels: keys,
    };
    // The eighth cp_ descriptor index no consumer reads. Recorded rather than
    // dropped: it is a real curve, and its purpose is still open.
    if (ref.path.trailing) out.trailing_curve = ref.path.trailing;
    return out;
  }

  /**
   * The `<stage>.cam.json` payload: raw Hermite curves, keyed by slot.
   *
   * Curves rather than baked samples, because the client must evaluate at an
   * arbitrary frame and must be able to highlight the `start..end` sub-range a
   * single `queue_event` command plays. A baked LINEAR animation can express
   * neither.
   */
  toJson(fps = 60.0): Record<string, unknown> {
    const paths: Record<string, unknown> = {};
    const objects: Record<string, unknown> = {};
    for (const slot of [...this.bySlot.keys()].sort((a, b) => a - b)) {
      const ref = this.bySlot.get(slot)!;
      (ref.isObjectPath ? objects : paths)[String(slot)] = this.pathJson(ref);
    }
    return { fps, paths, object_paths: objects, warnings: this.warnings };
  }
}

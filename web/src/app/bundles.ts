/**
 * Every stage this page can open, and which bundle each one comes from.
 *
 * There are two bundles and they are live at once: the one the page was
 * served out of `extract/player/`, and the one the browser exported for
 * itself into the Origin Private File System. A page can hold four of the
 * first and two of the second, so "which bundle am I playing" is not a
 * question with one answer -- it is a question per stage, and this is what
 * answers it.
 *
 * **The cache wins.** An export you made in this tab is the more recent
 * statement about that stage, and it is the only one you can rebuild. The
 * served bundle fills in the rest.
 *
 * **A stage is only offered from a source whose version lines up.** That is
 * two checks, both already in `bundle/load.ts`: the manifest's `format` and
 * schema digest, and then each entry's own `format`, which the manifest's does
 * not imply -- the exporter carries forward entries it did not rebuild. A
 * stage that fails either is not in the index, so it is rebuilt rather than
 * loaded, which is the whole point of keeping the install around.
 */

import { builderDrift, loadManifest, serverSource, stageBuilderStale,
         stageFormatRefusal } from "../bundle";
import type { BundleSource } from "../bundle/load";
import type { Manifest, StageEntry } from "../bundle/manifest";
import { GameMode } from "../game/game_mode";
import { cacheSource } from "./install";

/** Which of the two bundles a stage came out of. */
export type Origin = "server" | "cache";

export interface StageSlot {
  stage: number;
  original: boolean;
  entry: StageEntry;
  from: Origin;
  /**
   * Built by an exporter that is not the one in this page.
   *
   * Readable, playable, and probably a little wrong. See
   * {@link stageBuilderStale}; the page says so rather than refusing.
   */
  stale: boolean;
}

/** Every stage number the game has, which is what the page can offer to build. */
export const ALL_STAGES = [1, 2, 3, 4, 5, 6];

/**
 * How a stage and its mode name one slot.
 *
 * Exported because three files were spelling `${stage}:${original ? 1 : 0}`
 * out by hand and any one of them could have written it differently.
 */
export function slotKey(stage: number, original: boolean): string {
  return `${stage}:${original ? 1 : 0}`;
}

export class BundleIndex {
  private slots = new Map<string, StageSlot>();

  /**
   * The merged manifest, for the parts of the page that describe *a* bundle
   * rather than a stage: the build stamp in the status line, the projection
   * the renderer sets up from. The cache's is preferred for the same reason
   * its stages are, and `stages` is the merged list so the picker and the
   * loader cannot disagree about what exists.
   */
  manifest: Manifest | null = null;

  /** Why a source contributed nothing, by source. Empty when both loaded. */
  readonly refusals = new Map<Origin, string>();

  /**
   * Each source's per-file exporter digests, for naming what went out of date.
   *
   * Per source rather than off {@link BundleIndex.manifest}, which is the
   * *merged* one and therefore whichever source happened to answer first. The
   * two can disagree -- a cache built ten minutes ago beside a served bundle
   * from last week is the ordinary case -- and the files that moved under the
   * stale one are the only ones worth naming.
   */
  private readonly builderFiles = new Map<Origin, Record<string, string>>();

  /** Re-read both manifests. Called at startup and after every export. */
  async refresh(): Promise<void> {
    this.slots.clear();
    this.refusals.clear();
    this.builderFiles.clear();
    let merged: Manifest | null = null;
    const entries: StageEntry[] = [];

    // Cache first, so its stages are the ones that survive the `has` below.
    for (const from of ["cache", "server"] as const) {
      let m: Manifest;
      try {
        m = await loadManifest(sourceOf(from));
      } catch (err) {
        this.refusals.set(from, err instanceof Error ? err.message : String(err));
        continue;
      }
      merged ??= m;
      if (m.builder?.files) this.builderFiles.set(from, m.builder.files);
      for (const entry of m.stages) {
        if (stageFormatRefusal(entry.name, entry.format)) continue;
        const stage = entry.stage ?? entry.scene;
        const original = entry.game_mode === GameMode.Original;
        const k = slotKey(stage, original);
        if (this.slots.has(k)) continue;
        this.slots.set(k, { stage, original, entry, from,
                            stale: stageBuilderStale(entry.builder) });
        entries.push(entry);
      }
    }

    entries.sort((a, b) => ((a.stage ?? a.scene) - (b.stage ?? b.scene))
      || a.name.localeCompare(b.name));
    this.manifest = merged ? { ...merged, stages: entries } : null;
  }

  /** The stage, or undefined when neither bundle holds a version we can read. */
  find(stage: number, original: boolean): StageSlot | undefined {
    return this.slots.get(slotKey(stage, original));
  }

  /** Every stage either bundle holds, in order. */
  built(): StageSlot[] {
    return [...this.slots.values()].sort(
      (a, b) => a.stage - b.stage || Number(a.original) - Number(b.original));
  }

  /**
   * Every stage that is out of date, and what changed since it was built.
   *
   * The list is what the Bundle button warns about; the names are what its
   * tooltip cannot fit and the bundle screen can.
   */
  stale(): StageSlot[] {
    return this.built().filter((s) => s.stale);
  }

  /** Which exporter files moved since the stale stages were built. */
  get drift(): string[] {
    const out = new Set<string>();
    for (const s of this.stale()) {
      for (const n of builderDrift(this.builderFiles.get(s.from))) out.add(n);
    }
    return [...out].sort();
  }

  /** Whether anything at all can be played. */
  get empty(): boolean {
    return this.slots.size === 0;
  }
}

/** The reader for a source. */
export function sourceOf(from: Origin): BundleSource {
  return from === "cache" ? cacheSource : serverSource;
}

/**
 * What one stage's two JSON files add up to, and how they are fetched.
 *
 * Part of the bundle the exporter writes; see docs/formats/ for each block.
 */

import type { CamJson } from "./cameras";
import type { CharactersJson } from "./characters";
import { SUPPORTED_FORMAT } from "./manifest";
import type { Manifest, StageEntry } from "./manifest";
import { SCHEMA_FILES, SCHEMA_HASH } from "./schema_hash";
import type { BackdropJson, BreakablesJson, PropsJson, RainJson, RigsJson,
              CiviliansJson, HumanoidProgramJson, SetPieceParamsJson,
              SoundJson } from "./scene";
import type { BlockJson, ColiJson, RegionEntryJson } from "./script";
import type { BgmJson } from "./sound";

export interface ScriptJson {
  /**
   * `BUNDLE_FORMAT` at the time this file was written — see
   * {@link StageEntry.format}. Absent in a stage written before format 3.
   */
  format?: number;
  scene: number;
  stage: number | null;
  /** `g_GameMode` as the exe numbers it — see `game/game_mode.ts`. */
  game_mode: number;
  evt_file: string;
  entry_block: number;
  /** Which step of the entry block runs first; the game picks it by mode. */
  entry_step: number;
  routes: { kind: string; next: number[] }[];
  blocks: BlockJson[];
  regions: RegionEntryJson[][];
  cam_slots_used: number[];
  bgm?: BgmJson;
  sound?: SoundJson;
  backdrop?: BackdropJson;
  rigs?: RigsJson;
  characters?: CharactersJson;
  props?: PropsJson;
  breakables?: BreakablesJson;
  /** Class 0x24's parameter tail, keyed by spawn address. */
  set_pieces?: Record<string, SetPieceParamsJson>;
  /** Class 0x25's decoded bytecode, keyed by spawn address. */
  humanoids?: Record<string, HumanoidProgramJson>;
  /** Class 0x10's civilians: the exe's scripts, and who runs which. */
  civilians?: CiviliansJson;
  rain?: RainJson;
  /** The `coli/` blobs this scene loads — see {@link ColiJson}. */
  coli?: ColiJson;
  warnings: string[];
}

export interface StageBundle {
  entry: StageEntry;
  script: ScriptJson;
  cam: CamJson;
  geometryUrl: string;
}

// -- loading ---------------------------------------------------------------

const ROOT = "bundle";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

/**
 * Which of these declarations the bundle disagrees with, by name.
 *
 * The digest alone can only say *that* something moved. Naming the files is
 * the difference between a message you act on and one you learn to ignore,
 * and it costs eight strings in the manifest.
 */
function schemaDrift(theirs: Record<string, string> | undefined): string[] {
  const names = new Set([...Object.keys(SCHEMA_FILES),
                         ...Object.keys(theirs ?? {})]);
  return [...names].filter((n) => SCHEMA_FILES[n] !== theirs?.[n]).sort();
}

export async function loadManifest(): Promise<Manifest> {
  const m = await getJson<Manifest>(`${ROOT}/manifest.json`);
  if (m.format !== SUPPORTED_FORMAT) {
    throw new Error(
      `bundle format ${m.format}, this client reads ${SUPPORTED_FORMAT}. ` +
        `Rebuild with tools/export_player.py.`,
    );
  }
  // **This refuses rather than warns, and the reason is what the failure
  // looks like when it is not caught.** A bundle whose shape does not match
  // the declarations reading it does not crash: `getJson<T>` is a bare cast,
  // so a renamed field arrives as `undefined` and the stage renders *almost*
  // right — no enemies in one region, a camera that never turns — which is
  // indistinguishable from a gameplay bug and has cost this project days more
  // than once. A warning in a console nobody has open is not a check.
  //
  // The cost of refusing is one re-export, and only when a declaration
  // actually changed: the digest covers the declarations, not the file, so
  // editing a doc comment here costs nothing. See `tools/hod2lib/schema.py`.
  if (m.schema?.hash !== SCHEMA_HASH) {
    const drift = schemaDrift(m.schema?.files);
    throw new Error(
      `this bundle was exported against a different web/src/bundle/ schema` +
        (drift.length ? `: ${drift.join(", ")} changed since` : "") +
        `. Rebuild with tools/export_player.py.`,
    );
  }
  return m;
}

/** The stage's own version, which the manifest's does not imply. */
function checkStageFormat(what: string, format: number | undefined): void {
  if (format === SUPPORTED_FORMAT) return;
  throw new Error(
    `${what} is bundle format ${format ?? "(none)"}, this client reads ` +
      `${SUPPORTED_FORMAT}. It was carried into this bundle from an older ` +
      `export; rebuild it with tools/export_player.py --all.`,
  );
}

export async function loadStage(entry: StageEntry): Promise<StageBundle> {
  checkStageFormat(entry.name, entry.format);
  const dir = `${ROOT}/${entry.name}`;
  const [script, cam] = await Promise.all([
    getJson<ScriptJson>(`${dir}/${entry.script}`),
    getJson<CamJson>(`${dir}/${entry.cam}`),
  ]);
  // The manifest entry and the files it names are written together but do not
  // travel together: a stage directory copied in from another bundle keeps its
  // own format while the entry indexing it says whatever this export said.
  checkStageFormat(entry.script, script.format);
  checkStageFormat(entry.cam, cam.format);
  return { entry, script, cam, geometryUrl: `${dir}/${entry.geometry}` };
}

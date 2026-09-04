/**
 * Fetching a bundle, and refusing one this client cannot read.
 *
 * **Split out of `stage.ts` because the schema digest hashes this directory,
 * and code is not a declaration.** `schema.py` globbed `web/src/bundle/*.ts`,
 * so every one of the refusal strings below was part of the hash that decides
 * whether an exported bundle is still valid — and rewording one of them
 * invalidated every bundle on disk and demanded a full re-export for a change
 * that cannot alter a single byte of a bundle. The digest was supposed to cost
 * nothing to keep, and a check that expensive to satisfy is a check that gets
 * deleted.
 *
 * So the boundary is now structural: `schema.py` names the declaration files
 * it hashes, and `verify_exporters.py` fails if one of them grows runtime
 * code. Declarations describe what a bundle contains; this file decides what
 * to do about it, and only the former can be disagreed with by a bundle.
 */
import type { CamJson } from "./cameras";
import { SUPPORTED_FORMAT } from "./manifest";
import type { Manifest, StageEntry } from "./manifest";
import { SCHEMA_FILES, SCHEMA_HASH } from "./schema_hash";
import type { ScriptJson, StageBundle } from "./stage";


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

/**
 * Why this client will not read this manifest, or `null` if it will.
 *
 * Split out of {@link loadManifest} and pure, for the reason `snapshotRefusal`
 * is: **a refusal nothing can call is a refusal nothing tests.** Both of the
 * checks below went in green against a bundle they should have rejected —
 * `extract/player` was format 2 while `SUPPORTED_FORMAT` was 3 — because every
 * test reads the bundle's JSON directly and none of them goes through
 * `loadManifest`. That is the same shape as F7-F10 in the review: the property
 * was right and the thing measuring it could not fire. `test:bundle` drives
 * this function, so now it can.
 */
export function manifestRefusal(m: Manifest | null | undefined): string | null {
  if (!m || typeof m !== "object") return "not a manifest";
  if (m.format !== SUPPORTED_FORMAT) {
    return `bundle format ${m.format}, this client reads ${SUPPORTED_FORMAT}. `
      + `Rebuild with tools/export_player.py.`;
  }
  // **This refuses rather than warns, and the reason is what the failure
  // looks like when it is not caught.** A bundle whose shape does not match
  // the declarations reading it does not crash: `getJson<T>` is a bare cast,
  // so a renamed field arrives as `undefined` and the stage renders *almost*
  // right -- no enemies in one region, a camera that never turns -- which is
  // indistinguishable from a gameplay bug and has cost this project days more
  // than once. A warning in a console nobody has open is not a check.
  //
  // The cost of refusing is one re-export, and only when a declaration
  // actually changed: the digest covers the declarations, not the file, so
  // editing a doc comment here costs nothing. See `tools/hod2lib/schema.py`.
  if (m.schema?.hash !== SCHEMA_HASH) {
    const drift = schemaDrift(m.schema?.files);
    return `this bundle was exported against a different web/src/bundle/ `
      + `schema`
      + (drift.length ? `: ${drift.join(", ")} changed since` : "")
      + `. Rebuild with tools/export_player.py.`;
  }
  return null;
}

export async function loadManifest(): Promise<Manifest> {
  const m = await getJson<Manifest>(`${ROOT}/manifest.json`);
  const no = manifestRefusal(m);
  if (no) throw new Error(no);
  return m;
}

/** The stage's own version, which the manifest's does not imply. */
export function stageFormatRefusal(what: string,
                                   format: number | undefined): string | null {
  if (format === SUPPORTED_FORMAT) return null;
  return `${what} is bundle format ${format ?? "(none)"}, this client reads `
    + `${SUPPORTED_FORMAT}. It was carried into this bundle from an older `
    + `export; rebuild it with tools/export_player.py --all.`;
}

function checkStageFormat(what: string, format: number | undefined): void {
  const no = stageFormatRefusal(what, format);
  if (no) throw new Error(no);
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

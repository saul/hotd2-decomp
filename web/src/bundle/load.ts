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
import { BUILDER_FILES, BUILDER_HASH } from "./builder_hash";
import { SCHEMA_FILES, SCHEMA_HASH } from "./schema_hash";
import type { ScriptJson, StageBundle } from "./stage";


const ROOT = "bundle";

/**
 * Where a bundle's files come from.
 *
 * There are two, and they are live at the same time: the dev server, which
 * serves `extract/player/` under `/bundle/`, and the browser's own cache,
 * which holds the exports the page made for itself. They have the same tree
 * and the same names, so this is the whole difference between them -- one
 * `fetch`, or one `File` out of the Origin Private File System.
 *
 * Which one a *stage* comes from is decided per stage, in `app/bundles.ts`,
 * because a page can perfectly well be served four stages and hold two of its
 * own. Nothing here holds a current source: every call names the one it means.
 *
 * `geometry` is separate from `json` because a GLB is handed to three.js as a
 * URL rather than parsed here, and a cached one has to become a `blob:` URL
 * that is later revoked. {@link releaseGeometry} is that revoke.
 */
export interface BundleSource {
  json<T>(path: string): Promise<T>;
  geometry(path: string): Promise<string>;
  release?(url: string): void;
}

/** The bundle the page was served, under `/bundle/`. */
export const serverSource: BundleSource = {
  async json<T>(path: string): Promise<T> {
    const url = `${ROOT}/${path}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
    return (await r.json()) as T;
  },
  async geometry(path: string): Promise<string> {
    return `${ROOT}/${path}`;
  },
};

/**
 * Give back whatever {@link loadStage} handed out as `geometryUrl`.
 *
 * The source is passed because it has to be the one that handed the URL out:
 * a `blob:` from the cache must be revoked and an `http:` from the server must
 * not, and by the time a stage is torn down the *next* stage may already be
 * loading from the other one.
 */
export function releaseGeometry(src: BundleSource, url: string): void {
  src.release?.(url);
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
      + `Rebuild it: \`npm run export -- --game-dir "..." --all\`, or from `
      + `your install in the page.`;
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
  // editing a doc comment here costs nothing. See `tools/gen_schema_hash.py`.
  if (m.schema?.hash !== SCHEMA_HASH) {
    const drift = schemaDrift(m.schema?.files);
    return `this bundle was exported against a different web/src/bundle/ `
      + `schema`
      + (drift.length ? `: ${drift.join(", ")} changed since` : "")
      + `. Rebuild it: \`npm run export -- --game-dir "..." --all\`.`;
  }
  return null;
}

export async function loadManifest(src: BundleSource): Promise<Manifest> {
  const m = await src.json<Manifest>("manifest.json");
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
    + `export; rebuild it with \`npm run export -- --all\`.`;
}

/**
 * Is this stage older than the exporter that would build it now?
 *
 * **This warns; it does not refuse**, and the difference from
 * {@link stageFormatRefusal} beside it is the whole design. A format or schema
 * mismatch means the bundle cannot be read correctly and using it produces a
 * stage that renders *almost* right, so it is refused. An exporter change
 * usually means the bundle reads perfectly and is a little out of date --
 * refusing would make every unrelated fix in `hod2lib/` cost a forty-minute
 * re-export before anything could be opened at all.
 *
 * The case this exists for: `nl1.dropCollapsedUvTriangles` was deleting 3-5%
 * of every stage's geometry, and switching it off moved no declaration and no
 * `BUNDLE_FORMAT`. A stage already in the browser's cache therefore went on
 * winning over the rebuilt one -- with holes in it -- however many times the
 * tree was exported, and nothing on the page said why.
 */
export function stageBuilderStale(builder: string | undefined): boolean {
  return builder !== BUILDER_HASH;
}

/**
 * Which of the exporter's files moved since this bundle was built, by name.
 *
 * The same reasoning as {@link schemaDrift}: the digest can only say *that*
 * something changed, and a message you can act on names it. Empty when the
 * bundle predates the digest entirely, which is its own answer.
 */
export function builderDrift(theirs: Record<string, string> | undefined):
    string[] {
  if (!theirs) return [];
  const names = new Set([...Object.keys(BUILDER_FILES), ...Object.keys(theirs)]);
  return [...names].filter((n) => BUILDER_FILES[n] !== theirs[n]).sort();
}

function checkStageFormat(what: string, format: number | undefined): void {
  const no = stageFormatRefusal(what, format);
  if (no) throw new Error(no);
}

export async function loadStage(src: BundleSource,
                                entry: StageEntry): Promise<StageBundle> {
  checkStageFormat(entry.name, entry.format);
  const dir = entry.name;
  const [script, cam] = await Promise.all([
    src.json<ScriptJson>(`${dir}/${entry.script}`),
    src.json<CamJson>(`${dir}/${entry.cam}`),
  ]);
  // The manifest entry and the files it names are written together but do not
  // travel together: a stage directory copied in from another bundle keeps its
  // own format while the entry indexing it says whatever this export said.
  checkStageFormat(entry.script, script.format);
  checkStageFormat(entry.cam, cam.format);
  return { entry, script, cam,
           geometryUrl: await src.geometry(`${dir}/${entry.geometry}`) };
}

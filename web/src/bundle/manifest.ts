/**
 * The manifest and its stage entries.
 *
 * Part of the bundle the exporter writes; see docs/formats/ for each block.
 */

/**
 * The `format` this client reads, and the exporter's `BUNDLE_FORMAT` must
 * match it exactly. Both sat at 1 through every shape change either side ever
 * made — `coli`, `civilians`, `humanoids`, `set_pieces`, the renumbered
 * `game_mode` — so this check has never once been able to fire, and a bundle
 * built before collision existed loaded and silently lost it.
 *
 * The two constants move together, in the same commit as the shape change.
 *
 * **This is the coarse half of the contract and it is not the half that will
 * fire**, for the reason above: bumping it is something a person has to
 * remember. {@link Manifest.schema} is the half nobody has to remember. Move
 * this one when the *layout* changes — a file added to a stage directory, a
 * block renamed — and let the digest catch the field-level drift.
 *
 * 3: the manifest carries a schema digest and every stage carries its own
 * `format`. See `docs/formats/bundle.md`.
 *
 * 4: `<stage>.cam.json` carries `warnings`, the `cam/` decoder's own — the
 * counterpart of {@link ScriptJson.warnings}, which had travelled since the
 * beginning while the camera's were produced and read by nothing on the export
 * path. And the schema digest is taken over a **named** set of declaration
 * files rather than everything in this directory, so the loader's refusal
 * strings are no longer part of what invalidates a bundle.
 */
export const SUPPORTED_FORMAT = 4;

/**
 * The exporter's digest of the declarations in this directory.
 *
 * Compared against `schema_hash.ts`, which is generated from the same sources
 * and compiled into the client. See {@link SCHEMA_HASH} and
 * `tools/gen_schema_hash.py`.
 */
export interface SchemaDigest {
  /** One digest over {@link SchemaDigest.files}, in filename order. */
  hash: string;
  /** Per file, so a mismatch can name the block that moved. */
  files: Record<string, string>;
}

/**
 * The digest of the exporter that wrote this bundle.
 *
 * The other half of the contract from {@link SchemaDigest}, and it answers a
 * different question. The schema digest says whether this client can *read*
 * the bundle, and a mismatch is a refusal. This says whether the bundle is
 * what today's exporter would write, and a mismatch is a **warning**: the
 * bundle is readable and merely out of date.
 *
 * Absent on anything built before this existed, which is itself out of date.
 *
 * See `tools/gen_builder_hash.py` for why it is here at all -- an exporter fix
 * that changes no declaration used to leave a stale copy in the browser's
 * cache winning over the rebuilt one for ever.
 */
export interface BuilderDigest {
  /** One digest over {@link BuilderDigest.files}, in filename order. */
  hash: string;
  /** Per file, so a stale bundle can name what moved. */
  files: Record<string, string>;
}

export interface Manifest {
  format: number;
  /**
   * Absent in a bundle built before format 3, which the `format` check above
   * refuses first — so a `schema` this client reads is always present.
   */
  schema?: SchemaDigest;
  /** See {@link BuilderDigest}. Absent on a bundle built before it existed. */
  builder?: BuilderDigest;
  tool: string;
  tool_version: string;
  built: string;
  game_dir: string;
  fps: number;
  projection: {
    yfov_deg: number;
    yfov_bams: number;
    aspect: number;
    znear: number;
    zfar: number;
  };
  stages: StageEntry[];
  notes?: Record<string, unknown>;
}

export interface StageEntry {
  name: string;
  /**
   * The format **this stage** was written in, which is not necessarily the
   * manifest's: the exporter carries forward the entries a partial
   * export did not rebuild, so a fresh manifest can index a stage directory
   * an older tool wrote. Absent on an entry carried from before format 3.
   */
  format?: number;
  /**
   * The exporter **this stage** was written by — {@link BuilderDigest.hash}.
   *
   * On the entry rather than only on the manifest for the same reason
   * {@link StageEntry.format} is: a partial export carries forward the entries
   * it did not rebuild, and the browser's cache is nothing *but* partial
   * exports. One stage at a time is how that cache is filled, so one stage at
   * a time is how it goes out of date.
   */
  builder?: string;
  stage: number | null;
  scene: number;
  /** `g_GameMode` as the exe numbers it — see `game/game_mode.ts`. */
  game_mode: number;
  geometry: string;
  cam: string;
  script: string;
  counts: Record<string, number>;
  sources: Record<string, string>;
}

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
 */
export const SUPPORTED_FORMAT = 3;

/**
 * The exporter's digest of the declarations in this directory.
 *
 * Compared against `schema_hash.ts`, which is generated from the same sources
 * and compiled into the client. See {@link SCHEMA_HASH} and
 * `tools/hod2lib/schema.py`.
 */
export interface SchemaDigest {
  /** One digest over {@link SchemaDigest.files}, in filename order. */
  hash: string;
  /** Per file, so a mismatch can name the block that moved. */
  files: Record<string, string>;
}

export interface Manifest {
  format: number;
  /**
   * Absent in a bundle built before format 3, which the `format` check above
   * refuses first — so a `schema` this client reads is always present.
   */
  schema?: SchemaDigest;
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
   * manifest's: `export_player.py` carries forward the entries a partial
   * export did not rebuild, so a fresh manifest can index a stage directory
   * an older tool wrote. Absent on an entry carried from before format 3.
   */
  format?: number;
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

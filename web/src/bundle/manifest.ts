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
 */
export const SUPPORTED_FORMAT = 2;

export interface Manifest {
  format: number;
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

/**
 * The manifest and its stage entries.
 *
 * Part of the bundle the exporter writes; see docs/formats/ for each block.
 */

export const SUPPORTED_FORMAT = 1;

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

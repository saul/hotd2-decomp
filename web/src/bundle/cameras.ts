/**
 * The `cam/` curves: one path per slot, four keys per frame.
 *
 * Part of the bundle the exporter writes; see docs/formats/ for each block.
 */

// -- cameras ---------------------------------------------------------------

/** One Hermite key: `[time, value, tangentOut, tangentIn]`. */
export type Key = [number, number, number, number];

export interface CamPathJson {
  file: string;
  index: number;
  start: number;
  duration: number;
  /** `eye_x`…`roll` for a `cp_` path, `pos_x`…`rot_z` for an `op_` one. */
  channels: Record<string, Key[]>;
  trailing_curve?: number;
}

export interface CamJson {
  /**
   * `BUNDLE_FORMAT` at the time this file was written. Every file in a stage
   * directory carries it, because a manifest is rewritten by any export and
   * these are not — see {@link StageEntry.format}.
   */
  format?: number;
  fps: number;
  /** Keyed by **global path slot**, which is what a `cam_play` operand is. */
  paths: Record<string, CamPathJson>;
  object_paths: Record<string, CamPathJson>;
}

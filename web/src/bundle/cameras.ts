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
  /**
   * What the `cam/` parse could not make sense of — a descriptor past the end
   * of the file, a channel index that is not a curve start.
   *
   * The counterpart of {@link ScriptJson.warnings}, and it was missing: the
   * decoder produced these and only a verifier that runs over the game
   * directory ever read them, so a stage exported with paths quietly dropped
   * and the camera not moving where it should. Absent in a bundle written
   * before format 4.
   */
  warnings?: string[];
}

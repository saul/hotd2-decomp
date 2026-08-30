/**
 * The evt bytecode as the exporter decodes it: blocks, steps,
 * instructions, spawns and regions.
 *
 * Part of the bundle the exporter writes; see docs/formats/ for each block.
 */

// -- script ----------------------------------------------------------------

export interface SpawnJson {
  at: number;
  class: number;
  flags: number;
  pos: [number, number, number];
  yaw_deg: number;
  orient: [number, number, number];
  hp: number;
}

/**
 * One decoded instruction. The fields beyond the first five vary by opcode --
 * they are whatever `hod2lib.script` could resolve. An opcode whose meaning is
 * still only "the global it writes" carries `raw` and nothing else, and the
 * event feed shows those operands verbatim rather than inventing a label.
 */
export interface OpJson {
  i: number;
  at: number;
  op: number;
  name: string;
  cat: string;

  region?: number;
  slot?: number;
  entry?: number;
  file?: string;
  pol?: number;
  tex?: number;

  sel?: number;
  action?: string;
  args?: number[];
  start?: number;
  end?: number;
  flags?: number;
  static?: boolean;
  resume?: boolean;
  cam?: { file: string; path: number; duration: number } | null;

  spawns?: SpawnJson[];
  scene_state?: { major: number | string; minor: number };
  camera_state?: string | null;
  branch_preview?: {
    choice: number;
    frame: number;
    slot: number;
    cam: { file: string; path: number } | null;
  }[];
  use_fixed_eye_y?: boolean;
  camera_fixed_eye_y?: number | null;
  force_path_advance?: boolean;
  arg?: number;
  blocks_on?: string;
  flag?: number;
  sound?: number;
  track?: number;
  roll_enabled?: boolean;
  enabled?: boolean;
  ground_y?: number;
  /** evt `0x2D`: the dialogue group to look up. */
  message_group?: number;
  value?: number;
  /**
   * A plain-English reading of `value` for the opcodes whose operand space is
   * small, closed and fully read out of the handler — `0x1C`, `0x1D`, `0x1F`
   * and `0x2C`. The exporter supplies it so the meaning travels with the
   * instruction instead of being reinvented in the client.
   */
  means?: string;
  /** evt `0x1F`: what this shutter state does to the firing gate, if anything. */
  firing_gate?: boolean;
  /** evt `0x2C`: true opens the skippable region, false closes it. */
  open?: boolean;
  light_block?: number;
  channel?: number;
  channel_name?: string;
  components?: number[];
  /** `0x21` animates by a per-frame rate, `0x23` over a frame count. */
  tween?: "rate" | "time";
  rate?: number;
  frames?: number;
  pitch_deg?: number;
  yaw_deg?: number;
  raw?: string[];
  [k: string]: unknown;
}

export interface StepJson {
  index: number;
  at: number;
  ops: OpJson[];
}

export interface BlockJson {
  index: number;
  at: number;
  route: { kind: "goto" | "branch" | "end" | string; next: number[] };
  hole?: boolean;
  steps?: StepJson[];
  external_steps?: { index: number; ptr: number }[];
}

export interface RegionEntryJson {
  slot: number;
  draw_mode: number;
  file: string;
  entry: number;
}

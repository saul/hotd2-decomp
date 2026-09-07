/**
 * One `coli/` blob — the collision the engine itself queries.
 *
 * Flat arrays per blob, the way the baked motions are: `plane` is `4n`,
 * `verts` `12n` (four corners, three floats each), `axis` and `surface` `n`.
 * `axis` is the **dominant** axis, 0 = X, 1 = Y, 2 = Z, and it names the
 * component the point-in-quad test drops.
 *
 * The AABB is stored max-then-min in the file; the exporter writes it back out
 * as an honest pair, because reading it the file's way round gives an inverted
 * box that rejects everything.
 */
export interface ColiBlob {
  min: number[];
  max: number[];
  n: number;
  plane: number[];
  verts: number[];
  axis: number[];
  surface: number[];
}

/**
 * A scene's collision. `ColiLoadForScene` loads two files — `coli0.bin` for
 * every scene plus `coli<scene+1>.bin` — and the event script selects blobs
 * out of them by pointer, which resolves to the `"<file>:<offset>"` key here.
 */
export interface ColiJson {
  files: string[];
  blobs: Record<string, ColiBlob>;
  note?: string;
}

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
  /**
   * The descriptor's `+0x20` word. `SpawnFromDescriptor` (`FUN_00408A20`)
   * copies it to `obj+0x1316` and both combat classes make it the low half of
   * their flag word `obj+0x136C` — `EnemyThrowerInit` (`FUN_00449620`) with
   * `| 0x180000`, `EnemyZombieInit` (`FUN_00452DA0`) with `| 0x60000000`.
   *
   * The exporter used to drop it as "unused in every shipped file". It is not:
   * 23 of 51 class-0x31 and 76 of 345 class-0x30 descriptors set it. See
   * `docs/formats/evt.md`.
   */
  desc_flags: number;
}

/**
 * `spawn_simple` (0x0A) and its two gated forms: the whole operand.
 *
 * `EvtOpSpawnSimple0A` (`FUN_00408990`) takes a two-word `{class, hp}` record
 * rather than a 0x24-byte placement descriptor, so there is no position, no
 * orientation and no tail — the object places itself. The four the shipped
 * scripts name live in `comevtbl.bin` and are the screen furniture: the
 * chapter card (class 0x60), the result card (0x61) and its two companions.
 */
export interface SimpleSpawnJson {
  class: number;
  /** `(short)record[1]`, into both `obj+0x11C` and `obj+0x11E`. */
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
  /** `spawn_simple` (0x02/0x06/0x0A) — see {@link SimpleSpawnJson}. */
  simple?: SimpleSpawnJson[];
  scene_state?: { major: number | string; minor: number };
  camera_state?: string | null;
  /** `goto_scene_state` / `goto_scene_state_when_alive` (0x31/0x32). */
  scene_state_minor?: number;
  /** `set_action_drain_mode` (0x33): the ring's dequeue mode. */
  drain_mode?: number;
  /** `set_action_drain_mode` (0x33): added to the pending count, **unsigned**
   *  in the bundle -- every one of the 128 in the game is -1. */
  pending_delta?: number;
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
  /**
   * evt `0x10` / `0x11`: the `coli/` blobs this instruction selects into the
   * full or the ray-only set, each resolved to the `{file, offset}` pair that
   * keys `ColiJson.blobs`.
   */
  meshes?: { file?: string; offset?: number; operand: number; address: number;
             quads?: number; surfaces?: number[] }[];
  set?: "full" | "ray";
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

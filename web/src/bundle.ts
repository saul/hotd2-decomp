/**
 * The bundle `tools/export_player.py` writes, and the types the rest of the
 * client reads it through.
 *
 * Nothing here parses a game format. Every one of them was decoded once, in
 * Python (`hod2lib`), and this is the shape that decoding is handed over in.
 * See docs/PLAYER_PLAN.md for why the split is that way round.
 */

/** Bumped when the on-disk shape changes in a way the client must notice. */
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
  game_mode: number;
  geometry: string;
  cam: string;
  script: string;
  counts: Record<string, number>;
  sources: Record<string, string>;
}

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
  fps: number;
  /** Keyed by **global path slot**, which is what a `cam_play` operand is. */
  paths: Record<string, CamPathJson>;
  object_paths: Record<string, CamPathJson>;
}

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
  value?: number;
  light_block?: number;
  channel?: number;
  channel_name?: string;
  components?: number[];
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

export interface BgmJson {
  /** Both filename tables, indexed by `id & 0xFFF`. Holes are real nulls. */
  names: { ar: (string | null)[]; plain: (string | null)[] };
  default_table: "ar" | "plain";
  /** The stage's own track — named by convention, not started by the script. */
  stage_track: {
    index: number;
    id: number;
    ar: string | null;
    plain: string | null;
    note: string;
  } | null;
  game_mode: number;
}

/** The SE and voice name tables. Keys are decimal ids as strings. */
export interface SoundJson {
  se: Record<string, string>;
  voice: Record<string, string>;
}

export interface ScriptJson {
  scene: number;
  stage: number | null;
  game_mode: number;
  evt_file: string;
  entry_block: number;
  /** Which step of the entry block runs first; the game picks it by mode. */
  entry_step: number;
  routes: { kind: string; next: number[] }[];
  blocks: BlockJson[];
  regions: RegionEntryJson[][];
  cam_slots_used: number[];
  bgm?: BgmJson;
  sound?: SoundJson;
  warnings: string[];
}

export interface StageBundle {
  entry: StageEntry;
  script: ScriptJson;
  cam: CamJson;
  geometryUrl: string;
}

// -- loading ---------------------------------------------------------------

const ROOT = "bundle";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

export async function loadManifest(): Promise<Manifest> {
  const m = await getJson<Manifest>(`${ROOT}/manifest.json`);
  if (m.format !== SUPPORTED_FORMAT) {
    throw new Error(
      `bundle format ${m.format}, this client reads ${SUPPORTED_FORMAT}. ` +
        `Rebuild with tools/export_player.py.`,
    );
  }
  return m;
}

export async function loadStage(entry: StageEntry): Promise<StageBundle> {
  const dir = `${ROOT}/${entry.name}`;
  const [script, cam] = await Promise.all([
    getJson<ScriptJson>(`${dir}/${entry.script}`),
    getJson<CamJson>(`${dir}/${entry.cam}`),
  ]);
  return { entry, script, cam, geometryUrl: `${dir}/${entry.geometry}` };
}

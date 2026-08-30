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
  /** Keyframe fields reconstructed from a finite neighbour. */
  repairs?: number;
  /**
   * Channels that held no finite value at all and were zero-filled. That is
   * an invention, not a repair — the path must not be presented as data.
   */
  damaged?: Record<string, string[]>;
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
export interface MessageVariant {
  variant: number;
  /** 0 = 1P/player 1, 1 = 1P/player 2, 2 = 2P. */
  player_cfg: number;
  sprite: number;
  frames: number;
  /** Screen position in the game's 640x480 space. */
  x: number;
  y: number;
  voice: number;
  voice_file: string | null;
  /** The subtitle lines, in order. See `DialogueLine`. */
  lines?: DialogueLine[];
}

/**
 * One subtitle line of a dialogue variant.
 *
 * The task counts `frames` *down*, and steps to the next line whenever the
 * remaining count falls below this line's `end_frame` — so `end_frame` reads
 * as "frames still left when this line gives way", and the last line of a
 * variant has 0.
 */
export interface DialogueLine {
  line: number;
  text: string;
  /** Added to the centred position, in the game's 640-wide screen. */
  x_offset: number;
  end_frame: number;
}

/** One motion, baked flat so the client can index it without parsing. */
export interface BakedMotion {
  bank: string;
  frames: number;
  /** `mot/` is authored at 30 Hz against the engine's 60 Hz clock. */
  fps: number;
  /** `frames * 3` floats: the root translation. */
  root: number[];
  /** `frames * bone_count * 3` BAMS shorts, bone 0 first. */
  rot: number[];
}

export interface CharacterBone {
  bone: number;
  /** The exporter's part name, which the glTF node name ends with. */
  part: string;
  slot: number;
  offset: [number, number, number];
  parent: number | null;
}

export interface CharacterType {
  type: number;
  name: string;
  file: string;
  /** Bones in a motion frame — the stride, from the EXE. */
  bone_count: number;
  bones: CharacterBone[];
  motions: Record<string, BakedMotion>;
}

export interface CharacterPlacement {
  /** evt offset of the spawn descriptor. */
  at: number;
  class: number;
  char_type: number;
  /** null when this class has no motion rule yet — marker only. */
  motion: number | null;
  /**
   * A scripted entrance played once before `motion` starts looping — state 21
   * of class 0x30's 54-state machine. The two zombies in the stage-2 van jump
   * out of it this way, staggered by their delays.
   */
  intro?: { motion: number; delay: number };
}

export interface CharactersJson {
  types: Record<string, CharacterType>;
  placements: CharacterPlacement[];
  note: string;
}

/** One swinging prop — a door leaf, a shutter, a van door. */
export interface PropHinge {
  name: string;
  kind: "hinge";
  at: number;
  /** The class-0x44 builder that made it: 1, 2 or 4. */
  selector: number;
  slot: number;
  /** +1 or −1; mirrors the swing so a pair opens outward. */
  side: number;
  curve: number;
  /** BAMS mounting angle, separate from the swing. */
  base_yaw: number;
  /** Script flag that starts the swing. */
  open_flag: number;
  /** Script flag that deletes it, or −1. */
  remove_flag: number;
}

/** A class-0x33 selector-2 prop: drawn until a flag or a camera frame. */
export interface PropStatic {
  name: string;
  kind: "static";
  at: number;
  slot: number;
  remove_flag: number;
  remove_frame: number | null;
}

export interface PropsJson {
  hinges: PropHinge[];
  statics: PropStatic[];
  /** Curve id → `[rx, ry, rz]` in BAMS, one per frame. */
  curves: Record<string, number[][]>;
  note: string;
}

export interface SoundJson {
  se: Record<string, string>;
  voice: Record<string, string>;
  /** evt 0x2D groups; each holds three variants, one per player config. */
  messages?: Record<string, (MessageVariant | null)[]>;
  screen?: { width: number; height: number; note: string };
}

export interface BackdropPreset {
  preset: number;
  slot_a: number;
  slot_b: number;
  /** Y offset from the camera, 0 … −3000. */
  dy: number;
  /** BAMS added to the dome's Y rotation every frame. */
  spin_bams: number;
  /** BAMS the angle resets to when the preset changes. */
  angle0_bams: number;
  file_a?: string;
  entry_a?: number;
  file_b?: string;
  entry_b?: number;
}

export interface BackdropJson {
  presets: BackdropPreset[];
  /** The presets this scene's script actually selects with `0x1B`. */
  used: number[];
  note: string;
}

export interface RigRoute {
  /** Global `op_` path slot the instance rides. */
  slot: number;
  /** Added to the path position *before* the pose rotations. */
  bias: [number, number, number];
  /** `cp_` slots that select this route. Empty means ungated. */
  cam_paths: number[];
  file: string | null;
  index: number | null;
  duration: number | null;
  /** `CAM_PATH_LENGTH[slot]` — the frame the routines clamp at. */
  length: number | null;
  /** What the routine does at the end of this route, from the transcription. */
  note?: string;
}

export interface RigJson {
  name: string;
  routine: string;
  note: string;
  routes: RigRoute[];
  world_space: boolean;
  spawn_class: number | null;
  /** Rules the transcription records rather than bakes. */
  animated_parts: { part: string; rule: string; condition: string }[];
}

export interface RigsJson {
  rigs: RigJson[];
  /** Rigs read but not placeable, with the reason. */
  blocked: { name: string; routine: string; reason: string }[];
  note: string;
}

export interface RainJson {
  /** Asset slot the effect draws; `stage1.bin[0]`. */
  slot: number;
  file: string | null;
  entry: number | null;
  /** 50 — the extent of the particle array, not a stored count. */
  count: number;
  fall_per_frame: number;
  respawn_below: number;
  /** `[modulo, offset]` per axis, exactly as the routine spells them. */
  spawn: { x: [number, number]; y: [number, number]; z: [number, number] };
  scale: [number, number, number];
  roll_bams: number;
  alpha: number;
  draw_layer: number;
  /** How many times this scene's script turns rain on. */
  enabled_by_script: number;
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
  backdrop?: BackdropJson;
  rigs?: RigsJson;
  characters?: CharactersJson;
  props?: PropsJson;
  rain?: RainJson;
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

/**
 * The scenery the script drives: props, backdrops, camera rigs and rain.
 *
 * Part of the bundle the exporter writes; see docs/formats/ for each block.
 */

import type { MessageVariant } from "./sound";

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

/**
 * One member of a breakable group — a 10-byte record read out of the exe by
 * `PlaceBreakableGroup` (`FUN_00462A80`), not out of the evt.
 */
export interface BreakableMember {
  index: number;
  /** Record `+0x00`/`+0x02`, already scaled by the record's own 0.1. */
  x: number;
  z: number;
  /** Record `+0x04`. 0 means this prop hides nothing. */
  item_set: number;
  /** Record `+0x05`, signed. The Boss Mode drop, `-1` for none. */
  boss_item: number;
  /** Record `+0x06`. Height above the floor is `level * level_height`. */
  level: number;
  y_offset: number;
  /** Record `+0x08`/`+0x09`, truncated to the `+0x07` count. */
  supports: number[];
}

export interface BreakablePlacement {
  /** The script address of the class-0x41 spawn that places this group. */
  at: number;
  group: number;
  /** Descriptor `+0x24` — how many evt blocks the props live for. */
  lifetime_evt_blocks: number;
}

export interface BreakablesJson {
  /** All nine groups, indexed by group id. */
  groups: BreakableMember[][];
  /** `g_breakable_hull_points` — 96 `[x, y, z]`, already scaled by 0.001. */
  hull: [number, number, number][];
  placements: BreakablePlacement[];
  /** 7.540296 — one stack level, in world units. */
  level_height: number;
}

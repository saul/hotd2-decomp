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
  /**
   * `obj+0x1DC`. Its **sign** mirrors the swing so a pair opens outward; its
   * magnitude is the amplitude of the wobble the prop does when it is shot,
   * and must never scale the pose — see `render/hinge.ts`. Four of the game's
   * 56 hinges carry ±512 or ±416, so ±1 is not safe to assume.
   */
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
  /**
   * Set when the routine evaluates this path at a **literal** time instead of
   * the camera frame — the object is parked at a fixed point on the path
   * rather than riding it. `FUN_0048E600` does this for the stage-1 vehicle on
   * `cp_st1` 2: `CamEvalObjectPath6(0xFE, 350.0)`.
   */
  hold_frame?: number | null;
  /**
   * The frame past which the routine stops re-evaluating and holds the pose it
   * last wrote. Not always the path length — `St1VehicleUpdate` stops at
   * `0x15D` (349) where `op_st1` 1's length is 350.
   */
  stop_frame?: number | null;
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
  /** Record `+0x05`, signed. The `g_GameMode == 1` drop, `-1` for none. */
  story_item: number;
  /** Record `+0x06`. Height above the floor is `level * level_height`. */
  level: number;
  y_offset: number;
  /** Record `+0x08`/`+0x09`, truncated to the `+0x07` count. */
  supports: number[];
}

/**
 * One container spawn, decoded. Three families share this shape because they
 * share `g_item_set_countdown` — see `_container_placements` in the exporter
 * for which descriptor field each one reads.
 */
export interface BreakablePlacement {
  /** The script address of the spawn that places it. */
  at: number;
  /**
   * Which constructor built it.
   *
   * The last three are **route-branch triggers** and are here for that: a
   * `chain` group 1, a `fragment` sub-kind 9 pair and a `story_switch` each
   * write `g_script_branch_var`, and without them in the bundle the port
   * cannot take five of the game's sixteen branches. See
   * `game/class41/branch.ts`.
   */
  container: "group" | "kinded" | "falling" | "generic"
    | "chain" | "fragment" | "story_switch";
  /** How many evt blocks it lives for. */
  lifetime_evt_steps: number;
  /** `group` only — the row of `g_breakable_group_ptrs` to build. */
  group?: number;
  /** `kinded` and `falling` — the object kind in the orientation word. */
  kind?: number;
  /**
   * `generic` — the class-0x41 constructor type, and the spawn descriptor's
   * `+0x11C`.
   *
   * `slot` and `lifetime_evt_steps` carry the **same word**: the constructor
   * writes it to `obj+0x28C` and to `obj+0x11C` both. Only the types in
   * `GENERIC_DESCRIPTOR_SLOT` draw the slot; for everything else it is a
   * lifetime and `slot` is meaningless. See `game/class41/generic.ts`.
   */
  type?: number;
  slot?: number;
  /** `generic` — the other two orientation words, which really are angles. */
  pitch?: number;
  roll?: number;
  /** The item set it belongs to, 0 for none. */
  item_set?: number;
  /** How many props share that set; the countdown is seeded from it. */
  set_size?: number;
  /** `falling` only — the `g_GameMode == 1` drop, `-1` for none. */
  story_item?: number;
  /**
   * `chain` only — the group id `PlaceChainSegments` stamps on all twenty
   * segments. **Group 1 is the branch trigger**, and the constructor refuses
   * to build it outside Original Mode.
   */
  chain_group?: number;
  /**
   * `fragment` only — the sub-kind `PlaceFragmentProps` stamps on the row.
   * **Sub-kind 9 is the branch trigger**, and it takes both of them.
   */
  sub_kind?: number;
  /**
   * `story_switch` only — the `g_script_flags` index the route waits on, and
   * the one that removes the object. `-1` means none. `branch_flag` is set to
   * -1 the frame the route is taken, which is the switch's second latch.
   */
  branch_flag?: number;
  remove_flag?: number;
  /**
   * `story_switch` only — the four Original Mode item ids that throw the
   * switch without a shot. `-1` in the first means it has no key and any shot
   * throws it.
   */
  keys?: number[];
  pos?: [number, number, number];
  /** BAMS. */
  yaw?: number;
}

/** One row of `g_prop_kind_params`, per class-0x41 type-4 object kind. */
export interface PropKindParams {
  kind: number;
  effect: number;
  effect_variant: number;
  /** `PlaySoundId` id played when the prop is destroyed. */
  sound: number;
  /** `obj+0x124` — the hit radius. */
  radius: number;
  /** How far above the prop's origin the shot-test point sits. */
  y_offset: number;
}

export interface BreakablesJson {
  /** All nine groups, indexed by group id. */
  groups: BreakableMember[][];
  /** `g_breakable_hull_points` — 96 `[x, y, z]`, already scaled by 0.001. */
  hull: [number, number, number][];
  /** The 48-point hull `FallingContainerUpdate` settles against. */
  falling_hull: [number, number, number][];
  /** `g_prop_kind_params`, indexed by kind. */
  kinds: PropKindParams[];
  placements: BreakablePlacement[];
  /** 7.540296 — one stack level, in world units. */
  level_height: number;
}

/** One class-0x24 set-piece's parameter tail — see `game/class24`. */
export interface SetPieceParamsJson {
  selector: number;
  removePath: number;
  removeFrame: number;
  motion: number;
  hold: number;
  cuePath: number;
  cueFrame: number;
  cue2Path: number;
  cue2Frame: number;
  /** `obj+0x11C`: a start frame, or -1 for a random one. Not hit points. */
  phase: number;
}

/** One class-0x25 command — see `game/class25`. */
export interface HumanoidCmdJson {
  op: number;
  mode: number;
  a: number;
  b: number;
  f0?: number;
  f1?: number;
  /** `op 15` only: the index it jumps to. */
  next?: number;
}

/** One class-0x25 spawn's program. */
/**
 * One class-0x10 command, as `ExeTables.civilian_scripts` decodes it.
 *
 * The stream is **dwords**, not the 8-byte records class 0x25 uses, and the
 * length is per-opcode; `args` is everything after the opcode. The resolved
 * fields are the operands that are pointers into the exe, followed for the
 * port because it cannot follow them itself.
 */
export interface CivilianCmdJson {
  op: number;
  args: number[];
  /** Indices into {@link CiviliansJson.scripts} for a pointer operand. */
  scripts?: number[];
  /** Ops 5, 6 and 0x26: the three floats the operand points at. */
  point?: [number, number, number] | null;
  /** Op 5's approach radius, op 0x16's target scale — the operand as a float. */
  radius?: number;
  /** Op 0x18's six floats: position then rotation. */
  pose?: number[];
  /** Op 0x22's `(sound id, delay)` list, terminated by id `0xFFFFFFFF`. */
  sounds?: [number, number][];
  /** Ops 0x13 and 0x14: an index into {@link CiviliansJson.items}. */
  item?: number;
  /** Op 0x15: `[weight, item index]`, the list the weighted pick walks. */
  itemTable?: [number, number][];
}

/**
 * One held-item record — the 0x7C bytes `CivilianDrawHeldItems`
 * (`FUN_0048CD10`) reads. An item is one asset slot hung off one bone, rotated
 * and then offset and scaled by whichever of the six attach sets the character
 * type takes.
 */
export interface CivilianItemJson {
  bone: number;
  slot: number;
  /** 3-10 and 0x0E-0x12 draw a second, fixed slot as well. */
  kind: number;
  extra?: number | null;
  /** BAMS, applied X then Z then Y as the draw does. */
  rot: [number, number, number];
  /** Per attach set: translate x, y, z, then a uniform scale. */
  sets: [number, number, number, number][];
}

/** One class-0x10 spawn's descriptor tail — see `game/class10`. */
export interface CivilianSpawnJson {
  charType: number;
  /** Index into {@link CiviliansJson.entries}. */
  script: number;
  removePath: number;
  removeFrame: number;
  removeDelay: number;
  children: {
    at: number; class: number; charType: number | null;
    pos: [number, number, number]; yaw: number; hp: number;
  }[];
}

/**
 * Class 0x10's scripts, which live in the **exe** rather than the evt, and the
 * per-spawn tail that picks one.
 */
export interface CiviliansJson {
  /** `g_civilian_scripts` (0x005702A8), 67 slots -> index into `scripts`. */
  entries: number[];
  /** Every reachable stream, including the ones only an operand points at. */
  scripts: CivilianCmdJson[][];
  /** Every held-item record any stream names, in first-seen order. */
  items: CivilianItemJson[];
  /** Keyed by the spawn's script address. */
  spawns: Record<string, CivilianSpawnJson>;
}

export interface HumanoidProgramJson {
  charType: number;
  removePath: number;
  removeFrame: number;
  flags2: number;
  motion: number;
  phase: number;
  cmds: HumanoidCmdJson[];
}

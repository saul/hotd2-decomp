/**
 * Class 0x14's `.rdata`, as the bundle carries it (`hod2lib/class14.ts`
 * writes it, `CharactersJson.class14` types it), and the literals its
 * routines load that are not tables.
 *
 * Every table here is read by an instruction in this class and nowhere else.
 * They are data rather than constants in `game/` because the architecture's
 * rule 5 puts the exe's tables in the bundle, next to the motions they index.
 */
import type {
  Class14AnimCue, Class14Json, Class14WindowTiming,
} from "../../bundle/characters";
import { T } from "../tables";

/** The whole block, or null for a bundle written before it existed. */
export function Class14Tables(): Class14Json | null {
  const t = T.chars?.class14;
  return t && "anim_slots" in t ? t : null;
}

/**
 * `g_class14_anim_slots[slot]` — `0x00596408`, 30 pointers into
 * `g_class14_anim_cues` (`0x0059626C`). The first short of each record is the
 * motion.
 */
export function Class14AnimSlot(slot: number): Class14AnimCue | null {
  return Class14Tables()?.anim_slots[slot] ?? null;
}

/** `*(s16 *)g_class14_anim_slots[slot]` — the motion an anim slot names. */
export function Class14AnimMotion(slot: number): number {
  return Class14AnimSlot(slot)?.motion ?? 0;
}

/** `g_class14_window_timing[row]` — `0x005965C0`, 8 rows of 12 bytes. */
export function Class14WindowTimingRow(row: number): Class14WindowTiming {
  return Class14Tables()?.window_timing[row]
    ?? { open_hold: 0, shut_hold: 0, open_rate: 1, close_rate: -1 };
}

/**
 * `g_class14_damage_cones[i]` — `0x00596480`, 40 rows of
 * `{maxYaw, rotX, minPitch, maxPitch}` s16, by the weak point's frame less
 * its first. Rows 0..18 are all zero: the window is shut.
 */
export function Class14DamageCone(i: number): [number, number, number, number] {
  return Class14Tables()?.damage_cones[i] ?? [0, 0, 0, 0];
}

/** `g_class14_phase_hp_frac[phase]` — `0x00596670`, ten floats. */
export function Class14PhaseHpFrac(phase: number): number {
  return Class14Tables()?.phase_hp_frac[phase] ?? 0;
}

/**
 * `g_class14_bone_damage[rank][players - 1]` — `0x00596698`, read through
 * `[EAX + EDX*2 + 0x596697]` with `EAX = g_players_in_play` and `EDX` the
 * rank: the player count is folded into the base, so one player reads
 * column 0.
 */
export function Class14BoneDamage(rank: number, players: number): number {
  const row = Class14Tables()?.bone_damage[rank];
  return row?.[players - 1] ?? 0;
}

/**
 * `g_class14_summon_counts[rank*3 + round]` — `0x00596640`. Read with the
 * round counter `+0x9C` **after** the decrement, so its column 0 is the last
 * round, not the first.
 */
export function Class14SummonCount(rank: number, round: number): number {
  return Class14Tables()?.summon_counts[rank]?.[round] ?? 0;
}

/** `g_class14_summon_delays_a[rank]` — `0x00596620`. Frames between fish. */
export function Class14SummonDelayA(rank: number): number {
  return Class14Tables()?.summon_delays_a[rank] ?? 0;
}

/** `g_class14_summon_delays_b[rank]` — `0x00596630`. */
export function Class14SummonDelayB(rank: number): number {
  return Class14Tables()?.summon_delays_b[rank] ?? 0;
}

// -- literals ---------------------------------------------------------------

/** The rank is a signed byte the engine clamps into 0..15 on every write. */
export const CLASS14_RANK_MAX = 0xf;

/** `Class14Init`: `MOV word ptr [EAX + 0x62], 0xB` at `0x00475EEA`. */
export const CLASS14_ANIM_SLOT_SPAWN = 0xb;

/** `obj+0x124 = 30.0f` (`0x41F00000`) at `0x00475F4F`. */
export const CLASS14_SHOT_SPHERE = 30;

/** `state+0x0C = 6.0f` (`0x40C00000`) — Init at `0x00475F98`, and the reaction. */
export const CLASS14_CAMERA_RISE = 6;

/** The shutter every entrance hands the fight over on. */
export const CLASS14_SHUTTER_OPEN = 1;

/** `ActorTurnTowardXZ` (`FUN_00426120`) is passed 0x200 at every call site. */
export const CLASS14_TURN_STEP = 0x200;

/** Flipbook A's strip (`boss2.bin` 2..36) and B's (37..76), Init's literals. */
export const CLASS14_BOOK_A_LOW = 0x2cb;
export const CLASS14_BOOK_A_HIGH = 0x2ed;
export const CLASS14_BOOK_B_LOW = 0x2ee;
export const CLASS14_BOOK_B_HIGH = 0x315;

/** `ScoreAddForPlayer(player, 0x5DC)` for the kill, and 10 a damaging hit. */
export const CLASS14_SCORE_KILL = 0x5dc;
export const CLASS14_SCORE_HIT = 10;

/** `g_boss_shot_damage_cap` — `0x0055E1B4`, 33.0. */
export const CLASS14_DAMAGE_CAP = 33;

/** The `g_script_flags` bytes this class writes, by the instruction. */
export const CLASS14_FLAG_BANNER = 9;
export const CLASS14_FLAG_INTRO_DONE = 10;
export const CLASS14_FLAG_ROUND_B_OPEN = 11;
export const CLASS14_FLAG_ROUND_B_DONE = 12;
export const CLASS14_FLAG_BREAK_A_OPEN = 13;
export const CLASS14_FLAG_BREAK_A_DONE = 14;
export const CLASS14_FLAG_BREAK_B_OPEN = 15;
export const CLASS14_FLAG_BREAK_B_DONE = 16;
export const CLASS14_FLAG_DEAD = 17;
export const CLASS14_FLAG_DEAD_STAGE5 = 31;
/**
 * `g_script_flags[0x5F]` — `0x009C725F`, the byte `Class14StateEntranceB`'s
 * sub 1 waits on. Block 37 raises it itself (`set_script_flag 0x5F`).
 */
export const CLASS14_FLAG_ENTRANCE_B_GO = 0x5f;

/** The sounds, by id (`PlaySoundId`), with the file each names. */
export enum Class14Sound {
  /** `COMMON\BLOOD03_16.WAV` — a damaging hit. */
  Blood = 0x316a9,
  /** `COMMON2\ZOMBIE_022_16.wav` — the reaction starts. */
  React = 0x1117a9,
  /** `COMMON\BOMB2_16.WAV`. */
  Bomb = 0xc16a9,
  /** `COMMON\DAMAGE4_22.WAV`. */
  Damage = 0x1d16a9,
  /** `COMMON2\ZOMBIE_007_16.wav`. */
  Growl = 0x417a9,
  /** `COMMON2\ZOMBIE_002_16.wav`. */
  Breath = 0x17a9,
  /** `COMMON\HERTBEAT_22.WAV`. */
  Heartbeat = 0x3516a9,
  /** `COMMON2\ZOMBIE_018_16.wav` — the roar. */
  Roar = 0xd17a9,
  /** `COMMON\ENE_WALK7_22.WAV` — a launch. */
  Launch = 0x2a16a9,
  /** `COMMON2\ZOMBIE_035_16.wav` — a summoning round starts. */
  Summon = 0x1617a9,
  /** `COMMON2\ZOMBIE_032_16.wav`. */
  Sink = 0x1417a9,
  /** `COMMON2\ZOMBIE_036_16.wav`. */
  DeathCry = 0x1717a9,
}

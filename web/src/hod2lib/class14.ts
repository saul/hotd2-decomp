/**
 * Class 0x14's tables -- the stage-2 boss. The port of
 * `tools/hod2lib/class14.py`.
 *
 * Every one of these is `.rdata` that `Class14Update` (`FUN_00476150`) and the
 * routines under it index directly, so they travel in the bundle
 * (`characters.class14`) rather than as constants in `game/class14/`. Each
 * address is the one the consuming instruction names; see
 * `docs/re/boss-hierophant.md` for the reading.
 */

import { f32, i16, i8, u8 } from "./bytes";
import type { ExeTables } from "./exetab";

/** `g_class14_anim_slots` -- 30 pointers into `g_class14_anim_cues`. */
export const CLASS14_ANIM_SLOTS = 0x00596408;
export const CLASS14_ANIM_SLOT_COUNT = 30;
/** `g_class14_damage_cones` -- 40 x `{s16 maxYaw, rotX, minPitch, maxPitch}`. */
export const CLASS14_DAMAGE_CONES = 0x00596480;
export const CLASS14_DAMAGE_CONE_COUNT = 40;
/** `g_class14_window_timing` -- 8 x `{s16 openHold, shutHold; f32 openRate, closeRate}`. */
export const CLASS14_WINDOW_TIMING = 0x005965c0;
export const CLASS14_WINDOW_TIMING_COUNT = 8;
/** `g_class14_summon_delays_a` / `_b` -- 16 bytes each, by adaptive rank. */
export const CLASS14_SUMMON_DELAYS_A = 0x00596620;
export const CLASS14_SUMMON_DELAYS_B = 0x00596630;
/** `g_class14_summon_counts` -- 16 rows of 3 bytes, `[rank*3 + round]`. */
export const CLASS14_SUMMON_COUNTS = 0x00596640;
/** `g_class14_phase_hp_frac` -- 10 floats, by phase. */
export const CLASS14_PHASE_HP_FRAC = 0x00596670;
/** `g_class14_bone_damage` -- 16 rows of 2 signed bytes, `[rank*2 + players-1]`. */
export const CLASS14_BONE_DAMAGE = 0x00596698;
export const CLASS14_RANKS = 16;
export const CLASS14_PHASES = 10;

/**
 * One `g_class14_anim_cues` record: the motion, then `{frame, code}` pairs
 * until a frame of -1, then the code that holds past the last pair.
 * `Class14AdvanceMotionAndPublishPoints` walks it for the first cue frame at
 * or past the play cursor.
 */
function animCue(tables: ExeTables, va: number):
    { motion: number; cues: [number, number][]; end_code: number } | null {
  const o = tables.v2r(va);
  if (o === null) return null;
  const d = tables.data;
  const motion = i16(d, o);
  const cues: [number, number][] = [];
  let p = o + 2;
  // The longest shipped record has five pairs; the bound is the reader's.
  for (let i = 0; i < 32 && p + 4 <= d.length; i++) {
    const frame = i16(d, p);
    const code = i16(d, p + 2);
    if (frame === -1) return { motion, cues, end_code: code };
    cues.push([frame, code]);
    p += 4;
  }
  return null;
}

/**
 * Class 0x14's `.rdata`, read where the routines read it. An empty object
 * when there is no executable -- the client then has no boss tables and the
 * boss cannot be damaged, which is what a bundle without them should do.
 */
export function class14Tables(tables: ExeTables | null):
    Record<string, unknown> {
  if (tables === null) return {};
  const d = tables.data;
  const at = (va: number): number => {
    const o = tables.v2r(va);
    if (o === null) throw new Error(`class14: 0x${va.toString(16)} unmapped`);
    return o;
  };
  const animSlots: unknown[] = [];
  for (let i = 0; i < CLASS14_ANIM_SLOT_COUNT; i++) {
    const ptr = tables.ru32(CLASS14_ANIM_SLOTS + i * 4) ?? 0;
    animSlots.push(animCue(tables, ptr));
  }
  const cones: number[][] = [];
  let o = at(CLASS14_DAMAGE_CONES);
  for (let i = 0; i < CLASS14_DAMAGE_CONE_COUNT; i++, o += 8) {
    cones.push([i16(d, o), i16(d, o + 2), i16(d, o + 4), i16(d, o + 6)]);
  }
  const timing: Record<string, number>[] = [];
  o = at(CLASS14_WINDOW_TIMING);
  for (let i = 0; i < CLASS14_WINDOW_TIMING_COUNT; i++, o += 12) {
    timing.push({ open_hold: i16(d, o), shut_hold: i16(d, o + 2),
                  open_rate: f32(d, o + 4), close_rate: f32(d, o + 8) });
  }
  const bytes = (va: number, n: number): number[] => {
    const b = at(va);
    return Array.from({ length: n }, (_u, k) => u8(d, b + k));
  };
  const counts: number[][] = [];
  const c = at(CLASS14_SUMMON_COUNTS);
  for (let r = 0; r < CLASS14_RANKS; r++) {
    counts.push([u8(d, c + r * 3), u8(d, c + r * 3 + 1), u8(d, c + r * 3 + 2)]);
  }
  const frac: number[] = [];
  const pf = at(CLASS14_PHASE_HP_FRAC);
  for (let i = 0; i < CLASS14_PHASES; i++) frac.push(f32(d, pf + i * 4));
  const damage: number[][] = [];
  const bd = at(CLASS14_BONE_DAMAGE);
  for (let r = 0; r < CLASS14_RANKS; r++) {
    damage.push([i8(d, bd + r * 2), i8(d, bd + r * 2 + 1)]);
  }
  return {
    anim_slots: animSlots,
    damage_cones: cones,
    window_timing: timing,
    summon_delays_a: bytes(CLASS14_SUMMON_DELAYS_A, CLASS14_RANKS),
    summon_delays_b: bytes(CLASS14_SUMMON_DELAYS_B, CLASS14_RANKS),
    summon_counts: counts,
    phase_hp_frac: frac,
    bone_damage: damage,
  };
}

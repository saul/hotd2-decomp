/**
 * Class 0x2D's data: the `.rdata` tables the bundle carries
 * (`script.json`'s `class2d` block, `ExeTables.class2dTables`), read through
 * {@link T}; the `.data` words the routines read, which no instruction in
 * the image writes; and the float literals the routines load, each with the
 * instruction that loads it.
 *
 * Every table is indexed exactly as its reader indexes it: `[rank]` is
 * `obj+0x1324`, `[players]` is `g_players_in_play` as it stands (0 is never
 * reached in play), and a lookup the bundle lacks answers 0 -- a pre-`class2d`
 * bundle, in which the fight cannot run.
 */
import { T } from "../tables";
import { vec3, type Vec3 } from "../vec";

/** `[port-only]` -- one entry of a bundle table, or 0 where it has none. */
function at(list: readonly number[] | undefined, i: number): number {
  return list?.[i] ?? 0;
}

/** `[port-only]` accessor of `g_class2d_hit_damage` (`0x0055CCD6`)`[players]`: 12 with one player, 7 with two. */
export function Class2DHitDamage(players: number): number {
  return at(T.class2d?.hit_damage, players);
}

/** `[port-only]` accessor of `g_class2d_charge_arrive_dist` (`0x0055CCD4`), 30.0. */
export function Class2DChargeArriveDist(): number {
  return T.class2d?.charge_arrive_dist ?? 0;
}

/** `[port-only]` accessor of `g_class2d_waypoints` (`0x0055CCE0`)`[i]`. */
export function Class2DWaypoint(i: number): Vec3 {
  const w = T.class2d?.waypoints[i];
  return w ? vec3(w[0], w[1], w[2]) : vec3();
}

/** `[port-only]` accessor of `g_class2d_attack_picks` (`0x0055CD1C`)`[rank][i]`. */
export function Class2DAttackPick(rank: number, i: number): number {
  return at(T.class2d?.attack_picks[rank], i);
}

/** `[port-only]` accessor of `g_class2d_stagger_hits` (`0x0055CF9A`)`[players]`. */
export function Class2DStaggerHits(players: number): number {
  return at(T.class2d?.stagger_hits, players);
}

/** `[port-only]` accessor of `g_class2d_charge_steps` (`0x0055CFA0`)`[rank]`. */
export function Class2DChargeSteps(rank: number): number {
  return at(T.class2d?.charge_steps, rank);
}

/** `[port-only]` accessor of `g_class2d_child_kind_picks` (`0x0055CFC0`)`[row][i]`. */
export function Class2DChildKindPick(row: number, i: number): number {
  return at(T.class2d?.child_kind_picks[row], i);
}

/** One `g_class2d_path_segments` row (`0x0055D060`). */
export interface Class2DPathSegment {
  step: number;
  advance: number;
  strike: number;
  end: number;
  words: readonly number[];
}

const NO_SEGMENT: Class2DPathSegment = {
  step: 0, advance: 0, strike: 0, end: 0, words: [0, 0, 0, 0],
};

/** `[port-only]` accessor of `g_class2d_path_segments` (`0x0055D060`)`[i]`. */
export function Class2DPathSegmentOf(i: number): Class2DPathSegment {
  return T.class2d?.path_segments[i] ?? NO_SEGMENT;
}

/** `[port-only]` accessor of `g_class2d_child_offsets` (`0x0055D120`)`[kind]`. */
export function Class2DChildOffset(kind: number): Vec3 {
  const o = T.class2d?.child_offsets[kind];
  return o ? vec3(o[0], o[1], o[2]) : vec3();
}

/** `[port-only]` accessor of `g_class2d_launch_gap` (`0x0055D1B8`)`[rank]`. */
export function Class2DLaunchGap(rank: number): number {
  return at(T.class2d?.launch_gap, rank);
}

/** `[port-only]` accessor of `g_class2d_flight_frames` (`0x0055D1D8`)`[rank]`. */
export function Class2DFlightFrames(rank: number): number {
  return at(T.class2d?.flight_frames, rank);
}

/** `[port-only]` accessor of `g_class2d_pair_flight_frames` (`0x0055D1F8`)`[rank]`. */
export function Class2DPairFlightFrames(rank: number): number {
  return at(T.class2d?.pair_flight_frames, rank);
}

/** `[port-only]` accessor of `g_class2d_child0_path_start` (`0x0055D234`)`[r]`. */
export function Class2DChild0PathStart(r: number): number {
  return at(T.class2d?.child0_path_start, r);
}

/**
 * `[port-only]` accessor of `g_class2d_child_bone_satellite`
 * (`0x0055D238`)`[bone]` for kinds 0, 1 and
 * 3, `g_class2d_child2_bone_satellite` (`0x0055D268`) for kind 2; `0xFF`
 * where the bone carries none. The reads are `MOVSX` (signed) for the index
 * and `CMP byte, 0xFF` for the test.
 */
export function Class2DBoneSatellite(kind2: boolean, bone: number): number {
  const t = kind2 ? T.class2d?.child2_bone_satellite
    : T.class2d?.child_bone_satellite;
  return t?.[bone] ?? 0xff;
}

/** `[port-only]` accessor of `g_class2d_child2_approach` (`0x0055D248`)`[rank]`. */
export function Class2DChild2Approach(rank: number): number {
  return at(T.class2d?.child2_approach, rank);
}

/** `[port-only]` accessor of `g_class2d_child3_approach` (`0x0055D284`)`[rank]`. */
export function Class2DChild3Approach(rank: number): number {
  return at(T.class2d?.child3_approach, rank);
}

/**
 * The `.data` words. Each has one reference in the image, the read (a byte
 * search for the address), so each is a constant of the build.
 */
/** `g_class2d_intro_end_frame` -- `0x005770B4`, 1810. */
export const g_class2d_intro_end_frame = 1810;
/** `g_class2d_join_frames` -- `0x005770BC`, 300. */
export const g_class2d_join_frames = 300;
/** `g_class2d_rise_end_frame` -- `0x00577348`, 1630. */
export const g_class2d_rise_end_frame = 1630;
/** `g_class2d_path185_end_frame` -- `0x0057734C`, 1810. */
export const g_class2d_path185_end_frame = 1810;
/** `g_class2d_child0_path_end` -- `0x00577380`, s32[2]. */
export const g_class2d_child0_path_end: readonly number[] = [130, 120];

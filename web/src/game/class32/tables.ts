/**
 * Class 0x32's `.rdata`, as the bundle carries it (`hod2lib/class32.ts`
 * writes it, `CharactersJson.class32` types it), and its descriptor tail.
 *
 * Every table is read by one instruction of the class, by the boss's rank
 * where it has seventeen rows -- see `docs/re/boss-magician.md` §1.
 */
import type { Actor } from "../actor";
import type { CharacterPlacement, Class32Json } from "../../bundle/characters";
import { T } from "../tables";

/** `[port-only]` The whole block, or null for a bundle written before it existed. */
export function Class32Tables(): Class32Json | null {
  const t = T.chars?.class32;
  return t && "phases" in t ? t as Class32Json : null;
}

/** `[port-only]` The spawn's descriptor tail, `obj+0x1390`, as the bundle carries it. */
export type Class32Tail = NonNullable<CharacterPlacement["class32"]>;

/**
 * `[port-only]` accessor: the descriptor tail an actor's `obj+0x1390` points
 * at -- the boss's own, or, for a projectile, its boss's (the projectile's
 * `obj+0x1390` is the boss and the routine reads `boss+0x1390` through it).
 */
export function Class32TailOf(boss: Actor | undefined): Class32Tail | null {
  if (!boss) return null;
  const p = T.chars?.placements.find((x) => x.at === boss.at);
  return p?.class32 ?? null;
}

/**
 * `[port-only]` accessor: `g_class32_phases[row]` -- `0x00596770`, the state
 * (`MOV CX, word ptr [EAX*8 + 0x596770]`) and the floor
 * (`FMUL float ptr [EDI*8 + 0x596774]`). A row past the table reads as the
 * last one, `(-1, -1.0)`.
 */
export function Class32Phase(row: number): [number, number] {
  const t = Class32Tables()?.phases;
  if (!t || !t.length) return [-1, -1];
  return t[row] ?? t[t.length - 1];
}

/** `[port-only]` accessor: `g_class32_hop_offsets[i]` -- `0x005967A0`. */
export function Class32HopOffset(i: number): [number, number, number] {
  return Class32Tables()?.hop_offsets[i] ?? [0, 0, 0];
}

/** `[port-only]` accessor: `g_class32_hop_frames[rank]` -- `0x005967D0`. */
export function Class32HopFrames(rank: number): number {
  return Class32Tables()?.hop_frames[rank] ?? 0;
}

/** `[port-only]` accessor: `g_class32_circle_offsets[i]` -- `0x00596818`. */
export function Class32CircleOffset(i: number): [number, number, number] {
  return Class32Tables()?.circle_offsets[i] ?? [0, 0, 0];
}

/**
 * `[port-only]` accessor: `g_class32_rank_rows[rank]` -- `0x00596848`,
 * `[circle_frames, circle_hold, circle_laps, lunge_frames]`.
 */
export function Class32RankRow(rank: number): [number, number, number, number] {
  return Class32Tables()?.rank_rows[rank] ?? [0, 0, 0, 0];
}

/** `[port-only]` accessor: `g_class32_projectile_frames[rank]` -- `0x00596958`. */
export function Class32ProjectileFrames(rank: number): number {
  return Class32Tables()?.projectile_frames[rank] ?? 0;
}

/**
 * `[port-only]` accessor: `g_class32_barrage_rows[rank]` -- `0x005969A0`,
 * `[scatter_base, scatter_spread, max_live, aimed_count]`.
 */
export function Class32BarrageRow(rank: number): [number, number, number, number] {
  return Class32Tables()?.barrage_rows[rank] ?? [0, 0, 0, 0];
}

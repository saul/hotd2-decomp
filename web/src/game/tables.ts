/**
 * The exported data, typed.
 *
 * These are the game's `.rodata` and its loaded assets: read-only for the
 * whole life of a stage, so they are deliberately **not** part of a snapshot —
 * a save state carries the state, and the tables come back with the bundle.
 */
import type {
  AttackJson, BakedMotion, CharactersJson, CharacterType, ThrowHandJson,
} from "../bundle";
import type { Actor } from "./actor";
import { G } from "./globals";

export const T = {
  /** The whole `characters` block: tables, types and placements. */
  chars: null as CharactersJson | null,
  types: {} as Record<string, CharacterType>,
  get approach() { return T.chars?.approach ?? null; },
  get tracking() { return T.chars?.tracking ?? null; },
  get player() { return T.chars?.player ?? null; },
};

/**
 * The scene reset's job: point the tables at this stage's data and copy the
 * approach rings into the globals, which is what `DAT_004C4CD0` ->
 * `g_enemy_approach_rings` does at 0x004C4CD0.
 */
export function SetGameTables(chars: CharactersJson | undefined): void {
  T.chars = chars ?? null;
  T.types = chars?.types ?? {};

  const rings = chars?.approach?.rings ?? [];
  G.g_enemy_approach_rings = rings.map((r) => r.inner);
  G.g_enemy_approach_ring_mid = rings.map((r) => r.mid);
  G.g_enemy_approach_ring_outer = rings.map((r) => r.outer);
  G.g_enemy_approach_steps = chars?.approach?.steps?.base ?? 0;
  G.g_enemy_approach_steps_mid = chars?.approach?.steps?.mid_add ?? 0;
  G.g_enemy_approach_steps_outer = chars?.approach?.steps?.outer_add ?? 0;
  // `ResetDamageRank` (`FUN_00460770`) seeds the adaptive rank from the menu
  // difficulty; there is no adaptive update ported yet, so it stays at seed.
  G.g_damage_rank = Math.min(15, Math.max(0,
    chars?.difficulty?.initial_rank?.[G.g_difficulty] ?? 0));
}

export function CharacterTypeOf(a: Actor): CharacterType | null {
  return T.types[String(a.charType)] ?? null;
}

export function MotionOf(a: Actor, id: number): BakedMotion | null {
  return T.types[String(a.charType)]?.motions[String(id)] ?? null;
}

/**
 * Attacks this actor can perform for its body condition — the row
 * `ZombieStateStrike` indexes with the pick table.
 */
export function AttackListOf(a: Actor): Record<string, AttackJson> {
  const t = CharacterTypeOf(a);
  return t?.attacks?.[String(a.condition)] ?? t?.attacks?.["0"] ?? {};
}

export function AttackPicksOf(a: Actor): number[] {
  const t = CharacterTypeOf(a);
  return t?.attack_picks?.[String(a.condition)] ?? t?.attack_picks?.["0"] ?? [];
}

/**
 * The first entry of the row that is actually baked into this bundle.
 *
 * [diverges] The engine picks between the two variants with a flag bit —
 * `row[2 + ((obj+0x34 >> 0x1B) & 1)]` for the run — and nothing ported sets
 * it, so this takes whichever exists. It matters because a row entry can name
 * a clip authored for **another skeleton**: `znchain`'s run is `zom.bin` 968,
 * which bakes for the 16-bone humanoids and is refused for it. Asking for the
 * first entry by index and getting a number that has no clip behind it is
 * what left every zombie standing still.
 */
export function FirstBakedOf(a: Actor, row: number[],
                             ...indices: number[]): number | undefined {
  for (const i of indices) {
    const m = row[i];
    if (m !== undefined && MotionOf(a, m)) return m;
  }
  return undefined;
}

/** The general motion row: 0/1 walk, 2/3 attack run, `backoff_index` retreat. */
export function MotionRowOf(a: Actor): number[] {
  const t = CharacterTypeOf(a);
  return t?.motion_row?.[String(a.condition)] ?? t?.motion_row?.["0"] ?? [];
}

/** The thrower's hands for its body condition. */
export function ThrowHandsOf(a: Actor): ThrowHandJson[] {
  const t = CharacterTypeOf(a);
  return t?.throw?.hands?.[String(a.condition)]
      ?? t?.throw?.hands?.["0"] ?? [];
}

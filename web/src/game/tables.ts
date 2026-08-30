/**
 * The exported data, typed.
 *
 * These are the game's `.rodata` and its loaded assets: read-only for the
 * whole life of a stage, so they are deliberately **not** part of a snapshot —
 * a save state carries the state, and the tables come back with the bundle.
 */
import type {
  ApproachJson, AttackJson, BakedMotion, CharacterType, PlayerDamageJson,
  ThrowHandJson, TrackingJson,
} from "../bundle";
import type { Actor } from "./actor";
import { G } from "./globals";

export const T = {
  types: {} as Record<string, CharacterType>,
  approach: null as ApproachJson | null,
  tracking: null as TrackingJson | null,
  player: null as PlayerDamageJson | null,
};

/**
 * The scene reset's job: point the tables at this stage's data and copy the
 * approach rings into the globals, which is what `DAT_004C4CD0` ->
 * `g_enemy_approach_rings` does at 0x004C4CD0.
 */
export function SetGameTables(types: Record<string, CharacterType> | undefined,
                              approach: ApproachJson | undefined,
                              tracking: TrackingJson | undefined,
                              player: PlayerDamageJson | undefined): void {
  T.types = types ?? {};
  T.approach = approach ?? null;
  T.tracking = tracking ?? null;
  T.player = player ?? null;

  const rings = approach?.rings ?? [];
  G.g_enemy_approach_rings = rings.map((r) => r.inner);
  G.g_enemy_approach_ring_mid = rings.map((r) => r.mid);
  G.g_enemy_approach_ring_outer = rings.map((r) => r.outer);
  G.g_enemy_approach_steps = approach?.steps?.base ?? 0;
  G.g_enemy_approach_steps_mid = approach?.steps?.mid_add ?? 0;
  G.g_enemy_approach_steps_outer = approach?.steps?.outer_add ?? 0;
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

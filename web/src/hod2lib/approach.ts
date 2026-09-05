/**
 * The rings an enemy advances through, and the camera that watches it.
 * The port of `tools/hod2lib/approach.py`.
 *
 * One subject, not two: `TestApproachRing` and `ZombieStateApproach` measure
 * the actor's distance **to the camera** and read the same three radii, and
 * `RegisterForCameraTracking` sorts the same actors by the same distance so
 * `SelectCameraLookAtTarget` can pick one and `TurnLookAtToward` ease onto it.
 * docs/formats/combat.md sections 9 and 10.
 *
 * Only {@link APPROACH_RING_DEFAULTS} and {@link TURN_RATE_CURVES} are
 * `.rdata` and travel in the bundle. The rest of this module is `.text`
 * immediates, and they live in `web/src/game/camera/` -- see
 * `docs/formats/bundle.md`.
 */

import { f32s, u32 } from "./bytes";
import type { ExeTables } from "./exetab";

/**
 * `DAT_004C4CD0`: four `{inner, mid, outer}` f32 ring sets, copied into
 * `g_enemy_approach_rings` by the scene reset (`FUN_0045EEC0`). No stage
 * script uses evt `0x0E`, the opcode that would override them, so these
 * constants are what every encounter in the game actually runs on.
 */
export const APPROACH_RING_DEFAULTS = 0x004c4cd0;

export const APPROACH_RING_SETS = 4;

/** `EnemyZombieInit`: character type 0 uses ring set 2, everything else 0. */
export const RING_SET_FOR_CHAR0 = 2;

/**
 * `PTR_DAT_00576C04`: four 64-byte turn-rate curves, indexed by the angle
 * between where the camera looks and where it wants to look, clamped and
 * shifted right 7. The scene reset picks curve **1**. A larger value is a
 * *slower* turn: `TurnLookAtToward` steps `1 / (1 + rate)` of the remaining
 * angle.
 */
export const TURN_RATE_CURVES = 0x00576c04;

export const TURN_RATE_CURVE_COUNT = 4;

export const TURN_RATE_CURVE_LEN = 64;

/**
 * The advance rings and the step counts, with their defaults.
 *
 * `TestApproachRing` and `ZombieStateApproach` both measure the actor's
 * distance **to the camera** and read the same three radii, so one table
 * serves the walk-in and the attack run.
 */
export function approachTables(tables: ExeTables): Record<string, unknown> {
  const o = tables.v2r(APPROACH_RING_DEFAULTS)!;
  const sets: Record<string, number>[] = [];
  for (let i = 0; i < APPROACH_RING_SETS; i++) {
    const [inner, mid, outer] = f32s(tables.data, o + i * 12, 3);
    sets.push({ inner, mid, outer });
  }
  // Only the radii travel. The step defaults and `RING_SET_FOR_CHAR0` are
  // immediates in `.text`, so they belong in `web/src/game/class30/ring.ts`.
  return { rings: sets };
}

/**
 * What the gameplay camera aims at, and how fast it turns.
 *
 * Three routines, all in docs/formats/combat.md section 10: enemies register
 * themselves nearest-first, `SelectCameraLookAtTarget` picks a point from the
 * slot table, and `TurnLookAtToward` eases the camera onto it.
 */
export function cameraTracking(tables: ExeTables): Record<string, unknown> {
  const b = tables.v2r(TURN_RATE_CURVES)!;
  const curves: number[][] = [];
  for (let i = 0; i < TURN_RATE_CURVE_COUNT; i++) {
    const ptr = u32(tables.data, b + i * 4);
    const o = tables.v2r(ptr);
    if (o === null) {
      curves.push([]);
      continue;
    }
    const row: number[] = [];
    for (let k = 0; k < TURN_RATE_CURVE_LEN; k++) {
      row.push((tables.data[o + k] << 24) >> 24);   // signed bytes
    }
    curves.push(row);
  }
  return { curves };
}

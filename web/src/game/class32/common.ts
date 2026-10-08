/**
 * The four small routines every class-0x32 state calls: the stop, the
 * permit pair and the rank step.
 */
import type { Rng } from "../../core/rng";
import type { Actor, Boss5Actor } from "../actor";
import { ActorScreenHalfSign } from "../combat/permits";
import { IsPlayerAttackable } from "../combat/player";
import { G } from "../globals";
import type { GameHost } from "../host";

/** `Class32AdjustRank`'s clamp: `JL` below 0 to 0, `CMP 0xF; JLE` above to 15. */
const RANK_MAX = 0xf;

/**
 * `Class32StopMoving` — `FUN_0047FFC0`.
 * `obj+0x58..0x60 = 0; obj+0x4C..0x54 = 0` -- acceleration and velocity.
 */
export function Class32StopMoving(obj: Actor): void {
  obj.accX = 0;
  obj.accY = 0;
  obj.accZ = 0;
  obj.vel.x = 0;
  obj.vel.y = 0;
  obj.vel.z = 0;
}

/**
 * `Class32ReleaseAttackPermit` — `FUN_0047FFE0`.
 * `if ((s8)obj+0x121 != -1) { g_attack_permits[obj+0x121] = 0; obj+0x121 = 0xFF; }`
 *
 * The port's permit table holds the holder's `at` and frees with -1 (see
 * `globals.ts`); "free" is written as the port writes it.
 */
export function Class32ReleaseAttackPermit(obj: Actor): void {
  if (obj.attackPermit !== -1) {
    G.g_attack_permits[obj.attackPermit] = -1;
    obj.attackPermit = -1;
  }
}

/** `[port-only]` Is `g_attack_permits[p]` 0? The port's table frees with -1. */
function PermitFree(p: number): boolean {
  return G.g_attack_permits[p] === -1;
}

/**
 * `Class32TryClaimAttackPermit` — `FUN_0047FE90`. Returns 1 with a permit
 * taken, 0 without.
 *
 * ```
 * obj+0x121 = 0xFF
 * if (g_attack_committed) goto test_held           ; 0x0047FEA3
 * switch (g_max_attackers) {
 *   case 1: if (g_active_player == 0 && !permits[0]) obj+0x121 = 0
 *           if (g_active_player == 1 && !permits[1]) obj+0x121 = 1
 *   case 2: g_players_in_play == 1 : c = rand() % 2; if (!permits[c]) obj+0x121 = c
 *           g_enemies_present == 1 : c = rand() % 2; obj+0x121 = permits[c] ? ~c : c
 *           else: s = ActorScreenHalfSign(obj)
 *                 s == -1 && !permits[0] ? 0 : s == 1 && !permits[1] ? 1 : none
 * }
 * if (!IsPlayerAttackable((s8)obj+0x121)) obj+0x121 = 0xFF
 * test_held: if (obj+0x121 == 0xFF) return 0
 * permits[(s8)obj+0x121] = 1; return 1
 * ```
 *
 * `TryClaimAttackSlot` (`FUN_00455DE0`)'s pick, instruction for instruction
 * (`0x0047FE9C`..`0x0047FF97`), with neither its on-screen test nor its
 * latch: the boss claims from wherever it is. With `g_attack_committed` up
 * nothing is picked and the claim fails. A taken coin is `NOT`-ed as there
 * (`0x0047FF19`), which gives -1 or -2; `IsPlayerAttackable` refuses both
 * outside attract mode, which the port does not run.
 */
export function Class32TryClaimAttackPermit(obj: Boss5Actor, rng: Rng,
                                            host?: GameHost): number {
  obj.attackPermit = -1;
  if (G.g_attack_committed === 0) {
    if (G.g_max_attackers === 1) {
      if (G.g_active_player === 0) {
        if (PermitFree(0)) obj.attackPermit = 0;
      }
      if (G.g_active_player === 1 && PermitFree(1)) obj.attackPermit = 1;
    } else if (G.g_max_attackers === 2) {
      if (G.g_players_in_play === 1) {
        const c = rng.int(2);
        if (PermitFree(c)) obj.attackPermit = c;
      } else if (G.g_enemies_present === 1) {
        const c = rng.int(2);
        obj.attackPermit = PermitFree(c) ? c : ~c;
      } else {
        const s = ActorScreenHalfSign(obj, host);
        if (s === -1) {
          if (PermitFree(0)) obj.attackPermit = 0;
        } else if (s === 1 && PermitFree(1)) {
          obj.attackPermit = 1;
        }
      }
    }
    if (!IsPlayerAttackable(obj.attackPermit)) obj.attackPermit = -1;
  }
  if (obj.attackPermit === -1) return 0;
  G.g_attack_permits[obj.attackPermit] = obj.at;
  return 1;
}

/**
 * `Class32AdjustRank` — `FUN_00480010`. `(obj, delta)`:
 * `obj+0x131E = (s8)(obj+0x131E + delta)`, then below 0 to 0 and above 15
 * to 15.
 */
export function Class32AdjustRank(obj: Boss5Actor, delta: number): void {
  const t = obj.boss5;
  t.rank = ((t.rank + delta) << 24) >> 24;
  if (t.rank < 0) t.rank = 0;
  if (t.rank > RANK_MAX) t.rank = RANK_MAX;
}

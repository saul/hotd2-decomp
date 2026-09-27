/**
 * Class 0x14's per-frame bookkeeping around the state: the route steering
 * (`Class14FollowSegment`), the phase ladder (`Class14AdvancePhase`) and the
 * adaptive rank (`Class14TrackAdaptiveRank`). All three `[proved]` from their
 * decompilations and instruction streams.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import { SpawnClass } from "../spawn_class";
import type { Vec3 } from "../vec";
import {
  Class14Flag, Class14Phase, Class14State, type Boss2Tail,
} from "./state";
import { CLASS14_RANK_MAX, Class14PhaseHpFrac } from "./tables";

function Tail(obj: Actor): Boss2Tail | null {
  return obj.cls === SpawnClass.Boss2 ? obj.boss2 : null;
}

/**
 * `Class14FollowSegment` — `FUN_00477CD0`, `(p, a, b, step)`: keep an x/z
 * point at least `step` inside the line through `a` and `b`.
 *
 * ```c
 * px = p.x - a.x;  pz = p.z - a.z;  bx = b.x - a.x;  bz = b.z - a.z
 * t = (bx*px + bz*pz) / (bx*bx + bz*bz)
 * nx = t*bx - px;  nz = t*bz - pz;  d = sqrt(nx*nx + nz*nz)   ; p to the line
 * if (d == 0) {
 *     if (step == 0) return 1
 *     if (bz != 0) p.x += (bz / |bz|) * step
 *     if (bx != 0) p.z -= (bx / |bx|) * step
 *     return 0
 * }
 * if (bz*px - bx*pz >= 0) {          ; the inner side
 *     if (step <= d) return 1        ; far enough in: nothing to do
 *     step = d - step                ; ...else back off to `step`
 * } else step = d + step             ; outside: across, and `step` in
 * p.x += step * nx / d;  p.z += step * nz / d
 * return 0
 * ```
 *
 * `Class14Update` chains three of them on the four route corners, which is
 * what keeps the boss inside the patch of water the descriptor gives it. The
 * division is unguarded, as the engine's is: every shipped route has two
 * distinct corners on each side.
 */
export function Class14FollowSegment(p: Vec3, a: Vec3, b: Vec3,
                                     step: number): boolean {
  const px = Math.fround(p.x - a.x);
  const pz = Math.fround(p.z - a.z);
  const bx = Math.fround(b.x - a.x);
  const bz = Math.fround(b.z - a.z);
  const t = Math.fround((bx * px + bz * pz) / (bx * bx + bz * bz));
  const nx = Math.fround(t * bx - px);
  const nz = Math.fround(t * bz - pz);
  const d = Math.fround(Math.sqrt(nx * nx + nz * nz));
  if (d === 0) {
    if (step === 0) return true;
    if (bz !== 0) p.x = Math.fround((bz / Math.abs(bz)) * step + p.x);
    if (bx !== 0) p.z = Math.fround(p.z - (bx / Math.abs(bx)) * step);
    return false;
  }
  let reach: number;
  if (0 <= bz * px - bx * pz) {
    if (step <= d) return true;
    reach = d - step;
  } else {
    reach = d + step;
  }
  p.x = Math.fround((reach * nx) / d + p.x);
  p.z = Math.fround((reach * nz) / d + p.z);
  return false;
}

/**
 * `Class14AdvancePhase` — `FUN_00477E60`. The phase ladder, once a frame.
 *
 * ```c
 * if ((float)hp <= (float)maxhp * frac[phase]) switch (phase) {
 *   case 0: if (4 < state < 8) { state 10; sub 0; phase 1; }
 *   case 3: if (4 < state < 8) { state 6; sub 0; phase 4; flags |= 1; +0x9C = 1; }
 *   case 5: ... phase 6, the same;  case 6: ... phase 7, the same
 *   case 8: if (4 < state < 8) { state 6; sub 0; phase 9; +0x9C = 0; }
 * }
 * ```
 *
 * Every arm needs the state to be 5, 6 or 7 -- a boss mid-leap, mid-reaction
 * or mid-cut finishes it first. Phases 1 and 4 are ended by their summoning
 * round, and 2, 7 and 9 by a death, so they have no arm.
 */
export function Class14AdvancePhase(obj: Actor): void {
  const t = Tail(obj);
  if (!t) return;
  if (!(obj.hp <= obj.maxHp * Class14PhaseHpFrac(t.phase))) return;
  const free = t.state > Class14State.Entrance4 && t.state < Class14State.Strike;
  if (!free) return;
  switch (t.phase) {
    case Class14Phase.ShortOpen:
      t.state = Class14State.SummonRoundA;
      t.sub = 0;
      t.phase = Class14Phase.ShortMid;
      return;
    case Class14Phase.LongOpen:
    case Class14Phase.LongThird:
    case Class14Phase.LongFourth:
      t.state = Class14State.Close;
      t.sub = 0;
      t.phase = t.phase === Class14Phase.LongOpen ? Class14Phase.LongSecond
        : t.phase === Class14Phase.LongThird ? Class14Phase.LongFourth
          : Class14Phase.LongFinal;
      t.flags |= Class14Flag.OffRoute;
      t.counter0 = 1;
      return;
    case Class14Phase.Stage5Open:
      t.state = Class14State.Close;
      t.sub = 0;
      t.phase = Class14Phase.Stage5Final;
      t.counter0 = 0;
      return;
    default:
      return;
  }
}

/** `(s8)` -- the rank and its bump are signed bytes. */
function S8(v: number): number {
  return (v << 24) >> 24;
}

/**
 * `Class14TrackAdaptiveRank` — `FUN_00477FF0`.
 *
 * ```c
 * if (+0x97 > 0) { +0x96++; +0x97 = 0; }          ; a damaging hit last frame
 * one player:  if (lives[active] != +0x98[active]) {
 *                  if (lives[active] < it) { +0x96 -= 3; +0x97 = 0; }
 *                  it = lives[active]; }
 * two:         for p in 0, 1: the same, but -= 2 while in state 10 or 11
 * clamp +0x96 into 0..15
 * ```
 *
 * With one player a lost life always costs **3** -- the "2 during a
 * summoning round" is the two-player arm's alone.
 */
export function Class14TrackAdaptiveRank(obj: Actor): void {
  const t = Tail(obj);
  if (!t) return;
  if (t.rankBump > 0) {
    t.rank = S8(t.rank + 1);
    t.rankBump = 0;
  }
  if (G.g_players_in_play === 1) {
    const p = G.g_active_player;
    const now = G.g_player_lives[p] ?? 0;
    if (t.lives[p] !== now) {
      if (now < t.lives[p]) {
        t.rank = S8(t.rank - 3);
        t.rankBump = 0;
      }
      t.lives[p] = S8(now);
    }
  } else {
    for (let p = 0; p < 2; p++) {
      const now = G.g_player_lives[p] ?? 0;
      if (t.lives[p] === now) continue;
      if (now < t.lives[p]) {
        const inRound = t.state === Class14State.SummonRoundA
          || t.state === Class14State.SummonRoundB;
        t.rank = S8(t.rank - (inRound ? 2 : 3));
        t.rankBump = 0;
      }
      t.lives[p] = S8(now);
    }
  }
  if (t.rank < 0) t.rank = 0;
  else if (t.rank > CLASS14_RANK_MAX) t.rank = CLASS14_RANK_MAX;
}

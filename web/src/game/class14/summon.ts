/**
 * Class 0x14's two summoning rounds, `g_class14_states[10]` and `[11]`: the
 * boss calls fish out of the water, a fixed number a round by the adaptive
 * rank, one at a time.
 *
 * The pacing is the engine's and it is three things together:
 * `SpawnWaterEnemyAt` (`FUN_00438640`) refuses while any of the four
 * `g_water_attack_slots` is held, so there is one fish in the air at a time;
 * the placement waits for `g_enemies_alive < 4` **and for the screen shake to
 * have stopped**; and a round ends only when `g_enemies_alive` is back to 1,
 * the boss alone. Each fish is seated under the surface the wave field gives
 * at its point (`WaterFieldSampleHeight`) -- one unit down in round A, ten in
 * round B -- and each round raises the rank by one unless a life was lost
 * during it.
 *
 * Both `[proved]` from the decompilation and the instruction stream. Round
 * A's dispatch is not what its pseudocode shows: sub 0 and sub 1 run the
 * approach **and then the switch**, so on the first frame the boss is still
 * far off it also takes case 0 (anim 0x1A, sub 1) -- the listing at
 * `0x004796FB` jumps through `0x00479BC4` after the approach, not instead of
 * it.
 */
import { ActorFlag, type Boss2Actor } from "../actor";
import { ActorPointIsAhead, ActorTurnTowardXZ } from "../actor_turn";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { WaterFieldSampleHeight } from "../class16";
import { SpawnWaterEnemyAt } from "../class51";
import { G } from "../globals";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixTransformPoint,
} from "../matrix";
import type { ClassFrame } from "../registry";
import { vec3 } from "../vec";
import { Class14Phase, Class14State, type Boss2Tail } from "./state";
import {
  Class14BlendAnim, Class14ClipLength, Class14Cursor, Class14Sound as Sound,
} from "./motion";
import {
  CLASS14_FLAG_ROUND_B_DONE, CLASS14_FLAG_ROUND_B_OPEN, CLASS14_RANK_MAX,
  CLASS14_TURN_STEP, Class14PhaseHpFrac, Class14Sound, Class14SummonCount,
  Class14SummonDelayA, Class14SummonDelayB,
} from "./tables";

/** The approach: within 15 on the first frame, 5 after. */
const APPROACH_FIRST = 15;
const APPROACH_THEN = 5;
/** `target - dir * 50`. */
const SWIM_BACK = 50;
/** Three rounds a visit. */
const ROUNDS = 3;
/** Round A's fish: 100 frames to live, sub-type 1, one below the surface. */
const A_LIFETIME = 100;
const A_SUBTYPE = 1;
const A_DEPTH = 1;
/** Round B's: 0x50 frames, sub-type 2, ten below. */
const B_LIFETIME = 0x50;
const B_SUBTYPE = 2;
const B_DEPTH = 10;
/** Fish are placed only while fewer than 4 enemies are alive. */
const ALIVE_CAP = 4;
/** Round B's camera cues: `cp_` 0x6A frame 0x5F, then 0x6B frame 100. */
const B_OPEN_PATH = 0x6a;
const B_OPEN_FRAME = 0x5f;
const B_DONE_PATH = 0x6b;
const B_DONE_FRAME = 100;
/** Round B's swim away: to x 190 or 270 at z -2150, by a coin. */
const B_EXIT_NEAR = 190;
const B_EXIT_FAR = 270;
const B_EXIT_Z = -2150;

function S8(v: number): number {
  return (v << 24) >> 24;
}

/** `if (+0xAC) { rank++ (to 15) }` -- a clean round ranks up. */
function RankUpIfClean(t: Boss2Tail): void {
  if (t.noLifeLost === 0) return;
  t.rank = S8(t.rank + 1);
  if (t.rank > CLASS14_RANK_MAX) t.rank = CLASS14_RANK_MAX;
}

/**
 * The lives test both rounds end their placement sub on: any life lost since
 * the round began clears `+0xAC`. One player compares its own counter; the
 * other two terms compare both players' -- all three are always evaluated,
 * as the engine's `||` chain is.
 */
function LifeLost(t: Boss2Tail): boolean {
  const L = G.g_player_lives;
  if (G.g_players_in_play === 1
      && (L[G.g_active_player] ?? 0) < t.lives[G.g_active_player]) {
    return true;
  }
  return (L[0] ?? 0) < t.lives[0] || (L[1] ?? 0) < t.lives[1];
}

/** `(float)hp <= (float)maxhp * frac[phase]` -- this round's threshold. */
function AtThreshold(obj: Boss2Actor, t: Boss2Tail): boolean {
  return obj.hp <= obj.maxHp * Class14PhaseHpFrac(t.phase);
}

/**
 * `Class14StateSummonRoundA` — `FUN_00479530`. `g_class14_states[10]`,
 * the short ladder's round.
 *
 * ```
 * sub 0 only: clear the four water slots; +0xA8 = rand() % 2; +0xAC = 0
 * sub 0, 1:   L = (target - pos) through RotY(-yaw) RotZ(-roll) RotX(pitch)
 *             (sub 0 and L.z < 15) or (sub 1 and L.z < 5):
 *                 anim 0x1B; obj+0x34 = & ~0x100 | 0x2000; B.hold = 0;
 *                 +0x9C = 3; sub = 2
 *             else swim toward target - dir * 50
 * then switch (sub):
 * 0: anim 0x1A; sub++
 * 2: len - 1: rank up if clean; anim 0xC; obj+0x34 &= ~0x2000; +0x9C--;
 *             +0xA0 = counts[rank][+0x9C]; +0xA4 = 0; +0xAC = 1; sub = 4
 *    cursor 0x2D: ZOMBIE_035
 * 3: above the threshold with rounds left: anim 0x1B; |= 0x2000; sub = 2
 *    else anim 0xC; sub = 6
 * 4: with a player in play:
 *      no fish left: once the boss is alone -- rounds left: anim 0x1B,
 *                    |= 0x2000, sub 2; else sub 6
 *      due: fewer than 4 alive and no shake: a fish on the side
 *           rand() % 3 picks against +0xA8; +0xA0--; +0xA4 = delays_a[rank]
 *      else +0xA4--
 *    at the threshold: sub = 6
 *    a life lost: +0xAC = 0 (and return)
 * 5: anim 0xC; sub = 6                                             (into 6)
 * 6: rank up if clean; +0xAC = 0
 *    the boss alone with a player in play: state 5, sub 0, phase 2,
 *    obj+0x34 |= 0x10000000
 * ```
 *
 * Subs 3 and 5 are reached only from a reaction: `Class14StateCuedMotion`
 * returns a round to its saved sub less one.
 */
export function Class14StateSummonRoundA(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  if (t.sub === 0) {
    G.g_water_attack_slots = [0, 0, 0, 0];
    // `rand() & 0x80000001` -- `% 2` of a non-negative (L46).
    t.counter3 = f.rng.int(2);
    t.noLifeLost = 0;
  }
  if (t.sub === 0 || t.sub === 1) {
    const m = MatIdentity();
    MatrixRotateY(m, -obj.yaw);
    MatrixRotateZ(m, -obj.roll);
    MatrixRotateX(m, obj.pitch);
    const L = vec3();
    MatrixTransformPoint(m, {
      x: Math.fround(t.target.x - obj.pos.x),
      y: Math.fround(t.target.y - obj.pos.y),
      z: Math.fround(t.target.z - obj.pos.z),
    }, L);
    if ((t.sub === 0 && L.z < APPROACH_FIRST)
        || (t.sub === 1 && L.z < APPROACH_THEN)) {
      Class14BlendAnim(obj, t, 0x1b);
      obj.flags = (obj.flags & ~ActorFlag.ShotImmune) | ActorFlag.NoHitReaction;
      t.bookB.hold = 0;
      t.counter0 = ROUNDS;
      t.sub = 2;
    } else {
      ActorTurnTowardXZ(obj,
        Math.fround((t.target.x - t.dir.x * SWIM_BACK) - obj.pos.x),
        Math.fround((t.target.z - t.dir.z * SWIM_BACK) - obj.pos.z),
        CLASS14_TURN_STEP);
    }
  }
  switch (t.sub) {
    case 0:
      Class14BlendAnim(obj, t, 0x1a);
      t.sub += 1;
      return;
    case 2: {
      const c = Class14Cursor(obj);
      if (c === Class14ClipLength(obj) - 1) {
        RankUpIfClean(t);
        Class14BlendAnim(obj, t, 0xc);
        obj.flags &= ~ActorFlag.NoHitReaction;
        t.counter0 -= 1;
        t.counter1 = Class14SummonCount(t.rank, t.counter0);
        t.counter2 = 0;
        t.noLifeLost = 1;
        t.sub = 4;
        return;
      }
      if (c === 0x2d) Sound(f.events, Class14Sound.Summon);
      return;
    }
    case 3:
      if (!AtThreshold(obj, t) && t.counter0 > 0) {
        Class14BlendAnim(obj, t, 0x1b);
        obj.flags |= ActorFlag.NoHitReaction;
        t.sub = 2;
        return;
      }
      Class14BlendAnim(obj, t, 0xc);
      t.sub = 6;
      return;
    case 4:
      if (G.g_players_in_play > 0) {
        if (t.counter1 === 0) {
          if (G.g_enemies_alive === 1) {
            if (t.counter0 < 1) {
              t.sub = 6;
            } else {
              Class14BlendAnim(obj, t, 0x1b);
              obj.flags |= ActorFlag.NoHitReaction;
              t.sub = 2;
            }
          }
        } else if (t.counter2 === 0) {
          if (G.g_enemies_alive < ALIVE_CAP && G.g_screen_shake_frames === 0) {
            Class14PlaceFishA(obj, t, f);
          }
        } else {
          t.counter2 -= 1;
        }
      }
      if (AtThreshold(obj, t)) t.sub = 6;
      if (LifeLost(t)) {
        t.noLifeLost = 0;
        return;
      }
      return;
    case 5:
    case 6:
      if (t.sub === 5) {
        Class14BlendAnim(obj, t, 0xc);
        t.sub = 6;
      }
      if (t.noLifeLost !== 0) {
        RankUpIfClean(t);
        t.noLifeLost = 0;
      }
      if (G.g_enemies_present === 1 && G.g_players_in_play > 0) {
        t.state = Class14State.Hunt;
        t.sub = 0;
        t.phase = Class14Phase.ShortFinal;
        obj.flags |= ActorFlag.Committed;
      }
      return;
    default:
      return;
  }
}

/**
 * Round A's placement, `0x0047993F..0x00479A3A`: 40 back along the route and
 * 30 or 40 to one side, the side a coin weighed by `+0xA8` -- the side taken
 * last time is the one `rand() % 3` has to beat.
 *
 * ```
 * if (+0xA8 < rand() % 3) { +0xA8 = 1; X = x + dir.z*30 - dir.x*40; s = dir.x*30 }
 * else                    { +0xA8 = 0; X = x - dir.z*40 - dir.x*40; s = dir.x*-40 }
 * Z = z - s - dir.z*40
 * SpawnWaterEnemyAt(X, WaterFieldSampleHeight(X, _, Z) - 1.0, Z, 100, 1)
 * ```
 *
 * `[port-only]` as a function.
 */
function Class14PlaceFishA(obj: Boss2Actor, t: Boss2Tail, f: ClassFrame): void {
  const d = t.dir;
  let X: number, s: number;
  if (t.counter3 < f.rng.int(3)) {
    t.counter3 = 1;
    X = Math.fround((d.z * 30 + obj.pos.x) - d.x * 40);
    s = d.x * 30;
  } else {
    t.counter3 = 0;
    X = Math.fround((obj.pos.x - d.z * 40) - d.x * 40);
    s = d.x * -40;
  }
  const Z = Math.fround((obj.pos.z - s) - d.z * 40);
  // The sampler reads x and z only; the y word it is handed is whatever the
  // routine's stack held, and nothing reads it.
  const Y = Math.fround(WaterFieldSampleHeight(vec3(X, 0, Z)) - A_DEPTH);
  SpawnWaterEnemyAt(X, Y, Z, A_LIFETIME, A_SUBTYPE, f.rng, f.host);
  t.counter1 -= 1;
  t.counter2 = Class14SummonDelayA(t.rank);
}

/**
 * `Class14StateSummonRoundB` — `FUN_00479BE0`. `g_class14_states[11]`, the
 * long ladder's round, fought over the pier with the camera on `cp_` 0x6A.
 *
 * ```
 * 0: blend(0x23); obj+0x34 &= ~0x4000; +0x9C = 3; clear the water slots;
 *    +0xAC = 0; sub++
 * 1: camera settled or free: g_script_flags[11] = 1; sub++
 * 2: cp 0x6A at frame 0x5F: obj+0x34 &= ~0x10100; B.hold = 0; +0xA8 = 0x1E;
 *    sub = 4
 * 3: cursor == len: rank up if clean; blend(0x23); obj+0x34 &= ~0x2000;
 *    +0x9C--; +0xA0 = counts[rank][+0x9C]; +0xA4 = 0; +0xAC = 1; sub = 6
 * 4: +0xA8-- == 0: +0xA8 = rand() % 2, then 5's body
 * 5: above the threshold with rounds left: blend(0x30); |= 0x2000;
 *    ZOMBIE_035; sub = 3;  else blend(0x23); sub = 8
 * 6: as A's sub 4, with round B's placement; its "round spent" arm plays
 *    blend(0x30), |= 0x2000, ZOMBIE_035, sub 3; the threshold sends sub 8
 * 7: blend(0x23); sub = 8                                          (into 8)
 * 8: rank up if clean; +0xAC = 0
 *    the boss alone with a player in play: blend(0x2A); sub = 9;
 *    +0x9C = rand() % 2; obj+0x34 |= 0x100
 * 9: T = (+0x9C == 0 ? 190 : 270, y, -2150)
 *    not yet past T (ActorPointIsAhead is 0): turn toward x - T
 *    past it: obj+0x34 |= 0x10000 (off the camera); sub++
 * 10: camera settled or free: g_script_flags[12] = 1; sub++
 * 11: cp 0x6B at frame 100: state 13 (Reposition); sub 0; phase 5
 * ```
 */
export function Class14StateSummonRoundB(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  switch (t.sub) {
    case 0:
      ActorSetMotionBlended(obj, 0x23, 0, 10);
      obj.flags &= ~ActorFlag.PoseFrozen;
      t.counter0 = ROUNDS;
      G.g_water_attack_slots = [0, 0, 0, 0];
      t.noLifeLost = 0;
      t.sub += 1;
      return;
    case 1:
      if (G.g_camera_settled !== 0 || G.g_camera_free !== 0) {
        G.g_script_flags[CLASS14_FLAG_ROUND_B_OPEN] = 1;
        t.sub += 1;
      }
      return;
    case 2:
      if (G.g_active_cam_path === B_OPEN_PATH
          && G.g_cam_path_frame === B_OPEN_FRAME) {
        obj.flags &= ~(ActorFlag.NoCameraTrack | ActorFlag.ShotImmune);
        t.bookB.hold = 0;
        t.counter3 = 0x1e;
        t.sub = 4;
      }
      return;
    case 3:
      if (Class14Cursor(obj) === Class14ClipLength(obj)) {
        RankUpIfClean(t);
        ActorSetMotionBlended(obj, 0x23, 0, 10);
        obj.flags &= ~ActorFlag.NoHitReaction;
        t.counter0 -= 1;
        t.counter1 = Class14SummonCount(t.rank, t.counter0);
        t.counter2 = 0;
        t.noLifeLost = 1;
        t.sub = 6;
      }
      return;
    case 4: {
      const v = t.counter3;
      t.counter3 = v - 1;
      if (v !== 0) return;
      t.counter3 = f.rng.int(2);
      Class14RoundBNext(obj, t, f);
      return;
    }
    case 5:
      Class14RoundBNext(obj, t, f);
      return;
    case 6:
      if (G.g_players_in_play > 0) {
        if (t.counter1 === 0) {
          if (G.g_enemies_alive === 1) {
            if (t.counter0 < 1) {
              t.sub = 8;
            } else {
              ActorSetMotionBlended(obj, 0x30, 0, 10);
              obj.flags |= ActorFlag.NoHitReaction;
              Sound(f.events, Class14Sound.Summon);
              t.sub = 3;
            }
          }
        } else if (t.counter2 === 0) {
          if (G.g_enemies_alive < ALIVE_CAP && G.g_screen_shake_frames === 0) {
            Class14PlaceFishB(obj, t, f);
          }
        } else {
          t.counter2 -= 1;
        }
      }
      if (AtThreshold(obj, t)) t.sub = 8;
      if (LifeLost(t)) t.noLifeLost = 0;
      return;
    case 7:
    case 8:
      if (t.sub === 7) {
        ActorSetMotionBlended(obj, 0x23, 0, 10);
        t.sub = 8;
      }
      if (t.noLifeLost !== 0) {
        RankUpIfClean(t);
        t.noLifeLost = 0;
      }
      if (G.g_enemies_present === 1 && G.g_players_in_play > 0) {
        ActorSetMotionBlended(obj, 0x2a, 0, 10);
        t.sub = 9;
        t.counter0 = f.rng.int(2);
        obj.flags |= ActorFlag.ShotImmune;
      }
      return;
    case 9: {
      const T = vec3(t.counter0 === 0 ? B_EXIT_NEAR : B_EXIT_FAR, obj.pos.y,
                     B_EXIT_Z);
      if (!ActorPointIsAhead(obj, T)) {
        ActorTurnTowardXZ(obj, Math.fround(obj.pos.x - T.x),
                          Math.fround(obj.pos.z - T.z), CLASS14_TURN_STEP);
        return;
      }
      obj.flags |= ActorFlag.NoCameraTrack;
      t.sub += 1;
      return;
    }
    case 10:
      if (G.g_camera_settled !== 0 || G.g_camera_free !== 0) {
        G.g_script_flags[CLASS14_FLAG_ROUND_B_DONE] = 1;
        t.sub += 1;
      }
      return;
    case 11:
      if (G.g_active_cam_path === B_DONE_PATH
          && G.g_cam_path_frame === B_DONE_FRAME) {
        t.state = Class14State.Reposition;
        t.sub = 0;
        t.phase = Class14Phase.LongThird;
      }
      return;
    default:
      return;
  }
}

/**
 * Round B's sub 5 body, `0x00479D3B`, which sub 4 jumps into: another round
 * while above the threshold with rounds left, else the swim away.
 * `[port-only]` as a function.
 */
function Class14RoundBNext(obj: Boss2Actor, t: Boss2Tail, f: ClassFrame): void {
  if (!AtThreshold(obj, t) && t.counter0 > 0) {
    ActorSetMotionBlended(obj, 0x30, 0, 10);
    obj.flags |= ActorFlag.NoHitReaction;
    Sound(f.events, Class14Sound.Summon);
    t.sub = 3;
    return;
  }
  ActorSetMotionBlended(obj, 0x23, 0, 10);
  t.sub = 8;
}

/**
 * Round B's placement, `0x00479EB6..0x00479FF0`: 15..25 across and 15..30
 * along the route from the boss, three draws a fish.
 *
 * ```
 * a = (float)(rand() % 11) + 15.0;  b = (float)(rand() % 16) + 15.0
 * if (+0xA8 < rand() % 3) { +0xA8 = 1; X = b*dir.x + a*dir.z + x; Z = (b*dir.z - a*dir.x) + z }
 * else                    { +0xA8 = 0; X = b*dir.x + (x - a*dir.z); Z = b*dir.z + (z + a*dir.x) }
 * SpawnWaterEnemyAt(X, WaterFieldSampleHeight(X, _, Z) - 10.0, Z, 0x50, 2)
 * ```
 *
 * `[port-only]` as a function.
 */
function Class14PlaceFishB(obj: Boss2Actor, t: Boss2Tail, f: ClassFrame): void {
  const d = t.dir;
  const a = f.rng.int(11) + 15;
  // `rand() & 0x8000000F` -- `% 16` of a non-negative (L46).
  const b = f.rng.int(16) + 15;
  let X: number, Z: number;
  if (t.counter3 < f.rng.int(3)) {
    t.counter3 = 1;
    X = Math.fround(b * d.x + a * d.z + obj.pos.x);
    Z = Math.fround((b * d.z - a * d.x) + obj.pos.z);
  } else {
    t.counter3 = 0;
    X = Math.fround(b * d.x + (obj.pos.x - a * d.z));
    Z = Math.fround(b * d.z + (obj.pos.z + a * d.x));
  }
  const Y = Math.fround(WaterFieldSampleHeight(vec3(X, 0, Z)) - B_DEPTH);
  SpawnWaterEnemyAt(X, Y, Z, B_LIFETIME, B_SUBTYPE, f.rng, f.host);
  t.counter1 -= 1;
  t.counter2 = Class14SummonDelayB(t.rank);
}

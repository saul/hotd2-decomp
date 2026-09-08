/**
 * Class 0x14 — **the stage-2 boss**, and the single biggest `wait_script_flag`
 * blocker in the game.
 *
 * Character type `0x47` is `boss2.bin`; the block that spawns it loads
 * `boss2.bin`, `scr_bosmater_st2.bin`, `sanbasi.bin` (the pier) and
 * `water_hamon.bin`, and the fight is fought over water. Five spawns in the
 * shipped scripts, and they are **four alternative endings plus one cameo**:
 *
 * | stage | block | descriptor `tail+0x01` | gates the block then waits on |
 * |---|---|---|---|
 * | 2 | 35 | 0 | 10, 17 |
 * | 2 | 37 | 1 | 10, 11, 12, 13, 14, 15, 16, 17 |
 * | 2 | 39 | 3 | 10, 17 |
 * | 2 | 41 | 4 | 10, 11, 12, 13, 14, 15, 16, 17 |
 * | 5 |  3 | 2 | 31 |
 *
 * That is **21 gates**, not the 20 across three stages the work list carried:
 * all twenty of stage 2's are this class, stage 5's one is, and **stage 4's
 * blocks 23–29 are not** — they gate on flags 31 and 32, stage 4 has no
 * class-0x14 spawn anywhere, and the writer there is class 0x19. Flag 31 has
 * two writers and only one of them is here.
 *
 * ## How a flag gets raised
 *
 * Three things in sequence, and the port needs all three or the gate never
 * opens:
 *
 * 1. An **entrance** runs until `g_bHudShutterState` reaches 1, hands over to
 *    {@link Class14StateHunt} and — for entrances 0, 1, 3 and 4 — raises
 *    `g_script_flags[10]`.
 * 2. {@link Class14AdvancePhase} walks {@link Class14Phase} as the hit points
 *    fall past `g_class14_phase_hp_frac`. Flags 11–16 are raised along the
 *    long ladder by {@link Class14StateSummonRoundB} and
 *    {@link Class14StateScriptedBreak}.
 * 3. The **death**: a shot that empties the hit points raises
 *    `ActorFlag.Dead`, {@link Class14ApplyBoneDamage} puts the boss into
 *    {@link Class14State.CuedMotion} or {@link Class14State.KnockedDown}, and
 *    that state's own frame cue reads the phase and raises flag 17 (phases 2
 *    and 7) or **flag 31** (phase 9).
 *
 * ## What is ported and what is not
 *
 * Ported: the whole state machine, the phase ladder, the descriptor tail, the
 * shot path and its damage, the reaction, the deaths and every one of the
 * twelve flag writes.
 *
 * Not ported, each `[open]` where it sits: every `PlaySoundId`, the two
 * dialogue lines, the water splashes (`0x0043FCA0`), the screen shake
 * (`0x00435E50`), the boss health bar at `0x009C8E10`, the second pose track
 * at `g_class14_state+0x7C`..`+0x90`, the six attack points
 * `Class14AdvanceMotionAndPublishPoints` (`FUN_00476AD0`) publishes, and the
 * camera `Class14StateScriptedBreak` drives with `CamEvalPath7`. All of them
 * are drawing, sound or a second copy of a pose, and none is on the path to a
 * flag.
 *
 * Two things are `[diverges]` and are marked at the line: the water enemies
 * the summoning rounds place, and the two-player arms.
 */
import type { Rng } from "../../core/rng";
import { type Actor, ActorFlag } from "../actor";
import { ActorSetMotion, ActorSetMotionBlended } from "../class30/motion_cue";
import { QueryGroundHeightAt } from "../coli";
import { ScoreAddForPlayer } from "../combat/score";
import { PlayerTakeDamage } from "../combat/player";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { MotionPlayFrame, MotionPlayLength, SecondsToTicks } from "../tables";
import { BAMS, bamsWrap, type Vec3 } from "../vec";
import {
  Class14Flag, Class14Phase, Class14State, type Boss2Tail,
} from "./state";

export { Class14Phase, Class14State } from "./state";

/**
 * `g_class14_anim_slots` — `0x00596408`, 30 pointers into
 * `g_class14_anim_cues` (`0x0059626C`). Only the **first short** of each
 * record is a motion; the rest are `{frame, code}` cue pairs the sound and
 * effect side reads, and the port has neither.
 *
 * Every id is in `boss2.bin`'s own bank, 21..58, which is what lets the
 * exporter offer that whole range and let `bake` refuse the rest.
 */
export const CLASS14_ANIM_SLOT_MOTION = [
  21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 33, 34, 37, 38, 39,
  40, 43, 44, 45, 47, 49, 50, 51, 52, 53, 54, 55, 58, 46,
];

/**
 * `g_class14_phase_hp_frac` — `0x00596670`, ten floats indexed by the phase.
 *
 * A zero is a phase that ends in a death rather than in another phase, which
 * is why `Class14AdvancePhase` has no arm for 2, 7 or 9.
 */
export const CLASS14_PHASE_HP_FRAC = [
  0.53333336, 0.33333334, 0, 0.53333336, 0.33333334,
  0.22222222, 0.11111112, 0, 0.5, 0,
];

/**
 * `g_class14_summon_delays_a` — `0x00596620` — and
 * `g_class14_summon_delays_b` — `0x00596630`. Frames between two water
 * enemies, by the adaptive rank.
 */
export const CLASS14_SUMMON_DELAYS_A = [
  75, 75, 70, 70, 65, 65, 60, 60, 55, 55, 50, 50, 45, 45, 40, 40,
];
export const CLASS14_SUMMON_DELAYS_B = [
  70, 70, 65, 65, 60, 60, 55, 55, 50, 50, 45, 45, 40, 40, 35, 35,
];

/**
 * `g_class14_summon_counts` — `0x00596640`, 16 rows of 3 bytes indexed by the
 * rank and then by the round counter at `g_class14_state+0x9C`.
 */
export const CLASS14_SUMMON_COUNTS = [
  [5, 4, 3], [6, 5, 4], [6, 5, 4], [6, 5, 4], [6, 5, 4], [7, 6, 5],
  [7, 6, 5], [7, 6, 5], [7, 6, 5], [8, 7, 6], [8, 7, 6], [8, 7, 6],
  [8, 7, 6], [9, 8, 7], [9, 8, 7], [9, 8, 7],
];

/** The rank is a signed byte the engine clamps into 0..15 on every write. */
export const CLASS14_RANK_MAX = 0xf;

/** `Class14Init` writes `MOV word ptr [EAX + 0x62], 0xB` at `0x00475F5F`. */
export const CLASS14_ANIM_SLOT_SPAWN = 0xb;

/** `obj+0x124` — the shot-test sphere `Class14Init` seats, 30.0. */
export const CLASS14_SHOT_SPHERE = 30;

/** The `g_bHudShutterState` every entrance hands the fight over on. */
export const CLASS14_SHUTTER_OPEN = 1;

/** `ActorTurnTowardXZ` (`FUN_00426120`) is passed 0x200 at every call site. */
export const CLASS14_TURN_STEP = 0x200;

/** `Class14StateHunt`'s two rings, and the heading it will not attack past. */
export const CLASS14_STRIKE_RANGE = 55;
export const CLASS14_LUNGE_RANGE = 135;
export const CLASS14_LUNGE_HEADING = 0x1fff;

/** `Class14StateClose`'s hand-over: the target inside 5 units, ahead. */
export const CLASS14_CLOSE_RANGE = 5;

/** `ScoreAddForPlayer(player, 0x5DC)` for the kill, and 10 a hit. */
export const CLASS14_SCORE_KILL = 0x5dc;
export const CLASS14_SCORE_HIT = 10;

/** The hit-reaction motion `Class14StateCuedMotion` plays, `0x00596430`. */
const ANIM_SLOT_REACT = 10;
/** `Class14StateKnockedDown`'s four, `0x00596458`/`48`/`7C`/`3C`. */
const ANIM_SLOT_LAUNCH = 0x14;
const ANIM_SLOT_LAND = 0x10;
const ANIM_SLOT_ROLL = 0x1d;
const ANIM_SLOT_GET_UP = 0xd;

function Tail(obj: Actor): Boss2Tail | null {
  return obj.cls === SpawnClass.Boss2 ? obj.boss2 : null;
}

/** The motion an anim slot names. */
function AnimMotion(slot: number): number {
  return CLASS14_ANIM_SLOT_MOTION[slot] ?? 0;
}

/** `char+0x08 == g_motion_play_length[char+0x20]`, the exe's end-of-clip cue. */
function AtClipEnd(obj: Actor, back = 0): boolean {
  const len = MotionPlayLength(obj);
  // An unbaked clip has no length, and the engine's cue can then never be
  // reached. Saying so once here is better than every state discovering it.
  if (len <= 0) return false;
  return MotionPlayFrame(obj) === len - back;
}

/** The play cursor, `char+0x08`. */
function ClipFrame(obj: Actor): number {
  return MotionPlayFrame(obj);
}

/**
 * `Class14FollowSegment` — `FUN_00477CD0`.
 *
 * Moves an x/z position toward the line through `a` and `b` by `step`, and
 * answers **true when it is already on the far side** — which is the answer
 * `Class14Update` chains on and `Class14StateClose` leaves the state on.
 */
export function Class14FollowSegment(p: Vec3, a: Vec3, b: Vec3,
                                     step: number): boolean {
  const px = p.x - a.x, pz = p.z - a.z;
  const bx = b.x - a.x, bz = b.z - a.z;
  const denom = bx * bx + bz * bz;
  if (denom === 0) return true;
  const t = (bx * px + bz * pz) / denom;
  let nx = t * bx - px;
  let nz = t * bz - pz;
  const d = Math.hypot(nx, nz);
  if (d === 0) {
    if (step === 0) return true;
    if (bz !== 0) p.x += Math.sign(bz) * step;
    if (bx !== 0) p.z -= Math.sign(bx) * step;
    return false;
  }
  let reach = step;
  if (bz * px - bx * pz >= 0) {
    if (step <= d) return true;
    reach = d - step;
  } else {
    reach = d + step;
  }
  p.x += (reach * nx) / d;
  p.z += (reach * nz) / d;
  return false;
}

/**
 * `ActorTurnTowardXZ` — `FUN_00426120`, over `ActorHeadingErrorTo`
 * (`FUN_00426090`).
 *
 * The engine builds the inverse of the actor's own rotation and transforms the
 * offset through it; with only a yaw in play — the boss's pitch and roll at
 * `obj+0x64`/`+0x6C` are never written by this class — that reduces to the
 * signed BAMS difference between the offset's heading and the actor's own.
 */
function Class14HeadingErrorTo(obj: Actor, dx: number, dz: number): number {
  const want = Math.atan2(dx, dz) * BAMS;
  let d = (want - obj.yaw) % 65536;
  if (d > 32768) d -= 65536;
  if (d < -32768) d += 65536;
  return d;
}

function Class14TurnTowardXZ(obj: Actor, dx: number, dz: number,
                             step: number): void {
  const e = Class14HeadingErrorTo(obj, dx, dz);
  if (e > step) obj.yaw = bamsWrap(obj.yaw + step);
  else if (e < -step) obj.yaw = bamsWrap(obj.yaw - step);
  else obj.yaw = bamsWrap(obj.yaw + e);
}

/**
 * `Class14Init` — `FUN_00475E90`.
 *
 * ```c
 * tail = obj+0x130C;
 * g_class14_char = obj+0x194;  g_class14_xform = obj+0x40;
 * g_cur_actor = obj;
 * g_class14_state = ActorAllocSub(0xBC);   obj+0x1310 = it;
 * obj+0x34 |= 0x8000;
 * char->type = tail[0];                    // 0x47, boss2.bin
 * state->animSlot = 0xB;  char->motion = g_class14_anim_slots[0xB][0];
 * g_enemies_present += 1;  g_enemies_alive += 1;
 * state->state = tail[1];  state->flags = 1;
 * state->dir = tail+0x04;  state->route = tail+0x10 .. +0x2C;
 * state->rank = GetDamageRank();
 * *obj = Class14Update;
 * ```
 *
 * **Both counters**, so a `wait_enemies_alive` or `wait_enemies_present` gate
 * sees the boss. Stage 2's block 35 and stage 5's block 3 both end on
 * `wait_enemies_present 0`, which is the boss's despawn and not its death.
 */
export function Class14Init(obj: Actor, rng?: Rng): void {
  void rng;
  const t = Tail(obj);
  if (!t) return;
  const d = obj.class14;
  t.flags = Class14Flag.OffRoute;
  t.state = (d?.state ?? 0) as Class14State;
  t.sub = 0;
  t.phase = Class14Phase.ShortOpen;
  t.animSlot = CLASS14_ANIM_SLOT_SPAWN;
  // `MOV dword ptr [ESI + 0x124], 0x41F00000` at `0x00475FF7` — the radius
  // `ShotTestSphere` (`FUN_00404630`) broad-phases with, **not** the camera
  // rise. The rise is `state+0x0C`, which `Class14Update` hands to
  // `ActorRegisterCameraPoint` and which only `Class14ApplyBoneDamage` writes.
  obj.hitRadius = CLASS14_SHOT_SPHERE;
  t.cameraRise = 0;
  obj.motion = AnimMotion(CLASS14_ANIM_SLOT_SPAWN);
  obj.playTicks = 0;
  obj.visible = true;
  // `MOV byte ptr [ESI + 0x121], 0xFF` and `[ESI + 0x120], 0xFF`: no player
  // picked yet. The port keeps the engine's 0xFF as -1 on `killedBy`, and the
  // target player is chosen by `ActorPickTargetPlayer` — one player here.
  obj.killedBy = -1;
  if (d) {
    t.dir.x = d.dir[0]; t.dir.y = d.dir[1]; t.dir.z = d.dir[2];
    for (let i = 0; i < 4 && i < d.route.length; i++) {
      t.route[i].x = d.route[i][0];
      t.route[i].y = d.route[i][1];
      t.route[i].z = d.route[i][2];
    }
  }
  // `GetDamageRank` (`FUN_0040A8A0`) at `0x00476113`, and the two life
  // counters at `state+0x98`/`+0x99` seeded from the players'.
  t.rank = Math.max(0, Math.min(CLASS14_RANK_MAX, G.g_damage_rank));
  t.rankBump = 0;
  t.lives = [G.g_player_lives[0] ?? 0, G.g_player_lives[1] ?? 0];
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
}

/**
 * `Class14AdvancePhase` — `FUN_00477E60`.
 *
 * The phase ladder, run once a frame from {@link Class14Update}. Every arm
 * needs the state to be 5, 6 or 7 — `4 < state && state < 8` — so a boss in
 * the middle of a leap, a reaction or a cut finishes it first.
 */
export function Class14AdvancePhase(obj: Actor): void {
  const t = Tail(obj);
  if (!t) return;
  const frac = CLASS14_PHASE_HP_FRAC[t.phase] ?? 0;
  if (obj.hp > obj.maxHp * frac) return;
  if (!(t.state > 4 && t.state < 8)) return;
  switch (t.phase) {
    case Class14Phase.ShortOpen:
      t.state = Class14State.SummonRoundA;
      t.sub = 0;
      t.phase = Class14Phase.ShortMid;
      return;
    case Class14Phase.LongOpen:
      t.state = Class14State.Close;
      t.sub = 0;
      t.phase = Class14Phase.LongSecond;
      t.flags |= Class14Flag.OffRoute;
      t.counter0 = 1;
      return;
    case Class14Phase.LongThird:
      t.state = Class14State.Close;
      t.sub = 0;
      t.phase = Class14Phase.LongFourth;
      t.flags |= Class14Flag.OffRoute;
      t.counter0 = 1;
      return;
    case Class14Phase.LongFourth:
      t.state = Class14State.Close;
      t.sub = 0;
      t.phase = Class14Phase.LongFinal;
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
      // Phases 1, 2, 4, 7 and 9 have no arm: 1 and 4 are ended by the
      // summoning round itself, and 2, 7 and 9 end in a death.
      return;
  }
}

/**
 * `Class14TrackAdaptiveRank` — `FUN_00477FF0`.
 *
 * `state+0x96` is a 0..15 rank the summoning tables index. A landed shot
 * raises `state+0x97` and this turns that into `+1`; a life lost since the
 * last frame costs **3**, or 2 while the boss is in one of the two summoning
 * rounds. Clamped into 0..15 on the way out.
 *
 * The two-player arm walks both life counters at `0x009A5C66 + p*0x98` and is
 * `[open]`: `g_players_in_play` is 1 in this port and the second half has
 * never run.
 */
export function Class14TrackAdaptiveRank(obj: Actor): void {
  const t = Tail(obj);
  if (!t) return;
  if (t.rankBump > 0) {
    t.rank += 1;
    t.rankBump = 0;
  }
  if (G.g_players_in_play === 1) {
    const p = G.g_active_player;
    const now = G.g_player_lives[p] ?? 0;
    if (t.lives[p] !== now) {
      if (now < t.lives[p]) {
        t.rank -= (t.state === Class14State.SummonRoundA
                   || t.state === Class14State.SummonRoundB) ? 2 : 3;
        t.rankBump = 0;
      }
      t.lives[p] = now;
    }
  }
  if (t.rank > CLASS14_RANK_MAX) t.rank = CLASS14_RANK_MAX;
  if (t.rank < 0) t.rank = 0;
}

/**
 * `Class14ApplyBoneDamage` — `FUN_004763E0`, the routine
 * {@link Class14ResolveShotBone} calls per player.
 *
 * The engine tests the shot ray against a cone seated on the boss's bone
 * matrix and refuses a hit outside it; the port's shot path has already picked
 * the bone through `ShotTestSphere`, so **the cone test is not re-run** —
 * `[diverges]`, and it is the same divergence class 0x20 and class 0x53 make:
 * one `pendingHit` an actor, taken where the port's ray found it.
 *
 * What is transcribed exactly is what the hit costs and what it starts:
 *
 * * the damage, `g_class14_bone_damage[zone + rank*2]` at `0x00596697`,
 *   doubled in Arcade Mode and scaled by the weapon in Original Mode;
 * * `state+0x97 += 1`, the rank bump;
 * * hit points to zero: `ActorFlag.Dead`, `g_enemies_alive -= 1`, 1500 points;
 * * otherwise 10 points and, once the phase's threshold is crossed,
 *   `ActorFlag.ShotImmune`, which is what stops the boss being shot to death
 *   *through* a phase change;
 * * and then the reaction — {@link Class14State.KnockedDown} if the boss is
 *   airborne in a leap, {@link Class14State.CuedMotion} otherwise — with the
 *   state and sub it was in saved into `nextState`/`nextSub` so the reaction
 *   can put it back.
 *
 * The damage itself is the exe's, and the FPU expression the decompiler drops
 * (L1) reads, from `0x00476749`:
 *
 * ```
 * MOVSX EAX, word ptr [g_players_in_play]
 * MOVSX EDX, byte ptr [ECX + 0x96]              ; the adaptive rank
 * MOVSX ECX, byte ptr [EAX + EDX*2 + 0x596697]  ; g_class14_bone_damage
 * FILD  ECX
 * if (g_GameMode == 1 && weapon[player].factor != -1.0f) FMUL weapon factor
 * else                                                   FADD ST0, ST0
 * if (f > g_class14_damage_cap) f = g_class14_damage_cap
 * obj->hp = ftol(obj->hp - f)
 * ```
 */

/**
 * `g_class14_bone_damage` — `0x00596698`. `[rank][g_players_in_play - 1]`.
 *
 * Two players do less each, and a player on a high adaptive rank does less
 * than one who is struggling — the same direction as every other rank table in
 * the game.
 */
export const CLASS14_BONE_DAMAGE = [
  [30, 28], [28, 26], [27, 24], [26, 23], [25, 22], [25, 22], [24, 21],
  [24, 21], [23, 20], [23, 20], [22, 19], [22, 19], [21, 18], [20, 17],
  [18, 15], [16, 13],
];

/** `g_class14_damage_cap` — `0x0055E1B4`, 33.0. */
export const CLASS14_DAMAGE_CAP = 33;

/**
 * What one shot takes off the boss.
 *
 * `[port-only]` as a function: the engine has this inline in
 * `Class14ApplyBoneDamage` and reaches the table through
 * `[EAX + EDX*2 + 0x596697]`, with the player count folded into the base. It
 * is split out here so the two numbers can be asserted on their own.
 *
 * `[open]` is the Original-Mode arm: the multiplier is `weapon[player] + 0x0C`
 * out of the array at `0x009A2240`, and the port has no such record — so
 * Original Mode takes the doubling, which is what the engine does for a
 * weapon whose factor is `-1.0f`.
 */
export function Class14DamagePerHit(rank: number): number {
  const row = CLASS14_BONE_DAMAGE[Math.max(0, Math.min(CLASS14_RANK_MAX, rank))]
    ?? CLASS14_BONE_DAMAGE[0];
  const base = row[Math.max(0, Math.min(1, G.g_players_in_play - 1))];
  return Math.min(CLASS14_DAMAGE_CAP, base * 2);
}

export function Class14ApplyBoneDamage(obj: Actor, player: number): void {
  const t = Tail(obj);
  if (!t) return;
  if ((obj.flags & ActorFlag.Dead) === 0) {
    obj.hp -= Class14DamagePerHit(t.rank);
    t.rankBump += 1;
    if (obj.hp < 1) {
      obj.hp = 0;
      obj.flags &= ~ActorFlag.NoHitReaction;
      obj.flags |= ActorFlag.Dead;
      G.g_enemies_alive -= 1;
      ScoreAddForPlayer(player, CLASS14_SCORE_KILL);
    } else if (obj.hp <= obj.maxHp * (CLASS14_PHASE_HP_FRAC[t.phase] ?? 0)) {
      obj.flags |= ActorFlag.ShotImmune;
    }
    ScoreAddForPlayer(player, CLASS14_SCORE_HIT);
  }
  // `FUN_00407310(obj, ray, 2.0)` — the blood sprite. The renderer's.
  if (obj.flags & ActorFlag.Reacting) return;
  if (obj.flags & ActorFlag.NoHitReaction) return;
  const airborne = AirborneForReaction(obj, t);
  obj.flags = (obj.flags & ~ActorFlag.PoseFrozen) | ActorFlag.Reacting;
  t.nextState = t.state;
  t.nextSub = t.sub;
  t.state = airborne ? Class14State.KnockedDown : Class14State.CuedMotion;
  t.sub = 0;
  if (!airborne) t.cameraRise = 6;         // `state+0x0C = 0x40C00000`
  t.parts = Math.min(7, t.parts + 2);
}

/**
 * The airborne test at `0x00476808`, spelt out: in state 12 or 14 anywhere
 * above the ground, or in state 9 more than five units above it.
 */
function AirborneForReaction(obj: Actor, t: Boss2Tail): boolean {
  const g = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
  if (t.state === Class14State.LeapAttack
      || t.state === Class14State.LeapFromSide) {
    return obj.pos.y > g;
  }
  if (t.state === Class14State.LungeAtCamera) return obj.pos.y > g + 5;
  return false;
}

/**
 * `Class14ResolveShotBone` — `FUN_00476270`, the first thing
 * {@link Class14Update} does.
 *
 * Returns at once unless `obj+0x34` bit 3 — `MarkActorShot`'s — is set, picks
 * which player fired from bits 1 and 2 (a `rand()` coin when both or neither
 * are up), clears all three bits, and runs {@link Class14ApplyBoneDamage} for
 * each player whose entry of `obj+0x190` names a bone. **This class is why
 * `ownsShotResult` exists**: nothing here goes near `ResolveHit`'s damage
 * tables.
 */
export function Class14ResolveShotBone(obj: Actor, rng?: Rng): void {
  if ((obj.flags & ActorFlag.Hit) === 0) return;
  const bits = obj.flags & 6;
  let first: number;
  let second: number;
  if (bits === 2) {
    first = 0; second = -1;
  } else if (bits === 4) {
    first = 1; second = -1;
  } else {
    first = rng ? (rng.int(2) & 1) : 0;
    second = first ^ 1;
  }
  obj.flags &= ~0xe;
  const bone = obj.pendingHit?.bone ?? 0;
  obj.pendingHit = null;
  for (const p of [first, second]) {
    if (p < 0) continue;
    if (p >= G.g_players_in_play) continue;
    if (bone < 1) continue;
    Class14ApplyBoneDamage(obj, p);
    // `while (*p == -1 || obj+0x190+*p < 1)` — the loop stops at the first
    // player that carries a bone, so only one damage call a frame.
    break;
  }
}

/**
 * `Class14Update` — `FUN_00476150`. One actor, one 60 Hz frame.
 *
 * ```c
 * g_class14_char = obj+0x194; g_class14_xform = obj+0x40; g_cur_actor = obj;
 * g_class14_state = obj+0x1310;
 * Class14ResolveShotBone(obj);
 * g_class14_states[state->state](obj);
 * Class14AdvanceMotionAndPublishPoints(obj);
 * if ((state->flags & 1) == 0) {
 *     if (Class14FollowSegment(xform, route+0, route+1, 5.0))
 *         Class14FollowSegment(xform, route+2, route+3, 5.0);
 *     Class14FollowSegment(xform, route+1, route+2, 10.0);
 * }
 * Class14AdvancePhase(obj);
 * ActorRegisterCameraPoint(state->cameraRise);
 * Class14TrackAdaptiveRank();
 * if (g_active_cam_path == tail+0x30 && g_cam_path_frame == tail+0x32) {
 *     g_enemy_slots[obj+0x3C] = 0; ActorDespawn(obj);
 * }
 * ```
 *
 * The three `Class14FollowSegment` calls are what keeps the boss inside the
 * quad of water the descriptor gives it, and the **order is the engine's**:
 * the second runs only when the first says the boss is past its segment.
 */
export function Class14Update(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  Class14ResolveShotBone(obj, f.rng);
  Class14RunState(obj, f);
  if ((t.flags & Class14Flag.OffRoute) === 0) {
    if (Class14FollowSegment(obj.pos, t.route[0], t.route[1], 5)) {
      Class14FollowSegment(obj.pos, t.route[2], t.route[3], 5);
    }
    Class14FollowSegment(obj.pos, t.route[1], t.route[2], 10);
  }
  Class14AdvancePhase(obj);
  Class14TrackAdaptiveRank(obj);
  const d = obj.class14;
  if (d && G.g_active_cam_path === d.despawn_path
      && G.g_cam_path_frame === d.despawn_frame) {
    ActorDespawn(obj);
  }
}

/** `CALL dword ptr [ECX*0x4 + 0x596218]` at `0x0047618F`. */
function Class14RunState(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  switch (t.state) {
    case Class14State.Entrance0:
    case Class14State.Entrance3:
      Class14StateEntranceA(obj, f); return;
    case Class14State.Entrance1:
    case Class14State.Entrance4:
      Class14StateEntranceB(obj, f); return;
    case Class14State.Entrance2: Class14StateEntranceC(obj, f); return;
    case Class14State.Hunt: Class14StateHunt(obj, f); return;
    case Class14State.Close: Class14StateClose(obj, f); return;
    case Class14State.Roar: Class14StateRoar(obj, f); return;
    case Class14State.Strike: Class14StateStrike(obj, f); return;
    case Class14State.LungeAtCamera: Class14StateLungeAtCamera(obj, f); return;
    case Class14State.SummonRoundA: Class14StateSummonRoundA(obj, f); return;
    case Class14State.SummonRoundB: Class14StateSummonRoundB(obj, f); return;
    case Class14State.LeapAttack: Class14StateLeapAttack(obj, f); return;
    case Class14State.Reposition: Class14StateReposition(obj, f); return;
    case Class14State.LeapFromSide: Class14StateLeapFromSide(obj, f); return;
    case Class14State.ScriptedBreak: Class14StateScriptedBreak(obj, f); return;
    case Class14State.CuedMotion: Class14StateCuedMotion(obj, f); return;
    case Class14State.KnockedDown: Class14StateKnockedDown(obj, f); return;
    case Class14State.DeathA: Class14StateDeathA(obj, f); return;
    case Class14State.DeathB: Class14StateDeathB(obj, f); return;
    case Class14State.DeathC: Class14StateDeathC(obj, f); return;
    default: return;
  }
}

/**
 * The hand-over every entrance ends on, at `0x0047833A`, `0x004785C3` and
 * `0x00478680`: the shutter reaches 1, the boss latches where it is standing
 * as {@link Boss2Tail.target}, drops {@link Class14Flag.OffRoute} so the route
 * steering starts, and enters {@link Class14State.Hunt}.
 *
 * `raiseFlag10` is the one thing the three do not share.
 */
function Class14EntranceHandOver(obj: Actor, t: Boss2Tail,
                                 raiseFlag10: boolean): void {
  t.state = Class14State.Hunt;
  t.sub = 0;
  t.target.x = obj.pos.x;
  t.target.y = obj.pos.y;
  t.target.z = obj.pos.z;
  obj.flags &= ~0x8000;
  t.flags &= ~Class14Flag.OffRoute;
  if (raiseFlag10) G.g_script_flags[CLASS14_FLAG_INTRO_DONE] = 1;
}

/** `g_script_flags[10]` — `0x009C7200`, index 10. `0x0047835B`, `0x004785E4`. */
export const CLASS14_FLAG_INTRO_DONE = 10;
/** `g_script_flags[11]` — `0x00479C78`, and the byte entrance 2 waits on. */
export const CLASS14_FLAG_ROUND_B_OPEN = 11;
/** `g_script_flags[12]` — `0x0047A264`. */
export const CLASS14_FLAG_ROUND_B_DONE = 12;
/** `g_script_flags[13]` / `[14]` — `0x0047B153`, `0x0047B1D7`. Phase 6. */
export const CLASS14_FLAG_BREAK_A_OPEN = 13;
export const CLASS14_FLAG_BREAK_A_DONE = 14;
/** `g_script_flags[15]` / `[16]` — `0x0047B14B`, `0x0047B1CE`. Phase 7. */
export const CLASS14_FLAG_BREAK_B_OPEN = 15;
export const CLASS14_FLAG_BREAK_B_DONE = 16;
/** `g_script_flags[17]` — `0x0047B46B`, `0x0047BA6E`. Phases 2 and 7 die. */
export const CLASS14_FLAG_DEAD = 17;
/** `g_script_flags[31]` — `0x0047B458`, `0x0047BA5B`. Phase 9 dies. */
export const CLASS14_FLAG_DEAD_STAGE5 = 31;

/**
 * `Class14StateEntranceA` — `FUN_00478160`. `g_class14_states[0]` and `[3]`.
 *
 * Six sub-states, and the arm at sub 0 is picked by reading the *state* back:
 * an actor that started in {@link Class14State.Entrance3} skips straight to
 * sub 3 with anim slot 0xE, and one that started in
 * {@link Class14State.Entrance0} plays slot 0x13 first. Sub 3 and sub 4 fall
 * through, which is the engine's — there is no `break` between them.
 */
export function Class14StateEntranceA(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  switch (t.sub) {
    case 0:
      t.phase = Class14Phase.ShortOpen;
      if (t.state === Class14State.Entrance3) {
        t.animSlot = 0xe;
        ActorSetMotion(obj, AnimMotion(0xe));
        G.g_script_flags[9] = 1;           // `DAT_009C7209 = 1` at 0x004781CE
        obj.flags &= ~0x20000;
        t.sub = 3;
      } else {
        t.animSlot = 0x13;
        ActorSetMotion(obj, AnimMotion(0x13));
        t.sub += 1;
      }
      break;
    case 1:
      if (ClipFrame(obj) === 0x1e) {
        obj.flags &= ~0x20000;
        t.sub += 1;
      }
      break;
    case 2:
      if (AtClipEnd(obj)) {
        t.animSlot = 0xe;
        ActorSetMotionBlended(obj, AnimMotion(0xe), 0, 10);
        G.g_script_flags[9] = 1;
        t.sub += 1;
      }
      break;
    case 3:
      if (ClipFrame(obj) === 0x5a) {
        t.animSlot = 0xf;
        ActorSetMotionBlended(obj, AnimMotion(0xf), 0, 10);
        t.sub += 1;
      }
      // falls through — the engine has no `break` here
      Class14EntranceAWaitShutter(obj, t);
      break;
    case 4:
      Class14EntranceAWaitShutter(obj, t);
      break;
    default:
      break;
  }
  void f;
}

function Class14EntranceAWaitShutter(obj: Actor, t: Boss2Tail): void {
  if (G.g_bHudShutterState === CLASS14_SHUTTER_OPEN) {
    Class14EntranceHandOver(obj, t, true);
  }
}

/**
 * `Class14StateEntranceB` — `FUN_004783B0`. `g_class14_states[1]` and `[4]`.
 *
 * The long fight's entrance, and the one difference that matters is the
 * phase it leaves: {@link Class14Phase.LongOpen} rather than
 * {@link Class14Phase.ShortOpen}, which is what puts flags 11–16 on the
 * boss's road. Sub 1 waits on `DAT_009C725F`, a byte
 * `PropUpdateType19`-family code raises; `[open]` in the port, so the wait is
 * transcribed and **passes at once** — declared below.
 */
export function Class14StateEntranceB(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  switch (t.sub) {
    case 0:
      t.phase = Class14Phase.LongOpen;
      if (t.state === Class14State.Entrance4) {
        ActorSetMotion(obj, 0x26);
        G.g_script_flags[9] = 1;
        t.sub = 4;
      } else {
        ActorSetMotion(obj, 0x20);
        obj.flags |= 0x8c000;
        t.sub += 1;
      }
      break;
    case 1:
      // [diverges] `DAT_009C725F` is raised by the prop family at
      // `0x00468EE4` and nothing in this port runs it, so this wait would hold
      // the entrance shut for ever. It passes on the frame it is reached,
      // which is the same rule `script/waits/flag.ts` states for a gate whose
      // writer has no module.
      t.counter0 = 0x1e;
      t.sub += 1;
      break;
    case 2:
      if (t.counter0 === 0) {
        obj.flags &= ~0xc000;
        t.sub += 1;
      } else {
        t.counter0 -= 1;
      }
      break;
    case 3:
      if (AtClipEnd(obj)) {
        ActorSetMotionBlended(obj, 0x26, 0, 10);
        obj.flags &= ~0x80000;
        G.g_script_flags[9] = 1;
        t.sub += 1;
      }
      break;
    case 4:
      if (ClipFrame(obj) === 0x5a) {
        ActorSetMotionBlended(obj, 0x27, 0, 10);
        t.sub += 1;
      }
      // falls through
      if (G.g_bHudShutterState === CLASS14_SHUTTER_OPEN) {
        Class14EntranceHandOver(obj, t, true);
      }
      break;
    case 5:
      if (G.g_bHudShutterState === CLASS14_SHUTTER_OPEN) {
        Class14EntranceHandOver(obj, t, true);
      }
      break;
    default:
      break;
  }
  void f;
}

/**
 * `Class14StateEntranceC` — `FUN_00478640`. `g_class14_states[2]`, and stage
 * 5 block 3's only spawn.
 *
 * The same six sub-states as {@link Class14StateEntranceB} with two
 * differences that decide the whole of stage 5's gate: it leaves
 * {@link Class14Phase.Stage5Open}, and **it raises no flag** — which is why
 * that block waits on 31 alone. Sub 1's wait is on `g_script_flags[11]`, and
 * the script raises it four instructions before the spawn, so it is a real
 * wait the port can evaluate.
 */
export function Class14StateEntranceC(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  switch (t.sub) {
    case 0:
      ActorSetMotion(obj, 0x20);
      obj.flags |= 0x8c000;
      t.phase = Class14Phase.Stage5Open;
      t.sub += 1;
      // falls through
      if (G.g_script_flags[CLASS14_FLAG_ROUND_B_OPEN]) {
        t.counter0 = 0x1e;
        t.sub += 1;
      }
      break;
    case 1:
      if (G.g_script_flags[CLASS14_FLAG_ROUND_B_OPEN]) {
        t.counter0 = 0x1e;
        t.sub += 1;
      }
      break;
    case 2:
      if (t.counter0 === 0) {
        obj.flags &= ~0xc000;
        t.sub += 1;
      } else {
        t.counter0 -= 1;
      }
      break;
    case 3:
      if (AtClipEnd(obj)) {
        ActorSetMotionBlended(obj, 0x26, 0, 10);
        obj.flags &= ~0x80000;
        t.sub += 1;
      }
      break;
    case 4:
      if (ClipFrame(obj) === 0x5a) {
        ActorSetMotionBlended(obj, 0x27, 0, 10);
        t.sub += 1;
      }
      // falls through
      if (G.g_bHudShutterState === CLASS14_SHUTTER_OPEN) {
        Class14EntranceHandOver(obj, t, false);
      }
      break;
    case 5:
      if (G.g_bHudShutterState === CLASS14_SHUTTER_OPEN) {
        Class14EntranceHandOver(obj, t, false);
      }
      break;
    default:
      break;
  }
  void f;
}

/**
 * `Class14StateHunt` — `FUN_00478870`. `g_class14_states[5]`.
 *
 * The hub. Sub 0 picks the swim clip from the hit points and the adaptive
 * rank; sub 1 turns to face the camera and chooses the next move from the
 * phase:
 *
 * | phase | range | heading | next |
 * |---|---|---|---|
 * | 0, 3, 8 | 55 | — | {@link Class14State.Strike} |
 * | 2, 9 | 135 | ≤ 0x1FFF | {@link Class14State.LungeAtCamera} |
 * | 5, 6, 7 | 135 | ≤ 0x1FFF | {@link Class14State.LeapAttack} |
 *
 * Phases 1 and 4 appear in none of those rows, which is the engine saying the
 * boss is in a summoning round and has no move of its own.
 */
export function Class14StateHunt(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if (t.sub === 0) {
    const p = t.phase;
    let slot: number;
    if (p === Class14Phase.ShortOpen || p === Class14Phase.LongOpen
        || p === Class14Phase.Stage5Open) {
      if (obj.hp > (CLASS14_PHASE_HP_FRAC[p] + 1) * obj.maxHp * 0.5) {
        slot = 2;
      } else if (t.rank === CLASS14_RANK_MAX) {
        slot = 4;
      } else if (t.rank === 0) {
        slot = 0;
      } else if (t.rank < 3) {
        slot = 3;
      } else {
        slot = 5;
      }
    } else {
      slot = 5;
    }
    t.animSlot = slot;
    ActorSetMotionBlended(obj, AnimMotion(slot), 0, 10);
    obj.flags &= ~ActorFlag.ShotImmune;
    t.sub += 1;
  } else if (t.sub !== 1) {
    return;
  }
  Class14TurnTowardXZ(obj, obj.pos.x - f.eye.x, obj.pos.z - f.eye.z,
                      CLASS14_TURN_STEP);
  const dx = obj.pos.x - f.eye.x;
  const dz = obj.pos.z - f.eye.z;
  const d = Math.hypot(dx, dz);
  const p = t.phase;
  if (p === Class14Phase.ShortOpen || p === Class14Phase.LongOpen
      || p === Class14Phase.Stage5Open) {
    if (d >= CLASS14_STRIKE_RANGE) return;
    t.state = Class14State.Strike;
    t.sub = 0;
    return;
  }
  if (p === Class14Phase.ShortFinal || p === Class14Phase.Stage5Final) {
    if (d >= CLASS14_LUNGE_RANGE) return;
    if (Math.abs(Class14HeadingErrorTo(obj, dx, dz)) > CLASS14_LUNGE_HEADING) {
      return;
    }
    t.state = Class14State.LungeAtCamera;
    t.sub = 0;
    return;
  }
  if (p === Class14Phase.LongThird || p === Class14Phase.LongFourth
      || p === Class14Phase.LongFinal) {
    if (d >= CLASS14_LUNGE_RANGE) return;
    if (Math.abs(Class14HeadingErrorTo(obj, dx, dz)) > CLASS14_LUNGE_HEADING) {
      return;
    }
    t.state = Class14State.LeapAttack;
    t.sub = 0;
  }
}

/**
 * `Class14StateClose` — `FUN_00478C00`. `g_class14_states[6]`.
 *
 * Two shapes, told apart by `state+0x9C`, which
 * {@link Class14AdvancePhase} sets to 1 on three of its arms and to 0 on the
 * fourth:
 *
 * * **0** — swim at the latched target and, once it is within 5 units *ahead*,
 *   enter {@link Class14State.Roar} with two roars queued;
 * * **1** — follow the route's middle segment and enter
 *   {@link Class14State.ScriptedBreak} the moment
 *   {@link Class14FollowSegment} says the boss has left it. That is the arm
 *   the flags come off.
 */
export function Class14StateClose(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if (t.sub === 0) {
    const slot = (t.phase === Class14Phase.ShortFinal
                  || t.phase === Class14Phase.LongSecond
                  || t.phase === Class14Phase.LongThird
                  || t.phase === Class14Phase.LongFourth
                  || t.phase === Class14Phase.LongFinal
                  || t.phase === Class14Phase.Stage5Final) ? 0x19 : 0x1a;
    t.animSlot = slot;
    ActorSetMotionBlended(obj, AnimMotion(slot), 0, 10);
    t.sub += 1;
  } else if (t.sub !== 1) {
    return;
  }
  if (t.counter0 === 0) {
    // The engine rotates the offset into the boss's own frame and reads the
    // forward component; with only a yaw that is a dot product.
    const dx = t.target.x - obj.pos.x;
    const dz = t.target.z - obj.pos.z;
    const c = Math.cos(obj.yaw / BAMS);
    const s = Math.sin(obj.yaw / BAMS);
    const ahead = dx * s + dz * c;
    if (ahead < CLASS14_CLOSE_RANGE) {
      t.state = Class14State.Roar;
      t.sub = 0;
      t.roars = 2;
      return;
    }
    Class14TurnTowardXZ(obj,
      (t.target.x - t.dir.x * 50) - obj.pos.x,
      (t.target.z - t.dir.z * 50) - obj.pos.z, CLASS14_TURN_STEP);
    return;
  }
  if (t.counter0 !== 1) return;
  if (!Class14FollowSegment(obj.pos, t.route[1], t.route[2], 10)) {
    t.state = Class14State.ScriptedBreak;
    t.sub = 0;
    return;
  }
  Class14TurnTowardXZ(obj,
    (t.target.x - t.dir.x * 50) - obj.pos.x,
    (t.target.z - t.dir.z * 50) - obj.pos.z, CLASS14_TURN_STEP);
  void f;
}

/**
 * `Class14StateRoar` — `FUN_00478E30`. `g_class14_states[7]`.
 *
 * Plays anim slot 8 `state+0x60` times, one sound apiece, and returns to
 * {@link Class14State.Hunt}. The count-down is on the clip's last frame, so a
 * clip the bundle has not baked would leave the boss here for ever — see
 * {@link AtClipEnd}.
 */
export function Class14StateRoar(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if (t.sub === 0) {
    t.animSlot = 8;
    ActorSetMotionBlended(obj, AnimMotion(8), 0, 10);
    t.roars -= 1;
    t.sub += 1;
  } else if (t.sub !== 1) {
    return;
  }
  if (!AtClipEnd(obj, 1) || G.g_players_in_play <= 0) return;
  if (t.roars === 0) {
    t.state = Class14State.Hunt;
    t.sub = 0;
    return;
  }
  t.roars -= 1;
  void f;
}

/**
 * `Class14StateStrike` — `FUN_00478EE0`. `g_class14_states[8]`.
 *
 * The melee. `PlayerTakeDamage` (`FUN_00415300`) at motion frame `0x3C`, and
 * `obj+0x34` bit `0x2000` opens at `0x37` — the two frames apart the port's
 * class 0x30 has too. The camera drag over frames `0x1E`..`0x37` is the
 * renderer's and is `[open]`.
 */
export function Class14StateStrike(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if (t.sub === 0) {
    t.animSlot = 0x15;
    ActorSetMotionBlended(obj, AnimMotion(0x15), 0, 10);
    t.sub += 1;
  } else if (t.sub !== 1) {
    return;
  }
  const fr = ClipFrame(obj);
  if (fr === 0x37) {
    obj.flags |= ActorFlag.NoHitReaction;
    return;
  }
  if (fr === 0x3c) {
    PlayerTakeDamage(G.g_active_player, obj, 6, f.events);
    obj.flags &= ~ActorFlag.NoHitReaction;
    t.parts = Math.max(0, t.parts - 1);
    return;
  }
  if (AtClipEnd(obj, 1)) {
    t.state = Class14State.Close;
    t.sub = 0;
    t.counter0 = 0;
    obj.flags &= ~0x10002000;
  }
}

/**
 * The three leaps share a shape, and this is it: launch toward the camera at
 * one motion frame, fall under gravity, hurt the player where it lands, bounce
 * once and settle.
 *
 * `[open]` — the arm each of the three takes when `g_max_attackers` is 2 is a
 * matrix-stack pick between the two players' seats, and this port has one
 * player, so the arm has never run.
 */
function Class14LaunchAtCamera(obj: Actor, eye: Vec3, scale: number): void {
  const dx = obj.pos.x - eye.x;
  const dz = obj.pos.z - eye.z;
  const speed = Math.hypot(dx, dz) * scale;
  obj.vel.x = Math.sin(obj.yaw / BAMS) * speed;
  obj.vel.y = 4;
  obj.vel.z = Math.cos(obj.yaw / BAMS) * speed;
  obj.accY = -0.068055555;
}

/** The integration every leap ends on, gated by {@link Class14Flag.NoIntegrate}. */
function Class14Integrate(obj: Actor, t: Boss2Tail): void {
  if (t.flags & Class14Flag.NoIntegrate) return;
  obj.pos.x += obj.vel.x;
  obj.pos.y += obj.vel.y;
  obj.pos.z += obj.vel.z;
  obj.vel.y += obj.accY;
}

/**
 * `Class14StateLungeAtCamera` — `FUN_00479030`. `g_class14_states[9]`.
 *
 * Phases 2 and 9's attack. The launch factor is `-0.0074074073` in phase 9 and
 * `-0.0076923077` everywhere else — the one number in the class that reads the
 * phase for a value rather than for a branch.
 */
export function Class14StateLungeAtCamera(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  switch (t.sub) {
    case 0:
      t.animSlot = 0x17;
      ActorSetMotionBlended(obj, AnimMotion(0x17), 0, 10);
      obj.flags = (obj.flags & ~0x2100) | 0x10000000;
      obj.vel.x = obj.vel.y = obj.vel.z = 0;
      obj.accY = 0;
      t.sub += 1;
      // falls through
      Class14LungeSub1(obj, t, f);
      break;
    case 1:
      Class14LungeSub1(obj, t, f);
      break;
    case 2:
      if (ClipFrame(obj) === 0x41) obj.flags |= ActorFlag.PoseFrozen;
      if (obj.vel.y < 0) {
        obj.flags &= ~ActorFlag.PoseFrozen;
        t.sub += 1;
      }
      break;
    case 3: {
      if (ClipFrame(obj) === 0x55) obj.flags |= ActorFlag.PoseFrozen;
      const g = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
      if (obj.pos.y < g + 22) {
        PlayerTakeDamage(G.g_active_player, obj, 6, f.events);
        obj.vel.x *= 0.1; obj.vel.y *= 0.1; obj.vel.z *= 0.1;
        obj.accY = 0;
        t.counter0 = 10;
        t.parts = Math.max(0, t.parts - 1);
        t.sub += 1;
      }
      t.parts = 7;
      break;
    }
    case 4:
      if (t.counter0 === 0) {
        obj.flags &= ~ActorFlag.PoseFrozen;
        obj.vel.x *= -2.5;
        obj.vel.y = 0.1;
        obj.vel.z *= -2.5;
        obj.accY = -0.068055555;
        t.sub += 1;
      } else {
        t.counter0 -= 1;
      }
      break;
    case 5: {
      const g = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
      if (obj.pos.y < g) {
        obj.vel.x = obj.vel.y = obj.vel.z = 0;
        obj.accY = 0;
        obj.pos.y = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
      }
      if (AtClipEnd(obj, 1)) {
        t.state = Class14State.Close;
        t.sub = 0;
        t.counter0 = 0;
        obj.flags &= ~0x10002000;
      }
      break;
    }
    default:
      break;
  }
  Class14Integrate(obj, t);
}

function Class14LungeSub1(obj: Actor, t: Boss2Tail, f: ClassFrame): void {
  if (G.g_max_attackers === 2) return;      // `[open]`, the two-player arm
  Class14TurnTowardXZ(obj, obj.pos.x - f.eye.x, obj.pos.z - f.eye.z,
                      CLASS14_TURN_STEP);
  if (ClipFrame(obj) !== 0x23) return;
  Class14LaunchAtCamera(obj, f.eye,
    t.phase === Class14Phase.Stage5Final ? -0.0074074073 : -0.0076923077);
  t.sub += 1;
}

/**
 * `Class14StateSummonRoundA` — `FUN_00479530`. `g_class14_states[10]`.
 *
 * Phase 1's round. It calls `SpawnWaterEnemyAt` (`FUN_00438640`) with a
 * lifetime of 100 and sub-type 1 while `g_enemies_alive` is under four, spaces
 * them by `g_class14_summon_delays_a[rank]` and takes the count out of
 * `g_class14_summon_counts`. When the round is spent and the boss is the only
 * thing alive it returns to {@link Class14State.Hunt} with the phase set to
 * {@link Class14Phase.ShortFinal} — the phase whose death raises flag 17.
 *
 * `[diverges]` **The water enemies are not placed.** Class 0x51 has no module,
 * so `SpawnWaterEnemyAt` would build an actor nothing runs. The counting is
 * transcribed exactly and the placement is not, which means the round is over
 * as soon as its counters run out rather than when the water is clear. Porting
 * class 0x51 retires it.
 */
export function Class14StateSummonRoundA(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if (t.sub === 0 || t.sub === 1) {
    if (t.sub === 0) {
      t.counter3 = f.rng.int(2) & 1;
      t.hurtThisRound = 0;
    }
    const dx = t.target.x - obj.pos.x;
    const dz = t.target.z - obj.pos.z;
    const c = Math.cos(obj.yaw / BAMS);
    const s = Math.sin(obj.yaw / BAMS);
    const ahead = dx * s + dz * c;
    if ((t.sub === 0 && ahead < 15) || (t.sub === 1 && ahead < 5)) {
      t.animSlot = 0x1b;
      ActorSetMotionBlended(obj, AnimMotion(0x1b), 0, 10);
      obj.flags = (obj.flags & ~ActorFlag.ShotImmune)
        | ActorFlag.NoHitReaction;
      t.counter0 = 3;
      t.sub = 2;
      return;
    }
    Class14TurnTowardXZ(obj,
      (t.target.x - t.dir.x * 50) - obj.pos.x,
      (t.target.z - t.dir.z * 50) - obj.pos.z, CLASS14_TURN_STEP);
    return;
  }
  switch (t.sub) {
    case 2:
      if (AtClipEnd(obj, 1)) {
        if (t.hurtThisRound !== 0) {
          t.rank = Math.min(CLASS14_RANK_MAX, t.rank + 1);
        }
        t.animSlot = 0xc;
        ActorSetMotionBlended(obj, AnimMotion(0xc), 0, 10);
        obj.flags &= ~ActorFlag.NoHitReaction;
        t.counter0 -= 1;
        t.counter1 = CLASS14_SUMMON_COUNTS[t.rank]?.[t.counter0] ?? 0;
        t.counter2 = 0;
        t.hurtThisRound = 1;
        t.sub = 4;
      }
      break;
    case 3:
      if (obj.hp > obj.maxHp * (CLASS14_PHASE_HP_FRAC[t.phase] ?? 0)
          && t.counter0 > 0) {
        t.animSlot = 0x1b;
        ActorSetMotionBlended(obj, AnimMotion(0x1b), 0, 10);
        obj.flags |= ActorFlag.NoHitReaction;
        t.sub = 2;
        return;
      }
      t.animSlot = 0xc;
      ActorSetMotionBlended(obj, AnimMotion(0xc), 0, 10);
      t.sub = 6;
      break;
    case 4:
      if (G.g_players_in_play > 0) {
        if (t.counter1 === 0) {
          if (G.g_enemies_alive === 1) {
            if (t.counter0 < 1) {
              t.sub = 6;
            } else {
              t.animSlot = 0x1b;
              ActorSetMotionBlended(obj, AnimMotion(0x1b), 0, 10);
              obj.flags |= ActorFlag.NoHitReaction;
              t.sub = 2;
            }
          }
        } else if (t.counter2 === 0) {
          if (G.g_enemies_alive < 4) {
            // `SpawnWaterEnemyAt` (`FUN_00438640`) with a lifetime of 100
            // and sub-type 1 goes here. Class 0x51 has no module, so an actor
            // built for it would stand in the water doing nothing and hold
            // `g_enemies_alive` above 1 for ever — which is the test this
            // round's own exit reads. The counting is transcribed and the
            // placement is not, so the round ends on its counters rather than
            // on the water being cleared. `[diverges]`
            t.counter3 = f.rng.int(3) > t.counter3 ? 1 : 0;
            t.counter1 -= 1;
            t.counter2 = CLASS14_SUMMON_DELAYS_A[t.rank] ?? 0;
          }
        } else {
          t.counter2 -= 1;
        }
      }
      if (obj.hp <= obj.maxHp * (CLASS14_PHASE_HP_FRAC[t.phase] ?? 0)) {
        t.sub = 6;
      }
      break;
    case 5:
      t.animSlot = 0xc;
      ActorSetMotionBlended(obj, AnimMotion(0xc), 0, 10);
      t.sub = 6;
      // falls through
      Class14SummonRoundAEnd(obj, t);
      break;
    case 6:
      Class14SummonRoundAEnd(obj, t);
      break;
    default:
      break;
  }
}

function Class14SummonRoundAEnd(obj: Actor, t: Boss2Tail): void {
  if (t.hurtThisRound !== 0) {
    t.rank = Math.min(CLASS14_RANK_MAX, t.rank + 1);
    t.hurtThisRound = 0;
  }
  if (G.g_enemies_present === 1 && G.g_players_in_play > 0) {
    t.state = Class14State.Hunt;
    t.sub = 0;
    t.phase = Class14Phase.ShortFinal;
    obj.flags |= 0x10000000;
  }
}

/**
 * `Class14StateSummonRoundB` — `FUN_00479BE0`. `g_class14_states[11]`.
 *
 * Phase 4's round, and **the state that raises flags 11 and 12**: 11 at
 * `0x00479C78` once the camera has settled on the cut, 12 at `0x0047A264`
 * after the swim away. It ends by entering {@link Class14State.Reposition}
 * with the phase set to {@link Class14Phase.LongThird}.
 *
 * Its own hand-overs read `g_active_cam_path` and `g_cam_path_frame` — sub 2
 * wants slot 0x6A at frame 0x5F and sub 0xB slot 0x6B at frame 100 — which
 * the port carries, so they are transcribed as they stand. The water enemies
 * carry the same `[diverges]` as {@link Class14StateSummonRoundA}'s.
 */
export function Class14StateSummonRoundB(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  switch (t.sub) {
    case 0:
      ActorSetMotionBlended(obj, 0x23, 0, 10);
      obj.flags &= ~ActorFlag.PoseFrozen;
      t.counter0 = 3;
      t.hurtThisRound = 0;
      t.sub += 1;
      return;
    case 1:
      if (G.g_camera_settled !== 0 || G.g_camera_free !== 0) {
        G.g_script_flags[CLASS14_FLAG_ROUND_B_OPEN] = 1;
        t.sub += 1;
      }
      return;
    case 2:
      if (G.g_active_cam_path === 0x6a && G.g_cam_path_frame === 0x5f) {
        obj.flags &= ~0x10100;
        t.counter3 = 0x1e;
        t.sub = 4;
      }
      return;
    case 3:
      if (AtClipEnd(obj)) {
        if (t.hurtThisRound !== 0) {
          t.rank = Math.min(CLASS14_RANK_MAX, t.rank + 1);
        }
        ActorSetMotionBlended(obj, 0x23, 0, 10);
        obj.flags &= ~ActorFlag.NoHitReaction;
        t.counter0 -= 1;
        t.counter1 = CLASS14_SUMMON_COUNTS[t.rank]?.[t.counter0] ?? 0;
        t.counter2 = 0;
        t.hurtThisRound = 1;
        t.sub = 6;
      }
      return;
    case 4:
      if (t.counter3 === 0) {
        t.counter3 = f.rng.int(2) & 1;
        Class14SummonRoundBSub5(obj, t);
      } else {
        t.counter3 -= 1;
      }
      return;
    case 5:
      Class14SummonRoundBSub5(obj, t);
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
              t.sub = 3;
            }
          }
        } else if (t.counter2 === 0) {
          if (G.g_enemies_alive < 4) {
            // `SpawnWaterEnemyAt` (`FUN_00438640`) with a lifetime of 0x50
            // and sub-type 2 goes here, and it is the same unported class 0x51
            // as {@link Class14StateSummonRoundA}'s: the count is kept and the
            // enemy is not placed, so the round is over when its counters run
            // out rather than when the water is clear. `[diverges]`
            t.counter3 = f.rng.int(3) > t.counter3 ? 1 : 0;
            t.counter1 -= 1;
            t.counter2 = CLASS14_SUMMON_DELAYS_B[t.rank] ?? 0;
          }
        } else {
          t.counter2 -= 1;
        }
      }
      if (obj.hp <= obj.maxHp * (CLASS14_PHASE_HP_FRAC[t.phase] ?? 0)) {
        t.sub = 8;
      }
      return;
    case 7:
      ActorSetMotionBlended(obj, 0x23, 0, 10);
      t.sub = 8;
      // falls through
      Class14SummonRoundBEnd(obj, t, f);
      return;
    case 8:
      Class14SummonRoundBEnd(obj, t, f);
      return;
    case 9: {
      // The engine drives to a literal point — 270 or 190 by the coin, and
      // `z = -2150`, which are stage 2's own coordinates.
      const tx = t.counter0 === 0 ? 190 : 270;
      const tz = -2150;
      const ahead = (tx - obj.pos.x) * Math.sin(obj.yaw / BAMS)
        + (tz - obj.pos.z) * Math.cos(obj.yaw / BAMS);
      if (ahead > 0) {
        Class14TurnTowardXZ(obj, obj.pos.x - tx, obj.pos.z - tz,
                            CLASS14_TURN_STEP);
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
      if (G.g_active_cam_path === 0x6b && G.g_cam_path_frame === 100) {
        t.state = Class14State.Reposition;
        t.sub = 0;
        t.phase = Class14Phase.LongThird;
      }
      return;
    default:
      return;
  }
}

function Class14SummonRoundBSub5(obj: Actor, t: Boss2Tail): void {
  if (obj.hp > obj.maxHp * (CLASS14_PHASE_HP_FRAC[t.phase] ?? 0)
      && t.counter0 > 0) {
    ActorSetMotionBlended(obj, 0x30, 0, 10);
    obj.flags |= ActorFlag.NoHitReaction;
    t.sub = 3;
    return;
  }
  ActorSetMotionBlended(obj, 0x23, 0, 10);
  t.sub = 8;
}

function Class14SummonRoundBEnd(obj: Actor, t: Boss2Tail, f: ClassFrame): void {
  if (t.hurtThisRound !== 0) {
    t.rank = Math.min(CLASS14_RANK_MAX, t.rank + 1);
    t.hurtThisRound = 0;
  }
  if (G.g_enemies_present === 1 && G.g_players_in_play > 0) {
    ActorSetMotionBlended(obj, 0x2a, 0, 10);
    t.sub = 9;
    t.counter0 = f.rng.int(2) & 1;
    obj.flags |= ActorFlag.ShotImmune;
  }
}

/**
 * `Class14StateLeapAttack` — `FUN_0047A2E0`. `g_class14_states[12]`.
 *
 * Phases 5, 6 and 7's attack, and the same launch/land/bounce as
 * {@link Class14StateLungeAtCamera} over motion `0x33`. Its exit sets the
 * state to {@link Class14State.Close} with `state+0x9C` cleared.
 */
export function Class14StateLeapAttack(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  switch (t.sub) {
    case 0:
      ActorSetMotionBlended(obj, 0x33, 0, 10);
      obj.flags = (obj.flags & ~ActorFlag.ShotImmune) | 0x10000000;
      obj.vel.x = obj.vel.y = obj.vel.z = 0;
      obj.accY = 0;
      t.sub += 1;
      // falls through
      Class14LeapAttackSub1(obj, t, f);
      break;
    case 1:
      Class14LeapAttackSub1(obj, t, f);
      break;
    case 2:
      if (ClipFrame(obj) === 0x41) obj.flags |= ActorFlag.PoseFrozen;
      if (obj.vel.y < 0) {
        obj.flags &= ~ActorFlag.PoseFrozen;
        t.sub += 1;
      }
      break;
    case 3: {
      if (ClipFrame(obj) === 0x55) obj.flags |= ActorFlag.PoseFrozen;
      const g = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
      if (obj.pos.y < g + 22) {
        PlayerTakeDamage(G.g_active_player, obj, 6, f.events);
        obj.vel.x *= 0.1; obj.vel.y *= 0.1; obj.vel.z *= 0.1;
        obj.accY = 0;
        t.counter0 = 10;
        t.parts = Math.max(0, t.parts - 1);
        t.sub += 1;
      }
      t.parts = 7;
      break;
    }
    case 4:
      if (t.counter0 === 0) {
        obj.flags &= ~ActorFlag.PoseFrozen;
        obj.vel.x *= -2.5;
        obj.vel.y = 0.1;
        obj.vel.z *= -2.5;
        obj.accY = -0.068055555;
        t.sub += 1;
      } else {
        t.counter0 -= 1;
      }
      break;
    case 5: {
      const g = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
      if (obj.pos.y < g) {
        obj.vel.x = obj.vel.y = obj.vel.z = 0;
        obj.accY = 0;
        obj.pos.y = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
      }
      if (AtClipEnd(obj, 1)) {
        t.state = Class14State.Close;
        t.sub = 0;
        t.counter0 = 0;
        obj.flags &= ~0x10002000;
      }
      break;
    }
    default:
      break;
  }
  Class14Integrate(obj, t);
}

function Class14LeapAttackSub1(obj: Actor, t: Boss2Tail, f: ClassFrame): void {
  if (G.g_max_attackers === 2) return;      // `[open]`, the two-player arm
  Class14TurnTowardXZ(obj, obj.pos.x - f.eye.x, obj.pos.z - f.eye.z,
                      CLASS14_TURN_STEP);
  if (ClipFrame(obj) !== 0x23) return;
  Class14LaunchAtCamera(obj, f.eye, -0.0076923077);
  t.sub += 1;
}

/**
 * `Class14StateReposition` — `FUN_0047A7C0`. `g_class14_states[13]`.
 *
 * Puts the boss 65 units to one side of the route's mid-line, facing along the
 * descriptor's direction, plays anim `0x38` or `0x39` by `state+0x9C`, and
 * hands back to {@link Class14State.Hunt}.
 */
export function Class14StateReposition(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if (t.sub === 0) {
    const mid = (t.route[2].x + t.route[1].x) * 0.5;
    if (t.counter0 === 0) {
      ActorSetMotion(obj, 0x38);
      obj.pos.x = mid - 65;
    } else {
      ActorSetMotion(obj, 0x39);
      obj.pos.x = mid + 65;
    }
    obj.yaw = bamsWrap(Math.round(Math.atan2(-t.dir.x, -t.dir.z) * BAMS));
    obj.pos.z = t.route[1].z;
    obj.pos.y = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
    obj.flags &= ~0x84000;
    t.sub += 1;
    return;
  }
  if (t.sub !== 1) return;
  if (AtClipEnd(obj, 1)) {
    t.state = Class14State.Hunt;
    t.sub = 0;
    obj.flags &= ~0x2100;
    t.flags &= ~Class14Flag.OffRoute;
  }
  void f;
}

/**
 * `Class14StateLeapFromSide` — `FUN_0047A990`. `g_class14_states[14]`.
 *
 * The leap {@link Class14StateScriptedBreak} hands over to. Places the boss 60
 * units to one side, launches at the camera on the same terms as the other
 * two, plays a dialogue line at motion frame `0x2D` (`[open]`) and damages the
 * player where it lands.
 */
export function Class14StateLeapFromSide(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  switch (t.sub) {
    case 0: {
      const mid = (t.route[2].x + t.route[1].x) * 0.5;
      obj.pos.x = t.counter0 === 0 ? mid - 60 : mid + 60;
      ActorSetMotionBlended(obj, 0x33, 0x23, 0);
      obj.pos.z = t.route[1].z;
      obj.pos.y = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
      if (G.g_max_attackers === 2) return;  // `[open]`, the two-player arm
      obj.yaw = bamsWrap(Math.round(
        Math.atan2(obj.pos.x - f.eye.x, obj.pos.z - f.eye.z) * BAMS));
      Class14LaunchAtCamera(obj, f.eye, -0.0076923077);
      obj.flags = (obj.flags & ~0x84000) | 0x10000000;
      t.sub += 1;
      break;
    }
    case 1: {
      const fr = ClipFrame(obj);
      if (fr === 0x41) obj.flags |= ActorFlag.PoseFrozen;
      else if (fr === 0x2d) obj.flags &= ~ActorFlag.NoCameraTrack;
      if (obj.vel.y < 0) {
        obj.flags &= ~0x6100;
        t.sub += 1;
      }
      break;
    }
    case 2:
      if (t.flags & Class14Flag.OffRoute) {
        t.flags &= ~Class14Flag.OffRoute;
        t.sub += 1;
      }
      // falls through
      Class14LeapFromSideSub3(obj, t, f);
      break;
    case 3:
      Class14LeapFromSideSub3(obj, t, f);
      break;
    case 4:
      if (t.counter0 === 0) {
        obj.flags &= ~ActorFlag.PoseFrozen;
        obj.vel.x *= -2.5;
        obj.vel.y = 0.1;
        obj.vel.z *= -2.5;
        obj.accY = -0.068055555;
        t.sub += 1;
      } else {
        t.counter0 -= 1;
      }
      break;
    case 5: {
      const g = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
      if (obj.pos.y < g) {
        obj.vel.x = obj.vel.y = obj.vel.z = 0;
        obj.accY = 0;
        obj.pos.y = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
      }
      if (AtClipEnd(obj, 1)) {
        t.state = Class14State.Close;
        t.sub = 0;
        t.counter0 = 0;
        obj.flags &= ~0x10000000;
      }
      break;
    }
    default:
      break;
  }
  Class14Integrate(obj, t);
}

function Class14LeapFromSideSub3(obj: Actor, t: Boss2Tail,
                                 f: ClassFrame): void {
  if (ClipFrame(obj) === 0x55) obj.flags |= ActorFlag.PoseFrozen;
  const g = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
  if (obj.pos.y < g + 22) {
    PlayerTakeDamage(G.g_active_player, obj, 6, f.events);
    obj.vel.x *= 0.1; obj.vel.y *= 0.1; obj.vel.z *= 0.1;
    obj.accY = 0;
    t.counter0 = 10;
    t.parts = Math.max(0, t.parts - 1);
    t.sub = 4;
  }
  t.parts = 7;
}

/**
 * `Class14StateScriptedBreak` — `FUN_0047AF60`. `g_class14_states[15]`.
 *
 * The between-rounds cut, and **the state four of the eight middle flags come
 * off**. Sub 3 forks on the phase: {@link Class14Phase.LongSecond} goes to
 * {@link Class14State.SummonRoundB}, and everything else drives on into subs 4
 * and 5, which raise
 *
 * * `g_script_flags[13]` (phase 6) or `[15]` (phase 7) once the camera has
 *   settled, and
 * * `g_script_flags[14]` (phase 6) or `[16]` (phase 7) at path frame `0xA1`.
 *
 * The camera itself is `CamEvalPath7` over `cp_` slot `0x6C` or `0x6D` picked
 * by a coin, which is `[open]` — the port's walker owns the camera and this
 * class cannot take it. The **path frame** is still counted, because the
 * second flag hangs off it.
 */
export function Class14StateScriptedBreak(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  switch (t.sub) {
    case 0:
      ActorSetMotionBlended(obj, 0x24, 0, 10);
      t.sub += 1;
      return;
    case 1:
      if (AtClipEnd(obj, 1)) {
        t.counter2 = 10;
        obj.flags |= 0x14000;
        t.sub += 1;
        return;
      }
      if (ClipFrame(obj) === 10) obj.flags |= 0x80000;
      return;
    case 2:
      if (t.counter2 === 0) {
        obj.pos.x -= t.dir.x * 40;
        obj.pos.z -= t.dir.z * 40;
        obj.yaw = bamsWrap(-0x8000 - G.g_camera_yaw_bams);
        t.counter2 = 0x14;
        t.sub += 1;
      } else {
        t.counter2 -= 1;
      }
      return;
    case 3:
      if (t.counter2 === 0) {
        if (t.phase === Class14Phase.LongSecond) {
          t.state = Class14State.SummonRoundB;
          t.sub = 0;
          return;
        }
        t.sub += 1;
      } else {
        t.counter2 -= 1;
      }
      return;
    case 4:
      if (G.g_camera_settled !== 0 || G.g_camera_free !== 0) {
        if (t.phase === Class14Phase.LongFourth) {
          G.g_script_flags[CLASS14_FLAG_BREAK_A_OPEN] = 1;
        } else if (t.phase === Class14Phase.LongFinal) {
          G.g_script_flags[CLASS14_FLAG_BREAK_B_OPEN] = 1;
        }
        t.counter0 = (f.rng.int(2) & 1) === 0 ? 0x6d : 0x6c;
        t.counter1 = 0;
        t.sub += 1;
      }
      return;
    case 5:
      if (t.counter1 === 0xa1) {
        if (t.phase === Class14Phase.LongFourth) {
          G.g_script_flags[CLASS14_FLAG_BREAK_A_DONE] = 1;
        } else if (t.phase === Class14Phase.LongFinal) {
          G.g_script_flags[CLASS14_FLAG_BREAK_B_DONE] = 1;
        }
        t.counter0 = f.rng.int(2) & 1;
        t.state = Class14State.LeapFromSide;
        t.sub = 0;
        return;
      }
      // `CamEvalPath7(state->counter0, state->counter1, ...)` — `[open]`.
      t.counter1 += 1;
      return;
    default:
      return;
  }
}

/**
 * The death fork both reaction states carry, at `0x0047B44E` and
 * `0x0047BA4D`. Reached at motion frame `0x14` (`Class14StateCuedMotion`) or
 * `0x3C` (`Class14StateKnockedDown`) with `ActorFlag.Dead` up.
 *
 * **This is where every one of the game's twenty-one class-0x14 gates is
 * finally opened**, and the phase alone decides which flag.
 */
function Class14EnterDeathForPhase(t: Boss2Tail): boolean {
  if (t.phase === Class14Phase.ShortFinal) {
    t.state = Class14State.DeathA;
    G.g_script_flags[CLASS14_FLAG_DEAD] = 1;
  } else if (t.phase === Class14Phase.LongFinal) {
    t.state = Class14State.DeathB;
    G.g_script_flags[CLASS14_FLAG_DEAD] = 1;
  } else if (t.phase === Class14Phase.Stage5Final) {
    t.state = Class14State.DeathC;
    G.g_script_flags[CLASS14_FLAG_DEAD_STAGE5] = 1;
  } else {
    return false;
  }
  t.sub = 0;
  return true;
}

/**
 * `Class14StateCuedMotion` — `FUN_0047B280`. `g_class14_states[16]`.
 *
 * The hit reaction on the ground. Plays the clip its anim slot names — `0x29`
 * when the boss was in {@link Class14State.SummonRoundB}, the slot-10 clip
 * otherwise — swims back toward the latched point, and when the clip ends
 * returns to the state saved in `nextState`, with three special cases the
 * engine spells out: state 7 goes to {@link Class14State.Hunt}, states 8, 9,
 * 12 and 14 go to {@link Class14State.Close}, and states 10 and 11 resume at
 * `nextSub - 1`.
 */
export function Class14StateCuedMotion(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if (t.sub === 0) {
    if (t.nextState === Class14State.SummonRoundB) {
      ActorSetMotionBlended(obj, 0x29, 0, 10);
    } else {
      t.animSlot = ANIM_SLOT_REACT;
      ActorSetMotionBlended(obj, AnimMotion(ANIM_SLOT_REACT), 0, 10);
      if (obj.flags & 0x20000) {
        obj.pos.y = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
      }
    }
    t.sub += 1;
  } else if (t.sub !== 1) {
    return;
  }
  Class14TurnTowardXZ(obj,
    (t.target.x - t.dir.x * 100) - obj.pos.x,
    (t.target.z - t.dir.z * 100) - obj.pos.z, CLASS14_TURN_STEP);
  if (AtClipEnd(obj, 1)) {
    const back = t.nextState;
    if (back === Class14State.Roar) {
      t.state = Class14State.Hunt;
      t.roars = 0;
      t.sub = 0;
    } else if (back === Class14State.Strike
               || back === Class14State.LungeAtCamera
               || back === Class14State.LeapAttack
               || back === Class14State.LeapFromSide) {
      t.state = Class14State.Close;
      t.sub = 0;
      t.counter0 = 0;
    } else if (back === Class14State.SummonRoundA
               || back === Class14State.SummonRoundB) {
      t.state = back;
      t.sub = t.nextSub - 1;
    } else {
      t.state = back;
      t.sub = 0;
    }
    obj.flags &= ~ActorFlag.Reacting;
    return;
  }
  if (ClipFrame(obj) === 0x14 && (obj.flags & ActorFlag.Dead)) {
    if (Class14EnterDeathForPhase(t)) return;
    t.sub = 0;
  }
  void f;
}

/**
 * `Class14StateKnockedDown` — `FUN_0047B4C0`. `g_class14_states[17]`.
 *
 * The reaction taken when the shot landed while the boss was airborne: it is
 * thrown away from the camera, falls, plays the roll and the get-up and
 * returns to {@link Class14State.Close}. Its death fork is the same one, at
 * motion frame `0x3C` — `0x0047BA5B` for flag 31 and `0x0047BA6E` for 17.
 */
export function Class14StateKnockedDown(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  switch (t.sub) {
    case 0: {
      t.counter1 = 10;
      t.counter0 = 9;
      t.animSlot = ANIM_SLOT_LAUNCH;
      ActorSetMotionBlended(obj, AnimMotion(ANIM_SLOT_LAUNCH), 1, 10);
      const dx = obj.pos.x - f.eye.x;
      const dz = obj.pos.z - f.eye.z;
      const pitch = Math.atan2(obj.pos.y - f.eye.y, Math.hypot(dx, dz));
      const yaw = Math.atan2(dx, dz);
      if (t.phase === Class14Phase.ShortFinal) {
        obj.vel.x = Math.cos(pitch) * t.dir.x * -2.5;
        obj.vel.z = Math.cos(pitch) * t.dir.z * -2.5;
      } else {
        obj.vel.x = Math.sin(yaw) * Math.cos(pitch) * 2.5;
        obj.vel.z = Math.cos(yaw) * Math.cos(pitch) * 2.5;
      }
      obj.vel.y = Math.sin(pitch) * 2.5;
      obj.accY = -0.08166666;
      t.sub += 1;
      break;
    }
    case 1: {
      if (t.counter0 !== 0) {
        t.counter0 -= 1;
        ActorSetMotionBlended(obj, AnimMotion(ANIM_SLOT_LAUNCH),
                              t.counter1 - t.counter0, 10);
      }
      const g = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
      if (obj.pos.y < g) {
        obj.vel.x *= 0.1;
        obj.vel.z *= 0.1;
        obj.vel.y = 0;
        obj.accY = 0;
        obj.pos.y = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 100, obj.pos.z);
        if (obj.flags & ActorFlag.PoseFrozen) {
          Class14KnockedDownToRoll(obj, t);
          break;
        }
        t.sub = 2;
      }
      // falls through
      Class14KnockedDownSub2(obj, t);
      break;
    }
    case 2:
      Class14KnockedDownSub2(obj, t);
      break;
    case 3:
      if (t.counter0 !== 0) {
        t.animSlot = ANIM_SLOT_ROLL;
        t.counter0 -= 1;
        ActorSetMotionBlended(obj, AnimMotion(ANIM_SLOT_ROLL),
                              t.counter1 - t.counter0, 10);
      }
      if (AtClipEnd(obj)) {
        obj.vel.x = 0;
        obj.vel.z = 0;
        t.animSlot = ANIM_SLOT_GET_UP;
        ActorSetMotionBlended(obj, AnimMotion(ANIM_SLOT_GET_UP), 0, 10);
        t.sub = 4;
      }
      break;
    case 4:
      if (AtClipEnd(obj, 1)) {
        t.state = Class14State.Close;
        t.counter0 = 0;
        t.sub = 0;
        obj.flags &= ~ActorFlag.Reacting;
        break;
      }
      if (ClipFrame(obj) === 0x3c && (obj.flags & ActorFlag.Dead)) {
        if (Class14EnterDeathForPhase(t)) break;
        t.sub = 0;
      }
      break;
    default:
      break;
  }
  obj.pos.x += obj.vel.x;
  obj.pos.y += obj.vel.y;
  obj.pos.z += obj.vel.z;
  obj.vel.y += obj.accY;
}

function Class14KnockedDownSub2(obj: Actor, t: Boss2Tail): void {
  if (!AtClipEnd(obj, 1)) return;
  if (t.sub === 1) {
    obj.flags |= ActorFlag.PoseFrozen;
    return;
  }
  Class14KnockedDownToRoll(obj, t);
}

function Class14KnockedDownToRoll(obj: Actor, t: Boss2Tail): void {
  t.counter1 = 10;
  t.counter0 = 9;
  t.animSlot = ANIM_SLOT_LAND;
  ActorSetMotionBlended(obj, AnimMotion(ANIM_SLOT_LAND), 1, 10);
  obj.flags &= ~ActorFlag.PoseFrozen;
  t.sub = 3;
}

/**
 * `Class14StateDeathA` — `FUN_0047BAD0`. `g_class14_states[18]`, phase 2's.
 *
 * The three deaths are long scripted sinks with their own camera work, and
 * **the gate is already open before any of them runs**: the flag is raised by
 * the state that enters them. What the port keeps is the lifetime — the boss
 * stops being an enemy and leaves — so that the `wait_enemies_present 0` the
 * same step then reaches can come down. The choreography is `[open]`.
 */
export function Class14StateDeathA(obj: Actor, f: ClassFrame): void {
  Class14StateDeathCommon(obj, f);
}

/** `Class14StateDeathB` — `FUN_0047BFE0`. `g_class14_states[19]`, phase 7's. */
export function Class14StateDeathB(obj: Actor, f: ClassFrame): void {
  Class14StateDeathCommon(obj, f);
}

/** `Class14StateDeathC` — `FUN_0047C5F0`. `g_class14_states[20]`, phase 9's. */
export function Class14StateDeathC(obj: Actor, f: ClassFrame): void {
  Class14StateDeathCommon(obj, f);
}

/**
 * [port-only] The lifetime the three deaths share, without their choreography.
 *
 * All three are the same shape: swim to a scripted point, cue an effect at a
 * motion frame, sink, and then — `0x0047C92A` in `Class14StateDeathC`, and its
 * counterparts in the other two — **drop `g_enemies_present` and stop.** They
 * never despawn: the actor stays on the field until `Class14Update`'s camera
 * cue takes it, which is `tail+0x30`/`+0x32`.
 *
 * That last step is the one the script is waiting for. Stage 5's block 3 and
 * stage 2's blocks 35 and 37 all reach a `wait_enemies_present 0` after their
 * flag, and `Class14ApplyBoneDamage` has only taken the boss out of
 * `g_enemies_alive` — so a death that does not do this leaves the stage parked
 * on a count of one for ever, which is exactly what it did.
 *
 * `[diverges]` The **hold** is the port's, not the engine's: the engine's is
 * four sub-states long and measured in motion frames and route segments, and
 * two of the three end on effects the port does not have. One count is what is
 * transcribed; the time in front of it is named rather than derived.
 */
function Class14StateDeathCommon(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if (t.sub === 0) {
    obj.flags |= ActorFlag.NoHitReaction;
    t.flags |= Class14Flag.OffRoute;
    t.counter0 = CLASS14_DEATH_FRAMES;
    t.sub = 1;
  }
  if (t.sub !== 1) return;
  t.counter0 -= SecondsToTicks(f.dt);
  if (t.counter0 > 0) return;
  // `DEC word ptr [g_enemies_present]` at `0x0047C92A`, once.
  G.g_enemies_present -= 1;
  t.sub = 2;
}

/**
 * [port-only] How long the port holds the body before it leaves the present
 * count. `Class14StateDeathC`'s own two counts are 0x1E and 0x5A frames with a
 * swim and a motion cue between them; 180 is the same order and is a number
 * the port owns.
 */
export const CLASS14_DEATH_FRAMES = 180;

/**
 * [port-only] There is no `Init` split in the engine — `Class14Init` is both
 * the constructor and the first frame's setup. This is the half the port needs
 * before `Class14Init` runs: an actor the character layer has loaded.
 */
export function Class14Spawn(obj: Actor, rng?: Rng): void {
  Class14Init(obj, rng);
}

export const Boss2Handler: ClassHandler = {
  init: Class14Spawn,
  update: Class14Update,
  // The deaths are four states of the class's own, exactly like class 0x31's:
  // stopping on the frame the hit points run out would freeze the boss in the
  // reaction that is about to raise the flag.
  updatesWhenDead: true,
  // `Class14ResolveShotBone` reads `obj+0x34` bit 3 itself and runs its own
  // damage table; a shot must not go through `ResolveHit`.
  ownsShotResult: true,
  raisesScriptFlag: [
    CLASS14_FLAG_INTRO_DONE, CLASS14_FLAG_ROUND_B_OPEN,
    CLASS14_FLAG_ROUND_B_DONE, CLASS14_FLAG_BREAK_A_OPEN,
    CLASS14_FLAG_BREAK_A_DONE, CLASS14_FLAG_BREAK_B_OPEN,
    CLASS14_FLAG_BREAK_B_DONE, CLASS14_FLAG_DEAD, CLASS14_FLAG_DEAD_STAGE5,
  ],
  onDeadSweep: () => {
    // Nothing. `Class14ApplyBoneDamage` has already dropped the alive count
    // and the class's own death states drop the present count, so the generic
    // teardown would take both twice.
  },
  debug: (obj): ActorDebug => {
    const t = Tail(obj);
    if (!t) return { summary: "boss2 · no tail" };
    return {
      summary: `boss2 · ${Class14State[t.state]} sub ${t.sub}`
        + ` · ${Class14Phase[t.phase]}`,
      detail: [
        `hp ${obj.hp}/${obj.maxHp}, rank ${t.rank}`,
        `counters ${t.counter0}/${t.counter1}/${t.counter2}/${t.counter3}`,
      ],
      hot: t.state >= Class14State.CuedMotion,
    };
  },
};

registerClass(SpawnClass.Boss2, Boss2Handler);

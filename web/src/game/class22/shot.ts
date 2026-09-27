/**
 * Class 0x22's damage model: `Class22ChargeShots` (`FUN_0049D640`), the two
 * phases' gates on it, and `Class22StepAggression` (`FUN_0049D180`).
 *
 * The class owns its shot result (`ClassHandler.ownsShotResult`):
 * `MarkActorShot` (`FUN_00404DB0`) raises `obj+0x34` bit 3 and the shooter's
 * bit, and writes the part it hit into `obj+0x190 + player` — the port's
 * `obj.shotBones[player]` — and the phases decide what that costs.
 *
 * **The flier is one sphere.** `ShotTestSphere` (`FUN_00404630`) descends
 * into the bones only when `obj+0x34` has bit `0x80`, and nothing in either
 * class writes it (`Class22Init` touches `obj+0x34` not at all, the
 * descriptors' flag words are 0, and an exhaustive scan of `OR ..., 0x8..`
 * immediates finds none in these routines) `[proved]`. So in the engine the
 * part is always 1 — `MarkActorShot`'s "hit whole" — and a hit is worth 10.
 * The 120-point arm for part 2 is transcribed; the engine cannot reach it.
 */
import { ActorFlag, type Actor, type JudgmentActor } from "../actor";
import { PlayerTakeDamage } from "../combat/player";
import { ScoreAddForPlayer } from "../combat/score";
import { SpawnBoneHitSprite } from "../effects/blood";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import type { ClassFrame } from "../registry";
import { Class22DrawAndPoseSubActor } from "./draw";
import { Class22FaceCamera } from "./paths";
import { BossHpFractionOf } from "../boss_hp_bar";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { ActorAdvanceMotion } from "../motion";
import { CLASS22_FLINCH_MOTIONS } from "./records";
import {
  Class22Flag, Class22Relative, Class22Variant, type Class22Descriptor,
  type JudgmentTail,
} from "./state";

/** `PUSH 0x78` / `PUSH 0xA` — a part-2 hit, and any other. */
const SCORE_PART2 = 0x78;
const SCORE_HIT = 0x0a;
/** `PUSH 0x5DC` at `0x0049D523` — the kill. */
export const CLASS22_KILL_SCORE = 0x5dc;
/** `(-(g_active_player != 2) & 5) + 0x19`: 30 a hit, 25 when both players are attackable. */
const DAMAGE_ONE = 30;
const DAMAGE_BOTH = 25;
/**
 * `g_active_player` 2 — both players attackable. `SelectAttackablePlayer`
 * writes -1, 0, 1 or 2.
 */
const BOTH_PLAYERS = 2;

/**
 * The float at `0x009A224C + player * 0x14` — `g_original_item_slots + 0x0C`
 * — that Original Mode multiplies each hit by, `-1.0` meaning "double".
 *
 * **It is 1.0 in every state the game can reach**, and that is why it is a
 * constant here rather than a field. It has exactly three writers and all
 * three store `0x3F800000`: `ResetOriginalModeLoadout` (`FUN_0048A0F0`, the
 * `*(puVar1 + 5) = 0x3f800000` of its per-player loop), `PlayerEnterPlay`
 * (`0x00414917`, from the constant at `0x004EC92C`) and `FUN_00416240`'s
 * item cases 0..0xD (`0x0041627F`, `0x00416297`) `[proved]` by the
 * cross-references to `0x009A224C` and `0x009A2260`. So `f * 1.0` and the
 * `-1.0` test are both taken exactly as the engine takes them.
 */
export const ORIGINAL_WEAPON_SCALE: number = 1.0;

/** `PlaySoundId` — the class's sounds go out as the port's `sound.play`. `[port-only]` as a function. */
export function Class22PlaySound(f: ClassFrame, id: number): void {
  f.events?.emit("sound.play", { id });
}

/**
 * The two sounds `Class22Phase1TakeShots` and `Class22Phase2TakeShots` play,
 * by variant: `SMALL_BOSS_4` (`0x2A18A9` stage 1, `0x2F23A9` stage 5) for a
 * flinch and `SMALL_BOSS_13` (`0x2818A9`, `0x2D23A9`) for the kill. Variants
 * 0 and 3 never fight.
 */
const SND_FLINCH: Readonly<Record<number, number>> = {
  [Class22Variant.Stage1]: 0x2a18a9, [Class22Variant.Stage5]: 0x2f23a9,
};
const SND_KILLED: Readonly<Record<number, number>> = {
  [Class22Variant.Stage1]: 0x2818a9, [Class22Variant.Stage5]: 0x2d23a9,
};


/**
 * The call `RegisterEnemySlot` (`FUN_00408E80`) at one of the two classes'
 * call sites: the first free general slot of `g_enemy_slots`, held until the
 * next `UpdateCameraEnemySlots` (`FUN_00408DD0`) empties the table.
 * `[port-only]` as a function -- see `JudgmentTail.enemySlot`.
 */
export function JudgmentRegisterEnemySlot(t: { enemySlot: boolean }): void {
  t.enemySlot = true;
}

/**
 * `ReleaseCameraEnemySlot` (`FUN_004092B0`) at one of the two classes' call
 * sites: `g_enemy_slots[obj+0x120] = 0; obj+0x120 = 0xFF`.
 * `[port-only]` as a function.
 */
export function JudgmentReleaseEnemySlot(t: { enemySlot: boolean;
                                             cameraListed: boolean }): void {
  t.enemySlot = false;
  t.cameraListed = false;
}

/**
 * `Class22ChargeShots` — `FUN_0049D640`. Returns `last`: -1 nobody, 0 or 1
 * that player, 2 both.
 *
 * ```
 * last = -1
 * for p in 0, 1:
 *     bit = 1 << (p+1); part = 0
 *     if ((obj+0x34 & bit) && (part = (s8)obj+0x190[p]) != 0):
 *         last = last + 1 + p
 *         ScoreAddForPlayer(p, part == 2 ? 120 : 10)
 *         SpawnBoneHitSprite(obj, part)
 *         dmg = g_active_player != 2 ? 30 : 25
 *         if (g_GameMode == 1): dmg = ftol(*rec == -1.0 ? dmg+dmg : dmg * *rec)
 *         obj+0x11C -= dmg; obj+0x1358++; obj+0x1364++
 *     obj+0x190[p] = 0
 *     part_record(part).flags &= ~bit & ~8
 * ```
 *
 * The last line clears the hit bits on the part's draw record, which the
 * port does not keep: its per-bone records are the renderer's.
 */
export function Class22ChargeShots(obj: JudgmentActor, f: ClassFrame): number {
  const t = obj.judgment;
  let last = -1;
  for (let p = 0; p < 2; p++) {
    const bit = 1 << (p + 1);
    let part = 0;
    if ((obj.flags & bit) !== 0 && (part = (obj.shotBones[p] << 24) >> 24) !== 0) {
      last = last + 1 + p;
      ScoreAddForPlayer(p, part === 2 ? SCORE_PART2 : SCORE_HIT, f.events);
      SpawnBoneHitSprite(obj.at, part);
      let dmg = G.g_active_player !== BOTH_PLAYERS ? DAMAGE_ONE : DAMAGE_BOTH;
      if (G.g_GameMode === GameMode.Original) {
        // `FILD; FCOMP [rec] == -1.0 ? FADD ST0,ST0 : FMUL [rec]; __ftol`.
        const scale = ORIGINAL_WEAPON_SCALE;
        dmg = Math.trunc(scale === -1.0 ? dmg + dmg : dmg * scale);
      }
      obj.hp = ((obj.hp - dmg) << 16) >> 16;
      t.charged += 1;
      t.hitsTaken += 1;
    }
    obj.shotBones[p] = 0;
  }
  return last;
}

/**
 * `Class22StepAggression` — `FUN_0049D180`. `+0x1354` moves by what the last
 * frame did: -1 for a hit charged, +1 per eight companion hits, +3 (and the
 * taunt latch) for a companion strike; then clamped to 0..15.
 */
export function Class22StepAggression(t: JudgmentTail): void {
  if (t.charged !== 0) {
    t.charged = 0;
    t.aggression -= 1;
  }
  if (t.companionHits > 7) {
    t.aggression += 1;
    t.companionHits -= 8;
  }
  if (t.companionStruck !== 0) {
    t.aggression += 3;
    t.companionStruck = 0;
    t.strikesLanded += 1;
    t.taunt = 1;
  }
  if (t.aggression < 0) t.aggression = 0;
  if (t.aggression > 15) t.aggression = 15;
}

/** The flinch both phases play: `g_class22_flinch_motions[rand() & 1]`, fade 3. */
function Class22Flinch(obj: JudgmentActor, f: ClassFrame): void {
  ActorSetMotionBlended(obj, CLASS22_FLINCH_MOTIONS[f.rng.int(2)], 0, 3);
}

/**
 * The subs `Class22Phase1TakeShots` runs in: `(sub - 1)` through the byte
 * table at `0x0049D498` = `00 01 01 01 00 01 00 01 01 01 00`, 0 meaning run.
 */
const PHASE1_TAKES_SHOTS: readonly number[] = [1, 5, 7, 11];

/**
 * `Class22Phase1TakeShots` — `FUN_0049D220`.
 *
 * ```
 * if sub not in {1, 5, 7, 11}: return
 * obj+0x11C -= (s16)obj+0x132C                        ; the companion's hand-over
 * if (obj+0x34 & 8) && !(obj+0x34 & 0x40000000):
 *     Class22ChargeShots(obj)
 *     if hp > floor:
 *         if stage == 0 && hp <= tail[0xC]: stage = 1
 *         obj+0x34 |= 0x40000100; flinch; SMALL_BOSS_4; sub++; return
 * else if hp > floor: return
 * obj+0x34 |= 0x40000100; flinch; SMALL_BOSS_4
 * obj+0x1310++; sub = 0; FaceCamera; hp = floor; g_boss_hp_fraction = hp/max
 * Class22DrawAndPoseSubActor; obj+0x194++
 * ```
 *
 * So the companion's damage alone can carry the flier into phase 2, with no
 * shot at the flier at all -- and phase 1 can never overshoot the floor.
 */
export function Class22Phase1TakeShots(obj: JudgmentActor, f: ClassFrame,
                                       d: Class22Descriptor): void {
  const t = obj.judgment;
  if (!PHASE1_TAKES_SHOTS.includes(obj.sub)) return;
  obj.hp = ((obj.hp - ((t.transfer << 16) >> 16)) << 16) >> 16;
  if ((obj.flags & ActorFlag.Hit) !== 0
      && (obj.flags & Class22Flag.Reacting) === 0) {
    Class22ChargeShots(obj, f);
    if (d.phase1_floor < obj.hp) {
      if (t.hpStage === 0 && obj.hp <= d.hp_stage) t.hpStage = 1;
      obj.flags |= Class22Flag.Reacting | Class22Flag.Flinched;
      Class22Flinch(obj, f);
      const snd = SND_FLINCH[t.variant];
      if (snd !== undefined) Class22PlaySound(f, snd);
      obj.sub += 1;
      return;
    }
  } else if (d.phase1_floor < obj.hp) {
    return;
  }
  obj.flags |= Class22Flag.Reacting | Class22Flag.Flinched;
  Class22Flinch(obj, f);
  const snd = SND_FLINCH[t.variant];
  if (snd !== undefined) Class22PlaySound(f, snd);
  obj.state += 1;
  obj.sub = 0;
  obj.yaw = Class22FaceCamera(obj.pos.x, obj.pos.z, f.eye.x, f.eye.z);
  obj.hp = d.phase1_floor;
  // `FSTP [0x009C8E10]` at `0x0049D478`.
  G.g_boss_hp_fraction = BossHpFractionOf(obj.hp, obj.maxHp);
  Class22DrawAndPoseSubActor(obj, f);
  ActorAdvanceMotion(obj, f.dt);
}

/**
 * The subs `Class22Phase2TakeShots` runs in: jump table `0x0049D61C` on
 * `sub - 3` = `{run, ret, run, ret, run, ret, run, run}`.
 */
const PHASE2_TAKES_SHOTS: readonly number[] = [3, 5, 7, 9, 10];

/**
 * `Class22Phase2TakeShots` — `FUN_0049D4B0`.
 *
 * ```
 * if sub not in {3, 5, 7, 9, 10} or !(obj+0x34 & 8) or (obj+0x34 & 0x40000000): return
 * last = Class22ChargeShots(obj)
 * if hp <= 0:
 *     g_boss_engaged = 0
 *     ScoreAddForPlayer(last == 2 ? rand() & 1 : last, 1500)
 *     BossModeRecordGrade(); flinch; SMALL_BOSS_13
 *     obj+0x1310 = 3; obj+0x34 |= 0x40000100; sub = 0
 *     Class22DrawAndPoseSubActor; obj+0x194++; return
 * obj+0x34 |= 0x40000100; flinch; SMALL_BOSS_4; sub++; obj+0x1354 -= 2
 * ```
 *
 * `last` is -1 when bit 3 is up with no part byte, and the engine then pays
 * player -1, which `ScoreAddForPlayer` refuses. `MarkActorShot` always writes
 * a part with the bit, so that arm is not reached.
 */
export function Class22Phase2TakeShots(obj: JudgmentActor,
                                       f: ClassFrame): void {
  const t = obj.judgment;
  if (!PHASE2_TAKES_SHOTS.includes(obj.sub)) return;
  if ((obj.flags & ActorFlag.Hit) === 0) return;
  if ((obj.flags & Class22Flag.Reacting) !== 0) return;
  const last = Class22ChargeShots(obj, f);
  if (obj.hp < 1) {
    // `MOV byte ptr [0x009CA0EA], 0` at `0x0049D507`.
    G.g_boss_engaged = 0;
    // `CMP AX, 0x2; JNZ` -- a coin between the two players when both hit.
    const who = last === 2 ? f.rng.int(2) : last;
    ScoreAddForPlayer(who, CLASS22_KILL_SCORE, f.events);
    // `BossModeRecordGrade` (`FUN_00425F40`) returns at once unless
    // `g_GameMode == 3`. The port exports no Boss Mode bundle, so that arm --
    // the Boss Mode save's grade table -- is not reachable from a stage.
    Class22Flinch(obj, f);
    const snd = SND_KILLED[t.variant];
    if (snd !== undefined) Class22PlaySound(f, snd);
    obj.state = Class22Relative.Death;
    obj.flags |= Class22Flag.Reacting | Class22Flag.Flinched;
    obj.sub = 0;
    Class22DrawAndPoseSubActor(obj, f);
    ActorAdvanceMotion(obj, f.dt);
    return;
  }
  obj.flags |= Class22Flag.Reacting | Class22Flag.Flinched;
  Class22Flinch(obj, f);
  const snd = SND_FLINCH[t.variant];
  if (snd !== undefined) Class22PlaySound(f, snd);
  obj.sub += 1;
  t.aggression -= 2;
}

/** A player's damage from a strike: `PlayerTakeDamage(p, 1, kind)` by `g_active_player`. `[port-only]` as a function. */
export function Class22StrikePlayers(obj: Actor, f: ClassFrame,
                                     kind: number): void {
  if (G.g_active_player === 0) {
    PlayerTakeDamage(0, 1, kind, f.events, obj);
  } else if (G.g_active_player === 1) {
    PlayerTakeDamage(1, 1, kind, f.events, obj);
  } else if (G.g_active_player === BOTH_PLAYERS) {
    PlayerTakeDamage(0, 1, kind, f.events, obj);
    PlayerTakeDamage(1, 1, kind, f.events, obj);
  }
}

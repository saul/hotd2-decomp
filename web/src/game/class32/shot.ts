/**
 * Class 0x32 being shot: `Class32OnShot` (`FUN_0047CC20`) and its two halves,
 * `Class32ResolvePlayerShots` (`FUN_0047CD40`) and `Class32ChargeShotBone`
 * (`FUN_0047CE10`).
 *
 * The class sets `ClassHandler.ownsShotResult`: `MarkActorShot`
 * (`FUN_00404DB0`) raises `obj+0x34` bit 3 and the shooter's bit and writes
 * the bone into `obj+0x190 + player`, and these read it back.
 *
 * **Four bones take damage and nothing else does**: the byte map at
 * `0x0047D108` sends bones 4, 6, 11 and 13 to the charge and every other
 * bone (and anything past 13) to a spark. They are the four nodes whose
 * `Class32DrawBonePart` arm replaces the bone's own model with an animated
 * run (`bone_parts.ts`). The damage is the descriptor's `tail+0x04`, 10 in
 * the one shipped spawn: forty-five hits with one player, sixty-five with
 * two (each hit 7.0).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, type Boss5Actor } from "../actor";
import { ChooseHitPlayerOrder } from "../combat/hit_order";
import { ScoreAddForPlayer } from "../combat/score";
import { SpawnSpriteEffect } from "../effects/sprite";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import type { GameHost } from "../host";
import { vec3 } from "../vec";
import { Class32State } from "./state";
import { Class32Phase, Class32TailOf } from "./tables";

/** `CMP EAX, 0xD; JA` -- a bone past 13 is a spark. */
const DAMAGE_BONE_LAST = 0xd;
/**
 * The byte map at `0x0047D108`, bones 0..13, into the jump table at
 * `0x0047D0FC` -- 0 nothing (`0x0047D01D`), 1 the charge (`0x0047CE6C`),
 * 2 a spark (`0x0047CF85`). Read out of memory (L38).
 */
const BONE_ARM: readonly number[] = [0, 2, 2, 2, 1, 2, 1, 2, 2, 2, 2, 1, 2, 1];
const ARM_NONE = 0;
const ARM_CHARGE = 1;

/** `SpawnSpriteEffect(&point, 0x50, 2, p)` -- the damaging hit's spark, facing the eye flat. */
const HIT_SPRITE = 0x50;
const HIT_SPRITE_FACE = 2;
/** `SpawnSpriteEffect(&point, 0x35, 1, p)` -- every other hit's. */
const SPARK_SPRITE = 0x35;
const SPARK_SPRITE_FACE = 1;
/** `PlaySoundId(0x1E16A9)` -- the damaging hit. */
const SND_HIT = 0x1e16a9;
/** `PUSH 0xA` -- ten points a damaging hit; `PUSH 0x5DC`, 1500, for the kill. */
const HIT_SCORE = 10;
const KILL_SCORE = 0x5dc;
/** `FMUL float ptr [0x005644F4]` -- `0x3F333333`, 0.7, with two players in play. */
const TWO_PLAYER_DAMAGE = Math.fround(0.7);
/** `CMP ECX, 0xBF800000` -- the weapon scale that doubles instead. */
const DOUBLE_DAMAGE_SCALE = -1.0;

/** `MOV dword ptr [ESI + 0x1334], 0x8` -- the hit flash. */
export const CLASS32_HIT_FLASH = 8;
/** `IMUL 0x66666667; SAR EDX, 2` -- the phase floor is `(maxHp / 10) * floor`. */
const PHASE_DIVISOR = 10;

/**
 * `Class32OnShot` — `FUN_0047CC20`.
 *
 * ```
 * hp0 = obj+0x11C
 * if (!(obj+0x34 & 8)) return
 * Class32ResolvePlayerShots()
 * if (obj+0x34 & 0x100) return
 * if (obj+0x34 & 0x4000000) {
 *     obj+0x1334 = 8; obj+0x136C |= 2; state 2, sub 0; return
 * }
 * if (obj+0x11C >= hp0) return
 * obj+0x1334 = 8
 * if ((s8)obj+0x131A == 1) { if (--obj+0x1368 > 0) return }
 * else if (hp >= (maxHp / 10) * g_class32_phases[obj+0x1364].floor) return
 * obj+0x34 |= 0x100; obj+0x131B = (u8)state; state 5, sub 0
 * ```
 *
 * `0x0047CC61` is the only write of state 2 in the image: the whole death
 * chain starts on the frame the hit points run out.
 */
export function Class32OnShot(obj: Boss5Actor, rng: Rng, host: GameHost,
                              events?: Events): void {
  const t = obj.boss5;
  const hp0 = obj.hp;
  if ((obj.flags & ActorFlag.Hit) === 0) return;
  Class32ResolvePlayerShots(obj, rng, host, events);
  const f = obj.flags;
  if ((f & ActorFlag.ShotImmune) !== 0) return;
  if ((f & ActorFlag.Dead) !== 0) {
    t.flash = CLASS32_HIT_FLASH;
    obj.flags2 |= 2;
    obj.state = Class32State.DeathSequence;
    obj.sub = 0;
    return;
  }
  if (obj.hp >= hp0) return;
  t.flash = CLASS32_HIT_FLASH;
  if (t.attack === 1) {
    t.hitsToReact -= 1;
    if (t.hitsToReact > 0) return;
  } else {
    const floor = Math.fround(Math.trunc(obj.maxHp / PHASE_DIVISOR)
      * Class32Phase(t.phase)[1]);
    if (floor <= obj.hp) return;
  }
  obj.flags = f | ActorFlag.ShotImmune;
  t.interrupted = obj.state & 0xff;
  obj.state = Class32State.HitReaction;
  obj.sub = 0;
}

/**
 * `Class32ResolvePlayerShots` — `FUN_0047CD40`. Takes no argument: the
 * object is `g_cur_actor`.
 *
 * ```
 * ChooseHitPlayerOrder()
 * for (p in g_hit_player_order) {                 ; two entries, to 0x009C8910
 *     if (p == -1) continue
 *     g_shot_bone[p] = 0; bit = 1 << (p + 1)
 *     if (obj+0x34 & bit) {
 *         g_shot_bone[p] = (s8)obj+0x190[p]
 *         Class32ChargeShotBone(p)
 *         rec(g_shot_bone[p])+0x74 &= ~8; &= ~bit
 *     }
 *     obj+0x34 &= ~8; obj+0x34 &= ~bit
 * }
 * ```
 *
 * The bone record's `+0x74` hit bits have no reader in the port (the shot
 * test reads that word's mesh bit, which nothing here touches), so the two
 * clears there are not carried.
 */
export function Class32ResolvePlayerShots(obj: Boss5Actor, rng: Rng,
                                          host: GameHost,
                                          events?: Events): void {
  ChooseHitPlayerOrder(rng);
  // [port-only] The port's merged record of the same shot, consumed with the
  // bits; nothing in this class reads it.
  obj.pendingHit = null;
  for (const p of G.g_hit_player_order) {
    if (p === -1) continue;
    G.g_shot_bone[p] = 0;
    const bit = 1 << (p + 1);
    if ((obj.flags & bit) !== 0) {
      G.g_shot_bone[p] = ((obj.shotBones[p] ?? 0) << 24) >> 24;
      Class32ChargeShotBone(obj, p, host, events);
    }
    obj.flags &= ~ActorFlag.Hit;
    obj.flags &= ~bit;
  }
}

const _pt = vec3();

/**
 * `Class32ChargeShotBone` — `FUN_0047CE10`. One shooter's hit, `p`.
 *
 * ```
 * if (obj+0x34 & 0x100) { SpawnSpriteEffect(point, 0x35, 1, p); return }
 * if (obj+0x34 & 0x4000000) return
 * switch (bone = g_shot_bone[p]) {               ; > 13: the spark arm
 *   case 4, 6, 11, 13:
 *     SpawnSpriteEffect(point, 0x50, 2, p); PlaySoundId(0x1E16A9)
 *     ScoreAddForPlayer(p, 10)
 *     d = g_players_in_play == 2 ? (s8)tail[4] * 0.7f : (float)(s8)tail[4]
 *     if (g_GameMode == 1) d = scale[p] == -1.0 ? d + d : d * scale[p]
 *     obj+0x11C = ftol(obj+0x11C - d)
 *   case 0: break
 *   default: SpawnSpriteEffect(point, 0x35, 1, p)
 * }
 * if (obj+0x11C < 1) {
 *     obj+0x34 |= 0x4000000; ScoreAddForPlayer(p, 0x5DC)
 *     obj+0x131C = p; g_boss_engaged = 0
 * }
 * ```
 *
 * `point` is the bone's hit centre (node record `+0x68`) through
 * `g_camera_blocks[g_camera_index]`: the model block's record holds it in
 * the world. The subtraction runs on the FPU and truncates once.
 */
export function Class32ChargeShotBone(obj: Boss5Actor, p: number,
                                      host: GameHost, events?: Events): void {
  const bone = G.g_shot_bone[p] ?? 0;
  const h = obj.skel?.bones[bone]?.hit ?? [0, 0, 0];
  _pt.x = h[0]; _pt.y = h[1]; _pt.z = h[2];
  if ((obj.flags & ActorFlag.ShotImmune) !== 0) {
    SpawnSpriteEffect(vec3(_pt.x, _pt.y, _pt.z), 0, 0, SPARK_SPRITE,
                      SPARK_SPRITE_FACE, p, host, events);
    return;
  }
  if ((obj.flags & ActorFlag.Dead) !== 0) return;
  const arm = bone >>> 0 > DAMAGE_BONE_LAST ? 2 : BONE_ARM[bone];
  if (arm === ARM_CHARGE) {
    SpawnSpriteEffect(vec3(_pt.x, _pt.y, _pt.z), 0, 0, HIT_SPRITE,
                      HIT_SPRITE_FACE, p, host, events);
    events?.emit("sound.play", { id: SND_HIT });
    ScoreAddForPlayer(p, HIT_SCORE, events);
    const base = Class32TailOf(obj)?.damage ?? 0;
    let d = G.g_players_in_play === 2 ? base * TWO_PLAYER_DAMAGE : base;
    if (G.g_GameMode === GameMode.Original) {
      const scale = G.g_original_weapon_damage_scale[p] ?? 1;
      d = scale === DOUBLE_DAMAGE_SCALE ? d + d : d * scale;
    }
    obj.hp = (Math.trunc(obj.hp - d) << 16) >> 16;
  } else if (arm !== ARM_NONE) {
    SpawnSpriteEffect(vec3(_pt.x, _pt.y, _pt.z), 0, 0, SPARK_SPRITE,
                      SPARK_SPRITE_FACE, p, host, events);
  }
  if (obj.hp < 1) {
    obj.flags |= ActorFlag.Dead;
    ScoreAddForPlayer(p, KILL_SCORE, events);
    obj.killedBy = p;
    G.g_boss_engaged = 0;
  }
}

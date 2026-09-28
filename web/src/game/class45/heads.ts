/**
 * Class 0x45 sub-type 2: the five fighting heads.
 *
 * Head index 2 is the big `boss3l.bin` head and the fight's director: it
 * schedules the other heads' bites, counts for the enemy gate, and in stage 3
 * ends the fight by dying when the other four are down, because stage 3's
 * big head cannot be hurt. See `docs/re/boss-tower.md`.
 */
import type { Boss3Actor } from "../actor";
import { ActorFlag, type Actor } from "../actor";
import { ActorByAt, G } from "../globals";
import type { ClassFrame } from "../registry";
import { BossHpBarSpawn } from "../boss_hp_bar";
import { ScoreAddForPlayer } from "../combat/score";
import { RegisterForShotTest } from "../combat/shot_test";
import { PlayerTakeDamage } from "../combat/player";
import { SpawnBoneHitSprite } from "../effects/blood";
import { ActorBuildSkinnedModel } from "../spawn";
import { ActorDespawn } from "../despawn";
import { GameMode } from "../game_mode";
import { PlayerState } from "../player_state";
import { CharacterTypeOf } from "../tables";
import { CameraSlotVacate, RegisterEnemySlot, RegisterForCameraTracking }
  from "../camera/slots";
import {
  Boss3BlockNew, Boss3HeadState, Boss3IdleTable, Boss3AttackTable,
  Boss3BystanderState, Boss3Phase, Boss3PoseHook, Boss3Routine, Boss3Variant,
  type Boss3Block,
} from "./state";
import {
  BOSS3_ATTACKS_A, BOSS3_ATTACKS_B, BOSS3_ATTACK_DELAY_BY_RANK,
  BOSS3_HURT_MOTIONS, BOSS3_IDLE_MOTIONS_A, BOSS3_IDLE_MOTIONS_B,
  BOSS3L_ATTACKS, BOSS3L_IDLE_MOTIONS, BOSS3_SWAP_MOTIONS,
  type Boss3Attack,
} from "./tables";
import {
  Boss3DrawModel, Boss3ModelStep, Boss3SetMotion, Boss3SetMotionBlended,
  TRACK_FADING,
} from "./model";
import { Boss3ComposeBonePose, Boss3DrawBoneParts, PoseHookNone } from "./pose";
import {
  Boss3NextRand, Boss3PlayStageSound, CrtRand, PlaySoundId,
} from "./rand";
import { Boss3SpawnBoneSpark, Boss3SpawnIntroCard } from "./tasks";

/** `g_scene_state_major_entered == 2` -- the path camera, where bites land. */
const SCENE_MAJOR_PATH = 2;
/** `BossHpBarSpawn(320.0, 35.0)` -- `PUSH 0x420C0000; PUSH 0x43A00000`. */
export const BOSS3_BAR_X = 320;
export const BOSS3_BAR_Y = 35;
/** The heads' hit points: 45, or 30 on stage 6 (`AND 0xF; ADD 0x1E`). */
const HEAD_HP = 0x2d;
const HEAD_HP_STAGE6 = 0x1e;
/** The shared bar: 180, or 150 on stage 6. `[0x0055CB14]` and `[0x0055CB18]`. */
const POOL_SCALE = Math.fround(1 / 180);
const POOL_SCALE_STAGE6 = Math.fround(1 / 150);
/** A damaging hit's points, and the last head's. */
const HIT_POINTS = 10;
const KILL_POINTS = 0x5dc;
/** `MOV EAX, 0x2D; IDIV EDI` -- the damage before the weapon, over 5 or 3. */
const DAMAGE_BASE = 0x2d;
/** The mouth must be open by more than this: `CMP EAX, 0x1700`. */
const JAW_OPEN = 0x1700;
/** The neck's sum refuses between `0x1700` and `0xC000`. */
const NECK_LOW = 0x1700;
const NECK_HIGH = 0xc000;
/** `g_boss3_rank` tops out at 15 and a bite takes 3 off it. */
const RANK_MAX = 15;
const RANK_BITE = 3;
/** The death clip's cue frames: `0x4B` for a small head, `0x70` for the big one. */
const DEATH_CUE = 0x4b;
const DEATH_CUE_BIG = 0x70;
/** Phase 2's cue for the small heads, `0x38`. */
const DOWN_CUE = 0x38;
/** `PlaySoundId(0xB16A9)` -- `COMMON\BOMB1_11`. */
const SOUND_BOMB1 = 0xb16a9;
/** `COMMON2\ZOMBIE_046_16`, `COMMON\BULLET_OTH1_16`, `COMMON\SWORD11_22_1`. */
const SOUND_HEAD_DIE = 0x1c17a9;
const SOUND_MISS = 0x1216a9;
const SOUND_GRAB = 0x3d16a9;
/** The two civilians' cries as they are let go: `COM\209_M`, `DAMEGE_GA\188_2_GA`. */
const SOUND_LET_GO_0 = 0x20000012;
const SOUND_LET_GO_1 = 0x1da9;
/** `g_screen_shake_frames = 0x18`. */
const SHAKE_FRAMES = 0x18;
/** Phase 2: head 2 counts 180 frames to the gate; phase 3 on stage 6, 240 to go. */
const GATE_FRAMES = 0xb4;
const DESPAWN_FRAMES = 0xf0;
/** The big head's intro cues: `0x4B` on stage 6, `0x3C`/`0x226` and `0x122`. */
const INTRO_CUE_STAGE6 = 0x4b;
const INTRO_CUE_A = 0x3c;
const INTRO_CUE_B = 0x226;
const INTRO_CUE_C = 0x122;
/** The track point sits 22 above the big head at first (`[0x0055CAD8]`). */
const TRACK_RISE = 22;
/** The camera eases onto the weak bone by `[0x004C4D08]`, 0.15. */
const TRACK_EASE = Math.fround(0.15);
/** The flash clock's two cues in state 5, `3` and `0xF`. */
const BITE_CUE_A = 3;
const BITE_CUE_B = 0xf;
/** `0x58` -- heads 0 and 4 outside Boss Mode open on it, 4 at frame `0x1E`. */
const CLIP_HELD = 0x58;
const HELD_START_4 = 0x1e;
/** The grab clips: `0x57` and `0x59`, the civilians' `0x21D` and `0x21F`. */
const CLIP_GRAB_0 = 0x57;
const CLIP_GRAB_4 = 0x59;
const CLIP_TAKEN_0 = 0x21d;
const CLIP_TAKEN_1 = 0x21f;
/** Where each grab lets go: cues `0x17`/`0x3F` for the sound, `0x21`/`0x49` to release. */
const GRAB_SOUND_0 = 0x17;
const GRAB_SOUND_1 = 0x3f;
const GRAB_RELEASE_0 = 0x21;
const GRAB_RELEASE_1 = 0x49;
/** The released civilians' velocities. */
const LET_GO_VEL_0 = [Math.fround(-2.4), Math.fround(1.4), Math.fround(-0.2)];
const LET_GO_VEL_1 = [Math.fround(-1.4), Math.fround(1.8), Math.fround(-0.2)];

/** The idle table `+0x7634` points at. */
function IdleTableOf(blk: Boss3Block): readonly number[] {
  if (blk.idleTable === Boss3IdleTable.B) return BOSS3_IDLE_MOTIONS_B;
  if (blk.idleTable === Boss3IdleTable.Large) return BOSS3L_IDLE_MOTIONS;
  return BOSS3_IDLE_MOTIONS_A;
}

/** The attack table `+0x7628` points at. */
function AttackTableOf(blk: Boss3Block): readonly Boss3Attack[] {
  if (blk.attackTable === Boss3AttackTable.B) return BOSS3_ATTACKS_B;
  if (blk.attackTable === Boss3AttackTable.Large) return BOSS3L_ATTACKS;
  return BOSS3_ATTACKS_A;
}

/** The actor in `g_boss3_heads[i]`, if it is one of this class's. */
function HeadAt(i: number): Boss3Actor | null {
  const a = ActorByAt(G.g_boss3_heads[i] ?? -1);
  return a && a.cls === 0x45 ? a as Boss3Actor : null;
}

/** ...and in `g_boss3_bystanders[i]`. */
function BystanderAt(i: number): Boss3Actor | null {
  const a = ActorByAt(G.g_boss3_bystanders[i] ?? -1);
  return a && a.cls === 0x45 ? a as Boss3Actor : null;
}

/**
 * `rand() % (spread + 1) + base` of `g_boss3_attack_delay_by_rank[rank]`
 * (`0x005890E0`), as the handler, the bite and the scheduler each draw it.
 * `[port-only]` as a function: three sites write this arithmetic inline.
 */
export function Boss3DrawAttackDelay(f: { rng: ClassFrame["rng"] },
                                     rank: number): number {
  const row = BOSS3_ATTACK_DELAY_BY_RANK[rank]
    ?? BOSS3_ATTACK_DELAY_BY_RANK[0];
  return ((CrtRand(f.rng) % (row.spread + 1) + row.base) << 16) >> 16;
}

/** Either player in play: `g_player_state[0] == 5 || g_player_state[1] == 5`. */
function AnyPlayerInPlay(): boolean {
  return G.g_player_state[0] === PlayerState.InPlay
    || G.g_player_state[1] === PlayerState.InPlay;
}

/** Zero every bone's extra rotation, as three states do on their way to 4. */
function ClearExtras(blk: Boss3Block): void {
  for (let i = 0; i < blk.boneCount; i++) {
    blk.extraX[i] = 0; blk.extraY[i] = 0; blk.extraZ[i] = 0;
  }
}

/**
 * Enter state 7. `[port-only]` in one respect: `obj.dead`, the port's own
 * mark of a dead actor, which its inspectors read. What keeps a shot off the
 * head is its tail's `RegisterForShotTest` gate, `state != 7`.
 */
function EnterDead(obj: Boss3Actor): void {
  obj.state = Boss3HeadState.Dead;
  obj.dead = true;
}

/**
 * `Boss3FightHeadInit` — `FUN_0041FE30`. `desc+0x22` (`obj+0x11C`) is the
 * head's **index**, 0..4, and is overwritten with its hit points; the
 * `0x77C4` block is allocated zeroed and filled by index -- the big head
 * (2) or a small one with an idle set by the index's parity. Head 2 counts
 * in both enemy counters. Outside Boss Mode heads 0 and 4 open on the grab
 * clip. `obj+0x34 |= 0x8000` keeps every head out of the shot test until the
 * fight.
 */
export function Boss3FightHeadInit(obj: Boss3Actor): void {
  const t = obj.boss3;
  const idx = (obj.hp << 16) >> 16;
  if (idx >= 0 && idx < G.g_boss3_heads.length) G.g_boss3_heads[idx] = obj.at;
  t.index = (idx << 24) >> 24;
  obj.hp = G.g_boss3_variant !== Boss3Variant.Stage6 ? HEAD_HP : HEAD_HP_STAGE6;
  const blk = Boss3BlockNew();
  t.block = blk;
  let clip: number;
  if (t.index === 2) {
    // `MOV word ptr [EBP + 0x60], 0x48` -- `boss3l.bin`; the placement's own
    // character type is the same, by the exporter's rule for this class.
    clip = BOSS3L_IDLE_MOTIONS[0];
    blk.jawSway = -300;
    G.g_boss3_track_point.x = obj.pos.x;
    G.g_boss3_track_point.y = Math.fround(obj.pos.y + TRACK_RISE);
    G.g_boss3_track_point.z = obj.pos.z;
  } else {
    blk.idleSet = t.index & 1;
    if (blk.idleSet === 0) {
      clip = BOSS3_IDLE_MOTIONS_A[t.index];
      blk.idleTable = Boss3IdleTable.A;
      blk.attackTable = Boss3AttackTable.A;
    } else {
      clip = BOSS3_IDLE_MOTIONS_B[t.index];
      blk.idleTable = Boss3IdleTable.B;
      blk.attackTable = Boss3AttackTable.B;
    }
  }
  // `ActorBuildSkinnedModel` (`FUN_00410440`) -- the model block fresh on the
  // clip, and the hit-slot claim the port makes where that routine does.
  Boss3SetMotion(obj, clip);
  ActorBuildSkinnedModel(obj);
  obj.flags |= ActorFlag.NoShotTest;
  t.modelFrame = 0;
  const radius = CharacterTypeOf(obj)?.actor_radius ?? 0;
  obj.hitRadius = radius;
  obj.radius = radius;
  t.poseHook = Boss3PoseHook.None;
  if (t.index === 2) {
    blk.boneCount = 0x1b; blk.weakBone = 0x18; blk.jawA = 0x19; blk.jawB = 0x1a;
    blk.idleCount = 6; blk.attackCount = 3;
    blk.idleTable = Boss3IdleTable.Large;
    blk.attackTable = Boss3AttackTable.Large;
    blk.hurtClip = 0x49;
    blk.deathClip = 0x41;
  } else {
    blk.boneCount = 0x14; blk.weakBone = 0x11; blk.jawA = 0x12; blk.jawB = 0x13;
    blk.idleCount = 0xb; blk.attackCount = 4;
    // `MOV CX, word ptr [EAX*0x4 + 0x588F48]` -- a dword stride, so set A is
    // entry 0 (99) and set B entry 2 (85).
    blk.hurtClip = BOSS3_HURT_MOTIONS[blk.idleSet * 2];
    blk.deathClip = 0x4c;
  }
  ClearExtras(blk);
  blk.flashClock = 0;
  blk.introClock = 0;
  blk.armed = -1;
  if (t.index === 2) {
    // `INC word ptr [0x009c7006]` / `[0x009c904a]` at `0x00420082`.
    G.g_enemies_present += 1;
    G.g_enemies_alive += 1;
  }
  if (G.g_GameMode !== GameMode.Boss) {
    if (t.index === 0) {
      obj.motion = CLIP_HELD;
      t.modelFrame = 0;
    } else if (t.index === 4) {
      obj.motion = CLIP_HELD;
      t.modelFrame = HELD_START_4;
    }
  }
  RegisterEnemySlot(obj);                         // `0x004200AE` / `0x004200D4`
  t.routine = Boss3Routine.FightHeadUpdate;
}

/**
 * `Boss3FightHeadSwapIdleSet` — `FUN_00421930`. The swap clip for the set it
 * is leaving, the other set's tables, and a hurt clip drawn from the new
 * set's window -- `{99, 100}` for A and `{100, 85}` for B, the latter
 * `0x00588F4A` and not the hit path's `{85, 86}`.
 */
export function Boss3FightHeadSwapIdleSet(obj: Boss3Actor): void {
  const blk = obj.boss3.block;
  if (!blk) return;
  Boss3SetMotion(obj, BOSS3_SWAP_MOTIONS[blk.idleSet]);
  blk.idleSet = (1 - blk.idleSet) & 0xff;
  if (blk.idleSet === 0) {
    blk.idleTable = Boss3IdleTable.A;
    blk.attackTable = Boss3AttackTable.A;
    blk.hurtClip = BOSS3_HURT_MOTIONS[Boss3NextRand(1)];
  } else {
    blk.idleTable = Boss3IdleTable.B;
    blk.attackTable = Boss3AttackTable.B;
    blk.hurtClip = BOSS3_HURT_MOTIONS[Boss3NextRand(1) + 1];
  }
  obj.boss3.modelFrame = 0;
}

/**
 * `Boss3FightHeadIntroGrab` — `FUN_00422D30`. Heads 0 and 4 in the intro,
 * outside Boss Mode, and the civilian each holds (`c = idx != 0`):
 *
 * * **0** wait on `g_script_flags[0]` and the held clip's end, then play
 *   the grab on both; once the grab passes its cue (`0x17`/`0x3F`) play the
 *   blade, and past `0x21`/`0x49` let the civilian go -- a velocity and a
 *   cry -- and move to 2;
 * * **2** at the grab's end blend into the head's idle set, and move to 3;
 * * **3** idle; on `g_script_flags[1]` head 0 raises the intro card, and on
 *   `g_script_flags[2]` both enter the fight (the bar from head 0), the
 *   phase turning when the second of the two reaches state 4.
 */
export function Boss3FightHeadIntroGrab(obj: Boss3Actor,
                                        f: ClassFrame): void {
  const t = obj.boss3;
  const blk = t.block;
  if (!blk) return;
  const c = t.index !== 0 ? 1 : 0;
  switch (obj.state) {
    case Boss3HeadState.Waiting: {
      const bys = BystanderAt(c);
      if (!bys) return;
      if (bys.state === Boss3BystanderState.Standing) {
        Boss3ModelStep(obj);
        if (G.g_script_flags[0] === 1 && t.clipEnded) {
          if (c === 0) {
            Boss3SetMotion(obj, CLIP_GRAB_0);
            Boss3SetMotion(bys, CLIP_TAKEN_0);
          } else {
            Boss3SetMotion(obj, CLIP_GRAB_4);
            Boss3SetMotion(bys, CLIP_TAKEN_1);
          }
          bys.state = Boss3BystanderState.Moving;
        }
        return;
      }
      if (bys.state !== Boss3BystanderState.Moving) return;
      if (c === 0) {
        if (t.cursor === GRAB_SOUND_0) PlaySoundId(SOUND_GRAB, f.events);
        if (t.cursor < GRAB_RELEASE_0) { Boss3ModelStep(obj); return; }
      } else {
        if (t.cursor === GRAB_SOUND_1) PlaySoundId(SOUND_GRAB, f.events);
        if (t.cursor < GRAB_RELEASE_1) { Boss3ModelStep(obj); return; }
      }
      bys.state = Boss3BystanderState.Released;
      obj.state = Boss3HeadState.Released;
      t.counter = 0;
      const v = c === 0 ? LET_GO_VEL_0 : LET_GO_VEL_1;
      bys.vel.x = v[0]; bys.vel.y = v[1]; bys.vel.z = v[2];
      PlaySoundId(c === 0 ? SOUND_LET_GO_0 : SOUND_LET_GO_1, f.events);
      return;
    }
    case Boss3HeadState.Released: {
      const ended = t.clipEnded;
      Boss3ModelStep(obj);
      if (!ended) return;
      blk.idleSet = t.index & 1;
      if (blk.idleSet === 0) {
        Boss3SetMotionBlended(obj, BOSS3_IDLE_MOTIONS_A[t.index], 0, 4);
        blk.idleTable = Boss3IdleTable.A;
        blk.attackTable = Boss3AttackTable.A;
      } else {
        Boss3SetMotionBlended(obj, BOSS3_IDLE_MOTIONS_B[t.index], 0, 4);
        blk.idleTable = Boss3IdleTable.B;
        blk.attackTable = Boss3AttackTable.B;
      }
      t.counter = 0;
      obj.state = Boss3HeadState.Settled;
      return;
    }
    case Boss3HeadState.Settled: {
      Boss3ModelStep(obj);
      if (G.g_script_flags[1] !== 0 && t.index === 0 && t.counter === 0) {
        Boss3SpawnIntroCard();
        t.counter = 1;
      }
      if (G.g_script_flags[2] !== 1) return;
      obj.flags &= ~ActorFlag.NoShotTest;
      t.counter = 0;
      obj.state = Boss3HeadState.Idle;
      if (t.index === 0) {
        BossHpBarSpawn(BOSS3_BAR_X, BOSS3_BAR_Y);
        G.g_boss_hp_fraction = 1;             // `0x00422E02`
      }
      const h0 = HeadAt(0), h4 = HeadAt(4);
      if (h0 && h0.state === Boss3HeadState.Idle
          && h4 && h4.state === Boss3HeadState.Idle) {
        G.g_boss3_phase = Boss3Phase.Fight;   // `0x00422E34`
      }
      return;
    }
    default:
      return;
  }
}

/** The shooter, as every shot routine of the class picks it. */
function Shooter(obj: Actor, f: ClassFrame): number {
  const p0 = (obj.flags & ActorFlag.HitByPlayer0) !== 0;
  const p1 = (obj.flags & ActorFlag.HitByPlayer1) !== 0;
  if (p0 && p1) return CrtRand(f.rng) & 1;
  return p0 ? 0 : 1;
}

/**
 * The Original Mode weapon's damage scale, `[0x009A224C + q*0x14]` with
 * -1.0 standing for 2.0 (`FCOM [0x004C4C64]`; `FLD [0x004E30F0]`), and 1.0
 * in any other mode. `q` is a second draw when both players fired.
 * `[port-only]` as a function: the two hit routines inline it.
 */
export function Boss3WeaponScale(obj: Actor, f: ClassFrame): number {
  if (G.g_GameMode !== GameMode.Original) return 1;
  const q = Shooter(obj, f);
  const m = G.g_original_weapon_damage_scale[q] ?? 1;
  return m === -1 ? 2 : m;
}

/**
 * `Boss3FightHeadUpdate` — `FUN_004209B0`. One head, one frame: the shot,
 * the draw and pose, the phase, and the tail -- the shot test, the camera's
 * weak-bone point, and stage 3's big head dying once the fourth small one
 * has. Every step is `docs/re/boss-tower.md`'s, which quotes the addresses.
 */
export function Boss3FightHeadUpdate(obj: Boss3Actor, f: ClassFrame): void {
  const t = obj.boss3;
  const blk = t.block;
  if (!blk) return;
  const idx = t.index;
  if (idx >= 0 && idx < G.g_boss3_heads.length) G.g_boss3_heads[idx] = obj.at;

  // -- 1. the shot, only in the fight and outside the flinch and death;
  //       outside that window the hit bits are left latched.
  if (G.g_boss3_phase === Boss3Phase.Fight
      && obj.state !== Boss3HeadState.Dead
      && obj.state !== Boss3HeadState.Flinch
      && (obj.flags & ActorFlag.Hit)) {
    obj.flags &= ~ActorFlag.Hit;
    const p = Shooter(obj, f);
    const weak = blk.weakBone;
    let ok = ((obj.flags & ActorFlag.HitByPlayer0) !== 0
              && obj.shotBones[0] === weak)
          || ((obj.flags & ActorFlag.HitByPlayer1) !== 0
              && obj.shotBones[1] === weak);
    if (ok) {
      const a = t.boneRot[blk.jawA * 3 + 2] + blk.extraZ[blk.jawA];
      const b = t.boneRot[blk.jawB * 3 + 2] + blk.extraZ[blk.jawB];
      if (Math.abs((a - b) | 0) <= JAW_OPEN) ok = false;
    }
    if (ok && G.g_boss3_variant !== Boss3Variant.Stage6 && idx === 2) {
      ok = false;
    }
    const neck = blk.neckSum & 0xffff;
    if (ok && neck > NECK_LOW && neck < NECK_HIGH) ok = false;
    if (ok) {
      ScoreAddForPlayer(p, HIT_POINTS, f.events);
      SpawnBoneHitSprite(obj.at, obj.shotBones[p] ?? 0);
      const div = G.g_players_in_play === 2 ? 5 : 3;
      const m = Boss3WeaponScale(obj, f);
      const d = Math.trunc(Math.trunc(DAMAGE_BASE / div) * m);
      obj.hp = ((obj.hp - d) << 16) >> 16;
      G.g_boss3_head_hp_pool = ((G.g_boss3_head_hp_pool - d) << 16) >> 16;
      if (obj.hp < 0) {
        G.g_boss3_head_hp_pool =
          ((G.g_boss3_head_hp_pool - obj.hp) << 16) >> 16;
      }
      G.g_boss_hp_fraction = Math.fround(G.g_boss3_head_hp_pool
        * (G.g_boss3_variant === Boss3Variant.Stage6
          ? POOL_SCALE_STAGE6 : POOL_SCALE));          // `0x00420C22`
      if (G.g_boss_hp_fraction < 0) G.g_boss_hp_fraction = 0; // `0x00420C3B`
      if (G.g_boss3_rank < RANK_MAX) G.g_boss3_rank += 1;
      if (obj.hp <= 0) {
        PlaySoundId(SOUND_HEAD_DIE, f.events);
        EnterDead(obj);
        G.g_boss3_heads_left = ((G.g_boss3_heads_left - 1) << 24) >> 24;
        t.counter = 0;
        CameraSlotVacate(obj);                          // `0x00420CA8`
        Boss3SetMotionBlended(obj, blk.deathClip, 8, 8);
        if (G.g_boss3_heads_left === 0) {
          t.counter = 0;
          G.g_boss3_phase = Boss3Phase.AllDown;
          G.g_boss_hp_fraction = 0;                         // `0x00420CE3`
          ScoreAddForPlayer(Shooter(obj, f), KILL_POINTS, f.events);
        }
      } else {
        Boss3PlayStageSound(1, f.events);
        obj.state = Boss3HeadState.Flinch;
        if (idx !== 2) {
          blk.hurtClip = BOSS3_HURT_MOTIONS[Boss3NextRand(1)
                                            + blk.idleSet * 2];
        }
        Boss3SetMotionBlended(obj, blk.hurtClip, 8, 8);
        t.blend = 0;
        G.g_boss3_last_head = idx;
      }
      if (blk.armed > -1) {
        if (G.g_boss3_heads_attacking > 0) G.g_boss3_heads_attacking -= 1;
        blk.armed = -1;
      }
    } else {
      PlaySoundId(SOUND_MISS, f.events);
      Boss3SpawnBoneSpark(obj.at, obj.shotBones[p] ?? 0);
    }
    G.g_boss3_rand_counter = (G.g_boss3_rand_counter + t.modelFrame % 10) >>> 0;
    obj.flags &= ~(ActorFlag.HitByPlayer0 | ActorFlag.HitByPlayer1);
  }

  // -- 2. the draw and the pose.
  Boss3DrawModel(obj);
  if (obj.state === Boss3HeadState.Idle || obj.state === Boss3HeadState.Attack
      || obj.state === Boss3HeadState.Flinch) {
    Boss3ComposeBonePose(obj);
  }
  Boss3DrawBoneParts(obj, f.events);
  if (G.g_boss3_phase === Boss3Phase.Fight
      && obj.state === Boss3HeadState.Waiting) {
    obj.state = Boss3HeadState.Idle;
    obj.flags &= ~ActorFlag.NoShotTest;
  }

  // -- 3. the phase.
  switch (G.g_boss3_phase) {
    case Boss3Phase.Intro:
      Boss3FightHeadIntro(obj, f);
      break;
    case Boss3Phase.Fight:
      Boss3FightHeadFight(obj, f);
      break;
    case Boss3Phase.AllDown:
      if (!Boss3FightHeadAllDown(obj, f)) return;
      break;
    case Boss3Phase.Despawn:
      if (G.g_boss3_variant === Boss3Variant.Stage6) {
        t.counter += 1;
        if (t.counter < DESPAWN_FRAMES) break;
      }
      Boss3FightHeadLeave(obj);
      return;
    default:
      break;
  }

  // -- 4. the tail (`0x00421542`).
  obj.lookAt.x = obj.pos.x;
  obj.lookAt.y = obj.pos.y;
  obj.lookAt.z = obj.pos.z;
  obj.shotCentre.x = obj.pos.x;
  obj.shotCentre.y = obj.pos.y;
  obj.shotCentre.z = obj.pos.z;
  // `if (state != 7) RegisterForShotTest(obj)` at `0x004215AF`, with
  // `obj+0x70` the position just written.
  if (obj.state !== Boss3HeadState.Dead) RegisterForShotTest(obj, f.host);
  let track = false;
  if (G.g_boss3_phase === Boss3Phase.Intro) {
    track = idx === 2;
  } else if (G.g_boss3_phase === Boss3Phase.Fight && blk.armed > -1) {
    track = true;
  }
  if (!track && G.g_boss3_heads_attacking === 0 && idx === G.g_boss3_last_head
      && obj.state !== Boss3HeadState.Dead) {
    track = true;
  }
  if (track) {
    const o = blk.weakBone * 3;
    const tp = G.g_boss3_track_point;
    tp.x = Math.fround((t.bonePoint[o] - tp.x) * TRACK_EASE + tp.x);
    tp.y = Math.fround((t.bonePoint[o + 1] - tp.y) * TRACK_EASE + tp.y);
    tp.z = Math.fround((t.bonePoint[o + 2] - tp.z) * TRACK_EASE + tp.z);
    obj.lookAt.x = tp.x;
    obj.lookAt.y = tp.y;
    obj.lookAt.z = tp.z;
    // `RegisterForCameraTracking` (`FUN_00408EC0`) at `0x00421871`, unless
    // the head is dead -- the class's only call of it.
    if (obj.state !== Boss3HeadState.Dead) RegisterForCameraTracking(obj);
  }
  if (G.g_boss3_variant !== Boss3Variant.Stage6 && G.g_boss3_heads_left === 1
      && idx === 2) {
    // `0x00421879`: stage 3's big head goes down with the last small one.
    EnterDead(obj);
    G.g_boss3_heads_left = ((G.g_boss3_heads_left - 1) << 24) >> 24;
    t.counter = 0;
    CameraSlotVacate(obj);                            // `0x004218C0`
    Boss3SetMotionBlended(obj, blk.deathClip, 8, 8);
    G.g_boss3_phase = Boss3Phase.AllDown;
  }
}

/** Phase 0, `0x00420EA2`. */
function Boss3FightHeadIntro(obj: Boss3Actor, f: ClassFrame): void {
  const t = obj.boss3;
  const blk = t.block!;
  if (G.g_boss3_variant === Boss3Variant.Stage6) {
    if (G.g_script_flags[0] === 1) {
      BossHpBarSpawn(BOSS3_BAR_X, BOSS3_BAR_Y);   // `0x00420EBE`
      G.g_boss_hp_fraction = 1;                   // `0x00420EC6`
      G.g_boss3_phase = Boss3Phase.Fight;
    }
    const v = blk.introClock;
    blk.introClock = ((v + 1) << 16) >> 16;
    if (v === INTRO_CUE_STAGE6) Boss3PlayStageSound(3, f.events);
    Boss3ModelStep(obj);
    return;
  }
  if (G.g_GameMode !== GameMode.Boss) {
    if (t.index === 0 || t.index === 4) Boss3FightHeadIntroGrab(obj, f);
    else Boss3ModelStep(obj);
  } else {
    Boss3ModelStep(obj);
    if (G.g_script_flags[1] === 1 && t.index === 0 && t.counter === 0) {
      Boss3SpawnIntroCard();
      t.counter = 1;
    }
    if (G.g_script_flags[2] === 1) {
      G.g_boss3_phase = Boss3Phase.Fight;
      obj.flags &= ~ActorFlag.NoShotTest;
      t.counter = 0;
      obj.state = Boss3HeadState.Idle;
      if (G.g_GameMode === GameMode.Boss) G.g_boss_engaged = 1;
      if (t.index === 0) {
        BossHpBarSpawn(BOSS3_BAR_X, BOSS3_BAR_Y); // `0x00420FD2`
        G.g_boss_hp_fraction = 1;                 // `0x00420FDA`
      }
    }
  }
  if (t.index === 2) {
    blk.introClock = ((blk.introClock + 1) << 16) >> 16;
    const v = blk.introClock;
    if (v === INTRO_CUE_A || v === INTRO_CUE_B) {
      Boss3PlayStageSound(3, f.events);
    }
    if (v === INTRO_CUE_C) Boss3PlayStageSound(5, f.events);
  }
}

/** Phase 1, `0x00421033`: the four states, then head 2's scheduler. */
function Boss3FightHeadFight(obj: Boss3Actor, f: ClassFrame): void {
  const t = obj.boss3;
  const blk = t.block!;
  const idx = t.index;
  let schedule = true;
  switch (obj.state) {
    case Boss3HeadState.Idle: {
      Boss3ModelStep(obj);
      if (blk.armed > 0) blk.armed -= 1;
      let started = false;
      if (t.clipEnded) {
        if (Boss3NextRand(1) !== 0 && idx !== 2 && blk.armed === -1) {
          Boss3FightHeadSwapIdleSet(obj);
        } else {
          const tbl = IdleTableOf(blk);
          Boss3SetMotion(obj, tbl[Boss3NextRand(blk.idleCount - 1)] ?? 0);
          t.modelFrame = 0;
          started = true;
        }
      }
      if (G.g_boss3_variant !== Boss3Variant.Stage6 && idx === 2) break;
      if (blk.armed === 0 && started
          && G.g_scene_state_major_entered === SCENE_MAJOR_PATH
          && AnyPlayerInPlay()) {
        const r = Boss3NextRand(blk.attackCount - 1);
        obj.state = Boss3HeadState.Attack;
        const atk = AttackTableOf(blk)[r];
        Boss3SetMotion(obj, atk?.motion ?? 0);
        t.modelFrame = 0;
        blk.flashClock = 0;
        blk.hitFrame = atk?.hitFrame ?? 0;
        if (G.g_players_in_play === 2) {
          t.bitePlayer = Boss3NextRand(1);
        } else {
          if (G.g_active_player === 0) t.bitePlayer = 0;
          if (G.g_active_player === 1) t.bitePlayer = 1;
        }
      }
      break;
    }
    case Boss3HeadState.Attack: {
      if (blk.flashClock === BITE_CUE_A) Boss3PlayStageSound(4, f.events);
      if (blk.flashClock === BITE_CUE_B) Boss3PlayStageSound(2, f.events);
      const c = t.modelFrame;
      Boss3ModelStep(obj);
      if (c === blk.hitFrame) {
        if (G.g_scene_state_major_entered === SCENE_MAJOR_PATH
            && G.g_players_in_play > 0
            && G.g_player_state[t.bitePlayer] === PlayerState.InPlay) {
          PlayerTakeDamage(t.bitePlayer, 1, 9, f.events, obj);
          // `ADD AL, 0xFD` -- the `CMP` before it is dead: the rank always
          // drops by three here.
          G.g_boss3_rank = ((G.g_boss3_rank - RANK_BITE) << 24) >> 24;
        }
        if (G.g_boss3_heads_attacking > 0) G.g_boss3_heads_attacking -= 1;
        blk.armed = -1;
        if (G.g_boss3_rank < 0) G.g_boss3_rank = 0;
        G.g_boss3_attack_delay = Boss3DrawAttackDelay(f, G.g_boss3_rank);
        G.g_boss3_last_head = idx;
      }
      if (t.clipEnded) {
        if (Boss3NextRand(1) !== 0 && idx !== 2) {
          Boss3FightHeadSwapIdleSet(obj);
        } else {
          const tbl = IdleTableOf(blk);
          Boss3SetMotion(obj, tbl[Boss3NextRand(blk.idleCount - 1)] ?? 0);
          t.modelFrame = 0;
        }
        obj.state = Boss3HeadState.Idle;
        ClearExtras(blk);
      }
      break;
    }
    case Boss3HeadState.Flinch: {
      if (t.trackBits & TRACK_FADING) {
        Boss3ModelStep(obj);
        t.blend = Math.fround(t.blend + 1);
        break;
      }
      const ended = t.clipEnded;
      Boss3ModelStep(obj);
      if (ended) {
        const tbl = IdleTableOf(blk);
        Boss3SetMotion(obj, tbl[Boss3NextRand(blk.idleCount - 1)] ?? 0);
        t.modelFrame = 0;
      }
      obj.state = Boss3HeadState.Idle;
      ClearExtras(blk);
      break;
    }
    case Boss3HeadState.Dead: {
      if (!t.clipEnded) Boss3ModelStep(obj);
      const cue = idx === 2 ? DEATH_CUE_BIG : DEATH_CUE;
      if (t.cursor === cue && !(t.trackBits & TRACK_FADING)) {
        PlaySoundId(SOUND_BOMB1, f.events);
        PoseHookNone(4, 0x14);
        G.g_screen_shake_frames = SHAKE_FRAMES;
      }
      break;
    }
    default:
      break;
  }
  if (schedule && idx === 2) Boss3FightHeadSchedule(f);
}

/**
 * Head 2's scheduler, `0x0042141B`: while a player is in play on the path
 * camera, count the delay down, and at zero -- if fewer than two heads are
 * armed -- arm a random live head that is not itself armed, unless another
 * armed head is more than two places away from it.
 */
function Boss3FightHeadSchedule(f: ClassFrame): void {
  if (G.g_scene_state_major_entered !== SCENE_MAJOR_PATH) return;
  if (!AnyPlayerInPlay()) return;
  G.g_boss3_attack_delay = ((G.g_boss3_attack_delay - 1) << 16) >> 16;
  if (G.g_boss3_attack_delay > 0) return;
  if (G.g_boss3_heads_attacking >= 2) return;
  const k = Boss3NextRand(4);
  const h = HeadAt(k);
  const hb = h?.boss3.block;
  if (!h || !hb) return;
  if (G.g_boss3_variant !== Boss3Variant.Stage6 && k === 2) return;
  if (h.state === Boss3HeadState.Dead) return;
  if (hb.armed === 0) return;
  let blocked = false;
  for (let i = 0; i < 5; i++) {
    if (i === k) continue;
    const other = HeadAt(i)?.boss3.block;
    if (other && other.armed === 0 && Math.abs(i - k) > 2) blocked = true;
  }
  if (blocked) return;
  hb.armed = 0;
  G.g_boss3_attack_delay = Boss3DrawAttackDelay(f, G.g_boss3_rank);
  G.g_boss3_heads_attacking += 1;
}

/**
 * Phase 2, `0x004215D6`. Returns false when the head has despawned: head 2,
 * 180 frames after the fight ended, drops both enemy counters -- **the
 * gate** -- moves the class to phase 3, and in stage 3 leaves.
 */
function Boss3FightHeadAllDown(obj: Boss3Actor, f: ClassFrame): boolean {
  const t = obj.boss3;
  const blk = t.block!;
  if (t.index === 2) {
    if (t.cursor === DEATH_CUE_BIG) {
      PlaySoundId(SOUND_BOMB1, f.events);
      G.g_screen_shake_frames = SHAKE_FRAMES;
      PoseHookNone(6, 0x1e);
    }
    t.counter += 1;
    if (t.counter === GATE_FRAMES) {
      G.g_enemies_present -= 1;                   // `0x00421623`
      G.g_enemies_alive -= 1;                     // `0x0042162A`
      G.g_boss3_phase = Boss3Phase.Despawn;
      CameraSlotVacate(obj);                      // `0x00421645`
      t.counter = 0;
      if (G.g_boss3_variant !== Boss3Variant.Stage6) {
        Boss3FightHeadLeave(obj);
        return false;
      }
    }
  } else if (obj.state === Boss3HeadState.Dead && t.cursor === DOWN_CUE
             && !(t.trackBits & TRACK_FADING)) {
    PlaySoundId(SOUND_BOMB1, f.events);
    PoseHookNone(4, 0x14);
    G.g_screen_shake_frames = SHAKE_FRAMES;
  }
  if (obj.state !== Boss3HeadState.Dead) {
    EnterDead(obj);
    t.counter = 0;
    Boss3SetMotionBlended(obj, blk.deathClip, 8, 8);
  }
  if (!t.clipEnded) Boss3ModelStep(obj);
  return true;
}

/** `ActorFreeHitSlot` (`FUN_004092D0`) when `obj+0x3C` holds one, then `ActorDespawn`. */
function Boss3FightHeadLeave(obj: Boss3Actor): void {
  ActorDespawn(obj);
}

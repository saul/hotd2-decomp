/**
 * `Boss4ResolveShot` — `FUN_00491B40`. Class 0x19's whole damage model.
 *
 * This class sets {@link ClassHandler.ownsShotResult}, so a shot at the boss
 * never goes through `combat/`'s `ResolveHit`: `MarkActorShot`
 * (`FUN_00404DB0`) raises `obj+0x34` bit 3 and the bone byte at
 * `obj+0x190 + shooter`, and this is what reads them back — the same shape
 * class 0x10's civilians are under, and for the same reason. The zombie damage
 * table would charge this actor hit points off a row it does not have.
 *
 * ## One weak point, and a floor under it
 *
 * Only **bone 2** does damage, or any bone whose surface code came back
 * `0x3D`; everything else is a spark. That is `CMP EBX, 0x2` at `0x00491DCE`,
 * and bone 2 is the top node of `boss4.bin`'s fifteen.
 *
 * And the hit points do not run out on their own. `state+0x24` is this phase's
 * share of the bar, and the frame the hit points reach it `obj+0x34` bit
 * `0x100` goes up and **every later shot is refused** —
 * `TEST AH, 0x1; JNZ` at `0x00491DC5`, before any of the arithmetic. Only
 * `Boss4AdvancePhaseWhenWalkDone` (`FUN_00492350`) clears it, and only when
 * the arena progression has moved the boss to its next phase. So the fight is
 * paced by the arena and not by the player's aim, and **a port that does not
 * run the phases cannot take the boss below `8/9` of its bar.** See
 * `index.ts`'s note on what is and is not ported.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import { ActorFlag } from "../actor";
import { ScoreAddForPlayer } from "../combat/score";
import {
  BOSS4_BODY_DAMAGE, BOSS4_HEAD_DAMAGE, BOSS4_SHOT_DAMAGE_CAP,
  BOSS4_SOFT_SURFACE, BOSS4_WEAK_BONE, Boss4State,
} from "./state";
import type { Boss4Block as Blk } from "./state";

/** Points for one head hit — `PUSH 0xA` at `0x00491DF3`. */
const BOSS4_HEAD_SCORE = 10;

/** Points for the kill — `PUSH 0x5DC` at `0x00491EA4`. */
export const BOSS4_KILL_SCORE = 0x5dc;

/**
 * `Boss4ResolveShot` — `FUN_00491B40`.
 *
 * The engine walks `g_shot_shooters` (`0x009C8908`), a two-entry list it fills
 * from `obj+0x34` bits 1 and 2 — one player, the other, or both in a random
 * order when neither bit is set. The port has one shot record per frame on
 * `obj.pendingHit`, so it resolves the one shooter the port has and the loop
 * is a single pass. `[diverges]`, and it is the port's one-player
 * configuration rather than anything about this class.
 */
export function Boss4ResolveShot(obj: Actor, b: Blk): void {
  const hit = obj.pendingHit;
  if (!hit) return;
  // `AND AL, 0xF1` at `0x00491BA6` — the shot bit and the two shooter bits are
  // consumed here, whatever the outcome.
  obj.pendingHit = null;

  // `MOVSX EBX, byte ptr [ESI + EBP*0x1 + 0x190]; TEST EBX, EBX; JLE` — bone 0
  // and a negative bone are both "nothing was hit".
  const bone = hit.bone;
  if (bone <= 0) return;
  const surface = hit.result;

  // The three effect arms at `0x00491D5E`: code 0x3D spawns gore and a wet
  // sound, code 0x35 is silence, a head hit on a boss that is still
  // damageable is a heavier sound, and everything else is a spark.
  // `[port-only]` none of the four is ported; the effects layer has no entry
  // for this class. The *branch* is kept because the damage test below reads
  // the same two facts.

  // `TEST AH, 0x1; JNZ` at `0x00491DC5` — obj+0x34 bit 0x100, the phase floor.
  if (obj.flags & ActorFlag.ShotImmune) return;
  // `CMP EBX, 0x2; JZ; CMP [ESP+0x10], 0x3D; JNZ` — one of the two, or nothing
  // happens at all.
  if (bone !== BOSS4_WEAK_BONE && surface !== BOSS4_SOFT_SURFACE) return;
  // `TEST EAX, 0x4000000; JNZ` — already dead, so the transition below is all
  // that is left to run.
  if (!(obj.flags & ActorFlag.Dead)) {
    Boss4ApplyDamage(obj, b, bone);
  }

  // `TEST EAX, 0x4000000` again at `0x00491F6E`, on the flags as they now are.
  if (obj.flags & ActorFlag.Dead) {
    b.state = Boss4State.Death;
    b.sub = 0;
    return;
  }
  // `TEST EAX, 0x40002000; JNZ` — a reaction already running, or a strike
  // armed, and neither is interrupted.
  if (obj.flags & (ActorFlag.Reacting | ActorFlag.NoHitReaction)) return;
  if (bone !== BOSS4_WEAK_BONE) return;

  // `AND EAX, 0xEFFFBFFF; OR EAX, 0x40000000` at `0x00491FA1`.
  obj.flags = (obj.flags & ~(0x10000000 | ActorFlag.PoseFrozen))
             | ActorFlag.Reacting;
  b.savedState = b.state;
  b.savedSub = b.sub;
  // `[diverges]` The engine now takes the world Y of the bones at `char+0x910`
  // and `char+0x760` and picks the knock-down only when **both** are above
  // `g_camera_fixed_eye_y + 10.0`. The port would have to ask `GameHost` for
  // two bone positions from inside the shot path, which is a seam this class
  // does not have yet; it takes the flinch, which is the arm the engine takes
  // whenever either bone is low. Named rather than guessed: the knock-down is
  // reachable in the engine and is not reachable here.
  b.state = Boss4State.Flinch;
}

/**
 * The arithmetic at `0x00491DEE`..`0x00491F2F`, which the decompiler drops
 * because it is all FPU (L1). Read from the instruction stream.
 *
 * ```
 * head:  MOVSX ECX, byte [g_boss4_head_damage + players + rank*2]; FILD
 * body:  FLD [0x004C4380]                     ; 1.0
 * if (g_ca08c == 1)                           ; Original Mode
 *     if ([0x009A224C + p*0x14] == -1.0) FADD ST0,ST0     ; doubled
 *     else                               FMUL [0x009A2240 + p*0x14 + 0xC]
 * FCOM g_boss4_shot_damage_cap; if (!(d <= 33.0)) d = 33.0
 * hp = ftol((float)hp - d)
 * ```
 */
function Boss4ApplyDamage(obj: Actor, b: Blk, bone: number): void {
  let damage: number;
  if (bone === BOSS4_WEAK_BONE) {
    // `MOVSX EDX, word ptr [0x009c8e80]` is `g_players_in_play`, and `ECX` is
    // the rank byte at `state+0x0B`. Two players do less damage each.
    damage = BOSS4_HEAD_DAMAGE[G.g_players_in_play + b.rank * 2] ?? 0;
    // `MOV CL, byte ptr [EAX + 0xC]; INC CL` — the head-hit tally, and ten
    // points for it. The engine's `ScoreAddForPlayer` is `FUN_004156C0`.
    b.headHits = (b.headHits + 1) & 0xff;
    ScoreAddForPlayer(0, BOSS4_HEAD_SCORE);
  } else {
    damage = BOSS4_BODY_DAMAGE;
  }
  // `[diverges]` The Original-Mode weapon multiplier at `0x00491E31` is not
  // modelled: `g_ca08c` (`0x009CA08C`) and the per-player weapon record at
  // `0x009A2240` are both `[open]`, and the arcade configuration this port
  // runs takes neither arm.
  if (damage > BOSS4_SHOT_DAMAGE_CAP) damage = BOSS4_SHOT_DAMAGE_CAP;

  // `FILD hp; FSUB ST0,ST1; CALL __ftol; MOV word ptr [ESI+0x11C], AX` — the
  // truncation is towards zero and the store is a **signed 16-bit** one.
  obj.hp = ((obj.hp - damage) | 0) << 16 >> 16;

  if (obj.hp <= 0) {
    // `AND CH, 0xDF; OR ECX, 0x4000100` at `0x00491EA1` — the death latch, the
    // no-more-damage bit, and the strike bit dropped.
    obj.flags = (obj.flags & ~ActorFlag.NoHitReaction)
              | ActorFlag.Dead | ActorFlag.ShotImmune;
    G.g_enemies_alive -= 1;
    ScoreAddForPlayer(0, BOSS4_KILL_SCORE);
    // `CALL 0x00425F40` — `[open]`, and not ported.
    return;
  }
  // `FILD hp; FIDIV obj+0x11E; FSTP [0x009C8E10]` — the boss's health bar.
  // `[port-only]` the port has no boss bar to feed and the global is not in
  // `G`; the fraction is `obj.hp / obj.maxHp` wherever one is wanted.

  // `FILD hp; FCOMP [EDX + 0x24]; TEST AH, 0x41; JZ` — at or below the phase
  // floor, and the boss stops taking damage until the phase advances.
  if (obj.hp <= b.phaseHpFloor) {
    obj.flags |= ActorFlag.ShotImmune;
    // `CMP CL, 0x12; JZ; CMP CL, 0x13; JZ; AND AH, 0xDF` — the strike bit is
    // left alone while the boss is pinning a player or charging.
    if (b.state !== Boss4State.PinPlayer
        && b.state !== Boss4State.ChargePastCamera) {
      obj.flags &= ~ActorFlag.NoHitReaction;
    }
  }
}

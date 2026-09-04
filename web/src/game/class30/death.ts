/**
 * Dying, and being a corpse.
 *
 * Class 0x30's death is **four states, not a clip**, and the port used to have
 * none of them: `ResolveHit` set `dead`, handed the actor a directional death
 * clip and the director stopped updating it. So a killed zombie stayed in the
 * pool for ever, still counted in `g_enemies_present`, still drawn standing
 * where it fell.
 *
 * The engine's chain is
 *
 * ```
 * ZombieOnShot -> Death(6) -> [DeathFallAndBounce(12)] -> ZombieEnterCorpseState
 *                                                          |
 *                                          CorpseSink(7) --+-- CorpseBlink(8)
 *                                                 |               |
 *                                                 +-- ActorDespawn +
 * ```
 *
 * and the two enemy counters fall at **different points along it**:
 * `ZombieReleasePermitAndUntrack` drops `g_enemies_alive` as the death state
 * opens, `ZombieEnterCorpseState` drops `g_enemies_present` when the death clip
 * has finished. That window — present but not alive — is the entire reason the
 * script has both `wait_enemies_present` (0x43) and `wait_enemies_alive`
 * (0x44), and class 0x31 was the only class in the port that had it.
 *
 * The corpse **does** leave: `ZombieStateCorpseSink` counts 0x78 frames down
 * and calls `ActorDespawn` itself. Nothing here needs a timer the exe does not
 * have.
 */
import type { Rng } from "../../core/rng";
import { ActorFlag, CountFlag, ZombieFlag2, type ZombieActor } from "../actor";
import {
  ReleaseEnemyAliveCount, ReleaseEnemyPresentCount,
} from "../combat/counts";
import { ChooseDeathMotionDirectional } from "../combat/resolve_hit";
import { ReleaseAttackSlot } from "../combat/permits";
import { QueryGroundHeightAt } from "../coli";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import { MotionOf, MotionPlayFrame, MotionPlayLength } from "../tables";
import { ActorSetMotionBlended } from "./motion_cue";
import { GAME_HZ, MotionFade, ZombieState } from "./states";

/** `obj+0x1330 = 0x78` — the corpse lies there for two seconds. */
const CORPSE_FRAMES = 0x78;
/** `obj+0x44 -= 0.04` a frame while it does, which is what sinks it. */
const CORPSE_SINK = 0.04;
/** The two character types that flicker out instead of sinking. */
const CORPSE_BLINK_TYPES: readonly number[] = [0x12, 3];

/**
 * `obj+0x34 |= 0x8000` — raised with {@link ActorFlag.PoseFrozen} by
 * `ZombieEnterCorpseState` (`OR AH, 0xc0` — `80cc c0`... in fact
 * `AND EAX, 0xfffdfffe` / `OR AH, 0xc0` at 0x00456759/0x0045675E).
 *
 * `[open]` — nothing in the ported call graph reads bit 0x8000 of `obj+0x34`.
 * Written rather than dropped, because the engine writes it and the next
 * reader should see that it was seen.
 */
const CORPSE_UNREAD_BIT = 0x8000;

/**
 * `obj+0x34 |= 0x80000` — raised with {@link ActorFlag.Airborne} by both
 * corpse states (`OR EAX, 0xa0000`).
 *
 * `[likely]` it suppresses the ground decal: `FUN_0040A590` is
 * `if (!(obj+0x34 & 0x80000) && (obj+0x1F8 & 1)) FUN_0040A620(obj, w, h)` with
 * two sizes per character type, and it is the only reader found. The port does
 * not draw one, so this write has no consequence here.
 */
const CORPSE_NO_DECAL_BIT = 0x80000;

/** `ZombieStateDeathFallAndBounce`'s `obj+0x5C` — `0xbd16872b` = -0.03675f. */
const BOUNCE_GRAVITY = -0.03675;
/** ...and the bounce: `obj+0x50 *= -0.25`. */
const BOUNCE_NORMAL = -0.25;
/** Below this vertical speed the body has settled. */
const SETTLE_SPEED = 0.15;
/** `obj+0x19C < 0x3C` — sixty ticks of the death clip before the fall opens. */
const BOUNCE_HOLD_TICKS = 0x3c;
/** The clip that plays when the thrown body lands, at a random start frame. */
const BOUNCE_LANDING_CLIP = 0x3f8;
const BOUNCE_LANDING_SPREAD = 10;
/** The death clip `ChooseDeathMotion` gives an actor still holding a weapon. */
export const DEATH_CLIP_HOLDING_WEAPON = 0x3f9;

/**
 * `obj+0x136C` bit 0x8000000, the second half of body condition 4's special
 * arm (`TEST EAX, 0x2000000` at 0x004561B9 then `TEST EAX, 0x8000000` at
 * 0x004561C0; the first is {@link ZombieFlag2.LowSphere}).
 *
 * `[open]` — class 0x31 calls the same bit `ThrowerFlag.Regrowing`, on the
 * strength of a class-0x31 reader. Nothing found writes it on a class-0x30
 * actor, and naming a bit after the other class's use of the offset is exactly
 * the guess this project bans. A literal until someone reads its writer.
 */
const COND4_SPECIAL_BIT = 0x8000000;

/** Body condition 4 with both `obj+0x136C` bits 0x2000000 and 0x8000000. */
const DEATH_CLIP_COND4_SPECIAL = 0x3da;
const DEATH_CLIP_COND4_SPECIAL_START = 0x19;
/** ...otherwise condition 4 tosses a coin between these two. */
const DEATH_CLIP_COND4 = 0x404;
const DEATH_CLIP_COND4_ALT = 0x404 + 0x16;
/** Body conditions 5 and 6, and character types 0xF..0x11 while carried. */
const DEATH_CLIP_COND56 = 0x3db;

/** `obj+0x130C` — the body conditions `ChooseDeathMotion` branches on. */
const COND_FOUR = 4;
const COND_FIVE = 5;
const COND_SIX = 6;
/** The character type whose `obj+0x136C` bit 0x8000 keeps whatever it plays. */
const CHAR_KEEPS_CLIP = 10;
/** ...and the range that takes {@link DEATH_CLIP_COND56} while carried. */
const CHAR_CARRIED_DEATH_LO = 0xf;
const CHAR_CARRIED_DEATH_HI = 0x11;

/**
 * `ChooseDeathMotion` — `FUN_004560B0`. Which clip this death plays.
 *
 * Read from the disassembly rather than the decompilation, because two of its
 * arms are easy to get backwards and one of them is recorded wrongly in
 * `functions.tsv`:
 *
 * ```
 * 0045615e  83f80a       CMP  EAX, 0xa           ; EAX = charType, obj+0x1F4
 * 00456161  7428         JZ   0045618b
 * ...
 * 0045618b  8b866c130000 MOV  EAX, [ESI+0x136c]
 * 00456191  f6c480       TEST AH, 0x80           ; bit 0x8000
 * 00456194  7574         JNZ  0045620a           ; -> the *tail*, no clip at all
 * ```
 *
 * `0045620a` is the shared tail — install the effect cues, clear
 * {@link ActorFlag.PoseFrozen} — and it is reached **past** the
 * `ActorSetMotionBlended` at `00456202`. So character type 10 with
 * `obj+0x136C` bit 0x8000 ({@link ZombieFlag2.DeathMotionVariant}) keeps
 * whatever it was already playing; it does not take clip 0x3DB, which is what
 * the annotation says. `[proved]`
 *
 * The coin toss for body condition 4 is the `NEG`/`SBB` idiom at
 * 0x004561EA — `rand() & 0x80000001`, normalised, negated, `SBB EAX, EAX`,
 * `AND EAX, 0x16`, `ADD EAX, 0x404` — so it is 0x404 on an even draw and
 * 0x41A on an odd one, not a range.
 *
 * [diverges] Three things the engine does here have no port. The four
 * destroyed-part arms read `obj+0x1368` bits 0x8/0x10/0x40/0x80, which
 * `ZombieStateTargetMotionScript` and `ZombieStateDragTarget` set from a
 * kill-move clip id the port does not model — so those bits are never up and
 * the arms are unreachable rather than omitted. `ZombieInstallDeathEffectCues`
 * (`FUN_004563F0`) points `obj+0x13A0` at a dust/splash cue list, which is an
 * effect. And the exe's directional pick sets the base motion itself and then
 * remaps it through `obj+0x136C` bits 1, 2 and 4; the port's
 * `ChooseDeathMotionDirectional` returns the id and has never had the remap.
 */
export function ChooseDeathMotion(obj: ZombieActor, rng: Rng): void {
  const play = (motion: number, frame = 0): void => {
    ActorSetMotionBlended(obj, motion, frame, MotionFade.Quick);
  };
  const directional = (): void => {
    const m = ChooseDeathMotionDirectional(obj, G.g_camera_yaw_bams, rng);
    if (m !== undefined && MotionOf(obj, m)) play(m);
  };
  // The shared tail: `FUN_004563F0` then `AND AH, 0xbf` on `obj+0x34`.
  const done = (): void => { obj.flags &= ~ActorFlag.PoseFrozen; };

  if (obj.condition === COND_FOUR) {
    if ((obj.flags2 & ZombieFlag2.LowSphere)
        && (obj.flags2 & COND4_SPECIAL_BIT)) {
      play(DEATH_CLIP_COND4_SPECIAL, DEATH_CLIP_COND4_SPECIAL_START);
    } else {
      play(rng.int(2) === 0 ? DEATH_CLIP_COND4 : DEATH_CLIP_COND4_ALT);
    }
    return done();
  }

  if (obj.condition === COND_FIVE || obj.condition === COND_SIX) {
    // `if ((obj+0x136C & 7) != 0) goto directional` — the three low bits of
    // the second word, which for class 0x30 are the scene-lit bit and the two
    // `ChooseDeathMotionDirectional` remaps.
    if (obj.flags2 & 7) directional();
    else play(DEATH_CLIP_COND56);
    return done();
  }

  // An actor that still has hold of something dies its own way, and state 6
  // reads the same bit to send it to `ZombieStateDeathFallAndBounce`.
  if (obj.flags & ActorFlag.HoldingWeapon) {
    play(DEATH_CLIP_HOLDING_WEAPON);
    return done();
  }
  // The four destroyed-part arms would go here -- `obj+0x1368` bits 0x8,
  // 0x10, 0x40 and 0x80 giving clips 0x1AC, 0x1A5, 0x279 and 0x229. See the
  // `[diverges]` above: no ported routine raises any of them.

  if (obj.charType === CHAR_KEEPS_CLIP) {
    if (obj.flags2 & ZombieFlag2.DeathMotionVariant) return done();
    directional();
    return done();
  }
  if (obj.charType >= CHAR_CARRIED_DEATH_LO
      && obj.charType <= CHAR_CARRIED_DEATH_HI
      && (obj.flags2 & ZombieFlag2.Carried)) {
    play(DEATH_CLIP_COND56);
    return done();
  }
  directional();
  return done();
}

/**
 * `ZombieReleasePermitAndUntrack` — `FUN_004565A0`. The teardown that takes a
 * dead class-0x30 actor out of the attack system, and **the only thing that
 * does**.
 *
 * ```
 * 004565a6  CALL 00456520            ; ReleaseAttackSlot
 * 004565b6  TEST CL, AL              ; AL = obj+0x38, CL = 1
 * 004565b8  JNZ  004565f3            ; CountFlag.KeepCounted -> nothing else
 * 004565bd  TEST EAX, 0x800000       ; EAX = obj+0x34
 * 004565c2  JZ   004565cd
 * 004565c4  CMP  word ptr [0x009c904a], CX   ; g_enemies_alive == 1?
 * 004565cb  JZ   004565ea            ; ...then keep the camera on it
 * 004565cd  OR   EAX, 0x10000        ; NoCameraTrack
 * 004565e2  MOV  byte [EAX*8 + 0x9a5ec0], 0  ; g_enemy_slots[obj+0x120]
 * 004565eb  CALL 00456560            ; ReleaseEnemyAliveCount
 * ```
 *
 * The **alive** count falls here and the **present** count does not: that is
 * `ZombieEnterCorpseState`'s, one death clip later.
 *
 * Three things this routine keeps together that the port used to split.
 * `ReleaseAttackSlot` (`FUN_00456520`) is the permit and **only** the permit —
 * it does not touch `obj+0x34`. The `NoCameraTrack` raise and the
 * `g_enemy_slots` clear are one arm, taken or skipped together. And the arm is
 * guarded: an actor carrying {@link ActorFlag.KeepCameraWhenLast} that is the
 * **last enemy alive** keeps camera tracking *and* keeps its slot, so the
 * killing shot of a fight is not cut away from. Six shipped spawns carry that
 * bit; see the flag's own comment for where they are and how it gets there.
 */
export function ZombieReleasePermitAndUntrack(obj: ZombieActor): void {
  ReleaseAttackSlot(obj);
  if (obj.flags38 & CountFlag.KeepCounted) return;
  // `004565bd a900008000` / `004565c4 66390d4a909c00` with CX = 1 — the test
  // is on `g_enemies_alive` (`0x009C904A`), which has not been decremented
  // yet: `ReleaseEnemyAliveCount` is the call *after* this arm, so "1" here
  // means "this actor is the last one".
  if (!(obj.flags & ActorFlag.KeepCameraWhenLast) || G.g_enemies_alive !== 1) {
    obj.flags |= ActorFlag.NoCameraTrack;
    // The camera slot at `obj+0x120`, which is a different slot from the
    // permit at `obj+0x121`. Modelled as a filter by `at`, for the reason
    // `ThrowerLeave` gives: the port keeps `g_enemy_slots` as a list of
    // actors.
    G.g_enemy_slots = G.g_enemy_slots.filter((at) => at !== obj.at);
  }
  ReleaseEnemyAliveCount(obj);
}

/**
 * `ZombieStateDeath6` — `FUN_00454D20`, class 0x30 state 6.
 *
 * Subs 0 and 1 are a **fallthrough**: `00454d42` increments the sub and runs
 * straight on into `00454d49`, which increments it again and runs on into the
 * sub-2 body at `00454d90`. So choosing the clip, the teardown and the first
 * frame of the wait all happen on the frame the actor enters the state.
 *
 * The wait is `g_motion_play_length[obj+0x1B4] - 1 <= obj+0x19C`, on the base
 * track — **the death clip plays exactly once and the state leaves on its last
 * frame**. That is the independent confirmation that the looping death clip
 * fixed at `b917532` was a bug and not the engine's behaviour.
 *
 * [diverges] The per-frame call through `PTR_FUN_00592BC4` — which is
 * `g_class30_states[0x37]`, `ZombieDeathEffectCueTick` (`FUN_004569B0`) — walks
 * the cue list `ChooseDeathMotion` installed and spawns a dust puff or a
 * splash when the play cursor reaches each cue. It is an effect and the port
 * has no cue list to walk; the one piece of state it touches,
 * {@link ZombieFlag2.OneShotFired}, is cleared below exactly as the engine
 * clears it.
 */
export function ZombieStateDeath6(obj: ZombieActor, rng: Rng): void {
  if (obj.sub === 0) {
    ChooseDeathMotion(obj, rng);
    obj.sub += 1;
  }
  if (obj.sub === 1) {
    // `OR EAX, 0x22000` on `obj+0x34` at 0x00454D4D: off the floor, and the
    // same bit the ballistic entrances raise while an arc is armed.
    obj.flags |= ActorFlag.Airborne | ActorFlag.ArcSpent;
    // `AND AH, 0xfd` then `OR EAX, 0x60000000` at 0x00454D5B — the pending
    // hit reaction is dropped and the body takes part in both pushes again.
    obj.flags2 = (obj.flags2 & ~ZombieFlag2.HitReactionPending)
               | ZombieFlag2.CollideWorld | ZombieFlag2.CollideActors;
    // `ZombiePlayDeathVoice` (`FUN_00456600`) goes here. [diverges] It is
    // sound only: it plays scream 0x4E17A9 or 0x2025A9 when this actor holds
    // the last of the groan voices counted at `0x009C8A74`, then clears its
    // own latch `obj+0x131B` and counts the global down. The latch is raised
    // by `EnemyZombieInitByCharType` (0x00453164), which the port does not
    // have, so a transcription here could never fire. `[open]`
    ZombieReleasePermitAndUntrack(obj);
    obj.sub += 1;
    // `AND ECX, 0xfffeffff` at 0x00454D7D — the death clip's own splash cue
    // may fire even if an earlier one already did.
    obj.flags2 &= ~ZombieFlag2.OneShotFired;
  }
  if (obj.sub !== 2) return;

  const holding = (obj.flags & ActorFlag.HoldingWeapon) !== 0;
  const spent = MotionPlayFrame(obj) >= MotionPlayLength(obj) - 1;
  if (!spent && !holding) return;

  obj.flags2 &= ~ZombieFlag2.HitReactionPending;
  if (holding) {
    obj.state = ZombieState.DeathFallAndBounce;
    obj.sub = 0;
    return;
  }
  ZombieEnterCorpseState(obj);
}

/**
 * `ZombieEnterCorpseState` — `FUN_00456740`. The twin of
 * `ThrowerEnterCorpseState`, and the routine the port's comments used to call
 * unread.
 *
 * ```
 * 0045674b  AND EAX, 0x9fffffff      ; obj+0x136C: out of both pushes
 * 00456759  AND EAX, 0xfffdfffe      ; obj+0x34:  not airborne, and bit 0
 * 0045675e  OR  AH, 0xc0             ;            | 0xC000
 * 00456767  TEST AL, 0x1             ; obj+0x38 bit 0
 * 0045676c  CALL 00456580            ; ReleaseEnemyPresentCount
 * 00456774  MOV EDX, [ESI+0x194] / DEC EDX / MOV [ESI+0x194], EDX
 * 00456782  CMP AX, 0x12  /  0045678e CMP AX, 0x3   ; obj+0x1F4, charType
 * 00456794  MOV word [ESI+0x1310], 0x7   ; ...else 0x8 at 004567a8
 * ```
 *
 * **The present count falls here and nowhere else**, which is what makes a
 * corpse still on stage present but not alive.
 *
 * `obj+0x194 -= 1` steps the base track's own frame counter back one. It is
 * the counter `MotionPlayFrame` takes modulo `play_length + 1`, and the state
 * above only leaves once it has reached `play_length - 1`, so this is what
 * keeps the corpse a frame short of the wrap rather than one past it.
 *
 * `obj+0x34 &= ~1` is transcribed as a comment and not as a write, on the same
 * terms as `ThrowerLeave`: bit 0 of the flag word is what
 * `RankEnemiesByDistance` (`FUN_004090B0`) tests before it writes a rank, and
 * the port's `RegisterForDistanceRank` stands in for it with `!dead`, which a
 * corpse already fails. `[proved]` for the test, `[open]` for the bit's name.
 */
export function ZombieEnterCorpseState(obj: ZombieActor): void {
  obj.flags2 &= ~(ZombieFlag2.CollideWorld | ZombieFlag2.CollideActors);
  obj.flags = (obj.flags & ~ActorFlag.Airborne)
            | ActorFlag.PoseFrozen | CORPSE_UNREAD_BIT;
  if (!(obj.flags38 & CountFlag.KeepCounted)) ReleaseEnemyPresentCount(obj);
  obj.playTicks -= 1;
  obj.state = CORPSE_BLINK_TYPES.includes(obj.charType)
    ? ZombieState.CorpseBlink : ZombieState.CorpseSink;
  obj.sub = 0;
}

/**
 * The opening both corpse states share: `FUN_00454F20` and `FUN_00454FD0` are
 * the same eight lines up to the countdown, and differ only in whether the
 * body sinks or flickers.
 *
 * [diverges] `SpawnGroundRingEffect` is the first call of each, and it is an
 * effect the port does not draw.
 */
function ZombieCorpseBegin(obj: ZombieActor): void {
  // `AND EDX, 0xdffffdff` — **0x20000000 and 0x200 only.** The comment on
  // `ZombieFlag2.HitReactionAlt` used to name this instruction as the thing
  // that clears bit 0x100; `0xdffffdff` has bit 8 set, so it does not.
  obj.flags2 &= ~(ZombieFlag2.CollideWorld | ZombieFlag2.HitReactionPending);
  // `OR EAX, 0xa0000` — off the floor for the sink, and no ground decal.
  obj.flags |= ActorFlag.Airborne | CORPSE_NO_DECAL_BIT;
  obj.zom.corpseTimer = CORPSE_FRAMES;
  // `obj+0x1350 = obj+0x68` — the spawn yaw stashed in the field the port
  // calls `landSurface`. `[open]`: nothing in the ported call graph reads it
  // back for a class-0x30 corpse, and writing a heading into a field named for
  // a surface id would be worse than naming the gap. Not written.
  obj.sub = 1;
}

/**
 * The corpse's last act, shared by both states: drop out of camera tracking,
 * give the camera slot back, and leave the pool.
 *
 * `obj+0x34 |= 0x10000` / `g_enemy_slots[obj+0x120 * 8] = 0` / `ActorDespawn`
 * at 0x00454F9C..0x00454FBB, and the identical three at 0x0045508C.
 */
function ZombieCorpseLeave(obj: ZombieActor): void {
  obj.flags |= ActorFlag.NoCameraTrack;
  G.g_enemy_slots = G.g_enemy_slots.filter((at) => at !== obj.at);
  ActorDespawn(obj);
}

/**
 * The pose pin both corpse states call every frame — `ZombieCorpsePoseFrame`
 * (`FUN_00454E00`).
 *
 * [diverges] Not ported, and it needs an exporter change rather than a
 * reading. The routine writes `obj+0x194` from a table chosen by the clip:
 * `DAT_0059301C` covers the eight directional deaths 0x3D9..0x3E0 and five
 * special cases sit at `DAT_0059305C` (0x3F8), `DAT_00593064` (0x1DF),
 * `DAT_0059306C` (0x41A), `DAT_00593074` (0x404) and `DAT_0059307C` (0x3F7),
 * each a pair picked with `rand() % 17 >> 4` — the same once-in-seventeen
 * idiom `ThrowerCorpsePoseFrame` uses against class 0x31's own table at
 * `0x00592AC0`. **None of the class-0x30 table is exported**, and
 * `tools/hod2lib/` is outside this change's file list.
 *
 * What it costs is only *which* frame of the death clip the body holds:
 * `ZombieEnterCorpseState` raises {@link ActorFlag.PoseFrozen}, so the corpse
 * is frozen either way, on the clip's last frame here rather than on the
 * authored one.
 */

/**
 * `ZombieStateCorpseSink` — `FUN_00454F20`, class 0x30 state 7.
 *
 * Two seconds, sinking 0.04 units a frame, then gone. The sink works because
 * {@link ZombieCorpseBegin} raises {@link ActorFlag.Airborne}, which is the bit
 * `ZombiePushOutOfWorldAndActors` skips its ground snap on — without it the
 * floor would put the body back every frame.
 */
export function ZombieStateCorpseSink(obj: ZombieActor, dt: number): void {
  if (obj.sub === 0) ZombieCorpseBegin(obj);
  else if (obj.sub !== 1) return;

  const frames = dt * GAME_HZ;
  obj.zom.corpseTimer -= frames;
  obj.pos.y -= CORPSE_SINK * frames;
  if (obj.zom.corpseTimer < 1) ZombieCorpseLeave(obj);
}

/**
 * `ZombieStateCorpseBlink` — `FUN_00454FD0`, class 0x30 state 8. Character
 * types 0x12 and 3 only.
 *
 * The same two seconds without the sink: the countdown's **parity** drives the
 * whole skinned model's per-part draw flag through `FUN_00409D10`, which walks
 * `model+0x3C` parts and writes the byte at `model+0x40 + i*8 - 7`. `obj+0x1F8`
 * bit 0 takes the same value and is what `FUN_0040A590` reads before it draws
 * the ground decal.
 *
 * [diverges] The port has one draw alpha per actor rather than a byte per
 * part, which is `ThrowerStateCorpse`'s answer to the same routine.
 */
export function ZombieStateCorpseBlink(obj: ZombieActor, dt: number): void {
  if (obj.sub === 0) ZombieCorpseBegin(obj);
  else if (obj.sub !== 1) return;

  // Parity is read **before** the decrement, so the first frame is visible.
  obj.alpha = (Math.floor(obj.zom.corpseTimer) & 1) ? 0 : 1;

  const frames = dt * GAME_HZ;
  obj.zom.corpseTimer -= frames;
  if (obj.zom.corpseTimer >= 1) return;
  obj.alpha = 1;
  ZombieCorpseLeave(obj);
}

/**
 * `ZombieStateDeathFallAndBounce` — `FUN_00456DF0`, class 0x30 state 12.
 *
 * Where `ZombieStateDeath6` sends an actor that dies still holding something —
 * `obj+0x34` bit 0x1000000, the bit `ZombieStateStandAndThrow` raises while a
 * thrower has a weapon and `CivilianReleaseCaptors` clears on a released
 * captor. `ChooseDeathMotion` has already given it clip 0x3F9.
 *
 * It holds that clip for sixty ticks, then falls under gravity until the
 * ground stops it, bounces at a quarter of the impact speed, cuts to the
 * landing clip 0x3F8 at a random frame, and enters the corpse when the bounce
 * has died down.
 *
 * [diverges] The landing effect at `PTR_FUN_00592BC8` —
 * `ZombieDeathLandingEffect` (`FUN_00456B70`), which is
 * `g_class30_states[0x38]` — is a splash on surfaces 5 and 0x37 and a dust
 * puff otherwise. Not ported; the one piece of state it owns is
 * {@link ZombieFlag2.OneShotFired}, which is the gate below and is set here
 * where the hook would set it.
 */
export function ZombieStateDeathFallAndBounce(obj: ZombieActor, dt: number,
                                              rng: Rng): void {
  const frames = dt * GAME_HZ;

  if (obj.sub === 0) {
    obj.flags2 &= ~ZombieFlag2.CollideWorld;
    obj.flags &= ~ActorFlag.PoseFrozen;
    obj.accY = BOUNCE_GRAVITY;
    obj.sub = 1;
  }
  if (obj.sub === 1) {
    if (MotionPlayFrame(obj) < BOUNCE_HOLD_TICKS) return;
    obj.sub += 1;
    obj.flags2 = (obj.flags2 & ~ZombieFlag2.OneShotFired)
               | ZombieFlag2.CollideWorld;
  }
  if (obj.sub !== 2) return;

  // The clip freezes on its last frame, but only clip 0x3F9 does — once the
  // landing clip is running the test cannot come true again.
  if (obj.motion === DEATH_CLIP_HOLDING_WEAPON
      && MotionPlayFrame(obj) >= MotionPlayLength(obj) - 1) {
    obj.flags |= ActorFlag.PoseFrozen;
  }
  obj.vel.y += obj.accY * frames;
  const ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y, obj.pos.z);
  if (obj.pos.y + obj.vel.y > ground) return;

  obj.pos.y = ground;
  obj.vel.y *= BOUNCE_NORMAL;
  if (!(obj.flags2 & ZombieFlag2.OneShotFired)) {
    obj.flags2 |= ZombieFlag2.OneShotFired;
    ActorSetMotionBlended(obj, BOUNCE_LANDING_CLIP,
                          rng.int(BOUNCE_LANDING_SPREAD), MotionFade.Normal);
    obj.flags &= ~ActorFlag.PoseFrozen;
  }
  if (Math.abs(obj.vel.y) > SETTLE_SPEED) return;
  // `ClearCurrentActorVelocityAndAccel` — the body has stopped.
  obj.vel.x = obj.vel.y = obj.vel.z = 0;
  obj.accY = 0;
  ZombieEnterCorpseState(obj);
}

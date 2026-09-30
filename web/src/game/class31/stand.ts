/**
 * The hub, and the wait.
 *
 * `ThrowerStateStandAndDecide` is where a thrower spends most of its life. It
 * plays the idle its **stance** names — a different clip on each wall and on
 * the ceiling — turns to face the camera at 0x200 BAMS a frame, and then asks
 * the router. `ThrowerStateWaitForPermit` is the same pose held until the one
 * attack permit comes free, and it is the only way into the pounce at close
 * range.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, ThrowerFlag, ThrowerStance, type ThrowerActor }
  from "../actor";
import { TurnActorAwayFromPointTestArrival } from "../actor_turn";
import { ThrowerTryClaimAttackSlot } from "../combat/permits";
import type { GameHost } from "../host";
import { QueryGroundSurfaceAt } from "../coli";
import { MotionOf, MotionPlayLength } from "../tables";
import { G } from "../globals";
import type { Vec3 } from "../vec";
import { SetCurrentActorMotionBlended } from "../class30/motion_cue";
import { MotionFade } from "../class30/states";
import { GroundDustCode, ThrowerEmitGroundDust } from "./ground_dust";
import { ThrowerPickNextState, ThrowerTryEnterState } from "./router";
import {
  STAND_AIM_TOLERANCE, STAND_TURN_RATE, ThrowerMotion, ThrowerState,
} from "./states";
import { ThrowerMotionOf } from "./tables";

/** Character type 0x18 has its own clip for everything. */
const CHAR_ZSLMAN = 0x18;
/** The type table at `0x0044B3D0`: `ADD EAX, -0x16; CMP EAX, 0x3; JA`. */
const CHAR_TYPE_FIRST = 0x16;
const CHAR_TYPE_LAST = 0x19;
/**
 * `QueryGroundSurfaceAt(x, y + 4.5, z)` at `0x0044B2D8` -- `FADD
 * [0x00565DE8]`, 4.5 -- which `zskamere` does not turn on when it is
 * `PERCH_SURFACE`, 0x35.
 */
const SURFACE_PROBE_RISE = 4.5;

/**
 * The character type whose ground arm stores its position instead of drawing a
 * new start frame — `CMP word ptr [ESI + 0x1F4], 0x16` at `0x0044B202`.
 * The position is `obj+0x13E4`, the start of the trail `ThrowerEmitGroundDust`
 * (`FUN_0044D260`) lays behind character type 0x16 and alone among the four.
 */
const CHAR_TYPE_STANDS_ON_ITS_MARK = 0x16;

/**
 * `[port-only]` — the stance these two states compute **for themselves**.
 *
 * `bit6 + 2*bit7 + 3*bit8`, and no `Pouncing` term: the engine spells it
 * inline twice, at `0x0044B1CC` and again at `0x0044B418`, and both then test
 * the sum against the length of their own table rather than masking it.
 *
 * `ThrowerStanceOf` is the *other* one — `ThrowerLoadAttackArcScript`'s,
 * which adds `4*bit17` — and the two are not interchangeable here. Masking
 * that one with `& 3` is how a sum of 4 read as ground and 6 as a wall, rows
 * neither of these routines ever selects.
 */
function ThrowerSurfaceStance(obj: ThrowerActor): number {
  const f = obj.flags2;
  return (f & ThrowerFlag.WallA ? ThrowerStance.WallA : 0)
       + (f & ThrowerFlag.WallB ? ThrowerStance.WallB : 0)
       + (f & ThrowerFlag.Ceiling ? ThrowerStance.Ceiling : 0);
}

/**
 * The idle each stance plays, for every character but 0x18.
 *
 * [proved] from the disassembly at `0x0044B24B`, `0x0044B269` and
 * `0x0044B287`: the decompiler renders these as `0x20F - 0xD7` and so on,
 * which reads as the 0x18 clip minus a constant. The three are 0x138, 0x137
 * and 0x131, not the 0x138/0x135/0x13B an earlier pass recorded.
 */
const STAND_BY_STANCE = [undefined, 0x138, 0x137, 0x131];
const STAND_BY_STANCE_ZSLMAN = [undefined, 0x20f, 0x20c, 0x212];

/** `ThrowerStateWaitForPermit`'s idle, which is a different set again. */
const WAIT_BY_STANCE = [undefined, 0x129, 0x124, 0x134];
const WAIT_BY_STANCE_ZSLMAN = [0x208, 0x1fd, 0x1f3, 0x205];
/** ...and its fallback for a stance the table does not name. */
const WAIT_DEFAULT = 0x127;

/**
 * `ThrowerStateStandAndDecide` — `FUN_0044B180`, class 0x31 state 7.
 *
 * The sub-state is an aim latch, and its arms **fall into each other**
 * (`L53`): the dispatch at `0x0044B1B4` jumps to sub 0's arm, sub 1's or sub
 * 2's, and each runs on into the next with no `RET` between.
 *
 * ```
 *        walk = g_class31_motion_sets[set][2 + (obj+0x34 >> 27 & 1)]
 *        start = rand() % 10                    ; 0x0044B1A0, every frame
 * sub 0  the stance's clip (see below), SetCurrentActorMotionBlended(clip,
 *        start, 5); sub 1, and on
 * sub 1  by type (the table at 0x0044B3D0):
 *          0x17: if QueryGroundSurfaceAt(x, y + 4.5, z) == 0x35, no turn
 *          0x16, 0x17, 0x18, 0x19: unless OffGround,
 *            TurnActorAwayFromPointTestArrival(eye, 0x200, 0x200) -> sub 2
 *        and on
 * sub 2  0x16, 0x18, 0x19 only: unless OffGround, the same turn again, and
 *        if it has not arrived, sub 0
 * all    the re-arm, else the router; ThrowerEmitGroundDust(0x5A)
 * ```
 *
 * So a type-0x16, 0x18 or 0x19 thrower turns **twice** a frame, 0x400 BAMS,
 * and while it is still coming round it goes back to sub 0 every frame and
 * starts its idle over; a `zskamere` (0x17) turns once, never drops back, and
 * standing on surface 0x35 does not turn at all. An actor on a wall or the
 * ceiling skips every turn -- `obj+0x136C` bit 0x20 -- which is why a
 * clinging thrower does not swing round to track you.
 *
 * The port turned once a frame, only in the sub the frame began in, had no
 * type table, and drew the `rand() % 10` only in sub 0.
 */
export function ThrowerStateStandAndDecide(obj: ThrowerActor,
                                           dt: number,
                                           rng: Rng, host: GameHost,
                                           events?: Events): void {
  const stance = ThrowerSurfaceStance(obj);
  // `g_class31_motion_sets[set][2 + (obj+0x34 >> 27 & 1)]` at `0x0044B19C`:
  // the walk pair, by the spawn's bit 27. This took the first of the pair
  // for every spawn, and stage 4's `zskamere` with the bit walked on 443
  // where the exe walks them on 438.
  let motion = ThrowerMotionOf(obj,
                               ThrowerMotion.Walk + ((obj.flags >>> 27) & 1));
  // `rand() % 10`, the default start frame -- drawn at `0x0044B1A0`, **before**
  // the sub-state dispatch, so on every frame the hub runs.
  let start = rng.int(10);
  const entry = obj.sub;
  if (entry === 0) {
    if (stance > ThrowerStance.Ceiling) {
      // `cmp eax, 3; ja 0x0044B293` — two surface bits at once sums past the
      // table, and the arm that skips it plays the set's own walk at the
      // frame already drawn. It is not `stance & 3`: that reads 4 as ground
      // and 6 as a wall, which are rows this routine never selects.
    } else if (stance === ThrowerStance.Ground) {
      if (obj.charType === CHAR_TYPE_STANDS_ON_ITS_MARK) {
        // `0x0044B21E` — character type 0x16 keeps the drawn frame and stores
        // where it is standing instead: the trail's first point, which
        // `ThrowerEmitGroundDust` measures the first scuff from.
        obj.target.x = obj.pos.x;
        obj.target.y = obj.pos.y;
        obj.target.z = obj.pos.z;
      } else {
        // `rand() % g_motion_play_length[motion]` at `0x0044B211`: on the
        // ground the start is drawn from the clip's own play length, which is
        // what keeps a pair of them out of lockstep. A play cursor, as
        // `ActorSetMotionBlended` takes every start -- and so is the
        // `rand() % 10` above (`0x0044B1AB`), which the other arms pass.
        start = rng.int(Math.max(1, MotionPlayLength(obj, motion ?? -1)));
      }
    } else {
      motion = (obj.charType === CHAR_ZSLMAN
        ? STAND_BY_STANCE_ZSLMAN : STAND_BY_STANCE)[stance];
    }
    // **Unconditional**, as `0x0044B29E` is. This used to be class 0x30's
    // `ZombieSetMotionIfIdle`, which returns early while a one-shot is on
    // `obj.action` — so an actor that reached the hub with the leap's landing
    // clip or the fall's still running never got its idle at all, and held
    // whatever pose it was spawned in for the rest of its life.
    if (motion !== undefined && MotionOf(obj, motion)) {
      SetCurrentActorMotionBlended(obj, motion, start, MotionFade.Quick);
    }
    obj.sub = 1;
  }

  // Sub 1's arm, entered from sub 0 or on its own (`0x0044B2AD`).
  if ((entry === 0 || entry === 1) && obj.charType >= CHAR_TYPE_FIRST
      && obj.charType <= CHAR_TYPE_LAST) {
    const perched = obj.charType === CHAR_ZSKAMERE
      && QueryGroundSurfaceAt(obj.pos.x, obj.pos.y + SURFACE_PROBE_RISE,
                              obj.pos.z) === PERCH_SURFACE;
    if (!perched && !(obj.flags2 & ThrowerFlag.OffGround)
        && TurnTowardCameraAndTest(obj, dt)) {
      obj.sub += 1;
    }
  }
  // Sub 2's arm, entered from sub 1 or on its own (`0x0044B31C`): every type
  // but 0x17 turns again, and drops back to sub 0 while it has not arrived.
  if (entry >= 0 && entry <= 2
      && (obj.charType === CHAR_TYPE_STANDS_ON_ITS_MARK
          || (obj.charType > CHAR_ZSKAMERE && obj.charType <= CHAR_TYPE_LAST))
      && !(obj.flags2 & ThrowerFlag.OffGround)
      && !TurnTowardCameraAndTest(obj, dt)) {
    obj.sub = 0;
  }

  // The re-arm comes first, and only from here: an actor that has thrown puts
  // its weapon back before it does anything else.
  const rearm = obj.charType === CHAR_ZSLMAN
    ? ThrowerState.RestoreBothHands : ThrowerState.Rearm;
  if (!ThrowerTryEnterState(obj, rearm, rng, host)
      && obj.state !== ThrowerState.FallToSurface) {
    ThrowerPickNextState(obj, rng, host);
  }
  // `0x0044B3B2`, which all three of those paths reach: the re-arm's `JZ`,
  // the fall's `JZ` and the router's fall-through. It runs after the router,
  // so a frame that leaves the stand for another state takes the trail's
  // any-state arm rather than its footfall test.
  ThrowerEmitGroundDust(obj, GroundDustCode.Trail, host, events);
}

/**
 * `TurnActorAwayFromPointTestArrival` (`FUN_00409FE0`) as state 7 calls it:
 * `(obj, g_camera_eye_x, 0, g_camera_eye_z, 0x200, 0x200)` at `0044b309` and
 * `0044b355` -- step the yaw 0x200 toward the camera and report whether it is
 * now within 0x200 of it.
 *
 * It was an inline copy with `atan2` rounded where `VecToAngles` truncates and
 * a `bamsDelta` window standing in for `AngleWithinTolerance`; the routine is
 * ported in `actor_turn.ts` now and this calls it.
 */
function TurnTowardCameraAndTest(obj: ThrowerActor,
                                 dt: number): boolean {
  _eyeAtFloor.x = G.g_camera_eye.x;
  _eyeAtFloor.z = G.g_camera_eye.z;
  return TurnActorAwayFromPointTestArrival(obj, _eyeAtFloor, STAND_TURN_RATE,
                                           STAND_AIM_TOLERANCE, dt);
}
/** The point the routine is handed: the eye's x and z, and a height of 0. */
const _eyeAtFloor: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * `ThrowerStateWaitForPermit` — `FUN_0044B3E0`, class 0x31 state 8.
 *
 * Where the router sends an actor that has closed inside 30 units. It idles —
 * in its stance's own clip, so a wall-clinging one waits on the wall — until
 * `ThrowerTryClaimAttackSlot` succeeds, and then goes straight to the pounce.
 *
 * This is the throttle: there is one permit in single player, so however many
 * throwers are on you, only one is ever coming.
 *
 * The way out is a four-arm table on the character type (`0x0044B600`,
 * behind `ADD EAX, -0x16 / CMP EAX, 0x3 / JA` to the `RET` at `0x0044B4FE`):
 * 0x16, 0x18 and 0x19 take `0x0044B526` -- `PUSH 0x2416a9 / CALL
 * 0x0041cfd0`, drop `obj+0x136C` bit `0x400`, state 9 -- and 0x17 takes
 * `0x0044B54D`, the perch test, which goes to state 0x20 in silence or plays
 * the same sound at `0x0044B5A5` on its way to state 0x18. `[proved]`
 * Ghidra's listing runs the first arm on into misaligned bytes after its
 * `AND AH, 0xfb` (`0x0044B53E`); `66c786101300000900` at `0x0044B53C` is
 * `MOV word ptr [ESI + 0x1310], 0x9`. The port played neither sound.
 */
export function ThrowerStateWaitForPermit(obj: ThrowerActor,
                                          rng: Rng,
                                          host: GameHost,
                                          events?: Events): void {
  // `SUB EAX, 0x0 / JZ`, `DEC EAX / JZ` at `0x0044B3EC`: two arms, and any
  // other sub returns.
  if (obj.sub !== 0 && obj.sub !== 1) return;
  if (obj.sub === 0) {
    if (!ThrowerTryClaimAttackSlot(obj, rng, host)) {
      // `if ((obj+0x34 & 0x40000000) != 0) return;` — an actor already in a
      // reaction holds whatever clip that reaction is playing rather than
      // dropping into the wait's idle.
      if (obj.flags & ActorFlag.Reacting) return;
      const stance = ThrowerSurfaceStance(obj);
      let motion: number | undefined;
      if (obj.charType === CHAR_ZSLMAN) {
        motion = WAIT_BY_STANCE_ZSLMAN[stance] ?? WAIT_DEFAULT;
      } else if (stance === ThrowerStance.Ground) {
        // `CMP AX, 0x17 / JZ 0x0044b481` at `0x0044B458`: character type
        // 0x17 stands in the set's first idle and draws nothing; the others
        // flip `rand() % 2` between the pair. The port drew for 0x17 too.
        motion = ThrowerMotionOf(obj, obj.charType === CHAR_ZSKAMERE
          ? ThrowerMotion.Idle
          : rng.int(2) === 0 ? ThrowerMotion.Idle : ThrowerMotion.IdleAlt);
      } else {
        motion = WAIT_BY_STANCE[stance] ?? WAIT_DEFAULT;
      }
      // `cmp [ESI + 0x1B4], EAX; je` at `0x0044B4C8` — the same-motion test is
      // this routine's own, and it is the only test around the set. What
      // follows it at `0x0044B4E0` is again the unconditional setter, at
      // frame 0 over a ten-frame fade.
      if (motion !== undefined && obj.motion !== motion && MotionOf(obj, motion)) {
        SetCurrentActorMotionBlended(obj, motion, 0, MotionFade.Normal);
      }
      return;
    }
    obj.sub = 1;
  }

  obj.sub = 0;
  // `obj+0x136C |= 0x180000` — the claim is also where the engine turns both
  // collision halves back on, so an actor that has been through a corpse
  // state (which clears them) collides again when it next commits.
  obj.flags2 |= ThrowerFlag.Collide;
  if (obj.charType < CHAR_ZSASS || obj.charType > CHAR_ZSTIN) return;
  // Character type 0x17 does not pounce. It splits two ways, and **it raises
  // the throw-table bit on the way out** — which is what makes both of its
  // attacks resolve against `g_class31_throws` rather than the melee row.
  // Neither state sets that bit itself, so this is the only place it is set.
  if (obj.charType === CHAR_ZSKAMERE) {
    obj.flags2 |= ThrowerFlag.UseThrowTable;
    // On surface 0x35, more than fifteen units above `g_camera_eye_y` (read
    // by address at `0x0044B56F`: the gameplay eye, so level with the rail's
    // own height, not fifteen above the drawn camera), it perches and
    // swings on the spot; otherwise it closes and strikes.
    const surface = QueryGroundSurfaceAt(obj.pos.x, obj.pos.y + 4.5,
                                         obj.pos.z);
    if (surface === PERCH_SURFACE
        && G.g_camera_eye.y + PERCH_HEIGHT < obj.pos.y) {
      obj.state = ThrowerState.StrikeOnTheSpot;
      return;
    }
    events?.emit("sound.play", { id: SND_ATTACK_CLAIMED });
    obj.state = ThrowerState.CloseAndStrike;
    return;
  }
  events?.emit("sound.play", { id: SND_ATTACK_CLAIMED });
  obj.flags2 &= ~ThrowerFlag.UseThrowTable;
  obj.state = ThrowerState.Pounce;
}

/**
 * `PUSH 0x2416a9` at `0x0044B526` and `0x0044B5A5`: what a claim that goes
 * to state 9 or 0x18 plays. `ThrowerStateLeapToSurface` names the same id at
 * `0x0044C225`.
 */
const SND_ATTACK_CLAIMED = 0x2416a9;
/** The way out's table spans the four class-0x31 types, `0x16..0x19`. */
const CHAR_ZSASS = 0x16;
const CHAR_ZSTIN = 0x19;
/** Character type 0x17, the only one that does not pounce. */
const CHAR_ZSKAMERE = 0x17;
/** The surface it perches on, and how far above the eye it must be. */
const PERCH_SURFACE = 0x35;
const PERCH_HEIGHT = 15;

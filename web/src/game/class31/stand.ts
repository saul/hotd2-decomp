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
import type { Rng } from "../../core/rng";
import { ActorFlag, ThrowerFlag, type Actor } from "../actor";
import { TurnActorTowardCameraEye } from "../actor_turn";
import { ThrowerTryClaimAttackSlot } from "../combat/permits";
import type { GameHost } from "../host";
import { QueryGroundSurfaceAt } from "../coli";
import { MotionOf } from "../tables";
import { bamsDelta, dist2d, type Vec3 } from "../vec";
import { ZombieSetMotionIfIdle } from "../class30/motion_cue";
import { MotionFade } from "../class30/states";
import { ThrowerPickNextState, ThrowerTryEnterState } from "./router";
import {
  STAND_TURN_RATE, ThrowerMotion, ThrowerState,
} from "./states";
import { ThrowerMotionOf, ThrowerStanceOf } from "./tables";

/** Character type 0x18 has its own clip for everything. */
const CHAR_ZSLMAN = 0x18;

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
 * The sub-state is an aim latch, not a sequence: sub 1 waits for the turn to
 * arrive, and sub 2 drops back to 0 the moment it is lost again. An actor on a
 * wall or the ceiling skips the turn entirely — `obj+0x136C` bit 0x20 — which
 * is why a clinging thrower does not swing round to track you.
 */
export function ThrowerStateStandAndDecide(obj: Actor, eye: Vec3, dt: number,
                                           rng: Rng, host: GameHost): void {
  const stance = ThrowerStanceOf(obj) & 3;
  if (obj.sub === 0) {
    let motion = ThrowerMotionOf(obj, ThrowerMotion.Walk);
    let start: number | "clip" = rng.int(10);
    if (stance === 0) {
      // On the ground the start frame is drawn from the clip's own length,
      // which is what keeps a pair of them out of lockstep.
      start = "clip";
    } else {
      motion = (obj.charType === CHAR_ZSLMAN
        ? STAND_BY_STANCE_ZSLMAN : STAND_BY_STANCE)[stance];
    }
    ZombieSetMotionIfIdle(obj, motion, rng, start, MotionFade.Quick);
    obj.sub = 1;
  }

  // The aim latch. Only an actor standing on the ground turns.
  if (obj.sub === 1 && !(obj.flags2 & ThrowerFlag.OffGround)) {
    if (TurnTowardCameraAndTest(obj, eye, dt)) obj.sub = 2;
  } else if (obj.sub === 2 && !(obj.flags2 & ThrowerFlag.OffGround)) {
    if (!TurnTowardCameraAndTest(obj, eye, dt)) obj.sub = 0;
  }

  // The re-arm comes first, and only from here: an actor that has thrown puts
  // its weapon back before it does anything else.
  const rearm = obj.charType === CHAR_ZSLMAN
    ? ThrowerState.RestoreBothHands : ThrowerState.Rearm;
  if (ThrowerTryEnterState(obj, rearm, rng, host)) return;
  if (obj.state === ThrowerState.FallToSurface) return;
  ThrowerPickNextState(obj, eye, rng, host);
}

/**
 * `TurnActorAwayFromPointTestArrival` (`FUN_00409FE0`) as state 7 calls it —
 * step the yaw 0x200 toward the camera and report whether it has arrived
 * within 0x200. Ghidra types the routine `void`; the value falls through EAX.
 */
function TurnTowardCameraAndTest(obj: Actor, eye: Vec3, dt: number): boolean {
  TurnActorTowardCameraEye(obj, eye, STAND_TURN_RATE, dt);
  const want = Math.atan2(obj.pos.x - eye.x, obj.pos.z - eye.z);
  const bams = Math.round((want * 65536) / (Math.PI * 2)) & 0xffff;
  return Math.abs(bamsDelta(bams, obj.yaw)) <= STAND_TURN_RATE;
}

/**
 * `ThrowerStateWaitForPermit` — `FUN_0044B3E0`, class 0x31 state 8.
 *
 * Where the router sends an actor that has closed inside 30 units. It idles —
 * in its stance's own clip, so a wall-clinging one waits on the wall — until
 * `ThrowerTryClaimAttackSlot` succeeds, and then goes straight to the pounce.
 *
 * This is the throttle: there is one permit in single player, so however many
 * throwers are on you, only one is ever coming.
 */
export function ThrowerStateWaitForPermit(obj: Actor, eye: Vec3, rng: Rng,
                                          host: GameHost): void {
  if (obj.sub === 0) {
    if (!ThrowerTryClaimAttackSlot(obj, host)) {
      // `if ((obj+0x34 & 0x40000000) != 0) return;` — an actor already in a
      // reaction holds whatever clip that reaction is playing rather than
      // dropping into the wait's idle.
      if (obj.flags & ActorFlag.Reacting) return;
      const stance = ThrowerStanceOf(obj) & 3;
      let motion: number | undefined;
      if (obj.charType === CHAR_ZSLMAN) {
        motion = WAIT_BY_STANCE_ZSLMAN[stance] ?? WAIT_DEFAULT;
      } else if (stance === 0) {
        motion = ThrowerMotionOf(obj, rng.int(2) === 0
          ? ThrowerMotion.Idle : ThrowerMotion.IdleAlt);
      } else {
        motion = WAIT_BY_STANCE[stance] ?? WAIT_DEFAULT;
      }
      if (motion !== undefined && obj.motion !== motion && MotionOf(obj, motion)) {
        ZombieSetMotionIfIdle(obj, motion, rng, 0, MotionFade.Normal);
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
  // Character type 0x17 does not pounce. It splits two ways, and **it raises
  // the throw-table bit on the way out** — which is what makes both of its
  // attacks resolve against `g_class31_throws` rather than the melee row.
  // Neither state sets that bit itself, so this is the only place it is set.
  if (obj.charType === CHAR_ZSKAMERE) {
    obj.flags2 |= ThrowerFlag.UseThrowTable;
    // On surface 0x35, more than fifteen units above the eye, it perches and
    // swings on the spot; otherwise it closes and strikes.
    const surface = QueryGroundSurfaceAt(obj.pos.x, obj.pos.y + 4.5,
                                         obj.pos.z);
    obj.state = surface === PERCH_SURFACE && eye.y + PERCH_HEIGHT < obj.pos.y
      ? ThrowerState.StrikeOnTheSpot : ThrowerState.CloseAndStrike;
    return;
  }
  obj.flags2 &= ~ThrowerFlag.UseThrowTable;
  obj.state = ThrowerState.Pounce;
}

/** Character type 0x17, the only one that does not pounce. */
const CHAR_ZSKAMERE = 0x17;
/** The surface it perches on, and how far above the eye it must be. */
const PERCH_SURFACE = 0x35;
const PERCH_HEIGHT = 15;

/** Is this actor far enough from the camera to be out of its face? */
export function ThrowerIsClear(obj: Actor, eye: Vec3, clear: number): boolean {
  return dist2d(obj.pos, eye) >= clear;
}

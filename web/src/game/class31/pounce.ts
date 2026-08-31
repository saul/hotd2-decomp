/**
 * The pounce, the leap back, and the pause between them.
 *
 * `ThrowerStateLeapDown` is the attack, and it is not a swing at a range: it
 * is an **arc onto a point in front of the camera** with the attack's own clip
 * laid over it, running `ThrowerStrikeConnect` every frame. The stab lands
 * because the arc put the actor there on the frame the attack entry names.
 *
 * `ThrowerStateLeapAside` is the leap back out of your face, and it is the
 * reason the fight has a rhythm: the actor arcs to a point five units to one
 * side of the camera and fifty in front, then stands there for ninety frames
 * before the router will consider anything else. That pause *is* the cooldown
 * — there is no timer.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, ThrowerFlag, type Actor } from "../actor";
import { TurnActorAwayFromPoint } from "../actor_turn";
import { ReleaseAttackSlot } from "../combat/permits";
import { ColiTraceSegmentAllSets } from "../coli";
import { G } from "../globals";
import type { GameHost } from "../host";
import { vec3, type Vec3 } from "../vec";
import { ZombieSetMotionIfIdle } from "../class30/motion_cue";
import { GAME_HZ, MotionFade } from "../class30/states";
import {
  ActorArcBeginToWaypoint, ActorArcStep, ActorClipFrame, ActorLocalPoint,
  InstallArcMotionScript,
} from "./arc";
import { ThrowerPickLandingPoint } from "./leap_down";
import {
  ASIDE_AHEAD, ASIDE_SIDEWAYS, LEAP_ASIDE_CLEAR, LEAP_ASIDE_FRAMES,
  ThrowerMotion, ThrowerState,
} from "./states";
import { ThrowerStrikeConnect } from "./strike";
import {
  ThrowerArcScript, ThrowerAttackOf, ThrowerMotionOf, ThrowerPickAttack,
  ThrowerStanceOf,
} from "./tables";

const _dest = vec3();
/** How far above and below the landing point the probe reaches. */
const ASIDE_PROBE = 1000;

const CHAR_ZSASS = 0x16;
const CHAR_ZSLMAN = 0x18;

/**
 * `ThrowerStateLeapDown` — `FUN_0044B670`, class 0x31 states 9, 12 and 13.
 *
 * Three state ids, one handler: the router's picks name 12 at middle range and
 * 13 far out, and `ThrowerStateWaitForPermit` sends the close case to 9.
 *
 * Two details that are easy to get backwards. The **stance is latched before
 * the surface bits are cleared** — `obj+0x1364` is written first — so a
 * thrower that pounces off a wall swings the wall's attack, and arrives on the
 * ground. And the attack index is not chosen here at all: passing the null
 * script sentinel to `ActorArcBeginToWaypoint` is what makes it roll one.
 */
export function ThrowerStateLeapDown(obj: Actor, dt: number, rng: Rng,
                                     host: GameHost, events?: Events): void {
  if (obj.sub === 0) {
    ThrowerPickLandingPoint(obj, host, _dest);
    obj.yaw = G.g_camera_yaw_bams;
    // The null-script call: it rolls the attack index and installs *that*
    // attack's arc script, which is how the swing and the flight are one clip.
    ActorArcBeginToWaypoint(obj, _dest, null, 1, () => {
      obj.attack = obj.charType === CHAR_ZSLMAN
        ? 3 : ThrowerPickAttack(obj, rng.int(10));
      obj.stance = ThrowerStanceOf(obj);
      InstallArcMotionScript(obj,
        ThrowerAttackOf(obj, obj.stance, obj.attack)?.script ?? null);
    });
    obj.flags |= ActorFlag.BackingOff;      // 0x10000000 -- registered as busy
    if (obj.charType !== CHAR_ZSLMAN) {
      // Off the wall. The stance the swing was drawn against is already
      // latched in `obj.stance`, so clearing these does not change the attack.
      obj.flags2 &= ~(ThrowerFlag.Surface | ThrowerFlag.OffGround
                    | ThrowerFlag.Struck | 0x200);
    }
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    if (obj.charType !== CHAR_ZSLMAN) ThrowerStrikeConnect(obj, events);
    if (ActorArcStep(obj, 1, dt)) return;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    ThrowerStrikeConnect(obj, events);
    // The engine re-snaps to the landing point every frame outside Training
    // Mode, so the actor tracks a camera that is still moving.
    ThrowerPickLandingPoint(obj, host, _dest);
    obj.pos.x = _dest.x;
    obj.pos.y = _dest.y;
    obj.pos.z = _dest.z;
    if (obj.action) return;
    obj.sub = 3;
  }

  obj.flags2 &= ~ThrowerFlag.Struck;
  obj.flags &= ~ActorFlag.BackingOff;
  obj.state = ThrowerState.LeapAside;
  obj.sub = 0;
}

/** Which arc script the leap back plays — by attack, then by character. */
function asideScript(obj: Actor): string {
  if (obj.attack === 3 && obj.charType !== CHAR_ZSLMAN) return "aside_attack3";
  if (obj.charType === CHAR_ZSASS) return "aside_zsass";
  if (obj.charType === CHAR_ZSLMAN) {
    return `aside_zslman_${ThrowerStanceOf(obj) & 3}`;
  }
  return "aside";
}

/**
 * `ThrowerStateLeapAside` — `FUN_0044B880`, class 0x31 state 10.
 *
 * Where to land is worked out in the **camera's own frame**, yaw only: five
 * units to one side and fifty in front. Then a vertical segment is traced
 * there, from a thousand units below the actor's tracked point to a thousand
 * above, and the actor lands on whatever that hits — a ledge, a walkway, the
 * street. When the trace misses, the engine's own fallback is the ground plane
 * `g_camera_fixed_eye_y`, which is what a host with no collision always gets.
 */
export function ThrowerStateLeapAside(obj: Actor, eye: Vec3, dt: number,
                                      rng: Rng): void {
  if (obj.sub === 0) {
    const side = (obj.flags2 & 0x10) ? 1 : (rng.int(2) === 0 ? 1 : -1);
    // The camera's **yaw only**, not its whole matrix: the point stays level
    // however the camera is pitched, which is why the engine builds it with a
    // bare `MatrixRotateY(g_camera_yaw_bams)`.
    ActorLocalPoint(eye, G.g_camera_yaw_bams, side * ASIDE_SIDEWAYS, 0,
                    ASIDE_AHEAD, _dest);

    if (ColiTraceSegmentAllSets(_dest.x, obj.lookAt.y - ASIDE_PROBE, _dest.z,
                                _dest.x, obj.lookAt.y + ASIDE_PROBE, _dest.z)) {
      obj.strikeStart.x = G.g_coli_hit_x;
      obj.strikeStart.y = G.g_coli_hit_y;
      obj.strikeStart.z = G.g_coli_hit_z;
    } else {
      // The engine's own fallback when the vertical probe finds nothing.
      obj.strikeStart.x = _dest.x;
      obj.strikeStart.y = G.g_camera_fixed_eye_y;
      obj.strikeStart.z = _dest.z;
    }

    ActorArcBeginToWaypoint(obj, obj.strikeStart,
                            ThrowerArcScript(asideScript(obj)), 1);
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    if (!(obj.flags2 & ThrowerFlag.OffGround)) {
      TurnActorAwayFromPoint(obj, obj.strikeStart, -0x100, dt);
    }
    if (ActorArcStep(obj, 1, dt)) return;
    obj.sinceLanding = 0;
    obj.flags &= ~ActorFlag.BackingOff;
    ReleaseAttackSlot(obj);
    ZombieSetMotionIfIdle(obj, ThrowerMotionOf(obj, ThrowerMotion.Land), rng,
                          0, MotionFade.Quick);
    obj.sub = 2;
  }

  // Sub 2: stand where it landed until it is clear of the camera *and* the
  // landing clip has played out. That wait is the pause between attacks.
  obj.sinceLanding += dt * GAME_HZ;
  const clear = obj.sinceLanding > LEAP_ASIDE_FRAMES
             || dist2(obj, eye) >= LEAP_ASIDE_CLEAR * LEAP_ASIDE_CLEAR;
  if (clear && !obj.action) {
    obj.state = ThrowerState.StandAndDecide;
    obj.sub = 0;
  }
}

function dist2(obj: Actor, eye: Vec3): number {
  const dx = obj.pos.x - eye.x;
  const dz = obj.pos.z - eye.z;
  return dx * dx + dz * dz;
}

/**
 * `ThrowerStateWithdraw` — `FUN_0044EC80`, class 0x31 state 25.
 *
 * The retreat the two *scripted* attacks end in — state 22's and state 23's —
 * where the ordinary pounce ends in the leap aside instead. Same shape: play
 * the landing clip, and go back to standing once ninety frames have passed or
 * the actor is fifty units clear.
 */
export function ThrowerStateWithdraw(obj: Actor, eye: Vec3, dt: number,
                                     rng: Rng): void {
  if (obj.sub === 0) {
    obj.flags |= ActorFlag.BackingOff;
    obj.flags2 |= 0x180000;
    ZombieSetMotionIfIdle(obj, ThrowerMotionOf(obj, ThrowerMotion.Land), rng,
                          0, MotionFade.Normal);
    obj.sinceLanding = 0;
    obj.sub = 1;
  }

  obj.sinceLanding += dt * GAME_HZ;
  if (obj.sinceLanding < LEAP_ASIDE_FRAMES
      && dist2(obj, eye) < LEAP_ASIDE_CLEAR * LEAP_ASIDE_CLEAR) return;
  if (obj.action && ActorClipFrame(obj) >= 0) return;

  obj.sinceLanding = 0;
  ReleaseAttackSlot(obj);
  obj.flags &= ~ActorFlag.BackingOff;
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
}

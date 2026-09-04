/**
 * The three entrances a `zstin` arrives by, all reading the same four bytes of
 * descriptor as three different things.
 *
 * Stage 2 uses each of them: block 17 step 5's pair walk fifteen units out of
 * the dark (state 18), block 18 and block 23's play a one-shot clip on the
 * spot (state 19), and block 21's two wait and then leap straight at you
 * (state 23). Every one of them ends up in `ThrowerStateStandAndDecide`, which
 * is where the fight actually starts.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, ThrowerFlag, type ThrowerActor } from "../actor";
import { ThrowerTryClaimAttackSlot } from "../combat/permits";
import type { GameHost } from "../host";
import { MotionOf } from "../tables";
import { bamsWrap, vec3 } from "../vec";
import { ZombieSetMotionIfIdle } from "../class30/motion_cue";
import { GAME_HZ, MotionFade } from "../class30/states";
import {
  ActorArcBegin, ActorArcStep, ActorClipFrame, ActorClipLength,
  InstallArcMotionScript,
} from "./arc";
import { ThrowerPickLandingPoint } from "./leap_down";
import { ThrowerMotion, ThrowerState } from "./states";
import { ThrowerStrikeConnect } from "./strike";
import {
  ThrowerAttackOf, ThrowerMotionOf, ThrowerPickAttack, ThrowerStanceOf,
} from "./tables";

const _dest = vec3();

/**
 * `ThrowerStateWalkDistance` — `FUN_0044E2A0`, class 0x31 state 18.
 *
 * Plays the set's walk clip and hands to the hub once the **2D** distance from
 * where it started reaches the float at descriptor tail `+0x04`. The walking
 * is the clip's own root motion, exactly as class 0x30's is; there is no
 * velocity here at all.
 */
export function ThrowerStateWalkDistance(obj: ThrowerActor, rng: Rng): void {
  if (obj.sub === 0) {
    ZombieSetMotionIfIdle(obj, ThrowerMotionOf(obj, ThrowerMotion.Walk), rng,
                          "clip", MotionFade.Quick);
    obj.arcFrom = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
    obj.sub = 1;
  }
  const dx = obj.arcFrom.x - obj.pos.x;
  const dz = obj.arcFrom.z - obj.pos.z;
  if (Math.hypot(dx, dz) < obj.walkDistance) return;

  obj.strikeStart.x = obj.pos.x;
  obj.strikeStart.y = obj.pos.y;
  obj.strikeStart.z = obj.pos.z;
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
}

/**
 * `ThrowerStateEntranceClip` — `FUN_0044E410`, class 0x31 state 19.
 *
 * One clip, named by the descriptor, played to two frames off its end. Stage
 * 2's `zstin` all name motion 296.
 */
export function ThrowerStateEntranceClip(obj: ThrowerActor): void {
  if (obj.sub === 0) {
    const m = MotionOf(obj, obj.entranceMotion);
    if (!m) { obj.state = ThrowerState.StandAndDecide; return; }
    obj.action = { motion: obj.entranceMotion, ticks: 0, loop: false };
    obj.rootActionFrame = -1;
    obj.sub = 1;
  }
  const len = ActorClipLength(obj, obj.entranceMotion);
  if (obj.action && ActorClipFrame(obj) < len - 2) return;
  obj.action = null;
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
}

/**
 * `ThrowerStateDelayedPounce` — `FUN_0044E830`, class 0x31 state 23.
 *
 * Both an entrance and an attack, and the only one that aims at the camera's
 * *own* height rather than at a point below it: the destination is
 * `ThrowerPickLandingPoint`'s x and z at `g_camera_eye_y`. It rolls its roll
 * angle back to level at 0xCCC a frame on the way in, and ends in
 * `ThrowerStateWithdraw` rather than in the leap aside.
 *
 * Note which stance each half reads. The **script** comes from the row
 * including the pounce bit, and the **hit frame** from `obj+0x1364`, which
 * this state never writes — so the swing plays row 4's clip and connects on
 * row 0's frame. That is what the code does, and it is not a transcription
 * slip.
 */
export function ThrowerStateDelayedPounce(obj: ThrowerActor, dt: number,
                                          rng: Rng,
                                          host: GameHost,
                                          events?: Events): void {
  const p = obj.pounce;
  if (!p) { obj.state = ThrowerState.StandAndDecide; obj.sub = 0; return; }

  if (obj.sub === 0) {
    obj.action = { motion: p.motion, ticks: 0, loop: false };
    obj.rootActionFrame = -1;
    obj.slideTimer = p.frames;
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    obj.slideTimer -= dt * GAME_HZ;
    if (obj.slideTimer > 0) return;
    if (!ThrowerTryClaimAttackSlot(obj, host)) obj.attackPermit = -1;
    obj.flags |= ActorFlag.BackingOff;
    obj.flags2 |= ThrowerFlag.Pouncing;
    obj.attack = ThrowerPickAttack(obj, rng.int(10));
    InstallArcMotionScript(obj,
      ThrowerAttackOf(obj, ThrowerStanceOf(obj), obj.attack)?.script ?? null);
    ThrowerPickLandingPoint(obj, host, _dest);
    _dest.y = obj.lookAt.y;
    ActorArcBegin(obj, _dest, p.frames);
    obj.arcPhase = 0;
    obj.sub = 2;
  }

  // Roll back to level at 0xCCC a frame — it comes in off the vertical.
  obj.yaw = bamsWrap(obj.yaw);
  if (obj.attackPermit >= 0) ThrowerStrikeConnect(obj, events);
  if (ActorArcStep(obj, 1, dt)) return;

  obj.flags &= ~ActorFlag.BackingOff;
  obj.flags2 &= ~ThrowerFlag.Pouncing;
  obj.state = ThrowerState.Withdraw;
  obj.sub = 0;
}

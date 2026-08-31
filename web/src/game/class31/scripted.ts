/**
 * The five states a class-0x31 spawn can only be *placed* in.
 *
 * None of them is reachable from the router: `ThrowerTryEnterState` accepts
 * twelve state ids and none of these is among them, and no other state writes
 * them either. They exist because a level designer put a `0x1B` or a `0x22` in
 * a spawn descriptor's byte +2 — which makes their descriptor tail the whole
 * specification, and every one of them a different tail.
 *
 * Measured over every shipped `evt/` file:
 *
 * ```
 * 21  RideObjectPath   0 spawns — cut content, and unreachable
 * 22  LeapStrike       0 spawns — dead code
 * 27  GrabPlayer       4 spawns, all `zslman` in stage 5
 * 28  WaitForCue       6 spawns, all in the training stage
 * 34  BlinkInThreeHops 8 spawns, all `zslman` in stage 6
 * ```
 *
 * Because `obj+0x1390` is fixed for an actor's life, every state it enters
 * reads the *same* record — and these five layouts are mutually incompatible,
 * so an actor can use at most one of them. The shipped data agrees: every
 * `tail+3` is 7, the hub.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, ThrowerFlag, type Actor } from "../actor";
import { ThrowerTryClaimAttackSlot } from "../combat/permits";
import { PlayerTakeDamage } from "../combat/player";
import { G } from "../globals";
import type { GameHost } from "../host";
import { MotionOf } from "../tables";
import { vec3, type Vec3 } from "../vec";
import { GAME_HZ } from "../class30/states";
import {
  ActorArcBegin, ActorArcStep, ActorClipFrame, ActorClipLength, ActorLocalPoint,
} from "./arc";
import { ThrowerPickLandingPoint } from "./leap_down";
import { ThrowerState } from "./states";
import { ThrowerStrikeConnect } from "./strike";
import { ThrowerLoadAttackArcScript, ThrowerPickAttack } from "./tables";

const _p = vec3();

/**
 * The blink states 27 and 34 share: solid on an even frame of
 * `g_blink_frame_counter` (0x009A5C50), gone on an odd one. `obj+0x138C` is
 * the draw alpha and `obj+0x136C` bit 2 is the flag `ThrowerDrawBonePart`
 * reads to decide whether to use it.
 */
function ThrowerBlink(obj: Actor): void {
  if (Math.floor(G.g_frame) & 1) {
    obj.alpha = 0;
    obj.flags2 |= ThrowerFlag.Blinking;
  } else {
    obj.alpha = 1;
    obj.flags2 &= ~ThrowerFlag.Blinking;
  }
}

/**
 * `ThrowerStateRideObjectPath` — `FUN_0044E5D0`, class 0x31 state 21.
 *
 * Rides object path `0x14F` — `op_st2`'s local path 7 — at the camera's own
 * path frame for 196 frames, then claims a permit and pounces. Both the slot
 * and the count are immediates, not descriptor fields.
 *
 * **No shipped spawn starts in it and no state can reach it.** Ported because
 * the state table names it and a bare number in a switch is how the cat ended
 * up running the zombie's machine.
 */
export function ThrowerStateRideObjectPath(obj: Actor, dt: number,
                                           host: GameHost): void {
  if (obj.sub === 0) {
    obj.slideTimer = 0;
    obj.sub = 1;
  }
  if (obj.sub === 1) {
    const n = obj.slideTimer;
    obj.slideTimer += dt * GAME_HZ;
    if (n < RIDE_FRAMES) {
      // `CamEvalObjectPath6` returns three floats and then three **ints** —
      // Ghidra types all six as float and it is wrong.
      const p = host.objectPath?.(RIDE_PATH_SLOT, G.g_cam_path_frame);
      if (p) {
        obj.pos.x = p.x; obj.pos.y = p.y; obj.pos.z = p.z;
        if (p.yaw !== undefined) obj.yaw = p.yaw;
      }
      return;
    }
    obj.sub = 2;
  }
  // The claim's answer is discarded: it pounces either way.
  ThrowerTryClaimAttackSlot(obj, host);
  obj.state = ThrowerState.Pounce;
  obj.sub = 0;
}

/** `op_st2` local path 7, and the frames it rides for. */
const RIDE_PATH_SLOT = 0x14f;
const RIDE_FRAMES = 0xc4;

/**
 * `ThrowerStateLeapStrike` — `FUN_0044E6B0`, class 0x31 state 22.
 *
 * The pounce again, but over a duration the descriptor names rather than one
 * the distance implies — and with a detail worth keeping: when the permit
 * claim **fails** it forces a target out of `g_active_player` and attacks with
 * no permit actually held. Nothing else in the class does that.
 *
 * **Dead code**: no shipped spawn starts in it, and no state reaches it.
 */
export function ThrowerStateLeapStrike(obj: Actor, dt: number, rng: Rng,
                                       host: GameHost,
                                       events?: Events): void {
  if (obj.sub === 0) {
    if (!ThrowerTryClaimAttackSlot(obj, host)) {
      // `g_active_player`: -1 nobody, 0 or 1 that player only, 2 both.
      obj.attackPermit = G.g_active_player === 1 ? 1
        : G.g_active_player === 2 ? rng.int(2) : 0;
    }
    obj.flags |= ActorFlag.BackingOff;
    obj.flags2 |= ThrowerFlag.Pouncing;
    obj.attack = ThrowerPickAttack(obj, rng.int(10));
    ThrowerLoadAttackArcScript(obj);
    ThrowerPickLandingPoint(obj, host, _p);
    ActorArcBegin(obj, _p, obj.leapStrikeFrames);
    obj.arcPhase = 0;
    obj.sub = 1;
  }
  if (obj.attackPermit >= 0) ThrowerStrikeConnect(obj, events);
  if (ActorArcStep(obj, 1, dt)) return;
  obj.flags &= ~ActorFlag.BackingOff;
  obj.flags2 &= ~ThrowerFlag.Pouncing;
  obj.state = ThrowerState.LeapAside;
  obj.sub = 0;
}

/** `ThrowerStateGrabPlayer`'s sub-states, which the engine simply increments. */
enum GrabSub {
  Anchor = 0,
  WaitForCue = 1,
  Descend = 2,
  Hold = 3,
  Grab = 4,
  ThrowAway = 5,
}

/** The two grab clips, picked at random, and the ride and finish clips. */
const GRAB_RIDE = 0x1e9;
const GRAB_A = 0x1e5;
const GRAB_B = 0x1e7;
const GRAB_FINISH = 0x1e8;
/** The frame of the grab clip the damage lands on. */
const GRAB_HIT_FRAME = 30;
/** It blinks for the last fifteen frames of the hold. */
const GRAB_BLINK_TAIL = 15;

/**
 * `ThrowerStateGrabPlayer` — `FUN_0044EF90`, class 0x31 state 27.
 *
 * Stage 5's four `zslman` come in on this: they ride a **camera-relative**
 * offset — re-anchored every frame, so they hang in shot however the camera
 * moves — wait for the camera path to reach a named frame, drop onto the
 * player, hold, and grab. It is the only state in the class that takes a
 * permit **outright** rather than claiming one, and the only one that names
 * its victim in the descriptor.
 *
 * [diverges] The engine rides subs 2 to 4 through
 * `MatrixTranslate(camera eye); MatrixRotateY(g_camera_yaw_bams + 0x8000)` and
 * writes only X and Z, leaving Y to the descent. That is reproduced. What is
 * not is the second camera block's path frame (`g_cam_path_frame_2`), which
 * the cue also accepts and the port has no second block for.
 */
export function ThrowerStateGrabPlayer(obj: Actor, eye: Vec3, dt: number,
                                       rng: Rng, events?: Events): void {
  const g = obj.grab;
  if (!g) { obj.state = ThrowerState.StandAndDecide; obj.sub = 0; return; }

  if (obj.sub === GrabSub.Anchor) {
    obj.action = { motion: GRAB_RIDE, t: 0, loop: false };
    obj.rootActionFrame = -1;
    // The spawn position *is* the camera-relative offset, kept for ever.
    obj.arcFrom = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
    obj.arcTo = { x: g.offset[0], y: g.offset[1], z: g.offset[2] };
    obj.pos.x += eye.x; obj.pos.y += eye.y; obj.pos.z += eye.z;
    obj.sub = GrabSub.WaitForCue;
  }

  if (obj.sub === GrabSub.WaitForCue) {
    obj.pos.x = eye.x + obj.arcFrom.x;
    obj.pos.y = eye.y + obj.arcFrom.y;
    obj.pos.z = eye.z + obj.arcFrom.z;
    if (G.g_cam_path_frame !== g.cue_frame) return ThrowerGrabRide(obj, eye);
    // Only the Y of the destination offset is ever read; the engine stores the
    // other two and never looks at them again.
    obj.vel.y = (obj.arcTo.y - obj.arcFrom.y) / g.drop_frames;
    obj.slideTimer = g.drop_frames;
    obj.sub = GrabSub.Descend;
  }

  if (obj.sub === GrabSub.Descend) {
    ThrowerBlink(obj);
    obj.slideTimer -= dt * GAME_HZ;
    if (obj.slideTimer > 0) return ThrowerGrabRide(obj, eye);
    obj.vel.x = obj.vel.y = obj.vel.z = 0;
    obj.pos.y = eye.y + obj.arcTo.y;
    obj.action = { motion: GRAB_RIDE, t: 0, loop: false };
    obj.rootActionFrame = -1;
    obj.slideTimer = g.hold_frames;
    obj.sub = GrabSub.Hold;
  }

  if (obj.sub === GrabSub.Hold) {
    if (obj.slideTimer > g.hold_frames - GRAB_BLINK_TAIL) {
      ThrowerBlink(obj);
    } else {
      obj.flags2 &= ~ThrowerFlag.Blinking;
      obj.alpha = 1;
    }
    obj.slideTimer -= dt * GAME_HZ;
    if (obj.slideTimer > 0) return ThrowerGrabRide(obj, eye);
    ThrowerGrabTakePermit(obj, g.player, rng);
    obj.sub = GrabSub.Grab;
  }

  if (obj.sub === GrabSub.Grab) {
    const m = obj.action?.motion ?? 0;
    if (obj.attackPermit >= 0 && !obj.struck
        && ActorClipFrame(obj) >= GRAB_HIT_FRAME) {
      obj.struck = true;
      PlayerTakeDamage(obj.attackPermit, obj, m !== GRAB_A ? 1 : 0, events,
                       "strike", -1);
    }
    if (obj.action && ActorClipFrame(obj) < ActorClipLength(obj, m) - 1) {
      return ThrowerGrabRide(obj, eye);
    }
    obj.strikeStart = { x: eye.x, y: eye.y, z: eye.z };
    obj.action = { motion: GRAB_FINISH, t: 0, loop: false };
    obj.rootActionFrame = -1;
    obj.sub = GrabSub.ThrowAway;
  }

  // Sub 5 rides the camera by **delta** rather than by offset, so the throw
  // plays out wherever the camera has got to.
  obj.pos.x += eye.x - obj.strikeStart.x;
  obj.pos.y += eye.y - obj.strikeStart.y;
  obj.pos.z += eye.z - obj.strikeStart.z;
  obj.strikeStart = { x: eye.x, y: eye.y, z: eye.z };
  if (!obj.action) ThrowerLeave(obj);
}

/** Subs 2 to 4 hang off the camera's yaw, half a turn round. X and Z only. */
function ThrowerGrabRide(obj: Actor, eye: Vec3): void {
  if (obj.sub < GrabSub.Descend || obj.sub > GrabSub.Grab) return;
  ActorLocalPoint(eye, G.g_camera_yaw_bams + 0x8000, obj.arcFrom.x,
                  obj.arcFrom.y, obj.arcFrom.z, _p);
  obj.pos.x = _p.x;
  obj.pos.z = _p.z;
}

/**
 * The permit negotiation at the end of the hold: take the named player's slot
 * outright, and if that player cannot be attacked or is already someone else's
 * target, try the other one before giving up.
 */
function ThrowerGrabTakePermit(obj: Actor, named: number, rng: Rng): void {
  let p = named === -1 ? rng.int(2) : named;
  if (!IsPlayerAttackable(p) || G.g_attack_permits[p] === 1) {
    if (p === 0) {
      p = IsPlayerAttackable(1) && G.g_attack_permits[1] === -1 ? 1 : -1;
    } else if (p === 1) {
      p = IsPlayerAttackable(0) && G.g_attack_permits[0] === -1 ? 0 : -1;
    }
  }
  if (p !== -1) {
    G.g_attack_permits[p] = obj.at;
    obj.action = { motion: rng.int(2) === 0 ? GRAB_B : GRAB_A, t: 0,
                   loop: false };
    obj.rootActionFrame = -1;
    obj.struck = false;
  }
  obj.attackPermit = p;
}

/**
 * `IsPlayerAttackable` — `FUN_00409DC0`.
 *
 * [diverges] The engine tests the scene state, the app state and the per-player
 * state word; the port has none of those and tests the one thing that stands in
 * for all three — the player is alive.
 */
export function IsPlayerAttackable(player: number): boolean {
  return player >= 0 && (G.g_player_lives[player] ?? 0) > 0;
}

/** `ThrowerLeave` — `FUN_0044AD60`. Release everything and go. */
function ThrowerLeave(obj: Actor): void {
  if (obj.attackPermit >= 0) G.g_attack_permits[obj.attackPermit] = -1;
  obj.attackPermit = -1;
  obj.dead = true;
  obj.visible = false;
}

/** `ThrowerStateWaitForCue`'s condition selector, the s16 at tail `+0x08`. */
export enum CueCondition {
  /** A frame count in `obj+0x1330`. */
  Frames = 0,
  /** The camera's own path frame. */
  CamPathFrame = 1,
  /** A `g_script_flags` byte. */
  ScriptFlag = 2,
}

/**
 * `ThrowerStateWaitForCue` — `FUN_0044F510`, class 0x31 state 28.
 *
 * Hold a clip until something happens, then become whatever state the
 * descriptor's byte `+0x03` names. All six shipped spawns are in the training
 * stage and all six name state 7, the hub.
 *
 * A selector above 2 waits for ever, and that is the engine's own behaviour.
 */
export function ThrowerStateWaitForCue(obj: Actor, dt: number,
                                       rng: Rng): void {
  const c = obj.cue;
  if (!c) { obj.state = ThrowerState.StandAndDecide; obj.sub = 0; return; }

  if (obj.sub === 0) {
    const m = MotionOf(obj, c.motion);
    if (m) {
      obj.action = { motion: c.motion, t: rng.int(m.frames) / m.fps,
                     loop: false };
      obj.rootActionFrame = -1;
    }
    obj.slideTimer = 0;
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    switch (c.cond) {
      case CueCondition.Frames:
        obj.slideTimer += dt * GAME_HZ;
        if (obj.slideTimer < c.operand) return;
        break;
      case CueCondition.CamPathFrame:
        if (G.g_cam_path_frame < c.operand) return;
        break;
      case CueCondition.ScriptFlag:
        if (G.g_script_flags[c.operand] !== 1) return;
        break;
      default:
        return;                              // waits for ever, as the exe does
    }
    obj.sub = 2;
  }
  obj.state = obj.attackState;
  obj.sub = 0;
}

/** `ThrowerStateBlinkInThreeHops`: three hops, thirty frames apart. */
const BLINK_HOPS = 3;
const BLINK_HOP_FRAMES = 30;
const BLINK_HOP_UNITS = 30;
/** The stance idle, an immediate rather than a table lookup. */
const BLINK_IDLE_BY_STANCE = [0x208, 0x1fd, 0x1f3, 0x205];

/**
 * `ThrowerStateBlinkInThreeHops` — `FUN_00451480`, class 0x31 state 34.
 *
 * Stage 6's eight `zslman` arrive this way, staggered by a descriptor delay of
 * 0, 30, 60 or 90 frames: they appear ninety units out along their own facing,
 * blink, and jump in to sixty and then thirty, thirty frames apart, before
 * going solid and handing to the state their descriptor names.
 *
 * The earlier reading called this a retreat and named it after one. It is a
 * materialisation: `obj+0x1348` counts **down** 3, 2, 1, and each hop is
 * measured from the origin captured on entry rather than from where the actor
 * currently is.
 */
export function ThrowerStateBlinkInThreeHops(obj: Actor, dt: number,
                                             stance: number): void {
  if (obj.sub >= 2) ThrowerBlink(obj);

  if (obj.sub === 0) {
    obj.hopsLeft = BLINK_HOPS;
    obj.flags |= ActorFlag.NoCameraTrack;
    const m = BLINK_IDLE_BY_STANCE[stance & 3] ?? BLINK_IDLE_BY_STANCE[0];
    if (MotionOf(obj, m)) {
      obj.action = { motion: m, t: 0, loop: false };
      obj.rootActionFrame = -1;
    }
    obj.arcFrom = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
    obj.slideTimer = obj.backAwayDelay;
    obj.flags2 |= ThrowerFlag.Blinking;
    obj.alpha = 0;
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    obj.slideTimer -= dt * GAME_HZ;
    if (obj.slideTimer >= 1) return;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    ActorLocalPoint(obj.arcFrom, obj.yaw, 0, 0,
                    obj.hopsLeft * BLINK_HOP_UNITS, obj.pos);
    obj.hopFrames = BLINK_HOP_FRAMES;
    obj.sub = 3;
  }

  if (obj.sub === 3) {
    obj.hopFrames -= dt * GAME_HZ;
    if (obj.hopFrames > 0) return;
    obj.sub = 4;
  }

  obj.hopsLeft -= 1;
  if (obj.hopsLeft > 0) { obj.sub = 2; return; }
  obj.flags2 &= ~ThrowerFlag.Blinking;
  obj.alpha = 1;
  obj.flags &= ~ActorFlag.NoCameraTrack;
  obj.state = obj.attackState;
  obj.sub = 0;
}

/**
 * The three class-0x30 states a **rider** uses: the zombies that stand on a
 * class-0x13 boat (class 0x18, `CarriedZombieUpdate18`), whose position is in
 * the boat's own space until they leave it.
 *
 * `g_class30_states` (`0x00592AE8`) entries 46, 47 and 48 are `0x0045CFC0`,
 * `0x0045D120` and `0x0045D500` — read off the table, with 45
 * (`ZombieStateTargetLostPause`, `0x0045C7D0`) and 49 (`NoOpStub`,
 * `0x0041EBB0`) either side agreeing with what the port already had (`L38`).
 * Until now all three fell to the dispatch's `default`, so a rider that won
 * its permit gave the attack up and stood on the boat.
 *
 * * **46, `ZombieStateIdleOnCarrier`** — where `CarriedZombieUpdate18`'s
 *   camera cue sends a rider while the camera is short of its frame: play the
 *   character's `row[0]` clip and keep turning to face the camera, the camera
 *   taken into the boat's space first.
 * * **48, `ZombieStateLeapOffCarrierToPoint`** — stage 3's riders' attack:
 *   play the leap clip, and on its launch frame bake the boat into the
 *   actor's pose, hand it back to the plain zombie update, and ride a
 *   parabola to a world point the script names — the landing on the player's
 *   boat. Then land, and hand over to `AttackRun`.
 * * **47, `ZombieStateLeapOffCarrierForward`** — stage 2's rider's attack:
 *   the same, but launched along its own facing at a scripted speed.
 *
 * The leap's two numbers and its clip come through `ZombieScriptForState`
 * (`FUN_0045CA10`) — the descriptor's `tail+0x08` blob, which the bundle
 * decodes as `attack_script.head` (`hod2lib/actorscript.ts`, shapes 47/48).
 */
import type { Events } from "../../core/events";
import { ActorFlag, ZombieFlag2, type Actor, type ZombieActor } from "../actor";
import { TurnActorAwayFromPoint } from "../actor_turn";
import { CarrierBakeWorldPose, CarrierLocalPoint } from "../carrier";
import { QueryGroundHeightAt } from "../coli";
import { SpawnSpriteEffect } from "../effects/sprite";
import { ActorByAt, G } from "../globals";
import {
  MatIdentity, MatrixGetAngles, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixToEulerBams,
} from "../matrix";
import { MotionPlayFrame, MotionPlayLength, MotionRowOf } from "../tables";
import { vec3, type Vec3 } from "../vec";
import { ActorSetMotionBlended } from "./motion_cue";
import { ZombieState } from "./states";
import { ZombieScriptForState } from "./target";

/** `ActorSetMotionBlended(..., 0x14)` in state 46's sub 0. */
const IDLE_FADE = 0x14;
/** The fade every other clip change in these three states takes. */
const LEAP_FADE = 10;
/** `TurnActorAwayFromPoint(..., 0x68)` while standing on the boat. */
const TURN_ON_CARRIER = 0x68;
/** `TurnActorAwayFromPoint(..., 0x1A0)` once off it. */
const TURN_OFF_CARRIER = 0x1a0;
/** `obj+0x5C = 0xBDDF0123` in state 47 — the forward leap's gravity. */
const FORWARD_LEAP_GRAVITY = -0.1088888868689537;
/** `QueryGroundHeightAt(x, y + 100.0, z)` — how far above the actor it probes. */
const LAND_PROBE_RISE = 100.0;
/** The two water surfaces a landing sinks through (`coli.md`). */
const SURFACE_WATER = 5;
const SURFACE_WATER_ALT = 0x37;
/** Surface 53, and the sound state 48 plays landing on it. */
const SURFACE_53 = 0x35;
const SND_LAND_53 = 0x1c16a9;
/** `SpawnSpriteEffect(&p, 0x61, 1, -1)` — the splash, once per leap. */
const EFFECT_SPLASH = 0x61;
/**
 * `obj+0x136C` bit 2, which a leaper dead on landing raises with
 * `DiedInFlight | CollideWorld` (`OR 0xA0000002`). No reader of it is named
 * here. `[open]`
 */
const FLAG2_BIT_2 = 0x2;
/** `[port-only]` guard on the water walk, which the engine leaves unbounded. */
const WATER_WALK_CAP = 4096;

const _p = vec3();

function Carrier(obj: Actor): Actor | undefined {
  return obj.carrierAt >= 0 ? ActorByAt(obj.carrierAt) : undefined;
}

/** Face a point given in the boat's space, from where the rider stands in it. */
function TurnOnCarrier(obj: ZombieActor, carrier: Actor | undefined,
                       x: number, y: number, z: number, dt: number): void {
  if (!carrier) return;
  CarrierLocalPoint(carrier, x, y, z, _p);
  TurnActorAwayFromPoint(obj, _p, TURN_ON_CARRIER, dt);
}

/**
 * `ZombieStateIdleOnCarrier` — `FUN_0045CFC0`, class 0x30 state 46.
 *
 * ```
 * sub 0: if (motion != row[0]) ActorSetMotionBlended(row[0], 0, 0x14);
 *        sub++; obj+0x1320 = motion;          -- and on into sub 1's body
 * sub 1: turn toward the camera eye taken into the carrier's space (0x68)
 * else:  if (!(obj+0x34 & 0x40000000) && motion != obj+0x1320)
 *            ActorSetMotionBlended(obj+0x1320, 0, 10);
 * ```
 *
 * `row[0]` is `*g_pHitReactionMotionsAlt[type][condition]` (`0x00592CBC`),
 * which is the port's {@link MotionRowOf} — the same table the idle
 * `ZombieStateHoldAtRange` plays from.
 */
export function ZombieStateIdleOnCarrier(obj: ZombieActor, eye: Vec3,
                                         dt: number): void {
  const carrier = Carrier(obj);
  if (obj.sub === 0) {
    const idle = MotionRowOf(obj)[0] ?? obj.motion;
    if (obj.motion !== idle) ActorSetMotionBlended(obj, idle, 0, IDLE_FADE);
    obj.sub = 1;
    obj.zom.scriptMotion = obj.motion;
  } else if (obj.sub !== 1) {
    if (!(obj.flags & ActorFlag.Reacting)
        && obj.motion !== obj.zom.scriptMotion) {
      ActorSetMotionBlended(obj, obj.zom.scriptMotion, 0, LEAP_FADE);
    }
    return;
  }
  TurnOnCarrier(obj, carrier, eye.x, eye.y, eye.z, dt);
}

/**
 * The half of states 47 and 48 after the launch — sub 2, the flight and the
 * landing, which the two write identically but for one sound and one mask.
 */
function LeapOffCarrierFly(obj: ZombieActor, freezeFrame: number, eye: Vec3,
                           dt: number, toPoint: boolean,
                           events?: Events): void {
  obj.vel.y += obj.accY;
  if (MotionPlayFrame(obj) === freezeFrame) {
    obj.flags |= ActorFlag.PoseFrozen;
    obj.frozen = 1;
  }
  let ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y + LAND_PROBE_RISE,
                                   obj.pos.z);
  if (obj.pos.y < ground && (G.g_coli_hit_surface === SURFACE_WATER_ALT
                             || G.g_coli_hit_surface === SURFACE_WATER)) {
    if (!(obj.flags2 & ZombieFlag2.OneShotFired)) {
      // `SpawnSpriteEffect(&(x, ground, z), 0x61, 1, -1)` — four pushes at
      // `0x0045D6EC`..`0x0045D6F6`, no angles. `[likely]` the face-camera
      // flag makes them irrelevant; they are passed as zero.
      SpawnSpriteEffect(vec3(obj.pos.x, ground, obj.pos.z), 0, 0,
                        EFFECT_SPLASH, 1, -1, undefined, events);
      obj.flags2 |= ZombieFlag2.OneShotFired;
    }
    let probe = ground;
    for (let n = 0; n < WATER_WALK_CAP; n++) {
      probe -= 1.0;
      ground = QueryGroundHeightAt(obj.pos.x, probe, obj.pos.z);
      if (G.g_coli_hit_surface === SURFACE_WATER_ALT) continue;
      if (G.g_coli_hit_surface !== SURFACE_WATER) break;
    }
  }

  if (((obj.pitch | obj.roll) & 0xffff) === 0) {
    if (obj.pos.y <= ground) {
      if (toPoint && G.g_coli_hit_surface === SURFACE_53) {
        events?.emit("sound.play", { id: SND_LAND_53 });
      }
      obj.vel.x = obj.vel.y = obj.vel.z = 0;
      obj.accY = 0;
      obj.pos.y = ground;
      // `AND 0xFFFEBFFF`: the splash latch and the leap bit come down.
      obj.flags2 &= ~(ZombieFlag2.OneShotFired | ZombieFlag2.Leaping);
      if (obj.hp < 1) {
        obj.state = ZombieState.Death;
        obj.flags &= ~ActorFlag.Airborne;
        obj.flags2 |= ZombieFlag2.DiedInFlight | ZombieFlag2.CollideWorld
          | FLAG2_BIT_2;
        obj.sub = 0;
      } else {
        obj.sub += 1;
        // State 47 always clears `0x26000`; state 48 keeps the airborne bit
        // when the landing found a surface (`0x0045D84A`..`0x0045D85F`).
        const clear = !toPoint || G.g_coli_hit_surface === 0
          ? ActorFlag.Airborne | ActorFlag.PoseFrozen | ActorFlag.NoHitReaction
          : ActorFlag.PoseFrozen | ActorFlag.NoHitReaction;
        obj.flags &= ~clear;
        if (clear & ActorFlag.PoseFrozen) obj.frozen = 0;
        obj.flags2 |= ZombieFlag2.CollideWorld;
      }
    }
    TurnActorAwayFromPoint(obj, eye, TURN_OFF_CARRIER, dt);
    return;
  }
  // Tilted off the boat: halve the pitch and roll about the actor's own
  // heading. `MatrixGetAngles` of `RotX; RotZ; RotY`, rebuilt as
  // `RotY(yaw); RotX(pitch / 2); RotZ(roll / 2)`, read back with
  // `MatrixToEulerBams`.
  const m = MatIdentity();
  MatrixRotateX(m, obj.pitch);
  MatrixRotateZ(m, obj.roll);
  MatrixRotateY(m, obj.yaw);
  const a = MatrixGetAngles(m);
  const n = MatIdentity();
  MatrixRotateY(n, a.yaw);
  MatrixRotateX(n, Math.trunc(a.pitch / 2));
  MatrixRotateZ(n, Math.trunc(a.roll / 2));
  const e = MatrixToEulerBams(n);
  obj.pitch = e.rx;
  obj.yaw = e.ry;
  obj.roll = e.rz;
}

/** Sub 3 of both: play the landing out, then `AttackRun`. */
function LeapOffCarrierLanded(obj: ZombieActor, eye: Vec3, dt: number): void {
  if (MotionPlayFrame(obj) === MotionPlayLength(obj) - 1) {
    obj.state = ZombieState.AttackRun;
    obj.sub = 0;
  }
  TurnActorAwayFromPoint(obj, eye, TURN_OFF_CARRIER, dt);
}

/**
 * `ZombieStateLeapOffCarrierToPoint` — `FUN_0045D500`, class 0x30 state 48.
 *
 * ```
 * s = ZombieScriptForState(obj);  // {f32 x, z, vy, accel; s16 motion, frame, freeze}
 * sub 0: ActorSetMotionBlended(s.motion, 0, 10); sub++; obj+0x34 |= 0x2000;
 * sub 1: if (clip frame == s.frame) {
 *            CarrierBakeWorldPose(obj, carrier); *obj = EnemyZombieUpdate;
 *            obj+0x136C = (obj+0x136C & 0xDFFEFFFF) | 0x4000;
 *            t = |vy / accel|;
 *            vel = ((x - pos.x) / 2t, vy, (z - pos.z) / 2t); accY = accel; sub++;
 *        }
 *        turn toward (x, camera y, z) taken into the carrier's space (0x68)
 * sub 2: fly, land -- LeapOffCarrierFly
 * sub 3: play out, then state 1
 * ```
 *
 * The turn in sub 1 runs **after** the bake on the launch frame, so it
 * measures a carrier-space point against a world position that one frame; it
 * is transcribed as read.
 */
export function ZombieStateLeapOffCarrierToPoint(obj: ZombieActor, eye: Vec3,
                                                 dt: number,
                                                 events?: Events): void {
  const s = ZombieScriptForState(obj)?.head;
  const carrier = Carrier(obj);
  switch (obj.sub) {
    case 0:
      if (s?.motion !== undefined) {
        ActorSetMotionBlended(obj, s.motion, 0, LEAP_FADE);
      }
      obj.sub = 1;
      obj.flags |= ActorFlag.NoHitReaction;
      return;
    case 1: {
      const pt = s?.leap_point ?? [obj.pos.x, obj.pos.z];
      if (s && MotionPlayFrame(obj) === s.frame) {
        if (carrier) CarrierBakeWorldPose(obj, carrier);
        obj.carrierAt = -1;
        obj.flags2 = (obj.flags2
          & ~(ZombieFlag2.CollideWorld | ZombieFlag2.OneShotFired))
          | ZombieFlag2.Leaping;
        const vy = s.leap_vy ?? 0;
        const acc = s.leap_accel ?? 0;
        let t = vy / acc;
        if (t < 0) t = -t;
        obj.vel.x = (pt[0] - obj.pos.x) / (t + t);
        obj.vel.z = (pt[1] - obj.pos.z) / (t + t);
        obj.vel.y = vy;
        obj.accY = acc;
        obj.sub = 2;
      }
      TurnOnCarrier(obj, carrier, pt[0], eye.y, pt[1], dt);
      return;
    }
    case 2:
      LeapOffCarrierFly(obj, s?.freeze ?? -1, eye, dt, true, events);
      return;
    case 3:
      LeapOffCarrierLanded(obj, eye, dt);
      return;
  }
}

/**
 * `ZombieStateLeapOffCarrierForward` — `FUN_0045D120`, class 0x30 state 47.
 *
 * As state 48, but the script is `{f32 speed, vy; s16 motion, frame,
 * freeze}` and the launch is along the actor's own facing:
 * `vel = (-sin(yaw) * speed, vy, -cos(yaw) * speed)`, `accY = -0.10889`
 * (`0xBDDF0123`). Sub 1 turns toward the **camera** in the carrier's space,
 * and the landing always clears `0x26000` and plays no sound.
 */
export function ZombieStateLeapOffCarrierForward(obj: ZombieActor, eye: Vec3,
                                                 dt: number,
                                                 events?: Events): void {
  const s = ZombieScriptForState(obj)?.head;
  const carrier = Carrier(obj);
  switch (obj.sub) {
    case 0:
      if (s?.motion !== undefined) {
        ActorSetMotionBlended(obj, s.motion, 0, LEAP_FADE);
      }
      obj.sub = 1;
      obj.flags |= ActorFlag.NoHitReaction;
      return;
    case 1:
      if (s && MotionPlayFrame(obj) === s.frame) {
        if (carrier) CarrierBakeWorldPose(obj, carrier);
        obj.carrierAt = -1;
        obj.flags2 = (obj.flags2
          & ~(ZombieFlag2.CollideWorld | ZombieFlag2.OneShotFired))
          | ZombieFlag2.Leaping;
        const a = obj.yaw * 9.587379924285257e-05;
        const speed = s.leap_speed ?? 0;
        obj.vel.x = -(Math.sin(a) * speed);
        obj.vel.z = -(Math.cos(a) * speed);
        obj.accY = FORWARD_LEAP_GRAVITY;
        obj.vel.y = s.leap_vy ?? 0;
        obj.sub = 2;
      }
      TurnOnCarrier(obj, carrier, eye.x, eye.y, eye.z, dt);
      return;
    case 2:
      LeapOffCarrierFly(obj, s?.freeze ?? -1, eye, dt, false, events);
      return;
    case 3:
      LeapOffCarrierLanded(obj, eye, dt);
      return;
  }
}


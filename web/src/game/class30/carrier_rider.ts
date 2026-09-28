/**
 * Class 0x30 states 46, 47 and 48 — what a class-0x18 rider does when its
 * script is done: hold on the carrier facing the camera, or leap off it.
 *
 * Only class 0x18 reaches them. `CarriedZombieInit18` is `EnemyZombieInit`
 * plus two stores, so its descriptor's attack state (`tail[3]`) is one of
 * these, and `ZombieScriptEnded` hands it there when the maul (state 35) or
 * the walk (state 34) runs out. All three read the carrier the actor was
 * built on (`obj+0x13B0`), and run inside `CarriedZombieUpdate18`'s carrier
 * matrix — so every position they touch before the leap is carrier-relative.
 *
 * ```
 * CarriedZombieUpdate18, after the state:
 *   if (state == tail[3] && sub == 0 && tail+0x0C != -1
 *       && g_cam_path_frame < tail+0x0E && g_active_cam_path == tail+0x0C)
 *       state = 0x2E, sub = 0;
 * ```
 *
 * so a rider whose script ends **before** the camera cue holds on the boat in
 * state 46 until the cue frame itself and then leaps (47, or 48 at a point),
 * and one whose script ends after it leaps at once. Stage 2's boat rider (evt
 * `0xA174`) mauls its civilian while the boat is still on its way to the wall
 * and so stays aboard, turning to face the camera, until camera path 78
 * reaches frame 630 -- `0x276`, the same number as the ride frame its boat
 * strikes the wall on. The port had none of the three: the default
 * arm sent it to `AttackRun` in the carrier's frame, where it walked off
 * across the canal in carrier-relative coordinates — 1,660 units from the
 * camera and unhittable — and stage 2 block 16 step 12's `wait_enemies_alive`
 * never released.
 */
import type { Events } from "../../core/events";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { ActorFlag, type ZombieActor } from "../actor";
import { TurnActorAwayFromPoint } from "../actor_turn";
import {
  CarrierBakeWorldPose, CarrierInverseTransformPoint, MatrixGetAngles,
  MatrixToEulerBams, RotXZY, RotYXZ,
} from "../carrier";
import { QueryGroundHeightAt } from "../coli";
import { SpawnSpriteEffect } from "../effects/sprite";
import { ActorByAt, G } from "../globals";
import type { GameHost } from "../host";
import { MotionPlayFrame, MotionPlayLength, MotionRowOf } from "../tables";
import { vec3, type Vec3 } from "../vec";
import { ActorSetMotionBlended } from "./motion_cue";
import { ZombieFlag2 } from "../actor";
import { ZombieState } from "./states";
import { ZombieScriptForState } from "./target";

/** `0x68` — the rider's turn toward the camera while it is still aboard. */
const RIDER_TURN_RATE = 0x68;
/** `0x1A0` — the turn once it has landed. */
const LANDED_TURN_RATE = 0x1a0;
/**
 * `MOV [ESI+0x5C], 0xBDDF0123` — state 47's own gravity. The float those bits
 * are is -0.10888888..., not the -0.10889056 this said.
 */
const LEAP47_GRAVITY = -0.1088888868689537;
/** `QueryGroundHeightAt(x, y + 100, z)`. */
const GROUND_PROBE_RISE = 100.0;
/** The two collision surfaces the landing treats as water. */
const SURFACE_WATER = 5;
const SURFACE_WATER_ALT = 0x37;
/** `g_coli_hit_surface == 0x35` — state 48 knocks on landing there. */
const SURFACE_WOOD = 0x35;
/** `SpawnSpriteEffect(..., 0x61, 1, -1)` — the splash into water. */
const SPLASH_SPRITE_KIND = 0x61;
/** `PlaySoundId(0x1C16A9)` — `COMMON\DAMAGE3_22.WAV`, the landing knock. */
const SFX_LAND_KNOCK = 0x1c16a9;
/** `obj+0x136C` bit 0x10000 — the splash has been spawned for this leap. */
const FLAG2_SPLASHED = 0x10000;
/** `obj+0x34` bit 0x20000 — cleared on landing with the pose bits. */
const FLAG_LAND_CLEAR = 0x20000;

const _local = vec3();

/** The rider's carrier, when there still is one. */
function carrierOf(obj: ZombieActor) {
  return obj.carrierAt >= 0 ? ActorByAt(obj.carrierAt) : undefined;
}

/**
 * Turn toward a world point seen from inside the carrier's frame: the states'
 * `MatrixInvert(0); MatrixTransformPoint; TurnActorAwayFromPoint`.
 */
function turnTowardInCarrier(obj: ZombieActor, x: number, y: number,
                             z: number, rate: number, dt: number,
                             c = carrierOf(obj)): void {
  if (!c) return;
  CarrierInverseTransformPoint(c, x, y, z, _local);
  TurnActorAwayFromPoint(obj, _local, rate, dt);
}

/**
 * `ZombieStateHoldOnCarrier` — `FUN_0045CFC0`. Class 0x30 state 46.
 *
 * Sub 0 blends to the actor's own idle — row 0 of
 * `g_class30_motion_rows` for its body condition, the clip
 * `ZombieStateApproach` walks on — remembers it at `obj+0x1320`, and runs on
 * into sub 1 (the `INC` at `0x0045D022` is followed by sub 1's first
 * instruction). Sub 1 turns toward the camera eye, taken into the carrier's
 * frame, at `0x68` a frame -- and then **leaves on the camera cue**:
 *
 * ```
 * 0045d0af  CALL MatrixStackPop           ; Ghidra: no-return, and the body ends
 * 0045d0b4  MOVSX EAX, word [EBP+0xc]     ; EBP = obj+0x1390, the tail
 * 0045d0b8  CMP [g_active_cam_path], EAX ; JNZ out
 * 0045d0c5  MOVSX ECX, word [EBP+0xe]
 * 0045d0c9  CMP [g_cam_path_frame], ECX  ; JNZ out
 * 0045d0d1  state = (s8)[EBP+3]; sub = 0  ; the attack state
 * 0045d0e6  if (!(obj+0x34 & 0x40000000) && obj+0x1B4 != obj+0x1320)
 *               blend(obj+0x1320, 0, 10)  ; every sub ends here
 * ```
 *
 * `CarriedZombieUpdate18` sends a rider here while the camera is **short** of
 * `tail+0x0E`; this sends it on to its attack state on the frame the camera
 * **reaches** it. So a rider whose maul ends early holds on the boat facing
 * the camera and leaps on its cue, and one whose maul ends late leaps at once.
 * Everything after the pop was `L35`'s: the port read the pseudocode, called
 * this state "no exit, the actor stays on the carrier until it is shot", and
 * stage 3 block 0's `0xADC` stood on its boat through the crash.
 */
export function ZombieStateHoldOnCarrier(obj: ZombieActor, eye: Vec3,
                                         dt: number): void {
  if (obj.sub === 0) {
    const m = MotionRowOf(obj)[0] ?? 0;
    if (obj.motion !== m) ActorSetMotionBlended(obj, m, 0, 0x14);
    obj.sub += 1;
    obj.zom.scriptMotion = obj.motion;
  }
  if (obj.sub === 1) {
    turnTowardInCarrier(obj, eye.x, eye.y, eye.z, RIDER_TURN_RATE, dt);
    // The same three tail fields the wrapper's cue reads, compared equal.
    const cue = obj.class18;
    if (cue && G.g_active_cam_path === cue.cue_path
        && G.g_cam_path_frame === cue.cue_frame) {
      obj.state = cue.from_state;
      obj.sub = 0;
    }
  }
  if ((obj.flags & ActorFlag.Reacting) === 0
      && obj.motion !== obj.zom.scriptMotion) {
    ActorSetMotionBlended(obj, obj.zom.scriptMotion, 0, 10);
  }
}

/**
 * The flight both leaps share, sub 2: gravity, the pose freeze on the
 * script's frame, the ground under the actor with the water layers skipped,
 * and the landing — or, while the baked pose still carries pitch or roll,
 * halving both instead.
 */
function LeapOffCarrierFlight(obj: ZombieActor, flagFrame: number,
                              knockOnWood: boolean, eye: Vec3, dt: number,
                              host: GameHost | undefined,
                              events: Events | undefined): void {
  obj.vel.y += obj.accY;
  if (MotionPlayFrame(obj) === flagFrame) obj.flags |= ActorFlag.PoseFrozen;
  let ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y + GROUND_PROBE_RISE,
                                   obj.pos.z);
  if (obj.pos.y < ground && (G.g_coli_hit_surface === SURFACE_WATER_ALT
                             || G.g_coli_hit_surface === SURFACE_WATER)) {
    if ((obj.flags2 & FLAG2_SPLASHED) === 0) {
      SpawnSpriteEffect(vec3(obj.pos.x, ground, obj.pos.z), 0, 0,
                        SPLASH_SPRITE_KIND, 1, -1, host, events);
      obj.flags2 |= FLAG2_SPLASHED;
    }
    // Step down through the water until something solid answers.
    let probe = ground;
    do {
      do {
        probe -= 1.0;
        ground = QueryGroundHeightAt(obj.pos.x, probe, obj.pos.z);
      } while (G.g_coli_hit_surface === SURFACE_WATER_ALT);
    } while (G.g_coli_hit_surface === SURFACE_WATER);
  }

  if (((obj.pitch | obj.roll) & 0xffff) === 0) {
    if (obj.pos.y <= ground) {
      if (knockOnWood && G.g_coli_hit_surface === SURFACE_WOOD) {
        events?.emit("sound.play", { id: SFX_LAND_KNOCK });
      }
      obj.vel.x = obj.vel.y = obj.vel.z = 0;
      obj.accY = 0;
      obj.pos.y = ground;
      obj.flags2 &= ~(FLAG2_SPLASHED | ZombieFlag2.Leaping);
      if (obj.hp < 1) {
        obj.state = ZombieState.Death;
        obj.flags &= ~FLAG_LAND_CLEAR;
        obj.flags2 |= ZombieFlag2.CollideWorld | ZombieFlag2.DiedInFlight | 2;
        obj.sub = 0;
      } else {
        // State 48 keeps `0x20000` when the ground is a real surface; 47,
        // and 48 over nothing, clear it with the pose bits.
        const keep = knockOnWood && G.g_coli_hit_surface !== 0;
        obj.flags &= keep ? ~(ActorFlag.PoseFrozen | ActorFlag.NoHitReaction)
          : ~(FLAG_LAND_CLEAR | ActorFlag.PoseFrozen
              | ActorFlag.NoHitReaction);
        obj.sub += 1;
        obj.flags2 |= ZombieFlag2.CollideWorld;
      }
    }
    TurnActorAwayFromPoint(obj, eye, LANDED_TURN_RATE, dt);
    return;
  }
  // `MatrixGetAngles` of the pose, then half the pitch and roll back through
  // `MatrixToEulerBams`: the baked tilt of the carrier levels out in the air.
  const a = MatrixGetAngles(RotXZY(obj.pitch, obj.roll, obj.yaw));
  const r = MatrixToEulerBams(RotYXZ(a.y, Math.trunc(a.x / 2),
                                     Math.trunc(a.z / 2)));
  obj.pitch = r.pitch;
  obj.yaw = r.yaw;
  obj.roll = r.roll;
}

/** Sub 3 of both leaps: face the camera until the landing clip ends. */
function LeapOffCarrierLanded(obj: ZombieActor, eye: Vec3, dt: number): void {
  const len = MotionPlayLength(obj);
  if (MotionPlayFrame(obj) === len - 1) {
    obj.state = ZombieState.AttackRun;
    obj.sub = 0;
  }
  TurnActorAwayFromPoint(obj, eye, LANDED_TURN_RATE, dt);
}

/**
 * The release both leaps make on the script's frame: the carrier's matrix
 * baked into the actor, the plain zombie update back, and the world push off
 * for the flight. Returns false while the frame has not come.
 */
function LeapOffCarrierRelease(obj: ZombieActor, frame: number): boolean {
  if (MotionPlayFrame(obj) !== frame) return false;
  const c = carrierOf(obj);
  if (c) CarrierBakeWorldPose(obj, c);
  // `*obj = EnemyZombieUpdate`: the actor is no longer a rider.
  obj.carrierAt = -1;
  obj.flags2 = (obj.flags2 & 0xdffeffff) | ZombieFlag2.Leaping;
  return true;
}

/**
 * `ZombieStateLeapOffCarrierForward` — `FUN_0045D120`. Class 0x30 state 47, stage 2's
 * boat rider's attack state.
 *
 * The attack blob's header is `{f32 dist; f32 vy; s16 motion; s16 release;
 * s16 flag_frame}`. Sub 0 plays the clip and blocks hit reactions; sub 1
 * turns to the camera aboard until the clip reaches `release`, then steps off
 * — `vel = (-sin(yaw)·dist, vy, -cos(yaw)·dist)` in world space with gravity
 * `-0.109`; sub 2 flies and lands; sub 3 faces the camera out and goes to
 * `AttackRun`.
 */
export function ZombieStateLeapOffCarrierForward(obj: ZombieActor, eye: Vec3,
                                          dt: number, host?: GameHost,
                                          events?: Events): void {
  const h = ZombieScriptForState(obj)?.head;
  if (!h) return;
  switch (obj.sub) {
    case 0:
      ActorSetMotionBlended(obj, h.motion ?? 0, 0, 10);
      obj.sub += 1;
      obj.flags |= ActorFlag.NoHitReaction;
      return;
    case 1: {
      // The carrier is read at the top of the routine and the turn below runs
      // on the release frame too -- against a position that is now world
      // space. The engine does it; so does the port.
      const c = carrierOf(obj);
      if (LeapOffCarrierRelease(obj, h.release ?? -1)) {
        const a = obj.yaw * BAMS_TO_RAD_F64;
        obj.vel.x = -(Math.sin(a) * (h.dist ?? 0));
        obj.vel.z = -(Math.cos(a) * (h.dist ?? 0));
        obj.accY = LEAP47_GRAVITY;
        obj.vel.y = h.vy ?? 0;
        obj.sub += 1;
      }
      turnTowardInCarrier(obj, eye.x, eye.y, eye.z, RIDER_TURN_RATE, dt, c);
      return;
    }
    case 2:
      LeapOffCarrierFlight(obj, h.flag_frame ?? -1, false, eye, dt, host,
                           events);
      return;
    case 3:
      LeapOffCarrierLanded(obj, eye, dt);
      return;
  }
}

/**
 * `ZombieStateLeapOffCarrierAtMark` — `FUN_0045D500`. Class 0x30 state 48,
 * stage 3's boat riders' attack state.
 *
 * The header is `{f32 x, z, vy, gravity; s16 motion; s16 release;
 * s16 flag_frame}`: the same leap aimed at a world point on the bank, timed so
 * the arc lands on it — `t = |vy / gravity|`, `vel.xz = (point - pos) / 2t`.
 * Aboard it turns toward that point rather than the camera, and a landing on
 * surface `0x35` knocks.
 */
export function ZombieStateLeapOffCarrierAtMark(obj: ZombieActor, eye: Vec3,
                                                 dt: number, host?: GameHost,
                                                 events?: Events): void {
  const h = ZombieScriptForState(obj)?.head;
  const pt = h?.point;
  if (!h || !pt) return;
  switch (obj.sub) {
    case 0:
      ActorSetMotionBlended(obj, h.motion ?? 0, 0, 10);
      obj.sub += 1;
      obj.flags |= ActorFlag.NoHitReaction;
      return;
    case 1: {
      const c = carrierOf(obj);
      if (LeapOffCarrierRelease(obj, h.release ?? -1)) {
        const vy = h.vy ?? 0;
        const g = h.gravity ?? 0;
        const t = Math.abs(vy / g);
        obj.vel.x = (pt[0] - obj.pos.x) / (t + t);
        obj.vel.z = (pt[2] - obj.pos.z) / (t + t);
        obj.vel.y = vy;
        obj.accY = g;
        obj.sub += 1;
      }
      turnTowardInCarrier(obj, pt[0], eye.y, pt[2], RIDER_TURN_RATE, dt, c);
      return;
    }
    case 2:
      LeapOffCarrierFlight(obj, h.flag_frame ?? -1, true, eye, dt, host,
                           events);
      return;
    case 3:
      LeapOffCarrierLanded(obj, eye, dt);
      return;
  }
}

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
import { ActorFlag, ThrowerFlag, type ThrowerActor } from "../actor";
import { TurnActorAwayFromPoint } from "../actor_turn";
import { ThrowerReleaseAttackPermit } from "../combat/permits";
import { ActorPlayHitVoice, ActorVoice } from "../combat/voice";
import { ColiTraceSegmentAllSets } from "../coli";
import { G } from "../globals";
import { CharacterTypeOf, MotionPlayFrame, MotionPlayLength } from "../tables";
import type { GameHost } from "../host";
import { vec3, type Vec3 } from "../vec";
import { SetCurrentActorMotionBlended, ZombieSetMotionIfIdle }
  from "../class30/motion_cue";
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
/** `CMP word ptr [ESI + 0x1F4], 0x17` at `0x0044ECF8`: `zskamere`. */
const CHAR_ZSKAMERE = 0x17;
const CHAR_ZSLMAN = 0x18;
/**
 * `PUSH 0xffffff00` at `0x0044BB1B`: the leap aside's turn, a negative rate,
 * so the long way round, away from where the leap began.
 */
const LEAP_ASIDE_TURN_RATE = -0x100;
/** `PUSH 0xffffff00` at `0x0044ED0E`: type 0x17's turn out of the swing. */
const WITHDRAW_TURN_RATE = -0x100;
/** Type 0x17 is clear of the camera at thirty units, not fifty. */
const WITHDRAW_CLEAR_BACKING = 30;

/** The head bone, whose draw record is `obj+0x20C + 2 * 0x90` = `obj+0x32C`. */
const HEAD_BONE = 2;
/**
 * `CMP EAX, 0x2002` at `0x0044B6F6`, against `obj+0x32C`: the head model the
 * pounce cries out with -- the one `ThrowerShotFeedback` (`FUN_00449B20`)
 * swaps for `0x2015` on a damaging head hit, so a thrower whose head has been
 * shot pounces in silence.
 */
const CRYING_HEAD_SLOT = 0x2002;

/**
 * `obj+0x32C`, the head's draw record as it stands.
 *
 * [port-only] A lookup, not a routine: `boneSlot` holds only what a swap or
 * the part bind wrote, and the record is the skeleton's own slot until then --
 * zero once `RemoveBoneSubtree` has taken the head off. The same fallback as
 * `nodeSlotOf` in `game/model_draw.ts` and `BoneDrawSlot` in
 * `combat/shot_test.ts`.
 */
function headSlotOf(obj: ThrowerActor): number {
  if (obj.removed.includes(HEAD_BONE)) return 0;
  return obj.boneSlot[String(HEAD_BONE)]
    ?? CharacterTypeOf(obj)?.bones.find((b) => b.bone === HEAD_BONE)?.slot
    ?? 0;
}

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
 *
 * `[proved]` from the listing, four arms off the jump table at `0x0044B868`,
 * the first two falling into the next:
 *
 * ```
 * sub 0  0044b695  ThrowerPickLandingPoint(obj, &p); obj+0x68 = g_camera_yaw_bams
 *        0044b6b0  ActorArcBeginToWaypoint(obj, &p, &DAT_007DCC70, 1)
 *        0044b6fb  obj+0x1364 = the stance row
 *        0044b6f0  obj+0x34 |= 0x10000000                     ; Committed
 *        0044b709  if (obj+0x32C == 0x2002) ActorPlayHitVoice(obj, 3)
 *        0044b721  type != 0x18: obj+0x136C &= 0xfffff61f       ; ~0x9E0
 *        0044b734  type == 0x18: obj+0x136C &= ~0x800; obj+0x13D8.. = obj+0x40..
 *        sub 1, and on
 * sub 1  0044b76f  if (!(obj+0x136C & 0x800) && type != 0x18)
 *                    ThrowerStrikeConnect(obj)
 *        0044b77a  if (ActorArcStep(obj, 1) == 1) return
 *        0044b791  obj+0x136C &= ~0x180000; sub 2, and on
 * sub 2  0044b7b0  if (!(obj+0x136C & 0x800)) ThrowerStrikeConnect(obj)
 *        0044b7c8  unless Training with DAT_009C72F2 up: obj+0x40.. = the
 *                  landing point again
 *        0044b82c  if (obj+0x19C < g_motion_play_length[obj+0x1B4] - 2) return
 *        sub 3, and on
 * sub 3  0044b83e  obj+0x136C &= ~0x800; obj+0x34 &= ~0x10000000
 *                  state 10, sub 0
 * ```
 *
 * It used to raise and clear `ActorFlag.BackingOff` (`0x20000000`, the bit
 * `RankEnemiesByDistance` drops from the queue) for `0x10000000`, so a thrower
 * in mid-pounce left the ranking the engine keeps it in. It also cleared bit
 * `0x200` with the surface bits, which `0xfffff61f` keeps; never cried out;
 * gave `zslman` neither of its two stores; left both collision bits up on
 * landing; and waited for the clip to run out rather than two frames short.
 */
export function ThrowerStateLeapDown(obj: ThrowerActor, dt: number, rng: Rng,
                                     host: GameHost, events?: Events): void {
  if (obj.sub === 0) {
    ThrowerPickLandingPoint(obj, host, _dest);
    obj.yaw = G.g_camera_yaw_bams;
    // The null-script call: it rolls the attack index and installs *that*
    // attack's arc script, which is how the swing and the flight are one clip.
    ActorArcBeginToWaypoint(obj, _dest, null, 1, () => {
      obj.attack = obj.charType === CHAR_ZSLMAN
        ? 3 : ThrowerPickAttack(obj, rng.int(10));
      obj.thr.stance = ThrowerStanceOf(obj);
      InstallArcMotionScript(obj,
        ThrowerAttackOf(obj, obj.thr.stance, obj.attack)?.script ?? null);
    });
    // `OR ECX, 0x10000000` at `0x0044B6F0`: mid-attack, and kept in the
    // ranking for it.
    obj.flags |= ActorFlag.Committed;
    if (headSlotOf(obj) === CRYING_HEAD_SLOT) {
      ActorPlayHitVoice(obj, ActorVoice.Attack, rng,
                        (id) => events?.emit("sound.play", { id }));
    }
    if (obj.charType !== CHAR_ZSLMAN) {
      // Off the wall. The stance the swing was drawn against is already
      // latched in `obj.thr.stance`, so clearing these does not change the
      // attack. `0xfffff61f` leaves bit `0x200` alone.
      obj.flags2 &= ~(ThrowerFlag.Surface | ThrowerFlag.OffGround
                    | ThrowerFlag.Struck);
    } else {
      // `zslman` keeps its surface bits, and stores where the pounce left
      // from in `obj+0x13D8`..`0x13E0`.
      obj.flags2 &= ~ThrowerFlag.Struck;
      obj.strikeStart.x = obj.pos.x;
      obj.strikeStart.y = obj.pos.y;
      obj.strikeStart.z = obj.pos.z;
    }
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    if (!(obj.flags2 & ThrowerFlag.Struck) && obj.charType !== CHAR_ZSLMAN) {
      ThrowerStrikeConnect(obj, events);
    }
    if (ActorArcStep(obj, 1, dt)) return;
    // Down: `AND ECX, 0xffe7ffff` at `0x0044B791`. It collides with nothing
    // until a claim in `ThrowerStateStandAndDecide` raises both again.
    obj.flags2 &= ~ThrowerFlag.Collide;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    if (!(obj.flags2 & ThrowerFlag.Struck)) ThrowerStrikeConnect(obj, events);
    // The engine re-snaps to the landing point every frame, so the actor
    // tracks a camera that is still moving.
    //
    // [diverges] ...except in Training Mode while `DAT_009C72F2` is up
    // (`0x0044B7B8`..`0x0044B7EE`). That byte's one writer is the training
    // lesson driver `FUN_00497760`, which raises it as a lesson ends and is
    // not ported, so the port's byte is always down and it always snaps --
    // which is the engine's own answer in every other mode.
    ThrowerPickLandingPoint(obj, host, _dest);
    obj.pos.x = _dest.x;
    obj.pos.y = _dest.y;
    obj.pos.z = _dest.z;
    // `obj+0x19C` against `g_motion_play_length[obj+0x1B4] - 2` at
    // `0x0044B82A`: two frames short of the end of the clip, not the end.
    if (obj.action
        && ActorClipFrame(obj) < MotionPlayLength(obj, obj.action.motion) - 2) {
      return;
    }
    obj.sub = 3;
  }

  if (obj.sub !== 3) return;
  obj.flags2 &= ~ThrowerFlag.Struck;
  obj.flags &= ~ActorFlag.Committed;
  obj.state = ThrowerState.LeapAside;
  obj.sub = 0;
}

/** Which arc script the leap back plays — by attack, then by character. */
function asideScript(obj: ThrowerActor): string {
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
export function ThrowerStateLeapAside(obj: ThrowerActor, eye: Vec3, dt: number,
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
      TurnActorAwayFromPoint(obj, obj.strikeStart, LEAP_ASIDE_TURN_RATE, dt);
    }
    if (ActorArcStep(obj, 1, dt)) return;
    obj.thr.sinceLanding = 0;
    obj.flags &= ~ActorFlag.BackingOff;
    ThrowerReleaseAttackPermit(obj);
    ZombieSetMotionIfIdle(obj, ThrowerMotionOf(obj, ThrowerMotion.Land), rng,
                          0, MotionFade.Quick);
    obj.sub = 2;
  }

  // Sub 2: stand where it landed until it is clear of the camera *and* the
  // landing clip has played out. That wait is the pause between attacks.
  obj.thr.sinceLanding += dt * GAME_HZ;
  const clear = obj.thr.sinceLanding > LEAP_ASIDE_FRAMES
             || dist2(obj, eye) >= LEAP_ASIDE_CLEAR * LEAP_ASIDE_CLEAR;
  if (clear && !obj.action) {
    obj.state = ThrowerState.StandAndDecide;
    obj.sub = 0;
  }
}

function dist2(obj: ThrowerActor, eye: Vec3): number {
  const dx = obj.pos.x - eye.x;
  const dz = obj.pos.z - eye.z;
  return dx * dx + dz * dz;
}

/**
 * `ThrowerStateWithdraw` — `FUN_0044EC80`, class 0x31 state 25.
 *
 * The retreat the two *scripted* attacks end in — state 22's and state 23's —
 * where the ordinary pounce ends in the leap aside instead. Play the landing
 * clip, and go back to standing once ninety frames have passed or the actor
 * is clear of the camera. `[proved]`, the whole routine:
 *
 * ```
 * sub 0     obj+0x34 |= 0x20000000; obj+0x136C |= 0x180000
 *           type 0x17: obj+0x34 |= 0x2000
 *           SetCurrentActorMotionBlended(g_class31_motion_sets[cond][4], 0, 1)
 *           sub 1, obj+0x1338 = 0, and on into sub 1
 * type 0x17 TurnActorAwayFromPoint(obj, obj+0x13D8, obj+0x13E0, -0x100)   0044ed16
 *           if (++obj+0x1338 < 0x5A && 2D distance to the eye < 30) return
 * others    if (++obj+0x1338 < 0x5A && 2D distance to the eye < 50) return
 *           if (obj+0x19C < g_motion_play_length[obj+0x1B4] - 2) return
 * exit      obj+0x1338 = 0; ThrowerReleaseAttackPermit; state 7, sub 0
 *           obj+0x34 &= ~0x20002000
 * ```
 *
 * **Character type 0x17 is a different retreat**: it keeps turning to face
 * where its strike began -- the negative rate turns the long way, so away
 * from it -- it only has to get thirty units clear, it does not wait for the
 * clip, and it will not flinch while it goes. The port had one retreat for
 * every type, with no turn at all, a pooled "if idle" motion call at fade 10,
 * and an exit that waited on the swing channel instead of the clip.
 */
export function ThrowerStateWithdraw(obj: ThrowerActor, eye: Vec3, dt: number,
                                     _rng: Rng): void {
  const backsOff = obj.charType === CHAR_ZSKAMERE;
  if (obj.sub === 0) {
    obj.flags |= ActorFlag.BackingOff;
    obj.flags2 |= 0x180000;
    if (backsOff) obj.flags |= ActorFlag.NoHitReaction;
    const land = ThrowerMotionOf(obj, ThrowerMotion.Land);
    if (land !== undefined) SetCurrentActorMotionBlended(obj, land, 0, 1);
    obj.sub = 1;
    obj.thr.sinceLanding = 0;
  } else if (obj.sub !== 1) {
    return;
  }

  if (backsOff) {
    TurnActorAwayFromPoint(obj, obj.strikeStart, WITHDRAW_TURN_RATE, dt);
    obj.thr.sinceLanding += dt * GAME_HZ;
    if (obj.thr.sinceLanding < LEAP_ASIDE_FRAMES
        && dist2(obj, eye) < WITHDRAW_CLEAR_BACKING * WITHDRAW_CLEAR_BACKING) {
      return;
    }
  } else {
    obj.thr.sinceLanding += dt * GAME_HZ;
    if (obj.thr.sinceLanding < LEAP_ASIDE_FRAMES
        && dist2(obj, eye) < LEAP_ASIDE_CLEAR * LEAP_ASIDE_CLEAR) return;
    if (MotionPlayFrame(obj) < MotionPlayLength(obj) - 2) return;
  }

  obj.thr.sinceLanding = 0;
  ThrowerReleaseAttackPermit(obj);
  obj.state = ThrowerState.StandAndDecide;
  obj.flags &= ~(ActorFlag.BackingOff | ActorFlag.NoHitReaction);
  obj.sub = 0;
}

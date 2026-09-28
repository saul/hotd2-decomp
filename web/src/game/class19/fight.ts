/**
 * The stage-4 boss's movement states -- 4 to 0xE: the approach, the choice,
 * the holds, the facing test, the arrival, the turns, the walk to the phase-3
 * exit, the withdraw that ends phase 13 and the two waits for a player.
 *
 * "blend" is `ActorSetMotionBlended(char, clip, 0, fade)` (`FUN_004119A0`),
 * "unless playing" the `CMP [char+0x20], clip` guard in front of most of
 * them, "turn" `ActorTurnTowardXZ(obj+0x40, off.x, off.z, step)`
 * (`FUN_00426120`) and "err" `ActorHeadingErrorTo` (`FUN_00426090`). The turn
 * drives its offset onto the actor's local **+z**, and every call here passes
 * `pos - target` except the three that pass `P0 - pos`
 * (`Boss4StateChooseAction`, the withdraw's sub 2, the flinch's non-camera
 * arm) -- that is the exe's, and both signs are kept.
 * `docs/re/boss-strength.md` §8 has the reading.
 */
import type { Actor } from "../actor";
import { ActorFlag } from "../actor";
import { ActorPickTargetPlayer } from "../actor_target";
import {
  ActorHeadingErrorTo, ActorPointIsAhead, ActorTurnTowardXZ,
} from "../actor_turn";
import { MotionFrameOf } from "../actor_pose";
import { ActorSetMotion, ActorSetMotionBlended } from "../class30/motion_cue";
import { G } from "../globals";
import {
  FtolS16, MatCopy, MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixToEulerZYX, MatrixTransformVector, RADIANS_TO_BAMS, type Mat,
} from "../matrix";
import type { ClassFrame } from "../registry";
import { MotionPlayFrame, MotionPlayLength } from "../tables";
import { vec3 } from "../vec";
import { Boss4KeepInsideEdge } from "./arena";
import { Boss4QueueCameraCue } from "./camera";
import { Boss4ChainsawOff, Boss4ChainsawOn } from "./frame";
import { Boss4ResumeAfterHit } from "./death";
import {
  Boss4BlendUnlessPlaying, Boss4Clip, Boss4DistanceXZ, Boss4Enter, Boss4Flag,
  Boss4NoPlayerFree, Boss4PhaseFloor, Boss4Sound, Boss4State, Boss4Tables,
} from "./state";
import type { Boss4Block as Blk } from "./state";

/** The turn step most states use -- `PUSH 0x200`. */
const TURN_STEP = 0x200;
/** `Boss4StateFaceCamera`'s slower turn -- `PUSH 0x100`. */
const FACE_TURN_STEP = 0x100;

// -- Boss4PickApproachAttack ---------------------------------------------

/** `MOV dword [EAX+0x84], 0x43340000` -- the throw's range, 180.0. */
const THROW_RANGE = 180.0;
/** `0x42480000` -- strike 0xF's range, 50.0. */
const STRIKE65_RANGE = 50.0;
/** `0x428C0000` -- strikes 0x10 and 0x11's, 70.0. */
const STRIKE7A_RANGE = 70.0;
/** `rand() % 9` -- the columns of `g_boss4_approach_picks`. */
const PICK_COLUMNS = 9;

/**
 * `Boss4PickApproachAttack` — `FUN_00493F30`. Which attack the approach ends
 * in (`state+0x74`) and how close it has to get first (`state+0x84`):
 *
 * ```
 * phase 3 or 13:        (0x12, 180.0)   -- the throw
 * obj+0x34 & 0x100:     (0x0F, 50.0)    -- refusing damage: strike 0x65
 * else k = (s8)g_boss4_approach_picks[rank*9 + rand() % 9]
 *      if (state == 7 && k == 0) k = 1
 *      0: (0x0F, 50.0);  1: (0x10, 70.0);  2: (0x11, 70.0);  else nothing
 * ```
 *
 * No entry of the shipped table is 2 (§8.3), so state 0x11 is never picked;
 * the arm is kept because the table is data.
 */
export function Boss4PickApproachAttack(obj: Actor, b: Blk,
                                        f: ClassFrame): void {
  if (b.phase === 3 || b.phase === 13) {
    b.w74 = Boss4State.ThrowHeldProp;
    b.f84 = THROW_RANGE;
    return;
  }
  if (obj.flags & ActorFlag.ShotImmune) {
    b.w74 = Boss4State.StrikeClip65;
    b.f84 = STRIKE65_RANGE;
    return;
  }
  const row = Boss4Tables().approach_picks[(b.rank << 24) >> 24] ?? [];
  let k = ((row[f.rng.int(PICK_COLUMNS)] ?? 0) << 24) >> 24;
  if (b.state === Boss4State.FaceCamera && k === 0) k = 1;
  if (k === 0) {
    b.w74 = Boss4State.StrikeClip65;
    b.f84 = STRIKE65_RANGE;
  } else if (k === 1) {
    b.w74 = Boss4State.StrikeClip7A;
    b.f84 = STRIKE7A_RANGE;
  } else if (k === 2) {
    b.w74 = Boss4State.StrikeClip7B;
    b.f84 = STRIKE7A_RANGE;
  }
}

// -- state 4 --------------------------------------------------------------

/**
 * `Boss4StateApproachCamera` — `FUN_00493DC0`. State 4.
 *
 * ```
 * sub 0: Boss4PickApproachAttack(obj)
 *        phase 2: unless 0x78 blend(0x78, 0, 10);  3, 13: unless 0x6B blend(0x6B, 0, 10)
 *        8, 17:   unless 0x6D blend(0x6D, 0, 3)
 *        else:    rand() & 1 ? unless 0x78 blend(0x78, 0, 10) : unless 0x6B blend(0x6B, 0, 10)
 *        sub = 1, and on into sub 1
 * sub 1: unless flag 8: turn(pos - eye, 0x200)
 *        |pos - eye| < state+0x84: state = (u8)state+0x74; sub 0; ActorPickTargetPlayer(obj)
 * ```
 *
 * The switch is `byte [0x00493F20 + phase - 2]` through `0x00493F10`.
 */
export function Boss4StateApproachCamera(obj: Actor, b: Blk,
                                         f: ClassFrame): void {
  // The gameplay eye, `g_camera_eye`, by address in the exe.
  const eye = G.g_camera_eye;
  if (b.sub === 0) {
    Boss4PickApproachAttack(obj, b, f);
    switch (b.phase) {
      case 2:
        Boss4BlendUnlessPlaying(obj, Boss4Clip.Walk78, 10);
        break;
      case 3:
      case 13:
        Boss4BlendUnlessPlaying(obj, Boss4Clip.Idle, 10);
        break;
      case 8:
      case 17:
        Boss4BlendUnlessPlaying(obj, Boss4Clip.Walk6D, 3);
        break;
      default:
        // `CALL rand; AND EAX, 1` -- `rand() % 2` for the non-negative
        // values `rand` returns.
        if (f.rng.int(2) !== 0) {
          Boss4BlendUnlessPlaying(obj, Boss4Clip.Walk78, 10);
        } else {
          Boss4BlendUnlessPlaying(obj, Boss4Clip.Idle, 10);
        }
    }
    b.sub = 1;
  } else if (b.sub !== 1) {
    return;
  }
  if (!(b.flags & Boss4Flag.Transition)) {
    ActorTurnTowardXZ(obj, obj.pos.x - eye.x, obj.pos.z - eye.z,
                      TURN_STEP);
  }
  if (Boss4DistanceXZ(obj, eye.x, eye.z) < b.f84) {
    Boss4Enter(b, b.w74 & 0xff);
    // `MOV byte ptr [obj+0x121], AL` inside the pick: whom the attack goes
    // for. The boss holds no permit by it -- see `Boss4Handler.onDeadSweep`.
    obj.attackPermit = ActorPickTargetPlayer(f.rng);
  }
}

// -- state 5 --------------------------------------------------------------

/** `[0x00570A5C]` 180.0 -- phase 3's approach-again distance. */
const PHASE3_APPROACH = 180.0;
/** `[0x005691C4]` 210.0 -- phase 3's exit distance. */
const PHASE3_EXIT = 210.0;
/** `[0x00570A54]` 155.0 -- phase 13's approach-again distance. */
const PHASE13_APPROACH = 155.0;
/** `[0x00570A58]` 120.0 -- the last phases' hold distance. */
const LAST_PHASE_HOLD = 120.0;
/** `[0x00570A50]` 90.0 -- the ordinary hold distance. */
const HOLD_DISTANCE = 90.0;
/** Phase 3's exit: state 9 turning to `(530.0, -1720.0)`, then state 0xB. */
const PHASE3_EXIT_TURN_X = 530.0;   // 0x44048000
const PHASE3_EXIT_TURN_Z = -1720.0; // 0xC4D70000

/**
 * `Boss4StateChooseAction` — `FUN_00494010`. State 5, where every attack ends.
 *
 * ```
 * sub 0: phases 8, 17: unless 0x6E blend(0x6E, 0, 3);  else unless 0x6C blend(0x6C, 0, 10)
 *        sub = 1, and on into sub 1
 * sub 1: turn(P0 - pos, 0x200);  d = |pos - eye|
 *        switch (byte [0x0049439C + phase - 3] through 0x0049438C)
 * ```
 *
 * The four arms are transcribed below. The floor test is
 * `FILD hp; FILD maxhp; FMUL frac[phase]; FCOMPP` -- "floor < hp".
 */
export function Boss4StateChooseAction(obj: Actor, b: Blk,
                                       _f: ClassFrame): void {
  // The gameplay eye, `g_camera_eye`, by address in the exe.
  const eye = G.g_camera_eye;
  if (b.sub === 0) {
    if (b.phase === 8 || b.phase === 17) {
      Boss4BlendUnlessPlaying(obj, Boss4Clip.ChooseLast, 3);
    } else {
      Boss4BlendUnlessPlaying(obj, Boss4Clip.Choose, 10);
    }
    b.sub = 1;
  } else if (b.sub !== 1) {
    return;
  }
  const p0 = b.arena[0];
  ActorTurnTowardXZ(obj, p0.x - obj.pos.x, p0.z - obj.pos.z, TURN_STEP);
  const d = Boss4DistanceXZ(obj, eye.x, eye.z);
  const floorBelow = Boss4PhaseFloor(obj.maxHp, b.phase) < obj.hp;

  switch (b.phase) {
    case 3:
      if (floorBelow && b.propsLeft !== 0) {
        if (d > PHASE3_APPROACH) Boss4Enter(b, Boss4State.ApproachCamera);
        return;
      }
      if (!(d > PHASE3_EXIT)) return;
      if (Boss4NoPlayerFree()) {
        Boss4Enter(b, Boss4State.HoldUntilPlayerFree);
        return;
      }
      Boss4Enter(b, Boss4State.TurnToStoredPoint);
      b.w74 = Boss4State.WalkToPoint;
      b.f84 = PHASE3_EXIT_TURN_X;
      b.f88 = PHASE3_EXIT_TURN_Z;
      b.phase += 1;
      b.flags &= ~Boss4Flag.Fenced;
      obj.flags |= ActorFlag.ShotImmune;
      return;
    case 13:
      if (floorBelow && b.propsLeft !== 0) {
        if (d > PHASE13_APPROACH) Boss4Enter(b, Boss4State.ApproachCamera);
        return;
      }
      if (Boss4NoPlayerFree()) {
        Boss4Enter(b, Boss4State.HoldUntilPlayerFree);
        return;
      }
      Boss4Enter(b, Boss4State.WithdrawAndAdvancePhase);
      return;
    case 8:
    case 17:
      if (d > LAST_PHASE_HOLD) {
        Boss4Enter(b, Boss4State.HoldThenApproach);
        b.w74 = 1;
      }
      return;
    default:
      if (b.flags & Boss4Flag.Transition) return;
      if (d > HOLD_DISTANCE) {
        Boss4Enter(b, Boss4State.HoldThenApproach);
        b.w74 = 1;
      }
  }
}

// -- state 6 --------------------------------------------------------------

/**
 * `Boss4StateHoldThenApproach` — `FUN_004943B0`. State 6: play the hold clip
 * `state+0x74 + 1` times over, then approach.
 *
 * ```
 * sub 0: phases 8, 17: unless 0x7D blend(0x7D, 0, 3); unless flag 8 PlaySoundId(0x271BA9)
 *        else:         unless 0x7C blend(0x7C, 0, 10); unless flag 8 PlaySoundId(0x231BA9)
 *        state+0x74--; sub = 1; return
 * sub 1: cursor != len - 1: return
 *        state+0x74 != 0: state+0x74--; return
 *        g_players_in_play <= 0: return;  flag 8: return
 *        state 4; sub 0
 * ```
 */
export function Boss4StateHoldThenApproach(obj: Actor, b: Blk,
                                           f: ClassFrame): void {
  if (b.sub === 0) {
    if (b.phase === 8 || b.phase === 17) {
      Boss4BlendUnlessPlaying(obj, Boss4Clip.HoldLast, 3);
      if (!(b.flags & Boss4Flag.Transition)) {
        f.events?.emit("sound.play", { id: Boss4Sound.Yarare3 });
      }
    } else {
      Boss4BlendUnlessPlaying(obj, Boss4Clip.Entrance, 10);
      if (!(b.flags & Boss4Flag.Transition)) {
        f.events?.emit("sound.play", { id: Boss4Sound.Hashiri });
      }
    }
    b.w74 -= 1;
    b.sub = 1;
    return;
  }
  if (b.sub !== 1) return;
  if (MotionPlayFrame(obj) !== MotionPlayLength(obj) - 1) return;
  if (b.w74 !== 0) {
    b.w74 -= 1;
    return;
  }
  if (G.g_players_in_play <= 0) return;
  if (b.flags & Boss4Flag.Transition) return;
  Boss4Enter(b, Boss4State.ApproachCamera);
}

// -- state 7 --------------------------------------------------------------

/** `CMP EAX, 0x800` on the heading error's absolute value. */
const FACE_TOLERANCE = 0x800;

/**
 * `Boss4StateFaceCamera` — `FUN_004944A0`. State 7: turn to the camera, and
 * once he faces it within `0x800` with the phase's `P1` ahead of him, pick an
 * attack and approach (straight into state 4's sub 1).
 *
 * ```
 * unless flag 8 or a fade running (char+0x37 & 1): turn(pos - eye, 0x100)
 * obj+0x34 & 0x10000: return
 * |err(pos - eye)| >= 0x800: return
 * !ActorPointIsAhead(obj, P1): return
 * Boss4PickApproachAttack(obj); state 4; sub 1
 * ```
 *
 * `char+0x37` bit 0 is the base track's fade, the port's `obj.fadeFrom`.
 */
export function Boss4StateFaceCamera(obj: Actor, b: Blk, f: ClassFrame): void {
  // The gameplay eye, `g_camera_eye`, by address in the exe.
  const eye = G.g_camera_eye;
  if (!(b.flags & Boss4Flag.Transition) && obj.fadeFrom === null) {
    ActorTurnTowardXZ(obj, obj.pos.x - eye.x, obj.pos.z - eye.z,
                      FACE_TURN_STEP);
  }
  if (obj.flags & ActorFlag.NoCameraTrack) return;
  const err = ActorHeadingErrorTo(obj, obj.pos.x - eye.x,
                                  obj.pos.z - eye.z);
  if (Math.abs(err) >= FACE_TOLERANCE) return;
  if (!ActorPointIsAhead(obj, b.arena[1])) return;
  Boss4PickApproachAttack(obj, b, f);
  b.state = Boss4State.ApproachCamera;
  b.sub = 1;
}

// -- state 8 --------------------------------------------------------------

/**
 * `Boss4StatePlayArrivalClip` — `FUN_004945A0`. State 8: `ActorSetMotion(0x72)`
 * -- a cut -- and, when the cursor reaches the play length **itself** (not
 * one short; the sampler's `% (len + 1)` lets it), `blend(0x78, 0, 10)`
 * unguarded and state 7.
 */
export function Boss4StatePlayArrivalClip(obj: Actor, b: Blk): void {
  if (b.sub === 0) {
    ActorSetMotion(obj, Boss4Clip.Arrival);
    b.sub = 1;
    return;
  }
  if (b.sub !== 1) return;
  if (MotionPlayFrame(obj) !== MotionPlayLength(obj)) return;
  ActorSetMotionBlended(obj, Boss4Clip.Walk78, 0, 10);
  Boss4Enter(b, Boss4State.FaceCamera);
}

// -- state 9 --------------------------------------------------------------

/** `CMP EAX, 0x7000` -- the heading error the exit wants to exceed. */
const TURN_POINT_BEHIND = 0x7000;

/**
 * `Boss4StateTurnToStoredPoint` — `FUN_00494610`. State 9: walk-turn toward
 * `(state+0x84, pos.y, state+0x88)` and leave for state `(u8)state+0x74`.
 *
 * ```
 * sub 0: unless 0x78 blend(0x78, 0, 10); sub = 1, and on into sub 1
 * sub 1: q = (state+0x84, pos.y, state+0x88); turn(pos - q, 0x200)
 *        |err(pos - q)| > 0x7000 && ActorPointIsAhead(obj, q): state = (u8)state+0x74; sub 0
 * ```
 *
 * The turn drives `pos - q` onto local +z, which puts `q` behind him; the
 * exit wants `q` both ahead **and** nearly opposite that offset. `[open]` how
 * often both hold at once, which is §8.8's question -- it is transcribed as it
 * is, not as it might have been meant.
 */
export function Boss4StateTurnToStoredPoint(obj: Actor, b: Blk): void {
  if (b.sub === 0) {
    Boss4BlendUnlessPlaying(obj, Boss4Clip.Walk78, 10);
    b.sub = 1;
  } else if (b.sub !== 1) {
    return;
  }
  const q = vec3(b.f84, obj.pos.y, b.f88);
  ActorTurnTowardXZ(obj, obj.pos.x - q.x, obj.pos.z - q.z, TURN_STEP);
  const err = ActorHeadingErrorTo(obj, obj.pos.x - q.x, obj.pos.z - q.z);
  if (Math.abs(err) > TURN_POINT_BEHIND && ActorPointIsAhead(obj, q)) {
    Boss4Enter(b, b.w74 & 0xff);
  }
}

// -- state 0xA ------------------------------------------------------------

/** The two depth-0 records under the root -- bone 1 (head, both arms) and bone 9 (both legs). */
const UPPER_RECORD = 1;
const LOWER_RECORD = 9;

const _vC = vec3();
const _vP = vec3();
const _z = vec3(0, 0, 1);

/**
 * `Boss4StateTurnClipThenApproach` — `FUN_00494730`. State 0xA: play the
 * turn clip `0x76`, then fold the heading it ended on into the actor's yaw
 * and counter-rotate the pose so nothing jumps.
 *
 * ```
 * sub 0: unless 0x76 blend(0x76, 0, 10); sub++
 * sub 1: cursor != len - 1: return
 *        char+0x20 = 0x6B; char+0x08 = 0                 -- written, no ActorSetMotion
 *        f  = MotionFrameAddress(type, 0x6B, 0)
 *        vC = (RotZ RotY RotX(f record 0) RotZ RotY RotX(f record 1)) * (0,0,1)
 *        vP = the same over the drawn records 0 and 1 (char+0x7C.., char+0x10C..)
 *        A = (s16)ftol(atan2(vP.x, vP.z) * k);  B = (s16)ftol(atan2(vC.x, vC.z) * k)
 *        obj+0x68 += A - B
 *        M = RotX(-r0x) RotY(-r0y) RotZ(-r0z) RotY(-(A-B)) RotZ(r0z) RotY(r0y) RotX(r0x)
 *        record 1 = MatrixToEulerZYX(M * RotZ RotY RotX(record 1)); record 9 likewise
 *        blend(0x6B, 0, 10); Boss4PickApproachAttack(obj); state 4; sub 1
 * ```
 *
 * The yaw turns the whole body by `A - B`; the two sub-trees under the root
 * are turned back by the same amount **in the root's frame**, so the drawn
 * pose is where it was -- and the blend then dissolves from it into the idle
 * facing the new way. The drawn records are the clip's frame at the cursor
 * (the port draws whole authored frames); the rewritten ones go to the
 * renderer as the fade snapshot's `records`, which is what the engine's
 * `ActorSetMotionBlended` copies them into.
 */
export function Boss4StateTurnClipThenApproach(obj: Actor, b: Blk,
                                               f: ClassFrame): void {
  if (b.sub === 0) {
    Boss4BlendUnlessPlaying(obj, Boss4Clip.Turn, 10);
    b.sub += 1;
    return;
  }
  if (b.sub !== 1) return;
  if (MotionPlayFrame(obj) !== MotionPlayLength(obj) - 1) return;

  // The pose last drawn: the turn clip at the cursor, before anything moves.
  const drawn = MotionFrameOf(obj, obj.motion, MotionPlayFrame(obj) >> 1);
  const idle = MotionFrameOf(obj, Boss4Clip.Idle, 0);
  if (drawn && idle) {
    const r0 = drawn.rot(0);
    const r1 = drawn.rot(UPPER_RECORD);
    const r9 = drawn.rot(LOWER_RECORD);
    HeadingOf(idle.rot(0), idle.rot(UPPER_RECORD), _vC);
    HeadingOf(r0, r1, _vP);
    const a = FtolS16(Math.atan2(_vP.x, _vP.z) * RADIANS_TO_BAMS);
    const bb = FtolS16(Math.atan2(_vC.x, _vC.z) * RADIANS_TO_BAMS);
    obj.yaw = (obj.yaw + (a - bb)) | 0;
    const m = MatIdentity();
    MatrixRotateX(m, -r0[0]);
    MatrixRotateY(m, -r0[1]);
    MatrixRotateZ(m, -r0[2]);
    MatrixRotateY(m, -(a - bb));
    MatrixRotateZ(m, r0[2]);
    MatrixRotateY(m, r0[1]);
    MatrixRotateX(m, r0[0]);
    const rec1 = Rebased(m, r1);
    const rec9 = Rebased(m, r9);
    // `char+0x20 = 0x6B; char+0x08 = 0` and then the blend: the port's
    // primitive snapshots `obj.motion` itself, so it is called on the turn
    // clip and the snapshot's two rewritten records attached after.
    ActorSetMotionBlended(obj, Boss4Clip.Idle, 0, 10);
    if (obj.fadeFrom) {
      obj.fadeFrom.records = [
        { record: UPPER_RECORD, rot: rec1 },
        { record: LOWER_RECORD, rot: rec9 },
      ];
    }
  } else {
    // A bundle without the clips: the clip change alone, as the blend is.
    ActorSetMotionBlended(obj, Boss4Clip.Idle, 0, 10);
  }
  Boss4PickApproachAttack(obj, b, f);
  b.state = Boss4State.ApproachCamera;
  b.sub = 1;
}

/** `RotZ RotY RotX(r0) RotZ RotY RotX(r1) * (0, 0, 1)`, into `out`. */
function HeadingOf(r0: [number, number, number], r1: [number, number, number],
                   out: typeof _vC): void {
  const m = MatIdentity();
  MatrixRotateZ(m, r0[2]);
  MatrixRotateY(m, r0[1]);
  MatrixRotateX(m, r0[0]);
  MatrixRotateZ(m, r1[2]);
  MatrixRotateY(m, r1[1]);
  MatrixRotateX(m, r1[0]);
  MatrixTransformVector(m, _z, out);
}

/** `Push; RotZ RotY RotX(r); FUN_004019E0 -> (rx, ry, rz); Pop` on `m`. */
function Rebased(m: Mat, r: [number, number, number]):
    [number, number, number] {
  const t = MatCopy(MatIdentity(), m);
  MatrixRotateZ(t, r[2]);
  MatrixRotateY(t, r[1]);
  MatrixRotateX(t, r[0]);
  const e = MatrixToEulerZYX(t);
  return [e.rx, e.ry, e.rz];
}

// -- state 0xB ------------------------------------------------------------

/** `[0x00570A60]`, `[0x00570A64]` -- where phase 3's exit walks to. */
const WALK_TO_X = 535.0;
const WALK_TO_Z = -1900.0;
/** `[0x004C4C8C]` 20.0 -- close enough. */
const WALK_ARRIVE = 20.0;
/** `[0x00570A48]` 150.0 -- the chainsaw starts again this near the camera. */
const CHAINSAW_NEAR = 150.0;

/**
 * `Boss4StateWalkToPoint` — `FUN_004958F0`. State 0xB, phase 4's walk off
 * after phase 3's throw.
 *
 * ```
 * sub 0: obj+0x34 |= 0x10000; unless 0x6B blend(0x6B, 0, 10); flags &= ~0x10
 *        Boss4ChainsawOff(); sub++, and on into sub 1
 * sub 1: turn(pos - (535, -1900), 0x200)
 *        |pos - (535, -1900)| < 20: Boss4QueueCameraCue(phase); flags |= 8
 *        !(flags & 0x10) && |pos - eye| < 150: flags |= 0x10; Boss4ChainsawOn()
 * ```
 */
export function Boss4StateWalkToPoint(obj: Actor, b: Blk, f: ClassFrame): void {
  // The gameplay eye, `g_camera_eye`, by address in the exe.
  const eye = G.g_camera_eye;
  if (b.sub === 0) {
    obj.flags |= ActorFlag.NoCameraTrack;
    Boss4BlendUnlessPlaying(obj, Boss4Clip.Idle, 10);
    b.flags &= ~Boss4Flag.Footfalls;
    Boss4ChainsawOff(b, f.events);
    b.sub += 1;
  } else if (b.sub !== 1) {
    return;
  }
  ActorTurnTowardXZ(obj, obj.pos.x - WALK_TO_X, obj.pos.z - WALK_TO_Z,
                    TURN_STEP);
  if (Boss4DistanceXZ(obj, WALK_TO_X, WALK_TO_Z) < WALK_ARRIVE) {
    Boss4QueueCameraCue(b, b.phase);
    b.flags |= Boss4Flag.Transition;
  }
  if (!(b.flags & Boss4Flag.Footfalls)
      && Boss4DistanceXZ(obj, eye.x, eye.z) < CHAINSAW_NEAR) {
    b.flags |= Boss4Flag.Footfalls;
    Boss4ChainsawOn(b, f.events);
  }
}

// -- state 0xC ------------------------------------------------------------

/** `[0x00570A74]` 95.0, `[0x00570A70]` 105.0, `[0x004C43B0]` 100.0. */
const WITHDRAW_NEAR = 95.0;
const WITHDRAW_FAR = 105.0;
const WITHDRAW_MID = 100.0;
/** `0xC3820000`, `0xC4F8C000` -- where the withdraw turns to, `(-260, -1990)`. */
const WITHDRAW_TURN_X = -260.0;
const WITHDRAW_TURN_Z = -1990.0;

/**
 * `Boss4StateWithdrawAndAdvancePhase` — `FUN_00495A20`. State 0xC, the end of
 * phase 13: get to about 100 from the camera, advance the phase, then turn
 * away and freeze until the arena seats him for phase 14.
 *
 * ```
 * advance := flags &= ~2; obj+0x34 |= 0x100; phase++; Boss4QueueCameraCue(phase); flags |= 8
 * sub 0: d = |pos - eye|
 *        d < 95:        unless 0x6C blend(0x6C, 0, 10); sub 2
 *        d > 105:       unless 0x6B blend(0x6B, 0, 10); sub 1
 *        else:          unless 0x6B blend(0x6B, 0, 10); sub 3; advance
 * sub 1: turn(pos - eye, 0x200);  d < 100: sub 3; advance
 * sub 2: turn(P0 - pos, 0x200);   d > 100: unless 0x6B blend(0x6B, 0, 10); sub 3; advance
 * sub 3: !(obj+0x34 & 0x10000) && !Boss4KeepInsideEdge(pos, P4, P5, 0, 0): obj+0x34 |= 0x10000
 *        q = (-260, pos.y, -1990); turn(pos - q, 0x200)
 *        ActorPointIsAhead(obj, q): obj+0x34 |= 0x4000; sub 4
 * ```
 *
 * Jump table `0x00495D20`, subs 0..3; sub 4 does nothing -- the pose is
 * frozen, and `Boss4AdvanceArenaWaypoint`'s phase-14 arm thaws it.
 */
export function Boss4StateWithdrawAndAdvancePhase(obj: Actor, b: Blk,
                                                  _f: ClassFrame): void {
  // The gameplay eye, `g_camera_eye`, by address in the exe.
  const eye = G.g_camera_eye;
  const advance = (): void => {
    b.flags &= ~Boss4Flag.Fenced;
    obj.flags |= ActorFlag.ShotImmune;
    b.phase += 1;
    Boss4QueueCameraCue(b, b.phase);
    b.flags |= Boss4Flag.Transition;
  };
  switch (b.sub) {
    case 0: {
      const d = Boss4DistanceXZ(obj, eye.x, eye.z);
      if (d < WITHDRAW_NEAR) {
        Boss4BlendUnlessPlaying(obj, Boss4Clip.Choose, 10);
        b.sub = 2;
      } else if (d > WITHDRAW_FAR) {
        Boss4BlendUnlessPlaying(obj, Boss4Clip.Idle, 10);
        b.sub = 1;
      } else {
        Boss4BlendUnlessPlaying(obj, Boss4Clip.Idle, 10);
        b.sub = 3;
        advance();
      }
      return;
    }
    case 1:
      ActorTurnTowardXZ(obj, obj.pos.x - eye.x, obj.pos.z - eye.z,
                        TURN_STEP);
      if (Boss4DistanceXZ(obj, eye.x, eye.z) < WITHDRAW_MID) {
        b.sub = 3;
        advance();
      }
      return;
    case 2: {
      const p0 = b.arena[0];
      ActorTurnTowardXZ(obj, p0.x - obj.pos.x, p0.z - obj.pos.z, TURN_STEP);
      if (Boss4DistanceXZ(obj, eye.x, eye.z) > WITHDRAW_MID) {
        Boss4BlendUnlessPlaying(obj, Boss4Clip.Idle, 10);
        b.sub = 3;
        advance();
      }
      return;
    }
    case 3: {
      if (!(obj.flags & ActorFlag.NoCameraTrack)
          && !Boss4KeepInsideEdge(obj.pos, b.arena[4], b.arena[5], 0, false)) {
        obj.flags |= ActorFlag.NoCameraTrack;
      }
      const q = vec3(WITHDRAW_TURN_X, obj.pos.y, WITHDRAW_TURN_Z);
      ActorTurnTowardXZ(obj, obj.pos.x - q.x, obj.pos.z - q.z, TURN_STEP);
      if (ActorPointIsAhead(obj, q)) {
        obj.flags |= ActorFlag.PoseFrozen;
        b.sub += 1;
      }
      return;
    }
    default:
  }
}

// -- states 0xD and 0xE ---------------------------------------------------

/**
 * `Boss4StateWaitForPlayer` — `FUN_00495D30`. State 0xD, where
 * `Boss4ResumeAfterHit` parks the boss while nobody is in play:
 * `unless 0x7C blend(0x7C, 0, 10); PlaySoundId(0x231BA9)`, then with a player
 * in play it tail-jumps (`JMP 0x004952A0`) to `Boss4ResumeAfterHit`.
 */
export function Boss4StateWaitForPlayer(obj: Actor, b: Blk,
                                        f: ClassFrame): void {
  if (b.sub === 0) {
    Boss4BlendUnlessPlaying(obj, Boss4Clip.Entrance, 10);
    f.events?.emit("sound.play", { id: Boss4Sound.Hashiri });
    b.sub += 1;
    return;
  }
  if (b.sub !== 1) return;
  if (G.g_players_in_play <= 0) return;
  Boss4ResumeAfterHit(obj, b, f);
}

/**
 * `Boss4StateHoldUntilPlayerFree` — `FUN_00495D90`. State 0xE, the phase-3 and
 * phase-13 exits' wait: sub 0 as 0xD's; sub 1 holds while
 * {@link Boss4NoPlayerFree}, then state 5.
 */
export function Boss4StateHoldUntilPlayerFree(obj: Actor, b: Blk,
                                              f: ClassFrame): void {
  if (b.sub === 0) {
    Boss4BlendUnlessPlaying(obj, Boss4Clip.Entrance, 10);
    f.events?.emit("sound.play", { id: Boss4Sound.Hashiri });
    b.sub += 1;
    return;
  }
  if (b.sub !== 1) return;
  if (Boss4NoPlayerFree()) return;
  Boss4Enter(b, Boss4State.ChooseAction);
}

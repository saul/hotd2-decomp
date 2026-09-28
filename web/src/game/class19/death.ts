/**
 * Class 0x19's reactions and death -- states `0x14`, `0x15`, `0x16`, the way
 * back out of a reaction, the unreachable debug state -- and the only writer
 * of `g_script_flags[32]` in the game.
 *
 * `Boss4StateDeath` (`FUN_00495770`) is the second half of every one of the
 * eight gates this class holds: `wait_script_flag 32` is the instruction
 * immediately after the fight in blocks 23, 25, 27 and 29, and
 * `MOV byte ptr [0x009c7220], 0x1` at `0x004958C7` is what releases it. It
 * lands on **clip frame 0x46**, not on the frame the hit points ran out and
 * not on the end of the clip -- the body is still falling when the script is
 * let go.
 */
import type { Actor } from "../actor";
import { ActorFlag } from "../actor";
import { ActorShiftToHoldBone1Position } from "../actor_pose";
import { ActorTurnTowardXZ } from "../actor_turn";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { G } from "../globals";
import { FtolS16, RADIANS_TO_BAMS } from "../matrix";
import type { ClassFrame } from "../registry";
import { MotionPlayFrame, MotionPlayLength } from "../tables";
import { Boss4QueueCameraCue } from "./camera";
import { Boss4ChainsawOff } from "./frame";
import {
  BOSS4_CAMERA_RISE, Boss4Clip, Boss4Enter, Boss4Flag, Boss4Sound, Boss4State,
} from "./state";
import type { Boss4Block as Blk } from "./state";

/**
 * `g_script_flags` — `0x009C7200`, index 32.
 *
 * Four `wait_script_flag 32` gates, all in stage 4: blocks 23, 25, 27 and 29,
 * one each. One writer in the whole image, `0x004958C7`.
 */
export const BOSS4_DEAD_FLAG = 32;

/** The dwell the death state latches -- `MOV [EAX + 0x74], 0xF0`. Four seconds. */
export const BOSS4_DEATH_DWELL = 0xf0;

/** The clip frame the flag lands on -- `SUB EAX, 0x46` at `0x0049580B`. */
const DEATH_FLAG_FRAME = 0x46;

/** The clip frame the body lands on -- `SUB EAX, 0x3C` after it, so 0x82. */
const DEATH_LAND_FRAME = 0x82;

/** `MOV dword ptr [0x009c8e8c], 0x32` -- the landing's shake. */
const DEATH_LAND_SHAKE = 0x32;

/**
 * Where the body is put on frame 0x46, and which way it faces: phase 8 (the
 * first arena's last) at `(270.0, 42.6, -1789.4)` facing 0, anything else at
 * `(-515.1, 42.6, -1718.4)` facing `0x8000` -- the words `43870000 422A6666
 * C4DFACCD` and `C400C666 422A6666 C4D6CCCD`, stored as they are.
 */
const DEATH_SPOT_ARENA_1 = {
  x: Math.fround(270.0), y: Math.fround(42.6), z: Math.fround(-1789.4), yaw: 0,
};
const DEATH_SPOT_ARENA_2 = {
  x: Math.fround(-515.1), y: Math.fround(42.6), z: Math.fround(-1718.4),
  yaw: 0x8000,
};

/**
 * `Boss4StateDeath` — `FUN_00495770`. State `0x16`.
 *
 * ```
 * sub 0: blend(0x69, 0, 10); flags &= ~2; state+0x74 = 0xF0; PlaySoundId(0x241BA9)
 *        g_boss_engaged = 0; sub++, and on into sub 1
 * sub 1: cursor == len - 1: obj+0x34 |= 0x4000; sub++
 *        cursor == 0x46:    the spot and the facing; obj+0x34 |= 0x10000; flags &= ~0x10
 *                           g_script_flags[32] = 1
 *        cursor == 0x82:    PlaySoundId(0xB16A9); Boss4ChainsawOff(); g_screen_shake_frames = 0x32
 * sub 2: state+0x74--
 * every sub: state+0x74 == 0: g_enemies_present--
 * ```
 */
export function Boss4StateDeath(obj: Actor, b: Blk, f: ClassFrame): void {
  if (b.sub === 0) {
    ActorSetMotionBlended(obj, Boss4Clip.Die, 0, 10);
    b.flags &= ~Boss4Flag.Fenced;
    b.w74 = BOSS4_DEATH_DWELL;
    f.events?.emit("sound.play", { id: Boss4Sound.Taore });
    // `MOV byte ptr [0x009CA0EA], 0` -- the byte the entrance raised.
    G.g_boss_engaged = 0;
    b.sub += 1;
  } else if (b.sub !== 1) {
    if (b.sub === 2) b.w74 -= 1;
    Boss4DeathRetire(b);
    return;
  }

  const frame = MotionPlayFrame(obj);
  if (frame === MotionPlayLength(obj) - 1) {
    // `OR dword ptr [ESI + 0x34], 0x4000` -- the pose freezes on the last
    // frame, which is what leaves a body on the floor rather than a loop.
    obj.flags |= ActorFlag.PoseFrozen;
    b.sub += 1;
  } else if (frame === DEATH_FLAG_FRAME) {
    const spot = b.phase === 8 ? DEATH_SPOT_ARENA_1 : DEATH_SPOT_ARENA_2;
    obj.pos.x = spot.x;
    obj.pos.y = spot.y;
    obj.pos.z = spot.z;
    obj.yaw = spot.yaw;
    obj.flags |= ActorFlag.NoCameraTrack;
    b.flags &= ~Boss4Flag.Footfalls;
    // `MOV byte ptr [0x009c7220], 0x1` at `0x004958C7`. **This is the gate.**
    G.g_script_flags[BOSS4_DEAD_FLAG] = 1;
  } else if (frame === DEATH_LAND_FRAME) {
    f.events?.emit("sound.play", { id: Boss4Sound.Bomb });
    Boss4ChainsawOff(b, f.events);
    G.g_screen_shake_frames = DEATH_LAND_SHAKE;
  }
  Boss4DeathRetire(b);
}

/**
 * The tail every path of `Boss4StateDeath` falls into, at `0x004958CE`:
 * `if (state+0x74 == 0) g_enemies_present--` -- an equality, so the count
 * drops on exactly one frame of the dwell, which is why only sub 2 steps it.
 */
function Boss4DeathRetire(b: Blk): void {
  if (b.w74 === 0) G.g_enemies_present -= 1;
}

/**
 * `Boss4StateFlinch` — `FUN_00495340`. State `0x14`, a head hit with a foot
 * down.
 *
 * ```
 * sub 0: saved == 7: state+0x74 = char+0x20; blend(phase == 3 ? 0x73 : 0x6F, 0, 10)
 *        else:       state+0x70 = 6.0; blend(0x73, 0, 10)
 *        PlaySoundId(0x281BA9); sub++, and on into sub 1
 * sub 1: saved != 0x13: char+0x20 == 0x6F ? turn(pos - eye, 0x200) : turn(P0 - pos, 0x200)
 *        cursor == len - 1: the switch below; obj+0x34 &= ~0x40000000
 * ```
 *
 * The switch is `byte [0x0049555C + saved - 6]` through `0x0049553C`, read
 * from memory: 6 -> state 4; 7 -> blend(state+0x74, 0, 10), state 7; 8 ->
 * blend(0x78, 0, 10), state 7; 9 -> phase 13 ? state 4 : **nothing**; 0xA ->
 * state 4; 0xB..0xE and anything outside 6..0x13 -> back to the saved state;
 * 0xF..0x12 -> state 5; 0x13 -> `Boss4ResumeAfterHit`. Each arm but 0x13
 * writes sub 0; case 9 in another phase writes neither, which leaves the boss
 * in the flinch with its clip finished and the tail running again next frame.
 */
export function Boss4StateFlinch(obj: Actor, b: Blk, f: ClassFrame): void {
  // The gameplay eye, `g_camera_eye`, by address in the exe.
  const eye = G.g_camera_eye;
  if (b.sub === 0) {
    if (b.savedState === Boss4State.FaceCamera) {
      // `MOV [EAX + 0x74], char+0x20` -- the clip to put back afterwards.
      b.w74 = obj.motion;
      ActorSetMotionBlended(obj, b.phase === 3
        ? Boss4Clip.Flinch : Boss4Clip.FlinchIdle, 0, 10);
    } else {
      b.cameraRise = BOSS4_CAMERA_RISE;
      ActorSetMotionBlended(obj, Boss4Clip.Flinch, 0, 10);
    }
    f.events?.emit("sound.play", { id: Boss4Sound.Yarare4 });
    b.sub += 1;
  } else if (b.sub !== 1) {
    return;
  }

  if (b.savedState !== Boss4State.ChargePastCamera) {
    if (obj.motion === Boss4Clip.FlinchIdle) {
      ActorTurnTowardXZ(obj, obj.pos.x - eye.x, obj.pos.z - eye.z, 0x200);
    } else {
      const p0 = b.arena[0];
      ActorTurnTowardXZ(obj, p0.x - obj.pos.x, p0.z - obj.pos.z, 0x200);
    }
  }

  if (MotionPlayFrame(obj) !== MotionPlayLength(obj) - 1) return;

  switch (b.savedState) {
    case Boss4State.HoldThenApproach:        // 6
    case Boss4State.TurnClipThenApproach:    // 0xA
      Boss4Enter(b, Boss4State.ApproachCamera);
      break;
    case Boss4State.FaceCamera:              // 7
      ActorSetMotionBlended(obj, b.w74, 0, 10);
      Boss4Enter(b, Boss4State.FaceCamera);
      break;
    case Boss4State.PlayArrivalClip:         // 8
      ActorSetMotionBlended(obj, Boss4Clip.Walk78, 0, 10);
      Boss4Enter(b, Boss4State.FaceCamera);
      break;
    case Boss4State.TurnToStoredPoint:       // 9
      if (b.phase === 13) Boss4Enter(b, Boss4State.ApproachCamera);
      break;
    case Boss4State.StrikeClip65:
    case Boss4State.StrikeClip7A:
    case Boss4State.StrikeClip7B:
    case Boss4State.ThrowHeldProp:           // 0xF..0x12
      Boss4Enter(b, Boss4State.ChooseAction);
      break;
    case Boss4State.ChargePastCamera:        // 0x13
      Boss4ResumeAfterHit(obj, b, f);
      break;
    default:
      Boss4Enter(b, b.savedState);
      break;
  }
  obj.flags &= ~ActorFlag.Reacting;
}

/** `[0x004C4D10]` 0.3 -- the knock-down's push away from the camera. */
const KNOCK_PUSH = Math.fround(0.3);
/** `[0x004E30F0]` 2.0 -- and its drop. */
const KNOCK_DROP = 2.0;
/** `0xBD5F0123` -- its gravity. */
const KNOCK_GRAVITY = -0.054444443434476852;
/** The clip frame the fall's pose freezes on -- `CMP [EDX + 0x8], 0x19`. */
const KNOCK_FREEZE_FRAME = 0x19;
/** `[0x004C4370]` -- radians per BAMS, the angles' way back. */
const BAMS_TO_RADIANS = Math.PI / 0x8000;

/**
 * `Boss4StateKnockDown` — `FUN_00495570`. State `0x15`, a head hit with both
 * feet in the air: he is thrown back and down, away from the camera.
 *
 * ```
 * sub 0: state+0x70 = 6.0; char+0x20 = 0x71; char+0x08 = 0
 *        ActorShiftToHoldBone1Position(obj); blend(0x71, 0, 10)
 *        d = pos - eye;  pitch = (s16)ftol(atan2(d.y, |d.xz|) * k);  yaw = (s16)ftol(atan2(d.x, d.z) * k)
 *        vel = (sin yaw cos pitch * 0.3, sin pitch * 0.3 - 2.0, cos yaw cos pitch * 0.3)
 *        obj+0x5C = -0.0544; PlaySoundId(0x281BA9); sub++, and on into sub 1
 * sub 1: pos += vel; vel.y += obj+0x5C
 *        cursor == 0x19: obj+0x34 |= 0x4000
 *        pos.y < g_camera_fixed_eye_y: obj+0x34 &= ~0x4000; pos.y = g_camera_fixed_eye_y; sub++
 * sub 2: cursor == len - 1: Boss4ResumeAfterHit(); obj+0x34 &= ~0x40000000
 * ```
 *
 * The clip is written before the shift so that the shift reads clip 0x71's
 * frame 0; the port's blend snapshots `obj.motion` itself, so it runs first
 * and the shift after it, which reads the same clip and frame.
 */
export function Boss4StateKnockDown(obj: Actor, b: Blk, f: ClassFrame): void {
  // The gameplay eye, `g_camera_eye`, by address in the exe.
  const eye = G.g_camera_eye;
  if (b.sub === 0) {
    b.cameraRise = BOSS4_CAMERA_RISE;
    ActorSetMotionBlended(obj, Boss4Clip.KnockDown, 0, 10);
    ActorShiftToHoldBone1Position(obj, f.host);
    const dx = Math.fround(obj.pos.x - eye.x);
    const dy = Math.fround(obj.pos.y - eye.y);
    const dz = Math.fround(obj.pos.z - eye.z);
    const pitch = FtolS16(Math.atan2(dy, Math.sqrt(dz * dz + dx * dx))
                          * RADIANS_TO_BAMS);
    const yaw = FtolS16(Math.atan2(dx, dz) * RADIANS_TO_BAMS);
    const yr = yaw * BAMS_TO_RADIANS;
    const pr = pitch * BAMS_TO_RADIANS;
    const cp = Math.fround(Math.cos(pr));
    obj.vel.x = Math.fround(Math.sin(yr) * cp * KNOCK_PUSH);
    obj.vel.y = Math.fround(Math.sin(pr) * KNOCK_PUSH - KNOCK_DROP);
    obj.vel.z = Math.fround(Math.cos(yr) * cp * KNOCK_PUSH);
    obj.accY = KNOCK_GRAVITY;
    f.events?.emit("sound.play", { id: Boss4Sound.Yarare4 });
    b.sub += 1;
  }
  if (b.sub === 1) {
    obj.pos.x = Math.fround(obj.vel.x + obj.pos.x);
    obj.pos.y = Math.fround(obj.vel.y + obj.pos.y);
    obj.pos.z = Math.fround(obj.vel.z + obj.pos.z);
    obj.vel.y = Math.fround(obj.accY + obj.vel.y);
    if (MotionPlayFrame(obj) === KNOCK_FREEZE_FRAME) {
      obj.flags |= ActorFlag.PoseFrozen;
    }
    if (obj.pos.y < G.g_camera_fixed_eye_y) {
      obj.flags &= ~ActorFlag.PoseFrozen;
      obj.pos.y = G.g_camera_fixed_eye_y;
      b.sub += 1;
    }
    return;
  }
  if (b.sub !== 2) return;
  if (MotionPlayFrame(obj) !== MotionPlayLength(obj) - 1) return;
  Boss4ResumeAfterHit(obj, b, f);
  obj.flags &= ~ActorFlag.Reacting;
}

/**
 * `Boss4ResumeAfterHit` — `FUN_004952A0`. Leave a reaction.
 *
 * With no player in play the boss parks in state `0x0D`. Otherwise the phases
 * that end in a charge queue their cue again -- `Boss4QueueCameraCue` with
 * `0x12`, `0x13`, `0x14`, `0x15` for phases 5, 7, 11, 16 (bytes
 * `0x00495334[phase - 5]` through `0x00495320`, read from memory) -- then
 * `blend(0x6B, 0, 10)`, unguarded, and state 7.
 */
export function Boss4ResumeAfterHit(obj: Actor, b: Blk, f: ClassFrame): void {
  void f;
  if (G.g_players_in_play <= 0) {
    Boss4Enter(b, Boss4State.WaitForPlayer);
    return;
  }
  const cue = RESUME_CUES[b.phase];
  if (cue !== undefined) Boss4QueueCameraCue(b, cue);
  ActorSetMotionBlended(obj, Boss4Clip.Idle, 0, 10);
  Boss4Enter(b, Boss4State.FaceCamera);
}

/** `0x00495334`'s arms: the cue each charging phase replays. */
const RESUME_CUES: Readonly<Record<number, number>> = {
  5: 0x12, 7: 0x13, 11: 0x14, 16: 0x15,
};

/** `[0x004D1D24]` -- the debug state's step, 0.2. */
const DEBUG_STEP = Math.fround(0.2);

/**
 * `Boss4StateDebugFreeMove` — `FUN_00495E20`. State `0x17`, which **nothing
 * enters**: sub 0 `blend(0x7C, 0, 10)`; then with `g_pad_held` bit 8 held,
 * bits `0x10`/`0x20` move z by +/-0.2 and `0x40`/`0x80` x by -/+0.2 (the
 * second pair's `else if`, the first's too). Transcribed because it is in the
 * dispatch table; the port feeds `g_pad_held` nothing, so it would stand
 * still.
 */
export function Boss4StateDebugFreeMove(obj: Actor, b: Blk): void {
  if (b.sub === 0) {
    ActorSetMotionBlended(obj, Boss4Clip.Entrance, 0, 10);
    b.sub += 1;
  } else if (b.sub !== 1) {
    return;
  }
  const pad = G.g_pad_held;
  if (!(pad & 0x08)) return;
  if (pad & 0x10) obj.pos.z = Math.fround(obj.pos.z + DEBUG_STEP);
  else if (pad & 0x20) obj.pos.z = Math.fround(obj.pos.z - DEBUG_STEP);
  if (pad & 0x40) obj.pos.x = Math.fround(obj.pos.x - DEBUG_STEP);
  else if (pad & 0x80) obj.pos.x = Math.fround(obj.pos.x + DEBUG_STEP);
}

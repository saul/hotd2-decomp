/**
 * The arena -- how the stage-4 boss's fight moves from one phase to the next.
 *
 * The fight is nine **phases** per arena, 0..8 on camera path 185 (entrances
 * 0 and 2) and 9..17 on path 193 (entrances 1 and 3). A phase ends when the
 * hit points reach its floor (`g_boss4_phase_hp_fraction`); then the boss
 * plays a camera move itself (`class19/camera.ts`) and, when the camera's
 * frame passes the phase's threshold, is seated at the next spot with the
 * next phase's six arena points loaded. He is damageable again once he is five
 * units inside the new quad, tracked by the camera once he is inside two of
 * its edges, and fenced in from then on.
 *
 * Every number here is `.text` -- thresholds, seats, headings -- except the
 * arena points, which are `g_boss4_phase_arenas` and come from the bundle.
 * `docs/re/boss-strength.md` §7 has the reading.
 */
import type { Actor } from "../actor";
import { ActorFlag } from "../actor";
import { ActorPointIsAhead } from "../actor_turn";
import { ActorSetMotion, ActorSetMotionBlended } from "../class30/motion_cue";
import { G } from "../globals";
import { Boss4QueueCameraCue } from "./camera";
import {
  Boss4Clip, Boss4Flag, Boss4PhaseFloor, Boss4State, Boss4Tables,
} from "./state";
import type { Boss4Block as Blk } from "./state";
import type { Vec3 } from "../vec";

/**
 * `Boss4LoadPhaseArena` — `FUN_004932C0`. The phase's six points into
 * `state+0x28`..`+0x6F`, each `(x, pos.y, z)`, and flags `0x60` raised -- the
 * two arm-when-inside checks below.
 */
export function Boss4LoadPhaseArena(obj: Actor, b: Blk): void {
  const pts = Boss4Tables().phase_arenas[b.phase] ?? [];
  for (let i = 0; i < 6; i++) {
    const p = pts[i] ?? [0, 0];
    b.arena[i].x = p[0];
    b.arena[i].y = obj.pos.y;
    b.arena[i].z = p[1];
  }
  b.flags |= Boss4Flag.TrackPending | Boss4Flag.ArmPending;
}

/**
 * `Boss4KeepInsideEdge` — `FUN_00493330`. `(pos, a, b, margin, push)`, all
 * in x/z. Answers 1 when the position is on the inner side of the line `a->b`
 * and at least `margin` from it; otherwise 0, and with `push` it moves the
 * position there:
 *
 * ```
 * t = (b-a).(p-a) / |b-a|^2;  e = t(b-a) - (p-a);  d = |e|
 * d == 0:  margin == 0 -> 1; !push -> 0; else x += sign(bz)m, z -= sign(bx)m; 0
 * cross(b-a, p-a) < 0 (outside):  push -> p += e(d+m)/d;  0
 * d < margin (inside, too close):  push -> p += e(d-m)/d;  0
 * otherwise 1
 * ```
 *
 * Class 0x14's `Class14FollowSegment` (`FUN_00477CD0`) is the same geometry
 * without the push flag; the exe has two functions, and so does the port.
 * The values the exe stores and reloads as floats -- the edge, the foot
 * vector and its length -- are rounded where it rounds them.
 */
export function Boss4KeepInsideEdge(p: Vec3, a: Vec3, bPt: Vec3,
                                    margin: number, push: boolean): boolean {
  const px = p.x - a.x;
  const pz = p.z - a.z;
  const bx = Math.fround(bPt.x - a.x);
  const bz = Math.fround(bPt.z - a.z);
  const t = (bz * pz + bx * px) / (bz * bz + bx * bx);
  const ex = Math.fround(t * bx - px);
  const ez = Math.fround(t * bz - pz);
  const d = Math.fround(Math.sqrt(ez * ez + ex * ex));
  if (d === 0) {
    if (margin === 0) return true;
    if (!push) return false;
    if (bz !== 0) p.x = Math.fround(p.x + (bz / Math.abs(bz)) * margin);
    if (bx !== 0) p.z = Math.fround(p.z - (bx / Math.abs(bx)) * margin);
    return false;
  }
  let s: number;
  if (bz * px - bx * pz < 0) {
    s = d + margin;
  } else if (d < margin) {
    s = d - margin;
  } else {
    return true;
  }
  if (push) {
    p.x = Math.fround(p.x + (s * ex) / d);
    p.z = Math.fround(p.z + (s * ez) / d);
  }
  return false;
}

/** The fence's margin, `PUSH 0x40A00000` in `Boss4Update` -- 5.0. */
export const FENCE_MARGIN = 5;

/**
 * `Boss4TrackWhenInsideArena` — `FUN_004922C0`. After a seat the boss is off
 * the camera's tracking (`obj+0x34` bit `0x10000`); this puts him back once
 * he is inside two of the new quad's edges.
 *
 * ```
 * if (!(flags & 0x20)) return
 * if (!(obj+0x34 & 0x10000)) { flags &= ~0x20; return }
 * if (flags & 8) return;  if (state == 0x13) return
 * if (!KeepInsideEdge(pos, P2, P3, 0.0, 0)) return
 * if (!KeepInsideEdge(pos, P4, P5, 0.0, 0)) return
 * obj+0x34 &= ~0x10000; flags &= ~0x20
 * ```
 */
export function Boss4TrackWhenInsideArena(obj: Actor, b: Blk): void {
  if (!(b.flags & Boss4Flag.TrackPending)) return;
  if (!(obj.flags & ActorFlag.NoCameraTrack)) {
    b.flags &= ~Boss4Flag.TrackPending;
    return;
  }
  if (b.flags & Boss4Flag.Transition) return;
  if (b.state === Boss4State.ChargePastCamera) return;
  const a = b.arena;
  if (!Boss4KeepInsideEdge(obj.pos, a[2], a[3], 0, false)) return;
  if (!Boss4KeepInsideEdge(obj.pos, a[4], a[5], 0, false)) return;
  obj.flags &= ~ActorFlag.NoCameraTrack;
  b.flags &= ~Boss4Flag.TrackPending;
}

/**
 * `Boss4ArmPhaseWhenInsideArena` — `FUN_00492350`. Lifts the phase floor's
 * shot-immunity and seats the new floor once the boss is five inside three of
 * the quad's edges -- or at once when he is already fenced.
 *
 * ```
 * if (!(flags & 0x40)) return
 * if (!(flags & 2)) {
 *     if (!KeepInsideEdge(pos, P2, P3, 5.0, 0)) return   (and P3->P4, P4->P5)
 *     obj+0x34 &= ~0x100; state+0x24 = floor; flags |= 2; flags &= ~0x40; return
 * }
 * obj+0x34 &= ~0x100; state+0x24 = floor; flags &= ~0x40
 * ```
 */
export function Boss4ArmPhaseWhenInsideArena(obj: Actor, b: Blk): void {
  if (!(b.flags & Boss4Flag.ArmPending)) return;
  if (!(b.flags & Boss4Flag.Fenced)) {
    const a = b.arena;
    if (!Boss4KeepInsideEdge(obj.pos, a[2], a[3], FENCE_MARGIN, false)) return;
    if (!Boss4KeepInsideEdge(obj.pos, a[3], a[4], FENCE_MARGIN, false)) return;
    if (!Boss4KeepInsideEdge(obj.pos, a[4], a[5], FENCE_MARGIN, false)) return;
    obj.flags &= ~ActorFlag.ShotImmune;
    b.phaseHpFloor = Boss4PhaseFloor(obj.maxHp, b.phase);
    b.flags |= Boss4Flag.Fenced;
    b.flags &= ~Boss4Flag.ArmPending;
    return;
  }
  obj.flags &= ~ActorFlag.ShotImmune;
  b.phaseHpFloor = Boss4PhaseFloor(obj.maxHp, b.phase);
  b.flags &= ~Boss4Flag.ArmPending;
}

/**
 * The phase-16 advance's cue frame: `CMP EAX, [0x00570636]` --
 * `g_boss4_camera_cues[21].end`, 1220, read out of the table rather than
 * written as an immediate.
 */
const PHASE16_CUE_ENTRY = 21;

/**
 * `Boss4AdvancePhaseAtFloor` — `FUN_00492790`. When no cue is running or
 * queued and the screen is still, a phase whose floor the hit points have
 * reached moves on: the next phase's cue is queued and the transition flag
 * raised. Phases 3 and 13 advance through `Boss4StateChooseAction` instead,
 * and 8 and 17 are the last (floor 0).
 *
 * The switch is `byte [0x004928B4 + phase + 1]` through `0x004928A8`: phases
 * 3, 8, 13, 17 and `0xFF` return; 16 has its own arm; everything else the
 * common one. The hit-point test is `FILD hp; FILD maxhp; FMUL frac; FCOMPP;
 * TEST AH, 1` -- it returns while `floor < hp`.
 */
export function Boss4AdvancePhaseAtFloor(obj: Actor, b: Blk): void {
  if (G.g_screen_shake_frames !== 0) return;
  if (b.cueStep !== 0) return;
  if (b.flags & Boss4Flag.CueQueued) return;
  switch (b.phase) {
    case 3: case 8: case 13: case 17: case 0xff:
      return;
    case 16: {
      if (Boss4PhaseFloor(obj.maxHp, b.phase) < obj.hp) return;
      const end = Boss4Tables().camera_cues[PHASE16_CUE_ENTRY]?.end ?? -1;
      // `CALL __ftol` on `state+0x14` -- truncation of a positive float.
      if (Math.trunc(b.cueFrame) !== end) return;
      b.phase += 1;
      Boss4QueueCameraCue(b, b.phase);
      b.flags |= Boss4Flag.Transition;
      return;
    }
    default:
      if (b.phase > 17) return;
      if (Boss4PhaseFloor(obj.maxHp, b.phase) < obj.hp) return;
      obj.flags |= ActorFlag.NoCameraTrack;
      b.phase += 1;
      Boss4QueueCameraCue(b, b.phase);
      b.flags |= Boss4Flag.Transition;
  }
}

/** One seat: the camera frame, the spot, the heading. */
interface Seat {
  /** `CMP dword ptr [0x009A6110], n` -- `g_cam_path_frame`'s threshold. */
  frame: number;
  x: number;
  z: number;
  /** `MOV dword ptr [ESI + 0x68], n` -- the yaw, BAMS. */
  yaw: number;
}

/**
 * `Boss4AdvanceArenaWaypoint`'s seats, by phase, as `.text` immediates
 * (`docs/re/boss-strength.md` §7.4 lists them with their float words).
 * Phase 9 has none and 13 and 17 are handled apart.
 */
const SEATS: Readonly<Record<number, Seat>> = {
  1: { frame: 0x104, x: 205, z: -1620, yaw: 0xc000 },
  2: { frame: 0x1cc, x: 255, z: -1700, yaw: 0xc000 },
  3: { frame: 0x258, x: 420, z: -1685, yaw: 0xc000 },
  4: { frame: 0x2a9, x: 555, z: -1860, yaw: 0x400 },
  5: { frame: 0x316, x: 425, z: -1970, yaw: 0x2000 },
  6: { frame: 0x3ca, x: 350, z: -1990, yaw: 0x2800 },
  7: { frame: 0x42e, x: 175, z: -1918, yaw: 0x4000 },
  8: { frame: 0x4e2, x: 65, z: -1930, yaw: 0x5000 },
  10: { frame: 0x8c, x: -390, z: -1605, yaw: 0x4000 },
  11: { frame: 0xfa, x: -440, z: -1730, yaw: 0xbb00 },
  12: { frame: 0x212, x: -270, z: -1785, yaw: 0xdc00 },
  13: { frame: 0x26c, x: 0, z: 0, yaw: 0 },
  14: { frame: 0x30c, x: -270, z: -2080, yaw: 0x4000 },
  15: { frame: 0x3d4, x: -360, z: -2080, yaw: 0x3800 },
  16: { frame: 0x442, x: -485, z: -1948, yaw: 0x5800 },
};

/**
 * The points the "below the threshold" arms test while the boss is in state 7
 * or 4 -- `if (ActorPointIsAhead(point)) { state 5; sub 0 }`, at
 * `0x00492FC0`. No turn: the boss is only switched into the choice state.
 */
const BELOW: Readonly<Record<number, [number, number]>> = {
  3: [420, -1685], 5: [470, -1925], 6: [370, -2065], 7: [240, -2035],
  8: [60, -1920], 11: [-460, -1760], 13: [-195, -1915], 15: [-450, -2095],
  16: [-450, -2095],
};

/** The charges' camera frames: `state+0x74`, then `+0x78`. */
const CHARGE: Readonly<Record<number, [number, number]>> = {
  5: [0x334, 0x32a], 7: [0x46a, 0x456], 11: [0x154, 0x136],
  16: [0x474, 0x460],
};

/** Phase 13's stored turn point's z, `0xC4F14000` at `0x00492DFB`. */
const PHASE13_TURN_Z = -1930;

/**
 * `Boss4AdvanceArenaWaypoint` — `FUN_004928D0`. While the transition flag
 * is up, seat the boss for the phase once `g_cam_path_frame` has passed the
 * phase's threshold. Switch on `phase - 1` through `0x0049304C`; the shapes:
 *
 * * **1, 10** -- if the spot is already ahead of him, keep his place and walk
 *   the idle in (`blend(0x6B, 0, 10)` unless playing); otherwise seat him
 *   there facing the yaw on `ActorSetMotion(0x6B)`. State 7, tail A.
 * * **3** -- seat; `blend(0x6B, 0, 2)` unless playing; state 7, tail A.
 * * **4** -- seat; `ActorSetMotion(0x6B)`; state 7, tail A.
 * * **8** -- seat; `blend(0x6D, 0, 5)` unless playing; state 7, tail A.
 * * **2, 6, 12, 15** -- seat; state 8; tail B.
 * * **5, 7, 11, 16** -- seat; state 0x13 with the charge's two frames; tail A.
 * * **13** -- no seat; `blend(0x6B, 0, 5)` unless playing; state 9 turning to
 *   `(pos.x, -1930)` and on to state 0xA; tail A.
 * * **14** -- seat; `ActorSetMotionBlended(0x6B, 10, 0)`, a start frame and
 *   no fade; state 7; tail E.
 * * **17** -- no threshold: while the state is below 0xF,
 *   `blend(0x6D, 0, 10)`, state 7, tail A.
 *
 * Tail A: `flags &= ~8; flags &= ~2; obj+0x34 &= 0xBFFFDFFF;
 * Boss4LoadPhaseArena`. B is A and then `obj+0x34 &= ~0x10000`. E is A and
 * then `&= 0xFFFEBFFF`. Seating writes x and z only, and always sub 0.
 */
export function Boss4AdvanceArenaWaypoint(obj: Actor, b: Blk): void {
  if (!(b.flags & Boss4Flag.Transition)) return;
  const phase = b.phase;
  if (phase < 1 || phase > 17 || phase === 9) return;
  const f = G.g_cam_path_frame;

  if (phase === 17) {
    if (b.state >= Boss4State.StrikeClip65) return;
    ActorSetMotionBlended(obj, Boss4Clip.Walk6D, 0, 10);
    Enter(b, Boss4State.FaceCamera);
    TailA(obj, b);
    return;
  }

  const seat = SEATS[phase];
  if (f < seat.frame) {
    // Below the threshold: only phases with a point, and only in 7 or 4.
    const pt = BELOW[phase];
    if (!pt) return;
    if (b.state !== Boss4State.FaceCamera
        && b.state !== Boss4State.ApproachCamera) {
      return;
    }
    if (ActorPointIsAhead(obj, { x: pt[0], y: obj.pos.y, z: pt[1] })) {
      Enter(b, Boss4State.ChooseAction);
    }
    return;
  }

  switch (phase) {
    case 1:
    case 10:
      if (ActorPointIsAhead(obj, { x: seat.x, y: obj.pos.y, z: seat.z })) {
        if (obj.motion !== Boss4Clip.Idle) {
          ActorSetMotionBlended(obj, Boss4Clip.Idle, 0, 10);
        }
      } else {
        Seat(obj, seat);
        ActorSetMotion(obj, Boss4Clip.Idle);
      }
      Enter(b, Boss4State.FaceCamera);
      TailA(obj, b);
      return;
    case 3:
      Seat(obj, seat);
      if (obj.motion !== Boss4Clip.Idle) {
        ActorSetMotionBlended(obj, Boss4Clip.Idle, 0, 2);
      }
      Enter(b, Boss4State.FaceCamera);
      TailA(obj, b);
      return;
    case 4:
      Seat(obj, seat);
      ActorSetMotion(obj, Boss4Clip.Idle);
      Enter(b, Boss4State.FaceCamera);
      TailA(obj, b);
      return;
    case 8:
      Seat(obj, seat);
      if (obj.motion !== Boss4Clip.Walk6D) {
        ActorSetMotionBlended(obj, Boss4Clip.Walk6D, 0, 5);
      }
      Enter(b, Boss4State.FaceCamera);
      TailA(obj, b);
      return;
    case 2:
    case 6:
    case 12:
    case 15:
      Seat(obj, seat);
      Enter(b, Boss4State.PlayArrivalClip);
      TailA(obj, b);
      obj.flags &= ~ActorFlag.NoCameraTrack;
      return;
    case 5:
    case 7:
    case 11:
    case 16:
      Seat(obj, seat);
      Enter(b, Boss4State.ChargePastCamera);
      b.w74 = CHARGE[phase][0];
      b.w78 = CHARGE[phase][1];
      TailA(obj, b);
      return;
    case 13:
      if (obj.motion !== Boss4Clip.Idle) {
        ActorSetMotionBlended(obj, Boss4Clip.Idle, 0, 5);
      }
      Enter(b, Boss4State.TurnToStoredPoint);
      b.w74 = Boss4State.TurnClipThenApproach;
      b.f84 = obj.pos.x;
      b.f88 = PHASE13_TURN_Z;
      TailA(obj, b);
      return;
    case 14:
      Seat(obj, seat);
      // `PUSH 0; PUSH 0xA; PUSH 0x6B` -- a start **cursor** of 10, which is
      // authored frame 5 in the port's unit, and no fade.
      ActorSetMotionBlended(obj, Boss4Clip.Idle, 5, 0);
      Enter(b, Boss4State.FaceCamera);
      TailA(obj, b);
      obj.flags &= ~(ActorFlag.NoCameraTrack | ActorFlag.PoseFrozen);
      return;
  }
}

/** `pos.x`, `pos.z` and the yaw -- a seat. `[port-only]` as a function. */
function Seat(obj: Actor, s: Seat): void {
  obj.pos.x = s.x;
  obj.pos.z = s.z;
  obj.yaw = s.yaw;
}

/** `state = n; sub = 0`. `[port-only]` as a function. */
function Enter(b: Blk, state: Boss4State): void {
  b.state = state;
  b.sub = 0;
}

/**
 * Tail A, `0x00492CC4` (and the same code at `0x00492F86`/`0x0049301D`):
 * the transition and the fence down, the reaction and strike bits off, and
 * the new phase's arena loaded. `[port-only]` as a function.
 */
function TailA(obj: Actor, b: Blk): void {
  b.flags &= ~Boss4Flag.Transition;
  b.flags &= ~Boss4Flag.Fenced;
  obj.flags &= ~(ActorFlag.Reacting | ActorFlag.NoHitReaction);
  Boss4LoadPhaseArena(obj, b);
}

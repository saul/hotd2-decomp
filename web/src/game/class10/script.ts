/**
 * The command stream, and the two walks over it.
 *
 * `CivilianRunScript` (`FUN_0048B9E0`) is the **action** VM: it executes
 * opcodes `0x00..0x2C` and stops before anything above `0x2B`, parking the
 * cursor on the next `Wait`. `CivilianReapplyWaitCommand` (`FUN_0048B760`) is
 * a second, smaller VM over the same stream, and it exists because
 * `CivilianStepScript` may **skip** a block: a skipped block's clip, target,
 * timer and cues still have to be in place for the wait that follows it to
 * mean anything, and its sounds, dialogue and score must not run, because
 * those are not conditions.
 */
import type { Actor } from "../actor";
import type { Rng } from "../../core/rng";
import { ScoreAddForPlayer } from "../combat/score";
import { G } from "../globals";
import type { ClassFrame } from "../registry";
import { FrameToTicks, MotionOf } from "../tables";
import { CivilianAddHeldItem, CivilianAddPickedItem, CivilianPickHeldItem }
  from "./items";
import { FALL_ACCEL } from "./hooks";
import { AsFloat, CivilianHook, CivilianOp, CivilianWait, CmdAt } from "./ops";

/** What a rescue pays — `ScoreAddForPlayer`'s operand. */
const RESCUE_AWARD = 400;

/**
 * `CivilianRunScript` — `FUN_0048B9E0`.
 *
 * Walks the stream from `pc`, applying each command, and stops **before** the
 * first opcode above `0x2B` — leaving `sub.cursor` on it for
 * `CivilianStepScript` to wait out. `sub.wait`'s `Uncounted` bit survives the
 * walk, which is the `*sub |= saved & 0x08000000` at the end.
 */
export function CivilianRunScript(obj: Actor, script: number, pc: number,
                                  f?: ClassFrame, rng?: Rng): void {
  const sub = obj.civ;
  if (!sub) return;
  const uncounted = sub.wait & CivilianWait.Uncounted;
  sub.script = script;
  sub.skipCount = 0;

  for (let guard = 0; guard < 4096; guard++) {
    const c = CmdAt(script, pc);
    if (!c) break;
    const a = c.args;
    switch (c.op as CivilianOp) {
      case CivilianOp.SetMotion:
      case CivilianOp.SetMotionFrom:
        sub.loops = a[1];
        sub.frameLimit = 0;
        CivilianSetMotion(obj, a[0],
                          c.op === CivilianOp.SetMotionFrom ? a[2] : 0);
        break;
      case CivilianOp.SetFrameLimit: sub.frameLimit = a[0]; break;
      case CivilianOp.SetTurnRate: sub.turnRate = a[0]; break;
      case CivilianOp.SetMotionFrame: sub.motionCompare = a[0]; break;
      case CivilianOp.SetTarget:
        sub.targetMode = a[0];
        sub.radius = c.radius ?? 0;
        if (a[0] > 0 && c.point) {
          sub.target = { x: c.point[0], y: c.point[1], z: c.point[2] };
        }
        break;
      case CivilianOp.SetTargetPoint:
        sub.targetMode = a[0];
        if (c.point) {
          sub.target = { x: c.point[0], y: c.point[1], z: c.point[2] };
        }
        break;
      case CivilianOp.SetTargetHeading: {
        // 100 units along the heading, measured from where the actor is.
        sub.targetMode = 1;
        const r = a[0] * ((Math.PI * 2) / 65536);
        sub.target = { x: obj.pos.x - Math.sin(r) * 100, y: obj.pos.y,
                       z: obj.pos.z - Math.cos(r) * 100 };
        break;
      }
      case CivilianOp.SetYaw: obj.yaw = a[0]; break;
      case CivilianOp.SetTimer: sub.timer = a[0]; break;
      case CivilianOp.SetEnemiesGoal: sub.enemiesGoal = a[0]; break;
      case CivilianOp.SetChildrenGoal: sub.childrenGoal = a[0]; break;
      case CivilianOp.SetCiviliansGoal: sub.civiliansGoal = a[0]; break;
      case CivilianOp.SetCameraCue:
        sub.cuePath = a[0]; sub.cueFrame = a[1]; break;
      case CivilianOp.SetOnShot:
        sub.onShot = a[0]; sub.onShotScript = c.scripts?.[0] ?? -1; break;
      case CivilianOp.SetOnShotKilled:
        sub.onShotAlt = a[0]; sub.onShotAltScript = c.scripts?.[0] ?? -1;
        break;
      case CivilianOp.SetHook:
        sub.hook = a[0];
        sub.hookBusy = 0;
        if (sub.hook === CivilianHook.LaunchUp) obj.vel.y = AsFloat(a[1]);
        if (sub.hook === CivilianHook.Launch) {
          obj.vel.x = AsFloat(a[1]);
          obj.vel.y = AsFloat(a[2]);
          obj.vel.z = AsFloat(a[3]);
        }
        if (sub.hook === CivilianHook.Fall
            || sub.hook === CivilianHook.LaunchUp
            || sub.hook === CivilianHook.Launch) {
          obj.accY = FALL_ACCEL;
          if (sub.hook === CivilianHook.Fall) obj.vel.y = 0;
        }
        break;
      case CivilianOp.SetSkipCount: sub.skipCount = a[0]; break;
      case CivilianOp.SetRemoveDelay: sub.removeDelay = a[0]; break;
      case CivilianOp.SetRadiusRamp:
        sub.scaleTarget = c.radius ?? 1;
        sub.scaleStep = a[1] ? (sub.scaleTarget - 1) / AsFloat(a[1]) : 0;
        break;
      case CivilianOp.SetCameraPointMode: sub.cameraPointMode = a[0]; break;
      case CivilianOp.SetPose:
        if (c.pose && c.pose.length === 6) {
          obj.pos = { x: c.pose[0], y: c.pose[1], z: c.pose[2] };
          obj.yaw = c.pose[4];
        }
        break;
      case CivilianOp.SetChildCue:
        // **The order.** `sub+0x2C` is a class-0x30 state id and `sub+0x2E` a
        // countdown, and the captors sitting in
        // `ZombieStateAwaitCivilianOrder` are what read them. An earlier
        // revision kept only the second operand and called it `childCue2`
        // `[open]`, which threw the order itself away.
        if (sub.childCount !== 0) {
          sub.childOrder = a[0];
          sub.childOrderFrames = a[1];
        }
        break;
      case CivilianOp.SetScriptFlag:
        G.g_script_flags[a[0]] = 1; break;
      case CivilianOp.PlayDialogue:
        // `EvtOpPlayDialogue2D` (`FUN_00435B80`) — the *same* call evt op 0x2D
        // makes, and all 36 operands the shipped streams use are real message
        // groups, so a civilian's line goes through the player's own subtitle
        // and voice path rather than out as a bare sound id.
        //
        // The engine gates it on the removal countdown, so a civilian already
        // walking off stays quiet.
        if (sub.removeDelay === 0) {
          f?.events?.emit("civilian.dialogue", { at: obj.at, group: a[0] });
        }
        break;
      case CivilianOp.SetResume:
        sub.resume = a[0]; sub.resumeScript = c.scripts?.[0] ?? -1; break;
      case CivilianOp.SetResumeByMode:
        // `DAT_009A2226` picks the second stream. `[open]` — nothing else
        // read writes it, so this always takes the first, as a one-player
        // arcade run does.
        sub.resume = a[0]; sub.resumeScript = c.scripts?.[0] ?? -1; break;
      case CivilianOp.SetFlagIndex: sub.flagIndex = a[0]; break;
      case CivilianOp.QueueSound:
        sub.soundId = a[0]; sub.soundDelay = a[1]; break;
      case CivilianOp.QueueSoundList: {
        const list = (c.sounds ?? []).map((s) => [s[0], s[1]] as
                                          [number, number]);
        const head = list.shift();
        sub.soundId = head?.[0] ?? 0;
        sub.soundDelay = head?.[1] ?? 0;
        sub.sounds = list;
        break;
      }
      case CivilianOp.SetCameraBone: sub.cameraBone = a[0]; break;
      case CivilianOp.SetActorFlags: obj.flags |= a[0]; break;
      case CivilianOp.SetDeathVoice: sub.deathVoice = a[0] & 0xff; break;
      case CivilianOp.MoveOverFrames:
        sub.moveTo = a[0] >= 1 && c.point
          ? { x: c.point[0], y: c.point[1], z: c.point[2] }
          : { x: 0, y: 0, z: 0 };
        sub.moveFrames = a[1];
        if (sub.moveFrames > 0) {
          obj.vel.x = (sub.moveTo.x - obj.pos.x) / sub.moveFrames;
          obj.vel.y = (sub.moveTo.y - obj.pos.y) / sub.moveFrames;
          obj.vel.z = (sub.moveTo.z - obj.pos.z) / sub.moveFrames;
        }
        break;
      case CivilianOp.Wait:
        CivilianApplyWaitWord(obj, a[0], f);
        break;
      // The three held-item ops are three routines in the engine too, and
      // they are three here -- see `class10/items.ts`.
      case CivilianOp.AddHeldItem:
        CivilianAddHeldItem(sub, c);
        break;
      case CivilianOp.AddPickedItem:
        CivilianAddPickedItem(sub);
        break;
      case CivilianOp.PickHeldItem:
        CivilianPickHeldItem(sub, c, f?.rng ?? rng);
        break;
      // Unread. Named so the stream stays legible and so a later reading has
      // somewhere to land; deliberately no behaviour.
      case CivilianOp.SetGlobalA:
      case CivilianOp.SetGlobalB:
      case CivilianOp.SetAttachMode:
      case CivilianOp.SetAttachTarget:
      case CivilianOp.SetPairA:
      case CivilianOp.SetScale:
      case CivilianOp.DebugOnly:
        break;
      default:
        break;
    }
    pc += 1;
    const next = CmdAt(script, pc);
    if (!next || next.op > CivilianOp.Wait - 1) {
      sub.pc = pc;
      sub.cursor = pc;
      sub.wait |= uncounted;
      return;
    }
  }
  sub.pc = pc;
  sub.cursor = pc;
  sub.wait |= uncounted;
}

/**
 * Op 0x2C's own body, split out because `CivilianRunScript` is the only place
 * the rescue can be paid and burying it in a `case` hid it.
 */
function CivilianApplyWaitWord(obj: Actor, word: number,
                               f?: ClassFrame): void {
  const sub = obj.civ;
  if (!sub) return;
  // `RemoveOffCamera` is masked off on load and set again by nothing: the
  // engine writes `flags = operand & 0xFBFFFFFF`.
  sub.wait = word & ~0x04000000;
  if (sub.wait & CivilianWait.LeaveCountNow) {
    G.g_civilians_alive -= 1;
    sub.flags2 |= 1;
  }
  if (sub.wait & 0x4000) sub.frameLimit = 0;
  if (sub.wait & 0x40000) obj.flags &= ~0x10000;
  else obj.flags |= 0x10000;
  if (!(sub.wait & CivilianWait.Rescued)) return;

  // **The rescue.** `sub+0x6C` is the player whose shot killed the last
  // captor, `-1` when the engine could not name one — and then both are paid.
  const player = sub.rescuePlayer;
  if (player === -1) {
    ScoreAddForPlayer(0, RESCUE_AWARD, f?.events);
    ScoreAddForPlayer(1, RESCUE_AWARD, f?.events);
  } else {
    ScoreAddForPlayer(player, RESCUE_AWARD, f?.events);
  }
  sub.wait &= ~CivilianWait.Rescued;
  f?.events?.emit("civilian.rescued", {
    at: obj.at, player, score: G.g_player_score[Math.max(0, player)],
  });
}

/** Ops 0x00 and 0x01: change the clip, and reset its clock. */
function CivilianSetMotion(obj: Actor, motion: number, frame: number): void {
  if (obj.motion === motion) return;
  obj.motion = motion;
  const m = MotionOf(obj, motion);
  obj.playTicks = FrameToTicks(frame, m);
  obj.rootFrame = -1;
}

/**
 * `CivilianReapplyWaitCommand` — `FUN_0048B760`.
 *
 * Walks forward from one wait command to the next, applying **only** the
 * opcodes whose state a wait condition reads. That is the whole reason it
 * exists as a second, smaller VM: `CivilianStepScript` may skip a block, and a
 * skipped block's clip, target and cue still have to be in place for the wait
 * that follows it to mean anything. Its actions — the sounds, the dialogue,
 * the score — are not run, because they are not conditions.
 */
export function CivilianReapplyWaitCommand(obj: Actor, script: number,
                                           pc: number): number {
  const sub = obj.civ;
  if (!sub) return pc;
  for (let guard = 0; guard < 4096; guard++) {
    const c = CmdAt(script, pc);
    if (!c) return pc;
    const a = c.args;
    switch (c.op as CivilianOp) {
      case CivilianOp.SetMotion:
        sub.loops = a[1];
        obj.playTicks = 0;
        break;
      case CivilianOp.SetMotionFrom: {
        sub.loops = a[1];
        const m = MotionOf(obj, obj.motion);
        obj.playTicks = FrameToTicks(a[2] ?? 0, m);
        break;
      }
      case CivilianOp.SetMotionFrame: sub.motionCompare = a[0]; break;
      case CivilianOp.SetTarget:
        sub.targetMode = a[0];
        sub.radius = c.radius ?? 0;
        if (a[0] > 0 && c.point) {
          sub.target = { x: c.point[0], y: c.point[1], z: c.point[2] };
        }
        break;
      case CivilianOp.SetTargetPoint:
        sub.targetMode = a[0];
        if (c.point) {
          sub.target = { x: c.point[0], y: c.point[1], z: c.point[2] };
        }
        break;
      case CivilianOp.SetTargetHeading: {
        sub.targetMode = 1;
        const r = a[0] * ((Math.PI * 2) / 65536);
        sub.target = { x: obj.pos.x - Math.sin(r) * 100, y: obj.pos.y,
                       z: obj.pos.z - Math.cos(r) * 100 };
        break;
      }
      case CivilianOp.SetTimer: sub.timer = a[0]; break;
      case CivilianOp.SetEnemiesGoal: sub.enemiesGoal = a[0]; break;
      case CivilianOp.SetChildrenGoal: sub.childrenGoal = a[0]; break;
      case CivilianOp.SetCiviliansGoal: sub.civiliansGoal = a[0]; break;
      case CivilianOp.SetCameraCue:
        sub.cuePath = a[0]; sub.cueFrame = a[1]; break;
      case CivilianOp.SetHook: sub.hook = a[0]; break;
      case CivilianOp.SetFlagIndex: sub.flagIndex = a[0]; break;
      default: break;
    }
    pc += 1;
    const next = CmdAt(script, pc);
    if (!next || next.op > CivilianOp.Wait - 1) return pc;
  }
  return pc;
}

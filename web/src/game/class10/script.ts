/**
 * The command stream, and the two walks over it.
 *
 * `CivilianRunScript` (`FUN_0048B9E0`) is the **action** VM: it executes
 * opcodes `0x00..0x2C` and stops before anything above `0x2B`, parking the
 * cursor on the next `Wait`. `CivilianReapplyWaitCommand` (`FUN_0048B760`) is
 * a second, smaller VM over the same stream, and it exists because
 * `CivilianStepScript` may **skip** a block, or pass several in one frame: a
 * block's loop count, play cursor, target, timer and cues have to be in place
 * for that loop to test the wait that follows it, and its sounds, dialogue and
 * score must not run, because those are not conditions. It never writes the
 * clip itself, and eight of the words it writes the step puts back before it
 * returns -- see `CivilianStepScript`.
 */
import { ActorFlag, MotionFlag, type Actor } from "../actor";
import type { Rng } from "../../core/rng";
import { ScoreAddForPlayer } from "../combat/score";
import { G } from "../globals";
import { RecordRescue } from "../rescue";
import type { ClassFrame } from "../registry";
import { NULL_HOST, type GameHost } from "../host";
import { CivilianAddHeldItem, CivilianAddPickedItem, CivilianPickHeldItem }
  from "./items";
import { CivilianCallHookInstall } from "./hooks";
import { ActorStorePlayCursor } from "../motion";
import { AsFloat, CivilianFrameHook, CivilianHookInstall, CivilianOp,
         CivilianWait, CmdAt } from "./ops";
import { CivilianApplyMotionPose } from "./pose";

/** What a rescue pays — `ScoreAddForPlayer`'s operand. */
const RESCUE_AWARD = 400;

/**
 * The one `g_app_state` (`0x009C8E98`) value that refuses
 * {@link CivilianOp.SetHudShutterState} — `CMP dword ptr [0x009c8e98], 0xA`
 * at `0x0048BF0A`. A scalar, not a member of a set the exe switches on: 10 is
 * one of the shell's unnamed screens and nothing else in the routine tests it.
 */
const CIV_SHUTTER_BLOCKED_APP_STATE = 10;

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
  // `MOV EBX, dword ptr [EAX]` at `0x0048B9EA`, before the loop: the word the
  // block now ending ran under. Ops 0x00 and 0x01 hand it to
  // `CivilianApplyMotionPose`, which reads the old block's root-motion bit off
  // it and everything else off the new word op 0x2C is about to load.
  const entryWord = sub.wait;
  const host = f?.host ?? NULL_HOST;
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
                          c.op === CivilianOp.SetMotionFrom ? a[2] : 0,
                          entryWord, host);
        break;
      case CivilianOp.SetFrameLimit: sub.frameLimit = a[0]; break;
      case CivilianOp.SetMotionBlend: sub.motionBlend = a[0]; break;
      case CivilianOp.SetMotionFrame: sub.motionCompare = a[0]; break;
      case CivilianOp.SetTarget:
        sub.targetMode = a[0];
        sub.radius = c.radius ?? 0;
        if (a[0] > 0 && c.point) {
          sub.target = { x: c.point[0], y: c.point[1], z: c.point[2] };
        }
        break;
      // **The point and not the mode.** `MOV dword ptr [EAX + 0x44], EDX` at
      // `0x0048BC93` -- the pointer goes to `sub+0x44`, not to `sub+0x40` --
      // and the three words it names are copied into `sub+0x30..0x38`. The
      // target mode is left as it stands, so this does not turn anyone: see
      // {@link CivilianOp.SetTargetPoint}.
      case CivilianOp.SetTargetPoint:
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
      // `0x0048BD81`. A null operand is `MOV dword ptr [EAX + 0x5C],
      // NoOpStub` and nothing else. Any other is **called** -- `PUSH ESI
      // (cmd + 2); PUSH EDI (obj); CALL ECX; MOV ESI, EAX` -- so the install
      // routine writes the step and whatever else it writes, and the pointer
      // it returns is the next command; then `MOV word ptr [EAX + 0x18], BP`
      // puts the done flag down. The port used to store the operand itself
      // and inline three of the four installs here, with the fall's gravity
      // for all three.
      case CivilianOp.SetHook:
        if (a[0] === CivilianHookInstall.None) {
          sub.hook = CivilianFrameHook.None;
          break;
        }
        CivilianCallHookInstall(obj, a[0], a.slice(1));
        sub.hookDone = 0;
        break;
      case CivilianOp.SetSkipCount: sub.skipCount = a[0]; break;
      case CivilianOp.SetRemoveDelay: sub.removeDelay = a[0]; break;
      case CivilianOp.SetRadiusRamp:
        sub.scaleTarget = c.radius ?? 1;
        sub.scaleStep = a[1] ? (sub.scaleTarget - 1) / AsFloat(a[1]) : 0;
        break;
      case CivilianOp.SetSphereCentreMode:
        // `MOV DL, byte ptr [ESI+0x4]`: a byte, and the switch reads it back
        // with `MOVSX`, so the signed byte is what the field holds.
        sub.sphereCentreMode = (a[0] << 24) >> 24;
        break;
      case CivilianOp.SetPose:
        // Six dwords, copied: the position's floats into `obj+0x40..0x48`,
        // the rotation's BAMS into `obj+0x64..0x6C` -- pitch, yaw, roll.
        if (c.pose && c.pose.length === 6) {
          obj.pos = { x: c.pose[0], y: c.pose[1], z: c.pose[2] };
          obj.pitch = c.pose[3];
          obj.yaw = c.pose[4];
          obj.roll = c.pose[5];
        }
        break;
      case CivilianOp.SetChildCue:
        // **The order.** `sub+0x2C` is a class-0x30 state id and `sub+0x2E` a
        // countdown, and the captors sitting in
        // `ZombieStateAwaitCivilianOrder` are what read them. An earlier
        // revision kept only the second operand and called it `childCue2`,
        // an open question, which threw the order itself away.
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
        // No point (`CMP ECX, EBP; JLE` on the operand, `0x0048C0E3`) is a
        // move onto `g_camera_eye`, the three words by address at
        // `0x0048C0FE..114`. The port moved to the world origin.
        sub.moveTo = a[0] >= 1 && c.point
          ? { x: c.point[0], y: c.point[1], z: c.point[2] }
          : { x: G.g_camera_eye.x, y: G.g_camera_eye.y, z: G.g_camera_eye.z };
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
        CivilianAddPickedItem(sub, c);
        break;
      case CivilianOp.PickHeldItem:
        CivilianPickHeldItem(sub, c, f?.rng ?? rng);
        break;
      // `MOV word ptr [0x009c88a4], CX` -- a **signed 16-bit** store, so the
      // truncation is the engine's and not a tidy-up. Every shipped stream
      // passes 1; the mask is here because the command is a dword and the
      // store is a word, and a port that widened it would be inventing a
      // route index the engine cannot express.
      case CivilianOp.SetRouteBranch:
        G.g_script_branch_var = (a[0] << 16) >> 16;
        break;
      // **The shutter, and with it the trigger.** `MOV DL, byte ptr [ESI+4]`
      // / `MOV byte ptr [0x009ca0f4], DL` at `0x0048BF13`, behind
      // `CMP dword ptr [0x009c8e98], 0xA` / `JZ`. A byte store, so the low
      // byte of the dword and nothing else; the guard is
      // `g_app_state != 10` and not "in play", so it holds in every state the
      // port ever runs a stage in.
      //
      // Nothing more is needed here: `script/state/shutter.ts` notices a state
      // written from outside evt `0x1F` on its next step -- it was taught to
      // for `BossIntroBannerUpdate` -- and that is where `g_nFiringGate`
      // comes back up. See {@link CivilianOp.SetHudShutterState} for why a
      // shipped room depends on it.
      case CivilianOp.SetHudShutterState:
        if (G.g_app_state !== CIV_SHUTTER_BLOCKED_APP_STATE) {
          G.g_bHudShutterState = a[0] & 0xff;
        }
        break;
      // Unread. Named so the stream stays legible and so a later reading has
      // somewhere to land; deliberately no behaviour.
      //
      // **These three used to fall through into `SetScale`'s body** and write
      // its operand into `obj.scale`, which is `model+0x116C` and the factor
      // `SkeletonApplyRootMotion` (`FUN_00410C50`) multiplies the root delta
      // by. Their operands are small integers -- 1, 2, 5, 200 -- and
      // {@link AsFloat} reinterprets a dword's bits, so the scale came out a
      // denormal around 1e-45 and every step the clip authored was multiplied
      // to nothing. 125 commands in the shipped streams run one of the four
      // this case used to hold.
      case CivilianOp.SetAttachMode:
      case CivilianOp.SetAttachTarget:
      case CivilianOp.SetPairA:
        break;
      // `MOV dword ptr [g_cur_actor_model + 0x116c], param_2[1]` -- the
      // operand is stored **verbatim** into a float field, so it is a float
      // bit pattern and `AsFloat` is the store. One command in the whole game
      // runs it, `0x42480000` = 50.0. It scales the root motion as well as the
      // draw -- see `ActorModelScale` in `game/root_motion.ts`.
      case CivilianOp.SetScale:
        obj.scale = AsFloat(a[0]);
        break;
      case CivilianOp.InPlayOnly:
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
    sub.subFlags |= 1;
  }
  if (sub.wait & 0x4000) sub.frameLimit = 0;
  // Inverted, and the engine's own inversion: the wait bit means *tracked*
  // and `obj+0x34` bit `0x10000` means *not*.
  if (sub.wait & CivilianWait.CameraTrack) {
    obj.flags &= ~ActorFlag.NoCameraTrack;
  } else {
    obj.flags |= ActorFlag.NoCameraTrack;
  }
  if (!(sub.wait & CivilianWait.Rescued)) return;

  // **The rescue's bookkeeping** (`0x0048BA8C`..`0x0048BAC4`), before a
  // point is paid: the run's total, this scene's count, and at the count
  // *before* the increment the civilian's own character type (`model+0x60`)
  // -- the list the result card stands its figures from.
  RecordRescue(obj.charType);

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

/**
 * Ops 0x00 and 0x01: change the clip -- **and set the clip's root-motion
 * gate from the block's wait word**, then hand the change to
 * `CivilianApplyMotionPose` (`FUN_0048C310`).
 *
 * All of it is inside the engine's `if (model+0x20 != new clip)`, so a block
 * that re-states the clip it is already playing changes none of it -- the
 * gate included. That is why the test comes first here.
 *
 * The gate is `model+0x64` bit 1, {@link Actor.motionFlags}, and its source is
 * bit `0x00100000` of `sub.wait` -- see {@link CivilianWait.RootMotion} for the
 * decompiled arm. The engine writes it **before** the pose call, so the pose
 * call sees the new gate; the root-motion baseline goes with the blend, which
 * resets it (`Actor.rootCursor = -1`), so the delta taken on the frame a gate
 * re-opens never spans the frames it was shut.
 *
 * `[port-only]` as a function: the two ops' shared arm, inline in the engine.
 */
function CivilianSetMotion(obj: Actor, motion: number, start: number,
                           entryWord: number, host: GameHost): void {
  if (obj.motion === motion) return;
  if (obj.civ && (obj.civ.wait & CivilianWait.RootMotion) !== 0) {
    obj.motionFlags |= MotionFlag.RootMotion;
  } else {
    obj.motionFlags &= ~MotionFlag.RootMotion;
  }
  CivilianApplyMotionPose(obj, entryWord, start, motion, host);
}

/**
 * `CivilianReapplyWaitCommand` — `FUN_0048B760`.
 *
 * Walks forward from one wait command to the next, applying **only** the
 * opcodes whose state a wait condition reads. That is the whole reason it
 * exists as a second, smaller VM: `CivilianStepScript` may skip a block, and a
 * skipped block's loop count, cursor, target and cue have to be in place for
 * the step's own test of the wait that follows it. They are in place for that
 * test and no longer: the step restores the loop count, the three goals, the
 * cue, the frame compare and the flag index on its way out, whatever it did.
 * Its actions — the sounds, the
 * dialogue, the score — are not run, because they are not conditions; and of
 * ops 0x00 and 0x01 it runs only the loop count and the **cursor** store,
 * never the clip change (`model+0x20`) or the pose call that goes with it.
 * Op 0x10 is the one exception to "conditions only": it calls the install
 * routine for its side effects and then uninstalls what it installed.
 *
 * Its two callers are both `CivilianStepScript`'s -- `0x0048B699` (the skip
 * walk) and `0x0048B6C3` (the block at the cursor), `[proved]` by a byte scan
 * for `E8` calls into it -- so everything it stores is read, if at all, by the
 * rest of that step and by the `CivilianRunScript` it hands the frame to.
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
      // `MOV dword ptr [ECX + 0x8], 0x0` at `0x0048B794`: the **cursor**,
      // `model+0x08`, and not the counter at `model+0x00` -- nor the clip at
      // `model+0x20`, which this walk never writes. The next draw recomputes
      // the cursor from the counter, so the clip plays on where it was; the
      // store is for this frame's `0x200` test, and for a fade that holds the
      // cursor. This wrote the port's one clock, and so restarted the clip a
      // frame before `CivilianRunScript` changed it: `CivilianApplyMotionPose`
      // then took the drawn pose -- the turn and the fade's snapshot -- from
      // the outgoing clip's first frame. See `ActorStorePlayCursor`.
      case CivilianOp.SetMotion:
        sub.loops = a[1];
        ActorStorePlayCursor(obj, 0);
        break;
      // `MOV dword ptr [ECX + 0x8], EDX` at `0x0048B7BA`, EDX = `cmd[3]`: the
      // start cursor, as it is, into the same word. This once converted it as
      // an authored frame and started the clip twice as far in.
      case CivilianOp.SetMotionFrom:
        sub.loops = a[1];
        ActorStorePlayCursor(obj, a[2] ?? 0);
        break;
      case CivilianOp.SetMotionFrame: sub.motionCompare = a[0]; break;
      case CivilianOp.SetTarget:
        sub.targetMode = a[0];
        sub.radius = c.radius ?? 0;
        if (a[0] > 0 && c.point) {
          sub.target = { x: c.point[0], y: c.point[1], z: c.point[2] };
        }
        break;
      // `MOV dword ptr [ECX + 0x44], EDX` at `0x0048B84E`: the same arm as
      // the action VM's, and it leaves `sub+0x40` alone the same way.
      case CivilianOp.SetTargetPoint:
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
      // `0x0048B913`. A null operand writes **nothing** -- `JZ` to the
      // length bump -- so the step already installed stands. Any other is
      // called exactly as the action VM calls it, so its velocity, gravity and
      // flag writes all land, and then `MOV dword ptr [ECX + 0x5C], NoOpStub`
      // at `0x0048B92E` takes the step it installed straight back out.
      // `sub+0x18` is not touched. The port stored the operand into the slot,
      // which installed a hook the exe never runs from here and, for a null
      // operand, uninstalled one it leaves running.
      case CivilianOp.SetHook:
        if (a[0] === CivilianHookInstall.None) break;
        CivilianCallHookInstall(obj, a[0], a.slice(1));
        sub.hook = CivilianFrameHook.None;
        break;
      case CivilianOp.SetFlagIndex: sub.flagIndex = a[0]; break;
      default: break;
    }
    pc += 1;
    const next = CmdAt(script, pc);
    if (!next || next.op > CivilianOp.Wait - 1) return pc;
  }
  return pc;
}

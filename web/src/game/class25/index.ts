/**
 * Class 0x25 — the script-driven humanoid. 142 spawns, 137 of them reached.
 *
 * The second-largest class in the game, and a **bytecode VM**. The spawn's
 * parameter tail points at a command block; `ScriptedHumanoidInit`
 * (`FUN_004840D0`) installs `ScriptedHumanoidUpdate` (`FUN_004842A0`) as the
 * object's entry point and never runs again, and that routine walks 8-byte
 * commands until one of them blocks.
 *
 * It is **not an enemy**: not damageable, awards nothing, and shots land in its
 * hit slot with nothing to consume them. What it is, is the game's cutscene
 * system — a skinned character told to play a motion, ride an object path,
 * turn to face the camera, swap the model in its hand and make a noise, in
 * whatever order the block says.
 *
 * ## The command stream
 *
 * ```
 * tail+0x00  s8   character type
 * tail+0x02  s16  removal: cam path, or a script-flag index
 * tail+0x04  s16  removal: cam frame threshold
 * tail+0x08  u32  a model handle
 * tail+0x0C  u32  -> the command block
 *
 * blk+0x02   s16  == 2: start with the draw flag set
 * blk+0x04   s16  the motion it opens in
 * blk+0x06   s16  phase seed, -1 for `rand() % 10`
 * blk+0x08   ...  the commands
 * ```
 *
 * Each command is `{op, mode, a, b}` in four `s16`s, or sixteen bytes when it
 * carries a point. **That length rule is the check on the whole reading**: one
 * wrong length desynchronises the stream and the opcodes go out of range at
 * once, and all 137 blocks decode with every opcode in `0..18` or `-1`.
 *
 * A command that cannot proceed does not advance the cursor — it falls through
 * to the per-frame tail, and the VM tries it again next frame. That is the
 * whole scheduling model: `waitFrames` counts up in `holdFrames` while a
 * condition is unmet.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import type { ClassFrame, ClassHandler } from "../registry";
import { T } from "../tables";
import { VecToAngles } from "../vec";

/** The opcodes `ScriptedHumanoidUpdate` switches on. */
export enum HumanoidOp {
  /** Wait for a condition, then let the animation **run**. */
  WaitThenPlay = 0,
  /** Wait for a condition, then **hold** the pose. */
  WaitThenHold = 1,
  /** Set the motion by id, with a phase. */
  SetMotion = 2,
  /** Set the motion with a blend and a mode. */
  SetMotionBlended = 3,
  /** Wait for a condition. The workhorse — 357 of the 1,385 commands. */
  WaitUntil = 4,
  /** Turn by a fixed amount over N frames. */
  TurnOver = 5,
  /** Stop turning, or start facing the camera every frame. */
  TurnMode = 6,
  /** Face a point once. */
  FacePoint = 7,
  /** Set the position — y alone in mode 1, x and z otherwise. */
  SetPos = 8,
  /** Swap the model in a hand, from a per-character weapon table. */
  SetHandModel = 9,
  /** Skip the following commands unless the player count matches. */
  IfPlayerCount = 10,
  /** Ride an object path. */
  FollowPath = 11,
  /** A one-shot effect this port does not run. */
  Effect = 12,
  /** `PlaySoundId`. */
  PlaySound = 13,
  /**
   * `obj+0x1330`. **Not** a draw mode: `ScriptedHumanoidUpdate`'s draw routine
   * never reads it and poses the actor unconditionally. `[open]` — the only
   * reader is the hit handler installed at `obj+0x12EC`, which is unread.
   */
  SetHitMode = 14,
  /** Jump. */
  Jump = 15,
  /** Swap one bone's draw slot. */
  SetBoneModel = 16,
  /** Hand the object to another routine entirely. */
  Handoff = 17,
  /** `ActorKill`. */
  Kill = 18,
  /** Fall out of the VM into the idle routine at `LAB_00484D40`. */
  End = -1,
}

/** The condition modes opcodes 0, 1 and 4 share. */
export enum HumanoidCond {
  /** `holdFrames` has reached `a` — a plain frame count. */
  Frames = 0,
  /** The camera has reached path `a` at frame `b`. */
  CameraAt = 1,
  /** The motion frame has reached `a`, or its last frame when `a` is -1. */
  MotionFrame = 2,
  /** Script flag `a` is set. */
  ScriptFlag = 3,
  /** The actor is nearer the point than it was last frame. */
  NearerThanBefore = 4,
  /** Unconditional. */
  Always = -1,
}

/** `obj+0x132C` — how the actor is turning. */
export enum HumanoidTurn {
  None = 0,
  /** Easing toward `turnTarget` by `turnStep` for `turnFrames`. */
  Over = 1,
  /** Facing the camera, recomputed every frame. */
  FaceCamera = 2,
}

/** One decoded command. */
export interface HumanoidCmd {
  op: number;
  mode: number;
  a: number;
  b: number;
  f0?: number;
  f1?: number;
  /** `Jump` only: the index this jumps to, or -1. */
  next?: number;
}

/** One spawn's program and the fields the Init reads. */
export interface HumanoidProgram {
  charType: number;
  removePath: number;
  removeFrame: number;
  flags2: number;
  motion: number;
  phase: number;
  cmds: HumanoidCmd[];
}

/** `obj+0x34` bit that swaps the removal trigger, as for class 0x24. */
export const HUMANOID_FLAG_REMOVE_ON_SCRIPT_FLAG = 0x2000000;

/** How many commands may run in one frame before the VM is called stuck. */
export const MAX_COMMANDS_PER_FRAME = 256;

export function HumanoidProgramOf(a: Actor): HumanoidProgram | null {
  return T.humanoids?.[String(a.at)] ?? null;
}

/**
 * `ScriptedHumanoidInit` — `FUN_004840D0`.
 *
 * [diverges] Boss Mode remaps the character type through the two selected-
 * player bytes at `0x009A2242` / `0x009A2256` — types 0x39 and 0x3A become the
 * chosen character, or 0x21. Nothing in the port chooses a player character,
 * so the descriptor's own type stands.
 */
export function ScriptedHumanoidInit(obj: Actor): void {
  const p = HumanoidProgramOf(obj);
  obj.pc = 0;
  obj.holdFrames = 0;
  // The Init pre-applies the first command: `obj+0x1324 = 1` when the block
  // opens with an op-1 wait, so an actor whose first instruction is "hold"
  // does not play a frame before it takes effect.
  obj.frozen = 0;
  obj.turnMode = HumanoidTurn.None;
  obj.turnFrames = 0;
  obj.turnStep = 0;
  obj.turnTarget = 0;
  obj.pathSlot = -1;
  obj.pathMode = 0;
  if (!p) return;
  if (p.cmds[0]?.op === HumanoidOp.WaitThenHold) obj.frozen = 1;
  obj.motion = p.motion;
  const m = T.types[String(obj.charType)]?.motions[String(p.motion)];
  const fps = m?.fps ?? 30;
  // `rand() % 10` rather than a frame anywhere in the clip: the phase here is
  // a tenth of a second's worth of stagger, not a random pose.
  obj.clock = (p.phase === -1 ? 0 : p.phase) / Math.max(1, fps);
}

/** The removal test, identical in shape to class 0x24's. */
export function HumanoidShouldRemove(obj: Actor, p: HumanoidProgram): boolean {
  if ((obj.flags & HUMANOID_FLAG_REMOVE_ON_SCRIPT_FLAG) !== 0) {
    return G.g_script_flags[p.removePath] === 1;
  }
  return G.g_active_cam_path === p.removePath
      && G.g_cam_path_frame >= p.removeFrame;
}

/** The motion frame the clip is showing. */
function MotionFrame(obj: Actor): number {
  const m = T.types[String(obj.charType)]?.motions[String(obj.motion)];
  return Math.floor(obj.clock * (m?.fps ?? 30));
}

function AtLastMotionFrame(obj: Actor): boolean {
  const m = T.types[String(obj.charType)]?.motions[String(obj.motion)];
  return !!m?.frames && MotionFrame(obj) >= m.frames - 1;
}

/** Whether a command's condition is met. Shared by opcodes 0, 1 and 4. */
function CondMet(obj: Actor, c: HumanoidCmd): boolean {
  switch (c.mode) {
    case HumanoidCond.Frames:
      return obj.holdFrames === c.a;
    case HumanoidCond.CameraAt:
      return G.g_active_cam_path === c.a && G.g_cam_path_frame >= c.b;
    case HumanoidCond.MotionFrame:
      return c.a === -1 ? AtLastMotionFrame(obj) : MotionFrame(obj) === c.a;
    case HumanoidCond.ScriptFlag:
      return G.g_script_flags[c.a] === 1;
    case HumanoidCond.NearerThanBefore: {
      // `dist(pos, point) > dist(prevPos, point)` fails the test: the actor
      // has to be *closing*. Measured flat, x and z only, as every range test
      // in this game is.
      const px = c.f0 ?? 0, pz = c.f1 ?? 0;
      const now = Math.hypot(obj.pos.x - px, obj.pos.z - pz);
      const was = Math.hypot(obj.prevPos.x - px, obj.prevPos.z - pz);
      return now < was;
    }
    case HumanoidCond.Always:
      return true;
    default:
      return false;
  }
}

/**
 * `ScriptedHumanoidUpdate` — `FUN_004842A0`. Run commands until one blocks.
 *
 * The loop is the engine's: a command that proceeds advances the cursor and
 * loops again in the *same* frame, and one that cannot falls through to the
 * per-frame tail. So a block of setup commands all take effect at once, and
 * only a wait costs a frame.
 */
export function ScriptedHumanoidUpdate(obj: Actor, f: ClassFrame): void {
  const p = HumanoidProgramOf(obj);
  if (!p) return;

  if (HumanoidShouldRemove(obj, p)) {
    obj.dead = true;
    obj.visible = false;
    return;
  }

  let ran = 0;
  while (ran++ < MAX_COMMANDS_PER_FRAME) {
    const c = p.cmds[obj.pc];
    if (!c) break;
    if (!RunCommand(obj, c, f)) break;
  }
  HumanoidFrameTail(obj, f);
}

/** One command. Returns whether the cursor moved — false parks the VM. */
function RunCommand(obj: Actor, c: HumanoidCmd, f: ClassFrame): boolean {
  switch (c.op) {
    case HumanoidOp.WaitThenPlay:
    case HumanoidOp.WaitThenHold:
      if (!CondMet(obj, c)) return false;
      // `obj+0x1324 = <the opcode>`, and that word is the **freeze flag** the
      // draw routine tests before advancing the motion frame — the same one
      // class 0x24 has. So the opcode number is not a marker: op 0 lets the
      // animation run and op 1 holds the pose, and the engine writes it by
      // reusing the opcode as the value.
      obj.frozen = c.op === HumanoidOp.WaitThenHold ? 1 : 0;
      obj.holdFrames = 0;
      obj.pc += 1;
      return true;

    case HumanoidOp.WaitUntil:
      if (!CondMet(obj, c)) return false;
      obj.holdFrames = 0;
      obj.pc += 1;
      return true;

    case HumanoidOp.SetMotion:
    case HumanoidOp.SetMotionBlended: {
      obj.motion = c.a;
      obj.clock = 0;
      obj.rootFrame = -1;
      // Mode 1 clears the draw flag and mode 2 sets it; `SetMotion` also takes
      // a phase in `b`, and -1 there is the same tenth-of-a-second stagger.
      if (c.op === HumanoidOp.SetMotion && c.b !== -1) {
        const m = T.types[String(obj.charType)]?.motions[String(c.a)];
        obj.clock = c.b / Math.max(1, m?.fps ?? 30);
      }
      obj.holdFrames = 0;
      obj.pc += 1;
      return true;
    }

    case HumanoidOp.TurnOver:
      obj.turnFrames = c.a;
      obj.turnMode = HumanoidTurn.Over;
      // Mode 0 turns one way and mode 1 the other; both divide the sweep by
      // the frame count, which is what makes it a constant-rate turn.
      obj.turnStep = (c.mode === 0 ? -1 : 1) * Math.trunc(c.b / Math.max(1, c.a));
      obj.turnTarget = obj.yaw + (c.mode === 0 ? -c.b : c.b);
      obj.holdFrames = 0;
      obj.pc += 1;
      return true;

    case HumanoidOp.TurnMode:
      obj.turnMode = c.mode === 1 ? HumanoidTurn.FaceCamera : HumanoidTurn.None;
      obj.holdFrames = 0;
      obj.pc += 1;
      return true;

    case HumanoidOp.FacePoint:
      obj.yaw = VecToAngles(obj.pos.x - (c.f0 ?? 0), 0,
                            obj.pos.z - (c.f1 ?? 0)).yaw & 0xffff;
      obj.turnMode = HumanoidTurn.None;
      obj.holdFrames = 0;
      obj.pc += 1;
      return true;

    case HumanoidOp.SetPos:
      if (c.mode === 1) obj.pos.y = c.f0 ?? obj.pos.y;
      else { obj.pos.x = c.f0 ?? obj.pos.x; obj.pos.z = c.f1 ?? obj.pos.z; }
      obj.holdFrames = 0;
      obj.pc += 1;
      return true;

    case HumanoidOp.FollowPath:
      // Mode 0 stops following; 1 takes the path's rotation too, 2 only its
      // position.
      obj.pathMode = c.mode;
      if (c.mode !== 0) { obj.pathSlot = c.a; obj.pathOffset = c.b; }
      obj.holdFrames = 0;
      obj.pc += 1;
      return true;

    case HumanoidOp.PlaySound:
      // The id is a full dword at `+4`, not the s16 the other opcodes use.
      f.events?.emit("sound.play", { id: (c.a & 0xffff) | (c.b << 16) });
      obj.holdFrames = 0;
      obj.pc += 1;
      return true;

    case HumanoidOp.SetHitMode:
      obj.hitMode = c.mode;
      obj.holdFrames = 0;
      obj.pc += 1;
      return true;

    case HumanoidOp.Jump:
      if (c.next === undefined || c.next < 0) return false;
      obj.pc = c.next;
      obj.holdFrames = 0;
      return true;

    case HumanoidOp.IfPlayerCount:
      // The engine skips forward to a `-2` terminator when the count does not
      // match. One player is the port's only configuration, so the arms for
      // two never run; taking the matching arm is the same decision.
      obj.holdFrames = 0;
      obj.pc += 1;
      return true;

    case HumanoidOp.Kill:
    case HumanoidOp.End:
      // `-1` installs the idle routine and `18` is `ActorKill`; both leave the
      // VM. The actor stays drawn for `End` and goes for `Kill`.
      if (c.op === HumanoidOp.Kill) { obj.dead = true; obj.visible = false; }
      obj.pc = -1;
      return false;

    // [diverges] These three need routines this port has not read:
    // `op 9` and `op 16` swap a model from per-character tables at
    // `0x004EC9E0` and `PTR_DAT_004C7160`, and `op 17` hands the object to one
    // of five other update routines. The command is stepped over so the rest
    // of the program still runs — stalling on it would park the actor for ever.
    case HumanoidOp.SetHandModel:
    case HumanoidOp.SetBoneModel:
    case HumanoidOp.Effect:
    case HumanoidOp.Handoff:
      obj.holdFrames = 0;
      obj.pc += 1;
      return true;

    default:
      obj.holdFrames = 0;
      obj.pc += 1;
      return true;
  }
}

/**
 * The tail every blocked frame runs: count the stall, turn, ride the path, and
 * remember where we were for the `NearerThanBefore` test.
 */
function HumanoidFrameTail(obj: Actor, f: ClassFrame): void {
  obj.holdFrames += 1;

  if (obj.turnMode === HumanoidTurn.Over) {
    obj.yaw += obj.turnStep;
    obj.turnFrames -= 1;
    if (obj.turnFrames === 0) {
      // The last frame snaps to the target rather than accumulating rounding.
      obj.yaw = obj.turnTarget;
      obj.turnMode = HumanoidTurn.None;
    }
  } else if (obj.turnMode === HumanoidTurn.FaceCamera) {
    obj.yaw = VecToAngles(obj.pos.x - f.eye.x, 0, obj.pos.z - f.eye.z).yaw
      & 0xffff;
  }

  if (obj.pathMode !== 0 && obj.pathSlot >= 0) {
    // `CamEvalObjectPath6(slot, g_cam_path_frame)` — the object paths run on
    // the *camera's* frame, which is what keeps a scripted actor in step with
    // the shot it belongs to.
    const p = f.host.objectPath?.(obj.pathSlot, G.g_cam_path_frame);
    if (p) {
      obj.pos.x = p.x;
      obj.pos.y = p.y;
      obj.pos.z = p.z;
      // Mode 2 takes the position only; mode 1 takes the orientation too.
      if (obj.pathMode !== 2 && p.yaw !== undefined) obj.yaw = p.yaw;
    }
  }

  obj.prevPos.x = obj.pos.x;
  obj.prevPos.y = obj.pos.y;
  obj.prevPos.z = obj.pos.z;
}

export const ScriptedHumanoidHandler: ClassHandler = {
  init: ScriptedHumanoidInit,
  update: ScriptedHumanoidUpdate,
};

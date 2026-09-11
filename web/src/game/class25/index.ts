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
import type { Actor, HumanoidActor } from "../actor";
import { ActorBindPartList } from "../attachments";
import { ScriptedHumanoidDebug } from "./debug";
import { authoredFrameOfTicks, ticksOfAuthoredFrame }
  from "../../core/play_cursor";
import { G } from "../globals";
import {
  registerClass, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { HumanoidDrawVariant } from "./state";
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
  /**
   * `if (g_active_player == mode)` — run the following commands, or skip past
   * the `mode == -2` marker that closes the arm.
   *
   * **It is not a player *count*.** `0x004847A9`, `0x004847D9` and
   * `0x00484809` all compare `dword ptr [0x009c7000]`, which is
   * `g_active_player` — `SelectAttackablePlayer` (`FUN_00414F40`) writes -1
   * for nobody, 0 or 1 for that player alone and 2 for both — and not
   * `g_players_in_play` (`0x009C8E80`). The two are different questions and
   * they differ in exactly the case this opcode exists for: one player is in
   * play, and the arms select *which* of the two player characters stands in
   * the cut scene.
   */
  IfActivePlayer = 10,
  /** Ride an object path. */
  FollowPath = 11,
  /**
   * `obj+0x1364` — a **persistent** bone decoration. Mode 1 sets it and mode 0
   * clears it; the per-bone draw hook then decorates bone 2 for as long as it
   * is set. It used to be read here as a one-shot effect.
   */
  SetBoneDecoration = 12,
  /** `PlaySoundId`. */
  PlaySound = 13,
  /**
   * `obj+0x1330` — which of the character's hand props is drawn.
   *
   * It **is** a draw mode. `ScriptedHumanoidDraw` (`FUN_00484FF0`) never reads
   * it, which had been taken to mean nothing did; the reader is
   * `ScriptedHumanoidBoneDrawHook` (`FUN_00485260`), the per-bone callback
   * `ScriptedHumanoidInit` (`FUN_004840D0`) installs at `obj+0x12EC`.
   * Mode 2 also zeroes the cel counter at `obj+0x1334`.
   */
  SetBonePropMode = 14,
  /** Jump. */
  Jump = 15,
  /** Swap one bone's draw slot. */
  SetBoneModel = 16,
  /** Hand the object to another routine entirely. */
  Handoff = 17,
  /** `ActorKill`. */
  Kill = 18,
  /**
   * Fall out of the VM: the engine writes `ScriptedHumanoidIdle`
   * (`FUN_00484D40`) over the object's entry point and the actor stops
   * turning, stops following its path and stops counting.
   */
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
  /**
   * The actor is **farther** from the point than it was last frame.
   *
   * `[proved]`, and the port had it inverted. `0x004845AE`-`0x004845FD` builds
   * `|pos - point|` and `|prevPos - point|` in that order and ends
   * `FXCH; FXCH; FCOMPP` (`d9c9 d9c9 ded9`), which compares `|prev|` against
   * `|pos|`; `0x00484601 TEST AH,0x1` (`f6c401`) reads **C0**, set when the
   * first is the smaller, and `0x00484604 JZ 0x00484A7B` (`0f8471040000`)
   * takes the blocked path when it is clear. So the command proceeds only
   * while the previous distance was the shorter one — the actor is receding.
   * Both `FXCH`es are the compiler shuffling the pair back into place and
   * cancel; the operand order is what the comparison turns on.
   *
   * Two shipped commands use it, both in stage 1 (0x64FC and 0x6658, `op 4`
   * mode 4), and both are waiting for something to walk away.
   */
  FartherThanBefore = 4,
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
  /**
   * {@link HumanoidOp.IfActivePlayer} modes 0, 1 and 2 only: the index the
   * test skips to when `g_active_player` does not match it.
   */
  skip?: number;
}

/** One spawn's program and the fields the Init reads. */
export interface HumanoidProgram {
  charType: number;
  removePath: number;
  removeFrame: number;
  /**
   * `desc + 0x2A` — the decoration selector `ScriptedHumanoidDraw`
   * (`FUN_00484FF0`) switches on, `*(int16*)(obj+0x1390 + 6)`.
   *
   * No arm of the VM reads it — it is a draw-time field. `ScriptedHumanoidInit`
   * copies it onto the actor as `HumanoidTail.drawVariant`, which is where the
   * renderer reads it and where the reason for the copy is written down. Zero
   * for 129 of the six stages' 137 spawns.
   *
   * Optional because a bundle written before it existed has no such field,
   * and absent reads as the "draws nothing" case.
   */
  drawVariant?: number;
  flags2: number;
  motion: number;
  phase: number;
  cmds: HumanoidCmd[];
}

/** `obj+0x34` bit that swaps the removal trigger, as for class 0x24. */
export const HUMANOID_FLAG_REMOVE_ON_SCRIPT_FLAG = 0x2000000;


// -- exe `.rdata`, not the bundle ------------------------------------------
//
// Two tables this class reads out of the image. They are not authored per
// stage and no exporter emits them, so they travel with the code that reads
// them — the same call `class30/ring.ts` makes for its own immediates.

/** One row of `g_class25_path_offsets` — `0x00596B18`. 24 bytes. */
export interface HumanoidPathOffset {
  /** `+0x00/04/08`, rotated through the path's orientation and added to pos. */
  dx: number; dy: number; dz: number;
  /** `+0x10`, added to `obj+0x68` unmasked when non-zero. */
  dyaw: number;
}

/**
 * `g_class25_path_offsets` — `0x00596B18`. The attachment offset `op 11`'s
 * `b` names, on top of whatever object path the actor is riding.
 *
 * **Fifteen records**, `0x00596B18`..`0x00596C7F`, ending exactly where
 * `g_class25_bone_prop_cels` — `0x00596C80` begins; the extent used to be
 * `[open]` and that abutment is what closes it. Index 0 is the "no offset"
 * sentinel and is all zeroes. Record 1's `dyaw` of `0x8000` is exactly a half
 * turn, which is the check on the reading; shipped data reaches indices 1..5.
 *
 * `+0x0C` and `+0x14` are zero in all fifteen and nothing reads them.
 */
export const g_class25_path_offsets: readonly HumanoidPathOffset[] = [
  { dx: 0, dy: 0, dz: 0, dyaw: 0 },
  { dx: 4.5, dy: 3.0, dz: -1.5, dyaw: 0x8000 },
  { dx: -7.35, dy: 0, dz: 3.78, dyaw: 0 },
  { dx: -1.54, dy: 0, dz: 6.97, dyaw: 0 },
  { dx: 4.62, dy: -8.0, dz: 1.42, dyaw: 0x8000 },
  { dx: -4.78, dy: -8.0, dz: 0.86, dyaw: 0x8000 },
  { dx: 4.56, dy: -8.28, dz: -7.02, dyaw: 0x8000 },
  { dx: -4.68, dy: -8.28, dz: -7.02, dyaw: 0x8000 },
  { dx: 0.56, dy: 0.89, dz: -3.12, dyaw: 0 },
  { dx: 2.66, dy: 0.89, dz: 4.18, dyaw: 0 },
  { dx: -4.92, dy: 0, dz: 0, dyaw: 0x8000 },
  { dx: 4.95, dy: 0, dz: 0, dyaw: 0x8000 },
  { dx: 4.5, dy: 6.6, dz: -2.9, dyaw: 0x18e3 },
  { dx: 4.0, dy: 6.6, dz: -6.5, dyaw: 0x18e3 },
  { dx: 5.0, dy: 6.6, dz: 0.7, dyaw: 0x238e },
];

// The two cel tables the counter at `obj+0x1334` feeds are the renderer's and
// are not transcribed here: `g_class25_bone_prop_cels` — `0x00596C80` (a
// ping-pong ramp 0->6->0, used when `bonePropMode` is 2) and
// `g_class25_bone_prop_cels_alt` — `0x00596C90` (a two-cel blink, used when it
// is 1). `ScriptedHumanoidBoneDrawHook` (`FUN_00485260`) indexes both with
// `bonePropFrame % 13`, and each table is exactly thirteen bytes long. The
// port keeps the counter because the VM writes it, and nothing more.

/**
 * The object-path slots that get an extra lift.
 *
 * `[proved]`, and unexplained: with an offset record applied, slots `0x156`
 * through `0x15C` inclusive take a further `+2.0` in y —
 * `CMP EAX,0x156; JL; CMP EAX,0x15c; JG; FLD; FADD double ptr [0x0055caf8];
 * FSTP float ptr [EDI + 0x44]` at `0x00484C0C`–`0x00484C2A`, and
 * `0x0055CAF8` reads `00 00 00 00 00 00 00 40` = 2.0.
 */
export const PATH_SLOT_LIFT_LO = 0x156;
export const PATH_SLOT_LIFT_HI = 0x15c;
export const PATH_SLOT_LIFT = 2.0;

/** The character types `ScriptedHumanoidInit` seeds `bonePropMode` to 1 for. */
export const BONE_PROP_CHAR_LO = 0x39;
export const BONE_PROP_CHAR_HI = 0x3b;

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
export function ScriptedHumanoidInit(obj: HumanoidActor): void {
  // `model+0x1170 = *(u32 *)(tail + 8)`, then `ActorBindPartList` --
  // the same two instructions `CivilianInit` runs, at the same tail
  // offset. Five of the game's class-0x25 spawns carry a list.
  ActorBindPartList(obj);
  const p = HumanoidProgramOf(obj);
  obj.hum.pc = 0;
  obj.hum.stallFrames = 0;
  // The Init pre-applies the first command: `obj+0x1324 = 1` when the block
  // opens with an op-1 wait, so an actor whose first instruction is "hold"
  // does not play a frame before it takes effect.
  obj.frozen = 0;
  obj.hum.turnMode = HumanoidTurn.None;
  obj.hum.turnFrames = 0;
  obj.hum.turnStep = 0;
  obj.hum.turnTarget = 0;
  // [port-only] `+0x135C` is one of two words in the tail the Init leaves
  // alone; the port seeds it so a `pathMode` of 0 can never index a slot.
  obj.hum.pathSlot = -1;
  obj.hum.pathMode = 0;
  obj.hum.pathOffsetRecord = 0;
  // [port-only] The descriptor word `desc + 0x2A`, cached on the actor. The
  // engine re-reads it in `ScriptedHumanoidDraw` (`FUN_00484FF0`) every draw
  // and it cannot change; see {@link HumanoidTail.drawVariant} for why the
  // port keeps a copy instead.
  obj.hum.drawVariant = p?.drawVariant ?? HumanoidDrawVariant.None;
  obj.hum.boneDecoration = 0;
  obj.hum.bonePropFrame = 0;
  // `MOVSX ECX, word ptr [EDI + 0x60]` (= `obj+0x1F4`), `CMP ECX,0x39 / JL /
  // CMP ECX,0x3b / JG` at `0x00484247`-`0x00484253`: character types 0x39
  // through 0x3B open with hand prop 1, everything else with 0.
  obj.hum.bonePropMode =
    (obj.charType >= BONE_PROP_CHAR_LO && obj.charType <= BONE_PROP_CHAR_HI)
      ? 1 : 0;
  if (!p) return;
  if (p.cmds[0]?.op === HumanoidOp.WaitThenHold) obj.frozen = 1;
  obj.motion = p.motion;
  const m = T.types[String(obj.charType)]?.motions[String(p.motion)];
  const fps = m?.fps ?? 30;
  // `rand() % 10` rather than a frame anywhere in the clip: the phase here is
  // a tenth of a second's worth of stagger, not a random pose.
  obj.playTicks = ticksOfAuthoredFrame(p.phase === -1 ? 0 : p.phase, fps);
}

/** The removal test, identical in shape to class 0x24's. */
export function HumanoidShouldRemove(obj: HumanoidActor, p: HumanoidProgram): boolean {
  if ((obj.flags & HUMANOID_FLAG_REMOVE_ON_SCRIPT_FLAG) !== 0) {
    return G.g_script_flags[p.removePath] === 1;
  }
  return G.g_active_cam_path === p.removePath
      && G.g_cam_path_frame >= p.removeFrame;
}

/** The **authored** frame the clip is showing — not the 60 Hz play cursor. */
function MotionFrame(obj: HumanoidActor): number {
  const m = T.types[String(obj.charType)]?.motions[String(obj.motion)];
  return authoredFrameOfTicks(obj.playTicks, m?.fps ?? 30, m?.frames ?? 0);
}

function AtLastMotionFrame(obj: HumanoidActor): boolean {
  const m = T.types[String(obj.charType)]?.motions[String(obj.motion)];
  return !!m?.frames && MotionFrame(obj) >= m.frames - 1;
}

/** Whether a command's condition is met. Shared by opcodes 0, 1 and 4. */
function CondMet(obj: HumanoidActor, c: HumanoidCmd): boolean {
  switch (c.mode) {
    case HumanoidCond.Frames:
      return obj.hum.stallFrames === c.a;
    case HumanoidCond.CameraAt:
      return G.g_active_cam_path === c.a && G.g_cam_path_frame >= c.b;
    case HumanoidCond.MotionFrame:
      return c.a === -1 ? AtLastMotionFrame(obj) : MotionFrame(obj) === c.a;
    case HumanoidCond.ScriptFlag:
      return G.g_script_flags[c.a] === 1;
    case HumanoidCond.FartherThanBefore: {
      // The actor has to be **receding**: the engine blocks unless
      // `|prevPos - point| < |pos - point|`. See the enum member for the
      // instructions. Measured flat, x and z only, as every range test in this
      // game is.
      const px = c.f0 ?? 0, pz = c.f1 ?? 0;
      const now = Math.hypot(obj.pos.x - px, obj.pos.z - pz);
      const was = Math.hypot(obj.hum.prevPos.x - px, obj.hum.prevPos.z - pz);
      return was < now;
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
export function ScriptedHumanoidUpdate(obj: HumanoidActor, f: ClassFrame): void {
  const p = HumanoidProgramOf(obj);
  if (!p) return;

  // Opcode -1 wrote `ScriptedHumanoidIdle` over the object's entry point
  // (`MOV dword ptr [EDI], 0x484d40` @`0x00484A87`), so from the *next* frame
  // this routine is not what the engine calls. The port dispatches on the
  // cursor instead, which is the same call made once removed.
  if (obj.hum.pc < 0) {
    ScriptedHumanoidIdle(obj);
    return;
  }

  if (HumanoidShouldRemove(obj, p)) {
    obj.dead = true;
    obj.visible = false;
    return;
  }

  let ran = 0;
  while (ran++ < MAX_COMMANDS_PER_FRAME) {
    const c = p.cmds[obj.hum.pc];
    if (!c) break;
    if (!RunCommand(obj, c, f)) break;
  }
  HumanoidFrameTail(obj, f);
}

/** One command. Returns whether the cursor moved — false parks the VM. */
function RunCommand(obj: HumanoidActor, c: HumanoidCmd, f: ClassFrame): boolean {
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
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;

    case HumanoidOp.WaitUntil:
      if (!CondMet(obj, c)) return false;
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;

    case HumanoidOp.SetMotion:
    case HumanoidOp.SetMotionBlended: {
      obj.motion = c.a;
      obj.playTicks = 0;
      obj.rootFrame = -1;
      // Mode 1 clears the draw flag and mode 2 sets it; `SetMotion` also takes
      // a phase in `b`, and -1 there is the same tenth-of-a-second stagger.
      if (c.op === HumanoidOp.SetMotion && c.b !== -1) {
        const m = T.types[String(obj.charType)]?.motions[String(c.a)];
        obj.playTicks = ticksOfAuthoredFrame(c.b, m?.fps ?? 30);
      }
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;
    }

    case HumanoidOp.TurnOver:
      obj.hum.turnFrames = c.a;
      obj.hum.turnMode = HumanoidTurn.Over;
      // Mode 0 turns one way and mode 1 the other; both divide the sweep by
      // the frame count, which is what makes it a constant-rate turn.
      obj.hum.turnStep = (c.mode === 0 ? -1 : 1) * Math.trunc(c.b / Math.max(1, c.a));
      obj.hum.turnTarget = obj.yaw + (c.mode === 0 ? -c.b : c.b);
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;

    case HumanoidOp.TurnMode:
      obj.hum.turnMode = c.mode === 1 ? HumanoidTurn.FaceCamera : HumanoidTurn.None;
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;

    case HumanoidOp.FacePoint:
      obj.yaw = VecToAngles(obj.pos.x - (c.f0 ?? 0), 0,
                            obj.pos.z - (c.f1 ?? 0)).yaw & 0xffff;
      obj.hum.turnMode = HumanoidTurn.None;
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;

    case HumanoidOp.SetPos:
      if (c.mode === 1) obj.pos.y = c.f0 ?? obj.pos.y;
      else { obj.pos.x = c.f0 ?? obj.pos.x; obj.pos.z = c.f1 ?? obj.pos.z; }
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;

    case HumanoidOp.FollowPath:
      // Mode 0 stops following; 1 takes the path's rotation too, 2 only its
      // position. Anything above 2 falls straight through to `0x004848A4` and
      // writes nothing but the stall reset -- it does **not** set `pathMode`,
      // which a bare `pathMode = mode` would.
      if (c.mode === 0) obj.hum.pathMode = 0;
      else if (c.mode === 1 || c.mode === 2) {
        obj.hum.pathMode = c.mode;
        obj.hum.pathSlot = c.a;
        obj.hum.pathOffsetRecord = c.b;
      }
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;

    case HumanoidOp.PlaySound:
      // The id is a full dword at `+4`, not the s16 the other opcodes use.
      f.events?.emit("sound.play", { id: (c.a & 0xffff) | (c.b << 16) });
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;

    case HumanoidOp.SetBonePropMode:
      // `0x0048490C`-`0x00484956`: mode 0, 1 and 2 write 0, 1 and 2, and mode
      // 2 alone restarts the cel counter. Any other mode leaves both alone.
      if (c.mode === 2) {
        obj.hum.bonePropMode = 2;
        obj.hum.bonePropFrame = 0;
      } else if (c.mode === 1) obj.hum.bonePropMode = 1;
      else if (c.mode === 0) obj.hum.bonePropMode = 0;
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;

    case HumanoidOp.SetBoneDecoration:
      // `0x004848B2`-`0x004848E4`: mode 1 sets the toggle and calls
      // `FUN_00485D70` (`[open]`, and the renderer's), mode 0 clears it, and
      // any other mode leaves it as it was.
      if (c.mode === 1) obj.hum.boneDecoration = 1;
      else if (c.mode === 0) obj.hum.boneDecoration = 0;
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;

    case HumanoidOp.Jump:
      if (c.next === undefined || c.next < 0) return false;
      obj.hum.pc = c.next;
      obj.hum.stallFrames = 0;
      return true;

    case HumanoidOp.IfActivePlayer:
      // `0x0048478C`-`0x00484833`. Only modes 0, 1 and 2 test anything; every
      // other mode -- `-2`, which is the marker closing an arm -- steps the
      // cursor and does nothing else. On a match the cursor also just steps,
      // into the arm; on a mismatch it goes to `skip`, which the exporter
      // resolved from the engine's forward scan for that marker.
      //
      // **This used to always fall through**, on the reasoning that one
      // player is the port's only configuration so "taking the matching arm is
      // the same decision". It is not the same decision: the arm an `op 10`
      // guards is frequently `op 18` (`ActorKill`), and falling into it killed
      // the actor the test exists to keep. Stage 3's block 2 spawns both
      // player characters and kills the one the active player is not; the port
      // killed both, and the whole of the cut scene's foreground was missing.
      obj.hum.stallFrames = 0;
      if (c.mode === 0 || c.mode === 1 || c.mode === 2) {
        if (G.g_active_player === c.mode) obj.hum.pc += 1;
        else if (c.skip !== undefined && c.skip >= 0) obj.hum.pc = c.skip;
        // [port-only] A bundle written before `skip` was carried, or a scan
        // that ran off the end of the file. The engine cannot be in this
        // position — its skip is a scan it makes on the spot. Leaving the VM
        // is what `op -1` does: the actor stays drawn on its current clip,
        // which is wrong but visible, where running the arm regardless is how
        // it came to be deleted.
        else { obj.hum.pc = -1; return false; }
      } else obj.hum.pc += 1;
      return true;

    case HumanoidOp.Kill:
    case HumanoidOp.End:
      // `-1` installs the idle routine and `18` is `ActorKill`; both leave the
      // VM. The actor stays drawn for `End` and goes for `Kill`.
      if (c.op === HumanoidOp.Kill) { obj.dead = true; obj.visible = false; }
      obj.hum.pc = -1;
      return false;

    // [diverges] These three need routines this port has not read:
    // `op 9` and `op 16` swap a model from per-character tables at
    // `0x004EC9E0` and `PTR_DAT_004C7160`, and `op 17` hands the object to one
    // of five other update routines. The command is stepped over so the rest
    // of the program still runs — stalling on it would park the actor for ever.
    case HumanoidOp.SetHandModel:
    case HumanoidOp.SetBoneModel:
    case HumanoidOp.Handoff:
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;

    default:
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;
  }
}

/**
 * The tail every blocked frame runs: count the stall, turn, ride the path, and
 * remember where we were for the `FartherThanBefore` test.
 *
 * `0x00484A8D`-`0x00484C7C`, and it belongs to `ScriptedHumanoidUpdate`
 * (`FUN_004842A0`) alone. The frame that runs `op -1` reaches it — the entry
 * point is overwritten at `0x00484A87` and execution falls straight through —
 * but no frame after that does, because `ScriptedHumanoidIdle`
 * (`FUN_00484D40`) has none of it.
 */
function HumanoidFrameTail(obj: HumanoidActor, f: ClassFrame): void {
  obj.hum.stallFrames += 1;

  if (obj.hum.turnMode === HumanoidTurn.Over) {
    obj.yaw += obj.hum.turnStep;
    obj.hum.turnFrames -= 1;
    if (obj.hum.turnFrames === 0) {
      // The last frame snaps to the target rather than accumulating rounding.
      obj.yaw = obj.hum.turnTarget;
      obj.hum.turnMode = HumanoidTurn.None;
    }
  } else if (obj.hum.turnMode === HumanoidTurn.FaceCamera) {
    obj.yaw = VecToAngles(obj.pos.x - f.eye.x, 0, obj.pos.z - f.eye.z).yaw
      & 0xffff;
  }

  if (obj.hum.pathMode !== 0 && obj.hum.pathSlot >= 0) {
    // `CamEvalObjectPath6(slot, g_cam_path_frame)` — the object paths run on
    // the *camera's* frame, which is what keeps a scripted actor in step with
    // the shot it belongs to.
    const p = f.host.objectPath?.(obj.hum.pathSlot, G.g_cam_path_frame);
    if (p) {
      obj.pos.x = p.x;
      obj.pos.y = p.y;
      obj.pos.z = p.z;
      // Mode 2 takes the position only; mode 1 takes the orientation too.
      //
      // **The engine writes all three angles here**, not just the yaw:
      // `MOV [EDI+0x64],EAX; MOV [EDI+0x68],ECX; MOV [EDI+0x6c],EDX` at
      // `0x00484B6E`-`0x00484B74`, out of `CamEvalObjectPath6`'s second half,
      // and `CMP [EDI+0x1358],0x2 / JZ` at `0x00484B5D` is the mode-2 skip.
      // `[open]` The port writes the yaw alone because the yaw is the only one
      // `render/characters.ts` draws -- `inst.root.rotation.set(0, yaw, 0)` --
      // so writing the other two would put a value on the actor that nothing
      // reads. Giving a rider the path's pitch and roll is a renderer change
      // and its own piece of work.
      if (obj.hum.pathMode !== 2 && p.yaw !== undefined) obj.yaw = p.yaw;
      // The offset vector, though, **is** rotated by all three, and that is
      // this file's own arithmetic rather than the renderer's.
      HumanoidApplyPathOffset(obj, p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0);
    }
  }

  obj.hum.prevPos.x = obj.pos.x;
  obj.hum.prevPos.y = obj.pos.y;
  obj.hum.prevPos.z = obj.pos.z;
}

/**
 * The attachment offset the followed path carries, from
 * `g_class25_path_offsets` — `0x00596B18`.
 *
 * `[proved]` at `0x00484B77`–`0x00484C79`, and it is why `obj+0x1360` is a
 * record index rather than a distance: the record's three floats are rotated
 * through the **path's** orientation and added to the position, its `+0x10` is
 * added to the yaw unmasked, and a slot in `PATH_SLOT_LIFT_LO`..`_HI` takes a
 * further 2.0 in y on top. The port stored the index and never read it, so a
 * scripted actor rode its path with none of this applied — 22 of the 24
 * `op 11` commands the six stages carry name a non-zero record.
 *
 * The engine builds the rotation as
 * `MatrixLoadIdentity; MatrixRotateZ(rz); MatrixRotateY(ry); MatrixRotateX(rx)`
 * and the stack post-multiplies, so **X applies to the vector first and Z
 * last** — the same composition `class41/prop.ts` spells out for `Ry·Rz·Rx`.
 *
 * All three angles come from the path. This note used to declare a
 * `[diverges]` saying that `rx` and `rz` "arrive as zero, because
 * `GameHost.objectPath` publishes only the path's position and yaw" — and by
 * the time anyone read it the seam published all six, with `host.ts`'s own
 * comment saying the pitch and roll were added "so the attachment-offset
 * rotation in `class25` can stop passing zeros for them". It went on passing
 * zeros. That is `L26`: a divergence declared in prose is a claim with an
 * alibi, and it read as though the case had been thought about and settled.
 * `op_st3` 340's `rot_x` runs to 15,758 BAMS, so the zeros were not harmless
 * on the one path the boat riders use.
 *
 * Private, and deliberately: the engine has this inline in
 * `ScriptedHumanoidUpdate`'s tail and there is no exe function here to name.
 */
function HumanoidApplyPathOffset(obj: HumanoidActor, rx: number, ry: number,
                                 rz: number): void {
  const r = g_class25_path_offsets[obj.hum.pathOffsetRecord];
  // Index 0 is the sentinel and the engine's `JZ` skips the whole block.
  if (obj.hum.pathOffsetRecord === 0 || !r) return;

  const bams = (a: number) => (a * Math.PI * 2) / 65536;
  let ca = Math.cos(bams(rx)), sa = Math.sin(bams(rx));
  let x = r.dx;
  let y = r.dy * ca - r.dz * sa;
  let z = r.dy * sa + r.dz * ca;

  ca = Math.cos(bams(ry)); sa = Math.sin(bams(ry));
  const yx = x * ca + z * sa;
  z = -x * sa + z * ca;
  x = yx;

  ca = Math.cos(bams(rz)); sa = Math.sin(bams(rz));
  const zx = x * ca - y * sa;
  y = x * sa + y * ca;
  x = zx;

  obj.pos.x += x;
  obj.pos.y += y;
  obj.pos.z += z;

  if (obj.hum.pathSlot >= PATH_SLOT_LIFT_LO && obj.hum.pathSlot <= PATH_SLOT_LIFT_HI) {
    obj.pos.y += PATH_SLOT_LIFT;
  }

  // `MOV ECX,[EBP+0x10]; MOV EDX,[ESI]; ADD EDX,ECX; MOV [ESI],EDX` with
  // `ESI = obj+0x68` at `0x00484C69`-`0x00484C72`. No mask: the engine lets
  // the yaw run outside 0..0xFFFF here, as `op 5`'s `turnTarget` does.
  if (r.dyaw !== 0) obj.yaw += r.dyaw;
}

/**
 * `ScriptedHumanoidIdle` — `FUN_00484D40`. What opcode -1 installs.
 *
 * `[proved]` exhaustively: the cutscene-skip teardown, the same removal test
 * `ScriptedHumanoidUpdate` (`FUN_004842A0`) opens with, then
 * `ScriptedHumanoidDraw` (`FUN_00484FF0`) and `RET` at `0x00484DE2`.
 *
 * **And nothing else** — no `obj+0x1320` step, no turn, no object-path follow,
 * no `obj+0x13C0` capture. So a class-0x25 actor whose program has ended stops
 * dead where it stands. The port used to leave `pc` at -1 and keep running
 * `HumanoidFrameTail` every frame, which kept the 69 of the six stages' 137
 * scripted humanoids that reach an `op -1` turning and riding their paths for
 * ever after their programs had finished.
 *
 * The skip teardown is not ported: `g_cutscene_skipping` — `0x009A2230` is
 * never raised, because the player has no cutscene skip.
 */
export function ScriptedHumanoidIdle(obj: HumanoidActor): void {
  const p = HumanoidProgramOf(obj);
  if (!p) return;
  if (HumanoidShouldRemove(obj, p)) {
    obj.dead = true;
    obj.visible = false;
  }
  // `CALL 0x00484FF0` — the draw, which is the renderer's.
}

export const ScriptedHumanoidHandler: ClassHandler = {
  init: ScriptedHumanoidInit,
  update: ScriptedHumanoidUpdate,
  debug: ScriptedHumanoidDebug,
};

/**
 * A bytecode VM driving a skinned character. Not an enemy.
 */
registerClass(SpawnClass.ScriptedHumanoid, ScriptedHumanoidHandler);

/**
 * Class 0x25 — the script-driven humanoid. 142 spawns, 137 of them reached.
 *
 * The second-largest class in the game, and a **bytecode VM**. The spawn's
 * parameter tail points at a command block; the Init at `0x004840D0`
 * installs the VM at `0x004842A0` as the object's entry point and never runs
 * again, and that routine walks 8-byte commands until one of them blocks.
 * (Both are ported below, so they are named here by address -- `L42`.)
 *
 * It is **not an enemy**: not damageable, awards nothing, and not even shot at.
 * It holds a hit slot, as every skinned actor does, but nothing in the class
 * files it for the shot test, so a bullet passes through it -- see the handler
 * at the foot of the file. What it is, is the game's cutscene
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
import type { Rng } from "../../core/rng";
import { MotionFlag, type Actor, type HumanoidActor } from "../actor";
import { ActorBindPartList } from "../attachments";
import { ActorSetMotion, ActorSetMotionBlended } from "../class30/motion_cue";
import { ScriptedHumanoidDebug } from "./debug";
import { SpawnBloodSpray } from "../effects/blood";
import { SpawnSpriteEffect, SpriteEffectKind } from "../effects/sprite";
import { G, HIT_SLOT_NONE } from "../globals";
import { GameMode } from "../game_mode";
import { ActorFreeHitSlot } from "../hit_slots";
import {
  registerClass, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { HumanoidDrawVariant, HumanoidRoutine } from "./state";
import { CharacterTypeOf, MotionPlayFrame, MotionPlayLength, T }
  from "../tables";
import { vec3, VecToAngles } from "../vec";

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
  /**
   * Bone 5's draw slot from `g_player_hand_slots[3*a + mode]` -- `a` a
   * character's row, `mode` one of its three hand models. See
   * {@link RunCommand}'s arm for the Original Mode row.
   */
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
   * `obj+0x1364` — **the head follows the camera**, persistently. Mode 1 sets
   * it and seeds the aim, mode 0 clears it; `ScriptedHumanoidBoneDrawHook`
   * then turns bone 2 through `ScriptedHumanoidAimHeadAtCamera`
   * (`FUN_00485BA0`) for as long as it is set. It used to be read here as a
   * one-shot effect, and then as a bone "decoration", before either routine
   * was read.
   */
  SetHeadAim = 12,
  /** `PlaySoundId`. */
  PlaySound = 13,
  /**
   * `obj+0x1330` — which of the character's hand props is drawn.
   *
   * It **is** a draw mode. `ScriptedHumanoidDraw` (`FUN_00484FF0`) never reads
   * it, which had been taken to mean nothing did; the reader is
   * `ScriptedHumanoidBoneDrawHook` (`FUN_00485260`), the per-bone callback
   * the Init at `0x004840D0` installs at `obj+0x12EC`.
   * Mode 2 also zeroes the cel counter at `obj+0x1334`.
   */
  SetBonePropMode = 14,
  /** Jump. */
  Jump = 15,
  /**
   * Blood on bone `a`, then bone `a`'s draw slot from the character's effect
   * table at `6*a + b` -- a scripted wound, shot on cue.
   */
  SetBoneModel = 16,
  /**
   * Five different things by mode, and only three of them leave the VM:
   * modes 0, 1 and 4 install {@link HumanoidRoutine.FallAndSplash},
   * {@link HumanoidRoutine.LaunchAndDrop} and {@link HumanoidRoutine.FallTimed}
   * over the object's entry point and end the frame; modes 2 and 3 spawn a
   * sprite at a point the routine names and run on. See {@link HumanoidHandoff}.
   */
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
  /**
   * The play cursor **is** `a`, or `g_motion_play_length - 1` when `a` is -1
   * -- an equality, in the engine's 60 Hz cursor over the 30 Hz clip. See
   * {@link HumanoidTail.playCursor}. `op 0` never proceeds on it.
   */
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
  /**
   * The index of the block's first command (`blk + 8`), where the Init points
   * the cursor. `cmds` is in address order and a program can jump back into
   * commands stored before its own block -- stage 4's player pair share their
   * tails that way -- so it is not always 0.
   */
  entry: number;
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
 * `g_class25_bone_prop_cels` — `0x00596C80` begins; the extent used to be an
 * open question, and that abutment is what answers it. Index 0 is the "no
 * offset" sentinel and is all zeroes. Record 1's `dyaw` of `0x8000` is exactly
 * a half turn, which is the check on the reading; shipped data reaches indices
 * 1..5.
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

// -- the two commands that write a bone's draw slot --------------------------

/**
 * `op 9`'s bone: `MOV dword ptr [EDI + 0x4dc], EAX` at `0x0048477B`, and the
 * bone records are `obj + 0x20C + bone*0x90` -- `0x4DC` is bone 5's `+0x00`.
 */
export const HAND_BONE = 5;
/** `LEA ECX, [EAX + EAX*2]` at `0x0048476B`: a character's row is three wide. */
export const HAND_SLOT_VARIANTS = 3;
/**
 * `op 16`'s row stride: `LEA EAX, [EAX + EAX*2]` then `LEA EDX, [EDX + EAX*2]`
 * at `0x0048498D`/`0x00484993` -- `6*a + b`, six steps a bone, the stride
 * `ResolveHit` walks the same table at.
 */
export const BONE_EFFECT_STEPS = 6;
/**
 * `CMP EAX, 0x2; JLE` at `0x004849B9`: 0, 1 and 2 are the effect table's
 * control codes, and `op 16` leaves the bone alone for them.
 */
export const BONE_EFFECT_CONTROL_MAX = 2;
/** `PUSH 0x3f400000` at `0x00484976` -- `SpawnBloodSpray`'s severity, 0.75. */
export const BONE_MODEL_BLOOD = 0.75;

/** The character types `ScriptedHumanoidInit` seeds `bonePropMode` to 1 for. */
export const BONE_PROP_CHAR_LO = 0x39;
export const BONE_PROP_CHAR_HI = 0x3b;

/** How many commands may run in one frame before the VM is called stuck. */
export const MAX_COMMANDS_PER_FRAME = 256;

// -- the routines `op 17` hands over to -------------------------------------
//
// Immediates and `.rdata` constants, each read at the instruction that loads
// it. The float ones are the float32 the word holds, not the decimal the
// decompiler rounds it to.

/** `SpawnSpriteEffect`'s last two: face the camera fully, or by yaw alone. */
const SPRITE_FACE_CAMERA = 1;
const SPRITE_FACE_CAMERA_YAW = 2;
const SPRITE_NO_PLAYER = -1;

/** `FSUB double ptr [0x0055D188]` — `ScriptedHumanoidFallAndSplash`'s gravity. */
export const FALL_SPLASH_GRAVITY = 0.02;
/**
 * `FCOMP double ptr [0x00569480]` then `TEST AH, 0x41` — the height at or
 * below which the fall ends. `728a8ee4f2ff3bc0` = -27.9998.
 */
export const FALL_SPLASH_FLOOR = -27.9998;
/** `MOV [ESP+0x18], 0xc1c7ff97` — the splash's height, not the actor's. */
export const FALL_SPLASH_Y = -24.999799728393555;

/** `MOV [ESI+0x50], 0x41a00000` — the launch's first rise per frame. */
export const LAUNCH_VY = 20.0;
/** `FSUB float ptr [0x00569488]` — the x the launch throws away from. */
export const LAUNCH_ORIGIN_X = 231.5;
/**
 * `FSUB float ptr [0x00565E1C]` (`2301df3c`) — the per-frame step of the
 * launch's gravity **and** of the timed fall's, 0.027222222 as a float32.
 */
export const GRAVITY_STEP = 0.027222221717238426;
/** `FCOMP float ptr [0x004C436C]` — 0.0: the launch ends below it. */
export const LAUNCH_FLOOR = 0.0;

/** `MOV [EDI+0x50], 0xbed11111` — `op 17` mode 4's opening fall speed. */
export const FALL_TIMED_START_VY = -0.40833333134651184;
/** `CMP EAX, 0xc8; JLE` — the timed fall dies on its 201st frame. */
export const FALL_TIMED_FRAMES = 200;

/**
 * `op 17` mode 3's sprite: kind 0x41 -- `impact_sprite["65"]` in the bundle,
 * a 76-cel strip with no ricochet sound -- at one of two fixed points.
 */
const HANDOFF_SPLASH_KIND = 0x41;
const HANDOFF_SPLASH_BLOCK = 9;
/** `c33d4ccd`, `c4bc2000` at `0x00484A05`/`0x00484A15`, for block 9. */
const HANDOFF_SPLASH_B9 = { x: -189.3000030517578, z: -1505.0 };
/** `c49e0000`, `c4a92000` at `0x00484A1F`/`0x00484A2F`, anywhere else. */
const HANDOFF_SPLASH = { x: -1264.0, z: -1353.0 };
/** `c1c73333` — both points' height. */
const HANDOFF_SPLASH_Y = -24.899999618530273;

/** `op 17` mode 2's sprite: `c479e000`, `404f5c29`, `c4a20666`, yaw `0xC000`. */
const FIXED_IMPACT = { x: -999.5, y: 3.240000009536743, z: -1296.199951171875 };
const FIXED_IMPACT_YAW = 0xc000;

export function HumanoidProgramOf(a: Actor): HumanoidProgram | null {
  return T.humanoids?.[String(a.at)] ?? null;
}

/**
 * `ScriptedHumanoidInit` — `FUN_004840D0`.
 *
 * [diverges] Original Mode -- `g_GameMode == 1`, `DEC EAX; JZ` at
 * `0x00484106`; this note said Boss Mode -- remaps character types 0x39 and
 * 0x3A through `g_original_character` before the model is built: `c <= 7`
 * gives `0x39 + c`, 8 gives 0x21, 9 gives 0x34, and anything else leaves the
 * type unwritten (`0x00484116`-`0x00484183`). The port builds the model in
 * `ActorSpawn`, before this runs, so the remap has no place here. With
 * `g_original_character` as its one writer leaves it -- the player index --
 * the remap is 0x39 to 0x39 and 0x3A to 0x3A, so nothing a shipped stage can
 * reach draws differently; it would take a writer of another character.
 */
export function ScriptedHumanoidInit(obj: HumanoidActor, rng?: Rng): void {
  // `model+0x1170 = *(u32 *)(tail + 8)`, then `ActorBindPartList` --
  // the same two instructions `CivilianInit` runs, at the same tail
  // offset. Five of the game's class-0x25 spawns carry a list.
  ActorBindPartList(obj);
  const p = HumanoidProgramOf(obj);
  // The Init's last line is `*param_1 = ScriptedHumanoidUpdate`.
  obj.hum.routine = HumanoidRoutine.Update;
  // `MOV [ESI + 0x1394], EBP` at `0x00484282`, `EBP` the block plus 8: the
  // block's own first command, which the bundle names by its index.
  obj.hum.pc = p?.entry ?? 0;
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
  obj.hum.aimsHead = 0;
  obj.hum.bonePropFrame = 0;
  // `MOVSX ECX, word ptr [EDI + 0x60]` (= `obj+0x1F4`), `CMP ECX,0x39 / JL /
  // CMP ECX,0x3b / JG` at `0x00484247`-`0x00484253`: character types 0x39
  // through 0x3B open with hand prop 1, everything else with 0.
  obj.hum.bonePropMode =
    (obj.charType >= BONE_PROP_CHAR_LO && obj.charType <= BONE_PROP_CHAR_HI)
      ? 1 : 0;
  // `param_1[0x4ce] = 0` -- `ScriptedHumanoidFallTimed`'s frame count.
  obj.hum.fallFrames = 0;
  // `ActorBuildSkinnedModel` leaves the sampled cursor at the clip's start.
  obj.hum.playCursor = 0;
  if (!p) return;
  // `CMP word ptr [EBP], 0x1` at `0x00484270`: the first command's op.
  if (p.cmds[p.entry]?.op === HumanoidOp.WaitThenHold) obj.frozen = 1;
  obj.motion = p.motion;
  // `if (*(short *)(blk + 2) == 2) obj+0x1F8 |= 4`, straight after the build.
  if (p.flags2 === 2) obj.motionFlags |= MotionFlag.TraceGround;
  // `*piVar1 = blk+6 == -1 ? rand() % 10 : blk+6` -- written to the **counter**
  // at `obj+0x194`, in the counter's own unit. This took the phase as an
  // authored frame and doubled it, and took -1 as 0 under a comment that said
  // `rand() % 10`: twenty spawns ship -1, two a literal.
  //
  // [port-only] `?? 0` is an Init called with no generator, which is a unit
  // test's `ActorSpawn`; the director always hands one over.
  obj.playTicks = p.phase === -1 ? (rng?.int(10) ?? 0) : p.phase;
}

/** The removal test, identical in shape to class 0x24's. */
export function HumanoidShouldRemove(obj: HumanoidActor, p: HumanoidProgram): boolean {
  if ((obj.flags & HUMANOID_FLAG_REMOVE_ON_SCRIPT_FLAG) !== 0) {
    return G.g_script_flags[p.removePath] === 1;
  }
  return G.g_active_cam_path === p.removePath
      && G.g_cam_path_frame >= p.removeFrame;
}

/**
 * The `mode 2` test both switches make: `obj+0x19C` against `a`, or against
 * `g_motion_play_length[obj+0x1B4] - 1` when `a` is -1 -- `MOVSX ECX, word ptr
 * [EAX*0x2 + 0x4e07d0]; DEC ECX; CMP EAX, ECX`, the same four instructions
 * `ScriptedHumanoidFallAndSplash` opens with.
 *
 * **An equality, on the cursor.** This read the *authored* frame and tested the
 * last one with `>=`, and every number the programs carry says otherwise: 40
 * of the 265 shipped `mode 2` commands name a cursor, and 24 of those name one
 * past the end of the clip in authored frames -- `a=66` and `a=68` on a
 * 35-frame clip whose play length is 68, `a=73` on stage 2's 41-frame 855.
 * Those never fired, so the actor sat on the clip until its removal trigger.
 */
function AtMotionCursor(obj: HumanoidActor, a: number): boolean {
  const want = a === -1 ? MotionPlayLength(obj, obj.motion) - 1 : a;
  return obj.hum.playCursor === want;
}

/**
 * `op 0` and `op 1`'s conditions: `INC ECX; CMP ECX, 0x4; JA 0x00484a8d` at
 * `0x0048437C` over the mode, then the table at `0x00484CF8` -- modes -1, 0, 1,
 * 2 and 3, and **nothing else proceeds**: a mode 4 here is the blocked path,
 * not the point test `op 4` has.
 *
 * Mode 2 tests the **opcode** first (`CMP BP, BX; JZ` at `0x004843CD`, `BP`
 * the op word and `BX` zero) and blocks when it is zero,
 * so an `op 0` never proceeds on a motion cursor. No shipped command is either
 * shape; they are the routine's arms, and so the port's.
 */
function WaitCondMet(obj: HumanoidActor, c: HumanoidCmd): boolean {
  switch (c.mode) {
    case HumanoidCond.Frames:
    case HumanoidCond.CameraAt:
    case HumanoidCond.ScriptFlag:
      return CondMet(obj, c);
    case HumanoidCond.MotionFrame:
      return c.op !== HumanoidOp.WaitThenPlay && AtMotionCursor(obj, c.a);
    case HumanoidCond.Always:
      return true;
    default:
      return false;
  }
}

/**
 * `op 4`'s conditions: `CMP EAX, 0x4; JA 0x00484a8d` at `0x004844E1`, unsigned,
 * then the table at `0x00484D0C` -- modes 0 to 4, and **no** -1: an
 * `op 4 mode -1` is the blocked path and never proceeds. None ships.
 */
function CondMet(obj: HumanoidActor, c: HumanoidCmd): boolean {
  switch (c.mode) {
    case HumanoidCond.Frames:
      return obj.hum.stallFrames === c.a;
    case HumanoidCond.CameraAt:
      return G.g_active_cam_path === c.a && G.g_cam_path_frame >= c.b;
    case HumanoidCond.MotionFrame:
      return AtMotionCursor(obj, c.a);
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

  // `MOV ECX,[0x009a2230]` at `0x004842A0`, the routine's first instruction:
  // a skipped cut scene tears the actor down -- hit slot, part list (unless
  // `+0x1316` keeps it), `ActorKill`.
  if (G.g_cutscene_skipping !== 0) {
    HumanoidKill(obj);
    return;
  }
  if (HumanoidShouldRemove(obj, p)) {
    HumanoidKill(obj);
    return;
  }

  let ran = 0;
  while (ran++ < MAX_COMMANDS_PER_FRAME) {
    const c = p.cmds[obj.hum.pc];
    if (!c) break;
    if (!RunCommand(obj, c, f)) break;
  }
  // `op 18` is `ActorKill`, which does not return: no tail, no draw.
  if (obj.dead) return;
  HumanoidFrameTail(obj, f);
}

/**
 * [port-only] What the engine does by calling `obj+0x00`: run whichever
 * routine is installed. The engine writes a code pointer and calls it; the
 * port writes {@link HumanoidRoutine} and switches, which is the same call made
 * once removed -- class 0x24's `SetPiecePropUpdate` makes the same trade.
 */
export function ScriptedHumanoidRun(obj: HumanoidActor, f: ClassFrame): void {
  switch (obj.hum.routine) {
    case HumanoidRoutine.Update:
      ScriptedHumanoidUpdate(obj, f);
      return;
    case HumanoidRoutine.Idle:
      ScriptedHumanoidIdle(obj);
      return;
    case HumanoidRoutine.FallAndSplash:
      ScriptedHumanoidFallAndSplash(obj, f);
      return;
    case HumanoidRoutine.LaunchAndDrop:
      ScriptedHumanoidLaunchAndDrop(obj);
      return;
    case HumanoidRoutine.FallTimed:
      ScriptedHumanoidFallTimed(obj);
      return;
  }
}

/**
 * The teardown the class writes out inline wherever it dies of its own
 * accord -- the removal test in the VM and the idle routine, and the three
 * routines `op 17` installs: `if (obj+0x3C != -1) ActorFreeHitSlot(obj)`,
 * then `ActorReleasePartList(obj+0x1304)` (all but the one at `0x00484F90`,
 * which skips it), then `ActorKill`.
 *
 * Private, and not an exe function: there is no routine here to name. The
 * part-list release has no counterpart in the port -- it hands back asset
 * loads, and the bundle holds every model -- so the two shapes are one here;
 * `ActorKill` is the port's usual pair, `dead` and not drawn.
 *
 * The removal test used to set the pair and leave the hit slot claimed, so
 * every scripted humanoid that left the stage held one of the fourteen
 * `g_hit_slots` for the rest of it.
 */
function HumanoidKill(obj: HumanoidActor): void {
  if (obj.hitSlot !== HIT_SLOT_NONE) ActorFreeHitSlot(obj);
  obj.dead = true;
  obj.visible = false;
}

/**
 * The half of `ScriptedHumanoidDraw` (`FUN_00484FF0`) the game reads back: its
 * skeleton draw samples `obj+0x19C` from the counter before the counter is
 * stepped. See {@link HumanoidTail.playCursor}.
 *
 * Private, like {@link HumanoidApplyPathOffset}: it is part of another routine,
 * and the rest of that routine -- the skeleton, the shadow, the decoration and
 * the counter's step -- is the renderer's and `ActorAdvanceMotion`'s.
 */
function HumanoidSampleDrawnCursor(obj: HumanoidActor): void {
  obj.hum.playCursor = MotionPlayFrame(obj);
}

/** One command. Returns whether the cursor moved — false parks the VM. */
function RunCommand(obj: HumanoidActor, c: HumanoidCmd, f: ClassFrame): boolean {
  switch (c.op) {
    case HumanoidOp.WaitThenPlay:
    case HumanoidOp.WaitThenHold:
      if (!WaitCondMet(obj, c)) return false;
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
      // `ActorSetMotion(obj+0x194, a)` -- a cut, cursor and counter zeroed --
      // and then the **counter** is written outright: `b`, or `rand() % 10`
      // for -1 (`MOV [EBP], ECX` at `0x00484466`, `CALL rand; IDIV 10` at
      // `0x0048446B`, `EBP = obj+0x194`). In the counter's own unit: this
      // took `b` as an authored frame and doubled it, and took -1 as 0.
      ActorSetMotion(obj, c.a);
      obj.hum.playCursor = 0;
      obj.playTicks = c.b === -1 ? f.rng.int(10) : c.b;
      // Mode 1 clears `obj+0x1F8` bit 4 (`AND AL, 0xfb` at `0x0048449E`) and
      // mode 2 raises it (`OR AL, 0x4` at `0x00484488`); any other mode
      // leaves it. The bit is the one the Init raises for `blk+2 == 2`.
      if (c.mode === 1) obj.motionFlags &= ~MotionFlag.TraceGround;
      else if (c.mode === 2) obj.motionFlags |= MotionFlag.TraceGround;
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;

    case HumanoidOp.SetMotionBlended: {
      // `ActorSetMotionBlended(obj+0x194, a, b, mode)`: `b` is the start
      // **cursor** and `mode` the fade length, as the routine takes them. This
      // cut to frame 0 and ignored both, so every scripted clip change snapped
      // -- the zombies' fall back into the canal included (mode 5). The port's
      // primitive takes the cursor as it stands, `-1` included: eighteen
      // shipped commands pass it, which holds the cursor at -1 for the fade
      // and plays the clip from 0 when the fade lets go.
      ActorSetMotionBlended(obj, c.a, c.b, c.mode);
      obj.hum.playCursor = c.b;
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

    case HumanoidOp.SetHeadAim:
      // `0x004848B2`-`0x004848E4`: mode 1 sets the toggle and calls
      // `ScriptedHumanoidSeedHeadAim` (`FUN_00485D70`), mode 0 clears it, and
      // any other mode leaves it as it was.
      //
      // [diverges] The seed is not made. It writes the head's two angles,
      // `obj+0x1368`/`+0x136C`, toward the camera eye raised 15, and nothing
      // reads them but `ScriptedHumanoidAimHeadAtCamera` -- class 0x25's head
      // aim, which is not ported. Op 12 is in none of the 274 class-0x25
      // programs the twelve bundles carry, so neither routine ever runs in the
      // exported data; porting the pair is `class30/head_aim.ts` over two
      // other words, with an absolute turn in place of a relative one.
      if (c.mode === 1) obj.hum.aimsHead = 1;
      else if (c.mode === 0) obj.hum.aimsHead = 0;
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
        else { obj.hum.routine = HumanoidRoutine.Idle; return false; }
      } else obj.hum.pc += 1;
      return true;

    case HumanoidOp.Kill:
      // `0x00484A80 CALL ActorKill`, which does not return: the actor goes
      // and nothing after it runs. A bare kill -- the hit slot stays claimed,
      // unlike the class's other deaths.
      obj.dead = true;
      obj.visible = false;
      return false;

    case HumanoidOp.End:
      // `MOV dword ptr [EDI], 0x484d40` at `0x00484A87`, and on into the tail
      // with the cursor still on this command: from the next frame the idle
      // routine is what runs, and the actor stays drawn on its clip.
      obj.hum.routine = HumanoidRoutine.Idle;
      return false;

    case HumanoidOp.Handoff:
      return HumanoidHandoff(obj, c, f);

    case HumanoidOp.SetHandModel: {
      // `0x00484739`-`0x00484787`. The row is `a`, except in Original Mode
      // (`g_GameMode == 1`: `DEC EAX; JNZ 0x00484767`), where an `a` of 0 or 1
      // is the character that player plays -- `MOVSX EAX, byte ptr
      // [0x009a2242]` at `0x00484760`, `[0x009a2256]` at `0x00484757`. Then
      // `MOVSX EAX, word ptr [ECX*2 + 0x4ec9e0]` with `ECX = 3*row + mode` and
      // `MOV [EDI + 0x4dc], EAX`: bone 5's draw slot, written whatever it is.
      let row = c.a;
      if (G.g_GameMode === GameMode.Original && (c.a === 0 || c.a === 1)) {
        row = G.g_original_character[c.a];
      }
      const slot = T.chars?.player_hand_slots
        ?.[row * HAND_SLOT_VARIANTS + c.mode];
      // [port-only] The bundle carries the table's ten rows, the ones the
      // character byte can name; an index outside them reads the words after
      // the table in the engine and nothing here. The 117 shipped commands
      // name rows 0 to 4 and modes 0 to 2.
      if (slot !== undefined) {
        obj.boneSlot[String(HAND_BONE)] = slot;
        f.host.setBoneSlot(obj.at, HAND_BONE, slot);
      }
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;
    }

    case HumanoidOp.SetBoneModel: {
      // `0x00484972`-`0x004849C9`. `SpawnBloodSpray(obj, a, 0.75)` first,
      // always -- the call at `0x0048497D` is `SpawnBloodSpray` (`FUN_00407310`)
      // and it is the port's -- then the character's effect-table entry
      // `6*a + b` (`MOV EBP, [EAX*4 + 0x4c7160]` on `obj+0x1F4`, `MOV AX, word
      // ptr [EBP + EDX*2]` into a cleared `EAX`), and bone `a`'s record
      // (`LEA ECX, [ECX + EDI + 0x20c]`, `ECX = a*0x90`) takes it only when
      // `CMP EAX, EBX; JL` or `CMP EAX, 0x2; JLE` lets it past: never for a
      // control code, and the `JL` arm cannot fire on a zero-extended `u16`.
      //
      // **Not `ActorSwapDamagedPart` (`FUN_004098E0`).** Only the slot is
      // written: no `NoPartSwap` test, no hit sphere, no step counter at
      // `+0x8C`, no zone bit. The class is not shot at, so a wound here is
      // drawn and nothing else.
      SpawnBloodSpray(obj.at, c.a, BONE_MODEL_BLOOD);
      // The bundle carries the table as six steps per skeleton bone, so the
      // flat index is split back into the row it lands in -- which is `a`'s
      // own for the shipped `b` of 0 and 1, and the next bone's for a `b` of
      // six or more, as in the engine. [port-only] A row the skeleton has no
      // bone for reads 0 here, which the command never stores.
      const j = c.a * BONE_EFFECT_STEPS + c.b;
      const bone = Math.floor(j / BONE_EFFECT_STEPS);
      const slot = CharacterTypeOf(obj)?.bones.find((x) => x.bone === bone)
        ?.steps?.[j - bone * BONE_EFFECT_STEPS]?.[0] ?? 0;
      if (slot < 0 || slot > BONE_EFFECT_CONTROL_MAX) {
        obj.boneSlot[String(c.a)] = slot;
        f.host.setBoneSlot(obj.at, c.a, slot);
      }
      obj.hum.stallFrames = 0;
      obj.hum.pc += 1;
      return true;
    }

    default:
      // `LEA EDX,[EAX+1]; CMP EDX,0x13; JA 0x00484a8d` at `0x00484365`: an
      // opcode outside -1..18 goes to the tail with the cursor on it, so the
      // VM parks there. None ships -- every command of the 137 programs
      // decodes in range, which is the check on the command lengths.
      return false;
  }
}

/**
 * `op 17`, `0x004849CE`: a switch on the mode through the five-entry table at
 * `0x00484D20` (`0x004849E2`, `0x004849EA`, `0x004849F2`, `0x004849FB`,
 * `0x00484A5A`).
 *
 * * **0, 1, 4** write a routine over the object's entry point -- mode 4 first
 *   sets `obj+0x50 = -0.40833333` (`0xbed11111`) -- and end the frame through
 *   the VM's tail, with the cursor past this command. The VM never runs again.
 * * **2, 3** spawn a sprite and **stay**: `MOV CL, 0x1` and the loop runs the
 *   next command in the same frame.
 * * Anything else (`CMP EAX,4; JA`, unsigned, so negatives too) steps past
 *   the command and ends the frame, since `CL` is cleared at the loop's head.
 *
 * Returns whether the VM runs on, as {@link RunCommand} does.
 *
 * This was stepped over for as long as the class existed, and `op -1` always
 * follows a mode 0, 1 or 4 in the shipped programs -- so the actor fell into
 * the idle routine on whatever clip the program had last started. Stage 2's
 * four zombies at the jetty (evt 43584, 43740, 55372, 55536) had just started
 * their fall back into the canal, clip 972 with a fade of 5, and the idle
 * routine never raises the freeze flag: they stood on the jetty playing the
 * fall on a loop until the boss fight's camera took them away.
 */
function HumanoidHandoff(obj: HumanoidActor, c: HumanoidCmd,
                         f: ClassFrame): boolean {
  let stays = false;
  switch (c.mode) {
    case 0:
      obj.hum.routine = HumanoidRoutine.FallAndSplash;
      break;
    case 1:
      obj.hum.routine = HumanoidRoutine.LaunchAndDrop;
      break;
    case 2:
      ScriptedHumanoidSpawnFixedImpact(f);
      stays = true;
      break;
    case 3:
      // `g_evt_block_index == 9` picks the point (`CMP word ptr [0x009a2bc0],
      // 0x9` at `0x004849FB`), and the sprite turns to the camera by yaw
      // alone. `params[3..5]` are zeroed (`0x00484A42`-`0x00484A4A`).
      SpawnSpriteEffect(
        G.g_evt_block_index === HANDOFF_SPLASH_BLOCK
          ? vec3(HANDOFF_SPLASH_B9.x, HANDOFF_SPLASH_Y, HANDOFF_SPLASH_B9.z)
          : vec3(HANDOFF_SPLASH.x, HANDOFF_SPLASH_Y, HANDOFF_SPLASH.z),
        0, 0, HANDOFF_SPLASH_KIND, SPRITE_FACE_CAMERA_YAW, SPRITE_NO_PLAYER,
        f.host, f.events);
      stays = true;
      break;
    case 4:
      obj.vel.y = FALL_TIMED_START_VY;
      obj.hum.routine = HumanoidRoutine.FallTimed;
      break;
  }
  obj.hum.pc += 1;
  obj.hum.stallFrames = 0;
  return stays;
}

/**
 * `ScriptedHumanoidSpawnFixedImpact` — `FUN_00484F50`. `op 17` mode 2.
 *
 * One sprite at one point, and nothing of the actor's: kind 0x34 -- the
 * second copy of the metal material's arm, `BULLET_MET1` and all -- at
 * `(-999.5, 3.24, -1296.2)` facing yaw `0xC000`, not turned to the camera.
 * Stage 2's two gunmen (evt 65768, 66004) call it three times each, each
 * straight after a shot's sound.
 */
export function ScriptedHumanoidSpawnFixedImpact(f: ClassFrame): void {
  SpawnSpriteEffect(vec3(FIXED_IMPACT.x, FIXED_IMPACT.y, FIXED_IMPACT.z),
                    0, FIXED_IMPACT_YAW, SpriteEffectKind.MetalAlt, 0,
                    SPRITE_NO_PLAYER, f.host, f.events);
}

/**
 * `ScriptedHumanoidFallAndSplash` — `FUN_00484DF0`. What `op 17` mode 0
 * installs, and the end of stage 2's jetty zombies (two a route, blocks 16
 * and 20).
 *
 * ```
 * 00484dfe  obj+0x50 -= 0.02;  obj+0x44 += obj+0x50         ; from rest
 * 00484e10  if (obj+0x19C == g_motion_play_length[obj+0x1B4] - 1)
 *               obj+0x1324 = 1                              ; hold the clip
 * 00484e33  if (obj+0x44 <= -27.9998) {
 *               SpawnSpriteEffect({x, -24.9998, z}, 0x61, 1, -1)
 *               ActorFreeHitSlot; ActorReleasePartList; ActorKill
 *           }
 * 00484e91  ScriptedHumanoidDraw(obj)
 * ```
 *
 * So the clip the program left playing -- the fall back, 972 -- plays **once**
 * and holds its last cursor, and the body sinks from the jetty's -23 past
 * -27.9998, throws a splash at -24.9998 and is gone 22 frames after the
 * hand-off, well before a 59-tick clip could loop. Kind 0x61 is the strip the
 * bat's and the owl's water splashes flip through, so into water is
 * `[likely]`. No removal test and no cutscene-skip teardown: nothing but the
 * depth ends it.
 *
 * `obj+0x50` is `vel.y`, and nothing in the class writes it before this, so the
 * fall starts from rest.
 */
export function ScriptedHumanoidFallAndSplash(obj: HumanoidActor,
                                              f: ClassFrame): void {
  obj.vel.y -= FALL_SPLASH_GRAVITY;
  obj.pos.y += obj.vel.y;
  if (AtMotionCursor(obj, -1)) obj.frozen = 1;
  if (obj.pos.y <= FALL_SPLASH_FLOOR) {
    SpawnSpriteEffect(vec3(obj.pos.x, FALL_SPLASH_Y, obj.pos.z), 0, 0,
                      SpriteEffectKind.Splash, SPRITE_FACE_CAMERA,
                      SPRITE_NO_PLAYER, f.host, f.events);
    HumanoidKill(obj);
    return;
  }
  HumanoidSampleDrawnCursor(obj);
}

/**
 * `ScriptedHumanoidLaunchAndDrop` — `FUN_00484EA0`. What `op 17` mode 1
 * installs.
 *
 * Sub 0 seeds the throw -- `vel.y = 20`, `vel.x = x - 231.5`, both
 * accumulators zeroed -- bumps the substate and **falls through into sub 1**
 * (`INC word ptr [ESI+0x1312]` at `0x00484EDF`, then `0x00484EE6`, `L53`), so
 * the first step is taken on the launch frame. Sub 1 is a gravity that itself
 * grows: `accY -= 0.0272; vel.y += accY; y += vel.y; x += vel.x`, and the
 * actor dies below `y = 0`. Any other substate only draws.
 *
 * Stage 2 block 37's five bystanders run it on script flag 95.
 */
export function ScriptedHumanoidLaunchAndDrop(obj: HumanoidActor): void {
  if (obj.sub === 0) {
    obj.vel.y = LAUNCH_VY;
    obj.accY = 0;
    obj.accX = 0;
    obj.vel.x = obj.pos.x - LAUNCH_ORIGIN_X;
    obj.sub += 1;
  } else if (obj.sub !== 1) {
    HumanoidSampleDrawnCursor(obj);
    return;
  }
  obj.accY -= GRAVITY_STEP;
  obj.vel.y += obj.accY;
  obj.pos.y += obj.vel.y;
  obj.pos.x += obj.vel.x;
  if (obj.pos.y < LAUNCH_FLOOR) {
    HumanoidKill(obj);
    return;
  }
  HumanoidSampleDrawnCursor(obj);
}

/**
 * `ScriptedHumanoidFallTimed` — `FUN_00484F90`. What `op 17` mode 4 installs,
 * after setting `vel.y` to -0.408.
 *
 * `vel.y -= 0.0272; y += vel.y`, and a frame count at `obj+0x1338` that kills
 * the actor once it passes 200 -- with the hit slot freed and, unlike the
 * other two, no part-list release. Stage 6's evt 18820 is the one user.
 */
export function ScriptedHumanoidFallTimed(obj: HumanoidActor): void {
  obj.vel.y -= GRAVITY_STEP;
  obj.pos.y += obj.vel.y;
  obj.hum.fallFrames += 1;
  if (obj.hum.fallFrames > FALL_TIMED_FRAMES) {
    HumanoidKill(obj);
    return;
  }
  HumanoidSampleDrawnCursor(obj);
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
    // `g_camera_eye_z` and `_x` by address, `0x00484AB3` and `0x00484ACA`.
    const eye = G.g_camera_eye;
    obj.yaw = VecToAngles(obj.pos.x - eye.x, 0, obj.pos.z - eye.z).yaw
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
      // `0x00484B6E`-`0x00484B74`, out of `CamEvalObjectPath6`'s second half
      // (its three ints, `L2`), and `CMP [EDI+0x1358],0x2 / JZ` at
      // `0x00484B5D` is the mode-2 skip. `[proved]` The draw then turns the
      // body by all three, in the order `ScriptedHumanoidInit` names --
      // `render/characters/humanoid.ts`. This wrote the yaw alone for as long
      // as the renderer drew only yaw, so `op_st3` 340's boat riders stood
      // upright on a path whose `rot_x` runs to 15,758 BAMS.
      //
      // A host that publishes a position alone leaves the angles as they
      // were; `GameHost.objectPath` has all six whenever it has a path.
      if (obj.hum.pathMode !== 2) {
        if (p.pitch !== undefined) obj.pitch = p.pitch;
        if (p.yaw !== undefined) obj.yaw = p.yaw;
        if (p.roll !== undefined) obj.roll = p.roll;
      }
      // The offset vector, though, **is** rotated by all three, and that is
      // this file's own arithmetic rather than the renderer's.
      HumanoidApplyPathOffset(obj, p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0);
    }
  }

  obj.hum.prevPos.x = obj.pos.x;
  obj.hum.prevPos.y = obj.pos.y;
  obj.hum.prevPos.z = obj.pos.z;
  // `ScriptedHumanoidDraw(obj)`, the tail's last call.
  HumanoidSampleDrawnCursor(obj);
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
 * divergence saying that `rx` and `rz` "arrive as zero, because
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
 * the VM at `0x004842A0` opens with -- hit slot, part list, `ActorKill` --
 * then `ScriptedHumanoidDraw` (`FUN_00484FF0`) and `RET` at `0x00484DE2`.
 *
 * **And nothing else** — no `obj+0x1320` step, no turn, no object-path follow,
 * no `obj+0x13C0` capture. So a class-0x25 actor whose program has ended stops
 * dead where it stands. The port used to leave `pc` at -1 and keep running
 * `HumanoidFrameTail` every frame, which kept the 69 of the six stages' 137
 * scripted humanoids that reach an `op -1` turning and riding their paths for
 * ever after their programs had finished. It is one of five routines the
 * object can be handed ({@link HumanoidRoutine}); `op 17` installs three
 * others, which this used to stand in for as well.
 *
 * The skip teardown comes first (`0x00484D40`): with `g_cutscene_skipping`
 * (`0x009A2230`) up the actor gives back its hit slot and its part list and
 * is killed, whatever its removal cue says.
 */
export function ScriptedHumanoidIdle(obj: HumanoidActor): void {
  const p = HumanoidProgramOf(obj);
  if (!p) return;
  if (G.g_cutscene_skipping !== 0) {
    HumanoidKill(obj);
    return;
  }
  if (HumanoidShouldRemove(obj, p)) {
    HumanoidKill(obj);
    return;
  }
  // `CALL 0x00484FF0` — the draw, which is the renderer's. Its chapter-card
  // early-out (`ScreenFurniture.ChapterCard`, `0x00484FF8`) skips the body
  // and the decoration but lands on the tick at `0x0048523A`, not the `RET`,
  // so the motion frame advances behind a card either way.
  HumanoidSampleDrawnCursor(obj);
}

export const ScriptedHumanoidHandler: ClassHandler = {
  init: ScriptedHumanoidInit,
  update: ScriptedHumanoidRun,
  debug: ScriptedHumanoidDebug,
  // **Registers where the engine's routines do, which is nowhere**, so the
  // pick finds it through `G.g_shot_test_list` alone and never finds it.
  // `[proved]` from the bytes rather than the xref list: a scan of `.text`
  // finds 95 `E8`/`E9` calls to `RegisterForShotTest` (`FUN_00405160`), 17
  // to `ActorRegisterCameraPoint` (`FUN_00409B70`), which ends in one, and
  // 22 to `RegisterForCameraTracking` (`FUN_00408EC0`), and no absolute
  // pointer to any of them. None lies in `0x004840D0`..`0x00485F8F`, and a
  // descent from the class's thirteen routines -- the ported ones, the draw
  // `0x00484FF0`, its per-bone hook `0x00485260`, the head aim, and
  // `SpawnTumblingModelAtBone5` (`FUN_00485DE0`) with the object it makes --
  // through every call, jump table and installed code pointer they reach,
  // no-return marks ignored, reaches none of those 134 sites. So no bullet in
  // the game touches a scripted humanoid. The render pick could find the
  // four whose spawn record leaves bit `0x8000` clear -- stage 2's jetty
  // zombies, blocks 16 and 20 -- and did: block 16's first, through the
  // corner of a building, and `ResolveHit` killed it for ninety points
  // (`tools/humanoid_shot_page.mjs`).
  registersForShotTest: true,
  // ...and the debug clear takes nothing a shot could not: the Kill button
  // used to kill every scripted humanoid in the pool, a cut scene's whole
  // cast included.
  invulnerable: () => true,
};

/**
 * A bytecode VM driving a skinned character. Not an enemy.
 */
registerClass(SpawnClass.ScriptedHumanoid, ScriptedHumanoidHandler);

/**
 * The sets class 0x10's two VMs switch on.
 *
 * `CivilianRunScript` (`FUN_0048B9E0`) and `CivilianReapplyWaitCommand`
 * (`FUN_0048B760`) both switch on {@link CivilianOp}, `CivilianStepScript`
 * (`FUN_0048B1E0`) tests every bit of {@link CivilianWait}, and both halves
 * resolve {@link CivilianTarget}. They are here, with the two readers that
 * turn a command's dwords into what the engine reads them as, because six
 * files need them and none of them needs another.
 */
import type { CivilianCmdJson } from "../../bundle/scene";
import { T } from "../tables";

/**
 * The opcodes `CivilianRunScript` (`FUN_0048B9E0`) switches on.
 *
 * The numbers are the exe's. Anything above {@link Wait} stops the VM, which
 * is the `if (0x2B < *cursor)` at the bottom of its loop — so `Wait` itself is
 * only ever executed on the frame `CivilianStepScript` resumes into it.
 */
export enum CivilianOp {
  /** Play a clip: `(motion, loops)`. Negative loops play for ever. */
  SetMotion = 0x00,
  /** The same with a starting frame: `(motion, loops, frame)`. */
  SetMotionFrom = 0x01,
  /** Stop the clip at this frame rather than at its length. */
  SetFrameLimit = 0x02,
  /** The per-frame cap on the turn toward the target, in BAMS. */
  SetTurnRate = 0x03,
  /** The clip frame wait bit {@link CivilianWait.MotionFrame} looks for. */
  SetMotionFrame = 0x04,
  /** A target point: `(pointer or mode, radius)`. See {@link CivilianTarget}. */
  SetTarget = 0x05,
  /** A target point, always dereferenced. */
  SetTargetPoint = 0x06,
  /** A target 100 units away along a BAMS heading. */
  SetTargetHeading = 0x07,
  /** Set the actor's yaw outright. */
  SetYaw = 0x08,
  /** Wait this many frames as well as whatever the wait word says. */
  SetTimer = 0x09,
  /** The enemy count the wait bits 0x01 and 0x02 count down to. */
  SetEnemiesGoal = 0x0A,
  /** The surviving-child count wait bit 0x04 counts down to. */
  SetChildrenGoal = 0x0B,
  /** The `g_civilians_alive` count wait bit 0x08 counts down to. */
  SetCiviliansGoal = 0x0C,
  /** The camera cue wait bit 0x80 waits for: `(path, frame)`. */
  SetCameraCue = 0x0D,
  /** The script a shot switches to. **Zero here means unshootable.** */
  SetOnShot = 0x0E,
  /** The script a *killing* shot switches to, when it differs. */
  SetOnShotKilled = 0x0F,
  /** Install a native per-frame hook — see {@link CivilianHook}. */
  SetHook = 0x10,
  /** Wait commands to re-apply and skip past on the next resume. */
  SetSkipCount = 0x11,
  /** Frames until the actor leaves, once its removal cue has been met. */
  SetRemoveDelay = 0x12,
  /** Put a model in the actor's hand. Drawing only. */
  AddHeldItem = 0x13,
  /** Put the last *picked* model in the actor's hand. Drawing only. */
  AddPickedItem = 0x14,
  /** Pick a model from a weighted table and preload it. Drawing only. */
  PickHeldItem = 0x15,
  /** Ramp `obj+0x128` to a new radius over N frames. */
  SetRadiusRamp = 0x16,
  /** Which point `CivilianUpdate`'s switch writes into `obj+0x12C`, the
   *  collision-sphere centre the shot test and the actor push both read. */
  SetCameraPointMode = 0x17,
  /** Teleport: six floats, position then rotation. */
  SetPose = 0x18,
  /**
   * **Set the route branch.** `g_script_branch_var` (`0x009C88A4`) = the s16
   * at `cmd+4`; the command is two dwords.
   *
   * ```
   * 0048BECE  668b4e04        MOV CX, word ptr [ESI + 0x4]
   * 0048BED2  83c608          ADD ESI, 0x8
   * 0048BED5  66890da4889c00  MOV word ptr [0x009c88a4], CX
   * ```
   *
   * That global is what `EvtAdvanceStepOrRoute` (`FUN_0045F000`) indexes a
   * `kind == 1` route record's `next[]` with, so **this is how the game
   * decides which way a branching stage goes.** Eleven of the 136 shipped
   * civilian streams run it, all eleven pass `1`, and every one of them sits
   * after the `SetOnShot 0` that makes the civilian unshootable — that is,
   * after she is safe. A rescued civilian takes the alternate route.
   *
   * It was `SetGlobalA`, and `[open]` on the grounds that the reader had not
   * been read. The reader was two functions away.
   */
  SetRouteBranch = 0x19,
  /** `(a, b)` applied only when this civilian still has children. */
  SetChildCue = 0x1A,
  /**
   * **Set the HUD shutter, and with it the firing gate.**
   * `g_bHudShutterState` — `0x009CA0F4` — takes the **low byte** of the
   * operand, unless `g_app_state` (`0x009C8E98`) is 10:
   *
   * ```
   * 0048BF0A  833d988e9c000a  CMP dword ptr [0x009c8e98], 0xA
   * 0048BF11  7409            JZ  0x0048bf1c
   * 0048BF13  8a5604          MOV DL, byte ptr [ESI + 0x4]
   * 0048BF16  8815f4a09c00    MOV byte ptr [0x009ca0f4], DL
   * ```
   *
   * `HudDrawShutterState` (`FUN_00413970`) picks the change up on its next
   * pass and raises `g_nFiringGate` for a 1 or drops it at the end of a 3 —
   * so **a civilian's script can hand the player the gun back inside a
   * letterboxed scene the evt script never reopens.** Stage 1 block 1 is
   * exactly that: step 6 closes the shutter, step 8's `wait_enemies_alive`
   * stands with the tutorial captor alive and the gun dead, and the man it
   * has just killed runs a killed script whose fourth command is this one.
   *
   * 60 commands in the shared 136-block table run it, 30 with 1 and 30 with 3.
   * It was `SetGlobalB` and `[open]` on the grounds that the target global had
   * not been read; it had been named for two sessions.
   */
  SetHudShutterState = 0x1B,
  /** Raise one `g_script_flags` byte. */
  SetScriptFlag = 0x1C,
  /** `EvtOpPlayDialogue2D` — the civilian's voice line. */
  PlayDialogue = 0x1D,
  /** Resume into this script instead of the cursor, next time. */
  SetResume = 0x1E,
  /** The same, choosing between two by `DAT_009A2226`. */
  SetResumeByMode = 0x1F,
  /** Which `g_script_flags` byte wait bit 0x2000 reads. */
  SetFlagIndex = 0x20,
  /** Queue one sound: `(id, delay in frames)`. */
  QueueSound = 0x21,
  /** Queue a list of `(id, delay)` pairs. */
  QueueSoundList = 0x22,
  /** A child-attachment mode. `[open]` — only `2` is read, and it latches. */
  SetAttachMode = 0x23,
  /** The same with an explicit target. `[open]`. */
  SetAttachTarget = 0x24,
  /** `[open]` — writes `sub+0xA4` / `sub+0xA8`, which nothing read reads. */
  SetPairA = 0x25,
  /** Move to a point over N frames; a point below 1 means the camera. */
  MoveOverFrames = 0x26,
  /**
   * The character's size, `model+0x116C`.
   *
   * **Not drawing only**, which is what this said. `SkeletonApplyRootMotion`
   * scales the clip's root delta by the same field, so a script that shrinks a
   * civilian also slows her walk — the two are one statement, because a
   * smaller character takes smaller steps.
   */
  SetScale = 0x27,
  /** Which bone the camera point rides. Drawing only. */
  SetCameraBone = 0x28,
  /** OR bits into `obj+0x34`. */
  SetActorFlags = 0x29,
  /** Which death voice to use, or `0xFF` to pick one by character type. */
  SetDeathVoice = 0x2A,
  /**
   * A six-word command taken only while `g_app_state` is 6 — which is
   * **in play**, so this is the ordinary path and not a debug one. It used to
   * be called `DebugOnly` on the strength of that gate alone, back when
   * `g_app_state`'s meaning was `[open]`.
   *
   * ```
   * 0048C202  833d988e9c0006  CMP dword ptr [0x009c8e98], 0x6
   * 0048C209  751f            JNZ (past the whole arm)
   * 0048C20B  668b5604        MOV DX, word ptr [ESI + 0x4]
   * 0048C20F  668990bc000000  MOV word ptr [EAX + 0xbc], DX
   * 0048C216  8b0da0d07d00    MOV ECX, dword ptr [0x007dd0a0]
   * 0048C21C  8d4608          LEA EAX, [ESI + 0x8]
   * 0048C21F  8981c0000000    MOV dword ptr [ECX + 0xc0], EAX
   * ```
   *
   * So it writes the s16 at `cmd+4` into the script context's `+0xBC` and a
   * **pointer back into the stream**, at `cmd+8`, into its `+0xC0`. What those
   * two fields are is `[open]`, and the port does nothing with the op.
   */
  InPlayOnly = 0x2B,
  /** Load the wait word and suspend. See {@link CivilianWait}. */
  Wait = 0x2C,
  /** End of stream. */
  End = 0x2D,
}

/**
 * The bits of op {@link CivilianOp.Wait}'s operand.
 *
 * Every one is a **reason to keep waiting**, which is the shape of
 * `CivilianStepScript`'s conjunction: the script resumes on the frame the last
 * of them stops holding. `Free` inverts that and is why it reads oddly — with
 * it set the conjunction fails outright and the script runs at once.
 */
export enum CivilianWait {
  /** Wait while `g_enemies_present` is above `enemiesGoal`. */
  EnemiesPresent = 0x00000001,
  /** Wait while `g_enemies_alive` is above `enemiesGoal`. */
  EnemiesAlive = 0x00000002,
  /** Wait while more than `childrenGoal` of my children are alive. */
  ChildrenAlive = 0x00000004,
  /** Wait while `g_civilians_alive` is above `civiliansGoal`. */
  CiviliansAlive = 0x00000008,
  /** Walk at the target; arrive when the 2D distance is inside `radius`. */
  Reach = 0x00000010,
  /** Turn to the target; arrive when the heading error reaches zero. */
  Face = 0x00000020,
  /** Wait until the target is in front — local `z` above zero. */
  InFront = 0x00000040,
  /** Wait for camera path `cuePath` to reach frame `cueFrame`. */
  CameraCue = 0x00000080,
  /** Wait while the clip still has loops left to play. */
  MotionLoops = 0x00000100,
  /** Wait until the clip frame equals `motionCompare`. */
  MotionFrame = 0x00000200,
  /** Wait until the installed frame hook says it has finished. */
  Hook = 0x00000400,
  /** Do not wait at all: this makes the whole conjunction fail. */
  Free = 0x00000800,
  /** Wait until the camera's eased look-at has caught up. */
  CameraSettled = 0x00001000,
  /** Wait until `g_script_flags[flagIndex]` is raised. */
  ScriptFlag = 0x00002000,
  /**
   * **Let the camera track her.** Bit `0x00040000`, and not a wait condition:
   * op 0x2C writes `obj+0x34`'s `NoCameraTrack` bit from it, and inverted —
   *
   * ```c
   * if ((*g_cur_civilian & 0x40000) == 0) obj+0x34 |=  0x10000;
   * else                                  obj+0x34 &= ~0x10000;
   * ```
   *
   * — so the bit set means *tracked* and the bit clear means *excluded from
   * `RegisterForCameraTracking`*. 315 of the 596 shipped wait commands set it,
   * more than any other bit in the word. `[proved]`
   */
  CameraTrack = 0x00040000,
  /**
   * **Does this block's clip carry the civilian?** Bit `0x00100000`, and not a
   * wait condition at all — it is the per-block root-motion switch.
   *
   * `CivilianRunScript` (`FUN_0048B9E0`) op 0x00 and op 0x01 write it straight
   * into the motion block's gate on every clip *change*:
   *
   * ```c
   * if (*(int *)(g_cur_actor_model + 0x20) != param_2[1]) {   // a new clip
   *   *(int *)(g_cur_actor_model + 0x20) = param_2[1];
   *   if ((*g_cur_civilian & 0x100000) == 0)
   *     uVar7 = *(uint *)(g_cur_actor_model + 100) & 0xfffffffd;   // clear
   *   else
   *     uVar7 = *(uint *)(g_cur_actor_model + 100) | 2;            // set
   *   *(uint *)(g_cur_actor_model + 100) = uVar7;
   * ```
   *
   * `model + 100` is `model+0x64`, which is {@link Actor.motionFlags}, and bit
   * `2` is the one and only gate `SkeletonApplyRootMotion` (`FUN_00410C50`)
   * tests before it moves the actor. So the answer to "do the engine's
   * civilians use root motion" is **yes, and their script says so block by
   * block**: 289 of the 596 shipped wait words carry this bit and 297 do not.
   * `[proved]`
   *
   * It is read at the moment op 0x00 runs, which is *inside* the block its own
   * leading `Wait` opened — so the word that governs the clip is the one that
   * introduced it, exactly as {@link CivilianOp.Wait}'s note describes.
   */
  RootMotion = 0x00100000,
  /** Not counted in `g_civilians_alive`, and worth no score. */
  Uncounted = 0x08000000,
  /** Leave `g_civilians_alive` now rather than on removal. */
  LeaveCountNow = 0x00080000,
  /** May be removed when off camera. */
  RemoveOffCamera = 0x02000000,
  /** **The rescue.** Pay 400 and clear the bit. */
  Rescued = 0x10000000,
  /**
   * Bit `0x1000000` — take part in the world push.
   * `PoseHookGrowAndPushOutOfWorld` tests it before tracing at all, so a
   * civilian standing in scenery stays where the script put it unless the
   * script says otherwise.
   */
  PushOutOfWorld = 0x01000000,
  /**
   * Wait until a player is actually in play — `g_players_in_play >= 1`.
   *
   * `CivilianStepScript` keeps waiting while `g_players_in_play < 1`, so this
   * is a "has the game started" gate and not the player-count test the name
   * `TwoPlayers` used to claim. In an ordinary single-player run it is met on
   * frame one.
   */
  InPlay = 0x40000000,
  /** The bits that make the loop worth entering at all. */
  Any = 0x40003fff,
  /** Either of these parks the script whatever else the word says. */
  Blocked = 0x14000000,
}

/** Op {@link CivilianOp.SetTarget}'s first operand, when it is not a pointer. */
export enum CivilianTarget {
  /** No target: the turn step does not run. */
  None = 0,
  /** The camera — which in this game is the player. */
  Camera = -1,
  /** The actor's own position mirrored through the camera: turn away. */
  AwayFromCamera = -2,
}

/**
 * The native hooks op {@link CivilianOp.SetHook} installs at `sub+0x5C`.
 *
 * The command's length is **the hook's** to decide — the engine calls it as
 * `next = hook(obj, cmd + 2)` and takes the pointer back — which is why the
 * exporter has to know them by address to decode the stream at all.
 */
export enum CivilianHook {
  /** `NoOpStub` (`FUN_0041EBB0`): uninstall. */
  None = 0,
  /** `0x0048D9F0`: fall under gravity until the ground catches it. */
  Fall = 0x0048d9f0,
  /** `0x0048DA90`: ride the surviving children. `[open]` — pose only. */
  RideChildren = 0x0048da90,
  /** `0x0048DB90`: take a launch speed in y, then fall. */
  LaunchUp = 0x0048db90,
  /** `0x0048DBD0`: take a whole launch velocity, then fall. */
  Launch = 0x0048dbd0,
}

/**
 * One command of one stream, or null past its end.
 *
 * [port-only] The engine walks a pointer through a dword array and decides
 * each command's length from its opcode; the exporter has already done that,
 * so what the VM walks here is an index into a decoded list. Named rather than
 * inlined because both VMs and the step loop index the same stream and a
 * silent `undefined` in any of them is a script that stops.
 */
export function CmdAt(script: number, pc: number): CivilianCmdJson | null {
  const s = T.civilians?.scripts?.[script];
  return s?.[pc] ?? null;
}

/**
 * Reinterpret a script dword as the float the engine reads it as.
 *
 * [port-only] The exe does not convert anything: the operand is already four
 * bytes and the FPU is handed them. The bundle carries the dword, so the
 * reinterpretation has to be spelled out on this side.
 */
export function AsFloat(v: number): number {
  const b = new DataView(new ArrayBuffer(4));
  b.setInt32(0, v | 0, true);
  return b.getFloat32(0, true);
}

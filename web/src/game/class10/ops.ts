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
  /**
   * **The cross-fade length of the next clip change**, into `sub+0xE`.
   * `MOV word ptr [EAX + 0xe], CX` at `0x0048BD5E`. Its one reader is
   * `CivilianApplyMotionPose` (`FUN_0048C310`), which hands it to
   * `ActorSetMotionBlended` as the fade (`MOVSX EDX, word ptr [ECX + 0xe]`
   * at `0x0048C824`); `CivilianInit` writes 10 (`0x0048A4F1`). A sweep of
   * every `[r + 0xe]` operand in the image finds no third. It was
   * `SetTurnRate`, a name nothing read supported -- the turn passes the
   * literal `0x100`. `[proved]`
   */
  SetMotionBlend = 0x03,
  /** The clip frame wait bit {@link CivilianWait.MotionFrame} looks for. */
  SetMotionFrame = 0x04,
  /** A target point: `(pointer or mode, radius)`. See {@link CivilianTarget}. */
  SetTarget = 0x05,
  /**
   * **A target point, and not a target mode.** The operand is a pointer, kept
   * at `sub+0x44`, and the three words it names are copied into
   * `sub+0x30..0x38`; `sub+0x40`, the mode {@link SetTarget} writes, is not
   * touched:
   *
   * ```
   * 0048BC8D  8b5604    MOV EDX, dword ptr [ESI + 0x4]
   * 0048BC93  895044    MOV dword ptr [EAX + 0x44], EDX
   * 0048BC9B  8b5044    MOV EDX, dword ptr [EAX + 0x44]
   * 0048BC9E  8d4830    LEA ECX, [EAX + 0x30]      ; then three MOVs through it
   * ```
   *
   * and `CivilianReapplyWaitCommand` has the same arm at `0x0048B84E`. So it
   * turns nobody -- `CivilianUpdate` steps the turn only while `sub+0x40` is
   * non-zero -- and all eleven in the shipped table sit in a block whose
   * wait word carries {@link CivilianWait.InFront}, the one test that reads
   * `sub+0x30..0x38` raw. It is the point the civilian walks **past** on her
   * own clip. The port wrote the pointer into the mode as well, which made
   * every one of them turn toward it. `[proved]`
   *
   * `sub+0x44` is read back by these two arms' own dereference and by
   * nothing else in the class (an operand sweep of `0x0048A000..0x0048E000`
   * finds the four instructions above and no other `[r + 0x44]` on the
   * sub-block), `[likely]` nothing anywhere; the port carries the decoded
   * point instead of the pointer and keeps no field for it.
   */
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
  /** Call a hook install routine — see {@link CivilianHookInstall}. */
  SetHook = 0x10,
  /** Wait commands to re-apply and skip past on the next resume. */
  SetSkipCount = 0x11,
  /** Frames until the actor leaves, once its removal cue has been met. */
  SetRemoveDelay = 0x12,
  /**
   * Put an item in the actor's hand: a record, and the wait-word bits its
   * routine gives it on. **Not drawing only** -- the record's routine is the
   * extra life or the Original Mode item, paid on the frame those bits turn
   * up in the wait word. See `class10/items.ts`.
   */
  AddHeldItem = 0x13,
  /** The same with the last *picked* record. */
  AddPickedItem = 0x14,
  /** Pick a record from a weighted table and preload it. */
  PickHeldItem = 0x15,
  /**
   * Ramp `obj+0x128` to a new radius over N frames: `sub+0x78 = cmd[1]` (a
   * float's bits) and `sub+0x7C = (sub+0x78 - obj+0x128) / cmd[2]`, the
   * divide an `FIDIV` of the dword -- an integer frame count -- from the
   * radius the actor has **now** (`0x0048BE42`..`0x0048BE4E`).
   * `PoseHookGrowAndPushOutOfWorld` steps it. `[proved]`
   */
  SetRadiusRamp = 0x16,
  /**
   * Which point `CivilianUpdate`'s switch writes into `obj+0x12C`, the
   * collision-sphere centre — a {@link CivilianSphereMode}. The low byte of
   * the operand goes to `sub+0x80`: `MOV DL, byte ptr [ESI+0x4]` /
   * `MOV byte ptr [EAX+0x80], DL` at `0x0048BE5B`..`0x0048BE61`. `[proved]`
   *
   * It was called `SetCameraPointMode`, which it is not: the camera's point is
   * `obj+0x100`, and nothing this op sets reaches it.
   */
  SetSphereCentreMode = 0x17,
  /**
   * Teleport: six **dwords** copied as they are -- three floats into
   * `obj+0x40..0x48` and three BAMS integers into `obj+0x64..0x6C`
   * (`0x0048BE71`..`0x0048BEA9`, `MOV`s all). The bundle read all six as
   * floats until the rotation was needed; see `hod2lib/exetab.ts`.
   */
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
   * It was `SetGlobalA`, an open question on the grounds that the reader had
   * not been read. The reader was two functions away.
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
   * It was `SetGlobalB`, an open question on the grounds that the target
   * global had not been read; it had been named for two sessions.
   */
  SetHudShutterState = 0x1B,
  /** Raise one `g_script_flags` byte. */
  SetScriptFlag = 0x1C,
  /**
   * `EvtOpPlayDialogue2D` — the civilian's voice line, when
   * `(g_cutscene_skipping && word & 0x20000000) || sub+0x2A == 0`
   * (`0x0048BF36`..`0x0048BF4A`): not while she is walking off, unless a skip
   * is under way and her word says she stays for it. `[proved]`
   */
  PlayDialogue = 0x1D,
  /** Resume into this script instead of the cursor, next time. */
  SetResume = 0x1E,
  /**
   * The same, choosing between two streams by **the title menu's row**:
   *
   * ```
   * 0048ba0a  MOV  EDX, 0x1                          ; at the loop's head
   * 0048bf79  CMP  word ptr [0x009a2226], DX         ; g_title_menu_cursor
   * 0048bf80  JNZ  0x0048bf95                        ; -> sub+0x54 = cmd[1]
   * 0048bf82  MOV  EDX, dword ptr [ESI + 0x8]        ; -> sub+0x54 = cmd[2]
   * ```
   *
   * The cursor is the row the player confirmed, and rows 0..3 are the
   * `g_GameMode` the confirm writes, so the second stream is Original Mode's
   * -- see `g_title_menu_cursor` in `game/globals.ts`. Its three uses are
   * the last block of stage 2's `0x8510`, of the stream stage 2's `0x1158C`
   * and `0x12098` resume into, and of stage 4's `0x23F8`, and each second
   * stream is where that civilian picks (op 0x15) and gives (op 0x14) an
   * Original Mode item. `[proved]`
   */
  SetResumeByMode = 0x1F,
  /** Which `g_script_flags` byte wait bit 0x2000 reads. */
  SetFlagIndex = 0x20,
  /** Queue one sound: `(id, delay in frames)`. */
  QueueSound = 0x21,
  /**
   * Queue a list of `(id, delay)` pairs: the first into `sub+0x84/0x88` and
   * the rest's pointer into `sub+0x58`, 0 when the next id is `-1`. **A null
   * operand writes `sub+0x58 = 0` and nothing else** (`0x0048BFBD`), so a
   * sound already queued by op 0x21 still plays. `[proved]`
   */
  QueueSoundList = 0x22,
  /**
   * **What the head looks at**: `sub+0x8C = cmd[1]` -- a
   * {@link CivilianHeadMode} -- and for mode 2, the first child into
   * `sub+0x90` while there is one, else the mode goes straight back to 0
   * (`0x0048C044`..`0x0048C08A`). `CivilianDrawBonePart` (`FUN_0048D1F0`) is
   * the reader, on bone 2, every draw. `[proved]`
   */
  SetHeadLook = 0x23,
  /**
   * The same with the target named: `sub+0x8C = cmd[1]`, `sub+0x90 =
   * cmd[2]`, a pointer to three floats for modes 4 and 5. Both shipped uses
   * are mode 5, a point in her own frame. `[proved]`
   */
  SetHeadLookAt = 0x24,
  /**
   * **The mouth**: `sub+0xA4 = cmd[1]` (frames), `sub+0xA8 = cmd[2]` (which
   * of `g_civilian_mouth_tables`), `sub+0xA0 = 0` (`0x0048C08C`). The same
   * hook steps the cursor and adds the table's byte to bone 2's slot, which
   * is how a civilian's face moves while she speaks. `[proved]`
   */
  SetMouth = 0x25,
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
  /**
   * **Which bone the shot marker goes to**: the s16 at `cmd+4` into
   * `sub+0xAC` (`0x0048C1C5`). `CivilianUpdate`'s shot arm takes that bone's
   * record point in the world (`MOVSX EAX, word ptr [EAX + 0xac]` at
   * `0x0048ABCB`) for `SpawnCivilianHitMarker` (`FUN_0048E080`). It was
   * `SetCameraBone`, which nothing reads it as. One shipped use, bone 9.
   * `[proved]`
   */
  SetHitBone = 0x28,
  /** OR bits into `obj+0x34`. */
  SetActorFlags = 0x29,
  /** Which death voice to use, or `0xFF` to pick one by character type. */
  SetDeathVoice = 0x2A,
  /**
   * A six-word command taken only while `g_app_state` is 6 — which is
   * **in play**, so this is the ordinary path and not a debug one. It used to
   * be called `DebugOnly` on the strength of that gate alone, back when
   * `g_app_state`'s meaning was an open question.
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
   * So it writes the s16 at `cmd+4` into `sub+0xBC` and a **pointer back
   * into the stream**, at `cmd+8`, into `sub+0xC0` (`ECX` is
   * `g_cur_civilian`, `0x007DD0A0`). Then `CMP dword ptr [ESI + 0x8], EBP;
   * JNZ` at `0x0048C22A`: only a zero `cmd[2]` moves the cursor on, by six
   * dwords -- any other value leaves it on this command and the loop runs it
   * again for ever. Both shipped uses carry 0 there (stage 1's stream 13 and
   * stream 39: `(1, 0, 5, 0x1E, 0x14)` and `(5, 0, 3, 0x1E, 0x14)`).
   *
   * **Nothing reads what it writes.** `sub+0xBC` has three other references
   * in the image: `CivilianInit`'s zero (`0x0048A592`) and `CivilianUpdate`'s
   * countdown, which reads it only to decrement it while it is non-zero
   * (`0x0048AD97`..`0x0048ADA4`). `sub+0xC0` has none. The sweep: every
   * instruction whose operand is `[reg + 0xbc]` or `[reg + 0xc0]` (fifteen and
   * fourteen, the rest stack frames and other structures), and a byte search
   * for `?? ?? C0 00 00 00` whose every `.text` hit outside those is a jump
   * displacement, an immediate or data. So the op has no effect a player can
   * see; the port keeps the two words and the countdown because the engine
   * does (`CivilianState.inPlayCountdown`). `[proved]`
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
   *
   * **It is what holds the room while a rescued civilian speaks.**
   * `CivilianUpdate` calls `ActorRegisterCameraPoint` at `0x0048ADB0` every
   * frame, so while this bit is set she holds a `g_enemy_slots` entry and
   * `g_camera_free` -- the second half of every room-clear gate -- stays down.
   * See `camera/slots.ts` and bug 18.
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
   * block**: 289 of the 596 shipped wait words carry this bit and 307 do not.
   * `[proved]`
   *
   * It is read at the moment op 0x00 runs, which is *inside* the block its own
   * leading `Wait` opened — so the word that governs the clip is the one that
   * introduced it, exactly as {@link CivilianOp.Wait}'s note describes.
   */
  RootMotion = 0x00100000,
  /**
   * The four bits `CivilianApplyMotionPose` (`FUN_0048C310`) reads off the
   * **new** block's word at a clip change -- see `class10/pose.ts`. Either of
   * the first two turns the actor by the heading the drawn pose has and the
   * new clip's first frame lacks (`TEST [sub], 0x18000` at `0x0048C348`);
   * `TurnKeepBones` then counter-rotates records 1 and 9 so the body does not
   * swing through the turn, and `TurnTakeRoot` without it takes record 0 from
   * the new frame. `[proved]`
   */
  TurnKeepBones = 0x00008000,
  TurnTakeRoot = 0x00010000,
  /**
   * Move the actor so bone 1 of the new clip's first frame lands where the
   * last draw put it -- `TEST [sub], 0x20000` at `0x0048C489`. It is how a
   * clip that climbs down off something hands the height it reached to the
   * next one. `[proved]`
   */
  HoldBone1 = 0x00020000,
  /**
   * No blend, and none of the record rewrites: `TEST EAX, 0x200000` at
   * `0x0048C673` jumps straight to `ActorSetMotionBlended(model, clip,
   * start, 0)`. `[proved]`
   */
  Cut = 0x00200000,
  /** Not counted in `g_civilians_alive`, and worth no score. */
  Uncounted = 0x08000000,
  /**
   * **Hand the item over.** Not a wait condition: the bit every shipped op
   * 0x13 and 0x14 names as its entry's operand, which the record's routine
   * tests against this word from `CivilianDrawHeldItems` each frame
   * (`TEST EAX, EDX` at `0x0048DCCE` / `0x0048DD6E`). Eleven wait commands
   * carry it, all `0x940100`: one in each of the eleven streams that append an
   * item, after the append. `[proved]`
   */
  GiveItem = 0x00800000,
  /**
   * Raised by a held item's routine on the frame it gives, and answered by
   * `CivilianDrawHeldItems` (`TEST EAX, 0x400000` at `0x0048CF59`), which
   * clears it and drops that entry. No shipped wait word carries it. `[proved]`
   */
  ItemTaken = 0x00400000,
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
  /**
   * **She stays through a skipped cut scene.** Bit `0x20000000`, read in two
   * places and nowhere else (every `TEST` of the mask in the image):
   * `CivilianUpdate`'s removal (`0x0048AFA0`), where a skip starts her
   * one-frame removal countdown unless the word carries it, and op 0x1D
   * (`0x0048BF3E`), where it lets her line through a skip -- to an
   * `EvtOpPlayDialogue2D` that then says nothing, because it returns on the
   * same flag. Three shipped words carry it: `0x20000080` and two
   * `0x28200000`. `[proved]`
   */
  StayThroughSkip = 0x20000000,
  /** The bits that make the loop worth entering at all. */
  Any = 0x40003fff,
  /** Either of these parks the script whatever else the word says. */
  Blocked = 0x14000000,
}

/**
 * `sub+0x8C`, which ops {@link CivilianOp.SetHeadLook} and
 * {@link CivilianOp.SetHeadLookAt} write and `CivilianDrawBonePart`
 * (`FUN_0048D1F0`) switches on for bone 2: `DEC ECX; CMP ECX, 4; JA; JMP
 * [ECX*4 + 0x0048D994]` at `0x0048D2C6`, five cells, `0x0048D2D7`,
 * `0x0048D2FC`, `0x0048D3B8`, `0x0048D3DA`, `0x0048D3F5`. The shipped
 * streams use 1, 2, 3, 5 and 6. `[proved]`
 */
export enum CivilianHeadMode {
  /** The hook leaves the head alone -- and writes this once the turn is gone. */
  None = 0,
  /** `g_camera_eye` plus 15 up: the gameplay eye, which is the player. */
  Eye = 1,
  /** A child's head: `sub+0x90`'s bone-2 record, in the world. */
  Child = 2,
  /** `g_camera_lookat_target`, the point the camera wants to look at. */
  LookAt = 3,
  /** A point, `*(float3 *)sub+0x90`. No shipped use. */
  Point = 4,
  /** A point in her own frame -- `T(pos) Rx Rz Ry` -- op 0x24's two uses. */
  LocalPoint = 5,
  /**
   * Back to rest: the target is the pose's own angles, so the turn winds down
   * to nothing and the hook then writes {@link None}. The shot arm writes it,
   * and so does the hook when a watched child is gone.
   */
  Rest = 6,
}

/** `CMP ESI, EDI` with `EDI = 6` at `0x0048D7E6`: `sub+0xA8`'s "no mouth". */
export const CIVILIAN_MOUTH_NONE = 6;

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
 * `sub+0x80`, which op {@link CivilianOp.SetSphereCentreMode} writes and
 * `CivilianUpdate` (`FUN_0048A920`) switches on to fill `obj+0x12C`, the
 * collision-sphere centre. `MOVSX EAX, byte ptr [EDX+0x80]; CMP EAX, 3;
 * JA 0x0048AF7D; JMP [EAX*4 + 0x0048B12C]` at `0x0048ADC4`: the table's four
 * cells are `0x0048ADDB`, `0x0048ADFC`, `0x0048AE60` and `0x0048AEC4`, and any
 * other value — negative ones included, the compare being unsigned — writes
 * nothing at all. `[proved]`
 *
 * Every arm but the first reads a bone's **draw record**: the matrix
 * `SkeletonEmitNode` (`FUN_004114C0`) stores at
 * `g_skeleton_node_out + bone*0x90 + 0x28` — `obj+0x20C + bone*0x90 + 0x28`,
 * or `model+0xA0 + bone*0x90` off `g_cur_actor_model` (`obj+0x194`) — which
 * is the stack top just after `SkeletonPoseNode` (`FUN_00411700`) translated
 * and rotated the node, under the camera: the bone's frame in view space. Each
 * arm loads `g_camera_blocks[g_camera_index]` (`0x009A6040`, view to world),
 * `MatrixMultiply`s the record onto it and takes the translation: **the bone's
 * origin in the world**. The byte offsets the arms add to
 * `g_cur_actor_model` are the evidence for the bone numbers.
 *
 * Members are named for the point, not for what the bone may be.
 */
export enum CivilianSphereMode {
  /** `0x0048ADDB`: `obj+0x40..0x48`, the actor's own position. */
  Position = 0,
  /** `0x0048ADFC`: `ADD ECX, 0x1C0` — bone 2's record. */
  Bone2 = 1,
  /**
   * `0x0048AE60`: `ADD EDX, 0x130` — bone 1's record, and `CivilianInit`
   * (`FUN_0048A3E0`) writes this mode, so it is every civilian's until a
   * script says otherwise.
   */
  Bone1 = 2,
  /**
   * `0x0048AEC4`: `ADD EAX, 0x910` then `ADD ECX, 0x760` — bones 15 and 12 —
   * and the point halfway between them, each axis `(a + b) * 0.5` with the
   * `0x3F000000` at `0x004C43AC`.
   */
  Bones12And15 = 3,
}

/**
 * The routines op {@link CivilianOp.SetHook}'s operand names, or 0 for none.
 *
 * Each is an **install**: both VMs call it as `next = hook(obj, cmd + 2)`
 * (`CALL ECX` at `0x0048BD8D` in `CivilianRunScript`, at `0x0048B923` in
 * `CivilianReapplyWaitCommand`), it writes a step into `sub+0x5C` with
 * whatever else it writes, and the pointer it returns is the next command --
 * so the command's length is the routine's to decide, which is why the
 * exporter has to know them by address to decode the stream at all
 * (`CIVILIAN_HOOK_LEN` in `hod2lib/exetab.ts`). What `sub+0x5C` holds
 * afterwards is a {@link CivilianFrameHook}, never one of these.
 */
export enum CivilianHookInstall {
  /** A null operand, and no call: see the two VMs' arms for what each does. */
  None = 0,
  /** `CivilianHookStartFall` (`FUN_0048D9F0`). No operand. */
  StartFall = 0x0048d9f0,
  /** `CivilianHookRideChildren` (`FUN_0048DA90`). No operand. */
  RideChildren = 0x0048da90,
  /** `CivilianHookStartMoveY` (`FUN_0048DB90`). One operand, a float. */
  StartMoveY = 0x0048db90,
  /** `CivilianHookStartMoveLocal` (`FUN_0048DBD0`). Three, a float vector. */
  StartMoveLocal = 0x0048dbd0,
}

/**
 * What `sub+0x5C` holds: the step `CivilianUpdate` calls once a frame with the
 * object pushed, `CALL dword ptr [EAX + 0x5C]` at `0x0048A962` -- straight
 * after the child prune. Only the install routines above write one in, and
 * only `NoOpStub` is ever written back over it.
 */
export enum CivilianFrameHook {
  /**
   * `NoOpStub` (`FUN_0041EBB0`), a bare `RET`: what `CivilianInit` writes
   * (`g_cur_civilian[0x17]`), what the action VM writes for a null operand and
   * the reapply walk after every call, and what the steps that finish write.
   */
  None = 0x0041ebb0,
  /** `CivilianHookFallStep` (`FUN_0048DA20`), from `StartFall`. */
  FallStep = 0x0048da20,
  /** `CivilianHookRideChildrenStep` (`FUN_0048DAB0`), from `RideChildren`. */
  RideChildrenStep = 0x0048dab0,
  /** `CivilianHookMoveYStep` (`FUN_0048DBC0`), from `StartMoveY`. */
  MoveYStep = 0x0048dbc0,
  /** `CivilianHookMoveLocalStep` (`FUN_0048DC10`), from `StartMoveLocal`. */
  MoveLocalStep = 0x0048dc10,
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

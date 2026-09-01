/**
 * Class 0x10 — the civilian, and the game's rescue mechanic.
 *
 * 47 spawns across the six stages, and every one of them is a **script**:
 * `CivilianInit` (`FUN_0048A3E0`) reads a byte at the descriptor tail's `+0x01`
 * and indexes `g_civilian_scripts` (0x005702A8) with it, then hands the stream
 * to `CivilianRunScript` (`FUN_0048B9E0`). Unlike class 0x24 and class 0x25,
 * whose parameters live in the evt, **these scripts are compiled into
 * Hod2.exe** — 67 entry points, 136 streams once the ones only an operand
 * points at are followed, 1,967 commands.
 *
 * ## Two halves, and why there are two
 *
 * A stream is a run of **blocks**, each led by a `Wait` and followed by its
 * actions:
 *
 * * `CivilianRunScript` (`FUN_0048B9E0`) executes opcodes `0x00..0x2C` and
 *   stops before anything above `0x2B`, parking the cursor on the next
 *   `Wait`.
 * * `CivilianStepScript` (`FUN_0048B1E0`) runs every frame and decides whether
 *   the parked wait is over. When it is, `CivilianUpdate` calls the VM again
 *   from the cursor.
 *
 * **The wait word leads its block and governs the wait that follows it.** That
 * is why every shipped stream opens with a `Wait`: the VM runs its first
 * command whatever it is, so the opening `Wait` loads a word, the block runs,
 * and the actor then waits on that word. A word with no wait bits and no timer
 * parks the actor for good, which is how a civilian that has said its line
 * simply stands there — and it is the last command of most of the 136 streams.
 *
 * Every bit of the word is a *reason to keep waiting* — see
 * {@link CivilianWait} — which makes `CivilianStepScript`'s conjunction read
 * inverted: it returns false while the reasons hold.
 *
 * Two consequences worth knowing, both of them the engine's and neither
 * obvious:
 *
 * * **A block whose own wait is already satisfied is skipped.** Once the
 *   parked wait clears, the step loop loads the *cursor's* word and tests it
 *   too; if that passes as well it advances again, and the block it walked
 *   past never runs its actions.
 *   `CivilianReapplyWaitCommand` (`FUN_0048B760`) is what makes that safe — it
 *   re-applies the skipped block's clip, target, timer and cues, which are the
 *   only things a later wait can read.
 * * **The timer does not delay its own block.** The step loop clears it on
 *   every resume, so the value that survives is the one the reapply walk reads
 *   out of the block *ahead* — and a timer of `n` costs `n + 1` frames,
 *   because the test reads the value before the decrement.
 *
 * ## The rescue
 *
 * `CivilianInit` reads a **child count** at tail `+0x0C` and an array of
 * descriptor pointers at `+0x10`, and calls `SpawnFromDescriptor` on each,
 * parenting every one at `child+0x1394`. Those children are the zombies
 * holding the civilian: 47 of them, class 0x30, and **nothing in the evt's
 * instruction stream points at their descriptors** — so the script walker
 * never saw them and this port had neither the zombies nor the rescue.
 *
 * `CivilianPruneDeadChildren` (`FUN_0048CA60`) drops a child from the list
 * when it dies and remembers which player killed it. Wait bit `0x04` blocks
 * until the list is shorter than `childrenGoal`, and the block it unblocks
 * ends with a wait word carrying `0x10000000` — which is where
 * `CivilianRunScript` pays **+400**, to that player or to both.
 *
 * Shooting the civilian instead costs the shooter a **life** and **-100**, and
 * a killing shot costs *both* players 100. That asymmetry is in the code, not
 * a reading of it: the survivable branch calls `ScoreAddForPlayer` once with
 * the player the hit flags name, and the killed branch calls it twice.
 *
 * ## What this does not do
 *
 * [diverges] The **drawing** stays in the renderer, which is where it belongs:
 * `CivilianDrawHeldItems` (`FUN_0048CD10`) is `syncHeldItems` in
 * `render/characters.ts`, and `ActorRegisterCameraPoint`'s shot sphere is that
 * layer's `pick` — this side owns the radius at `obj+0x124` and the item list,
 * and nothing else. `CivilianApplyMotionPose` (`FUN_0048C310`) is not ported:
 * it blends the clip, takes the root translation off the pol file and turns
 * the body by the difference between two bone directions, and the generic
 * `ActorAdvanceMotion` root walk already carries a civilian where its clips
 * say.
 *
 * [open] `CivilianUpdateOnCarrier` (`FUN_0048B140`) pushes a carrier object's
 * translate and rotate around the whole update, for the **7 of 47** spawns
 * whose descriptor `+0x22` is non-zero. The carrier is `g_civilian_carrier`
 * (0x009A2C88), which a class-0x13 sub-constructor writes — and class 0x13 is
 * not read, let alone ported, so there is no object to ride. Those seven stand
 * where the script put them until it is. Naming the dependency is the point:
 * approximating the ride would put them somewhere plausible and wrong.
 *
 * [open] `SpawnCivilianBloodPool` (`FUN_0048E080`) builds a ground decal at the
 * shot point, scaled by how far below the camera plane it is. It is a whole
 * object of its own class with an unread update, and the renderer's impact
 * sprite already marks the hit.
 */
import type { CivilianCmdJson } from "../../bundle/scene";
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, ActorUpdateBoundingSphere, type Actor } from "../actor";
import { ColiTestSphereAgainstFullSet, QueryGroundHeightAt } from "../coli";
import { CamPathCueReached } from "../camera/path";
import { ScoreAddForPlayer } from "../combat/score";
import { PlayerTakeDamageTimed } from "../combat/player";
import { ActorDespawn } from "../despawn";
import { ActorByAt, G } from "../globals";
import type { ActorDebug, ClassFrame, ClassHandler } from "../registry";
import { CharacterTypeOf, MotionOf, MotionPlayFrame, MotionPlayLength, T }
  from "../tables";
import { makeCivilianState, type CivilianState } from "./state";

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
  /** Which point `ActorRegisterCameraPoint` registers for the shot test. */
  SetCameraPointMode = 0x17,
  /** Teleport: six floats, position then rotation. */
  SetPose = 0x18,
  /** `DAT_009C88A4`. `[open]` — the reader has not been read. */
  SetGlobalA = 0x19,
  /** `(a, b)` applied only when this civilian still has children. */
  SetChildCue = 0x1A,
  /** `DAT_009CA0F4`, unless the app state is 10. `[open]`. */
  SetGlobalB = 0x1B,
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
  /** The model scale, `model+0x116C`. Drawing only. */
  SetScale = 0x27,
  /** Which bone the camera point rides. Drawing only. */
  SetCameraBone = 0x28,
  /** OR bits into `obj+0x34`. */
  SetActorFlags = 0x29,
  /** Which death voice to use, or `0xFF` to pick one by character type. */
  SetDeathVoice = 0x2A,
  /** A six-word command taken only while the app state is 6. `[open]`. */
  DebugOnly = 0x2B,
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
  /** Wait while only one player is in play. */
  TwoPlayers = 0x40000000,
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

/** `sub+0x5C`'s own constants — the fall step at 0x0048DA20. */
const FALL_ACCEL = -0.02722;
const FALL_PROBE = 100;
/** `CivilianHookRideChildrenStep`'s turn cap, 0x0048DB6C. */
const RIDE_TURN_CAP = 0x80;

/** `CivilianInit`'s literals. */
const DEFAULT_TURN_RATE = 10;

/** What a shot costs, and what a rescue pays — `ScoreAddForPlayer`'s operands. */
const SHOT_PENALTY = -100;
const RESCUE_AWARD = 400;

function CmdAt(script: number, pc: number): CivilianCmdJson | null {
  const s = T.civilians?.scripts?.[script];
  return s?.[pc] ?? null;
}

/**
 * `CivilianInit` — `FUN_0048A3E0`.
 *
 * Allocates the sub-block, seeds it, points the script at the tail's entry and
 * builds the children. The engine also installs the two pose hooks
 * (`UNK_0048D1F0` and `PoseHookGrowAndPushOutOfWorld`) and binds the part list;
 * both are the renderer's, and are `[diverges]` here.
 */
/** `CivilianInit`'s literal for `obj+0x128` — `0x3F800000`. */
const CIVILIAN_BODY_RADIUS = 1;

export function CivilianInit(obj: Actor, rng?: Rng): void {
  const sub = makeCivilianState();
  obj.civ = sub;
  // `obj+0x120` and `obj+0x121` are both 0xFF: a civilian holds neither a
  // general slot nor an attack permit, whatever `RegisterEnemySlot` hands it.
  obj.attackPermit = -1;
  sub.turnRate = DEFAULT_TURN_RATE;
  // `obj+0x124 = g_actor_radius_by_char[type]`, `obj+0x128 = 1.0`. The first
  // is the shot sphere and is ten units for every civilian; the second is the
  // radius `PoseHookGrowAndPushOutOfWorld` ramps, which op 0x16 retargets.
  obj.radius = CharacterTypeOf(obj)?.actor_radius ?? 0;
  // **This is the one the captors run into.** `obj+0x128` is the body sphere
  // every actor-versus-actor push measures against, and the port set only the
  // shot sphere above — so `ColiTestSphereAgainstActors`' lazy default filled
  // it from `obj+0x124`, ten units, and a captor walking at its civilian was
  // shoved off it from thirteen and a half units away. Its script wants to be
  // within six. It never arrived, and the civilian was never mauled.
  obj.bodyRadius = CIVILIAN_BODY_RADIUS;
  sub.scaleTarget = CIVILIAN_BODY_RADIUS;
  sub.attachSet = CivilianAttachSet(obj.charType);

  const p = T.civilians?.spawns?.[String(obj.at)];
  if (!p) return;
  sub.removePath = p.removePath;
  sub.removeFrame = p.removeFrame;
  sub.childCount = p.children.length;
  sub.children = p.children.map((c) => c.at);
  // `CivilianInit` raises it **unconditionally** — the INC at `0x0048A6FE` is
  // on the straight-line fall-through — and this runs exactly when the engine
  // runs it, on the script's spawn opcode. Three paths take it back, one each.
  G.g_civilians_alive += 1;

  const entry = T.civilians?.entries?.[p.script];
  if (entry === undefined) return;
  sub.script = entry;
  CivilianRunScript(obj, entry, 0, undefined, rng);
}

/**
 * `sub+0x82` — which of a held-item record's six attach sets this character
 * uses, from `CivilianInit`'s own switch on the character type.
 *
 * One record therefore serves every skin that can hold it, with a different
 * offset and scale in a child's hand than in an old man's.
 */
export function CivilianAttachSet(charType: number): number {
  switch (charType) {
    case 0x20: case 0x23:
      return 0;
    case 0x24: case 0x25: case 0x31: case 0x32: case 0x33:
      return 4;
    case 0x26: case 0x29: case 0x2a: case 0x2b: case 0x2c: case 0x2d:
    case 0x38:
      return 1;
    case 0x27: case 0x28:
      return 2;
    case 0x2e: case 0x2f: case 0x30:
      return 3;
    default:
      return 5;
  }
}

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
      case CivilianOp.AddHeldItem:
        // `CivilianAddHeldItem` (`FUN_0048CAE0`) grows the array by one and
        // appends. The engine's second operand is the pair's other half, which
        // only the per-item callback reads and nothing here does.
        if ((c.item ?? -1) >= 0) sub.items.push(c.item!);
        break;
      case CivilianOp.AddPickedItem:
        // `CivilianAddPickedItem` (`FUN_0048CB60`) — the same, with whatever
        // op 0x15 last chose.
        if (sub.pickedItem >= 0) sub.items.push(sub.pickedItem);
        break;
      case CivilianOp.PickHeldItem: {
        // `CivilianPickHeldItem` (`FUN_0048CBF0`): sum the weights, take
        // `rand() % total`, and walk the list subtracting until it goes
        // negative. Drawn from `ctx.rng` — `Math.random` would break the
        // snapshot, and which bottle a civilian is holding is state.
        const tbl = c.itemTable ?? [];
        const total = tbl.reduce((n, e) => n + e[0], 0);
        const draw = f?.rng ?? rng;
        if (total > 0 && draw) {
          let r = draw.int(total) - (tbl[0]?.[0] ?? 0);
          let i = 0;
          while (r >= 0 && i + 1 < tbl.length) { i += 1; r -= tbl[i][0]; }
          sub.pickedItem = tbl[i]?.[1] ?? -1;
        }
        break;
      }
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

/** Reinterpret a script dword as the float the engine reads it as. */
function AsFloat(v: number): number {
  const b = new DataView(new ArrayBuffer(4));
  b.setInt32(0, v | 0, true);
  return b.getFloat32(0, true);
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
  obj.clock = m && m.fps ? frame / m.fps : 0;
  obj.rootFrame = -1;
}

/**
 * `CivilianStepScript` — `FUN_0048B1E0`.
 *
 * Returns true when the parked wait is over and the VM should run. **Every bit
 * of the wait word is a reason to keep waiting**, so the engine's conjunction
 * reads inverted at first glance: it breaks out (returns false) when all the
 * reasons still hold, and falls through to the resume when one of them does
 * not.
 *
 * The resume is not simply "the next command". `sub.skipCount` (op 0x11) says
 * how many wait commands to walk past first, and each is walked by
 * `CivilianReapplyWaitCommand`, which re-applies the state the *skipped*
 * block's wait conditions read without running its actions.
 */
export function CivilianStepScript(obj: Actor, f: ClassFrame): boolean {
  const sub = obj.civ;
  if (!sub || sub.script < 0) return false;

  // The engine saves the fields `CivilianReapplyWaitCommand` may clobber and
  // puts them back before returning false, so a frame that does not resume
  // leaves the sub-block exactly as it found it.
  const saved = {
    loops: sub.loops, childrenGoal: sub.childrenGoal,
    enemiesGoal: sub.enemiesGoal, civiliansGoal: sub.civiliansGoal,
    cuePath: sub.cuePath, cueFrame: sub.cueFrame,
    motionCompare: sub.motionCompare, flagIndex: sub.flagIndex,
  };
  let word = sub.wait;
  let pc = sub.cursor;
  let ran = false;

  for (let guard = 0; guard < 256; guard++) {
    if (!((word & CivilianWait.Any) !== 0 || sub.timer >= 0)) break;
    if (word & CivilianWait.Blocked) break;

    if (CivilianWaitStillHolds(obj, word)) {
      if ((word & (CivilianWait.Reach | CivilianWait.Face)) === 0) {
        if (!CivilianCueMet(obj, word)) {
          const t = sub.timer;
          if (t < 0) break;
          sub.timer = t - 1;
          if (t !== 0) break;
        }
      } else if (!CivilianArrived(obj, word, f)) {
        break;
      } else {
        sub.targetMode = CivilianTarget.None;
      }
    }

    sub.timer = -1;
    ran = true;
    sub.hookBusy = 0;
    let at = pc;
    if (sub.resumeScript >= 0) {
      sub.script = sub.resumeScript;
      at = 0;
      sub.resume = 0;
      sub.resumeScript = -1;
    } else {
      while (sub.skipCount !== 0) {
        at = CivilianReapplyWaitCommand(obj, sub.script, at);
        sub.skipCount -= 1;
      }
    }
    const here = CmdAt(sub.script, at);
    word = here?.args?.[0] ?? 0;
    sub.cursor = at;
    pc = CivilianReapplyWaitCommand(obj, sub.script, at);
    if (CmdAt(sub.script, pc)?.op === CivilianOp.End) break;
  }

  if (!ran) Object.assign(sub, saved);
  return ran;
}

/** True while the wait word's counters and gates still hold the script. */
function CivilianWaitStillHolds(obj: Actor, word: number): boolean {
  const sub = obj.civ;
  if (!sub) return false;
  if ((word & CivilianWait.EnemiesPresent)
      && !(sub.enemiesGoal < G.g_enemies_present)) return false;
  if ((word & CivilianWait.EnemiesAlive)
      && !(sub.enemiesGoal < G.g_enemies_alive)) return false;
  if ((word & CivilianWait.CiviliansAlive)
      && !(sub.civiliansGoal < G.g_civilians_alive)) return false;
  if ((word & CivilianWait.ChildrenAlive)
      && !(sub.childrenGoal < sub.childCount)) return false;
  if ((word & CivilianWait.MotionLoops) && sub.loops === 0) return false;
  if ((word & CivilianWait.MotionFrame)
      // `*(int *)(model + 8)` is `obj+0x19C`, the **play** cursor, not the
      // authored frame index — the same clock every other cue is counted in.
      && MotionPlayFrame(obj) === sub.motionCompare) return false;
  if ((word & CivilianWait.Hook) && sub.hookBusy !== 0) return false;
  if (word & CivilianWait.Free) return false;
  if ((word & CivilianWait.CameraSettled)
      && !(G.g_camera_settled === 0)) return false;
  // `?? 0` and not a bare read: a flag the script has never set is absent from
  // the array, and `undefined !== 0` would have ended the wait on frame one.
  if ((word & CivilianWait.ScriptFlag)
      && (G.g_script_flags[sub.flagIndex] ?? 0) !== 0) return false;
  return true;
}

/** The camera cue and the player-count gate, which sit past the timer. */
function CivilianCueMet(obj: Actor, word: number): boolean {
  const sub = obj.civ;
  if (!sub) return false;
  if ((word & CivilianWait.CameraCue)
      && CamPathCueReached(sub.cuePath, sub.cueFrame)) return true;
  if ((word & CivilianWait.TwoPlayers) && G.g_two_player_game >= 1) return true;
  return false;
}

/** Wait bits 0x10 / 0x20 / 0x40: has the actor reached or faced its target? */
function CivilianArrived(obj: Actor, word: number, f: ClassFrame): boolean {
  const sub = obj.civ;
  if (!sub) return false;
  const to = CivilianTargetPoint(obj, f);
  if ((word & CivilianWait.Reach) === 0) {
    // Turn only: arrived the frame the heading error rounds to zero.
    const err = HeadingError(obj, to);
    if (err === 0) { sub.targetMode = CivilianTarget.None; return true; }
    return CivilianInFront(obj, word, to);
  }
  const d = Math.hypot(obj.pos.x - to.x, obj.pos.z - to.z);
  if (sub.radius < d) return CivilianInFront(obj, word, to);
  if (sub.targetMode > 0 && sub.radius <= 1) {
    obj.pos.x = to.x;
    obj.pos.z = to.z;
  }
  return true;
}

/** Wait bit 0x40, which can end the wait on its own. */
function CivilianInFront(obj: Actor, word: number,
                         to: { x: number; y: number; z: number }): boolean {
  if ((word & CivilianWait.InFront) === 0) return false;
  const a = obj.yaw * ((Math.PI * 2) / 65536);
  const dx = to.x - obj.pos.x;
  const dz = to.z - obj.pos.z;
  // The engine rotates the delta into the actor's own frame and tests z.
  return dz * Math.cos(a) - dx * Math.sin(a) > 0;
}

/** Where `targetMode` says the target is, this frame. */
function CivilianTargetPoint(obj: Actor, f: ClassFrame):
    { x: number; y: number; z: number } {
  const sub = obj.civ;
  if (!sub) return { x: 0, y: 0, z: 0 };
  if (sub.targetMode >= 0) return sub.target;
  if (sub.targetMode === CivilianTarget.Camera) {
    return { x: f.eye.x, y: f.eye.y, z: f.eye.z };
  }
  return { x: obj.pos.x * 2 - f.eye.x, y: f.eye.y,
           z: obj.pos.z * 2 - f.eye.z };
}

/** The BAMS the actor would have to turn to face `to`. */
function HeadingError(obj: Actor, to: { x: number; z: number }): number {
  const want = Math.atan2(obj.pos.x - to.x, obj.pos.z - to.z);
  const have = obj.yaw * ((Math.PI * 2) / 65536);
  let d = want - have;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.trunc(d * (65536 / (Math.PI * 2)));
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
        obj.clock = 0;
        break;
      case CivilianOp.SetMotionFrom: {
        sub.loops = a[1];
        const m = MotionOf(obj, obj.motion);
        obj.clock = m && m.fps ? a[2] / m.fps : 0;
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

/**
 * `CivilianPruneDeadChildren` — `FUN_0048CA60`.
 *
 * Drops every child whose `obj+0x34` carries the dead bit, remembering the
 * player named at `child+0x131C` — which is who gets the +400 when the last
 * one goes.
 */
export function CivilianPruneDeadChildren(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  const keep: number[] = [];
  for (const at of sub.children) {
    const kid = ActorByAt(at);
    if (kid && !(kid.dead || (kid.flags & ActorFlag.Dead))) {
      keep.push(at);
      continue;
    }
    if (kid) sub.rescuePlayer = kid.killedBy ?? -1;
    // `sub+0x64` is the pounce slot; the engine clears it when the child
    // holding it goes, or the next one never gets a turn.
    if (sub.pouncer === at) sub.pouncer = 0;
  }
  sub.children = keep;
  sub.childCount = keep.length;
}

/**
 * `CivilianPlayDeathVoice` — `FUN_0048D140`.
 *
 * `sub+0x81` names the voice; `0xFF` picks one from the character type, which
 * is what proves what this class is: types 0x24/0x25/0x2E/0x31-0x33 get id
 * `0x2000001A`, 0x21/0x22 get `0x20000011`, 0x26-0x2C get `0x2000000B`,
 * 0x20/0x23/0x2D get `0x2000000D`, and everything else `0x20000012` — the
 * young man, the man, the young woman, the old woman and the child of
 * `COM\\220_Y_M.WAV` and its neighbours.
 */
export function CivilianPlayDeathVoice(obj: Actor, events?: Events): void {
  const sub = obj.civ;
  const byIndex = [0x2000001a, 0x20000012, 0x2000000b, 0x20000011,
                   0x2000000d];
  let id: number;
  const sel = sub?.deathVoice ?? 0xff;
  if (sel < byIndex.length) {
    id = byIndex[sel];
  } else {
    const t = obj.charType;
    if (t === 0x20 || t === 0x23 || t === 0x2d) id = byIndex[4];
    else if (t === 0x21 || t === 0x22) id = byIndex[3];
    else if (t === 0x24 || t === 0x25 || t === 0x2e
             || (t >= 0x31 && t <= 0x33)) id = byIndex[0];
    else if (t >= 0x26 && t <= 0x2c) id = byIndex[2];
    else id = byIndex[1];
  }
  events?.emit("sound.play", { id });
}

/**
 * `CivilianUpdate` — `FUN_0048A920`. One frame of a civilian.
 *
 * The order is the engine's: prune, hook, turn, interpolate, advance the clip,
 * step the script, then the shot branch, the sound queue and the removal. The
 * shot branch runs **after** the script step on purpose — a shot taken this
 * frame switches the script the step just resumed.
 */
export function CivilianUpdate(obj: Actor, f: ClassFrame): void {
  const sub = obj.civ;
  if (!sub) return;
  const frames = f.dt * 60;

  CivilianPruneDeadChildren(obj);
  CivilianRunFrameHook(obj, frames);
  if (sub.targetMode !== CivilianTarget.None) CivilianStepTurnToTarget(obj, f);

  // Op 0x26's move, which the engine steps by a per-frame delta and then snaps.
  if (sub.moveFrames !== 0) {
    sub.moveFrames -= 1;
    if (sub.moveFrames === 0) {
      obj.pos = { ...sub.moveTo };
    } else {
      obj.pos.x += obj.vel.x;
      obj.pos.y += obj.vel.y;
      obj.pos.z += obj.vel.z;
    }
  }

  // The loop counter. The clip clock itself is `ActorAdvanceMotion`'s; this is
  // the part class 0x10 owns — how many more times it may come round.
  CivilianCountMotionLoops(obj);

  if (CivilianStepScript(obj, f)) {
    CivilianRunScript(obj, sub.script, sub.cursor, f);
  }

  CivilianCheckShot(obj, f);

  // The queued sound, and the list op 0x22 left behind it.
  if (sub.soundDelay !== 0) {
    sub.soundDelay -= 1;
    if (sub.soundDelay === 0) {
      f.events?.emit("sound.play", { id: sub.soundId });
      const next = sub.sounds.shift();
      if (next) { sub.soundId = next[0]; sub.soundDelay = next[1]; }
    }
  }

  // `ActorRegisterCameraPoint(4.0)` (`FUN_00409B70`) goes here in the engine:
  // it transforms `obj+0x100` into view space, appends the actor to the
  // per-frame gunshot list and raises `obj+0x104` by its argument.
  //
  // [diverges] Every part of that is the draw's. `obj+0x100` is written by
  // `SkeletonEmitNode` as the skeleton is walked, and the port has no
  // skeleton — `render/characters.ts`'s `trackLookAt` is that writer here, and
  // it already applies the same 4.0 rise. The shot test is the renderer's too,
  // for the same reason: the ray is the mouse's. What the port owns is the
  // sphere's *radius*, `obj+0x124`, which `CivilianInit` sets.
  CivilianWriteCameraPoint(obj);
  PoseHookGrowAndPushOutOfWorld(obj);
  CivilianCheckRemoval(obj);
}

/**
 * `PoseHookGrowAndPushOutOfWorld` — `FUN_0048D070`.
 *
 * The class's per-frame pose hook, and one of only two in the program. It does
 * two things and neither is a bone: it steps `obj+0x128` — the **body radius**
 * — toward the target op 0x16 set, by that op's per-frame step, clamping at
 * the target from whichever side it approaches; then, if the civilian's wait
 * word carries {@link CivilianWait.PushOutOfWorld}, it traces that sphere
 * against the full collision set and moves the actor out along the hit normal
 * by the **whole** penetration.
 *
 * The engine runs it from the pose walk; the port runs it from the update,
 * for the same reason `ActorAdvanceMotion` lives in `game/` — a hook that only
 * fires while something is drawing is a hook that a headless run and a
 * restored save both lose.
 */
export function PoseHookGrowAndPushOutOfWorld(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  if (sub.scaleTarget !== obj.bodyRadius) {
    obj.bodyRadius += sub.scaleStep;
    // Clamp from whichever side it is closing: growing overshoots upward,
    // shrinking overshoots downward, and a zero step never arrives at all.
    if (sub.scaleStep > 0 && obj.bodyRadius > sub.scaleTarget) {
      obj.bodyRadius = sub.scaleTarget;
    } else if (sub.scaleStep < 0 && obj.bodyRadius < sub.scaleTarget) {
      obj.bodyRadius = sub.scaleTarget;
    }
  }
  if (!(sub.wait & CivilianWait.PushOutOfWorld)) return;
  ActorUpdateBoundingSphere(obj);
  if (!ColiTestSphereAgainstFullSet(obj.camPoint.x, obj.camPoint.y,
                                    obj.camPoint.z, obj.bodyRadius)) {
    return;
  }
  const d = G.g_coli_hit_depth;
  obj.pos.x += (G.g_coli_hit_normal[0] ?? 0) * d;
  obj.pos.y += (G.g_coli_hit_normal[1] ?? 0) * d;
  obj.pos.z += (G.g_coli_hit_normal[2] ?? 0) * d;
}

/**
 * The camera-point switch at the tail of `CivilianUpdate`: `sub+0x80` (op
 * 0x17) picks which point goes to `obj+0x12C`.
 *
 * [open] Only mode 0 is ported. Modes 1, 2 and 3 multiply the camera matrix by
 * a matrix inside the model block (`model+0x70`, `model+0x4C`, and the
 * midpoint of `model+0x244` and `model+0x1D8`) and those are not bone records
 * — they are matrices the pose leaves behind, which `game/` cannot reach.
 * Eight of the shipped streams ask for mode 1, four for mode 2, two for mode 3.
 */
function CivilianWriteCameraPoint(obj: Actor): void {
  if (obj.civ?.cameraPointMode !== 0) return;
  obj.camPoint.x = obj.pos.x;
  obj.camPoint.y = obj.pos.y;
  obj.camPoint.z = obj.pos.z;
}

/**
 * The shot and the rescue branch of `CivilianUpdate`.
 *
 * `sub.onShot` is the gate: a civilian with no on-shot script has its hit bits
 * cleared every frame and cannot be hurt at all, which is how the ones behind
 * glass work.
 */
function CivilianCheckShot(obj: Actor, f: ClassFrame): void {
  const sub = obj.civ;
  if (!sub) return;
  if (sub.onShotScript < 0) {
    obj.flags &= ~0xe;
    obj.pendingHit = null;
    return;
  }
  const killed = (obj.flags & ActorFlag.Dead) !== 0;
  const hit = killed || (obj.flags & 8) !== 0 || obj.pendingHit !== null;
  if (!hit) return;

  let player: number;
  if (killed) {
    // A killing shot costs **both** players 100 — the engine calls
    // `ScoreAddForPlayer` twice with no test at all.
    player = -1;
    if (!(sub.wait & CivilianWait.Uncounted)) {
      ScoreAddForPlayer(0, SHOT_PENALTY, f.events);
      ScoreAddForPlayer(1, SHOT_PENALTY, f.events);
    }
  } else {
    // `obj+0x34` bits 1 and 2 name the shooter; neither means "either".
    const two = obj.flags & 6;
    player = two === 2 ? 0 : two === 4 ? 1 : (f.rng.next() < 0.5 ? 0 : 1);
    PlayerTakeDamageTimed(player, obj, 0, f.events);
    ScoreAddForPlayer(player, SHOT_PENALTY, f.events);
    G.g_head_combo_bonus[player] = 0;
    G.g_player_hit_count[player] += 1;
    obj.flags |= ActorFlag.Dead;
  }
  obj.pendingHit = null;
  obj.dead = true;
  sub.timer = -1;
  sub.targetMode = CivilianTarget.None;
  sub.sounds = [];
  sub.soundDelay = 0;

  // The killed branch takes `onShotAlt` when there is one; the survivable one
  // always takes `onShot`.
  const to = !killed && sub.onShotAltScript >= 0
    ? sub.onShotAltScript : sub.onShotScript;
  sub.onShot = 0;
  sub.onShotScript = -1;
  sub.resume = 0;
  sub.resumeScript = -1;
  f.events?.emit("civilian.shot", { at: obj.at, player });
  CivilianPlayDeathVoice(obj, f.events);
  CivilianRunScript(obj, to, 0, f);
}

/**
 * The removal cue: camera path `removePath` reaching frame `removeFrame`
 * starts a countdown, and the actor leaves when it runs out.
 */
function CivilianCheckRemoval(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  if (sub.removeDelay === 0) {
    if (CamPathCueReached(sub.removePath, sub.removeFrame)) {
      sub.removeDelay = Math.max(1, T.civilians?.spawns?.[String(obj.at)]
        ?.removeDelay ?? 0);
    }
    return;
  }
  sub.removeDelay -= 1;
  if (sub.removeDelay !== 0) return;
  // A civilian still holding children does not leave: the engine restarts the
  // countdown instead, which is what keeps a hostage on stage until rescued.
  if (sub.childCount !== 0) { sub.removeDelay = 1; return; }
  if (!(sub.flags2 & 1)) G.g_civilians_alive -= 1;
  ActorDespawn(obj);
}

/** Op 0x00's loop counter, which wait bit 0x100 blocks on. */
export function CivilianCountMotionLoops(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  const m = MotionOf(obj, obj.motion);
  if (!m) return;

  // `(short)sub+0x0C`, **signed**: negative means play for ever, and the
  // engine's `if (0 < loops)` skips the whole arm at zero — a clip with no
  // loops left does not advance at all.
  const loops = sub.loops;
  if (loops < 0) return;
  if (loops === 0) { CivilianHoldLastFrame(obj); return; }

  const cur = MotionPlayFrame(obj);
  if (sub.frameLimit === 0) {
    // `model[2] < g_anim_frame_counts[model[8]]` — the **play** length. The
    // cursor wraps at `play + 1`, so this is false on exactly one frame of
    // each play-through, which is what makes a loop cost one play rather than
    // one frame. Reading `m.frames` here spent a loop halfway through instead.
    if (cur < MotionPlayLength(obj)) return;
    sub.loops -= 1;
    if (sub.loops !== 0) return;      // more to play: keep advancing
    CivilianHoldLastFrame(obj);
    return;
  }
  // The frame-limit form: stop at `sub+0x08` rather than at the clip's end,
  // and rewind only when the wait word asks for another loop.
  if (cur < sub.frameLimit) return;
  if (sub.wait & CivilianWait.MotionLoops) {
    sub.loops -= 1;
    if (sub.loops !== 0) {
      obj.clock = 0;
      obj.rootFrame = -1;
      return;
    }
  }
  CivilianHoldLastFrame(obj);
}

/**
 * Stop the play cursor where it is.
 *
 * **This is what the engine does by simply not incrementing it.**
 * `CivilianUpdate`'s loop arm advances `model+0x00` only while the loop count
 * allows; when it runs out nothing touches the cursor again and the clip sits
 * on its last frame for as long as the actor lives. The port's clock is
 * advanced unconditionally by `ActorAdvanceMotion` and wrapped by the
 * renderer, so "stop incrementing" has to be said out loud — otherwise a
 * civilian killed in a set piece plays its dying clip over and over, which is
 * exactly what it did.
 *
 * The cursor is pinned at the play length rather than at the clip's last
 * authored frame because that is where the engine's leaves it: the increment
 * is refused on the first frame that reaches it.
 */
function CivilianHoldLastFrame(obj: Actor): void {
  const m = MotionOf(obj, obj.motion);
  if (!m?.fps) return;
  // The cursor is at the play length when the last loop is spent -- the one
  // value that wraps to zero on the next tick -- so pinning the clock there
  // is exactly the engine's "stop incrementing `model[0]`".
  const hold = MotionPlayLength(obj) / (m.fps * 2);
  if (obj.clock > hold) obj.clock = hold;
}

/** `sub+0x5C`, called once a frame before anything else moves the actor. */
function CivilianRunFrameHook(obj: Actor, frames: number): void {
  const sub = obj.civ;
  if (!sub) return;
  switch (sub.hook as CivilianHook) {
    case CivilianHook.Fall:
    case CivilianHook.LaunchUp:
    case CivilianHook.Launch: {
      // `0x0048DA20`: accelerate, step, and stop the frame the ground is at
      // or above the new height.
      obj.vel.y += obj.accY * frames;
      const ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y + FALL_PROBE,
                                         obj.pos.z);
      obj.pos.x += obj.vel.x * frames;
      obj.pos.y += obj.vel.y * frames;
      obj.pos.z += obj.vel.z * frames;
      if (ground >= obj.pos.y) {
        obj.pos.y = ground;
        obj.vel = { x: 0, y: 0, z: 0 };
        sub.hookBusy = 1;
        sub.hook = CivilianHook.None;
      }
      break;
    }
    case CivilianHook.RideChildren: {
      // `0x0048DAB0`: face the **average** of the surviving captors, at up to
      // 0x80 BAMS a frame, and uninstall once this actor is flagged dead. It
      // is a facing, not a carry — the civilian turns to whoever is still
      // holding it, and stops when the last one is gone.
      if (obj.flags & ActorFlag.Dead) { sub.hook = CivilianHook.None; break; }
      const n = sub.children.length;
      if (n === 0) break;
      const mid = { x: 0, y: 0, z: 0 };
      for (const at of sub.children) {
        const kid = ActorByAt(at);
        if (!kid) continue;
        mid.x += kid.pos.x; mid.y += kid.pos.y; mid.z += kid.pos.z;
      }
      mid.x /= n; mid.y /= n; mid.z /= n;
      ActorTurnTowardPoint(obj, mid, RIDE_TURN_CAP);
      break;
    }
    case CivilianHook.None:
    default:
      break;
  }
}

/**
 * `CivilianStepTurnToTarget` — `FUN_0048C850`, and the turn itself is
 * `ActorTurnTowardPoint` (`FUN_0048C990`).
 *
 * One capped step of yaw per frame toward whatever `targetMode` names.
 */
export function CivilianStepTurnToTarget(obj: Actor, f: ClassFrame): void {
  const sub = obj.civ;
  if (!sub) return;
  ActorTurnTowardPoint(obj, CivilianTargetPoint(obj, f), sub.turnRate);
}

/**
 * `ActorTurnTowardPoint` — `FUN_0048C990`. Turn `obj` toward `to`, by at most
 * `cap` BAMS this frame.
 */
export function ActorTurnTowardPoint(obj: Actor,
                                     to: { x: number; y: number; z: number },
                                     cap: number): void {
  const err = HeadingError(obj, to);
  const step = err > cap ? cap : err < -cap ? -cap : err;
  obj.yaw = (obj.yaw + step) & 0xffff;
}

/**
 * The civilian VM, for the debug sidebar.
 *
 * The wait word is the whole story: `CivilianStepScript` only enters its loop
 * when the word has a bit in `Any` or the timer is running, so a word made
 * only of high bits is parked until something outside the VM moves it — which
 * is what stage 1's hostage does while it waits to be killed. Spelling the
 * bits out, next to the counter or cue each one is actually waiting on, is the
 * difference between reading that and staring at a hex value.
 */
const WAIT_BIT_NAMES: [number, string][] = [
  [CivilianWait.EnemiesPresent, "enemies-present"],
  [CivilianWait.EnemiesAlive, "enemies-alive"],
  [CivilianWait.ChildrenAlive, "children-alive"],
  [CivilianWait.CiviliansAlive, "civilians-alive"],
  [CivilianWait.Reach, "reach"], [0x20, "face"], [0x40, "in-front"],
  [0x80, "camera-cue"],
  [CivilianWait.MotionLoops, "motion-loops"],
  [CivilianWait.MotionFrame, "motion-frame"],
  [0x400, "hook"], [CivilianWait.Free, "free"],
  [CivilianWait.CameraSettled, "camera-settled"],
  [CivilianWait.ScriptFlag, "script-flag"],
  [CivilianWait.LeaveCountNow, "leave-count"],
  [CivilianWait.PushOutOfWorld, "push-out"],
  [CivilianWait.RemoveOffCamera, "remove-off-camera"],
  [CivilianWait.Uncounted, "uncounted"],
  [CivilianWait.Rescued, "rescued"],
  [CivilianWait.TwoPlayers, "two-players"],
];

export function CivilianDebug(obj: Actor): ActorDebug {
  const sub = obj.civ;
  if (!sub) return { summary: "no VM state", hot: true };
  const word = sub.wait >>> 0;
  const parked = (word & CivilianWait.Any) === 0 && sub.timer < 0;
  const bits = WAIT_BIT_NAMES.filter(([b]) => word & b).map(([, n]) => n);

  // What each set bit is actually waiting on, beside its current value: a
  // script held by a counter reads differently from one waiting on a cue that
  // has already gone by, and only the second is a bug.
  const on: string[] = [];
  if (word & CivilianWait.EnemiesAlive) {
    on.push(`enemies>${sub.enemiesGoal} (${G.g_enemies_alive})`);
  }
  if (word & CivilianWait.CiviliansAlive) {
    on.push(`civilians>${sub.civiliansGoal} (${G.g_civilians_alive})`);
  }
  if (word & CivilianWait.ChildrenAlive) {
    on.push(`children>${sub.childrenGoal} (${sub.childCount})`);
  }
  if (word & CivilianWait.MotionLoops) on.push(`loops ${sub.loops}`);
  if (word & CivilianWait.MotionFrame) {
    on.push(`frame ${MotionPlayFrame(obj)}==${sub.motionCompare}`);
  }
  if (word & 0x80) {
    on.push(`cue (${sub.cuePath},${sub.cueFrame}) now `
      + `(${G.g_active_cam_path},${G.g_cam_path_frame})`);
  }
  if (sub.timer >= 0) on.push(`timer ${sub.timer}`);

  const detail = [
    `script ${sub.script} · pc ${sub.pc} · cursor ${sub.cursor}`
      + ` · motion ${obj.motion}`,
    `wait 0x${word.toString(16)}${bits.length ? " · " + bits.join(" ") : ""}`,
  ];
  if (on.length) detail.push(`on ${on.join(" · ")}`);
  if (parked) {
    detail.push("no loop bit and no timer — parked until something "
      + "outside the VM moves it");
  }
  detail.push(`removal (${sub.removePath},${sub.removeFrame})`
    + ` delay ${sub.removeDelay} · children ${sub.childCount}`
    + ` · onShot ${sub.onShotScript}`);
  return {
    summary: (obj.dead ? "dead · " : "")
      + (parked ? "parked" : bits.length ? bits.join(" ") : "running"),
    detail,
    hot: parked && !obj.dead,
  };
}

export const CivilianHandler: ClassHandler = {
  init: CivilianInit,
  update: CivilianUpdate,
  debug: CivilianDebug,
  // A civilian has no hit table and no hit points: the shot test marks it and
  // `CivilianCheckShot` is what a hit *means*. See `combat/shot.ts`.
  ownsShotResult: true,
  // A shot civilian keeps running: its on-shot script is what plays the fall,
  // the voice and the removal, and stopping at `dead` froze it upright.
  updatesWhenDead: true,
};

export type { CivilianState };

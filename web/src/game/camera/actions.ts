/**
 * The queued-action ring, and the ten actions `queue_event` can put on it.
 *
 * `EvtOpQueueEvent30` (`FUN_0045F7F0`), in the interpreter's task, only
 * **pushes** a pointer to its instruction onto a sixteen-slot ring and adds
 * one to `g_queued_events_pending`. Nothing runs until `EvtRunQueuedActions`
 * (`FUN_00402320`), which `CameraActorTick` calls two tasks later in the same
 * frame (the scene's task list at `0x00460710`: the interpreter first, the
 * camera actor third):
 *
 * ```c
 * for (;;) {
 *     g_evt_action_handler(0);                       // the current handler, every frame
 *     if (ring empty) break;
 *     if (g_evt_action_advance is 1 or 2) {
 *         handler = g_evt_action_table[sel >> 4][sel & 0xF];  operands = record;
 *         call_now = g_evt_action_advance == 1;
 *     } else call_now = false;
 *     g_evt_action_advance = 0;
 *     if (!call_now) return;
 * }
 * if (g_evt_action_advance is 1 or 2) g_evt_action_handler = NoOpStub;
 * ```
 *
 * So an action queued while the current handler is still running -- a
 * `cam_play` mid-shot, a `finish_sequence`'s driver -- **waits in the ring**
 * until that handler retires (`advance = 1`: the next action is dequeued and
 * called in the same pass) or the script lets go of it (`goto_scene_state`:
 * advance 1 and the slot parked; `set_action_drain_mode 2`: dequeued now,
 * first called next frame). A handler retires with `advance = 1;
 * g_queued_events_pending--` and leaves itself in the slot for the ring to
 * replace. `[proved]`
 *
 * Everything is `G`'s: the ring, the cursor mode, the operand scratch and the
 * handler identity. Only slot 0 of the four evt-action blocks is modelled --
 * the other three are the two-player camera blocks' and the shipped scripts
 * never queue into them.
 */
import { G } from "../globals";
import { MatIdentity, MatrixLoadIdentity, MatrixRotateX, MatrixRotateY,
         MatrixTransformPoint, MatrixTranslate } from "../matrix";
import { vec3 } from "../vec";
import { EVT_ACTION_TABLE, EvtActionHandler } from "./driver";
import { makeCameraBlockRecords } from "./slot_table";
import { CAMERA_EYE_DROP, CamStashPathRange } from "./rail";
import { CamAdvancePathFrame, CamEvalStaticPose, CamStartPathPlayback,
         EvtActionRetire } from "./path";
import { EvtEnterSceneState, EvtEnterSceneStateUnstamped } from "./hooks";
import { CameraMode, CameraResetForPathShot, CameraDriverSelectMode }
  from "./mode";
import { CameraDriverFromDeferredPose } from "./track";

/** `DAT_009A34D0`..`DAT_009CA108`: sixteen slots, masked `& 0xF`. */
export const EVT_ACTION_RING_SLOTS = 16;

/**
 * One ring record: the selector and its operands, as the instruction holds
 * them. The engine's ring holds a pointer to the instruction; the port holds
 * the words, which is the same thing for a program that is never rewritten.
 */
export interface EvtQueuedAction {
  sel: number;
  args: number[];
}

/**
 * `[port-only]` as a function -- the push half of `EvtOpQueueEvent30`
 * (`FUN_0045F7F0`); the skip test in front of it is the interpreter's:
 *
 * ```c
 * ring[DAT_009CA108] = g_evt_ip;
 * if (selector == 0x21) g_attack_committed = 0;     // CMP EDX, 0x21 at 0x0045F82E
 * DAT_009CA108 = (DAT_009CA108 + 1) & 0xF;
 * g_queued_events_pending++;
 * ```
 *
 * A seventeenth push would overwrite the oldest unrun record; the shipped
 * scripts never have more than three outstanding. `[proved]`
 */
export function EvtQueueAction(sel: number, args: readonly number[]): void {
  const ring = G.g_evt_action_ring;
  if (ring.length >= EVT_ACTION_RING_SLOTS) ring.shift();
  ring.push({ sel, args: [...args] });
  if (sel === 0x21) G.g_attack_committed = 0;
  G.g_queued_events_pending += 1;
}

/**
 * `EvtRunQueuedActions` — `FUN_00402320`. See the head of this file.
 *
 * `g_evt_action_advance` is **not** reset on the way out of the loop through
 * the empty test, so an idle ring keeps it at 1 and the next record queued is
 * dequeued and called on the frame it arrives. `[proved]`
 */
export function EvtRunQueuedActions(): void {
  for (;;) {
    EvtCallActionHandler();
    const ring = G.g_evt_action_ring;
    if (ring.length === 0) break;
    let callNow = false;
    const adv = G.g_evt_action_advance;
    if (adv >= 1 && adv <= 2) {
      const rec = ring.shift() as EvtQueuedAction;
      G.g_evt_action_handler =
        EVT_ACTION_TABLE[rec.sel] ?? EvtActionHandler.None;
      const ops = G.g_evt_action_operands;
      for (let i = 0; i < 8; i++) ops[i] = rec.args[i] ?? 0;
      callNow = adv === 1;
    }
    G.g_evt_action_advance = 0;
    if (!callNow) return;
  }
  const adv = G.g_evt_action_advance;
  if (adv >= 1 && adv <= 2) G.g_evt_action_handler = EvtActionHandler.None;
}

/**
 * `[port-only]` -- `(*g_evt_action_handler)(0)`, a switch over
 * {@link EvtActionHandler} standing in for the indirect call.
 */
export function EvtCallActionHandler(): void {
  switch (G.g_evt_action_handler as EvtActionHandler) {
    case EvtActionHandler.None: return;
    case EvtActionHandler.PathPlay: return CamAdvancePathFrame();
    case EvtActionHandler.SelectMode: return CameraDriverSelectMode();
    case EvtActionHandler.DeferredPose: return CameraDriverFromDeferredPose();
    case EvtActionHandler.StartWithEyeSnap:
      return CameraActionStartWithEyeSnap();
    case EvtActionHandler.StartWithEyeMatrix:
      return CameraActionStartWithEyeMatrix();
    case EvtActionHandler.StartDeferredPose:
      return CameraActionStartDeferredPose();
    case EvtActionHandler.SetPlayerFlag:
    case EvtActionHandler.SetUpdateRoutine:
    case EvtActionHandler.SetContinuation:
      return EvtActionRetireOnly();
    case EvtActionHandler.SceneState: return EvtActionSceneState11();
    case EvtActionHandler.SetCameraIndex: return EvtActionSetGlobal14();
    case EvtActionHandler.SetEaseEye: return EvtActionSetFlag15();
    case EvtActionHandler.HoldCameraPreset:
      return EvtActionHoldCameraPreset20();
    case EvtActionHandler.FinishSequence: return EvtActionFinishSequence21();
    case EvtActionHandler.CamPlay: return EvtActionCamPlay40();
    case EvtActionHandler.StoreSix: return EvtActionStoreSixOperands60();
  }
}

/**
 * Selectors 0x10, 0x12 and 0x13: `EvtActionSetPlayerFlag10` (both players'
 * flag bit 0, the on-screen body), `EvtActionSetUpdateRoutine12` (both
 * players' update routine out of `0x00579E90`) and
 * `EvtActionSetContinuation13`. Each writes a player word the port does not
 * keep -- the body is not drawn and the routine table has one live entry --
 * and retires, which is the half the camera sees.
 */
function EvtActionRetireOnly(): void {
  EvtActionRetire();
}

/** `EvtActionSceneState11` — `FUN_004036B0`: the live major, the operand's minor. */
function EvtActionSceneState11(): void {
  EvtEnterSceneState(G.g_scene_state_major, G.g_evt_action_operands[0]);
  EvtActionRetire();
}

/**
 * `EvtActionSetGlobal14` — `FUN_004037E0`: `g_camera_index = operand`. The
 * block `UpdateSceneViewAndLight` nods and draws. Both shipped sites pass 0,
 * the only block the port has.
 */
function EvtActionSetGlobal14(): void {
  G.g_camera_index = G.g_evt_action_operands[0];
  EvtActionRetire();
}

/** `EvtActionSetFlag15` — `FUN_00403930`: `g_camera_ease_eye = 1`. */
function EvtActionSetFlag15(): void {
  G.g_camera_ease_eye = 1;
  EvtActionRetire();
}

/**
 * `g_camera_preset_table` — `0x00576CF0`, six dwords a row: the eye, then the
 * pitch, yaw and roll words. The one shipped `hold_camera_preset` (stage 1
 * block 16) names row 0, which reads `0, 17.0, 0, 0, 0, 0`. `[proved]`
 * (`read_memory`)
 */
const CAMERA_PRESETS: readonly (readonly number[])[] = [
  [0, 17.0, 0, 0, 0, 0],
];

/**
 * `EvtActionHoldCameraPreset20` — `FUN_004032E0`. A persistent handler:
 *
 * ```c
 * g_camera_free = 1;
 * block.eye, pitch, yaw, roll = g_camera_preset_table[operand[1]];   // 24 bytes, not the target
 * if (operand[0] != 0 && --operand[0] == 0) retire;
 * ```
 *
 * An operand 0 of zero never counts down, so the shot holds until the script
 * lets go of the slot.
 */
function EvtActionHoldCameraPreset20(): void {
  G.g_camera_free = 1;
  const row = CAMERA_PRESETS[G.g_evt_action_operands[1]] ?? CAMERA_PRESETS[0];
  G.g_camera_block_eye.x = row[0];
  G.g_camera_block_eye.y = row[1];
  G.g_camera_block_eye.z = row[2];
  G.g_camera_block_pitch_bams = row[3];
  G.g_camera_block_yaw_bams = row[4];
  G.g_camera_block_roll_bams = row[5];
  const ops = G.g_evt_action_operands;
  if (ops[0] !== 0) {
    ops[0] -= 1;
    if (ops[0] === 0) EvtActionRetire();
  }
}

/**
 * `g_camera_action_starters` — `0x00576B20`, the table
 * `EvtActionFinishSequence21` indexes with the scene-state minor at
 * `0x00403765`: `[4]` `0x00402460`, `[6]` `0x00402580`, `[7]` `0x00402DB0`,
 * the rest null. `[proved]` (`read_memory`)
 */
export const CAMERA_ACTION_STARTERS: Readonly<Record<number, EvtActionHandler>> = {
  4: EvtActionHandler.StartWithEyeSnap,
  6: EvtActionHandler.StartWithEyeMatrix,
  7: EvtActionHandler.StartDeferredPose,
};

/**
 * `EvtActionFinishSequence21` — `FUN_00403710`.
 *
 * ```c
 * g_attack_permits[0] = g_attack_permits[1] = 0;
 * g_camera_mode = 3;
 * EvtEnterSceneStateUnstamped(2, operand[0]);
 * g_screen_furniture_flags |= 1;
 * g_evt_action_handler = g_camera_action_starters[g_scene_state_minor];
 * g_evt_action_advance = 0;
 * ```
 *
 * It does **not** retire: the starter it installs is called on the next pass
 * and the driver that installs stays in the slot until `goto_scene_state`
 * parks it and takes the count back. The permits are pointers in the engine
 * and 0 is none; the port's none is -1.
 */
function EvtActionFinishSequence21(): void {
  G.g_attack_permits[0] = -1;
  G.g_attack_permits[1] = -1;
  G.g_camera_mode = CameraMode.TrackEnemies;
  EvtEnterSceneStateUnstamped(2, G.g_evt_action_operands[0]);
  G.g_screen_furniture_flags |= 1;
  G.g_evt_action_handler =
    CAMERA_ACTION_STARTERS[G.g_scene_state_minor] ?? EvtActionHandler.None;
  G.g_evt_action_advance = 0;
}

/**
 * `EvtActionCamPlay40` — `FUN_00403360`. Operands `start, end, path, flags`,
 * and the branches in this order:
 *
 * ```c
 * if (start == end)  CamEvalStaticPose();      // a held pose
 * else if (flags & 2) CamStashPathRange();      // stash for scene state (2,6)/(2,7)
 * else                CamStartPathPlayback();
 * ```
 */
function EvtActionCamPlay40(): void {
  const [start, end, path, flags] = G.g_evt_action_operands;
  if (start === end) return CamEvalStaticPose(path, start);
  if ((flags & 2) !== 0) return CamStashPathRange(path, start, end);
  CamStartPathPlayback(path, start, end, flags);
}

/**
 * `EvtActionStoreSixOperands60` — `FUN_004038A0`. Three `(frame, path)`
 * operand pairs, stored path first, and the latch:
 *
 * ```c
 * g_evt_cam_override_valid = 1;
 * pairs[1] = op[0]; pairs[0] = op[1]; pairs[3] = op[2]; pairs[2] = op[3]; ...
 * ```
 *
 * `CameraArmStashedPath` reads `pairs[branch * 2]` as the path and
 * `pairs[branch * 2 + 1]` as the frame.
 */
function EvtActionStoreSixOperands60(): void {
  const op = G.g_evt_action_operands;
  G.g_evt_cam_override_valid = 1;
  G.g_evt_cam_override_pairs = [
    { path: op[1], frame: op[0] },
    { path: op[3], frame: op[2] },
    { path: op[5], frame: op[4] },
  ];
  EvtActionRetire();
}

// -- the three starters ----------------------------------------------------

/** `(0, 0, -30)`, `0xC1F00000`: the starters' seat for `g_cam_path_target`. */
const STARTER_TARGET_DEPTH = 30.0;

const _m = MatIdentity();
const _a = vec3();

/**
 * `[port-only]` as a function -- the seat the minor-4 and minor-6 starters
 * both write inline (`0x004024CE`..`0x0040254F`, `0x0040259A`..`0x0040261D`):
 *
 * ```c
 * Push; LoadIdentity; Translate(block.eye); RotateY(block.yaw); RotateX(block.pitch);
 * g_cam_path_target = M * (0, 0, -30);
 * Pop;
 * ```
 *
 * A point thirty units straight ahead of the block along its own angles: the
 * fallback aim `SelectCameraLookAtTarget` eases to with nothing registered,
 * until a rail publishes a pose.
 */
function CameraStarterSeatPathTarget(): void {
  const m = _m;
  MatrixLoadIdentity(m);
  const e = G.g_camera_block_eye;
  MatrixTranslate(m, e.x, e.y, e.z);
  MatrixRotateY(m, G.g_camera_block_yaw_bams);
  MatrixRotateX(m, G.g_camera_block_pitch_bams);
  _a.x = 0; _a.y = 0; _a.z = -STARTER_TARGET_DEPTH;
  MatrixTransformPoint(m, _a, G.g_cam_path_target);
}

/**
 * `CameraActionStartWithEyeSnap` — `FUN_00402460`, `g_camera_action_starters[4]`.
 *
 * ```c
 * if (g_camera_starter_reseats) {
 *     CameraResetForPathShot();
 *     g_camera_eye = block.eye with y - 15.0;
 *     g_camera_pitch_bams = 0;  g_camera_roll_bams = 0;
 *     g_camera_yaw_bams = (block.yaw - 0x8000) & 0xFFFF;
 *     g_cam_path_target = T(block.eye) Ry(block.yaw) Rx(block.pitch) * (0, 0, -30);
 * }
 * g_camera_starter_reseats = 1;
 * g_evt_action_handler = CameraDriverSelectMode;  CameraDriverSelectMode();
 * ```
 *
 * The decompilation stops at the `MatrixStackPop` Ghidra marks no-return and
 * shows a `return` there (L35); the bytes go on at `0x00402557` into the
 * install for both arms. `[proved]`
 */
function CameraActionStartWithEyeSnap(): void {
  if (G.g_camera_starter_reseats !== 0) {
    CameraResetForPathShot();
    const e = G.g_camera_block_eye;
    G.g_camera_eye.x = e.x;
    G.g_camera_eye.y = e.y - CAMERA_EYE_DROP;
    G.g_camera_eye.z = e.z;
    G.g_camera_pitch_bams = 0;
    G.g_camera_yaw_bams = (G.g_camera_block_yaw_bams - 0x8000) & 0xffff;
    G.g_camera_roll_bams = 0;
    CameraStarterSeatPathTarget();
  }
  G.g_camera_starter_reseats = 1;
  G.g_evt_action_handler = EvtActionHandler.SelectMode;
  CameraDriverSelectMode();
}

/**
 * `CameraActionStartWithEyeMatrix` — `FUN_00402580`, `g_camera_action_starters[6]`.
 * {@link CameraActionStartWithEyeSnap} without the gameplay-eye write: the
 * reset and the `g_cam_path_target` seat, then the same install. `[proved]`
 */
function CameraActionStartWithEyeMatrix(): void {
  if (G.g_camera_starter_reseats !== 0) {
    CameraResetForPathShot();
    CameraStarterSeatPathTarget();
  }
  G.g_camera_starter_reseats = 1;
  G.g_evt_action_handler = EvtActionHandler.SelectMode;
  CameraDriverSelectMode();
}

/**
 * `CameraActionStartDeferredPose` — `FUN_00402DB0`, `g_camera_action_starters[7]`.
 *
 * ```c
 * if (g_camera_starter_reseats) { CameraResetForPathShot(); g_camera_free = 1; g_camera_mode = 0; }
 * g_camera_starter_reseats = 1;
 * g_evt_action_handler = CameraDriverFromDeferredPose;  CameraDriverFromDeferredPose();
 * ```
 */
function CameraActionStartDeferredPose(): void {
  if (G.g_camera_starter_reseats !== 0) {
    CameraResetForPathShot();
    G.g_camera_free = 1;
    G.g_camera_mode = 0;
  }
  G.g_camera_starter_reseats = 1;
  G.g_evt_action_handler = EvtActionHandler.DeferredPose;
  CameraDriverFromDeferredPose();
}

// -- the interpreter's side --------------------------------------------------

/**
 * `[port-only]` as a function -- the action half of `EvtOpGotoSceneState31`
 * (`FUN_0045F870`) and
 * `EvtOpGotoSceneStateWhenPlayersAlive32` (`FUN_0045F900`) once its gate is
 * open:
 *
 * ```c
 * EvtEnterSceneStateUnstamped(1, minor);
 * g_scene_state_major_entered = 1;  g_scene_state_minor_entered = minor;
 * g_camera_mode = 0;
 * g_evt_cam_override_valid = 0;  g_camera_ease_eye = 0;         // 0x31 only
 * both players' flags &= ~1;
 * g_evt_action_handler = NoOpStub;  g_evt_action_advance = 1;
 * g_queued_events_pending--;
 * ```
 *
 * Parking the slot is what stops the `finish_sequence`'s driver, and the
 * count it takes back is that action's, which never retires itself. 0x32
 * leaves the override latch and the eye ease alone. `[proved]`
 */
export function EvtGotoSceneState(minor: number, clearsLatches: boolean): void {
  EvtEnterSceneStateUnstamped(1, minor);
  G.g_scene_state_major_entered = 1;
  G.g_scene_state_minor_entered = minor;
  G.g_camera_mode = 0;
  if (clearsLatches) {
    G.g_evt_cam_override_valid = 0;
    G.g_camera_ease_eye = 0;
  }
  G.g_evt_action_handler = EvtActionHandler.None;
  G.g_evt_action_advance = 1;
  G.g_queued_events_pending -= 1;
}

/**
 * `g_player_state_handlers` (`0x00579CD0`, `0x14` a row) `+0x10`, by
 * `g_player_state`: 0 for 4 (`PlayerStateArmContinue`), 5 (in play) and 6
 * (`PlayerStateArmGameOver`), 1 for the other nine. `[proved]`
 * (`read_memory`).
 */
const PLAYER_STATE_CLEAR_OF_DEATH = [1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1];

/**
 * `[port-only]` as a function -- the gate `EvtOpGotoSceneStateWhenPlayersAlive32`
 * (`FUN_0045F900`) puts in front of {@link EvtGotoSceneState}:
 *
 * ```c
 * if (g_evt_yield == 0) g_evt_yield = 1;
 * for p in 0, 1:
 *     if (g_player_state_handlers[g_player_state[p]].f10 == 0
 *         && g_player_lives[p] <= 0) return;           // re-run next frame
 * ...EvtGotoSceneState..., g_evt_yield = 0, pc += 8
 * ```
 *
 * So the scene state waits while either player is dead and in the
 * continue-or-game-over chain; a player in any other state, or one with lives
 * left, lets it through on the frame it is reached. The nineteen shipped sites
 * are the bosses' rooms, each straight after the wait for the boss's death.
 */
export function EvtPlayersClearOfDeath(): boolean {
  for (let p = 0; p < 2; p++) {
    const st = G.g_player_state[p];
    if ((PLAYER_STATE_CLEAR_OF_DEATH[st] ?? 1) === 0
        && (G.g_player_lives[p] ?? 0) <= 0) {
      return false;
    }
  }
  return true;
}

/**
 * `EvtOpSetActionDrainMode33` — `FUN_0045F9F0`, less the program counter:
 * `g_evt_action_advance = op0; g_queued_events_pending += op1`. All 128
 * shipped sites pass `2, -1`: take back a `finish_sequence` that never
 * retires, and dequeue what is behind it now but call it next frame.
 */
export function EvtOpSetActionDrainMode33(mode: number, delta: number): void {
  G.g_evt_action_advance = mode;
  G.g_queued_events_pending += delta;
}

/**
 * `[port-only]` as a function -- the camera half of `ResetSceneCombatState`
 * (`FUN_0045EEC0`), the `checkpoint` opcode (0x4D) every block opens with:
 *
 * ```c
 * g_cam_path_frame = 0;
 * EvtEnterSceneStateUnstamped(1, 3);
 * both players' flags &= ~1;
 * g_cam_path_frames_left = 0x7FFFFFFF;  g_camera_turn_curve = 1;
 * g_evt_cam_override_valid = 0;  g_camera_starter_reseats = 1;
 * g_camera_ease_eye = 0;  g_camera_driver_held = 0;  g_cam_roll_enabled = 0;
 * g_camera_use_fixed_y = 0;
 * ```
 *
 * The rest of the routine -- the approach rings, the route history -- is the
 * interpreter's opcode's.
 */
export function CheckpointResetCamera(): void {
  G.g_cam_path_frame = 0;
  EvtEnterSceneStateUnstamped(1, 3);
  G.g_cam_path_frames_left = 0x7fffffff;
  G.g_camera_turn_curve = 1;
  G.g_evt_cam_override_valid = 0;
  G.g_camera_starter_reseats = 1;
  G.g_camera_ease_eye = 0;
  G.g_camera_driver_held = 0;
  G.g_cam_roll_enabled = 0;
  G.g_camera_use_fixed_y = 0;
}

/**
 * `CameraBlocksReset` — `FUN_004021D0`.
 *
 * ```c
 * for each of the four blocks: eye..roll = target..+0x2F = 0x0059C990 (all zero); +0x110 = 0;
 * g_camera_turn_curve = 1;  0x009C6F1C = 0;  0x009C6F04 = 0;  g_camera_index = 0;
 * EvtEnterSceneState(0, 0);
 * g_camera_free = 0;  g_camera_hand_back_started = 0;  g_evt_cam_override_valid = 0;
 * LightBlockInit x2; LightsUseSecondarySet; LightsRestoreScene;
 * ```
 *
 * Block 0 is the port's `g_camera_block_*`, blocks 1..3
 * `g_camera_blocks_extra`; `+0x110` is each block's `g_cam_path_frame`. The
 * two light blocks are the walker's. `[proved]`
 */
export function CameraBlocksReset(): void {
  G.g_camera_block_eye = vec3();
  G.g_camera_block_pitch_bams = 0;
  G.g_camera_block_yaw_bams = 0;
  G.g_camera_block_roll_bams = 0;
  G.g_camera_block_target = vec3();
  G.g_cam_path_frame = 0;
  G.g_camera_blocks_extra = makeCameraBlockRecords();
  G.g_camera_turn_curve = 1;
  G.g_camera_view_block_mode = 0;
  G.g_camera_index = 0;
  EvtEnterSceneState(0, 0);
  G.g_camera_free = 0;
  G.g_camera_hand_back_started = 0;
  G.g_evt_cam_override_valid = 0;
}

/**
 * `CameraActorInit` — `FUN_00402260`, with the ring reset
 * `EvtLoadBlockProgram` (`FUN_0045EBC0`) makes over it: the scene's camera,
 * as a new scene's task list builds it.
 *
 * ```c
 * CameraBlocksReset();
 * EvtEnterSceneState(1, 1);
 * ring cursors = 0;  g_queued_events_pending = 0;  g_evt_action_advance = 2;
 * g_evt_action_handler[0..3] = NoOpStub, ...;
 * ```
 *
 * The advance of **2** means the scene's first queued action is dequeued on
 * the frame it is queued and first called on the one after. `[proved]`
 */
export function CameraActorInit(): void {
  CameraBlocksReset();
  EvtEnterSceneState(1, 1);
  G.g_evt_action_ring = [];
  G.g_queued_events_pending = 0;
  G.g_evt_action_advance = 2;
  G.g_evt_action_handler = EvtActionHandler.None;
}


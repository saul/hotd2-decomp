/**
 * The mode machine that decides when a room is allowed to hand back:
 * `CameraDriverSelectMode`, the handler scene-state minors 4 and 6 install
 * (through their starters in `camera/actions.ts`).
 *
 * ```c
 * busy = any of the first four g_enemy_slots occupied;
 * if (variant is 0..2) g_camera_mode = (counter == 0 && !busy) ? 2 : 3;
 * if (g_camera_driver_held == 1) g_camera_mode = 6;
 * if (g_camera_mode != 2) { g_camera_free = 0; g_camera_hand_back_started = 0; }
 * g_camera_mode_hooks[g_camera_mode]();
 * g_cam_path_frame = __ftol(g_rail_frame);
 * ```
 *
 * **`g_camera_free` is not raised by anything an enemy does.** Mode 2 is only
 * the permission to *start* turning; `CameraTurnOntoPathTarget` eases the eye
 * and the aim back onto the path and raises the flag on the frame the aim
 * converges.
 *
 * All of this runs inside `CameraActorTick`, **before** the scene state's
 * hook, the players and every actor (`SceneTaskWalk`, `game/director.ts`), so
 * a driver reads the slots the fill dealt on the previous frame and the pose
 * the rail drew on the previous frame. `[proved]` from the task list at
 * `0x00460710`.
 */
import { G } from "../globals";
import { vec3 } from "../vec";
import { TURN_RATE_UNTRACKED } from "./constants";
import { CamBlockSetAnglesFromLookAt, CamEvalPath7, CameraPoseBlock }
  from "./path";
import { CameraSlotsBusy } from "./slots";
import { CameraArmStashedPath, CameraTrackEnemiesTick } from "./track";
import { LookAtCosineSquared, TurnLookAtToward } from "./turn";
import { LerpWeighted } from "../vec";


/**
 * `g_camera_mode` — `0x009C6F20`, an index into `g_camera_mode_hooks`
 * (`0x00576CBC`).
 *
 * Only the modes `CameraDriverSelectMode` can choose are members. Mode 7 is
 * `FUN_00402A40`, forced by `0x009C6F30`/`0x009C6F32`; those two bytes are
 * written only by that routine itself and zeroed by `CameraResetForPathShot`
 * (byte search for `306f9c00` and `326f9c00`), so nothing ever raises them
 * and the mode cannot be reached. `[proved]` 0, 1, 4 and 8 are
 * `SceneStateInvalidHang`; 5 is null.
 */
export enum CameraMode {
  /** `CameraDispatchHandBack` (`FUN_00402720`). */
  HandBackToPath = 2,
  /** `CameraTrackEnemiesTick` (`FUN_00402890`). */
  TrackEnemies = 3,
  /**
   * `PoseHookNone` (`FUN_00420810`) -- nothing at all. Forced while
   * `g_camera_driver_held` is 1, so whatever is writing the camera block (the
   * boss-name banner's flight) has it to itself.
   */
  Held = 6,
}

/**
 * `g_camera_hand_back_variant` — `0x009C6F2E`, an index into
 * `g_camera_hand_back_hooks` (`0x00576CE0`) *and* the choice of counter.
 *
 * `CameraResetForPathShot` (`FUN_004031E0`) writes 0 and nothing writes
 * anything else, so only the first member happens.
 */
export enum CameraHandBackVariant {
  /** `g_enemies_alive`, turning with `CameraTurnOntoPathTarget`. */
  AliveCountAndTurn = 0,
  /** `g_enemies_alive`, handing back with `CameraHandBackToPath`. */
  AliveCountAndHandBack = 1,
  /** `g_enemies_present`, turning with `CameraTurnOntoPathTarget`. */
  PresentCountAndTurn = 2,
}

/**
 * `CameraResetForPathShot` — `FUN_004031E0`. The first thing every starter
 * does.
 *
 * ```c
 * player flags &= ~1 (both);  g_rail_frame = (float)g_cam_path_frame;
 * g_camera_index = 0;  g_camera_free = 0;  g_camera_hand_back_started = 0;
 * 0x9C6F30 = 0x9C6F31 = 0x9C6F32 = 0;  g_camera_hand_back_variant = 0;
 * g_cam_path_frames_left = 0x7FFFFFFF;  g_camera_turn_rate = 0x200;
 * ```
 *
 * The rate of `0x200` is what makes a new shot's first turn nearly nothing:
 * `TurnLookAtToward` steps `1 / (1 + 512)` of the angle on the frame before
 * `ComputeLookAtAngleError` or the untracked constant replaces it. The two
 * players' flag bit 0 is the on-screen body (`PlayerHookDrawBody`).
 */
export function CameraResetForPathShot(): void {
  G.g_player_flags[1] &= ~1;
  G.g_player_flags[0] &= ~1;
  G.g_rail_frame = G.g_cam_path_frame;
  G.g_camera_index = 0;
  G.g_camera_free = 0;
  G.g_camera_hand_back_started = 0;
  G.g_camera_hand_back_variant = CameraHandBackVariant.AliveCountAndTurn;
  G.g_cam_path_frames_left = 0x7fffffff;
  G.g_camera_turn_rate = CAMERA_TURN_RATE_ON_RESET;
}

/** `MOV word ptr [0x009C6F36], 0x200` at `0x0040323C`. */
export const CAMERA_TURN_RATE_ON_RESET = 0x200;

/**
 * `CameraDriverSelectMode` — `FUN_00402650`. The mode machine, and the only
 * writer of `g_camera_free` that can take it away.
 *
 * The counter is chosen by the variant -- 0 and 1 `g_enemies_alive`, 2
 * `g_enemies_present` -- and a variant outside 0..2 leaves the mode alone.
 * Last, **after** the mode's routine, `g_cam_path_frame = __ftol(g_rail_frame)`
 * (`FLD [0x009C70BC]` at `0x004026F7`): the frame every camera cue reads is
 * the one the stashed rail drew on the previous frame, since the rail's hook
 * runs after this in the frame. `[proved]`
 */
export function CameraDriverSelectMode(): void {
  const busy = CameraSlotsBusy();
  const variant = G.g_camera_hand_back_variant;
  if (variant >= 0 && variant <= CameraHandBackVariant.PresentCountAndTurn) {
    const count = variant === CameraHandBackVariant.PresentCountAndTurn
      ? G.g_enemies_present
      : G.g_enemies_alive;
    G.g_camera_mode = count === 0 && !busy
      ? CameraMode.HandBackToPath : CameraMode.TrackEnemies;
  }
  // `CMP dword ptr [0x009ca094], 0x1` at `0x004026AB`: held, the mode is 6
  // whatever the counters said, and the room is not free.
  if (G.g_camera_driver_held === 1) G.g_camera_mode = CameraMode.Held;
  if (G.g_camera_mode !== CameraMode.HandBackToPath) {
    G.g_camera_free = 0;
    G.g_camera_hand_back_started = 0;
  }
  if (G.g_camera_mode === CameraMode.HandBackToPath) CameraDispatchHandBack();
  else if (G.g_camera_mode === CameraMode.TrackEnemies) CameraTrackEnemiesTick();
  // `CameraMode.Held`: `PoseHookNone`, which does nothing.
  G.g_cam_path_frame = Math.trunc(G.g_rail_frame);
}

/**
 * `CameraDispatchHandBack` — `FUN_00402720`. One jump through
 * `g_camera_hand_back_hooks`: `[0]` and `[2]` are
 * {@link CameraTurnOntoPathTarget}, `[1]` {@link CameraHandBackToPath}.
 */
export function CameraDispatchHandBack(): void {
  if (G.g_camera_hand_back_variant === CameraHandBackVariant.AliveCountAndHandBack) {
    CameraHandBackToPath();
    return;
  }
  CameraTurnOntoPathTarget();
}

/** `FUN_00403C00`'s numerator. Every call site in the engine passes 1. */
const TURN_NUMERATOR = 1;

/** `[0x004C439C]`, `0x3F7FFF58` -- the convergence test, against the cosine *squared*. */
const HAND_BACK_CONVERGED = 0.99999;

/**
 * `[0x00576C0C]`'s first byte: the rate both eases here turn at. It is
 * {@link TURN_RATE_UNTRACKED}, the byte `CameraTrackEnemiesTick` reads at
 * `0x004029F2` too.
 */
const HAND_BACK_TURN_RATE = TURN_RATE_UNTRACKED;

const _eased = vec3();
const _pathEye = vec3();
const _discard = vec3();

/**
 * `StepCameraLookAtDamped` — `FUN_00402F80`. One frame of the turn back.
 *
 * ```c
 * CamEvalPath7(g_active_cam_path, (float)g_cam_path_frame, &eye_local, &g_camera_lookat_target, ...);
 * TurnLookAtToward(block.eye, g_camera_lookat_target, block.target, &out, 1, (s8)*[0x00576C0C]);
 * block.target = out;
 * ```
 *
 * The desired aim is the **path's** target at the published frame -- not the
 * deferred pose's, and not `g_cam_path_target`. `[proved]`
 */
export function StepCameraLookAtDamped(): void {
  CamEvalPath7(G.g_active_cam_path, G.g_cam_path_frame, _discard,
               G.g_camera_lookat_target);
  TurnLookAtToward(G.g_camera_block_eye, G.g_camera_lookat_target,
                   G.g_camera_block_target, _eased, TURN_NUMERATOR,
                   HAND_BACK_TURN_RATE);
  G.g_camera_block_target.x = _eased.x;
  G.g_camera_block_target.y = _eased.y;
  G.g_camera_block_target.z = _eased.z;
}

/** `LerpWeighted(a, b, 1, 15)`'s weights: a sixteenth of the way a frame. */
const EASE_NUM = 1;
const EASE_DEN = 15;

/**
 * `CameraEaseEyeToPath` — `FUN_00402E60`. The hand-back's eye:
 *
 * ```c
 * CamEvalPath7(g_active_cam_path, (float)g_cam_path_frame, &0x009C6F90, &local, ...);
 * block.eye.x = LerpWeighted(block.eye.x, 0x009C6F90.x, 1, 15);   // and y, z
 * ```
 *
 * A sixteenth of the way to the **path's** eye at the published frame, every
 * frame of the turn. `0x009C6F90` is a scratch triple nothing else reads.
 * `[proved]`
 */
export function CameraEaseEyeToPath(): void {
  CamEvalPath7(G.g_active_cam_path, G.g_cam_path_frame, _pathEye, _discard);
  const e = G.g_camera_block_eye;
  e.x = LerpWeighted(e.x, _pathEye.x, EASE_NUM, EASE_DEN);
  e.y = LerpWeighted(e.y, _pathEye.y, EASE_NUM, EASE_DEN);
  e.z = LerpWeighted(e.z, _pathEye.z, EASE_NUM, EASE_DEN);
}

/**
 * `CameraTurnOntoPathTarget` — `FUN_00402740`. The hand-back itself.
 *
 * ```c
 * switch ((g_camera_free ? 2 : 0) | (g_camera_hand_back_started ? 1 : 0)) {
 *   case 0: g_camera_hand_back_started = 1;             // and fall through
 *   case 1: if (g_evt_cam_override_valid) CameraArmStashedPath(&block);
 *           CameraEaseEyeToPath();  StepCameraLookAtDamped();
 *           if (|cos2(lookat - eye, block.target - eye)| > 0.99999) {
 *               g_camera_hand_back_started = 0;
 *               g_camera_free = 1;  g_camera_settled = 1;
 *           }
 *           break;
 *   default:                                            // free: back on the rail
 *           CamEvalPath7(g_active_cam_path, (float)g_cam_path_frame, &block.eye, &block.target);
 * }
 * CamBlockSetAnglesFromLookAt(&block, &block.target, 0);
 * ```
 *
 * The arm here has **no frames-left test**, unlike `CameraTrackEnemiesTick`'s
 * (`0x0040279F`). Once free, the camera block is the path at the published
 * frame, eye and aim, every frame, with the roll zeroed. `[proved]`
 */
export function CameraTurnOntoPathTarget(): void {
  const state = (G.g_camera_free !== 0 ? 2 : 0)
              | (G.g_camera_hand_back_started !== 0 ? 1 : 0);
  if (state >= 2) {
    CamEvalPath7(G.g_active_cam_path, G.g_cam_path_frame,
                 G.g_camera_block_eye, G.g_camera_block_target);
  } else {
    if (state === 0) G.g_camera_hand_back_started = 1;
    if (G.g_evt_cam_override_valid !== 0) CameraArmStashedPath();
    CameraEaseEyeToPath();
    StepCameraLookAtDamped();
    if (Math.abs(LookAtCosineSquared(G.g_camera_block_eye,
                                     G.g_camera_lookat_target,
                                     G.g_camera_block_target))
        > HAND_BACK_CONVERGED) {
      G.g_camera_hand_back_started = 0;
      G.g_camera_free = 1;
      G.g_camera_settled = 1;
    }
  }
  CamBlockSetAnglesFromLookAt(CameraPoseBlock.Camera, G.g_camera_block_target, 0);
}

/**
 * `CameraHandBackToPath` — `FUN_00402860`, `g_camera_hand_back_hooks[1]`: free
 * at once, then the same eye ease and aim step as the turn, with no
 * convergence test. Unreachable -- `CameraResetForPathShot` is the variant's
 * only writer and it writes 0 -- and ported because it is five lines of the
 * table.
 */
export function CameraHandBackToPath(): void {
  G.g_camera_hand_back_started = 0;
  G.g_camera_free = 1;
  CameraEaseEyeToPath();
  StepCameraLookAtDamped();
  CamBlockSetAnglesFromLookAt(CameraPoseBlock.Camera, G.g_camera_block_target, 0);
}

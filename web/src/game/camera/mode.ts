/**
 * Which camera runs this frame, and when the room is allowed to hand back.
 *
 * The player used to have one camera routine and one rule for
 * `g_camera_free`: the slot table is empty, so the room is clear. The engine
 * has **two drivers and a mode machine**, and the difference between them is
 * the second between a zombie dying and the script moving on.
 *
 * ```
 * EvtActionFinishSequence21 (FUN_00403710)
 *   g_camera_mode = 3
 *   EvtEnterSceneState(2, minor)
 *   g_evt_action_handler = g_camera_action_starters[g_scene_state_minor]
 *                              |
 *        minor 4 -> CameraActionStartWithEyeSnap    -+
 *        minor 6 -> CameraActionStartWithEyeMatrix  -+-> CameraDriverSelectMode
 *        minor 7 -> CameraActionStartDeferredPose    -> CameraDriverFromDeferredPose
 *        minor 3 -> null  (what goto_scene_state leaves behind)
 * ```
 *
 * and `CameraDriverSelectMode` is the mode machine:
 *
 * ```c
 * busy = any of the first four g_enemy_slots occupied;
 * if (g_camera_hand_back_variant >= 0)
 *     g_camera_mode = (counter == 0 && !busy) ? 2 : 3;
 * if (g_camera_mode != 2) { g_camera_free = 0; g_camera_hand_back_started = 0; }
 * g_camera_mode_hooks[g_camera_mode]();
 * ```
 *
 * **`g_camera_free` is not raised by anything an enemy does.** Mode 2 is only
 * the permission to *start* turning; `CameraTurnOntoPathTarget` eases the aim
 * back onto the path's own target at the untracked rate and raises the flag on
 * the frame the two converge. Measured with the port's own ease, that is 41
 * frames from five degrees off the rail and 77 from ninety — two thirds of a
 * second to one and a third.
 *
 * Two objections the old code recorded, and what the binary says to each:
 *
 * * *"`g_enemies_alive == 0` and the aim converging belong to a different
 *   driver; ANDing them holds a gate for ever whenever anything is alive."*
 *   They belong to the driver **572 of 836 shots install**, against 264 for
 *   the one the port modelled, and the conjunction cannot deadlock: every one
 *   of the 278 room-clear gates in the shipped scripts has operand 0, so the
 *   gate's own counter test and the selector's are the same test.
 * * *"Every enemy death site frees the flag outright."* Two do —
 *   `0x0048042C` and `0x00428B44` — and neither is on class 0x30's path.
 *   `ZombieReleasePermitAndUntrack` (`FUN_004565A0`) clears the actor's slot
 *   and its alive count and never touches `g_camera_free`.
 *
 * What is **not** modelled, and would be a guess to model:
 *
 * * The two overrides. `[0x009CA094] == 1` forces mode 6 (`PoseHookNone`,
 *   which stops the camera entirely) and `[0x009C6F30]` / `[0x009C6F32]`
 *   force mode 7 (`FUN_00402A40`). Sixteen routines write the first and none
 *   of them is read yet. `[open]`
 * * `CameraEaseEyeToPath` (`FUN_00402E60`), the 1/16 ease of the block **eye**
 *   toward the path's. The port takes the eye straight off the playing path
 *   every frame, which is the same call it already makes about
 *   `CameraEaseBlockEyeToPathPose` (`FUN_00402EF0`) in the tracking hook.
 *   [diverges]
 * * `CameraHandBackToPath` (`FUN_00402860`), `g_camera_hand_back_hooks[1]`.
 *   Unreachable: `CameraResetForPathShot` is the variant's only writer and it
 *   writes 0.
 */
import { G } from "../globals";
import { TURN_RATE_UNTRACKED } from "./constants";
import { CameraDriverFromDeferredPose, CameraTrackEnemiesTick } from "./track";
import { LookAtCosineSquared, TurnLookAtToward } from "./turn";
import { vec3 } from "../vec";

/**
 * `g_camera_mode` — `0x009C6F20`, an index into `g_camera_mode_hooks`
 * (`0x00576CBC`).
 *
 * Only the two `CameraDriverSelectMode` can choose are members. 6 and 7 are
 * reached solely through the overrides above; 0, 1, 4 and 8 are
 * `SceneStateInvalidHang` and 5 is null.
 */
export enum CameraMode {
  /** `CameraDispatchHandBack` (`FUN_00402720`). */
  HandBackToPath = 2,
  /** `CameraTrackEnemiesTick` (`FUN_00402890`). */
  TrackEnemies = 3,
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
 * `[port-only]` — the identity of the driver a camera action installed, which
 * stands in for the function pointer in `g_evt_action_handler` (0x009A610C).
 * See {@link G.g_camera_action_driver}.
 */
export enum CameraActionDriver {
  /** Nothing queued, or `goto_scene_state` parked the slot on a `RET`. */
  None = 0,
  /** `CameraDriverSelectMode` (`FUN_00402650`) — scene-state minors 4 and 6. */
  SelectMode = 1,
  /** `CameraDriverFromDeferredPose` (`FUN_00402E00`) — minor 7. */
  DeferredPose = 2,
}

/**
 * `g_camera_action_starters` — `0x00576B20`, the table
 * `EvtActionFinishSequence21` indexes with the scene-state minor at
 * `0x00403765`.
 *
 * Only the driver each starter installs is modelled; the seating each does
 * first is the camera pose, which the host already writes from the path.
 */
export const CAMERA_ACTION_STARTERS: Readonly<Record<number, CameraActionDriver>> = {
  4: CameraActionDriver.SelectMode,
  6: CameraActionDriver.SelectMode,
  7: CameraActionDriver.DeferredPose,
};

/**
 * `FUN_004022B0` — the camera actor's own tick, minus everything the port has
 * no model for.
 *
 * Two stores, and both matter. `g_camera_settled` is a **this-frame** answer
 * and is cleared here, before any driver can raise it; it used to be cleared
 * at the top of `CameraTrackEnemiesTick`, which was fine while that routine
 * ran unconditionally and wrong the moment the hand-back could run instead —
 * a latched `g_camera_settled` opens every `wait_targets_clear` for the rest
 * of the stage. `g_camera_is_tracking` is seeded to 1 and
 * `SelectCameraLookAtTarget` clears it when no slot is claimed.
 *
 * Not modelled: the per-major dispatch through `[0x00576B10]`, the walk over
 * the camera blocks calling each block's own hook, and
 * `UpdateSceneViewAndLight` (`FUN_00401F40`). [diverges]
 */
export function CameraActorTick(): void {
  G.g_camera_settled = 0;
  G.g_camera_is_tracking = 1;
}

/**
 * `CameraDriverSelectMode` — `FUN_00402650`.
 *
 * The mode machine, and the only writer of `g_camera_free` that can take it
 * away. The slot walk is over the **first four** entries in the engine; the
 * port's `g_enemy_slots` holds only claimed slots and fills from 0, and
 * nothing but a permit holder can sit above index 3 while index 2 is free, so
 * the walk is a length test.
 */
export function CameraDriverSelectMode(): void {
  const busy = G.g_enemy_slots.length !== 0;
  const variant = G.g_camera_hand_back_variant;
  if (variant >= 0) {
    const count = variant === CameraHandBackVariant.PresentCountAndTurn
      ? G.g_enemies_present
      : G.g_enemies_alive;
    G.g_camera_mode = count === 0 && !busy
      ? CameraMode.HandBackToPath : CameraMode.TrackEnemies;
  }
  if (G.g_camera_mode !== CameraMode.HandBackToPath) {
    G.g_camera_free = 0;
    G.g_camera_hand_back_started = 0;
  }
  if (G.g_camera_mode === CameraMode.HandBackToPath) CameraDispatchHandBack();
  else CameraTrackEnemiesTick();
}

/**
 * `CameraDispatchHandBack` — `FUN_00402720`. One jump through
 * `g_camera_hand_back_hooks`.
 *
 * Variant 1 is `CameraHandBackToPath` (`FUN_00402860`) and has no port,
 * because nothing writes 1 — see {@link CameraHandBackVariant}.
 */
export function CameraDispatchHandBack(): void {
  CameraTurnOntoPathTarget();
}

/** `FUN_00403C00`'s numerator. Every call site in the engine passes 1. */
const TURN_NUMERATOR = 1;

/** `[0x004C439C]` — the convergence test, against the *square* of the cosine. */
const HAND_BACK_CONVERGED = 0.99999;

const _eased = vec3();

/**
 * `StepCameraLookAtDamped` — `FUN_00402F80`. One frame of the turn back.
 *
 * The engine re-evaluates the playing path into `g_camera_lookat_target` with
 * `CamEvalPath7` and then eases `g_camera_block_target` onto it at the rate
 * byte `[[0x00576C0C]]`, which is 12 — the identical expression
 * `CameraTrackEnemiesTick` uses at `0x004029F2` for
 * {@link TURN_RATE_UNTRACKED}. The path's own aim is already in
 * `g_cam_path_target`, which is where `CamSetPathTarget` publishes it.
 */
export function StepCameraLookAtDamped(): void {
  const want = G.g_camera_lookat_target;
  want.x = G.g_cam_path_target.x;
  want.y = G.g_cam_path_target.y;
  want.z = G.g_cam_path_target.z;
  TurnLookAtToward(G.g_camera_block_eye, want, G.g_camera_block_target,
                   _eased, TURN_NUMERATOR, TURN_RATE_UNTRACKED);
  G.g_camera_block_target.x = _eased.x;
  G.g_camera_block_target.y = _eased.y;
  G.g_camera_block_target.z = _eased.z;
}

/**
 * `CameraTurnOntoPathTarget` — `FUN_00402740`. The hand-back itself.
 *
 * ```c
 * switch ((g_camera_free ? 2 : 0) | (g_camera_hand_back_started ? 1 : 0)) {
 *   case 0: g_camera_hand_back_started = 1;   // and fall through
 *   case 1: CameraEaseEyeToPath(); StepCameraLookAtDamped();
 *           if (|cos2(blockAim, pathAim)| >= 0.99999) {
 *               g_camera_hand_back_started = 0;
 *               g_camera_free = 1; g_camera_settled = 1;
 *           }
 *           break;
 *   default: CamEvalPath7(...);                // already back on the rail
 * }
 * CamBlockSetAnglesFromLookAt(...);
 * ```
 *
 * The degenerate guard is the one `CameraTrackEnemiesTick` already carries and
 * for the same reason: `FUN_00401DF0` divides by both lengths and answers 0
 * rather than NaN when either is zero, which is a look-at sitting on the eye
 * before any path has seated the block. Zero fails the test, so without the
 * guard a stage whose camera has never been posed could never hand back and
 * every room-clear gate in it would wait for good. [diverges]
 */
export function CameraTurnOntoPathTarget(): void {
  // Back on the rail: the engine re-evaluates the path into the camera block,
  // which the host has already done for this frame. [diverges]
  if (G.g_camera_free !== 0) return;
  G.g_camera_hand_back_started = 1;
  StepCameraLookAtDamped();
  const eye = G.g_camera_block_eye;
  const want = G.g_camera_lookat_target;
  const have = G.g_camera_block_target;
  const gap = Math.abs(want.x - have.x) + Math.abs(want.y - have.y)
            + Math.abs(want.z - have.z);
  if (gap < 1e-4
      || Math.abs(LookAtCosineSquared(eye, want, have)) > HAND_BACK_CONVERGED) {
    G.g_camera_hand_back_started = 0;
    G.g_camera_free = 1;
    G.g_camera_settled = 1;
  }
}

/**
 * `[port-only]` — `EvtRunQueuedActions` (`FUN_00402320`) calling whatever
 * `EvtActionFinishSequence21` last parked in `g_evt_action_handler`. It is
 * port-only because the engine's is an indirect call through a pointer and
 * this is a switch over {@link CameraActionDriver}, which is the same thing
 * with an identity a snapshot can hold.
 *
 * A shot with no action running — between a `goto_scene_state` and the next
 * `finish_sequence` — leaves the aim and `g_camera_free` exactly where they
 * were, because in the engine the slot holds a bare `RET`. Four of the 278
 * room-clear gates are reached in that state.
 */
export function CameraRunQueuedAction(): void {
  if (G.g_camera_action_driver === CameraActionDriver.SelectMode) {
    CameraDriverSelectMode();
    return;
  }
  if (G.g_camera_action_driver === CameraActionDriver.DeferredPose) {
    CameraDriverFromDeferredPose();
  }
}

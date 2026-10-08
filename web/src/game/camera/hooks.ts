/**
 * The scene state's camera routine: `g_camera_update_hook` (`0x009C7080`),
 * which the installers in `g_scene_state_table` write and `CameraUpdateTick`
 * jumps through once a frame.
 *
 * ```
 *   (0,0)  CameraInstallNoOpHook          NoOpStub
 *   (1,1)  CameraInstallFollowMidpoint    CameraFollowPlayerMidpoint
 *   (1,2)  CameraInstallNoOpWithBodyDraw  NoOpStub
 *   (1,3)  CameraInstallViewAngles        CameraFromViewAngles
 *   (2,4)  CameraInstallSnapToPathEye     CameraSnapToPathEye -> CameraHoldEyeTick
 *   (2,5)  CameraInstallPathImpulseShake  CameraPathWithImpulseShake -> CameraImpulseShakeTick
 *   (2,6)  CameraInstallDeferredRail      CameraStepDeferredRailWithFrameExport -> CameraStepRailTick
 *   (2,7)  CameraInstallStashedPath       CameraPlayStashedPath
 * ```
 *
 * **What these write is the gameplay eye**, `g_camera_eye` and its three
 * angles -- where the enemies measure to -- and, for the rail, the deferred
 * pose block. None of them writes the camera block, which is the queued
 * action's (`camera/mode.ts`, `camera/path.ts`) and is drawn.
 *
 * `CameraUpdateTick`'s task comes **after** `CameraActorTick`'s in every
 * scene's list (`0x00460710`: `CameraActorCreate` third, `CameraUpdateTaskCreate`
 * fifth), so the hook sees the block the driver just wrote and the view
 * `UpdateSceneViewAndLight` just built, and everything after it -- the
 * players, the slot fill, every actor -- sees the eye it wrote. `[proved]`
 */
import { G } from "../globals";
import { SceneStateInstallPlayerHooks } from "../effects/damage_overlay";
import { MatCopy, MatIdentity, MatrixGetTranslation, MatrixLoadIdentity,
         MatrixRotateY,
         MatrixTransformPoint, MatrixTranslate,
         RADIANS_TO_BAMS } from "../matrix";
import { LerpAngleShortWay, LerpWeightedByFractions, vec3 } from "../vec";
import { CameraUpdateHook } from "./driver";
import { CAMERA_INDEX_VIEW_ANGLES } from "./view";
import { CAMERA_EYE_DROP, CameraPlayStashedPath,
         CameraStepDeferredRailWithFrameExport, CameraStepRailTick }
  from "./rail";

/**
 * `CameraUpdateTick` — `FUN_0040C370`. `JMP [g_camera_update_hook]`.
 * `[port-only]` as a switch: the engine's is an indirect jump.
 */
export function CameraUpdateTick(): void {
  switch (G.g_camera_update_hook as CameraUpdateHook) {
    case CameraUpdateHook.None: return;
    case CameraUpdateHook.FollowPlayerMidpoint:
      return CameraFollowPlayerMidpoint();
    case CameraUpdateHook.FromViewAngles: return CameraFromViewAngles();
    case CameraUpdateHook.SnapToPathEye: return CameraSnapToPathEye();
    case CameraUpdateHook.HoldEye: return CameraHoldEyeTick();
    case CameraUpdateHook.PathWithImpulseShake:
      return CameraPathWithImpulseShake();
    case CameraUpdateHook.ImpulseShake: return CameraImpulseShakeTick();
    case CameraUpdateHook.DeferredRailInstall:
      return CameraStepDeferredRailWithFrameExport();
    case CameraUpdateHook.StepRail: return CameraStepRailTick();
    case CameraUpdateHook.PlayStashedPath: return CameraPlayStashedPath();
  }
}

/**
 * `EvtEnterSceneState` — `FUN_00403BD0`.
 *
 * ```
 * g_scene_state_minor = g_scene_state_minor_entered = minor;
 * g_scene_state_major = g_scene_state_major_entered = major;
 * JMP g_scene_state_table[major * 9 + minor]           ; 0x00576C14
 * ```
 *
 * Its callers are `CameraActorInit`, `CameraBlocksReset` and
 * `EvtActionSceneState11`. `[proved]`
 */
export function EvtEnterSceneState(major: number, minor: number): void {
  G.g_scene_state_major_entered = major;
  G.g_scene_state_minor_entered = minor;
  EvtEnterSceneStateUnstamped(major, minor);
}

/**
 * `EvtEnterSceneStateUnstamped` — `FUN_00403BB0`: the same without the
 * `_entered` pair, which `UpdateSceneViewAndLight` stamps at the end of the
 * camera actor's task. `EvtActionFinishSequence21`, the checkpoint's
 * `ResetSceneCombatState` and the two `goto_scene_state` opcodes call it; the
 * last two stamp the pair themselves. `[proved]`
 *
 * The cell is an installer: both players' camera hook
 * (`SceneStateInstallPlayerHooks`) and `g_camera_update_hook` -- and, for
 * (1, 3) alone, `g_camera_index` ({@link CameraInstallViewAngles}). Every
 * other cell is `SceneStateInvalidHang` (`FUN_00402710`) and the shipped
 * scripts reach none of them, so they install nothing here.
 */
export function EvtEnterSceneStateUnstamped(major: number, minor: number): void {
  G.g_scene_state_minor = minor;
  G.g_scene_state_major = major;
  SceneStateInstallPlayerHooks(major, minor);
  const cell = major * 9 + minor;
  const hook = SCENE_STATE_CAMERA_HOOKS[cell];
  if (hook !== undefined) G.g_camera_update_hook = hook;
  if (cell === SCENE_STATE_VIEW_ANGLES) CameraInstallViewAngles();
}

/** Scene state (1, 3)'s cell, `g_scene_state_table[12]` (`0x00576C44`). */
const SCENE_STATE_VIEW_ANGLES = 1 * 9 + 3;

/**
 * The half of `CameraInstallViewAngles` — `FUN_004039D0`, scene state (1, 3)'s
 * installer -- that no other installer has:
 *
 * ```
 * 004039d0  MOV EAX, 0x415970
 * 004039d5  MOV dword ptr [0x009c6f00], 0x2       ; g_camera_index = 2
 * 004039df  MOV dword ptr [0x009c7080], 0x40c380  ; g_camera_update_hook = CameraFromViewAngles
 * 004039e9  MOV [0x009a5e10], EAX                 ; both players' second hook
 * 004039ee  MOV [0x009a5ce0], EAX
 * ```
 *
 * The hook is {@link SCENE_STATE_CAMERA_HOOKS}'s and the players' words are
 * `SceneStateInstallPlayerHooks`'; this is the index. **So every cutscene is
 * drawn from camera block 2** -- block 0's eye aimed at block 0's look-at,
 * `EvtRunQueuedActionsSyncViewBlock`'s copy -- until a starter's
 * `CameraResetForPathShot` writes 0 back. The other seven installers write
 * no index (`0x00403970`..`0x00403AB8`, read whole). `[proved]`
 */
export function CameraInstallViewAngles(): void {
  G.g_camera_index = CAMERA_INDEX_VIEW_ANGLES;
}

/** The live cells of `g_scene_state_table`, by `major * 9 + minor`. */
const SCENE_STATE_CAMERA_HOOKS: Readonly<Record<number, CameraUpdateHook>> = {
  [0 * 9 + 0]: CameraUpdateHook.None,                  // CameraInstallNoOpHook
  [1 * 9 + 1]: CameraUpdateHook.FollowPlayerMidpoint,  // CameraInstallFollowMidpoint
  [1 * 9 + 2]: CameraUpdateHook.None,                  // CameraInstallNoOpWithBodyDraw
  [1 * 9 + 3]: CameraUpdateHook.FromViewAngles,        // CameraInstallViewAngles
  [2 * 9 + 4]: CameraUpdateHook.SnapToPathEye,         // CameraInstallSnapToPathEye
  [2 * 9 + 5]: CameraUpdateHook.PathWithImpulseShake,  // CameraInstallPathImpulseShake
  [2 * 9 + 6]: CameraUpdateHook.DeferredRailInstall,   // CameraInstallDeferredRail
  [2 * 9 + 7]: CameraUpdateHook.PlayStashedPath,       // CameraInstallStashedPath
};

/**
 * `CameraFollowPlayerMidpoint` — `FUN_0040C9C0`, scene state (1,1): the
 * gameplay eye and its angles from the player bodies -- with a player count
 * other than 1 their midpoint, `LerpWeightedByFractions(a, b, 1, 1)` for the
 * eye and `LerpAngleShortWay(a, b, 1, 1)` for each angle; with one, the
 * `g_active_player`'s body as it stands. `[proved]`
 *
 * Under the `PlaceEntity` hooks the bodies are where this put the eye, so it
 * hands the eye back to itself: `PlacePlayerEntityFromViewPose` stands a body
 * at `T(eye) Rz Ry Rx * (x, 0, 0)` with `x` 0 for one attacker and -3, 3 for
 * two, and the camera's angles. It moves only when a script's routine has
 * placed the bodies itself -- stage 1's opening (1,1), where the eye rides in
 * the driver's seat, and stage 2 block 6's. The scene also enters (1,1) as it
 * loads (`CameraActorInit`'s `EvtEnterSceneState(1, 1)`), where the bodies
 * are freshly made at the origin with zero angles.
 *
 * The hook runs before the player tasks, so it reads the bodies the last
 * frame's hooks left. `g_active_player` is -1 when nobody can be attacked,
 * and the exe then reads the word before the first body's slot; that read
 * is `[open]`, and the port leaves the eye as it is.
 */
export function CameraFollowPlayerMidpoint(): void {
  const b0 = G.g_player_bodies[0];
  const b1 = G.g_player_bodies[1];
  if (G.g_players_in_play !== 1) {
    if (!b0 || !b1) return;
    G.g_camera_eye.x = Math.fround(LerpWeightedByFractions(b0.pos.x, b1.pos.x,
                                                           1, 1));
    G.g_camera_eye.y = Math.fround(LerpWeightedByFractions(b0.pos.y, b1.pos.y,
                                                           1, 1));
    G.g_camera_eye.z = Math.fround(LerpWeightedByFractions(b0.pos.z, b1.pos.z,
                                                           1, 1));
    G.g_camera_pitch_bams = LerpAngleShortWay(b0.pitch, b1.pitch, 1, 1);
    G.g_camera_yaw_bams = LerpAngleShortWay(b0.yaw, b1.yaw, 1, 1);
    G.g_camera_roll_bams = LerpAngleShortWay(b0.roll, b1.roll, 1, 1);
    return;
  }
  const b = G.g_player_bodies[G.g_active_player];
  if (!b) return;
  G.g_camera_eye.x = b.pos.x;
  G.g_camera_eye.y = b.pos.y;
  G.g_camera_eye.z = b.pos.z;
  G.g_camera_pitch_bams = b.pitch;
  G.g_camera_yaw_bams = b.yaw;
  G.g_camera_roll_bams = b.roll;
}

const _m = MatIdentity();
const _p = vec3();
const _q = vec3();

/**
 * `CameraFromViewAngles` — `FUN_0040C380`, scene state (1,3): the gameplay
 * eye fifteen units down the camera's own Y axis.
 *
 * ```c
 * Push; LoadIdentity;
 * RotateY((block.yaw - 0x8000) & 0xFFFF); RotateX(-block.pitch); RotateZ(block.roll);
 * FUN_00401C50(yaw', &g_camera_pitch_bams, &g_camera_yaw_bams, &g_camera_roll_bams);
 * SetTop(g_camera_blocks);                 // this frame's view-to-world
 * Translate(0, -15.0, 0);                  // 0xC1700000
 * g_camera_eye = GetTranslation();
 * ```
 *
 * `g_camera_blocks` is the matrix `UpdateSceneViewAndLight` built earlier in
 * the frame -- **block 0's, by address** (`PUSH 0x9a6040` at `0x0040C3E2`),
 * and the angles are block 0's too (`[0x009a60d0]`, `[0x009a60cc]`,
 * `[0x009a60d4]`), although under (1, 3) the frame is drawn from block 2. So
 * the gameplay eye follows block 0's heading while the view turns to its
 * look-at. `[proved]` for the eye. The three angles are what `FUN_00401C50`
 * recovers from the matrix the routine built out of the block's --
 * `(block.yaw - 0x8000) & 0xFFFF`, `-block.pitch` and `block.roll` --
 * `[likely]`: a decomposition of the rotation it was just given, and nothing
 * the port has reads them in (1,3).
 */
export function CameraFromViewAngles(): void {
  G.g_camera_yaw_bams = (G.g_camera_block_yaw_bams - 0x8000) & 0xffff;
  G.g_camera_pitch_bams = -G.g_camera_block_pitch_bams;
  G.g_camera_roll_bams = G.g_camera_block_roll_bams;
  const m = MatCopy(_m, G.g_camera_view_to_world);
  MatrixTranslate(m, 0, -CAMERA_EYE_DROP, 0);
  MatrixGetTranslation(m, G.g_camera_eye);
}

/**
 * `CameraSnapToPathEye` — `FUN_0040C430`, scene state (2,4)'s hook on its
 * first call: the camera block's eye into the deferred pose block, the hook
 * re-pointed at {@link CameraHoldEyeTick}, and that run. `[proved]`
 */
export function CameraSnapToPathEye(): void {
  G.g_cam_path_eye.x = G.g_camera_block_eye.x;
  G.g_cam_path_eye.y = G.g_camera_block_eye.y;
  G.g_cam_path_eye.z = G.g_camera_block_eye.z;
  G.g_camera_update_hook = CameraUpdateHook.HoldEye;
  CameraHoldEyeTick();
}

/**
 * `CameraHoldEyeTick` — `FUN_0040C470`. The gameplay eye held where
 * {@link CameraSnapToPathEye} put the pose, and **`g_cam_path_frames_left =
 * -1` every frame** -- which is what lets `CameraTrackEnemiesTick` arm a
 * branch preview under minor 4. It writes no angles: the eye holds while
 * `SelectCameraLookAtTarget` swings the look-at. `[proved]`
 */
export function CameraHoldEyeTick(): void {
  G.g_camera_eye.x = G.g_cam_path_eye.x;
  G.g_camera_eye.y = G.g_camera_use_fixed_y === 1
    ? G.g_camera_fixed_eye_y : G.g_cam_path_eye.y - CAMERA_EYE_DROP;
  G.g_cam_path_frames_left = -1;
  G.g_camera_eye.z = G.g_cam_path_eye.z;
}

/**
 * The two words `CameraPathWithImpulseShake` measures its heading from,
 * `0x009C7084` and `0x009C708C`. Nothing in the image writes either (byte
 * search for `84709c00` / `8c709c00` finds the one read each), so they hold
 * their load value, zero. `[proved]`
 */
const IMPULSE_ORIGIN_X = 0;
const IMPULSE_ORIGIN_Z = 0;

/**
 * `CameraPathWithImpulseShake` — `FUN_0040C4C0`, scene state (2,5)'s hook on
 * its first call. **No shipped script enters (2,5)**: `finish_sequence`'s
 * 836 operands are 4, 6 and 7 only.
 *
 * ```c
 * g_camera_eye.x = block.eye.x;  g_camera_eye.z = block.eye.z;
 * g_camera_eye.y = fixed_y ? g_camera_fixed_eye_y : g_cam_path_eye.y - 15.0;   // the POSE's y
 * g_camera_pitch_bams = -block.pitch;
 * g_camera_yaw_bams   = (block.yaw - 0x8000) & 0xFFFF;
 * g_camera_roll_bams  = block.roll;
 * g_camera_impulse_yaw_bams = (s16)ftol(atan2(0x9C7084 - eye.x, -(0x9C708C - eye.z)) * 10430.378);
 * impulse offset, velocity, request and lock = 0;
 * hook = CameraImpulseShakeTick, and fall into it.
 * ```
 */
export function CameraPathWithImpulseShake(): void {
  const eye = G.g_camera_block_eye;
  G.g_camera_eye.x = eye.x;
  G.g_camera_eye.y = G.g_camera_use_fixed_y === 1
    ? G.g_camera_fixed_eye_y : G.g_cam_path_eye.y - CAMERA_EYE_DROP;
  G.g_camera_eye.z = eye.z;
  G.g_camera_pitch_bams = -G.g_camera_block_pitch_bams;
  G.g_camera_yaw_bams = (G.g_camera_block_yaw_bams - 0x8000) & 0xffff;
  G.g_camera_roll_bams = G.g_camera_block_roll_bams;
  const a = Math.atan2(IMPULSE_ORIGIN_X - eye.x, -(IMPULSE_ORIGIN_Z - eye.z));
  G.g_camera_impulse_yaw_bams = (Math.trunc(a * RADIANS_TO_BAMS) << 16) >> 16;
  G.g_camera_impulse_offset = vec3();
  G.g_camera_impulse_velocity = vec3();
  G.g_camera_impulse_request = 0;
  G.g_camera_impulse_lock = 0;
  G.g_camera_update_hook = CameraUpdateHook.ImpulseShake;
  CameraImpulseShakeTick();
}

/** `MOV [0x009C7104], 0x1E`: a push lasts thirty frames. */
const IMPULSE_FRAMES = 30;
/** `[0x004C43A0]` = 8.0, the push's scale. */
const IMPULSE_SCALE = 8.0;
/** `[0x004D1CE4]` = 1/15 (`0x3D888889`), the offset's share. */
const IMPULSE_OFFSET_K = 0.06666667;
/** `[0x004D1CE8]` = -1/450 (`0xBB11A2B4`), the velocity's share. */
const IMPULSE_VELOCITY_K = -0.0022222223;
/** `g_pad_state` bit `0x20000`, which requests a push. */
const IMPULSE_PAD_BIT = 0x20000;

/**
 * `CameraImpulseShakeTick` — `FUN_0040C5C0`. (2,5)'s steady body.
 *
 * ```c
 * if (g_pad_state & 0x20000) request = 1;
 * if (request && !frames && !lock) {
 *     dir = RotY(g_camera_impulse_yaw_bams) * (0, 0, -1);
 *     frames = 30;  velocity = dir * 8 * -1/450;  offset = dir * 8 * 1/15;
 * }
 * if (frames) {
 *     if (--frames == 0) request = 0;
 *     offset += velocity;  g_camera_eye += offset;
 * }
 * ```
 *
 * The eye it pushes is the one the install left: nothing else writes it under
 * (2,5), so a push is thirty frames of drift that stays where it ends.
 * `[proved]`
 */
export function CameraImpulseShakeTick(): void {
  if (G.g_pad_state & IMPULSE_PAD_BIT) G.g_camera_impulse_request = 1;
  if (G.g_camera_impulse_request !== 0 && G.g_camera_impulse_frames === 0
      && G.g_camera_impulse_lock === 0) {
    const m = _m;
    MatrixLoadIdentity(m);
    MatrixRotateY(m, G.g_camera_impulse_yaw_bams);
    _p.x = 0; _p.y = 0; _p.z = -1;
    MatrixTransformPoint(m, _p, _q);
    G.g_camera_impulse_frames = IMPULSE_FRAMES;
    const v = G.g_camera_impulse_velocity, o = G.g_camera_impulse_offset;
    v.x = _q.x * IMPULSE_SCALE * IMPULSE_VELOCITY_K;
    v.y = _q.y * IMPULSE_SCALE * IMPULSE_VELOCITY_K;
    v.z = _q.z * IMPULSE_SCALE * IMPULSE_VELOCITY_K;
    o.x = _q.x * IMPULSE_SCALE * IMPULSE_OFFSET_K;
    o.y = _q.y * IMPULSE_SCALE * IMPULSE_OFFSET_K;
    o.z = _q.z * IMPULSE_SCALE * IMPULSE_OFFSET_K;
  }
  if (G.g_camera_impulse_frames === 0) return;
  G.g_camera_impulse_frames -= 1;
  if (G.g_camera_impulse_frames === 0) G.g_camera_impulse_request = 0;
  const o = G.g_camera_impulse_offset, v = G.g_camera_impulse_velocity;
  o.x += v.x; o.y += v.y; o.z += v.z;
  G.g_camera_eye.x += o.x;
  G.g_camera_eye.y += o.y;
  G.g_camera_eye.z += o.z;
}

/**
 * The view the frame is drawn with: the camera half of
 * `UpdateSceneViewAndLight` (`FUN_00401F40`), the last thing
 * `CameraActorTick` does.
 *
 * ```
 * for each of the four camera blocks b:
 *   if (b == g_camera_index) {                          -- the shake's nod
 *     LoadIdentity; Translate(b.eye); RotateY(b.yaw); RotateX(b.pitch)
 *     p = M * (0, (float)g_screen_shake_pitch, -1000)
 *     CamBlockSetAnglesFromLookAt(b, p, b.roll)
 *   }
 *   LoadIdentity; Translate(b.eye); RotateY(b.yaw); RotateX(b.pitch); RotateZ(b.roll)
 *   MatrixStore(b + 0x40)                                -- g_camera_blocks, view to world
 *   MatrixGetAngles(&b.pitch, &b.yaw, &b.roll);  b.eye = MatrixGetTranslation()
 *   LoadIdentity; RotateZ(-roll); RotateX(-pitch); RotateY(-yaw); Translate(-eye)
 *   MatrixStore(b + 0x00)                                -- g_camera_world_to_view
 * SetTop(g_camera_world_to_view[g_camera_index]); ...the scene light...
 * g_scene_state_major_entered = g_scene_state_major;  g_scene_state_minor_entered = g_scene_state_minor;
 * g_screen_furniture_flags bit 0 = !(major == 1 && app state != 5 && !(flags & 0x30));
 * ```
 *
 * **The view is a block's angles, not its look-at.** Every driver re-derives
 * the angles from the eye and the look-at before this runs, and this re-derives
 * them once more through the nod -- so a camera that does not re-derive them
 * (`EvtActionHoldCameraPreset20`, which writes angles and not a look-at, or a
 * parked slot) is drawn from whatever angles the block holds. The nod runs
 * every frame, pitch or none; with no shake it re-aims the block down its own
 * axis.
 *
 * **Which block is drawn is `g_camera_index`'s, and under scene state (1, 3)
 * that is block 2.** `CameraInstallViewAngles` (`FUN_004039D0`) writes the
 * index 2 (`camera/hooks.ts`); `EvtRunQueuedActionsSyncViewBlock`, earlier in
 * the same task, copies block 0's eye into block 2 and aims it at block 0's
 * **look-at** (`camera/actor.ts`). So a cutscene is drawn looking where block
 * 0's look-at says even when nothing derived block 0's angles from it: the
 * boss-name banner flies block 0's eye and look-at along its own path and
 * writes no angle (`boss_banner.ts`), and the camera turns with the flight.
 * Outside (1, 3) the starters' `CameraResetForPathShot` puts the index back
 * to 0. `[proved]`
 *
 * The shake's nod is a vertical turn of `atan(pitch / 1000)`: 47 units at its
 * first frame is 2.7 degrees, decaying linearly and swinging every 10.7 frames
 * (`UpdateScreenShake`, `FUN_00415270`). It does not accumulate where a hit
 * can happen: under row 2 a driver re-derives the angles from eye and look-at
 * every frame, so each frame's nod lands on an un-nodded aim -- and under
 * (1, 3) it lands on block 2, which is re-aimed from block 0 every frame, and
 * never on block 0. `[proved]`
 *
 * The drawn block's two matrices are what the port's frame reads the camera
 * through -- the host's `viewSpaceOf`, `viewPoint`, `aimPoint` and
 * `cameraMatrices`, through {@link CameraBlockWorldToView} and
 * {@link CameraBlockViewToWorld} -- and what the draw places the three.js
 * camera from. Built here, inside the camera actor's task, they are the view
 * of **this** frame for every task after it, as the engine's are. The port
 * keeps blocks 0 and 2, the two the index is ever written; blocks 1 and 3 are
 * the two-player blocks no shipped script uses.
 */
import { AppState, G } from "../globals";
import { BuildSceneLightDirection } from "../light_block";
import { SetRenderLightDirection } from "../light_sets";
import { MatrixGetAngles, type Rot3 } from "../carrier";
import { MatIdentity, MatCopy, MatrixGetTranslation, MatrixLoadIdentity,
         MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTransformPoint,
         MatrixTranslate, type Mat } from "../matrix";
import { vec3, type Vec3 } from "../vec";
import { CameraUpdateHook } from "./driver";
import { CamBlockSetAnglesFromLookAt, CamEvalPath7, CameraPoseBlock }
  from "./path";

/** `MOV [ESP+0x34], 0xC47A0000` — the look distance, -1000 on the camera's z. */
export const SHAKE_LOOK_DISTANCE = 1000.0;

/**
 * The camera index `CameraInstallViewAngles` (`FUN_004039D0`) writes -- `MOV
 * dword ptr [0x009c6f00], 0x2` at `0x004039D5` -- and so the block drawn under
 * scene state (1, 3).
 */
export const CAMERA_INDEX_VIEW_ANGLES = 2;

const _m = MatIdentity();
const _p = vec3();
const _q = vec3();

/**
 * The view-to-world matrix's rotation as `game/carrier.ts`'s `Rot3`: the
 * matrix stack keeps row vectors, so its `+X` image is row 0 where `Rot3`'s is
 * column 0. `[port-only]`.
 */
function RotationOf(m: ArrayLike<number>): Rot3 {
  return [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
}

/**
 * `[port-only]` -- `g_camera_blocks + i * 0x1A4` (`0x009A6040`), camera block
 * `i`'s view-to-world matrix: how a reader the engine points at
 * `g_camera_index`'s block reads it. The port keeps blocks 0 and 2, the only
 * values `g_camera_index` is ever written (see the global), so any other `i`
 * is block 0's.
 */
export function CameraBlockViewToWorld(i: number): Mat {
  return i === CAMERA_INDEX_VIEW_ANGLES ? G.g_camera_block2_view_to_world
    : G.g_camera_view_to_world;
}

/**
 * `[port-only]` -- `g_camera_world_to_view + i * 0x1A4` (`0x009A6000`),
 * camera block `i`'s world-to-view matrix, as {@link CameraBlockViewToWorld}.
 * Handed `G.g_camera_index`, it is the matrix `UpdateSceneViewAndLight` leaves
 * on the top of the stack (`0x0040212E`) for every draw after it.
 */
export function CameraBlockWorldToView(i: number): Mat {
  return i === CAMERA_INDEX_VIEW_ANGLES ? G.g_camera_block2_world_to_view
    : G.g_camera_world_to_view;
}

/**
 * `[port-only]` -- `g_camera_blocks + i * 0x1A4 + 0x80` (`0x009A60C0`), camera
 * block `i`'s eye, as {@link CameraBlockViewToWorld}: how a reader the engine
 * points at `[g_camera_index * 0x1A4 + 0x9A60C0]` reads it. Handed
 * `G.g_camera_index`, it is the eye of the block the frame is drawn from --
 * block 2's under scene state (1, 3), block 0's otherwise. A reader that
 * names `0x009A60C0` by address reads `G.g_camera_block_eye` whatever the
 * index, and one that names `0x009C71E0` reads `G.g_camera_eye`, the gameplay
 * eye; `docs/formats/cam.md` § *Which eye* has the table.
 */
export function CameraBlockEye(i: number): Vec3 {
  return i === CAMERA_INDEX_VIEW_ANGLES ? G.g_camera_block2_eye
    : G.g_camera_block_eye;
}

/**
 * `[port-only]` -- `g_camera_blocks + i * 0x1A4 + 0x90` (`0x009A60D0`), camera
 * block `i`'s yaw, as {@link CameraBlockEye}: what a reader of
 * `[g_camera_index * 0x1A4 + 0x9A60D0]` reads.
 */
export function CameraBlockYaw(i: number): number {
  return i === CAMERA_INDEX_VIEW_ANGLES ? G.g_camera_block2_yaw_bams
    : G.g_camera_block_yaw_bams;
}

/**
 * `[port-only]` -- `g_camera_blocks + i * 0x1A4 + 0xD0` (`0x009A6110`), camera
 * block `i`'s path frame, as {@link CameraBlockEye}: what a reader of
 * `[g_camera_index * 0x1A4 + 0x9A6110]` reads -- `PropUpdateType72`
 * (`0x0047095A`), `WaterSurfaceUpdate` (`0x0046E50B`) and
 * `OwlUpdateAndResolveShot` (`0x004460EA`), each after `MOV reg,
 * [0x009c6f00]`. Block 2's is `G.g_cam_path_frame_2`, which is always 0, so
 * under scene state (1, 3) such a reader sees 0 whatever path is playing.
 */
export function CameraBlockPathFrame(i: number): number {
  return i === CAMERA_INDEX_VIEW_ANGLES ? G.g_cam_path_frame_2
    : G.g_cam_path_frame;
}

/**
 * `[port-only]` -- `g_camera_blocks + i * 0x1A4 + 0x8C` (`0x009A60CC`), camera
 * block `i`'s pitch, as {@link CameraBlockYaw}.
 */
export function CameraBlockPitch(i: number): number {
  return i === CAMERA_INDEX_VIEW_ANGLES ? G.g_camera_block2_pitch_bams
    : G.g_camera_block_pitch_bams;
}

/**
 * `UpdateSceneViewAndLight` — `FUN_00401F40`, for the two camera blocks the
 * port keeps, in the loop's order (`ESI` from `0x009A60D4` by `0x1A4`: block 0
 * first, block 2 third). See the head of this file. Then the light
 * (`0x00402147`..`0x00402168`):
 *
 * ```
 * BuildSceneLightDirection(g_scene_light_pitch_bams, g_scene_light_yaw_bams,
 *                          &g_scene_light_block0, &g_scene_light_dir_view)
 * SetRenderLightDirection(&g_scene_light_dir_view)
 * FUN_0040E160(&g_scene_light_block0)        ; the shadow's copy, not carried
 * ```
 */
export function UpdateSceneViewAndLight(): void {
  // `CMP EBP, [0x009c6f00]; JNZ` at `0x00401F4E`: the nod, on the block
  // `g_camera_index` names, and on no other.
  if (G.g_camera_index === 0) CameraNodBlock(CameraPoseBlock.Camera);
  CameraBuildView();
  if (G.g_camera_index === CAMERA_INDEX_VIEW_ANGLES) {
    CameraNodBlock(CameraPoseBlock.Block2);
  }
  CameraBlock2BuildView();
  const b0 = G.g_scene_light_block0;
  BuildSceneLightDirection(b0.pitch, b0.yaw, b0.dir);
  SetRenderLightDirection(b0.dir);
  // The stamp every unstamped scene-state entry waits for.
  G.g_scene_state_major_entered = G.g_scene_state_major;
  G.g_scene_state_minor_entered = G.g_scene_state_minor;
  if (G.g_scene_state_major === 1 && G.g_app_state !== AppState.Attract
      && (G.g_screen_furniture_flags & 0x30) === 0) {
    G.g_screen_furniture_flags &= ~1;
  } else {
    G.g_screen_furniture_flags |= 1;
  }
}

/**
 * `[port-only]` as a function -- the nod, `0x00401F5A`..`0x00402041`: a
 * point a thousand units down the block's own axis, lifted by the shake, and
 * the block's pitch and yaw re-derived from it with its own roll.
 */
function CameraNodBlock(block: CameraPoseBlock.Camera
                             | CameraPoseBlock.Block2): void {
  const b2 = block === CameraPoseBlock.Block2;
  const e = b2 ? G.g_camera_block2_eye : G.g_camera_block_eye;
  const m = _m;
  MatrixLoadIdentity(m);
  MatrixTranslate(m, e.x, e.y, e.z);
  MatrixRotateY(m, b2 ? G.g_camera_block2_yaw_bams : G.g_camera_block_yaw_bams);
  MatrixRotateX(m, b2 ? G.g_camera_block2_pitch_bams
                      : G.g_camera_block_pitch_bams);
  _p.x = 0;
  _p.y = Math.fround(G.g_screen_shake_pitch);
  _p.z = -SHAKE_LOOK_DISTANCE;
  MatrixTransformPoint(m, _p, _q);
  CamBlockSetAnglesFromLookAt(block, _q, b2 ? G.g_camera_block2_roll_bams
                                            : G.g_camera_block_roll_bams);
}

/**
 * `[port-only]` as a function -- the per-block body of
 * `UpdateSceneViewAndLight` after the nod, for block 0: view-to-world built
 * from the block's eye and angles, the angles and eye read back out of it
 * (`MatrixGetAngles`, `MatrixGetTranslation`), and world-to-view built from
 * those. See the head of this file.
 */
export function CameraBuildView(): void {
  const e = G.g_camera_block_eye;
  const m = _m;
  MatrixLoadIdentity(m);
  MatrixTranslate(m, e.x, e.y, e.z);
  MatrixRotateY(m, G.g_camera_block_yaw_bams);
  MatrixRotateX(m, G.g_camera_block_pitch_bams);
  MatrixRotateZ(m, G.g_camera_block_roll_bams);
  MatCopy(G.g_camera_view_to_world, m);
  // `MatrixGetAngles` (`FUN_004018E0`): each angle truncated to whole BAMS,
  // so the round trip can lose one.
  const a = MatrixGetAngles(RotationOf(m));
  G.g_camera_block_pitch_bams = a.x;
  G.g_camera_block_yaw_bams = a.y;
  G.g_camera_block_roll_bams = a.z;
  MatrixGetTranslation(m, e);
  MatrixLoadIdentity(m);
  MatrixRotateZ(m, -G.g_camera_block_roll_bams);
  MatrixRotateX(m, -G.g_camera_block_pitch_bams);
  MatrixRotateY(m, -G.g_camera_block_yaw_bams);
  MatrixTranslate(m, -e.x, -e.y, -e.z);
  MatCopy(G.g_camera_world_to_view, m);
}

/**
 * `[port-only]` as a function -- the same per-block body for camera block 2,
 * the loop's third pass (`ESI` = `0x009A641C`): its view-to-world into
 * `0x009A6388`, its angles and eye read back through the same
 * `MatrixGetAngles` truncation block 0's go through, and its world-to-view
 * into `0x009A6348` -- the matrices the frame is drawn from while
 * `g_camera_index` is 2, and the yaw the frog's wedge reads. `[proved]`
 */
function CameraBlock2BuildView(): void {
  const e = G.g_camera_block2_eye;
  const m = _m;
  MatrixLoadIdentity(m);
  MatrixTranslate(m, e.x, e.y, e.z);
  MatrixRotateY(m, G.g_camera_block2_yaw_bams);
  MatrixRotateX(m, G.g_camera_block2_pitch_bams);
  MatrixRotateZ(m, G.g_camera_block2_roll_bams);
  MatCopy(G.g_camera_block2_view_to_world, m);
  const a = MatrixGetAngles(RotationOf(m));
  G.g_camera_block2_pitch_bams = a.x;
  G.g_camera_block2_yaw_bams = a.y;
  G.g_camera_block2_roll_bams = a.z;
  MatrixGetTranslation(m, e);
  MatrixLoadIdentity(m);
  MatrixRotateZ(m, -G.g_camera_block2_roll_bams);
  MatrixRotateX(m, -G.g_camera_block2_pitch_bams);
  MatrixRotateY(m, -G.g_camera_block2_yaw_bams);
  MatrixTranslate(m, -e.x, -e.y, -e.z);
  MatCopy(G.g_camera_block2_world_to_view, m);
}

/**
 * `[port-only]` as a function -- the tail of `EvtRunQueuedActionsSyncViewBlock`
 * (`FUN_004023D0`), from `0x004023F0`, where its `JMP` lands once the queued
 * actions have run: under scene state (1, 3) camera block 2 takes block 0's
 * eye and angles (`REP MOVSD` of six dwords from `0x009A60C0`), its look-at
 * and the three words after it (six from `0x009A60D8`), and is aimed at that
 * look-at with block 0's roll. See `camera/actor.ts` for the routine, and the
 * `== 5` arm this does not have.
 */
export function CameraSyncViewBlock2(): void {
  if (G.g_scene_state_minor_entered !== 3) return;
  const e = G.g_camera_block_eye, t = G.g_camera_block_target;
  G.g_camera_block2_eye = vec3(e.x, e.y, e.z);
  G.g_camera_block2_pitch_bams = G.g_camera_block_pitch_bams;
  G.g_camera_block2_yaw_bams = G.g_camera_block_yaw_bams;
  G.g_camera_block2_roll_bams = G.g_camera_block_roll_bams;
  G.g_camera_block2_target = vec3(t.x, t.y, t.z);
  CamBlockSetAnglesFromLookAt(CameraPoseBlock.Block2, G.g_camera_block2_target,
                              G.g_camera_block_roll_bams);
}

/**
 * `[port-only]` -- put the camera block where the camera words say, and build
 * the view drawn from it, for a seek, the frame scrubber, a reset or a stage
 * opening at an address: the places the player moves the script without
 * running the frames that would have written the block. The engine has no
 * seek, so there is no routine to cite; each half is the routine that would
 * have written the block had the frames run -- the path at `g_cam_path_frame`
 * into the block as `CamAdvancePathFrame` writes it, or, with the stashed rail
 * installed, the rail's frame into the deferred pose block and that copied
 * across as `CameraDriverFromDeferredPose` copies it; then, under (1, 3), the
 * block copied into block 2 as the camera actor's next pass copies it, since
 * block 2 is the one drawn there; and both blocks' matrices built.
 */
export function CameraReseatFromFrame(): void {
  const slot = G.g_active_cam_path;
  if (slot < 0) return;
  const hook = G.g_camera_update_hook as CameraUpdateHook;
  if (hook === CameraUpdateHook.StepRail
      || hook === CameraUpdateHook.DeferredRailInstall
      || hook === CameraUpdateHook.PlayStashedPath) {
    const roll = CamEvalPath7(slot, G.g_rail_frame, G.g_cam_path_eye,
                              G.g_cam_path_target);
    CamBlockSetAnglesFromLookAt(CameraPoseBlock.Path, G.g_cam_path_target, roll);
    const e = G.g_camera_block_eye, pe = G.g_cam_path_eye;
    e.x = pe.x; e.y = pe.y; e.z = pe.z;
    const t = G.g_camera_block_target, pt = G.g_cam_path_target;
    t.x = pt.x; t.y = pt.y; t.z = pt.z;
    G.g_camera_block_pitch_bams = G.g_cam_path_pitch_bams;
    G.g_camera_block_yaw_bams = G.g_cam_path_yaw_bams;
    G.g_camera_block_roll_bams = G.g_cam_path_roll_bams;
  } else {
    const roll = CamEvalPath7(slot, G.g_cam_path_frame, G.g_camera_block_eye,
                              G.g_camera_block_target);
    CamBlockSetAnglesFromLookAt(CameraPoseBlock.Camera,
                                G.g_camera_block_target, roll);
  }
  CameraBuildView();
  if (G.g_scene_state_major_entered === 1) CameraSyncViewBlock2();
  CameraBlock2BuildView();
}

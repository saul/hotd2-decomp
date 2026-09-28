/**
 * The camera's mode-3 routine, the minor-7 driver, and the camera point every
 * enemy registers.
 *
 * `CameraTrackEnemiesTick` (`FUN_00402890`) is the gameplay camera, the mode
 * `CameraDriverSelectMode` runs while anything is alive or claimed:
 *
 * ```c
 * if (g_cam_path_frames_left < 0 && g_evt_cam_override_valid) CameraArmStashedPath(&block);
 * CameraEaseBlockEyeToPathPose();              // the block's EYE, onto the deferred pose
 * SelectCameraLookAtTarget();                  // what it WANTS to look at
 * block.target = TurnLookAtToward(block.eye, g_camera_lookat_target, block.target, 1, g_camera_turn_rate);
 * CamBlockSetAnglesFromLookAt(&block, &block.target, block.roll);
 * if (!g_camera_is_tracking) {
 *     if (|cos2(lookat - eye, target - eye)| > 0.99999) g_camera_settled = 1;
 *     g_camera_turn_rate = *[0x00576C0C];      // 12
 * } else if (g_enemies_alive == 0 && g_camera_hand_back_variant == 2) g_camera_turn_rate = 0;
 * else ComputeLookAtAngleError();
 * ```
 *
 * The turn is unconditional: there is no branch that assigns the desired
 * point straight through, so the aim only ever moves by easing, and with
 * nothing registered the desired point is the deferred pose's own target
 * (`g_cam_path_target`) -- which is why the camera swings back onto the rail
 * when the last enemy dies instead of cutting to it. The eye is the deferred
 * pose's: the stashed rail moves it under minor 6, and under minor 4
 * `CameraSnapToPathEye` froze it where the shot left the block.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import type { GameHost } from "../host";
import { TURN_RATE_UNTRACKED } from "./constants";
import { CamBlockSetAnglesFromLookAt, CamEvalPath7, CameraPoseBlock }
  from "./path";
import { SelectCameraLookAtTarget } from "./select_target";
import { CameraSlotsBusy, RegisterForCameraTracking } from "./slots";
import { ComputeLookAtAngleError, LookAtCosineSquared, TurnLookAtToward }
  from "./turn";
import { LerpWeighted, vec3 } from "../vec";
import { RegisterForShotTest } from "../combat/shot_test";

/**
 * The bone the camera follows.
 *
 * `SkeletonEmitNode` (`FUN_004114C0`) records one bone's **world position**
 * into `obj+0x100` as it walks the skeleton, and that is what
 * `SelectCameraLookAtTarget` aims at — never `obj+0x40`. The bone is **1** for
 * an ordinary humanoid (character types 0..0x14); 2 and 9 are selected by
 * flags this port does not model, and so is the `-3.5` the same routine takes
 * off the height for a close-ranked enemy. `[open]` -- see
 * `docs/PLAYER_PROGRESS.md`'s camera section.
 */
const CAMERA_TRACK_BONE = 1;

const _bone = vec3();

/**
 * `[port-only]` -- the `obj+0x100` write `SkeletonEmitNode` (`FUN_004114C0`)
 * makes while it draws the actor: the tracked bone's world position, unlifted.
 *
 * The engine draws every skeleton actor inside its own update, so every one of
 * them carries the point whether or not it ever registers for the camera --
 * the host's `viewSpaceOf` and the HUD marker read it for all of them. The
 * port's skeleton is three.js's, so the point comes across `GameHost` from the
 * pose the renderer last drew, and `SceneTaskWalk` records it for each
 * visible actor before its update runs. A host with no pose for the actor
 * leaves the point where it was.
 *
 * This ran in `render/characters.ts` until step 21, writing `a.lookAt` from a
 * renderer -- which meant turning the Characters view toggle off froze the
 * camera's idea of where everything was. A view switch is not allowed to
 * change what the game thinks.
 *
 * Returns whether the point was recorded.
 */
export function SkeletonRecordCameraPoint(obj: Actor, host: GameHost): boolean {
  if (!host.boneWorld(obj.at, CAMERA_TRACK_BONE, _bone)) return false;
  obj.lookAt.x = _bone.x;
  obj.lookAt.y = _bone.y;
  obj.lookAt.z = _bone.z;
  return true;
}

/**
 * `ActorRegisterCameraPoint` — `FUN_00409B70`. Where the camera follows this
 * actor, where the shot test finds it, and the call that makes it a camera
 * candidate at all: one routine with two tail calls.
 *
 * ```
 * 00409B74  ESI = g_cur_actor
 * 00409B7A  MatrixStackPush(0); MatrixStackSetTopFromArray(g_camera_world_to_view)
 * 00409BA3  obj+0x70..0x78 = MatrixTransformPoint(obj+0x100..0x108)
 * 00409BE7  MatrixStackPop(1)                 ; Ghidra: no-return, so ...
 * 00409BEC  PUSH ESI; CALL 0x00405160         ; ... RegisterForShotTest is in no xref list
 * 00409BF2  obj+0x104 += rise                 ; FLD [ESP+0x38]; FADD [ESI+0x104]
 * 00409C03  RegisterForCameraTracking(obj)    ; 0x00408EC0, the second tail call
 * ```
 *
 * `rise` is **the routine's float argument**, pushed at each call site --
 * `d9442438` at `0x00409BF2` is the first argument with the prologue's
 * `SUB ESP, 0x18` and one `PUSH ESI` live `[proved]`. The seventeen sites,
 * re-read with `disassemble_bytes` because the decompiler drops float
 * arguments:
 *
 * | site | caller | push | value | gate before the call |
 * |---|---|---|---|---|
 * | 0x0045347A | `EnemyZombieUpdate`, class 0x30 | `6800008040` | **4.0** | none |
 * | 0x00449991 | `EnemyThrowerUpdate`, class 0x31 | `6a00` | **0.0** | none |
 * | 0x0048ADB0 | `CivilianUpdate`, class 0x10 | `6800008040` | **4.0** | none |
 * | 0x0043A2C7 | `FrogUpdate`, class 0x11 | `680000803f` | 1.0 | none |
 * | 0x0047621E | `Class14Update`, class 0x14 | `state+0x0C` | **runtime** | none |
 * | 0x00491A49 | `Boss4Update`, class 0x19 | `PUSH EAX` = `[EDX + 0x70]` | **runtime** | none |
 * | 0x00427D01 / 0x004283D2 / 0x00428AB2 | `Class2DState3` / `4` / `5`, class 0x2D | `680000a040` | 5.0 | none |
 * | 0x0042C273 | `Class2DChildKind0Update` | `6800000040` | 2.0 | `obj+0x34` bit `0x100` clear |
 * | 0x0042C986, 0x0042D5D0 | `Class2DChildKind1Update`, `Class2DChildKind3Update` | `6800007041` | 15.0 | bit `0x100` clear |
 * | 0x0042CF93 | `Class2DChildKind2Update` | `6a00` | 0.0 | bit `0x100` clear |
 * | 0x0049C8CE | `Class22FightPhase2`, class 0x22 | `6800000040` | 2.0 | bit `0x100` clear |
 * | 0x0047CA3A | `Class32Update`, class 0x32 | `6a00` | 0.0 | none |
 * | 0x00490917, 0x004912EA | `Class23FightBesideCompanion`, `Class23TrainingFightAlone`, class 0x23 | `680000c040` | 6.0 | none |
 *
 * **Each class's update makes the call itself, at its row above**, as the
 * engine's do: classes 0x30, 0x31, 0x10 and 0x11 in their updates here, and
 * the boss classes in their own directories. A class with no port has no
 * update and so never registers -- it cannot hold a room gate with nothing to
 * shoot. The owl, the bats, the fish, the horde and the carried props file
 * themselves with `RegisterForCameraTracking` directly, which is their exe
 * routines' shape. Classes 0x24, 0x25, 0x41 and 0x44 never call it.
 *
 * `obj+0x100` is what the skeleton walk recorded as it drew the tracked bone
 * ({@link SkeletonRecordCameraPoint}); every exe caller draws the line before,
 * so the port re-reads the pose here and the lift lands on this frame's bone
 * and never on last frame's lifted one. It goes into the shot test **before**
 * the lift, so the sphere sits on the bone and the camera aims `rise` above
 * it. A host with no pose refreshes nothing and lifts nothing -- with no draw
 * the port's `+= rise` would climb -- but the actor still registers.
 *
 * **The shot-test call is made for every class, as the engine's is.** The
 * list it appends to has two readers: the shot pick, and -- published a frame
 * later by `ColiPublishDynamicList` (`FUN_00405360`) -- the crowd push,
 * `ColiTestSphereAgainstActors` (`FUN_00405B10`), which finds a zombie, a
 * thrower, a civilian or a frog only because it registered here. The shot
 * test's migration, one class at a time (`docs/formats/combat.md`, "The shot
 * test"), is the pick's business and is kept there:
 * `ProcessPlayerShotsTestList` passes over the entry of a class that has not
 * set `ClassHandler.registersForShotTest`, which `render/characters.ts` still
 * picks, so no actor is in two picks at once. This call used to be gated on
 * that flag, which left every class-0x30 and 0x31 actor out of the list the
 * crowd push walks.
 */
export function ActorRegisterCameraPoint(obj: Actor, host: GameHost,
                                         rise: number): void {
  // An actor that carries the engine's model block (`game/skeleton.ts`) has
  // no host to ask: its own skeleton walk wrote `obj+0x100` this frame, as
  // the engine's does, and the routine's arithmetic applies as it stands --
  // `FLD rise; FADD [obj+0x104]; FSTP [obj+0x104]`, climbing too on a frame
  // whose walk drew nothing, which is the engine's own behaviour for a
  // hidden model (`SkeletonEmitNode` writes the point only while it draws).
  const posed = obj.skel ? true : SkeletonRecordCameraPoint(obj, host);
  obj.shotCentre.x = obj.lookAt.x;
  obj.shotCentre.y = obj.lookAt.y;
  obj.shotCentre.z = obj.lookAt.z;
  RegisterForShotTest(obj, host);
  if (obj.skel) {
    obj.lookAt.y = Math.fround(rise + obj.lookAt.y);
    RegisterForCameraTracking(obj);
    return;
  }
  if (posed) obj.lookAt.y += rise;
  RegisterForCameraTracking(obj);
}

/** `FUN_00403C00`'s numerator. Every call site in the engine passes 1. */
const TURN_NUMERATOR = 1;

/** `[0x004C439C]`, `0x3F7FFF58`: the convergence test, on the cosine squared. */
const SETTLED_COS2 = 0.99999;

const _eased = vec3();

/** `CameraTrackEnemiesTick` — `FUN_00402890`. See the file's head. `[proved]` */
export function CameraTrackEnemiesTick(): void {
  if (G.g_cam_path_frames_left < 0 && G.g_evt_cam_override_valid !== 0) {
    CameraArmStashedPath();
  }
  CameraEaseBlockEyeToPathPose();
  SelectCameraLookAtTarget();
  const eye = G.g_camera_block_eye;
  // The rate is one frame old on purpose: the engine writes it at the end of
  // this routine and reads it here, at the top of the next.
  TurnLookAtToward(eye, G.g_camera_lookat_target, G.g_camera_block_target,
                   _eased, TURN_NUMERATOR, G.g_camera_turn_rate);
  G.g_camera_block_target.x = _eased.x;
  G.g_camera_block_target.y = _eased.y;
  G.g_camera_block_target.z = _eased.z;
  CamBlockSetAnglesFromLookAt(CameraPoseBlock.Camera, G.g_camera_block_target,
                              G.g_camera_block_roll_bams);
  const cos2 = LookAtCosineSquared(eye, G.g_camera_lookat_target,
                                   G.g_camera_block_target);
  if (G.g_camera_is_tracking === 0) {
    // `EvtOpWaitTargetsClear47` is what reads this.
    if (Math.abs(cos2) > SETTLED_COS2) G.g_camera_settled = 1;
    G.g_camera_turn_rate = TURN_RATE_UNTRACKED;
    return;
  }
  // Dead code in the shipped game -- `CameraResetForPathShot` is the
  // variant's only writer and it writes 0 -- kept because it is a branch of
  // the routine and costs one line.
  if (G.g_enemies_alive === 0 && G.g_camera_hand_back_variant === 2) {
    G.g_camera_turn_rate = 0;
    return;
  }
  ComputeLookAtAngleError();
}

/** `LerpWeighted(block.eye, pose.eye, 1, 15)`: a sixteenth of the way a frame. */
const EASE_NUM = 1;
const EASE_DEN = 15;

/**
 * `CameraEaseBlockEyeToPathPose` — `FUN_00402EF0`. The block's eye onto the
 * deferred pose's:
 *
 * ```c
 * if (g_camera_ease_eye) block.eye = LerpWeighted(block.eye, g_cam_path_eye, 1, 15);   // per axis
 * else                   block.eye = g_cam_path_eye;
 * ```
 *
 * `g_camera_ease_eye` is raised by `set_flag` (`EvtActionSetFlag15`) and
 * lowered by `goto_scene_state` and the scene reset, so an ordinary shot
 * snaps and the twelve that raise it glide. `[proved]`
 */
export function CameraEaseBlockEyeToPathPose(): void {
  const e = G.g_camera_block_eye, p = G.g_cam_path_eye;
  if (G.g_camera_ease_eye !== 0) {
    e.x = LerpWeighted(e.x, p.x, EASE_NUM, EASE_DEN);
    e.y = LerpWeighted(e.y, p.y, EASE_NUM, EASE_DEN);
    e.z = LerpWeighted(e.z, p.z, EASE_NUM, EASE_DEN);
    return;
  }
  e.x = p.x; e.y = p.y; e.z = p.z;
}

/**
 * `CameraArmStashedPath` — `FUN_00403DB0`. Put the deferred pose on the shot
 * the next route will open with:
 *
 * ```c
 * g_rail_frame      = (float)g_evt_cam_override_pairs[g_script_branch_var * 2 + 1];
 * g_active_cam_path = g_evt_cam_override_pairs[g_script_branch_var * 2];
 * block.g_cam_path_frame = __ftol(g_rail_frame);
 * CamEvalPath7(g_active_cam_path, (float)g_cam_path_frame, &g_cam_path_eye, &g_cam_path_target, ...);
 * ```
 *
 * The pairs are the last `store_six`'s. It writes the deferred pose block and
 * the path words and **not** the camera block, which reaches the pose only
 * through the ease that follows it; nor the angle words beside the pose, which
 * nothing reads under the minors that call this. `[proved]`
 */
export function CameraArmStashedPath(): void {
  const pair = G.g_evt_cam_override_pairs[G.g_script_branch_var];
  const frame = pair?.frame ?? 0;
  G.g_rail_frame = frame;
  G.g_active_cam_path = pair?.path ?? 0;
  G.g_cam_path_frame = Math.trunc(G.g_rail_frame);
  CamEvalPath7(G.g_active_cam_path, G.g_cam_path_frame, G.g_cam_path_eye,
               G.g_cam_path_target);
}

/**
 * `CameraDriverFromDeferredPose` — `FUN_00402E00`. **The other driver**, and
 * the one a scene-state minor of 7 installs.
 *
 * ```c
 * g_camera_free = 1;
 * for (p = &g_enemy_slots; p < 0x009A5EE0; p += 8)
 *     if (*p != 0) { g_camera_free = 0; break; }
 * memcpy(&g_camera_block_eye,    g_cam_path_eye,     24);   // eye, pitch, yaw, roll
 * memcpy(&g_camera_block_target, &g_cam_path_target, 24);   // target, and the 12 bytes after it
 * g_cam_path_frame = __ftol(g_rail_frame);
 * ```
 *
 * Four slots, stride 8, and the flag is the *occupied* byte of each -- nothing
 * else. **It has no turn back onto the rail and no counter test**: it copies
 * the deferred pose block into the camera block whole, angles and all, and
 * frees the room on the frame the last enemy leaves the slot table. Minor 7 is
 * 264 of the 836 `finish_sequence` sites and 5 of the 278 room-clear gates.
 *
 * The second copy's last twelve bytes run past `g_cam_path_target` into
 * `0x009C70E4..EF`, over the camera block's `+0xE4..EF`. No instruction names
 * either address (no xref, and a byte search for `e4709c00` and `e4609a00`
 * finds nothing), so the port copies the target alone -- `[likely]` those
 * twelve bytes are padding in both blocks. `[proved]` for the rest.
 */
export function CameraDriverFromDeferredPose(): void {
  G.g_camera_free = CameraSlotsBusy() ? 0 : 1;
  const e = G.g_camera_block_eye, pe = G.g_cam_path_eye;
  e.x = pe.x; e.y = pe.y; e.z = pe.z;
  G.g_camera_block_pitch_bams = G.g_cam_path_pitch_bams;
  G.g_camera_block_yaw_bams = G.g_cam_path_yaw_bams;
  G.g_camera_block_roll_bams = G.g_cam_path_roll_bams;
  const t = G.g_camera_block_target, pt = G.g_cam_path_target;
  t.x = pt.x; t.y = pt.y; t.z = pt.z;
  G.g_cam_path_frame = Math.trunc(G.g_rail_frame);
}

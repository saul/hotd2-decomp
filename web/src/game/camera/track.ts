/**
 * `CameraTrackEnemiesTick` — `FUN_00402890`. The gameplay camera.
 *
 * One of the eight routines the scene state machine installs at
 * `g_camera_update_hook` (0x009C7080), and the one that is live while you are
 * fighting. It runs after the queued `cam_play` action has written the camera
 * block for this frame, and it does exactly three things:
 *
 * 1. `SelectCameraLookAtTarget` picks the point the camera *wants* — an
 *    attacking enemy, the midpoint of two, or the path's own target.
 * 2. `TurnLookAtToward` eases `g_camera_block_target` a fraction of the way
 *    onto it. **Unconditionally.** There is no branch here that assigns the
 *    desired point straight through; the only way the aim moves is by easing.
 * 3. It refreshes `g_camera_turn_rate` for the next frame: the angle-error
 *    curve while an enemy is registered, the flat constant (12) when none is.
 *
 * That is the whole reason the game's camera never cuts on its own. A shot
 * ends, `CamAdvancePathFrame` retires, the block freezes at the rail's last
 * pose, enemies pull the aim off it and — when they die — the fallback pulls
 * it smoothly back. The port had step 2 as an `if (tracking)`, so killing the
 * last enemy teleported the aim back to the rail in one frame.
 *
 * Not ported, deliberately:
 *
 * - The `CameraArmStashedPath` (`FUN_00403DB0`) call the routine opens with,
 *   which re-arms a branch preview's stashed pose.
 * - `FUN_00402EF0`, which eases the block **eye** toward the deferred-rail
 *   pose at 0x009C70C0 at 1/16 a frame. In this port the eye comes straight
 *   off the playing path every frame, exactly as `CamAdvancePathFrame` writes
 *   it; the second pose block that ease reads has no port yet. [open]
 * - `if (g_enemies_alive == 0 && DAT_009C6F2E == 2) rate = 0`, a snap. That
 *   byte *is* written -- once, to **0**, at `0x0040322D` in `FUN_004031E0` --
 *   so it is zero for the life of the process and the branch is dead code all
 *   the same. (This note used to say "written in none", which was wrong: the
 *   store is there, it just never stores anything but zero. Same conclusion,
 *   sounder reason.)
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import type { GameHost } from "../host";
import { TURN_RATE_UNTRACKED } from "./constants";
import { SelectCameraLookAtTarget } from "./select_target";
import { CameraSlotsBusy, RegisterForCameraTracking } from "./slots";
import { ComputeLookAtAngleError, LookAtCosineSquared, TurnLookAtToward }
  from "./turn";
import { vec3 } from "../vec";
import { RegisterForShotTest } from "../combat/shot_test";
import { g_class_handlers } from "../registry";

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
 * | 0x00490917, 0x004912EA | `Class23StateShared1`, `Class23Subtype2State1`, class 0x23 | `680000c040` | 6.0 | none |
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
 * The shot-test call is made for a class that has set
 * `ClassHandler.registersForShotTest`, and only for one: the classes that have
 * not are still picked by `render/characters.ts`, and filing them here as
 * well would put them in two picks at once. That boundary is the shot test's
 * migration, one class at a time (`docs/formats/combat.md`, "The shot
 * test"), not this routine's; it goes when the last class moves across.
 */
export function ActorRegisterCameraPoint(obj: Actor, host: GameHost,
                                         rise: number): void {
  const posed = SkeletonRecordCameraPoint(obj, host);
  if (g_class_handlers[obj.cls]?.registersForShotTest) {
    obj.shotCentre.x = obj.lookAt.x;
    obj.shotCentre.y = obj.lookAt.y;
    obj.shotCentre.z = obj.lookAt.z;
    RegisterForShotTest(obj, host);
  }
  if (posed) obj.lookAt.y += rise;
  RegisterForCameraTracking(obj);
}

/** `FUN_00403C00`'s numerator. Every call site in the engine passes 1. */
const TURN_NUMERATOR = 1;

const _eased = vec3();

export function CameraTrackEnemiesTick(): void {
  // `g_camera_settled` is cleared by `CameraActorTick` (`FUN_004022B0`) and
  // raised again by the convergence test below — it is a *this frame* answer,
  // not a latch. The clear used to be the first line of this function, which
  // held while this was the only camera routine the port ran and became a bug
  // the moment `CameraDispatchHandBack` could run instead of it: a latched
  // `g_camera_settled` opens every `wait_targets_clear` for the rest of the
  // stage. It is in the engine's own routine now.
  SelectCameraLookAtTarget();

  const eye = G.g_camera_block_eye;
  // The rate is one frame old on purpose: the engine writes it at the end of
  // this routine and reads it here, at the top of the next.
  TurnLookAtToward(eye, G.g_camera_lookat_target, G.g_camera_block_target,
                   _eased, TURN_NUMERATOR, G.g_camera_turn_rate);
  G.g_camera_block_target.x = _eased.x;
  G.g_camera_block_target.y = _eased.y;
  G.g_camera_block_target.z = _eased.z;

  if (!G.g_camera_is_tracking) {
    // `FUN_00401DF0` returns the *square* of the cosine, so 0.99999 is about
    // 0.18 degrees. `EvtOpWaitTargetsClear47` is what reads this.
    // `FUN_00401DF0` returns the *square* of the cosine and this is the
    // engine's own 0.99999. But it divides by both lengths, and returns 0
    // rather than NaN when either is degenerate -- which is a look-at sitting
    // exactly on the eye, before any path has seated the block. Zero fails the
    // test, so on that frame nothing would ever settle. Since room-clear gates
    // now hang off this, an unposed camera would park the script for good.
    //
    // So the degenerate case is answered directly instead: convergence is the
    // eased look-at having reached the desired one, and two coincident points
    // are converged whatever the eye is doing. A numerical guard on the port's
    // side, not a change to the rule. [diverges]
    const want = G.g_camera_lookat_target, have = G.g_camera_block_target;
    const gap = Math.abs(want.x - have.x) + Math.abs(want.y - have.y)
              + Math.abs(want.z - have.z);
    if (gap < 1e-4
        || Math.abs(LookAtCosineSquared(eye, want, have)) > 0.99999) {
      G.g_camera_settled = 1;
    }
    G.g_camera_turn_rate = TURN_RATE_UNTRACKED;
    return;
  }
  ComputeLookAtAngleError();
}

/**
 * `CameraDriverFromDeferredPose` — `FUN_00402E00`. **The other driver**, and
 * the one a scene-state minor of 7 installs.
 *
 *     g_camera_free = 1;
 *     for (p = &g_enemy_slots; p < 0x009A5EE0; p += 8)
 *         if (*p != 0) { g_camera_free = 0; break; }
 *     memcpy(&g_camera_block_eye, 0x009C70C0, 24);
 *     memcpy(&g_camera_block_target, &g_cam_path_target, 24);
 *     g_cam_path_frame = __ftol([0x009C70BC]);
 *
 * Four slots, stride 8, and the flag is the *occupied* byte of each — nothing
 * else. `g_enemy_slots` here holds only the claimed slots, so the walk is a
 * length test.
 *
 * **It has no turn back onto the rail and no counter test**: it copies the
 * deferred pose block into the camera block whole and frees the room on the
 * frame the last enemy leaves the slot table. That is why it is the wrong rule
 * to apply to every shot, which is what this function used to do — see
 * `camera/mode.ts`. Minor 7 is 264 of the 836 `finish_sequence` sites and 5 of
 * the 278 room-clear gates.
 *
 * The two `memcpy`s and the frame store are not modelled: the port's camera
 * block is seated from the playing path by the host every frame, which is the
 * same call it makes about `CameraEaseBlockEyeToPathPose` (`FUN_00402EF0`)
 * above. What is left is the flag. [diverges]
 */
export function CameraDriverFromDeferredPose(): void {
  G.g_camera_free = CameraSlotsBusy() ? 0 : 1;
}

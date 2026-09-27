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
import { SpawnClass } from "../spawn_class";
import { TURN_RATE_UNTRACKED } from "./constants";
import { SelectCameraLookAtTarget } from "./select_target";
import { ComputeLookAtAngleError, LookAtCosineSquared, TurnLookAtToward }
  from "./turn";
import { vec3 } from "../vec";
import { RegisterForShotTest } from "../combat/shot_test";

/**
 * The bone the camera follows.
 *
 * `SkeletonEmitNode` (`FUN_004114C0`) records one bone's **world position**
 * into `obj+0x100` as it walks the skeleton, and that is what
 * `SelectCameraLookAtTarget` aims at — never `obj+0x40`. The bone is **1** for
 * an ordinary humanoid (character types 0..0x14); 2 and 9 are selected by
 * flags this port does not model.
 */
const CAMERA_TRACK_BONE = 1;

/**
 * The lift each class asks `ActorRegisterCameraPoint` for.
 *
 * **It is the routine's float argument, not a field on the actor.**
 * `FUN_00409B70` reads it off the stack — `FLD float ptr [ESP + 0x38]`, bytes
 * `d9442438`, at 0x00409BF2, which with the prologue's `SUB ESP, 0x18` and one
 * `PUSH ESI` still live is the first argument — and adds it to `obj+0x104`
 * (`FADD float ptr [ESI + 0x104]`, `FSTP float ptr [ESI + 0x104]`). `[proved]`
 *
 * All fifteen call sites, re-read with `disassemble_bytes` and the raw hex
 * quoted, because the decompiler drops float arguments:
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
 * `Class2DState4` (`FUN_00427D40`) is what builds the four child kinds, one
 * `ActorAlloc(init, 0x13F4)` each on `obj+0x1320` 0..3 (`0x004282C5..0x0042831B`),
 * with the inits at `0x0042C0B0`, `0x0042C830`, `0x0042CD30` and `0x0042D490`.
 * Classes 0x2D, 0x22, 0x23 and 0x32 have no port, so their rows are recorded
 * and not admitted: an actor with no behaviour registering for the camera
 * would hold every room gate with nothing to shoot. `[open]` until they are.
 *
 * So it is per-call-site, and a constant at all but two -- class 0x14's and
 * class 0x19's are fields, which `ClassHandler.cameraRise` answers.
 *
 * **Classes 0x24, 0x25, 0x41 and 0x44 never call the routine at all**: the
 * sixteen rows above are every reference to 0x00409B70 in the binary and none
 * of them is in those classes' code. They get 0 here, because 0 is the only value that does not
 * invent a lift the engine never applies to them.
 *
 * [diverges] *Who* is registered is still not the engine's set: `director.ts`
 * calls {@link ActorLiftCameraPoint} for every visible actor of a class that
 * has not set `ClassHandler.registersForShotTest`, where the engine calls
 * `ActorRegisterCameraPoint` from these seventeen sites. Narrowing it would
 * leave `lookAt` at the origin for the rest, which `SelectCameraLookAtTarget`
 * and the HUD marker both read. A class that sets the flag calls the real
 * routine from its own update, at its row above, and leaves this list; this
 * table is what makes that possible one class at a time.
 */
const CAMERA_POINT_RISE: Partial<Record<SpawnClass, number>> = {
  [SpawnClass.Civilian]: 4,
  [SpawnClass.Zombie]: 4,
  // `CarriedZombieUpdate18` runs `EnemyZombieUpdate`, whose call this is.
  [SpawnClass.CarriedZombie]: 4,
  [SpawnClass.Thrower]: 0,
  // `FrogUpdate` (`FUN_0043A1E0`): `ActorRegisterCameraPoint(1.0)`.
  [SpawnClass.Frog]: 1,
};

/** What {@link CAMERA_POINT_RISE} gives a class with no exe call site. */
const CAMERA_POINT_RISE_NONE = 0;

/**
 * The float argument this class's `Update` pushes. See
 * {@link CAMERA_POINT_RISE}.
 *
 * [port-only] The engine has no such lookup: each `Update` pushes its own
 * literal at its own call site. The port calls `ActorRegisterCameraPoint` from
 * one place, so the fifteen literals have to be a table, and this is it.
 */
export function CameraPointRiseFor(cls: SpawnClass): number {
  return CAMERA_POINT_RISE[cls] ?? CAMERA_POINT_RISE_NONE;
}

const _bone = vec3();

/**
 * `ActorRegisterCameraPoint` — `FUN_00409B70`. Where the camera follows this
 * actor, and where the shot test finds it.
 *
 * ```
 * 00409B74  ESI = g_cur_actor
 * 00409B7A  MatrixStackPush(0); MatrixStackSetTopFromArray(g_camera_world_to_view)
 * 00409BA3  obj+0x70..0x78 = MatrixTransformPoint(obj+0x100..0x108)
 * 00409BE7  MatrixStackPop(1)                 ; Ghidra: no-return, so ...
 * 00409BEC  PUSH ESI; CALL 0x00405160         ; ... RegisterForShotTest is in no xref list
 * 00409BF2  obj+0x104 += rise                 ; FLD [ESP+0x38]; FADD [ESI+0x104]
 * 00409C03  RegisterForCameraTracking(obj)
 * ```
 *
 * **This is the call that puts its callers in the shot test.** Ghidra's
 * function body and its pseudocode both end at the `MatrixStackPop`, so
 * `get_xrefs_to 0x00405160` does not list it, and no update that reaches
 * `RegisterForShotTest` only through here shows up as a caller (`L35`).
 * `[proved]` from the bytes.
 *
 * `obj+0x100` is what `SkeletonEmitNode` (`FUN_004114C0`) recorded as it drew
 * the tracked bone -- bone 1 for any character type past `0x14`, which is
 * every boss, and 1, 2 or 9 by flags below that (see {@link CAMERA_TRACK_BONE})
 * -- and it goes into the shot test **before** the lift, so the sphere sits
 * on the bone and the camera aims `rise` above it. The port has the bone's world position across
 * `GameHost` and keeps `obj+0x70..0x78` in world space
 * ({@link Actor.shotCentre}); `RegisterForShotTest` takes the depth.
 *
 * Called by the classes that register the engine's way, from their own
 * update, at the exe's site. The rest still get {@link ActorLiftCameraPoint}
 * from `director.ts`. `RegisterForCameraTracking` is not called: the port's
 * candidate list is `camera/slots.ts`'s predicate over the pool, which
 * `ClassHandler.tracksCamera` already answers per class.
 *
 * `[port-only]` in one respect: a host with no pose for this actor refreshes
 * nothing and lifts nothing. The engine's callers have always drawn the bone
 * the line before, so its `+= rise` lands on a fresh point every frame; with
 * no draw, the port's would climb.
 */
export function ActorRegisterCameraPoint(obj: Actor, host: GameHost,
                                         rise: number): void {
  const posed = host.boneWorld(obj.at, CAMERA_TRACK_BONE, _bone);
  if (posed) {
    obj.lookAt.x = _bone.x;
    obj.lookAt.y = _bone.y;
    obj.lookAt.z = _bone.z;
  }
  obj.shotCentre.x = obj.lookAt.x;
  obj.shotCentre.y = obj.lookAt.y;
  obj.shotCentre.z = obj.lookAt.z;
  RegisterForShotTest(obj, host);
  if (posed) obj.lookAt.y += rise;
}

/**
 * `[port-only]` The camera half of `ActorRegisterCameraPoint`, for a class
 * that has not moved the call into its own update: the tracked bone, lifted.
 *
 * `director.ts` runs this for every visible actor of such a class, before its
 * update, which is what the port has always done. It registers nothing for
 * the shot test, because those classes are still picked by `render/` without
 * one. When a class sets `ClassHandler.registersForShotTest` it calls the
 * real routine above instead, and this is no longer run for it.
 *
 * This ran in `render/characters.ts` until step 21, writing `a.lookAt` from a
 * renderer — which meant turning the Characters view toggle off froze the
 * camera's idea of where everything was. A view switch is not allowed to
 * change what the game thinks; that it could is the shape
 * `no-actor-writes-in-render` exists to catch.
 *
 * A host with no pose for this actor leaves the point where it was, which is
 * what a character with no skeleton in the scene should look like.
 */
export function ActorLiftCameraPoint(obj: Actor, host: GameHost,
                                     rise: number): void {
  if (!host.boneWorld(obj.at, CAMERA_TRACK_BONE, _bone)) return;
  obj.lookAt.x = _bone.x;
  obj.lookAt.y = _bone.y + rise;
  obj.lookAt.z = _bone.z;
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
  G.g_camera_free = G.g_enemy_slots.length === 0 ? 1 : 0;
}

/**
 * The player's own body, and the hooks that place, pose and draw it.
 *
 * Each player has a skinned body actor in the exe: `PlayerBodiesCreate`
 * (`FUN_00416450`) allocates one per player into `0x009A5CD8 + p*0x130`
 * (`ActorAllocSub(0x13F4)`, so a sub-object of the task that made it and not a
 * task of its own) whenever a task list with the camera tasks in it is built --
 * every scene's, and the game-over fly-over's.
 *
 * Two hooks in the player block run it, both called from the player's own
 * task (`PlayerUpdateInPlay`, `0x00413E90`), the `+0x80` one first:
 *
 * * **`g_player_entity_hook`** (`+0x80`) places it. In play that is
 *   `PlacePlayerEntityFromViewPose` behind one of four thunks -- the body sits
 *   on the gameplay eye, which is what `CameraFollowPlayerMidpoint` reads
 *   back under scene state (1,1) -- until a script's `set_update_routine`
 *   (`EvtActionSetUpdateRoutine12`) installs one of `g_player_entity_routines`:
 *   stage 1's opening seats the body in the car (`PlayerHookEnterSt1Vehicle`
 *   and its successors), stage 2 block 6 stands it at a point
 *   (`PlayerHookStandAtScenePoint` and its). The scene-state installers from
 *   (1,2) on put a `PlaceEntity` thunk back.
 * * **`g_player_camera_hook`** (`+0x7C`) draws it. `PlayerHookDrawBody` under
 *   the follow and no-op cameras draws it **when `g_player_flags` bit 0 is
 *   up** -- which only those two routines raise -- and steps its clip
 *   either way; in app state 7 `PlayerHookDrawBodyUntilMotionEnd` draws the
 *   game-over fall.
 *
 * So the body is on screen in exactly two scenes of play and on the game-over
 * screen. What the renderer needs is the record below and nothing else: where
 * the body is, which clip, which cursor, which hand, and whether a hook drew it
 * this frame.
 */
import { MotionFlag, MOTION_FLAGS_INIT } from "./actor";
import { PropEvalObjectPath6 } from "./class41/object_path";
import { PlayerCameraHook, PlayerEntityHook, PlayerHookSpawnDamageOverlay }
  from "./effects/damage_overlay";
import type { Events } from "../core/events";
import { GameMode } from "./game_mode";
import { AppState, G } from "./globals";
import { MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
         MatrixTransformPoint, MatrixTranslate } from "./matrix";
import {
  PLAYER_BODY_AT, ST1_VEHICLE_PARKED_CLIP, ST1_VEHICLE_PARKED_CLIP_P2,
  ST1_VEHICLE_SEATED_CLIP, ST1_VEHICLE_SEATED_CLIP_P2,
} from "./player_body_data";
import { ActorDrawShadow } from "./model_draw";
import { ActorModelScale, rootDelta } from "./root_motion";
import { T } from "./tables";
import { vec3, type Vec3 } from "./vec";

/** One player's body actor -- the fields of it the hooks and the draw read. */
export interface PlayerBody {
  /** `[port-only]` -- the address the bundle's row is known by. */
  at: number;
  /** `obj+0x1F4`. */
  charType: number;
  /** `obj+0x1B4` -- `model[8]`, what `ActorSetMotion` writes. */
  motion: number;
  /**
   * `obj+0x194` -- `model[0]`, the frame counter, in 60 Hz ticks. The hooks
   * step it and compare it with `g_motion_play_length[motion] - 1`; a clip
   * change without a fade zeroes it, one with a fade leaves it running.
   */
  playTicks: number;
  /**
   * `obj+0x19C` -- `model[2]`, the play cursor the draw poses at:
   * `playTicks % (play_length + 1)`, except while a fade holds it on the
   * start `ActorSetMotionBlended` wrote. {@link PlayerBodyDraw} keeps it.
   */
  cursor: number;
  /** `model[10]` -- the counter a fade is measured from. */
  fadeOrigin: number;
  /** `model+0x30` -- the fade's length, `fade + 1`. */
  fadeDiv: number;
  /** `model+0x37` bit 0 -- a fade is running. */
  fading: number;
  /** `obj+0x40`..`+0x48`. */
  pos: Vec3;
  /** `obj+0x64` -- BAMS. */
  pitch: number;
  /** `obj+0x68` -- BAMS. */
  yaw: number;
  /** `obj+0x6C` -- BAMS. */
  roll: number;
  /**
   * `obj+0x4DC` -- bone record 5's draw slot (`0x20C + 5*0x90`), the hand
   * `PlayerBodySetHandSlot` swaps. `ActorBuildSkinnedModel` builds it as the
   * skeleton's own bone-5 model, which is the table's variant 1.
   */
  handSlot: number;
  /** `model+0x64` -- `ActorBuildSkinnedModel` leaves 3. */
  motionFlags: number;
  /**
   * `obj+0x34`, which the draw's ground shadow tests for `0x80000`. 0:
   * `ActorAllocSub` (`FUN_004A74E0`) zeroes the block with `STOSD.REP`, and
   * `PlayerBodiesCreate` (`FUN_00416450`) stores nothing there. `[proved]`
   * for both; no other writer of the body's word has been looked for.
   */
  flags: number;
  /** `model+0x116C`, from the character type alone. */
  scale: number;
  /**
   * `[port-only]` -- the play cursor the last draw posed, so the next one
   * can take the root delta `SkeletonApplyRootMotion` (`FUN_00410C50`) takes
   * from inside the draw. -1: nothing drawn since the clip changed.
   */
  lastFrame: number;
  /**
   * `[port-only]` -- a hook drew the body this frame. The engine's draw is
   * the hook's own `DrawSkinnedModelAndShadow` call; the port's is the
   * renderer's, which draws exactly the bodies this says were drawn.
   */
  drawn: number;
}

/** With one player the body falls from the path frame after this one. */
const ONE_PLAYER_FALL_AFTER = 0x3b;
/** `obj+0x4DC` is bone record 5's slot: `0x20C + 5 * 0x90`. */
const BODY_HAND_BONE = 5;
/**
 * `g_player_hand_slots`' row width -- `PlayerBodySetHandSlot`'s
 * `c * 3 + variant` (`0x00416810`).
 */
const HAND_SLOT_VARIANTS = 3;
/** `PlayerHookEnterSt1Vehicle`'s hand: `PlayerBodySetHandSlot(task, 0)`. */
const ST1_VEHICLE_HAND = 0;
/** `PlayerHookStandAtScenePoint`'s: `PlayerBodySetHandSlot(task, 1)`. */
const STAND_HAND = 1;
/** `PlayerHookRideSt1Vehicle`'s seat: `(seat_x, 0, 0.239)`, `0x3E74BC6A`. */
const ST1_VEHICLE_SEAT_Z = Math.fround(0.239);
/** The stage-1 vehicle's three shots: `cp_st1` 0, 1 and 2. */
const CP_ST1_DRIVE = 0x20;
const CP_ST1_ARRIVE = 0x21;
const CP_ST1_PARKED = 0x22;
/** ...and the `op_` paths the car rides on the first two: `0xFD`, `0xFE`. */
const OP_ST1_DRIVE = 0xfd;
const OP_ST1_ARRIVE = 0xfe;
/** `CMP [g_cam_path_frame], 0x104; JG` -- the last frame cp 0x21 rides. */
const CP_ST1_ARRIVE_LAST_RIDDEN = 0x104;
/** `CMP [g_cam_path_frame], 0xC` -- the parked shot's frame the clip changes on. */
const CP_ST1_PARKED_CLIP_FRAME = 0xc;
/** `ActorSetMotionBlended(body, clip, 5, 0)`: the start and the fade. */
const ST1_VEHICLE_PARKED_START = 5;
const ST1_VEHICLE_PARKED_FADE = 0;
/** `PlayerHookStandAtScenePoint`'s two yaws, `0xF8E3` and `0xEE05`. */
const STAND_YAW_FIRST_OF_TWO = 0xf8e3;
const STAND_YAW = 0xee05;
/** `CMP [g_cam_path_frame], 0x29` in `PlayerHookPlayClipAfterCamFrame`. */
const STAND_CLIP_FROM_FRAME = 0x29;

/**
 * `[port-only]` in spelling: `g_motion_play_length[body+0x1B4]`, which the
 * hooks compare the counter with.
 */
function BodyPlayLength(b: PlayerBody): number {
  const m = T.types[String(b.charType)]?.motions[String(b.motion)];
  return m ? (m.play ?? Math.max(1, m.frames * 2 - 2)) : 0;
}

/**
 * `PlayerBodiesCreate` — `FUN_00416450`. One body per player, on the start
 * motion `0x004EC8A4` names, at the allocation's zeroed pose.
 *
 * The type is `g_player_body_char_types[p]` (`0x00579F50`, `T.gameOver`),
 * except in Original Mode when the player's character byte
 * (`g_original_character`, `0x009A2242 + p*0x14`) is not `p` -- a costume
 * from the trunk (`OriginalItemsApply`) -- where it is `0x39 + c` for `c`
 * below 8, `0x21` for 8 and `0x34` for 9, and any other byte leaves the
 * allocation's type. The hand is the skeleton's own bone-5 model. The hit
 * slot (`obj+0x3C = 0xE + p`) and the per-part draw callback at `obj+0x12EC`
 * (`FUN_00416570`, which widens two bones in Original Mode's big-head cheat)
 * are left out: nothing shoots the body, and the cheat is not in the port.
 */
export function PlayerBodiesCreate(): void {
  const go = T.gameOver;
  if (!go) {
    G.g_player_bodies = [];
    return;
  }
  G.g_player_bodies = PLAYER_BODY_AT.map((at, p) => {
    let ct = go.body_char_types[p];
    const c = G.g_original_character[p] ?? p;
    if (G.g_GameMode === GameMode.Original && c !== p) {
      if (c < 8) ct = c + 0x39;
      else if (c === 8) ct = 0x21;
      else if (c === 9) ct = 0x34;
    }
    const hand = T.types[String(ct)]?.bones
      ?.find((b) => b.bone === BODY_HAND_BONE)?.slot ?? 0;
    return {
      at, charType: ct, motion: go.body_start_motions[p], playTicks: 0,
      cursor: 0, fadeOrigin: 0, fadeDiv: 0, fading: 0,
      pos: vec3(), pitch: 0, yaw: 0, roll: 0, handSlot: hand,
      motionFlags: MOTION_FLAGS_INIT, flags: 0, scale: ActorModelScale(ct),
      lastFrame: -1, drawn: 0,
    };
  });
}

/**
 * `[port-only]` in spelling: `ActorSetMotion` (`FUN_00411930`) on a body --
 * the clip, and the counter and the cursor back to 0, no fade. The port's
 * `Actor` has its own, and a body is not one.
 */
export function PlayerBodySetMotion(b: PlayerBody, motion: number): void {
  b.motion = motion;
  b.playTicks = 0;
  b.cursor = 0;
  b.fading = 0;
  b.lastFrame = -1;
}

/**
 * `[port-only]` in spelling: `ActorSetMotionBlended` (`FUN_004119A0`) on a
 * body:
 *
 * ```
 * model[2] = start; model[6] = start / 2; model[10] = model[0] - 1;
 * model[8] = motion; model+0x30 = fade + 1; model+0x37 = (& 0xDF) | 1;
 * ```
 *
 * The counter is **not** touched: it runs on, and the fade measures from it.
 * The fade's own pose blend is the renderer's; the only caller here passes
 * a fade of 0, whose one frame of blend is weighted entirely onto the new
 * clip (`[likely]`: the weight is the counter's distance from `model[10]`
 * over `model+0x30`, which is 1 over 1 on that frame).
 */
export function PlayerBodySetMotionBlended(b: PlayerBody, motion: number,
                                           start: number, fade: number): void {
  b.cursor = start;
  b.fadeOrigin = b.playTicks - 1;
  b.motion = motion;
  b.fadeDiv = fade + 1;
  b.fading = 1;
  // `SkeletonApplyRootMotion` resets the baseline on the fade bit, so the
  // change takes no root step.
  b.lastFrame = -1;
}

/**
 * `PlayerBodySetHandSlot` — `FUN_00416810`. Bone 5's draw slot from
 * `g_player_hand_slots[c * 3 + variant]`, `c` the player -- or, in Original
 * Mode, the character byte when it is not the player.
 */
export function PlayerBodySetHandSlot(player: number, variant: number): void {
  const b = G.g_player_bodies[player];
  if (!b) return;
  let row = player;
  const c = G.g_original_character[player] ?? player;
  if (G.g_GameMode === GameMode.Original && c !== player) row = c;
  const slot = T.chars?.player_hand_slots?.[row * HAND_SLOT_VARIANTS + variant];
  if (slot !== undefined) b.handSlot = slot;
}

/**
 * `GameOverPlaceBody` — `FUN_00415A80`. The body's position is a table point
 * pushed through the gameplay eye's own matrix. `[proved]`:
 *
 * ```
 * 00415aa2  MatrixLoadIdentity()
 * 00415abb  MatrixTranslate(g_camera_eye_x, _y, _z)      ; 0x009C71E0..E8
 * 00415ac6  MatrixRotateZ([0x009c71f4])                  ; roll
 * 00415ad2  MatrixRotateY(g_camera_yaw_bams)             ; 0x009C71F0
 * 00415ade  MatrixRotateX(g_camera_pitch_bams)           ; 0x009C71EC
 * 00415b1d  MatrixTransformPoint((row.x, 0, row.z), &body+0x40)
 * ```
 *
 * On the game-over screen that matrix is the identity: `GameOverRunPhase`
 * zeroes the eye and all three angles in phase 0 (`0x00460A6E..AA0`), and the
 * only other writers are camera hooks the fly-over's scene state (0, 0) does
 * not install. So the point is the position -- here as in the engine, by the
 * same arithmetic.
 */
export function GameOverPlaceBody(player: number): void {
  const b = G.g_player_bodies[player];
  if (!b) return;
  const row = T.gameOver?.body_offsets[player - 2 + G.g_game_over_players * 2]
    ?? [0, 0];
  const m = MatIdentity();
  MatrixTranslate(m, G.g_camera_eye.x, G.g_camera_eye.y, G.g_camera_eye.z);
  MatrixRotateZ(m, G.g_camera_roll_bams);
  MatrixRotateY(m, G.g_camera_yaw_bams);
  MatrixRotateX(m, G.g_camera_pitch_bams);
  MatrixTransformPoint(m, { x: row[0], y: 0, z: row[1] }, b.pos);
}


/**
 * `PlacePlayerEntityFromViewPose` — `FUN_004159A0`, behind the four
 * `PlayerHookPlaceEntity` thunks: the body at `T(g_camera_eye) Rz(roll)
 * Ry(yaw) Rx(pitch) * (x, 0, 0)`, `x` from `0x00579E90[p + g_max_attackers *
 * 2]` -- 0 and 0 for one attacker, -3 and 3 for two -- and the camera's three
 * angles. `[proved]`
 */
export function PlacePlayerEntityFromViewPose(player: number): void {
  const b = G.g_player_bodies[player];
  if (!b) return;
  const x = T.gameOver?.entity_offsets[player + G.g_max_attackers * 2 - 2]
    ?? 0;
  const m = MatIdentity();
  MatrixTranslate(m, G.g_camera_eye.x, G.g_camera_eye.y, G.g_camera_eye.z);
  MatrixRotateZ(m, G.g_camera_roll_bams);
  MatrixRotateY(m, G.g_camera_yaw_bams);
  MatrixRotateX(m, G.g_camera_pitch_bams);
  MatrixTransformPoint(m, { x, y: 0, z: 0 }, b.pos);
  b.pos.x = Math.fround(b.pos.x);
  b.pos.y = Math.fround(b.pos.y);
  b.pos.z = Math.fround(b.pos.z);
  b.pitch = G.g_camera_pitch_bams;
  b.yaw = G.g_camera_yaw_bams;
  b.roll = G.g_camera_roll_bams;
}

/**
 * `PlayerHookEnterSt1Vehicle` — `FUN_00415B60`, `g_player_entity_routines[0]`.
 * Once: the draw bit up, the seated clip -- `0x34A` for player 1 of two,
 * `0x322` for anyone else -- the hand's variant 0, and the ride hook in its
 * own place for the next frame.
 */
export function PlayerHookEnterSt1Vehicle(player: number): void {
  G.g_player_flags[player] |= 1;
  const b = G.g_player_bodies[player];
  if (b) {
    PlayerBodySetMotion(b, G.g_players_in_play === 2 && player !== 0
      ? ST1_VEHICLE_SEATED_CLIP_P2 : ST1_VEHICLE_SEATED_CLIP);
  }
  PlayerBodySetHandSlot(player, ST1_VEHICLE_HAND);
  G.g_player_entity_hook[player] = PlayerEntityHook.RideSt1Vehicle;
}

/**
 * `PlayerHookRideSt1Vehicle` — `FUN_00415BD0`. The body in its seat, on the
 * stage-1 vehicle's own two routes -- the ones `St1VehicleUpdate`
 * (`FUN_0048E600`) rides the car on:
 *
 * ```
 * cp 0x20:                 pose = CamEvalObjectPath6(0xFD, frame)
 * cp 0x21, frame <= 0x104: pose = CamEvalObjectPath6(0xFE, frame); yaw = ry + 0x8000
 * cp 0x21 later, cp 0x22:  x, z, yaw = the body's own
 * a pose:  Push; LoadIdentity; Translate(pos); RotateY(ry);
 *          (x, _, z) = TransformPoint(seat_x[p + players * 2], 0, 0.239); Pop
 * body.x, z, yaw = those; body.y = pitch = roll = 0
 * cp 0x22, frame 0xC:      ActorSetMotionBlended(body, 0x334 | 0x319, 5, 0);
 *                          hook = PlayerHookHoldClipEnd
 * ```
 *
 * Unlike `St1VehicleUpdate` this does not clamp the frame to the route's
 * length. `g_st1_vehicle_seat_x` puts one player at the wheel (-4.6755, the
 * steering column's x in the car's own rig) and two either side of the car's
 * centre line.
 *
 * `[diverges]` **Any other camera path.** The exe's three stores then take
 * three stack slots no arm of the routine wrote this call -- whatever the
 * last call to reach that depth left there -- which the port cannot know; it
 * keeps the body's own x, z and yaw, as the parked arm does. Nothing shipped
 * reaches it: the hook is installed only by stage 1 block 0's
 * `set_update_routine 0`, queued while cp 0x20 is still the active path, and
 * the path changes again only through a `cam_play` of cp 0x21 or 0x22 or a
 * camera starter, and before any starter a scene-state installer writes a
 * `PlaceEntity` hook over this one (`SceneStateInstallPlayerHooks`) -- the
 * script's own `scene_state 3`, or, when a skip steps over that, the
 * `finish_sequence` that ends the block. `test/port/player_body.test.ts`
 * pins the arm.
 */
export function PlayerHookRideSt1Vehicle(player: number): void {
  const b = G.g_player_bodies[player];
  if (!b) return;
  const cp = G.g_active_cam_path;
  const frame = G.g_cam_path_frame;
  let x = b.pos.x;
  let z = b.pos.z;
  let yaw = b.yaw;
  if (cp === CP_ST1_DRIVE
      || (cp === CP_ST1_ARRIVE && frame <= CP_ST1_ARRIVE_LAST_RIDDEN)) {
    const at = PropEvalObjectPath6(cp === CP_ST1_DRIVE
      ? OP_ST1_DRIVE : OP_ST1_ARRIVE, frame);
    if (at) {
      const m = MatIdentity();
      MatrixTranslate(m, at.x, at.y, at.z);
      MatrixRotateY(m, at.ry);
      const seat = T.gameOver?.seat_x[player + G.g_players_in_play * 2] ?? 0;
      const out = vec3();
      MatrixTransformPoint(m, { x: seat, y: 0, z: ST1_VEHICLE_SEAT_Z }, out);
      x = Math.fround(out.x);
      z = Math.fround(out.z);
      yaw = cp === CP_ST1_DRIVE ? at.ry : at.ry + 0x8000;
    }
  }
  b.pos.z = z;
  b.pos.x = x;
  b.pos.y = 0;
  b.pitch = 0;
  b.roll = 0;
  b.yaw = yaw;
  if (cp === CP_ST1_PARKED && frame === CP_ST1_PARKED_CLIP_FRAME) {
    PlayerBodySetMotionBlended(b, G.g_players_in_play === 2 && player !== 0
      ? ST1_VEHICLE_PARKED_CLIP_P2 : ST1_VEHICLE_PARKED_CLIP,
      ST1_VEHICLE_PARKED_START, ST1_VEHICLE_PARKED_FADE);
    G.g_player_entity_hook[player] = PlayerEntityHook.HoldClipEnd;
  }
}

/**
 * `PlayerHookHoldClipEnd` — `FUN_00415E00`. A counter on the clip's last
 * frame goes back one; `PlayerHookDrawBody` steps it forward again, so the
 * body holds on its end.
 */
export function PlayerHookHoldClipEnd(player: number): void {
  const b = G.g_player_bodies[player];
  if (!b) return;
  const len = BodyPlayLength(b);
  if (b.playTicks === len - 1) b.playTicks = len - 2;
}

/**
 * `PlayerHookStandAtScenePoint` — `FUN_00415E40`,
 * `g_player_entity_routines[1]`. Once: the body at
 * `g_player_stand_points[p - 2 + players * 2]`, pitch and roll 0, the draw
 * bit up, the clip `g_player_stand_motions[p + players * 2]` with no fade and
 * the hand's variant 1 -- and by whether this is player 0 of two, the yaw and
 * the successor: `0xF8E3` and `PlayerHookHoldClipStart`, or `0xEE05` and
 * `PlayerHookPlayClipAfterCamFrame`.
 */
export function PlayerHookStandAtScenePoint(player: number): void {
  const b = G.g_player_bodies[player];
  const n = G.g_players_in_play;
  const at = T.gameOver?.stand_points[player - 2 + n * 2];
  const clip = T.gameOver?.stand_motions[player + n * 2];
  if (b) {
    if (at) {
      b.pos.x = at[0];
      b.pos.y = at[1];
      b.pos.z = at[2];
    }
    b.pitch = 0;
    b.roll = 0;
  }
  G.g_player_flags[player] |= 1;
  const firstOfTwo = n === 2 && player === 0;
  if (b) {
    b.yaw = firstOfTwo ? STAND_YAW_FIRST_OF_TWO : STAND_YAW;
    if (clip !== undefined) PlayerBodySetMotion(b, clip);
  }
  G.g_player_entity_hook[player] = firstOfTwo
    ? PlayerEntityHook.HoldClipStart : PlayerEntityHook.PlayClipAfterCamFrame;
  PlayerBodySetHandSlot(player, STAND_HAND);
}

/** `PlayerHookHoldClipStart` — `FUN_00415F60`: the counter back to 0. */
export function PlayerHookHoldClipStart(player: number): void {
  const b = G.g_player_bodies[player];
  if (b) b.playTicks = 0;
}

/**
 * `PlayerHookPlayClipAfterCamFrame` — `FUN_00415F90`. The counter is held
 * at 0 until the camera's path frame reaches 0x29; then the clip plays once
 * and holds a frame short of its end.
 */
export function PlayerHookPlayClipAfterCamFrame(player: number): void {
  const b = G.g_player_bodies[player];
  if (!b) return;
  if (G.g_cam_path_frame < STAND_CLIP_FROM_FRAME) b.playTicks = 0;
  const len = BodyPlayLength(b);
  if (len - 1 <= b.playTicks) b.playTicks = len - 2;
}

/**
 * `[port-only]` in spelling: the indirect call through `g_player_entity_hook`
 * at the head of `PlayerUpdateInPlay` (`0x00413EA9`..). The four thunks
 * `PlayerHookPlaceEntityA` to `D`, at `0x00415960`..`0x00415990`, are each
 * one call to `PlacePlayerEntityFromViewPose`.
 */
export function PlayerRunEntityHook(player: number): void {
  switch (G.g_player_entity_hook[player]) {
    case PlayerEntityHook.PlaceEntityA:
    case PlayerEntityHook.PlaceEntityB:
    case PlayerEntityHook.PlaceEntityC:
    case PlayerEntityHook.PlaceEntityD:
      PlacePlayerEntityFromViewPose(player);
      return;
    case PlayerEntityHook.EnterSt1Vehicle:
      PlayerHookEnterSt1Vehicle(player);
      return;
    case PlayerEntityHook.RideSt1Vehicle:
      PlayerHookRideSt1Vehicle(player);
      return;
    case PlayerEntityHook.HoldClipEnd:
      PlayerHookHoldClipEnd(player);
      return;
    case PlayerEntityHook.StandAtScenePoint:
      PlayerHookStandAtScenePoint(player);
      return;
    case PlayerEntityHook.HoldClipStart:
      PlayerHookHoldClipStart(player);
      return;
    case PlayerEntityHook.PlayClipAfterCamFrame:
      PlayerHookPlayClipAfterCamFrame(player);
      return;
    case PlayerEntityHook.None:
      return;
  }
}

/**
 * `PlayerHookDrawBody` — `FUN_00415120`, the `+0x7C` hook under the follow
 * and no-op cameras. The body is drawn only while `g_player_flags` bit 0 is
 * up; its counter is stepped every frame regardless. The draw is bracketed
 * by `LightsUseSecondarySet` and `LightsRestoreScene`, which are the
 * renderer's.
 */
export function PlayerHookDrawBody(player: number): void {
  const b = G.g_player_bodies[player];
  if (!b) return;
  if ((G.g_player_flags[player] & 1) !== 0) PlayerBodyDraw(b);
  b.playTicks += 1;
}

/**
 * `PlayerHookDrawBodyUntilMotionEnd` — `FUN_004151D0`. In app state 7: draw
 * the body, and either hand the hook over to `PlayerHookSetCurActor` -- which
 * draws nothing, so the body is gone from the next frame on -- once the
 * counter is on the clip's last frame, or step it once the fly-over's path
 * frame has reached the body's cue. Outside app state 7 it only names the
 * current actor, which the port does not keep.
 *
 * ```
 * if (g_app_state != 7) return;
 * DrawSkinnedModelAndShadow(body);         // push, walk, pop, shadow
 * if (counter == g_motion_play_length[motion] - 1) { hook = SetCurActor; return; }
 * if (g_game_over_players == 2) { if (0x004EC8C4[p] <= g_cam_path_frame) counter++; }
 * else if (0x3B < g_cam_path_frame) counter++;
 * ```
 *
 * `DrawSkinnedModelAndShadow` (`FUN_00411090`) is `MatrixStackPush`,
 * `SkeletonDrawWalk`, `MatrixStackPop` -- and then `ActorDrawShadow`
 * (`FUN_0040A590`) on **`g_cur_actor`**, past the `MatrixStackPop` Ghidra
 * marks no-return (`L35`). This routine stores the body there itself before
 * the draw -- `MOV [0x009a26a0], EAX` at `0x004151F5`, `EAX` the body loaded
 * from `0x009A5CD8 + p*0x130` -- so the shadow is the body's. `[proved]`
 */
export function PlayerHookDrawBodyUntilMotionEnd(player: number): void {
  const b = G.g_player_bodies[player];
  if (!b || G.g_app_state !== AppState.GameOver) return;
  PlayerBodyDraw(b);
  if (b.playTicks === BodyPlayLength(b) - 1) {
    G.g_player_camera_hook[player] = PlayerCameraHook.SetCurActor;
    return;
  }
  if (G.g_game_over_players === 2) {
    if ((T.gameOver?.fall_frames[player] ?? 0) <= G.g_cam_path_frame) {
      b.playTicks += 1;
    }
  } else if (ONE_PLAYER_FALL_AFTER < G.g_cam_path_frame) {
    b.playTicks += 1;
  }
}

/**
 * `PlayerRunCameraHook` — `FUN_00415100`. One indirect call through
 * `g_player_camera_hook`. `PlayerHookSetCurActor` (`FUN_004151B0`) only names
 * the current actor, which the port does not keep.
 */
export function PlayerRunCameraHook(player: number, events?: Events): void {
  switch (G.g_player_camera_hook[player]) {
    case PlayerCameraHook.SpawnDamageOverlay:
      PlayerHookSpawnDamageOverlay(player, events);
      return;
    case PlayerCameraHook.DrawBody:
      PlayerHookDrawBody(player);
      return;
    case PlayerCameraHook.DrawBodyUntilMotionEnd:
      PlayerHookDrawBodyUntilMotionEnd(player);
      return;
    case PlayerCameraHook.SetCurActor:
    case PlayerCameraHook.None:
      return;
  }
}

/**
 * The draw's engine half: `SkeletonAdvancePlayCursor` (`FUN_004111A0`)'s
 * clock, then the root delta `SkeletonApplyRootMotion` (`FUN_00410C50`) takes
 * from inside `SkeletonDrawWalk`, then the flag the renderer draws by.
 *
 * The clock: while a fade is up the cursor holds on the start
 * `ActorSetMotionBlended` wrote, until `counter - model[10]` reaches
 * `model+0x30 + 1`, where the counter is rewritten to `cursor + 1` and the
 * fade drops (a counter outside `0..model+0x30 + 1` of the origin drops it
 * at once). Without one, `cursor = counter % (play_length + 1)`.
 *
 * With `model+0x64` bit 1 up -- and `ActorBuildSkinnedModel` leaves it up --
 * the clip's horizontal root moves the body and the pose keeps only its
 * height.
 */
function PlayerBodyDraw(b: PlayerBody): void {
  if (b.fading !== 0) {
    const d = b.playTicks - b.fadeOrigin;
    const end = b.fadeDiv + 1;
    if (d === end) b.playTicks = b.cursor + 1;
    if (d === end || d < 0 || d > end) b.fading = 0;
  }
  const m = T.types[String(b.charType)]?.motions[String(b.motion)];
  if (m && m.frames > 0) {
    const play = m.play ?? Math.max(1, m.frames * 2 - 2);
    if (b.fading === 0) b.cursor = b.playTicks % (play + 1);
    const f = b.cursor;
    if ((b.motionFlags & MotionFlag.RootMotion) !== 0) {
      const d = rootDelta(m, play, b.lastFrame, f);
      if (d.x !== 0 || d.z !== 0) {
        const a = b.yaw * ((Math.PI * 2) / 65536);
        const s = Math.sin(a);
        const c = Math.cos(a);
        const dx = d.x * b.scale;
        const dz = d.z * b.scale;
        b.pos.x += dx * c + dz * s;
        b.pos.z += dz * c - dx * s;
      }
    }
    b.lastFrame = f;
  }
  b.drawn = 1;
  // `DrawSkinnedModelAndShadow`'s last call, `ActorDrawShadow(g_cur_actor)`:
  // both hooks that draw the body point `g_cur_actor` at it first
  // (`0x0041514B`, `0x004151F5`), so the shadow is the body's own.
  ActorDrawShadow(b);
}

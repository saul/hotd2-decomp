/**
 * Class 0x23's entrances — `Class23Subtype0Entrance` (`FUN_0048FEB0`, stage 1)
 * and `Class23Subtype1Entrance` (`FUN_00490D00`, stage 5).
 *
 * Both are keyed to the camera: the walker is not drawn at all until the
 * camera's path reaches its cue, then lands (stage 1) or stands (stage 5),
 * and in both it waits for the flier to reach its phase 1 -- the flier's
 * relative state 1 -- before it starts fighting.
 */
import type { JudgmentCompanionActor } from "../actor";
import { ActorSetMotion, ActorSetMotionBlended } from "../class30/motion_cue";
import { GameMode } from "../game_mode";
import { ActorByAt, G } from "../globals";
import type { ClassFrame } from "../registry";
import { CAM_PATH_LENGTH } from "../class22/records";
import { Class22PlaySound } from "../class22/shot";
import { MotionPlayLength } from "../tables";
import { CLASS23_FIRST_CLIP } from "./records";
import { Class23DrawAndStep, SND_GROAN } from "./fight";
import { Class23Subtype } from "./state";

/** Stage 1's walker, before and after the landing. */
const STAGE1_LAND_AT = { x: -1061.0, z: -476.0 };
const STAGE1_STAND_AT = { x: Math.fround(-1042.8), z: Math.fround(-475.7) };
/** Stage 5's: `(584.0, -70.9, -1170.0)`, yaw `0x8000`. */
const STAGE5_STAND_AT = { x: 584.0, y: Math.fround(-70.9), z: -1170.0 };
/** `0xC6DD` — stage 1's facing, the flier's own. */
const STAGE1_YAW = 0xc6dd;
const STAGE5_YAW = 0x8000;
/** `cp_st1` path `0x2F`; the frame the walker appears on (`0x203`) and leaps (`> 600`). */
const CAM_ST1_FIGHT = 0x2f;
const STAGE1_APPEAR_FRAME = 0x203;
const STAGE1_LEAP_AFTER = 600;
/** `cp_st5` path `0xCE`; the frame the walker appears on (`0xB4`). */
const CAM_ST5_FIGHT = 0xce;
const STAGE5_APPEAR_FRAME = 0xb4;
/** The landing: clip `0x386`, its axe at cursor `0x32`, the impact at `0x46`. */
const CLIP_LEAP = 0x386;
const LEAP_AXE_CURSOR = 0x32;
const LEAP_IMPACT_CURSOR = 0x46;
/** `len - 0x19` — the cursor the landing hands over to the back-off on. */
const LEAP_END_FROM_LENGTH = 0x19;
const CLIP_BACK_OFF = 0x38e;
/** `0x30` — the landing's screen shake. */
const SHAKE_LANDING = 0x30;
/** `DOORKICK3_22K` and `GRASS1_22` — the landing's two sounds. */
const SND_LAND_A = 0x2316a9;
const SND_LAND_B = 0x2b16a9;
/** The axe sound, `STAGE1_SE\AXE_44K` / stage 5's. */
const SND_AXE: Readonly<Record<number, number>> = {
  [Class23Subtype.Stage1]: 0x18a9, [Class23Subtype.Stage5]: 0x2423a9,
};
/** Stage 5's hold: the groan on counter 700, the idle on the back-off's cursor `0x75`. */
const STAGE5_GROAN_FRAME = 700;
const STAGE5_BACK_OFF_END = 0x75;
/** `pos.x - 50.0` (`0x0055D2AC`) — `+0x13C0` when the fight starts. `[open]` who reads it. */
const POINT_X_OFFSET = 50.0;
/** The flier's relative state the walker waits for: phase 1. */
const FLIER_PHASE1 = 1;

/**
 * `Class23LandingRingUpdate` (`FUN_00491700`)'s object, allocated at the
 * landing: a ring model (`boss1q.bin`[94], slot `0x17C8`) that spreads and
 * fades over `0x50` frames along the curve of `op_st1` path `0x147`.
 * `[port-only]` as a record on the actor: the ring has no gameplay reader,
 * and the renderer draws it from here (`render/characters/judgment.ts`).
 */
function Class23SpawnLandingRing(obj: JudgmentCompanionActor): void {
  obj.companion.ring = {
    x: obj.pos.x, y: obj.pos.y, z: obj.pos.z, yaw: 0, frame: 1,
    scale: { x: 0, y: 0, z: 0 }, fade: 0, drawn: false, killed: false,
  };
}

/** The shared end of both entrances: into the fight once the flier fights. */
function Class23WaitForFlier(obj: JudgmentCompanionActor): void {
  const flier = ActorByAt(obj.companion.companionAt);
  if (flier && flier.state === FLIER_PHASE1) {
    obj.companion.point.x = Math.fround(obj.pos.x - POINT_X_OFFSET);
    obj.companion.point.y = obj.pos.y;
    obj.state += 1;
    obj.companion.point.z = obj.pos.z;
    obj.sub = 0;
  }
}

/**
 * `Class23Subtype0Entrance` — `FUN_0048FEB0`. `g_class23_states_subtype0[0]`.
 *
 * Undrawn until `cp_st1` path `0x2F` passes frame `0x203`; seated at the
 * arena's edge; the leap on frame 601; its axe, its landing (a ring, a
 * screen shake, two sounds) and its back-off; then, on the camera's integer
 * frame `g_cam_path_length[0x2F]` (830), stood beside the flier.
 */
export function Class23Subtype0Entrance(obj: JudgmentCompanionActor,
                                        f: ClassFrame): void {
  const t = obj.companion;
  // Sub 0, which falls into sub 1 unless it returns.
  if (obj.sub === 0) {
    if (G.g_GameMode === GameMode.Boss) {
      ActorSetMotion(obj, CLASS23_FIRST_CLIP);
      obj.pos.x = STAGE1_STAND_AT.x;
      obj.pos.y = G.g_camera_fixed_eye_y;
      obj.pos.z = STAGE1_STAND_AT.z;
      obj.yaw = STAGE1_YAW;
      obj.roll = 0;
      obj.pitch = 0;
      obj.sub = 4;
      Class23DrawAndStep(obj, f);
      return;
    }
    // Undrawn, and so not advanced, until the camera's cue.
    if (G.g_active_cam_path === CAM_ST1_FIGHT
        && G.g_cam_path_frame < STAGE1_APPEAR_FRAME) return;
    obj.pos.x = STAGE1_LAND_AT.x;
    obj.pos.y = G.g_camera_fixed_eye_y;
    obj.pos.z = STAGE1_LAND_AT.z;
    obj.yaw = STAGE1_YAW;
    obj.roll = 0;
    obj.pitch = 0;
    obj.sub += 1;
  }
  switch (obj.sub) {
    case 1:
      if (G.g_active_cam_path === CAM_ST1_FIGHT
          && STAGE1_LEAP_AFTER < G.g_cam_path_frame) {
        ActorSetMotionBlended(obj, CLIP_LEAP, 0, 2);
        obj.sub += 1;
        Class23DrawAndStep(obj, f);
        return;
      }
      break;
    case 2: {
      if (t.cursor === LEAP_AXE_CURSOR) {
        const id = SND_AXE[t.subtype];
        if (id !== undefined) Class22PlaySound(f, id);
      }
      if (t.cursor === LEAP_IMPACT_CURSOR) {
        Class23SpawnLandingRing(obj);
        G.g_screen_shake_frames = SHAKE_LANDING;
        Class22PlaySound(f, SND_LAND_A);
        Class22PlaySound(f, SND_LAND_B);
      }
      if (t.cursor === MotionPlayLength(obj) - LEAP_END_FROM_LENGTH) {
        ActorSetMotionBlended(obj, CLIP_BACK_OFF, 0, 5);
        Class22PlaySound(f, SND_GROAN);
        obj.sub += 1;
        Class23DrawAndStep(obj, f);
        return;
      }
      break;
    }
    case 3:
      if (G.g_active_cam_path === CAM_ST1_FIGHT
          && G.g_cam_path_frame === CAM_PATH_LENGTH[CAM_ST1_FIGHT]) {
        ActorSetMotion(obj, CLASS23_FIRST_CLIP);
        obj.pos.x = STAGE1_STAND_AT.x;
        obj.pos.z = STAGE1_STAND_AT.z;
        obj.pos.y = G.g_camera_fixed_eye_y;
        obj.sub += 1;
        Class23DrawAndStep(obj, f);
        return;
      }
      break;
    case 4:
      Class23WaitForFlier(obj);
      break;
    default:
      break;
  }
  Class23DrawAndStep(obj, f);
}

/**
 * `Class23Subtype1Entrance` — `FUN_00490D00`. `g_class23_states_subtype1[0]`.
 *
 * Undrawn until `cp_st5` path `0xCE` passes frame `0xB4`; stood at
 * `(584, -70.9, -1170)` facing `0x8000`; on the camera's integer frame
 * `g_cam_path_length[0xCE]` (445) a counted wait, the back-off clip on count
 * 700 and the idle when it ends; then the same wait for the flier.
 */
export function Class23Subtype1Entrance(obj: JudgmentCompanionActor,
                                        f: ClassFrame): void {
  const t = obj.companion;
  // Sub 0, which falls into sub 1 unless it returns undrawn.
  if (obj.sub === 0) {
    if (G.g_active_cam_path === CAM_ST5_FIGHT
        && G.g_cam_path_frame < STAGE5_APPEAR_FRAME) return;
    obj.pos.x = STAGE5_STAND_AT.x;
    obj.pos.y = STAGE5_STAND_AT.y;
    obj.pos.z = STAGE5_STAND_AT.z;
    obj.yaw = STAGE5_YAW;
    obj.roll = 0;
    obj.pitch = 0;
    obj.sub += 1;
  }
  switch (obj.sub) {
    case 1:
      if (G.g_cam_path_frame === CAM_PATH_LENGTH[CAM_ST5_FIGHT]) {
        obj.sub += 1;
        t.counter = 0;
        Class23DrawAndStep(obj, f);
        return;
      }
      break;
    case 2:
      t.counter += 1;
      if (t.counter === STAGE5_GROAN_FRAME) {
        ActorSetMotionBlended(obj, CLIP_BACK_OFF, 0, 2);
        Class22PlaySound(f, SND_GROAN);
      }
      if (obj.motion === CLIP_BACK_OFF && t.cursor === STAGE5_BACK_OFF_END) {
        ActorSetMotionBlended(obj, CLASS23_FIRST_CLIP, 0, 10);
        obj.sub += 1;
        Class23DrawAndStep(obj, f);
        return;
      }
      break;
    case 3:
      Class23WaitForFlier(obj);
      break;
    default:
      break;
  }
  Class23DrawAndStep(obj, f);
}


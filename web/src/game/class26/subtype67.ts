/**
 * Class 0x26 subtypes 6 and 7 — stage 6 block 12's pair.
 *
 * Two spawns in the game, both at block 12 step 1 op 57 (descriptors
 * `0x46A8`, subtype 6, and `0x46CC`, subtype 7; none of the three routines
 * reads a descriptor tail),
 * which `Class26InstallSubtypeUpdate` (`FUN_0048E290`) hands to the routine at
 * `0x0048F930` and installs. Three routines, read whole from the disassembly
 * (`L89`: the listing Ghidra shows across `0x0048FBA8`..`0x0048FBB8` is
 * misaligned, and the bytes are what is transcribed):
 *
 * * **the update**, which picks a pose off object path `0x183` (subtype 6) or
 *   `0x184` (subtype 7) by the camera path that is playing, and hands the
 *   frame to one of the other two -- installing it, on two of its arms;
 * * **the draw**: subtype 6 is three models at its point until camera path
 *   `0xDF` frame `0x578` and one model after it, plus a second copy of that
 *   model sliding along z from frame `0x56E`; subtype 7 is one model at its
 *   point and one at a fixed point, which changes model on script flag
 *   `0x31`;
 * * **the draw-or-kill**: one model each, until camera path `0xEC` kills the
 *   object.
 *
 * Both object paths hold a point at frame 1310 and rise 236 units between
 * frames 1330 and 1610 (`op_st6` 1 and 2); both are 1630 frames long.
 *
 * ## What the draws are
 *
 * Every model these routines draw was on screen before this file existed
 * only because `render/stagescene.ts` drew every model the script loaded
 * with opcode `0x50` and no region listed, at the model's own origin (`L54`)
 * -- which for these seven is wherever their authors built them, and for
 * `common.bin[135]` was nowhere, since the script never loads it. The draws
 * are recorded where the routine makes them ({@link Class26DrawCall}) and
 * `render/slotmodels.ts` draws what is recorded.
 *
 * No routine here registers for the shot test, raises a collision bit or
 * counts anything. They are drawn and nothing else.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import { MatIdentity, MatrixScale, MatrixTranslate, type Mat } from "../matrix";
import type { ClassFrame } from "../registry";
import { SpawnClass } from "../spawn_class";
import {
  CLASS26_SUB6_LIGHT, CLASS26_SUB6_SLOT, CLASS26_SUB6_SLOT_BESIDE,
  CLASS26_SUB6_SLOT_LATCHED, CLASS26_SUB6_SLOT_LIT, CLASS26_SUB7_FIXED_SLOT,
  CLASS26_SUB7_FIXED_SLOT_FLAGGED, CLASS26_SUB7_SLOT, Class26Routine,
  Class26Subtype, type VehicleTail,
} from "./state";

/**
 * `g_class26_path_by_selector` — `0x005703B4`. The object path each selector
 * rides, indexed by `obj+0x11C - 6` (`SUB AX, 0x6` at `0x0048F945`; `MOVSX
 * EAX, word ptr [EDX*2 + 0x5703B4]`).
 *
 * Two `s16`, because the installer calls the update for subtypes 6 and 7
 * alone, so the index is 0 or 1 and nothing reads a third word. `[proved]`
 * from `read_memory`: `83 01 84 01`.
 */
export const g_class26_path_by_selector: readonly number[] = [0x183, 0x184];

/** `SUB AX, 0x6` at `0x0048F945`: the selector is the subtype less six. */
const SUBTYPE67_FIRST = 6;

/**
 * `g_cam_path_length` (`0x00576D38`) at the two paths the table names:
 * `[0x00577344]` and `[0x00577348]`, both `0x65E`, read from the image. The
 * update clamps with it -- `n = min(frame, length)` at `0x0048FA58` -- which on
 * these paths never binds before the arm that reads it is left at `0x629`.
 */
export const SUBTYPE67_PATH_LENGTH: Readonly<Record<number, number>> = {
  0x183: 0x65e, 0x184: 0x65e,
};

/** `PUSH 0x44A3C000` — 1310.0, the frame the update holds the pose at. */
export const SUBTYPE67_HOLD_FRAME = 1310.0;
/** `FADD double ptr [0x004C4C98]` — 0.5, over the held pose's y. */
export const SUBTYPE67_HOLD_LIFT = 0.5;
/**
 * `MOV dword ptr [ESI + 0x44], 0x452DD19A` at `0x0048F96D` and `0x0048FA12`,
 * and `PUSH 0x452DD19A` at `0x0048FCD3`: 2781.1, as the f32 it is.
 */
export const SUBTYPE67_TOP_Y = Math.fround(2781.1);
/** `MOV dword ptr [ESI + 0x44], 0x452E619A` at `0x0048FAD8`: 2790.1. */
export const SUBTYPE67_PATH_E9_Y = Math.fround(2790.1);

/**
 * The camera paths the update switches on: `ADD ECX, -0xDD; CMP ECX, 0xE; JA`
 * at `0x0048F982`, then the byte map at `0x0048FB24` -- `00 03 01 03 03 03 03
 * 03 03 03 03 03 02 02 02` -- into the four targets at `0x0048FB14`. So `0xDD`
 * and `0xDF` have arms, `0xE9`..`0xEB` share one, and `0xDE`, `0xE0`..`0xE8`
 * and everything outside the range only draw. `0xEC` is the draw-or-kill's.
 */
export const SUBTYPE67_CAM_HOLD = 0xdd;
export const SUBTYPE67_CAM_RIDE = 0xdf;
export const SUBTYPE67_CAM_E9 = 0xe9;
export const SUBTYPE67_CAM_EB = 0xeb;
export const SUBTYPE67_CAM_KILL = 0xec;

/** `CMP ECX, 0x51E; JGE` at `0x0048F9A6`: below it, path `0xDF` holds. */
export const SUBTYPE67_RIDE_FROM = 0x51e;
/** `CMP ECX, 0x578; JL` at `0x0048FA30`: `obj+0x1320 = 1` from here on. */
export const SUBTYPE67_ONE_MODEL_FROM = 0x578;
/** `CMP ECX, 0x629; JL` at `0x0048FA0A`: the ride ends and the draw installs. */
export const SUBTYPE67_RIDE_UNTIL = 0x629;
/**
 * `CMP dword ptr [0x009A6110], 0x56E; JL` at `0x0048FC97`, and `ADD ECX,
 * 0xFFFFFA92` at `0x0048FCB3`: subtype 6's second copy, from this frame.
 */
export const SUBTYPE67_SECOND_COPY_FROM = 0x56e;
/** `FMUL float ptr [0x004C43AC]` — 0.5 along z a frame. */
export const SUBTYPE67_SECOND_COPY_STEP = 0.5;
/** `FADD float ptr [0x0055D2AC]` — 50.0 ahead of the object's own z. */
export const SUBTYPE67_SECOND_COPY_AHEAD = 50.0;

/** `PUSH 0x0; PUSH 0x0; PUSH 0x43190000` — T(153, 0, 0) at `0x0048FC14`. */
const SUB6_BESIDE_X = 153.0;
/**
 * `PUSH 0xBF4EBEE0; PUSH 0x4105460B; PUSH 0xC10B70A4` at `0x0048FC2C` —
 * T(-8.715, 8.3296, -0.8076), as f32s.
 */
const SUB6_LIT_AT: readonly [number, number, number] =
  [Math.fround(-8.715), Math.fround(8.3296), Math.fround(-0.8076)];
/**
 * `PUSH 0x422DA8F6; PUSH 0x3EDA9FBE; PUSH 0x3DCCCCCD` at `0x0048FC40` —
 * `MatrixScale(0.1, 0.427, 43.415)`, as f32s. The `NoOpStub(43.415)` after it
 * (`0x0048FC59`) is the empty stub and draws nothing.
 */
const SUB6_LIT_SCALE: readonly [number, number, number] =
  [Math.fround(0.1), Math.fround(0.427), Math.fround(43.415)];
/**
 * `PUSH 0xC61A405C; PUSH EAX; PUSH 0x443C3805` at `0x0048FB8F` — subtype 7's
 * fixed point, `(752.8753, obj+0x44, -9872.09)`: its own y, a literal x and z.
 */
const SUB7_FIXED_X = Math.fround(752.8753);
const SUB7_FIXED_Z = Math.fround(-9872.09);
/**
 * `MOV AL, [0x009C7231]` at `0x0048FB9F` — `g_script_flags[0x31]`, which
 * block 12 step 1 op 161 raises. While it is 0 subtype 7 draws
 * {@link CLASS26_SUB7_FIXED_SLOT}.
 */
export const SUB7_SWAP_FLAG = 0x31;

/** `[port-only]` The class-0x26 arm of an actor, or null. */
export function VehicleTailOf(obj: Actor): VehicleTail | null {
  return obj.cls === SpawnClass.Vehicle
    ? (obj as { vehicle: VehicleTail }).vehicle : null;
}

/**
 * `AssetDrawSlot` (`FUN_00418560`) under `m`, recorded rather than made.
 * `[port-only]` as a function; see {@link Class26DrawCall}.
 */
function Class26DrawSlot(v: VehicleTail, m: Mat, slot: number,
                         light?: readonly [number, number, number]): void {
  v.draws.push(light
    ? { slot, m: m.slice(0, 16), light: [light[0], light[1], light[2]] }
    : { slot, m: m.slice(0, 16) });
}

/**
 * `ActorKill` (`FUN_004A7040`) — the task unlinks itself and longjmps out of
 * the walk, so nothing after the call runs. The port's pool removal is
 * `despawned`; `[port-only]` as a function. No hit slot is given back, as
 * `ActorDespawn` would: these objects never claim one.
 */
function Class26Kill(obj: Actor): void {
  obj.despawned = true;
  obj.visible = false;
}

/** `CamEvalObjectPath6` (`FUN_004042D0`) into `obj+0x40`..`+0x6C`, whole. */
type PathPose = { x: number; y: number; z: number;
                  pitch?: number; yaw?: number; roll?: number };

/** `+0x64`, `+0x68`, `+0x6C` — the three angles, as every arm stores them. */
function StoreAngles(obj: Actor, p: PathPose): void {
  obj.pitch = p.pitch ?? obj.pitch;
  obj.yaw = p.yaw ?? obj.yaw;
  obj.roll = p.roll ?? obj.roll;
}

/**
 * `Class26Subtype67Update` — `FUN_0048F930`. What `Class26InstallSubtypeUpdate`
 * runs once and installs for subtypes 6 and 7.
 *
 * ```c
 * path = g_class26_path_by_selector[obj+0x11C - 6];
 * if (g_GameMode == 3) {                                       // Boss Mode
 *     p = CamEvalObjectPath6(path, 1310.0);
 *     obj+0x44 = 2781.1; obj+0x40 = p.x; obj+0x48 = p.z; angles = p.r;
 *     Class26Subtype67DrawOrKill(obj); obj+0x00 = Class26Subtype67DrawOrKill;
 *     return;
 * }
 * switch (g_active_cam_path) {
 * case 0xDF:
 *     if (frame >= 0x51E) {
 *         if (frame >= 0x629) {
 *             obj+0x44 = 2781.1; obj+0x00 = Class26Subtype67Draw;
 *             Class26Subtype67Draw(obj); return;
 *         }
 *         if (frame >= 0x578) obj+0x1320 = 1;
 *         if (path != 0) {
 *             p = CamEvalObjectPath6(path, min(frame, g_cam_path_length[path]));
 *             obj+0x40..0x48 = p.xyz; angles = p.r;
 *         }
 *         Class26Subtype67Draw(obj); return;
 *     }
 *     // below 0x51E: 0xDD's arm
 * case 0xDD:
 *     p = CamEvalObjectPath6(path, 1310.0);
 *     obj+0x40 = p.x; obj+0x44 = p.y + 0.5; obj+0x48 = p.z; angles = p.r;
 *     Class26Subtype67Draw(obj); return;
 * case 0xE9: case 0xEA: case 0xEB:
 *     p = CamEvalObjectPath6(path, 1310.0);
 *     obj+0x44 = 2790.1; obj+0x40 = p.x; obj+0x48 = p.z; angles = p.r;
 *     Class26Subtype67DrawOrKill(obj); obj+0x00 = Class26Subtype67DrawOrKill;
 *     return;
 * default:
 *     Class26Subtype67Draw(obj);
 * }
 * ```
 *
 * `[proved]` from `0x0048F930`..`0x0048FB11` and the switch tables at
 * `0x0048FB14`/`0x0048FB24`. Three things the pseudocode states and it is
 * easy to read past:
 *
 * * **The held pose is lifted and the ridden one is not.** `0xDD`'s arm is
 *   `FLD [y]; FADD double 0.5; FSTP [ESI+0x44]` (`0x0048F9C9`..`0x0048F9F0`);
 *   the ride's arm stores the evaluator's y as it stands (`0x0048FA91`).
 * * **The ride's end touches only y.** At `0x629` the arm writes `+0x44` and
 *   installs the draw; x, z and the angles keep whatever the last ridden
 *   frame left.
 * * **The installer stores over whatever this installed.** It calls the
 *   routine and *then* writes itself back into `obj+0x00` (`CALL 0x0048F930;
 *   MOV dword ptr [ESI], 0x48F930` at `0x0048E319`), so on the first frame an
 *   arm that installs another routine is undone, and the next frame runs this
 *   one again -- see `Class26InstallSubtypeUpdate`.
 */
export function Class26Subtype67Update(obj: Actor, f: ClassFrame): void {
  const v = VehicleTailOf(obj);
  if (!v) return;
  const path = g_class26_path_by_selector[obj.hp - SUBTYPE67_FIRST];
  if (G.g_GameMode === GameMode.Boss) {
    const p = f.host.objectPath?.(path, SUBTYPE67_HOLD_FRAME);
    obj.pos.y = SUBTYPE67_TOP_Y;
    if (p) {
      obj.pos.x = p.x;
      obj.pos.z = p.z;
      StoreAngles(obj, p);
    }
    Class26Subtype67DrawOrKill(obj);
    v.routine = Class26Routine.Subtype67DrawOrKill;
    return;
  }
  const frame = G.g_cam_path_frame;
  const cam = G.g_active_cam_path;
  if (cam === SUBTYPE67_CAM_RIDE && frame >= SUBTYPE67_RIDE_FROM) {
    if (frame >= SUBTYPE67_RIDE_UNTIL) {
      obj.pos.y = SUBTYPE67_TOP_Y;
      v.routine = Class26Routine.Subtype67Draw;
      Class26Subtype67Draw(obj);
      return;
    }
    if (frame >= SUBTYPE67_ONE_MODEL_FROM) v.drawsOneModel = 1;
    if (path !== 0) {
      // `CMP ECX, EDX; JG` at `0x0048FA5F`: the frame, or the length when the
      // frame is past it.
      const len = SUBTYPE67_PATH_LENGTH[path] ?? frame;
      const n = frame > len ? len : frame;
      const p = f.host.objectPath?.(path, n);
      if (p) {
        obj.pos.x = p.x;
        obj.pos.y = p.y;
        obj.pos.z = p.z;
        StoreAngles(obj, p);
      }
    }
    Class26Subtype67Draw(obj);
    return;
  }
  if (cam === SUBTYPE67_CAM_HOLD || cam === SUBTYPE67_CAM_RIDE) {
    const p = f.host.objectPath?.(path, SUBTYPE67_HOLD_FRAME);
    if (p) {
      obj.pos.x = p.x;
      obj.pos.z = p.z;
      obj.pos.y = Math.fround(p.y + SUBTYPE67_HOLD_LIFT);
      StoreAngles(obj, p);
    }
    Class26Subtype67Draw(obj);
    return;
  }
  if (cam >= SUBTYPE67_CAM_E9 && cam <= SUBTYPE67_CAM_EB) {
    const p = f.host.objectPath?.(path, SUBTYPE67_HOLD_FRAME);
    obj.pos.y = SUBTYPE67_PATH_E9_Y;
    if (p) {
      obj.pos.x = p.x;
      obj.pos.z = p.z;
      StoreAngles(obj, p);
    }
    Class26Subtype67DrawOrKill(obj);
    v.routine = Class26Routine.Subtype67DrawOrKill;
    return;
  }
  Class26Subtype67Draw(obj);
}

/**
 * `Class26Subtype67Draw` — `FUN_0048FB40`. Subtypes 6 and 7, drawn.
 *
 * ```c
 * if (obj+0x11C == 6) {
 *     Push; T(obj+0x40, obj+0x44, obj+0x48);
 *     if (obj+0x1320 == 1) AssetDrawSlot(0x1914);
 *     else {
 *         AssetDrawSlot(0x1915);
 *         T(153, 0, 0);                   AssetDrawSlot(0xD36);
 *         T(-8.715, 8.3296, -0.8076);     MatrixScale(0.1, 0.427, 43.415);
 *         NoOpStub(43.415);
 *         SetRenderLightColour(0.05, 0.01, 0); AssetDrawSlot(0x9A8);
 *         LightsRestoreScene();
 *     }
 *     Pop;
 *     if (g_active_cam_path == 0xDF && g_cam_path_frame >= 0x56E) {
 *         Push; T(obj+0x40, 2781.1, (frame - 0x56E) * 0.5 + obj+0x48 + 50.0);
 *         AssetDrawSlot(0x1914); Pop;
 *     }
 *     return;
 * }
 * if (obj+0x11C != 7) return;
 * Push; T(obj+0x40, obj+0x44, obj+0x48); AssetDrawSlot(0x190C); Pop;
 * Push; T(752.8753, obj+0x44, -9872.09);
 * if (g_script_flags[0x31] == 0)             AssetDrawSlot(0x7E9);
 * else if (g_accuracy_stats_suppressed == 0) AssetDrawSlot(0x7EB);
 * Pop;
 * ```
 *
 * `[proved]` from `0x0048FB40`..`0x0048FCF3`. The three `T` of subtype 6's
 * first push **accumulate** (`L5`): the lit model is at `pos + (144.285,
 * 8.3296, -0.8076)`, under the scale, and `0xD36` at `pos + (153, 0, 0)`.
 *
 * **The light is the one call's.** `SetRenderLightColour` changes the light
 * colour and nothing else, and `LightsRestoreScene` puts the scene's back on
 * the next line, so it is recorded on that draw alone
 * ({@link CLASS26_SUB6_LIGHT}) and not written into
 * `G.g_render_light_colour`, whose other readers are the lit screen quads.
 *
 * **`0x7EB` has a second gate.** `CMP word ptr [0x009A5C48], 0; JNZ` at
 * `0x0048FBB2` skips the draw -- no model at all at the fixed point -- while
 * `g_accuracy_stats_suppressed` is up. `[proved]`
 */
export function Class26Subtype67Draw(obj: Actor): void {
  const v = VehicleTailOf(obj);
  if (!v) return;
  if (obj.hp === Class26Subtype.OnPath183) {
    const m = MatIdentity();
    MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
    if (v.drawsOneModel === 1) {
      Class26DrawSlot(v, m, CLASS26_SUB6_SLOT_LATCHED);
    } else {
      Class26DrawSlot(v, m, CLASS26_SUB6_SLOT);
      MatrixTranslate(m, SUB6_BESIDE_X, 0, 0);
      Class26DrawSlot(v, m, CLASS26_SUB6_SLOT_BESIDE);
      MatrixTranslate(m, SUB6_LIT_AT[0], SUB6_LIT_AT[1], SUB6_LIT_AT[2]);
      MatrixScale(m, SUB6_LIT_SCALE[0], SUB6_LIT_SCALE[1], SUB6_LIT_SCALE[2]);
      Class26DrawSlot(v, m, CLASS26_SUB6_SLOT_LIT, CLASS26_SUB6_LIGHT);
    }
    if (G.g_active_cam_path === SUBTYPE67_CAM_RIDE
        && G.g_cam_path_frame >= SUBTYPE67_SECOND_COPY_FROM) {
      const m2 = MatIdentity();
      // `FILD (frame - 0x56E); FMUL 0.5; FADD [ESI+0x48]; FADD 50.0; FSTP`.
      const z = Math.fround(
        (G.g_cam_path_frame - SUBTYPE67_SECOND_COPY_FROM)
          * SUBTYPE67_SECOND_COPY_STEP + obj.pos.z
          + SUBTYPE67_SECOND_COPY_AHEAD);
      MatrixTranslate(m2, obj.pos.x, SUBTYPE67_TOP_Y, z);
      Class26DrawSlot(v, m2, CLASS26_SUB6_SLOT_LATCHED);
    }
    return;
  }
  if (obj.hp !== Class26Subtype.OnPath184) return;
  const m = MatIdentity();
  MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
  Class26DrawSlot(v, m, CLASS26_SUB7_SLOT);
  const fixed = MatIdentity();
  MatrixTranslate(fixed, SUB7_FIXED_X, obj.pos.y, SUB7_FIXED_Z);
  // `TEST AL, AL` on the byte, then `CMP word ptr [...], 0` on the word.
  if (((G.g_script_flags[SUB7_SWAP_FLAG] ?? 0) & 0xff) === 0) {
    Class26DrawSlot(v, fixed, CLASS26_SUB7_FIXED_SLOT);
  } else if ((G.g_accuracy_stats_suppressed & 0xffff) === 0) {
    Class26DrawSlot(v, fixed, CLASS26_SUB7_FIXED_SLOT_FLAGGED);
  }
}

/**
 * `Class26Subtype67DrawOrKill` — `FUN_0048FD00`. The last routine the update
 * installs, in Boss Mode and on camera paths `0xE9`..`0xEB`.
 *
 * ```c
 * if (g_active_cam_path == 0xEC) { ActorKill(); return; }
 * if (obj+0x11C == 6)      { Push; T(pos); AssetDrawSlot(0x1914); Pop; }
 * else if (obj+0x11C == 7) { Push; T(pos); AssetDrawSlot(0x190C); Pop; }
 * ```
 *
 * `[proved]` from `0x0048FD00`..`0x0048FD82`. None of the four camera paths
 * this routine is installed or killed on is among stage 6's (`cp_st6` loads
 * slots `0xD9`..`0xE8`), so in the shipped stages it runs only in Boss Mode.
 */
export function Class26Subtype67DrawOrKill(obj: Actor): void {
  const v = VehicleTailOf(obj);
  if (!v) return;
  if (G.g_active_cam_path === SUBTYPE67_CAM_KILL) {
    Class26Kill(obj);
    return;
  }
  if (obj.hp === Class26Subtype.OnPath183) {
    const m = MatIdentity();
    MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
    Class26DrawSlot(v, m, CLASS26_SUB6_SLOT_LATCHED);
  } else if (obj.hp === Class26Subtype.OnPath184) {
    const m = MatIdentity();
    MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
    Class26DrawSlot(v, m, CLASS26_SUB7_SLOT);
  }
}

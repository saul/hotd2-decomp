/**
 * `CarrierPropSelectRoutine`'s selectors 2 and 9 -- the stage-4 boss's
 * transport, the thing he rides in on and jumps down from.
 *
 * Four shipped spawns, one per boss block: stage 4's blocks 23 and 25 carry
 * selector 2 (the boss's entrances 0 and 1 ride it) and blocks 27 and 29
 * selector 9 (entrances 2 and 3, already standing). Each is a class-0x13
 * prop with behaviour 8 drawing slot `0x94F` (`st1_1b.bin[1]`) in the same
 * `spawn_obj_c` as the boss, so `CarrierPropSelectRoutine` has made it
 * `g_civilian_carrier` by the time `Boss4Init` latches that global.
 *
 * ```c
 * switch (sub->state) {                        // jump table 0x00440AB4, 0..3
 * case 0: ride = ActorAllocSub(0xC); sub->+0x04 = ride
 *         if (selector == 9) {
 *             PropSeatOnObjectPath(obj, 0x175, 360)
 *             ride->door0 = t[58] + 0xC000; ride->door1 = 0xC000 - t[58]
 *             if (g_active_cam_path == 0xBD) obj+0x68 += 0x8000
 *             sub->state = 4; break                                  -- open, parked
 *         }
 *         ride->door0 = ride->door1 = 0xC000; ride->step = 0; sub->state++   -- falls into 1
 * case 1: f = g_cam_path_frame
 *         f < 190:       PropSeatOnObjectPath(obj, 0x175, 190)
 *         else f > 360:  PropSeatOnObjectPath(obj, 0x175, 360); sub->state++
 *         else:          if (f == 350) PlaySoundId(0xB16A9); PropSeatOnObjectPath(obj, 0x175, f)
 *         if (g_active_cam_path == 0xBB) obj+0x68 += 0x8000
 *         break
 * case 2: if ((g_active_cam_path == 0xB4 || == 0xBC) && g_cam_path_frame >= 250)
 *             { PlaySoundId(0x2316A9); sub->state++ }
 *         break
 * case 3: ride->door0 = t[step] + 0xC000; ride->door1 = 0xC000 - t[step]
 *         if (++step >= 0x3B) sub->state++
 * }
 * Push; Translate(pos); RotX(+0x64); RotZ(+0x6C); RotY(+0x68)
 *   Push; Translate(27.705, -30.0792, -24.8531); RotY(door0); AssetDrawSlot(0x952); Pop
 *   Translate(27.705, -30.0792, 25.1794); RotY(door1); AssetDrawSlot(0x953)
 * Pop
 * ```
 *
 * `t` is `g_carrier2_door_yaw` (`0x005926D0`, 59 s16), from the bundle. The
 * doors are the renderer's (`render/slotmodels.ts`), off the two yaws. The
 * sounds are `COMMON\BOMB1_11.WAV` (the landing at 350) and
 * `COMMON\DOORKICK3_22K.wav` (the doors kicked open on paths 180 and 188).
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import type { ClassFrame } from "../registry";
import { SpawnClass } from "../spawn_class";
import { T } from "../tables";
import { PropSeatOnObjectPath } from "./index";
import { CarrierRoutine2State, type ScriptedPropTail } from "./state";

/** `PUSH 0x175` -- the `op_` object path the transport rides. */
export const CARRIER2_PATH = 0x175;
/** `PUSH 0xBE` / `CMP EAX, 0x168` -- the ride's first and last frames. */
const CARRIER2_FIRST_FRAME = 190;
const CARRIER2_LAST_FRAME = 360;
/** `CMP EAX, 0x15E` -- the landing's sound frame. */
const CARRIER2_LAND_FRAME = 350;
/** `CMP [0x009A6110], 0xFA` -- the doors are kicked open from this camera frame. */
const CARRIER2_KICK_FRAME = 250;
/** `COMMON\BOMB1_11.WAV`, `COMMON\DOORKICK3_22K.wav`. */
export const SFX_CARRIER2_LAND = 0xb16a9;
export const SFX_CARRIER2_DOORS = 0x2316a9;
/** The closed doors' yaw, `0xC000`, both of them. */
const DOOR_SHUT = 0xc000;
/** `CMP EAX, 0x3B` -- the table's length, 59 entries. */
const DOOR_STEPS = 0x3b;
/** `MOVSX ECX, word [0x00592744]` -- selector 9's already-open entry, 58. */
const DOOR_OPEN_STEP = 58;
/** The camera paths the routine turns the transport around on. */
const PATH_TURN_PARKED = 0xbd;
const PATH_TURN_RIDING = 0xbb;
/** ...and the two it kicks the doors open on. */
const PATH_KICK_A = 0xb4;
const PATH_KICK_B = 0xbc;
/** The selector that arrives parked with its doors open. */
const SELECTOR_PARKED = 9;

/** `g_carrier2_door_yaw[i]`, 0 past the table or without it. */
function DoorYaw(i: number): number {
  return T.carrierDoorYaw?.[i] ?? 0;
}

/**
 * `CarrierPropRoutine2` — `FUN_004408A0`. One frame of the transport.
 *
 * `ride+0x00`, `+0x04`, `+0x08` are {@link ScriptedPropTail.door0Yaw},
 * `door1Yaw` and `doorStep`; `riding` says the block has been allocated,
 * which is also when the doors start being drawn.
 */
export function CarrierPropRoutine2(obj: Actor, f: ClassFrame): void {
  const sub = obj.cls === SpawnClass.ScriptedProp
    ? (obj as { prop13: ScriptedPropTail }).prop13 : null;
  if (!sub) return;

  switch (sub.state as CarrierRoutine2State) {
    case CarrierRoutine2State.Begin:
      sub.riding = true;
      if (sub.selector === SELECTOR_PARKED) {
        PropSeatOnObjectPath(obj, CARRIER2_PATH, CARRIER2_LAST_FRAME, f);
        sub.door0Yaw = DoorYaw(DOOR_OPEN_STEP) + DOOR_SHUT;
        sub.door1Yaw = DOOR_SHUT - DoorYaw(DOOR_OPEN_STEP);
        if (G.g_active_cam_path === PATH_TURN_PARKED) {
          obj.yaw = (obj.yaw + 0x8000) | 0;
        }
        sub.state = CarrierRoutine2State.Parked;
        break;
      }
      sub.door1Yaw = DOOR_SHUT;
      sub.door0Yaw = DOOR_SHUT;
      sub.doorStep = 0;
      sub.state = CarrierRoutine2State.Ride;
      CarrierPropRoutine2Ride(obj, sub, f);
      break;
    case CarrierRoutine2State.Ride:
      CarrierPropRoutine2Ride(obj, sub, f);
      break;
    case CarrierRoutine2State.Wait:
      if ((G.g_active_cam_path === PATH_KICK_A
           || G.g_active_cam_path === PATH_KICK_B)
          && G.g_cam_path_frame >= CARRIER2_KICK_FRAME) {
        f.events?.emit("sound.play", { id: SFX_CARRIER2_DOORS });
        sub.state = CarrierRoutine2State.Open;
      }
      break;
    case CarrierRoutine2State.Open: {
      const i = sub.doorStep;
      sub.door0Yaw = DoorYaw(i) + DOOR_SHUT;
      sub.door1Yaw = DOOR_SHUT - DoorYaw(i);
      sub.doorStep = i + 1;
      if (sub.doorStep >= DOOR_STEPS) sub.state = CarrierRoutine2State.Parked;
      break;
    }
    default:
      break;
  }
}

/**
 * Case 1's body, `0x00440944`, which case 0 falls into. `[port-only]` as a
 * function, as `CarrierPropRoutine0Ride` is.
 */
function CarrierPropRoutine2Ride(obj: Actor, sub: ScriptedPropTail,
                                 f: ClassFrame): void {
  const frame = G.g_cam_path_frame;
  if (frame < CARRIER2_FIRST_FRAME) {
    PropSeatOnObjectPath(obj, CARRIER2_PATH, CARRIER2_FIRST_FRAME, f);
  } else if (frame > CARRIER2_LAST_FRAME) {
    PropSeatOnObjectPath(obj, CARRIER2_PATH, CARRIER2_LAST_FRAME, f);
    sub.state = CarrierRoutine2State.Wait;
  } else {
    if (frame === CARRIER2_LAND_FRAME) {
      f.events?.emit("sound.play", { id: SFX_CARRIER2_LAND });
    }
    PropSeatOnObjectPath(obj, CARRIER2_PATH, frame, f);
  }
  if (G.g_active_cam_path === PATH_TURN_RIDING) {
    obj.yaw = (obj.yaw + 0x8000) | 0;
  }
}

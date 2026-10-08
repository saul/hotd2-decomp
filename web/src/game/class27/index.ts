/**
 * Class 0x27 -- an object that rides an `op_` path at the camera's frame
 * until frame `0xBE`, then swaps its model, stops where it is and burns until
 * `g_script_flags[0]`.
 *
 * ```
 * PathRidingVehicleUpdate      FUN_004329D0   the handler: ride, swap, skip
 * PathRidingVehicleHeldUpdate  FUN_00432AF0   held: draw until flag 0, then kill
 * PathRidingVehicleDraw        FUN_00432B10   the draw, and the cel counter
 * ```
 *
 * `[proved]` `g_class_handler_pairs` (`0x00593358`) row `{0x27,
 * 0x004329D0}` at `0x005933F0`, read out of the image with its neighbours
 * (`0x26 -> 0x0048E290`, `0x28 -> 0x00432610`, both what the port already
 * registers). There is no `Init`: `EvtOpSpawnPlaced09` (`FUN_004088A0`)
 * allocates the object with the handler, runs `ActorClearGameFields` and
 * copies the record's position, angles and `desc+0x22` -- so every word the
 * class reads that the spawn does not write starts at zero.
 *
 * `[proved]` Two shipped spawns, both stage 2 block 0 step 2, op 19 -- one
 * `spawn_placed` at evt `1060` naming descriptors `1920` (`obj+0x11C` 0)
 * and `1960` (1), each at the origin with a zero orientation and flags. The
 * step plays camera path `0x38` from frame 10 to 190 -- the car's own shot
 * (`St2CarRouteUpdate`, `FUN_004521B0`, rides `op_st2 0x148` on it). The two
 * objects ride `op_st2` `0x149` and `0x14A` at the same frame, so they run in
 * step with it; on frame `0xBE` = 190, the last of the play, both swap from
 * slot `0x2B` to slot `0x33` (`char_adv04.bin` 0 and 8, the file
 * `St2CarDraw` takes the car's eight models from), hold that pose and start
 * the two cel loops. A skip lands them on the same frame. Stage 2 raises
 * `g_script_flags[0]` at block 3 step 3, which kills them. What the models
 * depict is not this module's business.
 *
 * ## What the port used to do instead
 *
 * Nothing: class 0x27 had no module, so `SpawnSlotActor` built nothing for
 * either spawn and nothing drew slots `0x2B`, `0x33` or either cel loop in
 * stage 2. `render/rigs.ts` exported the `0x149`/`0x14A` routes as roots of
 * class 0x28's rig, which nothing draws.
 */
import type { Actor } from "../actor";
import { CameraBlockEye } from "../camera/view";
import { CLASS28_ROUTES } from "../class28";
import { G } from "../globals";
import type { GameHost } from "../host";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
  MatrixTranslate,
} from "../matrix";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { VecToAngles } from "../vec";
import { DrawSlotInWorld } from "../view_slot";
import { PathRidingVehicleRoutine } from "./state";

export {
  makePathRidingVehicleTail, PathRidingVehicleRoutine,
  type PathRidingVehicleTail,
} from "./state";

/** A class-0x27 actor, narrowed. */
export type PathRidingVehicleActor = Extract<Actor,
  { cls: SpawnClass.PathRidingVehicle }>;

/**
 * `MOV EDX, [ECX*4 + 0x589ae8]` at `0x00432A3A` and `0x00432AA8`: a **dword**
 * of `g_class28_route_table` (`0x00589AE0`) from entry 2, indexed by
 * `(s16)obj+0x11C` with no bound. Entries 2 and 3 are `{0x149, 0}` and
 * `{0x14A, 0}`, so the dword is the `op_` slot.
 */
export const PATH_VEHICLE_ROUTE_BASE = 2;

/** `MOV dword ptr [ESI + 0x13f0], 0x2b` at `0x004329ED` -- the first body. */
export const PATH_VEHICLE_SLOT_RIDING = 0x2b;

/** `MOV dword ptr [ESI + 0x13f0], 0x33` at `0x00432A14` and `0x00432A98`. */
export const PATH_VEHICLE_SLOT_HELD = 0x33;

/** `CMP dword ptr [0x009a6110], 0xbe; JL` at `0x004329FE` -- the swap frame. */
export const PATH_VEHICLE_SWAP_FRAME = 0xbe;

/** `PUSH 0x433e0000` at `0x00432AB0` -- 190.0, the skip's pose frame. */
export const PATH_VEHICLE_SKIP_FRAME = 190.0;

/** `MOV AL, [0x009c7200]; CMP AL, 1` at `0x00432AF0` -- `g_script_flags[0]`. */
const PATH_VEHICLE_KILL_FLAG = 0;

/** `CMP word ptr [ESI + 0x11c], 0x2; JGE` at `0x00432B6D`. */
const PATH_VEHICLE_CEL_ROUTES = 2;

/** `FADD float ptr [0x0055D2B4]` at `0x00432BDB` -- `0x40A00000`, 5.0. */
const PATH_VEHICLE_CEL_LIFT = 5.0;

/**
 * `CMP EAX, 0x28` / `MOV ECX, 0x28; IDIV ECX` at `0x00432C02`, then `ADD
 * EDX, 0x1433` or `ADD EDX, 0x1AAB` -- `char_adv00.bin` 9..48 and 57..96.
 */
export const PATH_VEHICLE_CEL_RUN = 0x28;
export const PATH_VEHICLE_CEL_FIRST = 0x1433;
export const PATH_VEHICLE_CEL_LOOP = 0x1aab;

/**
 * `AND EDX, 0x80000007` (and the signed fix-up) `; ADD EDX, 0xB67` at
 * `0x00432C5A` -- `char_adv00.bin` 1..8, the loop `PathRidingPropDraw`
 * (`FUN_00432840`) draws as well.
 */
export const PATH_VEHICLE_CEL2_FIRST = 0xb67;
export const PATH_VEHICLE_CEL2_RUN = 8;

/**
 * `PUSH 0x40a00000` -- `T(0, 0, 5.0)` at `0x00432C28` and `Scale(5.0, 5.0,
 * 5.0)` at `0x00432C36`; `NoOpStub(5.0)` after it does nothing.
 */
const PATH_VEHICLE_CEL2_AHEAD = 5.0;
const PATH_VEHICLE_CEL2_SCALE = 5.0;

/**
 * `CamEvalObjectPath6` (`FUN_004042D0`) onto `obj+0x40..0x48` and
 * `obj+0x64..0x6C` -- the six stores both of the handler's evaluations end
 * with (`0x00432A53`..`0x00432A6F`, `0x00432AC7`..`0x00432AE5`). The slot is
 * the dword at `0x00589AE8 + (s16)obj+0x11C * 4`. A host with no `op_` paths
 * is a valid host; the object then keeps the pose it has.
 */
function PathRidingVehiclePose(obj: PathRidingVehicleActor, host: GameHost,
                               frame: number): void {
  const [slot, freeze] = CLASS28_ROUTES[PATH_VEHICLE_ROUTE_BASE
                                        + ((obj.hp << 16) >> 16)];
  const p = host.objectPath?.(((freeze & 0xffff) << 16) | (slot & 0xffff),
                              frame);
  if (!p) return;
  obj.pos.x = p.x;
  obj.pos.y = p.y;
  obj.pos.z = p.z;
  obj.pitch = p.pitch ?? obj.pitch;
  obj.yaw = p.yaw ?? obj.yaw;
  obj.roll = p.roll ?? obj.roll;
}

/**
 * The swap, written the same three ways at `0x00432A0A` and `0x00432A8E`:
 * `obj+0x1324 = 1; obj+0x13F0 = 0x33; obj+0x00 = 0x00432AF0`.
 * `[port-only]` as a function -- the routine has the three stores twice.
 */
function PathRidingVehicleSwap(obj: PathRidingVehicleActor): void {
  const t = obj.vehicle27;
  t.burning = 1;
  t.drawSlot = PATH_VEHICLE_SLOT_HELD;
  t.routine = PathRidingVehicleRoutine.Held;
}

/**
 * `ActorKill` (`FUN_004A7040`) as this class takes it: a `JMP` straight to
 * the unlink, with no `ActorDespawn` in front and no hit slot to give back.
 * `[port-only]` as a name, the same shape and reason as `PathRidingPropKill`
 * in `class28/index.ts`.
 */
function PathRidingVehicleKill(obj: PathRidingVehicleActor): void {
  obj.despawned = true;
  obj.visible = false;
}

/**
 * `PathRidingVehicleDraw` -- `FUN_00432B10`. Both updates call it once a
 * frame.
 *
 * ```
 * Push; T(obj+0x40); RotZ(+0x6C); RotY(+0x68); RotX(+0x64);
 * AssetDrawSlot(obj+0x13F0); Pop;
 * if (obj+0x1324 != 0 && (s16)obj+0x11C < 2) {
 *     n = ++obj+0x1320;
 *     yaw = VecToAngles(eye.x - x, 0, eye.z - z).yaw;    // eye: g_camera_index's block
 *     Push; T(x, y + 5.0, z); RotY(yaw);
 *     AssetDrawSlot(n < 0x28 ? n % 0x28 + 0x1433 : n % 0x28 + 0x1AAB);
 *     T(0, 0, 5.0); Scale(5.0, 5.0, 5.0); NoOpStub(5.0);
 *     AssetDrawSlot(0xB67 + n % 8); Pop;
 * }
 * ```
 *
 * `[proved]` from the listing, `0x00432B10`..`0x00432C7F`. **The counter is
 * stepped here**, so it is the port's clock in `game/` and not the
 * renderer's (`L7`): the first loop runs `0x1434`..`0x145A` once and then
 * `0x1AAB`..`0x1AD2` for good, one cel a frame. The second translate comes
 * after the turn, so it is along the turned `+z` (`L84`); the matrices are
 * built in call order and recorded whole (`DrawSlotInWorld`), from the
 * identity where the engine's stack starts from the view. The eye is
 * `[g_camera_index * 0x1A4 + 0x009A60C0]` and `+ 0x009A60C8`
 * (`0x00432BAB`/`0x00432BB7`), the differences stored as floats
 * (`FSTP float ptr [ESP]`) and the yaw an integer.
 */
export function PathRidingVehicleDraw(obj: PathRidingVehicleActor): void {
  const t = obj.vehicle27;
  const m = MatIdentity();
  MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
  MatrixRotateZ(m, obj.roll);
  MatrixRotateY(m, obj.yaw);
  MatrixRotateX(m, obj.pitch);
  DrawSlotInWorld(t.drawSlot, m);
  if (t.burning === 0 || ((obj.hp << 16) >> 16) >= PATH_VEHICLE_CEL_ROUTES) {
    return;
  }
  t.cel = (t.cel + 1) | 0;
  const eye = CameraBlockEye(G.g_camera_index);
  const yaw = Math.trunc(VecToAngles(Math.fround(eye.x - obj.pos.x), 0,
                                     Math.fround(eye.z - obj.pos.z)).yaw);
  const s = MatIdentity();
  MatrixTranslate(s, obj.pos.x, Math.fround(obj.pos.y + PATH_VEHICLE_CEL_LIFT),
                  obj.pos.z);
  MatrixRotateY(s, yaw);
  const n = t.cel;
  DrawSlotInWorld(n < PATH_VEHICLE_CEL_RUN
    ? n % PATH_VEHICLE_CEL_RUN + PATH_VEHICLE_CEL_FIRST
    : n % PATH_VEHICLE_CEL_RUN + PATH_VEHICLE_CEL_LOOP, s);
  MatrixTranslate(s, 0, 0, PATH_VEHICLE_CEL2_AHEAD);
  MatrixScale(s, PATH_VEHICLE_CEL2_SCALE, PATH_VEHICLE_CEL2_SCALE,
              PATH_VEHICLE_CEL2_SCALE);
  DrawSlotInWorld(PATH_VEHICLE_CEL2_FIRST + n % PATH_VEHICLE_CEL2_RUN, s);
}

/**
 * `PathRidingVehicleHeldUpdate` -- `FUN_00432AF0`. The whole routine:
 *
 * ```
 * 00432AF0  CMP  byte ptr [0x009c7200], 0x1     ; g_script_flags[0]
 * 00432AF7  JNZ  0x00432AFE
 * 00432AF9  JMP  0x004a7040                     ; ActorKill
 * 00432AFE  ... CALL PathRidingVehicleDraw
 * ```
 *
 * It never poses: the object stays where the frame that installed it left
 * it, at camera frame `0xBE` or 190.0.
 */
export function PathRidingVehicleHeldUpdate(obj: PathRidingVehicleActor):
    void {
  if ((G.g_script_flags[PATH_VEHICLE_KILL_FLAG] ?? 0) === 1) {
    PathRidingVehicleKill(obj);
    return;
  }
  PathRidingVehicleDraw(obj);
}

/**
 * `PathRidingVehicleUpdate` -- `FUN_004329D0`. Class 0x27's handler, one
 * frame.
 *
 * ```
 * switch ((s16)obj+0x1312) {
 * case 0:  obj+0x13F0 = 0x2B;  obj+0x1312 = 1;          // and on into 1
 * case 1:  if (g_cam_path_frame >= 0xBE) swap();       // 0x33, burning, held
 * }
 * pose = CamEvalObjectPath6(route, (float)g_cam_path_frame);
 * PathRidingVehicleDraw(obj);
 * if (g_cutscene_skipping) { swap(); pose = CamEvalObjectPath6(route, 190.0); }
 * ```
 *
 * `[proved]` from the listing, `0x004329D0`..`0x00432AEC`. Three things are
 * easy to read wrong and are not:
 *
 * * **the swap has no camera-path test** -- only `g_cam_path_frame` -- and
 *   the frame it happens on still poses and draws: the swap falls through
 *   into the evaluation, so the held pose is the path at frame `0xBE` (or
 *   whatever frame first reached it), and that frame draws `0x33` and the
 *   first cels;
 * * **the skip arm comes after the draw**, so a skipped frame draws at the
 *   live frame's pose and the held routine draws at 190.0 from the next;
 * * `obj+0x1312` is never stepped past 1 here, and nothing else writes it:
 *   once the routine is swapped this one never runs again.
 */
export function PathRidingVehicleUpdate(obj: PathRidingVehicleActor,
                                        f: ClassFrame): void {
  const t = obj.vehicle27;
  if (obj.sub === 0) {
    t.drawSlot = PATH_VEHICLE_SLOT_RIDING;
    obj.sub = 1;
  }
  if (obj.sub === 1 && G.g_cam_path_frame >= PATH_VEHICLE_SWAP_FRAME) {
    PathRidingVehicleSwap(obj);
  }
  // `FILD dword ptr [0x009a6110]` at `0x00432A24` -- a whole frame.
  PathRidingVehiclePose(obj, f.host, G.g_cam_path_frame);
  PathRidingVehicleDraw(obj);
  if (G.g_cutscene_skipping !== 0) {
    PathRidingVehicleSwap(obj);
    PathRidingVehiclePose(obj, f.host, PATH_VEHICLE_SKIP_FRAME);
  }
}

function PathRidingVehicleDispatch(obj: Actor, f: ClassFrame): void {
  if (obj.cls !== SpawnClass.PathRidingVehicle) return;
  // `[port-only]` The engine calls whatever `obj+0x00` holds; a snapshot
  // cannot hold a function, so the tail holds which of the two it is.
  if (obj.vehicle27.routine === PathRidingVehicleRoutine.Held) {
    PathRidingVehicleHeldUpdate(obj);
  } else {
    PathRidingVehicleUpdate(obj, f);
  }
}

function PathRidingVehicleDebug(obj: Actor): ActorDebug {
  if (obj.cls !== SpawnClass.PathRidingVehicle) {
    return { summary: "not 0x27" };
  }
  const t = obj.vehicle27;
  const route = CLASS28_ROUTES[PATH_VEHICLE_ROUTE_BASE + obj.hp];
  const where = `(${obj.pos.x.toFixed(1)}, ${obj.pos.y.toFixed(1)},`
    + ` ${obj.pos.z.toFixed(1)})`;
  return {
    summary: `route 0x${(route?.[0] ?? 0).toString(16)} · slot `
      + `0x${t.drawSlot.toString(16)} · `
      + (t.routine === PathRidingVehicleRoutine.Held
        ? `held, cel ${t.cel}` : "riding"),
    detail: [`at ${where} · sub ${obj.sub}`],
    hot: t.burning === 1,
  };
}

export const PathRidingVehicleHandler: ClassHandler = {
  // Nothing at spawn: `EvtOpSpawnPlaced09` (`FUN_004088A0`) allocates the
  // object with the handler and calls no `Init`.
  init: () => {},
  update: PathRidingVehicleDispatch,
  // No hit points and no damage: `obj+0x11C` is the route, and the class
  // registers nothing for the shot test.
  ownsShotResult: true,
  debug: PathRidingVehicleDebug,
};

registerClass(SpawnClass.PathRidingVehicle, PathRidingVehicleHandler);

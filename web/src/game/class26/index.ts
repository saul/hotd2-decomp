/**
 * Class 0x26 — the vehicle-and-scenery family, and **stage 3's boat**.
 *
 * `Class26InstallSubtypeUpdate` (`FUN_0048E290`) is what the spawn opcode
 * allocates the object with. On the object's first tick it switches on
 * `obj+0x11C` — the subtype, not hit points (`L3`) — calls one of eight
 * routines once and writes that routine into `obj+0x00`, so every later tick
 * goes straight to it. Three subtypes are ported: 2, `Class26Subtype2Update`
 * (`FUN_0048EAD0`), the boat the player and their partner ride through stage
 * 3's canals, which is spawned at descriptor 3244 in eight of the stage's
 * blocks; and 6 and 7, `Class26Subtype67Update` (`FUN_0048F930`), stage 6
 * block 12's pair, in `subtype67.ts`. Subtypes 1, 3, 4 and 5 — the stage-1
 * car among them — are still drawn by `render/rigs.ts` off the rig table,
 * with no actor behind them, and subtype 0 by nothing.
 *
 * ## Why the boat is an actor at all
 *
 * The rig renderer already drew it. What it could not do is be **stood on**:
 * `Class26Subtype2Update`'s first frame seats `obj+0x14C` from the descriptor
 * tail — a pointer to `coli3.bin`'s blob at `0x9C08`, 23 quads of the boat's
 * foredeck in the boat's own space — and raises `obj+0x34 |= 0x51`. Bits
 * `0x10` and `0x40` of that are exactly what the first pass of
 * `ColiTraceSegmentAllSets` (`FUN_004053B0`) and of
 * `ColiTestSphereAgainstFullSet` (`FUN_004057F0`) require of an object before
 * testing the query against its blob, so every ground probe made over the boat
 * finds the deck. Stage 3 block 0 step 4's zombie leaps off a rooftop onto the
 * bow; without this pass its ground snap found the canal under the hull and it
 * stood waist-deep in the boat.
 *
 * ## What is here and what is not
 *
 * The pose, the first-frame block and the world matrix are here, because they
 * are what the collision reads. The draw — `AssetDrawSlot(0x1A37)` and the
 * view-space point at `obj+0x70` for the shot test — is `render/`'s, and
 * `render/rigs.ts` still poses its own copy of the model from the same path.
 * `[port-only]` Two readers of one routine: the rig's pose and this one agree
 * because they transcribe the same arithmetic, not because one reads the
 * other. Making the rig read this actor is the renderer's half of the job.
 */
import { ActorDespawn } from "../despawn";
import type { Actor } from "../actor";
import { G } from "../globals";
import { CameraBlockYaw } from "../camera/view";
import { ActorClaimHitSlot } from "../hit_slots";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { BAMS_TO_RAD } from "../../core/bams";
import {
  Class26Routine, Class26Subtype, type VehicleTail,
} from "./state";
import {
  Class26Subtype67Draw, Class26Subtype67DrawOrKill, Class26Subtype67Update,
  VehicleTailOf,
} from "./subtype67";

/**
 * `g_actor_kill_all` — `0x009C72E0`, which is `g_script_flags[0xE0]`: the
 * byte `Class26Subtype2Update` tests first (`MOV CL, byte ptr [0x009c72e0]`,
 * `CMP CL, 1`) and despawns on.
 */
const ACTOR_KILL_ALL_FLAG = 0xe0;

/** `obj+0x34 |= 0x51` at `0x0048EB0E` — `1`, `0x10` and `0x40`. */
const BOAT_FLAGS = 0x51;

/**
 * `obj+0x44 = y + 2.0` — `FADD float ptr [0x004e30f0]` at `0x0048ED86`, and
 * the constant is `00 00 00 40`, 2.0f (`L1`: read from the image, not from
 * the pseudocode).
 */
const BOAT_RIDE_HEIGHT = 2.0;

/** `+ 0x8000` on the camera block's yaw at `0x0048EDCD`. */
const FACE_CAMERA_TURN = 0x8000;

/**
 * `g_cam_path_length` (`0x00576D38`), for the nine `op_` slots the routine
 * rides — read out of the image with `ExeTables.camPathLength`. The routine
 * does `min(g_cam_path_frame, g_cam_path_length[slot])`, so the boat stops at
 * the end of its path rather than extrapolating along the last segment.
 */
const BOAT_PATH_LENGTH: Readonly<Record<number, number>> = {
  0x156: 1575, 0x157: 1530, 0x158: 855, 0x159: 2035, 0x15a: 1710,
  0x15b: 1850, 0x15c: 345, 0x15d: 1010, 0x199: 225,
};

/**
 * One arm of `Class26Subtype2Update`'s `switch (g_active_cam_path)`: the
 * `op_` slot the boat rides on that camera path, and the camera frames that
 * raise and drop {@link VehicleTail.faceCamera}.
 *
 * Transcribed arm by arm from `0x0048EB31`..`0x0048ED60`. Each arm tests
 * **exact** frames, so the latch changes only on the frame the camera passes
 * that number. Paths `0xF6`..`0xF8` ride slot `0x199` and never touch the
 * latch; a path in none of the arms skips the pose entirely (below).
 */
interface BoatRoute {
  slot: number;
  raise: readonly number[];
  drop: readonly number[];
}
const BOAT_ROUTES: Readonly<Record<number, BoatRoute>> = {
  0x7c: { slot: 0x156, raise: [0x3a2, 0x140], drop: [0x29e, 0x401] },
  0x7d: { slot: 0x157, raise: [0x3f7, 0x2ee], drop: [0x33e, 0x45b] },
  0x7e: { slot: 0x158, raise: [0x24e, 0], drop: [0x145, 0x339] },
  0x7f: { slot: 0x159, raise: [0x537], drop: [0x794] },
  // `0x483` **drops** it: the `!= 0x483` test at the top of this arm jumps
  // over the raise and lands on the store of 0 at `0x0048EC90`.
  0x82: { slot: 0x15a, raise: [0xe6, 0x3c5, 0x5c8],
          drop: [0x483, 0x15e, 0x6ae] },
  0x85: { slot: 0x15b, raise: [0x3d9, 0x46f, 0x1db, 200, 0x33e],
          drop: [0x410, 0x4ba, 0x375, 0x154, 0x24e] },
  0x86: { slot: 0x15c, raise: [0], drop: [0xbe] },
  0x87: { slot: 0x15d, raise: [0x1d1, 0], drop: [0x149, 0x334] },
  0xf6: { slot: 0x199, raise: [], drop: [] },
  0xf7: { slot: 0x199, raise: [], drop: [] },
  0xf8: { slot: 0x199, raise: [], drop: [] },
};

/**
 * `T · Rz · Ry · Rx`, the product the draw builds at `0x0048EDE6`..
 * `0x0048EE13` — `MatrixTranslate(obj+0x40)`, `MatrixRotateZ(obj+0x6C)`,
 * `MatrixRotateY(obj+0x68)`, `MatrixRotateX(obj+0x64)` — into
 * {@link Actor.coliMatrix}'s row-major 3x4.
 *
 * The rotations are the right-handed ones `game/carrier.ts` and
 * `render/rigs.ts` (a three.js `Euler` in `"ZYX"`) both use for the same
 * engine calls.
 */
function Class26StoreWorldMatrix(obj: Actor): void {
  const cx = Math.cos(obj.pitch * BAMS_TO_RAD);
  const sx = Math.sin(obj.pitch * BAMS_TO_RAD);
  const cy = Math.cos(obj.yaw * BAMS_TO_RAD);
  const sy = Math.sin(obj.yaw * BAMS_TO_RAD);
  const cz = Math.cos(obj.roll * BAMS_TO_RAD);
  const sz = Math.sin(obj.roll * BAMS_TO_RAD);
  // Rz · Ry
  const a00 = cz * cy, a01 = -sz, a02 = cz * sy;
  const a10 = sz * cy, a11 = cz, a12 = sz * sy;
  const a20 = -sy, a21 = 0, a22 = cy;
  // ...· Rx, whose columns are (1,0,0), (0,cx,sx), (0,-sx,cx).
  const m = obj.coliMatrix ?? (obj.coliMatrix = new Array(12).fill(0));
  m[0] = a00; m[1] = a01 * cx + a02 * sx; m[2] = -a01 * sx + a02 * cx;
  m[3] = obj.pos.x;
  m[4] = a10; m[5] = a11 * cx + a12 * sx; m[6] = -a11 * sx + a12 * cx;
  m[7] = obj.pos.y;
  m[8] = a20; m[9] = a21 * cx + a22 * sx; m[10] = -a21 * sx + a22 * cx;
  m[11] = obj.pos.z;
}

/**
 * `Class26Subtype2Update` — `FUN_0048EAD0`. Class 0x26 subtype 2, stage 3's
 * boat.
 *
 * ```c
 * if (g_actor_kill_all == 1) { ActorDespawn(obj); return; }
 * if (obj+0x1312 == 0) {
 *     obj+0x34 |= 0x51;  obj+0x14C = *(u32 *)tail;  g_carrier_object = obj;
 *     ActorClaimHitSlot(obj);  obj+0x1312++;
 * }
 * switch (g_active_cam_path) { ... slot, and the obj+0x1350 latch ...
 *   default: goto draw;                          // no pose this frame
 * }
 * n = min(g_cam_path_frame, g_cam_path_length[slot]);
 * CamEvalObjectPath6(slot, n) -> x, y + 2.0, z, rx, ry | latch, rz;
 * draw:
 * T; Rz; Ry; Rx; AssetDrawSlot(0x1A37); MatrixStore(obj+0x150); ...
 * RegisterForShotTest(obj);
 * ```
 *
 * The `RegisterForShotTest` at `0x0048EE9C` is **past the no-return
 * `MatrixStackPop`** Ghidra ends the function on (`L35`); disassembling from
 * `0x0048EE34` is what finds it, and it is how the boat gets into the list
 * the collision passes walk.
 */
export function Class26Subtype2Update(obj: Actor, f: ClassFrame): void {
  const v = VehicleTailOf(obj);
  if (!v) return;
  if ((G.g_script_flags[ACTOR_KILL_ALL_FLAG] ?? 0) === 1) {
    ActorDespawn(obj);
    return;
  }
  if (obj.sub === 0) {
    obj.flags |= BOAT_FLAGS;
    obj.coliBlob = obj.class26?.coli ?? null;
    G.g_carrier_object = obj.at;
    ActorClaimHitSlot(obj);
    obj.sub += 1;
  }

  const route = BOAT_ROUTES[G.g_active_cam_path];
  if (route) {
    if (route.raise.includes(G.g_cam_path_frame)) v.faceCamera = 1;
    else if (route.drop.includes(G.g_cam_path_frame)) v.faceCamera = 0;
    const len = BOAT_PATH_LENGTH[route.slot] ?? G.g_cam_path_frame;
    const n = Math.min(G.g_cam_path_frame, len);
    const p = f.host.objectPath?.(route.slot, n);
    if (p) {
      obj.pos.x = p.x;
      obj.pos.y = p.y + BOAT_RIDE_HEIGHT;
      obj.pos.z = p.z;
      obj.pitch = p.pitch ?? obj.pitch;
      // `obj+0x68 = g_camera_block_yaw_bams[g_camera_index] + 0x8000`
      // (`0x0048EDC6`..`0x0048EDD3`), no mask. This read `g_camera_yaw_bams`
      // (`0x009C71F0`), which the scene state's hooks write as a camera
      // heading already turned half round, so the latched boat stood half a
      // turn from where the engine puts it. `[proved]`
      obj.yaw = v.faceCamera
        ? CameraBlockYaw(G.g_camera_index) + FACE_CAMERA_TURN
        : (p.yaw ?? obj.yaw);
      obj.roll = p.roll ?? obj.roll;
    }
  }
  // The draw's `MatrixStore(obj+0x150)`, which runs whether or not the switch
  // posed the boat this frame.
  Class26StoreWorldMatrix(obj);
}

/**
 * `Class26InstallSubtypeUpdate` — `FUN_0048E290`. Class 0x26's handler.
 *
 * Runs the subtype's routine once and installs it:
 *
 * ```
 * 0048e319  CALL 0x0048f930                ; subtypes 6 and 7
 * 0048e321  MOV  dword ptr [ESI], 0x48f930
 * ```
 *
 * **The store comes after the call**, so whatever the routine installed on
 * this first frame is overwritten with the routine itself: a subtype-6/7
 * object whose first frame is in Boss Mode or on camera paths `0xE9`..`0xEB`
 * runs `Class26Subtype67Update` again on its second frame, and that one's
 * installation of the draw-or-kill is the one that stays. `[proved]`
 *
 * A subtype this port has not read gets nothing, which is what an unported
 * routine should look like: the object is in the pool and does not move.
 */
export function Class26InstallSubtypeUpdate(obj: Actor, f: ClassFrame): void {
  const v = VehicleTailOf(obj);
  if (!v) return;
  switch (obj.hp) {
    case Class26Subtype.Boat:
      Class26Subtype2Update(obj, f);
      v.routine = Class26Routine.Subtype2Update;
      return;
    case Class26Subtype.OnPath183:
    case Class26Subtype.OnPath184:
      Class26Subtype67Update(obj, f);
      v.routine = Class26Routine.Subtype67Update;
      return;
    default:
      return;
  }
}

/**
 * `[port-only]` The walk's call through `obj+0x00`: whichever routine is
 * installed there. It opens by clearing what the last frame drew (see
 * `Class26DrawCall`): a routine that returns before it draws has drawn
 * nothing this frame, which is what the engine's frame shows.
 */
function Class26Update(obj: Actor, f: ClassFrame): void {
  const v = VehicleTailOf(obj);
  if (!v) return;
  v.draws = [];
  switch (v.routine) {
    case Class26Routine.Install:
      Class26InstallSubtypeUpdate(obj, f);
      return;
    case Class26Routine.Subtype2Update:
      Class26Subtype2Update(obj, f);
      return;
    case Class26Routine.Subtype67Update:
      Class26Subtype67Update(obj, f);
      return;
    case Class26Routine.Subtype67Draw:
      Class26Subtype67Draw(obj);
      return;
    case Class26Routine.Subtype67DrawOrKill:
      Class26Subtype67DrawOrKill(obj);
      return;
  }
}

function Class26Debug(obj: Actor): ActorDebug {
  const v = VehicleTailOf(obj);
  return {
    summary: `subtype ${obj.hp} · ${Class26Routine[v?.routine ?? 0]}`
      + `${v?.faceCamera ? " · facing camera" : ""}`
      + `${v?.drawsOneModel ? " · one model" : ""}`,
    detail: [
      `blob ${obj.coliBlob ?? "none"}`,
      `at ${obj.pos.x.toFixed(1)},${obj.pos.y.toFixed(1)},`
      + `${obj.pos.z.toFixed(1)}`,
      `draws ${(v?.draws ?? []).map((d) => `0x${d.slot.toString(16)}`)
        .join(" ") || "none"}`,
    ],
    hot: obj.hp === Class26Subtype.Boat && !obj.coliBlob,
  };
}

export const VehicleHandler: ClassHandler = {
  // Nothing at spawn: the engine's handler is the installer, and it runs on
  // the object's first tick, not in the spawn opcode.
  init: () => {},
  update: Class26Update,
  // No hit points and no damage: `obj+0x11C` is the subtype.
  ownsShotResult: true,
  debug: Class26Debug,
};

registerClass(SpawnClass.Vehicle, VehicleHandler);

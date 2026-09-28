/**
 * The stage-2 car -- the red car the rescue target rides into stage 2 on --
 * as the **task** it is in the engine, and not as a model the renderer puts
 * up by itself.
 *
 * It is proved a car by its sound: the Training poser plays `0x719A9`, whose
 * SE record names `STAGE2_SE\CAR_SRIP_22.wav` (see `OBJ_452320` in
 * `tools/hod2lib/rigs.py`). Its draw routine is {@link St2CarDraw}, at
 * `0x00452320`: the exporter transcribes its transforms into the rig
 * `obj_452320`, and everything it decides -- the asset row, the two gated
 * rotations, the roll-limited frame -- is here.
 *
 * ## Who makes it, and when
 *
 * Exactly one thing allocates it: `RescueTargetInit` (`FUN_00451720`) calls
 * {@link St2CarSpawn} with `PUSH 0x0` at `0x004517F6` and `CALL 0x00452120` at
 * `0x00451800` in its non-Training arm, and with `obj+0x11C` at `0x0045183B`
 * in its Training arm. `get_xrefs_to 0x00452120` returns those two calls and
 * nothing else `[proved]`. So **the car does not exist until class 0x21 does**
 * -- and class 0x21's one spawn in the game is stage 2 block 0 step 2, after
 * the Goldman cutscene of step 1. The port drew the rig from stage load, which
 * put the car in Goldman's office: its three rig roots are exported at the
 * origin, and so is the desk.
 *
 * ## What it does
 *
 * ```
 * St2CarSpawn                0x00452120  ActorAlloc(St2CarInit, 0x13F4); +0x1350 = index
 * St2CarInit                 0x00452150  zero the draw words; Route (or Training)
 * St2CarRouteUpdate          0x004521B0  the camera path picks the op_ path; pose; draw
 * St2CarHeldUpdate           0x004522A0  parked: never re-poses; dies on g_script_flags[0]
 * St2CarDraw                 0x00452320  both of the above end by calling it; row, rotations
 * St2CarTrainingWaitUpdate   0x004528B0  Training only -- not ported, see St2CarInit
 * ```
 *
 * The route is chosen by `g_active_cam_path` alone -- `0x38`, `0x39` and `0x3A`
 * name `op_st2` `0x148`, `0x14E` and `0x14D` -- and the car stops following it
 * when `g_cam_path_frame` reaches that path's `g_cam_path_length` on `0x39` or
 * `0x3A`. From then on it is parked, and it draws until the script raises
 * `g_script_flags[0]` (stage 2 raises it at block 3 step 3 and at block 11).
 *
 * ## Why plain records in `G`
 *
 * The same answer as `g_carried_props`: the engine allocates a task with no
 * class id, the port keeps a pool whose every slice survives `clonePlain`, and
 * `render/rigs.ts` reads the pose back out of it -- the renderer owns the
 * model, the port owns whether it exists and where it is.
 */
import type { GameHost } from "../host";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import { MatrixGetAngles, RotZYX } from "../carrier";
import { vec3, type Vec3 } from "../vec";

/** `ActorAlloc(St2CarInit, 0x13F4)` -- `PUSH 0x13F4` at `0x00452120`. */
export const ST2CAR_TASK_SIZE = 0x13f4;

/**
 * The camera paths `St2CarRouteUpdate` names, and the `op_st2` path each one
 * poses the car from: `MOV ECX, 0x148` / `0x14E` / `0x14D` at `0x004521EB`,
 * `0x004521E4` and `0x004521DD`. Immediates -- the routine does **not** read
 * `g_st2car_path_table` (`0x00565EF4`), though that table's first three rows
 * are the same three numbers; only the Training poser indexes it.
 */
export enum St2CarShot {
  /** `cp_st2` 0x38 -- the car drives up. */
  DriveUp = 0x38,
  /** `cp_st2` 0x39 -- ends parked, with the post-crash asset set. */
  Crash = 0x39,
  /** `cp_st2` 0x3A -- the wheels stop at frame 0x50, parked at the end. */
  Stop = 0x3a,
}

/** `op_st2` slot per {@link St2CarShot}. */
export const ST2CAR_SHOT_PATH: Readonly<Record<St2CarShot, number>> = {
  [St2CarShot.DriveUp]: 0x148,
  [St2CarShot.Crash]: 0x14e,
  [St2CarShot.Stop]: 0x14d,
};

/**
 * `g_cam_path_length` (`0x00576D38`) at the three slots, read from the image:
 * `[0x00577258]` = `c8000000` (200), `[0x0057726C]` = `82000000` (130) and
 * `[0x00577270]` = `72010000` (370) -- the routine's `CMP EDX, [EAX*4 +
 * 0x576d38]` at `0x0045221C` and `0x00452230`. Only the last two are compared
 * -- `0x38` has no transition -- and 200 is kept so the table is the
 * routine's.
 */
export const ST2CAR_PATH_LENGTH: Readonly<Record<number, number>> = {
  0x148: 200, 0x14d: 130, 0x14e: 370,
};

/** `CMP [g_cam_path_frame], 0x50; JL` at `0x00452200`: on `0x3A` the spin
 * flag drops at frame 0x50 and stays down. */
export const ST2CAR_SPIN_STOP_FRAME = 0x50;

/** `ADD EDX, 0x1000` at `0x004521BE` -- BAMS the spin gains a frame. */
export const ST2CAR_SPIN_STEP = 0x1000;

/**
 * The parked car's second rotation: `op_` path `0x153` (`PUSH 0x153` at
 * `0x004522E9`), sampled at `n + 100.0` for `0 < n < 0x28` -- the constant is
 * `float [0x004C43B0]` = `0000c842`, 100.0 (L1: read from the image).
 */
export const ST2CAR_PART_YAW_PATH = 0x153;
export const ST2CAR_PART_YAW_OFFSET = 100;
export const ST2CAR_PART_YAW_FRAMES = 0x28;
/** `MOV ECX, 0x4000; SUB ECX, EAX` at `0x004522F7`. */
export const ST2CAR_PART_YAW_BASE = 0x4000;

/** `g_script_flags[0]` -- `MOV AL, [0x009c7200]; CMP AL, 1` at `0x004522A0`. */
export const ST2CAR_KILL_FLAG = 0;

/**
 * `g_st2car_asset_variants` — `0x00565F2C`, `int[2][4]`, read from the
 * image: `2d000000 2f000000 34000000 31000000` then `2e000000 30000000
 * 35000000 32000000`. {@link St2CarDraw} takes column `c` of row
 * `obj+0x13F0` as `[EAX + 0x565f2c + 4c]` after `SHL EAX, 0x4` (`0x0045235B`,
 * `0x004523A7`, `0x004524C5`, `0x00452515`). Through the pol slot list the
 * eight slots are `pol/char_adv04.bin` entries 2..10.
 */
export const ST2CAR_ASSET_VARIANTS: readonly (readonly number[])[] = [
  [0x2d, 0x2f, 0x34, 0x31],
  [0x2e, 0x30, 0x35, 0x32],
];

/** The two rows of {@link ST2CAR_ASSET_VARIANTS}, as `obj+0x13F0` holds them. */
export enum St2CarAssetRow {
  /** {@link St2CarInit} writes 0 at `0x00452157`. */
  Intact = 0,
  /**
   * `St2CarRouteUpdate` writes 1 at `0x00452239`, when shot `0x39` runs
   * out -- and nothing else writes the word. `[likely]` the crashed car: that
   * shot is the unshot branch's, and its script plays
   * `STAGE2_SE\BRIDGE_CRASH1_22.wav` (0x519A9) at frame 340 of it (stage 2
   * block 11 step 1), thirty frames before the swap.
   */
  Crashed = 1,
}

/**
 * The roll limiter {@link St2CarDraw} runs on `MatrixGetAngles`' roll before
 * the second frame re-applies it, `0x00452414`..`0x0045245A`: `r = roll &
 * 0xFFFF`, then `r <= 0x800` is 0, `r <= 0x4000` loses 0x800, `r < 0xC000`
 * passes, `r >= 0xE800` is 0, and the rest lose 0xE800. The immediates.
 */
export const ST2CAR_ROLL_DEADZONE_POS = 0x800;
export const ST2CAR_ROLL_PASS_LO = 0x4000;
export const ST2CAR_ROLL_PASS_HI = 0xc000;
export const ST2CAR_ROLL_DEADZONE_NEG = 0xe800;

/**
 * One `AssetDrawSlot` of {@link St2CarDraw}'s four, and what its push did
 * after `MatrixTranslate`-ing to the part. `[port-only]` in shape: the
 * engine draws, and the port hands `render/rigs.ts` the words to draw from.
 */
export interface St2CarDrawnPart {
  /** `g_st2car_asset_variants[obj+0x13F0][column]`. */
  slot: number;
  /**
   * The push hangs off the **roll-limited** frame (columns 2 and 3) rather
   * than the body's (columns 0 and 1).
   */
  limited: boolean;
  /** `MatrixRotateY` after the translation, BAMS; 0 where the routine makes
   * no call, which is the same matrix. */
  rotY: number;
  /** `MatrixRotateX` after the translation, BAMS; 0 likewise. */
  rotX: number;
}

/** `[port-only]` -- everything one {@link St2CarDraw} drew. */
export interface St2CarDrawList {
  /** The four draws, in column order. Empty before the first draw. */
  parts: St2CarDrawnPart[];
  /**
   * The roll-limited frame, re-applied at the car's position as
   * `MatrixRotateY(yaw); MatrixRotateX(pitch); MatrixRotateZ(roll)`
   * (`0x0045247B`, `0x00452485`, `0x0045248B`), BAMS.
   */
  limited: { pitch: number; yaw: number; roll: number };
}

/**
 * Which routine is installed at `obj+0x00`. The engine keeps a function
 * pointer; the numbers are the port's.
 */
export enum St2CarRoutine {
  /** {@link St2CarInit}, `0x00452150` -- what {@link St2CarSpawn} installs.
   * Linked, not cited: see L42 on citing a routine in the file that ports
   * it. */
  Init = 0,
  /** {@link St2CarRouteUpdate}, `0x004521B0`. */
  Route = 1,
  /** {@link St2CarHeldUpdate}, `0x004522A0`. */
  Held = 2,
  /** `St2CarTrainingWaitUpdate` (`FUN_004528B0`) -- see {@link St2CarInit}. */
  TrainingWait = 3,
}

/** The 0x13F4-byte task, as far as its own routines use it. Plain data. */
export interface St2Car {
  /** `[port-only]` -- the engine's identity is the task pointer. */
  id: number;
  /** `obj+0x00`, as a value. */
  routine: St2CarRoutine;
  /** `obj+0x1310`, `obj+0x1312` -- s16s `St2CarSpawn` zeroes. Nothing in the
   * car's own routines reads either. */
  state: number;
  sub: number;
  /** `obj+0x1350` -- the instance index, a row of `g_st2car_path_table`. 0
   * for the one arcade car; only the Training poser reads it. */
  index: number;
  /**
   * `obj+0x1320` -- 1 from the Init; `St2CarDraw` rotates two parts by
   * {@link spin} only while it is set. `St2CarRouteUpdate` drops it for good
   * at frame 0x50 of shot `0x3A`.
   */
  spinOn: number;
  /** `obj+0x1324` -- frames parked; `St2CarDraw` applies {@link partYaw}
   * only while it is non-zero. */
  heldFrames: number;
  /** `obj+0x132C` -- the Training poser's own frame counter. */
  trainingFrame: number;
  /** `obj+0x1330` -- BAMS, `+= 0x1000` every frame `St2CarRouteUpdate` runs
   * and never reset. */
  spin: number;
  /** `obj+0x1334` -- BAMS, the RotY {@link St2CarDraw} gives its second part
   * once parked. `[likely]` the driver's door: drawn, it is the door the
   * rescued man climbs out through. */
  partYaw: number;
  /** `obj+0x13F0` -- the row of {@link ST2CAR_ASSET_VARIANTS} the draw takes
   * its four slots from; {@link St2CarAssetRow.Crashed} once shot `0x39` has
   * run out. */
  variant: St2CarAssetRow;
  /** `obj+0x40`..`+0x48` and `+0x64`/`+0x68`/`+0x6C` -- the pose
   * `CamEvalObjectPath6` wrote, rotations in BAMS. */
  pos: Vec3;
  pitch: number;
  yaw: number;
  roll: number;
  /**
   * `[port-only]` -- a pose has been written. The engine's pose words are
   * whatever the heap held (`ActorAlloc`, `FUN_004A6FA0`, zeroes only the
   * 0x34-byte header: `MOV ECX, 0xD; REP STOSD` at `0x004A6FAE`) until the
   * first `CamEvalObjectPath6`, and the port has no such bytes to draw at.
   */
  posed: boolean;
  /** `[port-only]` -- this frame's routine called {@link St2CarDraw}. */
  drawn: boolean;
  /** `[port-only]` -- what that draw drew; stale while {@link drawn} is
   * false. */
  draw: St2CarDrawList;
}

/**
 * `St2CarSpawn` — `FUN_00452120`.
 *
 * ```c
 * obj = ActorAlloc(St2CarInit, 0x13F4);
 * obj->+0x1310 = 0;  obj->+0x1312 = 0;
 * obj->+0x1350 = (int)(short)index;
 * ```
 *
 * Appended, as `ActorAlloc` appends: the Init runs as the task's first update,
 * in {@link St2CarsTick}, which the director runs after the tasks the scene
 * made before it.
 */
export function St2CarSpawn(index: number): St2Car {
  const car: St2Car = {
    id: G.g_st2_car_seq++,
    routine: St2CarRoutine.Init,
    state: 0,
    sub: 0,
    // `MOVSX ECX, word ptr [ESP+4]` at `0x00452142`.
    index: (index << 16) >> 16,
    spinOn: 0,
    heldFrames: 0,
    trainingFrame: 0,
    spin: 0,
    partYaw: 0,
    variant: St2CarAssetRow.Intact,
    pos: vec3(),
    pitch: 0,
    yaw: 0,
    roll: 0,
    posed: false,
    drawn: false,
    draw: { parts: [], limited: { pitch: 0, yaw: 0, roll: 0 } },
  };
  G.g_st2_cars.push(car);
  return car;
}

/**
 * `St2CarInit` — `FUN_00452150`.
 *
 * ```c
 * obj->+0x13F0 = 0;  obj->+0x1330 = 0;  obj->+0x1334 = 0;
 * obj->+0x1320 = 1;  obj->+0x1324 = 0;
 * if (g_GameMode != 2) { St2CarRouteUpdate(obj); *obj = St2CarRouteUpdate; return; }
 * obj->+0x132C = 0;  St2CarTrainingWaitUpdate(obj);  *obj = St2CarTrainingWaitUpdate;
 * ```
 *
 * **The pointer is written after the call**, at `0x0045218C`, so a
 * `St2CarRouteUpdate` that parks the car on its very first frame is overruled
 * and runs again next frame. Kept in that order.
 *
 * [diverges] The Training arm installs `St2CarTrainingWaitUpdate`
 * (`FUN_004528B0`) and its poser `St2CarTrainingDriveUpdate` (`FUN_00452930`),
 * the traffic of the Training lesson: `g_training_lesson` tables at
 * `0x00565F46`/`0x00565F66`/`0x00565FA6` and the eight `op_train` paths. They
 * are not ported -- no stage bundle is exported in Training (`ResetGameOnStart`
 * sends that mode to scene 6) and class 0x21's own Training arm,
 * `RescueTargetTrainingWaitState` (`FUN_00452540`), is not ported either -- so
 * a Training car here waits undrawn, which is also what the wait routine does
 * until its cue.
 */
export function St2CarInit(car: St2Car, host: GameHost): void {
  car.variant = St2CarAssetRow.Intact;
  car.spin = 0;
  car.partYaw = 0;
  car.spinOn = 1;
  car.heldFrames = 0;
  if (G.g_GameMode !== GameMode.Training) {
    St2CarRouteUpdate(car, host);
    car.routine = St2CarRoutine.Route;
    return;
  }
  car.trainingFrame = 0;
  car.routine = St2CarRoutine.TrainingWait;
}

/**
 * `St2CarRouteUpdate` — `FUN_004521B0`.
 *
 * ```c
 * obj->+0x1330 += 0x1000;
 * switch (g_active_cam_path) {
 *   case 0x38: path = 0x148; break;
 *   case 0x39: path = 0x14E; break;
 *   case 0x3A: path = 0x14D; break;
 *   default:   path = (short)obj;           // MOV ECX, [ESP+0x20] at 0x004521F2
 * }
 * if (g_active_cam_path == 0x39) {
 *     if (g_cam_path_frame >= g_cam_path_length[path]) {
 *         obj->+0x13F0 = 1;  *obj = St2CarHeldUpdate;
 *     }
 * } else if (g_active_cam_path == 0x3A) {
 *     if (g_cam_path_frame >= 0x50) obj->+0x1320 = 0;
 *     if (g_cam_path_frame >= g_cam_path_length[path]) *obj = St2CarHeldUpdate;
 * }
 * CamEvalObjectPath6(path, (float)g_cam_path_frame, &p);
 * obj->+0x40.. = p.xyz;  obj->+0x64.. = p.rx, p.ry, p.rz;
 * St2CarDraw(obj);
 * ```
 *
 * **The pose is written after the hand-over**, on the same frame, at a frame
 * `>= ` the path's length: the parked pose is the path sampled where the
 * camera stood when the test passed, with no clamp -- `CamEvalObjectPath6`
 * (`FUN_004042D0`) has none, and neither does this routine.
 *
 * [diverges] On any other camera path the engine passes the task's own
 * pointer, truncated to 16 bits, as the path index, and draws at whatever
 * `CamEvalObjectPath6` reads out of the table with it. That is not a value
 * the port can have, so it writes no pose and the draw is at the last pose
 * written (none, before the first). In an unbroken run it is unreachable
 * after the first frame -- the three shots are back to back and the car parks
 * inside the third -- which is what the rig data's "harmless only because the
 * actor exists solely during those three shots" meant; a seek that makes the
 * car past them reaches it.
 */
export function St2CarRouteUpdate(car: St2Car, host: GameHost): void {
  car.spin = (car.spin + ST2CAR_SPIN_STEP) | 0;
  const cam = G.g_active_cam_path;
  const frame = G.g_cam_path_frame;
  const path = cam === St2CarShot.DriveUp || cam === St2CarShot.Crash
      || cam === St2CarShot.Stop
    ? ST2CAR_SHOT_PATH[cam as St2CarShot] : null;
  if (cam === St2CarShot.Crash) {
    if (path !== null && frame >= (ST2CAR_PATH_LENGTH[path] ?? Infinity)) {
      car.variant = St2CarAssetRow.Crashed;
      car.routine = St2CarRoutine.Held;
    }
  } else if (cam === St2CarShot.Stop) {
    if (frame >= ST2CAR_SPIN_STOP_FRAME) car.spinOn = 0;
    if (path !== null && frame >= (ST2CAR_PATH_LENGTH[path] ?? Infinity)) {
      car.routine = St2CarRoutine.Held;
    }
  }
  if (path !== null) {
    const p = host.objectPath?.(path, frame);
    if (p) {
      car.pos.x = p.x;
      car.pos.y = p.y;
      car.pos.z = p.z;
      // `__ftol` on each: the three rotations are ints (L2).
      car.pitch = Math.trunc(p.pitch ?? 0);
      car.yaw = Math.trunc(p.yaw ?? 0);
      car.roll = Math.trunc(p.roll ?? 0);
      car.posed = true;
    }
  }
  St2CarDraw(car);
}

/**
 * `St2CarHeldUpdate` — `FUN_004522A0`. Parked.
 *
 * ```c
 * if (g_script_flags[0] == 1) { ActorKill(); return; }
 * n = ++obj->+0x1324;
 * if (0 < n && n < 0x28) {
 *     CamEvalObjectPath6(0x153, (float)n + 100.0, &p);
 *     obj->+0x1334 = 0x4000 - p.ry;
 * }
 * St2CarDraw(obj);
 * ```
 *
 * The body pose is never written again: the car stays where
 * {@link St2CarRouteUpdate} left it. What moves is one part, for 39 frames,
 * on a path of its own. Returns false once the task has killed itself --
 * `ActorKill` (`FUN_004A7040`) unlinks it and longjmps out, so nothing is
 * drawn that frame.
 */
export function St2CarHeldUpdate(car: St2Car, host: GameHost): boolean {
  if ((G.g_script_flags[ST2CAR_KILL_FLAG] ?? 0) === 1) return false;
  car.heldFrames = (car.heldFrames + 1) | 0;
  const n = car.heldFrames;
  if (n > 0 && n < ST2CAR_PART_YAW_FRAMES) {
    const p = host.objectPath?.(ST2CAR_PART_YAW_PATH,
                                n + ST2CAR_PART_YAW_OFFSET);
    if (p) car.partYaw = (ST2CAR_PART_YAW_BASE - Math.trunc(p.yaw ?? 0)) | 0;
  }
  St2CarDraw(car);
  return true;
}

/**
 * `St2CarDraw` — `FUN_00452320`. The whole routine, `0x00452320`..
 * `0x0045253F` (the listing; Ghidra's body stops at the second
 * `MatrixStackPop`, L35):
 *
 * ```c
 * row = g_st2car_asset_variants[obj->+0x13F0];
 * Push(0); Translate(obj->+0x40..); RotZ(+0x6C); RotY(+0x68); RotX(+0x64);
 *   AssetDrawSlot(row[0]);
 *   Push(0); Translate(9.0583, 6.3682, 8.9433);              // nested
 *     if (obj->+0x1324) RotY(obj->+0x1334);
 *     AssetDrawSlot(row[1]);
 *   Pop(1);
 * Pop(1);
 * Push(0); LoadIdentity(); RotZ(+0x6C); RotY(+0x68); RotX(+0x64);
 *   MatrixGetAngles(&x, &y, &z);
 * Pop(1);
 * r = z & 0xFFFF;  lim = <the deadzone>;
 * Push(0); Translate(obj->+0x40..); RotY(y); RotX(x); RotZ(lim);
 *   Push(0); Translate(0, 3.1675, 13.6489);
 *     if (obj->+0x1320) RotX(obj->+0x1330);
 *     AssetDrawSlot(row[2]);
 *   Pop(1);
 *   Push(0); Translate(0, 3.1675, -9.48);
 *     if (obj->+0x1320) RotX(obj->+0x1330);
 *     AssetDrawSlot(row[3]);
 *   Pop(1);
 * Pop(1);
 * ```
 *
 * `[port-only]` in what it produces: the matrix stack and the draws are
 * `render/`'s, so this computes everything the routine decides -- which row,
 * which rotation each push takes and the second frame's three angles -- and
 * leaves it on {@link St2Car.draw} for `render/rigs.ts` to place the parts
 * with. The translations are the rig data's (`tools/hod2lib/rigs.py`
 * `OBJ_452320`), transcribed from the same `PUSH imm32`s.
 *
 * A skipped rotation is **not** a held one: once `St2CarRouteUpdate` clears
 * `+0x1320` at frame 0x50 of shot `0x3A`, the spun parts are drawn at `RotX`
 * of nothing, wherever the spin had got to.
 */
export function St2CarDraw(car: St2Car): void {
  const row = ST2CAR_ASSET_VARIANTS[car.variant];
  // `MatrixGetAngles` (`FUN_004018E0`) of `RotZ; RotY; RotX` after a
  // `MatrixLoadIdentity`, at `0x004523D2`..`0x00452401`.
  const a = MatrixGetAngles(RotZYX(car.roll, car.yaw, car.pitch));
  // `AND EAX, 0xFFFF` at `0x00452414`, so the `JL` after it never jumps.
  const r = a.z & 0xffff;
  let roll: number;
  if (r > ST2CAR_ROLL_PASS_LO) {
    if (r < ST2CAR_ROLL_PASS_HI) roll = r;
    else if (r >= ST2CAR_ROLL_DEADZONE_NEG) roll = 0;
    else roll = r - ST2CAR_ROLL_DEADZONE_NEG;       // `LEA EDI, [EAX - 0xE800]`
  } else if (r > ST2CAR_ROLL_DEADZONE_POS) {
    roll = r - ST2CAR_ROLL_DEADZONE_POS;            // `LEA EDI, [EAX - 0x800]`
  } else {
    roll = 0;
  }
  // `TEST [ESI+0x1324]` at `0x0045238B`; `TEST [ESI+0x1320]` at `0x004524A8`
  // and again at `0x004524F9`.
  const partYaw = car.heldFrames !== 0 ? car.partYaw : 0;
  const spin = car.spinOn !== 0 ? car.spin : 0;
  car.draw = {
    // Only rows 0 and 1 are ever written to `obj+0x13F0`.
    parts: row ? [
      { slot: row[0], limited: false, rotY: 0, rotX: 0 },
      { slot: row[1], limited: false, rotY: partYaw, rotX: 0 },
      { slot: row[2], limited: true, rotY: 0, rotX: spin },
      { slot: row[3], limited: true, rotY: 0, rotX: spin },
    ] : [],
    limited: { pitch: a.x, yaw: a.y, roll },
  };
  car.drawn = true;
}

/**
 * `[port-only]` -- the cars' task-list slots, once a frame, in allocation
 * order: the indirect call through `obj+0x00`, written as a `switch`. A task
 * that kills itself leaves the list.
 */
export function St2CarsTick(host: GameHost): void {
  if (!G.g_st2_cars.length) return;
  G.g_st2_cars = G.g_st2_cars.filter((car) => {
    car.drawn = false;
    switch (car.routine) {
      case St2CarRoutine.Init: St2CarInit(car, host); return true;
      case St2CarRoutine.Route: St2CarRouteUpdate(car, host); return true;
      case St2CarRoutine.Held: return St2CarHeldUpdate(car, host);
      // See `St2CarInit`'s declared divergence: not ported, and undrawn.
      case St2CarRoutine.TrainingWait: return true;
    }
    return true;
  });
}

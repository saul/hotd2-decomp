/**
 * Class 0x41 constructor 3 -- the stage-1 car's moving reflection.
 *
 * `PlaceType3UvScrollTask` allocates a 0x88-byte task and nothing else; the
 * task draws nothing either. It rewrites, in place, the UVs of three models
 * the stage-1 vehicle rig draws -- `char_adv00.bin[54]`, `[53]` and `[51]`,
 * slots `0x157E`, `0x157D` and `0x157B`, the translucent shells over the body
 * and the two sides -- so the reflection texture slides across the car as the
 * car turns against the camera and as the camera rises. Two spawns: stage 1
 * block 0 step 1 (evt `0x076C`) and scene 10 block 0, which the player does
 * not bundle.
 *
 * ## The model the walks rewrite
 *
 * Each of the three slots is a chain of strips. A header (a negative first
 * word) is 0x50 bytes; a strip is `{type, count}` and `count` vertex records,
 * a full one (flag bit 0 set) 0x20 bytes with `u` at `+0x18` and `v` at
 * `+0x1C`, any other 8. The Init touches every header and every full vertex
 * once; the Update moves every full vertex's `u` and `v` each frame. Both are
 * the same change to every vertex of a slot, so the port keeps it as one
 * transform a slot -- {@link Type3SlotUv} -- and `render/uv_scroll.ts` applies
 * it to the authored UVs.
 *
 * [diverges] The engine rounds each vertex's `u` and `v` to float after every
 * frame's add and ORs 1 into the bits of `v` (`OR EBP,0x1` at `0x00465B22`,
 * `OR EBP,EBX` at `0x00465F14`); the port keeps the running sums in doubles.
 * Both are below a float's last place on a UV of order one, and keeping them
 * would mean every vertex's UVs in `G` -- the departure the canal water's walk
 * (`class41/water.ts`) declares for the same instructions.
 *
 * [diverges] Both walks test the slot record's residency bit,
 * `g_asset_slots[slot] +0xD & 0x80` (`TEST byte [ECX+0x9a66ad],0x80`), and
 * the port keeps it only for the files the script loads and frees with
 * opcodes 0x52 and 0x53 (`game/pol_files.ts`), which `char_adv00.bin`, the
 * car's own file, is not: no stage-1 instruction loads it, so it arrives by
 * some other load the port does not model. So the three slots are taken as
 * resident whenever the task runs. Stage 1 has the file from its first step; the input that would differ
 * is a slot freed while the task lives, which stage 1 never does. The Init's
 * count of three resident slots is reached on its first frame, which the port
 * test pins.
 */
import { G } from "../globals";
import type { GameHost } from "../host";
import { CameraBlockEye, CameraBlockYaw } from "../camera/view";
import { vec3, type Vec3 } from "../vec";

/** The three slots, in the walks' own order (`0x004659E9`..`0x004659F9`). */
export const TYPE3_SLOTS: readonly number[] = [0x157e, 0x157d, 0x157b];

/** `ActorAlloc(Type3UvScrollInit, 0x88)` -- the task's size. */
export const TYPE3_TASK_SIZE = 0x88;

/** `CMP word [0x009a1a08],DI` with `DI = 0xA` -- the scene the other arm is for. */
const SCENE_ALT = 10;

/** `DAT_0055d218` -- f32 1/3. */
const THIRD = Math.fround(1 / 3);
/** `DAT_00565de0` -- f32 2/3. */
const TWO_THIRDS = Math.fround(2 / 3);
/** `DAT_005644f4` -- f32 0.7, slot `0x157E`'s `v` offset in scene 10. */
const ALT_V_OFFSET_BODY = Math.fround(0.7);
/** `DAT_004c43ac` -- f32 0.5, the other two slots' in scene 10. */
const ALT_V_OFFSET_SIDE = 0.5;
/** `MOV dword [ESP+0xc],0x3f000000` at `0x00465B44` -- every header's base alpha. */
export const TYPE3_BASE_ALPHA = 0.5;

/** `MOV dword [ESI+0x50],0x4344c5c9` at `0x00465B9A`. */
const SEED_EYE_Y = Math.fround(196.77259826660156);
/** `DAT_00569060` -- f32 0.016, the side shells' `u` per unit of turn. */
const SIDE_U_GAIN = Math.fround(0.016);
/** `DAT_00569064` -- f32 0.0032, scene 10's eye-motion gain. */
const ALT_EYE_GAIN = Math.fround(0.0032);
/** `DAT_00569068` -- f32 0.006, `v` per unit the eye rises. */
const RISE_V_GAIN = Math.fround(0.006);
/** `DAT_0056906c` -- f32 2.25e-5, the turn's gain in BAMS. */
const TURN_GAIN = Math.fround(2.25e-5);
/** `DAT_0055cb98` -- f32 0.001, the swerve's gain in BAMS. */
const SWERVE_GAIN = Math.fround(0.001);
/** `DAT_004c43b0` -- f32 100.0, how far into path `0xFF` the swerve reads. */
const SWERVE_FRAME_BIAS = 100.0;

/** `CMP EAX,0x21` / `CMP EAX,0x20` -- the two camera paths of the drive. */
const CAM_PATH_DRIVE_B = 0x21;
const CAM_PATH_DRIVE_A = 0x20;
/** `CMP ECX,0x15e` at `0x00465C54` -- path `0x21`'s frame the swerve starts on. */
const SWERVE_START_FRAME = 0x15e;
/** `CMP ECX,0x32` at `0x00465D21` -- the swerve reads while the frame is below. */
const SWERVE_FRAMES = 0x32;
/** The three `op_` paths: the car on each camera path, and the swerve. */
const OBJ_PATH_ON_A = 0xfd;
const OBJ_PATH_ON_B = 0xfe;
const OBJ_PATH_SWERVE = 0xff;

/** `g_actor_kill_all` -- `0x009C72E0`, which is `g_script_flags[0xE0]`. */
const ACTOR_KILL_ALL_FLAG = 0xe0;

/**
 * `[port-only]` in shape -- what the two walks have done to one slot's model,
 * which the engine rewrites in place: every full vertex's
 * `u' = u * uScale + uOffset` and `v' = v * vScale + vOffset`, and every
 * header's TSP word `| 0x2000` (filter mode 1, bilinear) with base colour A
 * {@link TYPE3_BASE_ALPHA}. One entry per slot an Init has walked.
 */
export interface Type3SlotUv {
  slot: number;
  uScale: number;
  uOffset: number;
  vScale: number;
  vOffset: number;
}

/** The task's words. The engine's handler pointer is {@link stage}. */
export interface Type3UvScrollTask {
  /** `[port-only]` -- the engine's identity is the task pointer. */
  id: number;
  /** `+0x00` -- the handler: the Init until it finds all three slots. */
  stage: "init" | "update";
  /** `+0x34` / `+0x3C` -- the swerve's first turn, scaled, its two halves. */
  o34: number;
  o3c: number;
  /** `+0x40..+0x48` -- the camera block's eye at the end of the last run. */
  eye: Vec3;
  /** `+0x4C`, `+0x54` -- the car's path position, kept and never read. */
  pathX: number;
  pathZ: number;
  /** `+0x50` -- block 0's eye height last frame. */
  eyeY: number;
  /** `+0x58` -- the swerve has started. */
  swerving: number;
  /** `+0x5C` -- the swerve path's yaw, less a quarter turn. */
  o5c: number;
  /** `+0x60` -- the same, kept for the next frame's difference. */
  o60: number;
  /** `+0x64` -- the swerve's first frame has been taken. */
  o64: number;
  /** `+0x84` -- resident slots counted, over every run of the Init. */
  resident: number;
}

/** The entry for `slot`, made the first time a walk touches it. */
function SlotUv(slot: number): Type3SlotUv {
  let e = G.g_type3_slot_uv.find((x) => x.slot === slot);
  if (!e) {
    e = { slot, uScale: 1, uOffset: 0, vScale: 1, vOffset: 0 };
    G.g_type3_slot_uv.push(e);
  }
  return e;
}

/**
 * `PlaceType3UvScrollTask` -- `FUN_00462DF0`. `g_class41_constructors[3]`.
 *
 * ```
 * ActorClearGameFields(ActorAlloc(Type3UvScrollInit, 0x88))
 * ```
 *
 * Nothing of the placer is read: not its position, not its `+0x11C`.
 */
export function PlaceType3UvScrollTask(): Type3UvScrollTask {
  const t: Type3UvScrollTask = {
    id: ++G.g_type3_task_seq, stage: "init",
    o34: 0, o3c: 0, eye: vec3(), pathX: 0, pathZ: 0, eyeY: 0,
    swerving: 0, o5c: 0, o60: 0, o64: 0, resident: 0,
  };
  G.g_type3_tasks.push(t);
  return t;
}

/**
 * `Type3UvScrollInit` -- `FUN_004659D0`. Runs every frame until it has
 * counted three resident slots, then installs the Update.
 *
 * Per resident slot, `+0x84` counts it and every header gets TSP `| 0x2000`
 * and base colour A 0.5; every full vertex of slot `0x157E` gets `u * 1/3`
 * and `v * 2/3`, of the other two `v * 2/3` -- in scene 10, `u * 1/3` for all
 * three and `v * 1/3 + 0.7` (`0x157E`) or `+ 0.5`. **The count is never
 * reset**, so an Init that found two slots and ran again would scale those
 * two a second time; transcribed as it is.
 *
 * Then, with three counted: outside scene 10, `CamEvalObjectPath6(0xFD, 0.0)`
 * into `+0x4C` and `+0x54`; in scene 10 the call is skipped and the two words
 * take whatever the stack held -- nothing reads them. `+0x50 = 196.77`,
 * `+0x58 = 0`, `+0x64 = 0`.
 */
export function Type3UvScrollInit(t: Type3UvScrollTask, host?: GameHost): void {
  const eye = CameraBlockEye(G.g_camera_index);
  t.eye.x = eye.x; t.eye.y = eye.y; t.eye.z = eye.z;
  const alt = G.g_scene_index === SCENE_ALT;
  TYPE3_SLOTS.forEach((slot, i) => {
    // Resident: see the second departure in the file comment.
    t.resident += 1;
    const e = SlotUv(slot);
    if (i === 0) {
      e.uScale = Math.fround(e.uScale * THIRD);
      e.uOffset = Math.fround(e.uOffset * THIRD);
      if (alt) {
        e.vScale = Math.fround(e.vScale * THIRD);
        e.vOffset = Math.fround(e.vOffset * THIRD + ALT_V_OFFSET_BODY);
      } else {
        e.vScale = Math.fround(e.vScale * TWO_THIRDS);
        e.vOffset = Math.fround(e.vOffset * TWO_THIRDS);
      }
    } else if (alt) {
      e.uScale = Math.fround(e.uScale * THIRD);
      e.uOffset = Math.fround(e.uOffset * THIRD);
      e.vScale = Math.fround(e.vScale * THIRD);
      e.vOffset = Math.fround(e.vOffset * THIRD + ALT_V_OFFSET_SIDE);
    } else {
      e.vScale = Math.fround(e.vScale * TWO_THIRDS);
      e.vOffset = Math.fround(e.vOffset * TWO_THIRDS);
    }
  });
  if (t.resident < TYPE3_SLOTS.length) return;
  if (!alt) {
    const p = host?.objectPath?.(OBJ_PATH_ON_A, 0.0);
    if (p) { t.pathX = p.x; t.pathZ = p.z; }
  }
  t.eyeY = SEED_EYE_Y;
  t.swerving = 0;
  t.o64 = 0;
  t.stage = "update";
}

/** `|a - b|` as the routine takes it: subtract, and subtract the other way if negative. */
function AbsDiff(a: number, b: number): number {
  const d = (a - b) | 0;
  return d < 0 ? (b - a) | 0 : d;
}

/**
 * `Type3UvScrollUpdate` -- `FUN_00465BC0`. One frame of the scroll; false
 * when the task kills itself.
 *
 * Three rates, `a`, `b` and `c`, from one of three arms:
 *
 * * **scene 10**: the camera block's eye motion since last frame, each axis
 *   times 0.0032.
 * * **the drive** (`+0x58` clear, and not path `0x21` past frame `0x15E`):
 *   `d = |ry - camera block yaw|` of `op_` path `0xFE` -- `0xFD` while camera
 *   path `0x20` plays -- at the camera's frame, folded to `0x8000 - d` past a
 *   quarter turn; `a = c = d * 2.25e-5`, and `b` is block 0's eye height's
 *   rise since last frame times 0.006 (`FLD [0x009a60c4]`, block 0's by
 *   address, not by `g_camera_index`).
 * * **the swerve**: while the camera frame is in `[0, 0x32)`, `op_` path
 *   `0xFF` at `frame + 100`, its yaw less `0x4000` against last frame's. The
 *   first such frame only records the turn (`+0x34`, `+0x3C`) and moves
 *   nothing; after it `a` and `c` are the turn's scaled change less that,
 *   `b` 0. `+0x58` goes up either way and stays up.
 *
 * Then the walk: slot `0x157D`'s `u` gains `sqrt(c² + a²) * 0.016`, slot
 * `0x157B`'s loses it with two players in play, and every slot's `v` gains
 * `b`. Last, the camera block's eye into `+0x40..+0x48`.
 *
 * It kills itself on `g_actor_kill_all`, and on camera path `0x21` with
 * `g_cutscene_skipping` (`0x009A2230`) up (`0x00465C0C`): a skipped opening
 * freezes the reflection where it stands.
 */
export function Type3UvScrollUpdate(t: Type3UvScrollTask,
                                    host?: GameHost): boolean {
  if ((G.g_script_flags[ACTOR_KILL_ALL_FLAG] ?? 0) === 1) return false;
  if (G.g_active_cam_path === CAM_PATH_DRIVE_B
      && G.g_cutscene_skipping !== 0) {
    return false;
  }
  let a = 0;
  let b = 0;
  let c = 0;
  const cam = G.g_active_cam_path;
  const frame = G.g_cam_path_frame;
  if (G.g_scene_index === SCENE_ALT) {
    const eye = CameraBlockEye(G.g_camera_index);
    a = Math.fround((eye.x - t.eye.x) * ALT_EYE_GAIN);
    b = Math.fround((eye.y - t.eye.y) * ALT_EYE_GAIN);
    c = Math.fround((eye.z - t.eye.z) * ALT_EYE_GAIN);
  } else if (t.swerving === 0
             && !(cam === CAM_PATH_DRIVE_B && frame >= SWERVE_START_FRAME)) {
    const path = cam === CAM_PATH_DRIVE_A ? OBJ_PATH_ON_A : OBJ_PATH_ON_B;
    // A host with no `op_` paths leaves the scroll where it is.
    const p = host?.objectPath?.(path, frame);
    if (!p) return true;
    let d = AbsDiff(p.yaw ?? 0, CameraBlockYaw(G.g_camera_index));
    if (d > 0x4000) d = 0x8000 - d;
    a = Math.fround(d * TURN_GAIN);
    b = Math.fround((G.g_camera_block_eye.y - t.eyeY) * RISE_V_GAIN);
    t.pathX = p.x;
    t.eyeY = G.g_camera_block_eye.y;
    t.pathZ = p.z;
    c = a;
  } else {
    if (frame >= 0 && frame < SWERVE_FRAMES) {
      const p = host?.objectPath?.(OBJ_PATH_SWERVE, frame + SWERVE_FRAME_BIAS);
      if (!p) return true;
      const ry = ((p.yaw ?? 0) - 0x4000) | 0;
      t.o5c = ry;
      if (t.o64 === 0) {
        const d = AbsDiff(ry, t.o60);
        t.o34 = Math.fround(d * SWERVE_GAIN);
        t.o64 = 1;
        t.o60 = ry;
        t.swerving = 1;
        t.o3c = Math.fround(d * SWERVE_GAIN);
        Type3UvWalk(a, b, c);
        Type3StoreEye(t);
        return true;
      }
      const d = AbsDiff(ry, t.o60);
      // `FILD; FMUL; FSUB [ESI+0x34]; FSTP float` -- one rounding, at the store.
      a = Math.fround(d * SWERVE_GAIN - t.o34);
      t.o60 = ry;
      c = Math.fround(d * SWERVE_GAIN - t.o3c);
    }
    t.swerving = 1;
  }
  Type3UvWalk(a, b, c);
  Type3StoreEye(t);
  return true;
}

/**
 * `[port-only]` -- the vertex walk at `0x00465E57`, as one frame of the
 * per-slot transform the file comment describes.
 */
function Type3UvWalk(a: number, b: number, c: number): void {
  const slide = Math.sqrt(c * c + a * a) * SIDE_U_GAIN;
  TYPE3_SLOTS.forEach((slot, i) => {
    const e = SlotUv(slot);
    if (i === 1) e.uOffset += slide;
    else if (i === 2 && G.g_players_in_play > 1) e.uOffset -= slide;
    e.vOffset += b;
  });
}

/** `0x00465F3E`..`0x00465F98` -- the camera block's eye, kept for next frame. */
function Type3StoreEye(t: Type3UvScrollTask): void {
  const eye = CameraBlockEye(G.g_camera_index);
  t.eye.x = eye.x; t.eye.y = eye.y; t.eye.z = eye.z;
}

/**
 * `[port-only]` -- the tasks `PlaceType3UvScrollTask` allocated, once a
 * frame, each running the handler it holds. A task that ends leaves the list;
 * what it did to the models stays, as it does in the engine.
 */
export function Type3UvScrollTick(host?: GameHost): void {
  if (!G.g_type3_tasks.length) return;
  G.g_type3_tasks = G.g_type3_tasks.filter((t) => {
    if (t.stage === "init") { Type3UvScrollInit(t, host); return true; }
    return Type3UvScrollUpdate(t, host);
  });
}

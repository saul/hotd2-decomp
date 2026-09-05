/**
 * The transcribed object rigs. **Generated file.**
 *
 * Written by `tools/gen_rig_data.py` from `tools/hod2lib/rigs.py`, which is
 * where these came from and where the evidence for each one is. A rig is a
 * draw routine read by hand -- there is no rig data in the asset files at all,
 * only 168 `AssetDrawSlot` call sites with their transforms as `PUSH imm32` in
 * the instruction stream -- so every number here was disassembled once, and
 * re-typing them would be doing that work again with nothing to catch a slip.
 *
 * The evidence travels: `note`, `animated` and `condition` are fields, not
 * comments, so they are in this file too. What is only in `rigs.py` is the
 * prose between declarations.
 *
 * `tools/verify_exporters.py` fails when this file is stale. Re-run the
 * generator after editing `rigs.py` and commit the two together.
 */

import type { Rig } from "./rigs";

export const RIGS: readonly Rig[] = [
  {
    name: "st1_vehicle",
    routine: "FUN_0048E600",
    routes: [
      {
        slot: 253,
        camPaths: [32],
      },
      {
        slot: 254,
        camPaths: [33],
        stopFrame: 349,
        note: "obj+0x1320 is cleared once the frame passes 0x15D (349) and the routine then stops re-evaluating, so the pose is held at frame 349 -- never at 350, which is the path's own length",
      },
      {
        slot: 254,
        camPaths: [34],
        holdFrame: 350.0,
        note: "parked: CamEvalObjectPath6(0xFE, 350.0), a literal, not the camera frame",
      },
    ],
    parts: [
      {
        name: "body",
        slots: [5497, 5502],
        note: "drawn at the object root, no local transform",
      },
      {
        name: "part_898",
        slots: [2200],
        translation: [-4.6755, 9.0, 6.239],
        rotation_bams: [53248, 0, 0],
        note: "two consecutive MatrixTranslate calls, composed here",
      },
      {
        name: "part_8cc",
        slots: [2252],
        translation: [0.0, 10.739, 11.4021],
        animated: "RotX(-0x1C00) . RotZ(ftol(sin(DAT_009A32A0 << 9))) . RotX(+0x1C00) -- a swing about an axis tilted -39.375 deg from Z. Identity while the sin term is 0, which is the pose exported here",
      },
      {
        name: "side_left",
        slots: [5500, 5501],
        translation: [-10.0702, 6.1773, 6.8503],
        drawLayer: 12,
        animated: "RotY by obj+0x1334",
        pathRotation: {
          slot: 255,
          channel: "rot_y",
          axis: "y",
          offsetBams: -16384,
          frameOffset: 100.0,
          frameLo: 0.0,
          frameHi: 49,
          frameDefault: 150.0,
          camPaths: [34],
          note: "obj+0x1334 = CamEvalObjectPath6(0xFF, t).rot_y - 0x4000, where t = g_cam_path_frame + 100.0 for frames 0..0x31 and 150.0 outside that range",
        },
        note: "[likely] an occupant; drawn in layer 0xC, then the routine restores layer 8",
      },
      {
        name: "side_right",
        slots: [5498, 5499],
        translation: [10.077, 6.211, 6.8302],
        animated: "RotY by -obj+0x1334",
        condition: "the RotY is applied only while obj+0x1324 is set, which happens when two players are in play",
        pathRotation: {
          slot: 255,
          channel: "rot_y",
          axis: "y",
          scale: -1.0,
          offsetBams: -16384,
          frameOffset: 100.0,
          frameLo: 0.0,
          frameHi: 49,
          frameDefault: 150.0,
          camPaths: [34],
          condition: "only while obj+0x1324 is set, which happens when two players are in play",
          note: "obj+0x1334 = CamEvalObjectPath6(0xFF, t).rot_y - 0x4000, where t = g_cam_path_frame + 100.0 for frames 0..0x31 and 150.0 outside that range",
        },
        note: "[likely] the other occupant",
      },
      {
        name: "spinner_front",
        slots: [5503],
        translation: [0.0, 3.8497, 16.2239],
        animated: "RotX by obj+0x1330, which gains 0x2000 a frame while obj+0x1320 (moving) is set",
      },
      {
        name: "spinner_rear",
        slots: [5504],
        translation: [0.0, 3.8497, -12.6732],
        animated: "RotX by obj+0x1330",
      },
      {
        name: "trail_fl",
        slots: [2254],
        translation: [-9.63, 0.0, 15.989],
        animated: "model cycles DAT_009A32A0 % 12 + 0x8CE",
        condition: "only while obj+0x1320 (moving) is set",
        hiddenUnless: "moving",
        note: "[likely] a dust/spray trail behind a wheel",
      },
      {
        name: "trail_fr",
        slots: [2254],
        translation: [9.63, 0.0, 15.989],
        scale: [-1.0, 1.0, 1.0],
        animated: "model cycles DAT_009A32A0 % 12 + 0x8CE",
        condition: "only while obj+0x1320 (moving) is set",
        hiddenUnless: "moving",
      },
      {
        name: "trail_rl",
        slots: [2254],
        translation: [-9.63, 0.0, -12.9132],
        animated: "model cycles DAT_009A32A0 % 12 + 0x8CE",
        condition: "only while obj+0x1320 (moving) is set",
        hiddenUnless: "moving",
      },
      {
        name: "trail_rr",
        slots: [2254],
        translation: [9.63, 0.0, -12.9132],
        scale: [-1.0, 1.0, 1.0],
        animated: "model cycles DAT_009A32A0 % 12 + 0x8CE",
        condition: "only while obj+0x1320 (moving) is set",
        hiddenUnless: "moving",
      },
    ],
    note: "Draws car_pl.bin parts and char_adv00.bin occupants. Route selected by the active camera path: cp_st1 0/1 ride op_st1 0/1 in lockstep, and cp_st1 2 parks the car at the end of op_st1 1.",
  },
  {
    name: "obj_48ead0",
    routine: "FUN_0048EAD0",
    routes: [
      {
        slot: 342,
        camPaths: [124],
        bias: [0.0, 2.0, 0.0],
        note: "pose.y is biased by the literal 2.0 at 0x004E30F0 before the rotations, so it is baked into the anchor",
      },
      {
        slot: 343,
        camPaths: [125],
        bias: [0.0, 2.0, 0.0],
        note: "pose.y is biased by the literal 2.0 at 0x004E30F0 before the rotations, so it is baked into the anchor",
      },
      {
        slot: 344,
        camPaths: [126],
        bias: [0.0, 2.0, 0.0],
        note: "pose.y is biased by the literal 2.0 at 0x004E30F0 before the rotations, so it is baked into the anchor",
      },
      {
        slot: 345,
        camPaths: [127],
        bias: [0.0, 2.0, 0.0],
        note: "pose.y is biased by the literal 2.0 at 0x004E30F0 before the rotations, so it is baked into the anchor",
      },
      {
        slot: 346,
        camPaths: [130],
        bias: [0.0, 2.0, 0.0],
        note: "pose.y is biased by the literal 2.0 at 0x004E30F0 before the rotations, so it is baked into the anchor",
      },
      {
        slot: 347,
        camPaths: [133],
        bias: [0.0, 2.0, 0.0],
        note: "pose.y is biased by the literal 2.0 at 0x004E30F0 before the rotations, so it is baked into the anchor",
      },
      {
        slot: 348,
        camPaths: [134],
        bias: [0.0, 2.0, 0.0],
        note: "pose.y is biased by the literal 2.0 at 0x004E30F0 before the rotations, so it is baked into the anchor",
      },
      {
        slot: 349,
        camPaths: [135],
        bias: [0.0, 2.0, 0.0],
        note: "pose.y is biased by the literal 2.0 at 0x004E30F0 before the rotations, so it is baked into the anchor",
      },
      {
        slot: 409,
        camPaths: [246],
        bias: [0.0, 2.0, 0.0],
      },
      {
        slot: 409,
        camPaths: [247],
        bias: [0.0, 2.0, 0.0],
      },
      {
        slot: 409,
        camPaths: [248],
        bias: [0.0, 2.0, 0.0],
      },
    ],
    parts: [
      {
        name: "part_1a37",
        slots: [6711],
        animated: "Root Y rotation is overridden while the latch obj+0x1350 is set: obj+0x68 becomes the live camera yaw (0x009A6040 + cam*0x1A4 + 0x90) + 0x8000, i.e. the part turns to face 180 deg from the camera. The latch is toggled at hardcoded frames per path -- see docs/formats/cam.md. Exported at the path pose.",
        note: "drawn at the object root; FUN_004A8CA0 then snapshots the matrix into obj+0x150 for hit-testing, not a draw",
      },
    ],
    note: "Frame is min(g_frame, cam_path_length[slot]) -- clamped to the end of the path. On a camera path outside the table the pose is not refreshed and the object draws at whatever pose it last held.",
  },
  {
    name: "obj_48f050",
    routine: "FUN_0048F050",
    routes: [
      {
        slot: 371,
        camPaths: [174, 175, 178],
        frame: "zero",
        note: "frame is a literal 0.0f (6A 00), not the clamped frame",
      },
      {
        slot: 371,
        camPaths: [176],
      },
      {
        slot: 372,
        camPaths: [177],
      },
    ],
    parts: [
      {
        name: "part_185b",
        slots: [6235],
        note: "drawn directly on the object root",
      },
    ],
    note: "Jump table at 0x0048F17C, index cam_path - 0xAE. On any other camera path there is no path eval at all and the object draws with the pose it already holds. Push/pop depth 1.",
  },
  {
    name: "obj_48f190",
    routine: "FUN_0048F190",
    routes: [
      {
        slot: 378,
        camPaths: [205],
      },
      {
        slot: 379,
        camPaths: [206],
      },
      {
        slot: 380,
        camPaths: [207],
      },
      {
        slot: 381,
        camPaths: [209],
      },
    ],
    fixedPoses: [
      {
        translation: [528.4, -0.1, -308.2],
        rotation_bams: [0, 41325, 0],
        camPaths: [204],
        note: "hardcoded pose, no path eval",
      },
    ],
    parts: [
      {
        name: "part_8c7_145c",
        slots: [2247, 5212],
        note: "drawn on the held-open object-root push",
      },
      {
        name: "part_899",
        slots: [2201],
        translation: [-4.6755, 9.0, 6.239],
        rotation_bams: [53248, 0, 0],
        note: "two consecutive MatrixTranslate calls compose by addition: (-4.6755,0,0.239) then (0,9,6). rotX raw 68 00 d0 00 00 = 0xD000",
      },
      {
        name: "part_8cd",
        slots: [2253],
        translation: [0.0, 10.739, 11.4021],
        rotation_bams: [7168, 7168, 16384],
        note: "literal call order rotX(-0x1C00), rotZ(0x4000), rotX(+0x1C00); the triple here is the exact equivalent",
      },
      {
        name: "part_896",
        slots: [2198],
        translation: [-10.0702, 6.1773, 6.8503],
        animated: "RotY by obj+0x1334, a runtime yaw",
        note: "mirror partner of part_893",
      },
      {
        name: "part_893",
        slots: [2195],
        translation: [10.077, 6.211, 6.8302],
        animated: "RotY by -(obj+0x1334)",
        condition: "the rotation, not the draw, is applied only while obj+0x1324 is set",
      },
      {
        name: "part_157f",
        slots: [5503],
        translation: [0.0, 3.8497, 16.2239],
        animated: "RotX by obj+0x1330, a free-running accumulator gaining 0x2000 a frame in the sibling state",
      },
      {
        name: "part_1580",
        slots: [5504],
        translation: [0.0, 3.8497, -12.6732],
        animated: "RotX by obj+0x1330, same accumulator and sign",
      },
      {
        name: "part_145d",
        slots: [5213],
        animated: "drawn under its OWN root push after the main root push is popped, and its root translate substitutes y = g_camera_fixed_eye_y (0x009C8E58) for obj+0x44 whenever obj+0x1328 is set (cp 0xCC, 0xCD, 0xD2)",
        note: "a sibling of the root group, not a child of it",
      },
    ],
    note: "Jump table at 0x0048F53C, index cam_path - 0xCC; 0xD0 and 0xD2 do no path eval. ROOT YAW OVERRIDE: while obj+0x1350 is set the root Y becomes camera yaw + 0x8000, i.e. the rig faces the camera. Latch frames: cp 0xCE set@100 clear@200; 0xCF set@70,630 clear@230,970; 0xD1 set@80,470 clear@320,1215.",
  },
  {
    name: "obj_48f560",
    routine: "FUN_0048F560",
    routes: [
      {
        slot: 386,
        camPaths: [218],
        frame: "zero",
        note: "frame is a literal 0.0f",
      },
      {
        slot: 386,
        camPaths: [219],
      },
    ],
    fixedPoses: [
      {
        translation: [557.5, 2492.2, -9880.2],
        rotation_bams: [0, 30037, 0],
        camPaths: [220, 236],
        note: "hardcoded pose",
      },
    ],
    parts: [
      {
        name: "part_1913",
        slots: [6419],
        note: "drawn on the held-open object-root push",
      },
      {
        name: "part_afe_aff",
        slots: [2814, 2815],
        translation: [0.0, 6.5, 15.5],
        condition: "drawn only while g_active_cam_path == 0xDA",
      },
      {
        name: "part_afc_afd",
        slots: [2812, 2813],
        translation: [0.0, 6.5, -11.3],
        condition: "drawn only while g_active_cam_path is 0xDB or 0xEC",
      },
      {
        name: "part_digit_hi_a",
        slots: [2772],
        translation: [-6.4712, 26.4288, 14.8662],
        animated: "slot = 0xAD4 + n/10 over the bank 0xAD4..0xADD. n: cp 0xDA -> 1; cp 0xDB -> (int16)((min(g_frame, cam_path_length[0x182]) - 50)/6 + 5); cp 0xDC -> 50 if g_frame >= 84 else g_frame/6 + 36; cp 0xEC -> 50. All divisions signed-truncating.",
      },
      {
        name: "part_digit_lo_a",
        slots: [2782],
        translation: [-7.5321, 26.4152, 14.8665],
        animated: "slot = 0xADE + n%10 over the bank 0xADE..0xAE7",
      },
      {
        name: "part_digit_hi_b",
        slots: [2792],
        translation: [6.1895, 26.4288, -10.7128],
        animated: "slot = 0xAE8 + n/10 over the bank 0xAE8..0xAF1",
      },
      {
        name: "part_digit_lo_b",
        slots: [2802],
        translation: [7.2504, 26.4152, -10.7116],
        animated: "slot = 0xAF2 + n%10 over the bank 0xAF2..0xAFB",
      },
    ],
    note: "Byte-index table 0x0048F904 into targets at 0x0048F8F0. Push/pop depth 2, 7/7 balanced. KNOWN BUG, [proved]: on any camera path outside {0xDA,0xDB,0xDC,0xEC} the four digit slot indices are read from [ESP+0x2C], the routine's own obj argument slot reused as scratch and never written on that path, giving 0xAD4 + (int16)obj_ptr. [likely] unreachable, since the routine is only installed as the handler during those paths.",
  },
  {
    name: "obj_484ff0_props",
    routine: "FUN_00484FF0",
    worldSpace: true,
    variantParam: [
      6,
      "i16",
    ],
    spawnClass: 37,
    parts: [
      {
        name: "part_1a37_v1",
        slots: [6711],
        translation: [-1367.0, -17.0, -1845.3],
        rotation_bams: [0, 32768, 0],
        condition: "variant == 1",
        variant: 1,
        note: "raw x=0xC4AAE000 y=0xC1880000 z=0xC4E6A99A, rotY 0x8000 = 180 deg. World space.",
      },
      {
        name: "part_1a37_v2",
        slots: [6711],
        translation: [214.0, -17.0, -2172.0],
        rotation_bams: [0, 43690, 0],
        condition: "variant == 2",
        variant: 2,
        note: "raw x=0x43560000 y=0xC1880000 z=0xC507C000, rotY 0xAAAA. World space.",
      },
      {
        name: "part_10df_v4",
        slots: [4319],
        translation: [-636.0, 43.35, -952.0],
        rotation_bams: [49152, 0, 0],
        condition: "variant == 4 and g_active_cam_path == 0x93",
        variant: 4,
        note: "raw x=0xC41F0000 y=0x422D6666 z=0xC46E0000, rotX 0xC000 = 270 deg. World space.",
      },
      {
        name: "part_1a37_v3_path",
        slots: [],
        animated: "placed entirely from CamEvalObjectPath6(obj+0x135C, g_frame) -- the slot is runtime, so nothing is exported for this part",
        condition: "variant == 3",
        note: "slot 0x1A37 at the path pose",
      },
      {
        name: "part_24a_pair",
        slots: [],
        animated: "mirrored pair at x = +/-1.7, z = 20, under an anchor at (pose.x, -25.0, pose.z) rotated by the pose's heading alone (pitch and roll discarded by the matrix->Euler decomposition at FUN_00401AE0). Each draws slot 0x24A + (g_counter % 22), a 22-frame flipbook. Runtime slot, so nothing is exported.",
        condition: "variant == 3",
      },
    ],
    note: "variant = *(int16*)(obj+0x1390 + 6), which is descriptor +0x2A -- the parameter tail opcodes 0x0B/0x0C/0x0D attach. Variants 1 and 2 occur in stage 2, 3 and 4 in stage 3. The variant-4 descriptor sits at (-635.1, 43.0, -955.9), which is where the routine hardcodes part_10df_v4 -- independent corroboration of both readings. The variant-3 parts take their path slot from obj+0x135C at runtime and are still not placeable. The whole routine is gated on DAT_009A5900 & 0x20, and [likely] that bit is dead: of 54 references, the setters are OR 1/2/8/0x10/0x18 and nothing sets 0x20, so the early-out never fires in the retail build.",
  },
  {
    name: "obj_470b70",
    routine: "FUN_00470B70",
    routes: [
      {
        slot: 377,
        frame: "obj+0x2C0, advancing +1.0 a frame only while obj+0x192 == 1",
      },
    ],
    parts: [
      {
        name: "part_1871",
        slots: [6257],
        animated: "drawn at the path pose with obj+0x1C8 added to z; the frame freezes at 105, when obj+0x192 becomes 2",
        note: "the draw call is chosen at runtime -- SubmitSlotWithSceneLightArray(0x1871) when DAT_009A2BB4 is set, else AssetDrawSlot(0x1871). Same slot either way: a lighting variant, not a transform variant.",
      },
    ],
    note: "Push/pop depth 1. After the pop it transforms (pose.x, pose.y + 8.0, pose.z) by the parent matrix into obj+0x70..0x78 -- a world anchor, not a draw. Returns early to FUN_00409CC0 when DAT_009C8E98 == 5, and ActorKills when the object is out of its scene segment.",
  },
  {
    name: "obj_470080",
    routine: "FUN_00470080",
    routes: [
      {
        slot: 406,
      },
      {
        slot: 407,
      },
      {
        slot: 408,
      },
    ],
    parts: [
      {
        name: "part_obj28c",
        slots: [],
        scale: [2.5, 2.5, 2.5],
        animated: "composed transform is T(p + d0) . R . T(-R.d0) with d0 = (sin, 0, cos) * 0.15 and R = RotY.RotZ.RotX; rotX and rotZ are bounded to +/-640 BAMS but rotY is set outside the routine and unbounded, so the offset does not provably cancel. Slot is obj+0x28C.",
        note: "after the draw, Scale(0.4) then MatrixStore(obj+0x2E4) -- 2.5 * 0.4 == 1.0, so obj+0x2E4 gets the UNSCALED part matrix, an attach point for something else",
      },
    ],
    note: "Path slot comes from the word table at 0x00595778 indexed by (int16)obj+0x290, whose ~20 writers are spread across the binary, so which route an instance takes is per-instance. Two SEQUENTIAL push/pop pairs, not nested: the first draws nothing, it only builds a scratch rotation to transform one vector. The path's rotation output is read but never used -- only pose.xyz is stored. Rotation order here is Y, Z, X, NOT the usual Z, Y, X.",
  },
  {
    name: "obj_416b00",
    routine: "FUN_00416B00",
    routes: [
      {
        slot: 404,
        frame: "(age % 24), a 24-frame loop",
      },
    ],
    parts: [
      {
        name: "a_tbl",
        slots: [],
        scale: [0.1, 0.1, 0.1],
        drawLayer: 12,
        animated: "MatrixLoadIdentity first, so this draws in VIEW space. Slot = table[variant] + age. A second draw shares the same push, so its scale is cumulative on the 0.1: 0.075 when kind == 4, else 0.05.",
        condition: "record active and kind != 3; forced inactive at age >= 9",
      },
      {
        name: "b_spin",
        slots: [],
        drawLayer: 12,
        animated: "inherits the caller's matrix, then MatrixClearRotation (0x004A9F70) wipes the 3x3 -- a screen-axis billboard -- then RotZ gains 0x1000 BAMS (22.5 deg) per call",
        condition: "record active and kind != 5",
      },
      {
        name: "b_path404",
        slots: [4253],
        drawLayer: 12,
        animated: "Translate(record pos), then CamEvalObjectPath6(0x194, age % 24) and Translate of that pose -- the two translations compose by addition -- then MatrixClearRotation and the pose rotations. The record position is runtime, so this is not placeable either.",
        condition: "record active and kind == 5, which FUN_00416F70 only assigns while g_GameMode == 1",
      },
      {
        name: "c_0xa6f",
        slots: [],
        scale: [0.05, 0.05, 0.05],
        drawLayer: 12,
        animated: "VIEW space again; slot = 0xA6F + age over 24 frames. RotZ is seeded at spawn from rand() % 0xFFFF and is not animated.",
        condition: "g_GameMode == 1 and kind == 4 and record active",
      },
    ],
    note: "[likely] the per-shot gunfire effect set -- spawned from the player's crosshair at unit view depth by FUN_00416F70, per player, a ring of 6 with short frame-counted lifetimes, drawn in layer 0xC. Record layout [proved]: +0x00 s16 active, +0x02 s16 variant (= player index), +0x04/08/0C f32 pos, +0x10/14/18 i32 rot, +0x1C/20/24 f32 velocity, +0x28 i32 age, +0x2C i32 kind. Slot tables at 0x00579F78 and 0x00579F7C hold 373/383 and 2934/2948. Nothing here is placeable: see the parts.",
  },
  {
    name: "obj_432840",
    routine: "FUN_00432840",
    routes: [
      {
        slot: 325,
        note: "obj+0x11C == 0; held at frame 0x29F before launch",
      },
      {
        slot: 326,
        note: "obj+0x11C == 1; held at frame 0x29B before launch",
      },
      {
        slot: 329,
        note: "obj+0x11C == 2; held at frame 0",
      },
      {
        slot: 330,
        note: "obj+0x11C == 3; held at frame 0",
      },
    ],
    spawnClass: 40,
    parts: [
      {
        name: "part_0033",
        slots: [51],
        note: "drawn at the object root with no scale of its own, so it inherits the incoming scale. Slot is the literal 0x33 stored into obj+0x13F0 at init.",
      },
      {
        name: "part_135f",
        slots: [4959],
        translation: [0.0, 5.0, 0.0],
        scale: [1.5, 2.0, 1.0],
        animated: "slot = 0x135F + (frame counter 0x009A32A0 % 15), a 15-slot loop 0x135F..0x136D. RotY is a pure camera-facing yaw from VecToAngles(camX - obj.x, 0.0, camZ - obj.z) -- a billboard with no pitch. The object's own rotations are NOT applied to this part. The +5.0 is a bias on the path position, applied before the yaw.",
        condition: "only while obj+0x1320 == 0, i.e. before launch",
      },
      {
        name: "part_0b67",
        slots: [2919],
        translation: [0.0, 0.0, 12.0],
        scale: [7.0, 7.0, 7.0],
        animated: "slot = 0xB67 + (frame counter 0x009A32A0 & 7), an 8-slot loop 0xB67..0xB6E, advancing in step with part_135f. Reuses the same yaw, not recomputed. Its path-position bias is +8.0 in Y, NOT the 5.0 that part_135f uses; the (0,0,12) here is a genuine post-rotation offset, since the yaw sits between the two translates and so they do not compose.",
        condition: "only while obj+0x1320 == 0, i.e. before launch",
      },
    ],
    note: "Max matrix depth 1, 3 balanced push/pop pairs, all parts siblings. No SetDrawLayerNibble, so everything is on the default layer. Until obj+0x1320 flips the pose is the route sampled ONCE at the table's freeze frame and held; it flips on the first frame where g_active_cam_path == 0x2F and g_frame >= that freeze frame, and the pose then tracks the live frame. Killed once cam_path_length[route] <= g_frame. In g_mode(0x009C8E98) == 10 the route is replaced by a literal pose from 0x0055DD18 and the object is killed once the camera reaches path 8; only sub-types 0 and 1 have plausible records there, so those poses are recorded in the note rather than emitted. [open] what mode 10 denotes.",
  },
  {
    name: "obj_4331d0",
    routine: "SUB_004331D0",
    variantParam: [
      0,
      "i32",
    ],
    routeParam: [
      12,
      "i32",
    ],
    mainAssetParam: [
      0,
      "i32",
    ],
    spawnClass: 51,
    parts: [
      {
        name: "part_main_13f0",
        slots: [],
        animated: "slot is obj+0x13F0, taken from the spawn parameter block, so it is runtime and nothing is exported. Uniform scale is 1.0, or 2.5 for assets 0x1A35/0x1A36; asset 0x1A36 also gets ry += 0x4000.",
      },
      {
        name: "part_1aab",
        slots: [],
        animated: "a 40-frame loop over slots 0x1AAB..0x1AD2. Placed in WORLD space -- it is drawn before the object's own push -- at a pose copied from the spawn parameter block, with RotY set to face the live camera by VecToAngles and RotX forced to 0. [likely] fire or smoke: it is triggered 20 frames after detonation, which also spawns an explosion FX and a sound, and once set the flag never clears.",
        condition: "obj+0x34 & 0x00200000, set 20 frames after the object detonates",
      },
      {
        name: "part_024a",
        slots: [],
        translation: [0.0, 0.0, 25.0],
        scale: [0.6, 0.5, 0.7],
        animated: "a 22-slot loop 0x24A..0x25F, +1 per draw",
        condition: "main asset != 0x1B0E, and only while the path plays",
      },
      {
        name: "part_0260",
        slots: [],
        translation: [0.0, 0.0, 25.0],
        scale: [0.6, 0.5, 0.7],
        animated: "a 22-slot loop 0x260..0x275, +1 per draw",
        condition: "main asset != 0x1B0E, and only while the path plays",
        note: "transform is byte-for-byte identical to part_024a: two co-located sprite loops running different sequences",
      },
      {
        name: "part_0899",
        slots: [2201],
        translation: [-5.2664, 8.3328, 6.717],
        rotation_bams: [-11578, 0, 0],
        condition: "main asset == 0x1B0E",
        variant: 6926,
        note: "raw x=0xC0A88659 y=0x41055326 z=0x40D6F1AA; rotX 0xFFFFD2C6 = -11578 = -63.5999 deg",
      },
      {
        name: "part_08cb_a",
        slots: [2251],
        translation: [0.0, 3.5437, 17.0281],
        animated: "RotX by obj+0x135C, which gains 0x2000 BAMS (45 deg) once per draw immediately before this part",
        condition: "main asset == 0x1B0E",
        variant: 6926,
      },
      {
        name: "part_08cb_b",
        slots: [2251],
        translation: [0.0, 3.5437, -12.384],
        animated: "RotX by obj+0x135C -- the same value part_08cb_a just advanced, read and not incremented again, so the two are always in phase",
        condition: "main asset == 0x1B0E",
        variant: 6926,
      },
      {
        name: "part_1b0a",
        slots: [6922],
        translation: [10.0, 6.216, 6.878],
        condition: "main asset == 0x1B0E",
        variant: 6926,
      },
      {
        name: "part_1b0d",
        slots: [6925],
        translation: [-10.0, 6.216, 6.878],
        condition: "main asset == 0x1B0E",
        variant: 6926,
        note: "[likely] a mirrored pair with part_1b0a -- same y and z, x negated -- but they are different asset ids, so they are two distinct models rather than one mirrored twice",
      },
    ],
    note: "Max matrix depth 1, 8 balanced push/pop pairs, no nesting -- every part is a sibling. Two of the pushed blocks draw nothing; one caches the object's camera-space position. No SetDrawLayerNibble anywhere. The parts split into two MUTUALLY EXCLUSIVE sets by the main asset id at obj+0x13F0: 0x1B0E gets part_0899/part_08cb_a/part_08cb_b/part_1b0a/part_1b0d and never the sprite loops; anything else gets the sprite loops and never those five. Every configuration draws part_main_13f0, and part_1aab once detonated.",
  },
  {
    name: "obj_452320",
    routine: "FUN_00452320",
    routes: [
      {
        slot: 328,
        camPaths: [56],
        note: "poser FUN_004521B0; playlen 200, no end-of-path transition",
      },
      {
        slot: 334,
        camPaths: [57],
        note: "playlen 370. At frame >= 370 the asset set swaps to variant 1 and the think pointer becomes FUN_004522A0, which never re-samples a path -- so the body pose freezes there permanently. [likely] the crash.",
      },
      {
        slot: 333,
        camPaths: [58],
        note: "playlen 130. At frame >= 80 the X-spin flag obj+0x1320 is cleared permanently; at 130 the think pointer becomes FUN_004522A0 and the variant stays 0.",
      },
      {
        slot: 410,
        note: "traffic instance 3, poser FUN_00452930, route from int16[0x00565EF4 + obj+0x1350 * 2]; these are op_train paths, so they are not in a numbered stage export",
      },
      {
        slot: 411,
        note: "traffic instance 4, poser FUN_00452930, route from int16[0x00565EF4 + obj+0x1350 * 2]; these are op_train paths, so they are not in a numbered stage export",
      },
      {
        slot: 412,
        note: "traffic instance 5, poser FUN_00452930, route from int16[0x00565EF4 + obj+0x1350 * 2]; these are op_train paths, so they are not in a numbered stage export",
      },
      {
        slot: 413,
        note: "traffic instance 6, poser FUN_00452930, route from int16[0x00565EF4 + obj+0x1350 * 2]; these are op_train paths, so they are not in a numbered stage export",
      },
      {
        slot: 414,
        note: "traffic instance 7, poser FUN_00452930, route from int16[0x00565EF4 + obj+0x1350 * 2]; these are op_train paths, so they are not in a numbered stage export",
      },
      {
        slot: 415,
        note: "traffic instance 8, poser FUN_00452930, route from int16[0x00565EF4 + obj+0x1350 * 2]; these are op_train paths, so they are not in a numbered stage export",
      },
      {
        slot: 416,
        note: "traffic instance 9, poser FUN_00452930, route from int16[0x00565EF4 + obj+0x1350 * 2]; these are op_train paths, so they are not in a numbered stage export",
      },
      {
        slot: 417,
        note: "traffic instance 10, poser FUN_00452930, route from int16[0x00565EF4 + obj+0x1350 * 2]; these are op_train paths, so they are not in a numbered stage export",
      },
    ],
    parts: [
      {
        name: "part_002d",
        slots: [45],
        note: "the object root itself: Translate(pose) then RotZ, RotY, RotX from obj+0x40/44/48 and 0x6C/68/64. Variant 1 draws 0x2E instead.",
      },
      {
        name: "part_002f",
        slots: [47],
        translation: [9.0582619, 6.368186, 8.9433079],
        animated: "RotY by obj+0x1334, applied only while obj+0x1324 is non-zero -- which happens only under FUN_004522A0, after the shot-0x39 freeze. obj+0x1334 is then 0x4000 - CamEvalObjectPath6(0x153, t + 100.0).ry for t = 1..39, and frozen after. So this part only moves once the body has stopped.",
        parent: "part_002d",
        note: "raw z=0x410F17C2, y=0x40CBC84B, x=0x4110EECC. Variant 1 draws 0x30. [open] what it is: the geometry and the timing would fit a panel swinging open, but nothing in the code or any string says so.",
      },
      {
        name: "part_0034",
        slots: [52],
        translation: [0.0, 3.1674952, 13.6489019],
        animated: "RotX by obj+0x1330, applied only while obj+0x1320 is set. obj+0x1330 gains 0x1000 BAMS (22.5 deg) every frame under FUN_004521B0 and FUN_00452930, and is never reset; FUN_004522A0 does not advance it, so the spin freezes there.",
        note: "raw z=0x415A61E5, y=0x404AB852, x=0.0. Variant 1 draws 0x35. Its true parent is a roll-limited copy of the body frame: FUN_004018E0 decomposes Rz.Ry.Rx into a YXZ triple, then the roll r (&0xFFFF) is remapped -- r<=0x800 -> 0; 0x800<r<=0x4000 -> r-0x800; 0x4000<r<0xC000 -> r; 0xC000<=r<0xE800 -> r-0xE800; r>=0xE800 -> 0. An asymmetric deadzone over -33.75..+11.25 deg, identity at rest.",
      },
      {
        name: "part_0031",
        slots: [49],
        translation: [0.0, 3.1674952, -9.4799995],
        animated: "RotX by obj+0x1330, same rule and same gate as part_0034",
        note: "raw z=0xC117AE14, y=0x404AB852, x=0.0. Variant 1 draws 0x32. [likely] this and part_0034 are the wheels or axles: both sit on the centreline at x=0 and the same height, 23.13 apart in Z, both spin about X only at a constant rate under one shared flag, and their parent carries a roll limiter of exactly the kind you write so wheels do not cut through the ground when the body rolls. Note there are only TWO such parts and both are at x=0, so they are not four wheels; and the code gives no forward axis, so neither is named front or rear.",
      },
    ],
    note: "Max matrix depth 2, balanced. No SetDrawLayerNibble, no MatrixScale, no lit-submit variant and NO pose bias anywhere -- every pose is written verbatim from CamEvalObjectPath6. Spawned by FUN_00452120 -> FUN_004A6FA0(FUN_00452150, 0x13F4), which sets obj+0x1350 to the instance index; the think pointer is FUN_004521B0, or FUN_00452930 when g_GameMode == 2. ASSET VARIANT: every part draws dword[0x00565F2C + obj+0x13F0 * 0x10 + column], a 2x4 int table. Variant 0 is exported; variant 1 is the set it swaps to after shot 0x39 ends. Only two rows exist. LATENT BUG [proved], same shape as FUN_0048F560's: on a camera path other than 0x38/0x39/0x3A, FUN_004521B0 leaves the actor pointer in ECX and sign-extends its low 16 bits as the path index. Harmless only because the actor exists solely during those three shots. [open] asset identities -- slots 0x2D..0x35 are runtime indices with no static name table in the exe.",
  },
];

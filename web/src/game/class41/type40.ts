/**
 * Class 0x41 type 40 — `PlaceFragmentProps` and `PropUpdateType40`, whole.
 *
 * 28 spawns across stages 1, 2 and 4, twenty sub-kinds, and until this file
 * the port placed every one of them **at the placer's own point with draw
 * slot 0** — that is, at the world origin and invisible — because only the
 * branch arm of the update had been read. Stage 1's church is where that
 * showed: sub-kind 0 is eight objects standing on the pews (new bug 8), all
 * of them missing.
 *
 * What the constructor does, per sub-kind (`FUN_004636A0`, the switch read
 * through its jump table at `0x00463998` because the decompiler loses the
 * sub-kind-0 arm at its `MatrixStackPop` — L35):
 *
 * * **0** — eight objects, each `T(16.473, 16.821, 4.749) . RotY(0x278D) .
 *   T(x, 0, z)` of a row of `g_fragment_subkind0_offsets`, drawing `0x123E`.
 * * **1** — twelve, from `g_fragment_subkind1_poses` with their own angles,
 *   drawing `0x17C6` while `g_fragment_subkind1_intact[i]` holds and `0x17C7`
 *   once a game has broken it (or always `0x17C6` in Training).
 * * **2..19** — `g_fragment_pose_tables[sk]` rows and `g_fragment_slots[sk]`,
 *   with a per-sub-kind switch for the yaw and the scale — including the
 *   **sub-kind 9 pair**, which also zeroes `g_branch_prop_shot_count`.
 *
 * A shot bursts the object into forty `garasu.bin` pieces (`0xCA5`..`0xCCC`)
 * that fall, bounce off the floor and spin for 100 frames, and swaps its own
 * model to the next slot (`0x123F` for sub-kind 0). The branch arm is here
 * too: this is the routine, not a piece of it.
 *
 * `[proved]` from `FUN_004636A0` and `FUN_0046C570`, every float and every
 * table re-read out of the image (L1, L6); the tables are checked against the
 * image by `web/tools/checks/prop_tables.ts`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import { BreakablePropAwardHit, ActorDespawnProp } from "./prop";
import { MsvcRand } from "./group";
import {
  BreakableFlag, makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { DEGREES_TO_BAMS } from "./type38";
import { SCRIPT_FLAG_CLEAR_PROPS } from "./lifetime";
import { BranchScriptFlag } from "./branch";

/**
 * `g_class41_fragment_counts` — `0x005945D8`, one byte per sub-kind: how many
 * objects `PlaceFragmentProps` builds for it.
 *
 * Sub-kind **9** is 2, and that 2 is load-bearing: it is the number
 * `PropUpdateType40` waits for `g_branch_prop_shot_count` to reach before it
 * opens the route.
 */
export const FRAGMENT_COUNTS = [
  8, 12, 4, 15, 9, 2, 6, 2, 1, 2, 3, 3, 4, 1, 1, 12, 1, 3, 2, 2,
];

/** The sub-kind whose pair is a route-branch trigger. */
export const FRAGMENT_BRANCH_SUBKIND = 9;

/** `PlaceFragmentProps` writes `obj+0x124 = 0x40B00000` for every sub-kind. */
export const FRAGMENT_RADIUS = 5.5;

/**
 * Sub-kind 0's frame: `MatrixTranslate(0x4183C8B4, 0x41869168, 0x4097F7CF)`
 * then `MatrixRotateY(0x278D)`, before each row's own `T(x, 0, z)`.
 */
export const FRAGMENT_SUBKIND0_ORIGIN: readonly [number, number, number] = [
  Math.fround(16.473), Math.fround(16.821), Math.fround(4.749),
];
export const FRAGMENT_SUBKIND0_YAW = 0x278d;

/** `g_fragment_subkind0_offsets` — `0x00594158`, `{f32 x, f32 z}` x 8. */
export const FRAGMENT_SUBKIND0_OFFSETS:
    ReadonlyArray<readonly [number, number]> = [
  [18.942, 2.629], [79.35, -44.605], [56.748, -29.142], [36.604, -16.283],
  [53.5, -82.391], [30.897, -66.928], [10.753, -54.069], [-10.692, -40.688],
];

/**
 * `g_fragment_subkind1_poses` — `0x00594038`,
 * `{f32 x, y, z; f32 rx, ry, rz}` x 12, the angles in degrees.
 */
export const FRAGMENT_SUBKIND1_POSES: ReadonlyArray<readonly number[]> = [
  [-949.296, 25.4024, -462.612, 0, 0, 0],
  [-949.296, 31.0393, -452.705, 0, 0, 0],
  [-949.296, 25.4024, -443.282, 0, 0, 0],
  [-1118.83, 26.5609, -437.113, 10.0465, 14.1132, 2.4736],
  [-1116.37, 30.4929, -426.699, 10.0465, 14.1132, 2.4736],
  [-1114.84, 23.3922, -418.654, 10.0465, 14.1132, 2.4736],
  [-1198.02, 25.4029, -417.933, 0, 18.9076, 0],
  [-1194.81, 31.0393, -408.56, 0, 18.9076, 0],
  [-1191.75, 25.402, -399.646, 0, 18.9076, 0],
  [-1332.14, 26.4479, -357.82, -13.3802, 25.7341, -5.8967],
  [-1333.33, 30.2009, -367.253, -13.3802, 25.7341, -5.8967],
  [-1337.73, 22.8368, -374.681, -13.3802, 25.7341, -5.8967],
];

/**
 * `g_fragment_pose_tables` — `0x005945EC`, one pointer per sub-kind to its
 * `{f32 x, y, z}` rows; these are the rows it points at. Sub-kinds 0 and 1
 * have their own arms and null pointers.
 *
 * Sub-kind 11's third row really is at z = -107367: the object is placed a
 * hundred thousand units out of the level. Transcribed, not corrected.
 */
export const FRAGMENT_POSES: Readonly<Record<number,
    ReadonlyArray<readonly [number, number, number]>>> = {
  2: [[-172.128, 1.801, -1865.053], [-206.437, 3.394, -1865.053],
      [-273.342, 3.394, -1800.471], [-273.342, 1.793, -1865.053]],
  3: [[-1323.065, 12.548, -1615.864], [-1305.897, 12.548, -1615.864],
      [-1314.223, 19.568, -1615.864], [-1423.429, 20.538, -1861.739],
      [-1423.429, 20.538, -1878.907], [-1423.428, 27.558, -1870.581],
      [-1591.584, 18.964, -1865.407], [-1591.584, 20.522, -1879.925],
      [-1591.583, 27.541, -1871.599], [-1249.161, 20.562, -1525.884],
      [-1231.994, 20.562, -1525.884], [-1240.32, 27.582, -1525.884],
      [-1373.454, 18.943, -1504.726], [-1373.454, 20.571, -1519.281],
      [-1373.454, 27.591, -1510.955]],
  4: [[169.148, 24.96, -1599.066], [169.148, 24.96, -1581.504],
      [169.148, 31.93, -1590.528], [-271.975, 24.923, -1406.736],
      [8.99, 31.888, -1487.428], [8.99, 24.923, -1495.948],
      [8.99, 24.923, -1478.436], [-280.495, 31.888, -1406.736],
      [-289.486, 24.923, -1406.736]],
  5: [[-861.742, 7.129, -712.972], [-916.776, 7.334, -714.822]],
  6: [[-666.039, 47.333, -1340.395], [-666.039, 47.333, -1291.728],
      [-666.039, 47.333, -1242.679], [-626.18, 47.333, -1242.818],
      [-626.18, 47.333, -1291.728], [-626.176, 47.333, -1340.558]],
  7: [[-456.515, 51.575, -1218.822], [-456.514, 51.575, -1241.602]],
  8: [[-520.6, 50, -1292.3]],
  9: [[86.6349, -4.3014, -224.327], [128.3177, -4.3014, -224.327]],
  10: [[167.4672, 34.2326, 178.228], [167.4672, 39.8652, 188.2923],
       [167.4672, 34.2325, 197.5527]],
  11: [[-845.993, 18.2454, -1176.41], [-954.093, -4.4234, -1116.98],
       [-1005.18, -16.0845, -107367]],
  12: [[-937.575, 8.74, -1142.8], [-919.766, 8.74, -1148.29],
       [-1120.04, -23.7912, -1033.64], [-1039.73, -2.0958, -1139.83]],
  13: [[-201.276, -68.4459, -264.619]],
  14: [[-91.9859, -70.0289, -440.501]],
  15: [[279.338, 58.651, -1710.3], [287.875, 65.622, -1710.3],
       [296.899, 58.651, -1710.3], [291.724, 58.651, -1817.283],
       [291.724, 65.622, -1808.746], [291.724, 58.651, -1799.722],
       [87.143, 58.651, -1879.318], [87.143, 65.622, -1870.781],
       [87.143, 58.651, -1861.756], [3.333, 58.651, -1881.377],
       [3.333, 65.622, -1872.84], [3.333, 58.651, -1863.816]],
  16: [[-168.82, -67.412, -416.539]],
  17: [[-625.32, 76.6326, -925.094], [-625.329, 77.5126, -1004.25],
       [-633.748, 77.5126, -1093.18]],
  18: [[85.6065, -96.9705, -846.446], [109.3629, -66.1124, -795.588]],
  19: [[103.2495, -36.9221, -679.424], [156.3629, -36.9221, -724.588]],
};

/**
 * `g_fragment_slots` — `0x0059463C` (read as `0x00594648[sk - 6]`), the slot
 * each sub-kind starts on. 0 for 0 and 1, whose arms write their own.
 */
export const FRAGMENT_SLOTS = [
  0, 0, 0x17c6, 0x17c6, 0x17c6, 0x1786, 0x1d4, 0x1786, 0x16b1, 0x17c6,
  0x17c6, 0x17c0, 0x17be, 0x1859, 0x1859, 0x17c6, 0x1ad4, 0x1ad4, 0x1ad4,
  0x1ad4,
];

/** Sub-kind 0's slot, whole and once shot. */
export const FRAGMENT_SUBKIND0_SLOT = 0x123e;
export const FRAGMENT_SUBKIND0_SLOT_HIT = 0x123f;
/** Sub-kind 1's slot while `g_fragment_subkind1_intact[i]` holds, and after. */
export const FRAGMENT_SUBKIND1_SLOT = 0x17c6;
export const FRAGMENT_SUBKIND1_SLOT_TAKEN = 0x17c7;

/** `g_fragment_subkind11_scales` / `_yaws` — `0x00594664` and `0x00594680`. */
export const FRAGMENT_SUBKIND11_SCALES = [
  Math.fround(1.7575), Math.fround(0.5946), 1.0,
];
export const FRAGMENT_SUBKIND11_YAWS = [0, 10638, -31395];
/** `g_fragment_subkind12_scales` / `_yaws` — `0x00594670` and `0x0059468C`. */
export const FRAGMENT_SUBKIND12_SCALES = [
  Math.fround(0.72), Math.fround(0.72), Math.fround(0.906),
  Math.fround(0.9967),
];
export const FRAGMENT_SUBKIND12_YAWS = [3129, 3129, 29830, 39322];

/**
 * `g_fragment_burst_scales` — `0x0059469C`, a byte per sub-kind: the burst
 * pieces' uniform scale in hundredths.
 */
export const FRAGMENT_BURST_SCALES = [
  70, 125, 125, 125, 125, 100, 70, 100, 100, 125, 125, 70, 70, 100, 100, 70,
  70, 70, 125, 125,
];

/** How many pieces a burst throws: the loop runs `0..0xFFF0` in `0x666`s. */
export const FRAGMENT_BURST_PIECES = 40;
/** `AssetDrawSlot(0xCA5 + i)` — `garasu.bin` entries 0..39. */
export const FRAGMENT_BURST_SLOT = 0xca5;
/** `CMP [ESI+0x1C0], 0x64` — the burst draws for this many frames. */
export const FRAGMENT_BURST_FRAMES = 100;
/** `0x0055CB10` — taken off each piece's vy every frame. */
export const FRAGMENT_BURST_GRAVITY = Math.fround(0.02722);
/** `0x0056474C` — a piece that reaches the floor bounces at this. */
export const FRAGMENT_BURST_BOUNCE = Math.fround(-0.4);
/** `0x004C4380` — the floor a piece bounces off is this above the ground. */
export const FRAGMENT_BURST_FLOOR = 1.0;
/** The pieces start 3.5 above the object, 2.0 for sub-kind 0. */
export const FRAGMENT_BURST_RISE = 3.5;
export const FRAGMENT_BURST_RISE_SUBKIND0 = 1.5;
/** `9.587379924285257e-05` — the routine's BAMS-to-radians. */
const BAMS_RAD = 9.587379924285257e-05;

/** `PlaySoundId(rand() & 1 ? 0x2C16A9 : 0x2D16A9)` on the burst. */
export const SFX_FRAGMENT_BURST_A = 0x2d16a9;
export const SFX_FRAGMENT_BURST_B = 0x2c16a9;

/**
 * Sub-kind 13's and 14's draw scales, which are not uniform:
 * `MatrixScale(0x3F4E48E9, 0x3FA41893, 0x3F800000)` and
 * `MatrixScale(0x3F990FF9, 0x3F588CE7, 0x3F4CCCCD)`.
 */
export const FRAGMENT_SUBKIND13_SCALE: readonly [number, number, number] = [
  Math.fround(0.8058), Math.fround(1.282), 1.0,
];
export const FRAGMENT_SUBKIND14_SCALE: readonly [number, number, number] = [
  Math.fround(1.1958), Math.fround(0.8459), Math.fround(0.8),
];

/**
 * Sub-kind 9's second draw: `AssetDrawSlot(obj+0x1E0 + 0x96)` at
 * `T(idx ? 127.8322 : 86.2678, -11.4758, -232.219)`, no rotation.
 */
export const FRAGMENT_SUBKIND9_EXTRA_SLOT = 0x96;
export const FRAGMENT_SUBKIND9_EXTRA_AT:
    ReadonlyArray<readonly [number, number, number]> = [
  [Math.fround(86.2678), Math.fround(-11.4758), Math.fround(-232.219)],
  [Math.fround(127.8322), Math.fround(-11.4758), Math.fround(-232.219)],
];

/** The two camera cues that retire every type-40 object. */
export const FRAGMENT_DESPAWN_CUES: ReadonlyArray<readonly [number, number]> = [
  [100, 0x50], [0x67, 10],
];

/**
 * [port-only] as a function; the engine writes it inline above its
 * `RegisterForShotTest`.
 *
 * The shot point's rise, which the routine picks from the **draw slot**:
 * 0, or 2.5 for sub-kind 0; then 8.0 if the slot is `0x17C6`, 5.0 if it is
 * `0x1786` or `0x16B1`. The slot tests come second and win.
 */
export function FragmentShotRise(p: BreakableProp): number {
  let rise = p.subKind === 0 ? 2.5 : 0.0;
  if (p.slot === 0x17c6) rise = 8.0;
  if (p.slot === 0x1786 || p.slot === 0x16b1) rise = 5.0;
  return rise;
}

/** `RotY(yaw)` applied to `(x, 0, z)`. */
function RotY(x: number, z: number, yaw: number): [number, number] {
  const c = Math.cos(yaw * BAMS_RAD), s = Math.sin(yaw * BAMS_RAD);
  return [x * c + z * s, -x * s + z * c];
}

/**
 * `PlaceFragmentProps` — `FUN_004636A0`. `g_class41_constructors[40]`.
 *
 * ```c
 * count = g_class41_fragment_counts[placer->+0x1F4];
 * for (i = 0; i < count; i++) {
 *     obj = ActorAlloc(PropUpdateType40, 0xD14); ActorClearGameFields(obj);
 *     obj->+0x11C = placer->+0x11C;  obj->+0x1BB = g_evt_step_index;
 *     obj->+0x1B8 = i;  obj->+0x1BA = sk;
 *     obj->+0x124 = 5.5;  obj->+0x34 = 0x80000001;  obj->+0x118 = 1.0;
 *     switch (sk) { ...the arms in the file comment... }
 * }
 * ```
 *
 * **The counter is zeroed here**, in the `sk - 6 == 3` arm, which is what
 * makes `PropUpdateType40`'s "both of them broken" test mean *both of the two
 * this placement built*.
 *
 * Positions land in `obj+0x194..0x19C` and angles in `obj+0x1AC..0x1B4` for
 * this family — the port carries them in `x/y/z` and `pitch/yaw/roll`, and
 * the draw slot `obj+0x1E0` in `slot`. `L3`.
 */
export function PlaceFragmentProps(pl: BreakablePlacement): BreakableProp[] {
  const sk = pl.sub_kind ?? 0;
  const count = FRAGMENT_COUNTS[sk] ?? 0;
  const out: BreakableProp[] = [];
  for (let i = 0; i < count; i++) {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, i);
    p.family = PropFamily.Type40;
    p.at = pl.at;
    p.kind = 40;
    p.subKind = sk;
    p.hitRadius = FRAGMENT_RADIUS;
    p.flags = 0x80000000 | BreakableFlag.Live;
    p.lastStepIndex = G.g_evt_step_index;
    p.stepsElapsed = 0;
    p.lifetime = pl.lifetime_evt_steps ?? 0;
    p.scale = 1.0;
    if (sk === 0) {
      const [ox, oz] = FRAGMENT_SUBKIND0_OFFSETS[i];
      const [rx, rz] = RotY(ox, oz, FRAGMENT_SUBKIND0_YAW);
      p.x = FRAGMENT_SUBKIND0_ORIGIN[0] + rx;
      p.y = FRAGMENT_SUBKIND0_ORIGIN[1];
      p.z = FRAGMENT_SUBKIND0_ORIGIN[2] + rz;
      p.slot = FRAGMENT_SUBKIND0_SLOT;
    } else if (sk === 1) {
      const r = FRAGMENT_SUBKIND1_POSES[i];
      p.x = r[0]; p.y = r[1]; p.z = r[2];
      p.pitch = Math.trunc(r[3] * DEGREES_TO_BAMS);
      p.yaw = Math.trunc(r[4] * DEGREES_TO_BAMS);
      p.roll = Math.trunc(r[5] * DEGREES_TO_BAMS);
      p.slot = (G.g_fragment_subkind1_intact[i] === 1
                || G.g_GameMode === GameMode.Training)
        ? FRAGMENT_SUBKIND1_SLOT : FRAGMENT_SUBKIND1_SLOT_TAKEN;
    } else {
      const r = FRAGMENT_POSES[sk]?.[i] ?? [0, 0, 0];
      p.x = r[0]; p.y = r[1]; p.z = r[2];
      p.slot = FRAGMENT_SLOTS[sk] ?? 0;
      // `switch (sk - 6)` through `0x00463998`; sub-kinds 2..5 wrap below
      // zero and the unsigned `JA` sends them past the table.
      switch (sk) {
        case 6:
          p.yaw = i < 3 ? 0x4000 : 0xc000;
          p.scale = 1.5;
          break;
        case 9:
          p.scale = Math.fround(0.8);
          G.g_branch_prop_shot_count = 0;
          break;
        case 11:
          p.scale = FRAGMENT_SUBKIND11_SCALES[i];
          p.yaw = FRAGMENT_SUBKIND11_YAWS[i];
          break;
        case 12:
          p.scale = FRAGMENT_SUBKIND12_SCALES[i];
          p.yaw = FRAGMENT_SUBKIND12_YAWS[i];
          break;
        case 13:
          p.yaw = -0x5660;
          break;
        case 14:
          p.pitch = -0x13dd;
          p.yaw = -0x4127;
          p.roll = 0x13de;
          break;
        case 17:
        case 18:
          p.yaw = -0x4000;
          break;
        case 19:
          p.yaw = i !== 0 ? -0x4000 : 0x298e;
          break;
        default:
          break;
      }
    }
    p.drawScale = [...FragmentDrawScale(p)];
    out.push(p);
  }
  return out;
}

/** `PUSH 0x3F000000; PUSH 0x3F800000; PUSH 0x3F000000` -- scene 0, block 1. */
export const FRAGMENT_BURST_LIGHT_BLOCK1: readonly [number, number, number] =
  [0.5, 1.0, 0.5];
/** `PUSH 0x3F4CCCCD; PUSH 0x3F800000; PUSH 0x3F800000` -- everywhere else. */
export const FRAGMENT_BURST_LIGHT: readonly [number, number, number] =
  [1.0, 1.0, Math.fround(0.8)];

/**
 * `PropUpdateType40` — `FUN_0046C570`. `g_class41_updates[40]`.
 *
 * The branch half — the sub-kind-9 pair and `g_branch_prop_shot_count` — is
 * unchanged from when it was the only half ported:
 *
 * ```c
 * if (g_GameMode == 1 && obj->+0x1BA == 9
 *     && g_branch_prop_shot_count == 2 && g_script_flags[0x11] == 1) {
 *     g_script_branch_var = 2;
 *     g_branch_prop_shot_count = -1;          // fire once
 * }
 * ```
 *
 * so **both** of the pair have to be broken, the counter is a global and not
 * a field, and the frame that breaks the second is not the frame the route
 * opens — the count is tested at the top and the hit at the bottom.
 *
 * `obj+0x1B9`, the "has burst" latch, is {@link BreakableProp.branchLatched}.
 */
export function PropUpdateType40(p: BreakableProp, rng: Rng,
                                  events?: Events): void {
  // `if (g_scene_index == 1 && g_script_flags[0x77]) ActorDespawn` — this
  // one does carry the scene-1 sweep, ahead of its own inline step test.
  if (G.g_scene_index === 1
      && (G.g_script_flags[SCRIPT_FLAG_CLEAR_PROPS] ?? 0) !== 0) {
    ActorDespawnProp(p);
    return;
  }
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.lifetime < p.stepsElapsed) {
      ActorDespawnProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }
  for (const [path, frame] of FRAGMENT_DESPAWN_CUES) {
    if (G.g_active_cam_path === path) {
      if (G.g_cam_path_frame === frame) {
        ActorDespawnProp(p);
        return;
      }
      break;
    }
  }

  if (G.g_GameMode === GameMode.Original && p.subKind === FRAGMENT_BRANCH_SUBKIND
      && G.g_branch_prop_shot_count === 2
      && (G.g_script_flags[BranchScriptFlag.FragmentPair] ?? 0) === 1) {
    G.g_script_branch_var = 2;
    G.g_branch_prop_shot_count = -1;
  }

  if ((p.flags & BreakableFlag.Hit) !== 0 && !p.branchLatched
      && (p.subKind !== 1 || G.g_fragment_subkind1_intact[p.member] !== 0)) {
    FragmentBurstSeed(p, rng);
    BreakablePropAwardHit(p.flags, true, rng);
    const r = MsvcRand(rng);
    events?.emit("sound.play", {
      id: (r & 1) === 0 ? SFX_FRAGMENT_BURST_A : SFX_FRAGMENT_BURST_B,
    });
    p.branchLatched = true;
    p.flags &= ~BreakableFlag.Hit;
    if (p.subKind === 0) {
      p.slot = FRAGMENT_SUBKIND0_SLOT_HIT;
    } else {
      p.slot += 1;
      if (p.subKind === 1 && G.g_GameMode !== GameMode.Training) {
        G.g_fragment_subkind1_intact[p.member] = 0;
      }
    }
    if (G.g_GameMode === GameMode.Original
        && p.subKind === FRAGMENT_BRANCH_SUBKIND) {
      G.g_branch_prop_shot_count += 1;
    }
  }

  p.burstLight = null;
  if (p.branchLatched && p.burstFrames < FRAGMENT_BURST_FRAMES) {
    // `SetRenderLightColour` before the pieces' draw (`0x0046C8E5`..
    // `0x0046C919`) -- (0.5, 1, 0.5) in scene 0 block 1, (1, 1, 0.8)
    // elsewhere -- and `LightsRestoreScene` after it (`0x0046CA79`): the
    // forty are lit by block 0 in that colour, the object itself by the
    // block's own.
    p.burstLight = G.g_scene_index === 0 && G.g_evt_block_index === 1
      ? [...FRAGMENT_BURST_LIGHT_BLOCK1] : [...FRAGMENT_BURST_LIGHT];
    const floor = G.g_camera_fixed_eye_y + FRAGMENT_BURST_FLOOR;
    const noBounce = G.g_scene_index === 1 && G.g_evt_block_index === 0x10;
    for (const b of p.burst) {
      b.vy = Math.fround(b.vy - FRAGMENT_BURST_GRAVITY);
      b.x += b.vx;
      b.y += b.vy;
      b.z += b.vz;
      b.rx = S16(b.rx + b.sx);
      b.ry = S16(b.ry + b.sy);
      b.rz = S16(b.rz + b.sz);
      if (floor > b.y && !noBounce) {
        b.y = floor;
        b.vy = Math.fround(b.vy * FRAGMENT_BURST_BOUNCE);
      }
    }
    p.burstFrames += 1;
  }

  if (!p.branchLatched) {
    PropRegisterForShotTest(p, p.x, p.y + FragmentShotRise(p), p.z);
  }
}

/** `(s16)` — the pieces' angles and spins are 16-bit words. */
function S16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * The forty pieces, seeded on the hit — the loop at the head of
 * `PropUpdateType40`'s hit arm, eleven `rand()`s a piece in this order:
 *
 * ```c
 * for (k = 0, a = 0; a < 0xFFF0; k++, a += 0x666) {
 *     piece[k].pos = (x, y + 3.5 (- 1.5 for sub-kind 0), z);
 *     piece[k].rot = (rand(), rand(), rand());
 *     s = sin((rand() % 0x201 + a) * 2pi/65536);
 *     piece[k].vx = (rand() % 26) * 0.01 * s;
 *     piece[k].vy = (rand() % 81) * 0.01;
 *     c = cos((rand() % 0x201 + a) * 2pi/65536);
 *     piece[k].vz = (rand() % 26) * 0.01 * c;
 *     piece[k].spin = (rand() % 0x401 - 0x200) x 3;
 * }
 * ```
 *
 * `[port-only]` as a function; the engine has it inline in the hit arm.
 */
function FragmentBurstSeed(p: BreakableProp, rng: Rng): void {
  p.burst = [];
  const rise = FRAGMENT_BURST_RISE
    - (p.subKind === 0 ? FRAGMENT_BURST_RISE_SUBKIND0 : 0);
  for (let k = 0, a = 0; a < 0xfff0; k++, a += 0x666) {
    const rx = S16(MsvcRand(rng));
    const ry = S16(MsvcRand(rng));
    const rz = S16(MsvcRand(rng));
    const sn = Math.sin(((MsvcRand(rng) % 0x201) + a) * BAMS_RAD);
    const vx = Math.fround((MsvcRand(rng) % 0x1a) * 0.01 * sn);
    const vy = Math.fround((MsvcRand(rng) % 0x51) * 0.01);
    const cs = Math.cos(((MsvcRand(rng) % 0x201) + a) * BAMS_RAD);
    const vz = Math.fround((MsvcRand(rng) % 0x1a) * 0.01 * cs);
    const sx = (MsvcRand(rng) % 0x401) - 0x200;
    const sy = (MsvcRand(rng) % 0x401) - 0x200;
    const sz = (MsvcRand(rng) % 0x401) - 0x200;
    p.burst.push({
      x: p.x, y: Math.fround(p.y + rise), z: p.z,
      vx, vy, vz, rx, ry, rz, sx, sy, sz,
    });
  }
}

/**
 * [port-only] as a function — the `MatrixScale` arm of `PropUpdateType40`'s
 * draw, decided once at placement because nothing after it changes the
 * inputs. Sub-kinds 13 and 14 scale per axis, the rest by `obj+0x118`.
 */
export function FragmentDrawScale(p: BreakableProp):
    readonly [number, number, number] {
  if (p.subKind === 13) return FRAGMENT_SUBKIND13_SCALE;
  if (p.subKind === 14) return FRAGMENT_SUBKIND14_SCALE;
  return [p.scale, p.scale, p.scale];
}

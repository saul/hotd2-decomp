/**
 * Class 0x2D's draws: the boss's (`Class2DDraw` and its node hook), the
 * light set every draw of the class is made under, and the record every
 * `AssetDrawSlot` of the class leaves for `render/`.
 *
 * ## What is drawn, and where it goes
 *
 * The engine draws inside the update: `DrawSkinnedModelAndShadow` walks the
 * skeleton with the camera's view matrix on the stack, and each node's hook
 * (`model+0x1158`) calls `AssetDrawSlot` on whatever it wants under the node's
 * matrix. The port poses the skeleton in `game/skeleton.ts` -- whose bone
 * records hold **world** matrices -- and runs the hook over the posed nodes
 * (`ActorRunNodeDrawHooks`, in the walk's order and behind the walk's gate).
 * Every `AssetDrawSlot` the class makes is then a {@link Class2DSlotDraw} in
 * `G.g_class2d_draws`, under the matrix the routine built:
 *
 * * built on a bone record or on `Translate(pos)` -- the world, `view` false;
 * * built on `MatrixLoadIdentity` -- the camera's own space, `view` true;
 * * built on the view matrix the walk left on the stack and then
 *   `MatrixClearRotation` (`FUN_004A9F70`), a billboard -- the port starts
 *   from `g_camera_world_to_view` (`CameraBlockWorldToView`), so the matrix
 *   is again the camera's own, `view` true.
 *
 * The node hooks draw every node's model themselves, so nothing of the boss's
 * or a child's skeleton is drawn by the character layer; its vertex-blended
 * parts are (`DrawCharacterPartSlot`, `FUN_00419B40`), from the same pose.
 */
import { G } from "../globals";
import type { EmperorActor } from "../actor";
import { CameraBlockPitch, CameraBlockYaw } from "../camera/view";
import {
  MatCopy, MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixScale, MatrixTranslate, type Mat,
} from "../matrix";
import { ActorRunNodeDrawHooks } from "../model_draw";
import type { ClassFrame } from "../registry";
import { DrawSkinnedModelAndShadow } from "../skeleton";
import { type Class2DLight } from "./state";

/**
 * `LightsUseCustomSet` — `FUN_0041DC10`, `(ambient, pitch, yaw, r, g, b)`:
 * `SetRenderAmbient(ambient)`, `BuildSceneLightDirection(pitch, yaw)` and
 * `SetRenderLightDirection`, `SetRenderLightColour(r, g, b)` -- the three
 * calls `LightsUseSecondarySet` (`FUN_0041DC70`) makes, with the values handed
 * in. `[proved]`
 *
 * The device state it sets is the renderer's; the port returns the set, and
 * every draw the routine makes before its `LightsRestoreScene` (`FUN_0041DCC0`)
 * carries it. The restore is where the routine stops passing it on.
 */
export function LightsUseCustomSet(ambient: number, pitch: number | null,
                                   yaw: number | null,
                                   r: number, g: number, b: number):
    Class2DLight {
  return { ambient, pitch, yaw, rgb: [r, g, b] };
}

/**
 * `LightsUseCustomSet(1.0, camera block pitch, yaw, 1, 1, 1)` -- the set
 * every draw of the satellites, the children and the death burst is made
 * under: `g_camera_block_pitch_bams` and `g_camera_block_yaw_bams` of
 * `g_camera_index`'s block (`[EAX + 0x9A60CC]`, `[EAX + 0x9A60D0]`).
 * `[port-only]` as a function; the call is inline at each site.
 */
export function Class2DCameraLight(): Class2DLight {
  const cam = G.g_camera_index;
  return LightsUseCustomSet(1.0, CameraBlockPitch(cam), CameraBlockYaw(cam),
                            1.0, 1.0, 1.0);
}

/**
 * `[port-only]` -- one `AssetDrawSlot` / `AssetDrawSlotWithAlpha` into the
 * frame's list. See the file's head for `view`.
 */
export function Class2DPushDraw(slot: number, m: Mat, view: boolean,
                                alpha: number | null, envUv: boolean,
                                light: Class2DLight | null): void {
  G.g_class2d_draws.push({ slot, m: m.slice(0, 16), view, alpha, envUv,
                           light });
}

/** `0x7B2`: `Class2DNodeDrawHook` switches on `slot - 0x7B2`. */
const HOOK_SLOT_BASE = 0x7b2;
/** `CMP EAX, 0x18; JA` -- the byte map at `0x0042950C` covers 25 slots. */
const HOOK_SLOT_SPAN = 0x18;
/**
 * The byte map at `0x0042950C` through the table at `0x004294CC`, as the
 * slot each arm draws after the node's own -- the node's shell, `slot + 0x1B`
 * -- and `-1` for the default arm (map value 15, `0x004294C8`), which draws
 * nothing more. Map entry by entry: 0 `0x7CD`, 1 `0x7CE`, 2..6 none, 7
 * `0x7D4`, 8 `0x7D5`, 9 `0x7D6`, 10 `0x7D7`, 11 `0x7D8`, 12..13 none, 14
 * `0x7DB`, 15 `0x7DC`, 16 `0x7DD`, 17 `0x7DE` (bone 1's arm), 18..20 none,
 * 21 `0x7E2`, 22 bone 5's arm, 23 `0x7E4`, 24 `0x7E5`.
 */
const HOOK_SHELL: readonly number[] = [
  0x7cd, 0x7ce, -1, -1, -1, -1, -1, 0x7d4, 0x7d5, 0x7d6, 0x7d7, 0x7d8, -1, -1,
  0x7db, 0x7dc, 0x7dd, 0x7de, -1, -1, -1, 0x7e2, -2, 0x7e4, 0x7e5,
];
/** Bone 1's slot, whose arm (`0x004290A9`) also draws the core. */
const HOOK_SLOT_BONE1 = 0x7c3;
/** Bone 5's slot, whose arm (`0x00429233`) draws the glow. */
const HOOK_SLOT_BONE5 = 0x7c8;
/** `PUSH 0x7E6` at `0x004290C4` -- bone 1's second shell. */
const BONE1_SHELL2 = 0x7e6;
/** `PUSH 0x791` at `0x00429120` -- the core, drawn plainly. */
const CORE_SLOT = 0x791;
/** `ADD EDX, 0x792` with `% 0x1E` -- the core's flipbook, thirty cels. */
const CORE_FLIP_FIRST = 0x792;
const CORE_FLIP_CELS = 0x1e;
/** `PUSH 0x7E3` at `0x00429360` -- bone 5's shell while the glow is off. */
const BONE5_SHELL = 0x7e3;
/** `ADD EDX, 0x755` -- the glow's sixty cels, `0x755 + +0x1338`. */
const GLOW_FIRST = 0x755;
/** `CMP EAX, 0x3B; JGE` at `0x004292AA` -- the glow's last cel. */
const GLOW_LAST = 0x3b;
/** `MOV EAX, 0x19B3; SUB EAX, EDX` with `% 0x18` -- the flare, 24 cels down. */
export const CLASS2D_FLARE_LAST = 0x19b3;
export const CLASS2D_FLARE_CELS = 0x18;
/** `0x3D2D8F30` at `[0x0055D198]` -- the glow flare's height a cel. */
const GLOW_FLARE_STEP = Math.fround(0.04237288236618042);
/** `PUSH 0x3F000000` -- the flare's other two scales. */
const GLOW_FLARE_WIDTH = 0.5;
/** `PUSH 0x3DE0AA65`, `PUSH 0x4013F972` -- the weak point on bone 1. */
export const CLASS2D_WEAK_POINT_X = Math.fround(2.3121);
export const CLASS2D_WEAK_POINT_Y = Math.fround(0.1097);
/** `PUSH 0x4000` at `0x004290F7` -- the core's tilt. */
const CORE_TILT = 0x4000;

/**
 * `(g_frame_counter << 16) / 60 & 0xFFFF` -- `SHL ECX, 0x10; MUL 0x88888889;
 * SHR EDX, 5` on the unsigned 32-bit shift, `AND EDX, 0xFFFF`. The core's
 * spin, one turn a second at 60 frames. `[port-only]` as a function.
 */
function CoreSpin(): number {
  const x = ((G.g_frame_counter << 16) >>> 0);
  return Math.floor(x / 60) & 0xffff;
}

/**
 * `Class2DNodeDrawHook` — `FUN_00429040`. boss6.bin's node hook: `(node)`,
 * with `g_cur_actor` the boss and the node's record the draw walk's.
 *
 * ```
 * slot = rec.slot
 * if (slot != 0x7C8 || obj+0x1360 == 0)
 *     { UVs(slot); AssetDrawSlotWithAlpha(slot, obj+0x1370) }
 * switch (map[slot - 0x7B2]) {      // 0..0x18, else nothing
 *   shell arms: UVs(slot + 0x1B); AssetDrawSlotWithAlpha(slot + 0x1B, obj+0x1370)
 *   bone 1: 0x7DE and 0x7E6 so; Push; T(2.3121, 0.1097, 0); RotX(0x4000);
 *           RotZ(spin); AssetDrawSlot(0x791);
 *           if (obj+0x1364) { Push; RotX(spin); RotY(spin); RotZ(spin);
 *                             AssetDrawSlot(0x792 + g_frame_counter % 30); Pop }
 *           Pop
 *   bone 5: +0x1360 0: 0x7E3 so
 *           1: +0x1338 < 0x3B ? ++; 0x755 + +0x1338 so; Push;
 *              Scale(0.5, +0x1338 * 0.04237, 0.5); NoOpStub(max);
 *              AssetDrawSlot(0x19B3 - g_blink_frame_counter % 24); Pop
 *           2: +0x1338 > 0 ? -- : (+0x1360 = 0, +0x1338 = 0); 0x755 + +0x1338 so
 * }
 * ```
 *
 * `[proved]`. The `UVs` call is `AssetSlotUVsFromViewNormals`
 * (`FUN_00418660`) on the same slot, and it is carried as `envUv`.
 */
export function Class2DNodeDrawHook(obj: EmperorActor, bone: number,
                                    slot: number, _f: ClassFrame): void {
  const b = obj.class2d.boss;
  const rec = obj.skel?.bones[bone];
  if (!b || !rec) return;
  const light = Class2DBossLight(obj);
  const node = rec.mat;
  if (slot !== HOOK_SLOT_BONE5 || b.glowMode === 0) {
    Class2DPushDraw(slot, node, false, b.alpha, true, light);
  }
  const k = slot - HOOK_SLOT_BASE;
  if (k < 0 || k > HOOK_SLOT_SPAN) return;
  if (slot === HOOK_SLOT_BONE1) {
    Class2DPushDraw(slot + 0x1b, node, false, b.alpha, true, light);
    Class2DPushDraw(BONE1_SHELL2, node, false, b.alpha, true, light);
    const m = MatCopy(MatIdentity(), node);
    MatrixTranslate(m, CLASS2D_WEAK_POINT_X, CLASS2D_WEAK_POINT_Y, 0);
    MatrixRotateX(m, CORE_TILT);
    MatrixRotateZ(m, CoreSpin());
    Class2DPushDraw(CORE_SLOT, m, false, null, false, light);
    if (b.core !== 0) {
      const c = MatCopy(MatIdentity(), m);
      MatrixRotateX(c, CoreSpin());
      MatrixRotateY(c, CoreSpin());
      MatrixRotateZ(c, CoreSpin());
      Class2DPushDraw(CORE_FLIP_FIRST + ((G.g_frame_counter >>> 0) % CORE_FLIP_CELS),
                      c, false, null, false, light);
    }
    return;
  }
  if (slot === HOOK_SLOT_BONE5) {
    if (b.glowMode === 0) {
      Class2DPushDraw(BONE5_SHELL, node, false, b.alpha, true, light);
    } else if (b.glowMode === 1) {
      if (b.glow < GLOW_LAST) b.glow += 1;
      Class2DPushDraw(GLOW_FIRST + b.glow, node, false, b.alpha, true, light);
      const m = MatCopy(MatIdentity(), node);
      MatrixScale(m, GLOW_FLARE_WIDTH,
                  Math.fround(b.glow * GLOW_FLARE_STEP), GLOW_FLARE_WIDTH);
      Class2DPushDraw(CLASS2D_FLARE_LAST
                      - ((G.g_blink_frame_counter >>> 0) % CLASS2D_FLARE_CELS),
                      m, false, null, false, light);
    } else if (b.glowMode === 2) {
      if (b.glow > 0) {
        b.glow -= 1;
      } else {
        b.glowMode = 0;
        b.glow = 0;
      }
      Class2DPushDraw(GLOW_FIRST + b.glow, node, false, b.alpha, true, light);
    }
    return;
  }
  const shell = HOOK_SHELL[k] ?? -1;
  if (shell >= 0) Class2DPushDraw(shell, node, false, b.alpha, true, light);
}

/** `0x3F333333` at `0x0042900F` -- `Class2DDraw`'s ambient. */
const BOSS_AMBIENT = Math.fround(0.7);

/**
 * The set `Class2DDraw` draws the boss under: ambient 0.7, the scene light's
 * direction, and the colour words -- the **second twice**, as the pushes are
 * (`PUSH EAX` of `+0x1348` two times at `0x00429001`/`0x00429006`, `+0x134C`
 * never loaded). `[port-only]` as a function.
 */
function Class2DBossLight(obj: EmperorActor): Class2DLight | null {
  const b = obj.class2d.boss;
  if (!b) return null;
  // `g_scene_light_pitch_bams`, `g_scene_light_yaw_bams`: `null`, the
  // scene light's own -- see `Class2DLight`.
  return LightsUseCustomSet(BOSS_AMBIENT, null, null, b.colour[0],
                            b.colour[1], b.colour[1]);
}

/** `FADD qword ptr [0x0055D190]` -- 0.01, the flash's recovery a frame. */
const COLOUR_RECOVER = 0.01;
/** `FCOMP [0x004C4380]` -- 1.0, where it stops. */
const COLOUR_FULL = 1.0;

/**
 * `Class2DDraw` — `FUN_00428F70`.
 *
 * ```
 * for c in +0x1344, +0x1348, +0x134C: if (c < 1.0) c += 0.01
 * LightsUseCustomSet(0.7, g_scene_light_pitch_bams, g_scene_light_yaw_bams,
 *                    +0x1344, +0x1348, +0x1348)
 * g_cur_actor = obj; DrawSkinnedModelAndShadow(char, obj+0x40, char+0x78)
 * LightsRestoreScene()
 * ```
 *
 * `[proved]`. The walk calls {@link Class2DNodeDrawHook} for every node it
 * draws; the port runs it over the posed skeleton, behind the same gate.
 */
export function Class2DDraw(obj: EmperorActor, f: ClassFrame): void {
  const b = obj.class2d.boss;
  if (!b) return;
  for (let i = 0; i < 3; i++) {
    if (b.colour[i] < COLOUR_FULL) {
      b.colour[i] = Math.fround(b.colour[i] + COLOUR_RECOVER);
    }
  }
  DrawSkinnedModelAndShadow(obj);
  ActorRunNodeDrawHooks(obj, (o, bone, slot, ff) =>
    Class2DNodeDrawHook(o as EmperorActor, bone, slot, ff), f);
}

/**
 * Class 0x41 constructor 61 — nine skinned figures standing in a row.
 *
 * One spawn in the game: stage 6 block 2 step 1 op 12 (evt `0x2058`), both
 * modes, a descriptor at the origin with `+0x11C = 1`. The figures stand
 * from there until op 75 of the same step raises `g_script_flags[0]`, which
 * each of them reads every frame and leaves on. Their character types, from
 * `g_type61_figure_types` (`0x0059504C`), are `tutorial`, `znkage`, `zstin`,
 * `znjoe`, `char_adv00`, `znkagex`, `znebi3`, `zsass` and `znele` by file;
 * `[open]` what the scene means by them.
 *
 * ## The constructor `[proved]`
 *
 * `PlaceType61Figures` at `0x004641F0`, `g_class41_constructors[61]`, read in
 * the disassembly (`0x004641F0`..`0x00464359`):
 *
 * ```c
 * for (i = 0; i < 9; i++) {
 *     obj = ActorAlloc(Type61FigureUpdate, 0x13F4); ActorClearGameFields(obj);
 *     g_cur_actor = obj;  obj->+0x34 = 1;
 *     if (i < 4) { z = -9605.0f; yaw = 0x8000; x = i * 24.0f + 79.0f; }
 *     else       { z = -9568.0f; yaw = 0;      x = (i - 4) * 24.0f + 41.0f; }
 *     y = 2510.0f;  if (type[i] == 0x19 || type[i] == 0x16) y = 2507.0f;
 *     obj->+0x3C = -1;  obj->+0x120 = 0xFF;
 *     obj->+0x1F4 = (s16)(s8)type[i];                  // g_type61_figure_types
 *     obj->+0x1B4 = 0x2F6;
 *     if (type[i] == 0x13) { obj->+0x1B4 = 0x3EA; z = -9608.0f; }
 *     if (type[i] == 0x16) { obj->+0x1B4 = 0x3DA; z = -9566.1f; }
 *     TaskListSaveCurrent(obj);
 *     ActorBuildSkinnedModel(obj+0x194, obj+0x40, obj+0x20C);
 *     TaskListCurrentIgnoringSaved();
 *     obj->+0x1FC = 5;  obj->+0x194 = 0;  obj->+0x1310 = 0;
 *     placer->+0x34 = (placer->+0x34 & ~0x80) | 0x80080000;   // the PLACER's
 *     obj->+0x11C = placer->+0x11C;
 *     obj->+0x1330 = (s16)g_evt_step_index;  obj->+0x1334 = 0;  obj->+0x1350 = 0;
 * }
 * ```
 *
 * * **The `AND` at `0x00464310` is on the placer**, `EAX` loaded from the
 *   argument at `0x004642FD` -- not on the figure, as the annotations used to
 *   say. The placer is killed on the line after its constructor returns, so
 *   the write reaches nothing; the figure keeps the `0x80` the build raised,
 *   and registers for no shot test that would read it.
 * * `TaskListSaveCurrent` (`FUN_0041DB70`) stores the current task list into
 *   `g_task_list_saved` and `TaskListCurrentIgnoringSaved` (`FUN_0041DB90`)
 *   hands that to `TaskListGetCurrent` (`FUN_004A7250`), which takes no
 *   argument: the pair changes nothing the game reads, and is not
 *   transcribed.
 * * `+0x1FC` (the rotation order), `+0x1330`, `+0x1334` and `+0x1350` are
 *   written and read by nothing the figure runs; the port carries none of
 *   them. The order is the build's own 5 in any case, and a lone yaw draws
 *   the same in every order.
 *
 * ## The update `[proved]`
 *
 * `Type61FigureUpdate` at `0x004729E0`, read in the disassembly
 * (`0x004729E0`..`0x00472A4D`):
 *
 * ```c
 * if (g_script_flags[0] == 1) { ActorDespawn(obj); return; }
 * g_cur_actor = obj;
 * LightsUseSecondarySet();
 * BuildSceneLightDirection(0, 0x4000, &world, &view);
 * SetRenderLightDirection(&world);
 * DrawSkinnedModelAndShadow(obj+0x194, obj+0x40, obj+0x20C);
 * LightsRestoreScene();
 * ```
 *
 * **It never steps the counter**, `obj+0x194`: no `INC` anywhere in the
 * routine, and the sampler only reads it (`SkeletonAdvancePlayCursor`,
 * `FUN_004111A0`). So each figure holds frame 0 of its clip for as long as it
 * stands -- which is why the class is `advancesOwnMotion`. The model and its
 * shadow are the renderer's, as the result card's figures' are
 * (`class61/figure.ts`); nothing registers for the shot test, nothing counts
 * toward an enemy gate.
 *
 * **The light is fixed to the screen.** `LightsUseSecondarySet` installs
 * block 1 -- its ambient, its colour and the view-space copy of its direction
 * -- and then the routine replaces the direction: `BuildSceneLightDirection
 * (0, 0x4000, &world, &view)` and `LEA EDX, [ESP+0x18]` -- the **first**
 * output, `world` -- into `SetRenderLightDirection` (`0x00472A28`).
 * `UpdateSceneViewAndLight`, `LightsUseSecondarySet`, `LightsRestoreScene`
 * and `LightsUseCustomSet` all hand that routine the **view** vector, the
 * second output, which is what the device lights by; this one hands it the
 * world vector `(1, 0, 0)`, so the figures are lit from view-space `+X`, the
 * screen's right, whichever way the camera looks `[proved]` (the argument;
 * that the device lights in view space is the four other callers' reading). The port's `SetRenderLightDirection` takes
 * the world vector whose view image the device is handed (`light_sets.ts`),
 * so the port hands it `(1, 0, 0)` taken back through the drawing block's
 * view-to-world, which the renderer's view transform returns to `(1, 0, 0)`:
 * the same question asked in the port's encoding (`L63`). What was set is
 * left on the figure for the renderer, {@link PropContainerTail.drawDir}.
 */
import { ActorFlag, type Actor, type PropContainerActor } from "../actor";
import { CameraBlockViewToWorld } from "../camera/view";
import { ActorDespawn } from "../despawn";
import { G, HIT_SLOT_NONE } from "../globals";
import { BuildSceneLightDirection } from "../light_block";
import {
  LightsRestoreScene, LightsUseSecondarySet, SetRenderLightDirection,
} from "../light_sets";
import { MatrixTransformVector } from "../matrix";
import { ActorBuildSkinnedModel, SpawnFromDescriptor } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { vec3, type Vec3 } from "../vec";
import {
  TYPE61_FIGURES, TYPE61_TYPE_A, TYPE61_TYPE_B, Type61FigureAt,
  Type61FigureClip,
} from "./ctor_literals";
import { PropContainerRoutine } from "./placer_state";

/** `CMP EBP, 4; JGE` at `0x0046421B` — the first four stand in the far row. */
export const TYPE61_FAR_ROW = 4;
/** `MOV [ESI+0x48], 0xC6161400` / `0xC6158000` — the two rows' z. */
export const TYPE61_FAR_Z = -9605.0;
export const TYPE61_NEAR_Z = -9568.0;
/** `MOV [ESI+0x68], 0x8000` / `0` — the far row faces the near one. */
export const TYPE61_FAR_YAW = 0x8000;
export const TYPE61_NEAR_YAW = 0;
/** `FMUL [0x004ECB84]` — 24 apart, from `FADD [0x00569024]` / `[0x00569020]`. */
export const TYPE61_SPACING = 24.0;
export const TYPE61_FAR_X = 79.0;
export const TYPE61_NEAR_X = 41.0;
/** `MOV [ESI+0x44], 0x451CE000`, and `0x451CB000` for types 0x19 and 0x16. */
export const TYPE61_Y = 2510.0;
export const TYPE61_Y_LOW = 2507.0;
/** `CMP AL, 0x19` at `0x00464286` — the other type stood three lower. */
export const TYPE61_TYPE_LOW = 0x19;
/** `MOV [ESI+0x48], 0xC6162000` for type 0x13; `0xC6157866` for 0x16. */
export const TYPE61_Z_A = -9608.0;
export const TYPE61_Z_B = Math.fround(-9566.1);
/** `CMP AL, 0x1` at `0x004729E8` — `g_script_flags[0]`, exactly 1. */
export const TYPE61_LEAVE_FLAG = 0;
/**
 * `OR EDX, 0x80080000` at `0x00464316`, after `AND DL, 0x7F` -- on the
 * placer's `+0x34`, nine times over.
 */
export const TYPE61_PLACER_FLAGS_SET = 0x80080000;
/**
 * `PUSH 0x4000; PUSH 0x0` into `BuildSceneLightDirection` at `0x00472A1C`:
 * the figures' light, pitch 0 and yaw a quarter turn -- world `(1, 0, 0)`.
 */
export const TYPE61_LIGHT_PITCH = 0;
export const TYPE61_LIGHT_YAW = 0x4000;

const _world: Vec3 = vec3();
const _handed: Vec3 = vec3();

/**
 * `PlaceType61Figures` — `FUN_004641F0`. `g_class41_constructors[61]`.
 *
 * `types` is `g_type61_figure_types` as the bundle carries it on the
 * placement; `lifetime` is the placer's `+0x11C`, copied into each figure's
 * and read by nothing.
 */
export function PlaceType61Figures(placer: Actor,
                                   types: readonly number[]): void {
  for (let i = 0; i < TYPE61_FIGURES; i++) {
    const type = (((types[i] ?? 0) << 24) >> 24);
    let x: number, z: number, yaw: number;
    if (i < TYPE61_FAR_ROW) {
      z = TYPE61_FAR_Z;
      yaw = TYPE61_FAR_YAW;
      x = Math.fround(i * TYPE61_SPACING + TYPE61_FAR_X);
    } else {
      z = TYPE61_NEAR_Z;
      yaw = TYPE61_NEAR_YAW;
      x = Math.fround((i - TYPE61_FAR_ROW) * TYPE61_SPACING + TYPE61_NEAR_X);
    }
    const y = type === TYPE61_TYPE_LOW || type === TYPE61_TYPE_B
      ? TYPE61_Y_LOW : TYPE61_Y;
    if (type === TYPE61_TYPE_A) z = TYPE61_Z_A;
    if (type === TYPE61_TYPE_B) z = TYPE61_Z_B;
    // `ActorAlloc(Type61FigureUpdate, 0x13F4)`: linked **after** the placer
    // and every object already alive, which is where `SpawnFromDescriptor`
    // pushes it, with the update as its handler from the start -- the
    // figure has no `Init` for the walk to run, so none is left pending.
    const a = SpawnFromDescriptor(Type61FigureAt(placer.at, i),
                                  SpawnClass.PropContainerPlacer, type,
                                  `figure ${i}`);
    a.initPending = false;
    a.visible = true;
    if (a.cls !== SpawnClass.PropContainerPlacer) continue;
    a.placer.routine = PropContainerRoutine.Type61Figure;
    G.g_cur_actor = a.at;
    // `ActorClearGameFields` then `MOV dword ptr [ESI+0x34], 0x1`: the flag
    // word is 1 -- not the `| 1` of a descriptor's spawn flags.
    a.flags = 1;
    a.pos = vec3(x, y, z);
    a.yaw = yaw;
    a.hitSlot = HIT_SLOT_NONE;                       // +0x3C = -1
    a.cameraSlot = -1;                               // +0x120 = 0xFF
    a.charType = type;                               // +0x1F4
    a.motion = Type61FigureClip(type);               // +0x1B4
    // `TaskListSaveCurrent` / `TaskListCurrentIgnoringSaved` round it and
    // change nothing. The build claims the figure a hit slot over the -1 and
    // raises `+0x34` bit 0x80 on `g_cur_actor`, the figure.
    ActorBuildSkinnedModel(a);
    a.playTicks = 0;                                 // +0x194 = 0
    a.state = 0;                                     // +0x1310 = 0
    // `AND DL, 0x7F; OR EDX, 0x80080000` on `EAX = [ESP+0x18]`, the placer,
    // which `PropContainerPlacerUpdate` kills as soon as this returns.
    placer.flags = ((placer.flags & ~ActorFlag.ShootPerBone)
                    | TYPE61_PLACER_FLAGS_SET) | 0;
    a.hp = placer.hp;                                // +0x11C
  }
}

/** `Type61FigureUpdate` — `FUN_004729E0`. */
export function Type61FigureUpdate(obj: PropContainerActor): void {
  if ((G.g_script_flags[TYPE61_LEAVE_FLAG] ?? 0) === 1) {
    ActorDespawn(obj);
    return;
  }
  G.g_cur_actor = obj.at;
  LightsUseSecondarySet();
  BuildSceneLightDirection(TYPE61_LIGHT_PITCH, TYPE61_LIGHT_YAW, _world);
  // `SetRenderLightDirection(&world)`: the world vector where the device
  // takes a view one -- see the file note for why the port's argument is it
  // taken back through the view.
  MatrixTransformVector(CameraBlockViewToWorld(G.g_camera_index), _world,
                        _handed);
  SetRenderLightDirection(_handed);
  const d = G.g_render_light_dir;
  obj.placer.drawDir = [d.x, d.y, d.z];
  // `DrawSkinnedModelAndShadow`: the renderer's, at frame 0 of the clip --
  // the counter is never stepped.
  LightsRestoreScene();
}

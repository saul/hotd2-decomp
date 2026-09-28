/**
 * The scene light array, and the two players' gun lights in it.
 *
 * ## What the engine does
 *
 * `SceneLightArrayInit` (`FUN_004809D0`) allocates a task,
 * `SceneLightArrayUpdate` (`FUN_00480970`), that runs once a frame. Every
 * frame it resets the renderer's sixteen light slots (`RenderLightsResetAll`,
 * `FUN_004AA830`), and **only while `g_scene_lighting` is non-zero** — evt
 * `0x14` — it builds the gun lights, hands `g_light_array_ambient` to the
 * renderer as the D3D ambient (`StoreLightArrayAmbientColour`,
 * `FUN_004AA720`) and submits every enabled entry of `g_entity_lights`
 * (`SetRenderLightEnabled` / `SetRenderLightFromWorld`, `FUN_004AA6F0` /
 * `FUN_004AA780`). `[proved]`
 *
 * That array is drawn with by exactly the things that ask for it: while
 * `g_scene_lighting` is up, `RegionDrawResidentSet` submits a region entry
 * with `draw_mode` 1 through `SubmitSlotWithSceneLightArray`, and so do
 * `DrawCharacterPartSlot` and `ZombieSubmitSlotByLighting` for an actor with
 * `obj+0x38` bit 3 and `ThrowerDrawPart` for a thrower with `obj+0x136C`
 * bit 0 — see {@link ActorDrawsSceneLit}. Everything else keeps the default
 * single light. `[proved]`
 *
 * ## The gun lights
 *
 * `BuildEntitySpotlightArray` (`FUN_00480AC0`) fills entries 1 and 2, one per
 * player. It is what the player sees as a torch on the gun: a spot at the
 * crosshair's world point, pointing away from the eye, white, `theta == phi
 * == pi/8`, `attenuation0 = 0.5` — which is a constant attenuation of **two**,
 * so the cone is twice the light's diffuse before D3D clamps the vertex
 * colour. See the function for the gate.
 *
 * The render side of all of this — which meshes take which light, and the
 * three.js lights themselves — is `render/lighting.ts`, and it reads only what
 * is here.
 */
import { AppState, G, PlayerState } from "./globals";
import type { GameHost } from "./host";
import { SpawnClass } from "./spawn_class";
import { ThrowerFlag, ZombieAux, type Actor } from "./actor";
import { VecToAngles, BAMS, type Vec3 } from "./vec";
import { RenderLightType } from "./entity_light";
export { ENTITY_LIGHT_COUNT, RenderLightType, makeEntityLights, type EntityLight }
  from "./entity_light";

/** Player `p`'s gun light is entry `GUN_LIGHT_FIRST + p`. */
export const GUN_LIGHT_FIRST = 1;
/** `0x3EC90FDB` — pi/8, stored as both `theta` and `phi`. */
export const GUN_LIGHT_CONE = 0.3926991;
/** `0x3F000000` at `+0x54`. */
export const GUN_LIGHT_ATTEN0 = 0.5;
/**
 * `sqrt` of the double at `0x005691D8`, at `+0x4C`. Past anything a stage is
 * drawn at; the port carries it as unbounded rather than reading the double.
 */
export const GUN_LIGHT_RANGE = Infinity;
/** `g_projection_distance_px` — 0x009A2D70, for the 640x480 frame. */
export const PROJECTION_DISTANCE_PX = 640.2;

const _local: Vec3 = { x: 0, y: 0, z: 0 };
const _eye: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * `BuildEntitySpotlightArray` — `FUN_00480AC0`. The two gun lights.
 *
 * Per player, entry `1 + player` is lit only if **all three** hold, and is
 * otherwise switched off (`enabled = 0`, nothing else touched):
 *
 * ```
 * g_entity_spotlights_on == 1                              evt 0x15
 * g_player_state[p] == 5  ||  g_app_state == 5             in play, or attract
 * g_aim_on_screen[p] != 0                                  PollPlayerAimInput
 * ```
 *
 * Then, all from the disassembly — the stores from `0x00480C46` on are
 * outside the body Ghidra gives the function (L35):
 *
 * ```
 * MatrixLoadIdentity();
 * MatrixTranslate(g_crosshair_x / g_projection_distance_px,
 *                 g_crosshair_y / g_projection_distance_px, -1.0);
 * MatrixMultiply(camera_block + 0x40);        // camera -> world
 * pos = MatrixGetTranslation();
 * VecToAngles(pos - g_camera_block_eye, &pitch, &yaw);   // eye: see below
 * dir = RotZ(0) RotY(yaw) RotX(pitch) * (0, 0, 1);
 * type 2, diffuse (1,1,1), falloff 1, att0 0.5, att1 = att2 = 0,
 * theta = phi = pi/8, range = sqrt(*(double *)0x005691D8)
 * ```
 *
 * The `+0x40` matrix is the one `UpdateSceneViewAndLight` stores as the
 * camera's forward transform, which is what `GameHost.viewPoint` answers.
 * `VecToAngles` then the rotation back is `normalize(pos - eye)` up to the
 * angles' BAMS rounding, and it is transcribed as the two calls.
 */
export function BuildEntitySpotlightArray(host: GameHost): void {
  for (let p = 0; p < 2; p++) {
    const light = G.g_entity_lights[GUN_LIGHT_FIRST + p];
    const inPlay = G.g_player_state[p] === PlayerState.InPlay
      || G.g_app_state === AppState.Attract;
    if (G.g_entity_spotlights_on !== 1 || !inPlay || !G.g_aim_on_screen[p]) {
      light.enabled = false;
      continue;
    }
    light.enabled = true;
    light.type = RenderLightType.Spot;
    host.viewPoint(G.g_crosshair_x[p] / PROJECTION_DISTANCE_PX,
                   G.g_crosshair_y[p] / PROJECTION_DISTANCE_PX, -1, _local);
    light.pos.x = _local.x;
    light.pos.y = _local.y;
    light.pos.z = _local.z;
    // The eye is the **same matrix's** origin, not `g_camera_block_eye` read
    // on its own. In the engine the two are one number: `+0x40` is built as
    // `T(eye) RotZ RotY RotX` out of the block eye by `UpdateSceneViewAndLight`,
    // so `pos - eye` is the crosshair offset `(x, y, -1)` rotated, and the aim
    // depends on the camera's rotation and nothing else. The port's matrix and
    // its block eye are written by different layers at different points in the
    // frame, and read separately they disagreed by one frame's travel whenever
    // the camera moved: on a display faster than 60 Hz the torch swung
    // between two aims every other frame, and held still for a camera that
    // only turned.
    host.viewPoint(0, 0, 0, _eye);
    const a = VecToAngles(_local.x - _eye.x, _local.y - _eye.y,
                          _local.z - _eye.z);
    RotateForwardByAngles(a.pitch, a.yaw, light.dir);
    light.diffuse = [1, 1, 1];
    light.falloff = 1;
    light.att0 = GUN_LIGHT_ATTEN0;
    light.att1 = 0;
    light.att2 = 0;
    light.theta = GUN_LIGHT_CONE;
    light.phi = GUN_LIGHT_CONE;
    light.range = GUN_LIGHT_RANGE;
  }
}

/**
 * `MatrixRotateZ(0); MatrixRotateY(yaw); MatrixRotateX(pitch);
 * MatrixTransformPoint((0,0,1))` — the tail of `BuildEntitySpotlightArray`.
 *
 * Worked through with the matrices as the rotators store them (see
 * `render/lighting.ts`, which derives the same product for
 * `BuildSceneLightDirection`): `(cos p sin y, -sin p, cos p cos y)`.
 */
function RotateForwardByAngles(pitchBams: number, yawBams: number,
                               out: Vec3): void {
  const p = pitchBams / BAMS;
  const y = yawBams / BAMS;
  const cp = Math.cos(p);
  out.x = cp * Math.sin(y);
  out.y = -Math.sin(p);
  out.z = cp * Math.cos(y);
}

/**
 * `SceneLightArrayUpdate` — `FUN_00480970`. The engine half of the per-frame
 * light task: only while `g_scene_lighting` is set are the gun lights built.
 *
 * `RenderLightsResetAll`, the ambient and the per-entry submission are the
 * renderer's and live in `render/lighting.ts`, which reads
 * {@link EntityLightLive} for the same gate.
 */
export function SceneLightArrayUpdate(host: GameHost): void {
  if (G.g_scene_lighting === 0) return;
  BuildEntitySpotlightArray(host);
}

/**
 * [port-only] Is entry `i` submitted to the renderer this frame? `SceneLightArrayUpdate`
 * submits nothing while `g_scene_lighting` is clear, whatever the entries
 * say, so both halves of the test are needed.
 */
export function EntityLightLive(i: number): boolean {
  return G.g_scene_lighting !== 0 && !!G.g_entity_lights[i]?.enabled;
}

/**
 * Does this actor draw through `SubmitSlotWithSceneLightArray`?
 *
 * `[port-only]` in shape — the engine asks it per part, inside each draw
 * routine — but not in content. Every reader is `g_scene_lighting` and one
 * bit:
 *
 * * `DrawCharacterPartSlot` (`FUN_00419B40`): `obj+0x38` bit 3,
 *   {@link ZombieAux.SceneLit}, which `EnemyZombieInitByCharType` raises from
 *   the descriptor, `CivilianInit` raises when the lighting is on at spawn,
 *   and `EnemyThrowerInit` raises for character type 0x17.
 * * `ZombieSubmitSlotByLighting` (`FUN_00453AE0`), every class-0x30 node:
 *   `obj+0x136C` bit `0x20` (`0x00453AE7`), the descriptor bit the first of
 *   those is raised from -- this used to say it read `obj+0x38` too. The two
 *   agree from `EnemyZombieInitByCharType` on `[likely]`: an operand search
 *   of class 0x30's code finds `obj+0x38` written only there and by the two
 *   count releases, and no write of `obj+0x136C` bit `0x20` has been found
 *   after `EnemyZombieInit` assigns it -- so one answer serves the actor.
 * * `ThrowerDrawPart` (`FUN_0044A200`) and `ThrowerDrawPartWithAlpha`
 *   (`FUN_0044A240`): `obj+0x136C` bit 0, {@link ThrowerFlag.SceneLit}.
 *
 * A faded draw under the light array is `AssetDrawSlotWithAlphaSceneLights`
 * (`FUN_00418620`): lit and faded both, which `render/gunlights.ts` and the
 * fade in `render/draw_order.ts` compose.
 */
export function ActorDrawsSceneLit(obj: Actor): boolean {
  if (G.g_scene_lighting === 0) return false;
  if (obj.flags38 & ZombieAux.SceneLit) return true;
  return obj.cls === SpawnClass.Thrower
    && !!(obj.flags2 & ThrowerFlag.SceneLit);
}

/**
 * The port's half of `PollPlayerAimInput`'s gun arm (`FUN_0040CBB0`).
 *
 * `[port-only]`. The engine polls a device each frame; the port's one device
 * is the pointer, which the renderer owns, so `app/` writes it here as input
 * the way `QueueShotRequest` takes a trigger pull. The pointer is the PC
 * mouse, which `InputMapDevicesToMaple` (`FUN_0041E530`) makes a gun, so this
 * is the gun arm: `g_aim_on_screen` is whether the aim is inside the screen,
 * and a pointer moving over the scene always is. The one frame it is not --
 * a pull off the screen -- is the shot queue's (`QueueOffscreenPull`). The
 * coordinates are the engine's own frame — pixels from the centre of the
 * 640x480 screen, `+y` up (`FUN_00486820` draws the crosshair at
 * `320 + x, 240 - y`).
 */
export function SetPlayerAimFromPointer(player: number, x: number,
                                        y: number): void {
  G.g_crosshair_x[player] = x;
  G.g_crosshair_y[player] = y;
  G.g_aim_on_screen[player] = 1;
}

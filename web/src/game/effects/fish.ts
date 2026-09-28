/**
 * Class 0x51's three effect tasks: the blood cloud, the water splash and the
 * surface ring.
 *
 * Each is a 0x68-byte task with its own routine that draws and then steps a
 * cursor, and **each one ends**. The ends are all past a `MatrixStackPop` the
 * decompiler has marked no-return (`L35`), which is why the pseudocode for
 * all three stops at the draw and why this class's notes used to say none of
 * them had a termination:
 *
 * * `BloodCloudTickInScreenSpace` -- `CMP EAX, 0x52; JLE` then
 *   `JMP ActorKill` at `0x00439E87`..`0x00439E8D`: twenty-five frames.
 * * `WaterSplashUpdate` -- `CMP EAX, 0x1356; JLE` then `JMP ActorKill` at
 *   `0x00439F83`..`0x00439F8B`: thirty frames.
 * * `SurfaceRingDrawAndFade` -- the scale grows, the alpha falls by a
 *   sixtieth, and `CMP word [ESI + 0x66], 0x3C; JNZ` then `JMP ActorKill` at
 *   `0x0043A05A`..`0x0043A071`: sixty frames.
 *
 * `[proved]`, all three, from the disassembly.
 *
 * They run on the frame they are made, after the fish that made them
 * (`ActorAlloc` appends to the running list; see `game/effects/owl.ts`), so
 * the pools are stepped after the actors and every draw is of what the step
 * recorded. The draw is `render/creature_effects.ts`'s.
 */
import type { Events } from "../../core/events";
import type { Actor } from "../actor";
import { AppState, G } from "../globals";
import { CameraBlockYaw } from "../camera/view";
import type { GameHost } from "../host";
import { vec3, type Vec3 } from "../vec";

// -- the blood cloud ---------------------------------------------------------

/** `+0x54 = 0x3A` -- the same twenty-five cels of `pol/common.bin` blood uses. */
export const FISH_BLOOD_FIRST_SLOT = 0x3a;
/** `CMP EAX, 0x52; JLE` -- the last cel, which is drawn. */
export const FISH_BLOOD_LAST_SLOT = 0x52;
/**
 * `MatrixScale(0x3DCCCCCD)` -- 0.1, or `0x3D4CCCCD` 0.05 when
 * `g_wCaptionMode` is 1. The port carries no caption mode, as
 * `POINT_BLOOD_SCALE` does not either.
 */
export const FISH_BLOOD_SCALE = 0.1;
export const FISH_BLOOD_SCALE_CAPTIONED = 0.05;

/** `SpawnFishBloodCloud`'s task. */
export interface FishBloodCloud {
  /** `[port-only]` -- the engine's identity is the task pointer. */
  id: number;
  /** `+0x38`, `+0x3C`, `+0x40` -- **camera** space, drawn under identity. */
  pos: Vec3;
  /** `+0x54` -- the slot, and the cursor. */
  slot: number;
  /** `[port-only]` -- the slot this frame drew, and whether it was the last. */
  shown: number;
  done: boolean;
}

/**
 * `SpawnFishBloodCloud` — `FUN_00439DC0`. In app state 6 only.
 *
 * The point is the fish's `obj+0x70`, which `FishProjectToScreen`
 * (`FUN_00439B50`) wrote at the end of the fish's last update: its position
 * through `g_camera_world_to_view`. `FishCheckShot` calls this before the
 * fish moves, so the position is still last frame's, and
 * {@link GameHost.viewSpaceOfPoint} puts it through the camera the renderer
 * last drew with -- the same two inputs. A host with no camera answers
 * nothing and the cloud starts at the eye, which only a headless run sees.
 */
export function SpawnFishBloodCloud(obj: Actor, host?: GameHost): void {
  if (G.g_app_state !== AppState.InPlay) return;
  const pos = vec3();
  host?.viewSpaceOfPoint?.(obj.pos, pos);
  G.g_fish_blood_clouds.push({
    id: G.g_creature_effect_seq++, pos, slot: FISH_BLOOD_FIRST_SLOT,
    shown: FISH_BLOOD_FIRST_SLOT, done: false,
  });
}

/**
 * `BloodCloudTickInScreenSpace` — `FUN_00439E00`. Draws the slot and steps
 * it; past `0x52` the task is killed, after that cel has been drawn.
 */
export function BloodCloudTickInScreenSpace(c: FishBloodCloud): boolean {
  if (c.done) return false;
  c.shown = c.slot;
  c.slot += 1;
  if (c.slot > FISH_BLOOD_LAST_SLOT) c.done = true;
  return true;
}

// -- the water splash --------------------------------------------------------

/** `+0x54 = 0x1339` -- `common.bin` 307..336. */
export const FISH_SPLASH_FIRST_SLOT = 0x1339;
/** `CMP EAX, 0x1356; JLE`. */
export const FISH_SPLASH_LAST_SLOT = 0x1356;
/** `g_water_level - [0x0055D1A0]`, 0.4. */
export const FISH_SPLASH_DEPTH = 0.4;
/** `COMMON\SIBUKI2_16.WAV` and `SIBUKI3` -- *shibuki*, a splash. */
export const SND_SPLASH_BIG = 0x4116a9;
export const SND_SPLASH_SMALL = 0x4216a9;

/** `FishSpawnWaterSplash`'s task. */
export interface FishWaterSplash {
  /** `[port-only]` */
  id: number;
  /** `+0x38`, `+0x3C`, `+0x40` -- world space. */
  x: number;
  y: number;
  z: number;
  /** `+0x58` -- the caller's scale. */
  scale: number;
  /** `+0x64` -- the caller's kind, which picked the sound. Read by nothing else. */
  kind: number;
  /** `+0x54` -- the slot, and the cursor. */
  slot: number;
  /**
   * `[port-only]` -- the slot this frame drew, the camera yaw it was turned
   * by, and whether it was the last.
   */
  shown: number;
  shownYaw: number;
  done: boolean;
}

/**
 * `FishSpawnWaterSplash` — `FUN_00439EA0`.
 *
 * At the fish's x and z, 0.4 under the water, whatever the fish's own height
 * -- a splash is on the surface. `kind` is the caller's: 0 for the surface
 * being crossed, 1 for a body going in. It picks the sound and is kept on the
 * task. Not gated on the app state, unlike the other two.
 */
export function FishSpawnWaterSplash(obj: Actor, scale: number, kind: number,
                                     events?: Events): void {
  G.g_fish_water_splashes.push({
    id: G.g_creature_effect_seq++,
    x: obj.pos.x, y: G.g_water_level - FISH_SPLASH_DEPTH, z: obj.pos.z,
    scale, kind: (kind << 16) >> 16, slot: FISH_SPLASH_FIRST_SLOT,
    shown: FISH_SPLASH_FIRST_SLOT, shownYaw: 0, done: false,
  });
  events?.emit("sound.play",
               { id: kind === 0 ? SND_SPLASH_SMALL : SND_SPLASH_BIG });
}

/**
 * `WaterSplashUpdate` — `FUN_00439F10`. `T(pos) Scale(s) RotY(camera yaw)`
 * and the slot, then the step; past `0x1356` the task is killed, after that
 * cel has been drawn.
 *
 * The yaw is `g_camera_block_yaw_bams[g_camera_index * 0x69]` (`0x009A60D0`,
 * read at `0x00439F5A`), the camera block's heading. This read
 * `g_camera_yaw_bams` (`0x009C71F0`), which the scene state's hooks write as
 * a camera heading turned half round. `[proved]`
 */
export function WaterSplashUpdate(s: FishWaterSplash): boolean {
  if (s.done) return false;
  s.shown = s.slot;
  s.shownYaw = CameraBlockYaw(G.g_camera_index);
  s.slot += 1;
  if (s.slot > FISH_SPLASH_LAST_SLOT) s.done = true;
  return true;
}

// -- the surface ring --------------------------------------------------------

/** `+0x54 = 0xB71` -- `fish.bin` entry 2. */
export const FISH_RING_SLOT = 0xb71;
/** `g_water_level - [0x004D1D24]`, 0.2. */
export const FISH_RING_DEPTH = 0.2;
/** `+0x5C = 0x3CA3D70A` -- how much the scale grows a frame. */
export const FISH_RING_GROWTH = 0.02;
/** `MatrixScale(s, 0x3E4CCCCD, s)` -- the ring's height, flat. */
export const FISH_RING_HEIGHT = 0.2;
/** `[0x0055DCF4]`, `0x3C888889` -- the alpha's fall, a sixtieth. */
export const FISH_RING_FADE = Math.fround(1 / 60);
/** `CMP word [ESI + 0x66], 0x3C` -- the frames it lives. */
export const FISH_RING_FRAMES = 0x3c;

/** `FishSpawnSurfaceRing`'s task. */
export interface FishSurfaceRing {
  /** `[port-only]` */
  id: number;
  /** `+0x38`, `+0x3C`, `+0x40` -- world space. */
  x: number;
  y: number;
  z: number;
  /** `+0x58`, `+0x5C` -- the scale and its growth. */
  scale: number;
  growth: number;
  /** `+0x60` -- the alpha. */
  alpha: number;
  /** `+0x66` -- frames drawn. */
  count: number;
  /** `[port-only]` -- the scale and alpha this frame drew, and whether it was the last. */
  shownScale: number;
  shownAlpha: number;
  done: boolean;
}

/**
 * `FishSpawnSurfaceRing` — `FUN_00439FA0`. Silent. At the fish's x and z,
 * 0.2 under the water.
 */
export function FishSpawnSurfaceRing(obj: Actor, scale: number): void {
  G.g_fish_surface_rings.push({
    id: G.g_creature_effect_seq++,
    x: obj.pos.x, y: G.g_water_level - FISH_RING_DEPTH, z: obj.pos.z,
    scale, growth: FISH_RING_GROWTH, alpha: 1.0, count: 0,
    shownScale: scale, shownAlpha: 1.0, done: false,
  });
}

/**
 * `SurfaceRingDrawAndFade` — `FUN_0043A000`. Draws `0xB71` flat at the
 * scale and alpha it has, then widens by 0.02, fades by a sixtieth and counts
 * the frame; on the sixtieth it is killed, after that frame has been drawn.
 */
export function SurfaceRingDrawAndFade(r: FishSurfaceRing): boolean {
  if (r.done) return false;
  r.shownScale = r.scale;
  r.shownAlpha = r.alpha;
  r.scale += r.growth;
  r.count = ((r.count + 1) << 16) >> 16;
  r.alpha -= FISH_RING_FADE;
  if (r.count === FISH_RING_FRAMES) r.done = true;
  return true;
}

// -- the pools ----------------------------------------------------------------

/**
 * `[port-only]` -- the three pools, stepped where the engine's task list
 * reaches them: after the actors that made them.
 */
export function FishEffectsTick(): void {
  if (G.g_fish_blood_clouds.length) {
    G.g_fish_blood_clouds = G.g_fish_blood_clouds.filter(
      (c) => BloodCloudTickInScreenSpace(c));
  }
  if (G.g_fish_water_splashes.length) {
    G.g_fish_water_splashes = G.g_fish_water_splashes.filter(
      (s) => WaterSplashUpdate(s));
  }
  if (G.g_fish_surface_rings.length) {
    G.g_fish_surface_rings = G.g_fish_surface_rings.filter(
      (r) => SurfaceRingDrawAndFade(r));
  }
}

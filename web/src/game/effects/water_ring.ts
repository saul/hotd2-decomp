/**
 * The flat ring a class-0x30 actor leaves on the wet surfaces:
 * `SpawnWaterRing` at `0x004567C0` and its task, `WaterRingUpdate` at
 * `0x00456880`.
 *
 * Six routines call it, always twice, at sizes 1.0 and 0.5. Four of them were
 * read for this and reach it only when `g_coli_hit_surface` is 5 or 0x37, the
 * two surfaces `PlayImpactSoundForMaterial` gives the water ricochet to:
 * `ZombieDeathEffectCueTick`, `ZombieDeathLandingEffect`,
 * `ZombieStrikeStartSplash` and `ZombieStrikeFrameSplash` `[proved]`. The
 * surfacing entrance and the captor script were not read here `[open]`. That
 * it is a ripple is `[likely]`, from where it is drawn and how: flat
 * (`MatrixScale(s, 0.2, s)`), widening 0.02 a frame and fading out over one
 * second. The model is `common.bin` 181, slot `0xE23`.
 *
 * ```
 * // WaterRingUpdate -- the tail past the MatrixStackPop is L35's
 * Push; T(+0x40, +0x44, +0x48); Scale(+0x118, 0.2, +0x118)
 * AssetDrawSlotWithAlpha(+0x13F0, +0x1374); Pop
 * +0x118 += +0x1370; +0x1330 += 1; +0x1374 -= 1/60
 * if (+0x1330 >= 0x3C) ActorKill()
 * ```
 *
 * **It draws, then steps** -- the sprite effects' order and not the ground
 * ring's -- so this steps where they do, at the head of the frame, and
 * `render/rings.ts` draws what the record holds.
 */
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { vec3, type Vec3 } from "../vec";

/** One ring. Plain data: it goes into a snapshot as it is. */
export interface WaterRing {
  /** `[port-only]` — the engine's identity is the task pointer. */
  id: number;
  /** `+0x40`/`+0x44`/`+0x48`, world space. */
  pos: Vec3;
  /** `+0x118` — the width, x and z; grows by {@link growth} a frame. */
  size: number;
  /** `+0x1370` — 0.02, what the width grows by. */
  growth: number;
  /** `+0x1374` — the alpha, 1.0 falling a sixtieth a frame. */
  alpha: number;
  /** `+0x1330` — frames drawn. */
  frames: number;
  /** `+0x13F0` — the slot drawn, `0xE23` from this spawner. */
  slot: number;
}

/** `+0x13F0 = 0xE23` — `common.bin` 181. */
export const WATER_RING_SLOT = 0xe23;
/** `+0x1370 = 0x3CA3D70A` — 0.02f. */
export const WATER_RING_GROWTH = Math.fround(0.02);
/** `PUSH 0x3E4CCCCD` — 0.2f, the height the ring is squashed to. */
export const WATER_RING_HEIGHT = Math.fround(0.2);
/** `FSUB [0x0055DCF4]` — `8988883c`, 0.016666668f, off the alpha a frame. */
export const WATER_RING_FADE_STEP = Math.fround(1 / 60);
/** `CMP EAX, 0x3C` — sixty frames drawn, then killed. */
export const WATER_RING_FRAMES = 0x3c;
/** `FMUL [0x004C4CC8]` — `cdcccc3d`, 0.1f, the size's random step. */
export const WATER_RING_SPREAD_STEP = Math.fround(0.1);
/** `rand() % 3` — how many of those steps. */
export const WATER_RING_SPREAD = 3;

/**
 * `SpawnWaterRing` — `FUN_004567C0`.
 *
 * `(params, scale)`. The six-word block its callers build also carries three
 * angles, copied to `+0x64..+0x6C` and read by nothing -- both death routines
 * leave them as whatever was on the stack -- so they are not carried here.
 *
 * The size is `scale` plus or minus `0.1 * (rand() % 3)`: two draws, **the
 * sign first** (`rand() & 0x80000001`, normalised, then `1 - 2n`) and the
 * step second.
 */
export function SpawnWaterRing(pos: Vec3, scale: number, rng: Rng): void {
  const sign = 1 - 2 * rng.int(2);
  const step = rng.int(WATER_RING_SPREAD);
  G.g_water_rings.push({
    id: G.g_water_ring_seq++,
    pos: vec3(pos.x, pos.y, pos.z),
    size: Math.fround(step * WATER_RING_SPREAD_STEP * sign + scale),
    growth: WATER_RING_GROWTH,
    alpha: 1.0,
    frames: 0,
    slot: WATER_RING_SLOT,
  });
}

/**
 * `WaterRingUpdate` — `FUN_00456880`: the half after its draw. Returns false
 * once the task is killed.
 */
export function WaterRingUpdate(e: WaterRing): boolean {
  e.size = Math.fround(e.growth + e.size);
  e.frames += 1;
  e.alpha = Math.fround(e.alpha - WATER_RING_FADE_STEP);
  return e.frames < WATER_RING_FRAMES;
}

/** `[port-only]` — walk the pool, as `SpriteEffectsTick` does its own. */
export function WaterRingsTick(): void {
  const live = G.g_water_rings;
  if (!live.length) return;
  G.g_water_rings = live.filter((e) => WaterRingUpdate(e));
}

/**
 * What every trigger pull looks like, whether or not it hits anything.
 *
 * `PlayerShotEffectSpawn` (`FUN_00416F70`) fills one slot of **three** rings
 * per player, six deep, and `PlayerShotEffectsThink` (`FUN_00416B00`) draws
 * and steps all eighteen records every frame:
 *
 * * the **muzzle flash**, nine frames from `g_muzzle_flash_slots[player]`,
 *   drawn twice under one transform — a tenth scale, then
 *   `g_muzzle_smoke_slots[player]` at half of that again, because
 *   `MatrixScale` compounds;
 * * the **tracer**, the round itself, thrown from the muzzle along the aim at
 *   twenty units a frame and drawn as one spun billboard;
 * * a third ring that only Original Mode's weapon kind 4 ever arms.
 *
 * The port had none of it. A shot produced a sound and, on a hit, a blood
 * sprite at the target — nothing at all left the gun, which is most of why
 * shooting read as a click rather than a shot.
 *
 * ## Camera space, and why two of the three rings live in it
 *
 * The flash and the Original Mode record hold a point in the **camera's own
 * space** and are drawn under `MatrixLoadIdentity`, so they ride the camera:
 * the flash is at the crosshair, one unit in front of the eye, and it stays
 * there while the camera turns. The tracer is the one that is put into the
 * world, because it has to fly away from the camera and be left behind.
 *
 * ## The tracer stops when the shot hit something
 *
 * `ProcessPlayerShots` (`FUN_00404570`) writes `g_shot_hit_something` for the
 * player whenever the segment found any candidate, and the tracer's only use
 * of it is to die on its **second** frame. So a round that hit is one frame of
 * streak leaving the barrel and a round that missed flies for a full second.
 *
 * ## The ring cursor is stepped in the middle
 *
 * `PlayerShotEffectSpawn` writes the flash and the tracer at the current
 * cursor, **then** advances it, and only then writes the Original Mode record
 * — into the next slot, which is the one the previous shot used. Transcribed
 * as written; it is only reachable with a weapon the port cannot equip.
 */
import type { GameHost } from "../host";
import { G } from "../globals";
import { vec3, type Vec3 } from "../vec";
import type { ShotRay } from "../host";
import { AnglesToward } from "./sprite";

/** Six records a player, which is what makes it a ring. */
export const SHOT_EFFECT_RING = 6;

/** `+0x28` — the flash is dead past frame 8, so nine slots are drawn. */
export const FLASH_LAST_FRAME = 8;
/** ...and the tracer past frame 0x3B, so a clean miss streaks for a second. */
export const TRACER_LAST_FRAME = 0x3b;
/** ...and the Original Mode record past 0x17. */
export const WEAPON_LAST_FRAME = 0x17;

/** `MatrixScale(0.1, 0.1, 0.1)` on the first of the flash's two draws. */
export const FLASH_SCALE = 0.1;
/**
 * The second draw's scale, and it is **not** the 0.5 the routine writes.
 *
 * `MatrixScale` (`FUN_004A9CC0`) multiplies the top of the matrix stack in
 * place — twelve `x = k * x` and no assignment anywhere — and
 * `PlayerShotEffectsThink` scales, draws, scales again and draws again inside
 * **one** push. So the second scale compounds onto the first: 0.1 x 0.5, and
 * 0.1 x 0.75 for Original Mode's weapon kind 4.
 *
 * Read as absolute, the second draw is a two-unit quad half a unit across at
 * one unit from the eye, which is two and a half screen heights: every shot
 * would white out the frame. Compounded it is a tenth of one, which is a
 * muzzle flash.
 */
export const FLASH_SMOKE_SCALE = FLASH_SCALE * 0.5;
export const FLASH_SMOKE_SCALE_KIND4 = FLASH_SCALE * 0.75;
/** `FUN_004A9CC0(0.05, ...)` on the Original Mode record. */
export const WEAPON_SCALE = 0.05;
/** `AssetDrawSlot(frame + 0xA6F)` — `pol/eff_org9.bin`. */
export const WEAPON_FIRST_SLOT = 0xa6f;

/** The tracer's speed a frame, and the Original Mode weapon 5's half of it. */
export const TRACER_SPEED = 20.0;
export const TRACER_SPEED_WEAPON5 = 10.0;
/** `+0x18 += 0x1000` a frame: the billboard spins as it goes. */
export const TRACER_SPIN = 0x1000;
/** `AssetDrawSlot(g_muzzle_smoke_slots[player] + 2)` — one quad. */
export const TRACER_SLOT_OFFSET = 2;

/**
 * `g_original_weapon_kind` — 0x009A2249. Zero in arcade, and every arm that
 * reads it is behind `g_GameMode == 1`.
 */
export enum OriginalWeaponKind {
  /** The arcade gun, and the only one the port can equip. */
  Standard = 0,
  /** Draws no muzzle flash at all. */
  Silent = 3,
  /** Widens the flash's second draw and arms the third ring. */
  Heavy = 4,
  /** Sends the tracer down the object-path arm at half speed. */
  Slow = 5,
}

/** One slot of the muzzle-flash ring — `g_shot_flash_ring`, 0x009A2960. */
export interface ShotFlash {
  /** `+0x00`. */
  live: boolean;
  /** `+0x02`. */
  player: number;
  /** `+0x04`, `+0x08`, `+0x0C` — **camera space**, with `z` at -1. */
  pos: Vec3;
  /** `+0x10` and `+0x14`, in BAMS. */
  pitch: number;
  yaw: number;
  /** `+0x28`. Stepped whether or not the record is live. */
  frame: number;
  /** `+0x2C`. */
  kind: OriginalWeaponKind;
}

/** One slot of the tracer ring — `g_shot_tracer_ring`, 0x009A2460. */
export interface ShotTracer {
  live: boolean;
  player: number;
  /** `+0x04`, `+0x08`, `+0x0C` — **world space**. */
  pos: Vec3;
  /** `+0x1C`, `+0x20`, `+0x24` — units a frame. */
  vel: Vec3;
  /** `+0x18` — the billboard's roll. */
  spin: number;
  /** `+0x28`. */
  frame: number;
  /** `+0x2C`. */
  kind: number;
}

/** One slot of the third ring — `g_shot_weapon_ring`, 0x009A2700. */
export interface ShotWeaponEffect {
  live: boolean;
  player: number;
  /** Camera space, like the flash. */
  pos: Vec3;
  pitch: number;
  yaw: number;
  /** `+0x18` — `rand() % 0xFFFF`. */
  roll: number;
  frame: number;
  kind: OriginalWeaponKind;
}

/** `[port-only]` — one ring's worth of empty records. */
export function makeShotFlashRing(): ShotFlash[] {
  return Array.from({ length: SHOT_EFFECT_RING * 2 }, () => ({
    live: false, player: 0, pos: vec3(), pitch: 0, yaw: 0, frame: 0,
    kind: OriginalWeaponKind.Standard,
  }));
}

/** `[port-only]` — see {@link makeShotFlashRing}. */
export function makeShotTracerRing(): ShotTracer[] {
  return Array.from({ length: SHOT_EFFECT_RING * 2 }, () => ({
    live: false, player: 0, pos: vec3(), vel: vec3(), spin: 0, frame: 0,
    kind: 0,
  }));
}

/** `[port-only]` — see {@link makeShotFlashRing}. */
export function makeShotWeaponRing(): ShotWeaponEffect[] {
  return Array.from({ length: SHOT_EFFECT_RING * 2 }, () => ({
    live: false, player: 0, pos: vec3(), pitch: 0, yaw: 0, roll: 0, frame: 0,
    kind: OriginalWeaponKind.Standard,
  }));
}

/**
 * The camera-space point the muzzle effects sit at, from the shot's own ray.
 *
 * `[port-only]` in spelling. The engine reads `g_crosshair_x` and
 * `g_crosshair_y` in pixels and divides both by `g_projection_distance_px`,
 * which is exactly the direction of the segment `BuildShotRay`
 * (`FUN_00406110`) built from the same two numbers, scaled so `z` is -1. The
 * port has the segment and not the pixels, so it takes the same point from
 * the end the port actually holds.
 *
 * Returns null when there is no camera to measure against.
 */
function MuzzlePointInView(ray: ShotRay, host: GameHost): Vec3 | null {
  const a = vec3();
  const b = vec3();
  if (!host.viewSpaceOfPoint?.(ray.origin, a)) return null;
  if (!host.viewSpaceOfPoint?.(
        { x: ray.origin.x + ray.dir.x, y: ray.origin.y + ray.dir.y,
          z: ray.origin.z + ray.dir.z }, b)) return null;
  const dz = b.z - a.z;
  if (!(dz < 0)) return null;             // pointing away from the screen
  return vec3((b.x - a.x) / -dz, (b.y - a.y) / -dz, -1.0);
}

/**
 * `PlayerShotEffectSpawn` — `FUN_00416F70`.
 *
 * `rand` is only reached by Original Mode weapon kind 4, which the port cannot
 * equip; it is taken as an argument rather than left out so the arm is whole.
 */
export function PlayerShotEffectSpawn(player: number, ray: ShotRay,
                                      host: GameHost,
                                      rand: () => number): void {
  const view = MuzzlePointInView(ray, host);
  if (!view) return;
  const kind = G.g_original_weapon_kind[player] ?? OriginalWeaponKind.Standard;
  const cursor = G.g_shot_effect_cursor[player] ?? 0;
  const i = cursor + player * SHOT_EFFECT_RING;

  // -- the muzzle flash, in camera space -------------------------------
  const f = G.g_shot_flash_ring[i];
  if (f) {
    f.player = player;
    f.live = true;
    f.frame = 0;
    f.pos.x = view.x; f.pos.y = view.y; f.pos.z = view.z;
    const a = AnglesToward(view.x, view.y, view.z);
    // The routine's own two corrections, in its own order: the yaw is turned
    // half a circle and the pitch is negated, which is what points the flash
    // back down the barrel rather than away along the shot.
    f.yaw = a.yaw + 0x8000;
    f.pitch = -a.pitch;
    f.kind = kind === OriginalWeaponKind.Silent
      ? OriginalWeaponKind.Silent
      : kind === OriginalWeaponKind.Heavy
        ? OriginalWeaponKind.Heavy : OriginalWeaponKind.Standard;
  }

  // -- the tracer, in the world ----------------------------------------
  const t = G.g_shot_tracer_ring[i];
  if (t) {
    t.player = player;
    t.live = true;
    t.frame = 0;
    host.viewPoint(view.x, view.y, view.z, t.pos);
    const eye = vec3();
    host.viewPoint(0, 0, 0, eye);
    let dx = t.pos.x - eye.x, dy = t.pos.y - eye.y, dz = t.pos.z - eye.z;
    const n = Math.hypot(dx, dy, dz) || 1;
    dx /= n; dy /= n; dz /= n;
    const slow = G.g_GameMode === 1 && kind === OriginalWeaponKind.Slow;
    const speed = slow ? TRACER_SPEED_WEAPON5 : TRACER_SPEED;
    t.kind = slow ? OriginalWeaponKind.Slow : 0;
    t.vel.x = dx * speed; t.vel.y = dy * speed; t.vel.z = dz * speed;
    t.spin = 0;
  }

  // The cursor moves HERE, between the tracer and the third record.
  G.g_shot_effect_cursor[player] = (cursor + 1) > 5 ? 0 : cursor + 1;

  if (G.g_GameMode !== 1 || kind === OriginalWeaponKind.Standard) return;

  const j = (G.g_shot_effect_cursor[player] ?? 0) + player * SHOT_EFFECT_RING;
  const w = G.g_shot_weapon_ring[j];
  if (!w) return;
  w.player = player;
  w.live = true;
  w.frame = 0;
  w.kind = kind;
  if (kind === OriginalWeaponKind.Heavy) {
    w.pos.x = view.x; w.pos.y = view.y; w.pos.z = view.z;
    const a = AnglesToward(view.x, view.y, view.z);
    w.yaw = a.yaw + 0x8000;
    w.pitch = -a.pitch;
    w.roll = rand() % 0xffff;
  }
}

/**
 * `[port-only]` — the state half of `PlayerShotEffectsThink`
 * (`FUN_00416B00`).
 *
 * The engine's pass is **test, move, draw, step**, all four in one routine.
 * The port's frame is **step, then draw**, so the step comes first and the
 * expiry test moves onto the value that is about to be drawn. Written that way
 * round the two agree exactly on how many frames of each record are seen: nine
 * of the flash, sixty of the tracer, and one of a tracer whose shot landed.
 *
 * The frame counters step on records that are **not** live, which is the
 * engine's own behaviour and is what makes a re-used slot expire immediately
 * rather than a frame late.
 *
 * [diverges] by exactly one frame, on the frame a record is spawned: the
 * engine moves the tracer before its first draw and the port draws it at the
 * muzzle first, because the spawn happens after this tick has already run.
 * Which of the two the engine really does depends on where
 * `PlayerShotEffectsThink`'s task sits in the list relative to the player's,
 * and that order is `[open]`.
 */
export function PlayerShotEffectsTick(): void {
  for (let i = 0; i < SHOT_EFFECT_RING * 2; i++) {
    const f = G.g_shot_flash_ring[i];
    if (f) {
      f.frame += 1;
      if (f.frame > FLASH_LAST_FRAME) f.live = false;
    }

    const t = G.g_shot_tracer_ring[i];
    if (t) {
      t.frame += 1;
      if (t.frame > TRACER_LAST_FRAME
          || (t.frame === 1 && (G.g_shot_hit_something[t.player] ?? 0) !== 0)) {
        t.live = false;
      }
      if (t.live) {
        t.pos.x += t.vel.x;
        t.pos.y += t.vel.y;
        t.pos.z += t.vel.z;
        if (t.kind !== OriginalWeaponKind.Slow) t.spin += TRACER_SPIN;
      }
    }

    if (G.g_GameMode === 1) {
      const w = G.g_shot_weapon_ring[i];
      if (w) {
        w.frame += 1;
        if (w.kind === OriginalWeaponKind.Heavy
            && w.frame > WEAPON_LAST_FRAME) {
          w.live = false;
        }
      }
    }
  }
}

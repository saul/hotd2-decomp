/**
 * What a class-0x30 body throws up when it hits the ground: the dust or the
 * splash at the cue frames of its death clip, and the one at a landing.
 *
 * Two entries of `g_class30_states` (`0x00592AE8`) are not states:
 * `[0x37]` (`PTR_FUN_00592BC4`) is `ZombieDeathEffectCueTick` and `[0x38]`
 * (`PTR_FUN_00592BC8`) is `ZombieDeathLandingEffect`, and the states call them
 * through the table rather than directly -- state 6 the first, every frame;
 * states 9, 12, 26 and 30 the second, where they land. `[proved]` by the xrefs
 * to both slots, which are those five states and nothing else.
 *
 * Both choose by the same three facts: the surface the trace twenty units
 * above the body finds (5 and 0x37 are water), `g_rain_enabled`, and
 * `obj+0x136C` bit 0x10000 ({@link ZombieFlag2.OneShotFired}), which lets the
 * water rings go down once per death.
 *
 * | | wet surface | rain, dry | dry |
 * |---|---|---|---|
 * | the landing | two water rings, a {@link SpriteEffectKind.Splash} on the floor | a splash on the floor | a {@link SpriteEffectKind.Dust} on the floor |
 * | a death cue | two water rings and a splash on the floor, once; a splash at the body after | a splash at the body | dust on the floor, stretched `(0.5, 1.5, 1.5)` -- or for types 0xF..0x11 a flat splash at the body |
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ZombieFlag2, type ZombieActor } from "../actor";
import { QueryGroundHeightAt } from "../coli";
import {
  SpawnSpriteEffect, SpawnSpriteEffectFromParamsThunk, SpriteEffectKind,
} from "../effects/sprite";
import { SpawnWaterRing } from "../effects/water_ring";
import { G } from "../globals";
import type { GameHost } from "../host";
import { MotionPlayFrame } from "../tables";
import { vec3 } from "../vec";

/**
 * `g_zombie_death_effect_cues` — `0x005930AC`. Play-cursor frames, each list
 * ending in -1, which `obj+0x19C` can never equal.
 *
 * **Flat, and on purpose**: the engine keeps a pointer into this block at
 * `obj+0x13A0` and walks it four bytes a cue, so the port keeps an index into
 * the same words. The zeroes after a one-cue list's terminator are the
 * block's own padding (every list is three words apart) and are never read.
 * Words 24..29 are two more empty lists no case of the switch names.
 */
export const ZOMBIE_DEATH_EFFECT_CUES: readonly number[] = [
  30, 56, -1,     // 0x005930AC -- clip 0x3D9
  40, -1, 0,      // 0x005930B8 -- 0x3DA
  25, -1, 0,      // 0x005930C4 -- 0x3DB
  37, 104, -1,    // 0x005930D0 -- 0x3DC
  48, -1, 0,      // 0x005930DC -- 0x3DD
  48, -1, 0,      // 0x005930E8 -- 0x3DE
  41, -1, 0,      // 0x005930F4 -- 0x3DF
  39, -1, 0,      // 0x00593100 -- 0x3E0
  -1, 0, 0,       // 0x0059310C
  -1, 0, 0,       // 0x00593118
  -1,             // 0x00593124 -- every other clip
];

/** `ZombieInstallDeathEffectCues`' eight cases: clip -> list, as a word index. */
const DEATH_CUE_LISTS: Readonly<Record<number, number>> = {
  0x3d9: 0, 0x3da: 3, 0x3db: 6, 0x3dc: 9,
  0x3dd: 12, 0x3de: 15, 0x3df: 18, 0x3e0: 21,
};
/** The switch's default, `0x00593124`. */
export const DEATH_CUE_LIST_DEFAULT = 30;

/** `FADD [0x004C4C8C]` — 20.0, where both routines start their trace. */
const EFFECT_PROBE_RISE = 20.0;
/** The two surfaces both routines splash on. */
const SURFACE_WATER = 5;
const SURFACE_WATER_ALT = 0x37;
/** `FUN_004567C0(&p, 1.0)` then `(&p, 0.5)` — the two rings' sizes. */
const WATER_RING_BIG = 1.0;
const WATER_RING_SMALL = 0.5;
/** `SpawnSpriteEffect`'s last three: face the camera fully, or by yaw only. */
const FACE_CAMERA = 1;
const FACE_CAMERA_YAW = 2;
const NO_PLAYER = -1;
/** `0x3F000000, 0x3FC00000, 0x3FC00000` at `params[6..8]` — the cue's dust. */
const CUE_DUST_SCALE = [0.5, 1.5, 1.5] as const;
/** `0x3F800000, 0x3E99999A, 0x3F800000` — the wader's flat splash. */
const CUE_WADER_SCALE = [1.0, Math.fround(0.3), 1.0] as const;
/** `CMP AX, 0xF / 0x10 / 0x11` at `0x00456A2C` — the three wading types. */
const WADER_TYPE_LO = 0xf;
const WADER_TYPE_HI = 0x11;

/**
 * The two landings that call `ZombieDeathLandingEffect` from an entrance --
 * `ZombieStateDelayedLeap` (`FUN_004581A0`) and
 * `ZombieStateArcScriptedEntrance` (`FUN_00458A70`) -- land with the same pair
 * of sounds around it: `PUSH 0x2A16A9` (`COMMON\ENE_WALK7_22.WAV`, at
 * `0x0045842C` and `0x00458C23`) after the hook, and for body condition 5,
 * which skips the hook, `PUSH 0x1C16A9` (`COMMON\DAMAGE3_22.WAV`, at
 * `0x0045840C` and `0x00458BF8`).
 */
export const SND_LANDING = 0x2a16a9;
export const SND_LANDING_HEAVY = 0x1c16a9;
/**
 * `MOV [0x009C8E8C], 0x20` at `0x00458419` and `0x00458C02` --
 * `g_screen_shake_frames`, the heavy landing's shake. That store is the whole
 * of what either state does to the camera; `UpdateScreenShake` turns the
 * count into the nod.
 */
export const LANDING_HEAVY_SHAKE = 0x20;
/** `CMP [ESI+0x130C], 5` in both -- the body condition that lands heavy. */
export const COND_HEAVY_LANDING = 5;

function wet(): boolean {
  return G.g_coli_hit_surface === SURFACE_WATER_ALT
      || G.g_coli_hit_surface === SURFACE_WATER;
}

/**
 * `ZombieInstallDeathEffectCues` — `FUN_004563F0`.
 *
 * `ChooseDeathMotion`'s tail, reached on every path through it, **after** the
 * clip is set -- so it keys on the clip the body is now playing, and a
 * character type 10 that keeps whatever it was playing keeps that clip's
 * list, which for anything but the eight directional deaths is empty.
 */
export function ZombieInstallDeathEffectCues(obj: ZombieActor): void {
  obj.zom.deathCue = DEATH_CUE_LISTS[obj.motion] ?? DEATH_CUE_LIST_DEFAULT;
}

/**
 * `ZombieDeathEffectCueTick` — `FUN_004569B0`, `g_class30_states[0x37]`.
 *
 * One equality a frame, `obj+0x19C == *cue`; on a hit, one trace and the
 * effects the table in the file comment gives, and the cursor steps on.
 *
 * Read from the disassembly for the two positions, because the decompiler
 * folds the stores to the parameter block together: the dust and the wet
 * arm's rings take the **traced** height (`MOV [ESP+0x10], EAX` at
 * `0x00456A4B`, `MOV [ESP+0x14], EDX` at `0x00456B1B`), and the wader's flat
 * splash, the rain's splash and the wet arm's splash once the rings have gone
 * down keep `obj+0x44`.
 */
export function ZombieDeathEffectCueTick(obj: ZombieActor, rng: Rng,
                                         host?: GameHost,
                                         events?: Events): void {
  if (MotionPlayFrame(obj) !== ZOMBIE_DEATH_EFFECT_CUES[obj.zom.deathCue]) {
    return;
  }
  const ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y + EFFECT_PROBE_RISE,
                                     obj.pos.z);
  if (G.g_rain_enabled !== 1 && !wet()) {
    if (obj.charType < WADER_TYPE_LO || obj.charType > WADER_TYPE_HI) {
      SpawnSpriteEffectFromParamsThunk({
        pos: vec3(obj.pos.x, ground, obj.pos.z), pitch: 0, yaw: 0,
        scale: vec3(...CUE_DUST_SCALE), kind: SpriteEffectKind.Dust,
        faceCamera: FACE_CAMERA_YAW, player: NO_PLAYER,
      }, host, events);
    } else {
      SpawnSpriteEffectFromParamsThunk({
        pos: vec3(obj.pos.x, obj.pos.y, obj.pos.z), pitch: 0, yaw: 0,
        scale: vec3(...CUE_WADER_SCALE), kind: SpriteEffectKind.Splash,
        faceCamera: FACE_CAMERA, player: NO_PLAYER,
      }, host, events);
    }
    obj.zom.deathCue += 1;
    return;
  }
  let y = obj.pos.y;
  if (wet() && !(obj.flags2 & ZombieFlag2.OneShotFired)) {
    const floor = vec3(obj.pos.x, ground, obj.pos.z);
    SpawnWaterRing(floor, WATER_RING_BIG, rng);
    SpawnWaterRing(floor, WATER_RING_SMALL, rng);
    obj.flags2 |= ZombieFlag2.OneShotFired;
    y = ground;
  }
  SpawnSpriteEffect(vec3(obj.pos.x, y, obj.pos.z), 0, 0, SpriteEffectKind.Splash,
                    FACE_CAMERA, NO_PLAYER, host, events);
  obj.zom.deathCue += 1;
}

/**
 * `ZombieDeathLandingEffect` — `FUN_00456B70`, `g_class30_states[0x38]`.
 *
 * Once per latch: nothing at all while {@link ZombieFlag2.OneShotFired} is up,
 * and it raises the bit on every arm. The trace is its own, twenty units above
 * the body, and **it moves `g_coli_hit_surface`** -- which
 * `ZombieStateDeathKnockbackArc` reads again straight after calling this, so
 * the call is part of that state's logic as well as its picture.
 *
 * Unlike the cue's dust, the landing's has no scale override: it goes through
 * `SpawnSpriteEffect` and takes the kind's own 0.7, or the distance law.
 */
export function ZombieDeathLandingEffect(obj: ZombieActor, rng: Rng,
                                         host?: GameHost,
                                         events?: Events): void {
  if (obj.flags2 & ZombieFlag2.OneShotFired) return;
  const at = vec3(obj.pos.x, 0, obj.pos.z);
  at.y = QueryGroundHeightAt(obj.pos.x, obj.pos.y + EFFECT_PROBE_RISE,
                             obj.pos.z);
  if (G.g_coli_hit_surface === SURFACE_WATER
      || G.g_coli_hit_surface === SURFACE_WATER_ALT) {
    SpawnWaterRing(at, WATER_RING_BIG, rng);
    SpawnWaterRing(at, WATER_RING_SMALL, rng);
    SpawnSpriteEffect(at, 0, 0, SpriteEffectKind.Splash, FACE_CAMERA,
                      NO_PLAYER, host, events);
  } else if (G.g_rain_enabled === 1) {
    SpawnSpriteEffect(at, 0, 0, SpriteEffectKind.Splash, FACE_CAMERA,
                      NO_PLAYER, host, events);
  } else {
    SpawnSpriteEffect(at, 0, 0, SpriteEffectKind.Dust, FACE_CAMERA_YAW,
                      NO_PLAYER, host, events);
  }
  obj.flags2 |= ZombieFlag2.OneShotFired;
}

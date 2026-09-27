/**
 * Class 0x43's three effect tasks: the feathers, the ground impact ring and
 * the water splash.
 *
 * Each is an object of its own in the engine's task list, allocated by the
 * owl and running its own routine, which both steps the object and draws it.
 * The port keeps the step here and the draw in `render/creature_effects.ts`,
 * from what the step left on the record -- the split `game/class45/tasks.ts`
 * makes for the Tower's tasks, for the same reason.
 *
 * ## When they run, and what that decides
 *
 * `ActorAlloc` (`FUN_004A6FA0`) links a new task at the tail of the running
 * task's sibling list, and `TaskRunTree` (`FUN_004A71A0`) reads each task's
 * next pointer only after the one before it has run -- so a task made by an
 * owl runs, and draws, **on the frame it was made**, after the owl
 * `[proved]`. The pools are therefore stepped after the actors
 * ({@link OwlEffectsTick} from `SceneTaskWalk`), and what each routine drew is
 * whatever the step leaves on the record: a feather steps and then draws, a
 * splash draws and then steps, and the records say which.
 *
 * ## Who spawns what
 *
 * * {@link OwlSpawnFeatherBurst} -- 40 feathers from the death in
 *   `OwlUpdateAndResolveShot` (`FUN_004460C0`), 8 from every strike in
 *   `OwlStateDiveAtCamera` (`FUN_00446F30`).
 * * {@link OwlSpawnGroundImpactRing} and {@link OwlSpawnWaterSplashFlipbook}
 *   -- only from the four landing arms of `OwlCorpseFallAndSettle`
 *   (`FUN_00448210`): the ring at `0x00448319` (sub-type 0), `0x00448376`
 *   (sub-type 1) and `0x00448710` (sub-type 2), the splash at `0x00448758`
 *   (sub-type 3, reaching `y = -25`). Those arms are the corpse's landing
 *   geometry, which `class43/index.ts` declares is not ported yet, so nothing
 *   calls these two until it is.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { G } from "../globals";

/** The engine's `9.587379924285257e-05`, BAMS to radians. */
const BAMS = (Math.PI * 2) / 65536;

// -- the feathers ------------------------------------------------------------

/** `AssetDrawSlot(0xBF0)` -- `owl.bin` 51. */
export const OWL_FEATHER_SLOT = 0xbf0;
/** `MatrixScale(0x3E19999A)`, all three axes. */
export const OWL_FEATHER_SCALE = 0.15;
/** `MatrixRotateX(0x4000)`, after the roll and the yaw. */
export const OWL_FEATHER_PITCH = 0x4000;
/** A feather dies on the half turn after this many: `CMP EAX, 0x8; JLE`. */
export const OWL_FEATHER_HALF_TURNS = 8;
/** The phase counts to here and wraps: `CMP EAX, 0x8000; JL`. */
export const OWL_FEATHER_HALF_TURN = 0x8000;
/** `[0x005647A0]` -- z closes on its target by a thirty-second a frame. */
export const OWL_FEATHER_Z_EASE = 0.03125;
/** `[0x004C4C98]` -- the height's swing, a double. */
export const OWL_FEATHER_SWAY = 0.5;

/**
 * One shed feather: `OwlSpawnFeatherBurst`'s 0x80-byte task. Plain data, so
 * it goes into a snapshot as it is.
 */
export interface OwlFeather {
  /** `[port-only]` -- the engine's identity is the task pointer. */
  id: number;
  /** `+0x34`, `+0x38`, `+0x3C` -- world space. */
  x: number;
  y: number;
  z: number;
  /** `+0x44` -- what {@link base} falls by each frame, negative. */
  fall: number;
  /** `+0x50` -- the height the sway swings about. */
  base: number;
  /** `+0x58`, `+0x60` -- where x and z are drifting to. */
  tx: number;
  tz: number;
  /** `+0x68` -- the yaw, drawn once and never stepped. */
  yaw: number;
  /** `+0x6C` -- the roll the draw turns by, written every frame. */
  roll: number;
  /** `+0x70` -- the phase, in BAMS, which wraps at {@link OWL_FEATHER_HALF_TURN}. */
  phase: number;
  /** `+0x74` -- the roll's amplitude. */
  amp: number;
  /** `+0x78` -- half turns done. */
  turns: number;
  /** `+0x7C` -- the phase's rate. */
  rate: number;
}

/**
 * `OwlSpawnFeatherBurst` — `FUN_00448900`.
 *
 * `count` feathers in a unit box about the owl, each with nine `rand()`
 * drawn in the engine's order: the three offsets, the two drift targets, the
 * fall rate, the phase rate, the roll amplitude and the yaw.
 *
 * Two of them are masks rather than divides. `rand() & 0x80000003` is a
 * signed `% 4`, and `rand()` is never negative (`0x004ADED2` ends
 * `AND EAX, 0x7FFF`), so it is {@link Rng.int}`(4)`. `rand() & 0x8000FFFF` is
 * a signed `% 0x10000` of a number below `0x8000` -- the mask does nothing,
 * and the yaw covers **half** a turn: {@link Rng.int}`(0x8000)`.
 */
export function OwlSpawnFeatherBurst(count: number, owl: Actor,
                                     rng: Rng): void {
  for (let n = count; n > 0; n -= 1) {
    const x = rng.int(11) * 0.1 + owl.pos.x - 0.5;
    const y = rng.int(11) * 0.1 + owl.pos.y - 0.5;
    const z = rng.int(11) * 0.1 + owl.pos.z - 0.5;
    const tx = rng.int(0x3d) * 0.1 + x - 3.0;
    const tz = rng.int(0x3d) * 0.1 + z - 3.0;
    const fall = rng.int(4) * 0.001 - 0.02 - 0.0015;
    const rate = rng.int(0x201) + 0x200;
    const amp = rng.int(0x801) + 0x2800;
    const yaw = rng.int(0x8000);
    // `ActorClearGameFields` zeroes the rest: the phase, the half-turn count
    // and the roll all start at 0.
    G.g_owl_feathers.push({
      id: G.g_creature_effect_seq++,
      x, y, z, fall, base: y, tx, tz, yaw, roll: 0, phase: 0, amp, turns: 0,
      rate,
    });
  }
}

/**
 * `OwlFeatherDriftAndDraw` — `FUN_00448A80`. The step; the draw is
 * `render/creature_effects.ts`'s, from the record this leaves.
 *
 * x eases toward its target over as many frames as a half turn takes and z by
 * a thirty-second, the height swings half a unit about a base that keeps
 * falling, and the roll rocks with the same phase. On each half turn the drift
 * is re-rolled from where the feather has got to -- six `rand()` -- and past
 * eight of them it goes **without drawing** (`CALL ActorKill` then `RET`).
 *
 * The roll is `amp / 2 - ftol(amp * sin(phase))` with the phase **before**
 * this frame's step: the engine takes the sine first and adds the rate after.
 *
 * Returns false when the feather is gone.
 */
export function OwlFeatherDriftAndDraw(f: OwlFeather, rng: Rng): boolean {
  const rate = f.rate;
  const phase = f.phase;
  const amp = f.amp;
  // `0x8000 / rate` is an integer divide, and the quotient is what divides.
  f.x += (f.tx - f.x) / Math.trunc(OWL_FEATHER_HALF_TURN / rate);
  f.z += (f.tz - f.z) * OWL_FEATHER_Z_EASE;
  const s = Math.sin(phase * BAMS);
  f.y = f.base - s * OWL_FEATHER_SWAY;
  f.base += f.fall;
  f.roll = Math.trunc(amp / 2) - Math.trunc(amp * s);
  f.phase = phase + rate;
  if (f.phase >= OWL_FEATHER_HALF_TURN) {
    f.turns += 1;
    if (f.turns > OWL_FEATHER_HALF_TURNS) return false;
    f.phase = 0;
    f.tx = rng.int(0x3d) * 0.1 + f.x - 3.0;
    f.base = f.y;
    f.tz = rng.int(0x3d) * 0.1 + f.z - 3.0;
    f.fall = rng.int(7) * 0.001 - 0.02 - 0.0015;
    f.rate = rng.int(0x401) + 0x100;
    f.amp = rng.int(0xc01) + 0x2400;
  }
  return true;
}

// -- the ground impact ring --------------------------------------------------

/** `AssetDrawSlot(0x1A38)` -- `common.bin` 371. */
export const OWL_RING_SLOT = 0x1a38;
/** `0x15E4 + g_frame_counter % 30` -- `common.bin` 338..367. */
export const OWL_RING_STRIP_FIRST_SLOT = 0x15e4;
export const OWL_RING_STRIP_CELS = 30;
/** `obj+0x1330 = 0x78` -- the pulse's frames. */
export const OWL_RING_PULSE_FRAMES = 0x78;
/**
 * `[0x004C4CA4]`, `0x43088889` -- a quarter turn over the pulse's 120 frames.
 * The float, not `16384 / 120`: `ftol` truncates the product, and at every
 * fifteenth frame the exact quotient lands on an integer that a double can
 * come in just under.
 */
export const OWL_RING_PULSE_RATE = Math.fround(136.53334);
/** `[0x004C49C0]` 3.0 on the pulse, and `[0x0055CB00]` 3.0 on the fade. */
export const OWL_RING_SPREAD = 3.0;
/** The fade holds this long at full alpha: `CMP EAX, 0x1E; JL`. */
export const OWL_RING_FADE_HOLD = 0x1e;
/** ...then fades over this many: `CMP EAX, 0x28; JL`, and `(40 - n)`. */
export const OWL_RING_FADE_FRAMES = 0x28;
/** `[0x005643F8]` -- 0.025, a fortieth. */
export const OWL_RING_FADE_STEP = 0.025;
/** `STAGE1_SE\BOBBLE1_22.wav` in scene 0 and `STAGE2_SE\BOBBLE1_22.wav` otherwise. */
export const SND_OWL_RING_SCENE0 = 0x118a9;
export const SND_OWL_RING_OTHER = 0x119a9;

/** Which routine is in the ring's `obj[0]`. */
export enum OwlGroundRingPhase {
  /** `OwlGroundImpactRingPulse` (`FUN_00448CE0`). */
  Pulse = 0,
  /** `OwlGroundImpactRingFadeOut` (`FUN_00448DF0`). */
  FadeOut = 1,
}

/** `OwlSpawnGroundImpactRing`'s 0x13F4-byte task. */
export interface OwlGroundRing {
  /** `[port-only]` */
  id: number;
  /** `+0x40`, `+0x44`, `+0x48`. */
  x: number;
  y: number;
  z: number;
  /** `+0x64` and `+0x68` -- the draw's `RotX` and `RotY`. */
  pitch: number;
  yaw: number;
  /** `+0x1340` -- the caller's scale. */
  scale: number;
  /** `+0x1330` -- the pulse's countdown, then the fade's first counter. */
  count: number;
  /** `+0x1320` -- the fade's second counter. */
  fade: number;
  /** `obj[0]`. */
  phase: OwlGroundRingPhase;
  /**
   * `[port-only]` -- what this frame's routine drew, for `render/`: which
   * routine it was, the ring's x/z scale, the strip's scale and cel (the
   * pulse only; 0 for none) and the alpha.
   */
  drew: OwlGroundRingPhase;
  ring: number;
  strip: number;
  stripSlot: number;
  alpha: number;
}

/**
 * `OwlSpawnGroundImpactRing` — `FUN_00448C50`. `(x, y, z, scale, pitch,
 * yaw)`, the order the arguments are read in at `0x00448C68`..`0x00448C8F`.
 * `ActorClearGameFields` leaves the fade counter at 0.
 */
export function OwlSpawnGroundImpactRing(x: number, y: number, z: number,
                                         scale: number, pitch: number,
                                         yaw: number, events?: Events): void {
  G.g_owl_ground_rings.push({
    id: G.g_creature_effect_seq++,
    x, y, z, pitch, yaw, scale,
    count: OWL_RING_PULSE_FRAMES, fade: 0,
    phase: OwlGroundRingPhase.Pulse,
    drew: OwlGroundRingPhase.Pulse, ring: 0, strip: 0, stripSlot: 0, alpha: 1,
  });
  events?.emit("sound.play", {
    id: G.g_scene_index === 0 ? SND_OWL_RING_SCENE0 : SND_OWL_RING_OTHER,
  });
}

/**
 * `OwlGroundImpactRingPulse` — `FUN_00448CE0`.
 *
 * The count comes down first, and at zero the fade is installed -- but this
 * frame still draws the pulse, at zero. The ring opens as the cosine of a
 * quarter turn winding down; the strip under it shrinks as the sine.
 */
export function OwlGroundImpactRingPulse(r: OwlGroundRing): boolean {
  r.count -= 1;
  if (r.count === 0) r.phase = OwlGroundRingPhase.FadeOut;
  const t = Math.trunc(r.count * OWL_RING_PULSE_RATE) * BAMS;
  r.drew = OwlGroundRingPhase.Pulse;
  r.ring = Math.cos(t) * r.scale * OWL_RING_SPREAD;
  r.strip = Math.sin(t) * r.scale;
  r.stripSlot = OWL_RING_STRIP_FIRST_SLOT
    + (G.g_frame_counter >>> 0) % OWL_RING_STRIP_CELS;
  r.alpha = 1;
  return true;
}

/**
 * `OwlGroundImpactRingFadeOut` — `FUN_00448DF0`.
 *
 * Twenty-nine frames at full alpha while `+0x1330` climbs to 30, then `+0x1320`
 * climbs too and the alpha is `(40 - it) * 0.025`; at 40 the ring goes
 * without drawing.
 */
export function OwlGroundImpactRingFadeOut(r: OwlGroundRing): boolean {
  r.count += 1;
  if (r.count >= OWL_RING_FADE_HOLD) {
    r.fade += 1;
    if (r.fade >= OWL_RING_FADE_FRAMES) return false;
  }
  r.drew = OwlGroundRingPhase.FadeOut;
  r.ring = r.scale * OWL_RING_SPREAD;
  r.strip = 0;
  r.alpha = (OWL_RING_FADE_FRAMES - r.fade) * OWL_RING_FADE_STEP;
  return true;
}

// -- the water splash ----------------------------------------------------------

/** `AssetDrawSlot(0x1339 + n)` -- `common.bin` 307..336. */
export const OWL_SPLASH_FIRST_SLOT = 0x1339;
/** `CMP EAX, 0x1D; JLE` -- thirty frames, the last one drawn. */
export const OWL_SPLASH_LAST_CEL = 0x1d;
/** `MOV [EAX + 0x38], 0xC1C80000` -- the water, whatever the corpse's y. */
export const OWL_SPLASH_Y = -25.0;

/** `OwlSpawnWaterSplashFlipbook`'s 0x80-byte task. */
export interface OwlWaterSplash {
  /** `[port-only]` */
  id: number;
  /** `+0x34`, `+0x38`, `+0x3C`. */
  x: number;
  y: number;
  z: number;
  /** `+0x78` -- the cel, and the cursor. */
  cel: number;
  /** `[port-only]` -- the cel this frame drew, and whether it was the last. */
  shown: number;
  done: boolean;
}

/**
 * `OwlSpawnWaterSplashFlipbook` — `FUN_004487D0`. The caller's x and z, and
 * a fixed y of -25: the second argument is pushed and never read.
 */
export function OwlSpawnWaterSplashFlipbook(x: number, _y: number,
                                            z: number): void {
  G.g_owl_water_splashes.push({
    id: G.g_creature_effect_seq++,
    x, y: OWL_SPLASH_Y, z, cel: 0, shown: 0, done: false,
  });
}

/**
 * `OwlWaterSplashFlipbookStep` — `FUN_00448800`. `T(pos)` and
 * `AssetDrawSlot(0x1339 + cel)` -- no scale, no turn -- then the cel steps
 * and past 29 the task is killed, after its last frame has been drawn.
 */
export function OwlWaterSplashFlipbookStep(s: OwlWaterSplash): boolean {
  if (s.done) return false;
  s.shown = s.cel;
  s.cel += 1;
  if (s.cel > OWL_SPLASH_LAST_CEL) s.done = true;
  return true;
}

// -- the pools ------------------------------------------------------------------

/**
 * `[port-only]` -- the three pools, stepped where the engine's task list
 * reaches them: after the actors that made them.
 */
export function OwlEffectsTick(rng: Rng): void {
  if (G.g_owl_feathers.length) {
    G.g_owl_feathers = G.g_owl_feathers.filter(
      (f) => OwlFeatherDriftAndDraw(f, rng));
  }
  if (G.g_owl_ground_rings.length) {
    G.g_owl_ground_rings = G.g_owl_ground_rings.filter((r) =>
      r.phase === OwlGroundRingPhase.Pulse
        ? OwlGroundImpactRingPulse(r) : OwlGroundImpactRingFadeOut(r));
  }
  if (G.g_owl_water_splashes.length) {
    G.g_owl_water_splashes = G.g_owl_water_splashes.filter(
      (s) => OwlWaterSplashFlipbookStep(s));
  }
}

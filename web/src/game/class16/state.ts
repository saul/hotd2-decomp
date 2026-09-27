/**
 * The water-wave field's two records, apart from the class modules so
 * `globals.ts` can name them without importing a class -- the arrangement
 * every class with a sub-block has, for the reason `registry.ts` records.
 *
 * `WaterFieldCreate` (`FUN_00442290`, class 0x16) allocates the field with
 * `ActorAllocRaw(0x2C)` and points `g_water_wave_field` (`0x007DCC4C`) at it;
 * `WaterWaveSourceAdd` (`FUN_004422D0`, class 0x17) allocates one 0x68-byte
 * task per wave source and hangs it in the field's slot array. Both classes
 * `ActorKill` themselves on the frame they run: what outlives them is these.
 */

/**
 * `g_wave_source_kinds` (`0x005644E4`) -- `{tick, size}` pairs indexed by the
 * class-0x17 spawn's `obj+0x11C`. Both are 0x68 bytes.
 */
export enum WaveSourceKind {
  /** `WaveSourceTravellingTick` (`FUN_004420C0`) / `WaveEvalTravelling`. */
  Travelling = 0,
  /** `WaveSourceCircularTick` (`FUN_004421B0`) / `WaveEvalCircular`. */
  Circular = 1,
}

/**
 * One wave source, the 0x68-byte task `WaterWaveSourceAdd` allocates.
 *
 * `[port-only]` in shape only: the engine's is a task on the object ring and
 * the field keeps a pointer to it; here the field keeps the record itself, so
 * a snapshot carries it once.
 */
export interface WaveSource {
  /** Which of `g_wave_source_kinds` built it -- the tick the task runs. */
  kind: WaveSourceKind;
  /**
   * `+0x34` -- the eval the field calls, written by the source's **first**
   * tick. `null` until then, which is the same as the engine's: nothing
   * samples a source before it has ticked, because `+0x00` (the field's
   * count) is raised by that same first tick.
   */
  evalKind: WaveSourceKind | null;
  /** `+0x38` -- 0 until the first tick, then 1. */
  ticked: number;
  /** `+0x3C`, `+0x40`, `+0x44` -- the spawn's position; `+0x3C` doubles as
   * the travelling wave's phase and both advance every frame. */
  x: number;
  y: number;
  z: number;
  /** `+0x48`, `+0x4C`, `+0x50` -- the spawn's pitch, yaw and roll, BAMS. */
  pitch: number;
  yaw: number;
  roll: number;
  /** `+0x54` -- the field slot it occupies. */
  slot: number;
  /**
   * `+0x58` -- the descriptor tail, which the first tick copies from. The
   * engine keeps a pointer into the evt data; the port keeps the three floats.
   */
  tail: [number, number, number];
  /** `+0x5C` amplitude, `+0x60` wavelength, `+0x64` speed. */
  amplitude: number;
  wavelength: number;
  speed: number;
}

/** The 0x2C bytes `g_water_wave_field` points at. */
export interface WaterWaveField {
  /** `[0]` -- how many sources have ticked, and so may be sampled. */
  count: number;
  /** `[1]` -- the occupied slots, one bit each. */
  mask: number;
  /** `[2]` -- the plane every source's wave is added to (`obj+0x44`). */
  planeY: number;
  /** `[3]..[10]` -- the eight slots. */
  sources: (WaveSource | null)[];
}

/** The eight slots of `[3]..[10]`: `CMP ESI, 0x2C` over a stride of 4. */
export const WAVE_FIELD_SLOTS = 8;

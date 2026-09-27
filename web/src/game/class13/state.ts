/**
 * Class 0x13's two state blocks, at the offsets the engine keeps them.
 *
 * `ScriptedPropInit13` (`FUN_0043FE10`) allocates a 0x1C-byte block at
 * `obj+0x1310` and every behaviour reads it; `CarrierPropRoutine1`
 * (`FUN_004403D0`) allocates a second 0x18-byte block at `sub+0x04` on its
 * first frame, which is the one that carries the ride.
 */

/**
 * `sub+0x0C` — the routine's state, and the index into the jump table at
 * `0x0044074C`.
 *
 * Named for what each does. The two halves after state 1 are the same fork:
 * with a civilian still alive the boat pulls up and stops, and with none it
 * runs its path to the end.
 */
export enum CarrierState {
  /** `0x004403F7` — allocate the ride block, seat the shot sphere. */
  Begin = 0,
  /** `0x00440437` — ride object path 351 until frame 0x500 forks. */
  RunIn = 1,
  /** `0x004404D2` — ride object path 350 in toward the mooring. */
  PullUp = 2,
  /** `0x00440469` — the tail alone: hold the last pose, run the wake. */
  Moored = 3,
  /** `0x0044050C` — ride 351 to its end, striking the bow effect on the way. */
  RunPast = 4,
  /** `0x0044061C` — the wake strip, drawn in the camera's own frame. */
  Wake = 5,
  /** ...and the same routine once the path is spent. */
  WakeSpent = 6,
  /** `0x00440738` — `ActorDespawn`. */
  Gone = 7,
}

/**
 * `sub+0x0C` as `CarrierPropRoutine0` (`FUN_00440210`) switches on it — a
 * second reading of the word {@link CarrierState} reads for selector 1, and a
 * separate enum because the two routines' numbers mean different things
 * (`L3`). No jump table: a `SUB`/`DEC` chain at `0x00440224`.
 */
export enum CarrierRoutine0State {
  /** `0x0044025D` — allocate the 0xC-byte ride block; falls into `Ride`. */
  Begin = 0,
  /** `0x00440286` — ride object path 0x151, drawing the wake, to frame 0x276. */
  Ride = 1,
  /** `0x00440233` — ride on to `g_carrier_routine0_ride_end` without a wake. */
  Coast = 2,
  /** Past the end: the tail alone, and the boat holds its last pose. */
  Stopped = 3,
}

/**
 * `sub+0x0C` as `CarrierPropRoutine2` (`FUN_004408A0`) switches on it -- a
 * third reading of the word (`L3`). Jump table `0x00440AB4`, four entries;
 * 4 and above is past it and runs only the draw.
 */
export enum CarrierRoutine2State {
  /** `0x004408C4` -- allocate the 0xC-byte ride block; selector 9 parks. */
  Begin = 0,
  /** `0x00440944` -- ride `op_` path 0x175 over camera frames 190..360. */
  Ride = 1,
  /** `0x004409B4` -- landed: wait for paths 180/188 at frame 250. */
  Wait = 2,
  /** `0x004409E2` -- the doors swing open over 59 frames. */
  Open = 3,
  /** Past the table: the doors hold, and only the draw runs. */
  Parked = 4,
}

/**
 * The `CarrierPropSelectRoutine` (`FUN_00440190`) selectors this port runs —
 * the keys of `g_carrier_prop_routines` in `class13/index.ts`, which
 * `test/port.test.ts` holds equal to this.
 *
 * Data-only and here rather than in `index.ts` so the exporter can read it
 * without importing the class registry: a carrier whose routine is not ported
 * would be drawn standing at its descriptor while the game has it riding a
 * path, and `hod2lib/bundle.ts` keeps such a model out of the bundle rather
 * than have it arrive doing the wrong thing.
 */
export const CARRIER_SELECTORS_PORTED: ReadonlySet<number> =
  new Set([0, 1, 2, 6, 9]);

/**
 * The per-routine literals of the two ground-wake routines' draws, which is
 * all that tells selector 1's draws from selector 6's:
 *
 * * `wakeZ` — the fourth argument of `CarrierDrawGroundWake`, its
 *   `Translate(0, 0, z)` along the heading: `PUSH 0x41D80000` (27.0) in
 *   `CarrierPropRoutine1`, `PUSH 0x42020000` (32.5) at `0x00441493` in
 *   `CarrierPropRoutine6`. A distance, not a scale.
 * * `stripZ` — states 5/6's `Translate(0, 0, z)` before the strip: -5.0 in
 *   routine 1, `PUSH 0xC0000000` (-2.0) at `0x00441644` in routine 6.
 * * `bowZ` — where the bow strip spawns: -5.0 in routine 1, and
 *   `PUSH 0x41000000` (+8.0) at `0x0044157C` in routine 6.
 */
export const CARRIER_GROUND_WAKE_DRAW: Readonly<Record<number,
  { wakeZ: number; stripZ: number; bowZ: number }>> = {
  1: { wakeZ: 27.0, stripZ: -5.0, bowZ: -5.0 },
  6: { wakeZ: 32.5, stripZ: -2.0, bowZ: 8.0 },
};

/**
 * The wake strip both carrier routines step — `char_adv06.bin[0..21]` — and
 * the offset `CarrierDrawGroundWake` (`FUN_00440770`) adds for the second of
 * the two slots it draws each frame (`char_adv06.bin[22..43]`).
 */
export const CARRIER_WAKE_FIRST = 0x24a;
export const CARRIER_WAKE_LAST = 0x25f;
export const CARRIER_WAKE_PAIR = 0x16;
/** `CarrierPropRoutine0`'s splash, `eff_dokan.bin[0..93]`. */
export const CARRIER0_SPLASH_FIRST = 0xfd4;
export const CARRIER0_SPLASH_LAST = 0x1031;
/**
 * `CarrierPropRoutine2`'s two doors -- `AssetDrawSlot(0x952)` and `(0x953)`
 * at `0x00440A6A` and `0x00440A9B`, `st1_1b.bin[4]` and `[5]`, each at its
 * own fixed offset from the carrier and turned by its own yaw.
 */
export const CARRIER2_DOOR_SLOTS: readonly [number, number] = [0x952, 0x953];
/**
 * The two doors' offsets in the carrier's frame -- `PUSH` immediates at
 * `0x00440A4E`..`0x00440A58` and `0x00440A7B`..`0x00440A85`:
 * `(0x41DDA3D7, 0xC1F0A234, 0xC1C6D326)` and `(.., .., 0x41C96F69)`.
 */
export const CARRIER2_DOOR_AT: readonly [readonly [number, number, number],
                                         readonly [number, number, number]] = [
  [Math.fround(27.705), Math.fround(-30.0792), Math.fround(-24.8531)],
  [Math.fround(27.705), Math.fround(-30.0792), Math.fround(25.1794)],
];

/** `CarrierPropRoutine1`'s states 5 and 6, `ride+0x14`. */
export const CARRIER1_STRIP_FIRST = 0x1aab;
export const CARRIER1_STRIP_LAST = 0x1ad2;
/** `SpawnPropStripEffect` kind 3, which `CarrierPropRoutine1` spawns at 0x550. */
export const CARRIER1_BOW_FIRST = 0x174a;
export const CARRIER1_BOW_LAST = 0x1785;

const span = (a: number, b: number): number[] =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * `[port-only]` — every asset slot a ported carrier routine draws besides the prop's own
 * `obj+0x1F4` — what the exporter has to carry for the draws in
 * `render/slotmodels.ts` to have anything to clone.
 */
export function CarrierDrawSlots(selector: number): number[] {
  switch (selector) {
    case 0:
      return [...span(CARRIER_WAKE_FIRST, CARRIER_WAKE_LAST),
              ...span(CARRIER0_SPLASH_FIRST, CARRIER0_SPLASH_LAST)];
    case 2:
    case 9:
      return [...CARRIER2_DOOR_SLOTS];
    case 1:
    case 6:
      return [...span(CARRIER_WAKE_FIRST,
                      CARRIER_WAKE_LAST + CARRIER_WAKE_PAIR),
              ...span(CARRIER1_STRIP_FIRST, CARRIER1_STRIP_LAST),
              ...span(CARRIER1_BOW_FIRST, CARRIER1_BOW_LAST)];
    default:
      return [];
  }
}

/** The 0x1C bytes `ScriptedPropInit13` fills, at `obj+0x1310`. */
export interface ScriptedPropTail {
  /** `sub+0x00` — which `g_prop_behaviours` entry is installed. */
  behaviour: number;
  /** `sub+0x08[0]` — the first dword of the operand block at `desc+0x14`. */
  selector: number;
  /**
   * `sub+0x0C` — the behaviour's own state word, and whose it is depends on
   * the selector: {@link CarrierState} for 1 and 6,
   * {@link CarrierRoutine0State} for 0, {@link CarrierRoutine2State} for 2
   * and 9.
   */
  state: CarrierState | CarrierRoutine0State | CarrierRoutine2State;
  /** `sub+0x0E` — the camera path that despawns the prop. */
  camPath: number;
  /** `sub+0x10` — ...and the frame on it. */
  camFrame: number;
  /** `sub+0x14` — a uniform scale, applied only when it is not 1.0. */
  scale: number;
  /** `sub+0x18` — the draw alpha; 1.0 is the plain `AssetDrawSlot`. */
  alpha: number;
  /** `obj+0x1F4` — the asset slot the update draws. */
  slot: number;
  /** Whether the 0x18-byte ride block below has been allocated. */
  riding: boolean;

  // -- the ride block, `ActorAllocSub(0x18)` at `sub+0x04` ------------------
  /** `ride+0x00` — the object-path frame, seeded from `g_cam_path_frame`. */
  pathFrame: number;
  /** `ride+0x04` — the wake's own cel cursor, `0x24A`..`0x25F`. */
  wakeCel: number;
  /** `ride+0x08` — non-zero while the wake is drawn at all. */
  wakeOn: number;
  /** `ride+0x0C` — the wake's scale. */
  wakeScale: number;
  /** `ride+0x10` — what the scale gains each frame; negative is a fade. */
  wakeFade: number;
  /** `ride+0x14` — the strip cursor states 5 and 6 draw, `0x1AAB`..`0x1AD2`. */
  stripCel: number;
  /**
   * `ride+0x08` **of `CarrierPropRoutine0`'s 0xC-byte block** — the splash
   * strip's cursor, `0xFD4`..`0x1031` (`eff_dokan.bin[0..93]`), 0 while no
   * splash is running. Selector 1's block keeps its wake switch at that
   * offset ({@link ScriptedPropTail.wakeOn}); a separate field because the
   * two blocks are two layouts.
   */
  splashCel: number;
  /**
   * `[port-only]` — the two numbers `CarrierDrawGroundWake`
   * (`FUN_00440770`) computes at draw time and the renderer cannot: the
   * ground under the carrier, `QueryGroundHeightAt(x, y + 100, z)`, and the
   * heading of its forward axis, `VecToAngles` of `(0, 0, 1)` through
   * `RotX; RotZ; RotY`. A collision query is the port's, so the routine's
   * tail computes both when it would draw and the renderer reads them.
   */
  wakeGroundY: number;
  wakeYaw: number;
  /**
   * `[port-only]` — the slot each of the routine's own draws handed
   * `AssetDrawSlot` **this frame**, 0 for no draw. The engine draws a cel and
   * then steps it; the port steps it in `game/` before `render/` looks, so
   * without these the renderer would draw every strip one frame ahead, or do
   * the step backwards itself.
   */
  wakeDrawn: number;
  splashDrawn: number;
  stripDrawn: number;

  // -- `CarrierPropRoutine2`'s 0xC-byte ride block, another layout (`L3`) ---
  /** `ride+0x00` -- the first door's yaw, BAMS, `0xC000 + t[i]`. */
  door0Yaw: number;
  /** `ride+0x04` -- the second door's, `0xC000 - t[i]`. */
  door1Yaw: number;
  /** `ride+0x08` -- the index into `g_carrier2_door_yaw`, 0..0x3B. */
  doorStep: number;
}

/** `[port-only]` — the two blocks `ActorAllocSub` zeroes, as one object. */
export function makeScriptedPropTail(): ScriptedPropTail {
  return {
    behaviour: 0, selector: 0, state: CarrierState.Begin,
    camPath: -1, camFrame: -1, scale: 1, alpha: 1, slot: 0, riding: false,
    pathFrame: 0, wakeCel: 0, wakeOn: 0, wakeScale: 0, wakeFade: 0,
    stripCel: 0, splashCel: 0, wakeGroundY: 0, wakeYaw: 0,
    wakeDrawn: 0, splashDrawn: 0, stripDrawn: 0,
    door0Yaw: 0, door1Yaw: 0, doorStep: 0,
  };
}

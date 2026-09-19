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
export const CARRIER_SELECTORS_PORTED: ReadonlySet<number> = new Set([0, 1, 6]);

/** The 0x1C bytes `ScriptedPropInit13` fills, at `obj+0x1310`. */
export interface ScriptedPropTail {
  /** `sub+0x00` — which `g_prop_behaviours` entry is installed. */
  behaviour: number;
  /** `sub+0x08[0]` — the first dword of the operand block at `desc+0x14`. */
  selector: number;
  /**
   * `sub+0x0C` — the behaviour's own state word, and whose it is depends on
   * the selector: {@link CarrierState} for 1, {@link CarrierRoutine0State}
   * for 0.
   */
  state: CarrierState | CarrierRoutine0State;
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
}

/** `[port-only]` — the two blocks `ActorAllocSub` zeroes, as one object. */
export function makeScriptedPropTail(): ScriptedPropTail {
  return {
    behaviour: 0, selector: 0, state: CarrierState.Begin,
    camPath: -1, camFrame: -1, scale: 1, alpha: 1, slot: 0, riding: false,
    pathFrame: 0, wakeCel: 0, wakeOn: 0, wakeScale: 0, wakeFade: 0,
    stripCel: 0, splashCel: 0,
  };
}

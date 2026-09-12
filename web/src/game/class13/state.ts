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

/** The 0x1C bytes `ScriptedPropInit13` fills, at `obj+0x1310`. */
export interface ScriptedPropTail {
  /** `sub+0x00` — which `g_prop_behaviours` entry is installed. */
  behaviour: number;
  /** `sub+0x08[0]` — the first dword of the operand block at `desc+0x14`. */
  selector: number;
  /** `sub+0x0C` — the behaviour's own state word. */
  state: CarrierState;
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
}

/** `[port-only]` — the two blocks `ActorAllocSub` zeroes, as one object. */
export function makeScriptedPropTail(): ScriptedPropTail {
  return {
    behaviour: 0, selector: 0, state: CarrierState.Begin,
    camPath: -1, camFrame: -1, scale: 1, alpha: 1, slot: 0, riding: false,
    pathFrame: 0, wakeCel: 0, wakeOn: 0, wakeScale: 0, wakeFade: 0,
    stripCel: 0,
  };
}

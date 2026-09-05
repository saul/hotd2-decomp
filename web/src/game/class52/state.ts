/**
 * The mouse's sub-block, apart from the class module so `actor.ts` can name it
 * without importing the class — the arrangement classes 0x20, 0x21, 0x24 and
 * 0x25 have, and for the reason `registry.ts` records: an ESM cycle that
 * resolves a table to `undefined` has cost this project three separate hours.
 *
 * `MouseInit` allocates it with `ActorAllocSub(0x28)` and hangs it at
 * `obj+0x1310`, which is the same offset class 0x10's civilian block uses.
 * Unlike that one it is not nullable in the port: every class-0x52 actor has
 * one from its first frame.
 */

/** `sub+0x18` — which arm of the routine the mouse is in. */
export enum MouseState {
  /**
   * Running. `MouseWanderUpdate` moves and animates; in
   * `MouseBranchTriggerUpdate` this is the arm that waits to be shot.
   */
  Run = 0,
  /**
   * Paused. The wanderer holds 60 frames and turns; the trigger uses the same
   * number for the frame that resolves its flight velocity.
   */
  Pause = 1,
  /** The trigger's flight, one arm per subtype. */
  FleeSubtype2 = 2,
  FleeSubtype3 = 3,
  FleeSubtype4 = 4,
  /**
   * Out of bounds. **Nothing in the class handles it**, so the mouse stops
   * moving and keeps drawing where it stopped — transcribed as written rather
   * than turned into a despawn it is not.
   */
  Stopped = 10,
  /** Despawn. Nothing shipped reaches it; the routine has the arm. */
  Leave = 11,
}

/** `obj+0x1310` — the 0x28 bytes `ActorAllocSub` hands `MouseInit`. */
export interface MouseTail {
  /** `sub+0x00` and `sub+0x08` — units a frame, rebuilt from the yaw. */
  vx: number;             // +0x00
  vz: number;             // +0x08
  /** `sub+0x0C` — 0.4, and the only speed the class has. */
  speed: number;          // +0x0C
  /** `sub+0x18`. */
  state: MouseState;      // +0x18
  /** `sub+0x1C` — frames lived. A wanderer despawns past 600. */
  life: number;           // +0x1C
  /** `sub+0x1E` — frames held in {@link MouseState.Pause}. */
  paused: number;         // +0x1E
  /** `sub+0x20` — the strip frame being drawn, `0x1385`..`0x138E`. */
  frame: number;          // +0x20
  /** `sub+0x22` and `sub+0x24` — the last and first frames of the strip. */
  lastFrame: number;      // +0x22
  firstFrame: number;     // +0x24
  /** `sub+0x26` — the subtype, from the descriptor tail. */
  subtype: number;        // +0x26
}

/**
 * [port-only] `ActorAllocSub` returns memory the Init then fills; this is the
 * zero it starts from, written out. `MouseInit` sets every field below.
 */
export function makeMouseTail(): MouseTail {
  return {
    vx: 0, vz: 0, speed: 0, state: MouseState.Run, life: 0, paused: 0,
    frame: 0, lastFrame: 0, firstFrame: 0, subtype: 0,
  };
}

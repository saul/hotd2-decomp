/**
 * Class 0x20's tail — the one word `OneHitTargetInit` (`FUN_00448ED0`) and its
 * four states own that is not already on the head.
 *
 * ## The state selector is port-only, and says so
 *
 * The engine has no state *field* for this class. It swaps `obj[0]`, the
 * object's entry point, and each of the four routines is a state:
 * `OneHitTargetUpdate` (`FUN_00449020`) → `OneHitTargetPlayDeathClip`
 * (`FUN_00449380`) → `OneHitTargetSinkAndDespawn` (`FUN_00449430`), with
 * `OneHitTargetHoldDrawn` (`FUN_004494D0`) off to one side. The port's registry
 * gives a class **one** `update`, so the pointer has to become a value —
 * exactly as class 0x25 turned `MOV [EDI], 0x484d40` into `pc = -1`.
 *
 * ## The sink countdown is NOT here, and that is deliberate
 *
 * `OneHitTargetPlayDeathClip` writes `obj+0x1330 = 0x78` and
 * `OneHitTargetSinkAndDespawn` counts it down. That word is
 * {@link ActorBase.arcFrames} on the head, because it is also the elapsed
 * frame of the **shared arc record** `ActorArcBegin`/`ActorArcStep` lay down
 * for classes 0x30 and 0x31, and class 0x24's `slideTimer`. A word only
 * separates onto arms when every class sharing it has one, and this one is
 * shared with routines that belong to no class at all — so it stays on the
 * head and class 0x20 reads it there, under a comment saying so.
 *
 * ## Not an allocated block
 *
 * `ActorAllocSub` (`FUN_004A74E0`) has 37 call sites and `OneHitTargetInit` is
 * not one of them `[proved]` — the only allocation its Init reaches is the
 * bone array inside `ActorBuildSkinnedModel` (`FUN_00410440`), which every
 * skeletal actor gets. So this is a view onto words that are always there, and
 * is not nullable. Same argument as `class25/state.ts` and `class24/state.ts`.
 */

/**
 * Which of class 0x20's four routines is installed at `obj[0]`.
 *
 * [port-only] — see the file comment. The values are the port's; the engine's
 * are function addresses.
 */
export enum OneHitTargetState {
  /** `OneHitTargetUpdate` (`FUN_00449020`). Alive, shootable, idling. */
  Alive = 0,
  /**
   * `OneHitTargetPlayDeathClip` (`FUN_00449380`). Plays motion 988 to its last
   * frame and holds there.
   */
  Dying = 1,
  /**
   * `OneHitTargetSinkAndDespawn` (`FUN_00449430`). 120 frames of body, sinking
   * 0.04 a frame, then `ActorDespawn`.
   */
  Sinking = 2,
  /**
   * `OneHitTargetHoldDrawn` (`FUN_004494D0`). Drawn and nothing else.
   *
   * Reached only in `g_GameMode` 2 (arcade) event block 0x0D, gated on
   * `DAT_009C72F2` / `DAT_009C72F1` — a pair of bytes `ZombieAdvanceMotion`,
   * `CivilianUpdate` and class 0x31 also read, and which are `[open]`.
   * **Not ported**, so nothing reaches this member; it exists because the
   * enum enumerates the engine's four routines and leaving one out would
   * quietly claim there are three.
   */
  HeldDrawn = 3,
}

export interface OneHitTargetTail {
  /** Which routine is at `obj[0]`. [port-only] — see the file comment. */
  state: OneHitTargetState;
}

/**
 * A tail for a freshly spawned target.
 *
 * [port-only] The engine writes `obj[0]` in `SpawnFromDescriptor` before the
 * Init runs and the Init overwrites it; there is nothing to zero. The port
 * zeroes because a snapshot has to fully determine the next frame.
 */
export function makeOneHitTargetTail(): OneHitTargetTail {
  return { state: OneHitTargetState.Alive };
}

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
   * Reached only in `g_GameMode` 2 (**Training**, not Arcade) event block
   * 0x0D, gated on
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

/**
 * The bones `OneHitTargetInit` (`FUN_00448ED0`) takes off the skeleton's own
 * draw: slot and hit radius both zeroed, `MOV [ESI + n], EBP` with
 * `ESI = obj+0x194` and `EBP = 0` at `0x00448F8E`..`0x00448FB8` -- `obj+0x4DC`
 * and `+0x554` are bone 5's record `+0x00` and `+0x78`, `+0x68C`/`+0x704`
 * bone 8's, `+0x8CC`/`+0x944` bone 12's, `+0xA7C`/`+0xAF4` bone 15's
 * (`obj+0x20C + bone*0x90`). `[proved]`
 */
export const CLASS20_CARRIED_BONES: readonly number[] = [5, 8, 12, 15];

/**
 * The bones `OneHitTargetBoneDrawHook` (`FUN_00449530`) draws a second model
 * on: the byte map at `0x00449610`, indexed by `bone - 2`, gives 4, 7, 11 and
 * 14 entry 1 of the jump table at `0x00449604` -- the arm at `0x00449566`
 * (bone 2 gets entry 0, the big-head arm, and the rest entry 2, the plain
 * draw) -- which draws the record's slot, then `Push; Translate(child+0x04, +0x08, +0x0C);
 * AssetDrawSlot(child+0x00); Pop` with `child = node+0x18` -- the skeleton
 * node's first child, whose record the Init zeroed. Each of these is the
 * parent of the bone at the same index of {@link CLASS20_CARRIED_BONES}.
 * `[proved]`
 */
export const CLASS20_CARRYING_BONES: readonly number[] = [4, 7, 11, 14];

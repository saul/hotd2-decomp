/**
 * What a wait is, as a rule the machine looks up rather than a branch inside
 * it.
 *
 * `applyWait` was a seventy-line `else if` chain over six opcodes, and
 * `waitSatisfied` a switch over the policies it produced — two places that had
 * to agree, in different halves of the file, with nothing checking that they
 * did. A rule owns both halves for its own opcodes.
 *
 * Registered the way `script/ops/` registers, and for the same reason: a wait
 * that has been read is a module, and one that has not is absent rather than
 * quietly falling through to a default that pretends it passed.
 */
import type { OpJson } from "../../bundle";
import type { CamCommand, WaitPolicy, WalkerHost } from "../walker";

/**
 * The questions a wait may ask the machine.
 *
 * Deliberately small. A rule that needs something not here is a rule reaching
 * into the interpreter, which is the shape being removed.
 */
export interface WaitContext {
  readonly cam: CamCommand | null;
  readonly flags: ReadonlySet<number>;
  readonly queuedEventsPending: number;
  readonly host: WalkerHost;
  /** Retire the action the current shot installed, if it has finished. */
  settleCameraAction(): void;
  /**
   * Whether the camera has finished the move it was on.
   *
   * The enemy gates test it as well as the count: the engine's gate does not
   * open while a scripted shot is still playing.
   */
  cameraHasHandedBack(): boolean;
}

export interface WaitRule {
  /** The opcodes this rule owns. */
  readonly ops: readonly number[];
  /**
   * True if a raised skip flag walks straight past it.
   *
   * `0x40` and `0x41` open with `if (skip == 0) { ...block... }` and `0x42`
   * with `if (skip != 0) { clear and advance }`, so all three are skippable.
   * The enemy-count and flag waits above `0x42` do not test the flag.
   */
  readonly skippable?: boolean;
  /**
   * True if passing it means every enemy it was gating is dead.
   *
   * Only the two enemy counters. Their postcondition says something about the
   * *actors* rather than about the clock, which is what a replay has to
   * reproduce by hand — see `Walker.retireGatedEnemies`.
   */
  readonly retiresEnemies?: boolean;
  /** Decide what this wait is waiting for, on the frame the instruction runs. */
  enter(op: OpJson, ctx: WaitContext): WaitPolicy;
  /** Is it over? Only called for a policy that actually blocks. */
  satisfied?(policy: WaitPolicy, op: OpJson, ctx: WaitContext): boolean;
}

/** How far a wait opcode can be honoured from the bundle alone. */
export const WAIT_NOTES: Record<number, string> = {
  0x40: "approximated: resolves when the current camera move ends",
  // Both counters carry the whole sentence rather than one of them pointing
  // at the other. `wait_enemies_alive` is **0x44** -- every one of the 99
  // enemy gates in stage 2 is that opcode, and 0x43 does not appear at all --
  // so the cross-reference was on the note nobody reads, and what a viewer
  // watching the script sail through one saw was "the second enemy counter,
  // gated with 0x43". That reads as a footnote. It needs to read as an
  // instruction.
  0x43: "the live-enemy gate: real while Shoot is on, and passed when it is "
      + "off, because nothing can then make the count fall",
  0x44: "the live-enemy gate: real while Shoot is on, and passed when it is "
      + "off, because nothing can then make the count fall",
  0x45: "passed: the script flag array is written by gameplay",
  0x46: "the civilian gate: real while Shoot is on, and passed when it is "
      + "off, because rescuing a civilian means killing its captors",
  0x47: "passed: 'camera settled and no live target' needs the runtime",
};

/** The fallback: a wait this client cannot evaluate does not block. */
export function passedBecause(op: OpJson): WaitPolicy {
  return { kind: "passed", why: WAIT_NOTES[op.op] ?? "needs the runtime" };
}

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
import type { OpJson, ScriptJson } from "../../bundle";
import type { CamCommand, WaitPolicy, WalkerHost } from "../walker";

/**
 * The questions a wait may ask the machine.
 *
 * Deliberately small. A rule that needs something not here is a rule reaching
 * into the interpreter, which is the shape being removed.
 */
export interface WaitContext {
  readonly cam: CamCommand | null;
  readonly queuedEventsPending: number;
  /**
   * The decoded stage script.
   *
   * `wait_script_flag` is the one rule that asks: the flags a gate can wait on
   * are raised by the actors *this bundle* holds, so which of them the port
   * can evaluate is a fact about the bundle rather than about the frame. See
   * `waits/flag.ts`.
   */
  readonly script: ScriptJson;
  readonly host: WalkerHost;
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
  readonly retires?: "enemies" | "civilians";
  /**
   * True if passing it means the room it closes has been played out: the
   * room-clear gates `0x43`, `0x44`, `0x46` and `0x47`.
   *
   * A replay needs it for the civilians the room held. Past one of these in
   * play her captors are dead (they are class 0x30 and counted), she has left
   * `g_civilians_alive`, or she has let go of the camera -- and every gate
   * needs `g_camera_free`, which a tracked civilian holds down (bug 18). So
   * her rescue is behind her, and her life's end is the next thing
   * `script/civilian_life.ts` looks for.
   */
  readonly clearsRoom?: boolean;
  /**
   * True if stepping past it means the camera has reached the frame it was
   * waiting for.
   *
   * The same idea as {@link retires}, for the other half of the world a seek
   * has to hand-reproduce. A wait's postcondition is part of the address:
   * `seekTo` replays instructions but observes no waits, so without this it
   * lands on an instruction the script only ever reaches with the shot
   * finished, holding a camera that is still in the middle of it — and then
   * the `finish_sequence` behind the wait freezes the shot where the seek left
   * it. Stage 2 block 16 step 6's `cam_play 581..660` froze at **581**, so
   * neither of the two cues that shot exists to fire — the captor's frame 660
   * and its civilian's 650 — could ever be reached at that address, and the
   * `wait_enemies_alive 0` two instructions later held for ever.
   *
   * Only `0x41` carries it.
   */
  readonly skipRunsCameraOn?: boolean;
  /**
   * True if stepping past it means the action ring has run dry: `0x40`,
   * `wait_queued_events_done`, whose condition is
   * `g_queued_events_pending == 0`. The actions a replay queued have to have
   * run -- a `cam_play` played to its end, a `store_six` stored -- or the
   * landing holds a ring the script has already waited out. The camera's own
   * tasks run them; see `CameraReplayUntil` in `game/camera/actor.ts`.
   */
  readonly drainsQueuedActions?: boolean;
  /**
   * True if stepping past it means the flag it names is now raised.
   *
   * The third of the postconditions, and the same argument as {@link retires}
   * and {@link skipRunsCameraOn}. `wait_script_flag` is only reached past in
   * play once `g_script_flags[operand]` is a 1, so a seek that steps over one
   * and leaves the byte at 0 lands in a state the game cannot be in — and
   * every later reader of that byte, in the script *and* in the classes that
   * read the same array, is looking at a world the address does not describe.
   *
   * Only `0x45` carries it.
   */
  readonly raisesScriptFlag?: boolean;
  /**
   * Decide what this wait is waiting for, on the frame the instruction runs.
   *
   * **The engine's first visit, and it does not read the condition.** Every
   * wait opcode except `0x40` opens with
   * `if (g_evt_yield == 0) { g_evt_yield = 1; return; }`, which ends
   * `EvtInterpreterLoop`'s `do { … } while (g_evt_yield == 0)` for the frame
   * before the test is reached — so a wait costs at least one frame whatever
   * the world looks like when the script arrives at it. A rule that models
   * that returns a blocking policy from here unconditionally and does the
   * whole test in {@link satisfied}.
   *
   * Every rule models it -- `0x41`, `0x42`, `0x43`, `0x44`, `0x45`, `0x46` and
   * `0x47` -- by never passing from here: a condition it cannot hold on is a
   * `yield` policy, which spends the frame and passes on the next visit. See
   * `waits/enemies.ts`, where it is the whole of two bugs. It is also what
   * keeps the action ring honest: a `finish_sequence` queued in front of a
   * wait has a camera-actor pass to run in before the `goto_scene_state`
   * behind the wait parks its slot, and a wait that passed on sight let the
   * `goto` run first and left the driver installed for good.
   */
  enter(op: OpJson, ctx: WaitContext): WaitPolicy;
  /**
   * Is it over? Only called for a policy that actually blocks, and exactly
   * once a frame — the engine's later visits, where the condition is read.
   */
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
  //
  // ...and they are two counters. 0x43 is `g_enemies_present`, which a corpse
  // stays in until its death clip ends; 0x44 is `g_enemies_alive`, which it
  // leaves the moment it dies. See `waits/enemies.ts`.
  0x43: "the corpse-clear gate (`g_enemies_present`): real — it ends when the "
      + "bodies have finished dying",
  0x44: "the live-enemy gate (`g_enemies_alive`): real — it ends when you "
      + "have killed them",
  0x45: "the script-flag gate (`g_script_flags`): real — the array is one "
      + "array, and gameplay writes it too",
  0x46: "the civilian gate: real — it ends when the captors are dead",
  0x47: "passed: this client has no camera to ask whether anything is left "
      + "to track",
};

/** The fallback: a wait this client cannot evaluate does not block. */
export function passedBecause(op: OpJson): WaitPolicy {
  return { kind: "passed", why: WAIT_NOTES[op.op] ?? "needs the runtime" };
}

/**
 * The same excuse for a wait whose engine routine yields on its first visit:
 * the frame is still spent, the condition is still not held on.
 */
export function YieldBecause(op: OpJson): WaitPolicy {
  return { kind: "yield", why: WAIT_NOTES[op.op] ?? "needs the runtime" };
}

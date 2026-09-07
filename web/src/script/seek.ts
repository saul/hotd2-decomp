/**
 * The seek planner.
 *
 * A seek is **not** part of the machine. It is a tool that drives the machine
 * to a target, the way a debugger drives a program — and keeping it inside the
 * interpreter is why `fix(gameplay): a camera cue the seek landed past could
 * never fire` was a walker bug rather than a planner bug. Out here, a seek
 * defect cannot break playback.
 *
 * Everything below goes through `Walker`'s public surface: `reset`,
 * `executeOne`, `stepOverWait`, `takeBranch`, and the cursor. If this file
 * ever needs something the machine does not already offer a player, that is a
 * sign the planner is reaching rather than driving.
 */
import type { Walker } from "./walker";

/**
 * Jump to an exact address and replay everything before it.
 *
 * Replaying rather than jumping is the only way the region, the streamed
 * slots and the camera are right when you land: `region_enter` is an
 * instruction, so the region at op 14 of block 3 is a function of every
 * instruction that ran first. Feed output is suppressed during the replay.
 *
 * **The replay observes no waits.** A wait is a thing the *player* watches;
 * a seek is asked for an address, so every one is stepped over the way
 * `primeToFirstWait` steps over the early ones. Without that the loop stops
 * at the first blocking instruction and every seek in the stage lands in the
 * same place -- stage 2 put all of them on block 0 step 1 op 29.
 *
 * Returns whether it actually arrived, so a caller that asked for an
 * unreachable address can say so instead of silently showing another one.
 */
export function seekTo(w: Walker, block: number, step = 0, opIndex = 0,
                       maxOps = 500000, entryBlock?: number): boolean {
  // From the entry the run actually opened at, not the stage's first one.
  // Stage 3 entered at block 7 cannot reach block 1, and a replay that starts
  // at 0 regardless would land somewhere the run never was.
  w.reset(entryBlock);
  const wasReplaying = w.replaying;
  w.replaying = true;
  try {
    return seekInner(w, block, step, opIndex, maxOps);
  } finally {
    w.replaying = wasReplaying;
  }
}

function seekInner(w: Walker, block: number, step: number, opIndex: number,
                   maxOps: number): boolean {
  let executed = 0;
  const arrived = () =>
    w.block === block && w.step === step && w.opIndex >= opIndex;
  let steered = -1;
  let steerChoice = -1;
  while (executed++ < maxOps) {
    if (arrived() || w.finished) break;
    // Point the *next* block transition at the goal.
    //
    // A branch route only pauses when it has more than one live target;
    // otherwise `advanceStepOrRoute` takes `next[branchChoice]` silently,
    // and `branchChoice` is 0 — so without this every seek follows the first
    // fork and everything on the other one is unreachable. Stage 2 puts
    // blocks 18, 21 and 22 behind block 14's second fork, and the falling
    // containers with them.
    //
    // The graph search is per block; the **assignment is per instruction**,
    // because `advanceStepOrRoute` clears `g_script_branch_var` on every step
    // advance exactly as the engine does. Setting it once on block entry
    // used to work and now does not: a block with more than one step wipes
    // the steer before the route is ever consulted.
    if (w.block !== steered) {
      steered = w.block;
      steerChoice = -1;
      const r = w.currentBlock?.route ?? w.script.routes[w.block];
      if (r?.kind === "branch" && r.next.length > 1) {
        const i = r.next.findIndex((n) => reaches(w, n, block));
        if (i >= 0) steerChoice = i;
      }
    }
    if (steerChoice >= 0) w.branchChoice = steerChoice;
    if (w.wait) {
      w.stepOverWait();
      continue;
    }
    // `halt` (0x4E) parks the interpreter and nothing in the script un-parks
    // it, so anything past one is unreachable in play too. Stop rather than
    // run script the game never would.
    if (w.parked) break;
    if (w.branch) { takeBranchToward(w, block); continue; }
    if (!w.executeOne(true)) break;
  }
  w.wait = null;
  w.branch = null;
  w.host.onBranch(null);
  return arrived();
}

/**
 * Resolve a branch met during a seek by taking the route the goal is
 * actually behind.
 *
 * Falling back to `next[0]` -- which is what `branch_choice` defaults to --
 * would make a seek past a branch point land wherever the first route goes,
 * so an address recorded on the other fork could never be returned to.
 */
function takeBranchToward(w: Walker, goal: number): void {
  const b = w.branch;
  if (!b) return;
  w.takeBranch(b.targets.find((t) => reaches(w, t, goal)) ?? b.targets[0]);
}

/** Whether `goal` is reachable from `from` by following block routes. */
function reaches(w: Walker, from: number, goal: number,
                 limit = 1024): boolean {
  const seen = new Set<number>();
  const queue = [from];
  while (queue.length > 0 && seen.size < limit) {
    const n = queue.shift() as number;
    if (n === goal) return true;
    if (n < 0 || seen.has(n)) continue;
    seen.add(n);
    const blk = w.blockAt(n);
    if (!blk || blk.hole) continue;
    const r = blk.route ?? w.script.routes[n];
    if (!r) continue;
    if (r.kind === "goto") queue.push(r.next[0]);
    else if (r.kind === "branch") queue.push(...r.next);
    else queue.push(n + 1);          // kind 2, as advanceStepOrRoute reads it
  }
  return false;
}

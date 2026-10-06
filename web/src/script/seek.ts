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
 *
 * **The address is checked before the replay starts**, and a target that is
 * not a whole number throws rather than degrading. Without that the failure
 * is silent and total: `arrived()` compares `w.block === block`, so a `block`
 * that is an object can never equal anything, `maxOps` defaults to 500,000,
 * and the "seek" runs the **entire script to its end** and returns `false`.
 * `tools/props43.mjs` was written as `seekTo(walker, { block, step }, rng)` —
 * it never seeked anywhere, reported the block and step from its own `argv` as
 * though they were where it had landed, and so claimed that stage 3 places two
 * type-43 props at block 0 step 3 when what it had measured was the whole of
 * stage 3. Nothing could catch it: the `.mjs` harnesses are outside `tsc`
 * (`allowJs` is off, so `include: ["tools"]` sees only the `.ts` files there),
 * `--experimental-strip-types` and esbuild check nothing, and the return value
 * was discarded. A `TypeError` here is the same trade `L15` describes for
 * `querySelector(...) as T`: fail at the call rather than three conclusions
 * later. `L44`.
 *
 * **A step the run never sits on is refused in its own block.** The engine
 * enters a routed block at step 1 (`EvtAdvanceStepOrRoute`, `0x0045F000`), and
 * picks step 0 only at a scene load in app state 5 or 9 or game mode 2 or 3
 * (`EvtLoadBlockProgram`, `0x0045EBC0`) -- never in the Arcade or Original
 * play the bundles are exported for. `[proved]` So `?block=2&step=0` names an
 * address no run reaches, and the replay used to hunt for it to the end of the
 * scene: it came back `false` with the walker `finished` and the next stage's
 * entry block written, the page showed the end of stage 1, and the first frame
 * of play loaded stage 2 (the boss banner's `block=14&step=0` landed on 14/3/0
 * for the same reason). Once the replay has *left* the target block without
 * arriving, the address is unreachable: a later visit is entered at step 1
 * again and walks the same steps. So the replay stops there, returns `false`,
 * and {@link seekToward} reports where the run entered the block -- the first
 * instruction it reached there, an address the engine does reach. **It does
 * not replay there itself.** A replay writes `G` -- script flags, the route
 * history, the actor pool -- and `Walker.reset` clears none of it, so a second
 * pass from here would land at the block's entry with the rest of the stage
 * already played. Going there is the caller's, through the same reset its first
 * seek took (`Player.seekTo`). The two step writers outside those routines that
 * this argument does not cover, `FUN_00497440` and `FUN_00497760`, sit with the
 * Training select screen and read `g_training_out`, so they are `[likely]`
 * Training-only; `ItemSelectFinish` (`FUN_004895C0`) writes step 1 *within* the
 * block, which the rule allows.
 */
export function seekTo(w: Walker, block: number, step = 0, opIndex = 0,
                       maxOps = 500000, entryBlock?: number): boolean {
  return seekToward(w, block, step, opIndex, maxOps, entryBlock).arrived;
}

/** What a seek found: whether it arrived, and if not, whether it could. */
export interface SeekResult {
  arrived: boolean;
  /**
   * The first `[step, opIndex]` the replay occupied in the target block, or
   * null when it never got there. On a miss with this set, the address is
   * inside a block the run does reach and this is where the run enters it.
   */
  entered: [number, number] | null;
}

/** {@link seekTo}, saying where the run entered the target block. */
export function seekToward(w: Walker, block: number, step = 0, opIndex = 0,
                           maxOps = 500000, entryBlock?: number): SeekResult {
  requireInt("block", block);
  requireInt("step", step);
  requireInt("opIndex", opIndex);
  requireInt("maxOps", maxOps);
  if (entryBlock !== undefined) requireInt("entryBlock", entryBlock);
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

/**
 * One seek argument, or a `TypeError` naming it.
 *
 * `Number.isInteger` and not a `typeof` test: `NaN`, `Infinity` and `1.5` are
 * all numbers and none of them can ever satisfy `arrived()` either.
 */
function requireInt(name: string, v: unknown): void {
  if (Number.isInteger(v)) return;
  const got = typeof v === "object" && v !== null
    ? `${v.constructor?.name ?? "object"} ${JSON.stringify(v)}`
    : `${typeof v} ${String(v)}`;
  throw new TypeError(`seekTo: ${name} must be a whole number, got ${got}`);
}

/** The replay itself. */
function seekInner(w: Walker, block: number, step: number, opIndex: number,
                   maxOps: number): SeekResult {
  let executed = 0;
  const arrived = () =>
    w.block === block && w.step === step && w.opIndex >= opIndex;
  let entered: [number, number] | null = null;
  let steered = -1;
  let steerChoice = -1;
  while (executed++ < maxOps) {
    if (arrived() || w.finished) break;
    if (w.block === block) entered ??= [w.step, w.opIndex];
    // Left the block without arriving: see `seekTo`.
    else if (entered) break;
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
  return { arrived: arrived(), entered };
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

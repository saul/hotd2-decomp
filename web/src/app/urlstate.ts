/**
 * All player state is URL-addressable.
 *
 *     ?stage=2&block=3&step=1&op=14
 *     ?stage=2&slot=59&frame=170
 *     ?stage=1&drive=1&seed=1        the driven clock, for a harness
 *
 * This is a user-facing deep-link feature and the hook a visual-regression
 * harness needs, which is why it is built in from the start rather than
 * bolted on: a test that cannot name a state cannot assert about one.
 */

export interface PlayerState {
  stage: number;
  original: boolean;
  mode: "step" | "play" | "free";
  block?: number;
  step?: number;
  op?: number;
  /** Camera path slot to pose from, instead of running the script. */
  slot?: number;
  frame?: number;
  /** Draw every region at once rather than only the current one. */
  all?: boolean;
  seed?: number;
  /** Halt the tick loop and render exactly one frame. For tests. */
  freeze?: boolean;
  /**
   * Hand the game clock to `app/harness.ts` — see the file for what that
   * means and why it is a flag rather than a mode.
   *
   * Inert unless it is set: with it absent the player has no `advance`, no
   * trace, and the same two clocks it has always had.
   */
  drive?: boolean;
}

const DEFAULTS: PlayerState = { stage: 2, original: false, mode: "step" };

function num(v: string | null): number | undefined {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: string | null): boolean | undefined {
  if (v === null) return undefined;
  return v === "" || v === "1" || v === "true";
}

export function readState(search = window.location.search): PlayerState {
  const q = new URLSearchParams(search);
  const mode = q.get("mode");
  return {
    stage: num(q.get("stage")) ?? DEFAULTS.stage,
    original: bool(q.get("original")) ?? false,
    mode: mode === "play" || mode === "free" || mode === "step"
      ? mode
      : DEFAULTS.mode,
    block: num(q.get("block")),
    step: num(q.get("step")),
    op: num(q.get("op")),
    slot: num(q.get("slot")),
    frame: num(q.get("frame")),
    all: bool(q.get("all")),
    seed: num(q.get("seed")),
    freeze: bool(q.get("freeze")),
    drive: bool(q.get("drive")),
  };
}

export function writeState(s: PlayerState, replace = true): void {
  const q = new URLSearchParams();
  q.set("stage", String(s.stage));
  if (s.original) q.set("original", "1");
  if (s.mode !== DEFAULTS.mode) q.set("mode", s.mode);
  if (s.block !== undefined) q.set("block", String(s.block));
  if (s.step !== undefined) q.set("step", String(s.step));
  if (s.op !== undefined) q.set("op", String(s.op));
  if (s.slot !== undefined) q.set("slot", String(s.slot));
  if (s.frame !== undefined) q.set("frame", String(Math.round(s.frame)));
  if (s.all) q.set("all", "1");
  if (s.seed !== undefined && s.seed !== 1) q.set("seed", String(s.seed));
  if (s.freeze) q.set("freeze", "1");
  // Written back like every other flag, so the address sync that runs while
  // the script plays does not quietly hand the clock back to the wall.
  if (s.drive) q.set("drive", "1");
  const url = `${window.location.pathname}?${q.toString()}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

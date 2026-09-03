/**
 * The engine's play cursor, and the two units derived from it.
 *
 * `obj+0x19C` is an integer the engine increments **once per 60 Hz frame**,
 * over motion data authored at 30 Hz. Three different frame units grew up
 * around that in this port — the cursor itself in half-frames, authored frames
 * in `class25`, and seconds × 60 in `class31/arc.ts` — and the cursor was not
 * even integral: it was a float accumulation of `1/60` seconds, floored back
 * out on read. Repeated addition of `1/60` does not land on multiples of
 * `1/60`, so the derived cursor **skipped values**, going 6, 8 and 30, 32
 * while showing 5 twice. Sixteen call sites test it with `===`, correctly,
 * because `>=` double-fires across the `% (play_length + 1)` wrap — so an
 * authored cue of 7, 15, 31 or 507 could never fire, and the actor parked.
 *
 * This file is one definition of the conversion, for the same reason
 * `core/bams.ts` is one definition of the angle unit: it was three, and the
 * ones that disagreed were the bug. It lives in `core/` rather than `game/`
 * because `render/` has to pose from the same cursor the port counts in, and
 * a value import from `game/` into `render/` is a layer violation — the same
 * placement, and the same reasoning, as `BAMS_TO_RAD`.
 */

/** The engine's frame rate. `obj+0x19C` gains one per frame at this rate. */
export const TICKS_PER_SECOND = 60;

/**
 * Seconds of game time to whole cursor ticks.
 *
 * `Math.round`, not `Math.floor`: every caller hands over a whole number of
 * frames' worth of time, and `Math.floor(3 * (1 / 60) * 60)` is 2.
 */
export function ticksOfSeconds(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}

/** Cursor ticks back to seconds, for anything that genuinely wants a duration. */
export function secondsOfTicks(ticks: number): number {
  return ticks / TICKS_PER_SECOND;
}

/**
 * The **authored** frame of a clip: which of its `frames` poses to draw.
 *
 * The unit the animation data is actually indexed by, and the one the cursor
 * is not. At the shipped 30 Hz this is the cursor halved.
 */
export function authoredFrameOfTicks(ticks: number, fps: number,
                                     frames: number): number {
  if (frames <= 0) return 0;
  const f = Math.floor(ticks * (fps || TICKS_PER_SECOND) / TICKS_PER_SECOND);
  return f % frames;
}

/**
 * The authored frame of a clip that **plays once and holds its last pose**.
 *
 * The difference from {@link authoredFrameOfTicks} is the whole bug this
 * exists for. That function ends in `f % frames`, which is right for a looping
 * clip and wrong for a one-shot — and three call sites wrote
 * `Math.min(frames - 1, authoredFrameOfTicks(...))` believing the `Math.min`
 * would hold the last frame. It cannot: the wrap happens *inside*, so once the
 * clip runs past its length the modulo restarts it at 0 and `Math.min` is
 * handed a small number, every time.
 *
 * The death clip is where that showed. It has no terminator — it is meant to
 * hold until `FUN_00456740` takes the body, which is unread — so a killed
 * zombie played its death animation and then played it again, for ever.
 * `obj.action` shares the shape but ends itself, so it only wrapped in the
 * frames between its last authored frame and the state noticing.
 *
 * Clamping here rather than at each call site is the same argument the head of
 * this file makes: one definition of the conversion, because the versions that
 * disagreed were the bug.
 */
export function authoredFrameHeld(ticks: number, fps: number,
                                  frames: number): number {
  if (frames <= 0) return 0;
  const f = Math.floor(ticks * (fps || TICKS_PER_SECOND) / TICKS_PER_SECOND);
  return Math.min(f, frames - 1);
}

/** An authored frame of a clip back to the cursor ticks that reach it. */
export function ticksOfAuthoredFrame(frame: number, fps: number): number {
  if (!fps) return Math.max(0, Math.round(frame));
  return Math.max(0, Math.round(frame * TICKS_PER_SECOND / fps));
}

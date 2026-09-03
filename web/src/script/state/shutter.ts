/**
 * The HUD shutter and the firing gate — `HudDrawShutterState`, `FUN_00413970`.
 *
 * evt `0x1F` picks one of nine states; the *drawing* is `hud/hud.ts`, which
 * holds no state of its own and reads these fields. What is here is the state
 * machine behind them: which state the shutter is in, which one a `7` restores,
 * how far through its 40-frame slide it is, and the firing gate the machine
 * raises and drops on the way.
 *
 * **The gate is part of this and not next to it.** `DAT_009C8E00` is written
 * on four of `FUN_00413970`'s paths and nowhere else in the whole game, so a
 * gate that lived outside the shutter would be a second owner of one word —
 * the shape that already cost this port once, when the slide counter existed
 * twice (`gateCloseLeft` and the shutter's own) and a seek reset one of them.
 * There is one counter here doing both jobs, exactly as there is one in the
 * exe.
 *
 * Registered as state the way `channels.ts` and `queued.ts` are: the walker
 * owns one of these and exposes `shutterState`, `shutterPrev`,
 * `shutterCounter` and `firingGate` as accessors onto it, so the save slice,
 * `hud/hud.ts` and the HUD strip all go on speaking the same four names.
 */

/** The shutter's slide, in frames. `0x28` in `HudDrawShutterState`. */
export const SHUTTER_FRAMES = 40;

export class Shutter {
  /**
   * `g_bHudShutterState` — `0x009CA0F4`. evt 0x1F, states 0..8.
   *
   * The state is the script's; a snapshot load used to put it back without the
   * slide phase behind it, so a save taken mid-close came back as a shutter
   * frozen half shut.
   */
  state = 2;
  /**
   * `g_bHudShutterPrev` — `0x009C8E9C`. What state 7 restores.
   *
   * `HudDrawShutterState` also compares it against the state to notice a
   * change and seed the counter, and writes it on every path except state 8 —
   * so a blackout does not become the state a later 7 restores.
   */
  prev = 2;
  /**
   * The slide counter: 0 fully closed, 40 fully open.
   *
   * **Not a global.** It is a field on the draw task, at `+0x50`, which is why
   * `globals.tsv` names the two states and not this. State 1 counts it up to
   * 0x28 and hands over to 2; state 3 counts it down to 0, draws the closed
   * bars and hands over to 4 — dropping the firing gate on the way.
   */
  counter = 0;
  /**
   * `DAT_009C8E00` -- the firing gate: 1 in states 0, 1 and 6, and 0 in state 5
   * and when a state-3 close completes. It is not simply "the shutter is
   * open": states 0 and 5 both draw a closed shutter and set it to 1 and 0
   * respectively, so a boss intro can be letterboxed and still let you shoot.
   */
  firingGate = false;

  /**
   * A stage from cold.
   *
   * BSS, so the gate starts **down**: `FUN_0045EBC0` does not touch
   * `DAT_009C8E00`, and nothing raises it until the shutter machine's first
   * state 0, 1 or 6.
   */
  reset(): void {
    this.state = this.prev = 2;
    this.counter = 0;
    this.firingGate = false;
  }

  /**
   * evt `0x1F`, the whole transition.
   *
   * The seeding is the exe's: the draw routine compares the state against
   * `g_bHudShutterPrev` and, on a change, sets the counter to 0x28 entering
   * state 3 and 0 entering state 1. State 7 assigns the previous state back
   * rather than being a state of its own.
   */
  set(state: number): void {
    if (state !== this.state) {
      if (state === 3) this.counter = SHUTTER_FRAMES;
      else if (state === 1) this.counter = 0;
    }
    if (state === 7) {
      this.state = this.prev;
    } else {
      this.prev = this.state;
      this.state = state;
    }
    this.applyFiringGate(this.state);
  }

  /**
   * The slide, on the script's own 60 Hz clock.
   *
   * State 1 counts up and hands over to 2; state 3 counts down and hands over
   * to 4, dropping the firing gate as it goes. Everything else holds.
   */
  step(frames: number): void {
    if (frames <= 0) return;
    if (this.state === 1) {
      this.counter = Math.min(SHUTTER_FRAMES, this.counter + frames);
      if (this.counter >= SHUTTER_FRAMES) this.prev = this.state = 2;
    } else if (this.state === 3) {
      this.counter = Math.max(0, this.counter - frames);
      if (this.counter <= 0) this.settle();
    }
  }

  /**
   * The end of a state-3 close: bars shut, gate down, state 4.
   *
   * Public because stepping *instructions* advances no frames — a close still
   * counting down would never finish and would hold the firing gate up for the
   * rest of the session, so `Walker.stepOnce` settles it by hand.
   */
  settle(): void {
    this.counter = 0;
    this.prev = this.state = 4;
    this.firingGate = false;
  }

  /**
   * The firing gate, exactly as `FUN_00413970` drives it.
   *
   * States 0, 1 and 6 raise it; state 5 drops it at once; state 3 drops it
   * only when the 40-frame close completes, which is why the countdown is kept
   * rather than the gate simply following the state.
   */
  private applyFiringGate(state: number): void {
    if (state === 0 || state === 1 || state === 6) this.firingGate = true;
    else if (state === 5) this.firingGate = false;
  }
}

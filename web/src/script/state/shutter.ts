/**
 * The HUD shutter and the firing gate — `HudDrawShutterState`, `FUN_00413970`.
 *
 * evt `0x1F` picks one of nine states; the *drawing* is `hud/hud.ts`, which
 * holds no state of its own and reads these fields. What is here is the state
 * machine behind them: which state the shutter is in, which one a `7` restores,
 * how far through its 40-frame slide it is, and the firing gate the machine
 * raises and drops on the way.
 *
 * **This machine is the gate's only writer, and the gate itself is in `G`.**
 * `g_nFiringGate` (`0x009C8E00`) is written on five of `FUN_00413970`'s paths
 * — states 0, 1 and 6 raise it, state 5 and a completed state-3 close drop it
 * — and by nothing else that runs inside a scene. (`ResetSceneOnEnter`
 * (`FUN_0045EDD0`) clears it on the way in, and four more writers exist on the
 * game's top-level screens: `FUN_00425E90`, `FUN_00497360`, `FUN_00497760`
 * and `FUN_00480D90`. None of them is reachable from a stage script, so the
 * port models none of them.) An earlier version of this comment said the write
 * happened "on four of `FUN_00413970`'s paths and nowhere else in the whole
 * game", and both halves of that were wrong.
 *
 * The *storage* moved to `game/globals.ts` when the port started honouring the
 * gate, because the routine that reads it — `PlayerFireAndReloadUpdate`
 * (`FUN_00414940`) — is in `game/`, and a value written here and copied there
 * would be exactly the second owner of one word this file was written to
 * avoid. The three fields that stay are the shutter's own: the exe's
 * `g_bHudShutterState`, `g_bHudShutterPrev` and the draw task's counter are
 * script state and nothing outside the script reads them.
 *
 * Registered as state the way `channels.ts` and `queued.ts` are: the walker
 * owns one of these and exposes `shutterState`, `shutterPrev`,
 * `shutterCounter` and `firingGate` as accessors onto it, so the save slice,
 * `hud/hud.ts` and the HUD strip all go on speaking the same four names.
 */
import { G } from "../../game/globals";

/** The shutter's slide, in frames. `0x28` in `HudDrawShutterState`. */
export const SHUTTER_FRAMES = 40;

export class Shutter {
  /**
   * `g_bHudShutterState` — `0x009CA0F4`. evt 0x1F, states 0..8.
   *
   * The state is the script's; a snapshot load used to put it back without the
   * slide phase behind it, so a save taken mid-close came back as a shutter
   * frozen half shut.
   *
   * **An accessor onto `G`, for the same reason `firingGate` is one**, and by
   * the same argument one step on: `game/` both reads and writes this byte
   * now. `BossIntroBannerUpdate` (`FUN_00437AC0`) stores 1 into it at
   * `0x00437F1E` — the only instruction in the image that puts the shutter
   * into state 1 from inside a stage — and class 0x19's entrance reads it at
   * `0x004938F6` to decide whether its fight has started. Neither of those is
   * script code, and a copy kept here and mirrored into `G` would be the
   * second owner of one byte. See the note at the top of this file.
   */
  get state(): number { return G.g_bHudShutterState; }
  set state(v: number) { G.g_bHudShutterState = v; }
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
   * `g_nFiringGate` — `0x009C8E00`: 1 in states 0, 1 and 6, and 0 in state 5
   * and when a state-3 close completes. It is not simply "the shutter is
   * open": states 0 and 5 both draw a closed shutter and set it to 1 and 0
   * respectively, so a boss intro can be letterboxed and still let you shoot.
   *
   * An accessor rather than a field: the word lives in `G`, where the fire
   * routine that reads it can see it. See the note at the top of this file.
   */
  get firingGate(): boolean { return G.g_nFiringGate !== 0; }
  set firingGate(v: boolean) { G.g_nFiringGate = v ? 1 : 0; }

  /**
   * A stage from cold.
   *
   * The gate starts **down**, which is the engine's: `ResetSceneOnEnter`
   * (`FUN_0045EDD0`) writes `g_nFiringGate = 0` at `0x0045EEAC`, and nothing
   * raises it until the shutter machine's first state 0, 1 or 6. The port's
   * `ResetSceneOnEnter` does the same write, so this line is a second statement
   * of it rather than the only one — a stage load and a seek both go through
   * that reset, and this is here for a `Shutter` built on its own.
   *
   * `[diverges]` The *state* is 2 here and 5 in the engine, which zeroes
   * `g_bHudShutterState` and `g_bHudShutterPrev` to 5 in the same routine. A 5
   * draws the closed bars and hands over to 4; a 2 draws nothing. That is a
   * visible difference at the first frame of a stage and it predates this
   * file, so it is named rather than changed here — the port's shutter machine
   * also has no per-frame collapse of 0, 5 and 6 into 4 and 2, and putting the
   * initial state right without that would leave the bars shut for good.
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
    // `HudDrawShutterState`'s own head, `0x00413975`: the *draw* routine is
    // where the engine notices a change and seeds the slide, so a state
    // written by anything other than evt 0x1F is picked up here rather than in
    // {@link Shutter.set}. Class 0x19's intro banner is such a writer, and
    // without this its state 1 would neither seed the counter nor raise the
    // firing gate — the boss would be unshootable for the whole fight.
    if (this.prev !== this.state) {
      if (this.state === 3) this.counter = SHUTTER_FRAMES;
      else if (this.state === 1) this.counter = 0;
      this.applyFiringGate(this.state);
      // `if (g_bHudShutterState != 8) g_bHudShutterPrev = g_bHudShutterState`
      // at the bottom of `FUN_00413970` — a blackout does not become the state
      // a later 7 restores. Without it the seeding above would re-fire every
      // frame and a state 1 would reset its own slide counter for ever.
      //
      // It also makes a `7` restore the state as of the previous *frame*
      // rather than the state before the previous `0x1F`, which is what the
      // engine does and what this machine did not: `g_bHudShutterPrev` is
      // written every frame there and only by `set` here. Two `7`s in the six
      // shipped scripts.
      if (this.state !== 8) this.prev = this.state;
    }
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

/**
 * The two screen-space things the script drives: the HUD shutter and the
 * on-screen message.
 *
 * Both are drawn in the game as view-space geometry at `z = -1`, which is a
 * screen overlay by another name — so they are DOM here rather than scene
 * objects. That keeps them crisp at any canvas size and out of the depth
 * buffer, which is what the game's own draw layer achieves.
 *
 * ## The shutter — evt `0x1F`
 *
 * `FUN_00413970` is a 9-state machine over `DAT_009CA0F4`, drawing asset
 * `0x93E` twice, at view-space `(0, +y, -1)` and `(0, -y, -1)`:
 *
 * ```
 * 0  draw closed at y = 0.35, then -> 4, firing gate on
 * 1  opening: counter 0 -> 40, y = 0.35 + counter * 0.0025, then -> 2
 * 2  (no case) nothing drawn -- fully open
 * 3  closing: counter 40 -> 0, same y; at 0 draw closed and -> 4, gate off
 * 4  draw closed at y = 0.35 (unless DAT_009A5900 & 0x30)
 * 5  draw closed, -> 4, gate off
 * 6  gate on, -> 2
 * 7  restore the previous state
 * 8  one bar at (0, 0, -1) scaled (1, 8, 1) -- a full blackout
 * ```
 *
 * So closed is `y = 0.35` and fully open `y = 0.45`, and the slide is 40
 * frames either way. With the game's 41.100 degree vertical FOV the half
 * height at `z = 1` is `tan(20.55 deg) = 0.3748`, so a closed shutter's inner
 * edge sits at 93.4 % of half height — a thin band top and bottom — and an
 * open one is past the edge of the screen.
 *
 * The bar's own extent comes from asset `0x93E`, which the player has no 2D
 * pipeline for, so each bar is drawn from its inner edge outward to beyond
 * the frame. That is right for a letterbox and cannot be wrong in the visible
 * region.
 *
 * ## The message — evt `0x2D`
 *
 * `FUN_00435B80` picks a variant by player configuration, plays its voice
 * through the ordinary sound dispatcher, and starts a task that holds a
 * sprite on screen for a frame count. The voice and the timing are exact
 * here; the sprite is an asset id with no 2D pipeline behind it, so its id
 * and position are shown instead of the artwork.
 */

import type { MessageVariant } from "./bundle";

/** Closed inner edge, and the 40-frame slide to fully open. */
const SHUTTER_CLOSED_Y = 0.35;
const SHUTTER_STEP = 0.0025;
const SHUTTER_FRAMES = 40;

/** Half-height of the view frustum at z = 1, for the game's 41.1 deg FOV. */
const HALF_HEIGHT = Math.tan((41.1 * Math.PI) / 180 / 2);

/** The game's screen space, which message x/y are expressed in. */
const SCREEN_W = 640;
const SCREEN_H = 480;

export class Hud {
  private readonly root: HTMLElement;
  private readonly top: HTMLElement;
  private readonly bottom: HTMLElement;
  private readonly message: HTMLElement;

  private state = 2;                 // 2 = open, which is the resting state
  private prevState = 2;
  private counter = 0;
  private msgFramesLeft = 0;
  private enabled = true;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud-layer";
    this.top = document.createElement("div");
    this.top.className = "shutter shutter-top";
    this.bottom = document.createElement("div");
    this.bottom.className = "shutter shutter-bottom";
    this.message = document.createElement("div");
    this.message.className = "screen-message";
    this.message.hidden = true;
    this.root.append(this.top, this.bottom, this.message);
    parent.appendChild(this.root);
    this.apply();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.root.hidden = !v;
  }

  reset(): void {
    this.state = this.prevState = 2;
    this.counter = 0;
    this.msgFramesLeft = 0;
    this.message.hidden = true;
    this.apply();
  }

  /** evt `0x1F`. */
  setShutterState(state: number): string | undefined {
    if (state === this.state) return undefined;
    // States 1 and 3 seed the counter from the state they came from: 3 starts
    // fully open and closes, 1 starts closed and opens.
    if (state === 3) this.counter = SHUTTER_FRAMES;
    else if (state === 1) this.counter = 0;
    if (state === 7) {
      this.state = this.prevState;   // 7 restores whatever was showing
    } else {
      this.prevState = this.state;
      this.state = state;
    }
    this.apply();
    return SHUTTER_LABEL[state] ?? `shutter state ${state}`;
  }

  /** evt `0x2D`, once the variant has been chosen. */
  showMessage(group: number, v: MessageVariant | null): string | undefined {
    if (!v) return `message group ${group} has no variant for this player`;
    this.msgFramesLeft = v.frames;
    this.message.hidden = false;
    this.message.textContent =
      `sprite 0x${v.sprite.toString(16).toUpperCase()}` +
      (v.voice_file ? `  ·  ${v.voice_file}` : "");
    // x/y are pixels in the game's 640x480 screen.
    this.message.style.left = `${(v.x / SCREEN_W) * 100}%`;
    this.message.style.top = `${(v.y / SCREEN_H) * 100}%`;
    return `message ${v.frames}f at (${v.x.toFixed(0)}, ${v.y.toFixed(0)})` +
      (v.voice_file ? ` + ${v.voice_file}` : "");
  }

  /** Advance both timers. `frames` is elapsed 60 Hz frames. */
  tick(frames: number): void {
    if (frames <= 0) return;
    if (this.msgFramesLeft > 0) {
      this.msgFramesLeft -= frames;
      if (this.msgFramesLeft <= 0) this.message.hidden = true;
    }
    if (this.state === 1) {
      this.counter = Math.min(SHUTTER_FRAMES, this.counter + frames);
      if (this.counter >= SHUTTER_FRAMES) this.state = 2;
      this.apply();
    } else if (this.state === 3) {
      this.counter = Math.max(0, this.counter - frames);
      if (this.counter <= 0) this.state = 4;
      this.apply();
    }
  }

  private apply(): void {
    // State 8 is a full blackout: one bar at y = 0 scaled 8x vertically.
    if (this.state === 8) {
      this.top.style.height = "100%";
      this.bottom.style.height = "0";
      return;
    }
    // 2 and 6 draw nothing at all.
    const open = this.state === 2 || this.state === 6;
    const y = open
      ? Number.POSITIVE_INFINITY
      : SHUTTER_CLOSED_Y + this.counter * SHUTTER_STEP;
    // The inner edge as a fraction of half-height, then of the whole frame.
    const frac = Math.min(1, y / HALF_HEIGHT);
    const pct = Math.max(0, (1 - frac) * 50);
    this.top.style.height = `${pct}%`;
    this.bottom.style.height = `${pct}%`;
  }

  get describe(): string {
    if (!this.enabled) return "off";
    const label = SHUTTER_LABEL[this.state] ?? `state ${this.state}`;
    const msg = this.msgFramesLeft > 0
      ? `, message ${Math.ceil(this.msgFramesLeft)}f` : "";
    return `${label}${msg}`;
  }
}

const SHUTTER_LABEL: Record<number, string> = {
  0: "closed",
  1: "opening",
  2: "open",
  3: "closing",
  4: "closed",
  5: "closed",
  6: "open",
  7: "restore",
  8: "blackout",
};

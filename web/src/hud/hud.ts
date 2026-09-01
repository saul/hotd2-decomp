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
 * frames either way — but `y` positions the bar's **origin**. Asset `0x93E` is
 * `common.bin` model 129, a four-vertex quad 1.03 wide and 0.10 tall centred
 * on that origin, so the closed bar spans 0.30..0.40 and its inner edge is
 * 0.30. With the game's 41.100 degree vertical FOV the half height at `z = 1`
 * is `tan(20.55 deg) = 0.3748`, so a closed shutter covers the outer 20 % of
 * each half — a 10 % band top and bottom — and clears the frame entirely once
 * the counter passes 30 of its 40 frames.
 *
 * `DAT_009c8e00`, which this machine sets to 1 in states 0/1/6 and 0 in
 * states 3 and 5, is the firing gate: it is 1 while the shutter is open. It is
 * also the flag the player-update routines test before offering a skip, which
 * is why Start only skips a cutscene while the letterbox is closed. See
 * `walker.ts` on `set_skippable_region`.
 *
 * ## The dialogue — evt `0x2D`
 *
 * `FUN_00435B80` picks a variant by player configuration, plays its voice
 * through the ordinary sound dispatcher, and starts a task holding a frame
 * count. That task, `FUN_00435AA0`, is a **subtitle renderer**:
 *
 * ```c
 * frames -= 1;
 * if (frames == 0 || skip_flag || DAT_009A2230) { task_end(); return; }
 * if (DAT_009C911E != 1) {
 *     id = lines[variant * 4 + line];
 *     if (frames < line_rec[id].end_frame) line++;
 *     DrawTextCentred(line_rec[id].x_offset, 384.0, line_rec[id].text);
 *     return;
 * }
 * DrawSprite(rec.sprite, rec.x, rec.y, ...);   // never reached
 * ```
 *
 * The sprite branch is dead: `DAT_009C911E` has exactly one writer in the
 * binary and it stores 2, and the global is BSS, so `== 1` is never true. The
 * game always draws text — which means the actual dialogue is recoverable, and
 * it is: "We're meeting G over there.", "Get him!" (or "Get them!" on the 2P
 * variant), and so on.
 *
 * Lines advance on a **countdown**: `frames` counts down from the record's
 * duration and the line index steps whenever it drops below the current line's
 * `end_frame`. The last line of a variant has `end_frame` 0, so it holds to the
 * end. That is reproduced exactly here.
 *
 * `FUN_00436850` draws the line centred at `x = 320 - len * 5.6 + x_offset` on
 * a 384 baseline in the 640x480 screen, 11.2 px per glyph, in (1.0, 0.8, 0.8).
 * The position and the colour are honoured; the bitmap font is not, since the
 * player has no 2D glyph pipeline, so the browser's own text sits where the
 * game's would.
 */

import type { SubtitleLine } from "../ui/projection";

/**
 * What `app/` hands over for evt `0x2D`.
 *
 * The bundle's `MessageVariant` has nine fields; four of them are what a
 * subtitle needs. Taking only those keeps `hud/` off the exporter's schema —
 * see `ui-reads-projection-only`.
 */
export interface ScreenMessage {
  frames: number;
  x: number;
  y: number;
  lines: SubtitleLine[];
  /** `STAGE2_VOICE\\...wav`, for the feed line. Null when there is no voice. */
  voiceFile: string | null;
}

/** Closed centre offset, and the 40-frame slide to fully open. */
const SHUTTER_CLOSED_Y = 0.35;
const SHUTTER_STEP = 0.0025;
const SHUTTER_FRAMES = 40;

/**
 * Half-height of the bar itself.
 *
 * `MatrixTranslate` positions the bar's **origin**, not its edge, and asset
 * `0x93E` is `common.bin` model 129: a single four-vertex quad spanning
 * x -0.515..0.515 and y -0.05..0.05. So a closed bar occupies 0.30..0.40 and
 * its inner edge is 0.30, not 0.35.
 *
 * That one term is the difference between a letterbox and a hairline. Against
 * the frustum half-height below, an inner edge of 0.30 covers 20% of the half
 * height -- a 10% band top and bottom, which is what the game looks like --
 * where 0.35 covers 6.6%, or 3.3% of the frame, which is nearly invisible.
 */
const SHUTTER_HALF = 0.05;

/**
 * Half-height of the view frustum at z = 1, for the game's 41.1 deg FOV.
 *
 * The quad's half-width of 0.515 is just over the 0.4997 half-width of a 4:3
 * frustum at this FOV, so the bar is authored to span a 4:3 screen exactly and
 * would leave a gap at either side of a wider one. The bars are drawn full
 * width here: at the aspect the artwork was cut for that is what they are, and
 * a letterbox that stops short of the frame edge would be a worse likeness
 * than one that does not.
 */
const HALF_HEIGHT = Math.tan((41.1 * Math.PI) / 180 / 2);

/** The game's screen space, which the subtitle geometry is expressed in. */
const SCREEN_W = 640;
const SCREEN_H = 480;

/** `FUN_00436850`'s baseline, and its per-glyph advance. */
const TEXT_BASELINE_Y = 384;
const GLYPH_ADVANCE = 11.2;

export class Hud {
  private readonly root: HTMLElement;
  private readonly top: HTMLElement;
  private readonly bottom: HTMLElement;
  private readonly message: HTMLElement;

  private state = 2;                 // 2 = open, which is the resting state
  private prevState = 2;
  private counter = 0;
  private msgFramesLeft = 0;
  private lines: SubtitleLine[] = [];
  private lineIndex = 0;
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
    this.lines = [];
    this.lineIndex = 0;
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
  showMessage(group: number, v: ScreenMessage | null): string | undefined {
    if (!v) return `dialogue group ${group} has no variant for this player`;
    this.msgFramesLeft = v.frames;
    this.lines = v.lines;
    this.lineIndex = 0;
    this.drawLine();
    const said = this.lines.map((l) => l.text).join(" / ");
    return said
      ? `“${said}”${v.voiceFile ? `  ·  ${v.voiceFile}` : ""}`
      : `dialogue ${v.frames}f${v.voiceFile ? ` · ${v.voiceFile}` : ""}` +
        " (no subtitle lines)";
  }

  /**
   * End a dialogue outright, as raising the skip flag does.
   *
   * `DrawDialogueSubtitleTask` tests the flag every frame and calls
   * `task_end()`, so the caption goes on the skip frame rather than playing
   * its remaining duration out.
   */
  endMessage(): void {
    this.msgFramesLeft = 0;
    this.lines = [];
    this.lineIndex = 0;
    this.message.hidden = true;
  }

  /** Place and fill the caption for whichever line the countdown is on. */
  private drawLine(): void {
    const l = this.lines[this.lineIndex];
    if (!l || this.msgFramesLeft <= 0) {
      this.message.hidden = true;
      return;
    }
    this.message.hidden = false;
    this.message.textContent = l.text;
    // The game centres on 320 and nudges by x_offset, so the caption's own
    // centre is what moves; the transform below anchors it there.
    const cx = SCREEN_W / 2 + l.xOffset;
    this.message.style.left = `${(cx / SCREEN_W) * 100}%`;
    this.message.style.top = `${(TEXT_BASELINE_Y / SCREEN_H) * 100}%`;
    // Match the game's advance so a long line occupies the width it would.
    this.message.style.fontSize =
      `${(GLYPH_ADVANCE / SCREEN_W) * 100 * 1.35}cqw`;
  }

  /**
   * Advance both timers. `frames` is 60 Hz frames the **walker** advanced.
   *
   * Not wall time: the shutter slide and the dialogue duration are script
   * state measured in game frames, so with playback paused they hold. That is
   * deliberate — stepping onto a `play_dialogue` and having the caption expire
   * two seconds later, while nothing is playing, makes the line unreadable.
   */
  tick(frames: number): void {
    if (frames <= 0) return;
    if (this.msgFramesLeft > 0) {
      this.msgFramesLeft -= frames;
      // `if (frames < line.end_frame) line++` -- the countdown, not a timer.
      const cur = this.lines[this.lineIndex];
      if (cur && this.lineIndex < this.lines.length - 1
          && this.msgFramesLeft < cur.endFrame) {
        this.lineIndex++;
      }
      this.drawLine();
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
    // State 8 is a full blackout: one bar at y = 0 scaled 8x vertically, so
    // its half-height is 0.4 against a frustum half-height of 0.375.
    if (this.state === 8) {
      this.top.style.height = "100%";
      this.bottom.style.height = "0";
      return;
    }
    // 2 and 6 draw nothing at all.
    const open = this.state === 2 || this.state === 6;
    const inner = open
      ? Number.POSITIVE_INFINITY
      : SHUTTER_CLOSED_Y + this.counter * SHUTTER_STEP - SHUTTER_HALF;
    // The inner edge as a fraction of half-height, then of the whole frame.
    const frac = Math.min(1, inner / HALF_HEIGHT);
    const pct = Math.max(0, (1 - frac) * 50);
    this.top.style.height = `${pct}%`;
    this.bottom.style.height = `${pct}%`;
  }

  get describe(): string {
    if (!this.enabled) return "off";
    const label = SHUTTER_LABEL[this.state] ?? `state ${this.state}`;
    const msg = this.msgFramesLeft > 0
      ? `, dialogue ${Math.ceil(this.msgFramesLeft)}f` : "";
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

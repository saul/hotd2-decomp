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

/**
 * Closed centre offset, and the step per slide frame.
 *
 * The slide's *length* is `SHUTTER_FRAMES` in `script/walker.ts`, where the
 * counter lives — this layer only turns a counter into a height.
 */
const SHUTTER_CLOSED_Y = 0.35;
const SHUTTER_STEP = 0.0025;

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

/**
 * The shutter and the caption, drawn.
 *
 * A `System`, and it holds **no state of its own**. The shutter's state, its
 * slide counter and the caption's countdown are all on `Walker`, because they
 * are what the script decided and a snapshot has to bring them back. This
 * layer reads them every tick and places two bars and a line of text.
 *
 * That is the whole of step 19, and the bug it fixes is small and long-lived:
 * `loadSnapshot` restored the shutter *state* and not the slide phase, because
 * the phase lived here, so a save taken three frames into a close came back as
 * a shutter frozen part-way shut with no clock behind it. `seekTo` did not
 * have the bug only because it called `reset()` by hand — one path remembering
 * what the other forgot, which is the shape this document keeps calling out.
 *
 * `resync` is therefore the same call as `update`: there is nothing to rebuild
 * that is not already read fresh.
 */
/**
 * What this layer reads. Structural on purpose.
 *
 * It is `Walker`'s shape and it is deliberately not `Walker`'s *type*: `hud/`
 * is the UI layer, and an import from `script/` would make it a second reader
 * of engine state — which is what `layer-direction` counts, and it counted
 * this the first time round. `app/` is the composition root and the only
 * layer allowed to see both sides, so the two lines that put this in the tick
 * order live in `app/systems.ts`.
 */
export interface ShutterView {
  shutterState: number;
  shutterCounter: number;
  captionGroup: number;
  captionFrames: number;
}

/**
 * The four nodes this layer draws onto, handed over by `app/`.
 *
 * The layer used to build them itself and append the root into `#viewport`,
 * which made it a second owner of what is inside the element React renders —
 * and left the shutter's place in the paint order to whichever of React's
 * conditional overlays had mounted first. React renders them now, in
 * `ui/panels/Viewport.tsx`, and hands them across through `UiHost`. The
 * arrangement is deliberate and it is what rule 6 permits: React owns the
 * structure and the classes the stylesheet hangs off, this layer owns the
 * geometry it writes onto them sixty times a second, and neither writes what
 * the other does.
 *
 * The shape is structurally identical to `UiHost["hud"]` rather than imported
 * from it, so `hud/` does not depend on the page's root component to describe
 * four divs. `new Hud(host.hud)` in `app/main.ts` is where the two meet, and
 * `tsc` fails there the moment they drift.
 */
export interface HudElements {
  /**
   * `.hud-layer`, the container.
   *
   * Named here because it is part of the handover and because naming it is
   * what says who owns it: React renders it and renders its `hidden` from
   * `toggles.hud`. The constructor does not keep it — see `setEnabled`.
   */
  root: HTMLElement;
  /** `.shutter-top`, whose `height` is the top bar of the letterbox. */
  top: HTMLElement;
  /** `.shutter-bottom`, likewise. */
  bottom: HTMLElement;
  /** `.screen-message`, the caption. This layer owns its `hidden`. */
  message: HTMLElement;
}

export class Hud {
  private readonly top: HTMLElement;
  private readonly bottom: HTMLElement;
  private readonly message: HTMLElement;

  /**
   * The dialogue table, by group. Installed by `app/` at stage load.
   *
   * The lines are bundle data rather than state, which is why the walker
   * carries the group and not the words.
   */
  messages: (group: number) => ScreenMessage | null = () => null;

  private enabled = true;
  /** What was last drawn, so an unchanged frame costs no DOM writes. */
  private drawn = "";

  // `.hud-layer` itself is not kept. Its `hidden` is the only thing this layer
  // ever wrote on it and that is React's now, so holding a reference would be
  // holding the one node the split says belongs to the other side.
  constructor(nodes: HudElements) {
    this.top = nodes.top;
    this.bottom = nodes.bottom;
    this.message = nodes.message;
    // The caption starts hidden because there is no caption until the script
    // starts one, and this layer is the only writer of that flag — React
    // renders the node and never touches its `hidden`, precisely so there is
    // no moment where the two disagree about a caption that does not exist.
    this.message.hidden = true;
  }

  /**
   * Whether the HUD toggle is on.
   *
   * It no longer hides anything: `.hud-layer`'s `hidden` is rendered by React
   * from `toggles.hud`, which is the same fact this is set from and the only
   * thing it was ever used for. Two writers for one boolean, one of them a
   * frame behind the other, is exactly the bug the seventh rule is about. The
   * flag stays because `describe` reports `"off"` from it, which is a
   * *sentence in the sidebar* and not a pixel.
   */
  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  /**
   * Draw, from the script's state and nothing else.
   *
   * This is the layer's whole update **and** its whole rebuild, which is why
   * `app/` can register it with `drawSystem` and a load, a seek and an
   * ordinary frame all go through one path.
   */
  draw(w: ShutterView | null): void {
    this.apply(w?.shutterState ?? 2, w?.shutterCounter ?? 0);
    this.drawLine(w?.captionGroup ?? -1, w?.captionFrames ?? 0);
  }

  /**
   * Which line the countdown is on.
   *
   * `DrawDialogueSubtitleTask` steps an index when `frames` drops below the
   * current line's `end_frame`. The end frames are fixed and descending and
   * the countdown is monotone, so counting the lines still ahead of it gives
   * the same answer — and keeps the index derived, which is what lets it stay
   * out of the save state. The last line stores `end_frame` 0 and holds.
   */
  private lineFor(lines: readonly SubtitleLine[], framesLeft: number)
      : SubtitleLine | undefined {
    if (!lines.length) return undefined;
    let i = 0;
    while (i < lines.length - 1 && framesLeft < lines[i].endFrame) i++;
    return lines[i];
  }

  /** Place and fill the caption for whichever line the countdown is on. */
  private drawLine(group: number, framesLeft: number): void {
    const v = group >= 0 ? this.messages(group) : null;
    const l = v ? this.lineFor(v.lines, framesLeft) : undefined;
    if (!l || framesLeft <= 0) {
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
   * Two bars, from the state and the counter.
   *
   * `drawn` is a one-string guard rather than a diff: this runs every tick and
   * the shutter changes on perhaps one frame in a thousand.
   */
  private apply(state: number, counter: number): void {
    const key = `${state}:${counter}`;
    if (key === this.drawn) return;
    this.drawn = key;
    // State 8 is a full blackout: one bar at y = 0 scaled 8x vertically, so
    // its half-height is 0.4 against a frustum half-height of 0.375.
    if (state === 8) {
      this.top.style.height = "100%";
      this.bottom.style.height = "0";
      return;
    }
    // 2 and 6 draw nothing at all.
    const open = state === 2 || state === 6;
    const inner = open
      ? Number.POSITIVE_INFINITY
      : SHUTTER_CLOSED_Y + counter * SHUTTER_STEP - SHUTTER_HALF;
    // The inner edge as a fraction of half-height, then of the whole frame.
    const frac = Math.min(1, inner / HALF_HEIGHT);
    const pct = Math.max(0, (1 - frac) * 50);
    this.top.style.height = `${pct}%`;
    this.bottom.style.height = `${pct}%`;
  }

  describe(w: ShutterView | null): string {
    if (!this.enabled) return "off";
    const state = w?.shutterState ?? 2;
    const label = SHUTTER_LABEL[state] ?? `state ${state}`;
    const frames = w?.captionFrames ?? 0;
    return `${label}${frames > 0 ? `, dialogue ${Math.ceil(frames)}f` : ""}`;
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

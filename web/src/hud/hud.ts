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
 * `HudDrawShutterState` (`FUN_00413970`, ported in `game/hud_shutter.ts`) is a
 * nine-state machine over `g_bHudShutterState`, drawing asset `0x93E` at
 * view-space `(0, +y, -1)` and `(0, -y, -1)`:
 *
 * ```
 * 0  draw closed at y = 0.35, then -> 4, firing gate on
 * 1  opening: counter 1 .. 40, y = 0.35 + counter * 0.0025; on the 41st
 *    frame nothing is drawn and it is 2
 * 2  (the tail) nothing drawn -- fully open
 * 3  closing: counter 39 .. 0, same y; on the 41st frame draw closed, -> 4,
 *    gate off
 * 4  draw closed at y = 0.35 (unless g_screen_furniture_flags & 0x30)
 * 5  draw closed, -> 4, gate off
 * 6  gate on, -> 2
 * 7  restore the previous state, and draw nothing that frame
 * 8  one bar at (0, 0, -1) scaled (1, 8, 1) -- a full blackout
 * ```
 *
 * **This layer does not run that machine or read its state.** The routine
 * records each bar it draws into `G.g_hud_shutter_bars` and `app/` hands the
 * list across, the way it hands over the screen sprites -- so what is on the
 * screen is exactly what the engine drew on the last frame, including the
 * frames a 7 draws nothing and the frames a screen card hides the bars.
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

/**
 * One subtitle line, as this layer draws it.
 *
 * Declared here rather than imported from `bundle/` on purpose. A type-only
 * import carries no code, but it makes the UI track the exporter's schema —
 * and the whole point of the boundary is that this side owns the shape of its
 * own input. `app/projection/message.ts` maps the bundle's `DialogueLine` onto
 * this and would not compile if the two drifted.
 *
 * It lived in `ui/projection.ts` until step 28, whose stated contract is "what
 * the UI is allowed to know" and whose every other type is a field of
 * `UiProjection`. This one never was: the only consumer is `ScreenMessage`
 * below, and that is a contract between `app/` and `hud/` that the projection
 * has no part in. The reasoning above is why it is still a declaration and not
 * an import from `bundle/`; only the file it sits in changed.
 */
export interface SubtitleLine {
  text: string;
  /** Added to the centred position, in the game's 640-wide screen. */
  xOffset: number;
  /** The frame count this line gives way at. */
  endFrame: number;
}

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
 *
 * A bar's own vertical scale multiplies it: the blackout's 8 makes it 0.4,
 * past the frustum's 0.3748 both ways.
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
 * A `System`, and it holds **no state of its own**. The caption's countdown is
 * on `Walker` and the shutter's bars are in `G`, as the engine's routine drew
 * them, because a snapshot has to bring both back. This layer reads them every
 * tick and places two bars and a line of text.
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
 *
 * Step 19 left two members behind that were not drawing: an `enabled` flag and
 * a `describe` that turned the shutter state into a word for the HUD strip.
 * `describe` needed a nine-row label table, `script/ops/hud.ts` already had
 * the same nine rows for the feed, and neither copy could tell it was one of
 * two. Step 28 moved the sentence to `app/projection/hud.ts`, which may read
 * both `script/`'s table and the walker, and `enabled` went with it — React
 * had already taken `.hud-layer`'s `hidden` in step 26, so the flag existed
 * only to make that one string say `"off"`. What is left here draws.
 */
/**
 * What this layer reads of the walker: the caption. Structural on purpose.
 *
 * It is `Walker`'s shape and it is deliberately not `Walker`'s *type*: `hud/`
 * is the UI layer, and an import from `script/` would make it a second reader
 * of engine state — which is what `layer-direction` counts, and it counted
 * this the first time round. `app/` is the composition root and the only
 * layer allowed to see both sides, so the two lines that put this in the tick
 * order live in `app/systems.ts`.
 *
 * It carried the shutter's state and counter too, and this layer turned them
 * into bars. It no longer does: the bars are {@link ShutterBarView}s, what the
 * engine's routine drew.
 */
export interface CaptionView {
  captionGroup: number;
  captionFrames: number;
}

/**
 * One bar `HudDrawShutterState` drew: its origin's `y` in view space at
 * `z = -1`, and its vertical scale. Structural, like {@link ScreenSpriteView}:
 * the engine's type is `ShutterBar` in `game/hud_shutter.ts`.
 */
export interface ShutterBarView {
  y: number;
  sy: number;
}

/**
 * One screen sprite to draw: `DrawScreenSprite`'s arguments as the engine
 * recorded them. Structural, like {@link CaptionView}: the engine's type is
 * `ScreenSprite` in `game/hud_readout.ts`, and `app/` hands its list across.
 */
export interface ScreenSpriteView {
  id: number;
  /** The anchor point in the 640x480 screen, y down -- see `flags`. */
  x: number;
  y: number;
  /** Multiply the image's own size. */
  sx: number;
  sy: number;
  /** 0..1. */
  alpha: number;
  /**
   * The quad's depth. The HUD's readouts are at 1.0 and nearer; anything
   * deeper sits behind the 3D and is not this layer's to draw (see
   * `render/screen_sprites_deep.ts`).
   */
  depth: number;
  /**
   * The low nibble is the anchor, in half-extents from the top-left:
   * `(flags & 3, flags >> 2 & 3)`, or `(1, 1)` -- the top-left itself -- when
   * it is 0. 10 is the centre.
   */
  flags: number;
  /**
   * `0xRRGGBB` the image is multiplied by -- a lit quad's vertex colour
   * (`SubmitScreenSpriteQuad`, flags bit `0x2000`) -- or absent for white.
   */
  tint?: number;
}

/** One sprite's image: the texture's size and a URL for it. */
export interface ScreenSpriteImage {
  w: number;
  h: number;
  url: string;
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
   * `toggles.hud`. The constructor does not keep it, and since step 28 there
   * is no member of this class that could want it.
   */
  root: HTMLElement;
  /** `.shutter-top`, whose `height` is the top bar of the letterbox. */
  top: HTMLElement;
  /** `.shutter-bottom`, likewise. */
  bottom: HTMLElement;
  /** `.screen-message`, the caption. This layer owns its `hidden`. */
  message: HTMLElement;
  /**
   * `.hud-screen`, a 640x480 canvas fitted to the game's 4:3 screen: the
   * readouts `DrawScreenSprite` draws. This layer owns its pixels.
   */
  screen: HTMLCanvasElement;
}

export class Hud {
  private readonly top: HTMLElement;
  private readonly bottom: HTMLElement;
  private readonly message: HTMLElement;
  private readonly screen: CanvasRenderingContext2D | null;

  /**
   * The screen sprites' images, by id. Installed by `app/` at stage load from
   * the bundle; a sprite with none is not drawn.
   */
  spriteImages: (id: number) => ScreenSpriteImage | null = () => null;
  /** Decoded images by URL, so a frame never waits on a decode twice. */
  private readonly images = new Map<string, HTMLImageElement>();
  /** {@link tinted}'s canvases, by URL and colour. */
  private readonly tints = new Map<string, HTMLCanvasElement>();
  /** What the screen last showed, as a string, so an unchanged frame costs nothing. */
  private screenDrawn = "";

  /**
   * The dialogue table, by group. Installed by `app/` at stage load.
   *
   * The lines are bundle data rather than state, which is why the walker
   * carries the group and not the words.
   */
  messages: (group: number) => ScreenMessage | null = () => null;

  /** What was last drawn, so an unchanged frame costs no DOM writes. */
  private drawn = "";

  // `.hud-layer` itself is not kept. Its `hidden` is the only thing this layer
  // ever wrote on it and that is React's now, so holding a reference would be
  // holding the one node the split says belongs to the other side.
  constructor(nodes: HudElements) {
    this.top = nodes.top;
    this.bottom = nodes.bottom;
    this.message = nodes.message;
    this.screen = nodes.screen.getContext("2d");
    // The caption starts hidden because there is no caption until the script
    // starts one, and this layer is the only writer of that flag — React
    // renders the node and never touches its `hidden`, precisely so there is
    // no moment where the two disagree about a caption that does not exist.
    this.message.hidden = true;
  }

  /**
   * Draw, from what the engine drew and nothing else.
   *
   * This is the layer's whole update **and** its whole rebuild, which is why
   * `app/` can register it with `drawSystem` and a load, a seek and an
   * ordinary frame all go through one path.
   */
  draw(w: CaptionView | null,
       sprites: readonly ScreenSpriteView[] = [],
       bars: readonly ShutterBarView[] = []): void {
    this.apply(bars);
    this.drawLine(w?.captionGroup ?? -1, w?.captionFrames ?? 0);
    this.drawSprites(sprites);
  }

  /**
   * The frame's screen sprites, in the order the engine drew them.
   *
   * `DrawSpriteQuadCommand` (0x004A7AB0) draws the texture `w * sx` by
   * `h * sy` about the anchor the flags name (the top-left for every HUD
   * readout, the centre for `ScreenSpriteDraw`), and the canvas's backing
   * store is the game's 640x480, so that is the whole of the mapping. The
   * images arrive the right way up from the exporter. An image still decoding
   * is skipped and the frame is marked undrawn, so the next draw fills it in.
   */
  private drawSprites(sprites: readonly ScreenSpriteView[]): void {
    const ctx = this.screen;
    if (!ctx) return;
    let key = "";
    // Only the ones in the HUD's own plane -- depth 1.0 or nearer.
    const near = sprites.filter((s) => s.depth <= 1);
    for (const s of near) {
      key += `${s.id},${s.x},${s.y},${s.sx},${s.sy},${s.alpha},${s.flags},`
        + `${s.tint ?? ""};`;
    }
    if (key === this.screenDrawn) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    let complete = true;
    for (const s of near) {
      const src = this.spriteImages(s.id);
      if (!src) continue;
      const img = this.image(src.url);
      if (!img.complete || img.naturalWidth === 0) {
        complete = false;
        continue;
      }
      // `g_sprite_quad_corners` less the anchor, in half-extents: the left
      // edge is `(1 - ax)` of them from x, the top `(1 - ay)` from y.
      const w = src.w * s.sx;
      const h = src.h * s.sy;
      const a = s.flags & 0xf;
      const ax = a === 0 ? 1 : a & 3;
      const ay = a === 0 ? 1 : (a >> 2) & 3;
      ctx.globalAlpha = Math.max(0, Math.min(1, s.alpha));
      const src2 = s.tint === undefined || s.tint === 0xffffff
        ? img : this.tinted(img, src.url, s.tint);
      ctx.drawImage(src2, s.x + (1 - ax) * w / 2, s.y + (1 - ay) * h / 2,
                    w, h);
    }
    ctx.globalAlpha = 1;
    this.screenDrawn = complete ? key : "";
  }

  /**
   * The image multiplied by `tint`, its alpha kept: what a vertex colour does
   * to a textured quad. Made once per image and colour -- a highlighted row
   * is a handful of glyphs in red -- on a canvas that never enters the page.
   */
  private tinted(img: HTMLImageElement, url: string,
                 tint: number): HTMLImageElement | HTMLCanvasElement {
    const key = `${url}#${tint}`;
    let c = this.tints.get(key);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d");
    if (!g) return img;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = `#${tint.toString(16).padStart(6, "0")}`;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(img, 0, 0);
    this.tints.set(key, c);
    return c;
  }

  private image(url: string): HTMLImageElement {
    let img = this.images.get(url);
    if (!img) {
      img = new Image();
      img.src = url;
      this.images.set(url, img);
    }
    return img;
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
   * The engine's bars, as two edge-anchored bands.
   *
   * `drawn` is a one-string guard rather than a diff: this runs every tick and
   * the shutter changes on perhaps one frame in a thousand.
   */
  private apply(bars: readonly ShutterBarView[]): void {
    const { top, bottom } = shutterCover(bars);
    const key = `${top}:${bottom}`;
    if (key === this.drawn) return;
    this.drawn = key;
    this.top.style.height = `${top}%`;
    this.bottom.style.height = `${bottom}%`;
  }
}

/**
 * How much of the frame the engine's bars cover from the top edge and from
 * the bottom edge, in percent of the frame's height.
 *
 * Every bar the routine draws touches an edge of the frustum -- a shut bar
 * spans 0.30..0.40 against a half-height of 0.3748, a sliding one moves out
 * past it, and the blackout's spans -0.4..0.4 and so touches both -- which is
 * why two bands anchored at the edges are enough to show all of them. A bar
 * that reached neither edge could not be drawn this way, and no arm of the
 * routine draws one.
 *
 * Exported for `test:ui`, which pins the closed band, the slide and the
 * blackout against the numbers the routine draws.
 */
export function shutterCover(bars: readonly ShutterBarView[])
    : { top: number; bottom: number } {
  let top = 0;
  let bottom = 0;
  const frame = 2 * HALF_HEIGHT;
  for (const b of bars) {
    const half = SHUTTER_HALF * b.sy;
    const lo = b.y - half;
    const hi = b.y + half;
    if (hi >= HALF_HEIGHT) top = Math.max(top, HALF_HEIGHT - lo);
    if (lo <= -HALF_HEIGHT) bottom = Math.max(bottom, hi + HALF_HEIGHT);
  }
  const pct = (v: number) => Math.min(100, Math.max(0, v / frame * 100));
  return { top: pct(top), bottom: pct(bottom) };
}

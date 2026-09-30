/**
 * Screen sprites: the engine's 2D draw call, recorded for the HUD layer.
 *
 * Every 2D picture the engine puts over the scene by sprite id -- the in-play
 * readouts (`hud_readout.ts`), and the game-over screen's sprites next --
 * goes through `DrawScreenSprite` (`FUN_0041C6D0`), which builds a 14-dword
 * record and hands it to `SpriteDrawCheckedBank` (`FUN_0041C630`):
 *
 * ```
 * +0x00 id   +0x04 x   +0x08 y   +0x0C depth   +0x10 sx   +0x14 sy
 * +0x18 u0 = 0   +0x1C v0 = 0   +0x20 u1 = 1   +0x24 v1 = 1
 * +0x28 rot (arg 7)   +0x2C 1.0   +0x30 -1   +0x34 flags (arg 8)
 * ```
 *
 * `[proved]` from the decompile. The quad is drawn `w * sx` by `h * sy` from
 * the top-left corner `(x, y)` of the 640x480 screen, y down
 * (`DrawSpriteQuadCommand`, `FUN_004A7AB0`).
 *
 * The port's screen is the HUD layer, which may not read the engine, so a
 * call is recorded into `G.g_screen_sprite_draws` and `app/` hands the list
 * across. Nothing here is HUD-specific: a routine that draws by sprite id
 * pushes a record, and the layer draws whatever the list holds, in order,
 * from the bundle's images for those ids.
 */
import { G } from "./globals";

/**
 * One `DrawScreenSprite` call.
 *
 * `[port-only]` as a record: the engine turns the call straight into a quad.
 * The fields are the call's own arguments.
 */
export interface ScreenSprite {
  /** The sprite id: `g_screen_sprite_bank` / `g_screen_sprite_tex_slot`. */
  id: number;
  /** Top-left corner, 640x480, y down. */
  x: number;
  y: number;
  /** z and rhw; 1.0 for most, 0.98 for digits over a sprite. */
  depth: number;
  /** Multiplies the texture's width and height. */
  sx: number;
  sy: number;
  /**
   * `+0x2C` -- the quad's alpha, 0..1. `DrawScreenSprite` writes 1.0;
   * `ScreenSpriteDraw` passes its own.
   */
  alpha: number;
  /**
   * `+0x34` -- the flags word. The low nibble is the **anchor**:
   * `DrawSpriteQuadCommand` (`FUN_004A7AB0`) places the quad's corners at
   * `g_sprite_quad_corners` (`{1,3},{3,3},{1,1},{3,1}`) less
   * `(flags & 3, flags >> 2 & 3)` half-extents, or less `(1, 1)` when the
   * nibble is 0 -- so 0 puts `(x, y)` at the top-left and 10 (`2, 2`) at the
   * centre. `[proved]` Bits `0x10`/`0x20` flip U/V; no call the port makes
   * sets them. Bit `0x2000` is {@link SCREEN_SPRITE_LIT}.
   */
  flags: number;
  /**
   * `0xRRGGBB` -- the vertex colour a {@link SCREEN_SPRITE_LIT} quad takes
   * from `g_render_light_colour_r..b` as it is submitted; absent for every
   * other sprite, which is drawn white. The image is multiplied by it.
   */
  tint?: number;
  /**
   * `+0x28` -- the quad's turn about its anchor, BAMS; absent for 0. The
   * trunk's two arrows in its two-player panel are the only callers that
   * pass anything else (`ItemSelectDrawPanels`, `0x1000` and `0xF000`).
   */
  rot?: number;
}

/**
 * Flags bit `0x2000`: **the quad is lit.** `SubmitScreenSpriteQuad`
 * (`FUN_004ACD20`) tests it (`TEST DH, 0x20` at `0x004ACE27`) and builds the
 * vertex colour from the render light colour `SetRenderLightColour` last set
 * -- `g_render_light_colour_r`, `g_`, `b` at `0x007E7998`..`A0`, each times
 * 255 -- instead of white, with the record's alpha on top either way.
 * `[proved]` The options screen's text and its EXIT are the port's only
 * callers that set it, which is how a highlighted row comes out red.
 */
export const SCREEN_SPRITE_LIT = 0x2000;

/** A light colour as the quad's `0xRRGGBB`: each channel times 255. */
function LightToTint(rgb: readonly number[]): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.trunc(v * 255)));
  return (c(rgb[0]) << 16) | (c(rgb[1]) << 8) | c(rgb[2]);
}

/**
 * `[port-only]` -- one record, as `SubmitScreenSpriteQuad` takes it: the
 * light colour goes in only when the flags ask for it.
 */
function ScreenSpriteRecord(id: number, x: number, y: number, depth: number,
                            sx: number, sy: number, alpha: number,
                            flags: number): ScreenSprite {
  const s: ScreenSprite = { id, x, y, depth, sx, sy, alpha, flags };
  if ((flags & SCREEN_SPRITE_LIT) !== 0) {
    s.tint = LightToTint(G.g_render_light_colour);
  }
  return s;
}

/**
 * `SetRenderLightColour` — `FUN_004AA0A0`. The light colour the next lit
 * draw takes -- `g_render_light_colour_r`, `g`, `b` -- and the light
 * generation up one. The port records it for the 2D quads that read it
 * ({@link SCREEN_SPRITE_LIT}); the 3D draws that call it are the renderer's,
 * which has its own copy of the scene light (`render/lighting.ts`).
 */
export function SetRenderLightColour(r: number, g: number, b: number): void {
  G.g_render_light_colour = [r, g, b];
}

/**
 * `DrawScreenSprite` — `FUN_0041C6D0`. Recorded rather than drawn; see
 * `G.g_screen_sprite_draws`. The flags word is carried for its anchor
 * nibble, its U/V flips and {@link SCREEN_SPRITE_LIT}. `rot` is the engine's
 * seventh argument, last here because only the trunk passes one.
 */
export function DrawScreenSprite(id: number, x: number, y: number,
                                 depth = 1, sx = 1, sy = 1, flags = 0,
                                 rot = 0): void {
  const s = ScreenSpriteRecord(id, x, y, depth, sx, sy, 1, flags);
  if (rot !== 0) s.rot = rot;
  G.g_screen_sprite_draws.push(s);
}

/** `ScreenSpriteDraw`'s flags word: anchor `(2, 2)`, the sprite's centre. */
const SCREEN_SPRITE_DRAW_FLAGS = 10;

/**
 * `ScreenSpriteDraw` — `FUN_00499F00`. The same record as `DrawScreenSprite`
 * builds, with the caller's alpha at `+0x2C` and flags 10 -- so `(x, y)` is
 * the sprite's **centre** -- and on through `SpriteDrawCheckedBank`.
 * `ScreenSpriteAnimTick`'s draw. `[proved]`
 */
export function ScreenSpriteDraw(id: number, x: number, y: number,
                                 depth: number, sx: number, sy: number,
                                 alpha: number): void {
  G.g_screen_sprite_draws.push({ id, x, y, depth, sx, sy, alpha,
                                 flags: SCREEN_SPRITE_DRAW_FLAGS });
}

/**
 * One cell of the layered queue: the record `DrawScreenSpriteLayered` builds,
 * and the layer it was pushed on.
 */
export interface QueuedScreenSprite {
  sprite: ScreenSprite;
  /** `+0x38` — which of the four header cells it is linked behind. */
  layer: number;
}

/**
 * The queue's record cells: from the cell after the fourth header
 * (`0x007C22A8`) to the bound `ScreenSpriteQueuePush` refuses at
 * (`CMP ECX, 0x7c29a8` at `0x0041C766`), 0x40 bytes each.
 */
export const SCREEN_SPRITE_QUEUE_CELLS = (0x007c29a8 - 0x007c22a8) / 0x40;

/** The four header cells `ScreenSpriteQueueReset` chains, one per layer. */
export const SCREEN_SPRITE_QUEUE_LAYERS = 4;

/**
 * `ScreenSpriteQueuePush` flags every cell with this: `OR DH, 0x7` at
 * `0x0041C7D0`. Bits 8..10 are the quad's **depth compare**:
 * `DrawSpriteQuadCommand` (`FUN_004A7AB0`) puts them in the PVR2 ISP word
 * (0 standing for 4) and `TranslatePvr2StateToD3D` (`FUN_004A7780`) maps them
 * through `g_ZFuncTable` (`[1, 7, 3, 5, 4, 6, 2, 8]`) -- so a plain sprite is
 * `D3DCMP_LESSEQUAL` and a queued one `D3DCMP_ALWAYS`, drawn over whatever the
 * scene has at its depth. `render/screen_sprites_deep.ts` honours it.
 */
const QUEUED_FLAG_BITS = 0x700;

/**
 * `DrawScreenSpriteLayered` — `FUN_0041C800`. `DrawScreenSprite`'s record,
 * with a ninth argument, the **layer**, and handed to the queue instead of
 * drawn. The rotation argument is 0 at every call and is not carried.
 */
export function DrawScreenSpriteLayered(id: number, x: number, y: number,
                                        depth: number, sx: number, sy: number,
                                        flags: number, layer: number): void {
  ScreenSpriteQueuePush(ScreenSpriteRecord(id, x, y, depth, sx, sy, 1, flags),
                        layer);
}

/**
 * `OptionsDrawSprite` — `FUN_00488000`. The same record as
 * `DrawScreenSprite` builds, with every field the caller's: depth, both
 * scales, the rotation word (`+0x28`, not carried -- see
 * {@link DrawScreenSprite}), the alpha (`+0x2C`) and the flags (`+0x34`); UVs
 * 0..1 and `-1` at `+0x30` as ever. A negative id draws nothing
 * (`TEST EAX, EAX; JL` at `0x00488007`). Only the options screen and its two
 * sub-screens call it. `[proved]`
 */
export function OptionsDrawSprite(id: number, x: number, y: number,
                                  depth: number, sx: number, sy: number,
                                  _rot: number, alpha: number,
                                  flags: number): void {
  if (id < 0) return;
  G.g_screen_sprite_draws.push(
    ScreenSpriteRecord(id, x, y, depth, sx, sy, alpha, flags));
}

/**
 * `ScreenSpriteQueuePush` — `FUN_0041C760`. The next free cell, the flags
 * word ORed with `0x700`, and the cell linked in **directly behind its
 * layer's header**, so the newest record of a layer is the first drawn.
 * Refused, silently, once the cells run out.
 *
 * The port keeps the cells in push order and lets the flush walk them the
 * way the chain would; the order that comes out is the same.
 */
export function ScreenSpriteQueuePush(s: ScreenSprite, layer: number): void {
  if (G.g_screen_sprite_queue.length >= SCREEN_SPRITE_QUEUE_CELLS) return;
  G.g_screen_sprite_queue.push({
    sprite: { ...s, flags: s.flags | QUEUED_FLAG_BITS }, layer,
  });
}

/**
 * `ScreenSpriteQueueReset` — `FUN_0041CF00`. The four headers re-chained and
 * the cursor back at the first cell: the queue is empty. Once a frame, from
 * `SetupSceneProjection`, ahead of the task walk.
 */
export function ScreenSpriteQueueReset(): void {
  G.g_screen_sprite_queue = [];
}

/**
 * `ScreenSpriteQueueFlush` — `FUN_0041CF30`. Walk the chain from the first
 * header and draw every live cell: layer 0's records newest first, then
 * layer 1's, 2's and 3's. Drawn here means appended to the frame's
 * `g_screen_sprite_draws`, after everything the frame drew directly, which is
 * where `FUN_00418550` puts the flush in the engine's frame.
 */
export function ScreenSpriteQueueFlush(): void {
  const q = G.g_screen_sprite_queue;
  for (let layer = 0; layer < SCREEN_SPRITE_QUEUE_LAYERS; layer++) {
    for (let i = q.length - 1; i >= 0; i--) {
      if (q[i].layer === layer) G.g_screen_sprite_draws.push(q[i].sprite);
    }
  }
}

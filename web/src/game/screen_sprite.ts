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
}

/**
 * `DrawScreenSprite` — `FUN_0041C6D0`. Recorded rather than drawn; see
 * `G.g_screen_sprite_draws`. The rotation and flag arguments are 0 at every
 * call the port makes, and are not carried; a caller that needs them adds
 * them to {@link ScreenSprite} and to the layer's draw.
 */
export function DrawScreenSprite(id: number, x: number, y: number,
                                 depth = 1, sx = 1, sy = 1): void {
  G.g_screen_sprite_draws.push({ id, x, y, depth, sx, sy });
}

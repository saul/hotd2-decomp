/**
 * The banner an Original Mode collectible raises when it is taken.
 *
 * Not an inventory write. `OriginalItemPropUpdate` and `PropUpdateType72`
 * count the pickup into `g_original_items_taken` themselves and then call
 * `SpawnOriginalItemBanner` with the item record's `+0x08`, which is a
 * **screen sprite id**: the task draws that sprite and a frame round it in
 * the middle of the lower screen for two and a half seconds, and does
 * nothing else.
 *
 * ```
 * SpawnOriginalItemBanner (FUN_00475E40):
 *   obj = ActorAlloc(OriginalItemBannerUpdate, 0x378); ActorClearGameFields(obj);
 *   obj+0x2A0 = 0; obj+0x28C = sprite; obj+0x2C0 = 1.0;
 *   g_original_item_banner_count++;
 *
 * OriginalItemBannerUpdate (FUN_00475D00):
 *   if (++obj+0x2A0 > 0x96 || (g_scene_index == 5 && g_original_item_banner_count > 1))
 *       { g_original_item_banner_count--; ActorKill(); }
 *   alpha = obj+0x2A0 < 0x87 ? 1.0 : (0x96 - obj+0x2A0) * (1/15);
 *   SetDrawLayerNibble(0xF); SpriteDrawCheckedBank({obj+0x28C, 320, 370, ..., alpha, flags 0xB});
 *   SetDrawLayerNibble(0xF); SpriteDrawCheckedBank({0x5E0,     320, 370, ..., alpha, flags 9});
 * ```
 *
 * The draws are records in `G.g_screen_sprite_draws`, the way every screen
 * sprite in the port is. The layer nibble has nothing to carry into them:
 * `SetDrawLayerNibble` (`FUN_004A79F0`) stores it at `0x007E78BC`, and the
 * image names that word four times -- the setter, `RenderInitStates`, and
 * the two model-command enqueuers, `RenderEnqueueCommand` and
 * `RenderEnqueueCommandFaded`. A screen sprite's quad goes through neither,
 * so the two calls here change nothing about what this draws. `[proved]`
 */
import { G } from "../globals";

/** One banner: the task's two words the update reads. */
export interface OriginalItemBanner {
  /** `obj+0x28C` — the item's screen sprite. */
  sprite: number;
  /** `obj+0x2A0` — frames drawn so far, stepped before each draw. */
  frame: number;
}

/** `CMP ECX, 0x96; JG` — the last frame drawn. */
export const ITEM_BANNER_FRAMES = 0x96;
/** `CMP ECX, 0x87; JGE` — the frame the fade starts on. */
export const ITEM_BANNER_FADE_FROM = 0x87;
/** `FMUL float ptr [0x00569198]` — 1/15, the fade's step. */
export const ITEM_BANNER_FADE_STEP = 0.06666667014360428;
/** `CMP word ptr [0x009a1a08], 0x5` — the scene that shows one at a time. */
export const ITEM_BANNER_SOLO_SCENE = 5;
/** `MOV dword ptr [ESP + 0x4], 0x43a00000` / `0x43b90000` — (320, 370). */
export const ITEM_BANNER_X = 320;
export const ITEM_BANNER_Y = 370;
/** `MOV dword ptr [ESP + 0x10], 0x5e0` — the frame drawn round the item. */
export const ITEM_BANNER_FRAME_SPRITE = 0x5e0;
/** The two records' flags words: the item's is 0xB, the frame's 9. */
export const ITEM_BANNER_ITEM_FLAGS = 0xb;
export const ITEM_BANNER_FRAME_FLAGS = 9;

/**
 * `SpawnOriginalItemBanner` — `FUN_00475E40`. `obj+0x2C0 = 1.0` is written
 * and never read by the update, so it is not carried.
 */
export function SpawnOriginalItemBanner(sprite: number): void {
  G.g_original_item_banners.push({ sprite, frame: 0 });
  G.g_original_item_banner_count += 1;
}

/**
 * `OriginalItemBannerUpdate` — `FUN_00475D00`. False once it has killed
 * itself.
 */
export function OriginalItemBannerUpdate(b: OriginalItemBanner): boolean {
  b.frame += 1;
  if (b.frame > ITEM_BANNER_FRAMES
      || (G.g_scene_index === ITEM_BANNER_SOLO_SCENE
          && G.g_original_item_banner_count > 1)) {
    G.g_original_item_banner_count -= 1;
    return false;
  }
  const alpha = b.frame < ITEM_BANNER_FADE_FROM
    ? 1 : Math.fround((ITEM_BANNER_FRAMES - b.frame) * ITEM_BANNER_FADE_STEP);
  G.g_screen_sprite_draws.push({
    id: b.sprite, x: ITEM_BANNER_X, y: ITEM_BANNER_Y, depth: 1, sx: 1, sy: 1,
    alpha, flags: ITEM_BANNER_ITEM_FLAGS,
  });
  G.g_screen_sprite_draws.push({
    id: ITEM_BANNER_FRAME_SPRITE, x: ITEM_BANNER_X, y: ITEM_BANNER_Y,
    depth: 1, sx: 1, sy: 1, alpha, flags: ITEM_BANNER_FRAME_FLAGS,
  });
  return true;
}

/**
 * `[port-only]` — the banner tasks, stepped in allocation order, after the
 * props that allocate them (`ActorAlloc` appends to the task list the props
 * are on). A banner that kills itself leaves the list here.
 */
export function OriginalItemBannersTick(): void {
  if (G.g_original_item_banners.length === 0) return;
  G.g_original_item_banners = G.g_original_item_banners.filter(
    (b) => OriginalItemBannerUpdate(b));
}

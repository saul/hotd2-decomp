/**
 * The chapter card in the second attract scene: an animated full screen, then
 * flag 248.
 *
 * `ChapterCardInstall` (`FUN_004342E0`) installs
 * `AttractScene11ChapterCardUpdate` when `g_app_state` is `0x0B`, the state
 * `AppStateDispatch` runs `RunAttractScene11` (`FUN_0041FB00`) in. The port
 * never enters it -- the page plays stages, in app state 6 -- so this is an
 * arm transcribed for the routine's sake, and its `scr_hinichi` sprites
 * (texbank `0x192`, 375 of them) are in no bundle.
 */
import type { ChapterCardActor } from "../actor";
import { G, ScreenFurniture } from "../globals";
import { DrawScreenSprite } from "../screen_sprite";
import { T } from "../tables";
import { CHAPTER_CARD_FLAG } from "./state";

/** `MOV word ptr [EBP + 0x11c], 0xc8` at `0x00434DC0`: 200 frames. */
export const ATTRACT11_CARD_FRAMES = 0xc8;
/** The dwell the flash frames replace the others in: `CMP AX, 0x48; JG` / `CMP AX, 0x3c; JL`. */
const FLASH_FROM = 0x3c;
const FLASH_TO = 0x48;
/** 5 x 15 tiles of 128x32: `CMP EBX, 0x280`, `CMP EAX, 0x1e0`. */
const TILE_W = 0x80;
const TILE_H = 0x20;
const ROW_END = 0x280;
const SCREEN_END = 0x1e0;
/** `ADD EDI, 0x5`: five ids a row. */
const ROW_IDS = 5;
/** `PUSH 0x40000000`: two units deep. */
const DEPTH = 2;
/** `MOV ECX, 0xa; DIV ECX` then `SHR EDX, 0x1`: a frame per two ticks, five. */
const FRAME_CYCLE = 10;

/** `AttractScene11ChapterCardUpdate`'s two subs, `obj+0x1312`. */
enum Sub {
  Setup = 0,
  Hold = 1,
}

/** `(v << 16) >> 16`. */
function s16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * `AttractScene11ChapterCardUpdate` — `FUN_00434DA0`. Sub 0 latches the dwell
 * at 200 and falls into sub 1; sub 1 draws the frame; every sub counts the
 * dwell down, and at zero -- in this order -- raises `g_script_flags[0xF8]`
 * (`MOV byte ptr [0x009c72f8], 0x1` at `0x00434EC0`), frees texbank `0x192`
 * (an asset job, which the port has no bank residency for), drops the
 * furniture bit (`AND AL, 0xDF` at `0x00434ED4`) and kills the card. A sub
 * above 1 skips the draw and still counts (`JMP 0x00434EA8`).
 */
export function AttractScene11ChapterCardUpdate(obj: ChapterCardActor): void {
  const sub = s16(obj.sub);
  if (sub === Sub.Setup) {
    obj.hp = ATTRACT11_CARD_FRAMES;
    obj.sub = s16(sub + 1);                      // `INC ECX; MOV [..], CX`
  }
  if (sub === Sub.Setup || sub === Sub.Hold) AttractScene11CardDraw(obj);
  obj.hp = s16(obj.hp - 1);
  if (obj.hp > 0) return;
  G.g_script_flags[CHAPTER_CARD_FLAG] = 1;
  G.g_screen_furniture_flags &= ~ScreenFurniture.ChapterCard;
  obj.dead = true;                                   // `ActorKill`
  obj.visible = false;
}

/**
 * Sub 1's draw, `0x00434DD0`..`0x00434EA0`: fifteen rows of five 128x32
 * tiles, the frame's first id picked by `g_frame_counter % 10` (unsigned,
 * `DIV`) halved, from the flash table while the dwell is 60..72 and the plain
 * one otherwise -- tested per tile, on a dwell the loop does not change.
 * With no `chapter_card` block in the bundle nothing is drawn.
 * `[port-only]` as a function: the sub's arm.
 */
function AttractScene11CardDraw(obj: ChapterCardActor): void {
  const tables = T.chapterCard;
  if (!tables) return;
  const frame = ((G.g_frame_counter >>> 0) % FRAME_CYCLE) >>> 1;
  let row = 0;
  for (let y = 0; y < SCREEN_END; y += TILE_H) {
    let col = 0;
    for (let x = 0; x < ROW_END; x += TILE_W) {
      const hp = s16(obj.hp);
      const base = hp <= FLASH_TO && hp >= FLASH_FROM
        ? tables.attract11_flash_frames[frame]
        : tables.attract11_frames[frame];
      DrawScreenSprite(base + row + col, x, y, DEPTH, 1, 1, 0);
      col += 1;
    }
    row += ROW_IDS;
  }
}

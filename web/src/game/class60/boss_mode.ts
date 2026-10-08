/**
 * The chapter card in Boss Mode: a backdrop while the boss is brought on,
 * then the fight's clock.
 *
 * `ChapterCardInstall` (`FUN_004342E0`) installs `BossModeChapterCardUpdate`
 * in place of the story card when `g_GameMode` is 3. Boss Mode's blocks place
 * the card too (stage 1 block 16, stage 2 blocks 39 and 41, stage 3 blocks 15
 * and 17, stage 4 blocks 27 and 29, stage 5 block 9, stage 6 block 14), each
 * followed by a `wait_frames` rather than the story blocks' `wait_script_flag
 * 0xF8` -- and this routine never raises flag 248 and never kills itself: it
 * lives for the entry, holding the clock.
 *
 * **Nothing the port runs reaches it**: `g_GameMode` comes from the bundle's
 * `game_mode`, which the exporter writes 0 or 1, and the port has no title
 * menu to choose Boss Mode on (see `game/boss_mode.ts`). It is transcribed
 * because it is an arm of a ported routine; its sprites -- the backdrop's
 * `scr_rank_bos01..06` and the clock's `scr_trn_byo` digits -- are not in
 * any bundle, since no bundle is a Boss Mode stage.
 */
import type { ChapterCardActor } from "../actor";
import { G, ScreenFurniture } from "../globals";
import type { GameHost } from "../host";
import type { ClassFrame } from "../registry";
import { DrawScreenSprite } from "../screen_sprite";
import { T } from "../tables";

/** `BossModeChapterCardUpdate`'s subs, `obj+0x1312` (table `0x00434D88`). */
export enum BossModeCardSub {
  /** Load the backdrop's bank, seed the damage rank; on into 1. */
  Load = 0,
  /** Draw the backdrop until the scene's flag is up. */
  Backdrop = 1,
  /** Free the chapter bank and drop the furniture bit. */
  Release = 2,
  /** Wait for the boss; start the clock; on into 4. */
  AwaitBoss = 3,
  /** Run the clock while the boss is up. */
  Clock = 4,
  /** Blink the final time for 121 frames. */
  Blink = 5,
}

/** The backdrop: 5 x 4 cells of 128x128, `CMP EDI, 0x280` / `CMP EAX, 0x200`. */
const BACKDROP_CELL = 0x80;
const BACKDROP_ROW_END = 0x280;
const BACKDROP_END = 0x200;
/** `ADD EBP, 0x5` at `0x00434A0C`: the sprite ids run five a row. */
const BACKDROP_ROW_IDS = 5;
/** `PUSH 0x40000000`: the backdrop is drawn two units deep. */
const BACKDROP_DEPTH = 2;
/** `LEA ECX, [EAX*4]` at `0x0043498C`: four rank a player in play. */
const RANK_PER_PLAYER = 4;
/** `CMP ECX, 0x78; JLE` at `0x00434D69`: the blink runs until the count passes 120. */
const BLINK_FRAMES = 0x78;
/** The blink: shown while `obj+0x1330 % 30 < 20` (`0x00434A69`..`0x00434A71`). */
const BLINK_PERIOD = 0x1e;
const BLINK_SHOWN = 0x14;

/** The clock's arithmetic: an hour of sixtieths, a minute, a second. */
const CLOCK_WRAP = 0x34bc0;                 // 216000, `SHL EDX, 0x6` of 3375*q
const CLOCK_MINUTE = 0xe10;                 // 3600, magic 0x91A2B3C5
const CLOCK_SECOND = 0x3c;                  // 60, magic 0x88888889
/** Hundredths from the sixtieths left over: `IMUL ECX, ECX, 0x64`. */
const CLOCK_HUNDRED = 0x64;

/** The digit sprites, `ADD EDI, 0xacf` &c. -- `scr_trn_byo`'s ten. */
const CLOCK_DIGIT = 0xacf;
/** The two separators, `PUSH 0x63b` and `PUSH 0x643`. */
const CLOCK_COLON_0 = 0x63b;
const CLOCK_COLON_1 = 0x643;
/** Each draw's x, `PUSH 0x435c0000` .. `PUSH 0x43c40000`. */
const CLOCK_X = [220, 248, 270, 292, 320, 342, 364, 392];
/** Digits at `y` 420 (`0x43D20000`), separators at 438 (`0x43DB0000`). */
const CLOCK_DIGIT_Y = 420;
const CLOCK_COLON_Y = 438;
/** `PUSH 0x3f4ccccd` -- depth 0.8, nearer than the HUD's 1.0. */
const CLOCK_DEPTH = Math.fround(0.8);
/** The separators' `sy`, `PUSH 0x3f19999a`. */
const CLOCK_COLON_SY = Math.fround(0.6);
/** Every clock draw's flags word: `PUSH 0xa`, anchored at its centre. */
const CLOCK_FLAGS = 10;

/** `BossModeClockRead`'s scale and rounding: `[0x00570F58]`, `[0x004C43AC]`. */
const CLOCK_TICKS_PER_MS = Math.fround(0.06000000238418579);
const CLOCK_ROUND = 0.5;

/** `(v << 16) >> 16`. */
function s16(v: number): number {
  return (v << 16) >> 16;
}

/** `(v << 24) >> 24`. */
function s8(v: number): number {
  return (v << 24) >> 24;
}

/**
 * `BossModeChapterCardUpdate` — `FUN_00434920`. One frame: the sub's arm,
 * then the clock's draw for every sub from 3 but 5, and for 5 on the blink's
 * on-frames.
 */
export function BossModeChapterCardUpdate(obj: ChapterCardActor,
                                          f: ClassFrame): void {
  const sub = s16(obj.sub);                   // `MOV AX, word ptr [ESI+0x1312]`
  switch (sub) {
    case BossModeCardSub.Load:
      BossModeCardLoad(obj);
      BossModeCardBackdrop(obj);                                // falls into 1
      break;
    case BossModeCardSub.Backdrop:
      BossModeCardBackdrop(obj);
      break;
    case BossModeCardSub.Release:
      // `AssetQueueFreeTexbank(g_scene_index + 0x18C)` (`ADD EAX, 0x18c` at
      // `0x00434CD0`) -- the story card's bank, not the backdrop's -- is an
      // asset job: the port keeps no bank residency for it to free.
      G.g_screen_furniture_flags &= ~ScreenFurniture.ChapterCard;
      obj.sub = s16(obj.sub + 1);
      break;
    case BossModeCardSub.AwaitBoss:
      if (G.g_boss_engaged === 0) break;
      obj.sub = s16(sub + 1);             // `INC EAX; MOV [ESI+0x1312], AX`
      BossModeClockStart(f.host);
      if (G.g_mode_select_word === 1 && G.g_boss_mode_entry !== 0) {
        BossModeClockSet(G.g_boss_mode_time);
      }
      BossModeCardClock(obj, f.host);                           // falls into 4
      break;
    case BossModeCardSub.Clock:
      BossModeCardClock(obj, f.host);
      break;
    case BossModeCardSub.Blink: {
      const n = obj.chapter.blinkFrames;
      obj.chapter.blinkFrames = n + 1;
      if (n > BLINK_FRAMES) obj.sub = s16(sub + 1);
      break;
    }
  }
  // The tail at `0x00434A46`, on the sub as the arm left it.
  const now = s16(obj.sub);
  if (now < BossModeCardSub.AwaitBoss) return;
  if (now === BossModeCardSub.Blink
      && !((obj.chapter.blinkFrames % BLINK_PERIOD) < BLINK_SHOWN)) return;
  BossModeCardDrawClock();
}

/**
 * Sub 0, `0x00434945`: `TexBankQueueLoad(g_scene_index + 0x160)` (`ADD EAX,
 * 0x160` at `0x0043494C`, `scr_rank_bos01..06`) and
 * `AssetDrainAllJobs` -- asset jobs, which the bundle has done -- then the
 * rank seeded as `ResetDamageRank` (`FUN_00460770`) seeds it, from
 * `g_boss_mode_difficulty` instead of the menu difficulty, plus four for each
 * player in play (`MOVSX DX, byte ptr [ECX + 0x5679f4]`, `ADD EDX, ECX`,
 * stored as a word). `[port-only]` as a function: the sub's arm.
 */
function BossModeCardLoad(obj: ChapterCardActor): void {
  G.g_damage_rank_pending = 0;
  G.g_rank_clock_on = 1;
  G.g_rank_clock = 1;
  const table = T.chars?.difficulty?.initial_rank;
  const seed = table?.[s8(G.g_boss_mode_difficulty)] ?? 0;
  G.g_damage_rank = s16(s8(seed) + G.g_players_in_play * RANK_PER_PLAYER);
  obj.sub = s16(obj.sub + 1);
}

/**
 * Sub 1, `0x004349A3`: the scene's twenty backdrop sprites, row by row, and
 * the sub steps once `g_script_flags[g_boss_mode_backdrop_flags[scene]]` is
 * 1 -- a byte compared with 1, not tested for non-zero. With no
 * `chapter_card` block in the bundle there is neither a backdrop nor a flag
 * to wait on, and the card holds. `[port-only]` as a function: the sub's arm.
 */
function BossModeCardBackdrop(obj: ChapterCardActor): void {
  const scene = s16(G.g_scene_index);
  const base = T.chapterCard?.boss_mode_backdrop_sprites[scene];
  let row = 0;
  for (let y = 0; y < BACKDROP_END; y += BACKDROP_CELL) {
    let col = 0;
    for (let x = 0; x < BACKDROP_ROW_END; x += BACKDROP_CELL) {
      if (base !== undefined) {
        DrawScreenSprite(base + row + col, x, y, BACKDROP_DEPTH, 1, 1, 0);
      }
      col += 1;
    }
    row += BACKDROP_ROW_IDS;
  }
  const flag = T.chapterCard?.boss_mode_backdrop_flags[scene];
  if (flag !== undefined && G.g_script_flags[flag & 0xff] === 1) {
    obj.sub = s16(obj.sub + 1);
  }
}

/**
 * Sub 4, `0x00434D35`: while the boss is engaged the clock is read into
 * `g_boss_mode_time`; the frame it drops, sub 5 and the blink counter zeroed.
 * `[port-only]` as a function: the sub's arm, which sub 3 falls into.
 */
function BossModeCardClock(obj: ChapterCardActor, host: GameHost): void {
  if (G.g_boss_engaged === 0) {
    obj.sub = s16(obj.sub + 1);
    obj.chapter.blinkFrames = 0;
    return;
  }
  G.g_boss_mode_time = BossModeClockRead(host);
}

/**
 * The clock's draw, `0x00434A7A`..`0x00434CBE`: `g_boss_mode_time % 216000`
 * -- an hour of sixtieths, every division truncating toward zero as `IDIV`
 * and the reciprocal multiplies do -- as `mm:ss:hh`, the minutes' tens only
 * when above 0 (`TEST EDI, EDI; JLE`). `[port-only]` as a function: the
 * routine's tail.
 */
function BossModeCardDrawClock(): void {
  const t = G.g_boss_mode_time | 0;
  const r = t - Math.trunc(t / CLOCK_WRAP) * CLOCK_WRAP;
  const mm = Math.trunc(r / CLOCK_MINUTE);
  const rs = r - mm * CLOCK_MINUTE;
  const ss = Math.trunc(rs / CLOCK_SECOND);
  const hh = Math.trunc(((rs - ss * CLOCK_SECOND) * CLOCK_HUNDRED)
                        / CLOCK_SECOND);
  const digit = (i: number, v: number) => {
    DrawScreenSprite(v + CLOCK_DIGIT, CLOCK_X[i], CLOCK_DIGIT_Y, CLOCK_DEPTH,
                     1, 1, CLOCK_FLAGS);
  };
  const colon = (i: number, id: number) => {
    DrawScreenSprite(id, CLOCK_X[i], CLOCK_COLON_Y, CLOCK_DEPTH, 1,
                     CLOCK_COLON_SY, CLOCK_FLAGS);
  };
  const mmTens = Math.trunc(mm / 10);
  if (mmTens > 0) digit(0, mmTens);
  digit(1, mm % 10);
  colon(2, CLOCK_COLON_0);
  digit(3, Math.trunc(ss / 10));
  digit(4, ss % 10);
  colon(5, CLOCK_COLON_1);
  digit(6, Math.trunc(hh / 10));
  digit(7, hh % 10);
}

/**
 * `BossModeClockStart` — `FUN_0049DF00`. `g_boss_mode_clock_start =
 * GetTickCount()`, `g_boss_mode_clock_base = 0`.
 */
export function BossModeClockStart(host: GameHost): void {
  G.g_boss_mode_clock_start = (host.tickCount?.() ?? 0) >>> 0;
  G.g_boss_mode_clock_base = 0;
}

/**
 * `BossModeClockRead` — `FUN_0049DF20`. The milliseconds since the start as
 * an unsigned 32-bit difference widened to 64 (`FILD qword` with a zero high
 * word), times 0.06, plus 0.5, plus the base as a signed dword (`FIADD`),
 * truncated by `__ftol` -- sixtieths of a second, rounded. The low dword is
 * what the caller stores.
 */
export function BossModeClockRead(host: GameHost): number {
  const now = (host.tickCount?.() ?? 0) >>> 0;
  const ms = (now - G.g_boss_mode_clock_start) >>> 0;
  return Math.trunc(ms * CLOCK_TICKS_PER_MS + CLOCK_ROUND
                    + (G.g_boss_mode_clock_base | 0)) | 0;
}

/** `BossModeClockSet` — `FUN_0049DF70`. `g_boss_mode_clock_base = v`. */
export function BossModeClockSet(v: number): void {
  G.g_boss_mode_clock_base = v | 0;
}

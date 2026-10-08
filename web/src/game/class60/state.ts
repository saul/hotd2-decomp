/**
 * Class 0x60's words: the card's own, the title animation's, and the
 * immediates its routines draw with.
 *
 * Data only -- no `registerClass`, nothing at module load -- so `actor.ts`,
 * `globals.ts`, the exporter and the renderer can all import it. The
 * routines are `index.ts`, `title.ts`, `boss_mode.ts` and `attract.ts`.
 */

/**
 * Which routine a class-0x60 object runs: the word at `obj+0x00`.
 *
 * Every card starts on `ChapterCardInstall` (`FUN_004342E0`), the class's
 * handler. Its head replaces itself: in Boss Mode it stores
 * `BossModeChapterCardUpdate` (`MOV dword ptr [ESI], 0x434920` at
 * `0x00434308`), in app state `0x0B` `AttractScene11ChapterCardUpdate`
 * (`MOV dword ptr [ESI], 0x434DA0` at `0x00434336`), and the task walk calls
 * that from the next frame on.
 */
export enum ChapterCardRoutine {
  Install = 0,
  BossMode = 1,
  AttractScene11 = 2,
}

/**
 * `g_script_flags` — `0x009C7200`, index 248: the flag every card raises as
 * it dies. A literal in both routines that raise it, not a field of the
 * record: `BL` (loaded 1 at `0x00434343`) stored at `0x004348C1` by the story
 * card, `MOV byte ptr [0x009c72f8], 0x1` at `0x00434EC0` by app state
 * 0x0B's. The Boss Mode card never raises it.
 */
export const CHAPTER_CARD_FLAG = 0xf8;

/** The tail every class-0x60 object carries. */
export interface ChapterCardTail {
  /** `obj+0x00`. See {@link ChapterCardRoutine}. */
  routine: ChapterCardRoutine;
  /**
   * `obj+0x1330`, s32: `BossModeChapterCardUpdate`'s blink counter, zeroed
   * the frame the boss falls (`0x00434D45`) and counted in sub 5.
   */
  blinkFrames: number;
}

/** `[port-only]` -- a fresh one: `ActorInitFlags` leaves the rest zero. */
export function makeChapterCardTail(): ChapterCardTail {
  return { routine: ChapterCardRoutine.Install, blinkFrames: 0 };
}

/**
 * One record of `g_chapter_title_parts` (`0x007DCAA0`), 0x20 bytes, eight of
 * them. The fields a routine reads:
 *
 * ```
 * +0x08 f32 sx   +0x0C f32 sy   +0x10 s16 frame   +0x18 f32 alpha   +0x1C s16 phase
 * ```
 *
 * `frame` and `phase` are read only in record 0 -- the animation's counter
 * and its state. `+0x00`, `+0x04`, `+0x12` and `+0x14` are zeroed by
 * `ChapterTitleReset` (`FUN_00436A30`) and read by nothing: a scan of
 * `.text` for every dword in `0x007DCAA0..0x007DCBB0` finds only that
 * routine, `ChapterTitleDraw` (`FUN_00436AD0`) and `ChapterCardInstall`. So
 * they are not carried. `[proved]`
 */
export interface ChapterTitlePart {
  sx: number;
  sy: number;
  frame: number;
  alpha: number;
  phase: number;
}

/** The records of `g_chapter_title_parts`: `CMP EAX, 0x7dcba4; JL`. */
export const CHAPTER_TITLE_PARTS = 8;

/** `[port-only]` -- the block as the data segment starts it: zero. */
export function makeChapterTitleParts(): ChapterTitlePart[] {
  return Array.from({ length: CHAPTER_TITLE_PARTS },
    () => ({ sx: 0, sy: 0, frame: 0, alpha: 0, phase: 0 }));
}

/**
 * The scenes `ChapterCardInstall`'s two jump tables have an arm for:
 * `CMP EAX, 0x5; JA` at `0x004343B0` and `0x004345BB`.
 */
export const CHAPTER_CARD_SCENES = 6;

/**
 * What each of sub 0's scene arms writes into `g_chapter_title_sprites`
 * (`0x007DCBA0`), s0..s7 -- the `MOV word ptr [0x007dcba0..ae], imm` runs at
 * `0x004343C5`, `0x00434417`, `0x00434469`, `0x004344BB`, `0x0043450D` and
 * `0x0043455C`. Scene 1's fourth is `0x22A`, out of its run: the id the bank
 * `scr_chapter_st2` added last. The ids resolve to `scr_chapter_st1..st6`,
 * texbanks `0x18C..0x191`, which each stage's script loads before the card.
 */
export const CHAPTER_TITLE_SPRITES: readonly (readonly number[])[] = [
  [0x1fb, 0x1fc, 0x1fd, 0x1fe, 0x1ff, 0x200, 0x201, 0x202],
  [0x203, 0x204, 0x205, 0x22a, 0x206, 0x207, 0x208, 0x209],
  [0x20a, 0x20b, 0x20c, 0x20d, 0x20e, 0x20f, 0x210, 0x211],
  [0x212, 0x213, 0x214, 0x215, 0x216, 0x217, 0x218, 0x219],
  [0x21a, 0x21b, 0x21c, 0x21d, 0x21e, 0x21f, 0x220, 0x221],
  [0x222, 0x223, 0x224, 0x225, 0x226, 0x227, 0x228, 0x229],
];

/**
 * Sub 1's scene arms: the four floats each `PUSH`es for `ChapterTitleDraw`,
 * `(x0, y0, x1, y1)` -- `0x004345CB`, `0x0043461C`, `0x0043466D`,
 * `0x004346BE`, `0x0043470F`, `0x004347B2`. 190/400/320/350/80/222 are
 * `0x433E0000`, `0x43C80000`, `0x43A00000`, `0x43AF0000`, `0x42A00000`,
 * `0x435E0000`.
 */
export const CHAPTER_TITLE_ORIGINS:
    readonly (readonly [number, number, number, number])[] = [
      [190, 80, 400, 350],
      [320, 80, 320, 350],
      [350, 80, 190, 350],
      [190, 80, 400, 350],
      [320, 80, 320, 350],
      [350, 80, 222, 350],
    ];

/**
 * The model scene 5's arm draws before its title: `PUSH 0x1730` at
 * `0x004347A2`, which the stage-6 script loads with `asset_load_slot` just
 * before it places the card and unloads just after the gate. A join key --
 * the exporter ships this slot's model -- so it is here.
 */
export const CHAPTER_CARD_MODEL_SLOT = 0x1730;
/** The scene whose arm draws {@link CHAPTER_CARD_MODEL_SLOT}. */
export const CHAPTER_CARD_MODEL_SCENE = 5;

/**
 * The per-scene caption sprite, `0x42B + scene` (`PUSH 0x42b` at
 * `0x00434612` .. `PUSH 0x430` at `0x004347F5`), drawn only when
 * `g_wCaptionMode` is 1 -- which this build never makes it (see
 * `CAPTION_MODE`). So the exporter does not ship them.
 */
export const CHAPTER_CAPTION_SPRITE_FIRST = 0x42b;

/**
 * The sprite ids every drawn arm of the story card names for `scene`, for
 * the exporter: the eight title sprites. `[port-only]` as a function.
 */
export function ChapterCardSpritesOf(scene: number): readonly number[] {
  return CHAPTER_TITLE_SPRITES[scene] ?? [];
}

/**
 * The asset slots the story card draws for `scene`, for the exporter.
 * `[port-only]` as a function.
 */
export function ChapterCardSlotsOf(scene: number): readonly number[] {
  return scene === CHAPTER_CARD_MODEL_SCENE ? [CHAPTER_CARD_MODEL_SLOT] : [];
}

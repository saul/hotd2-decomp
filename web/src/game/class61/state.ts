/**
 * Class 0x61's words: the card's own, and its figures'.
 *
 * Data only -- no `registerClass`, nothing at module load -- so `actor.ts`,
 * the exporter and the renderer can all import it. See `index.ts` for the
 * routines and `docs/re/stage-end.md` for the reading.
 */

/**
 * Which routine an object of this class runs: the word at `obj+0x00`.
 *
 * The card is `ResultCardInstall` (`FUN_00434EF0`) from its spawn. Each
 * figure it allocates starts on `ResultCardFigureInit` (`FUN_004356A0`),
 * installed by `ActorAlloc` (`0x0043500D`, `0x00435080`), which ends by
 * calling `ResultCardFigureUpdate` (`FUN_00435760`) and storing it at
 * `obj+0x00` (`0x00435752`). The figures have no class id of their own; the
 * port gives them the card's, and this word says which routine they are on.
 */
export enum ResultCardRoutine {
  Card = 0,
  FigureInit = 1,
  FigureUpdate = 2,
}

/** The tail every class-0x61 object carries. */
export interface ResultCardTail {
  /** `obj+0x00`. See {@link ResultCardRoutine}. */
  routine: ResultCardRoutine;
  /**
   * `obj+0x131B`, u8: the figure's place in the card's list, `BL` at
   * `0x0043501A` / `0x0043508D`. Only figure 0 can hold up the life.
   */
  figureIndex: number;
  /**
   * `obj+0x1350`: 1 on every rescued figure when the card's life bonus is
   * above 0 (`0x004350DB`), 0 on the no-rescue figures, which
   * `ActorClearGameFields` left.
   */
  lifeBonus: number;
  /**
   * `model+0x08` (`obj+0x19C`): the play cursor **as the figure's last draw
   * sampled it** from the counter. `ResultCardFigureUpdate` tests it before
   * this frame's draw, so it is a frame behind the counter the port steps
   * after the draw (L62); the node hook reads this frame's.
   */
  cursor: number;
  /**
   * `[port-only]` -- whether `ResultCardFigureDrawNode` (`FUN_004357F0`)
   * drew `common.bin[199]` on bone 5 this frame: the one draw the hook makes
   * that no model record holds, recorded for `render/` as `nodeDrawAlpha` is
   * for the classes that fade a node.
   */
  holdsLife: boolean;
  /**
   * `[port-only]` -- whether the hook took its Original Mode item arm this
   * frame, scaling the bones `RESULT_FIGURE_PART_SCALE` names around their
   * own draw. `g_original_item_part_scale`'s one writer is unported, so in
   * the port it is never true; `render/` applies it all the same.
   */
  partScale: boolean;
}

/** `[port-only]` -- a fresh one: `ActorClearGameFields` zeroes from `+0x34`. */
export function makeResultCardTail(): ResultCardTail {
  return { routine: ResultCardRoutine.Card, figureIndex: 0, lifeBonus: 0,
           cursor: 0, holdsLife: false, partScale: false };
}

/**
 * `common.bin[199]`, the slot `ResultCardFigureDrawNode` draws on bone 5:
 * `PUSH 0x10c3` at `0x004358EF`. A join key -- the exporter puts this slot's
 * model in the bundle and `render/` draws it -- so it is here.
 */
export const RESULT_FIGURE_LIFE_SLOT = 0x10c3;

/** The bone it rides: `CMP word ptr [EDI + 0x14], 0x5` at `0x0043589C`. */
export const RESULT_FIGURE_LIFE_BONE = 5;

/**
 * Its place on that bone: `MatrixTranslate(1.0, -1.0, 0)` then
 * `MatrixRotateX(0x4000)`, `MatrixRotateZ(0)`, `MatrixRotateY(0)` --
 * `0x004358C6`..`0x004358EA`.
 */
export const RESULT_FIGURE_LIFE_OFFSET: readonly [number, number, number] =
  [1.0, -1.0, 0];
export const RESULT_FIGURE_LIFE_ROT_X = 0x4000;

/**
 * `[port-only]` -- a figure's spawn address: bit 26, its place in the list
 * and its character type. `hod2lib/characters.ts` writes the per-type
 * template rows the renderer clones for it at
 * {@link ResultFigureTemplateAt}; neither an evt offset nor any other
 * synthetic address (bits 27..30) sets bit 26.
 */
export const RESULT_FIGURE_AT_BIT = 0x04000000;

/** `[port-only]` -- see {@link RESULT_FIGURE_AT_BIT}. */
export function ResultFigureAt(index: number, type: number): number {
  return (RESULT_FIGURE_AT_BIT | ((index & 0xff) << 8) | (type & 0xff)) >>> 0;
}

/** `[port-only]` -- bit 25, which a template row sets and a figure never. */
export const RESULT_FIGURE_TEMPLATE_BIT = 0x02000000;

/**
 * `[port-only]` -- the template row a figure of `type` is drawn from: bit 26
 * and {@link RESULT_FIGURE_TEMPLATE_BIT}.
 */
export function ResultFigureTemplateAt(type: number): number {
  return (RESULT_FIGURE_AT_BIT | RESULT_FIGURE_TEMPLATE_BIT | (type & 0xff))
    >>> 0;
}

/**
 * The clips a figure can be on, for the exporter to bake: the rescued
 * figures' three (`g_result_figure_records` `+0x02`, which the exporter reads
 * from the records themselves), figure 0's life clip `0x180` (`PUSH 0x180`
 * at `0x0043579A`), and the no-rescue figures' `rand() % 3 + 0x18B`
 * (`ADD EDX, 0x18b` at `0x00435055`).
 */
export const RESULT_FIGURE_LIFE_MOTION = 0x180;
export const RESULT_FIGURE_IDLE_MOTION_BASE = 0x18b;
export const RESULT_FIGURE_IDLE_MOTIONS = 3;

/**
 * The result card's sprites and glyph models, for the exporter to put in
 * the bundle: the seventeen `scr_result` tiles (`MOV EBX, 0xa2a` at
 * `0x00435118`, one per drawn cell) and `result.bin`'s thirty-eight slots,
 * `0x165F..0x1684` -- the digits `ResultCardDrawScore` adds to `0x165F`, the
 * two `0x1660 + p`, `0x1679` and every slot the glyph strings name.
 */
export const RESULT_CARD_TILE_FIRST = 0xa2a;
export const RESULT_CARD_TILES = 17;
export const RESULT_CARD_SPRITES: readonly number[] =
  Array.from({ length: RESULT_CARD_TILES }, (_u, i) => RESULT_CARD_TILE_FIRST + i);
export const RESULT_GLYPH_FIRST = 0x165f;
export const RESULT_GLYPH_SLOTS: readonly number[] =
  Array.from({ length: 0x1685 - RESULT_GLYPH_FIRST },
             (_u, i) => RESULT_GLYPH_FIRST + i);

/**
 * The Original Mode item scale's bones, `0x00435824`..`0x0043582E`: bones
 * 2..15 through the byte map at `0x00435914` (`0,2,2,1,2,2,1,2,2,2,1,2,2,1`)
 * and the jump table at `0x00435908` -- arm 0 is bone 2, arm 1 bones 5, 8,
 * 12 and 15, arm 2 nothing.
 */
export const RESULT_FIGURE_PART_SCALE: Readonly<Record<number,
    readonly [number, number, number]>> = {
  2: [1.5, 1, 1.5],                                // 0x3FC00000, 0x3F800000
  5: [2, 1, 2], 8: [2, 1, 2], 12: [2, 1, 2], 15: [2, 1, 2],   // 0x40000000
};

/**
 * The type `RescueTargetHeldState` (`FUN_00451980`) records for stage 2's
 * car rescue: `MOV word ptr [EDX*2 + 0x9c8ec0], 0x36` at `0x00451B21`, a
 * literal rather than the actor's own type. Here beside the figures, because
 * it is one of the types the card can stand and the exporter has to know it.
 */
export const RESCUE_TARGET_CHAR_TYPE = 0x36;

/** The class whose placement makes stage 2's car rescue: 0x21. */
export const RESCUE_TARGET_CLASS = 0x21;

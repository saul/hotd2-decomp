/**
 * Class 0x6E's words and immediates: Original Mode's trunk.
 *
 * Data only -- no `registerClass`, nothing at module load -- so `actor.ts`,
 * the exporter and the renderer can all import it. The routines are
 * `index.ts`'s; the reading is `docs/re/original-mode.md`.
 */

/**
 * The trunk's own words, `obj+0x1310..obj+0x136C`. `ItemSelectUpdate`
 * (`FUN_00488820`) zeroes every one of them in state 0, so a fresh block is
 * that state. Two players' halves sit side by side, player 0's first, which is
 * why each pair is an array here.
 */
export interface ItemSelectBlock {
  /**
   * `obj+0x00`: which routine the object runs. `ItemSelectUpdate` from the
   * spawn; `ItemSelectFinish` once both players are done (`*obj =
   * FUN_004895C0` at the update's tail).
   */
  routine: ItemSelectRoutine;
  /**
   * `obj+0x1310`, s16: 0 the set-up, 1 the lid opening under the camera, 2 one
   * frame's hand-over, 3 and on the menus.
   */
  state: number;
  /** `obj+0x131C`, s8: `g_active_player` as `ItemSelectTrackPlayers` last saw it. */
  activePlayer: number;
  /** `obj+0x1320` / `+0x1324`: this player is still choosing. */
  choosing: number[];
  /** `obj+0x1328` / `+0x132C`: the player's `g_player_state` when last looked at. */
  playerState: number[];
  /**
   * `obj+0x1330` / `+0x1334`: 0 while the cursor is in the list, 1 while it is
   * on the player's own slots.
   */
  onSlots: number[];
  /** `obj+0x1338`: the list's scroll, 0..26 -- shared by both players. */
  scroll: number;
  /** `obj+0x133C`: the camera path's frame, 0..0x8C. */
  frame: number;
  /** `obj+0x1350` / `+0x1354`: the list cursor's row on screen, 0..6. */
  row: number[];
  /**
   * `obj+0x1358` / `+0x135C`: which of the player's slots the cursor is on --
   * 0, 1, or 2 for OK.
   */
  slot: number[];
  /** `obj+0x1360` / `+0x1364`: frames the "can't carry both" sprite has shown. */
  refuseFrames: number[];
  /** `obj+0x1368` / `+0x136C`: the "can't carry both" sprite is up. */
  refusing: number[];
  /**
   * `obj+0x11E` (player 0, s16) / `obj+0x121` (player 1, s8): frames up or down
   * has been held, towards the 0x28 that starts the repeat.
   */
  holdFrames: number[];
  /**
   * `obj+0x11C` (player 0, s16) / `obj+0x120` (player 1, s8): the repeat, 1
   * down and 2 up, stepping every third frame.
   */
  repeat: number[];
}

/** The routine at `obj+0x00`. */
export enum ItemSelectRoutine {
  /** `ItemSelectUpdate`, `FUN_00488820`. */
  Update = 0,
  /** `ItemSelectFinish`, `FUN_004895C0`. */
  Finish = 1,
}

/** `[port-only]` -- a fresh block: every word state 0 writes, zeroed. */
export function makeItemSelectBlock(): ItemSelectBlock {
  return {
    routine: ItemSelectRoutine.Update,
    state: 0, activePlayer: 0, choosing: [0, 0], playerState: [0, 0],
    onSlots: [0, 0], scroll: 0, frame: 0, row: [0, 0], slot: [0, 0],
    refuseFrames: [0, 0], refusing: [0, 0], holdFrames: [0, 0], repeat: [0, 0],
  };
}

/** The states `obj+0x1310` steps through. */
export enum ItemSelectState {
  Setup = 0,
  LidOpening = 1,
  HandOver = 2,
  Menu = 3,
}

/**
 * The pad bits the menu reads, player 0's; player 1's are the same shifted up
 * 16 in `g_pad_state` and up 4 in the second word (`g_pad_aux_state`), whose
 * low nibble is up, down, left, right.
 */
export enum ItemSelectPad {
  /** A: take the item under the cursor, or put a slot's back. */
  A = 0x4,
  /** START: leave the trunk from OK. */
  Start = 0x8,
  Up = 0x10,
  Down = 0x20,
  /** To the list. */
  Left = 0x40,
  /** To the slots. */
  Right = 0x80,
}

/** `g_pad_aux_state`'s four, player 0's: `TEST byte ptr [...], 1/2/4/8`. */
export enum ItemSelectAux {
  Up = 0x1,
  Down = 0x2,
  Left = 0x4,
  Right = 0x8,
}

/** The trunk's three texbanks, `PUSH 0x156/0x1B5/0x15F` in state 0. */
export const ITEM_SELECT_TEXBANKS: readonly number[] = [0x156, 0x1b5, 0x15f];

/** `PUSH 0x10000028`: `ITEM_SELECT.wav`, the AR table's last track. */
export const ITEM_SELECT_BGM = 0x10000028;
/** `PUSH 0x80000000` in `ItemSelectFinish`: the music stopped. */
export const ITEM_SELECT_BGM_STOP = 0x80000000;

/** The trunk's sounds, `DC_SE\` unless said. */
export enum ItemSelectSound {
  /** `CURSOR1_22.wav`: the cursor moved. */
  Cursor = 0x000100a9,
  /** `ERROR1_22.wav`: nothing to take, or the pair refused. */
  Error = 0x000200a9,
  /** `OK1_22.wav`: an item taken. */
  Ok = 0x000300a9,
  /** `REREASE_22.wav` (sic): an item put back. */
  Release = 0x000400a9,
  /** `START_COIN\START1_22.wav`: a player done. */
  Start = 0x000121a9,
  /** `TRUNK_16.wav`, at camera frame 90 as the lid starts up. */
  Trunk = 0x001700a9,
}

/** The camera path the lid opens under: `PUSH 0x36` into `CamEvalPath7`. */
export const ITEM_SELECT_CAM_PATH = 0x36;
/** `CMP [EBP + 0x133c], 0x8b` / the skip's `0x8c`: the path's last frame. */
export const ITEM_SELECT_CAM_LAST = 0x8c;
/** `CMP ..., 0x5a`: the frame the lid starts up and the trunk sounds. */
export const ITEM_SELECT_LID_FRAME = 0x5a;
/** `SHL 8`: the lid's turn a frame past {@link ITEM_SELECT_LID_FRAME}, BAMS. */
export const ITEM_SELECT_LID_STEP = 0x100;

/** `car_org.bin[1]`, the trunk: `PUSH 0x145f` into `AssetDrawSlot`. */
export const ITEM_SELECT_TRUNK_SLOT = 0x145f;
/** `car_org.bin[2]`, its lid: `PUSH 0x1460`. */
export const ITEM_SELECT_LID_SLOT = 0x1460;
/** `MatrixTranslate(-572.1, 0.0, 262.4)`: the trunk's place in the world. */
export const ITEM_SELECT_TRUNK_AT: readonly [number, number, number] =
  [-572.1, 0.0, 262.4];
/** `MatrixRotateY(0x52D8)`. */
export const ITEM_SELECT_TRUNK_YAW = 0x52d8;
/** `MatrixTranslate(0.0, 10.321, -14.7259)`: the lid's hinge from the trunk. */
export const ITEM_SELECT_LID_HINGE: readonly [number, number, number] =
  [0.0, 10.321, -14.7259];

/** The list: seven rows on screen out of 33, `CMP ..., 6` / `CMP ..., 0x19`. */
export const ITEM_SELECT_ROWS = 7;
/** The deepest scroll, `33 - 7`. */
export const ITEM_SELECT_SCROLL_MAX = 0x1a;
/** `g_original_items_taken`'s width, and the list's. */
export const ORIGINAL_ITEM_IDS = 0x21;
/** `CMP AL, 0x28`: frames held before up or down repeats. */
export const ITEM_SELECT_REPEAT_DELAY = 0x28;
/** `CMP [...], 0x3C`: frames the "can't carry both" sprite stays up. */
export const ITEM_SELECT_REFUSE_FRAMES = 0x3c;

/**
 * The sprites the trunk draws by an immediate, named by what each image says
 * or shows (they were looked at; `docs/re/original-mode.md` has them).
 */
export enum ItemSelectSprite {
  /** 256x256, `scr_item`: "THESE ITEMS CAN NOT BE COMBINED." */
  CannotCombine = 0x5df,
  /** `scr_item`: "INSIDE THE TRUNK". */
  InsideTheTrunk = 0x5e2,
  /** `scr_item`: "TAKE OUT ITEM". */
  TakeOutItem = 0x5e4,
  /** `scr_item`: "(UP TO 2)". */
  UpTo2 = 0x5e5,
  /**
   * 512x128, `scr_item`: "YOU CAN TAKE OUT ITEMS HERE. TO END, MOVE THE
   * CURSOR TO END AND PRESS THE START BUTTON."
   */
  Instructions = 0x5e6,
  /** 64x32, `scr_item`: "END". */
  End = 0x5e7,
  /** `scr_org`, 0..9 at `0x5E8 + d`: the counts' digits. */
  Digit0 = 0x5e8,
  /** 32x32, `scr_org`: the count's "x". */
  Times = 0x5f2,
  /** 256x512, `scr_item`: the list's frame, an empty panel. */
  ListFrame = 0x5f3,
  /** 256x128, `scr_item`: the "1P" slot panel; `+ 2*p` is player 1's. */
  Panel1P = 0x5f4,
  /** 256x32, `scr_item`: an outlined bar, lit in the player's colour. */
  Cursor = 0x5f5,
  /** 256x128, `scr_item`: the "2P" slot panel. */
  Panel2P = 0x5f6,
  /** 32x32, `scr_item`: the scroll mark, flipped (`0x20`) for the upper one. */
  Arrow = 0x5f7,
  /** 32x32, `scr_item`: the red arrow from the list to the panels. */
  PanelArrow = 0x5f8,
}

/**
 * Every sprite the trunk can draw by an immediate, for the exporter; the item
 * labels come from `original_mode.list_sprites`.
 */
export const ITEM_SELECT_SPRITES: readonly number[] = [
  ItemSelectSprite.CannotCombine, ItemSelectSprite.InsideTheTrunk,
  ItemSelectSprite.TakeOutItem, ItemSelectSprite.UpTo2,
  ItemSelectSprite.Instructions, ItemSelectSprite.End,
  ...Array.from({ length: 10 }, (_u, d) => ItemSelectSprite.Digit0 + d),
  ItemSelectSprite.Times, ItemSelectSprite.ListFrame, ItemSelectSprite.Panel1P,
  ItemSelectSprite.Cursor, ItemSelectSprite.Panel2P, ItemSelectSprite.Arrow,
  ItemSelectSprite.PanelArrow,
];

/** The trunk's two models, for the exporter. */
export const ITEM_SELECT_SLOTS: readonly number[] = [
  ITEM_SELECT_TRUNK_SLOT, ITEM_SELECT_LID_SLOT,
];

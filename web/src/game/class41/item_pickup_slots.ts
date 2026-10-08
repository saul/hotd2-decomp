/**
 * The score pickup's table and immediates, and the golden frog's, as data
 * with no module-scope side effect -- the exporter reads the tables and
 * carries the models they name. See `SpawnScorePickup` and
 * `ScorePickupUpdate` in `class41/items.ts`, and `class41/golden_frog.ts`.
 */

/**
 * `g_item_pickup_slot` -- `0x00595058`, one `0xC`-byte record per item kind:
 *
 * ```
 * +0x0  u16  the slot the pickup is drawn with   g_item_pickup_slot
 * +0x2  s16  the points it pays                  g_item_score_table
 * +0x4  f32  the scale it is drawn at            (0x0059505C)
 * +0x8  f32  how far above the prop it is let out g_item_pickup_y_offset
 * ```
 *
 * `SpawnScorePickup` (`FUN_004723F0`) indexes it with `LEA ECX,[ECX+ECX*2];
 * SHL ECX,2` on the kind (`0x00472438`), and `ScorePickupUpdate`
 * (`FUN_004724A0`) with `LEA EAX,[EAX+EAX*2]` and `*4` (`0x004724B9`).
 */
export const ITEM_PICKUP_TABLE = 0x00595058;
export const ITEM_PICKUP_STRIDE = 0xc;

/**
 * The kinds the table is indexed by: the release switch's arms that call
 * `SpawnScorePickup` with the item set as the kind -- sets 2 and 5..8, in
 * each of `BreakablePropUpdate`, `KindedPropUpdate` and
 * `FallingContainerUpdate` -- and `PropUpdateType37`'s and
 * `PropUpdateType63`'s copies of the same switch. Nothing hands it another,
 * so these are the rows the exporter reads (`L6`).
 */
export const ITEM_PICKUP_KINDS: readonly number[] = [2, 5, 6, 7, 8];

/**
 * `g_class41_constructors[68]` (`0x00593690`) is
 * `PlaceGoldenFrogFromLessonTable` (`FUN_00463E50`).
 */
export const GOLDEN_FROG_LESSON_CONSTRUCTOR = 68;

/**
 * `g_golden_frog_lesson_xz` -- `0x0059579C`, `{s16 x; s16 z}` rows the
 * constructor reads at `(rand() % 3 + g_training_lesson * 3) * 4`
 * (`LEA EDX,[EBP+EAX*2]; ADD EAX,EDX; MOVSX EAX,word [EAX*4 + 0x59579C]`).
 * `g_training_lesson` runs 0..4 and never past it (its writer clamps at 4),
 * so the index source names fifteen rows, which end where
 * `g_original_item_records` (`0x005957D8`) begins.
 */
export const GOLDEN_FROG_LESSON_ROWS = 0x0059579c;
export const GOLDEN_FROG_LESSON_ROW_COUNT = 15;

/**
 * The strips a shot frog draws, `obj+0x13F0 + obj+0x1350` for `+0x1350` in
 * `0..0x31`, from either player's base: `0x116A..0x119B` and
 * `0x119C..0x11CD`. The character exporter gives type `0x1C`'s template
 * every one, for `render/characters/golden_frog.ts` to clone.
 */
export const GOLDEN_FROG_STRIP_SLOTS: readonly number[] = [
  ...Array.from({ length: 0x32 }, (_, i) => 0x116a + i),
  ...Array.from({ length: 0x32 }, (_, i) => 0x119c + i),
];

/**
 * `MOV word ptr [EBP + 0x60], 0x1C` -- the golden frog's `obj+0x1F4`, its
 * character type. All eighteen of its skeleton slots resolve to
 * `frog_gold.bin`, which is what names it.
 */
export const GOLDEN_FROG_CHAR_TYPE = 0x1c;

/** `MOV dword ptr [EBP + 0x20], 0x140` -- `obj+0x1B4`, the clip it sits on. */
export const GOLDEN_FROG_IDLE_MOTION = 0x140;
/** `PUSH 0x13F` into `ActorSetMotionBlended` -- the clip it is shot into. */
export const GOLDEN_FROG_SHOT_MOTION = 0x13f;

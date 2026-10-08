/**
 * What `ChainSegmentUpdate` (`FUN_00469510`) names by immediate, for the
 * exporter.
 *
 * Apart from `class41/chain.ts` so `hod2lib` can carry the link's model and the
 * item row the chain drops from without importing the routine.
 */

/** `PUSH 0x1234; CALL SubmitSlotWithSceneLightArray` at `0x004698DB`: one link. */
export const CHAIN_LINK_SLOT = 0x1234;

/**
 * `PUSH 0x4` at `0x004697C6` -- the `g_original_item_tables` row
 * `SpawnChainItemDrop` (`FUN_004699C0`) picks the item from when segment 0
 * latches.
 */
export const CHAIN_ITEM_ROW = 4;

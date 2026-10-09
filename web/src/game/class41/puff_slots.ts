/**
 * What `PlaceBreakableGroup` (`FUN_00462A80`) names by immediate for the
 * break puff, for the exporter.
 *
 * Apart from `class41/group.ts` so `hod2lib` can carry the puff's effect tree
 * and clip without importing the routine.
 */

/**
 * `MOV [ESI+0x324], ECX` with `ECX = 0` (`0x00462BFB`) -- the effect id of
 * every group prop's break puff (Training's one-shot targets overwrite it
 * with 6 at `0x00462C91`).
 */
export const BREAKABLE_PUFF_EFFECT = 0;

/**
 * `MOV dword ptr [ESI+0x328], 0x1D9` (`0x00462C01`) -- the puff's motion,
 * and the one `BreakableEffectUpdate` (`FUN_00465500`) tests for residency
 * (`CMP word ptr [0x009A46AC], 2`).
 */
export const BREAKABLE_PUFF_MOTION = 0x1d9;

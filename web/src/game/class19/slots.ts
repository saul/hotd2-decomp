/**
 * The asset slots class 0x19 draws besides its skeleton's own -- the join
 * keys the exporter has to carry so that `render/` has something to clone.
 *
 * Data-only, and here rather than in `index.ts`, so that `hod2lib/bundle.ts`
 * can import it without pulling the class registry in (the same arrangement
 * as `class13/state.ts`'s `CarrierDrawSlots`). Every one is a `.text`
 * immediate in the routine named beside it, except the head's nine, which are
 * the `.rdata` table `g_boss4_head_slot_by_bar` and travel in `script.json`'s
 * `boss4` block; the exporter reads them from there. All `boss4.bin`, resolved
 * through `ExeTables.assetSlots()`.
 */

/**
 * Bone 8's two models -- `MOV word ptr [char + 0x4F8], 0x442` when
 * `Boss4StateThrowHeldProp` (`FUN_00494D60`) takes a prop, and `0x441` (the
 * skeleton's own) when it throws it. `boss4.bin[24]` and `[23]`.
 */
export const BOSS4_HAND_HOLDING = 0x442;
export const BOSS4_HAND_EMPTY = 0x441;

/**
 * Bone 5's model: `Boss4Init` (`FUN_004917E0`) writes `char+0x348 = 0x444`
 * over the skeleton's `0x443` at `0x0049187B`, and
 * `Boss4AdvanceMotionAndDrawHeldProps` (`FUN_00492620`) would cycle it
 * `0x444..0x447` while state flag 4 is up -- which nothing in the image sets.
 * `boss4.bin[26..29]`.
 */
export const BOSS4_BLADE_FIRST = 0x444;
export const BOSS4_BLADE_LAST = 0x447;

/**
 * The carried prop's model: `Boss4SpawnHeldProp` (`FUN_00494F70`) takes it
 * from `g_carried_prop_types[2]` (`s16[+0x20 + hp*2]`, hp 1), and
 * `Boss4AdvanceMotionAndDrawHeldProps` draws the two not yet thrown with the
 * same literal. `boss4.bin[2]`.
 */
export const BOSS4_PROP_SLOT = 0x396;

/**
 * The mark a flesh hit leaves -- `AssetDrawSlot(0x3CD)` in
 * `Boss4DrawAndAgeBoneHitMark` (`FUN_00492210`). `boss4.bin[7]`.
 */
export const BOSS4_HIT_MARK_SLOT = 0x3cd;

/** The class id, for the exporter's gate. */
const BOSS4_CLASS = 0x19;

/**
 * `[port-only]` -- the slots `render/effects.ts` clones for this class: the
 * prop, held and in flight, and the hit mark. Empty for a stage with no
 * class-0x19 spawn.
 */
export function Boss4EffectSlots(classes: Iterable<number>): number[] {
  for (const c of classes) {
    if (c === BOSS4_CLASS) return [BOSS4_PROP_SLOT, BOSS4_HIT_MARK_SLOT];
  }
  return [];
}

/**
 * `[port-only]` -- the models `host.setBoneSlot` swaps onto the boss's bones:
 * the hand, the blade and the head's nine (`headSlots`, from the `.rdata`).
 * They ride the character's gore rig, which is where `render/characters.ts`
 * clones a swapped bone from.
 */
export function Boss4SwapSlots(headSlots: readonly number[]): number[] {
  const out = [BOSS4_HAND_HOLDING, BOSS4_HAND_EMPTY];
  for (let s = BOSS4_BLADE_FIRST; s <= BOSS4_BLADE_LAST; s++) out.push(s);
  for (const s of headSlots) if (!out.includes(s)) out.push(s);
  return out;
}

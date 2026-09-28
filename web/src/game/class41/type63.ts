/**
 * Class 0x41 type 63 — twelve items put down at once, from a table in the
 * image, and then nothing: the object dies on its first frame.
 *
 * One shipped spawn, stage 6. The whole routine, `0x0046FB50`..`0x0046FBBE`
 * `[proved]`:
 *
 * ```
 * 0046fb56  MOV ESI,0x5950c8
 * 0046fb5b  MOV dword [EDI+0x1a0],0x451c2b33            ; y = 2498.7
 * loop:
 * 0046fb65  MOV EAX,[ESI+4] ; MOV [EDI+0x19c],EAX       ; x = entry.x
 * 0046fb6e  FLD [ESI+8] ; FSUB [0x004c49c0] ; FSTP [EDI+0x1a4]   ; z = entry.z - 3.0
 * 0046fb7d  MOVSX EAX,byte [ESI] ; LEA ECX,[EAX-1] ; CMP ECX,7 ; JA next
 * 0046fb88  JMP [ECX*4 + 0x46fbc0]
 *             kind 1        SpawnExtraLifePickup(obj)
 *             kind 2, 5..8  SpawnScorePickup(obj, kind)
 *             kind 3        SpawnGoldenFrog(obj)
 *             kind 4        nothing
 * next:
 * 0046fbac  ADD ESI,12 ; CMP ESI,0x595158 ; JL loop
 * 0046fbb7  CALL ActorKill
 * ```
 *
 * The object is used as the **cursor** the three spawners read: each takes
 * its position from `obj+0x19C..+0x1A4`, so the routine walks its own
 * position across the table and hands itself to each in turn. The spawn's
 * descriptor contributes nothing but the type — no arm, and the placed
 * position is overwritten before anything reads it.
 *
 * The table, `g_prop_type63_items` (`0x005950C8`), twelve `{s8 kind, pad[3],
 * float x, float z}` records; the jump table at `0x0046FBC0` is the switch on
 * `kind - 1`, with kind 4 — the item set that has no arm in the break
 * switches either — falling through to the next record.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorKillProp } from "./prop";
import {
  SpawnExtraLifePickup, SpawnGoldenFrog, SpawnScorePickup,
} from "./items";
import { ItemSet, type BreakableProp } from "./prop_state";

/** `MOV dword [EDI+0x1A0], 0x451C2B33` — every item's height. */
export const TYPE63_ITEM_Y = 2498.699951171875;
/** `FSUB [0x004C49C0]` — 3.0 off each record's z. */
export const TYPE63_Z_BACK = 3.0;

/**
 * `g_prop_type63_items` — `0x005950C8`, twelve `{kind, x, z}` records read
 * out of the image (`read_memory`, twelve bytes each, `MOVSX` on the kind).
 */
export const TYPE63_ITEMS: ReadonlyArray<readonly [number, number, number]> = [
  [6, 419.0, -9382.0],
  [5, 436.0, -9382.0],
  [7, 426.0, -9377.0],
  [2, 432.0, -9377.0],
  [3, 420.0, -9373.0],
  [1, 427.0, -9370.0],
  [1, 440.0, -9375.0],
  [1, 449.0, -9376.0],
  [2, 413.0, -9367.0],
  [3, 438.0, -9363.0],
  [6, 432.0, -9368.0],
  [5, 456.0, -9372.0],
];

/**
 * `PropUpdateType63` — `FUN_0046FB50`. `g_class41_updates[63]`.
 */
export function PropUpdateType63(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  void rng;
  p.y = TYPE63_ITEM_Y;
  for (const [kind, x, z] of TYPE63_ITEMS) {
    p.x = x;
    p.z = Math.fround(z - TYPE63_Z_BACK);
    switch (kind) {
      case ItemSet.ExtraLife:
        SpawnExtraLifePickup(p, events);
        break;
      case ItemSet.Score2:
      case ItemSet.Score5:
      case ItemSet.Score6:
      case ItemSet.Score7:
      case ItemSet.Score8:
        SpawnScorePickup(p, kind, events);
        break;
      case ItemSet.GoldenFrog:
        SpawnGoldenFrog(p, events);
        break;
      default:
        break;
    }
  }
  ActorKillProp(p);
}

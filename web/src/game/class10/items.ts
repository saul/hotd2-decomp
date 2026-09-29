/**
 * Ops 0x13, 0x14 and 0x15 — what a civilian is holding — and what becomes of
 * it.
 *
 * Three routines of their own in the engine and three here, because that is
 * what they are: `CivilianRunScript` (`FUN_0048B9E0`) calls out to each rather
 * than growing the array itself. Each appends an 8-byte `{record, operand}`
 * pair to the array at `sub+0x70` (length at `sub+0x6E`).
 *
 * **The item is given by its own draw.** `CivilianDrawHeldItems`
 * (`FUN_0048CD10`), which `CivilianUpdate` calls at `0x0048AF89`, draws each
 * item and then calls the record's `rec+0x18` routine. There are two:
 * `CivilianHeldItemGrantLife` (`FUN_0048DCC0`) on record `0x0056B190` and
 * `CivilianHeldItemGrantOriginalItem` (`FUN_0048DD60`) on the other thirteen.
 * Each waits for the entry's operand to turn up in the **wait word** -- every
 * shipped op 0x13/0x14 passes `0x800000`, and each of the eleven streams
 * that append one later loads a wait word of `0x940100` -- and on that frame
 * pays, clears the bit and raises `0x400000`, which the draw answers by
 * dropping the entry. So
 * a rescued civilian holds the item up from the block that adds it to the
 * block whose word carries `0x800000`, and hands it over on that block's first
 * frame. `[proved]`
 *
 * The draw's other half, the model on the bone, is the renderer's
 * (`syncHeldItems` in `render/characters/held_items.ts`); what it draws is
 * {@link CivilianState.heldDrawn}, which this side leaves as the walk found it.
 */
import type { CivilianCmdJson, CivilianItemJson } from "../../bundle/scene";
import type { Rng } from "../../core/rng";
import type { Events } from "../../core/events";
import type { Actor } from "../actor";
import { GrantExtraLife } from "../class41/items";
import { SpawnOriginalItemBanner } from "../class41/item_banner";
import { ORIGINAL_ITEMS_TAKEN_CAP } from "../class41/original_item";
import { G } from "../globals";
import type { ClassFrame } from "../registry";
import { T } from "../tables";
import { SpawnLifeGrantedMarker } from "./life_marker";
import { CivilianWait } from "./ops";
import type { CivilianHeldItem, CivilianState } from "./state";

/**
 * `rec+0x18` — the two routines a held-item record names, by address. The
 * exporter carries the pointer (`CivilianItemJson.callback`); this is the
 * switch the engine's `CALL dword ptr [ESP + 0x48]` at `0x0048CF4A` is.
 */
export enum CivilianItemCallback {
  /** `CivilianHeldItemGrantLife` — record `0x0056B190`, slot `0x10C3`. */
  GrantLife = 0x0048dcc0,
  /** `CivilianHeldItemGrantOriginalItem` — the other thirteen records. */
  GrantOriginalItem = 0x0048dd60,
}

/**
 * `[port-only]` — the engine's null record pointer. The draw zeroes a taken
 * entry's first dword (`MOV dword ptr [ECX], 0x0` at `0x0048CF74`); here a
 * record is an index and 0 is a real one, so the zero is spelled -1.
 */
const TAKEN = -1;

/**
 * `CivilianAddHeldItem` — `FUN_0048CAE0`.
 *
 * Grows the array by one and appends the command's two operands: the record,
 * and the bits its callback waits to see in the wait word.
 */
export function CivilianAddHeldItem(sub: CivilianState,
                                    c: CivilianCmdJson): void {
  if ((c.item ?? -1) >= 0) {
    sub.items.push({ record: c.item!, operand: c.args[1] >>> 0 });
  }
}

/**
 * `CivilianAddPickedItem` — `FUN_0048CB60`. The same, with whatever
 * {@link CivilianPickHeldItem} last chose as the record and the command's one
 * operand as the second word.
 */
export function CivilianAddPickedItem(sub: CivilianState,
                                      c: CivilianCmdJson): void {
  if (sub.pickedItem >= 0) {
    sub.items.push({ record: sub.pickedItem, operand: c.args[0] >>> 0 });
  }
}

/**
 * `CivilianPickHeldItem` — `FUN_0048CBF0`.
 *
 * Sums the weights, takes `rand() % total`, and walks the list subtracting
 * until it goes negative. Drawn from `ctx.rng` — `Math.random` would break the
 * snapshot, and which bottle a civilian is holding is state.
 *
 * [diverges] The engine also preloads the chosen record's two assets, the
 * second through a per-kind table at 0x0056B0F4. Loading is the renderer's.
 */
export function CivilianPickHeldItem(sub: CivilianState, c: CivilianCmdJson,
                                     rng?: Rng): void {
  const tbl = c.itemTable ?? [];
  const total = tbl.reduce((n, e) => n + e[0], 0);
  if (total <= 0 || !rng) return;
  let r = rng.int(total) - (tbl[0]?.[0] ?? 0);
  let i = 0;
  while (r >= 0 && i + 1 < tbl.length) { i += 1; r -= tbl[i][0]; }
  sub.pickedItem = tbl[i]?.[1] ?? -1;
}

/**
 * `CivilianDrawHeldItems` — `FUN_0048CD10`, the game's half.
 *
 * ```
 * 0048cd1d  n = (s16)sub+0x6E; if (n == 0) return;  saved = sub+0x70
 * 0048cd48  loop: rec = *(sub+0x70)[0]; ... the draw ...
 * 0048cf4a    rec+0x18(obj)
 * 0048cf57    if (*sub & 0x400000) { *sub &= ~0x400000; EBX = 1;
 *                                    (sub+0x70)[0] = 0; --(s16)sub+0x6E; }
 * 0048cf89    sub+0x70 += 8; if (--n) loop
 * 0048cfab  if (EBX) { if (sub+0x6E) { new = ActorAllocSub(sub+0x6E * 8);
 *                      copy the entries whose record is not 0, in order }
 *                      free(saved) }
 * 0048d014  else sub+0x70 = saved
 * ```
 *
 * The count is taken once, at the top, so an entry dropped mid-walk does not
 * shorten the walk; `sub+0x70` itself is the cursor, which is how a callback
 * finds its own entry. Ghidra's pseudocode ends at the `MatrixStackPop` and
 * shows neither the compaction nor the restore (L35); both are read from the
 * listing at `0x0048CFA8`..`0x0048D01E`.
 *
 * The matrix work, `AssetDrawSlot` and the camera-facing second slot are the
 * renderer's. What it draws this frame is the list as the walk found it --
 * `heldDrawn`, taken before any callback runs, because the engine draws each
 * item *before* calling its callback: a civilian is seen holding the item on
 * the frame she gives it, and not on the next.
 */
export function CivilianDrawHeldItems(obj: Actor, f: ClassFrame): void {
  const sub = obj.civ;
  if (!sub) return;
  sub.heldDrawn = sub.items.map((e) => e.record);
  const n = sub.items.length;
  if (n === 0) return;
  let removed = false;
  for (let i = 0; i < n; i++) {
    const e = sub.items[i];
    CivilianHeldItemCallback(sub, e, f);
    if ((sub.wait & CivilianWait.ItemTaken) !== 0) {
      sub.wait &= ~CivilianWait.ItemTaken;
      removed = true;
      e.record = TAKEN;
    }
  }
  if (removed) sub.items = sub.items.filter((e) => e.record !== TAKEN);
}

/**
 * `CALL dword ptr [ESP + 0x48]` at `0x0048CF4A` — `rec+0x18(obj)`. Neither
 * routine reads the object it is handed; both work on `g_cur_civilian`.
 *
 * `[port-only]` as a function: the engine calls the pointer, and this is the
 * two-armed switch over the only two values the shipped records hold. A
 * record the bundle does not carry has no pointer to call.
 */
function CivilianHeldItemCallback(sub: CivilianState, e: CivilianHeldItem,
                                  f: ClassFrame): void {
  const rec = T.civilians?.items[e.record];
  switch (rec?.callback as CivilianItemCallback | undefined) {
    case CivilianItemCallback.GrantLife:
      CivilianHeldItemGrantLife(sub, e, f.rng, f.events);
      break;
    case CivilianItemCallback.GrantOriginalItem:
      CivilianHeldItemGrantOriginalItem(sub, e, rec!, f.rng);
      break;
    default:
      break;
  }
}

/**
 * The opening both callbacks share, `0x0048DCC0`..`0x0048DD31` and
 * `0x0048DD60`..`0x0048DDD1`, instruction for instruction. False when the
 * entry's operand is not in the wait word, which is every frame but one.
 *
 * ```
 * if ((entry[1] & *sub) == 0) return;
 * *sub = ~entry[1] & *sub;   *sub |= 0x400000;
 * if (g_players_in_play == 1) {
 *   if ((s16)sub+0x6C != g_active_player) (s16)sub+0x6C = g_active_player;
 * } else if ((s16)sub+0x6C == -1) (s16)sub+0x6C = rand() % 2;
 * ```
 *
 * `[port-only]` as a function: the engine writes it out twice. The player is
 * the prune's -- the killer of the last captor, `obj+0x131C` -- in a two-player
 * game, and **whoever is in play** in a one-player one, whatever the prune
 * named; a rescue nobody could be credited with is a coin toss.
 */
function CivilianHeldItemTake(sub: CivilianState, e: CivilianHeldItem,
                              rng: Rng): boolean {
  if ((e.operand & sub.wait) === 0) return false;
  sub.wait = (~e.operand & sub.wait) | CivilianWait.ItemTaken;
  if (G.g_players_in_play === 1) {
    if (sub.rescuePlayer !== G.g_active_player) {
      sub.rescuePlayer = (G.g_active_player << 16) >> 16;
    }
  } else if (sub.rescuePlayer === -1) {
    sub.rescuePlayer = rng.int(2);
  }
  return true;
}

/**
 * `CivilianHeldItemGrantLife` — `FUN_0048DCC0`. Record `0x0056B190`'s.
 *
 * `GrantExtraLife((s16)sub+0x6C)`, and the camera-space marker when it paid a
 * life rather than the 300 points it pays at the cap. No sound: neither this
 * routine, `GrantExtraLife` nor the marker's two routines call `PlaySoundId`.
 */
export function CivilianHeldItemGrantLife(sub: CivilianState,
                                          e: CivilianHeldItem, rng: Rng,
                                          events?: Events): void {
  if (!CivilianHeldItemTake(sub, e, rng)) return;
  if (GrantExtraLife(sub.rescuePlayer, events)) {
    SpawnLifeGrantedMarker(sub.rescuePlayer);
  }
}

/**
 * `CivilianHeldItemGrantOriginalItem` — `FUN_0048DD60`. The other thirteen
 * records', whose kind (`rec+8`) is an Original Mode item id.
 *
 * ```
 * 0048ddd8  rec = *(sub+0x70)[0]
 * 0048dde0  if ((s8)g_original_items_taken[rec+8] < 0x63) ++it
 * 0048ddf2  switch (rec+8) -> AssetQueueUnloadSlot(the second slot)
 * 0048de62  AssetQueueUnloadSlot(rec+4)
 * 0048de73  SpawnOriginalItemBanner((s16)g_original_item_bank_sprite[rec+8].sprite)
 * 0048de7f  q = ActorAlloc(DelayedTexbankFreeUpdate, 0x3C);
 *           q+0x34 = 0x96; q+0x38 = (s16)g_original_item_bank_sprite[rec+8].bank
 * ```
 *
 * No `g_GameMode` test: an Arcade rescue counts the item too.
 *
 * `[port-only]` The two unloads and the 150-frame task that frees the texbank
 * (`DelayedTexbankFreeUpdate`, `FUN_0048DEE0`, whose only other work is its
 * own countdown) are residency, and the port has none -- every slot the
 * bundle carries is resident from the stage's load. They are read and
 * dropped, the stance `class41/type78.ts` takes on the matching load.
 */
export function CivilianHeldItemGrantOriginalItem(
    sub: CivilianState, e: CivilianHeldItem, rec: CivilianItemJson,
    rng: Rng): void {
  if (!CivilianHeldItemTake(sub, e, rng)) return;
  const n = G.g_original_items_taken[rec.kind] ?? 0;
  if (n < ORIGINAL_ITEMS_TAKEN_CAP) G.g_original_items_taken[rec.kind] = n + 1;
  SpawnOriginalItemBanner(rec.banner ?? 0);
}

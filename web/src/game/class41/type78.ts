/**
 * Class 0x41 type 78 — a one-frame task that asks for a model to be loaded.
 *
 * One shipped spawn, stage 4. The whole routine, `0x00471BA0`..`0x00471BBD`
 * `[proved]`:
 *
 * ```
 * 00471ba0  MOV EAX,[g_GameMode] ; TEST EAX,EAX ; JNZ original
 * 00471ba9  PUSH 0x1a60 ; JMP load
 * 00471bb0  PUSH 0xa6c                          ; any mode but Arcade
 * 00471bb5  CALL AssetQueueLoadSlot
 * 00471bbd  JMP ActorKill                        ; a tail call
 * ```
 *
 * It draws nothing, is never shot and does not outlive the frame it is
 * placed: its whole effect is one entry on the asset job ring. Nor does it
 * reach `PlaceGenericProp`'s switch — `CMP EAX,0x47; JA` at `0x00461DAA`
 * sends every type past 77 to the default arm before the index table is read.
 *
 * `[port-only]` **The load has nothing to change in the port.**
 * `AssetQueueLoadSlot` (`FUN_0041D5D0`) makes a slot *resident*; it does not
 * draw it, and the port has no residency at all — every slot the bundle
 * carries is resident from the stage's load — so the request is read and
 * dropped, the stance `class44/script_flag_effect.ts` takes on the engine's
 * other residency test. It is deliberately **not** handed to the walker's
 * `asset_load_slot` bookkeeping: that set is what `render/stagescene.ts`
 * draws unregioned models from, and a load is not a draw (`L54`).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import { ActorKillProp } from "./prop";
import type { BreakableProp } from "./prop_state";

/** The slot type 78 asks for in Arcade Mode (`g_GameMode == 0`). */
export const TYPE78_ARCADE_SLOT = 0x1a60;
/** ...and in every other mode. */
export const TYPE78_OTHER_SLOT = 0xa6c;

/**
 * The slot `PropUpdateType78` would queue for the current mode.
 * `[port-only]` as a function: the routine's one `PUSH`, for a test to read.
 */
export function PropType78LoadSlot(): number {
  return G.g_GameMode === GameMode.Arcade ? TYPE78_ARCADE_SLOT
    : TYPE78_OTHER_SLOT;
}

/**
 * `PropUpdateType78` — `FUN_00471BA0`. `g_class41_updates[78]`.
 */
export function PropUpdateType78(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  void rng; void events;
  // `AssetQueueLoadSlot(PropType78LoadSlot())`: see the file comment.
  ActorKillProp(p);
}

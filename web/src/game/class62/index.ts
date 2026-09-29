/**
 * Class 0x62 — **the result card's loader**.
 *
 * `spawn_simple 0x00977244` places it immediately before class 0x61, and the
 * step's `asset_wait_tex_pol_jobs` between the two spawns is what waits for
 * what it asks for: the card's tiles, its glyphs, and each figure's model and
 * attachments. Then it kills itself, on its first frame. It writes no script
 * flag. See `docs/re/stage-end.md`, section 2.
 */
import type { Actor } from "../actor";
import { registerClass, type ClassHandler } from "../registry";
import { SpawnClass } from "../spawn_class";

/** `PUSH 0x16a` at `0x00435932`: `scr_result`, the card's tiles. */
export const RESULT_CARD_TEXBANK = 0x16a;
/** `PUSH 0x7c` at `0x0043593C`: `result.bin`, the glyphs. */
export const RESULT_CARD_POLFILE = 0x7c;
/** `ADD EAX, 0x85` at `0x00435971`: a civilian type's own model file. */
export const RESULT_FIGURE_POLFILE_BASE = 0x85;

/**
 * `ResultCardTally` — `FUN_00435930`.
 *
 * ```
 * TexBankQueueLoad(0x16A); PolFileQueueLoad(0x7C)
 * for each figure the card will make -- the scene's list, or its rescues:
 *     PolFileQueueLoad(type + 0x85)
 *     AttachmentListQueueLoad(g_result_figure_attachments[type - 0x20])
 * AssetDrainTexAndPolJobs(); ActorKill()
 * ```
 *
 * Every call but the last is a load, and the port loads nothing at run time:
 * the exporter has put each of those files in the bundle already, for every
 * type the card can stand (`hod2lib/characters.ts`), as `ActorBindPartList`'s
 * own load half is the bundle's. What is left for the scene to see is the
 * kill -- the object leaves the pool on its first frame, as the engine's
 * does, where before this module it stood in the pool for the rest of the
 * stage. `[proved]`
 */
export function ResultCardTally(obj: Actor): void {
  // `ActorKill` (`FUN_004A7040`) at `0x004359A7`, and after the rescue loop.
  obj.dead = true;
  obj.visible = false;
}

/**
 * `[port-only]` -- as class 0x61's: no `Init` in the engine, and `visible`
 * is what lets `GameUpdate` reach the object at all.
 */
export function ResultCardTallySpawn(obj: Actor): void {
  obj.visible = true;
}

export const ResultCardTallyHandler: ClassHandler = {
  init: ResultCardTallySpawn,
  update: ResultCardTally,
  debug: (obj) => ({
    summary: obj.dead ? "result card loader · done" : "result card loader",
  }),
};

registerClass(SpawnClass.ResultCardTally, ResultCardTallyHandler);

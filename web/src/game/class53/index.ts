/**
 * Class 0x53 — the cat, and a **route-branch trigger**.
 *
 * Four spawns, all stage 2, in blocks 3, 5, 8 and 11. `CatInit`
 * (`FUN_00431250`) reads two s16s off the descriptor tail: an animation set
 * that indexes the playlist at `0x00589A64`, and a sub-type. Sub-types 0 and 1
 * run `FUN_00431340` and are not triggers; **sub-type 2 and up** runs
 * `CatBranchTriggerUpdate`, and only while `g_GameMode == 1`.
 *
 * The species is settled rather than guessed: `g_character_skeletons`
 * (`0x004E0430`) puts all eighteen of character type `0x1A`'s nodes in
 * `cat.bin`, which is one of the binary's two name tables.
 *
 * ## The block gate, and why the data proves it
 *
 * ```c
 * if ((obj->+0x34 & 8) && g_script_branch_var == 0 && g_evt_block_index == 8) {
 *     g_script_branch_var = 2;
 *     ...motion 0x2FD, sub-state 1...
 * }
 * ```
 *
 * Three conditions, and the shipped data agrees with all three at once. Of the
 * four spawns **only block 8's carries a sub-type above 1** — the others are
 * sets 2, 4 and 5 at sub-types 0, 0 and 1 — so the one cat that could answer
 * is the one standing in the block that is allowed to. And block 8's route
 * record is `{10, -1, 32}`: slot 1 is a hole and slot 2 is real, which is
 * exactly what a write of 2 wants. Blocks 3, 5 and 11 have live slots that a 2
 * would miss or a hole it would fall into, and the gate is what keeps their
 * cats out of it.
 *
 * `g_script_branch_var == 0` is the third condition and it is a **courtesy**:
 * this trigger will not overwrite an answer something else has already given.
 * It is the only writer in the game that checks.
 *
 * ## What is not ported
 *
 * Sub-types 0 and 1 entirely — `FUN_00431340`, which is the cat walking about.
 * The trigger's own reaction: motion `0x2FA` at frame 200, the swap to `0x2FD`
 * on the hit, and the run away along -x that ends in motion `0x305` below
 * `x = -478`. None of it touches `g_script_branch_var`.
 */
import type { Actor } from "../actor";
import { ActorFlag } from "../actor";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";

/** The one event block `CatBranchTriggerUpdate` answers in. */
export const CAT_BRANCH_BLOCK = 8;

/** What it writes there. */
export const CAT_BRANCH_VALUE = 2;

/** The sub-type at and above which the cat is a trigger rather than a cat. */
export const CAT_FIRST_TRIGGER_SUBTYPE = 2;

function SubType(obj: Actor): number {
  return obj.class53?.subtype ?? 0;
}

/**
 * `CatInit` — `FUN_00431250`.
 *
 * ```c
 * obj->+0x1F4 = 0x1A;  obj->+0x1FC = 1;
 * sub = ActorAllocSub(0x24);
 * sub->+0x10 = tail->+0x00;                      // the animation set
 * obj->+0x1B4 = g_cat_motions[set * 5];          // its clip
 * if (tail->+0x02 < 2) { if (== 1) obj->+0x38 |= 8; *obj = FUN_00431340; }
 * else if (g_GameMode != 1) ActorDespawn(obj);
 * else { obj->+0x1B4 = 0x305; obj->+0x124 = 4.0; *obj = CatBranchTriggerUpdate; }
 * ```
 *
 * **The mode gate is in the Init**, so an arcade run never has a trigger cat
 * standing inert — it has no cat at all in that slot.
 */
export function CatInit(obj: Actor): void {
  if (SubType(obj) < CAT_FIRST_TRIGGER_SUBTYPE) return;
  if (G.g_GameMode !== GameMode.Original) {
    obj.dead = true;
    return;
  }
  // `obj+0x124 = 4.0` — the hit radius, which is what makes it shootable.
  obj.motion = 0x305;
}

/**
 * `CatBranchTriggerUpdate` — `FUN_00431430`. **The branch writer.**
 *
 * Its sub-state 0 counts frames and plays motion `0x2FA` at 200; the write is
 * the arm above. The `g_script_branch_var == 0` test means a route already
 * answered stands, which no other writer in the game respects.
 */
export function CatBranchTriggerUpdate(obj: Actor): void {
  if ((obj.flags & ActorFlag.Hit) !== 0
      && G.g_script_branch_var === 0
      && G.g_evt_block_index === CAT_BRANCH_BLOCK) {
    G.g_script_branch_var = CAT_BRANCH_VALUE;
    // `sub->+0x10 = 1` — it turns and runs, which is not ported.
    obj.dead = true;
  }
  obj.flags &= ~ActorFlag.Hit;
  obj.pendingHit = null;
}

function CatDebug(obj: Actor): ActorDebug {
  const sub = SubType(obj);
  const live = sub >= CAT_FIRST_TRIGGER_SUBTYPE
    && G.g_evt_block_index === CAT_BRANCH_BLOCK;
  return {
    summary: sub < CAT_FIRST_TRIGGER_SUBTYPE
      ? `sub-type ${sub} · a cat, not a trigger`
      : live ? "shoot for route 2" : `waiting for block ${CAT_BRANCH_BLOCK}`,
    detail: [`g_evt_block_index ${G.g_evt_block_index}`,
             `g_script_branch_var ${G.g_script_branch_var}`],
    hot: live,
  };
}

export const CatHandler: ClassHandler = {
  init: CatInit,
  update: (obj: Actor, f: ClassFrame) => {
    void f;
    if (SubType(obj) >= CAT_FIRST_TRIGGER_SUBTYPE) {
      CatBranchTriggerUpdate(obj);
    }
  },
  // The class reads `obj+0x34` bit 3 itself and has no hit points.
  ownsShotResult: true,
  debug: CatDebug,
};

registerClass(SpawnClass.SkinnedNpc, CatHandler);

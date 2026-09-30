/**
 * Class 0x41 constructor 42 -- one model, drawn where its own coordinates put
 * it, until the step index reaches 2.
 *
 * One spawn in the game: stage 2 block 35 step 1 op 52 (evt `0x14968`), both
 * modes, the step the stage-2 boss is fought in. The descriptor stands at the
 * origin and nothing of it is read. Slot `0x1823` is `komono_boss2.bin[7]`
 * -- a model of the boss arena's file, which is all that says what it is:
 * `[open]` beyond that.
 *
 * ## The two routines `[proved]`
 *
 * Neither was a Ghidra function until named here; both were read in the
 * disassembly, and each is short enough to give whole.
 *
 * `PlaceType42Prop` (`FUN_004639D0`), `g_class41_constructors[42]`:
 *
 * ```
 * 004639D1  PUSH 0x48 ; PUSH 0x46CE80 ; CALL ActorAlloc
 * 004639DF  PUSH ESI  ; CALL ActorClearGameFields
 * 004639E8  MOV byte ptr [ESI + 0x40], 0x0          ; already zero
 * 004639ED  RET
 * ```
 *
 * `PropDrawOnlyType42` (`FUN_0046CE80`), `g_class41_updates[42]` and the
 * routine the constructor hands `ActorAlloc`:
 *
 * ```
 * 0046CE80  CMP word ptr [0x009A2BB0], 0x2          ; g_evt_step_index
 * 0046CE88  JNZ 0x0046CE8F
 * 0046CE8A  JMP ActorKill
 * 0046CE8F  PUSH 0x1823 ; CALL AssetDrawSlot ; POP ECX ; RET
 * ```
 *
 * **The draw is made with no `MatrixStackPush`**: on whatever the task walk
 * left on top of the stack, the camera's world-to-view, which the recording's
 * identity stands for (`class41/prop_draw.ts`). So the model is drawn at its
 * own coordinates, the way `PropUpdateType13`'s panel is.
 *
 * No lifetime, no scene sweep, no shot test, no counter. The only way out is
 * the step index reading 2 -- a 16-bit compare -- so a route that left the
 * block without passing step 2 would leave it drawing; the engine has no
 * other test and neither has this.
 */
import { G } from "../globals";
import { MatIdentity } from "../matrix";
import { ActorKillProp } from "./prop";
import { PropDrawBegin, PropDrawSlot } from "./prop_draw";
import {
  BreakableState, makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";
import { TYPE42_SLOT } from "./ctor_literals";

/** `CMP word ptr [0x009A2BB0], 0x2` at `0x0046CE80` -- `g_evt_step_index`. */
export const TYPE42_KILL_STEP = 2;

/** `PlaceType42Prop` — `FUN_004639D0`. `g_class41_constructors[42]`. */
export function PlaceType42Prop(at: number): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.Type42;
  p.at = at;
  p.state = BreakableState.Standing;
  // `ActorClearGameFields` (`FUN_004A73D0`): every word the routine could
  // read is zero, and it reads none of them.
  p.flags = 0;
  p.removeFlag = 0;
  p.slot = TYPE42_SLOT;
  return p;
}

/** `PropDrawOnlyType42` — `FUN_0046CE80`. `g_class41_updates[42]`. */
export function PropDrawOnlyType42(p: BreakableProp): void {
  PropDrawBegin(p);
  if (((G.g_evt_step_index << 16) >> 16) === TYPE42_KILL_STEP) {
    ActorKillProp(p);
    return;
  }
  // `AssetDrawSlot(0x1823)` on the stack top the task was entered with.
  PropDrawSlot(p, MatIdentity(), TYPE42_SLOT);
}

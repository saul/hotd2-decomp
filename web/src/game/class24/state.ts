/**
 * Class 0x24's tail — the words `SetPiecePropInit` (`FUN_00482CE0`) owns.
 *
 * ## Why this arm has one field and not three
 *
 * The survey listed class 0x24's tail as `selector` (`obj+0x130C`),
 * `holdFrames` (`obj+0x1320`) and `slideTimer` (`obj+0x1330`). Only the first
 * is here, and the reason is the union's central limitation rather than an
 * oversight:
 *
 * * `obj+0x1320` has **43 uses in `game/class30/`** against four here. Class
 *   0x30 reads it as `scriptMotion`, a motion id, not a counter.
 * * `obj+0x1330` has **38 uses across `game/class30/` and `game/class31/`**
 *   against five here, and it is also the shared arc record's elapsed-frame
 *   word, driven by `ActorArcBegin`/`ActorArcStep` from both those classes.
 *
 * **A word only separates when every class sharing it has an arm.** Moving
 * either of those now would take it away from classes that still read it off
 * the head, so they stay on {@link ActorBase} until class 0x30 and class 0x31
 * have their own arms — and `obj+0x1330` may never move, because the arc
 * record belongs to no single class.
 *
 * That is the same fact the two non-directive lines in `port.test.ts`'s
 * `unionRejectsCrossClassReads` record, seen from the other end.
 *
 * ## Not an allocated block
 *
 * `ActorAllocSub` has 37 call sites and `SetPiecePropInit` is not one of them
 * [proved], so this is a view onto words that are always there rather than a
 * pointer to a block — which is why it is not nullable. See
 * `class25/state.ts`, which makes the same argument at length.
 */
import type { SetPieceState } from "./index";

export interface SetPiecePropTail {
  /**
   * `obj+0x130C` — the state selector, and the index `SetPiecePropInit`
   * (`FUN_00482CE0`) dispatches on.
   *
   * `[proved]`: `MOV dword ptr [EDI + 0x130c], EAX` (`89870c130000`) at
   * `0x00482D04` with `EAX = MOVSX byte [tail+0x5]`, read back at
   * `0x00482E0D` and jumped through as `JMP dword ptr [EAX*0x4 + 0x482ec8]`
   * (`ff2485c82e4800`) at `0x00482E1C`.
   *
   * Class 0x24 **never touches `obj+0x1310`**, which is where the port used to
   * keep this and where `state` still lives for the classes that do.
   *
   * The same word is `condition` for the combat classes and class 0x10's
   * descriptor-tail pointer: one address, three fields, and this arm separates
   * only the first of them.
   */
  selector: SetPieceState;    // +0x130C, also `condition` / class 0x10's tail
}

/**
 * A tail for a freshly spawned set-piece.
 *
 * [port-only] The engine allocates and zeroes nothing here —
 * `ActorClearGameFields` (`FUN_004A73D0`) clears from `obj+0x34` at
 * *allocation*, so a reused heap block starts with whatever the previous
 * occupant left. `SetPiecePropInit` writes the selector before anything reads
 * it, so the exe needs no zero; the port zeroes because a snapshot has to
 * fully determine the next frame. Same zeroing the flat struct did before the
 * arm existed, moved rather than introduced.
 */
export function makeSetPiecePropTail(): SetPiecePropTail {
  return { selector: 0 };
}

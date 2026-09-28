/**
 * Class 0x41 types 6 and 10 — one routine, two strips of models played on a
 * loop, one frame a tick, for a step or two.
 *
 * `g_class41_updates[6]` and `[10]` are both `0x004668A0`, and the two types
 * differ only in `PlaceGenericProp`'s arms:
 *
 * ```
 * case 6:   obj+0x28C = 0x1032;  obj+0x11C = 1;     // 0x00461DC2
 * case 10:  obj+0x28C = 0x10C4;  obj+0x11C = 2;     // 0x00461EEC
 * ```
 *
 * Case 6's 1 is a register: `MOV word [ESI+0x11c], DI`, with `EDI` loaded
 * `1` at `0x00461D1B` for the prologue's `obj+0x34 = 1` and never changed.
 *
 * The routine, `0x004668A0`..`0x00466926` `[proved]`:
 *
 * ```
 * 004668a6  CALL PropExpireByStepLifetime(obj)
 * 004668ae  CMP word [ESI+0x28c],0x1063 ; JNZ ; MOV word [ESI+0x28c],0x1032
 * 004668c2  CMP word [ESI+0x28c],0x10cd ; JNZ ; MOV word [ESI+0x28c],0x10c4
 * 004668d6  PUSH 0 ; CALL MatrixStackPush
 *           MatrixTranslate(+0x19C, +0x1A0, +0x1A4); MatrixRotateY(+0x1D0)
 * 00466903  MOV AX,[ESI+0x28c] ; MOVSX ECX,AX ; INC EAX ; PUSH ECX
 * 0046690f  MOV [ESI+0x28c],AX                ; the step, before the call
 * 00466916  CALL AssetDrawSlot                ; with the value from before it
 * 0046691b  PUSH 1 ; CALL MatrixStackPop ; RET
 * ```
 *
 * So the model **is** the cursor: each frame draws `obj+0x28C` and leaves it
 * one higher, and the two wrap tests put it back to the head of its strip on
 * the frame it would run off the end. Type 6 plays `0x1032..0x1062`, 49
 * frames; type 10 `0x10C4..0x10CC`, 9 frames. Both wraps are tested every
 * frame, so either type would wrap at either end — which is harmless, because
 * neither strip passes through the other's end.
 *
 * ## `obj+0x11C` is a lifetime here, not a shot count
 *
 * The arms' literals 1 and 2 are the word `PropExpireByStepLifetime`
 * (`FUN_00466640`) charges its step changes against, and this routine is the
 * only reader of the object: it never looks at `obj+0x34`'s hit bits, never
 * registers a shot sphere, and neither arm gives it a radius. The port read
 * the two literals as hit points (`GENERIC_HP`) and kept the descriptor's own
 * `+0x11C` as the lifetime, which is the reading the constructor had just
 * overwritten. So a type-6 prop lives until the **second** step change after
 * it is placed and a type-10 until the third, whatever its descriptor says.
 *
 * The prologue's result is not tested — but `ActorDespawn` ends in
 * `ActorKill`, which longjmps out of the task walk, so a prop the prologue
 * retires is not drawn again.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { MatrixRotateY, MatrixTranslate } from "../matrix";
import { PropExpireByStepLifetime } from "./lifetime";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import type { BreakableProp } from "./prop_state";

/** Type 6's strip: `0x1032` up to the `0x1063` that wraps back to it. */
export const TYPE6_FIRST_SLOT = 0x1032;
export const TYPE6_WRAP_SLOT = 0x1063;
/** Type 10's strip: `0x10C4` up to the `0x10CD` that wraps back to it. */
export const TYPE10_FIRST_SLOT = 0x10c4;
export const TYPE10_WRAP_SLOT = 0x10cd;

/** The arms' `obj+0x11C` literals — step lifetimes. */
export const TYPE6_LIFETIME = 1;
export const TYPE10_LIFETIME = 2;

/**
 * `PropUpdateType6` — `FUN_004668A0`. `g_class41_updates[6]` and `[10]`.
 */
export function PropUpdateType6(p: BreakableProp, rng: Rng,
                                events?: Events): void {
  void rng; void events;
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;
  if (p.slot === TYPE6_WRAP_SLOT) p.slot = TYPE6_FIRST_SLOT;
  if (p.slot === TYPE10_WRAP_SLOT) p.slot = TYPE10_FIRST_SLOT;
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, p.yaw);
  const drawn = p.slot;
  p.slot = ((drawn + 1) << 16) >> 16;
  PropDrawSlot(p, m, drawn);
}

/**
 * `PlaceGenericProp` case 6's arm.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00461DC2`
 * of `PlaceGenericProp`'s switch.
 */
export function PlaceGenericPropType6(p: BreakableProp,
                                      pl: BreakablePlacement, rng: Rng): void {
  void pl; void rng;
  p.slot = TYPE6_FIRST_SLOT;
  p.lifetime = TYPE6_LIFETIME;
}

/**
 * `PlaceGenericProp` case 10's arm — the same two words as type 6's, with
 * type 10's strip and a one-step-longer life.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00461EEC`
 * of `PlaceGenericProp`'s switch.
 */
export function PlaceGenericPropType10(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void pl; void rng;
  p.slot = TYPE10_FIRST_SLOT;
  p.lifetime = TYPE10_LIFETIME;
}

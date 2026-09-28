/**
 * Class 0x41 type 30 — something in stage 2 that drops and tumbles on a
 * script flag.
 *
 * One shipped spawn: stage 2 block 25 step 2 op 1 (evt `0x11648`) at
 * `(-495.2, 66.3, -1351.8)`, yaw `0x8000`, with a two-step lifetime. Block 25
 * step 3 op 6 raises `g_script_flags[0x67]`.
 *
 * What it is, from the asset slot and nothing else: `0x1DF` is
 * `komono_bar.bin[11]`, one of the bar's small articles. `[open]` beyond that.
 *
 * ## The whole routine, `0x0046A0F0`..`0x0046A1B4`
 *
 * ```c
 * PropExpireByStepLifetime(obj);                      // ActorDespawn never returns
 * if (g_script_flags[0x67] == 1) {
 *     vy = obj->+0x1C4 - 0.02722;                     // FSUB float [0x0055CB10]
 *     obj->+0x1CC -= 0x100; obj->+0x1D4 += 0x100;
 *     obj->+0x1C4 = vy;                               // FST: stays on the stack
 *     obj->+0x1A0 += vy;
 *     obj->+0x1A4 += 0.8;                             // FADD float [0x004C43A8]
 * }
 * Push; Translate(x, y, z); RotZ(+0x1D4); RotY(+0x1D0); RotX(+0x1CC);
 * AssetDrawSlot(0x1DF); Pop;
 * ```
 *
 * `[proved]` from the listing, whole: the pop is the last call. So once the
 * flag is up it falls under 0.02722 a frame squared, drifts 0.8 a frame
 * toward `+Z`, pitches `-0x100` and rolls `+0x100` a frame, and never stops
 * — no floor, no landing — until `PropExpireByStepLifetime`
 * (`FUN_00466640`) retires it (the shipped spawn's lifetime of 2 is the third
 * step change after it is placed, two after the flag) or the scene-1 sweep
 * takes it. Its result is not tested, and need not be: its
 * `ActorDespawn` (`FUN_00409CC0`) ends in `ActorKill` (`FUN_004A7040`) and
 * never returns.
 *
 * The flag test is a byte `== 1`. The draw is `AssetDrawSlot`
 * (`FUN_00418560`), unlit, every frame, after the step — so the first frame
 * of the fall already shows it moved. No hit arm, no `RegisterForShotTest`
 * (`FUN_00405160`) and no `AND` on `obj+0x34`: not shootable. No arm in
 * `PlaceGenericProp` (`FUN_00461CF0`): type 30 takes the switch's default.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { PropExpireByStepLifetime } from "./lifetime";
import {
  PropDrawBegin, PropDrawSlot, PropMatrixPush, PropMatrixTRzRyRx,
} from "./prop_draw";
import type { BreakableProp } from "./prop_state";

/** `g_script_flags[0x67]` (`0x009C7267`) — drop. Stage 2 block 25 step 3. */
export const SCRIPT_FLAG_TYPE30_DROP = 0x67;

/** `0x0055CB10` = `0x3CDEFC7A` — subtracted from `+0x1C4` every frame. */
export const TYPE30_GRAVITY = Math.fround(0.02722);
/** `0x004C43A8` = `0x3F4CCCCD` — added to `+0x1A4` every frame. */
export const TYPE30_DRIFT_Z = Math.fround(0.8);
/** `ADD ECX,0xFFFFFF00` on `+0x1CC` — the pitch step. */
export const TYPE30_PITCH_STEP = -0x100;
/** `ADD EAX,0x100` on `+0x1D4` — the roll step. */
export const TYPE30_ROLL_STEP = 0x100;

/** `PUSH 0x1DF` — `komono_bar.bin[11]`. */
export const TYPE30_SLOT = 0x1df;

/**
 * `PropUpdateType30` — `FUN_0046A0F0`. One falling prop, one 60 Hz frame.
 *
 * `+0x1C4` is {@link BreakableProp.vy}, `+0x19C..+0x1A4` its position and
 * `+0x1CC/+0x1D0/+0x1D4` {@link BreakableProp.pitch}, `yaw` and `roll`.
 *
 * `FST [ESI+0x1C4]` stores the new speed as a float and leaves the unrounded
 * value on the FPU stack for the `FADD` into `+0x1A0`; the port does the same
 * in double and rounds at each store.
 */
export function PropUpdateType30(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  void rng; void events;
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;
  if ((G.g_script_flags[SCRIPT_FLAG_TYPE30_DROP] ?? 0) === 1) {
    const vy = p.vy - TYPE30_GRAVITY;
    p.pitch = (p.pitch + TYPE30_PITCH_STEP) | 0;
    p.roll = (p.roll + TYPE30_ROLL_STEP) | 0;
    p.vy = Math.fround(vy);
    p.y = Math.fround(vy + p.y);
    p.z = Math.fround(p.z + TYPE30_DRIFT_Z);
  }
  const m = PropMatrixPush();
  PropMatrixTRzRyRx(m, p.x, p.y, p.z, p.pitch, p.yaw, p.roll);
  PropDrawSlot(p, m, TYPE30_SLOT);
}

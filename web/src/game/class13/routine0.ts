/**
 * `CarrierPropSelectRoutine`'s selector 0 — stage 2's boat that runs into
 * the wall.
 *
 * One shipped spawn: stage 2 block 16 step 11 op 2 (evt `0xA3E8`), drawing
 * slot `0x1A36` (`komono_boat.bin[1]`) at scale 2.5, with the block's
 * civilian (evt `0xA134`, `obj+0x11C = 1`, so `CivilianUpdateOnCarrier`) and
 * the class-0x18 zombie its Init builds riding it. It rides object path
 * `0x151` (`op_st2` index 9, frames 326..710) from the camera's own frame, and
 * at frame `0x276` (630) it strikes: `COMMON\SIBUKI2_16.WAV` sounds and a
 * 94-frame `eff_dokan.bin` strip plays at a fixed point by the wall. 630 is
 * also the class-0x18 zombie's own cue frame on camera path 78 — the frame it
 * leaves the boat.
 *
 * ```c
 * switch (sub->state) {                         // SUB/DEC chain, no table
 * case 0: ride = ActorAllocSub(0xC); sub->+0x04 = ride;
 *         ride->wake = 0x24A; ride->frame = g_cam_path_frame; ride->splash = 0;
 *         sub->state++;                          // and falls into case 1
 * case 1: PropSeatOnObjectPath(obj, 0x151, ride->frame);
 *         if (ride->frame >= 0x276) sub->state++;
 *         Push; Translate(pos); RotX; RotZ; RotY; Translate(0, 0, 27.5);
 *         Scale(1, 0.15, 1); AssetDrawSlot(ride->wake);
 *         if (++ride->wake > 0x25F) ride->wake = 0x24A;  Pop;
 *         ride->frame++; break;
 * case 2: PropSeatOnObjectPath(obj, 0x151, ride->frame);
 *         if (ride->frame < g_carrier_routine0_ride_end) ride->frame++;
 *         else sub->state++;
 * }
 * if (ride->splash) {
 *     Push; Translate(-1181.71, -18.908, -1508.41); RotY(0x18E3); Scale(0.6);
 *     AssetDrawSlot(ride->splash++); Pop;
 *     if (ride->splash > 0x1031) ride->splash = 0;
 *     return;
 * }
 * if (ride->frame == 0x276) { ride->splash = 0xFD4; PlaySoundId(0x4116A9); }
 * ```
 *
 * **Ghidra's pseudocode is wrong about case 1**, and would have frozen the
 * boat: it ends the arm at the `MatrixStackPop` (`L37`) and so shows no
 * `frame++`. The increment is `MOV EAX,[ESI]; INC EAX; MOV [ESI],EAX` at
 * `0x00440323`, and case 2's `JL` jumps into the middle of it at
 * `0x00440328`. The tail from `0x0044032B` is also past the body Ghidra gives.
 *
 * The splash is armed on the frame case 1 **leaves** `frame` at 630 — the
 * frame that seated the boat at 629 — and case 1 hands over to case 2 one
 * frame later, so the strike is on the last frame the wake is drawn.
 *
 * Both draws are `render/slotmodels.ts`', off `wakeDrawn` and `splashDrawn`,
 * which this routine sets on exactly the frames it draws: the wake
 * (`char_adv06.bin[0..21]`, one slot — selector 1 draws two, on the ground)
 * under the boat's own pose, and the splash at its fixed point by the wall.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import type { ClassFrame } from "../registry";
import { SpawnClass } from "../spawn_class";
import { PropSeatOnObjectPath } from "./index";
import {
  CARRIER0_SPLASH_FIRST, CARRIER0_SPLASH_LAST, CARRIER_WAKE_FIRST,
  CARRIER_WAKE_LAST, CarrierRoutine0State, type ScriptedPropTail,
} from "./state";

/** `PUSH 0x151` — the `op_` object path the routine rides. */
export const CARRIER0_PATH = 0x151;
/** `CMP EAX, 0x276` — the strike: the ride hands over and the splash starts. */
export const CARRIER0_FRAME_STRIKE = 0x276;
/**
 * `g_carrier_routine0_ride_end` — `0x0057727C`, 710. Where `op_st2` path 9
 * ends (it starts at 326 and lasts 384), and the frame the boat stops on.
 */
export const g_carrier_routine0_ride_end = 0x2c6;
/** `ride+0x04`, the wake strip — shared with selector 1. */
const CARRIER0_WAKE_FIRST = CARRIER_WAKE_FIRST;
const CARRIER0_WAKE_LAST = CARRIER_WAKE_LAST;
export { CARRIER0_SPLASH_FIRST, CARRIER0_SPLASH_LAST };
/** `COMMON\SIBUKI2_16.WAV` — *shibuki*, spray. */
export const SFX_CARRIER0_STRIKE = 0x4116a9;

/**
 * `CarrierPropRoutine0` — `FUN_00440210`. One frame of the ride.
 *
 * `ride+0x00` is {@link ScriptedPropTail.pathFrame}, `ride+0x04`
 * {@link ScriptedPropTail.wakeCel} and `ride+0x08`
 * {@link ScriptedPropTail.splashCel}.
 */
export function CarrierPropRoutine0(obj: Actor, f: ClassFrame): void {
  const sub = obj.cls === SpawnClass.ScriptedProp
    ? (obj as { prop13: ScriptedPropTail }).prop13 : null;
  if (!sub) return;

  sub.wakeDrawn = 0;
  switch (sub.state as CarrierRoutine0State) {
    case CarrierRoutine0State.Begin:
      sub.riding = true;
      sub.wakeCel = CARRIER0_WAKE_FIRST;
      sub.pathFrame = G.g_cam_path_frame;
      sub.splashCel = 0;
      sub.state = CarrierRoutine0State.Ride;
      CarrierPropRoutine0Ride(obj, sub, f);
      break;
    case CarrierRoutine0State.Ride:
      CarrierPropRoutine0Ride(obj, sub, f);
      break;
    case CarrierRoutine0State.Coast:
      PropSeatOnObjectPath(obj, CARRIER0_PATH, sub.pathFrame, f);
      if (sub.pathFrame < g_carrier_routine0_ride_end) sub.pathFrame += 1;
      else sub.state = CarrierRoutine0State.Stopped;
      break;
    case CarrierRoutine0State.Stopped:
      break;
  }

  // The tail, `0x0044032B`.
  sub.splashDrawn = 0;
  if (sub.splashCel !== 0) {
    // The draw of `sub.splashCel` is the renderer's; the step is state.
    sub.splashDrawn = sub.splashCel;
    sub.splashCel += 1;
    if (sub.splashCel > CARRIER0_SPLASH_LAST) sub.splashCel = 0;
    return;
  }
  if (sub.pathFrame === CARRIER0_FRAME_STRIKE) {
    sub.splashCel = CARRIER0_SPLASH_FIRST;
    f.events?.emit("sound.play", { id: SFX_CARRIER0_STRIKE });
  }
}

/**
 * Case 1's body, `0x00440286`, which case 0 falls into.
 *
 * [port-only] as a function: the engine reaches it by fall-through from the
 * allocation, and two call sites are how the port says so.
 */
function CarrierPropRoutine0Ride(obj: Actor, sub: ScriptedPropTail,
                                 f: ClassFrame): void {
  PropSeatOnObjectPath(obj, CARRIER0_PATH, sub.pathFrame, f);
  if (sub.pathFrame >= CARRIER0_FRAME_STRIKE) {
    sub.state = CarrierRoutine0State.Coast;
  }
  // `AssetDrawSlot(ride->wake)` is the renderer's; the cursor is this.
  sub.wakeDrawn = sub.wakeCel;
  sub.wakeCel += 1;
  if (sub.wakeCel > CARRIER0_WAKE_LAST) sub.wakeCel = CARRIER0_WAKE_FIRST;
  sub.pathFrame += 1;
}

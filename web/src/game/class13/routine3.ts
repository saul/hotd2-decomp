/**
 * `CarrierPropSelectRoutine`'s selector 3 -- stage 4's monitor (`[likely]`,
 * from its file and its sound), `colo_monitor.bin[14]` (slot `0x966`), which
 * stands where its record puts it, dims to 0.7 and comes back, and is
 * killed.
 *
 * One descriptor, evt `0x8C4C`: slot `0x966`, at `(318.28, 0, -353.92)` with
 * no angles, despawn cue camera path 180 frame 0, behaviour 8, selector 3.
 * Four spawn instructions, one per entrance of the stage-4 boss: blocks 23 and
 * 25 step 1 op 10 (at camera frame 90 of paths 179 and 187), blocks 27 and 29
 * step 1 op 47.
 *
 * ```c
 * // FUN_00440AD0, from its disassembly; sub = obj->+0x1310, ride = sub->+0x04
 * switch (sub->state) {                       // jump table 0x00440C00, 0..7
 * case 0: ride = ActorAllocSub(8); sub->+0x04 = ride; ride[0] = 0x958;
 *         sub->state++; sub->alpha = 1.0f; PlaySoundId(0x2F1BA9); return;
 * case 1: if (ride[0] < 0x95D) { ride[0]++; break; } sub->state++; break;
 * case 2: sub->alpha -= 0.03f;                               // [0x005644F8]
 *         if (sub->alpha <= 0.7f) { sub->alpha = 0.7f; sub->state++; } break;
 * case 3: if (g_cam_path_frame >= 0x1DF) { ride[1] = 0xB9; sub->state++; } break;
 * case 4: if (ride[1]-- == 0) sub->state++; break;
 * case 5: sub->alpha += 0.03f;
 *         if (!(sub->alpha < 1.0f)) { sub->alpha = 1.0f; sub->state++; } break;
 * case 6: if (ride[0] > 0x958) { ride[0]--; break; } sub->state++; break;
 * case 7: ActorKill();                                       // does not return
 * default: return;
 * }
 * SetDrawLayerNibble(9);                     // every `break` above ends here
 * ```
 *
 * It **never stores to the object**: no `PropSeatOnObjectPath`, no position,
 * no angle. What the player sees is all `ScriptedPropUpdate13`'s draw, which
 * follows: the record's pose, `AssetDrawSlotWithAlpha` whenever the alpha is
 * not 1.0, and in layer 9 from the second frame on, because the update sets
 * the world's 8 only after its own draw.
 *
 * `ride[0]` steps over `0x958..0x95D`, `colo_monitor.bin[0..5]`, and **nothing
 * draws it** -- the routine only compares it, `ScriptedPropUpdate13` never
 * reads `sub+0x04`, and no other instruction in `.text` has either word as an
 * immediate. In the port it is a counter, which is all it is in the exe.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import type { ClassFrame } from "../registry";
import { SpawnClass } from "../spawn_class";
import { CarrierRoutine3State, type ScriptedPropTail } from "./state";

/** `MOV dword ptr [EAX], 0x958` and `CMP EDX, 0x95D` / `CMP EDX, 0x958`. */
export const CARRIER3_CURSOR_FIRST = 0x958;
export const CARRIER3_CURSOR_LAST = 0x95d;
/** `PUSH 0x2F1BA9` -- `STAGE4_SE\MONITOR3.wav`. */
export const SFX_CARRIER3_START = 0x2f1ba9;
/** `FSUB`/`FADD float [0x005644F8]` -- what the alpha moves by a frame. */
export const CARRIER3_ALPHA_STEP = Math.fround(0.03);
/** `FCOMP float [0x005644F4]` and `MOV [ESI+0x18], 0x3F333333` -- 0.7. */
export const CARRIER3_ALPHA_DIM = Math.fround(0.7);
/** `FCOMP float [0x004C4380]` and `MOV [ESI+0x18], 0x3F800000` -- 1.0. */
const ALPHA_FULL = 1.0;
/** `CMP dword ptr [0x009a6110], 0x1DF` -- state 3's camera frame. */
export const CARRIER3_WAIT_FRAME = 0x1df;
/** `MOV dword ptr [EAX + 0x4], 0xB9` -- state 4's count. */
export const CARRIER3_HOLD = 0xb9;
/** `PUSH 0x9` -- `SetDrawLayerNibble`'s argument in every arm of 1..6. */
export const CARRIER3_DRAW_LAYER = 9;

/**
 * `CarrierPropRoutine3` — `FUN_00440AD0`. One frame of selector 3.
 */
export function CarrierPropRoutine3(obj: Actor, f: ClassFrame): void {
  const sub = obj.cls === SpawnClass.ScriptedProp
    ? (obj as { prop13: ScriptedPropTail }).prop13 : null;
  if (!sub) return;

  switch (sub.state as CarrierRoutine3State) {
    case CarrierRoutine3State.Begin:
      sub.riding = true;
      sub.monitorCursor = CARRIER3_CURSOR_FIRST;
      sub.state = CarrierRoutine3State.CountUp;
      sub.alpha = ALPHA_FULL;
      f.events?.emit("sound.play", { id: SFX_CARRIER3_START });
      // `0x00440B1E`: a `RET` -- the one arm with no `SetDrawLayerNibble`.
      return;
    case CarrierRoutine3State.CountUp:
      if (sub.monitorCursor < CARRIER3_CURSOR_LAST) sub.monitorCursor += 1;
      else sub.state = CarrierRoutine3State.FadeDown;
      break;
    case CarrierRoutine3State.FadeDown:
      // `FST` stores the single; `FCOMP` compares the register. Both agree
      // on every step from 1.0, the eleventh reaching 0.67.
      sub.alpha = Math.fround(sub.alpha - CARRIER3_ALPHA_STEP);
      if (sub.alpha <= CARRIER3_ALPHA_DIM) {
        sub.alpha = CARRIER3_ALPHA_DIM;
        sub.state = CarrierRoutine3State.WaitFrame;
      }
      break;
    case CarrierRoutine3State.WaitFrame:
      // The frame alone: `g_active_cam_path` is not read.
      if (G.g_cam_path_frame >= CARRIER3_WAIT_FRAME) {
        sub.monitorHold = CARRIER3_HOLD;
        sub.state = CarrierRoutine3State.Hold;
      }
      break;
    case CarrierRoutine3State.Hold: {
      // `TEST ECX, ECX; LEA EDX, [ECX - 1]; MOV [EAX+4], EDX; JNZ` -- a
      // post-decrement, so 0xB9 holds for 0xBA frames.
      const was = sub.monitorHold;
      sub.monitorHold = was - 1;
      if (was === 0) sub.state = CarrierRoutine3State.FadeUp;
      break;
    }
    case CarrierRoutine3State.FadeUp:
      sub.alpha = Math.fround(sub.alpha + CARRIER3_ALPHA_STEP);
      if (!(sub.alpha < ALPHA_FULL)) {
        sub.alpha = ALPHA_FULL;
        sub.state = CarrierRoutine3State.CountDown;
      }
      break;
    case CarrierRoutine3State.CountDown:
      if (sub.monitorCursor > CARRIER3_CURSOR_FIRST) sub.monitorCursor -= 1;
      else sub.state = CarrierRoutine3State.Kill;
      break;
    case CarrierRoutine3State.Kill:
      CarrierPropRoutine3Kill(obj);
      return;
    default:
      return;
  }
  // `SetDrawLayerNibble(9)`, which the prop's own draw is made in.
  sub.drawLayer = CARRIER3_DRAW_LAYER;
}

/**
 * `ActorKill` (`FUN_004A7040`) as this routine takes it: no `ActorDespawn` in
 * front. `[port-only]` as a name, as `FloatingPropKill` in
 * `class15/index.ts` is.
 */
function CarrierPropRoutine3Kill(obj: Actor): void {
  obj.despawned = true;
  obj.visible = false;
}

/**
 * Class 0x41 type 35 — the double door stage 2's block-5 civilian stands
 * behind.
 *
 * One shipped spawn, stage 2 block 3 step 4 op 5 (evt `0x2504`), and it is
 * placed **at the origin**: the routine never reads its own position. Both
 * leaves are drawn at literal world coordinates, which is why a renderer that
 * put the model at `p.x/p.y/p.z` drew it a kilometre away and the doorway
 * came out empty.
 *
 * ```c
 * PropExpireByStepLifetime(obj);            // its result is not tested
 * if (g_script_flags[0x68] == 1 && g_script_flags[0x69] == 0) {
 *     if (phase == 0) {
 *         if (++obj->+0x2A0 == 20 || obj->+0x2A0 == 50) {
 *             phase = 1; if (obj->+0x2A0 == 50) obj->+0x2A0 = 0;
 *             PlaySoundId(0x1C16A9);
 *         }
 *     } else if (phase == 1) {
 *         obj->+0x1E8 += obj->+0x1E8 < 0x4000 ? 0x2000 : 0x1000;
 *         obj->+0x1D0 = ftol(sin(obj->+0x1E8 * 2pi/65536) * 1536.0);
 *         if (obj->+0x1E8 > 0x8000) { obj->+0x1E8 = 0; obj->+0x1D0 = 0; phase = 0; }
 *     }
 * } else obj->+0x1D0 = 0;
 * Push; Translate(-620.55, 66.294, -997.98); RotY( obj->+0x1D0); Draw(0x1812); Pop;
 * Push; Translate(-620.55, 66.294, -980.82); RotY(-obj->+0x1D0); Draw(0x1813); Pop;
 * ```
 *
 * So the door **rattles**: twenty frames after flag 0x68 goes up both leaves
 * kick open 1536 BAMS (8.4°) in two frames and swing shut over the next five;
 * the count does not run during a swing, so the next knock is thirty frames
 * after that one ends, then twenty, then thirty, until flag 0x69 stops it.
 * Stage 2 block 5 step 2 raises 0x68 one frame before it spawns the civilian
 * and 0x69 at camera path 5 frame 365, which is when the civilian's second
 * captor's entry cue fires. `DAMAGE3_22.WAV` is the knock.
 *
 * The second leaf is past the `MatrixStackPop` Ghidra ends the function on
 * (`L37`); `disassemble_bytes` from `0x0046B433` is what found it. The
 * constants are `PUSH imm32` float bit patterns and a double at `0x005690B0`
 * (1536.0), all read off the disassembly (`L1`). The draw is
 * `render/breakables.ts`'. No `RegisterForShotTest` and no `AND` on
 * `obj+0x34`: the pool's generic arm registers every type, and this one's
 * `obj+0x124` is zero, so that registration can hit nothing.
 */
import type { Events } from "../../core/events";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { G } from "../globals";
import type { BreakableProp } from "./prop_state";

/** `obj+0x192` as `PropUpdateType35` (`FUN_0046B320`) switches on it. */
export enum Type35Phase {
  /** Counting frames to the next knock. */
  Count = 0,
  /** One swing out and back on `+0x1E8`. */
  Swing = 1,
}

/** `g_script_flags[0x68]` (`0x009C7268`) — rattle. */
export const SCRIPT_FLAG_TYPE35_RATTLE = 0x68;
/** `g_script_flags[0x69]` (`0x009C7269`) — stop, and it wins over 0x68. */
export const SCRIPT_FLAG_TYPE35_STILL = 0x69;

/** The two frame counts that start a swing; the second resets the count. */
const TYPE35_KNOCK_FIRST = 0x14;
const TYPE35_KNOCK_SECOND = 0x32;
/** The phase steps, BAMS: fast to the top of the swing, half speed back. */
const TYPE35_STEP_OUT = 0x2000;
const TYPE35_STEP_BACK = 0x1000;
const TYPE35_STEP_TURN = 0x4000;
const TYPE35_SWING_END = 0x8000;
/** `0x005690B0` — the swing's amplitude in BAMS, about 8.4°. */
const TYPE35_SWING_BAMS = 1536.0;

/** `COMMON\DAMAGE3_22.WAV`, at each knock. */
export const SFX_TYPE35_KNOCK = 0x1c16a9;

/**
 * `PropUpdateType35` — `FUN_0046B320`.
 *
 * Runs after the pool's generic arm has run `PropExpireByStepLifetime`, which
 * is the first line of the routine. `+0x2A0` is
 * {@link BreakableProp.storyItem}, `+0x1E8` {@link BreakableProp.hingeB},
 * `+0x1D0` {@link BreakableProp.yaw} and `+0x192`
 * {@link BreakableProp.routinePhase}.
 */
export function PropUpdateType35(p: BreakableProp, events?: Events): void {
  if ((G.g_script_flags[SCRIPT_FLAG_TYPE35_RATTLE] ?? 0) !== 1
      || (G.g_script_flags[SCRIPT_FLAG_TYPE35_STILL] ?? 0) !== 0) {
    p.yaw = 0;
    return;
  }
  if (p.routinePhase === Type35Phase.Count) {
    p.storyItem += 1;
    const n = p.storyItem;
    if (n === TYPE35_KNOCK_FIRST || n === TYPE35_KNOCK_SECOND) {
      p.routinePhase = Type35Phase.Swing;
      if (n === TYPE35_KNOCK_SECOND) p.storyItem = 0;
      events?.emit("sound.play", { id: SFX_TYPE35_KNOCK });
    }
  } else if (p.routinePhase === Type35Phase.Swing) {
    const phase = p.hingeB
      + (p.hingeB < TYPE35_STEP_TURN ? TYPE35_STEP_OUT : TYPE35_STEP_BACK);
    p.hingeB = phase;
    // `FMUL double [0x004C4370]; FSIN; FMUL double [0x005690B0]` with no
    // float store between, then `__ftol`, which truncates toward zero.
    p.yaw = Math.trunc(Math.sin(phase * BAMS_TO_RAD_F64) * TYPE35_SWING_BAMS);
    if (phase > TYPE35_SWING_END) {
      p.hingeB = 0;
      p.yaw = 0;
      p.routinePhase = Type35Phase.Count;
    }
  }
}

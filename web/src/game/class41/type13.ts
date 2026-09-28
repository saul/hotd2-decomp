/**
 * Class 0x41 type 13 — the part that drops out of stage 2's clock tower.
 *
 * One shipped spawn: stage 2 block 21 step 4 op 6 (evt `0xEC94`), placed at
 * `(-925, 180, -1297)` with a four-step lifetime. Block 21 step 7 op 4 raises
 * `g_script_flags[0x6D]` at camera path 33 frame 1415, and the cut scene that
 * follows (path 34) looks up the tower while the part falls **186 units** to
 * the ground and judders there.
 *
 * What it is, from the asset slots and nothing else: all three are
 * `komono_tokeidai.bin` — *tokeidai*, a clock tower, which is the area and
 * not necessarily the object (the lesson `class41/lift.ts` records). `0x1A43`
 * (entry 0) is 0.6 units deep, 8 across and 191 tall, and is the part that
 * drops. `0x1A49`/`0x1A4A` (entries 1 and 2) are a 7 x 11 x 7 box **modelled
 * in world space** at `(-947, 96..107, -1297)` — beside where the cut scene's
 * two class-0x25 player bodies stand — and the routine blinks between them.
 * The bug report calls the falling part a ladder; nothing in the code says so
 * and nothing contradicts it. `[open]` beyond "a tall thin part that drops".
 *
 * ```c
 * if (g_evt_step_index != obj->+0x196) {           // inlined lifetime
 *     if (obj->+0x11C < ++obj->+0x197) { ActorKill(); return; }
 *     obj->+0x2A0 = 1; obj->+0x196 = g_evt_step_index; obj->+0x28C = 0x1A4A;
 * }
 * if (g_scene_index == 1 && g_script_flags[0x77]) { ActorDespawn(obj); return; }
 * if (g_script_flags[0x6D] == 1 && g_cutscene_skipping) { phase = 2; y = -6.0; }
 * switch (phase) {
 * case 0: if (!obj->+0x2A0 && g_scene_tick_counter % 40 == 0)
 *             obj->+0x28C = 0x1A49 + (obj->+0x2A4 = 1 - obj->+0x2A4);
 *         if (g_script_flags[0x6D] == 1) {
 *             PlaySoundId(0x19A9); PlaySoundId(0x3517A9); PoseHookNone(1, 500);
 *             phase = 1; obj->+0x28C = 0x1A49;
 *         } break;
 * case 1: vy -= 0.02; y += vy;
 *         if (y < -6.0) { y = -6.0; phase = 2; judder = 0.4;
 *                         PlaySoundId(0x1916A9); PoseHookNone(0, 1); } break;
 * case 2: judder *= -0.925; if (fabs(judder) < 0.05) { judder = 0; phase = 3; }
 * }
 * AssetDrawSlot(obj->+0x28C);                       // no matrix: world space
 * Push; Translate(x, y, z + judder); AssetDrawSlot(0x1A43); Pop;
 * ```
 *
 * Every constant was read off the disassembly (`L1`): `0.02` at `0x004E3100`,
 * `-6.0` at `0x0055CB4C`, `-0.925` at `0x0056908C`, `0.05` at `0x004C4C88`,
 * and the `0.4` and `-6.0` stores are `MOV dword` immediates
 * (`0x3ECCCCCD`, `0xC0C00000`). `PoseHookNone` (`FUN_00420810`) is an empty
 * function and is not called here.
 *
 * The draw is `render/breakables.ts`'. The routine registers no shot sphere
 * and never masks `obj+0x34`.
 */
import type { Events } from "../../core/events";
import { G } from "../globals";
import { ActorDespawnProp, ActorKillProp } from "./prop";
import { SCRIPT_FLAG_CLEAR_PROPS } from "./lifetime";
import type { BreakableProp } from "./prop_state";

/** `obj+0x192` as `PropUpdateType13` (`FUN_00467F50`) switches on it. */
export enum Type13Phase {
  /** Hanging, and blinking the panel until the first step change. */
  Wait = 0,
  /** Falling under `TYPE13_GRAVITY`. */
  Fall = 1,
  /** Landed; `+0x1C8` rings down across Z. */
  Judder = 2,
  /** At rest. Nothing moves again. */
  Rest = 3,
}

/** `g_script_flags[0x6D]` (`0x009C726D`) — release it. Stage 2 raises it once. */
export const SCRIPT_FLAG_TYPE13_DROP = 0x6d;

/** `0x1A4A` — `komono_tokeidai.bin[2]`, the arm's slot and the step reset's. */
export const TYPE13_PANEL_SLOT = 0x1a4a;
/** `0x1A49` — `komono_tokeidai.bin[1]`, the other blink frame and the lit one. */
export const TYPE13_PANEL_LIT_SLOT = 0x1a49;
/** `0x1A43` — `komono_tokeidai.bin[0]`, the part that falls. */
export const TYPE13_DROP_SLOT = 0x1a43;

/** `g_scene_tick_counter % 0x28` — the blink period, in ticks. */
const TYPE13_BLINK_TICKS = 0x28;
/** `0x004E3100` — subtracted from `+0x1C4` every falling frame. */
const TYPE13_GRAVITY = 0.02;
/** `0x0055CB4C` — the floor, and where a skip leaves it. */
export const TYPE13_FLOOR_Y = -6.0;
/** `MOV [ESI+0x1C8], 0x3ECCCCCD` — the landing judder's first amplitude. */
const TYPE13_JUDDER = 0.4;
/** `0x0056908C` — what the judder is multiplied by each frame. */
const TYPE13_JUDDER_DECAY = -0.925;
/** `0x004C4C88` — below this magnitude the judder stops. */
const TYPE13_JUDDER_EPS = 0.05;

/** `STAGE2_SE\BEEP6_44.wav`, on release. */
export const SFX_TYPE13_BEEP = 0x19a9;
/** `COMMON2\SHUTTER1_16.wav`, on release. */
export const SFX_TYPE13_RELEASE = 0x3517a9;
/** `COMMON\CAN_ROLLING2_16.WAV`, on landing. */
export const SFX_TYPE13_LAND = 0x1916a9;

/**
 * `PropUpdateType13` — `FUN_00467F50`.
 *
 * `+0x1A0` is {@link BreakableProp.y}, `+0x1C4` {@link BreakableProp.vy},
 * `+0x1C8` {@link BreakableProp.vz} (a **displacement** added to Z at the
 * draw, not a velocity, for this type), `+0x2A0`
 * {@link BreakableProp.storyItem} (set once the prop has seen a step
 * change), `+0x2A4` {@link BreakableProp.removeFlag} (the blink toggle) and
 * `+0x192` {@link BreakableProp.routinePhase}.
 *
 * `[diverges]` The skip arm —
 * `g_script_flags[0x6D] == 1 && g_cutscene_skipping` snaps it to the floor in
 * {@link Type13Phase.Judder} — is not transcribed:
 * `g_cutscene_skipping` (`0x009A2230`) has no port in `G`, the gap
 * `class25/index.ts` and `class21/index.ts` already declare. A skipped cut
 * scene therefore lets the part finish falling on its own, 136 frames.
 */
export function PropUpdateType13(p: BreakableProp, events?: Events): void {
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.lifetime < p.stepsElapsed) {
      ActorKillProp(p);
      return;
    }
    p.storyItem = 1;
    p.lastStepIndex = G.g_evt_step_index;
    p.slot = TYPE13_PANEL_SLOT;
  }
  // The sweep comes **after** the step count here, the other way round from
  // `PropExpireByStepLifetime`, and it is the prologue's `ActorDespawn`.
  if (G.g_scene_index === 1
      && (G.g_script_flags[SCRIPT_FLAG_CLEAR_PROPS] ?? 0) !== 0) {
    ActorDespawnProp(p);
    return;
  }
  const released = (G.g_script_flags[SCRIPT_FLAG_TYPE13_DROP] ?? 0) === 1;

  switch (p.routinePhase as Type13Phase) {
    case Type13Phase.Wait:
      if (p.storyItem === 0
          && G.g_scene_tick_counter % TYPE13_BLINK_TICKS === 0) {
        p.removeFlag = 1 - p.removeFlag;
        p.slot = p.removeFlag + TYPE13_PANEL_LIT_SLOT;
      }
      if (released) {
        events?.emit("sound.play", { id: SFX_TYPE13_BEEP });
        events?.emit("sound.play", { id: SFX_TYPE13_RELEASE });
        p.routinePhase = Type13Phase.Fall;
        p.slot = TYPE13_PANEL_LIT_SLOT;
      }
      break;
    case Type13Phase.Fall:
      p.vy -= TYPE13_GRAVITY;
      p.y += p.vy;
      if (p.y < TYPE13_FLOOR_Y) {
        events?.emit("sound.play", { id: SFX_TYPE13_LAND });
        p.y = TYPE13_FLOOR_Y;
        p.routinePhase = Type13Phase.Judder;
        p.vz = TYPE13_JUDDER;
      }
      break;
    case Type13Phase.Judder:
      p.vz *= TYPE13_JUDDER_DECAY;
      if (Math.abs(p.vz) < TYPE13_JUDDER_EPS) {
        p.vz = 0;
        p.routinePhase = Type13Phase.Rest;
      }
      break;
    case Type13Phase.Rest:
      break;
  }
}

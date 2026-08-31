/**
 * Class 0x41 type 32 — the lift, and the one class-0x41 prop that *moves*.
 *
 * ## What it is, and how the name was got wrong first
 *
 * `LiftUpdate` (`FUN_0046A360`) draws three asset slots, and all three live in
 * **`komono_suimon.bin`** — *komono*, small items; *suimon* (水門), a sluice
 * gate. Read off the filename alone this is a water gate, and it was called
 * one for an hour. It is not: **the asset file is named for the area, not for
 * the object in it.**
 *
 * What it actually is, from the code and from looking at the render:
 *
 * * The routine's first act is `obj->y = g_camera_block_eye.y - 15.0`, held
 *   for as long as script flag 0x37 is up. Stage 2 raises that flag in block
 *   18 step 1 op 5 and then plays camera path 28 (`cp_st2` slot 83) for 1175
 *   frames, over which the **eye climbs from 55.0 to 144.2**. So the object
 *   rides from 40.0 to 129.2 — and 40.0 is exactly where the spawn puts it.
 *   An 89-unit vertical ride with the camera standing on it.
 * * Drawn, it is a **folding lattice cage gate** in two pairs of leaves, seen
 *   from inside, with a person's legs visible through it — the screenshot is
 *   `scratchpad/lift_22000.png`.
 * * The leaves' sound is `COMMON\DOORKICK3_22K_1.WAV`.
 *
 * Stage 2 places exactly one, at (-825.1, 40.0, -1871.7), from block 17
 * step 8.
 *
 * ## Three script flags and a counter
 *
 * Nothing here is on a timer; every motion is a script flag the event script
 * raises, which is why the lift stands inert in a replay that has not reached
 * the instruction that raises it.
 *
 * ```c
 * PropExpireByStepLifetime(obj);
 * if (g_script_flags[0x37] == 1) obj->y = g_camera_block_eye.y - 15.0f;
 * if (g_script_flags[0x6B] == 1) {
 *     if (obj->+0x1D0 <= 0x8000) {
 *         if (obj->+0x1D0 == 0x4000) PlaySoundId(0x2216A9);
 *         obj->+0x1D0 += 0x200;
 *     }
 *     obj->+0x2A0 += 1;
 * }
 * if (g_script_flags[0x6C] == 1 && obj->+0x1E8 <= 0xC000) {
 *     if (obj->+0x1E8 == 0x8000) PlaySoundId(0x2216A9);
 *     obj->+0x1E8 += 0x200;
 * }
 * if (obj->+0x2A0 > 0x27 && obj->+0x1CC <= 0x1000) {
 *     if (obj->+0x1CC == 0) PlaySoundId(0x2516A9);
 *     obj->+0x1CC += 0x200;
 * }
 * ```
 *
 * Stage 2's order is: block 17 step 8 op 26 spawns it, op 28 raises 0x6B and
 * the near pair starts to fold; block 18 step 1 op 5 raises 0x37 and the ride
 * begins; op 15 waits for path frame 220 and op 16 raises 0x6C, folding the
 * far pair. Three instructions, and every one of them is a flag.
 *
 * Each angle test is `< limit + 1`, so the frame that finds a hinge exactly at
 * its limit still adds a step: every one of them comes to rest **one 0x200
 * past** the round number. The sound tests are equalities against the
 * *starting* angle, so each fires on the first frame of its swing and never
 * again — `PlaceGenericProp` case 0x20 seeds exactly those three values.
 *
 * The panel is the only part with no flag of its own: it waits on `obj+0x2A0`,
 * which counts frames flag 0x6B has been up, so it moves 40 frames after the
 * near pair starts and never at all if that flag is never raised. [open] what
 * the panel is — it hinges 22.5° about X, thirteen units above the car floor.
 *
 * ## The draw is in `render/breakables.ts`
 *
 * The routine's second half is five `AssetDrawSlot` calls down a matrix stack
 * — the car, two pairs of folding leaves and the panel. Those live with the
 * renderer; the offsets and the composition order are quoted there.
 */
import type { Events } from "../../core/events";
import { G } from "../globals";
import { PropExpireByStepLifetime } from "./lifetime";
import type { BreakableProp } from "./prop_state";

/**
 * The `g_script_flags` (0x009C7200) entries this routine reads. Their meaning
 * is the lift's, not the script's: the script only raises them.
 */
export enum LiftFlag {
  /** 0x009C7237 — ride the camera. */
  RideCamera = 0x37,
  /** 0x009C726B — fold the near pair of cage leaves. */
  OpenNear = 0x6b,
  /** 0x009C726C — fold the far pair. */
  OpenFar = 0x6c,
}

/** How far under the camera's eye the car floor sits while riding. */
export const LIFT_RIDE_DROP = 15.0;

/** BAMS added to whichever hinge is moving, once per 60 Hz frame. */
export const LIFT_HINGE_STEP = 0x200;

/** `+0x1D0` — the near pair's rest angle and the angle it opens to. */
export const LIFT_NEAR_CLOSED = 0x4000;
export const LIFT_NEAR_OPEN = 0x8000;
/** `+0x1E8` — the far pair's. */
export const LIFT_FAR_CLOSED = 0x8000;
export const LIFT_FAR_OPEN = 0xc000;
/** `+0x1CC` — the overhead panel's, and the frame count that releases it. */
export const LIFT_PANEL_CLOSED = 0;
export const LIFT_PANEL_OPEN = 0x1000;
export const LIFT_PANEL_DELAY = 0x27;

/** `COMMON\DOORKICK3_22K_1.WAV`, as each pair of cage leaves starts to fold. */
export const SFX_LIFT_GATE = 0x2216a9;
/** `COMMON\ENE_WALK2_11.WAV`, as the panel starts to swing. */
export const SFX_LIFT_PANEL = 0x2516a9;

/** True while the script is holding this flag up. */
function ScriptFlagUp(f: LiftFlag): boolean {
  return (G.g_script_flags[f] ?? 0) === 1;
}

/**
 * `LiftUpdate` — `FUN_0046A360`.
 *
 * One call per 60 Hz frame, from the container pool.
 */
export function LiftUpdate(p: BreakableProp, events?: Events): void {
  if (PropExpireByStepLifetime(p)) return;

  if (ScriptFlagUp(LiftFlag.RideCamera)) {
    p.y = G.g_camera_block_eye.y - LIFT_RIDE_DROP;
  }

  if (ScriptFlagUp(LiftFlag.OpenNear)) {
    if (p.yaw <= LIFT_NEAR_OPEN) {
      if (p.yaw === LIFT_NEAR_CLOSED) {
        events?.emit("sound.play", { id: SFX_LIFT_GATE });
      }
      p.yaw += LIFT_HINGE_STEP;
    }
    // Outside the angle test: the counter runs for as long as the flag is up,
    // whether or not the leaves still have anywhere to go.
    p.storyItem += 1;
  }

  if (ScriptFlagUp(LiftFlag.OpenFar) && p.hingeB <= LIFT_FAR_OPEN) {
    if (p.hingeB === LIFT_FAR_CLOSED) {
      events?.emit("sound.play", { id: SFX_LIFT_GATE });
    }
    p.hingeB += LIFT_HINGE_STEP;
  }

  if (p.storyItem > LIFT_PANEL_DELAY && p.pitch <= LIFT_PANEL_OPEN) {
    if (p.pitch === LIFT_PANEL_CLOSED) {
      events?.emit("sound.play", { id: SFX_LIFT_PANEL });
    }
    p.pitch += LIFT_HINGE_STEP;
  }
}

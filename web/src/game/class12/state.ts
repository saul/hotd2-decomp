/**
 * Class 0x12's state block, at the offsets the engine keeps it.
 *
 * `ScriptedPropInit12` (`FUN_0043F9D0`) allocates 0x1C bytes at `obj+0x1310`
 * (`ActorAllocSub(0x1C)`) and fills them from the opcode-0x0C descriptor tail;
 * `ScriptedPropUpdate12` (`FUN_0043FA60`) reads and steps them. Data only, so
 * the exporter and the renderer can read the shape without importing the
 * class registry.
 */

/** The 0x1C bytes `ScriptedPropInit12` fills, at `obj+0x1310`. */
export interface ScriptedProp12Tail {
  /**
   * `sub+0x00` — the installed `g_prop_behaviours` entry, by index. The update
   * calls it every frame and swaps in `NoOpStub` (entry 0) when the delay
   * runs out; every shipped descriptor names 0 to begin with.
   */
  behaviour: number;
  /**
   * `sub+0x04`, s16 — the frames the strip waits once its flag is up. Counted
   * down by the update; while it is negative nothing ever moves.
   */
  delay: number;
  /** `sub+0x06` — the camera path that despawns the prop. */
  camPath: number;
  /** `sub+0x08` — ...and the frame on it. */
  camFrame: number;
  /** `sub+0x0A` — the slot the cursor jumps to when the delay runs out. */
  first: number;
  /** `sub+0x0C` — the last slot of the strip; past it the prop despawns. */
  last: number;
  /** `sub+0x0E` — the `g_script_flags` byte that starts the strip, -1 none. */
  flag: number;
  /** `sub+0x10` — a uniform scale, applied only when it is not 1.0. */
  scale: number;
  /**
   * `sub+0x14`, f32 — **the slot cursor**. `AssetDrawSlot(__ftol(sub+0x14))`
   * draws it; seeded from the descriptor's first slot, set to {@link first}
   * when the delay runs out and stepped by {@link step} after that.
   */
  cursor: number;
  /** `sub+0x18`, f32 — how far the cursor moves a frame once it runs. */
  step: number;
  /**
   * `obj+0x1F4` — written with `__ftol(sub+0x14)` on the frame the delay runs
   * out (`0x0043FAD9`). Nothing in this class reads it: the draw reads the
   * cursor. Kept because the engine keeps it.
   */
  slot1F4: number;
}

/**
 * `[port-only]` — the block before `ScriptedPropInit12` fills it: the
 * factory `makeActor` calls, which the engine's `ActorAllocSub` has no need of.
 */
export function makeScriptedProp12Tail(): ScriptedProp12Tail {
  return {
    behaviour: 0, delay: 0, camPath: -1, camFrame: -1, first: 0, last: 0,
    flag: -1, scale: 1, cursor: 0, step: 0, slot1F4: 0,
  };
}

/**
 * `[port-only]` — every asset slot one class-0x12 descriptor can draw: the
 * slot it starts on and the strip `first..last` the cursor runs through once
 * its flag is up. What the exporter carries so `render/slotmodels.ts` has a
 * model for each frame the update can ask for.
 *
 * `step` is not consulted: `__ftol` of a cursor stepped by a fraction still
 * lands on every whole slot in between, and a step above 1 would skip some --
 * carrying all of them costs a few models and cannot miss one.
 */
export function ScriptedProp12DrawSlots(t: {
  slot: number; first: number; last: number;
}): number[] {
  const out: number[] = [];
  if (t.slot > 0) out.push(t.slot);
  for (let s = t.first; s > 0 && s <= t.last; s++) {
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

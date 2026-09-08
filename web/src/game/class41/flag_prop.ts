/**
 * Class 0x41 type 75 — the one prop in the game that opens a
 * `wait_script_flag` gate.
 *
 * `PropUpdateType75` (`FUN_004710C0`) is `g_class41_updates[75]`, and it
 * raises `g_script_flags[20]` on **three** different instructions —
 * `0x004710D7`, `0x00471120` and `0x00471263`. Stage 4's block 2 step 7 opens
 * with `wait_script_flag 0x14`, no `set_script_flag` anywhere in stage 4 names
 * flag 20, and this is the only writer of it in the image. One shipped spawn:
 * stage 4 block 2 step 5, script address 9580, a `generic` placement of type
 * 75 with `lifetime_evt_steps` 2.
 *
 * ## Why it is its own family and not another `GENERIC_UPDATE` row
 *
 * Every other generic type runs the shared prologue —
 * `PropExpireByStepLifetime` (`FUN_00466640`) — and `class41/pool.ts` supplies
 * it around the type's own routine. This one does not call that function at
 * all. It **inlines a variant** of it: the `g_scene_index == 1 &&
 * g_script_flags[0x77]` sweep is left out, and two lines are folded into the
 * middle of the step-change arm, between spotting the change and charging the
 * lifetime for it. Nothing about that can be expressed by wrapping the shared
 * prologue around a table entry, so the object gets its own {@link PropFamily}
 * the way the lift and the story-mode switch do.
 *
 * The head is the second reason. The other Original-Mode-only types — 70, 71,
 * 72 and 77, which is {@link GENERIC_ORIGINAL_MODE_ONLY} — open with a bare
 * `if (g_GameMode != 1) { ActorDespawn(obj); return; }`. This one **raises the
 * flag on its way out**, so putting it in that set would leave stage 4's gate
 * shut for ever in Arcade Mode, which is the mode the player runs in. That set
 * carried an `[open]` note guessing type 75 belonged in it; it does not, and
 * the note is now answered.
 *
 * ## The three ways the flag goes up
 *
 * | where | when |
 * |---|---|
 * | `0x004710D7` | first frame, whenever `g_GameMode != 1` |
 * | `0x00471120` | the **second** change of `g_evt_step_index`, if unshot |
 * | `0x00471263` | 290 frames after it is shot |
 *
 * So the gate opens on its own in every configuration; shooting the prop only
 * changes how long it takes and what it drops on the way.
 *
 * Not transcribed: the crosshair spark (`FUN_004666B0`, a 0x50-byte object at
 * the aim point), the three sounds, the ride along object path 0x178 that
 * `obj+0x2C0` indexes, the `AssetDrawSlot(0xA6B)` draw, and
 * `g_original_item_pickup_blocked` (`0x007DCD14`) — the port transcribes
 * nothing that reads that byte. The ride moves the **model** and not the shot
 * sphere: `PropUpdateType75` registers at `obj+0x19C`, its placed origin, and
 * `PROP_SHOT_OFFSET[75]` already says so.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import { SpawnStoryModeItem } from "./items";
import { BreakablePropAwardHit, ActorDespawnProp } from "./prop";
import {
  BreakableFlag, PropCuePhase, type BreakableProp,
} from "./prop_state";
import { GenericPropRegisterForShotTest } from "./shot_test";

/**
 * The `obj+0x130C` this module's routine belongs to — `g_class41_updates[75]`,
 * at `0x005936BC + 75 * 4 = 0x005937E8`, which is that slot's only xref.
 */
export const PROP75_TYPE = 75;

/**
 * `g_script_flags` — `0x009C7200`, index 20.
 *
 * A literal in the routine and not a field of the placement: all three writes
 * are `MOV byte ptr [0x009C7214], 0x1`, bytes `c60514729c0001`. So it is the
 * same flag for every type-75 prop, which is what lets
 * {@link ClassHandler.raisesScriptFlag} declare it from the spawn record.
 */
export const PROP75_SCRIPT_FLAG = 0x14;

/**
 * `CMP EAX, 0x2` at `0x00471111` — the tick of `obj+0x2A4` the unshot arm
 * fires on.
 *
 * Not "after two steps have elapsed": the counter is incremented and then
 * tested for **equality**, so the flag goes up on that one change and on no
 * other. A prop that lived longer would not raise it again.
 */
export const PROP75_FLAG_STEP = 2;

/** `FADD float ptr [0x004C4380]` — `1.0`, once a frame. */
export const PROP75_RIDE_STEP = 1.0;

/**
 * `FCOMP float ptr [0x0056914C]` — `290.0`.
 *
 * The comparison is `FCOMP` then `TEST AH, 0x1`, which tests C0 — set when the
 * cursor is *below* the constant — and jumps past on that. So the arm fires at
 * `>= 290.0`, and since `ActorAlloc` zeroes `obj+0x2C0` and nothing resets it,
 * that is 290 frames from the shot.
 */
export const PROP75_RIDE_LENGTH = 290.0;

/**
 * `obj+0x2A0 = 1` at `0x004711C9` — the story-mode item kind this drops.
 *
 * `SpawnStoryModeItem` (`FUN_00467B90`) reads the kind out of that word, so
 * the prop is writing its own drop rather than taking one from a placement.
 */
export const PROP75_STORY_ITEM = 1;

/**
 * The world point the drop is made at, `0x004711E7`..`0x00471204`.
 *
 * The routine **overwrites its own position** with these three, calls
 * `SpawnStoryModeItem`, and puts the position straight back — because that
 * routine reads `obj+0x19C`/`+0x1A0`/`+0x1A4` and takes no coordinates. Raw
 * words `0x430E0000`, `0xC26F3333`, `0xC45E2CCD`.
 */
export const PROP75_DROP_AT: readonly [number, number, number] =
  [142.0, -59.79999923706055, -888.7000122070312];

/**
 * The shot arm, `0x00471169`..`0x00471226`.
 *
 * `[port-only]` as a *function*: in the engine it is the body of an `if`
 * inside `PropUpdateType75`. It is split out because it is the only part of
 * this routine that needs the `Rng` and the event sink, and folding those
 * through the whole update would put them on three arms that cannot use them.
 * The test stays at the call site, where the engine keeps it.
 */
function PropType75OnShot(p: BreakableProp, rng: Rng, events?: Events): void {
  // `BreakablePropAwardHit(obj+0x34, 0)` — the second argument is 0, so this
  // pays no points; it still counts the hit for the accuracy grade.
  BreakablePropAwardHit(p.flags, false, rng);

  // `obj+0x2A0 = 1`, then the position swap around `SpawnStoryModeItem`.
  p.storyItem = PROP75_STORY_ITEM;
  p.cuePhase = PropCuePhase.Riding;
  const [x, y, z] = [p.x, p.y, p.z];
  [p.x, p.y, p.z] = PROP75_DROP_AT;
  SpawnStoryModeItem(p, events);
  [p.x, p.y, p.z] = [x, y, z];
}

/**
 * `PropUpdateType75` — `FUN_004710C0`. One prop, one 60 Hz frame.
 */
export function PropUpdateType75(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  // `if (g_GameMode != 1) { g_script_flags[0x14] = 1; ActorDespawn(obj); }`
  if (G.g_GameMode !== GameMode.Original) {
    G.g_script_flags[PROP75_SCRIPT_FLAG] = 1;
    ActorDespawnProp(p);
    return;
  }

  // `PropExpireByStepLifetime` written out, without its scene-1 sweep and
  // with the flag tick folded into the middle. `obj+0x2A4` is a count of
  // step *changes* and is a different field from the lifetime's `obj+0x197`:
  // the lifetime one is a `char` and this one a full `int`.
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.removeFlag += 1;
    if (p.removeFlag === PROP75_FLAG_STEP
        && p.cuePhase === PropCuePhase.Untouched) {
      G.g_script_flags[PROP75_SCRIPT_FLAG] = 1;
    }
    p.stepsElapsed += 1;
    if (p.lifetime < p.stepsElapsed) {
      ActorDespawnProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
    // `CMP g_GameMode, EDI / JNZ 0x00471227` at `0x00471161`, with `EDI` still
    // the 1 loaded at `0x004710CA`. **Dead**: the head above has already
    // returned for every mode but 1. Written here as the fall-through it is
    // rather than dropped, so the routine reads as the engine has it.
  }

  if ((p.flags & BreakableFlag.Hit) !== 0
      && p.cuePhase === PropCuePhase.Untouched) {
    PropType75OnShot(p, rng, events);
  }

  // `if (obj+0x192 == 1) { obj+0x2C0 += 1.0; if (obj+0x2C0 >= 290.0) ... }`
  if (p.cuePhase === PropCuePhase.Riding) {
    p.shake += PROP75_RIDE_STEP;
    if (p.shake >= PROP75_RIDE_LENGTH) {
      p.cuePhase = PropCuePhase.Done;
      G.g_script_flags[PROP75_SCRIPT_FLAG] = 1;
    }
  }

  // The tail. **The hit bits are not cleared** — this routine has no `AND` on
  // `obj+0x34` anywhere in its 617 bytes, unlike the thirty that share the
  // prologue, and `class41/pool.ts` therefore must not clear them for it
  // either. Nothing re-fires on a stale bit, because both arms that read it
  // are latched on `obj+0x192`.
  GenericPropRegisterForShotTest(p);
}

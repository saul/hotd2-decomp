/**
 * Class 0x61 — **the stage-clear card**, and the actor `wait_script_flag 0xFE`
 * is waiting for.
 *
 * The last step of every result block runs `spawn_simple 0x00977244`
 * (class 0x62, the tally) and `spawn_simple 0x0097723C` (this), then
 * `set_hud_shutter_state 8`, `wait_frames 1`, and `wait_script_flag 0xFE`.
 * Five such gates: stage 1 block 14, stage 2 blocks 35 and 37, stage 3 blocks
 * 11 and 13, stage 4 blocks 23 and 25.
 *
 * **Nothing else in the image writes `g_script_flags[254]`.** A whole-image
 * byte search for the address `0x009C72FE` finds exactly one instruction,
 * `MOV byte ptr [0x009C72FE], 0x1` at `0x0043567C`, and it is this actor's
 * last act. So a port without class 0x61 cannot open a `0xFE` gate at all,
 * which is what the escape in `script/waits/flag.ts` existed for.
 *
 * ## What the port keeps, and what it does not
 *
 * The card is screen furniture: the rescue list out of
 * `g_civilians_rescued_by_scene`, the per-scene tables at `0x0055DF50`, a
 * score tally that counts up, two texbanks and a fade. **None of it is
 * ported.** What is ported is the actor's lifetime and the one side effect the
 * port has a global for: `g_nFiringGate = 0` at `0x00434FCA`, which is the
 * engine putting the trigger down for the results screen.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import {
  registerClass, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";

/** `g_script_flags` — `0x009C7200`, index 254. A literal at `0x0043567C`. */
export const RESULT_CARD_FLAG = 0xfe;

/** `MOV word ptr [EBP + 0x11c], 0x1a4` at `0x00434FDC` — seven seconds. */
export const RESULT_CARD_FRAMES = 0x1a4;

/**
 * The dwell at which the tally starts counting up — `CMP word ptr
 * [EBP+0x11c], 0x78; JG` at `0x00435107`, so the last two seconds.
 *
 * Ported because it is what moves the sub, and the sub is state a snapshot
 * carries; the tally it gates is not ported.
 */
export const RESULT_CARD_TALLY_AT = 0x78;

/** `ResultCardInstall`'s sub-states. */
enum Sub {
  /** Drop the trigger, latch the dwell, fall through into the tail. */
  Setup = 0,
  /** Hold, until the dwell reaches {@link RESULT_CARD_TALLY_AT}. */
  Hold = 1,
  /** The score counting up. Not ported beyond the state itself. */
  Tally = 2,
}

/**
 * `ResultCardInstall` — `FUN_00434EF0`. One actor, one 60 Hz frame.
 *
 * Unlike the chapter card there is no installer head: the routine dispatches
 * straight on `obj+0x1312`, and **every arm falls into the common tail** at
 * `0x00435118`, which draws the list and then counts the dwell down. So the
 * countdown runs on every frame from the first, sub included.
 */
export function ResultCardInstall(obj: Actor, f: ClassFrame): void {
  void f;
  if (obj.sub === Sub.Setup) {
    // `MOV dword ptr [0x009c8e00], EBX` with `EBX` zero, at `0x00434FCA`.
    // The results screen is not a place you may shoot, and the port has this
    // exact global — the shutter's gate — so it is transcribed rather than
    // dropped.
    G.g_nFiringGate = 0;
    obj.hp = RESULT_CARD_FRAMES;
    obj.sub = Sub.Hold;
  } else if (obj.sub === Sub.Hold && obj.hp <= RESULT_CARD_TALLY_AT) {
    obj.sub = Sub.Tally;
  }
  ResultCardCountDown(obj);
}

/** The tail at `0x00435663`: `DEC obj+0x11C`, and at zero the flag. */
function ResultCardCountDown(obj: Actor): void {
  obj.hp -= 1;
  if (obj.hp > 0) return;
  G.g_script_flags[RESULT_CARD_FLAG] = 1;
  ResultCardKill(obj);
}

/**
 * `ActorKill` (`FUN_004A7040`) at `0x0043568A`.
 *
 * `[port-only]` The clear of `g_screen_furniture_flags` bit `0x10` before it
 * is not modelled, for the same reason as the chapter card's `0x20`: nothing
 * in the port reads that word.
 */
function ResultCardKill(obj: Actor): void {
  obj.dead = true;
  obj.visible = false;
}

/**
 * `[port-only]` — no `Init` in the engine, and the card is screen space, so
 * the actor is never drawn in the world. `EvtOpSpawnSimple0A` allocates and
 * `ActorInitFlags` (`FUN_00408970`) clears the flags word; the class's first
 * frame is its update.
 *
 * `visible` is `true` and that is not a claim that anything draws it: in this
 * port that field stands for *"the character layer has this one's hierarchy"*,
 * and `GameUpdate`'s loop skips an actor without it — the engine has no such
 * test, it is the port's stand-in for a streamed-in model. A card has no
 * character type and no glTF node, so nothing can build one and nothing does;
 * the same line is what `SpawnSlotActors` writes for class 0x52's mouse, for
 * the same reason. Set it false and the countdown never runs, which is a card
 * that holds its gate shut for ever.
 */
export function ResultCardSpawn(obj: Actor): void {
  obj.visible = true;
}

export const ResultCardHandler: ClassHandler = {
  init: ResultCardSpawn,
  raisesScriptFlag: RESULT_CARD_FLAG,
  update: ResultCardInstall,
  debug: (obj) => ({
    summary: obj.dead
      ? "result card · done"
      : `result card · ${obj.hp} frames left`,
    detail: [`raises g_script_flags[${RESULT_CARD_FLAG}] at 0`],
    hot: !obj.dead,
  }),
};

registerClass(SpawnClass.ResultCard, ResultCardHandler);

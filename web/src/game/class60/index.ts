/**
 * Class 0x60 — **the chapter card**, and the actor `wait_script_flag 0xF8` is
 * waiting for.
 *
 * Every stage opens the same way. Block 0 step 1 loads the chapter texbank,
 * runs `spawn_simple 0x00977234` — the two-word `{class 0x60, hp 0}` record in
 * `comevtbl.bin` — and then blocks on `wait_script_flag 0xF8`. Flag 248 is
 * raised by exactly one instruction in the image, `MOV byte ptr
 * [0x009C72F8], BL` at `0x004348C1`, and it is the last thing this actor does
 * before it kills itself. Seven such gates in the six shipped scripts: one per
 * stage, plus stage 3's block 7 and stage 4's block 4.
 *
 * With opcode `0x0A` unported the actor never existed, so the gate could never
 * open and `wait_script_flag` had to be excused from evaluating it. That
 * excuse is what this module deletes.
 *
 * ## What the port keeps, and what it does not
 *
 * The card itself is screen furniture: eight text slots at `0x007DCBA0`, a
 * scene light block through `LightBlockSetDirection` (`FUN_0040E140`) and
 * `SetSceneAmbient` (`FUN_0040C2C0`), a per-scene sound, a fade, and at the
 * end the chapter texbank freed through `AssetQueueFreeTexbank`
 * (`FUN_0041D710`).
 * **None of that is ported** — the player draws no chapter card — and none of
 * it is what the script is waiting for. What is ported is the actor's
 * **lifetime**, which is the whole of the gate: the dwell, then the flag,
 * then `ActorKill`.
 *
 * ## The port skips every card
 *
 * The engine holds the card for 180 frames (`0xB4`) unless the pad cuts it
 * short. A player that draws no card showed those three seconds as a dead
 * pause at the top of every stage, so **by the user's decision the port
 * skips the chapter card entirely** — see {@link ChapterCardSkipRequested}.
 * The skip goes through the engine's *own* skip arm rather than around it, so
 * everything else the routine does is unchanged: the installer tests, sub 0's
 * latch, the flag and the kill all happen, on the card's first update.
 */
import type { Actor } from "../actor";
import { AppState, G } from "../globals";
import { GameMode } from "../game_mode";
import {
  registerClass, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";

/**
 * `g_script_flags` — `0x009C7200`, index 248.
 *
 * A literal in the routine and not a field of the record, so it is the same
 * flag for every chapter card in the game: `BL` is loaded 1 at `0x00434343`
 * and stored at `0x004348C1`.
 */
export const CHAPTER_CARD_FLAG = 0xf8;

/** `MOV word ptr [ESI + 0x11c], 0xb4` at `0x004345AB` — three seconds. */
export const CHAPTER_CARD_FRAMES = 0xb4;

/**
 * The dwell below which a trigger pull cuts the card short, at `0x00434810`.
 *
 * The engine's test is `g_pad_state` (`0x009C9028`) bit 2 **and**
 * `obj+0x11C < 0xA0`, so the first 20 frames of a card cannot be skipped by
 * the trigger; bit `0x20000` skips with no dwell test at all. The port has no
 * pad word for the screen furniture — the walker's `set_skippable_region` is
 * the *script's* flag rather than this one — and does not need one, because
 * it takes the unconditional arm on every card
 * ({@link ChapterCardSkipRequested}). Named so the number is already right.
 */
export const CHAPTER_CARD_SKIPPABLE_BELOW = 0xa0;

/** `g_pad_state` bit 2 — the trigger, honoured once the dwell is below 0xA0. */
const PAD_SKIP_TRIGGER = 0x2;

/** `g_pad_state` bit `0x20000` — skips the card with no dwell test. */
const PAD_SKIP_ALWAYS = 0x20000;

/** `MOV word ptr [ESI+0x11c], BX` with `BX = 1` at `0x00434826`: a skip
 *  leaves one frame, which the decrement straight after it spends. */
const CHAPTER_CARD_SKIPPED_DWELL = 1;

/**
 * The app state whose arm installs `FUN_00434DA0` instead of the card.
 *
 * Not an {@link AppState} member: that enum names only the screens that have
 * been read, and this one has not. `FUN_00434DA0` raises the same flag 248
 * from `0x00434EC0`, so whatever screen it is, it is the card's counterpart
 * there.
 */
const APP_STATE_INSTALLS_VARIANT = 0x0b;

/** `ChapterCardInstall`'s two sub-states, which it increments once. */
enum Sub {
  /** Seat the lights and the text, latch the dwell, fall straight through. */
  Setup = 0,
  /** Draw, and count the dwell down. */
  Hold = 1,
}

/**
 * `ChapterCardInstall` — `FUN_004342E0`. One actor, one 60 Hz frame.
 *
 * The engine's head is an **installer**, and both of its arms are unreachable
 * here: `g_GameMode == 3` is Boss Mode, which no shipped stage script is
 * entered in, and `g_app_state == 0x0B` is a screen the port never reaches —
 * in play the state is 6. The tests are transcribed rather than dropped, so
 * that the day either exists the routine says what the engine does; the two
 * installed updates, `FUN_00434920` and `FUN_00434DA0`, are `[open]` and not
 * ported. **An actor that takes either arm therefore never raises the flag in
 * this port**, which is why they return rather than falling through.
 */
export function ChapterCardInstall(obj: Actor, f: ClassFrame): void {
  void f;
  if (G.g_GameMode === GameMode.Boss) return;
  if (G.g_app_state === APP_STATE_INSTALLS_VARIANT) return;

  if (obj.sub === Sub.Setup) {
    // `INC word ptr [ESI+0x1312]` then `MOV word ptr [ESI+0x11c], 0xB4` at
    // `0x004345A4`, and that arm **falls through** into the sub-1 body — so
    // the countdown's first decrement is on this same frame.
    obj.sub = Sub.Hold;
    obj.hp = CHAPTER_CARD_FRAMES;
  }
  ChapterCardCountDown(obj);
}

/**
 * The countdown at `0x00434802`, which every arm of both subs falls into —
 * sub 1's scene-5 arm included: its `MatrixStackPop` at `0x004347AD` is a
 * `CALL` and not a tail jump, so the pseudocode's `return` there is Ghidra's
 * (`L35`), and the arm runs on through `0x00436AD0` into this.
 *
 * First the skip test, `0x00434802`–`0x00434826`:
 *
 * ```
 * if ((sub >= 1 && obj+0x11C < 0xA0 && (g_pad_state & 2))
 *     || (g_pad_state & 0x20000))
 *     obj+0x11C = 1;
 * ```
 *
 * then `DEC word ptr [ESI+0x11c]; CMP ..., 0; JG return` — so a dwell of `n`
 * costs `n` frames, a skip costs the frame it is taken on, and the flag lands
 * on the frame the dwell reaches zero.
 */
function ChapterCardCountDown(obj: Actor): void {
  const pad = ChapterCardSkipRequested();
  if ((obj.sub >= Sub.Hold && obj.hp < CHAPTER_CARD_SKIPPABLE_BELOW
       && (pad & PAD_SKIP_TRIGGER) !== 0)
      || (pad & PAD_SKIP_ALWAYS) !== 0) {
    obj.hp = CHAPTER_CARD_SKIPPED_DWELL;
  }
  obj.hp -= 1;
  if (obj.hp > 0) return;
  G.g_script_flags[CHAPTER_CARD_FLAG] = 1;
  ChapterCardKill(obj);
}

/**
 * `[port-only]` — the `g_pad_state` word (`0x009C9028`) as the card's skip
 * test reads it. The port has no pad word, so this is where it is decided.
 *
 * `[diverges]` Always the unconditional skip bit, so every chapter card is
 * cut on its first update and raises flag 248 there instead of three seconds
 * later. **The user's decision** (docs/NEW-BUGS.md, bug 13): the port draws
 * no chapter card, so the engine's dwell was a three-second dead pause at the
 * top of every stage, and the port skips title sequences entirely. Taking
 * the engine's own skip arm keeps the rest of the routine — installer, latch,
 * flag, kill — exactly as the exe runs it for a player who presses skip.
 */
export function ChapterCardSkipRequested(): number {
  return PAD_SKIP_ALWAYS;
}

/**
 * `ActorKill` (`FUN_004A7040`) at `0x004348CE`, and the clear of
 * `g_screen_furniture_flags` bit `0x20` before it.
 *
 * `[port-only]` The bit is not modelled: `g_screen_furniture_flags`
 * (`0x009A5900`) is read by the draw side and the port has no draw side for
 * the cards, so a bit nothing reads would be a global with one writer.
 */
function ChapterCardKill(obj: Actor): void {
  obj.dead = true;
  obj.visible = false;
}

/**
 * `[port-only]` — there is no `Init` in the engine. `EvtOpSpawnSimple0A` allocates,
 * `ActorInitFlags` (`FUN_00408970`) clears the flags word, and the class's
 * first frame is its update. This only settles what the port needs: the card
 * is screen space, so the actor is never drawn in the world.
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
export function ChapterCardSpawn(obj: Actor): void {
  obj.visible = true;
}

export const ChapterCardHandler: ClassHandler = {
  init: ChapterCardSpawn,
  raisesScriptFlag: CHAPTER_CARD_FLAG,
  update: ChapterCardInstall,
  debug: (obj) => ({
    summary: obj.dead
      ? "chapter card · done"
      : `chapter card · ${obj.hp} frames left`,
    detail: [`raises g_script_flags[${CHAPTER_CARD_FLAG}] at 0`],
    hot: !obj.dead,
  }),
};

registerClass(SpawnClass.ChapterCard, ChapterCardHandler);

/**
 * The HUD letterbox: `HudDrawShutterState` and the task that runs it.
 *
 * evt `0x1F` (`EvtOpSetHudShutterState1F`, `FUN_0045F380`) does one thing:
 * it stores its operand in `g_bHudShutterState`. **Everything else is this
 * routine's** -- the seeding of the slide, the 40-frame slide itself, the
 * one-frame states that hand over to 4 and 2, the restore, and every write of
 * `g_nFiringGate` inside a scene. It is a task of its own in the scene's task
 * list, so it runs once a frame whatever the script is doing, and it runs at a
 * fixed place in that frame:
 *
 * ```
 * 0x00460710, the scene's task-list builder (TaskRunTree runs a list in
 * creation order, and ActorAlloc appends):
 *   ...  PlayerTasksCreate, SpawnAttackablePlayerTask,
 *        HudShutterTaskCreate          <- 0x00460733, this task
 *        SceneLightArrayInit, RegionInit, ...  then every actor
 * ```
 *
 * So in one frame the script writes the byte first (its task is the list's
 * first), then both player tasks read it -- the fire routine tests the gate,
 * the readouts test the state -- and only then does this turn it into bars
 * and a gate; every actor after it (the class 0x14 and class 0x19 entrances
 * that wait on state 1) sees what this left. `SceneTaskWalk` calls it in that
 * place. `[proved]`: `ActorAlloc` (`FUN_004A6FA0`) links a new task at the
 * tail of its parent's `+0x28` list and `TaskRunTree` (`FUN_004A71A0`) walks
 * that list from its head.
 *
 * It used to live in `script/state/shutter.ts` and step at the **top** of the
 * walker's next tick, which put it before the players and a frame late: the
 * slide drew one counter value behind the engine's, a state-3 close dropped
 * the gate a frame early, and evt `0x1F` raised the gate itself -- a frame
 * before the engine lets a shot through. The seeding moved with it for the
 * same reason: the engine seeds in this routine's head, not in the opcode.
 *
 * What is drawn goes into `G.g_hud_shutter_bars`, the way `DrawScreenSprite`
 * calls go into `G.g_screen_sprite_draws`, and `hud/hud.ts` puts exactly those
 * bars on the screen. The layer decides nothing -- which is what lets it show
 * the frame a state 7 draws nothing, and the frames a screen card hides the
 * closed bars.
 */
import { G, ScreenFurniture } from "./globals";

/**
 * `g_bHudShutterState` (`0x009CA0F4`), the nine states the jump table at
 * `0x00413C80` dispatches on. Each member names its arm's address.
 *
 * The exe has no names for them; these say what each arm does. Anything
 * outside 0..8 takes the `JA` at `0x004139A6` straight to the tail.
 */
export enum ShutterState {
  /** `0x004139B3`: draw the bars shut, raise the gate, and become `Closed`. */
  CloseFiring = 0,
  /** `0x00413B17`: raise the gate and slide open over 40 frames, then `Open`. */
  Opening = 1,
  /** `0x00413C6D`, the tail itself: nothing drawn. */
  Open = 2,
  /** `0x00413A9D`: slide shut over 40 frames, then drop the gate and `Closed`. */
  Closing = 3,
  /** `0x00413BB5`: the bars held shut, unless a screen card has the screen. */
  Closed = 4,
  /** `0x00413A1C`: draw the bars shut, drop the gate, and become `Closed`. */
  CloseHoldFire = 5,
  /** `0x00413A85`: raise the gate and become `Open`; nothing drawn. */
  OpenFiring = 6,
  /** `0x00413C63`: put `g_bHudShutterPrev` back; nothing drawn this frame. */
  Restore = 7,
  /** `0x00413C15`: one bar at the centre, scaled eight times -- a blackout. */
  Blackout = 8,
}

/**
 * The slide's length in frames. `CMP EAX, 0x28` at `0x00413B24`, and the
 * `MOV [ESI+0x50], 0x28` that seeds a close at `0x00413988`.
 */
export const SHUTTER_FRAMES = 0x28;

/** Where a shut bar's origin sits, in view space at `z = -1`: `0x3EB33333`. */
export const SHUTTER_CLOSED_Y = 0.35;
/** A frame of the slide: `0x004E30FC`, `0x3B23D70A`. */
export const SHUTTER_SLIDE_STEP = 0.0025;
/** The blackout's vertical scale, `MatrixScale(1, 8, 1)` at `0x00413C3E`. */
export const SHUTTER_BLACKOUT_SCALE = 8;

/**
 * `g_screen_furniture_flags` bits that stop state 4 drawing: `TEST byte ptr
 * [0x009a5900], 0x30` at `0x00413BB5` -- the chapter card's and the result
 * card's, while either has the screen.
 *
 * **A function, not a `const`**, and on purpose: `globals.ts` imports this
 * module (for `HudShutterTaskCreate`) and this module imports `globals.ts`, so
 * in the browser's module order this file is evaluated before
 * `ScreenFurniture` exists. A top-level `const` built from the enum threw at
 * startup -- "reading 'ChapterCard'" -- and the page never loaded, while
 * `test:port`, which enters the graph from another module, passed. Read at
 * call time, the enum is always there.
 */
function ShutterHiddenByCards(): number {
  return ScreenFurniture.ChapterCard | ScreenFurniture.ResultCard;
}

/**
 * One `AssetDrawSlot(0x93E)` this routine made: the bar's origin in view
 * space at `z = -1`, and its vertical scale.
 *
 * `[port-only]` as a record -- the engine draws the quad on the spot. Asset
 * `0x93E` is `common.bin` model 129, a quad 1.03 wide and 0.10 tall about its
 * origin; every call here is `MatrixLoadIdentity`, `MatrixTranslate(0, y,
 * -1)`, and for the blackout `MatrixScale(1, 8, 1)`.
 */
export interface ShutterBar {
  y: number;
  sy: number;
}

/**
 * `HudShutterTaskCreate` — `FUN_00413950`. `ActorAlloc(HudDrawShutterState,
 * 0x58)` and the slide counter at `+0x50` set to 0, from the scene's
 * task-list builder. The port has no task object, so what the allocation
 * leaves is the counter, and an empty draw record: a list rebuilt on a scene
 * load has drawn nothing yet.
 */
export function HudShutterTaskCreate(): void {
  G.g_hud_shutter_counter = 0;
  G.g_hud_shutter_bars = [];
}

/** The two shut bars: `0x004139BA`..`0x004139F5`, and three copies of it. */
function DrawShutterClosed(): void {
  G.g_hud_shutter_bars.push({ y: SHUTTER_CLOSED_Y, sy: 1 },
                            { y: -SHUTTER_CLOSED_Y, sy: 1 });
}

/**
 * The two bars part-way, at `0x00413B3F`: `counter * 0.0025 + 0.35` for the
 * top one (`FILD [ESI+0x50]; FMUL [0x004E30FC]; FADD [0x004E30F8]`) and
 * `-0.35 - counter * 0.0025` for the bottom (`FSUBR [0x004E30F4]`). The
 * counter is the one the arm has just stepped.
 */
function DrawShutterSlide(counter: number): void {
  const y = counter * SHUTTER_SLIDE_STEP + SHUTTER_CLOSED_Y;
  G.g_hud_shutter_bars.push({ y, sy: 1 }, { y: -y, sy: 1 });
}

/**
 * `HudDrawShutterState` — `FUN_00413970`. One frame of the letterbox: seed
 * the slide on a change, run the state's arm, then remember the state.
 *
 * Read off the disassembly and the jump table at `0x00413C80`, not the
 * pseudocode: the decompiler folds states 0, 5 and 3-at-zero into one
 * `return` and drops the tails that write the gate and the state (`L37`).
 */
export function HudDrawShutterState(): void {
  G.g_hud_shutter_bars = [];
  // `0x00413970`..`0x00413995`: a state that is not the one last settled on
  // seeds the counter -- 0x28 into a close, 0 into an open -- and nothing
  // else. The opcode does none of this; it only stores the byte.
  if (G.g_bHudShutterPrev !== G.g_bHudShutterState) {
    if (G.g_bHudShutterState === ShutterState.Closing) {
      G.g_hud_shutter_counter = SHUTTER_FRAMES;
    } else if (G.g_bHudShutterState === ShutterState.Opening) {
      G.g_hud_shutter_counter = 0;
    }
  }
  switch (G.g_bHudShutterState as ShutterState) {
    case ShutterState.CloseFiring:
      // `0x00413A04`..`0x00413A15`, and `RET` -- the tail is not reached.
      DrawShutterClosed();
      G.g_bHudShutterState = ShutterState.Closed;
      G.g_nFiringGate = 1;
      G.g_bHudShutterPrev = ShutterState.Closed;
      return;
    case ShutterState.Opening: {
      // The gate goes up on every frame of the slide, first thing.
      G.g_nFiringGate = 1;
      const was = G.g_hud_shutter_counter;
      G.g_hud_shutter_counter = was + 1;
      if (was === SHUTTER_FRAMES) {
        // `0x00413B2F`: the frame after the bars reached 40, and nothing is
        // drawn on it. The counter is left at 41.
        G.g_bHudShutterState = G.g_bHudShutterPrev = ShutterState.Open;
        return;
      }
      DrawShutterSlide(G.g_hud_shutter_counter);
      break;
    }
    case ShutterState.Open:
      break;
    case ShutterState.Closing: {
      const was = G.g_hud_shutter_counter;
      G.g_hud_shutter_counter = was - 1;
      if (was === 0) {
        // `0x00413AB0`..`0x00413B10`: the frame after the bars met. The
        // counter is left at -1.
        DrawShutterClosed();
        G.g_bHudShutterState = ShutterState.Closed;
        G.g_nFiringGate = 0;
        G.g_bHudShutterPrev = ShutterState.Closed;
        return;
      }
      DrawShutterSlide(G.g_hud_shutter_counter);
      break;
    }
    case ShutterState.Closed:
      if ((G.g_screen_furniture_flags & ShutterHiddenByCards()) === 0) {
        DrawShutterClosed();
      }
      break;
    case ShutterState.CloseHoldFire:
      // `0x00413A6D`..`0x00413A7E`, and `RET`.
      DrawShutterClosed();
      G.g_bHudShutterState = ShutterState.Closed;
      G.g_nFiringGate = 0;
      G.g_bHudShutterPrev = ShutterState.Closed;
      return;
    case ShutterState.OpenFiring:
      // `0x00413A85`..`0x00413A96`, and `RET`.
      G.g_nFiringGate = 1;
      G.g_bHudShutterState = G.g_bHudShutterPrev = ShutterState.Open;
      return;
    case ShutterState.Restore:
      G.g_bHudShutterState = G.g_bHudShutterPrev;
      break;
    case ShutterState.Blackout:
      G.g_hud_shutter_bars.push({ y: 0, sy: SHUTTER_BLACKOUT_SCALE });
      break;
    default:
      break;
  }
  // The tail, `0x00413C6D`: a blackout is never the state a 7 restores.
  if (G.g_bHudShutterState !== ShutterState.Blackout) {
    G.g_bHudShutterPrev = G.g_bHudShutterState;
  }
}

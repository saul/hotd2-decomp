/**
 * Class 0x60 — **the chapter card**, and the actor `wait_script_flag 0xF8` is
 * waiting for.
 *
 * Every stage opens the same way. Block 0 step 1 fades the scene to black,
 * loads the chapter texbank (`scr_chapter_st1..6`), runs `spawn_simple
 * 0x00977234` -- the two-word `{class 0x60, hp 0}` record in `comevtbl.bin` --
 * and then blocks on `wait_script_flag 0xF8`. Flag 248 is raised by two
 * instructions in the image, both a card's last act before it kills itself.
 * Seven such gates in the six story scripts: one per stage, plus stage 3's
 * block 7 and stage 4's block 4. Boss Mode's blocks place the card too, and
 * wait on frames instead (`boss_mode.ts`).
 *
 * ## What it draws
 *
 * The card is screen furniture: three seconds of title -- eight screen
 * sprites zooming, echoing, cutting and stretching away
 * (`ChapterTitleDraw`, `title.ts`) -- over a screen that draws no level. It
 * raises `g_screen_furniture_flags` bit `0x20`
 * ({@link ScreenFurniture.ChapterCard}) for as long as it lives, and that bit
 * is what the world's draw steps aside for: `RegionDrawResidentSet`
 * (`FUN_00401260`) returns at once while it is up (`TEST AL, 0x20; JNZ` at
 * `0x00401268`), `render/stagescene.ts`. So do the shutter's state-4 bars,
 * `UpdateSceneViewAndLight`'s bit 0, class 0x22's cameo, and the bodies of
 * classes 0x24 and 0x25 and stage 1's vehicle, each in its own routine.
 * Stage 6's arm also draws a model, slot `0x1730`, half a turn about in front
 * of the eye. The sprites are the HUD layer's to draw (`G.g_screen_sprite_
 * draws`), the model `render/view_slots.ts`'s (`G.g_view_slot_draws`).
 *
 * ## What the port does not transcribe
 *
 * * Sub 0's `LightBlockSetDirection(&g_scene_light_block0, pitch, yaw)`
 *   (`FUN_0040E140`) with camera block `g_camera_index`'s angles, and
 *   `SetSceneAmbient(0.7)` (`FUN_0040C2C0`). Light block 0 is the walker's
 *   (`script/state/channels.ts`), which `game/` sits below and cannot write;
 *   see the report of this change. Every story script but stage 5's sets the
 *   direction again after the card, and stage 1's ambient is already 0.7.
 * * The asset jobs at the end -- `AssetQueueFreeTexbank(0x18C + scene)`
 *   (`FUN_0041D710`), stage 6's `AssetQueueUnloadSlot(0x1730)`
 *   (`FUN_0041D610`) and `AssetDrainAllJobs` (`FUN_0041D970`). The port
 *   keeps no texbank residency, and the slot's only drawer is this card,
 *   which dies on the same frame; the stage-6 script unloads it again with
 *   its own `asset_unload_slot` straight after the gate.
 */
import type { ChapterCardActor } from "../actor";
import { CAPTION_MODE, CAPTION_MODE_CAPTIONED } from "../caption_mode";
import { AppState, G, ScreenFurniture } from "../globals";
import { GameMode } from "../game_mode";
import {
  registerClass, type ClassFrame, type ClassHandler,
} from "../registry";
import { ScreenSpriteDraw } from "../screen_sprite";
import { SpawnClass } from "../spawn_class";
import { DrawSlotInView } from "../view_slot";
import { AttractScene11ChapterCardUpdate } from "./attract";
import { BossModeChapterCardUpdate } from "./boss_mode";
import {
  CHAPTER_CAPTION_SPRITE_FIRST, CHAPTER_CARD_FLAG, CHAPTER_CARD_MODEL_SCENE,
  CHAPTER_CARD_MODEL_SLOT, CHAPTER_CARD_SCENES, CHAPTER_TITLE_ORIGINS,
  CHAPTER_TITLE_SPRITES, ChapterCardRoutine,
} from "./state";
import { ChapterTitleDraw, ChapterTitleReset } from "./title";

export { CHAPTER_CARD_FLAG } from "./state";

/** `MOV word ptr [ESI + 0x11c], 0xb4` at `0x004345AB` — three seconds. */
export const CHAPTER_CARD_FRAMES = 0xb4;

/**
 * The dwell below which player 0's B cuts the card short: `CMP word ptr
 * [ESI + 0x11c], 0xa0; JGE` at `0x00434810`. So the first 20 frames of a
 * card cannot be skipped by player 0; player 1's B skips at any time.
 */
export const CHAPTER_CARD_SKIPPABLE_BELOW = 0xa0;

/**
 * `g_pad_state` (`0x009C9028`) bit `0x2` -- player 0's B, the reload: the
 * mouse's right button (`MouseReadButtons`, `FUN_0041F370`) and Right Ctrl
 * (`KeyboardReadAsPad`, `FUN_0041F1A0`). `TEST AL, 0x2` at `0x0043481B`.
 */
export const PAD_SKIP_PLAYER0 = 0x2;

/** Bit `0x20000`, player 1's B: `TEST EAX, 0x20000` at `0x0043481F`. */
export const PAD_SKIP_PLAYER1 = 0x20000;

/**
 * `MOV word ptr [ESI+0x11c], BX` with `BX = 1` at `0x00434826`: a skip
 * leaves one frame, which the decrement straight after it spends.
 */
const CHAPTER_CARD_SKIPPED_DWELL = 1;

/** The caption sprite's centre: `PUSH 0x44188000` (610), `PUSH 0x42ac0000` (86). */
const CAPTION_X = 610;
const CAPTION_Y = 86;

/**
 * Scene 5's model: `MatrixTranslate(0, 0, -30)` (`PUSH 0xc1f00000`),
 * `MatrixRotateY(0x8000)`, `MatrixScale(2, 2, 2)` (`PUSH 0x40000000`).
 */
const MODEL_Z = -30;
const MODEL_YAW = 0x8000;
const MODEL_SCALE = 2;

/** `ChapterCardInstall`'s two sub-states, which it increments once. */
enum Sub {
  /** Raise the furniture bit, seat the title, latch the dwell; on into 1. */
  Setup = 0,
  /** Draw, and count the dwell down. */
  Hold = 1,
}

/** `(v << 16) >> 16`: the sub and the dwell are words. */
function s16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * `ChapterCardInstall` — `FUN_004342E0`. One card, one 60 Hz frame.
 *
 * The head is an **installer**. In Boss Mode it raises the furniture bit
 * (`OR EDX, 0x20` at `0x004342F6`), runs `BossModeChapterCardUpdate` once and
 * stores it at `obj+0x00` (`0x00434308`); in app state `0x0B` the same with
 * `AttractScene11ChapterCardUpdate` (`0x00434324`..`0x00434336`). The task
 * walk calls the installed routine from the next frame on
 * ({@link ChapterCardRun}). Neither is reached in this port -- no bundle is a
 * Boss Mode stage, and the page plays in app state 6 -- but both are
 * transcribed, because they are this routine's arms.
 *
 * Otherwise the story card, inline: sub 0 latches and falls into sub 1, sub 1
 * draws, and every path -- a sub above 1 included (`JMP 0x00434802` at
 * `0x0043435B`) -- ends in the countdown.
 */
export function ChapterCardInstall(obj: ChapterCardActor, f: ClassFrame): void {
  if (G.g_GameMode === GameMode.Boss) {
    G.g_screen_furniture_flags |= ScreenFurniture.ChapterCard;
    BossModeChapterCardUpdate(obj, f);
    obj.chapter.routine = ChapterCardRoutine.BossMode;
    return;
  }
  if (G.g_app_state === AppState.AttractScene11) {
    G.g_screen_furniture_flags |= ScreenFurniture.ChapterCard;
    AttractScene11ChapterCardUpdate(obj);
    obj.chapter.routine = ChapterCardRoutine.AttractScene11;
    return;
  }
  const sub = s16(obj.sub);
  if (sub === Sub.Setup) {
    ChapterCardSetup(obj);
  } else if (sub !== Sub.Hold) {
    ChapterCardCountDown(obj);
    return;
  }
  ChapterCardDraw(G.g_scene_index);
  ChapterCardCountDown(obj);
}

/**
 * Sub 0, `0x00434360`. The furniture bit up (`OR AL, 0x20` at `0x0043436B`);
 * light block 0 along the camera and the ambient to 0.7, which the port does
 * not transcribe (see the file note); for scenes 0..5 (`CMP EAX, 0x5; JA` at
 * `0x004343B0`, table `0x004348D8`) `ChapterTitleReset` and the scene's eight
 * sprite ids; then `INC word ptr [ESI+0x1312]` and the dwell,
 * `0x004345A4`..`0x004345AB`, and on into sub 1. `[port-only]` as a function:
 * the sub's arm.
 */
function ChapterCardSetup(obj: ChapterCardActor): void {
  G.g_screen_furniture_flags |= ScreenFurniture.ChapterCard;
  const scene = s16(G.g_scene_index);
  if (scene >= 0 && scene < CHAPTER_CARD_SCENES) {
    ChapterTitleReset();
    const ids = CHAPTER_TITLE_SPRITES[scene];
    for (let i = 0; i < ids.length; i++) G.g_chapter_title_sprites[i] = ids[i];
  }
  obj.sub = s16(obj.sub + 1);
  obj.hp = CHAPTER_CARD_FRAMES;
}

/**
 * Sub 1's draw, `0x004345B4` (table `0x004348F0`), for scenes 0..5: the
 * title about the scene's two points -- scene 5 first drawing slot `0x1730`
 * in the eye's own space, `MatrixStackPush(0); MatrixLoadIdentity();
 * MatrixTranslate(0, 0, -30); MatrixRotateY(0x8000); MatrixScale(2, 2, 2);
 * NoOpStub(2.0); AssetDrawSlot(0x1730); MatrixStackPop(1)` -- and then, with
 * `g_wCaptionMode` 1 (`CMP word ptr [0x009c911e], BX`), the scene's caption
 * sprite at (610, 86). The caption never draws in this build: see
 * {@link CAPTION_MODE}. The scene-5 arm's `MatrixStackPop` is a `CALL`, not a
 * tail jump, so it runs on into its title, its caption test and the
 * countdown like the others. `[port-only]` as a function: the sub's arm.
 */
function ChapterCardDraw(sceneWord: number): void {
  const scene = s16(sceneWord);
  if (!(scene >= 0 && scene < CHAPTER_CARD_SCENES)) return;
  if (scene === CHAPTER_CARD_MODEL_SCENE) {
    DrawSlotInView(CHAPTER_CARD_MODEL_SLOT, 0, 0, MODEL_Z, MODEL_SCALE,
                   MODEL_YAW);
  }
  const [x0, y0, x1, y1] = CHAPTER_TITLE_ORIGINS[scene];
  ChapterTitleDraw(x0, y0, x1, y1);
  if (CAPTION_MODE !== CAPTION_MODE_CAPTIONED) return;
  ScreenSpriteDraw(CHAPTER_CAPTION_SPRITE_FIRST + scene, CAPTION_X, CAPTION_Y,
                   1, 1, 1, 1);
}

/**
 * The countdown at `0x00434802`, which every arm of both subs falls into.
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
 *
 * At zero, in the engine's order: the scene's asset jobs (not transcribed;
 * see the file note), the flag (`0x004348C1`), then the furniture bit down
 * (`AND AL, 0xDF` at `0x004348C7`, stored at `0x004348C9`), then `ActorKill`.
 * So the frame that opens the gate is also the one that gives the screen
 * back.
 */
function ChapterCardCountDown(obj: ChapterCardActor): void {
  const pad = G.g_pad_state;
  if ((s16(obj.sub) >= Sub.Hold && s16(obj.hp) < CHAPTER_CARD_SKIPPABLE_BELOW
       && (pad & PAD_SKIP_PLAYER0) !== 0)
      || (pad & PAD_SKIP_PLAYER1) !== 0) {
    obj.hp = CHAPTER_CARD_SKIPPED_DWELL;
  }
  obj.hp = s16(obj.hp - 1);
  if (obj.hp > 0) return;
  G.g_script_flags[CHAPTER_CARD_FLAG] = 1;
  G.g_screen_furniture_flags &= ~ScreenFurniture.ChapterCard;
  obj.dead = true;                                     // `ActorKill` at 0x004348CE
  obj.visible = false;
}

/**
 * `[port-only]` — the task walk's call through `obj+0x00`, for the three
 * routines a class-0x60 object can be on.
 */
function ChapterCardRun(obj: ChapterCardActor, f: ClassFrame): void {
  switch (obj.chapter.routine) {
    case ChapterCardRoutine.Install: ChapterCardInstall(obj, f); break;
    case ChapterCardRoutine.BossMode: BossModeChapterCardUpdate(obj, f); break;
    case ChapterCardRoutine.AttractScene11:
      AttractScene11ChapterCardUpdate(obj);
      break;
  }
}

/**
 * `[port-only]` — there is no `Init` in the engine. `EvtOpSpawnSimple0A`
 * allocates, `ActorInitFlags` (`FUN_00408970`) clears the flags word, and the
 * class's first frame is its update. This only settles what the port needs:
 * the card is screen space, so the actor is never drawn in the world.
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
export function ChapterCardSpawn(obj: ChapterCardActor): void {
  obj.visible = true;
}

export const ChapterCardHandler: ClassHandler = {
  init: (obj) => {
    if (obj.cls === SpawnClass.ChapterCard) ChapterCardSpawn(obj);
  },
  raisesScriptFlag: CHAPTER_CARD_FLAG,
  update: (obj, f) => {
    if (obj.cls === SpawnClass.ChapterCard) ChapterCardRun(obj, f);
  },
  debug: (obj) => ({
    summary: obj.dead
      ? "chapter card · done"
      : `chapter card · ${obj.hp} frames left`,
    detail: [`raises g_script_flags[${CHAPTER_CARD_FLAG}] at 0`],
    hot: !obj.dead,
  }),
};

registerClass(SpawnClass.ChapterCard, ChapterCardHandler);

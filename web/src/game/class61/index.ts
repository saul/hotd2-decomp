/**
 * Class 0x61 — **the stage-clear card**: the rescued civilians standing in
 * the scene, the lives they are worth, each player's score and accuracy, and
 * the actor `wait_script_flag 0xFE` is waiting for.
 *
 * The last step of every result block runs `spawn_simple 0x00977244`
 * (class 0x62, the card's loader), `spawn_simple 0x0097723C` (this), a
 * 420-frame `cam_play` through the part of the level the card is framed
 * over, `set_hud_shutter_state 8`, `wait_frames 1` and `wait_script_flag
 * 0xFE`. Seven such steps: stage 1 block 14, stage 2 blocks 35 and 37, stage
 * 3 blocks 11 and 13, stage 4 blocks 23 and 25. The whole reading is
 * `docs/re/stage-end.md`.
 *
 * **Nothing else in the image writes `g_script_flags[254]`.** A whole-image
 * byte search for the address `0x009C72FE` finds exactly one instruction,
 * `MOV byte ptr [0x009C72FE], 0x1` at `0x0043567C`, and it is this actor's
 * last act.
 *
 * ## The object and its figures
 *
 * The card allocates one task per figure in its first frame
 * (`ResultCardFigureInit`, `FUN_004356A0`, then `ResultCardFigureUpdate`,
 * `FUN_00435760`); those have no class id, and the port gives them this one,
 * with {@link ResultCardTail.routine} saying which routine a class-0x61
 * object runs. They are in `figure.ts`.
 *
 * ## What is drawn
 *
 * The card is screen furniture: seventeen `scr_result` tiles by
 * `DrawScreenSprite` at depth 1.1 -- behind the glyphs, in front of the
 * level, leaving the window the flight is seen through -- and `result.bin`
 * glyphs in the camera's own space, `game/view_slot.ts`. `render/` draws
 * both from `G`.
 */
import type { Actor, ResultCardActor } from "../actor";
import { G, ScreenFurniture } from "../globals";
import { GameMode } from "../game_mode";
import { PlayerState } from "../player_state";
import {
  registerClass, type ClassFrame, type ClassHandler,
} from "../registry";
import { DrawScreenSprite } from "../screen_sprite";
import { SpawnClass } from "../spawn_class";
import { ActorSpawn } from "../spawn";
import { DrawSlotInView } from "../view_slot";
import {
  G_RESULT_GLYPHS_ACCURACY, G_RESULT_GLYPHS_LIFE_BONUS,
  G_RESULT_GLYPHS_RESCUED, G_RESULT_GLYPHS_SCORE, G_RESULT_LIFE_BONUS,
  RESULT_GLYPHS_ACCURACY_LAST, RESULT_GLYPHS_LIFE_BONUS_END,
  RESULT_GLYPHS_RESCUED_END, RESULT_GLYPHS_SCORE_END, RESULT_LIFE_BONUS_ROW,
  RdataS8, RdataU16, ResultFigureList, ResultFigureRecordAt,
} from "./rdata";
import {
  RESULT_CARD_TILE_FIRST, RESULT_FIGURE_IDLE_MOTION_BASE,
  RESULT_FIGURE_IDLE_MOTIONS, RESULT_GLYPH_FIRST, ResultCardRoutine,
  ResultFigureAt,
} from "./state";
import { ResultCardFigureInit, ResultCardFigureUpdate } from "./figure";
import { ResultCardDrawAccuracy, ResultCardDrawScore } from "./draw";

/** `g_script_flags` — `0x009C7200`, index 254. A literal at `0x0043567C`. */
export const RESULT_CARD_FLAG = 0xfe;

/** `MOV word ptr [EBP + 0x11c], 0x1a4` at `0x00434FDC` — seven seconds. */
export const RESULT_CARD_FRAMES = 0x1a4;

/**
 * The dwell at which sub 1 hands over to the life bonus -- `CMP word ptr
 * [EBP+0x11c], 0x78; JG` at `0x00435107`, the last two seconds.
 */
export const RESULT_CARD_BONUS_AT = 0x78;

/** `PUSH 0x10000003` at `0x00434FBA`: bgm 3, `CLR.WAV`. */
export const RESULT_CARD_BGM = 0x10000003;

/** `ResultCardInstall`'s sub-states, `obj+0x1312`. */
export enum ResultCardSub {
  /** Sound, trigger down, furniture up, dwell, figures; on into 1. */
  Setup = 0,
  /** Hold, until the dwell reaches {@link RESULT_CARD_BONUS_AT}. */
  Hold = 1,
  /** The life bonus, once (`0x00434F4D`). */
  Bonus = 2,
  /** Nothing but the draw and the countdown. */
  Done = 3,
}

/**
 * The card's draw, from the tail at `0x00435118`. Screen positions are the
 * routine's own floats: an immediate `PUSH` where the instruction has one,
 * the `.rdata` word it `FMUL`s or `FSUB`s by where it does not.
 */
const TILE_DEPTH = Math.fround(1.1);                     // 0x3F8CCCCD
const TILE_SIZE = 0x80;
const TILE_ROWS = 4;
const TILE_ROW_END = 0x280;
/** Row 1's cells from `0x80` to `0x180` are not drawn: the window. */
const WINDOW_ROW = 1;
const WINDOW_FROM = 0x80;
const WINDOW_TO = 0x180;
const GLYPH_Z = -1;                                      // 0xBF800000
const RESCUED_Y = Math.fround(0.22);                     // 0x3E6147AE
const RESCUED_SCALE = Math.fround(0.07);                 // 0x3D8F5C29
const RESCUED_STEP = Math.fround(0.05);                  // [0x004C4C88]
const RESCUED_X0 = 0.25;                                 // [0x004C4C58]
const RESCUED_COUNT_X = 0.25;                            // 0x3E800000
/** The count shows once the dwell is at or below `0x186`, and climbs one a
 *  twentieth: `(0x186 - dwell) * 0x66666667 >> 35`. */
const RESCUED_COUNT_FROM = 0x186;
const RESCUED_COUNT_RATE = 20;
const BONUS_TEXT_FROM = 0xb4;
const BONUS_Y = Math.fround(0.05);                       // 0x3D4CCCCD
const BONUS_SCALE = Math.fround(0.05);
const BONUS_STEP = Math.fround(0.036);                   // [0x0055E170]
const BONUS_X0 = Math.fround(0.234);                     // [0x0055E16C]
const BONUS_DIGIT_FROM = 0x96;
const BONUS_DIGIT_X = Math.fround(0.234);                // 0x3E6F9DB2
const ACCURACY_Y = Math.fround(-0.24);                   // 0xBE75C28F
const ACCURACY_SCALE = Math.fround(0.03);                // 0x3CF5C28F
const ACCURACY_STEP = Math.fround(0.0275);               // [0x0055E168]
const ACCURACY_X0 = 0.233;                               // [0x0055E160], a double
/** `LEA EDX, [EDI + 0x5]` at `0x004353B7`. */
const ACCURACY_COLUMN0 = 5;
const PLAYER_Y = Math.fround(-0.11);                     // 0xBDE147AE
const PLAYER_SCALE = Math.fround(0.04);                  // 0x3D23D70A
/** `0x1660 + p` -- `PUSH 0x1660` at `0x0043546F`, `0x1661` at `0x0043558D`. */
const PLAYER_DIGIT = [0x1660, 0x1661];
const PLAYER_DIGIT_X = [Math.fround(-0.351), Math.fround(0.149)]; // 0xBEB39C0F, 0x3E18C7E3
const SCORE_TEXT_STEP = Math.fround(0.0288);             // [0x0055E15C]
/** Player 0 `FSUB [0x0055E158]`, player 1 `FADD [0x0055E154]`. */
const SCORE_TEXT_X0 = [-Math.fround(0.322), Math.fround(0.178)];
const SCORE_X = Math.fround(-0.293);                     // 0xBE961E4F
const SCORE_Y = Math.fround(-0.17);                      // 0xBE2E147B
const SCORE_STRIDE = 0.5;                                // 0x3F000000
const ACCURACY_X = Math.fround(-0.243);                  // 0xBE78D4FE
/** Player 0 `PUSH 0x3f000000`, player 1 `PUSH 0x3ebfb15b`. */
const ACCURACY_STRIDE = [0.5, Math.fround(0.3744)];
/** `CMP word ptr [0x009a5c84], 0x14; JL` at `0x00435521` / `0x00435640`. */
const ACCURACY_SHOWN_FROM = 0x14;

/** `(v << 16) >> 16` -- the engine's words here are s16. */
function s16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * The life bonus the card's head reads every frame, `0x00434EF0`..
 * `0x00434F2A`: `g_result_life_bonus[scene*8 + n]` while the scene's rescue
 * count `n` is under 8 (`CMP CX, 0x8; JL`), `[scene*8 + 7]` from there
 * (`[EAX*8 + 0x55e04b]`). A signed byte (`MOVSX BX, byte ptr` at the award,
 * `TEST AL, AL; JLE` at the figures). `[port-only]` as a function; 0 with no
 * table.
 */
function ResultCardLifeBonus(scene: number, n: number): number {
  const i = n < RESULT_LIFE_BONUS_ROW ? n : RESULT_LIFE_BONUS_ROW - 1;
  return RdataS8(G_RESULT_LIFE_BONUS + scene * RESULT_LIFE_BONUS_ROW + i) ?? 0;
}

/**
 * `ResultCardInstall` — `FUN_00434EF0`. One card, one 60 Hz frame.
 *
 * No installer head: the life bonus is read, then the routine dispatches on
 * `obj+0x1312`, and **every arm falls into the common tail** at
 * `0x00435118` -- the draw, then the countdown -- so both run on every frame
 * from the first. Sub 0 falls into sub 1's test on the same frame
 * (`INC [EBP+0x1312]` at `0x00435100`, then `0x00435107`); sub 2 runs once
 * and steps to 3.
 */
export function ResultCardInstall(obj: ResultCardActor, f: ClassFrame): void {
  const scene = G.g_scene_index;
  const n = s16(G.g_civilians_rescued_by_scene[scene] ?? 0);
  const bonus = ResultCardLifeBonus(scene, n);
  if (obj.sub === ResultCardSub.Setup) {
    ResultCardSetup(obj, f, scene, n, bonus);
    obj.sub = ResultCardSub.Hold;
  }
  if (obj.sub === ResultCardSub.Hold) {
    if (obj.hp <= RESULT_CARD_BONUS_AT) obj.sub = ResultCardSub.Bonus;
  } else if (obj.sub === ResultCardSub.Bonus) {
    ResultCardAwardLives(bonus);
    obj.sub = ResultCardSub.Done;
  }
  ResultCardDraw(obj, n, bonus);
  ResultCardCountDown(obj);
}

/**
 * Sub 0, `0x00434FB1`..`0x00435100`. `SndLoadPackStubbedOut(0, 0, -1)`
 * (`FUN_0041D3A0`, a stub) and then `PlaySoundId(0x10000003)`; the trigger
 * down (`MOV [0x009c8e00], EBX` at `0x00434FCA`); the furniture bit up (`OR
 * EDX, 0x10` at `0x00434FD0`); the dwell; the figures.
 *
 * With no rescue in the scene (`CMP AX, BX; JNZ` at `0x00434FF7`) one figure
 * per record of the scene's list until a type of -1, the record's type, and
 * `rand() % 3 + 0x18B` for its clip. With rescues one per rescue -- `i`
 * against the count re-read each time, **not** against the list -- the
 * rescued civilian's own type from `g_rescued_char_types`, record `i`'s
 * position and clip, and `obj+0x1350 = 1` while the bonus is above 0.
 *
 * `[port-only]` as a function: the arm is the routine's own, split out so the
 * dispatch above reads as the engine's.
 */
function ResultCardSetup(obj: ResultCardActor, f: ClassFrame, scene: number,
                         n: number, bonus: number): void {
  f.events?.emit("sound.play", { id: RESULT_CARD_BGM });
  G.g_nFiringGate = 0;
  G.g_screen_furniture_flags |= ScreenFurniture.ResultCard;
  obj.hp = RESULT_CARD_FRAMES;
  const list = ResultFigureList(scene);
  if (list === null) return;
  if (n === 0) {
    let rec = ResultFigureRecordAt(list, 0);
    let i = 0;
    while (rec && rec.type !== -1) {
      const motion = f.rng.int(RESULT_FIGURE_IDLE_MOTIONS)
        + RESULT_FIGURE_IDLE_MOTION_BASE;
      ResultCardAllocFigure(i, rec.type, motion, rec, 0, f);
      i += 1;
      rec = ResultFigureRecordAt(list, i);
    }
  } else if (n > 0) {
    for (let i = 0; i < s16(G.g_civilians_rescued_by_scene[scene] ?? 0); i++) {
      const rec = ResultFigureRecordAt(list, i);
      if (!rec) break;
      const type = s16(G.g_rescued_char_types[scene * 10 + i] ?? 0);
      ResultCardAllocFigure(i, type, rec.motion, rec, bonus > 0 ? 1 : 0, f);
    }
  }
}

/**
 * One figure, as sub 0 makes it: `ActorAlloc(ResultCardFigureInit, 0x13F4)`
 * and `ActorClearGameFields`, then `obj+0x131B` (the index), `obj+0x40..0x48`
 * (the record's position), `obj+0x68` (its yaw), `obj+0x1F4` (the type),
 * `obj+0x1B4` (the clip) and, for a rescued figure, `obj+0x1350`.
 *
 * `[port-only]` as a function; every store is the arm's. `ActorSpawn` puts it
 * in the pool after the card, where `ActorAlloc` appends it, and its first
 * update this frame is the init. The flags word is `ActorClearGameFields`'
 * zero -- not the `| 1` a descriptor spawn gets.
 */
function ResultCardAllocFigure(index: number, type: number, motion: number,
                               rec: { x: number; y: number; z: number;
                                      yaw: number },
                               lifeBonus: number, f: ClassFrame): void {
  const a = ActorSpawn(ResultFigureAt(index, type), SpawnClass.ResultCard,
                       type, `result figure ${index}`, undefined, f.rng,
                       f.events);
  if (a.cls !== SpawnClass.ResultCard) return;
  a.flags = 0;
  a.card.routine = ResultCardRoutine.FigureInit;
  a.card.figureIndex = index & 0xff;
  a.card.lifeBonus = lifeBonus;
  a.pos.x = rec.x;
  a.pos.y = rec.y;
  a.pos.z = rec.z;
  a.yaw = rec.yaw;
  a.charType = type;
  a.motion = motion;
}

/**
 * Sub 2, `0x00434F4D`..`0x00434FA5`: both players, in play or not, `lives +=
 * bonus` in 16 bits, then capped -- in Original Mode (`DEC EDX; JZ`) at their
 * own `g_original_life_cap`, signed (`CMP AX, DX; JL`); otherwise at
 * `g_max_lives`, unsigned (`CMP EDX, EAX; JC`), storing its low word.
 * `[port-only]` as a function, as {@link ResultCardSetup} is.
 */
function ResultCardAwardLives(bonus: number): void {
  for (let p = 0; p < 2; p++) {
    const lives = s16(bonus + (G.g_player_lives[p] ?? 0));
    G.g_player_lives[p] = lives;
    if (G.g_GameMode === GameMode.Original) {
      const cap = (G.g_original_life_cap[p] << 24) >> 24;
      if (!(lives < cap)) G.g_player_lives[p] = cap;
    } else if ((lives >>> 0) >= (G.g_max_lives >>> 0)) {
      G.g_player_lives[p] = s16(G.g_max_lives);
    }
  }
}

/**
 * The draw at `0x00435118`..`0x00435660`, on every frame. `[port-only]` as a
 * function; see the constants above for each number's instruction.
 */
function ResultCardDraw(obj: ResultCardActor, n: number, bonus: number): void {
  // The frame: seventeen tiles, `EBX` from `0xA2A` stepped once per drawn
  // cell, skipping the window.
  let id = RESULT_CARD_TILE_FIRST;
  for (let row = 0; row < TILE_ROWS; row++) {
    for (let x = 0; x < TILE_ROW_END; x += TILE_SIZE) {
      if (row === WINDOW_ROW && !(x < WINDOW_FROM) && !(x > WINDOW_TO)) {
        continue;
      }
      DrawScreenSprite(id, x, row * TILE_SIZE, TILE_DEPTH, 1, 1, 0);
      id += 1;
    }
  }
  // "RESCUED x" -- no zero test on this string.
  for (let va = G_RESULT_GLYPHS_RESCUED, i = 0; va < RESULT_GLYPHS_RESCUED_END;
    va += 2, i++) {
    DrawSlotInView(RdataU16(va) ?? 0,
                   Math.fround(i * RESCUED_STEP - RESCUED_X0), RESCUED_Y,
                   GLYPH_Z, RESCUED_SCALE);
  }
  if (obj.hp <= RESCUED_COUNT_FROM) {
    let c = Math.trunc((RESCUED_COUNT_FROM - obj.hp) / RESCUED_COUNT_RATE);
    if (s16(c) > n) c = n;
    DrawSlotInView(RESULT_GLYPH_FIRST + s16(c), RESCUED_COUNT_X, RESCUED_Y,
                   GLYPH_Z, RESCUED_SCALE);
  }
  if (obj.hp <= BONUS_TEXT_FROM) {
    for (let va = G_RESULT_GLYPHS_LIFE_BONUS, i = 0;
      va < RESULT_GLYPHS_LIFE_BONUS_END; va += 2, i++) {
      const slot = RdataU16(va) ?? 0;
      if (slot === 0) continue;
      DrawSlotInView(slot, Math.fround(i * BONUS_STEP - BONUS_X0), BONUS_Y,
                     GLYPH_Z, BONUS_SCALE);
    }
  }
  if (obj.hp <= BONUS_DIGIT_FROM) {
    DrawSlotInView(RESULT_GLYPH_FIRST + bonus, BONUS_DIGIT_X, BONUS_Y,
                   GLYPH_Z, BONUS_SCALE);
  }
  for (let va = G_RESULT_GLYPHS_ACCURACY, i = 0;
    va <= RESULT_GLYPHS_ACCURACY_LAST; va += 2, i++) {
    const slot = RdataU16(va) ?? 0;
    if (slot === 0) continue;
    DrawSlotInView(slot,
                   Math.fround((i + ACCURACY_COLUMN0) * ACCURACY_STEP
                               - ACCURACY_X0),
                   ACCURACY_Y, GLYPH_Z, ACCURACY_SCALE);
  }
  for (let p = 0; p < 2; p++) {
    if (G.g_player_state[p] !== PlayerState.InPlay) continue;
    DrawSlotInView(PLAYER_DIGIT[p], PLAYER_DIGIT_X[p], PLAYER_Y, GLYPH_Z,
                   PLAYER_SCALE);
    for (let va = G_RESULT_GLYPHS_SCORE, i = 0; va < RESULT_GLYPHS_SCORE_END;
      va += 2, i++) {
      const slot = RdataU16(va) ?? 0;
      if (slot === 0) continue;
      DrawSlotInView(slot, Math.fround(i * SCORE_TEXT_STEP + SCORE_TEXT_X0[p]),
                     PLAYER_Y, GLYPH_Z, PLAYER_SCALE);
    }
    ResultCardDrawScore(p, SCORE_X, SCORE_Y, SCORE_STRIDE);
    if (s16(G.g_player_shot_count[p]) >= ACCURACY_SHOWN_FROM) {
      ResultCardDrawAccuracy(p, ACCURACY_X, ACCURACY_Y, ACCURACY_STRIDE[p]);
    }
  }
}

/**
 * The tail at `0x00435663`: `DEC obj+0x11C`, and at zero the flag.
 *
 * `CMP word ptr [EBP+0x11c], BX` at `0x0043566A` compares against zero:
 * `EBX` is cleared at `0x00435188` and nothing in the draw after it writes
 * it. At zero, in the engine's order: the flag (`0x0043567C`), the furniture
 * bit down (`AND AL, 0xEF` at `0x00435683`, stored at `0x00435685`), then
 * `ActorKill`.
 */
function ResultCardCountDown(obj: Actor): void {
  obj.hp -= 1;
  if (obj.hp > 0) return;
  G.g_script_flags[RESULT_CARD_FLAG] = 1;
  G.g_screen_furniture_flags &= ~ScreenFurniture.ResultCard;
  ResultCardKill(obj);
}

/** `ActorKill` (`FUN_004A7040`) at `0x0043568A`. */
function ResultCardKill(obj: Actor): void {
  obj.dead = true;
  obj.visible = false;
}

/**
 * `[port-only]` — no `Init` in the engine, and the card is screen space, so
 * the actor is never drawn in the world. `EvtOpSpawnSimple0A` allocates and
 * `ActorInitFlags` (`FUN_00408970`) clears the flags word; the class's first
 * frame is its update. The figures come here too, from `ActorSpawn`; their
 * first update is `ResultCardFigureInit`, which the dispatch reaches.
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

/**
 * `[port-only]` — the task walk's call through `obj+0x00`, for the three
 * routines a class-0x61 object can be on.
 */
function ResultCardRun(obj: Actor, f: ClassFrame): void {
  if (obj.cls !== SpawnClass.ResultCard) return;
  switch (obj.card.routine) {
    case ResultCardRoutine.Card: ResultCardInstall(obj, f); break;
    case ResultCardRoutine.FigureInit: ResultCardFigureInit(obj, f); break;
    case ResultCardRoutine.FigureUpdate: ResultCardFigureUpdate(obj, f); break;
  }
}

export const ResultCardHandler: ClassHandler = {
  init: ResultCardSpawn,
  raisesScriptFlag: RESULT_CARD_FLAG,
  update: ResultCardRun,
  // The figures step `model+0` themselves, after their draw
  // (`INC dword ptr [EDI]` at `0x004357E6`); the card has no model.
  advancesOwnMotion: true,
  debug: (obj) => {
    if (obj.cls === SpawnClass.ResultCard
        && obj.card.routine !== ResultCardRoutine.Card) {
      return {
        summary: `result figure ${obj.card.figureIndex} · motion `
          + `0x${obj.motion.toString(16)}`,
        detail: [obj.card.lifeBonus ? "holds up the life" : "no bonus"],
      };
    }
    return {
      summary: obj.dead
        ? "result card · done"
        : `result card · sub ${obj.sub} · ${obj.hp} frames left`,
      detail: [`raises g_script_flags[${RESULT_CARD_FLAG}] at 0`],
      hot: !obj.dead,
    };
  },
};

registerClass(SpawnClass.ResultCard, ResultCardHandler);

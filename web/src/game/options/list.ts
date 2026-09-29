/**
 * The options list: its two tasks and its eleven rows.
 *
 * `OptionsTaskListCreate` makes two tasks, which `OptionsFrameList` walks
 * once a frame in allocation order: `OptionsMoveCursorTask` moves the cursor,
 * then `OptionsDrawListTask` draws the screen and calls each row's handler
 * from `g_options_rows` (`0x005696E0`) -- which draws the row's value and, on
 * the highlighted row, edits it. So a value changes on the same frame it is
 * drawn with its new text, after the cursor has already moved.
 *
 * Every edit writes the profile at once; nothing is held back for EXIT.
 * `[proved]`
 */
import type { Events } from "../../core/events";
import { G } from "../globals";
import { PlaySoundId } from "../class45/rand";
import { OptionsFactoryReset, ProfileSaveAndApply } from "../profile";
import { DrawScreenSprite, OptionsDrawSprite, SCREEN_SPRITE_LIT,
         SetRenderLightColour } from "../screen_sprite";
import { OptionsSprite } from "../options_data";
import { T } from "../tables";
import { OptionsDrawBackground, OptionsDrawNumber, OptionsDrawText,
         OptionsTextFlag } from "./text";
import { ScreenIdleDim } from "../screen_idle";
import { OptionsFrame, OptionsPhase } from "./state";

/** The rows, by their index in `g_options_rows` and the cursor's value. */
export enum OptionsRow {
  Difficulty = 0,
  Life = 1,
  Continue = 2,
  BloodColor = 3,
  SightGraphic = 4,
  SightSpeed = 5,
  SoundTestSe = 6,
  SoundTestMusic = 7,
  GunCalibration = 8,
  Default = 9,
  Exit = 10,
}

/**
 * The pad bits the list reads, player 0's; player 1's are the same shifted
 * up 16 (`KeyboardReadAsPad`, `FUN_0041F1A0`: the arrows and Enter for
 * player 0).
 */
export enum OptionsPad {
  /** A -- the trigger, Right Shift on the keyboard, the mouse's left button. */
  A = 0x4,
  /** START -- Enter. */
  Start = 0x8,
  Up = 0x10,
  Down = 0x20,
  Left = 0x40,
  Right = 0x80,
}

/** Either player: `PUSH 0x100010` and `0x200020` into `OptionsPadPressed`. */
const UP_EITHER = 0x100010;
const DOWN_EITHER = 0x200020;
/** `PUSH 0x800080` and `0x400040`: the value rows' right and left. */
const RIGHT_EITHER = 0x800080;
const LEFT_EITHER = 0x400040;
/** A or START, either player: `TEST [g_pad_state], 0xC000C`. */
const CONFIRM_EITHER = 0xc000c;
/** A, either player: `TEST [g_pad_state], 0x40004`. */
const A_EITHER = 0x40004;

/** `DC_SE\SELECT2_22.wav`: every cursor move and every value change. */
export const OPTIONS_SOUND_SELECT = 0xa9;
/** `COMMON\GUN1_22.WAV`: into Sight Speed or Gun Calibration. */
export const OPTIONS_SOUND_ENTER = 0x3016a9;
/** `START_COIN\START1_22.wav`: EXIT. */
export const OPTIONS_SOUND_EXIT = 0x121a9;
/** The three stops `PlaySoundControl` tells apart: music, voice, SE. */
const SOUND_STOP = 0x80000000;
const SOUND_STOP_VOICE = 0x80000002;
const SOUND_STOP_SE = 0x80000001;

/** The two sound-test rows' hold: at 30 frames a held direction repeats. */
const HOLD_REPEAT_FRAMES = 0x1e;
/** The SE test runs 0..0x2EE, the music test 0..0x12. */
const SE_TEST_LAST = 0x2ee;
const MUSIC_TEST_LAST = 0x12;

/**
 * `OptionsDrawText`'s flags for a row's label: 1 plain (`PUSH 1`), `0x111`
 * highlighted -- red, and at depth 0.9 -- and 9 faded.
 */
const LABEL_PLAIN = 0x1;
const LABEL_HIGHLIGHTED = LABEL_PLAIN | OptionsTextFlag.Red
  | OptionsTextFlag.Near;
/** Sight Speed's label while no player can use it. */
const LABEL_FADED = LABEL_PLAIN | OptionsTextFlag.Faded;

/**
 * `OptionsPadPressed` — `FUN_00488200`. 1 if any direction in `mask` was
 * pressed this frame, in `g_pad_state` or in the second pressed byte
 * `g_pad_aux_state` -- up, down, left, right as `0x10`, `0x20`, `0x40`,
 * `0x80` in the pad word and `1`, `2`, `4`, `8` in the byte, player 1's the
 * next sixteen and the next four. `[proved]`
 */
export function OptionsPadPressed(mask: number): number {
  const pad = G.g_pad_state;
  const aux = G.g_pad_aux_state & 0xff;
  let r = 0;
  if ((mask & 0x10) !== 0 && ((pad & 0x10) !== 0 || (aux & 1) !== 0)) r = 1;
  if ((mask & 0x20) !== 0 && ((pad & 0x20) !== 0 || (aux & 2) !== 0)) r = 1;
  if ((mask & 0x80) !== 0 && ((pad & 0x80) !== 0 || (aux & 8) !== 0)) r = 1;
  if ((mask & 0x40) !== 0 && ((pad & 0x40) !== 0 || (aux & 4) !== 0)) r = 1;
  if ((mask & 0x100000) !== 0
      && ((pad & 0x100000) !== 0 || (aux & 0x10) !== 0)) r = 1;
  if ((mask & 0x200000) !== 0
      && ((pad & 0x200000) !== 0 || (aux & 0x20) !== 0)) r = 1;
  if ((mask & 0x800000) !== 0
      && ((pad & 0x800000) !== 0 || (aux & 0x80) !== 0)) r = 1;
  if ((mask & 0x400000) !== 0
      && ((pad & 0x400000) !== 0 || (aux & 0x40) !== 0)) r = 1;
  return r;
}

/**
 * `OptionsHoldRepeatTick` — `FUN_00487C40`. While right is held (either
 * player, or `g_pad_aux_held & 0x88`) the count climbs to 30; while left is,
 * it falls to -30; otherwise it is 0. The sound-test rows step once a frame
 * while it sits at either end. `[proved]`
 */
export function OptionsHoldRepeatTick(): void {
  const held = G.g_pad_held;
  const aux = G.g_pad_aux_held & 0xff;
  if ((held & 0x80) !== 0 || (held & 0x800000) !== 0 || (aux & 0x88) !== 0) {
    if (G.g_options_hold_repeat < HOLD_REPEAT_FRAMES) {
      G.g_options_hold_repeat += 1;
    }
    return;
  }
  if ((held & 0x40) !== 0 || (held & 0x400000) !== 0 || (aux & 0x44) !== 0) {
    if (G.g_options_hold_repeat > -HOLD_REPEAT_FRAMES) {
      G.g_options_hold_repeat -= 1;
    }
    return;
  }
  G.g_options_hold_repeat = 0;
}

/**
 * [diverges] Gun Calibration is never on offer, by the user's choice. In the
 * exe it is for a gun outside PC input mode 6, and a touch is the port's
 * light gun (`0xD`), so a player whose last press was a finger would be
 * offered a screen the port has not got -- `OptionsCalibrationArm` and the
 * calibration run behind it are unported, and the page's guns are aimed by
 * the browser, with nothing to calibrate. The row is hidden and stepped
 * over as the exe does for a mouse; `OptionsCalibrationEntry`'s gate
 * is still the exe's.
 */
const GUN_CALIBRATION_OFFERED = false;

/**
 * Whether Gun Calibration is on offer: a player holding a gun that is not
 * in PC input mode 6. The same two lines open both tasks (`0x00486C38` and
 * `0x00486DC1`). `[port-only]` as a function. The port never offers it:
 * see {@link GUN_CALIBRATION_OFFERED}.
 */
function CalibrationOffered(): boolean {
  if (!GUN_CALIBRATION_OFFERED) return false;
  return (G.g_player_input_is_gun[0] === 1 && G.g_input_mode[0] !== 6)
    || (G.g_player_input_is_gun[1] === 1 && G.g_input_mode[1] !== 6);
}

/**
 * Whether Sight Speed is on offer: a player whose device is not a gun (the
 * keyboard, or a pad) -- `g_player_input_is_gun` 0 for either. `[port-only]`
 * as a function, as {@link CalibrationOffered}.
 */
function SightSpeedOffered(): boolean {
  return G.g_player_input_is_gun[0] === 0 || G.g_player_input_is_gun[1] === 0;
}

/**
 * `OptionsMoveCursorTask` — `FUN_00486C10`, the list's first task. Up (either
 * player) moves the cursor up a row and plays `0xA9`, stepping over Blood
 * Color unless it is shown, over Gun Calibration and Sight Speed unless each
 * is offered, and from the top to EXIT; down the same the other way, from
 * EXIT to the top. Both can happen in one frame. **Leaving either sound-test
 * row** stops the music, the voice and the SE and plays `0xA9` once more.
 * `[proved]`
 */
export function OptionsMoveCursorTask(events?: Events): void {
  const was = G.g_options_cursor;
  const calibration = CalibrationOffered();
  const sightSpeed = SightSpeedOffered();
  if (OptionsPadPressed(UP_EITHER) !== 0) {
    PlaySoundId(OPTIONS_SOUND_SELECT, events);
    G.g_options_cursor -= 1;
    const c = G.g_options_cursor;
    if (c === OptionsRow.BloodColor) {
      if (G.g_options_blood_row_shown === 0) {
        G.g_options_cursor = OptionsRow.Continue;
      }
    } else if (c === OptionsRow.GunCalibration) {
      if (!calibration) G.g_options_cursor = OptionsRow.SoundTestMusic;
    } else if (c === OptionsRow.SightSpeed) {
      if (!sightSpeed) G.g_options_cursor = OptionsRow.SightGraphic;
    } else if (c < 0) {
      G.g_options_cursor = OptionsRow.Exit;
    }
  }
  if (OptionsPadPressed(DOWN_EITHER) !== 0) {
    PlaySoundId(OPTIONS_SOUND_SELECT, events);
    G.g_options_cursor += 1;
    const c = G.g_options_cursor;
    if (c === OptionsRow.BloodColor) {
      if (G.g_options_blood_row_shown === 0) {
        G.g_options_cursor = OptionsRow.SightGraphic;
      }
    } else if (c === OptionsRow.GunCalibration) {
      if (!calibration) G.g_options_cursor = OptionsRow.Default;
    } else if (c === OptionsRow.SightSpeed) {
      if (!sightSpeed) G.g_options_cursor = OptionsRow.SoundTestSe;
    } else if (c > OptionsRow.Exit) {
      G.g_options_cursor = OptionsRow.Difficulty;
    }
  }
  if (G.g_options_cursor !== was
      && was >= OptionsRow.SoundTestSe && was <= OptionsRow.SoundTestMusic) {
    PlaySoundId(SOUND_STOP, events);
    PlaySoundId(SOUND_STOP_VOICE, events);
    PlaySoundId(SOUND_STOP_SE, events);
    PlaySoundId(OPTIONS_SOUND_SELECT, events);
  }
}

/** Where `OptionsDrawListTask` puts the title: `(344, 16)`, anchor 6. */
const TITLE_X = 344;
const TITLE_Y = 16;
/** Anchor `(2, 1)`: centred across, the top edge at y. */
const TITLE_FLAGS = 6;
/** EXIT's `(320, row*24 - 4)` (`FSUB [0x004C4CA0]`), lit, centred. */
const EXIT_X = 320;
const EXIT_DY = 4;
const EXIT_FLAGS = SCREEN_SPRITE_LIT | 0xa;

/** One row's label, at its own line or `g_options_row_shift` up. */
function DrawRowLabel(i: number, flags: number, lineOf = i): void {
  const rows = T.options?.rows;
  const row = rows?.[i];
  const line = rows?.[lineOf];
  if (!row || !line) return;
  const shift = i < OptionsRow.BloodColor ? 0 : G.g_options_row_shift;
  OptionsDrawText(row.col, line.row + shift, row.label, flags);
}

/**
 * `OptionsDrawListTask` — `FUN_00486DA0`, the list's second task. The idle
 * dimmer; background 0; "OPTIONS" at `(344, 16)`; then each of the eleven
 * rows, its label and its handler:
 *
 * * the highlighted row's label red and nearer (flags `0x111`), the rest
 *   plain (1) -- except Sight Speed, faded (9) while no player can use it;
 * * Blood Color only while shown, and at its own line;
 * * Gun Calibration only while offered, and Default on **its** line when it
 *   is not (`[0x00569720]`, row 8's record);
 * * every row below Blood Color moved by `g_options_row_shift`, which is -1:
 *   the hidden row's gap closed;
 * * EXIT is the `0x803` sprite, lit -- red when highlighted, drawn at its
 *   own line whatever the shift.
 *
 * Every row's handler runs, highlighted or not, and each draws its value.
 * `[proved]`
 */
export function OptionsDrawListTask(events?: Events): void {
  const calibration = CalibrationOffered();
  const sightSpeed = SightSpeedOffered();
  ScreenIdleDim();
  OptionsDrawBackground(0);
  DrawScreenSprite(OptionsSprite.Options, TITLE_X, TITLE_Y, 1, 1, 1,
                   TITLE_FLAGS);
  for (let i = 0; i <= OptionsRow.Exit; i++) {
    if (i < OptionsRow.Exit) {
      if (G.g_options_cursor === i) {
        if (i === OptionsRow.BloodColor) {
          if (G.g_options_blood_row_shown !== 0) {
            DrawBloodColorLabel(LABEL_HIGHLIGHTED);
          }
        } else if (i === OptionsRow.Default) {
          DrawRowLabel(i, LABEL_HIGHLIGHTED,
                       calibration ? i : OptionsRow.GunCalibration);
        } else {
          DrawRowLabel(i, LABEL_HIGHLIGHTED);
        }
      } else {
        switch (i) {
          case OptionsRow.BloodColor:
            if (G.g_options_blood_row_shown !== 0) {
              DrawBloodColorLabel(LABEL_PLAIN);
            }
            break;
          case OptionsRow.SightSpeed:
            DrawRowLabel(i, sightSpeed ? LABEL_PLAIN : LABEL_FADED);
            break;
          case OptionsRow.GunCalibration:
            if (calibration) DrawRowLabel(i, LABEL_PLAIN);
            break;
          case OptionsRow.Default:
            DrawRowLabel(i, LABEL_PLAIN,
                         calibration ? i : OptionsRow.GunCalibration);
            break;
          default:
            DrawRowLabel(i, LABEL_PLAIN);
            break;
        }
      }
    } else {
      if (G.g_options_cursor === OptionsRow.Exit) SetRenderLightColour(1, 0, 0);
      const line = T.options?.rows?.[OptionsRow.Exit]?.row ?? 0;
      DrawScreenSprite(OptionsSprite.Exit, EXIT_X,
                       line * 24 - EXIT_DY, 1, 1, 1, EXIT_FLAGS);
      SetRenderLightColour(1, 1, 1);
    }
    OPTIONS_ROW_HANDLERS[i](events);
  }
}

/**
 * Blood Color's label, both arms: its own column and line, **not** shifted
 * (`[0x005696F8]`, read straight). Unreachable in the shipped game.
 */
function DrawBloodColorLabel(flags: number): void {
  const row = T.options?.rows?.[OptionsRow.BloodColor];
  if (!row) return;
  OptionsDrawText(row.col, row.row, row.label, flags);
}

/** A value's line: its row's, moved up a line below Blood Color. */
function ValueLine(i: number): number {
  return (T.options?.rows?.[i]?.row ?? 0) + G.g_options_row_shift;
}

/**
 * `OptionsRowDifficulty` — `FUN_00487320`, row 0. Draws "Very Easy" ..
 * "Very Hard" at column 29; highlighted, right and left step the working
 * copy (`0xA9` each), which wraps 0..4 either way, and the setting is written
 * at once. `[proved]`
 */
export function OptionsRowDifficulty(events?: Events): void {
  const line = T.options?.rows?.[OptionsRow.Difficulty]?.row ?? 0;
  OptionsDrawText(29, line,
                  T.options?.difficulty_labels?.[G.g_options_edit_difficulty]
                    ?? "", 1);
  if (G.g_options_cursor !== OptionsRow.Difficulty) return;
  if (OptionsPadPressed(RIGHT_EITHER) !== 0) {
    PlaySoundId(OPTIONS_SOUND_SELECT, events);
    G.g_options_edit_difficulty += 1;
  }
  if (OptionsPadPressed(LEFT_EITHER) !== 0) {
    PlaySoundId(OPTIONS_SOUND_SELECT, events);
    G.g_options_edit_difficulty -= 1;
  }
  if (G.g_options_edit_difficulty > 4) {
    G.g_options_edit_difficulty = 0;
    G.g_option_difficulty = 0;
    return;
  }
  if (G.g_options_edit_difficulty < 0) G.g_options_edit_difficulty = 4;
  G.g_option_difficulty = G.g_options_edit_difficulty;
}

/**
 * `OptionsRowLife` — `FUN_004873E0`, row 1. The setting plus one, "1".."5"
 * (`[v*2 + 0x0056973A]`: the digit strings from "1"), at column 37; right and
 * left as Difficulty's, wrapping 0..4. `[proved]`
 */
export function OptionsRowLife(events?: Events): void {
  const line = T.options?.rows?.[OptionsRow.Life]?.row ?? 0;
  OptionsDrawText(37, line,
                  T.options?.digits?.[G.g_options_edit_lives + 1] ?? "", 1);
  if (G.g_options_cursor !== OptionsRow.Life) return;
  if (OptionsPadPressed(RIGHT_EITHER) !== 0) {
    PlaySoundId(OPTIONS_SOUND_SELECT, events);
    G.g_options_edit_lives += 1;
  }
  if (OptionsPadPressed(LEFT_EITHER) !== 0) {
    PlaySoundId(OPTIONS_SOUND_SELECT, events);
    G.g_options_edit_lives -= 1;
  }
  if (G.g_options_edit_lives >= 5) {
    G.g_options_edit_lives = 0;
    G.g_option_lives = 0;
    return;
  }
  if (G.g_options_edit_lives < 0) G.g_options_edit_lives = 4;
  G.g_option_lives = G.g_options_edit_lives;
}

/** "Free Play" is on the Continue row only with all three unlock bits. */
const FREE_PLAY_UNLOCKS = 7;

/**
 * [diverges] Free play is always on the Continue row: the row wraps 0..9 as
 * the exe's does only once `g_option_unlocks` has all three bits. By the
 * user's choice, since the port starts in free play and a player who steps
 * off it could otherwise never get back. `g_option_unlocks` is still written
 * and saved as the exe does; only {@link OptionsRowContinue}'s test ignores
 * it.
 */
const FREE_PLAY_ALWAYS_OFFERED = true;

/**
 * `OptionsRowContinue` — `FUN_004874A0`, row 2: the continues an Arcade game
 * gets, 1..9 at column 37 -- or "Free Play" at column 29 while the working
 * copy is 0. Right and left step it, and then:
 *
 * * with all three unlock bits (`g_option_unlocks & 7 == 7`) it wraps
 *   0..9, and 0 is written as -1, free play;
 * * without them it wraps **1..9**, so free play is not on offer -- and a
 *   step from a free-play profile goes to 1.
 *
 * `[proved]`. The port always takes the first arm: see
 * {@link FREE_PLAY_ALWAYS_OFFERED}.
 */
export function OptionsRowContinue(events?: Events): void {
  const unlocked = FREE_PLAY_ALWAYS_OFFERED
    || (G.g_option_unlocks & 7) === FREE_PLAY_UNLOCKS;
  const line = T.options?.rows?.[OptionsRow.Continue]?.row ?? 0;
  if (G.g_options_edit_credits === 0) {
    OptionsDrawText(29, line, T.options?.free_play ?? "", 1);
  } else {
    OptionsDrawText(37, line,
                    T.options?.digits?.[G.g_options_edit_credits] ?? "", 1);
  }
  if (G.g_options_cursor !== OptionsRow.Continue) return;
  if (OptionsPadPressed(RIGHT_EITHER) !== 0) {
    PlaySoundId(OPTIONS_SOUND_SELECT, events);
    G.g_options_edit_credits += 1;
  }
  if (OptionsPadPressed(LEFT_EITHER) !== 0) {
    PlaySoundId(OPTIONS_SOUND_SELECT, events);
    G.g_options_edit_credits -= 1;
  }
  const v = G.g_options_edit_credits;
  if (unlocked) {
    if (v > 9) {
      G.g_options_edit_credits = 0;
      G.g_option_credits = -1;
      return;
    }
    if (v < 0) {
      G.g_options_edit_credits = 9;
      G.g_option_credits = 9;
      return;
    }
    G.g_option_credits = v !== 0 ? v : -1;
    return;
  }
  if (v > 9) {
    G.g_options_edit_credits = 1;
    G.g_option_credits = 1;
    return;
  }
  if (v < 1) {
    G.g_options_edit_credits = 9;
    G.g_option_credits = 9;
    return;
  }
  G.g_option_credits = v;
}

/**
 * `OptionsRowBloodColor` — `FUN_00487250`, row 3. Only while the row is
 * shown -- which it never is: "  Red" / "Green" at column 33, and right and
 * left step 0..1 either way into `g_option_blood_color`. `[proved]`
 */
export function OptionsRowBloodColor(events?: Events): void {
  if (G.g_options_blood_row_shown === 0) return;
  const line = T.options?.rows?.[OptionsRow.BloodColor]?.row ?? 0;
  OptionsDrawText(33, line,
                  T.options?.blood_labels?.[G.g_options_edit_blood_color] ?? "",
                  1);
  if (G.g_options_cursor !== OptionsRow.BloodColor) return;
  if (OptionsPadPressed(RIGHT_EITHER) !== 0) {
    PlaySoundId(OPTIONS_SOUND_SELECT, events);
    G.g_options_edit_blood_color += 1;
  }
  if (OptionsPadPressed(LEFT_EITHER) !== 0) {
    PlaySoundId(OPTIONS_SOUND_SELECT, events);
    G.g_options_edit_blood_color -= 1;
  }
  if (G.g_options_edit_blood_color > 1) {
    G.g_options_edit_blood_color = 0;
    G.g_option_blood_color = 0;
    return;
  }
  if (G.g_options_edit_blood_color < 0) G.g_options_edit_blood_color = 1;
  G.g_option_blood_color = G.g_options_edit_blood_color;
}

/** Sight Graphic's four sprites: "1P" at 464, its crosshair at 506, ... */
const TAG_1P_X = 464;
const CROSSHAIR_1P_X = 506;
const TAG_2P_X = 544;
const CROSSHAIR_2P_X = 584;
/** ...the tags 10 below the line (`[0x004C43A4]`) and squashed to 0.7 high, */
const TAG_DY = 10;
const TAG_SY = 0.7;
/** ...the crosshairs 7 below (`[0x005644FC]`). */
const CROSSHAIR_DY = 7;
/** A player who cannot change it has theirs at half alpha. */
const SIGHT_GRAPHIC_LOCKED_ALPHA = 0.5;

/**
 * Whether player `p` can change their sight graphic: a standard controller
 * (`g_player_input_is_gun` 0 with a pad kind), or input mode 6. The row
 * draws the rest at half alpha and ignores their buttons. `[port-only]` as a
 * function; the test is the same at `0x00487615` and `0x004877BD`.
 */
function SightGraphicEditable(p: number): boolean {
  return (G.g_player_input_is_gun[p] === 0 && G.g_player_pad_kind[p] !== -1)
    || G.g_input_mode[p] === 6;
}

/**
 * `OptionsRowSightGraphic` — `FUN_004875D0`, row 4. Each player's "1P"/"2P"
 * tag and crosshair (`g_crosshair_sprites[setting + player*4]`) on the row,
 * at half alpha for a player who cannot change it. Highlighted, each player
 * who can steps their own with their own right and left (`0x80`/`0x40`,
 * `0x800000`/`0x400000`), `0xA9` a step; both wrap 0..3 and both are written
 * back. `[proved]`
 */
export function OptionsRowSightGraphic(events?: Events): void {
  const y = ValueLine(OptionsRow.SightGraphic) * 24;
  const sprites = T.options?.crosshair_sprites ?? [];
  const alpha = [0, 1].map((p) =>
    SightGraphicEditable(p) ? 1 : SIGHT_GRAPHIC_LOCKED_ALPHA);
  OptionsDrawSprite(OptionsSprite.Tag1P, TAG_1P_X, y + TAG_DY, 1, 1, TAG_SY,
                    0, alpha[0], 0);
  OptionsDrawSprite(sprites[G.g_options_edit_sight_graphic[0]] ?? -1,
                    CROSSHAIR_1P_X, y + CROSSHAIR_DY, 1, 1, 1, 0, alpha[0], 0);
  OptionsDrawSprite(OptionsSprite.Tag2P, TAG_2P_X, y + TAG_DY, 1, 1, TAG_SY,
                    0, alpha[1], 0);
  OptionsDrawSprite(sprites[G.g_options_edit_sight_graphic[1] + 4] ?? -1,
                    CROSSHAIR_2P_X, y + CROSSHAIR_DY, 1, 1, 1, 0, alpha[1], 0);
  if (G.g_options_cursor !== OptionsRow.SightGraphic) return;
  if (SightGraphicEditable(0)) {
    if (OptionsPadPressed(OptionsPad.Right) !== 0) {
      PlaySoundId(OPTIONS_SOUND_SELECT, events);
      G.g_options_edit_sight_graphic[0] += 1;
    }
    if (OptionsPadPressed(OptionsPad.Left) !== 0) {
      PlaySoundId(OPTIONS_SOUND_SELECT, events);
      G.g_options_edit_sight_graphic[0] -= 1;
    }
  }
  if (SightGraphicEditable(1)) {
    if (OptionsPadPressed(OptionsPad.Right << 16) !== 0) {
      PlaySoundId(OPTIONS_SOUND_SELECT, events);
      G.g_options_edit_sight_graphic[1] += 1;
    }
    if (OptionsPadPressed(OptionsPad.Left << 16) !== 0) {
      PlaySoundId(OPTIONS_SOUND_SELECT, events);
      G.g_options_edit_sight_graphic[1] -= 1;
    }
  }
  for (let p = 0; p < 2; p++) {
    if (G.g_options_edit_sight_graphic[p] >= 4) {
      G.g_options_edit_sight_graphic[p] = 0;
    }
    if (G.g_options_edit_sight_graphic[p] < 0) {
      G.g_options_edit_sight_graphic[p] = 3;
    }
  }
  G.g_player_sight_graphic[0] = G.g_options_edit_sight_graphic[0];
  G.g_player_sight_graphic[1] = G.g_options_edit_sight_graphic[1];
}

/**
 * `OptionsRowSightSpeed` — `FUN_004878E0`, row 5. Draws nothing of its own;
 * highlighted, A or START (either player) plays the gunshot and hands the
 * screen to the Sight Speed sub-screen. `[proved]`
 */
export function OptionsRowSightSpeed(events?: Events): void {
  if (G.g_options_cursor !== OptionsRow.SightSpeed) return;
  if ((G.g_pad_state & CONFIRM_EITHER) === 0) return;
  PlaySoundId(OPTIONS_SOUND_ENTER, events);
  G.g_options_frame = OptionsFrame.SightSpeedArm;
}

/** The two sound tests' "No." at column 32 and number at 35. */
const TEST_LABEL_COL = 32;
const TEST_NUMBER_COL = 35;

/**
 * `OptionsRowSoundTestSe` — `FUN_00487910`, row 6. "No." and the number.
 * Highlighted: the hold count ticks; right (or a right held for 30 frames)
 * steps up, left down, wrapping 0..0x2EE; and **A** (either player) loads
 * the entry's pack if it has one (`SndLoadPackStubbedOut`, a stub on the
 * PC), stops the voice and the SE, and plays the entry's id. `[proved]`
 */
export function OptionsRowSoundTestSe(events?: Events): void {
  const line = ValueLine(OptionsRow.SoundTestSe);
  OptionsDrawText(TEST_LABEL_COL, line, T.options?.number ?? "", 1);
  OptionsDrawNumber(TEST_NUMBER_COL, line, G.g_options_se_test);
  if (G.g_options_cursor !== OptionsRow.SoundTestSe) return;
  OptionsHoldRepeatTick();
  if (OptionsPadPressed(RIGHT_EITHER) !== 0
      || G.g_options_hold_repeat === HOLD_REPEAT_FRAMES) {
    G.g_options_se_test += 1;
  }
  if (OptionsPadPressed(LEFT_EITHER) !== 0
      || G.g_options_hold_repeat === -HOLD_REPEAT_FRAMES) {
    G.g_options_se_test -= 1;
  }
  if (G.g_options_se_test > SE_TEST_LAST) G.g_options_se_test = 0;
  else if (G.g_options_se_test < 0) G.g_options_se_test = SE_TEST_LAST;
  if ((G.g_pad_state & A_EITHER) === 0) return;
  // `SndLoadPackStubbedOut(pack, 0, 3)` when the entry's pack is not -1: an
  // empty function on the PC (`FUN_0041D3A0`), so nothing to do.
  PlaySoundId(SOUND_STOP_VOICE, events);
  PlaySoundId(SOUND_STOP_SE, events);
  PlaySoundId(T.options?.se_test?.[G.g_options_se_test] ?? 0, events);
}

/**
 * `OptionsRowSoundTestMusic` — `FUN_00487A50`, row 7. The same as the SE
 * test over 0..0x12, and A plays `g_options_music_test[n]` with no stop
 * first -- entry 0 is itself the music's stop, `0x80000000`. `[proved]`
 */
export function OptionsRowSoundTestMusic(events?: Events): void {
  const line = ValueLine(OptionsRow.SoundTestMusic);
  OptionsDrawText(TEST_LABEL_COL, line, T.options?.number ?? "", 1);
  OptionsDrawNumber(TEST_NUMBER_COL, line, G.g_options_music_test);
  if (G.g_options_cursor !== OptionsRow.SoundTestMusic) return;
  OptionsHoldRepeatTick();
  if (OptionsPadPressed(RIGHT_EITHER) !== 0
      || G.g_options_hold_repeat === HOLD_REPEAT_FRAMES) {
    G.g_options_music_test += 1;
  }
  if (OptionsPadPressed(LEFT_EITHER) !== 0
      || G.g_options_hold_repeat === -HOLD_REPEAT_FRAMES) {
    G.g_options_music_test -= 1;
  }
  if (G.g_options_music_test > MUSIC_TEST_LAST) G.g_options_music_test = 0;
  else if (G.g_options_music_test < 0) G.g_options_music_test = MUSIC_TEST_LAST;
  if ((G.g_pad_state & A_EITHER) === 0) return;
  PlaySoundId(T.options?.music_test?.[G.g_options_music_test] ?? 0, events);
}

/**
 * `OptionsRowGunCalibration` — `FUN_00487B50`, row 8. Nothing drawn;
 * highlighted, A or START plays the gunshot and hands the screen to the gun
 * calibration sub-screen. `[proved]`
 */
export function OptionsRowGunCalibration(events?: Events): void {
  if (G.g_options_cursor !== OptionsRow.GunCalibration) return;
  if ((G.g_pad_state & CONFIRM_EITHER) === 0) return;
  PlaySoundId(OPTIONS_SOUND_ENTER, events);
  G.g_options_frame = OptionsFrame.Calibration;
}

/**
 * `OptionsRowDefault` — `FUN_00487B80`, row 9. Highlighted, A (either
 * player) or player 1's START runs the factory reset `FUN_00401130` and takes
 * the working copies again -- difficulty, life, credits (0 for free play),
 * the unused byte, and each player's sight graphic and sight speed. Blood
 * Color's copy and the two sound tests are left as they were. No sound.
 * `[proved]`
 */
export function OptionsRowDefault(_events?: Events): void {
  if (G.g_options_cursor !== OptionsRow.Default) return;
  if ((G.g_pad_state & A_EITHER) === 0 && (G.g_pad_state & OptionsPad.Start) === 0) {
    return;
  }
  OptionsFactoryReset();
  G.g_options_edit_difficulty = G.g_option_difficulty;
  G.g_options_edit_lives = G.g_option_lives;
  G.g_options_edit_credits = G.g_option_credits === -1 ? 0 : G.g_option_credits;
  G.g_options_edit_9F28 = G.g_option_unused_9F28;
  for (let p = 0; p < 2; p++) {
    G.g_options_edit_sight_graphic[p] = G.g_player_sight_graphic[p];
    G.g_options_edit_sight_speed[p] = G.g_player_sight_speed[p];
  }
}

/**
 * `OptionsRowExit` — `FUN_00487C00`, row 10. Highlighted, A or START plays
 * `0x121A9`, saves the profile and applies it (`FUN_004011F0`), and moves the
 * screen to its last phase, which hands back to the title. `[proved]`
 */
export function OptionsRowExit(events?: Events): void {
  if (G.g_options_cursor !== OptionsRow.Exit) return;
  if ((G.g_pad_state & CONFIRM_EITHER) === 0) return;
  PlaySoundId(OPTIONS_SOUND_EXIT, events);
  ProfileSaveAndApply(events);
  G.g_nRunPhase = OptionsPhase.Leave;
}

/**
 * `g_options_rows`' handlers (`0x005696E4`, beside each row's record), by
 * row. Code, so the port's; the records are the bundle's.
 */
export const OPTIONS_ROW_HANDLERS: readonly ((events?: Events) => void)[] = [
  OptionsRowDifficulty, OptionsRowLife, OptionsRowContinue,
  OptionsRowBloodColor, OptionsRowSightGraphic, OptionsRowSightSpeed,
  OptionsRowSoundTestSe, OptionsRowSoundTestMusic, OptionsRowGunCalibration,
  OptionsRowDefault, OptionsRowExit,
];

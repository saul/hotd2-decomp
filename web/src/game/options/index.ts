/**
 * The options screen: app state `0x0C`, the title menu's OPTION row.
 *
 * `AppStateDispatch` (`FUN_004608A0`) runs `OptionsRunPhase` in it. Phase 0
 * arms the screen -- the sounds stopped, the stage released, the screen's
 * six texture banks queued, the task list built, working copies of the
 * profile's options taken -- phase 1 jumps through the frame pointer
 * `g_options_frame` every frame, and phase 2, which EXIT asks for, clears the
 * credits and hands back to the title. `[proved]`
 *
 * The frame pointer is the list (`OptionsFrameList`) or one of two
 * sub-screens the list hands the screen to: Sight Speed (row 5) and Gun
 * Calibration (row 8). **Neither is reachable in the port**, and the port
 * has their gates and not their bodies:
 *
 * * Sight Speed is for a player on a standard controller --
 *   `g_player_input_is_gun` 0 -- and the page's players are mouse guns (1):
 *   the list's cursor steps over the row, and `OptionsSightSpeedFrame`'s
 *   first test (no player with a pad kind) sends the screen straight back.
 * * Gun Calibration is for a gun **not** in PC input mode 6, and the page is
 *   mode 6 -- the mouse with the keyboard ORed into its pad word
 *   (`InputMapDevicesToMaple`, `FUN_0041E530`, whose case 6 falls into case
 *   5): the cursor steps over the row, and `OptionsCalibrationEntry`
 *   refuses. Mode 6 reads a fixed table for the mouse and never the
 *   calibration, so it could change nothing the page aims with.
 *
 * `docs/re/options-screen.md` has both bodies read in full; they land here
 * with an input model that has a keyboard crosshair or a calibrated gun.
 */
import type { Events } from "../../core/events";
import { G } from "../globals";
import { AppState } from "../globals";
import { PlaySoundId, SoundStopAll } from "../class45/rand";
import { CreditsClear } from "../game_over";
import { RequestAppState } from "../app_state";
import { ScreenIdleReset } from "../screen_idle";
import { OptionsDrawListTask, OptionsMoveCursorTask, OptionsRow } from "./list";
import { OptionsFrame, OptionsPhase, OptionsTask } from "./state";

/**
 * `OptionsTaskListCreate` — `FUN_00486BF0`, the builder `TaskListBuild`
 * runs: `ActorAlloc(OptionsMoveCursorTask, 0x34)`, then
 * `ActorAlloc(OptionsDrawListTask, 0x34)`. The list is the two, in that
 * order. `[proved]`
 */
export function OptionsTaskListCreate(): void {
  G.g_options_task_list = [OptionsTask.MoveCursor, OptionsTask.DrawList];
}

/**
 * `[port-only]` -- `TaskListWalk` over `g_options_task_list`: each task, in
 * allocation order.
 */
function OptionsTaskListWalk(events?: Events): void {
  for (const task of G.g_options_task_list) {
    switch (task) {
      case OptionsTask.MoveCursor: OptionsMoveCursorTask(events); break;
      case OptionsTask.DrawList: OptionsDrawListTask(events); break;
    }
  }
}

/** The stops `OptionsFrameList` plays when a device changes: music, voice, SE. */
const SOUND_STOP = 0x80000000;
const SOUND_STOP_VOICE = 0x80000002;
const SOUND_STOP_SE = 0x80000001;

/**
 * `OptionsFrameList` — `FUN_00486B80`, the list's frame. If either player's
 * `g_player_input_is_gun` is not what the list last saw, stop the music, the
 * voice and the SE and put the cursor on EXIT; then take both again and walk
 * the task list. `[proved]` (The decompiler stops at the first
 * `PlaySoundId`, L72; the listing runs on to `0x00486BC6`.)
 */
export function OptionsFrameList(events?: Events): void {
  if (G.g_player_input_is_gun[0] !== G.g_options_input_seen[0]
      || G.g_player_input_is_gun[1] !== G.g_options_input_seen[1]) {
    PlaySoundId(SOUND_STOP, events);
    PlaySoundId(SOUND_STOP_VOICE, events);
    PlaySoundId(SOUND_STOP_SE, events);
    G.g_options_cursor = OptionsRow.Exit;
  }
  G.g_options_input_seen = [G.g_player_input_is_gun[0],
                            G.g_player_input_is_gun[1]];
  OptionsTaskListWalk(events);
}

/**
 * `OptionsSightSpeedArm` — `FUN_004882D0`, Sight Speed's first frame: each
 * player's `g_player_pad_kind` taken, `0x009A34DC` zeroed, and for each
 * player on a standard controller (`g_player_input_is_gun` 0 with a pad
 * kind) an edit slot opened -- the crosshair seated at (-160, -120) or
 * (160, -120) in both the device and the aim record, and the sight speed
 * copied in. Then the idle count reset and the frame pointer on
 * `OptionsSightSpeedFrame`. `[proved]`
 *
 * The slot-opening arm is not ported: no player of the port is on a
 * standard controller (see the file note), so every slot is closed.
 */
export function OptionsSightSpeedArm(): void {
  G.g_sight_speed_released = [0, 0];
  G.g_sight_speed_kind_seen = [G.g_player_pad_kind[0], G.g_player_pad_kind[1]];
  // `0x009A34DC`, a word nothing in the port reads, zeroed.
  for (let p = 0; p < 2; p++) {
    if (G.g_player_input_is_gun[p] === 0 && G.g_player_pad_kind[p] !== -1) {
      // The slot-opening arm, not ported: see the file note.
      continue;
    }
    G.g_sight_speed_open[p] = 0;
  }
  ScreenIdleReset();
  G.g_options_frame = OptionsFrame.SightSpeed;
}

/**
 * `OptionsSightSpeedFrame` — `FUN_00488430`. **First**, if either player's
 * pad kind is not what the arm took, or neither player has one: back to the
 * list with the cursor on EXIT (`0x0048850A`). Otherwise the screen -- the
 * dimmer, background 1, "OPTIONS/" and "Sight Speed", each open slot's
 * crosshair moved by `PadMoveCrosshair` at its speed, B and A held to
 * raise and lower it, the sliders -- and START stores every open slot's
 * speed and goes back to the list. `[proved]`
 *
 * The port has the first test, which is the arm every port player takes;
 * the screen behind it is not ported (see the file note).
 */
export function OptionsSightSpeedFrame(): void {
  const k0 = G.g_player_pad_kind[0];
  const k1 = G.g_player_pad_kind[1];
  if (k0 !== G.g_sight_speed_kind_seen[0] || k1 !== G.g_sight_speed_kind_seen[1]
      || (k0 === -1 && k1 === -1)) {
    G.g_options_frame = OptionsFrame.List;
    G.g_options_cursor = OptionsRow.Exit;
  }
}

/**
 * `OptionsCalibrationEntry` — `FUN_00485F90`, Gun Calibration's first
 * frame. Player 1 if they hold a gun outside input mode 6, else player 2 if
 * they do: that player into `0x009A2C78` and `OptionsCalibrationArm`
 * (`FUN_00486020`). Neither: `FUN_004ABEF0(0)`, `0x009C6EF4 = 0`, and back
 * to the list with the cursor on EXIT. `[proved]`
 *
 * The port has the refusal, which is the arm every port player takes (input
 * mode 6); the arm and the calibration screen behind it are not ported (see
 * the file note).
 */
export function OptionsCalibrationEntry(): void {
  const gun = G.g_player_input_is_gun;
  const mode = G.g_input_mode;
  if (gun[0] === 1 && mode[0] !== 6) {
    G.g_calibration_player = 0;
    return;
  }
  if (gun[1] === 1 && mode[1] !== 6) {
    G.g_calibration_player = 1;
    return;
  }
  G.g_options_frame = OptionsFrame.List;
  G.g_options_cursor = OptionsRow.Exit;
}

/**
 * `OptionsRunPhase` — `FUN_004869E0`, app state `0x0C`.
 *
 * **Phase 0**, the arm: `SoundStopAll`; the job queues drained and the stage
 * released (`FUN_004A7310`, `FUN_0041D510`, `FUN_0041D540`); six texture
 * banks queued -- `scr_dc_option`, `scr_dc_common`, `scr_opt_moji05`,
 * `scr_back2`, `scr_back3`, `scr_back4` -- which the bundle already carries;
 * the task list; each player's device taken; the working copies of the
 * difficulty, life, credit (free play as 0), blood, sight graphic and unused
 * settings; the cursor on row 0, both sound tests at 0; the Blood Color row
 * hidden and the rows below it shifted up one; the idle count reset; the
 * list as the frame; phase 1.
 *
 * **Phase 1**: `JMP [g_options_frame]`.
 *
 * **Phase 2**: `CreditsClear`, the frame closed early for the load
 * (`FUN_00413CB0`, the renderer's), the screen-leave reset `FUN_0040AC10`,
 * and `RequestAppState(4)`, the title. `[proved]`
 */
export function OptionsRunPhase(events?: Events): void {
  // `[port-only]` -- the frame's screen sprites start empty: the engine
  // draws immediate-mode, and this screen's tasks are what draw them.
  G.g_screen_sprite_draws = [];
  switch (G.g_nRunPhase) {
    case OptionsPhase.Arm:
      SoundStopAll(events);
      // `FUN_0041D510`: every pol slot back to the resident set, every cam
      // file out -- nothing of the stage is left to draw.
      G.g_stage_unloaded = 1;
      OptionsTaskListCreate();
      G.g_options_input_seen = [G.g_player_input_is_gun[0],
                                G.g_player_input_is_gun[1]];
      G.g_options_edit_lives = G.g_option_lives;
      G.g_options_cursor = OptionsRow.Difficulty;
      G.g_options_edit_difficulty = G.g_option_difficulty;
      G.g_options_edit_credits = G.g_option_credits === -1
        ? 0 : G.g_option_credits;
      G.g_options_edit_blood_color = G.g_option_blood_color;
      G.g_options_edit_sight_graphic = [G.g_player_sight_graphic[0],
                                        G.g_player_sight_graphic[1]];
      // `FUN_0041D4A0(&0x009C8E30)`: the audio value's getter, which on the
      // PC prints "SS_GetAudioVal" and writes nothing.
      G.g_options_se_test = 0;
      G.g_options_music_test = 0;
      G.g_options_edit_9F28 = G.g_option_unused_9F28;
      G.g_options_blood_row_shown = 0;
      G.g_options_row_shift = -1;
      ScreenIdleReset();
      G.g_options_frame = OptionsFrame.List;
      G.g_nRunPhase = OptionsPhase.Run;
      return;
    case OptionsPhase.Run:
      switch (G.g_options_frame) {
        case OptionsFrame.List: OptionsFrameList(events); return;
        case OptionsFrame.SightSpeedArm: OptionsSightSpeedArm(); return;
        case OptionsFrame.SightSpeed: OptionsSightSpeedFrame(); return;
        case OptionsFrame.Calibration: OptionsCalibrationEntry(); return;
        // `OptionsFrame.CalibrationRun` is written only by
        // `OptionsCalibrationArm`, which is not ported.
      }
      return;
    case OptionsPhase.Leave:
      CreditsClear();
      // `FUN_00413CB0`: the frame closed early for the load that follows --
      // the renderer's, and nothing of `G`.
      ScreenLeaveReset();
      RequestAppState(AppState.Title);
      return;
    default:
      return;
  }
}

/**
 * `ScreenLeaveReset` — `FUN_0040AC10`, which seven screens call on their way
 * out: `FUN_004ABEF0(0)`, a grey to `NoOpStub`, `g_screen_frames` zeroed,
 * `CreditsClear`, `0x009C8FB4..B6` zeroed, and `FUN_0040E980` -- which zeroes
 * `g_current_bgm_id`, `0x009A1A00` and the words at `0x007C1790`. `[proved]`
 *
 * Of those, `G` has the frame count and the credits; the current BGM id is
 * the mixer's (`audio/bgm.ts`), and the rest is state nothing in the port
 * keeps.
 */
export function ScreenLeaveReset(): void {
  G.g_screen_frames = 0;
  CreditsClear();
}

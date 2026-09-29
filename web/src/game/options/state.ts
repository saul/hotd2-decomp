/**
 * The options screen's enumerations: its run phases, the routines its frame
 * pointer can hold, and its tasks.
 */

/** `OptionsRunPhase`'s `g_nRunPhase` arms. */
export enum OptionsPhase {
  /** The arm: working copies, the task list, the list's frame routine. */
  Arm = 0,
  /** `JMP [g_options_frame]`, every frame. */
  Run = 1,
  /** Credits cleared, the screen-leave reset, and back to the title. */
  Leave = 2,
}

/**
 * The routines `g_options_frame` (`0x009CA0F0`) holds, by their addresses:
 * the list, and the two sub-screens' entries and frames. Every store of the
 * pointer in `.text` is one of these five immediates (`MOV dword ptr
 * [0x009ca0f0], imm32` at `0x00486B2E`, `0x00487902`, `0x00487B72`,
 * `0x00488406`/`0x0048841D`, `0x004884FF`/`0x0048850A`, `0x00486008`,
 * `0x004863E1`, `0x00486431`, and the calibration entry's own
 * `0x00486020`..`0x00486160` pair). `[proved]`
 */
export enum OptionsFrame {
  /** `OptionsFrameList` — the list. */
  List = 0x00486b80,
  /** `OptionsSightSpeedArm` — Sight Speed's first frame. */
  SightSpeedArm = 0x004882d0,
  /** `OptionsSightSpeedFrame` — Sight Speed's every frame after it. */
  SightSpeed = 0x00488430,
  /** `OptionsCalibrationEntry` — Gun Calibration's first frame. */
  Calibration = 0x00485f90,
  /** `OptionsCalibrationFrame` — its every frame after the arm. */
  CalibrationRun = 0x00486160,
}

/**
 * The list's two tasks, by their routines' addresses, as
 * `OptionsTaskListCreate` (`FUN_00486BF0`) allocates them.
 */
export enum OptionsTask {
  /** `OptionsMoveCursorTask`. */
  MoveCursor = 0x00486c10,
  /** `OptionsDrawListTask`. */
  DrawList = 0x00486da0,
}

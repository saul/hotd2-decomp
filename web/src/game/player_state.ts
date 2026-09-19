/**
 * The player shell's three enumerations, in a module of their own.
 *
 * `[port-only]` in placement only: `globals.ts` holds `G`, which is typed by
 * these, and `player_shell.ts` builds its tables from them at load time --
 * with the enums inside `globals.ts` the two modules' import cycle evaluated
 * the tables before the enums existed. Re-exported from `globals.ts`.
 */

/**
 * `g_player_state` (`0x009A5C62`) — the per-player shell's state, and the index
 * `PlayerSetState` (`FUN_00415080`) takes into `g_player_state_handlers`
 * (`0x00579CD0`), whose entry is the routine installed in the player's task.
 * `game/player_shell.ts` ports every handler shipped play reaches.
 */
export enum PlayerState {
  /**
   * Starting a game: `PlayerStateEnterNewGame` (`FUN_00413DB0`) is
   * `PlayerEnterPlay(obj, 0)`. A start press outside app state 6 sets it.
   */
  EnterNewGame = 0,
  /**
   * Continuing: `PlayerStateEnterContinue` (`FUN_00413DE0`) lowers
   * `g_damage_rank` by one and is `PlayerEnterPlay(obj, 1)`. The start press
   * during the continue countdown sets it.
   */
  EnterContinue = 1,
  /**
   * Parked for a scene load. `AdvanceToNextScene` (`FUN_0045FFF0`) puts an
   * in-play player here, and the handler it installs,
   * `PlayerStateReenterAfterScene` (`FUN_00413E40`), is nothing but
   * `PlayerEnterPlay(obj, 2)`. `[proved]`
   */
  SceneReentry = 2,
  /**
   * Joining a game in progress: `PlayerStateEnterJoinIn` (`FUN_00413E50`)
   * clears the combo, shot and hit counts and is `PlayerEnterPlay(obj, 3)`.
   * A start press inside app state 6 sets it.
   */
  EnterJoinIn = 3,
  /**
   * Out of lives: `PlayerUpdateInPlay` (`FUN_00413E90`) sets it the frame the
   * lives reach zero, and `PlayerStateArmContinue` (`FUN_00414200`) starts
   * the continue countdown.
   */
  Continue = 4,
  /**
   * In play. `PlayerEnterPlay` (`FUN_00414770`) writes it from rows 0..3 of
   * `g_player_enter_play_modes` (`0x00579DE8`), and it is what
   * `IsPlayerAttackable` (`FUN_00409DC0`), `BatDiveUpdate` (`FUN_0042E230`),
   * `BatSwarmUpdate` (`FUN_0042ED50`) and the horde's bite test for. Its
   * handler entry is **null**: nothing installs it by state, because
   * `PlayerEnterPlay` installs `PlayerUpdateInPlay` itself. `[proved]`
   */
  InPlay = 5,
  /** The continue ran out: `PlayerStateArmGameOver` (`FUN_00414420`). */
  GameOver = 6,
  /** `PlayerStateIdle` (`FUN_00414520`) installs `NoOpStub`. */
  Idle = 7,
  /**
   * Name entry, after the ending: `PlayerStateArmNameEntry` (`FUN_00414540`).
   * Set only by `FUN_00480D90`, which the port does not reach.
   */
  NameEntry = 8,
  /**
   * Out of the game. The boot reset `FUN_0040A920` stores it for both players
   * (`0x0040AA3D`), and `CommitAppState` (`FUN_0040E860`) for both on any
   * screen but 6 and 7; `PlayerGameOverWait` (`FUN_004144C0`) ends in it.
   * Its handler `PlayerStateOut` (`FUN_004145C0`) polls for a start press.
   */
  Out = 9,
  /**
   * A start press held back: `PlayerTryStartPress` (`FUN_00414FC0`) parks the
   * requested state in `+0x48` and sets 10 while `g_screen_furniture_flags`
   * bit 0 is down, and `PlayerPendingStart` (`FUN_00414690`) applies it when the
   * bit comes up.
   */
  PendingStart = 10,
  /** `PlayerStateFireOnly` (`FUN_00414740`): ammo six and the trigger. */
  FireOnly = 11,
}

/**
 * Which routine a player's task runs -- the function pointer at `task+0`
 * that `ActorAlloc` gives it and every handler replaces. The port keeps the
 * routine's identity, not a pointer, so a snapshot can hold it. Each member
 * names the routine it stands for.
 */
export enum PlayerTask {
  /** No task: before `PlayerTasksCreate` (`FUN_00414ED0`) has run. */
  None = 0,
  /** `PlayerStateEnterNewGame` (`FUN_00413DB0`). */
  EnterNewGame,
  /** `PlayerStateEnterContinue` (`FUN_00413DE0`). */
  EnterContinue,
  /** `PlayerStateReenterAfterScene` (`FUN_00413E40`). */
  ReenterAfterScene,
  /** `PlayerStateEnterJoinIn` (`FUN_00413E50`). */
  EnterJoinIn,
  /** `PlayerStateArmContinue` (`FUN_00414200`). */
  ArmContinue,
  /** `PlayerContinueCountdown` (`FUN_00414280`). */
  ContinueCountdown,
  /** `PlayerContinueRearm` (`FUN_00414250`). */
  ContinueRearm,
  /** `PlayerUpdateInPlay` (`FUN_00413E90`). */
  InPlay,
  /** `PlayerStateArmGameOver` (`FUN_00414420`). */
  ArmGameOver,
  /** `PlayerGameOverWait` (`FUN_004144C0`). */
  GameOverWait,
  /** `NoOpStub` (`FUN_0041EBB0`), which `PlayerStateIdle` installs. */
  Idle,
  /** `PlayerStateArmNameEntry` (`FUN_00414540`). */
  ArmNameEntry,
  /** `PlayerStateOut` (`FUN_004145C0`). */
  Out,
  /** `WaitForStartPressTask` (`FUN_004145F0`), which is `PlayerPollStart`. */
  PollStart,
  /** `PlayerStateArmPendingStart` (`FUN_00414680`). */
  ArmPendingStart,
  /** `PlayerPendingStart` (`FUN_00414690`). */
  PendingStart,
  /** `PlayerStateFireOnly` (`FUN_00414740`). */
  FireOnly,
}

/**
 * `g_nRunPhase` (`0x009C90A4`) -- only the phases the port runs. The others
 * (0 `ResetGameOnStart`, 1 `AdvanceToNextScene`, 5/6 the stage step, 7 on the
 * ending) are the app's, which does them its own way; see `app/main.ts`.
 */
export enum RunPhase {
  /** `RunPhaseInPlay` (`FUN_004601D0`): a stage being played. */
  InPlay = 2,
  /** `RunPhaseContinueArm` (`FUN_004604E0`). */
  ContinueArm = 3,
  /** `RunPhaseContinueCountdown` (`FUN_00460530`). */
  ContinueCountdown = 4,
  /** `RunPhaseNoContinue` (`FUN_00460250`): out, and no credit to continue. */
  NoContinue = 11,
  /** `RunPhaseNoContinueWait` (`FUN_00460350`). */
  NoContinueWait = 12,
}

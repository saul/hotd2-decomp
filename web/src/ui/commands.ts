/**
 * What the UI can ask for.
 *
 * A closed union of plain values, and the *only* way anything in `ui/` changes
 * the world. No panel holds a reference to a layer, a system or the walker; it
 * dispatches one of these and `app/` decides what that means.
 *
 * Why a union rather than callbacks: a callback per control is what `wireUi`
 * was — sixteen anonymous listeners each reaching into a different object,
 * with no list of what the UI can do and no way to replay one. This is that
 * list, and it is exhaustively checked at the one place that handles it.
 */

/** The view toggles. One name per checkbox, so adding one is adding a case. */
export type ToggleName =
  | "allRegions" | "rails" | "aimRails" | "unported" | "stuck" | "coli"
  | "boxes" | "rigs" | "sky" | "hud" | "spawns" | "chars" | "props"
  | "breakables" | "propBoxes"
  | "muzzle" | "redBlood" | "branchPause";

export type UiCommand =
  | { kind: "toggle"; name: ToggleName; on: boolean }
  | { kind: "setStage"; stage: number }
  /**
   * Open the current stage at one of its entry blocks.
   *
   * Only stages 3 and 4 have more than one; see {@link UiProjection.entries}.
   */
  | { kind: "setEntry"; entry: number }
  | { kind: "setOriginal"; on: boolean }
  | { kind: "setMode"; mode: "play" | "free" }
  | { kind: "play" }
  | { kind: "pause" }
  /**
   * The start screen's button: play, and everything a first gesture unlocks.
   *
   * Not `play` with a flag, because what it adds is only possible *inside* a
   * gesture: a browser lets a page start audio, go fullscreen, lock the
   * orientation and ask for the motion sensors only while it is handling a
   * click or a tap, and the dispatch runs synchronously inside the one the
   * viewer made. `app/` decides which of those this device wants.
   */
  | { kind: "start" }
  | { kind: "seek"; block: number; step: number; op: number }
  | { kind: "killAll" }
  /** The sidebar's per-class "box this" checkbox. */
  | { kind: "boxClass"; cls: number; on: boolean }
  /** The sidebar's per-class fold. */
  | { kind: "foldClass"; cls: number; shut: boolean }
  /**
   * The wait panel's `box` checkbox.
   *
   * A command and not component state, because it changes something outside
   * `ui/`: the boxes drawn round the actors holding the wait. It used to be a
   * bare `<input>` in `index.html` that `publishUi` read back with
   * `$("#hl-wait").checked` once a frame -- the shell asking the DOM what the
   * user had clicked, rather than being told.
   */
  | { kind: "boxWait"; on: boolean }
  | { kind: "setLightMode"; mode: string }
  | { kind: "setFogMode"; mode: string }
  | { kind: "setFilterMode"; mode: string }
  /** The debug sidebar's 4:3 switch. See {@link UiProjection.pillarbox}. */
  | { kind: "setPillarbox"; on: boolean }
  | { kind: "setVolume"; volume: number }
  | { kind: "toggleMute" }
  /** `F`: the page fullscreen, or back. A key press is the gesture it needs. */
  | { kind: "toggleFullscreen" }
  | { kind: "requestSkip" }
  /**
   * `[port-only]` -- a new game at this stage's entry, or at stage 1, through
   * the same boot, title and START a page load runs: the game-over screen's
   * two buttons, and the menu's Restart. Not gameplay: the engine's screen
   * hands on to the next screen instead, which the port does not have.
   */
  | { kind: "restartStage" }
  | { kind: "restartFromStageOne" }
  | { kind: "takeBranch"; target: number }
  /** Hovering a route's button previews its opening shot. */
  | { kind: "previewBranch"; slot: number; frame: number }
  | { kind: "endPreview" }
  /** Hovering the branch bar stops the arcade countdown. Deciding is not a race. */
  | { kind: "branchHover"; over: boolean }
  /**
   * Open the bundle screen: which bundle is loaded, and build another.
   *
   * A command like any other, and it reaches something no other one does --
   * the export screen is its own React root over the page, in `app/install/`.
   * `ui/` may not import it and does not need to: this says what was clicked
   * and the composition root decides that it means "show that screen".
   */
  | { kind: "openBundles" };

/** What a panel is handed to talk back with. */
export type Dispatch = (c: UiCommand) => void;

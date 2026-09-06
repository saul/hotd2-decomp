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
  | "breakables" | "propBoxes" | "trackEnemies" | "shoot"
  | "muzzle" | "redBlood";

export type UiCommand =
  | { kind: "toggle"; name: ToggleName; on: boolean }
  | { kind: "setStage"; stage: number }
  | { kind: "setOriginal"; on: boolean }
  | { kind: "setMode"; mode: "play" | "step" | "free" }
  | { kind: "setSpeed"; speed: number }
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "stepForward" }
  | { kind: "stepBack" }
  /**
   * Back half a second of game time, through the snapshot ring.
   *
   * A different axis from `stepBack`, which is a *script* step: it seeks to
   * the previous instruction, which replays from the entry block and throws
   * the fight away. This puts the world back where it was, mid-fight, and is
   * the one the "it only happens after the second zombie dies" bug wants.
   * See `app/ring.ts`.
   */
  | { kind: "rewind" }
  | { kind: "reset" }
  | { kind: "seek"; block: number; step: number; op: number }
  | { kind: "scrubFrame"; frame: number; done: boolean }
  | { kind: "saveState" }
  | { kind: "loadState" }
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
  /**
   * The rigs panel's per-rig outline.
   *
   * Keyed by name rather than by index, because the list is rebuilt every
   * frame and an index would follow whatever happened to be in that position.
   */
  | { kind: "boxRig"; name: string; on: boolean }
  | { kind: "setLightMode"; mode: string }
  | { kind: "setFogMode"; mode: string }
  | { kind: "setFilterMode"; mode: string }
  | { kind: "setPillarbox"; on: boolean }
  | { kind: "setVolume"; volume: number }
  | { kind: "toggleMute" }
  | { kind: "requestSkip" }
  | { kind: "takeBranch"; target: number }
  /** Hovering a route's button previews its opening shot. */
  | { kind: "previewBranch"; slot: number; frame: number }
  | { kind: "endPreview" }
  /** Hovering the branch bar stops the arcade countdown. Deciding is not a race. */
  | { kind: "branchHover"; over: boolean };

/** What a panel is handed to talk back with. */
export type Dispatch = (c: UiCommand) => void;

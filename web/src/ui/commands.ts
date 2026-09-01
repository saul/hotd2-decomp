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
  | "breakables" | "trackEnemies" | "shoot";

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
  | { kind: "setLightMode"; mode: string }
  | { kind: "setFogMode"; mode: string }
  | { kind: "setPillarbox"; on: boolean }
  | { kind: "setVolume"; volume: number }
  | { kind: "toggleMute" }
  | { kind: "requestSkip" }
  /** Hovering the branch bar stops the arcade countdown. Deciding is not a race. */
  | { kind: "branchHover"; over: boolean };

/** What a panel is handed to talk back with. */
export type Dispatch = (c: UiCommand) => void;

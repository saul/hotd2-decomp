/**
 * Every key the page answers to, in one table.
 *
 * Three layers listen for keys, and for good reasons: `app/main.ts` owns the
 * game's (Space, Enter, R, S, the arrows, the digits), `render/freeroam.ts`
 * owns flying (WASDQE and Shift, in free roam only), and `ui/App.tsx` owns the
 * page's (the sidebar, this list, the overlays, mute, fullscreen). What none
 * of them had was one place that said what all of them do -- so the `?`
 * dialog is drawn from this, and `test:ui` reads the two other handlers'
 * source and holds them to it, both ways. A key bound without a row here, or
 * a row for a key nothing answers, fails that check rather than the viewer.
 *
 * The overlay keys are not in this file. They are a column of the toggle
 * table (`ToggleSpec.key`), which is the one owner of what a toggle is, and
 * the dialog appends them from there.
 */
import type { ToggleName } from "./commands";
import { TOGGLES } from "./panels/Toggles";

export interface Shortcut {
  /**
   * The `KeyboardEvent.code`s that do it -- what the handlers and the check
   * compare. Empty for a row that is not a key (a press on the game).
   */
  codes: readonly string[];
  /** What the key cap says. */
  cap: string;
  /** What it does. */
  what: string;
  /**
   * Who answers it. `app` is `app/main.ts`'s handler, `freeRoam` is
   * `render/freeroam.ts` (in free roam only), `ui` is `ui/App.tsx`, and
   * `pointer` is a press rather than a key.
   */
  by: "app" | "freeRoam" | "ui" | "pointer";
  /** The overlay it flips, so the dialog can say whether it is on. */
  toggle?: ToggleName;
  /** Said after `what`, dimmer: an overlay's sidebar panel. */
  note?: string;
}

export interface ShortcutGroup {
  title: string;
  rows: readonly Shortcut[];
}

const GAME: ShortcutGroup = {
  title: "Playing",
  rows: [
    { codes: [], cap: "Click", by: "pointer", what: "Shoot" },
    { codes: [], cap: "Right-click", by: "pointer",
      what: "Reload — a pull off the screen, as the arcade gun does it" },
    { codes: ["KeyR"], cap: "R", by: "app", what: "Reload" },
    { codes: ["Space"], cap: "Space", by: "app", what: "Play / pause" },
    { codes: ["Enter"], cap: "Enter", by: "app",
      what: "Skip the cutscene, where the game would allow it" },
    { codes: ["KeyS"], cap: "S", by: "app",
      what: "The pad's Start: a new game when you are out, a continue" },
    { codes: ["KeyM"], cap: "M", by: "ui", what: "Sound on / off" },
    { codes: ["KeyF"], cap: "F", by: "ui", what: "Fullscreen" },
  ],
};

const DEBUG: ShortcutGroup = {
  title: "Debugging",
  rows: [
    { codes: ["Backquote"], cap: "`", by: "ui", what: "Debug sidebar" },
    { codes: ["Digit1"], cap: "1", by: "app", what: "Play mode" },
    { codes: ["Digit2"], cap: "2", by: "app", what: "Free roam" },
    { codes: ["ArrowLeft"], cap: "←", by: "app",
      what: "Rewind half a second of game time" },
    { codes: ["Slash"], cap: "?", by: "ui", what: "This list" },
    { codes: ["Escape"], cap: "Esc", by: "ui",
      what: "Close this list, the menu or the bundle screen" },
  ],
};

const FREE_ROAM: ShortcutGroup = {
  title: "Free roam",
  rows: [
    { codes: ["KeyW", "KeyA", "KeyS", "KeyD"], cap: "W A S D", by: "freeRoam",
      what: "Fly forward, left, back, right" },
    { codes: ["KeyQ", "KeyE"], cap: "Q E", by: "freeRoam", what: "Down, up" },
    { codes: ["ShiftLeft", "ShiftRight"], cap: "Shift", by: "freeRoam",
      what: "Faster, held" },
    { codes: ["AltLeft"], cap: "Alt", by: "freeRoam", what: "Slower, held" },
    { codes: [], cap: "Click", by: "pointer",
      what: "Capture the pointer to look around; Esc lets it go" },
    { codes: [], cap: "Wheel", by: "pointer", what: "Flying speed" },
  ],
};

/** The overlays that have a key, from the toggle table. */
const OVERLAYS: ShortcutGroup = {
  title: "Debug overlays",
  rows: TOGGLES.filter((t) => t.key).map((t) => ({
    codes: [t.key as string],
    cap: keyCap(t.key as string),
    by: "ui" as const,
    what: t.label,
    toggle: t.name,
    note: t.group,
  })),
};

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] =
  [GAME, DEBUG, OVERLAYS, FREE_ROAM];

/** `KeyB` -> `B`, `Digit1` -> `1`; anything else as it is. */
export function keyCap(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code;
}

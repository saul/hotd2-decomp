/**
 * Remember the view preferences across reloads.
 *
 * The player's *addressable* state — stage, Original Mode, block/step/op,
 * camera slot and frame, all-regions — lives in the URL, deliberately: a state
 * you cannot name is a state a test cannot assert about, and a deep link is
 * worth more than a saved preference. That state already survives a reload,
 * because the URL does.
 *
 * What does not survive is the handful of controls that are pure viewing
 * preference: whether the rails are drawn, whether the dome is on, whether to
 * pillarbox. Those are not part of "where playback is", so putting them in the
 * URL would make every shared link carry someone else's overlay choices. They
 * belong in `localStorage`, per browser, and that is all this module does.
 *
 * `allRegions` is deliberately **not** saved. It is URL state, and having two
 * sources of truth for it is how a deep link ends up quietly overridden by
 * whatever the last visitor clicked.
 *
 * This used to work by writing values onto DOM controls and dispatching
 * `change`, so the ordinary handler applied them and there was only one code
 * path. The controls are React's now and there is no DOM to write to — but the
 * property is kept, and better: the restored values go back through
 * `runCommand`, which is the same path a click takes.
 */
import type { ToggleName } from "../ui/commands";

const KEY = "hod2.viewPrefs";

/** URL state, so never saved here. See the note above. */
const NOT_SAVED: ReadonlySet<ToggleName> = new Set<ToggleName>(["allRegions"]);

export interface ViewPrefs {
  toggles: Partial<Record<ToggleName, boolean>>;
  lightMode?: string;
  fogMode?: string;
  filterMode?: string;
  pillarbox?: boolean;
  speed?: number;
}

export function readViewPrefs(): ViewPrefs {
  // Private browsing and blocked site data both throw rather than return
  // empty, and a preference is never worth breaking startup over.
  try {
    const raw = window.localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object") return { toggles: {} };
    const p = v as ViewPrefs;
    return { ...p, toggles: p.toggles ?? {} };
  } catch {
    return { toggles: {} };
  }
}

export function writeViewPrefs(p: ViewPrefs): void {
  const toggles: Partial<Record<ToggleName, boolean>> = {};
  for (const [k, on] of Object.entries(p.toggles)) {
    if (!NOT_SAVED.has(k as ToggleName)) toggles[k as ToggleName] = on;
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...p, toggles }));
  } catch {
    /* quota, private mode, or site data blocked -- nothing to do */
  }
}

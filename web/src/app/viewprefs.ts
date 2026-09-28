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
 * preference: whether the rails are drawn, whether the dome is on, how the
 * scene is lit and filtered, and whether there is any sound. Those are not
 * part of "where playback is", so putting them in the URL would make every
 * shared link carry someone else's overlay choices. They belong in
 * `localStorage`, per browser, and that is all this module does.
 *
 * A browser may still hold `pillarbox` and `speed` from the old chrome, and
 * nothing reads either: `speed` went with the transport bar, and `pillarbox`
 * was written as `true` for every viewer whether or not they had touched it,
 * because it was the default and every setting saved them all. The 4:3 switch
 * is back, off by default, under a new name -- `fourByThree` -- so that an
 * old automatic `true` cannot turn it on. The next write drops both.
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
import { TOGGLES } from "../ui/panels/Toggles";

const KEY = "hod2.viewPrefs";

/**
 * What this file writes, so a reader can tell what an old save meant.
 *
 * **2**: the debug overlays start off. Every setting used to be saved whenever
 * any one changed, so a browser that had ever moved the volume holds
 * `rails: true` and `spawns: true` -- the old defaults, never chosen. Read as a
 * choice they would put the camera line and the spawn labels straight back
 * over the game, so a save from before 2 keeps its game switches and forgets
 * its overlay ones.
 */
const VERSION = 2;

/** The overlay switches, which a pre-2 save cannot be trusted about. */
const OVERLAYS: ReadonlySet<string> =
  new Set(TOGGLES.filter((t) => t.kind === "debug").map((t) => t.name));

/** URL state, so never saved here. See the note above. */
const NOT_SAVED: ReadonlySet<ToggleName> = new Set<ToggleName>(["allRegions"]);

export interface ViewPrefs {
  /** See {@link VERSION}. Absent in a save from before it existed. */
  v?: number;
  toggles: Partial<Record<ToggleName, boolean>>;
  lightMode?: string;
  fogMode?: string;
  filterMode?: string;
  /** The frame boxed to 4:3 rather than filling the window. See the note above. */
  fourByThree?: boolean;
  /**
   * Whether sound is off, and how loud it is when it is not.
   *
   * These belong here rather than in the URL for the reason the note above
   * gives: a shared link should not carry someone else's volume. But they were
   * in *neither*, so every reload came back silent at the default level and
   * the viewer had to click the speaker again — which is the one control you
   * notice being reset, because the page is quiet until you do.
   *
   * `muted` is stored rather than derived from `volume === 0`: the two are
   * different states in `Bgm`, and a viewer who muted at 80% expects 80% back.
   * It is the viewer's **choice**, and absent until they have made one: Start
   * turns the sound on for somebody who has never said, and must not for
   * somebody who said no. See `Player.mutePref`.
   */
  muted?: boolean;
  /** 0..1, as `Bgm` holds it — the slider is the one that works in percent. */
  volume?: number;
}

export function readViewPrefs(): ViewPrefs {
  // Private browsing and blocked site data both throw rather than return
  // empty, and a preference is never worth breaking startup over.
  try {
    const raw = window.localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object") return { toggles: {} };
    const p = v as ViewPrefs;
    const toggles = { ...(p.toggles ?? {}) };
    if ((p.v ?? 1) < VERSION) {
      for (const k of Object.keys(toggles)) {
        if (OVERLAYS.has(k)) delete toggles[k as ToggleName];
      }
    }
    return { ...p, toggles };
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
    window.localStorage.setItem(KEY,
                                JSON.stringify({ ...p, v: VERSION, toggles }));
  } catch {
    /* quota, private mode, or site data blocked -- nothing to do */
  }
}

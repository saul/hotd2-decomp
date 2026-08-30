/**
 * Remember the view toggles across reloads.
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
 * Restoring works by writing the saved value onto the control and then
 * dispatching `change`, so the ordinary handler in `main.ts` applies it. There
 * is deliberately no second code path: a preference that took effect by a
 * different route than a click would drift from one.
 *
 * `#stage-select`, `#original-toggle` and `#all-regions` are **not** listed
 * here. They are URL state, and having two sources of truth for them is how a
 * deep link ends up quietly overridden by whatever the last visitor clicked.
 */

const KEY = "hod2.viewPrefs";

/** The controls worth remembering, and nothing that is already URL state. */
const CONTROLS = [
  "#show-rails",
  "#show-aim",
  "#show-sky",
  "#show-rigs",
  "#show-spawns",
  "#pillarbox",
  "#light-mode",
  "#fog-mode",
  "#speed",
  "#combat",
] as const;

type Saved = Record<string, boolean | string>;

function read(): Saved {
  // Private browsing and blocked site data both throw rather than return
  // empty, and a preference is never worth breaking startup over.
  try {
    const raw = window.localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as Saved) : {};
  } catch {
    return {};
  }
}

function write(v: Saved): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* quota, private mode, or site data blocked -- nothing to do */
  }
}

function current(): Saved {
  const out: Saved = {};
  for (const sel of CONTROLS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el instanceof HTMLInputElement) out[sel] = el.checked;
    else if (el instanceof HTMLSelectElement) out[sel] = el.value;
  }
  return out;
}

/**
 * Apply the saved preferences and start recording changes.
 *
 * Call once, **after** `main.ts` has registered its `change` handlers — the
 * restore works by dispatching `change`, so the handlers must already be
 * listening or the value lands on the control and nowhere else.
 */
export function restoreViewPrefs(): void {
  const saved = read();
  for (const sel of CONTROLS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;

    const want = saved[sel];
    if (want !== undefined) {
      let changed = false;
      if (el instanceof HTMLInputElement && typeof want === "boolean") {
        changed = el.checked !== want;
        el.checked = want;
      } else if (el instanceof HTMLSelectElement && typeof want === "string") {
        // A stored value for an option that no longer exists would blank the
        // select, so only take one the markup still offers.
        const ok = [...el.options].some((o) => o.value === want);
        if (ok) {
          changed = el.value !== want;
          el.value = want;
        }
      }
      if (changed) el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    el.addEventListener("change", () => write(current()));
  }
  // Seed the store so a browser that has never saved still records the
  // defaults, which makes the next read a plain lookup rather than a merge.
  write(current());
}

/**
 * The handful of things a viewer expects to still be true after a reload.
 *
 * Which panels are folded, and nothing else of consequence. This is
 * deliberately *not* the projection: a fold changes nothing outside `ui/`, so
 * it is not a command, it never reaches `app/`, and putting it in the
 * projection would drag component state up into the composition root to
 * describe something the game does not have an opinion about.
 *
 * `localStorage`, wrapped: a browser set to block site data throws on the
 * accessor rather than returning null, and a layout preference is not worth a
 * blank page. One key per preference — see `PREFIX`.
 */
import { useCallback, useState } from "react";

/**
 * One `localStorage` entry per preference.
 *
 * It was one entry holding an object, read-modified-written on every change.
 * Two tabs open, or two panels folded in the same tick, and the second write
 * was built on a snapshot taken before the first — so the first was silently
 * undone. A key per name has no read-modify-write in it at all, which is the
 * whole fix: `setItem` on distinct keys cannot lose anything.
 */
const PREFIX = "hod2.ui.";

/**
 * The single blob that used to hold all of them, still read as a fallback.
 *
 * A viewer with folds saved under the old scheme keeps them until the first
 * time each one moves. Nothing writes here any more, so it drains rather than
 * needing a migration pass.
 */
const LEGACY_KEY = "hod2.ui";

/**
 * The stored value for `name`, or `undefined` if there is not one.
 *
 * Wrapped, because a browser set to block site data throws on the accessor
 * rather than returning null, and a layout preference is not worth a blank
 * page. Exported for `test:ui`, which is where the last-writer-wins case is
 * pinned.
 */
export function readPersisted(name: string): unknown {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    if (raw !== null) return JSON.parse(raw) as unknown;
    const legacy = localStorage.getItem(LEGACY_KEY) ?? "{}";
    const all = JSON.parse(legacy) as Record<string, unknown>;
    return name in all ? all[name] : undefined;
  } catch {
    return undefined;             // first run, private window, or blocked
  }
}

export function writePersisted(name: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch { /* ignore */ }
}

/**
 * `useState`, remembered under `name`.
 *
 * Read once, on the first render of the component that asks — so two panels
 * never race each other for the key, and a value written by one is picked up
 * by the next mount rather than pushed at whoever is already listening.
 */
export function usePersisted<T>(name: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readPersisted(name);
    return stored === undefined ? initial : stored as T;
  });
  const set = useCallback((next: T) => {
    setValue(next);
    writePersisted(name, next);
  }, [name]);
  return [value, set];
}

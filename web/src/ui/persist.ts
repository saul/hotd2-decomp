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
 * blank page.
 */
import { useCallback, useState } from "react";

const KEY = "hod2.ui";

function readAll(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};                    // first run, private window, or blocked
  }
}

function writeOne(name: string, value: unknown): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [name]: value }));
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
    const all = readAll();
    return name in all ? all[name] as T : initial;
  });
  const set = useCallback((next: T) => {
    setValue(next);
    writeOne(name, next);
  }, [name]);
  return [value, set];
}

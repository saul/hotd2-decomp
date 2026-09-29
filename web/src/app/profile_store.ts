/**
 * The profile, kept where the browser keeps things.
 *
 * The exe keeps its profile in four files it disguises as game data and
 * writes on the options' EXIT, the Original Mode game over and a few more
 * (`ProfileSave`, `FUN_004A0BD0`), and reads once at boot (`ProfileLoad`,
 * `FUN_004A0B60`). `game/profile.ts` is both routines' logic, with the file
 * half replaced by a `profile.save` event and an argument; this is the file
 * half: one `localStorage` key, JSON, per origin.
 *
 * `[port-only]`, all of it. What it stores is the port's `ProfileBlock` --
 * the options, the unlocks, each player's record, the saved Original items --
 * not the exe's `0xF4C` bytes: the rest of that block is the rankings and the
 * grades of modes the port does not have. The exe's byte sum and version are
 * its check that the files read back whole; here a parse that fails, a
 * missing key or another store version is a profile with nothing saved, which
 * `ProfileLoad` resets and `ProfileBoot` starts in free play.
 *
 * Storage can be blocked -- a private window, site data off -- and every
 * access is wrapped: the page then plays exactly as it does with nothing
 * saved, and an EXIT simply does not persist.
 */
import type { ProfileBlock } from "../game/profile";

/** The key, beside the page's other `hod2.` preferences. */
export const PROFILE_KEY = "hod2.profile";
/**
 * The layout of what is stored, not the exe's version byte (which travels
 * inside the block): a change to `ProfileBlock`'s shape bumps it, and an
 * older store is then a profile with nothing saved.
 */
const STORE_VERSION = 1;

/** What the page saved last, or null. */
export function readProfile(): ProfileBlock | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { v?: number; profile?: ProfileBlock };
    return v?.v === STORE_VERSION && v.profile ? v.profile : null;
  } catch {
    // not-a-loss: storage blocked or a store that will not parse is a
    // profile with nothing saved, which is what the caller then boots.
    return null;
  }
}

/** Keep `profile`, if the browser lets the page keep anything. */
export function writeProfile(profile: ProfileBlock): void {
  try {
    localStorage.setItem(PROFILE_KEY,
                         JSON.stringify({ v: STORE_VERSION, profile }));
  } catch {
    // not-a-loss: storage blocked; the setting holds for this page's life
    // in `G` and is simply not there next time, as with nothing saved.
  }
}

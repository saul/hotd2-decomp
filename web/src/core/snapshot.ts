/**
 * The save state.
 *
 * `world.save()` returns a plain JSON value that fully determines the next
 * frame; `world.load()` makes the running player identical to the moment it
 * was taken. See docs/PLAYER_ARCHITECTURE.md, "Saving and restoring the whole
 * game state", for the six rules that make that true.
 */

/**
 * Bumped whenever any system's slice changes shape. An older snapshot is
 * refused rather than half-applied — a partially restored actor list is a
 * crash that looks like a gameplay bug.
 */
export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
  version: number;
  /** The stage it was taken against; loading into another one is refused. */
  stage: number;
  /** 60 Hz frames since the stage loaded. */
  frame: number;
  /** The world RNG's state word. */
  rng: number;
  /** System id -> that system's slice. */
  parts: Record<string, unknown>;
}

/** Why a snapshot was refused, or null if it is loadable here. */
export function snapshotRefusal(s: Snapshot, stage: number): string | null {
  if (!s || typeof s !== "object") return "not a snapshot";
  if (s.version !== SNAPSHOT_VERSION) {
    return `snapshot version ${s.version}, this build reads ${SNAPSHOT_VERSION}`;
  }
  if (s.stage !== stage) {
    return `snapshot is from stage ${s.stage}, stage ${stage} is loaded`;
  }
  return null;
}

/**
 * A deep copy of plain data.
 *
 * `structuredClone` is exactly the right contract: it throws on a function, a
 * DOM node or a three.js object, so a system that leaks a live reference into
 * its slice fails here rather than producing a snapshot that aliases the
 * running state and silently does nothing.
 */
export function clonePlain<T>(v: T): T {
  return structuredClone(v);
}

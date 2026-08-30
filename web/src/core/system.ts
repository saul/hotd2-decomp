import type { PerspectiveCamera, Scene } from "three";
import type { Events } from "./events";
import type { Rng } from "./rng";

/**
 * What every system is handed. Built once per stage load and passed to every
 * call, so nothing has to capture anything.
 */
export interface Context {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly events: Events;
  /** The world's seeded generator. The only random source in the player. */
  readonly rng: Rng;
  /** Which stage is loaded — the snapshot is keyed on it. */
  stage: number;
  /** 60 Hz frames since the stage loaded. */
  frame: number;
}

/** One tick's worth of time, already scaled by speed and gated by freeze. */
export interface Tick {
  /** Seconds of game time. Zero while frozen. */
  dt: number;
  /** Whole 60 Hz frames the script advanced this tick. */
  frames: number;
  /** Wall-clock seconds, for feedback that should keep moving when paused. */
  wall: number;
  frozen: boolean;
}

/**
 * A layer of the player.
 *
 * Everything is optional except the id, because most layers only do one of
 * these things. `save`/`load` are what put a layer in the snapshot; a layer
 * without them contributes nothing and is expected to rebuild itself in
 * `resync`.
 */
export interface System {
  /** Unique, stable, and the key its slice takes in a snapshot. */
  readonly id: string;
  attach?(ctx: Context): void;
  update?(ctx: Context, t: Tick): void;
  detach?(ctx: Context): void;
  /** This system's slice of the save state. Plain JSON data only. */
  save?(): unknown;
  /** Restore that slice. Called before `resync`. */
  load?(slice: unknown, ctx: Context): void;
  /**
   * Rebuild whatever is derived from game state. Called on every system after
   * a load, in tick order, so a renderer can re-pose from the restored actors.
   */
  resync?(ctx: Context): void;
}

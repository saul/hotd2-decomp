import type { PerspectiveCamera, Scene } from "three";
import type { Walker } from "../script/walker";
import type { Scope } from "./scope";
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
  /**
   * The script, and through it everything the stage's own program decides:
   * the spawn list, the flags, the fog and light ramps, the camera command.
   *
   * Null until the first stage load. Every render layer reads it and none
   * writes it — the walker is stepped by `app/loop.ts`, which is the one
   * thing that gets to decide when a tick stops.
   */
  walker: Walker | null;
  /**
   * The stage's disposal scope: everything a layer builds in `attach`/`build`
   * and must give back when the stage is torn down.
   *
   * A layer that registers here needs no `detach` of its own. What goes in it
   * is the same set as what `resync` must be able to rebuild — see
   * `core/scope.ts` for why that is one rule and not two.
   */
  scope: Scope;
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
 * A tick that advances nothing.
 *
 * What `resync` hands a layer whose `update` is already the whole of its
 * rebuild: the state has been restored underneath it and it should place
 * itself against that state without moving any clock of its own.
 */
export const IDLE_TICK: Tick =
  { dt: 0, frames: 0, wall: 0, frozen: true };

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

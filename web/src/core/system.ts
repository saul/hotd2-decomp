import type { Walker } from "../script/walker";
import type { CameraFrame } from "./camera";
import type { Scope } from "./scope";
import type { Events } from "./events";
import type { Rng } from "./rng";

/**
 * What every system is handed. Built once per stage load and passed to every
 * call, so nothing has to capture anything.
 *
 * **No renderer.** There is no scene and no camera here, which is what makes
 * the engine's half of the player runnable with no browser at all. `render/`
 * widens this to a `RenderContext` — see `render/context.ts` — and `System`
 * is generic over which of the two a layer needs, so a layer that asks for
 * the wider one says so in its signature.
 */
export interface Context {
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
  /**
   * Everything a **seek or a snapshot load** rebuilds, as opposed to a stage
   * switch. Recycled by `app/` immediately before `World.load` runs its
   * `resync` pass, and again on a seek.
   *
   * This is the structural half of the rig bug step 8 fixed by hand: state
   * that describes *how the game got where it is* rather than where it is
   * cannot survive a seek, and anything registered here cannot survive one
   * either. A layer that keeps such state anywhere else is relying on
   * somebody remembering to reset it.
   */
  session: Scope;
  /**
   * Where the camera is, as plain numbers — see `core/camera.ts`.
   *
   * Filled in by `render/` from the camera it last drew with, and read by the
   * port. It is *not* a `Camera`: naming one here would put three.js in the
   * type every system declares, and the engine's half of the player would
   * stop being runnable without a browser.
   */
  readonly view: CameraFrame;
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
export interface System<C extends Context = Context> {
  /** Unique, stable, and the key its slice takes in a snapshot. */
  readonly id: string;
  attach?(ctx: C): void;
  update?(ctx: C, t: Tick): void;
  detach?(ctx: C): void;
  /** This system's slice of the save state. Plain JSON data only. */
  save?(): unknown;
  /** Restore that slice. Called before `resync`. */
  load?(slice: unknown, ctx: C): void;
  /**
   * Rebuild whatever is derived from game state. Called on every system after
   * a load, in tick order, so a renderer can re-pose from the restored actors.
   */
  resync?(ctx: C): void;
}

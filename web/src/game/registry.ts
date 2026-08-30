/**
 * `g_class_handlers` — 0x009A2280, built by `BuildClassHandlerTable`
 * (`FUN_0040AC90`) from the pairs at `g_class_handler_pairs`.
 *
 * **A class with no entry gets no behaviour.** That is the whole reason this
 * is a table rather than a chain of `if`s: the cat is class 0x53, the
 * civilians 0x10, the scripted humanoids 0x25, and running class 0x30's state
 * machine over all of them is what had the cat walking at the player. Reading
 * a new class means adding a module and one row here, and until then that
 * class keeps its looping motion and stays where the script put it.
 */
import type { Events } from "../core/events";
import type { Rng } from "../core/rng";
import type { Actor } from "./actor";
import type { GameHost } from "./host";
import { SpawnClass } from "./spawn_class";
import type { Vec3 } from "./vec";
import { EnemyZombieInit, EnemyZombieUpdate } from "./class30";
import { EnemyThrowerInit, EnemyThrowerUpdate } from "./class31/thrower";

export interface ClassFrame {
  eye: Vec3;
  dt: number;
  rng: Rng;
  host: GameHost;
  events?: Events;
}

export interface ClassHandler {
  /** The class's `Init` — what the spawn opcode's constructor leaves behind. */
  init(obj: Actor): void;
  /** The class's `Update` — one call per 60 Hz frame. */
  update(obj: Actor, f: ClassFrame): void;
}

export const g_class_handlers: Partial<Record<SpawnClass, ClassHandler>> = {
  [SpawnClass.Zombie]: {
    init: EnemyZombieInit,
    update: (o, f) => EnemyZombieUpdate(o, f.eye, f.dt, f.rng, f.events),
  },
  [SpawnClass.Thrower]: {
    init: EnemyThrowerInit,
    update: (o, f) => EnemyThrowerUpdate(o, f.eye, f.dt, f.host, f.events),
  },
};

/** The classes with a ported behaviour, for the UI and `verify_port.py`. */
export const PORTED_CLASSES: SpawnClass[] =
  Object.keys(g_class_handlers).map(Number);

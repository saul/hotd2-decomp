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
import { PropContainerPlacerHandler } from "./class41";
import { Class44PlacerHandler } from "./class44";
import { SetPiecePropHandler } from "./class24";
import { ScriptedHumanoidHandler } from "./class25";

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
    update: (o, f) => EnemyZombieUpdate(o, f.eye, f.dt, f.rng, f.host, f.events),
  },
  [SpawnClass.Thrower]: {
    init: EnemyThrowerInit,
    update: (o, f) => EnemyThrowerUpdate(o, f.eye, f.dt, f.host, f.events),
  },
  // A placer, not an actor: it builds its children and kills itself on its
  // first frame. It draws nothing, so it needs no renderer.
  [SpawnClass.PropContainerPlacer]: PropContainerPlacerHandler,
  // Same shape: a placer that builds and dies. Only selector 16 is ported.
  [SpawnClass.PropPlacer]: Class44PlacerHandler,
  // A skinned actor choreographed against the camera, not an enemy.
  [SpawnClass.SetPieceProp]: SetPiecePropHandler,
  // A bytecode VM driving a skinned character. Not an enemy.
  [SpawnClass.ScriptedHumanoid]: ScriptedHumanoidHandler,
};

/**
 * The classes whose handler increments `g_enemies_alive`.
 *
 * The counter is not "how many actors are on screen": each class's own handler
 * decides whether it is an enemy, and most do not. `spawns.md` proves the set
 * from the handlers — 0x30 and 0x31 increment it, 0x43 and the 0x11/0x14/0x19/
 * 0x32 group increment both counters, and 0x51 is a damageable water enemy.
 * A civilian, a scripted humanoid, the cat and a set-piece do not.
 *
 * This matters because `wait_enemies_alive` blocks the script until the count
 * falls: anything wrongly counted here is a stage that never continues. It
 * started mattering the moment class 0x24 was ported, because that put 21
 * animated non-enemies into stage 2's object list.
 */
export const ENEMY_CLASSES: ReadonlySet<number> = new Set([
  SpawnClass.Zombie, SpawnClass.Thrower, SpawnClass.FlyingEnemy,
  SpawnClass.WaterEnemy,
]);

/** Whether this actor is one the enemy counters count. */
export function ActorIsEnemy(cls: number): boolean {
  return ENEMY_CLASSES.has(cls);
}

/** The classes with a ported behaviour, for the UI and `verify_port.py`. */
export const PORTED_CLASSES: SpawnClass[] =
  Object.keys(g_class_handlers).map(Number);

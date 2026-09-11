/**
 * `g_class_handlers` — 0x009A2280, built by `BuildClassHandlerTable`
 * (`FUN_0040AC90`) from the pairs at `g_class_handler_pairs`.
 *
 * **A class with no entry gets no behaviour.** That is the whole reason this
 * is a table rather than a chain of `if`s: the cat is class 0x53, the
 * civilians 0x10, the scripted humanoids 0x25, and running class 0x30's state
 * machine over all of them is what had the cat walking at the player. Reading
 * a new class means adding a module and one `registerClass` call in it, and
 * until then that class keeps its looping motion and stays where the script
 * put it.
 *
 * ## This file knows nothing about any class
 *
 * It holds the contracts and the empty table; each class module fills its own
 * row. That direction is not taste. When the table was built here, `registry`
 * had to import every class module, so a class module that needed anything
 * from `registry` — the `ClassHandler` type, `ActorIsEnemy` — closed a cycle,
 * and ESM resolves a cycle by handing out whatever the half-evaluated module
 * has, which for a `const` table is `undefined`. That has cost this project an
 * hour three separate times, in `class41/pool.ts`, in `class44/index.ts` and
 * in `director.ts`, each time as *the class simply never ran and nothing said
 * why*. Registration inverts the edge: every class module points at this one
 * and nothing points back.
 *
 * The side-effect imports that make the modules evaluate at all live in
 * `game/classes.ts`, which is the one place the set of ported classes is
 * written down.
 */
import type { Events } from "../core/events";
import type { Rng } from "../core/rng";
import type { Actor } from "./actor";
import type { GameHost } from "./host";
import { SpawnClass } from "./spawn_class";
import type { Vec3 } from "./vec";

/**
 * The half of a spawn record {@link ClassHandler.raisesScriptFlag} is given.
 *
 * Both spawn opcodes' records satisfy it. `spawn_placed`'s carries a script
 * address; `spawn_simple`'s (`EvtOpSpawnSimple0A`) does not, and that is not a
 * gap in this type — a two-word `{class, hp}` record has no address for a
 * placement table to be keyed on, so a class placed that way can only ever
 * answer from its class.
 */
export interface SpawnRecord {
  class: number;
  hp: number;
  at?: number;
}

export interface ClassFrame {
  eye: Vec3;
  dt: number;
  rng: Rng;
  host: GameHost;
  events?: Events;
}

/**
 * What a class says about one of its actors, for the debug sidebar.
 *
 * The sidebar used to know how a zombie and a civilian each store their state,
 * which meant it only ever described the two classes someone had bothered to
 * teach it, and it drifted the moment either changed. Asking the class instead
 * puts the description next to the code it describes: a class that has been
 * ported explains itself, and one that has not says nothing rather than being
 * guessed at from the outside.
 */
export interface ActorDebug {
  /** One line, in the class's own vocabulary — its state, not a category. */
  summary: string;
  /** Detail beneath it. One short line each; omit rather than pad. */
  detail?: string[];
  /** Worth calling out: holding a permit, blocked, parked. */
  hot?: boolean;
}

/**
 * Why `GameUpdate`'s sweep has reached this actor.
 *
 * [port-only] The engine has no sweep at all: all 171 `ActorDespawn`
 * (`FUN_00409CC0`) references are inside a class's own state machine, so an
 * object gives its counts and its permit back on the way out and nothing has
 * to come along afterwards. The port reaches a despawn by routes the engine
 * does not have — `RetireUnlistedActor`, a class whose death states are not
 * ported — so it needs the backstop, and the backstop has to know *which* of
 * the three ways an actor is leaving. See {@link ActorDespawn}'s file.
 */
export enum DeadSweep {
  /** `ActorDespawn` has taken it out of the pool this frame. */
  Despawned = 0,
  /** Its hit points ran out and it is still in the pool. */
  Dead = 1,
  /** Not drawn: the character layer has not loaded it, or has taken it away. */
  Unloaded = 2,
}

export interface ClassHandler {
  /**
   * The class's `Init` — what the spawn opcode's constructor leaves behind.
   *
   * `rng` is optional because most Inits do not draw: the ones that do — class
   * 0x24's phase seed, class 0x10's weighted pick of what a civilian is
   * holding — call `rand()` in the engine too, and a draw that is not from
   * `ctx.rng` is a save state that does not restore.
   *
   * `events` is optional for the same reason and is here because one `Init` in
   * the engine makes a **sound**: `EnemyZombieInitByCharType` (`FUN_00452FD0`)
   * starts the looping chainsaw or laser sword for character types 2 and 3.
   * An `Init` that draws or plays declares it by taking the parameter; the
   * eight that do neither still satisfy this type, because a function of fewer
   * arguments is assignable to one of more.
   */
  init(obj: Actor, rng?: Rng, events?: Events): void;
  /**
   * The class's `Update` — one call per 60 Hz frame.
   *
   * One calling convention, and it is this one. Class 0x30 and 0x31 used to be
   * adapted in the table — `(o, f) => EnemyZombieUpdate(o, f.eye, f.dt, ...)`
   * — which meant the table held a closure for two classes and the function
   * itself for the other five, and a reader had two shapes to keep straight
   * for no gain. `ClassFrame` goes all the way down instead.
   */
  update(obj: Actor, f: ClassFrame): void;
  /**
   * Keep ticking this class after it dies.
   *
   * Most classes die into a clip the renderer plays out, so the director stops
   * updating them and nothing is lost. **Class 0x31's death is four states** —
   * the fall, the death clip, the corpse and the despawn — so stopping would
   * freeze a body in mid-air the moment its hit points ran out.
   */
  updatesWhenDead?: boolean;
  /**
   * Can this actor be hurt at all, right now?
   *
   * Class 0x10's answer is `sub.onShotScript < 0` — a civilian with no on-shot
   * script has its hit bits cleared every frame by `CivilianCheckShot`, which
   * is how the ones behind glass work. **The debug clear has to ask**, because
   * killing one of those strands it: it is dead, it is still counted in
   * `g_civilians_alive`, and it has no killed script to run the
   * `LeaveCountNow` that would take it out. `wait_scripted_actors` then holds
   * for ever on an actor no player could have touched.
   */
  invulnerable?(obj: Actor): boolean;
  /**
   * The class's own **leave the field** routine, ending in `ActorDespawn`.
   *
   * `ZombieReleaseAndDespawn` (`FUN_00455490`) for class 0x30 and
   * `ThrowerLeave` (`FUN_0044AD60`) for 0x31 are the engine's, and they are
   * the same shape: retire from the alive count, then the present count,
   * release the attack permit, clear the camera-tracking slot, despawn. Class
   * 0x10 does it inline at the bottom of `CivilianUpdate` (`FUN_0048A920`)
   * instead of in a function of its own.
   *
   * A class with no entry here has no such routine and gets a bare
   * `ActorDespawn` — which is what the engine gives it too.
   */
  leave?(obj: Actor): void;
  /**
   * What this class gives back when the sweep finds one of its actors dead,
   * undrawn or despawned.
   *
   * The same argument as {@link debug}, for the other end of an actor's life.
   * The sweep used to test `obj.cls === SpawnClass.Thrower` twice from the
   * outside — once to pick between `ReleaseEnemyAliveCount` and
   * `ThrowerRetireFromAliveCount`, once to pick which bit of which flags word
   * holds the off-screen permit latch — because those are the two facts the
   * two classes disagree about, and both are the *class's* business. A class
   * that has been ported knows what it holds; one that has not should not be
   * guessed at from a `switch` in `director.ts`.
   *
   * A class with no entry gets the generic teardown in `despawn.ts`, which is
   * the one thing that can be said about a class nobody has read: an unported
   * class never claims a permit, because it has no update to claim one with.
   */
  onDeadSweep?(obj: Actor, why: DeadSweep): void;
  /**
   * This class reads `obj+0x34` bit 3 itself, so a shot must **not** go
   * through `ResolveHit`.
   *
   * `MarkActorShot` (`FUN_00404DB0`) is all the engine's shot test ever does:
   * it raises bit 3 and the bit naming the shooter, and the actor's own update
   * decides what that means. For class 0x30 and 0x31 that leads to
   * `ResolveHit` and a damage table; for a class-0x10 civilian it leads to a
   * life, two hundred points and the on-shot script, and running the zombie's
   * damage table over one would charge it hit points it does not have and swap
   * gore models it has none of.
   */
  ownsShotResult?: boolean;
  /**
   * The `g_script_flags` byte an actor made from one spawn record raises, if
   * it raises one.
   *
   * **Not a mechanism — a declaration.** The class raises the flag itself, in
   * its own update, exactly where the engine does; this says *that it can*, so
   * that `script/waits/flag.ts` can tell a `wait_script_flag` gate this port
   * is able to open from one it is not. Fourteen of the game's forty-odd gates
   * are opened by an actor rather than by `set_script_flag`, and a gate whose
   * writer has no module is a gate that would park the stage for ever.
   *
   * Only for classes whose flag is a **literal in the routine** rather than a
   * field of the descriptor: class 0x60's 248 and class 0x61's 254 are, and
   * `ZombieStateTargetScriptWithFlag`'s is not — that one comes off the
   * captor's script entry and the bundle carries it, so it is read from the
   * data instead.
   *
   * ## Why a class may answer with a number, a list, or a function
   *
   * All three shapes are here because three different classes need them.
   *
   * A plain **number** says *every* actor of this class raises that flag,
   * which is true of the cards.
   *
   * A **list** because one class can name several: class 0x14 writes nine —
   * 10 through 17 and 31 — out of twelve instructions spread over its state
   * machine, and which one an actor reaches depends on the phase its
   * descriptor put it in. That is a declaration about the class, so it names
   * all of them.
   *
   * A **function** because for class 0x41 it is not a property of the class
   * at all. `PropContainerPlacerUpdate` (`FUN_00461CD0`) dispatches on the
   * record's own `+0x130C` to one of 79 constructors, and only the object one
   * of them builds — `PropUpdateType75` (`FUN_004710C0`) — writes
   * `g_script_flags[20]`. There are 441 class-0x41 spawns across the six
   * stages and exactly **one** of them is that object, so a class-wide answer
   * would tell every stage with any prop in it that flag 20 was coming. The
   * function is handed the spawn record and answers for that record, which is
   * the same question the engine's own dispatch asks.
   */
  raisesScriptFlag?: number | readonly number[]
                   | ((rec: SpawnRecord) => number | readonly number[]
                                          | undefined);
  /**
   * Describe one of this class's actors for the debug sidebar.
   *
   * Optional, and read-only by contract: it runs every frame the panel is
   * open, so it must not draw from `rng`, advance a clock or touch `G`.
   */
  debug?(obj: Actor): ActorDebug;
}

/**
 * The table itself. Empty at module evaluation; each class module fills its
 * own row through {@link registerClass}.
 */
export const g_class_handlers: Partial<Record<SpawnClass, ClassHandler>> = {};

/**
 * Put one class in the table.
 *
 * [port-only] The engine builds the whole table in one pass —
 * `BuildClassHandlerTable` (`FUN_0040AC90`) walks the `{id, handler}` pairs at
 * `g_class_handler_pairs` and writes them into `g_class_handlers` — so there
 * is no per-class registration routine to port. This is that walk turned
 * inside out, one pair at a time, from the module that owns the pair.
 *
 * **A second registration for a class is an error, loudly.** The engine's
 * table is written once from a static array and cannot have the problem; a
 * pile of side-effect imports can, and a row silently overwritten by a second
 * module is a class whose behaviour depends on module evaluation order — which
 * is the failure this whole arrangement exists to make impossible.
 */
export function registerClass(cls: SpawnClass, handler: ClassHandler): void {
  if (g_class_handlers[cls] !== undefined) {
    throw new Error(`class 0x${cls.toString(16).toUpperCase()} `
      + `(${SpawnClass[cls] ?? "?"}) is registered twice`);
  }
  g_class_handlers[cls] = handler;
}

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
 *
 * It is a literal set and not a scan of {@link g_class_handlers} on purpose:
 * four of the five classes in it have no module, so a table-derived answer
 * would leave them out and open every gate they are supposed to hold.
 */
export const ENEMY_CLASSES: ReadonlySet<number> = new Set([
  SpawnClass.Zombie, SpawnClass.Thrower, SpawnClass.FlyingEnemy,
  SpawnClass.WaterEnemy, SpawnClass.Frog,
]);

/** Whether this actor is one the enemy counters count. */
export function ActorIsEnemy(cls: number): boolean {
  return ENEMY_CLASSES.has(cls);
}

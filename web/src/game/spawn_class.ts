/**
 * The spawn classes, as `g_class_handler_pairs` (0x00593358) names them.
 *
 * Every class whose handler has actually been read has a member here, whether
 * or not the port implements it — naming a class costs nothing and `0x53` in
 * a registry key is exactly the kind of thing that ends up applied to the
 * wrong actor. The table and its evidence are docs/formats/spawns.md.
 *
 * A member here does **not** mean there is behaviour: `game/registry.ts` is
 * the list of classes that actually do something, and everything else keeps
 * its looping motion and stays where the script put it.
 */
export enum SpawnClass {
  /** `FUN_0048A3E0` — civilian / rescuable victim. Shooting one costs a life. */
  Civilian = 0x10,
  /**
   * `Class14Init` (`FUN_00475E90`) — **the stage-2 boss**, character type
   * `0x47` = `boss2.bin`, and the only class in the game with twelve
   * `g_script_flags` writers of its own. Five spawns: stage 2 blocks 35, 37,
   * 39 and 41 (four alternative endings, one per route) and stage 5 block 3.
   * Ported (`game/class14/`).
   */
  Boss2 = 0x14,
  /**
   * `Boss4Init` (`FUN_004917E0`) — **the stage-4 boss**, character type `0x4A`
   * (`boss4.bin`, 15 nodes), 300 hit points, four spawns and no others in the
   * game. Its descriptor tail carries fifteen per-bone model pointers, one per
   * node, and its entrance index picks one of four states. It increments both
   * enemy counters, and it is the only writer of `g_script_flags[31]` in
   * stage 4 and the only writer of `g_script_flags[32]` in the game.
   */
  Boss4 = 0x19,
  /** `FUN_00441750` — row spawner for floating props. */
  FloatingPropRow = 0x15,
  /** `FUN_00442290` — creates the water-wave field and records its plane Y. */
  WaterWaveField = 0x16,
  /**
   * `FUN_004422D0` — one wave source on the 0x16 field. `obj+0x11C` selects
   * travelling or circular; amplitude, wavelength and speed come off its tail.
   */
  WaterWaveSource = 0x17,
  /**
   * `OneHitTargetInit` (`FUN_00448ED0`) — a skinned actor that dies to any one
   * hit and pays 80 for it. Not an enemy: its Init increments no counter.
   * **Ported.**
   */
  OneHitTarget = 0x20,
  /**
   * `FUN_00451720` — enemy with **rank-scaled hit points**: `obj+0x11C` is
   * overwritten from the table at `0x00565F0C`, 1 or 2 by difficulty rank.
   */
  RankScaledEnemy = 0x21,
  /** `FUN_0049B0D0` — enemy with four behaviour variants and a companion. */
  VariantEnemy = 0x22,
  /** `FUN_004329D0` — path-riding vehicle; swaps model and lights a flame. */
  PathRidingVehicle = 0x27,
  /** `FUN_00432610` — path-riding prop. */
  PathRidingProp = 0x28,
  /** `FUN_00482CE0` — scripted non-combat set-piece prop. */
  SetPieceProp = 0x24,
  /** `FUN_004840D0` — script-driven humanoid actor. Not an enemy. */
  ScriptedHumanoid = 0x25,
  /** `Class26InstallSubtypeUpdate` (`FUN_0048E290`) — the vehicle-and-scenery family. */
  Vehicle = 0x26,
  /** `FUN_00432C80` — static scenery batch. */
  SceneryBatch = 0x29,
  /** `FUN_00432D40` — the handler is `JMP ActorKill`. It dies on sight. */
  DeadClass = 0x2a,
  /** `FUN_00438060` — scripted dynamic light source. */
  DynamicLight = 0x2b,
  /** `FUN_00426A70` — large multi-part creature. */
  LargeCreature = 0x2d,
  /** `EnemyZombieInit` (`FUN_00452DA0`) — the zombie. Ported. */
  Zombie = 0x30,
  /** `EnemyThrowerInit` (`FUN_00449620`) — humanoid enemy, four subtypes. Ported. */
  Thrower = 0x31,
  /** `FUN_00432FF0` — generic scripted scenery, eleven sub-handlers. */
  ScriptedScenery = 0x33,
  /** `FUN_0043BD30` — horde spawner. */
  HordeSpawner = 0x40,
  /** `FUN_00461CD0` — breakable-prop / item-container placer. */
  PropContainerPlacer = 0x41,
  /** `FUN_0042F9B0` — a batch of falling shootable breakables. */
  FallingBreakables = 0x42,
  /** `FUN_00445DB0` — flying enemy. */
  FlyingEnemy = 0x43,
  /** `FUN_00472B10` — prop placer. */
  PropPlacer = 0x44,
  /** `FUN_00438540` — water enemy. Rises, bobs, lunges to bite. */
  WaterEnemy = 0x51,
  /**
   * `MouseInit` (`FUN_0043F4C0`) — **the mouse**: its ten draw slots
   * `0x1385`..`0x138E` are `mouse.bin` entries 0 to 9. Subtypes 0 and 1
   * wander; 2, 3 and 4 are shootable route-branch triggers, in Original Mode
   * only.
   */
  Mouse = 0x52,
  /**
   * `CatInit` (`FUN_00431250`) — the cat, character type `0x1A`. Subtype 2
   * and up is a shootable route-branch trigger, in Original Mode only.
   */
  SkinnedNpc = 0x53,

  // -- the screen furniture ------------------------------------------------
  //
  // The four classes `spawn_simple` (0x0A) places, and the only four whose
  // records live in `comevtbl.bin` rather than in a stage table. They have no
  // position and no descriptor tail: two words, `{class, hp}`, and the object
  // places itself in screen space. Two of them raise a `g_script_flags` byte
  // the evt script then waits on, which is the whole reason the port has them.

  /**
   * `ChapterCardInstall` (`FUN_004342E0`) — the chapter card. Holds for 180
   * frames, raises `g_script_flags[0xF8]` and kills itself; every stage's
   * block 0 step 1 waits on that flag. **Ported** (`game/class60/`).
   */
  ChapterCard = 0x60,
  /**
   * `ResultCardInstall` (`FUN_00434EF0`) — the stage-clear card. Holds for 420
   * frames, drops `g_nFiringGate`, raises `g_script_flags[0xFE]` and kills
   * itself. **The only writer of flag 254 in the whole image.** **Ported**
   * (`game/class61/`).
   */
  ResultCard = 0x61,
  /**
   * `ResultCardTally` (`FUN_00435930`) — the result card's companion, placed
   * immediately before it. Draws the rescue list; writes no script flag, so
   * the port names it and gives it no module.
   */
  ResultCardTally = 0x62,
  /**
   * `InitCutsceneSkipWatcher` (`FUN_00435F20`) — the commonest `spawn_simple`
   * record, at the top of most steps in every stage. Installs the skip
   * watcher; writes no script flag.
   */
  CutsceneSkipWatcher = 0x63,
}

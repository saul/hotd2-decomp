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
  /** `FUN_0048E290` — the vehicle-and-scenery family. */
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
  /** `FUN_0043F4C0` — small wandering critter. */
  Critter = 0x52,
  /** `FUN_00431250` — skinned NPC. The cat. */
  SkinnedNpc = 0x53,
}

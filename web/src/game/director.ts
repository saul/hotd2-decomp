/**
 * One game frame.
 *
 * This is the order the engine runs them in, and the order matters:
 * `RankEnemiesByDistance` writes the rank that `ZombieStateApproach` reads
 * this same frame, and the camera runs **first** -- its action, its view and
 * the scene state's hook are settled before any player or actor moves, so the
 * camera reads what the actors did on the frames before. See `SceneTaskWalk`.
 */
import type { Events } from "../core/events";
import type { Rng } from "../core/rng";
import type { Actor } from "./actor";
import { ActorRunInit, ActorSpawn, SpawnFromDescriptor } from "./spawn";
export {
  ActorInitFlags, ActorRunInit, ActorSpawn, SpawnFromDescriptor,
} from "./spawn";
import { ActorDeadSweep, ActorDespawn } from "./despawn";
import { RegisterForCameraTracking, UpdateCameraEnemySlots }
  from "./camera/slots";
import { CameraActorTick, CameraUpdateTick } from "./camera/actor";
import { SkeletonRecordCameraPoint }
  from "./camera/track";
import { ThrownWeaponPoolUpdate } from "./class31/projectile";
import { ThrownWeaponCameraOf } from "./thrown_weapon";
import { BreakablePropPoolUpdate } from "./class41/pool";
import { WaterSurfacesTick } from "./class41/water";
import { DialogueTasksTick } from "./dialogue";
import { Type3UvScrollTick } from "./class41/type03";
import { Type26RipplesTick } from "./class41/type26";
import { St2CarsTick } from "./class21/car";
import { PropContainerType } from "./class41";
import { FLICKER_LIGHT_TYPE } from "./class41/type48";
import { Class44Selector } from "./class44";
import { SpawnHordePlacers } from "./class40";
import { SecondsToTicks, T } from "./tables";
import { RankEnemiesByDistance } from "./combat/rank";
import { DropDueShotRequests } from "./combat/shot";
import { ShotTestListReset } from "./combat/shot_test";
import { ColiPublishDynamicList } from "./coli";
import { CommitAppState } from "./app_state";
import { GameOverRunPhase } from "./game_over";
import { OptionsRunPhase } from "./options";
import { PlayerTasksRun } from "./player_shell";
import { HudDrawShutterState } from "./hud_shutter";
import { AutoReloadEmptyGuns } from "./player_gun";
import { RunPhaseDispatch } from "./run_phase";
import { ShotEffectsTick } from "./effects/tick";
import { BossHpBarsTick } from "./boss_hp_bar";
import { LifeGrantedMarkersTick } from "./class10/life_marker";
import { CivilianHitMarkersTick } from "./class10/hit_marker";
import { BossBannersTick } from "./boss_banner";
import { WaterWaveSourcesTick } from "./class17";
import { Boss4HitMarksTick } from "./class19/hit_mark";
import { Boss3TasksTick } from "./class45/tasks";
import { Class2DTasksTick } from "./class2D/tasks";
import { PushSceneLightStateToDevice } from "./light_sets";
import { Class32TasksTick } from "./class32/tasks";
import { BatSplashesTick } from "./class46/splash";
import { FishEffectsTick } from "./effects/fish";
import { OwlEffectsTick } from "./effects/owl";
import { RingEffectsTick } from "./effects/ring_effect";
import { ScreenSpriteQueueFlush, ScreenSpriteQueueReset } from "./screen_sprite";
import { CreditBlinkTick, InputReadFrameCounters } from "./credit_prompt";
import { SeveredHeadsTick } from "./effects/severed_head";
import { BodyCreaturePoolUpdate } from "./body_creature";
import { CarriedPropPoolUpdate } from "./carried_prop";
import { DescriptorFromPlacement, PlacementOrientation } from "./descriptor";
import type { CharacterPlacement } from "../bundle/characters";
import { ActorByAt, AppState, G } from "./globals";
import { ActorUpdateSuppressedBones } from "./parts";
import type { GameHost } from "./host";
import { ActorAdvanceMotion } from "./motion";
import { DeadSweep, g_class_handlers } from "./registry";
// For its side effect: every class module's own `registerClass` call. Nothing
// in this file names a class, and that is the point -- see `game/classes.ts`.
import "./classes";
import { SpawnClass as SpawnClassValue, type SpawnClass } from "./spawn_class";
import { ScriptedScenerySelector } from "./class33/state";
import { vec3, type Vec3 } from "./vec";

const GAME_HZ = 60;

/**
 * Take an actor out of the world because the **script stopped listing it**.
 *
 * **There is no such function in the exe, and no call site for one.** All 171
 * `ActorDespawn` (`FUN_00409CC0`) references are inside a class's own state
 * machine: an object leaves when its own logic decides to, and the walker's
 * spawn list is not a thing the engine has. This port materialises actors from
 * that list in `CharacterLayer`, so it also has to unmake them when an entry
 * goes, and this is that seam.
 *
 * [diverges] It runs the class's own leave routine, which is the nearest thing
 * the engine has to "you are done" — `ZombieReleaseAndDespawn` for 0x30,
 * `ThrowerLeave` for 0x31, `CivilianLeaveField` for 0x10 — and a bare
 * `ActorDespawn` for a class with none. What it is standing in for is a region
 * unload, and what that really does to the objects in it is `[open]`.
 *
 * Doing less than this is what the bug was: unmaking used to be a *hide*, so
 * the actor stayed in `g_object_list` with its counts and its permit, and
 * `wait_scripted_actors` held on a number nothing could bring down.
 */
export function RetireUnlistedActor(obj: Actor): void {
  const leave = g_class_handlers[obj.cls]?.leave;
  if (leave) leave(obj);
  else ActorDespawn(obj);
}


/**
 * The fields of a script spawn this needs. `script/walker`'s `ActiveSpawn`
 * satisfies it structurally, which keeps `game/` from importing the walker.
 */
export interface ScriptSpawn {
  at: number;
  class: number;
  pos?: [number, number, number];
  /**
   * The descriptor's own words, for the classes built from them alone:
   * `desc+0x22` (`obj+0x11C`), the three angles at `+0x14`..`+0x1C` and the
   * flags word at `+0x04`. The walker's `ActiveSpawn` carries all three; see
   * {@link SpawnPlacedFromRecord}.
   */
  hp?: number;
  orient?: [number, number, number];
  flags?: number;
  /**
   * The instruction that pushed it -- the walker's `ActiveSpawn` carries all
   * three. What {@link SpawnSiteKeys} tells one spawn instruction from
   * another by, when two of them name the same descriptor.
   */
  block?: number;
  step?: number;
  opIndex?: number;
  /**
   * `[port-only]` The record's replay scratch, which the walker's
   * `ActiveSpawn` carries -- see `ClassHandler.followReplayCamera`.
   */
  replay?: Readonly<Record<string, number>>;
}

/**
 * `[port-only]` -- one key per **spawn instruction run**, in list order.
 *
 * The spawn opcodes allocate a fresh object every time they run
 * (`ActorAlloc`, `FUN_004A6FA0`), whatever descriptor they name: stage 2
 * block 12 spawns block 11's class-0x2B light again while the first is still
 * burning, block 35 places block 20's class-0x15 plank row again, and stage 1
 * block 14 re-spawns the class-0x33 cars of blocks 5 and 11. The port
 * materialises these objects from the walker's list rather than from the
 * instruction, so it has to remember which list entries it has built -- and
 * an entry is an instruction, `(block, step, op, descriptor)`, not a
 * descriptor. The ordinal tells apart the same instruction run twice while
 * both entries are listed.
 */
export function SpawnSiteKeys(spawns: readonly ScriptSpawn[]): string[] {
  const seen = new Map<string, number>();
  return spawns.map((s) => {
    const base = `${s.block ?? -1}:${s.step ?? -1}:${s.opIndex ?? -1}:${s.at}`;
    const k = seen.get(base) ?? 0;
    seen.set(base, k + 1);
    return `${base}#${k}`;
  });
}

/**
 * `[port-only]` -- the pool address a new object from descriptor `at` is
 * linked under: `at` itself, or, when an object from that descriptor is
 * already in the pool, the next synthetic address (`g_summoned_actor_at`,
 * the counter `SpawnWaterEnemyAt` and the plank row draw from). The object
 * keeps `at` as its {@link Actor.descAt}. The engine needs neither: its pool
 * is keyed by pointer.
 */
export function SpawnSiteAt(at: number): number {
  if (!ActorByAt(at)) return at;
  const fresh = G.g_summoned_actor_at;
  G.g_summoned_actor_at -= 1;
  return fresh;
}

/**
 * The two facts about a character spawn that only the scene knows.
 *
 * Everything else about the object — its class, its character type, the whole
 * descriptor tail and its hit points — is in the bundle's `characters` block,
 * which `T` already holds. The position is not: the exporter bakes it into the
 * glTF node rather than emitting it beside the placement, so it comes across
 * from the renderer. The motion comes with it because the renderer is what
 * resolved the placement's clip against the type's motion table and refused
 * the ones it could not build.
 */
export interface CharacterSpawnRequest {
  at: number;
  motion: number;
  pos: Vec3;
  /**
   * The spawn whose `Init` makes this one, when the script does not list it:
   * a class-0x10 civilian's captors, which `CivilianInit` (`FUN_0048A3E0`)
   * `SpawnFromDescriptor`s itself. Their order follows from it.
   */
  parentAt?: number;
}

/**
 * The classes whose `Init` calls `ActorInitHitPoints`.
 *
 * **Exactly two, `[proved]`**: `FUN_0040A8B0` has two callers in the whole
 * image — `EnemyZombieInit` (`FUN_00452DA0`) at `0x00452DF2` and
 * `EnemyThrowerInit` (`0x00449620`) at `0x0044964A`. Every other class gets
 * `obj+0x11C` as `SpawnFromDescriptor` (`FUN_00408A20`) left it: the raw `s16`
 * at `desc+0x22`, copied to `obj+0x11C` **and** `obj+0x11E` before any `Init`
 * runs, with no difficulty delta and no clamp.
 *
 * That distinction is not academic, because `obj+0x11C` is the most
 * polymorphic word in the struct. It is a hit-point count for these two, an
 * animation phase seed for class 0x24, a sub-handler selector for classes
 * 0x26/0x28/0x33/0x44, and for a class-0x20 sub-type 1 it is the **direction
 * the actor spins**. The clamp's floor of 1 turns every honest zero into a
 * one, which for class 0x20 reverses the spin.
 */
const HP_SCALED_CLASSES: ReadonlySet<number> = new Set([
  SpawnClassValue.Zombie, SpawnClassValue.Thrower,
]);

/**
 * `ActorInitHitPoints` — `FUN_0040A8B0`. The descriptor's hit points plus the
 * difficulty delta, clamped to `[1, 300]`.
 *
 * The `cls` argument is the port's, and it is the gate above: this used to be
 * applied to **every** character placement, which is a routine the engine runs
 * from two `Init`s being run from the spawn path instead. See
 * {@link HP_SCALED_CLASSES}.
 */
export function ActorInitHitPoints(p: CharacterPlacement | undefined,
                                   cls?: number): number {
  const d = T.chars?.difficulty;
  if (!p) return 0;
  if (cls !== undefined && !HP_SCALED_CLASSES.has(cls)) return p.hp;
  if (!d?.hp_delta?.length) return p.hp;
  const hp = p.hp + (d.hp_delta[G.g_difficulty] ?? 0);
  return Math.min(d.hp_max, Math.max(d.hp_min, hp));
}

/**
 * Put the script's character spawns into the object pool.
 *
 * `SpawnFromDescriptor` (`FUN_00408A20`), for the classes that have a
 * skeleton. In the exe an actor comes into existence here — when opcode
 * 0x0B/0x0C/0x0D runs — and its class `Init` runs once, **later in the
 * frame**: when `SceneTaskWalk` reaches the object, after the scene's own
 * tasks. See `game/spawn.ts`.
 *
 * **Everything the record carries goes in before `Init` runs**, which is the
 * order the engine has: it fills the object from the record and only then
 * calls the class's `Init`. Setting them afterwards let the record overwrite
 * what `Init` decided — `CivilianInit` (`FUN_0048A3E0`) runs the civilian's
 * script as its last act, so a hostage whose script opens `SetMotion 371` had
 * it replaced by the placement's own 660 on the same frame, and every civilian
 * in the game stood in its spawn pose while its script ran on underneath.
 *
 * Idempotent: an `at` already in the pool is left alone.
 *
 * `[port-only]` as a *function*, and only as a function: everything inside the
 * loop is `SpawnFromDescriptor`, but the loop is not. The engine has no list
 * of live spawns to walk — one opcode makes one object, once — and the walker's
 * spawn list is the port's own answer to a region load. `SpawnPropContainers`
 * below is the same shape for the same reason.
 *
 * This was `render/characters.ts`'s until step 21. It is the engine's object
 * lifetime, and a renderer that decides an object exists is a renderer running
 * the game.
 */
export function SpawnScriptedCharacters(
    reqs: readonly CharacterSpawnRequest[]): Actor[] {
  const made: Actor[] = [];
  const placements = T.chars?.placements ?? [];
  for (const req of reqs) {
    if (ActorByAt(req.at)) continue;
    const p = placements.find((x) => x.at === req.at);
    // **A synthetic row is not a spawn.** The bat's wings have a placement so
    // that the client has geometry to bind, and no descriptor at all: the
    // object is built by `SpawnBatWings` (`FUN_0042E060`) inside its body's
    // `Init`, exactly where the engine builds it. Building one here as well
    // would make two actors at one address, and the second would have run no
    // `Init` worth the name.
    if (p?.synthetic) continue;
    const type = T.types[String(p?.char_type ?? 0)];
    const hp = ActorInitHitPoints(p, p?.class);
    made.push(SpawnFromDescriptor(
      req.at, (p?.class ?? 0) as SpawnClass,
      type?.type ?? 0, type?.name ?? `spawn ${req.at}`,
      { ...DescriptorFromPlacement(p),
        motion: req.motion,
        hp, maxHp: hp,
        // All three words of the record's orientation, `obj+0x64`/`+0x68`/
        // `+0x6C`, as `SpawnFromDescriptor` copies them.
        ...PlacementOrientation(p), pos: { ...req.pos },
        visible: true }));
  }
  return made;
}

/**
 * [port-only] Run every `Init` the walk has not reached yet, now.
 *
 * A stopped clock walks no tasks, and a seek lands stopped: the script phase
 * of a paused frame still makes the objects its spawn list names, and
 * without this they would stand in the pool as bare descriptors -- no
 * counts, no state, no hit slot -- until the transport started. The engine
 * has no such frame (it never runs its interpreter without walking the
 * list), so this is the app's seam and is called from nowhere else: the
 * `Init` runs where the port ran every `Init` before, at the spawn, reading
 * the camera as the paused frame holds it.
 */
export function RunPendingInits(rng?: Rng, events?: Events,
                                host?: GameHost): void {
  for (const obj of G.g_object_list) {
    if (obj.initPending) ActorRunInit(obj, rng, events, host);
  }
}

/**
 * Put the script's class-0x41 spawns into the object pool.
 *
 * Nothing else does: the character spawn above only builds spawns that resolve
 * to a skeleton, so a placer, which has no character at all, would never reach
 * the registry and no prop would ever be built. Saying so explicitly beats a
 * general fallback that would also re-spawn every enemy the character layer
 * already owns.
 *
 * It lives here rather than in `class41/` because putting it there made
 * `class41 -> director -> registry -> class41` a cycle, and ESM resolved it by
 * leaving `g_class_handlers[0x41]` undefined at evaluation time: the placers
 * spawned and were never updated, so no prop was ever placed and nothing said
 * why.
 *
 * A spawn with no row in `breakables.placements` is a constructor this port
 * does not implement — 73 of the 79 — and is left alone rather than guessed at.
 */
/**
 * The actors whose model is an **asset slot**, placed from the script's own
 * spawn list.
 *
 * [port-only] The engine has no such routine: `SpawnFromDescriptor`
 * (`FUN_00408A20`) builds every class the same way and `MouseInit` draws with
 * `AssetDrawSlot` afterwards. The port needs one because its ordinary spawn
 * path runs through `render/characters.ts` — an actor appears when a skinned
 * hierarchy is ready for it — and a class with no character type never gets
 * one. Class 0x52's mouse was ported and could not be built at all for
 * exactly that reason, which left one of the sixteen writers of
 * `g_script_branch_var` unreachable.
 *
 * Same shape as {@link SpawnPropContainers} beside it, and same reason for
 * living here: `class52 -> director -> registry -> class52` would be a cycle.
 *
 * **Two classes now.** Class 0x33 selector 1 is here for the same reason and
 * with one extra: its class id covers eleven different objects, so the test is
 * on the descriptor tail the bundle carries rather than on the class alone.
 *
 * The position and the three angles come from the **spawn record**, because
 * that is where they are for every class (see {@link PlacementOrientation});
 * the descriptor tail comes from `characters.placements`, which carries it
 * for these classes even though the renderer skips them. One source each.
 */
export function SpawnSlotActors(spawns: readonly ScriptSpawn[]): void {
  const placements = T.chars?.placements;
  if (!placements?.length) return;
  // `[port-only]` — **build each listed spawn instruction once**
  // (`SpawnSiteKeys`), and forget it when the script stops listing it. This routine runs every frame over the walker's
  // list, and `GameUpdate` prunes a despawned actor from the pool at the end of
  // the frame, so without this an actor that leaves under its own state machine
  // is rebuilt on the next one. Class 0x52's mouse and class 0x33's carrier
  // never despawn while they are still listed, which is why it did not show
  // until class 0x43 and class 0x51 arrived: a fish that falls back and goes
  // was rebuilt for ever, and a class-0x51 group header — an actor that exists
  // only to set the water level and die — was rebuilt sixty times a second.
  //
  // The engine has no such bookkeeping because it has no such routine: the
  // spawn opcode runs once, in the step that holds it.
  SlotActorsForgetUnlisted(spawns);
  // Class 0x40 counts instructions rather than addresses: see
  // `SpawnHordePlacers`.
  SpawnHordePlacers(spawns, placements);
  const keys = SpawnSiteKeys(spawns);
  spawns.forEach((s, i) => SpawnSlotActor(s, keys[i]));
}

/**
 * The bookkeeping half of {@link SpawnSlotActors}: forget a built spawn once
 * the script has stopped listing it. `[port-only]`, for the reason given
 * there.
 */
export function SlotActorsForgetUnlisted(spawns: readonly ScriptSpawn[]): void {
  const listed = new Set(SpawnSiteKeys(spawns));
  G.g_slot_actors_built = G.g_slot_actors_built.filter((k) => listed.has(k));
}

/**
 * One spawn of {@link SpawnSlotActors}, built if it is listed, placeable and
 * not built yet. Split out so `app/` can interleave these with the character
 * spawns **in the script's own order** — `SpawnFromDescriptor` makes one
 * object per descriptor, in instruction order, and a class whose `Init` reads
 * what the previous one left behind (`g_civilian_carrier`) sees exactly that.
 * `[port-only]`, as {@link SpawnSlotActors} is.
 */
export function SpawnSlotActor(s: ScriptSpawn,
                               key = SpawnSiteKeys([s])[0]): void {
  if (s.class === SpawnClassValue.PathRidingProp
      || s.class === SpawnClassValue.PathRidingVehicle) {
    SpawnPlacedFromRecord(s, key);
    return;
  }
  const placements = T.chars?.placements;
  if (!placements?.length) return;
  {
    if (G.g_slot_actors_built.includes(key)) return;
    const pl = placements.find((p) => p.at === s.at);
    if (!pl) return;
    // Decided before any arm links its object, and only once it is sure to.
    const at = (): number => SpawnSiteAt(s.at);
    if (s.class === SpawnClassValue.Mouse) {
      G.g_slot_actors_built.push(key);
      SpawnFromDescriptor(at(), SpawnClassValue.Mouse, -1, "mouse",
                          { class52: pl.class52 ?? null,
                            ...PlacementOrientation(pl),
                            pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                      s.pos?.[2] ?? 0),
                            visible: true, descAt: s.at });
      return;
    }
    // Class 0x43 -- the owl. Its handler is a placer that builds a 0x2A0-byte
    // object with no character type, so nothing in the character path can make
    // one either.
    // Class 0x13 -- a script-driven prop. No character type and no skeleton:
    // one asset slot under a matrix, so it comes through here rather than
    // through `render/characters.ts`. Opcode 0x0C, `SpawnFromDescriptorSmall`
    // (`FUN_00408BC0`): all three angles, which a static prop keeps for its
    // whole life and draws `RotX` first.
    //
    // **And the record's flags word**, which `SpawnFromDescriptorSmall` hands
    // `ActorInitFlags` (`FUN_00408970`) before the `Init` runs. All fifteen
    // class-0x13 descriptors in the game carry `0x8000`, no class-0x13 routine
    // read (the Init, the selector, routines 0, 1, 2 and 6, the update)
    // clears it, and `RegisterForShotTest` (`FUN_00405160`) refuses an object
    // with it (`TEST AH, 0x80` at `0x00405168`): no class-0x13 prop is ever in
    // the shot test. This arm used to drop the word, so stage 3's two boats --
    // whose routines seat a 40-unit sphere at `obj+0x124` -- were shootable,
    // and a sphere that size round the boat's origin took every pull aimed
    // at a rider standing behind it: the riders "did not die when shot".
    // Class 0x12 -- the same opcode, the same matrix, and a slot strip rather
    // than a behaviour. Its record's flags word is `0x10` for stage 1's
    // door (the shot mesh) and `0x8000` for the other two, and
    // `ScriptedPropUpdate12` raises `0x8000` itself when its strip starts, so
    // the word goes on as the class-0x13 arm below explains.
    if (s.class === SpawnClassValue.FlagStripProp) {
      if (!pl.class12) return;
      G.g_slot_actors_built.push(key);
      SpawnFromDescriptor(at(), SpawnClassValue.FlagStripProp, -1, "strip",
                          { class12: pl.class12, ...PlacementOrientation(pl),
                            flags: pl.init_flags ?? 0,
                            pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                      s.pos?.[2] ?? 0),
                            visible: true, descAt: s.at });
      return;
    }
    // Class 0x15 -- the row of floating planks. Opcode 0x0C too, so the
    // record's three angles and flags word, which every plank copies; the
    // placer builds the row from the tail and kills itself (`game/class15/`).
    if (s.class === SpawnClassValue.FloatingPropRow) {
      if (!pl.class15) return;
      G.g_slot_actors_built.push(key);
      SpawnFromDescriptor(at(), SpawnClassValue.FloatingPropRow, -1,
                          "plank row",
                          { class15: pl.class15, ...PlacementOrientation(pl),
                            flags: pl.init_flags ?? 0,
                            pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                      s.pos?.[2] ?? 0),
                            visible: true, descAt: s.at });
      return;
    }
    // Class 0x2B -- a scripted light. No tail and no position of its own:
    // `obj+0x11C`, the selector, is all `DynamicLightInit` reads
    // (`game/class2B/`).
    if (s.class === SpawnClassValue.DynamicLight) {
      G.g_slot_actors_built.push(key);
      SpawnFromDescriptor(at(), SpawnClassValue.DynamicLight, -1,
                          `light ${pl.hp}`,
                          { hp: pl.hp, maxHp: pl.hp, flags: pl.init_flags ?? 0,
                            visible: true, descAt: s.at });
      return;
    }
    if (s.class === SpawnClassValue.ScriptedProp) {
      if (!pl.class13) return;
      G.g_slot_actors_built.push(key);
      SpawnFromDescriptor(at(), SpawnClassValue.ScriptedProp, -1, "prop",
                          { class13: pl.class13, ...PlacementOrientation(pl),
                            flags: pl.init_flags ?? 0,
                            pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                      s.pos?.[2] ?? 0),
                            visible: true, descAt: s.at });
      return;
    }
    // Class 0x26 subtypes 2, 6 and 7 -- stage 3's boat and stage 6 block 12's
    // pair. Drawn by asset slot (and the boat by `render/rigs.ts`), with no
    // character type, so they come through here; the bundle carries a
    // placement for those subtypes alone (`slotDrawnSpawn`). `hp` is the
    // subtype, `obj+0x11C`, as `SpawnFromDescriptor` copies it.
    if (s.class === SpawnClassValue.Vehicle) {
      if (!pl.class26) return;
      G.g_slot_actors_built.push(key);
      SpawnFromDescriptor(at(), SpawnClassValue.Vehicle, -1,
                          pl.hp === 2 ? "boat" : `class 0x26 subtype ${pl.hp}`,
                          { class26: pl.class26, hp: pl.hp, maxHp: pl.hp,
                            ...PlacementOrientation(pl),
                            flags: pl.init_flags ?? 0,
                            pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                      s.pos?.[2] ?? 0),
                            visible: true, descAt: s.at });
      return;
    }
    if (s.class === SpawnClassValue.FlyingEnemy) {
      if (!pl.class43) return;
      G.g_slot_actors_built.push(key);
      SpawnFromDescriptor(at(), SpawnClassValue.FlyingEnemy, -1, "owl",
                          { class43: pl.class43, ...PlacementOrientation(pl),
                            pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                      s.pos?.[2] ?? 0),
                            visible: true, descAt: s.at });
      return;
    }
    // Class 0x42 -- the worm's placer. No character type: every draw of the
    // class is an asset slot. `PlaceWormBatch` runs as the `Init`, builds the
    // batch -- or the lone drop -- and despawns itself; the sub-type is the
    // descriptor's `+0x25`, and the position and the three angles are the
    // spawn record's, which is all `EvtOpSpawnPlaced09` gives it.
    if (s.class === SpawnClassValue.Worm) {
      if (!pl.class42) return;
      G.g_slot_actors_built.push(key);
      SpawnFromDescriptor(at(), SpawnClassValue.Worm, -1, "worm placer",
                          { class42: pl.class42, ...PlacementOrientation(pl),
                            pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                      s.pos?.[2] ?? 0),
                            visible: true, descAt: s.at });
      return;
    }
    // Class 0x29 -- a batch of floor decals. No character type: every draw is
    // an asset slot from one of the image's three lists, picked by `hp`
    // (`obj+0x11C`), and the tail names the camera cue that ends it.
    if (s.class === SpawnClassValue.SceneryBatch) {
      if (!pl.class29) return;
      G.g_slot_actors_built.push(key);
      SpawnFromDescriptor(at(), SpawnClassValue.SceneryBatch, -1,
                          `decals ${pl.hp}`,
                          { class29: pl.class29, hp: pl.hp, maxHp: pl.hp,
                            ...PlacementOrientation(pl),
                            pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                      s.pos?.[2] ?? 0),
                            visible: true, descAt: s.at });
      return;
    }
    // Classes 0x16 and 0x17 -- the stage-2 boss arena's wave field and its
    // sources. They draw nothing and kill themselves the frame they run, so
    // they have no character type either; the position is the one thing
    // either reads off the spawn (the field's plane is its `y`), and it goes
    // in the descriptor so the `Init` sees it.
    if (s.class === SpawnClassValue.WaterWaveField) {
      if (!pl.class16) return;
      G.g_slot_actors_built.push(key);
      SpawnFromDescriptor(at(), SpawnClassValue.WaterWaveField, -1,
                          "wave field",
                          { class16: pl.class16, ...PlacementOrientation(pl),
                            pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                      s.pos?.[2] ?? 0),
                            visible: true, descAt: s.at });
      return;
    }
    if (s.class === SpawnClassValue.WaterWaveSource) {
      if (!pl.class17) return;
      G.g_slot_actors_built.push(key);
      SpawnFromDescriptor(at(), SpawnClassValue.WaterWaveSource, -1,
                          "wave source",
                          { class17: pl.class17, hp: pl.hp, maxHp: pl.hp,
                            yaw: pl.yaw ?? 0, pitch: pl.class17.pitch,
                            roll: pl.class17.roll,
                            pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                      s.pos?.[2] ?? 0),
                            visible: true, descAt: s.at });
      return;
    }
    // Class 0x51 -- the fish. Drawn by asset slot from `fish.bin`, so it has
    // no character type and never reaches `render/characters.ts` either.
    // A **group header** goes through here as well: its `FishInit` sets
    // `g_water_level` and kills the actor, and skipping it would leave the
    // water where the previous scene left it.
    if (s.class === SpawnClassValue.WaterEnemy) {
      if (!pl.class51) return;
      // The position goes in the **descriptor**, not after the spawn: it is
      // the one class here whose `Init` reads it, into `sub+0x00..0x08`.
      G.g_slot_actors_built.push(key);
      SpawnFromDescriptor(at(), SpawnClassValue.WaterEnemy, -1, "fish",
                          { class51: pl.class51, ...PlacementOrientation(pl),
                            pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                      s.pos?.[2] ?? 0),
                            visible: true, descAt: s.at });
      return;
    }
    // Class 0x33 -- `hp` is the **selector**, not hit points:
    // `SpawnFromDescriptor` (`FUN_00408A20`) copies the raw `s16` at
    // `desc+0x22` into `obj+0x11C`, and `ScriptedSceneryDispatch33`
    // (`FUN_00432FF0`) switches on it. The bundle carries a tail block for the
    // sub-handlers this port has read that read one, and for no other --
    // `class33` for selector 1, `class33_prop` for selector 2, `class33_push`
    // for selector 4, `class33_cue` for selector 5, `class33_sub` for 6 to 11
    // and 99 -- and never two on one spawn. Selector 3
    // (`ScriptedEffectOnFirstFrame33`, `FUN_00433AC0`) reads no tail at all,
    // so its placement is the whole of what it needs. Any other placement is a
    // sub-handler nothing here can run and gets no object: the same refusal
    // `SpawnPropContainers` makes for an unnamed class-0x44 kind, rather than
    // a default arm that would run the wrong handler.
    if (s.class === SpawnClassValue.ScriptedScenery) {
      if (!pl.class33 && !pl.class33_push && !pl.class33_cue
          && !pl.class33_prop && !pl.class33_sub
          && pl.hp !== ScriptedScenerySelector.EffectOnFirstFrame) return;
      G.g_slot_actors_built.push(key);
      const obj = SpawnFromDescriptor(at(), SpawnClassValue.ScriptedScenery,
                          -1, `scenery ${pl.hp}`,
                          { class33: pl.class33, class33Push: pl.class33_push,
                            class33Cue: pl.class33_cue,
                            class33Sub: pl.class33_sub,
                            class33Prop: pl.class33_prop,
                            hp: pl.hp, maxHp: pl.hp,
                            ...PlacementOrientation(pl),
                            // `ActorInitFlags` (`FUN_00408970`) makes the
                            // descriptor's own flags word `obj+0x34` before
                            // any `Init` runs, and selector 4's two spawns
                            // carry `0x8000` there -- which is the very bit
                            // their `push_flag` clears. Dropping it would
                            // hand the port a chair pushable from frame one.
                            flags: pl.init_flags ?? 0,
                            pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                      s.pos?.[2] ?? 0),
                            visible: true, descAt: s.at });
      // `[port-only]` A seek's rebuild: what the replay's camera has run past
      // this record's object -- selector 7's cues -- goes on before it runs.
      if (s.replay) {
        g_class_handlers[obj.cls]?.resumeFromReplay?.(obj, s.replay);
      }
      return;
    }
  }
}

/**
 * Classes 0x28 and 0x27, as `EvtOpSpawnPlaced09` (`FUN_004088A0`) builds
 * them.
 *
 * Opcode 9 allocates `g_class_handlers[desc[0]]`, runs `ActorClearGameFields`
 * and `ActorInitFlags` on the descriptor's flags word, and copies `desc+0x22`
 * into `obj+0x11C` (and `+0x11E`), the position into `obj+0x40..0x48` and the
 * three angles into `obj+0x64..0x6C` -- and calls no `Init` and reads no
 * tail. So there is no placement row to look up: everything the object
 * starts with is on the spawn record, and the class's handler seats it on its
 * first frame (`game/class28/`, `game/class27/`). Both classes are placed
 * only by this opcode: stage 1's six class-0x28 spawns and stage 2 block 0's
 * two class-0x27 ones.
 *
 * `[port-only]` as a *function*, for the reason {@link SpawnSlotActors}
 * gives: built once per listed spawn instruction, which is the port's answer
 * to a replay. Before this arm each class's spawn built nothing: class 0x28's
 * draw ran in `render/rigs.ts` off the rig table with no object behind it,
 * and class 0x27 was not drawn at all.
 */
function SpawnPlacedFromRecord(s: ScriptSpawn, key: string): void {
  if (G.g_slot_actors_built.includes(key)) return;
  G.g_slot_actors_built.push(key);
  const cls = s.class as SpawnClass;
  SpawnFromDescriptor(SpawnSiteAt(s.at), cls, -1,
                      `placed 0x${cls.toString(16)} ${s.hp ?? 0}`,
                      { hp: s.hp ?? 0, maxHp: s.hp ?? 0,
                        flags: s.flags ?? 0,
                        pitch: s.orient?.[0] ?? 0, yaw: s.orient?.[1] ?? 0,
                        roll: s.orient?.[2] ?? 0,
                        pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                  s.pos?.[2] ?? 0),
                        visible: true, descAt: s.at });
}

/**
 * The fields of a `spawn_simple` record this needs. `script/walker`'s
 * `ActiveSimpleSpawn` satisfies it structurally, the same way
 * {@link ScriptSpawn} does — `game/` does not import the walker.
 */
export interface SimpleScriptSpawn {
  at: number;
  class: number;
  hp: number;
}

/**
 * Put `spawn_simple`'s objects into the pool.
 *
 * `EvtOpSpawnSimple0A` (`FUN_00408990`) allocates
 * `g_class_handlers[record[0]]` at 0x13F4 bytes, runs `ActorInitFlags`
 * (`FUN_00408970`) and writes `(short)record[1]` into **both** `obj+0x11C` and
 * `obj+0x11E`. There is no position, no orientation and no descriptor tail —
 * these classes are screen furniture and place themselves.
 *
 * `[port-only]` as a *loop*, for the same reason {@link SpawnScriptedCharacters}
 * is: the engine makes one object per operand as the instruction runs and
 * keeps no list, and the walker's list is the port's answer to a replay. The
 * body is the engine's, and it runs when the **instruction** does — a card
 * that waited for a frame would never be built during a seek, and the gate
 * behind it would have nothing to open it.
 *
 * Idempotent on `at`, which for these is the walker's own negative key.
 */
export function SpawnSimpleActors(spawns: readonly SimpleScriptSpawn[]): void {
  for (const s of spawns) {
    if (ActorByAt(s.at)) continue;
    // `-1` for the character type: these have no skeleton and no row in
    // `characters.types`, and 0 is a real type.
    const a = ActorSpawn(s.at, s.class as SpawnClass, -1,
                         `simple 0x${s.class.toString(16)}`,
                         { hp: s.hp, maxHp: s.hp });
    // The same line, and the same reason, as {@link SpawnSlotActors}: `visible`
    // is this port's "the character layer has built it", and `GameUpdate` skips
    // an actor without it. These have no character type to build, so nothing
    // draws them either way — but they still have to run.
    a.visible = true;
  }
}

export function SpawnPropContainers(spawns: readonly ScriptSpawn[]): void {
  const placements = T.breakables?.placements;
  if (!placements?.length) return;
  // Built once per spawn **instruction** while the script lists it, as
  // `SpawnSlotActors` does and for its reason: the placer dies on its first
  // frame and stays in the pool dead, which is what used to stop a second
  // build -- and so also stopped every re-spawn of the same descriptor by a
  // later instruction, which in the engine places the props again.
  const keys = SpawnSiteKeys(spawns);
  const listed = new Set(keys);
  G.g_prop_placers_built = G.g_prop_placers_built.filter((k) => listed.has(k));
  for (let i = 0; i < spawns.length; i++) {
    const s = spawns[i];
    const isPlacer = s.class === SpawnClassValue.PropContainerPlacer
                  || s.class === SpawnClassValue.PropPlacer;
    if (!isPlacer) continue;
    if (G.g_prop_placers_built.includes(keys[i])) continue;
    const pl = placements.find((p) => p.at === s.at);
    if (!pl) continue;
    G.g_prop_placers_built.push(keys[i]);

    // Class 0x44 dispatches on `+0x11C`, so the selector goes in `hp` — the
    // same field that is the *group id* for a class-0x41 placer.
    //
    // **The default arm is class 0x41's**, so a class-0x44 container that is
    // not named here does not merely go unbuilt: it is spawned as a
    // `PropContainerPlacer` and runs `PlaceBreakableGroup` with group 0. The
    // window halves at evt 0x1580/0x15CC did exactly that for as long as
    // `script_flag_effect` was missing from this table.
    const CLASS44_SELECTOR: Record<string, number> = {
      falling: Class44Selector.FallingContainer,
      story_switch: Class44Selector.StoryModeSwitch,
      script_flag_effect: Class44Selector.ScriptFlagEffect,
      rising_door: Class44Selector.RisingDoor,
      rise_to_height: Class44Selector.RiseToHeight,
      slide_on_flag: Class44Selector.SlideOnFlag,
      flag_lifted: Class44Selector.FlagLifted,
      draw_only_14: Class44Selector.DrawOnly,
      hinge: Class44Selector.Hinge,
      van_doors: Class44Selector.VanDoors,
      flag_slot_effect: Class44Selector.FlagSlotEffect,
      hinge_scaled: Class44Selector.HingeScaled,
      effect_handoff: Class44Selector.EffectHandoff,
      swing_then_break: Class44Selector.SwingThenBreak,
      scaled_slot_effect: Class44Selector.ScaledSlotEffect,
      effect_collapse: Class44Selector.EffectCollapse,
      slot_strip_loop: Class44Selector.SlotStripLoop,
      kinded_44: Class44Selector.KindedProp,
    };
    const sel = CLASS44_SELECTOR[pl.container];
    if (s.class === SpawnClassValue.PropPlacer && sel !== undefined) {
      const a = ActorSpawn(SpawnSiteAt(s.at), SpawnClassValue.PropPlacer, 0,
                           pl.container === "story_switch"
                             ? "story-mode switch"
                             : pl.container === "script_flag_effect"
                               ? `effect ${pl.effect}`
                               : pl.container === "rising_door"
                                 ? `rising door, flag ${pl.open_flag}`
                                 : pl.container === "rise_to_height"
                                   || pl.container === "slide_on_flag"
                                   || pl.container === "flag_lifted"
                                   ? `${pl.container}, flag ${pl.open_flag}`
                                   : pl.container === "draw_only_14"
                                     ? `slot 0x${(pl.slot ?? 0).toString(16)}`
                                     : pl.container === "falling"
                                       ? `container kind ${pl.kind}`
                                       : pl.container,
                           { hp: sel, descAt: s.at });
      a.pos = vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0, s.pos?.[2] ?? 0);
      a.yaw = pl.yaw ?? 0;
      a.visible = true;
      continue;
    }

    // `+0x130C` selects the class-0x41 constructor; `+0x11C` is the group id
    // for type 0, the lifetime for a kinded prop and the **asset slot** for a
    // generic one. Four meanings, one offset.
    const type = pl.container === "kinded" ? PropContainerType.KindedProp
      : pl.container === "generic" ? (pl.type ?? 0)
      : pl.container === "chain" ? PropContainerType.ChainSegments
      : pl.container === "fragment" ? PropContainerType.FragmentProps
      : pl.container === "flicker_light" ? FLICKER_LIGHT_TYPE
      : pl.container === "table38" ? PropContainerType.Table38Props
      : pl.container === "table39" ? PropContainerType.Table39Stacks
      : pl.container === "table44" ? PropContainerType.Table44Props
      : pl.container === "table50" ? PropContainerType.Table50Props
      : pl.container === "table66" ? PropContainerType.Table66Props
      : pl.container === "water_surface" ? PropContainerType.WaterSurface
      : pl.container === "uv_scroll" ? PropContainerType.UvScrollTask
      : pl.container === "type47" ? PropContainerType.Type47Prop
      : pl.container === "table16" ? PropContainerType.Table16Props
      : pl.container === "type17" ? PropContainerType.Type17Props
      : pl.container === "table29" ? PropContainerType.Table29Props
      : pl.container === "type37" ? PropContainerType.Type37PropPair
      : pl.container === "type42" ? PropContainerType.Type42Prop
      : pl.container === "type52" ? PropContainerType.Type52VanDoors
      : pl.container === "type55" ? PropContainerType.Type55Particles
      : pl.container === "type61" ? PropContainerType.Type61Figures
      : pl.container === "type65" ? PropContainerType.Type65Particles
      : pl.container === "golden_frog"
        ? PropContainerType.GoldenFrogFromLessonTable
      : pl.container === "ripple" ? PropContainerType.Type26RippleTask
      : PropContainerType.BreakableGroup;
    // The table constructors -- 38, 39, 44, 16 and 29 -- and constructor 37
    // read the placer's `+0x11C` as the step lifetime they copy into every
    // object, so that is what goes in `hp` for them; for a group it is the
    // group id.
    const table = pl.container === "table38" || pl.container === "table39"
      || pl.container === "table44" || pl.container === "table16"
      || pl.container === "table29" || pl.container === "type37"
      // ...and constructors 52 and 61 copy it into what they build: 52's
      // doors as their step lifetime, 61's figures as a word nothing reads;
      // constructor 68 into its frog's `+0x11C`, the step lifetime
      // `GoldenFrogUpdate` counts against; and constructor 26 into its task's
      // `+0x35`, the same.
      || pl.container === "type52" || pl.container === "type61"
      || pl.container === "golden_frog" || pl.container === "ripple";
    // The water task and constructors 50 and 66 read both descriptor fields
    // as themselves: `+0x1F4` the table index, `+0x11C` the lifetime.
    const bothFields = pl.container === "water_surface"
      || pl.container === "table50" || pl.container === "table66";
    const a = ActorSpawn(SpawnSiteAt(s.at), SpawnClassValue.PropContainerPlacer,
                         bothFields ? pl.field_1f4 ?? 0 : pl.lifetime_evt_steps,
                         pl.container === "kinded"
                           ? `prop kind ${pl.kind}`
                           : pl.container === "flicker_light"
                             ? "flicker light"
                             : bothFields
                               ? `${pl.container} ${pl.field_1f4}`
                               : `breakable group ${pl.group}`,
                         { hp: table || bothFields ? pl.lifetime_evt_steps
                                              : pl.group ?? 0,
                           condition: type, descAt: s.at });
    a.pos = vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0, s.pos?.[2] ?? 0);
    a.yaw = pl.yaw ?? 0;
    a.visible = true;
  }
}

export interface FrameResult {
  /**
   * Where the camera should look now — `g_camera_block_target`, after this
   * frame's ease. Always valid: with nothing registered it eases onto the
   * path's own target rather than handing control back.
   */
  lookAt: Vec3;
}

/**
 * Advance the whole game by `dt` seconds of game time.
 *
 * No eye is handed in. The one the app used to pass was the drawn camera as
 * the last draw left it -- a frame old, and not the point any enemy measures
 * to: the scene state's hook writes `g_camera_eye` inside the walk
 * (`CameraUpdateTick`, below), and every routine reads that, or a camera
 * block, from `G` by the address its instruction names. See `ClassFrame`.
 */
export function GameUpdate(dt: number, host: GameHost, rng: Rng,
                           events?: Events): FrameResult {
  const frames = dt * GAME_HZ;
  G.g_frame += frames;
  // `FUN_0040E730` steps three free-running counters once a game tick, and
  // this is the one two per-bone draw hooks index their model runs with --
  // `ZombieDrawBonePart` (`FUN_004534A0`) and `ThrowerDrawBonePart`. Whole
  // ticks, not `frames`: `g_frame` is fractional and a cel index taken from a
  // fraction repeats and skips (L12).
  G.g_blink_frame_counter += SecondsToTicks(dt);
  // ...and the second of the three, which `OwlDrawBodyChain` reads.
  G.g_frame_counter += SecondsToTicks(dt);
  // ...and the third, the one `ResetSceneOnEnter` zeroes.
  G.g_scene_tick_counter += SecondsToTicks(dt);
  // ...and the tick's next lines, the Hod2.ini auto-reload.
  AutoReloadEmptyGuns(events);
  // `SetupSceneProjection`'s `ScreenSpriteQueueReset` (`FUN_0041CF00`): the
  // layered queue starts every frame empty, whatever screen is up.
  ScreenSpriteQueueReset();
  // `[port-only]` -- the idle dimmer's draw is this frame's or nothing.
  G.g_screen_idle_dim = 0;
  // The input read, `FUN_0040E4D0` -> `InputReadFrame`: the frame counter the
  // credit line's blink runs on, and the credit tiers.
  InputReadFrameCounters(SecondsToTicks(dt));
  // Input first. `BuildShotRay` (`FUN_00406110`) writes the per-player shot
  // record and the frame reads it, so the trigger pulls the viewer made since
  // the last frame are resolved before anything moves -- an enemy is shot
  // where it was standing when the crosshair was over it, not where this
  // frame is about to put it.
  // **Before the trigger**, so an effect spawned by this frame's shot is drawn
  // at its first slot rather than its second. The engine's task list has the
  // same property for a different reason: `ActorAlloc` appends, and the walk
  // that would step a new task has already gone past the end.
  // `AppStateDispatch` (`FUN_004608A0`): only app state 6 runs the scene.
  // The game-over screen, 7, and the options screen, 0x0C, run their own
  // phases and task lists (`game/game_over.ts`, `game/options/`) and the
  // stage's actors stand still; any other screen (3, after the game over;
  // 4, the title) runs nothing the port has -- not even the dispatch's last
  // call, `CreditBlinkTick`, since the port has no screen 3 to draw its
  // PRESS START on and no title.
  if (G.g_app_state !== AppState.InPlay) {
    // The letterbox is one of the scene list's tasks (`HudShutterTaskCreate`,
    // `0x00460733`), so a screen that does not walk that list draws no bars.
    G.g_hud_shutter_bars = [];
    if (G.g_app_state === AppState.GameOver) {
      GameOverRunPhase({ host, rng, events }, events);
      CreditBlinkTick();
      ScreenSpriteQueueFlush();
    } else if (G.g_app_state === AppState.Options) {
      OptionsRunPhase(events);
      CreditBlinkTick();
      ScreenSpriteQueueFlush();
    }
    CommitAppState();
    return { lookAt: G.g_camera_block_target };
  }
  ShotEffectsTick();
  // The run phase wraps the task walk: `RunPhaseDispatch` (`FUN_0045FEE0`)
  // runs `RunSceneTasksAndTimers` from every phase a stage is played in, and
  // the continue screen is what it does around the walk. Then the frame's
  // screen request, if one was made, is committed -- `CommitAppState`
  // (`FUN_0040E860`) ends the engine's tick the same way.
  let result: FrameResult = { lookAt: G.g_camera_block_target };
  RunPhaseDispatch(() => {
    result = SceneTaskWalk(dt, host, rng, events);
  });
  // `AppStateDispatch`'s last call, whatever the screen.
  CreditBlinkTick();
  // `ScreenSpriteQueueFlush` (`FUN_0041CF30`), from `FUN_00418550`, which
  // `GameFrameTick` (`FUN_0040E730`) calls after `AppStateDispatch` -- so
  // after the run phase's own draws as well as the task walk's: the layered
  // queue lands after the continue screen's CONTINUE? and digit. It was at
  // the end of the walk, which put it before them.
  ScreenSpriteQueueFlush();
  CommitAppState();
  return result;
}

/**
 * `[port-only]` -- the scene's task list, walked in the engine's order.
 *
 * `0x00460710` builds it with fourteen calls, and `TaskRunTree`
 * (`FUN_004A71A0`) runs a list in creation order, so this is the order every
 * frame runs in, with every actor after all of it (`[proved]`; see
 * `camera/actor.ts` for the list):
 *
 * 1. the interpreter -- the walker's `tick`, run by the app before this;
 * 2. `PushSceneLightStateToDevice`: both light blocks' tweens stepped;
 * 3. `CameraActorTick`: the queued action's handler, then the view;
 * 5. `CameraUpdateTick`: the scene state's hook -- the gameplay eye, the rail;
 * 6. the two player tasks and `SelectAttackablePlayer`;
 * 12. `UpdateCameraEnemySlots`: the candidates the actors filed **last**
 *    frame, dealt into the slots the camera will read **next** frame;
 * 13. `RankEnemiesByDistance`;
 * 14. `ProcessPlayerShots`'s list reset;
 *
 * then every actor and pool in allocation order. So the camera a frame draws
 * is settled before anything moves, and what the actors do this frame reaches
 * the camera two frames on -- filed this frame, dealt next, read the one
 * after.
 */
function SceneTaskWalk(dt: number, host: GameHost,
                       rng: Rng, events?: Events): FrameResult {
  // The layered queue was emptied at the head of the frame, in `GameUpdate`.
  PushSceneLightStateToDevice(dt * GAME_HZ);
  CameraActorTick();
  CameraUpdateTick();
  // `[port-only]`: a body is on screen only on a frame a hook draws it.
  for (const b of G.g_player_bodies) b.drawn = 0;
  PlayerTasksRun({ host, rng, events });
  // The letterbox, the task `HudShutterTaskCreate` makes on the line after
  // `SpawnAttackablePlayerTask` (`0x00460733`): after both players have read
  // the state and the firing gate the script left, before any actor reads
  // what it turns them into. See `hud_shutter.ts`.
  HudDrawShutterState();
  UpdateCameraEnemySlots();
  // Once a frame: the rank the approach state tests against the ring table's
  // allowance, over what the zombies filed from their updates last frame.
  RankEnemiesByDistance();
  DropDueShotRequests();
  // `ProcessPlayerShots` (`FUN_00404570`) is a task of its own, the last the
  // list makes, and it ends by emptying `g_shot_test_list`: the trigger pulls
  // above were tested against what the actors registered last frame, and what
  // they register below is for the next one. See `combat/shot_test.ts`.
  // Its last three stores publish the list first (`0x00404612`), so the
  // crowd push this frame's actors run tests what they registered last frame.
  ColiPublishDynamicList();
  ShotTestListReset();
  // The heads the burst threw, stepped where the engine steps its tasks.
  SeveredHeadsTick(rng, events);

  // `ActorDespawn` unlinked these; the pool is a list, so they leave here.
  if (G.g_object_list.some((o) => o.despawned)) {
    // An actor that leaves the pool leaves both counts with it. The engine's
    // own despawn paths call the releases first -- `ZombieReleaseAndDespawn`
    // (`FUN_00455490`) is both of them and an `ActorDespawn` -- and this is
    // the backstop for the ones the port reaches another way. The latches make
    // it idempotent, so a route that already released pays nothing here.
    //
    // **Which** releases those are is the class's own answer and not a
    // `switch` here -- see `ClassHandler.onDeadSweep`.
    for (const o of G.g_object_list) {
      if (!o.despawned) continue;
      ActorDeadSweep(o, DeadSweep.Despawned);
    }
    G.g_object_list = G.g_object_list.filter((o) => !o.despawned);
  }

  // The stage-2 boss arena's wave sources, which class 0x17 allocated as
  // tasks ahead of the boss that samples them -- see `WaterWaveSourcesTick`.
  WaterWaveSourcesTick();

  // Class 0x2D's draws are made inside its routines, as the engine's are;
  // the list is this frame's (`class2D/draw.ts`).
  G.g_class2d_draws = [];
  const f = { dt, rng, host, events };
  for (const obj of G.g_object_list) {
    // `TaskRunTree` (`FUN_004A71A0`) calling `obj+0x00` while it is still the
    // handler `SpawnFromDescriptor` stored: the class's `Init`, here, after
    // the scene's own tasks -- so it reads the camera this frame's hook wrote.
    // An object an `Init` links is pushed behind this one and reached below,
    // on this frame, as `TaskRunTree`'s next-pointer read reaches it.
    //
    // The port then runs the frame's update as well, as it did when every
    // `Init` ran at the spawn. The engine does not always: `EnemyZombieInit`
    // writes `EnemyZombieUpdate` over `obj+0x00` and returns (`0x00452FB5`),
    // so a zombie's update starts on the next walk, while class 0x28's
    // handler seats itself on its first call and `Class22Init` runs its
    // update from inside. The port's split of each handler into `init` and
    // `update` answers that class by class: `ClassHandler.firstUpdateNextWalk`
    // is the answer for a class whose `Init` installs and returns, and class
    // 0x10 gives it.
    if (obj.initPending) {
      ActorRunInit(obj, rng, events, host);
      // An `Init` that kills its object (`PlaceWormBatch`, a fish group
      // header) longjmps out of the walk: nothing else of it runs.
      if (obj.despawned) continue;
      // ...and one that installs its update and returns has had this walk's
      // call: the update starts on the next. See
      // `ClassHandler.firstUpdateNextWalk`.
      if (g_class_handlers[obj.cls]?.firstUpdateNextWalk) continue;
    }
    // Every actor's clips run, handler or not: a class with no behaviour still
    // loops the motion the script gave it.
    if (obj.visible) {
      // ...unless the class steps `obj+0x194` itself, where the engine does:
      // see `ClassHandler.advancesOwnMotion`.
      if (!g_class_handlers[obj.cls]?.advancesOwnMotion) {
        ActorAdvanceMotion(obj, dt);
      }
      // `SkeletonNodeDrawSuppressed` (`FUN_004122E0`), which the engine asks
      // per node inside `SkeletonEmitNode`. Its input is `bone_records[9].slot`
      // -- what bone 9 is *currently* drawing -- so it cannot be baked into
      // the export, and it is a decision, so it cannot live in `render/`.
      // Once a frame here, read as state there.
      ActorUpdateSuppressedBones(obj);
      // `SkeletonEmitNode` (`FUN_004114C0`)'s `obj+0x100` write: the tracked
      // bone, as the renderer last posed it. The engine draws every skeleton
      // actor inside its own update, so every one carries the point whether
      // or not its class ever registers for the camera; the class's own
      // `ActorRegisterCameraPoint` call re-reads it and lifts it.
      // An actor carrying the engine's model block walks its own skeleton
      // inside its update, which writes the point (`game/skeleton.ts`).
      if (!obj.skel) SkeletonRecordCameraPoint(obj, host);
    }
    const handler = g_class_handlers[obj.cls];
    if (obj.dead || !obj.visible) {
      // A dead or unloaded actor must not sit on a permit — and clearing the
      // array is **not** how you give one back. `ReleaseAttackSlot`
      // (`FUN_00456520`) also lifts `g_attack_committed`, the latch a claim
      // raises when the actor it granted to was off screen, and
      // `TryClaimAttackSlot` reads that latch on its first line and gives up
      // before a player is even picked. So a zombie killed while holding an
      // off-screen permit left the latch raised for ever and **every**
      // remaining enemy was refused: a crowd walks to the ring and stands
      // there, wanting a permit that nobody holds.
      //
      // The engine does this from the death state itself —
      // `ZombieStateDeath6` (`FUN_00454D20`) sub 1 runs
      // `ZombieReleasePermitAndUntrack` (`FUN_004565A0`), whose first line is
      // the release. Class 0x30 has no death state here, so this sweep is
      // where it lands; it must be the whole function and not half of it.
      //
      // ...and the same reasoning for the enemy counters, which the engine
      // steps from the same teardown: `ZombieReleasePermitAndUntrack` drops
      // the alive count, and `ZombieEnterCorpseState` (`FUN_00456740`) the
      // present count when the death clip ends.
      //
      // Which bit of which flags word latches the permit, and which pair of
      // retires takes the actor out of the counts, are the **class's** two
      // answers. They were written here as `obj.cls === SpawnClass.Thrower`
      // twice; they are now `ClassHandler.onDeadSweep`, and the three reasons
      // the sweep can fire are `DeadSweep`.
      ActorDeadSweep(obj, obj.dead ? DeadSweep.Dead : DeadSweep.Unloaded);
      // ...but a class whose *death* is a state machine still has to run it.
      // Class 0x31 falls, lands, plays its death clip and rots; stopping here
      // left the body frozen wherever its hit points ran out.
      if (!(obj.dead && obj.visible && handler?.updatesWhenDead)) {
        obj.action = null;
        continue;
      }
    }
    // `g_cur_actor` is the object whose update is running, and the moving-
    // object collision passes skip it. See `Globals.g_cur_actor`.
    G.g_cur_actor = obj.at;
    handler?.update(obj, f);
    // **The boss classes' camera candidacy, until their updates make it.**
    // `[port-only]` bridge for the classes whose ports still answer
    // `tracksCamera`, the old predicate over the pool, rather than making the
    // call: a class that says it tracks and filed nothing this frame is filed
    // here, through `RegisterForCameraTracking` and its `NoCameraTrack` test.
    // Classes 0x22 and 0x23 answer `RegisterEnemySlot` with a latch it reads.
    // A class that already filed itself -- 0x14 and 0x19 call
    // `ActorRegisterCameraPoint` from their updates -- is not filed twice.
    //
    // Every other class makes its calls from its own update, where the
    // engine's routine does, and sets nothing. See `camera/track.ts`.
    if (handler?.tracksCamera?.(obj)
        && !G.g_camera_candidates.some((c) => c.prop === null
                                           && c.thrown === null
                                           && c.at === obj.at)) {
      RegisterForCameraTracking(obj);
    }
    G.g_cur_actor = -1;
  }

  // The thrown weapons, each running the routine its launcher installed --
  // `ThrownWeaponUpdate` (`FUN_00450780`) or `ZombieThrownWeaponUpdate`
  // (`FUN_0045A4F0`). One engine frame a call, like the other task pools.
  ThrownWeaponPoolUpdate({ cam: ThrownWeaponCameraOf(host), host, rng,
                           events });
  // ...and so are the creatures `znjoe` releases: `SpawnBodyCreature`
  // (`FUN_0043E720`) allocates a task with no class id, so it is stepped here
  // beside the other non-actor pools rather than inside the actor walk.
  BodyCreaturePoolUpdate(rng, host, events);
  // ...and the props state-37 zombies carry, which `ZombieStateCarryProp`
  // (`FUN_0045B380`) allocates the same way. See `game/carried_prop.ts`.
  CarriedPropPoolUpdate(rng, host, events);
  // The breakable props are their own 0x378 objects in the engine's pool, not
  // actors, so they get their own sweep — the same shape as the weapons.
  BreakablePropPoolUpdate(rng, events, host);
  // ...and the canal water tasks, which a class-0x41 placer allocates with
  // `ActorAlloc` like the props, so after the actors that placed them: a task
  // made this frame draws this frame. See `game/class41/water.ts`.
  WaterSurfacesTick();
  // ...and the subtitle tasks evt 0x2D and its other callers allocate, the
  // same way. See `game/dialogue.ts`.
  DialogueTasksTick();
  // ...and the car reflection's task, constructor 3's, the same way.
  Type3UvScrollTick(host);
  // ...and the warehouse water's, constructor 26's.
  Type26RipplesTick();

  // The stage-2 car, which `RescueTargetInit` (`FUN_00451720`) allocates:
  // an actor's task, so after the scene's own -- the camera's among them --
  // and it poses from the camera path this frame's camera actor has already
  // run. See `game/class21/car.ts`.
  St2CarsTick(host);
  // The tasks a boss allocates: the name banner and the health bar, after the
  // boss -- `ActorAlloc` appends. The banner flies the camera block here, with
  // the camera driver parked (`g_camera_driver_held`) so the next frame's
  // `CameraDriverSelectMode` leaves it alone, and the view the next frame
  // draws is built from it.
  BossBannersTick(host);
  BossHpBarsTick();
  // The markers a civilian's extra life raises (`SpawnLifeGrantedMarker`,
  // `FUN_0048DF10`), allocated by class 0x10's update above, so after it:
  // the first is drawn on the frame the life is paid. See
  // `game/class10/life_marker.ts`.
  LifeGrantedMarkersTick();
  // ...and the markers a shot civilian leaves (`SpawnCivilianHitMarker`,
  // `FUN_0048E080`), allocated by her update's shot arm the same way. See
  // `game/class10/hit_marker.ts`.
  CivilianHitMarkersTick();
  // ...and the marks the stage-4 boss's flesh hits leave, which
  // `Boss4SpawnBoneHitMark` (`FUN_004920C0`) allocates during the fight --
  // after the bar, so after it in the walk.
  Boss4HitMarksTick(host);
  // The owl's and the fish's tasks, allocated by their actors above, so
  // after them: every one runs on the frame its actor made it and draws what
  // it stepped to. See `game/effects/owl.ts`.
  OwlEffectsTick(rng);
  FishEffectsTick();
  RingEffectsTick();
  // The splashes a falling bat allocates (`SpawnBatSplash`, `FUN_0042F980`):
  // after the bats, so the first is drawn on the frame it is made. See
  // `game/class46/splash.ts`.
  BatSplashesTick();

  // Class 0x45's own tasks -- its intro card, the sparks and splashes, the
  // bulge and the wake -- allocated by its actors above, so after them.
  Boss3TasksTick(events);
  // ...and class 0x2D's: the sparks, the satellites' trails, the intro
  // flipbook and the death burst. See `game/class2D/tasks.ts`.
  Class2DTasksTick(host, events);
  // ...and class 0x32's draw-only tasks -- the afterimages, the body loop and
  // hands effects, the projectiles' trails, the death bursts and the exit
  // effect -- the same way. Its projectiles are actors and ran above.
  Class32TasksTick(events);
  // The layered queue is flushed by `GameUpdate`, after the run phase.
  return { lookAt: G.g_camera_block_target };
}

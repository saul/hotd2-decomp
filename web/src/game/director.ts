/**
 * One game frame.
 *
 * This is the order the engine runs them in, and the order matters:
 * `RankEnemiesByDistance` writes the rank that `ZombieStateApproach` reads
 * this same frame, and the camera reads the permits the states just changed.
 * The old client had the camera reading last frame's answer and it showed.
 */
import type { Events } from "../core/events";
import type { Rng } from "../core/rng";
import type { Actor } from "./actor";
import { ActorSpawn } from "./spawn";
export { ActorInitFlags, ActorSpawn } from "./spawn";
import { ActorDeadSweep, ActorDespawn } from "./despawn";
import { UpdateCameraEnemySlots } from "./camera/slots";
import { ActorRegisterCameraPoint, CameraPointRiseFor, CameraTrackEnemiesTick,
  UpdateCameraFreeFlag } from "./camera/track";
import { ThrownWeaponUpdate } from "./class31/projectile";
import { BreakablePropPoolUpdate } from "./class41/pool";
import { PropContainerType } from "./class41";
import { Class44Selector } from "./class44";
import { SecondsToTicks, T } from "./tables";
import { TickPlayerInvulnerability } from "./combat/player";
import { RankEnemiesByDistance } from "./combat/rank";
import { ProcessShotRequests } from "./combat/shot";
import { ShotEffectsTick } from "./effects/tick";
import { SeveredHeadsTick } from "./effects/severed_head";
import { DescriptorFromPlacement } from "./descriptor";
import type { CharacterPlacement } from "../bundle/characters";
import { ActorByAt, G } from "./globals";
import { ActorUpdateSuppressedBones } from "./parts";
import type { GameHost } from "./host";
import { ActorAdvanceMotion } from "./motion";
import { DeadSweep, g_class_handlers } from "./registry";
// For its side effect: every class module's own `registerClass` call. Nothing
// in this file names a class, and that is the point -- see `game/classes.ts`.
import "./classes";
import { SpawnClass as SpawnClassValue, type SpawnClass } from "./spawn_class";
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
 * 0x0B/0x0C/0x0D runs — and its class `Init` runs there and once.
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
    reqs: readonly CharacterSpawnRequest[], rng?: Rng,
    events?: Events): Actor[] {
  const made: Actor[] = [];
  const placements = T.chars?.placements ?? [];
  for (const req of reqs) {
    if (ActorByAt(req.at)) continue;
    const p = placements.find((x) => x.at === req.at);
    const type = T.types[String(p?.char_type ?? 0)];
    const hp = ActorInitHitPoints(p, p?.class);
    made.push(ActorSpawn(req.at, (p?.class ?? 0) as SpawnClass,
                         type?.type ?? 0, type?.name ?? `spawn ${req.at}`,
                         { ...DescriptorFromPlacement(p),
                           motion: req.motion,
                           hp, maxHp: hp,
                           yaw: p?.yaw ?? 0, pos: { ...req.pos },
                           visible: true },
                         rng, events));
  }
  return made;
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
 * The position and yaw come from the **spawn record**, because that is where
 * they are for every class; the descriptor tail comes from
 * `characters.placements`, which carries it for these classes even though the
 * renderer skips them. One source each.
 */
export function SpawnSlotActors(spawns: readonly ScriptSpawn[],
                                rng: Rng): void {
  const placements = T.chars?.placements;
  if (!placements?.length) return;
  // `[port-only]` — **build each listed spawn once**, and forget it when the
  // script stops listing it. This routine runs every frame over the walker's
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
  const listed = new Set(spawns.map((s) => s.at));
  G.g_slot_actors_built = G.g_slot_actors_built.filter((at) => listed.has(at));
  const built = new Set(G.g_slot_actors_built);
  for (const s of spawns) {
    if (built.has(s.at)) continue;
    if (ActorByAt(s.at)) continue;
    const pl = placements.find((p) => p.at === s.at);
    if (!pl) continue;
    if (s.class === SpawnClassValue.Mouse) {
      G.g_slot_actors_built.push(s.at);
      const a = ActorSpawn(s.at, SpawnClassValue.Mouse, -1, "mouse",
                           { class52: pl.class52 ?? null, yaw: pl.yaw ?? 0 },
                           rng);
      a.pos = vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0, s.pos?.[2] ?? 0);
      a.visible = true;
      continue;
    }
    // Class 0x43 -- the owl. Its handler is a placer that builds a 0x2A0-byte
    // object with no character type, so nothing in the character path can make
    // one either.
    if (s.class === SpawnClassValue.FlyingEnemy) {
      if (!pl.class43) continue;
      G.g_slot_actors_built.push(s.at);
      const a = ActorSpawn(s.at, SpawnClassValue.FlyingEnemy, -1, "owl",
                           { class43: pl.class43, yaw: pl.yaw ?? 0,
                             pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                       s.pos?.[2] ?? 0) },
                           rng);
      a.visible = true;
      continue;
    }
    // Class 0x51 -- the fish. Drawn by asset slot from `fish.bin`, so it has
    // no character type and never reaches `render/characters.ts` either.
    // A **group header** goes through here as well: its `FishInit` sets
    // `g_water_level` and kills the actor, and skipping it would leave the
    // water where the previous scene left it.
    if (s.class === SpawnClassValue.WaterEnemy) {
      if (!pl.class51) continue;
      // The position goes in the **descriptor**, not after the spawn: it is
      // the one class here whose `Init` reads it, into `sub+0x00..0x08`.
      G.g_slot_actors_built.push(s.at);
      const a = ActorSpawn(s.at, SpawnClassValue.WaterEnemy, -1, "fish",
                           { class51: pl.class51, yaw: pl.yaw ?? 0,
                             pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                       s.pos?.[2] ?? 0) },
                           rng);
      a.visible = true;
      continue;
    }
    // Class 0x33 -- `hp` is the **selector**, not hit points:
    // `SpawnFromDescriptor` (`FUN_00408A20`) copies the raw `s16` at
    // `desc+0x22` into `obj+0x11C`, and `ScriptedSceneryDispatch33`
    // (`FUN_00432FF0`) switches on it. The bundle carries a tail block for the
    // two sub-handlers this port has read and for no other -- `class33` for
    // selector 1, `class33_push` for selector 4 -- and never both on one
    // spawn, so a placement with neither is a sub-handler nothing here can run
    // and gets no object. That is the same refusal `SpawnPropContainers` makes
    // for an unnamed class-0x44 kind, rather than a default arm that would run
    // the wrong handler.
    if (s.class === SpawnClassValue.ScriptedScenery) {
      if (!pl.class33 && !pl.class33_push) continue;
      G.g_slot_actors_built.push(s.at);
      const a = ActorSpawn(s.at, SpawnClassValue.ScriptedScenery, -1,
                           `scenery ${pl.hp}`,
                           { class33: pl.class33, class33Push: pl.class33_push,
                             hp: pl.hp, maxHp: pl.hp, yaw: pl.yaw ?? 0,
                             // `ActorInitFlags` (`FUN_00408970`) makes the
                             // descriptor's own flags word `obj+0x34` before
                             // any `Init` runs, and selector 4's two spawns
                             // carry `0x8000` there -- which is the very bit
                             // their `push_flag` clears. Dropping it would
                             // hand the port a chair pushable from frame one.
                             flags: pl.init_flags ?? 0 });
      a.pos = vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0, s.pos?.[2] ?? 0);
      a.visible = true;
      continue;
    }
  }
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
  for (const s of spawns) {
    const isPlacer = s.class === SpawnClassValue.PropContainerPlacer
                  || s.class === SpawnClassValue.PropPlacer;
    if (!isPlacer) continue;
    if (ActorByAt(s.at)) continue;
    const pl = placements.find((p) => p.at === s.at);
    if (!pl) continue;

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
    };
    const sel = CLASS44_SELECTOR[pl.container];
    if (s.class === SpawnClassValue.PropPlacer && sel !== undefined) {
      const a = ActorSpawn(s.at, SpawnClassValue.PropPlacer, 0,
                           pl.container === "story_switch"
                             ? "story-mode switch"
                             : pl.container === "script_flag_effect"
                               ? `effect ${pl.effect}`
                               : pl.container === "rising_door"
                                 ? `rising door, flag ${pl.open_flag}`
                                 : `container kind ${pl.kind}`,
                           { hp: sel });
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
      : pl.container === "falling" ? PropContainerType.FallingContainer
      : pl.container === "chain" ? PropContainerType.ChainSegments
      : pl.container === "fragment" ? PropContainerType.FragmentProps
      : PropContainerType.BreakableGroup;
    const a = ActorSpawn(s.at, SpawnClassValue.PropContainerPlacer,
                         pl.lifetime_evt_steps,
                         pl.container === "kinded"
                           ? `prop kind ${pl.kind}`
                           : `breakable group ${pl.group}`,
                         { hp: pl.group ?? 0, condition: type });
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
 * `eye` is the camera, which in this game *is* the player: every range test in
 * the enemy code measures to it.
 */
export function GameUpdate(eye: Vec3, dt: number, host: GameHost, rng: Rng,
                           events?: Events): FrameResult {
  const frames = dt * GAME_HZ;
  G.g_frame += frames;
  // `FUN_0040E730` steps three free-running counters once a game tick, and
  // this is the one two per-bone draw hooks index their model runs with --
  // `ZombieDrawBonePart` (`FUN_004534A0`) and `ThrowerDrawBonePart`. Whole
  // ticks, not `frames`: `g_frame` is fractional and a cel index taken from a
  // fraction repeats and skips (L12).
  G.g_blink_frame_counter += SecondsToTicks(dt);
  // Input first. `BuildShotRay` (`FUN_00406110`) writes the per-player shot
  // record and the frame reads it, so the trigger pulls the viewer made since
  // the last frame are resolved before anything moves -- an enemy is shot
  // where it was standing when the crosshair was over it, not where this
  // frame is about to put it.
  // **Before the trigger**, so an effect spawned by this frame's shot is drawn
  // at its first slot rather than its second. The engine's task list has the
  // same property for a different reason: `ActorAlloc` appends, and the walk
  // that would step a new task has already gone past the end.
  ShotEffectsTick();
  ProcessShotRequests(host, rng, events);
  // The heads the burst threw, stepped where the engine steps its tasks.
  SeveredHeadsTick(rng, events);
  TickPlayerInvulnerability(frames);

  // Once a frame, for everyone: the rank the approach state tests against the
  // ring table's allowance.
  RankEnemiesByDistance(eye);

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

  const f = { eye, dt, rng, host, events };
  for (const obj of G.g_object_list) {
    // Every actor's clips run, handler or not: a class with no behaviour still
    // loops the motion the script gave it.
    if (obj.visible) {
      ActorAdvanceMotion(obj, dt);
      // `SkeletonNodeDrawSuppressed` (`FUN_004122E0`), which the engine asks
      // per node inside `SkeletonEmitNode`. Its input is `bone_records[9].slot`
      // -- what bone 9 is *currently* drawing -- so it cannot be baked into
      // the export, and it is a decision, so it cannot live in `render/`.
      // Once a frame here, read as state there.
      ActorUpdateSuppressedBones(obj);
      // `ActorRegisterCameraPoint` (`FUN_00409B70`): the tracked bone, lifted,
      // is where the camera follows this actor. Off the pose the renderer last
      // drew, which is the frame the engine's own reader sees too.
      //
      // The lift is the routine's **float argument**, pushed by whichever
      // class's `Update` makes the call -- 4.0 for a zombie or a civilian,
      // **0 for a thrower**. `CameraPointRiseFor` is that table; see it for
      // all fifteen call sites and for what the port does differently.
      ActorRegisterCameraPoint(obj, host, CameraPointRiseFor(obj.cls));
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
    handler?.update(obj, f);
  }

  ThrownWeaponUpdate(frames, events);
  // The breakable props are their own 0x378 objects in the engine's pool, not
  // actors, so they get their own sweep — the same shape as the weapons.
  BreakablePropPoolUpdate(rng, events);

  UpdateCameraEnemySlots(eye);
  // `FUN_00402E00` recomputes `g_camera_free` from the slot array it has just
  // filled -- the gate the room-clear waits need on top of their counter.
  UpdateCameraFreeFlag();
  // The camera hook, in the engine's own order: the queued `cam_play` action
  // has already seated the block on the rail for this frame (the host calls
  // `CamAdvancePathFrame`), and this eases the aim off it and back.
  CameraTrackEnemiesTick();
  return { lookAt: G.g_camera_block_target };
}

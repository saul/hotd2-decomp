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
import { makeActor, ThrowerFlag, ZombieFlag2, type Actor } from "./actor";
import { ActorDespawn } from "./despawn";
import { UpdateCameraEnemySlots } from "./camera/slots";
import { ActorRegisterCameraPoint, CameraTrackEnemiesTick,
  UpdateCameraFreeFlag } from "./camera/track";
import { ThrownWeaponUpdate } from "./class31/projectile";
import { BreakablePropPoolUpdate } from "./class41/pool";
import { PropContainerType } from "./class41";
import { Class44Selector } from "./class44";
import { T } from "./tables";
import { ReleaseAttackSlot } from "./combat/permits";
import {
  ReleaseEnemyAliveCount, ReleaseEnemyPresentCount,
  ThrowerRetireFromAliveCount, ThrowerRetireFromPresentCount,
} from "./combat/counts";
import { TickPlayerInvulnerability } from "./combat/player";
import { RankEnemiesByDistance } from "./combat/rank";
import { ProcessShotRequests } from "./combat/shot";
import { DescriptorFromPlacement } from "./descriptor";
import type { CharacterPlacement } from "../bundle/characters";
import { ActorByAt, G } from "./globals";
import type { GameHost } from "./host";
import { ActorAdvanceMotion } from "./motion";
import { ActorIsEnemy, g_class_handlers } from "./registry";
import { SpawnClass as SpawnClassValue, type SpawnClass } from "./spawn_class";
import { vec3, type Vec3 } from "./vec";

const GAME_HZ = 60;

/** Put one actor in the pool and run its class's `Init`. */
export function ActorSpawn(at: number, cls: SpawnClass, charType: number,
                           name: string,
                           descriptor?: Partial<Actor>,
                           rng?: Rng): Actor {
  const obj = makeActor(at, cls, charType, name);
  // The descriptor tail is what the class's own Init reads, so it goes on
  // before Init runs -- `EnemyZombieInit` starts the actor in `initialState`.
  if (descriptor) Object.assign(obj, descriptor);
  ActorInitFlags(obj, obj.flags);
  g_class_handlers[cls]?.init(obj, rng);
  G.g_object_list.push(obj);
  return obj;
}

/**
 * `ActorInitFlags` — `FUN_00408970`. The spawn record's flags word becomes the
 * actor's.
 *
 * `obj+0x34 = flags | 1` and `obj+0x38 = 0`, run by `SpawnFromDescriptor`
 * **before** the class's own `Init`, which then ORs its bits on top. The port
 * carried none of that word for a long time, and the bit that showed was
 * `0x20000`: `ZombiePushOutOfWorldAndActors` skips the per-frame ground snap
 * while it is set, so a spawn placed on a ledge stays on it. Ninety-five
 * shipped spawns set it, and without it every one of them was dropped to the
 * script's ground plane on its first frame — stage 1's axe man fell sixty-two
 * units off his platform and threw from behind the wall he had been standing
 * on.
 *
 * The other bits the shipped records use, for the same reason they are carried
 * whole rather than picked over: `0x8000` takes the actor out of the shot test
 * and the crowd push, `0x8000000` picks between `row[2]` and `row[3]`,
 * `0x40000` tells `EnemyZombieInit` not to compute the aim angles, and
 * `0x4000` freezes the pose.
 */
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

export function ActorInitFlags(obj: Actor, spawnFlags: number): void {
  obj.flags = spawnFlags | 1;
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
 * `ActorInitHitPoints` — `FUN_0040A8B0`. The descriptor's hit points plus the
 * difficulty delta, clamped to `[1, 300]`.
 */
export function ActorInitHitPoints(p: CharacterPlacement | undefined): number {
  const d = T.chars?.difficulty;
  if (!p) return 0;
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
    reqs: readonly CharacterSpawnRequest[], rng?: Rng): Actor[] {
  const made: Actor[] = [];
  const placements = T.chars?.placements ?? [];
  for (const req of reqs) {
    if (ActorByAt(req.at)) continue;
    const p = placements.find((x) => x.at === req.at);
    const type = T.types[String(p?.char_type ?? 0)];
    const hp = ActorInitHitPoints(p);
    made.push(ActorSpawn(req.at, (p?.class ?? 0) as SpawnClass,
                         type?.type ?? 0, type?.name ?? `spawn ${req.at}`,
                         { ...DescriptorFromPlacement(p),
                           motion: req.motion,
                           hp, maxHp: hp,
                           yaw: p?.yaw ?? 0, pos: { ...req.pos },
                           visible: true },
                         rng));
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

    if (pl.container === "falling" && s.class === SpawnClassValue.PropPlacer) {
      // Class 0x44 dispatches on `+0x11C`, so the selector goes in `hp` — the
      // same field that is the *group id* for a class-0x41 placer.
      const a = ActorSpawn(s.at, SpawnClassValue.PropPlacer, 0,
                           `container kind ${pl.kind}`,
                           { hp: Class44Selector.FallingContainer });
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
  // Input first. `BuildShotRay` (`FUN_00406110`) writes the per-player shot
  // record and the frame reads it, so the trigger pulls the viewer made since
  // the last frame are resolved before anything moves -- an enemy is shot
  // where it was standing when the crosshair was over it, not where this
  // frame is about to put it.
  ProcessShotRequests(host, rng, events);
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
    for (const o of G.g_object_list) {
      if (!o.despawned || !ActorIsEnemy(o.cls)) continue;
      if (o.cls === SpawnClassValue.Thrower) {
        ThrowerRetireFromAliveCount(o);
        ThrowerRetireFromPresentCount(o);
      } else {
        ReleaseEnemyAliveCount(o);
        ReleaseEnemyPresentCount(o);
      }
    }
    G.g_object_list = G.g_object_list.filter((o) => !o.despawned);
  }

  const f = { eye, dt, rng, host, events };
  for (const obj of G.g_object_list) {
    // Every actor's clips run, handler or not: a class with no behaviour still
    // loops the motion the script gave it.
    if (obj.visible) {
      ActorAdvanceMotion(obj, dt);
      // `ActorRegisterCameraPoint` (`FUN_00409B70`): the tracked bone, lifted,
      // is where the camera follows this actor. Off the pose the renderer last
      // drew, which is the frame the engine's own reader sees too.
      ActorRegisterCameraPoint(obj, host);
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
      ReleaseAttackSlot(obj, obj.cls === SpawnClassValue.Thrower
                        ? ThrowerFlag.OffScreenPermit
                        : ZombieFlag2.OffScreenPermit);
      // ...and the same reasoning for the enemy counters, which the engine
      // steps from the same teardown: `ZombieReleasePermitAndUntrack` drops
      // the alive count, and `ZombieEnterCorpseState` (`FUN_00456740`) the
      // present count when the death clip ends.
      //
      // **Only on death.** Not on `!visible`: the engine never ties either
      // count to whether the actor is drawn, and because the releases are
      // latched, doing so is permanent — an actor invisible for one frame
      // before the renderer turns it on would leave both counts and never
      // return, which cost two civilian rescues in `tools/civilians.mjs`
      // before this line said `dead`.
      //
      // [diverges] Class 0x30 has no death state here, so both of its
      // releases land on the same frame. That collapses the window in which a
      // class-0x30 corpse is *present but not alive*; class 0x31 keeps that
      // window, because it has its death states and calls the two retires
      // where the exe does. Porting `ZombieStateDeath6` (`FUN_00454D20`) and
      // `ZombieEnterCorpseState` is what closes it.
      if (obj.dead && ActorIsEnemy(obj.cls)
          && obj.cls !== SpawnClassValue.Thrower) {
        ReleaseEnemyAliveCount(obj);
        ReleaseEnemyPresentCount(obj);
      }
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

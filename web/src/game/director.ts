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
import { UpdateCameraEnemySlots } from "./camera/slots";
import { CameraTrackEnemiesTick, UpdateCameraFreeFlag }
  from "./camera/track";
import { ThrownWeaponUpdate } from "./class31/projectile";
import { BreakablePropPoolUpdate } from "./class41/pool";
import { PropContainerType } from "./class41";
import { Class44Selector } from "./class44";
import { T } from "./tables";
import { ReleaseAttackSlot } from "./combat/permits";
import { TickPlayerInvulnerability } from "./combat/player";
import { RankEnemiesByDistance } from "./combat/rank";
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
 * Put the script's class-0x41 spawns into the object pool.
 *
 * Nothing else does: `ActorSpawn` is otherwise reached only from the character
 * layer, and only for spawns that resolve to a skeleton — so a placer, which
 * has no character at all, never reached the registry and no prop was ever
 * built. Extracting spawning from the renderer is step 5 of
 * PLAYER_ARCHITECTURE.md; until then this is the one class that needs the
 * bridge, and saying so explicitly beats a general fallback that would also
 * re-spawn every enemy the character layer already owns.
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
/**
 * The two enemy counts, derived from the pool rather than stepped.
 *
 * [diverges] The engine keeps both as counters that each class's `Init` raises
 * and its teardown lowers. This predates the spawn-on-opcode work and is the
 * last of the counters still derived; `g_civilians_alive` is stepped where the
 * engine steps it.
 */
export function SyncDerivedActorCounts(): void {
  // Only the classes whose handler increments it — not every visible actor.
  // A set-piece or a civilian in this count is a `wait_enemies_alive` that
  // never unblocks.
  G.g_enemies_alive = G.g_object_list
    .filter((o) => !o.dead && o.visible && ActorIsEnemy(o.cls)).length;
  // The looser of the two. `EnemyThrowerInit` raises it and
  // `ThrowerRetireFromPresentCount` drops it — on *leaving*, not on dying — so
  // a corpse still on stage is present and not alive. Class 0x10's wait bit
  // 0x01 reads it, and reading zero would have unblocked every one of those
  // waits on frame one.
  G.g_enemies_present = G.g_object_list
    .filter((o) => o.visible && ActorIsEnemy(o.cls)).length;
}

export function GameUpdate(eye: Vec3, dt: number, host: GameHost, rng: Rng,
                           events?: Events): FrameResult {
  const frames = dt * GAME_HZ;
  G.g_frame += frames;
  TickPlayerInvulnerability(frames);

  // Once a frame, for everyone: the rank the approach state tests against the
  // ring table's allowance.
  RankEnemiesByDistance(eye);
  SyncDerivedActorCounts();

  // `ActorDespawn` unlinked these; the pool is a list, so they leave here.
  if (G.g_object_list.some((o) => o.despawned)) {
    G.g_object_list = G.g_object_list.filter((o) => !o.despawned);
  }

  const f = { eye, dt, rng, host, events };
  for (const obj of G.g_object_list) {
    // Every actor's clips run, handler or not: a class with no behaviour still
    // loops the motion the script gave it.
    if (obj.visible) ActorAdvanceMotion(obj, dt);
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

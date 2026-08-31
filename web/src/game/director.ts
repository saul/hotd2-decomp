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
import { makeActor, type Actor } from "./actor";
import { SelectCameraLookAtTarget } from "./camera/select_target";
import { UpdateCameraEnemySlots } from "./camera/slots";
import { TurnLookAtToward } from "./camera/turn";
import { ThrownWeaponUpdate } from "./class31/projectile";
import { BreakablePropPoolUpdate } from "./class41/pool";
import { PropContainerType } from "./class41";
import { Class44Selector } from "./class44";
import { T } from "./tables";
import { TickPlayerInvulnerability } from "./combat/player";
import { RankEnemiesByDistance } from "./combat/rank";
import { ActorByAt, G } from "./globals";
import type { GameHost } from "./host";
import { ActorAdvanceMotion } from "./motion";
import { g_class_handlers } from "./registry";
import { SpawnClass as SpawnClassValue, type SpawnClass } from "./spawn_class";
import { vec3, type Vec3 } from "./vec";

const GAME_HZ = 60;

/** Put one actor in the pool and run its class's `Init`. */
export function ActorSpawn(at: number, cls: SpawnClass, charType: number,
                           name: string,
                           descriptor?: Partial<Actor>): Actor {
  const obj = makeActor(at, cls, charType, name);
  // The descriptor tail is what the class's own Init reads, so it goes on
  // before Init runs -- `EnemyZombieInit` starts the actor in `initialState`.
  if (descriptor) Object.assign(obj, descriptor);
  g_class_handlers[cls]?.init(obj);
  G.g_object_list.push(obj);
  return obj;
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
                         pl.lifetime_evt_blocks,
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
  /** Whether anything is registered — false means "use the path's target". */
  tracking: boolean;
  /** Where the camera should look now, eased. Only valid when tracking. */
  lookAt: Vec3;
}

const _desired = vec3();

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
  TickPlayerInvulnerability(frames);

  // Once a frame, for everyone: the rank the approach state tests against the
  // ring table's allowance.
  RankEnemiesByDistance(eye);
  G.g_enemies_alive = G.g_object_list
    .filter((o) => !o.dead && o.visible).length;

  const f = { eye, dt, rng, host, events };
  for (const obj of G.g_object_list) {
    // Every actor's clips run, handler or not: a class with no behaviour still
    // loops the motion the script gave it.
    if (obj.visible) ActorAdvanceMotion(obj, dt);
    if (obj.dead || !obj.visible) {
      // A dead or unloaded actor must not sit on a permit.
      if (obj.attackPermit >= 0) {
        G.g_attack_permits[obj.attackPermit] = -1;
        obj.attackPermit = -1;
      }
      obj.action = null;
      continue;
    }
    g_class_handlers[obj.cls]?.update(obj, f);
  }

  ThrownWeaponUpdate(frames, events);
  // The breakable props are their own 0x378 objects in the engine's pool, not
  // actors, so they get their own sweep — the same shape as the weapons.
  BreakablePropPoolUpdate(rng, events);

  UpdateCameraEnemySlots(eye);
  const tracking = SelectCameraLookAtTarget(_desired);
  if (!tracking) {
    G.g_camera_lookat_valid = false;
    return { tracking: false, lookAt: G.g_camera_lookat_target };
  }
  const current = G.g_camera_lookat_valid ? G.g_camera_lookat_target : _desired;
  TurnLookAtToward(eye, current, _desired, G.g_camera_lookat_target);
  G.g_camera_lookat_valid = true;
  return { tracking: true, lookAt: G.g_camera_lookat_target };
}

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
import { TickPlayerInvulnerability } from "./combat/player";
import { RankEnemiesByDistance } from "./combat/rank";
import { G } from "./globals";
import type { GameHost } from "./host";
import { ActorAdvanceMotion } from "./motion";
import { g_class_handlers } from "./registry";
import type { SpawnClass } from "./spawn_class";
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

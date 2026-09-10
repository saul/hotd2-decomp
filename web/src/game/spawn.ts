/**
 * Putting one object in the pool.
 *
 * Its own module rather than a corner of `director.ts`, and the reason is the
 * same one `registry.ts` gives for not building the class table itself:
 * `director.ts` imports `./classes` for its side effects, so every class
 * module is downstream of it, and a class that needs to *make* an actor —
 * class 0x14's summoning rounds, class 0x41's and 0x44's children — would
 * close an ESM cycle and get `undefined` back. Nothing here imports a class.
 */
import type { Rng } from "../core/rng";
import { makeActor, type Actor } from "./actor";
import { G } from "./globals";
import { g_class_handlers } from "./registry";
import type { SpawnClass } from "./spawn_class";

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

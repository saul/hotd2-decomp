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
import type { Events } from "../core/events";
import type { Rng } from "../core/rng";
import { makeActor, type Actor } from "./actor";
import { G } from "./globals";
import { ActorClaimHitSlot, HIT_SLOT_CLAIMING_CLASSES }
  from "./hit_slots";
import { g_class_handlers } from "./registry";
import type { SpawnClass } from "./spawn_class";

/**
 * Put one actor in the pool and run its class's `Init`.
 *
 * `events` is here because **one class's `Init` makes a sound**:
 * `EnemyZombieInitByCharType` (`FUN_00452FD0`) starts the looping chainsaw or
 * laser sword for character types 2 and 3. See
 * `class30/weapon_loop.ts` — the engine has no handle for a playing loop, so
 * the noise has to begin at the moment the object that makes it does.
 */
export function ActorSpawn(at: number, cls: SpawnClass, charType: number,
                           name: string,
                           descriptor?: Partial<Actor>,
                           rng?: Rng, events?: Events): Actor {
  const obj = makeActor(at, cls, charType, name);
  // The descriptor tail is what the class's own Init reads, so it goes on
  // before Init runs -- `EnemyZombieInit` starts the actor in `initialState`.
  if (descriptor) Object.assign(obj, descriptor);
  ActorInitFlags(obj, obj.flags);
  // `ActorBuildSkinnedModel` (`FUN_00410440`) claims the actor's `g_hit_slots`
  // entry, and 35 class `Init`s call it -- every one that builds a skinned
  // character. The port has no model build, so the claim runs here, for the
  // classes whose `Init` is a proved caller and no others. `obj+0x3C` is the
  // phase of every cel a class-0x30 bone draws; see `class30/bonecels.ts`.
  if (HIT_SLOT_CLAIMING_CLASSES.has(cls)) ActorClaimHitSlot(obj);
  g_class_handlers[cls]?.init(obj, rng, events);
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
 *
 * And `0x8` is class 0x30's **ride the carrier**: `EnemyZombieInitByCharType`
 * reads it at `0x0045301D` and re-reads the descriptor's position and yaw as
 * an offset on `g_carrier_object` — see `class30/carrier.ts`. Four shipped
 * records set it, all in stage 5's block 2, and it is why carrying this whole
 * word rather than picking over it is the right shape: the bit that mattered
 * was one nobody had read.
 */
export function ActorInitFlags(obj: Actor, spawnFlags: number): void {
  obj.flags = spawnFlags | 1;
}

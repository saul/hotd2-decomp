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
import { ActorFlag, MOTION_FLAGS_INIT, makeActor, type Actor } from "./actor";
import { G } from "./globals";
import { ActorClaimHitSlot, HIT_SLOT_CLAIMING_CLASSES }
  from "./hit_slots";
import { g_class_handlers } from "./registry";
import { CharacterTypeOf } from "./tables";
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
  // 35 class `Init`s call `ActorBuildSkinnedModel` -- every one that builds a
  // skinned character. The port has no model build, so what the build leaves
  // on the actor is done here, for the classes whose `Init` is a proved
  // caller and no others. `obj+0x3C` is the phase of every cel a class-0x30
  // bone draws; see `class30/bonecels.ts`.
  if (HIT_SLOT_CLAIMING_CLASSES.has(cls)) ActorBuildSkinnedModel(obj);
  // **Into the pool before its `Init` runs**, because that is where the
  // engine's object is: `SpawnFromDescriptor` (`FUN_00408A20`) is
  // `ActorAlloc(g_class_handlers[class], 0x13F4)`, which links the task into
  // the ring, and the handler it installs is the `Init` -- run later, by the
  // task walk, from its place in the ring. So an object an `Init` makes is
  // linked **after** the one making it, and is updated after it every frame
  // from then on. `Class22Init` (`FUN_0049B0D0`) is the case that reads the
  // order: its companion, spawned from its own first update, reads the
  // flier's hit points and phase every frame, and the flier reads the
  // companion's position and strike bits, each a frame old in the engine.
  // Pushing after the `Init` put every such child in front of its parent.
  G.g_object_list.push(obj);
  g_class_handlers[cls]?.init(obj, rng, events);
  return obj;
}

/**
 * `ActorBuildSkinnedModel` — `FUN_00410440`, for the two things it leaves on
 * the actor.
 *
 * The routine builds the skeletal model record at `obj+0x194`, and that
 * record is the renderer's hierarchy here. What it also does to the actor's
 * own state is three things, and all three are ported:
 *
 * * The draw state: `model+0x64 = 3` — {@link MOTION_FLAGS_INIT}, `c7466403`
 *   at `0x004104C5` — and the vertex-blended parts' records. `model+0x3C` is
 *   `g_pCharacterExtraParts[type]->count` (`0x0052ED08`), `model+0x40` is
 *   `ActorAllocSub(count * 8)`, and the loop at `0x004104D8` writes each
 *   record's `+0` to 0 and its `+1` to 1: every part starts visible. The
 *   count comes from the character's `parts` in the bundle, which keeps a
 *   `null` for a null descriptor precisely so that its length is this count.
 * * `ActorClaimHitSlot` (`FUN_00409270`) — the actor's `g_hit_slots` entry.
 * * `SkeletonBuildAndPose` (`FUN_00410590`), which it calls, raises
 *   {@link ActorFlag.ShootPerBone} on `g_cur_actor` when the character's
 *   skeleton has root nodes:
 *
 *   ```
 *   004105CC  CMP word ptr [EAX + 0x16], 0x0   ; g_character_skeletons[type]
 *   004105D5  JZ  0x004105E5
 *   004105D7  MOV EAX, [0x009A26A0]            ; g_cur_actor
 *   004105DC  MOV ECX, dword ptr [EAX + 0x34]
 *   004105DF  OR  CL, 0x80
 *   004105E2  MOV dword ptr [EAX + 0x34], ECX
 *   ```
 *
 *   Every `Init` that calls the build points `g_cur_actor` at itself first,
 *   so the bit lands on the actor being built. It is the bit
 *   `ShotTestSphere` (`FUN_00404630`) forks on: with it, and bones, the shot
 *   is resolved bone by bone.
 *
 * The engine runs it from inside `Init`; the port runs it just before, which
 * is the same for every class it serves because each of their `Init`s only
 * ORs and ANDs `obj+0x34` afterwards. `CatInit` is the one that takes the bit
 * back, and it does so itself.
 */
export function ActorBuildSkinnedModel(obj: Actor): void {
  const type = CharacterTypeOf(obj);
  obj.motionFlags = MOTION_FLAGS_INIT;
  obj.partVisible = new Array<number>(type?.parts?.length ?? 0).fill(1);
  ActorClaimHitSlot(obj);
  if ((type?.bones ?? []).some((b) => b.parent === null)) {
    obj.flags |= ActorFlag.ShootPerBone;
  }
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

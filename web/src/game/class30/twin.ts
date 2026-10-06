/**
 * The twin: a second class-0x30 actor `znele` allocates beside itself, drawn
 * at a quarter alpha over it and faded out as `znele` fades in.
 *
 * Character type 9 (`znjikken1.bin`) has no spawn record anywhere in the
 * shipped game. `EnemyZombieInitByCharType` (`FUN_00452FD0`)'s type-0x12 arm
 * makes one per `znele` whose `obj+0x34` lacks `0x10000000` -- eleven of the
 * thirteen, all stage 6 -- and `EnemyZombieInit` (`FUN_00452DA0`) gives it
 * `ZombieTwinFollowHost` for its update instead of `EnemyZombieUpdate`
 * (`FUN_004533F0`). It runs no state. Every frame it takes the host's
 * transform and motion, draws, and waits for its own `0x1C7C` node to fade it
 * to nothing.
 *
 * What the two look like together, from the two fade arms of
 * `ZombieDrawBonePart` (`FUN_004534A0`): for a hundred frames `znele` is drawn
 * at 0 and the twin at 0.25 in the same place, wearing the same clip; then the
 * twin falls to 0 over sixteen frames and `znele` rises to 1 over thirty.
 *
 * [diverges] The twin's parts and its `0x1C71..0x1C80` cels are drawn with
 * UVs made from their normals each frame (`AssetSlotUVsFromViewNormals`,
 * `FUN_00418660`, on each of them before the draw); the port draws them with
 * the UVs the exporter wrote. That is a draw the renderer has no path for yet,
 * and it changes the texture the twin shows, not whether or how much of it
 * shows.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, type Actor, type ZombieActor } from "../actor";
import { ActorDespawn } from "../despawn";
import { ActorInitHitPoints } from "../director";
import { ActorByAt } from "../globals";
import type { ClassFrame } from "../registry";
import { ActorSpawn } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { RegisterForShotTest } from "../combat/shot_test";
import { ActorRunNodeDrawHooks } from "../model_draw";
import { DrawSkinnedModelAndShadow } from "../skeleton";
import { ZombieDrawBonePart } from "./draw";
import { ZombiePushOutOfWorldAndActors } from "./ground";
import { ZombieOnShot } from "./on_shot";

/** `MOV word ptr [EBX + 0x1f4], 0x9` at `0x00453249`. */
export const ZOMBIE_TWIN_CHAR_TYPE = 9;

/**
 * `[port-only]` — the spawn address the port gives a `znele`'s twin: the
 * host's with bit 27 set, which no evt offset, `hordeMemberAt`, `BatChildAt`,
 * `BatWingAt` or `Class22SubActorAt` sets.
 *
 * The engine keys nothing on an address; the port's pool and the renderer's
 * synthetic row do. `hod2lib/characters.ts` writes the same address on the
 * twin's row (`ZOMBIE_TWIN_AT_BIT`) and nothing can check that the two agree,
 * so each names the other.
 */
export const ZOMBIE_TWIN_AT_BIT = 0x08000000;

/**
 * [port-only] The twin's address for a host at `hostAt`. See
 * {@link ZOMBIE_TWIN_AT_BIT}.
 */
export function ZombieTwinAt(hostAt: number): number {
  return (hostAt | ZOMBIE_TWIN_AT_BIT) >>> 0;
}

/**
 * `OR EDX, 0x80040000` at `0x004532DB`, on the twin's own `obj+0x34` every
 * frame: {@link ActorFlag.NoHeadAim}, so its hook never turns its head, and
 * bit `0x80000000`, which the port has no reader for. `[open]` what that bit
 * selects for class 0x30.
 */
const TWIN_EVERY_FRAME = ActorFlag.NoHeadAim | 0x80000000;
/**
 * `AND AH, 0x7e` at `0x004532F1`: while the host has `0x10000000` the twin
 * clears the shot test's bit and the immunity on its own word instead of
 * taking the host's transform.
 */
const TWIN_HOST_COMMITTED_CLEARS = ActorFlag.NoShotTest | ActorFlag.ShotImmune;

/**
 * The allocation half of `EnemyZombieInitByCharType`'s type-0x12 arm,
 * `0x00453204..0x0045325B`:
 *
 * ```
 * 00453204  ActorAlloc(EnemyZombieInit, 0x13F4); ActorClearGameFields(twin)
 * 0045321b  twin+0x1390 = host+0x1390           ; the host's descriptor
 * 00453235  REP MOVSD, 0x18 dwords, host+0x40 -> twin+0x40
 * 0045323d  twin+0x13A4 = host
 * 00453243  twin+0x130C = host+0x130C
 * 00453249  twin+0x1F4 = 9 ; twin+0x11C = 999
 * ```
 *
 * `[proved]`. The twin's own `EnemyZombieInit` then runs from the host's
 * descriptor, keeping type 9 (`CMP word ptr [ESI + 0x1f4], 0x9` before the
 * descriptor's type is read), and its `ActorInitHitPoints` (`FUN_0040A8B0`)
 * **overwrites the 999**: it clamps `obj+0x11E` -- which the clear left at 0
 * and nothing here writes -- plus the difficulty delta into `[1, 300]` and
 * stores that at `obj+0x11C`. So the twin has the minimum, not 999.
 *
 * [port-only] as a function: the arm is inline in the engine.
 */
export function ZombieAllocTwin(host: ZombieActor, rng?: Rng,
                                events?: Events): Actor {
  const hp = ActorInitHitPoints(
    { hp: 0 } as Parameters<typeof ActorInitHitPoints>[0], SpawnClass.Zombie);
  const twin = ActorSpawn(ZombieTwinAt(host.at), SpawnClass.Zombie,
                          ZOMBIE_TWIN_CHAR_TYPE, "twin", {
    visible: true,
    hp,
    pos: { ...host.pos },
    vel: { ...host.vel },
    accX: host.accX, accY: host.accY, accZ: host.accZ,
    pitch: host.pitch, yaw: host.yaw, roll: host.roll,
    shotCentre: { ...host.shotCentre },
    condition: host.condition,
    // `obj+0x1390`, the descriptor: what `EnemyZombieInit` reads the state
    // bytes and the flags word from.
    initialState: host.initialState,
    attackState: host.attackState,
    descFlags: host.descFlags,
  }, rng, events);
  if (twin.cls === SpawnClass.Zombie) twin.zom.twinHost = host.at;
  return twin;
}

/**
 * `ZombieTwinFollowHost` — `FUN_00453290`. The twin's whole update.
 *
 * ```
 * 0045329f  g_cur_enemy = g_cur_actor = obj
 * 004532ab  FLD [EBX + 0x138c] / FCOMP 0.0 / TEST AH, 0x41 / JNZ despawn
 * 004532c2  TEST [host + 0x34], 0x4000000 / JNZ despawn     ; host dead
 * 004532d0  CALL ZombieOnShot(obj)
 * 004532db  obj+0x34 |= 0x80040000
 * 004532e7  TEST [host + 0x34], 0x10000000 / JZ copy
 * 004532f1  obj+0x34 &= ~0x8100                              ; and no copy
 * 004532f9  copy: 0x18 dwords host+0x40 -> obj+0x40, then 0x1320, 0x1324,
 *           0x1B4, 0x1B8, 0x194, 0x198
 * 00453353  CALL ZombieAdvanceMotion(obj)                    ; the draw
 * 0045337c  obj+0x70 = the view transform of obj+0x100..0x108
 * 004533cb  CALL RegisterForShotTest(obj)
 * 004533da  despawn: CALL ActorDespawn(obj)
 * ```
 *
 * `[proved]`. So the twin despawns on the frame after its alpha reaches 0 --
 * `TEST AH, 0x41` takes "equal" as well as "below" -- or when the host is
 * killed. It is not counted into either enemy count and never registers for
 * camera tracking, but it **does** register for the shot test with no
 * immunity: a shot the twin is in front of is its.
 *
 * The copy is the host's transform block -- position, velocity, the three
 * accelerations, the three angles and `obj+0x70` -- and its motion record.
 * `obj+0x1320`/`obj+0x1324` are the head aim's two angles on this class
 * (`HeadAimWords`), and `obj+0x194`/`0x198`/`0x1B4`/`0x1B8` the skinned
 * model's frame counters and clip; the port keeps that record as `motion`,
 * `playTicks` and the one-shot `action`, which are what is copied. The
 * model's blend words are not in the copied range, so the twin does not
 * cross-fade when the host does: it is handed the new clip at the frame the
 * host is on. The director has already stepped the twin's own clock this
 * frame (`ActorAdvanceMotion`, before the update, as for every actor); the
 * copy overwrites it, so the twin is drawn on the host's post-advance frame,
 * which is where the engine draws it.
 */
export function ZombieTwinFollowHost(obj: ZombieActor, f: ClassFrame): void {
  const host = obj.zom.twinHost >= 0 ? ActorByAt(obj.zom.twinHost) : undefined;
  if (!(obj.alpha > 0)) { ActorDespawn(obj); return; }
  // A host the port has already taken out of the pool is a dead one to the
  // twin: the engine's pointer would still read its last `obj+0x34`, which a
  // despawn raises `0x80018000` on and a death `0x4000000`.
  if (!host || host.despawned || (host.flags & ActorFlag.Dead) !== 0) {
    ActorDespawn(obj);
    return;
  }
  ZombieOnShot(obj);
  obj.flags |= TWIN_EVERY_FRAME;
  if ((host.flags & ActorFlag.Committed) !== 0) {
    obj.flags &= ~TWIN_HOST_COMMITTED_CLEARS;
  } else {
    ZombieTwinCopyHost(obj, host);
  }
  // `ZombieAdvanceMotion` (`FUN_00454860`): the draw, and with it the node
  // hook, which runs the `0x1C7C` arm's clock. The clock half is the
  // director's. Inside the same draw `SkeletonApplyRootMotion` calls the
  // pose hook at `obj+0x12F0` before any node, and `EnemyZombieInit` put
  // `ZombiePushOutOfWorldAndActors` there for the twin as for every class-0x30
  // actor (`0x00452E4A`, unconditional). Both push bits are down on a twin
  // (`ZombieInitTwinFade`), so what it does here is the ground snap and the
  // shove timer.
  ZombiePushOutOfWorldAndActors(obj);
  ActorRunNodeDrawHooks(obj, ZombieDrawBonePart, f);
  // The draw's shadow, on the twin -- this routine pointed `g_cur_actor` at
  // it (`0x004532A5`) -- which `TWIN_EVERY_FRAME`'s `0x80000` refuses.
  DrawSkinnedModelAndShadow(obj);
  // `obj+0x70`: the port keeps the point in world space and lets the shot
  // test take the depth (`RegisterForShotTest`). The point is `obj+0x100`,
  // the tracked bone the walk recorded, not lifted -- the twin never calls
  // `ActorRegisterCameraPoint`. Filed whatever the class, as the engine
  // files it: the list is the crowd push's as well as the pick's, and the
  // pick passes over a class the renderer still picks (`ShotTestPickedHere`).
  obj.shotCentre.x = obj.lookAt.x;
  obj.shotCentre.y = obj.lookAt.y;
  obj.shotCentre.z = obj.lookAt.z;
  RegisterForShotTest(obj, f.host);
}

/**
 * The copy at `0x004532F9..0x00453351`: the host's transform block and motion
 * record onto the twin. See {@link ZombieTwinFollowHost} for what each word is
 * here. [port-only] as a function.
 */
function ZombieTwinCopyHost(obj: ZombieActor, host: Actor): void {
  obj.pos.x = host.pos.x; obj.pos.y = host.pos.y; obj.pos.z = host.pos.z;
  obj.vel.x = host.vel.x; obj.vel.y = host.vel.y; obj.vel.z = host.vel.z;
  obj.accX = host.accX; obj.accY = host.accY; obj.accZ = host.accZ;
  obj.pitch = host.pitch; obj.yaw = host.yaw; obj.roll = host.roll;
  obj.shotCentre.x = host.shotCentre.x;
  obj.shotCentre.y = host.shotCentre.y;
  obj.shotCentre.z = host.shotCentre.z;
  if (host.cls === SpawnClass.Zombie || host.cls === SpawnClass.CarriedZombie) {
    obj.zom.headPitch = host.zom.headPitch;
    obj.zom.headYaw = host.zom.headYaw;
  }
  obj.motion = host.motion;
  obj.playTicks = host.playTicks;
  obj.rootCursor = host.rootCursor;
  obj.action = host.action ? { ...host.action } : null;
  obj.rootActionCursor = host.rootActionCursor;
  obj.fadeFrom = null;
  obj.fade = 0;
}

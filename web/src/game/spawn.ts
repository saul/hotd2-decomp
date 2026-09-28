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
import { ActorModelScale } from "./root_motion";
import { SkeletonBuildAndPose } from "./skeleton";
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
 * `ActorBuildSkinnedModel` — `FUN_00410440`, for what it leaves on
 * the actor.
 *
 * The routine builds the skeletal model record at `obj+0x194`, and that
 * record is the renderer's hierarchy here -- but for an actor that carries
 * the whole block (`Actor.skel`, `game/skeleton.ts`), which gets the whole
 * build. What it does to every actor's own state is five things, and all
 * five are ported:
 *
 * * **The size**, `model+0x116C`, first and from the character type alone:
 *   {@link ActorModelScale}, the jump table at `0x00410451`..`0x00410490`.
 *   Every skinned actor gets it, not only the ones that carry the block --
 *   `Actor.scale` is what the renderer draws the whole model under and what
 *   the root motion steps by (`game/root_motion.ts`).
 * * **Each bone's hit sphere**, `+0x78` and `+0x7C..+0x84` of its record
 *   (`obj + 0x20C + bone*0x90`): `SkeletonBuildAndPose` (`FUN_00410590`)
 *   walks the tree through `SkeletonWalkNode` (`FUN_004107E0`), which reads
 *   row `bone - 1` of `g_character_part_tables` (`0x004D032C`) and takes it
 *   **only when the row's own slot is the node's**:
 *
 *   ```
 *   00410830  MOV  EDX, dword ptr [EAX + -0x14]   ; the row's slot
 *   00410833  CMP  EDX, dword ptr [EDI]           ; the node's
 *   00410835  JNZ  0x00410876                     ; not ours: zero it
 *   00410837  FLD  float ptr [ECX + 0x1300]       ; g_cur_actor+0x1300 = model+0x116C
 *   0041083D  FMUL float ptr [EAX + -0x4]         ; the row's radius
 *   00410840  FSTP float ptr [ESI + 0x78]         ; the record's
 *   ...       +0x7C..+0x84 = the row's centre     ; 0x0041085D..0x00410871
 *   00410876  MOV  [ESI+0x78], 0; [ESI+0x84], 0; [ESI+0x80], 0; [ESI+0x7C], 0
 *   ```
 *
 *   -- the radius **times the size just written**, and the centre as the
 *   row has it, because the centre goes through the node matrix, which
 *   carries the size already. So a civilian drawn at 0.9 is shot through
 *   spheres 0.9 as wide, at bones 0.9 as far apart. The record is
 *   `Actor.boneRadius` and `Actor.boneCentre`, written here for every bone so
 *   that every reader -- both shot tests, the blood spray, the dropped-prop
 *   test -- reads the engine's numbers, and a class that writes over one
 *   (the frog's bone 2, the weapon hands) still wins, because its `Init`
 *   runs after this.
 *
 *   The slot test is what several types' rows need. Some types' pointers
 *   are a stub that ends in `-1` after a row or two, and their later "rows"
 *   are the next type's table read out of step; on others a real row names
 *   another model than the node does -- `zsass`'s bones 5 and 8 name the
 *   armed hands `EnemyThrowerInit` gives it (`0x1FA2`, `0x1F9E`) where the
 *   skeleton names the bare ones. Every row with a radius that the test
 *   refuses is `GATED` in `tools/verify_combat.py`, which derives the list
 *   from the exe and fails when it moves. So a `zsass` is born with
 *   both weapon hands unshootable, `EnemyThrowerInit` arms them without
 *   touching the radius, and only `ThrowerStateRearm` gives them a sphere,
 *   after a throw.
 *
 *   The bundle carries a row only where its radius is positive, so a bone
 *   whose row has none gets a zero centre here where the engine would copy
 *   the row's. Every reader of the centre also reads the radius, and none of
 *   them draws or tests a zero one, except the blood at a bone a *mesh* was
 *   hit on -- and the three types with mesh bones have positive rows there.
 *
 *   It is written once, here, and only here: op 0x27's later
 *   `SetScale` (`CivilianRunScript`, `FUN_0048B9E0`) changes the drawn size
 *   and leaves every radius as the build made it, as the engine's does.
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
  // `M[0x116C] = scale by character type`, the build's first write.
  obj.scale = ActorModelScale(obj.charType);
  // `SkeletonWalkNode`'s sphere, for every bone: `R+0x78 = obj+0x1300 *
  // row.radius` and `R+0x7C = row.centre` when the row's slot is the node's,
  // and all four zeroed when it is not. `fround`, because the engine's
  // radius is an `FSTP` to a float.
  for (const b of type?.bones ?? []) {
    const k = String(b.bone);
    if (b.hit_slot !== undefined && b.hit_slot === b.slot) {
      const c = b.hit_centre ?? [0, 0, 0];
      obj.boneRadius[k] = Math.fround(obj.scale * (b.hit_radius ?? 0));
      obj.boneCentre[k] = [c[0], c[1], c[2]];
    } else {
      obj.boneRadius[k] = 0;
      obj.boneCentre[k] = [0, 0, 0];
    }
  }
  // `M[0x64] = 3` -- drawn, root motion -- and the part records, each
  // `{0, 1}`: the half of the build every skinned actor has.
  obj.motionFlags = MOTION_FLAGS_INIT;
  obj.partVisible = new Array<number>(type?.parts?.length ?? 0).fill(1);
  const skel = obj.skel;
  if (skel) {
    // An actor that carries the model block (`game/skeleton.ts`, class 0x14
    // alone today) gets the whole build, from its own `Init`, which has put
    // the motion in `+0x20` first:
    //
    // ```
    // M[0x116C] = scale by character type
    // M[0]=0; M[0x10]=0; M[0x18]=0; M[0x08]=0; M[0x30]=0; M[0x28]=0
    // M[0x37]=0; M[0x36]=0; SkeletonAssignSubtreeTrack(0, 0)
    // M[0x64] = 3; M[0x68] = 5                 ; drawn, root motion; Z, Y, X
    // parts: M[0x40] = ActorAllocSub(n * 8), each {0, 1}
    // SkeletonBuildAndPose(M, pos, recs)       ; the first pose, and the 0x80
    // ```
    //
    // (The size is written above, for every actor.)
    skel.counter = 0;
    skel.prevFrame = 0;
    skel.frame = 0;
    skel.cursor = 0;
    skel.weightDiv = 0;
    skel.weightOrigin = 0;
    skel.flags = 0;
    skel.order = 5;
    SkeletonBuildAndPose(obj, skel);
    obj.motion = skel.motion;
    obj.playTicks = 0;
  } else if ((type?.bones ?? []).some((b) => b.parent === null)) {
    obj.flags |= ActorFlag.ShootPerBone;
  }
  ActorClaimHitSlot(obj);
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

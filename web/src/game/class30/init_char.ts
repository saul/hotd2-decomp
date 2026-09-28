/**
 * `EnemyZombieInit`'s per-character-type tail, and the three flag moves it
 * opens with.
 *
 * The head of this routine is not about the character type at all: it takes
 * three bits the spawn record put in `obj+0x34` and `obj+0x136C` and **moves**
 * them into `obj+0x38`, clearing two of them at the source. That is why
 * carrying the descriptor's flags word onto the actor — which this port does —
 * is not enough on its own: after this runs, `obj+0x34` no longer holds the
 * bit, and the only place the fact survives is `obj+0x38`.
 *
 * The one that shows is `obj+0x34` bit 1. Exactly two spawn records in the
 * shipped game set it, both class 0x30 in stage 3's block 2 step 4 — the two
 * axe men, `init_flags 0x20002` — and the bit it becomes,
 * `ZombieAux.StandThrowRetire`, is read in exactly one place in the whole
 * image: `ZombieStateStandAndThrow`'s ending. Without it those two walked
 * their descriptor's 25 units backwards through the wall of the building they
 * stand against, because the walk is what the *other* seven state-33 spawns
 * do.
 */
import type { Events } from "../../core/events";
import { ActorFlag, ZombieAux, ZombieFlag2, type ZombieActor } from "../actor";
import { SPAWN_RIDE_CARRIER, ZombieAttachToCarrier } from "./carrier";
import { EnemyZombieTakeWeaponLoopSe } from "./weapon_loop";
import { ZombieAllocTwin } from "./twin";

/**
 * The two bits this routine consumes out of the spawn record's flags word.
 *
 * They are the same two `MarkActorShot` (`FUN_00404DB0`) later uses to name
 * the player who fired — {@link ActorFlag.HitByPlayer0} and
 * {@link ActorFlag.HitByPlayer1} — which is *why* the routine clears them: a
 * descriptor bit left in `obj+0x34` would read as a shot on the actor's first
 * drain. One word, two meanings, separated by when they are written.
 */
const SPAWN_STAND_THROW_RETIRE = 0x2;
const SPAWN_TURN_TOWARD_CAMERA = 0x4;

/**
 * `EnemyZombieInitByCharType` — `FUN_00452FD0`.
 *
 * **The head, and the arms.** After the flag moves the engine branches on
 * the character type: 9 (the twin) and 0x12 (`znele`) set up a faded draw --
 * {@link ZombieFadeType} -- and 0x12 also allocates the twin beside itself,
 * 0xC branches on the body condition, and 2, 3 and 0xE give a hand a
 * collision mesh -- {@link ZombieBoneMeshType}. The fade arms and the mesh
 * arms are ported; 0xC's is not. (This comment used to say type 9 "becomes a
 * corpse". It is drawn at a quarter alpha and fades out; and that 0xE "loads
 * a prop", which is the mesh.)
 *
 * The fourth arm — `obj+0x34` bit 3 — **is** ported, and it is not a flag
 * move at all: it re-reads the descriptor's position and yaw as an offset on
 * `g_carrier_object` and seats the actor there. It lives in
 * `class30/carrier.ts` with the seat it calls, because the two are one
 * mechanism. This comment used to say the bit meant "spawned in the air" and
 * that `ZombieFlag2.AttachedToCarrier` "already carries it"; nothing set that
 * flag, nothing read it, and stage 5 block 2's four passengers stood at the
 * world origin for it.
 *
 * Types 2 and 3 this file used to describe as *"load a held prop and play a
 * spawn cry"*. Neither: the "prop" is the collision mesh, and the sound is a
 * share in the scene's one looping held-weapon SE, which runs until an actor
 * dies -- see {@link ZombieInitBoneMeshes} and
 * {@link EnemyZombieTakeWeaponLoopSe}.
 */
export function EnemyZombieInitByCharType(obj: ZombieActor,
                                          events?: Events): void {
  // `00453000  if (obj+0x136C & 0x20) obj+0x38 |= 8`. Raised, not moved: the
  // source bit stays where it is. `EnemyZombieInit` seeds `obj+0x136C`'s low
  // half from the descriptor's `+0x20` word (`00452EAF`) before calling this,
  // so the 55 shipped class-0x30 spawns that set it reach the arm -- which is
  // what draws them through the gun lights (`ZombieAux.SceneLit`).
  if (obj.flags2 & ZombieFlag2.DrawVariantSource) {
    obj.flags38 |= ZombieAux.SceneLit;
  }
  // `0045300B  if (obj+0x34 & 2) { obj+0x34 &= ~2; obj+0x38 |= 0x10 }`
  if (obj.flags & SPAWN_STAND_THROW_RETIRE) {
    obj.flags &= ~SPAWN_STAND_THROW_RETIRE;
    obj.flags38 |= ZombieAux.StandThrowRetire;
  }
  // `00453045  if (obj+0x34 & 4) { obj+0x34 &= ~4; obj+0x38 |= 0x20 }`
  if (obj.flags & SPAWN_TURN_TOWARD_CAMERA) {
    obj.flags &= ~SPAWN_TURN_TOWARD_CAMERA;
    obj.flags38 |= ZombieAux.TurnTowardCameraEye;
  }
  // `0045301D  TEST byte ptr [EBP + 0x34], DL` with `DL = 8` — the fourth
  // arm, and the only one that moves the actor rather than moving a bit.
  //
  // It re-reads the descriptor's position and yaw as **carrier-local**: the
  // position goes to `obj+0x13D8` and the yaw to `obj+0x135C`, the flag that
  // makes `EnemyZombieUpdate` re-seat the actor every frame goes up, the seat
  // runs once here so the actor is on the carrier from frame one, and the
  // carried bit goes up **after** the call and not before. See
  // `class30/carrier.ts` for `ZombieAttachToCarrier` and for what settled it.
  if (obj.flags & SPAWN_RIDE_CARRIER) {
    // `00453022/00453025/0045303D  obj+0x13D8/E0/DC = obj+0x40/48/44`, and
    // `00453034  obj+0x135C = obj+0x68`.
    obj.strikeStart.x = obj.pos.x;
    obj.strikeStart.y = obj.pos.y;
    obj.strikeStart.z = obj.pos.z;
    obj.zom.throwHand = obj.yaw;
    // `00453028  OR ECX, 0x10000000`, stored to `obj+0x136C` at `00453037`.
    obj.flags2 |= ZombieFlag2.AttachedToCarrier;
    ZombieAttachToCarrier(obj);
    // `OR EAX, 0x100000` on the word re-read at `00453058` — after the call.
    obj.flags2 |= ZombieFlag2.Carried;
  }
  // The switch's types-2-and-3 and 0xE arms: the flags and the meshes,
  // then `00453133`, the sound.
  ZombieInitBoneMeshes(obj);
  EnemyZombieTakeWeaponLoopSe(obj, events);
  // The two arms that set up a faded draw.
  if (obj.charType === ZombieFadeType.Twin) ZombieInitTwinFade(obj);
  else if (obj.charType === ZombieFadeType.Znele) {
    ZombieInitZneleFade(obj, events);
  }
}

/**
 * The three character types `EnemyZombieInitByCharType`'s switch gives a
 * collision mesh on a hand, named for their `pol/` files through
 * `g_character_skeletons`.
 */
export enum ZombieBoneMeshType {
  /** `znchain.bin` -- case 2, which raises one more bit and falls into 3. */
  Znchain = 2,
  /** `zndina.bin`. */
  Zndina = 3,
  /** `znken.bin` -- its own arm, bone 5 alone. */
  Znken = 0xe,
}

/** The two bones the arms name, by record: `obj+0x550..` and `obj+0x700..`. */
const MESH_BONE_RIGHT = 5;
const MESH_BONE_LEFT = 8;

/**
 * The mesh arms of `EnemyZombieInitByCharType` (`FUN_00452FD0`):
 *
 * ```
 * case 2:    obj+0x136C |= 0x400                               ; falls into 3
 * case 3:    obj+0x34 |= 0x400
 *            rec(5)+0x74 |= 0x51; rec(5)+0x88 = tail+0x10; rec(5)+0x78 = 0
 *            rec(8)+0x74 |= 0x51; rec(8)+0x88 = tail+0x10; rec(8)+0x78 = 0
 *            ...the weapon loop's take, EnemyZombieTakeWeaponLoopSe
 * case 0xE:  rec(5)+0x74 |= 0x51; rec(5)+0x88 = tail+0x10; rec(5)+0x78 = 0
 * ```
 *
 * `[proved]`, `0x004530BE..0x00453164` (the records are `obj+0x550`/`0x564`/
 * `0x554` and `obj+0x700`/`0x714`/`0x704`: bone 5's and bone 8's `+0x74`,
 * `+0x88` and `+0x78`). `+0x74 |= 0x51` and `+0x88` are what make
 * `ShotTestBoneTree` (`FUN_00404750`) test the bone against the mesh
 * instead of its sphere -- {@link Actor.boneColi} -- and the radius goes to
 * zero with it. The blob is the tail's `+0x10`, a relocated pointer into the
 * collision buffers, and every shipped spawn of the three names one.
 *
 * `0x400` on `obj+0x34` is {@link ActorFlag.NoDismember}: neither weapon
 * carrier comes apart. `0x400` on `obj+0x136C` is
 * {@link ZombieFlag2.EntryClipPlaying}, which `ZombieStateHoldAtRange`
 * already reads and clears and nothing in the port raised.
 *
 * `[port-only]` as a function, like {@link EnemyZombieTakeWeaponLoopSe}: the
 * engine's is two `switch` arms.
 */
export function ZombieInitBoneMeshes(obj: ZombieActor): void {
  const t = obj.charType;
  if (t === ZombieBoneMeshType.Znken) {
    ZombieGiveBoneMesh(obj, MESH_BONE_RIGHT);
    return;
  }
  if (t !== ZombieBoneMeshType.Znchain && t !== ZombieBoneMeshType.Zndina) {
    return;
  }
  // Case 2's one write, before it falls into case 3.
  if (t === ZombieBoneMeshType.Znchain) {
    obj.flags2 |= ZombieFlag2.EntryClipPlaying;
  }
  obj.flags |= ActorFlag.NoDismember;
  ZombieGiveBoneMesh(obj, MESH_BONE_RIGHT);
  ZombieGiveBoneMesh(obj, MESH_BONE_LEFT);
}

/**
 * One record's three writes. A tail whose `+0x10` did not resolve to a blob
 * leaves the record flagged with nothing to test -- `CMP [rec+0x88],-1` in
 * `ShotTestBoneTree` -- which the port has as no mesh and no radius, and the
 * same nothing.
 */
function ZombieGiveBoneMesh(obj: ZombieActor, bone: number): void {
  const k = String(bone);
  if (obj.boneMeshColi) obj.boneColi[k] = obj.boneMeshColi;
  obj.boneRadius[k] = 0;
}

/**
 * The two character types `EnemyZombieInitByCharType`'s switch gives a faded
 * draw, named for their `pol/` files through `g_character_skeletons`.
 */
export enum ZombieFadeType {
  /**
   * `znjikken1.bin`. No spawn record in the shipped game has it; type 0x12's
   * arm allocates one beside itself, and `EnemyZombieInit` (`FUN_00452DA0`)
   * gives it `ZombieTwinFollowHost` (`FUN_00453290`) for its update.
   */
  Twin = 9,
  /** `znele.bin` -- thirteen spawns, all stage 6. */
  Znele = 0x12,
}

/** `MOV [EBP + 0x138C], 0x3E800000` at `0x0045318F`: the twin's alpha. */
export const TWIN_ALPHA = 0.25;
/** `0x3C888889` at `0x00453199` -- 1/60 as an f32, the twin's fade step. */
export const TWIN_FADE_STEP = Math.fround(1 / 60);
/** `0x3D088889` at `0x004531DF` -- 1/30 as an f32, `znele`'s fade step. */
export const ZNELE_FADE_STEP = Math.fround(1 / 30);
/** `0x42C80000` at `0x004531A3` and `0x004531E9`: 100 draws before a step. */
export const FADE_DELAY = 100.0;
/**
 * `AND ECX, 0x9fffffff` (`0x0045317A`, `0x004531C8`): both fade arms take
 * the actor out of both pushes that `EnemyZombieInit` has just put it in.
 */
const FADE_NO_PUSH = ZombieFlag2.CollideWorld | ZombieFlag2.CollideActors;
/**
 * `OR ECX, 0x48500` at `0x004531C0`, on `znele`'s `obj+0x34`: no head aim, no
 * shot test, no dismemberment, shot-immune -- until its fade-in is done and
 * `ZombieDrawBonePart` lowers the shot test and the immunity again.
 */
const ZNELE_FADING_FLAGS = ActorFlag.NoHeadAim | ActorFlag.NoShotTest
  | ActorFlag.NoDismember | ActorFlag.ShotImmune;

/**
 * The type-9 arm of `EnemyZombieInitByCharType` (`FUN_00452FD0`),
 * `0x00453174..0x004531B0`:
 *
 * ```
 * 0045317a  AND ECX, 0x9fffffff               ; obj+0x136C, no pushes
 * 00453180  OR  EAX, EBX                      ; obj+0x1368 |= 0x20
 * 0045318f  MOV [EBP + 0x138c], 0x3e800000    ; alpha 0.25
 * 00453199  MOV [EBP + 0x1388], 0x3c888889    ; step 1/60
 * 004531a3  MOV [EBP + 0x134c], 0x42c80000    ; wait 100.0
 * ```
 *
 * `[proved]`. The twin is drawn at a quarter alpha from its first frame;
 * `ZombieDrawBonePart`'s `0x1C7C` arm waits out the hundred and then takes it
 * down, and `ZombieTwinFollowHost` despawns it at 0.
 */
function ZombieInitTwinFade(obj: ZombieActor): void {
  obj.flags2 &= ~FADE_NO_PUSH;
  obj.zom.fadeDraw = true;
  obj.alpha = TWIN_ALPHA;
  obj.zom.fadeStep = TWIN_FADE_STEP;
  obj.zom.fadeDelay = FADE_DELAY;
}

/**
 * The type-0x12 arm of `EnemyZombieInitByCharType` (`FUN_00452FD0`),
 * `0x004531B1..0x0045325F`, the draw half:
 *
 * ```
 * 004531c0  OR  ECX, 0x48500                  ; obj+0x34
 * 004531c8  AND ESI, 0x9fffffff               ; obj+0x136C, no pushes
 * 004531ce  OR  EDX, EBX                      ; obj+0x1368 |= 0x20
 * 004531d0  MOV [EBP + 0x138c], 0x0           ; alpha 0
 * 004531df  MOV [EBP + 0x1388], 0x3d088889    ; step 1/30
 * 004531e9  MOV [EBP + 0x134c], 0x42c80000    ; wait 100.0
 * ```
 *
 * `[proved]`. So a `znele` is drawn, invisible, from its first frame; after a
 * hundred draws of its `0x1C6C` node `ZombieDrawBonePart` fades it in over
 * thirty and gives it back its pushes and its shot test.
 *
 * Then, unless `obj+0x34` has `0x10000000` (`TEST EAX, 0x10000000` at
 * `0x004531DA`, `JNZ` past the allocation at `0x00453202`), the twin --
 * `ZombieAllocTwin` in `class30/twin.ts`.
 */
function ZombieInitZneleFade(obj: ZombieActor, events?: Events): void {
  obj.flags |= ZNELE_FADING_FLAGS;
  obj.flags2 &= ~FADE_NO_PUSH;
  obj.zom.fadeDraw = true;
  obj.alpha = 0;
  obj.zom.fadeStep = ZNELE_FADE_STEP;
  obj.zom.fadeDelay = FADE_DELAY;
  if ((obj.flags & ActorFlag.Committed) === 0) {
    ZombieAllocTwin(obj, undefined, events);
  }
}

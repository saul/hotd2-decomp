/**
 * The object struct.
 *
 * One TS field per exe field, at the offset named in the comment, because the
 * offsets are how the port gets checked. Everything here is plain data: no
 * three.js nodes, no functions, no `Map` or `Set` — the whole actor list goes
 * through `structuredClone` and then `JSON.stringify` on every save.
 *
 * The renderer binds to an actor by `at` and owns the nodes; it holds no state
 * of its own that a snapshot would need.
 */
import type { ArcStage, CharacterPlacement, TargetScriptJson, ZombieEntryTail }
  from "../bundle/characters";
import { HIT_SLOT_NONE } from "./globals";
import { ActorModelScale } from "./root_motion";
import type { CivilianState } from "./class10/state";
import type { Boss4Block } from "./class19/state";
import { SpawnClass } from "./spawn_class";
import { vec3, type Vec3 } from "./vec";
import { makeHumanoidTail, type HumanoidTail } from "./class25/state";
import { makeOneHitTargetTail, type OneHitTargetTail }
  from "./class20/state";
import { makeRescueTargetTail, type RescueTargetTail }
  from "./class21/state";
import { makeBoss2Tail, type Boss2Tail } from "./class14/state";
import type { SkeletonModel } from "./skeleton";
import type { ShotRay } from "./host";
import { makeJudgmentTail, type JudgmentTail } from "./class22/state";
import { makeJudgmentCompanionTail, type JudgmentCompanionTail }
  from "./class23/state";
import { makeFrogTail, type FrogTail } from "./class11/state";
import { makeOwlTail, type OwlTail } from "./class43/state";
import { makeScriptedPropTail, type ScriptedPropTail } from "./class13/state";
import { makeScriptedProp12Tail, type ScriptedProp12Tail }
  from "./class12/state";
import { makeVehicleTail, type VehicleTail } from "./class26/state";
import { makePathRidingPropTail, type PathRidingPropTail }
  from "./class28/state";
import { makeBatTail, type BatTail } from "./class46/state";
import { makeBoss3Tail, type Boss3Tail } from "./class45/state";
import { makeBoss5Tail, type Boss5Tail } from "./class32/state";
import { makeHordeTail, type HordeTail } from "./class40/state";
import { makeWormTail, type WormTail } from "./class42/state";
import { makeFishTail, type FishTail } from "./class51/state";
import { makeMouseTail, type MouseTail } from "./class52/state";
import { makeCatTail, type CatTail } from "./class53/state";
import { makeScriptedSceneryTail, type ScriptedSceneryTail }
  from "./class33/state";
import { makeSetPiecePropTail, type SetPiecePropTail }
  from "./class24/state";
import { makeThrowerTail, type ThrowerTail } from "./class31/state";
import { makeZombieTail, type ZombieTail } from "./class30/state";
import { makeResultCardTail, type ResultCardTail } from "./class61/state";

/**
 * `model+0x64` — the **motion block's** flag word, which is `obj+0x1F8`.
 *
 * The skeletal model record is embedded in the object at `obj+0x194`, so every
 * `model+n` in the decompiler is `obj+0x194+n`; `model+0x60` is
 * {@link Actor.charType} at `obj+0x1F4` and this word sits next to it.
 */
export enum MotionFlag {
  /**
   * Bit 0 — **the skeleton is drawn**, and the ground shadow with it.
   *
   * `SkeletonEmitNode` (`FUN_004114C0`) runs a node's draw hook, updates its
   * hit-centre and writes the camera point only while it is set —
   * `TEST byte ptr [ECX + 0x64], 0x1` / `JZ` at `0x00411505`, `ECX` being
   * `g_skeleton_model` — so with it clear **no node of the skeleton is
   * drawn**, hook and all; the pose itself is walked either way.
   * `ActorDrawShadow` (`FUN_0040A590`) and `ActorDrawGroundShadow`
   * (`FUN_0040A620`) both test it again before the shadow disc.
   * `ActorBuildSkinnedModel` sets it; class 0x14's entrances clear it to hide
   * the boss under the water and set it again. `[proved]`
   *
   * It is **not** the gate on the vertex-blended parts: those have a byte
   * each, {@link Actor.partVisible}, and `ActorSetPartVisibility`
   * (`FUN_00409D10`) is what writes them. Every state that hides an actor
   * writes both, and `ZombieStateAwaitCivilianOrder` and class 0x14's
   * entrances write this and only part 0's byte.
   */
  Drawn = 0x01,
  /**
   * **Does this clip's root translation carry the actor?**
   *
   * `SkeletonApplyRootMotion` (`FUN_00410C50`) tests exactly this and nothing
   * else before it touches the position — `if ((*(byte *)(model + 100) & 2) !=
   * 0)` — and the same test at the end of the routine decides whether the draw
   * keeps the clip's horizontal root translation or replaces it with
   * `MatrixTranslate(0, root.y, 0)`. The two are one switch: the translation
   * either moves the object or moves the pose, never both. `[proved]`
   */
  RootMotion = 0x02,
  /**
   * Bit `0x04` — **the ground-anchored draws trace the floor.**
   *
   * Two readers, and they make the same choice `[proved]`:
   * `SpawnGroundRingEffect` (`FUN_00407DA0`, `TEST byte ptr [EDI+0x1F8], 4`
   * at `0x00407DCD`) puts its ring on `QueryGroundHeightAt(x, y + 20, z)`
   * with the bit up and on `obj+0x44` without it, and `ActorDrawGroundShadow`
   * (`FUN_0040A620`, `TEST AL, 4` at `0x0040A649`) does the same for the
   * shadow. `EnemyZombieInit` (`OR EDX, 4` at `0x00452E21`) and
   * `EnemyThrowerInit` (`0x00449694`) raise it straight after
   * `ActorBuildSkinnedModel`, and so does `FrogInit` (`OR EDX, 4` at
   * `0x0043A170`); `OneHitTargetInit` (`FUN_00448ED0`) raises only bit 1, so a
   * class-0x20 ring sits at the body's own height.
   */
  TraceGround = 0x04,
  /**
   * Bit `0x10` — root motion moves the actor's **height** as well.
   *
   * `SkeletonApplyRootMotion`'s two arms differ by one store: with the bit
   * clear it writes back `obj+0x40` and `obj+0x48` only, with it set it writes
   * `obj+0x44` too (`0x00410E48`). `[proved]` What it writes is the height of
   * the delta *after* the actor's rotation, not the clip root's own y: on an
   * actor rolled onto a wall that height comes from the root's z, which is
   * how a walk clip becomes a climb. Its one writer found is
   * `ThrowerStateDelayedPounce` (`FUN_0044E830`), which raises it for its wait
   * clip (`OR ECX, 0x10` at `0x0044E863`) and drops it when the wait ends;
   * `ApplyRootMotion` in `game/root_motion.ts` honours it.
   */
  RootMotionY = 0x10,
  /**
   * Bit 3 — on an odd play cursor, blend the bones by swing-twist rather
   * than linearly (`FUN_00411700`). `Class32Init` sets it; nothing the port
   * runs does. `[proved]`
   */
  SwingTwistBetween = 0x08,
}

/**
 * What `ActorBuildSkinnedModel` (`FUN_00410440`) leaves in
 * {@link Actor.motionFlags}: `MOV dword ptr [ESI + 0x64], 0x3` at 0x004104C5,
 * bytes `c7466403000000`. `[proved]`
 *
 * It is unconditional, so **every skeletal actor in the game starts drawn and
 * with root motion on** — {@link MotionFlag.Drawn} and
 * {@link MotionFlag.RootMotion}. Class 0x10's script rewrites the second on
 * every clip change; class 0x30's hiding states clear and restore the first.
 */
export const MOTION_FLAGS_INIT = 3;

/** `obj+0x34` — the object's flag word. Only the bits the port reads. */
export enum ActorFlag {
  /**
   * `obj+0x34` bit `0x2000000`. Its only readers are the two strike connects,
   * `ActorStrikeConnect` (`FUN_00456490`) and `ThrowerStrikeConnect`
   * (`FUN_0044CE60`): with it up the strike lands **without** the hit latch
   * (`PlayerTakeDamage(player, 0, motion)`, so no damage overlay) and the
   * striker leaves at once -- `ZombieReleaseAndDespawn` or `ThrowerLeave`.
   *
   * This used to say the bit is raised by the routines at `0x0045E010` and
   * `0x0045E660`. They are `ZombieStateSplitLaunch` and
   * `ZombieStateCollapseToCondition4` now that they have been read, and their
   * `OR EAX, 0x2000000` (`0045e2e1`, `0045e732`) goes into **`obj+0x136C`**
   * -- {@link ZombieFlag2.LowSphere} -- not into this word: a search on the
   * literal found the constant and not the field (`L32`, `L3`). No class-0x30
   * routine raises this bit, so what makes an actor strike-and-leave is
   * `[open]` and nothing in the port sets it.
   */
  StrikeAndLeave = 0x2000000,
  /**
   * Set by `ZombieStateBackOff` while the actor retreats and cleared when it
   * finishes. `RankEnemiesByDistance` drops these from the compacted queue.
   *
   * On class 0x31 exactly two routines raise it, both of them the retreat:
   * `ThrowerStateLeapAside` (`OR EDI, 0x20000000` at `0x0044B8BA`) and
   * `ThrowerStateWithdraw` (`0x0044EC9F`). Its readers there are
   * `ThrowerStateFallToSurface` (`0x0044BE87`: land into the leap back, not
   * the hub) and the arc landing's dust column (`0x0044D2A1`). No class-0x31
   * actor is ranked -- `RegisterForDistanceRank`'s one call is at
   * `0x0045346D`, in `EnemyZombieUpdate`. `[proved]`; the strikes raise
   * {@link Committed}.
   */
  BackingOff = 0x20000000,
  /**
   * `obj+0x34` bit 8. While it is set `ThrowerShotFeedback` forces the hit
   * result to 5, so a downed thrower only ricochets — a real invulnerability
   * window, counted down by `obj+0x133C`. `ThrowerStateDelayedPounce`
   * (`FUN_0044E830`) holds it up for the whole of its wait instead
   * (`OR CH, 0x1` at `0x0044E884`, `AND CH, 0xfe` at `0x0044E8BD`).
   */
  ShotImmune = 0x100,
  /**
   * `obj+0x34` bit `0x2000` — **this actor does not react to being shot.**
   *
   * `[proved]`, and the image reads it in exactly two places, both of which
   * refuse a reaction:
   *
   * ```
   * 004544d8  f7463400200010  TEST dword ptr [ESI + 0x34], 0x10002000
   * 004544df  0f85...         JNZ  0x00454656          ; ActorPlayHitReaction
   * 00449a95  f6c420          TEST AH, 0x20            ; EAX = obj+0x34
   * 00449a98  755c            JNZ  0x00449af6          ; ThrowerOnShot
   * ```
   *
   * `ActorPlayHitReaction` (`FUN_004544C0`) returns before it looks up a clip,
   * and `ThrowerOnShot` (`FUN_004499A0`) skips the stumble, the knockdown and
   * the tumble. The other half of that first mask is {@link Committed}.
   *
   * Every writer raises it while **something else owns the body** and clears
   * it on the way out — `ZombieStateEmerge` (`00458532 OR DH, 0x21`, cleared
   * at `0045869F AND DH, 0xdf`), `ZombieStateDelayedLeap`,
   * `ZombieStateArcScriptedEntrance`, `ZombieStateMotionCue21`'s exit,
   * `ZombieApplyScriptMode`'s `0x2400`, `ThrowerStateFallToSurface`,
   * `ThrowerStateRearm`'s exit, and `ActorPlayHitReaction`'s own alt arm
   * (`004545F5 OR CH, 0x20`), which `ZombieTickAltHitReaction`
   * (`FUN_004547C0`) takes back down when that reaction has played out.
   *
   * **It was called `ArcSpent`**, after the one consequence class 0x31's fall
   * states get from it — the second knockdown of a life finds it already up
   * and launches no further arc. That is a *use*, not the bit: the name said
   * where it sits rather than what it is, and it is why the emerge's raise was
   * never ported and an emerging zombie staggered when the engine's does not.
   */
  NoHitReaction = 0x2000,
  /** Freezes the motion advance, which is how a pose holds mid-air. */
  PoseFrozen = 0x4000,
  /** A reaction is in progress. */
  Reacting = 0x40000000,
  /**
   * Bit `0x200000` — **class 0x33 selector 1's fire.**
   *
   * `ScriptedCarrierUpdate33` (`FUN_004331D0`) raises it `0x14` frames after
   * its effect fires, and from that frame the routine returns before its own
   * ride and its own despawn: the object stops moving and stays on the field
   * drawing the `0x1AAB`..`0x1AD2` loop. `[proved] fire` from the sounds —
   * raising it plays `0x723A9`, `STAGE5_SE\CAR_FIRE_22.wav`, and the despawn
   * arm plays `0x823A9`, `CAR_FIRE_22_OFF.wav`, which is what says the bit
   * stands for a *loop that has to be stopped* rather than a one-shot.
   *
   * `[proved]` two of its readers on `obj+0x34` are `0x004332DA` and
   * `0x00433830`, both inside that routine. The sweep that found those two --
   * `TEST` against a `0x200000` mask, 39 sites -- missed two more. One is
   * `TEST dword ptr [ECX + 0x34], 0x200000` at `0x00449D8F` in
   * `ThrowerPushOutOfWorld` (`FUN_00449D40`), on whatever object the crowd
   * push found, which knocks an off-ground thrower down instead of pushing
   * it. The other is `ZombieStateEmerge`, which loads `obj+0x34` into `EAX`,
   * tests it at `0x00458509` (`a900002000`) and clears the bit at
   * `0x00458510` -- a class-0x30 actor, whose bit can only have come in on its
   * spawn record (`class30/emerge.ts`, `L3`). Whether any other bare-register
   * test holds `obj+0x34` is `[open]`; this name describes the one class that
   * provably writes it. The same bit
   * number in `obj+0x136C` is {@link ThrowerFlag.DeathLatched}, which is a
   * different word and a different fact.
   */
  FireLoop = 0x200000,
  /** `ResolveHit` sets it when the hit points reach zero. */
  Dead = 0x4000000,
  /**
   * `obj+0x34` bit `0x80000` — **no ground shadow.** `ActorDrawShadow`
   * (`FUN_0040A590`) draws the disc only while this is clear and
   * {@link MotionFlag.Drawn} is set, and `ActorDrawGroundShadow`
   * (`FUN_0040A620`) tests the pair again: `TEST dword ptr [ESI + 0x34],
   * 0x80000` (`f7463400000800`) at `0x0040A625`. `[proved]` for that reader.
   *
   * Class 0x30 raises it with the other bits of a hide or a corpse:
   * `0x90000` with {@link NoCameraTrack} in `ZombieStateEmerge` and state 28,
   * `0x90100` with {@link ShotImmune} as well in
   * `ZombieStateWaitForCameraFrame`, `0xA0000` with {@link Airborne} in both
   * corpse states. Other classes use the same bit of this word for their own
   * ends (class 0x46's `PlaceBats` writes it, class 0x14 toggles it), and
   * `L3` applies: this names the reader, not every writer's intent.
   */
  NoShadow = 0x80000,
  /**
   * Excluded from `RegisterForCameraTracking`. `ZombieStateApproach` sets it
   * while walking and clears it the moment the actor wins a permit, which is
   * how the camera comes to consider only enemies that have committed.
   */
  NoCameraTrack = 0x10000,
  /**
   * `obj+0x34` bit `0x800000` — **do not untrack this actor if it is the last
   * one.** Every routine that would raise {@link NoCameraTrack} and free the
   * actor's camera slot skips both when this bit is set and the relevant
   * enemy counter is down to one, so the killing shot of a fight is not cut
   * away from.
   *
   * `[proved]`, and it is a **spawn-record** bit rather than a state bit.
   * Nothing in `Hod2.exe` writes it: an exhaustive scan of `.text` for every
   * encoding that can set bit 23 of the dword at `+0x34` — `0D`/`81 /1` with
   * an immediate, `80 /1` on the byte at `+0x36`, `C7 /0` on the word — finds
   * no site at all, and Ghidra's own operand search finds only the five
   * `TEST ..., 0x800000` reads listed below. It reaches the actor exactly one
   * way, through `ActorInitFlags` (`FUN_00408970`), which is
   * `obj+0x34 = spawn_flags | 1`. **Six shipped spawns carry it**, all class
   * 0x30 and all starting in state 18: three in stage 1 (character type 7,
   * `init_flags 0x800000`) and three in stage 3 (type 11, `0x8800000`).
   *
   * The five readers, each `a900008000`:
   *
   * | site | routine | counter |
   * |---|---|---|
   * | `0x004565BD` | `ZombieReleasePermitAndUntrack` (`FUN_004565A0`) | `g_enemies_alive == 1` |
   * | `0x0044D068` | `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) | `g_enemies_present == 1` |
   * | `0x0044AA52` | `ThrowerStateCorpseSink` (`FUN_0044A9D0`) | `g_enemies_present == 0` |
   * | `0x0044AC3F` | `ThrowerStateCorpseBlink` (`FUN_0044AB70`) | `g_enemies_present == 0` |
   * | `0x0043BA4B` | not in a Ghidra function; outside both ported classes | `g_enemies_alive == 1` |
   *
   * The two corpse states read it with the **opposite** polarity — they
   * untrack *only* when the bit is set and the count has reached zero — which
   * is why this is named for what the bit is, not for the arm any one reader
   * takes. `ZombieStateCorpseSink` (`FUN_00454F20`) does not test it at all:
   * `00454f9f 81ca00000100` is unconditional.
   *
   * **Not** {@link ZombieFlag2.Shoved}, which is bit `0x800000` of
   * `obj+0x136C`. One value, two words, two classes.
   */
  KeepCameraWhenLast = 0x800000,
  /**
   * `obj+0x34` bit `0x10000000` — this actor is mid-attack, and **a shot may
   * not stagger it out of the attack**.
   *
   * On class 0x30 the writers are the attacks themselves:
   * `ZombieStateStrike` raises it in sub 0, before the draw (`00455a96`), and
   * `ZombieStateBackOff`'s first frame is what clears it (`00455ca1`), so it
   * spans the pick, the lunge and the whole swing. `ZombieStateStandAndThrow`
   * holds it for the throw clip, `ZombieStateTargetMotionScript` for an entry
   * whose mode is not negative, and `ZombieStateDelayedStrikeInPlace` for its
   * own swing. `[proved]`
   *
   * The readers that matter to class 0x30, from a sweep of every `TEST`
   * against a mask holding the bit and every `AND` that clears it:
   * `ActorPlayHitReaction`'s opening refusal (`004544d8`, mask
   * `0x10002000`), `ZombieStateDelayedStrikeInPlace`'s idle (`0045eab3`),
   * `ZombieTwinFollowHost` (`004532e7`, the host's bit: the twin stops
   * copying its pose while the host attacks) and `ZombieDrawBonePart`'s
   * `0x1C6C` cel arm. The last two are not ported. `ZombieStateRideCarrier`
   * (`00458a35`) reads the **carrier's**, which is another class.
   *
   * It said "will not be re-ranked out of it". `RankEnemiesByDistance`
   * reads bit 1 and {@link BackingOff} and not this. `[proved]`
   *
   * Class 0x31's strikes raise it, every one of them, and not
   * {@link BackingOff}, which is the next bit up: the pounces for the flight
   * -- `ThrowerStateLeapDown` at `0x0044B6F0`, `ThrowerStateLeapStrike` at
   * `0x0044E72B`, `ThrowerStateDelayedPounce` at `0x0044E8E6` -- and the two
   * standing swings for the swing, `ThrowerStateCloseAndStrike` at
   * `0x0044EB5F` and `ThrowerStateStrikeOnTheSpot` at `0x00450BD2`. Each
   * clears it on its own way out and `ThrowerOnShot` clears it with
   * {@link BackingOff} (`AND EAX, 0xcfffffff` at `0x00449A24`). `[proved]`
   * from a linear sweep of `.text` for every 32-bit `TEST`/`OR`/`AND` whose
   * immediate touches either bit. Its class-0x31 readers: the arc landing's
   * dust column in `ThrowerEmitGroundDust` (`0x0044D296`), which it
   * suppresses, and -- across classes -- `ZombiePushOutOfWorldAndActors` at
   * `00454944`, which pushes a zombie 1.8x as hard when the actor that
   * shoved it (`obj+0x138`, written by `ColiTestSphereAgainstActors` at
   * `0x00405F2B`) carries it. Three of the five raised {@link BackingOff}
   * here until the sweep: the dust column went up under a strike and the
   * boost never did.
   */
  Committed = 0x10000000,
  /**
   * `obj+0x34` bit `0x1000000` — this actor still has hold of something, and
   * so dies its own way: `ChooseDeathMotion` (`FUN_004560B0`) takes clip
   * `0x3F9` on it ahead of every other arm and `ZombieStateDeath6`
   * (`FUN_00454D20`) sends it to {@link ZombieState.DeathFallAndBounce}
   * instead of to a corpse.
   *
   * **It comes from the spawn record**, not from a state. `ActorInitFlags`
   * ORs the record's `+0x04` word with 1 into `obj+0x34`, and shipped
   * class-0x30 records set this bit — `web/tools/checks/death_clips.ts` counts
   * them, and `CLASS30_DEATH_CLIPS` in `hod2lib/charmotion` says which clips
   * they therefore need baked.
   *
   * `[likely]` **no routine in the image raises it**, and the method is the
   * claim's limit. A sweep of `.text` for every encoding that names the
   * constant — `81 /1` and `0D` imm32 `OR`s, the byte and word forms at
   * `+0x37`/`+0x36`, `bts`, and `B8+r` `MOV`s — finds four `OR` sites and none
   * of them is class 0x30's. What it finds instead is three readers,
   * `ChooseDeathMotion` at `0x004560DD`, `ZombieStateDeath6` at `0x00454DB8`
   * and `ZombieStateStandAndThrow`'s sub 0 at `0x004590E6`, and two clears,
   * `ZombieStateDelayedLeap` at `0x004582B0` and state 33's walk arm at
   * `0x00459469`. Two of those were themselves nearly missed — the
   * `ZombieStateDeath6` test takes its mask from `MOV EAX, 0x1000000` at
   * `0x00454DA0`, and `CivilianReleaseCaptors` clears the bit on every
   * surviving child of a dead civilian through `MOV EDX, 0xfeffffff` and an
   * `AND` on the register — so a raise built the same way, out of a register
   * or a memory word, would be invisible to this sweep too (`L32`).
   *
   * The docstring this replaced said the state was "the only reader and
   * writer". What that cost:
   * `class30/stand_throw.ts` **raised** this bit in sub 0, where the engine's
   * own arm only tests it and writes `obj+0x136C` bits `1` and `0x100000`
   * (`0x004590E6`..`0x00459109`), and that is what put two character-type-19
   * axe men — whose records do not carry it — into state 12. It makes the
   * engine's writes now; an operand sweep for `0x1000000` in the database
   * finds no class-0x30 raise of this word either.
   */
  HoldingWeapon = 0x1000000,
  /**
   * `obj+0x34` bit `0x20000` — airborne. `ZombiePushOutOfWorldAndActors`
   * skips the ground snap while it is set, which is what lets a leap arc
   * through the air instead of being pulled onto the floor every frame.
   */
  Airborne = 0x20000,
  /**
   * `obj+0x34` bit 3 — a shot landed and the actor's own update has not drained
   * it yet. `MarkActorShot` (`FUN_00404DB0`) raises it together with bit 1 or
   * bit 2, which name the player who fired.
   */
  Hit = 0x8,
  /** Bit 1: player 0 fired the shot that raised {@link Hit}. */
  HitByPlayer0 = 0x2,
  /** Bit 2: player 1 did. Neither bit set means the shooter is unknown. */
  HitByPlayer1 = 0x4,
  /**
   * `obj+0x34` bit 7 — shoot this actor **per bone**. `ShotTestSphere`
   * descends into `ShotTestSkeleton` only when it is set; without it the actor
   * is one sphere of radius `obj+0x124`.
   *
   * **The skeleton build raises it, not a script.** `SkeletonBuildAndPose`
   * (`FUN_00410590`) does `obj+0x34 |= 0x80` on `g_cur_actor` whenever the
   * character's skeleton has root nodes (`0x004105CC`..`0x004105E2`,
   * `or cl,0x80`), and that is the only instruction in the image that sets
   * the bit. It runs once, from `ActorBuildSkinnedModel` (`FUN_00410440`),
   * which every skinned class's `Init` calls after pointing `g_cur_actor` at
   * itself -- so a civilian, a zombie, a thrower and every boss carry it.
   * Six builders clear it again with `AND 0x7F` straight after: `PlaceBats`,
   * `SpawnBatWings`, `CatInit`, `SpawnGoldenFrog` and two class-0x41 builders
   * (`0x00463E50`, `0x004641F0`). `ActorBuildSkinnedModel` in `spawn.ts` is
   * where the port raises it.
   */
  ShootPerBone = 0x80,
  /**
   * `obj+0x34` bit `0x10` — test this object as **a collision mesh**, not a
   * sphere. `ProcessPlayerShots` (`FUN_00404570`) sends it to `ShotTestMesh`
   * (`FUN_00404A00`) instead of `ShotTestSphere`, and `RegisterForShotTest`
   * takes it whatever its depth. Class 0x12's stage-1 door carries it in its
   * record's flags word, class 0x26's boat raises it with `obj+0x34 |= 0x51`,
   * and so does a story switch whose descriptor names a mesh. The test is
   * `combat/shot_test.ts`'s, on {@link Actor.coliBlob} through
   * {@link Actor.coliMatrix}.
   */
  ShotTestMesh = 0x10,
  /**
   * `obj+0x34` bit `0x8000` — **not in the shot test at all.**
   * `RegisterForShotTest` (`FUN_00405160`) returns before it appends the
   * actor when the bit is set, so no shot can find it and it takes no part in
   * the crowd push either. The spawn record's flags word carries it into
   * `ActorInitFlags`; bosses raise it for their entrances, `ActorDespawn`
   * raises it with `0x80018000`, and class 0x30's order wait with `0x18000`.
   * `render/`'s pick honours it, and `class41/shot_test.ts` does the same for
   * the props.
   */
  NoShotTest = 0x8000,
  /**
   * `obj+0x34` bit `0x40000` — **this actor's head does not follow the
   * camera.**
   *
   * `[proved]` that it has exactly four readers, all `TEST dword ptr
   * [reg + 0x34], 0x40000`: the aim seed in `EnemyZombieInit` (`0x00452EAB`)
   * and `EnemyThrowerInit` (`0x004496FE`), and the bone-2 gate in front of
   * `ActorAimHeadAtCamera` in `ZombieDrawBonePart` (`0x004534E0`) and
   * `ThrowerDrawBonePart` (`0x00449FCF`). `[likely]` that nothing in `.text`
   * writes it: a scan for every `OR`/`AND` form that can name bit 18 of
   * `+0x34` -- dword immediate, byte at `+0x36`, and the register forms --
   * finds none, so it comes from the spawn record alone, through
   * `ActorInitFlags`, and holds for the actor's life.
   *
   * The shipped data is what makes it the switch between the head's two
   * readings of `obj+0x1320`: 160 of the 608 class-0x30 spawn rows across the
   * twelve bundles carry it, and so do **all 138** whose start or attack state
   * is one of the eleven class-0x30 states that read or write that word
   * (34-38, 40, 41, 43-46), all 114 civilian captors, and all twelve of class
   * 0x18's rows. None of the 42 class-0x31 rows does.
   */
  NoHeadAim = 0x40000,
  /**
   * `obj+0x34` bit `0x200` — **this actor's parts do not get swapped.**
   * `ActorSwapDamagedPart` (`FUN_004098E0`) returns before it touches
   * anything, so the bone keeps the model it has, `obj+0x78` is not cleared
   * and the `obj+0x1318` zone bit is not set.
   *
   * `[proved]`, and it is the whole body of the routine that is skipped:
   *
   * ```
   * 00409913  8b4834  MOV  ECX, dword ptr [EAX + 0x34]   ; EAX = g_cur_actor
   * 00409916  f6c502  TEST CH, 0x2                       ; bit 0x200
   * 00409919  757f    JNZ  0x0040999a                    ; the epilogue
   * ```
   *
   * **Nothing in play raises it.** `f6c502` appears twice in `.text` and the
   * other site is not an actor; the only writer is `ResolveHit`'s out-of-play
   * `|= 0xE00` (see {@link NoDismember}), and no shipped spawn record carries
   * it — across all twelve stage scripts every `init_flags` value has `0x400`
   * as its whole low three nibbles.
   */
  NoPartSwap = 0x200,
  /**
   * `obj+0x34` bit `0x400` — **this actor does not come apart.** Both of
   * `ResolveHit`'s dismemberment arms test it and take the damage-only path
   * instead: the effect table's sever code, and the torso's death wound.
   *
   * `[proved]`, two readers, both in `ResolveHit` (`FUN_00409430`):
   *
   * | site | arm |
   * |---|---|
   * | `004095BD  f6c604  TEST DH, 0x4` | effect code 1, the sever |
   * | `004096C0  f6c404  TEST AH, 0x4` | code 0 on bone 1, the death wound |
   *
   * Hit points still come off and the actor still dies — the kill block that
   * raises {@link Dead} and scores is *outside* both guards. What it stops is
   * the limb leaving and the torso being cut in half.
   *
   * **It fires in ordinary play**, which is why it is modelled rather than
   * treated as an out-of-play quirk. Four writers reach `obj+0x34`:
   *
   * * `ActorInitFlags` (`FUN_00408970`) from the **spawn record** — 68 shipped
   *   class-0x30 spawns carry it (7 in stage 1, 27 in stage 2, 22 in stage 3,
   *   12 in stage 4, none in 5 or 6), and they are the scripted ones;
   * * `ZombieStateWalkToTarget` (`FUN_0045A890`) — `0045A96A 8b4634` /
   *   `0045A96E 80cc04` / `0045A972 894634`;
   * * `ZombieApplyScriptMode` (`FUN_0045CA30`) — mode `-2` raises it and
   *   clears `0x2000`, anything else raises `0x2400`. Already ported;
   * * `EnemyThrowerInit` (`FUN_00449620`), but **only for character type
   *   0x18** (`00449810 6683f918 CMP CX,0x18` / `JNZ`) — so every `zslman` is
   *   born with it. Ported in `class31/thrower.ts`, which owns that Init.
   *
   * ...and `ResolveHit` itself raises `0xE00` — this bit and the two either
   * side — while `g_app_state` is not 6, which is out of play. No site that
   * clears it on `obj+0x34` has been found: the four `AND ..H, 0xfb` sites in
   * `.text` all write `obj+0x136C` or are CRT code, so it is a latch.
   */
  NoDismember = 0x400,
  /**
   * `obj+0x34` bit `0x800` — **the shot reports nothing.** `ResolveHit` forces
   * `g_hit_result` (`0x009A58F8`) to zero after it has worked the result out,
   * so the shot scores nothing and draws no impact.
   *
   * ```
   * 004096F6  8b4f34              MOV  ECX, dword ptr [EDI + 0x34]
   * 004096F9  f6c508              TEST CH, 0x8
   * 004096FC  740b                JZ   0x00409709
   * 004096FE  c70485f8589a000000  MOV  dword ptr [EAX*4 + 0x9a58f8], 0x0
   * ```
   *
   * `[proved]`. Like {@link NoPartSwap} nothing in play raises it — only
   * `ResolveHit`'s out-of-play `|= 0xE00`.
   */
  NoHitResult = 0x800,
}

/**
 * `obj+0x1318` — the destroyed-zone mask, and the same three bits an attack's
 * `cancel_mask` names. Only three zones exist; `g_bone_damage_zone` maps every
 * other bone to 0xFF, which the game's `& 0x1F` parks on bit 31.
 */
export enum DamageZone {
  Head = 1,
  RightArm = 2,
  LeftArm = 4,
  /** The whole mask. `zones & DamageZone.All` is the engine's own `& 7`. */
  All = 7,
}

/**
 * One waypoint: `{s16 step, s16 script, f32 x, f32 y, f32 z}`, sixteen bytes
 * in the descriptor.
 *
 * `step` is the arc's **parameter-advance rate**, not the arc kind:
 * `ActorArcBeginTo` (`FUN_0044DC70`) sets the duration to `dist2d * step`
 * rounded down to a multiple of `step`, and the stepper adds `step` a frame —
 * so the leg still takes about `dist2d` frames, at `step` times the
 * resolution. The arc *kind* is `obj+0x1354`, which `SelectActorGravityAxis`
 * (`FUN_00450CF0`) writes from the surface the actor is attached to.
 *
 * `script` selects the leg's three-stage arc motion script — see
 * `InstallArcMotionScript` (`FUN_0044DA60`).
 */
export interface PathPoint {
  step: number;
  motion_set: number;
  dest: [number, number, number];
}

/**
 * `obj+0x136C` — class 0x31's second flag word.
 *
 * Bits 6, 7 and 8 are the **surface the actor is attached to**, and they are
 * the axis everything else about a thrower turns on: they pick its motion
 * row, its attack row, and the gravity axis `SelectActorGravityAxis`
 * (`FUN_00450CF0`) writes. `ThrowerStateLeapToSurface` sets one on arrival.
 */
export enum ThrowerFlag {
  /**
   * Bit 0 — draw every part through the engine's **other** entry point.
   *
   * `ThrowerDrawPart` (`FUN_0044A200`) and `ThrowerDrawPartWithAlpha`
   * (`FUN_0044A240`) branch on it, but only while the global at `0x009A2BB4`
   * — written by `EvtOpSetSceneLighting14` — is non-zero. For character type
   * 0x17 `EnemyThrowerInit` (`FUN_00449620`) also raises `obj+0x38` bit 3 for
   * it (`OR dword ptr [ESI + 0x38], 0x8` — `834e3808` at 0x00449802).
   *
   * **What the branch does is known.** `FUN_0044A200` is
   * `if ((obj+0x136C & 1) && g_scene_light_array) SubmitSlotWithSceneLightArray
   * (FUN_004185E0) else AssetDrawSlot (FUN_00418560)` — the bit picks the
   * lit submission path. `[proved]`, from two readings that met here: one
   * survey called the effect undetermined and the other read the branch
   * targets.
   *
   * **Two writers, and they are in different classes.** It comes from the
   * spawn descriptor's `+0x20` word — 18 of the 51 shipped class-0x31 spawns
   * set it — *and* class 0x10's captor release raises it on every surviving
   * child (`CivilianReleaseCaptors`). Those children are class 0x30, whose
   * draw path never tests this bit, so that write changes nothing in the
   * shipped game. Transcribed because the engine makes it; its purpose there
   * is `[open]`.
   */
  SceneLit = 0x1,
  /** `ThrowerFindWallBeside`'s own refusal bit. */
  NoWallLeap = 0x2,
  /**
   * Bit 3 — `EnemyThrowerInit`'s character-type-0x18 arm, on seeing it, zeroes
   * `handRegrow` and `arcKind` and seeds `turnTarget` from the spawn yaw
   * `obj+0x68`: `TEST byte ptr [ESI + 0x136c], 0x8` (`f6866c13000008`) at
   * 0x0044984D, then the three stores at 0x00449859..0x00449865.
   *
   * Descriptor-seeded like {@link SceneLit}, and **no shipped class-0x31
   * spawn sets it**, so the arm is dead in the retail data. `[proved]`
   */
  SeedTurnFromSpawnYaw = 0x8,
  /**
   * Bit 4 — `ThrowerStateLeapAside` (`FUN_0044B880`) skips its random
   * side-pick when it is set (`8a836c130000` then `a810` at
   * 0x0044B917/0x0044B920). Descriptor-seeded; no shipped spawn sets it, so
   * the leap always draws its side. `[proved]`
   */
  LeapAsideFixedSide = 0x10,
  /**
   * Bit `0x800000` — this actor has left `g_enemies_alive`, the latch
   * `ThrowerRetireFromAliveCount` (`FUN_0044CFF0`) tests and sets.
   *
   * Class 0x30 keeps the same two facts in `obj+0x38` — see
   * {@link CountFlag} — and this word's 0x800000 is class 0x30's
   * {@link ZombieFlag2.Shoved}. Two classes, one offset, three meanings.
   */
  LeftAlive = 0x800000,
  /** Bit `0x1000000` — ...and `g_enemies_present`, for
   *  `ThrowerRetireFromPresentCount` (`FUN_0044D020`). */
  LeftPresent = 0x1000000,
  /** Off the ground — set with any of the three surface bits. */
  OffGround = 0x20,
  /** State 15's wall. Stance `+1`. */
  WallA = 0x40,
  /** State 14's wall. Stance `+2`. */
  WallB = 0x80,
  /** State 16's ceiling. Stance `+3`. */
  Ceiling = 0x100,
  /** The three surface bits together. */
  Surface = 0x1C0,
  /**
   * Bit 2 — **draw the bones at {@link Actor.alpha}.** `ThrowerDrawBonePart`
   * (`FUN_00449F90`) tests it per node (`f6876c13000004` at `0x0044A016`) and
   * `ThrowerDrawPartAlphaIfBlinking` (`FUN_0044A280`) for type 0x18
   * (`f6806c13000004` at `0x0044A285`): with it up a bone is drawn through
   * `ThrowerDrawPartWithAlpha` at `obj+0x138C`, with it down solid whatever
   * that word holds. The blinking states raise it with the alpha at 0 and
   * drop it with the alpha at 1 — but for `ThrowerStateCorpseBlink`'s last
   * frame, which drops it with 0. It does not reach the vertex-blended parts,
   * which `DrawCharacterPartSlot` draws at the alpha for types 0x17 and 0x18
   * with no test of this bit at all. `[proved]`
   */
  Blinking = 0x4,
  /** A reaction is already running; a second shot latches a re-entry. */
  ReactReentry = 0x400000,
  /** The reaction has been chosen for this death; only once. */
  DeathLatched = 0x200000,
  /** Knocked down — what routes states 1 and 2 into the get-up. */
  KnockedDown = 0x4000000,
  /**
   * Bit 9 — `ActorArcStep` (`FUN_0044D860`) remembers here that the arc
   * script suppressed `obj+0x34` bit `0x100`, so the fade can put it back:
   * set with `OR DH, 0x2` (`80ce02`) at 0x0044D8B2 and cleared with
   * `AND AH, 0xfd` (`80e4fd`) at 0x0044D97A, both guarded on the character
   * type being 0x16..0x19. `[proved]` The port's arc does not suppress that
   * bit, so it has no reader here.
   */
  ArcSuppressedShotImmune = 0x200,
  /** `ThrowerStrikeConnect` uses `g_class31_throws` instead of the melee row. */
  UseThrowTable = 0x400,
  /**
   * Bit 12 — raised on entry to `ThrowerStateWalkDistance` (`FUN_0044E2A0`,
   * `OR CH, 0x10` — `80cd10` at 0x0044E32E) and cleared on the way out
   * (`AND ~0x1000` at 0x0044E3DE).
   *
   * **Nothing in the program tests it.** `[proved]` for the set and the
   * clear, `[open]` for a reader — there is no `TEST` against `obj+0x136C`
   * with `0x1000` anywhere.
   */
  Walking = 0x1000,
  /**
   * Bit 14 — the landing puff has already been emitted for this landing.
   *
   * `ThrowerEmitGroundDust` (`FUN_0044D260`) refuses while it is set and sets
   * it when it emits: `MOV EDI, 0x4000` (`bf00400000`) at 0x0044D531,
   * `TEST EDI, EAX` (`85c7`), then `OR EAX, EDI` (`0bc7`) and the store back
   * at 0x0044D5D9. `ThrowerStateFallAndLand` (`AND EBP, 0xffffbfff` —
   * `81e5ffbfffff` at 0x0044A6E6) and `ThrowerStateKnockedTumbling`
   * (0x004512F3) clear it as the body settles, which is what makes the puff
   * once per landing rather than once per actor. `[proved]`
   *
   * The latch is on the bounce's arm only (code 0x46): the thump
   * `ThrowerStateFallAndLand` plays after it goes out on every bounce.
   */
  LandingDustEmitted = 0x4000,
  /** `ThrowerPickNextState` has committed to a band; `moveBand` holds which. */
  BandLatched = 0x2000,
  /** This swing has already connected. */
  Struck = 0x800,
  /** Mid-pounce: the stance row moves by four. */
  Pouncing = 0x20000,
  /**
   * This actor took its permit while **off screen**, and `g_offscreen_attacker`
   * is latched because of it. `ThrowerReleaseAttackPermit` clears both.
   *
   * Class 0x30 keeps the same fact in bit `0x20000` of the same word — which
   * is `Pouncing` here, and harmless only because no actor is both classes.
   *
   * **The release has to match.** `ReleaseAttackSlot` (`FUN_00456520`) tests
   * `0x20000` and `ThrowerReleaseAttackPermit` (`FUN_0044CFB0`) tests this;
   * calling the first one on a thrower clears the permit but leaves
   * `g_attack_committed` raised, and then nothing in the scene may claim
   * again. Every class-0x31 release site in the exe calls the second.
   */
  OffScreenPermit = 0x8000,
  /**
   * `ThrowerPushOutOfWorld` (`FUN_00449D40`) tests this before pushing the
   * body sphere out of the **world**, at the full radius.
   *
   * Class 0x30's answer to the same question is
   * {@link ZombieFlag2.CollideWorld}, bit `0x20000000` — a different bit in
   * the same word, exactly like the permit latch above.
   */
  CollideWorld = 0x80000,
  /** ...and out of other **actors**, at two thirds of it. */
  CollideActors = 0x100000,
  /** Both, which is what `EnemyThrowerInit` seeds every spawn with. */
  Collide = 0x180000,
  /**
   * Bit `0x2000000` — the same bit class 0x30 keeps as
   * {@link ZombieFlag2.LowSphere}, and one of the few in this word that is
   * genuinely **shared**: `RankEnemiesByDistance` and `SkeletonEmitNode` read
   * it on actors of any class.
   *
   * For a thrower it is raised by `ThrowerShotFeedback` (`FUN_00449B20`) as
   * half of `OR EDX, 0x6000000` (`81ca00000006` at 0x00449C36) — the other
   * half being {@link KnockedDown} — and read by `ActorArcBeginToAtSpeed`
   * (`FUN_0044DB50`), where it halves the arc's minimum duration. See
   * `ARC_MIN_FRAMES` in `class31/death.ts`. `[proved]`
   */
  LowSphere = 0x2000000,
  /**
   * Bit `0x8000000` — character type 0x18's weapons are growing back, and
   * {@link Actor.handRegrow} is how far.
   *
   * `ThrowerStateRestoreBothHands` (`FUN_0044F900`) sets it
   * (`81c900000008` at 0x0044F9A6) and then waits on it
   * (`TEST dword ptr [ESI + 0x136c], 0x8000000` — `f7866c13000000000008`
   * at 0x0044F9B9); `ThrowerDrawBonePart` (`FUN_00449F90`) clears it when the
   * accumulator passes 1.0 (`81e1fffffff7` at 0x0044A169). `SkeletonEmitNode`
   * reads it too, to pick bone 9 as the camera point. `[proved]`
   */
  Regrowing = 0x8000000,
  /**
   * Bit `0x10000000` — make `SkeletonEmitNode` (`FUN_004114C0`) track **bone
   * 2** instead of the caller's bone (`MOV ECX, 0x2` at 0x00411589).
   *
   * `ThrowerStateLeapToPoint` (`FUN_0044E4C0`) tests and sets it
   * (0x0044E577/0x0044E57E) and clears it at 0x0044E54B;
   * `ThrowerStateLeapDown` (`FUN_0044B670`) clears it at 0x0044B841. A
   * draw-and-camera bit in a gameplay word, which is why class 0x31 has no
   * reader of its own. `[proved]`
   */
  TrackBone2 = 0x10000000,
}

/**
 * `obj+0x38`'s two accounting latches, for class 0x30.
 *
 * Each counter may only be left **once** per actor, and the latch is what
 * guarantees it: `ReleaseEnemyAliveCount` (`FUN_00456560`) and
 * `ReleaseEnemyPresentCount` (`FUN_00456580`) each test their bit, set it, and
 * only then decrement. Six routines call them and several can run on the same
 * actor, so without the latch a zombie would take the count negative and
 * `wait_enemies_alive` would open a block early.
 */
export enum CountFlag {
  /** Bit 1 — this actor has already left `g_enemies_alive`. */
  LeftAlive = 0x2,
  /** Bit 2 — ...and `g_enemies_present`. */
  LeftPresent = 0x4,
  /**
   * Bit 0 — `ZombieEnterCorpseState` (`FUN_00456740`) skips the present
   * release when it is set, and `ZombieReleasePermitAndUntrack`
   * (`FUN_004565A0`) skips dropping the actor from camera tracking.
   *
   * [open] Nothing in the ported call graph sets it.
   */
  KeepCounted = 0x1,
}

/**
 * `obj+0x38`'s upper bits, which are **spawn-record bits moved out of
 * `obj+0x34`** by `EnemyZombieInitByCharType` (`FUN_00452FD0`).
 *
 * The move is the thing worth knowing: the routine reads a bit of the flags
 * word `ActorInitFlags` built from the descriptor, **clears it there** and sets
 * a different bit here, so nothing downstream can find it at `obj+0x34` any
 * more. Reading the descriptor's word and stopping is why the port never saw
 * these at all.
 *
 * ```
 * 00453000  if (obj+0x136C & 0x20)  obj+0x38 |= 0x8
 * 0045300b  if (obj+0x34  & 0x2) { obj+0x34 &= ~0x2;  obj+0x38 |= 0x10 }
 * 00453045  if (obj+0x34  & 0x4) { obj+0x34 &= ~0x4;  obj+0x38 |= 0x20 }
 * ```
 *
 * `[proved]`, and they are separate from {@link CountFlag}'s three latches in
 * the same word.
 */
export enum ZombieAux {
  /**
   * Bit 3 — **draw through the scene light array.** Raised from
   * `obj+0x136C` bit `0x20`, which is the descriptor's own `+0x20` word.
   * `DrawCharacterPartSlot` (`FUN_00419B40`) reads it in eight places, always
   * together with `g_scene_lighting` (`0x009A2BB4`), and with both set it
   * submits through `SubmitSlotWithSceneLightArray` (or its alpha twin
   * `FUN_00418620`) instead of `AssetDrawSlot` — so the actor is lit by the
   * gun lights and the evt `0x16` ambient. `[proved]`, read for the flashlight;
   * this used to be `DrawVariant`, an open question. Fifty-five shipped
   * class-0x30 spawns set the source bit — 20 in stage 2 and 35 in stage 4.
   *
   * Class-agnostic: `EnemyThrowerInit` (`0x00449802`, character type 0x17
   * with `obj+0x136C` bit 0) and `CivilianInit` (`0x0048A642`, when
   * `g_scene_lighting` is set at spawn) raise the same bit. See
   * `scene_lights.ts`, `ActorDrawsSceneLit`.
   */
  SceneLit = 0x8,
  /**
   * Bit 4 — **a stationary thrower that never walks away.**
   *
   * `ZombieStateStandAndThrow` (`FUN_00459080`) is the only reader in the
   * whole image (`0045945C` and `004595B4`, both `TEST byte [ESI+0x38], 0x10`
   * — `f6463810`), and it is the switch between that state's two endings: with
   * the bit clear it walks its descriptor's distance through state 15 or leaps
   * through state 26, and with it set it stands where it is, gives both enemy
   * counters and its permit back at once, and waits to be despawned.
   *
   * **Two spawn records in the whole game set the `obj+0x34` bit it comes
   * from**, and they are the two axe men of stage 3 block 2 step 4 — script
   * addresses `0x3078` and `0x30BC`, both `init_flags 0x20002`. That is what
   * "when there is nowhere for the thrower to retreat to, the game just
   * carries on" is: not a collision test, a descriptor bit. `[proved]`
   */
  StandThrowRetire = 0x10,
  /**
   * Bit 5 — **turn toward the camera eye every frame**, at a rate of `0x1A0`
   * BAMS.
   *
   * Two readers, and they are the two carrier states:
   * `ZombieStateRideCarrier` at `0x004589F5` and
   * `ZombieStateDelayedStrikeInPlace` at `0x0045EAEA`, both
   * `TEST byte ptr [ESI + 0x38], 0x20` then
   * `TurnActorTowardCameraEye(obj, 0x1A0)` (`FUN_00409E80`). `[proved]`
   *
   * It used to be called `CarrierOffset`, on a note saying the first reader
   * "uses it to choose whether the actor's position is the carrier's plus its
   * own offset". It does not: the offset add at `0x00458A0E` is
   * unconditional, and this bit gates the call two instructions later and
   * nothing else. The name came from where the bit sits — `L20` — and it was
   * the wrong half of the routine.
   *
   * Three shipped class-0x30 records set the `obj+0x34` bit it comes from,
   * and they are exactly stage 2's first three state-29 riders (evt `0x5030`,
   * `0x506C`, `0x50A8`, `init_flags 0x60004`); none of the four spawns that
   * ride through {@link ZombieFlag2.AttachedToCarrier} sets it.
   */
  TurnTowardCameraEye = 0x20,
}

/** `obj+0x136C` for class 0x30, where the bits differ from the thrower's. */
export enum ZombieFlag2 {
  /**
   * `obj+0x136C` bit `0x4000000` — this actor may leave the floor. Without it
   * `ActorSnapToGroundHeight` sticks it to the collision height whatever the
   * drop; with it, more than ten units of air sends it to
   * `ZombieStateFallToGround`.
   */
  MayFall = 0x4000000,
  /**
   * Bit `0x20` — the descriptor's own `+0x20` word asking for the light
   * array. `EnemyZombieInitByCharType` (`FUN_00452FD0`) reads it at
   * `0x00453000` and raises {@link ZombieAux.SceneLit} (`obj+0x38` bit 3)
   * from it, which is what `DrawCharacterPartSlot` (`FUN_00419B40`) tests for
   * the parts; and `ZombieSubmitSlotByLighting` (`FUN_00453AE0`) tests **this**
   * bit for every node (`TEST byte ptr [EAX + 0x136c], CL`, `CL = 0x20`, at
   * `0x00453AE7`). This comment used to say nothing else in the image looked
   * at it.
   */
  DrawVariantSource = 0x20,
  /** Bit `0x20000000` — take part in the world push. Off while emerging. */
  CollideWorld = 0x20000000,
  /** Bit `0x40000000` — take part in the actor-versus-actor push. */
  CollideActors = 0x40000000,
  /** Bit `0x800000` — set for the frame a push actually moved this actor. */
  Shoved = 0x800000,
  /**
   * Bit `0x400000` — which way `ZombieStateBackOff` turns: clear, it passes
   * `-0x40` and turns away from where its strike began; set, `+0x40`, toward
   * it. The retreat's own first frame clears it (`00455cc0 81e1ffffbfff`)
   * and the shove timer flips it every sixty frames while the actor is being
   * pushed, so a wedged one tries the other way.
   */
  BackOffTurnFlip = 0x400000,
  /**
   * Bit `0x2000000` — the bounding sphere sits a half unit up, not one.
   *
   * That is the reader the name came from. Its three writers say what it is
   * *for*: this actor is **half a body**. `ZombieInitHalved` (`FUN_0045DA10`)
   * raises it on every `znkager` born at body condition 4, and the two states
   * the split machinery ends in, `ZombieStateSplitLaunch` (`FUN_0045E010`) and
   * `ZombieStateCollapseToCondition4` (`FUN_0045E660`), raise it on the way
   * back into the run. `ZombieSplitUpdateSelf` (`FUN_0045DA60`) and
   * `ZombieSplitCopyToHalf` (`FUN_0045DBC0`) test it to tell a first split
   * from a second. `[proved]`
   */
  LowSphere = 0x2000000,
  /**
   * Bit `0x1000000` — with {@link LowSphere}, what arms a split:
   * `ZombieStateAttackRun`'s one-in-64 roll and `ZombieStateLeapStrike`'s
   * quarter-arc test both clear it and call `ZombieSplitInTwo`
   * (`FUN_0045D9F0`) (`00455540 25fffffffe`, `0045e4db 25fffffffe`).
   *
   * **Nothing the shipped game runs ever raises it.** Its one class-0x30
   * writer is `ZombieStateCollapseToCondition4` at `0045e6a2`
   * (`OR EAX, 0x1000000`), and no instruction stores that state's number and
   * no descriptor, entry tail, captor script or civilian order names it;
   * `web/tools/checks/split_unreachable.ts` holds that. It used to be called
   * `AbortRollArmed`, after the routine's old name. `[proved]`
   */
  SplitArmed = 0x1000000,
  /**
   * Bit `0x80` — lets `ResolveHit` (`FUN_00409430`) sever bones 9 and up on
   * character type 0xC, whose sever arm is otherwise closed below bone 9
   * (`004095C2 CMP word ptr [EDI+0x1F4], 0xC`, then `TEST byte [..+0x136C],
   * 0x80`). `EnemyZombieInitByCharType` (`FUN_00452FD0`) raises it on
   * **every** `znkager`, and `ZombieInitHalved` raises it again as part of its
   * `0x6000080`; nothing else in class 0x30 writes it. So for a class-0x30
   * actor the gate is always open, and what it is for is `[open]` — the one
   * `znkager` that could reach `ResolveHit` without it is none. `[proved]`
   */
  SeverAnyBone = 0x80,
  /**
   * Bit `0x100000` — the actor is being **carried**: riding
   * `g_carrier_object` in `ZombieStateRideCarrier`, or in flight in
   * `ZombieStateArcScriptedEntrance` and `ZombieStateScriptedGrabAndDespawn`.
   * The states raise it for exactly as long as something other than the actor
   * itself owns its position.
   *
   * That is the carrier states' reading and not the bit's only writer (`L3`):
   * `ZombieStateEmerge` raises it for the climb out of the water
   * (`0x00458528`) and `ZombieStateStandAndThrow`'s sub 0 for an airborne
   * body-condition-7 thrower (`0x00459104`). `ZombieOnShot` and
   * `ChooseDeathMotion` read the bit whoever wrote it.
   */
  Carried = 0x100000,
  /**
   * The class-0x30 half of {@link ThrowerFlag.OffScreenPermit}:
   * `TryClaimAttackSlot` sets it, `ReleaseAttackSlot` and
   * `ZombieStateHoldAtRange` clear it, and each clears
   * `g_offscreen_attacker` with it.
   */
  OffScreenPermit = 0x20000,
  /**
   * Bit `0x4000` — raised for the length of `ZombieStateDelayedLeap`'s arc and
   * cleared on both its exits.
   *
   * **`ZombieOnShot` reads it back**, which answers an open question this
   * comment used to carry: `00453f88 f6c540` (`TEST CH, 0x40`) and the `JNZ`
   * two bytes later jump past the death-state change, so a zombie shot
   * mid-leap keeps flying. `[proved]`
   *
   * It is a different word from `obj+0x34` bit 0x4000
   * ({@link ActorFlag.PoseFrozen}) which the same state also toggles — two
   * flags, one value, and mixing them up would freeze the wrong thing.
   */
  Leaping = 0x4000,
  /**
   * Bit `0x80000000` — this actor's death has already been dispatched.
   *
   * Also no longer an open question: `ZombieOnShot` sets it at `00453f53`
   * (`0d00000080`) and refuses a second death on the test five instructions
   * earlier, `00453f3b a900000080`. `[proved]`
   */
  DiedInFlight = 0x80000000,
  /**
   * Bit `0x40000` — **`ZombieStateStrike` has captured `strikeStart`**, which
   * is to say this actor has swung at least once.
   *
   * `ZombieStateStrike` tests it and, when clear, copies `obj+0x40/0x44/0x48`
   * into `obj+0x13D8/0x13DC/0x13E0` and raises it in the same word:
   * `00455b98 a900000400` (`TEST EAX, 0x40000`), `00455ba5 0d00000400`
   * (`OR EAX, 0x40000`), `00455bb0 89866c130000`. `[proved]`
   *
   * **Nothing on the melee path ever clears it.** The one `AND` in the program
   * that does is in `ZombieSplitUpdateSelf` (`FUN_0045DA60`)
   * (`0045db39 25fffffbff`), reached only through `ZombieSplitInTwo`
   * (`FUN_0045D9F0`), which nothing in the shipped game calls; `EnemyZombieInit` clears it only because it *assigns* the whole
   * word (`00452eaf`, from `00452e9a`'s `(s16)obj+0x1316 | 0x60000000`). So
   * after its first swing an actor keeps this bit for the rest of its life,
   * and its two other readers in `ZombieStateHoldAtRange` — the too-close
   * escape at `0045577c` and the cooldown gate at `004557e0` — are permanent
   * from then on. It was a separate `hasStrikeAnchor: boolean` here, which is
   * why neither of those two was ever wired up.
   */
  StrikeAnchor = 0x40000,
  /**
   * Bit `0x400` — set by `EnemyZombieInitByCharType` for character type 2, and
   * cleared by `ZombieStateHoldAtRange` two frames from the end of the clip
   * (`00455904 80e4fb`, guarded by `obj+0x19C >= play_length(obj+0x1B4) - 2`).
   *
   * While it is up the same state exempts the actor from the too-close retreat
   * (`0045577c f7866c13000000040400`, the `0x40400` pair with
   * {@link ZombieFlag2.StrikeAnchor}) and refuses the attack claim outright
   * (`00455815 f6c404`). `ZombieOnShot` also clears it, for every shot that
 * lands (`00453f14 80e6fb AND DH, 0xFB`, stored at `00453f24`).
   * `[proved]` — the ops. That the clip in question is the *authored entrance*
   * one is `[likely]`: it is what character type 2's spawns carry.
   */
  EntryClipPlaying = 0x400,
  /**
   * Bit `0x10000` — a one-shot effect (splash, dust, sound) has already fired
   * for the clip that is running.
   *
   * Set by `ZombieStrikeFrameSplash` (0x00456DCB), `ZombieStateEmerge`
   * (0x0045888A) and `ZombieStateArcScriptedEntrance` (0x00458C15); cleared by
   * whoever starts the next clip, `ZombieStateStrike` among them
   * (`00455b77 81e2fffffeff`). `[proved]`
   */
  OneShotFired = 0x10000,
  /**
   * Bit `0x80000` — **a strike has just started**, published for one frame
   * through `g_cur_actor`.
   *
   * `ZombieStateStrike` raises it as it starts the swing
   * (`00455b7e 81ca00000800`) and the per-actor hook at `obj+0x12EC` consumes
   * and clears it in `FUN_004534A0` (`00453899` tests, `004538b4
   * 81a06c130000fffff7ff` clears). Not class 0x31's `CollideWorld`, which is
   * the same bit on the thrower's reading of this word. `[proved]`
   */
  StrikeStarted = 0x80000,
  /**
   * Bit `0x200000` — which of the motion row's two waiting clips this actor
   * plays.
   *
   * `ZombieStateAttackRun` writes it as `flags2 |= g_wait_turn_variant[i] <<
   * 0x15` (`0045[55]cc 8b149524615600`, `c1e215`), so a table value of 0
   * leaves it alone and the bit is sticky once set; `ZombieStateWaitTurn`
   * reads it straight back out with `SHR EAX, 0x15` + `AND EAX, 1`
   * (0x00455690). `[proved]`
   */
  WaitTurnVariant = 0x200000,
  /**
   * Bit `0x8000` — `ChooseDeathMotion` picks death motion 0x3DB for character
   * type 10 while it is up (`00456191 f6c480`), and `FUN_00457FB0` sets it
   * (`00458120`). `[proved]`
   *
   * The same value as {@link ThrowerFlag.OffScreenPermit}: two classes, one
   * bit, different meanings.
   */
  DeathMotionVariant = 0x8000,
  /**
   * Bit `0x8` — the shot that killed this actor landed within 18.0 of the
   * point recorded at `obj+0x13CC/0x13D4`.
   *
   * `ZombieOnShot` raises it (`00454006 83c908`) immediately before sending
   * the actor to state 9, and `FUN_004550E0` reads it back (`004552AE`).
   * `[proved]` for the op and the distance; what state 9 then does with it is
   * `[likely]` "die into the recorded spot".
   */
  ShotNearArcTarget = 0x8,
  /**
   * Bit `0x1000` — a hit-reaction clip is running on the **overlay** track,
   * `obj+0x1B8`/`obj+0x1A0` ({@link Actor.react}).
   *
   * `ActorPlayHitReaction` sets it, `ZombieClearHitReactionWhenDone`
   * (`FUN_00454660`) clears it once that track is handed back or a quarter of
   * its clip has played (`0045468a`, `00454716`), and while it is up
   * `ZombieSetMotionIfIdle` changes only the legs' clip
   * (`ActorSetMotionBlendedUnderOverlay`, `FUN_00411AC0`) so the stumble plays
   * on. `[proved]`
   */
  HitClipOverlay = 0x1000,
  /**
   * Bit `0x2000` — a reaction clip cut onto the **base** track
   * `obj+0x1B4`/`obj+0x19C`, for a hit on bone 9 or below it. While it is up
   * `ZombieSetMotionIfIdle` changes nothing (`TEST DH, 0x20` at
   * `0x0045477B`); `ZombieClearHitReactionWhenDone` drops it at the clip's
   * end or a quarter of the way in (`0x004546CF`, `0x00454734`). `[proved]`
   */
  HitClipBase = 0x2000,
  /**
   * Bit `0x200` — `ActorPlayHitReaction` raises it (`00454611`, `OR AH, 0x2`);
   * `ZombieStateDeath6` and `FUN_00454F20`/`FUN_00454FD0` clear it. `[proved]`
   *
   * With {@link ZombieFlag2.HitReactionAlt} **both** set, and
   * `obj+0x34 & 0x50000000` clear, `FUN_004547C0` takes the zone-indexed
   * reaction row instead of the ordinary one (`004547cb f6c401`,
   * `004547d4 f6c402`, `004547e0 f7c600000050`).
   */
  HitReactionPending = 0x200,
  /**
   * Bit `0x1` — raised with {@link ActorFlag.HoldingWeapon} cleared, when the
   * actor lets go of what it was holding: `ZombieStateCarryProp` does both at
   * its release and when its prop is destroyed, the same `& 0xFEFFFFFF` on
   * `obj+0x34` and `| 1` here both times. `ZombieStateStandAndThrow`'s sub 0
   * raises it too (`OR AL, 1` at `0x004590F4`), for a body-condition-7
   * thrower whose spawn record does **not** set `HoldingWeapon`.
   * `ChooseDeathMotion`'s directional arm reads `obj+0x136C` bits 1, 2 and 4;
   * `[open]` what this one selects there.
   */
  LetGo = 0x1,
  /**
   * Bit `0x100` — the other half of that gate, and **nothing the shipped game
   * runs raises it** on a class-0x30 actor. `[proved]` both ways a bit gets
   * into this word: a sweep of class 0x30's code (`0x00452DA0`..`0x0045ECC0`)
   * for every `OR` whose immediate carries it -- 32-bit, and the byte form on
   * `AH`/`CH`/`DH`/`BH` -- finds eleven, and every one of them stores to
   * `obj+0x34` (`ZombieApplyScriptMode`'s `0x0045CA59` and
   * `ZombieStateCollapseToCondition4`'s `0x0045E69F` among them); and
   * `EnemyZombieInit`'s copy of the descriptor's `+0x20` word carries it in
   * none of the twelve bundles' class-0x30 records. Its readers are
   * `ActorPlayHitReaction`'s alt arm, `ZombieTickAltHitReaction` and
   * `ActorSnapToGroundHeight` (0x00454B3B), so all three are transcribed
   * against a bit that stays down.
   *
   * This used to say `ZombieStateCorpseSink` (`FUN_00454F20`) and
   * `ZombieStateCorpseBlink` (`FUN_00454FD0`) clear it with
   * `AND EDX, 0xdffffdff`. **They do not**: `0xdffffdff` has bit 8 set, so
   * that mask clears `0x20000000` and `0x200` and leaves this one alone.
   */
  HitReactionAlt = 0x100,
  /**
   * Bit `0x800` — with it up, `ActorPlayHitReaction` cuts **every** hit's
   * reaction onto the base track, as it does a hit on bone 9 or below
   * (`004544e0`..: `CMP bone, 9 / JGE` and `TEST AH, 0x8 / JNZ` to one arm).
   * Nothing the shipped game runs raises it: the same sweep and census as
   * {@link ZombieFlag2.HitReactionAlt} find no class-0x30 `OR` that stores it
   * here -- the two `OR ?H, 0x8` in class 0x30 (`0x0045A951`, `0x0045B4D6`)
   * write through a pointer at `obj+0x1310` -- and no descriptor that carries
   * it. `[proved]`
   */
  ReactOnBaseTrack = 0x800,
  /**
   * Bit `0x10000000` — **this actor's position and yaw are an offset on
   * `g_carrier_object`**, and something re-seats it there every frame.
   *
   * `EnemyZombieInitByCharType` raises it at `0x00453028` when the spawn
   * record's `obj+0x34 & 8` says so, in the same arm that stashes the
   * descriptor's position at `obj+0x13D8` and its yaw at `obj+0x135C`; and
   * `EnemyZombieUpdate` tests it at `0x0045341C` and calls
   * `ZombieAttachToCarrier` (`FUN_0045E770`) at `0x00453424` — **before** the
   * state dispatch at `0x00453434`. `[proved]`
   *
   * It used to be called `SpawnedInAir`, which is what an offset with `y = 5`
   * looks like from outside and is not what the code does — `L20`. Nothing
   * set it and nothing read it, and the four spawns that carry it were left
   * standing at the world origin while the car they belong to drove off. See
   * `class30/carrier.ts`.
   */
  AttachedToCarrier = 0x10000000,
}

/**
 * The stance rows of `g_class31_melee_attacks`: which surface the actor is on,
 * and whether it is in the air. `ThrowerLoadAttackArcScript` (`FUN_0044B610`)
 * computes it as `bit6 + 2*(bit7 + 2*bit17) + 3*bit8`, which for the four
 * surface bits alone is 0..3 and with the pounce bit is 4..7.
 */
export enum ThrowerStance {
  Ground = 0,
  WallA = 1,
  WallB = 2,
  Ceiling = 3,
  /** Add this while `ThrowerFlag.Pouncing` is set. */
  Pounce = 4,
}

/**
 * One skeleton record's rotation in a fade's snapshot, overriding the clip's:
 * `(rx, ry, rz)` BAMS, applied `RotZ RotY RotX` like every record. See
 * {@link ActorBase.fadeFrom}.
 */
export interface FadeRecord {
  record: number;
  rot: [number, number, number];
}

/**
 * A fade snapshot's root translation where a routine wrote it before the
 * blend, axis by axis. See {@link ActorBase.fadeFrom}.
 */
export interface FadeRoot {
  x?: number;
  y?: number;
  z?: number;
}

/**
 * A one-shot clip on its own track: a strike, an arc stage, an entrance, a
 * corpse. It plays once and `ActorAdvanceMotion` clears it at its end.
 *
 * `ticks`, not seconds, for the same reason {@link Actor.playTicks} is: the
 * engine counts frames and the port compares against frame numbers. Holding it
 * in seconds meant `ActorClipFrame` was `t * 60` over a float accumulation, so
 * a frame test written `===` could be stepped over -- which is what the
 * `struck` latch on this interface's owner used to exist to work around.
 *
 * There is no `loop`. The one clip that ever looped here was class 0x30's
 * lunge, and the engine plays that on the ordinary track, where the cursor
 * wraps by itself (`ZombieStateStrike`, `FUN_00455A40`). A clip that has to
 * cycle belongs on {@link Actor.motion}.
 */
export interface ActorClip {
  motion: number;
  ticks: number;
  /**
   * `[port-only]` The clip was set through `ActorSetOneShotBlended`, the
   * channel's `ActorSetMotionBlended` (`FUN_004119A0`), so the actor's fade is
   * a fade **into it** and holds `ticks` on the start frame while it runs, as
   * `SkeletonAdvancePlayCursor` (`FUN_004111A0`) holds `obj+0x19C` while
   * `track+0x37` bit 0 is up. A one-shot set any other way keeps running under
   * a fade, which is what it did before this existed.
   */
  held?: boolean;
}

/**
 * Track 1 of the model block at `obj+0x194` -- the **overlay** a hit
 * reaction plays on, beside the base track {@link Actor.motion} is.
 *
 * `MotionCrossFadeTo` (`FUN_00411B70`) starts it and `MotionStartOnTrack`
 * (`FUN_004119F0`) hands it **a subtree**: `SkeletonAssignSubtreeTrack`
 * (`FUN_00412200`) writes the track into the record of `bone` and of every
 * bone below it, and `MotionWriteBoneAngles` (`FUN_00411D70`) poses a bone
 * from the track its record names. Both callers pass bone 1, which is bones
 * 1..8 -- torso, head, arms -- in every class-0x30 and class-0x31 skeleton,
 * and `SkeletonPoseRootFrame` (`FUN_00410920`) takes the root translation and
 * bone 0's rotation from track 0 with no track test at all. So a stumble moves
 * the upper body and nothing else: the legs keep walking, and a crawler
 * flinches its torso **on the floor**. The port used to blend the whole
 * skeleton, root included, onto the clip, which stood every crawler up on a
 * standing flinch.
 *
 * `SkeletonAdvanceOverlayCursor` (`FUN_004112E0`) is its clock and decides
 * when it ends; `ActorSetMotion` and `ActorSetMotionBlended` end it too,
 * because their `MotionStartOnTrack` puts the whole skeleton back on track 0
 * and writes `model+0x36 = 0`.
 */
export interface OverlayTrack {
  /** `track+0x24` -- `obj+0x1B8`, the clip. */
  motion: number;
  /**
   * `track+0x04` -- `obj+0x198`, the counter, in the base track's
   * {@link Actor.playTicks} encoding: held while a fade holds the cursor, and
   * the cursor `obj+0x1A0` is it modulo the play length + 1.
   */
  ticks: number;
  /** `track+0x35` -- `obj+0x1C9`: the root of the subtree it drives. */
  bone: number;
  /**
   * Slot A: the pose a fade on this track dissolves from --
   * `MotionLoadPoseSlot` (`FUN_00411C20`) mode 0xC's snapshot, held as the
   * clip and cursor it was drawn from, as {@link Actor.fadeFrom} is.
   */
  fadeFrom: { motion: number; ticks: number } | null;
  /** Frames of that fade left, in {@link Actor.fade}'s encoding. */
  fade: number;
  /** `track+0x31` -- the fade length + 1, as {@link Actor.fadeLen}. */
  fadeLen: number;
  /** `track+0x33` -- the fade back to the base clip, length + 1; 0 once spent. */
  fadeOut: number;
  /**
   * `track+0x38` bit `0x10` -- fading back to the base clip, then holding its
   * frame 0 until the base cursor comes round to it.
   */
  back: boolean;
  /**
   * `track+0x38` bit 3 -- `MotionCrossFadeAlt`'s (`FUN_00411B20`): the clip
   * never ends on its own.
   */
  hold: boolean;
}

/**
 * **Another actor**, by spawn address — the port's stand-in for a raw actor
 * pointer. `-1` is the engine's null.
 *
 * It exists to keep `obj+0x1394`'s two kinds apart. That one word holds a
 * pointer in every site read, but not the *same* kind of pointer:
 *
 * * an **actor pointer**, the parent — class 0x2D at 0x00426B7F and
 *   0x00428341, and `CivilianInit` (`FUN_0048A3E0`) writing itself onto each
 *   captor it builds, `MOV dword ptr [EDI + 0x1394], ESI`, bytes
 *   `89b794130000`, at 0x0048A7D9. That is this type;
 * * a **walking descriptor pointer**, which is {@link ListCursor}.
 *
 * `[proved]`, and it corrects the survey this came from: the third kind it
 * listed, "a small integer" for class 0x25, is not there. `ScriptedHumanoidInit`
 * (`FUN_004840D0`) seeds `obj+0x1394` with a pointer (0x004840FB),
 * `ScriptedHumanoidUpdate` (`FUN_004842A0`) reads it beside `obj+0x1390`
 * (0x004842BE) and stores an advanced pointer back (0x00484A9C). Class 0x25's
 * cursor is the same kind as class 0x31's.
 *
 * TypeScript aliases are structural, so this documents rather than enforces;
 * the enforcement is the union, which is not this wave's work. What it does
 * buy is that a reader cannot mistake `targetAt` for an index.
 */
export type ActorRef = number;

/**
 * **A cursor into a decoded list** — the port's index form of an exe pointer
 * that walks a descriptor.
 *
 * The engine keeps a raw address and advances it by the record stride; the
 * port has no flat address space, so it keeps how far in. `[diverges]` in
 * representation only, and it is what makes the cursor survive a snapshot.
 *
 * `[proved]` for both users of `obj+0x1394` in this shape:
 * `ThrowerStatePathFollow` (`FUN_0044EE00`) sets it to `obj+0x1390 + 8`
 * (`MOV dword ptr [EBX + 0x1394], EAX`, bytes `898394130000`, 0x0044EE35) and
 * then adds 0x10 a leg (`ADD EDX, 0x10`, bytes `83c210`, 0x0044EF0E, stored at
 * 0x0044EF13), stopping on `CMP word ptr [EAX], -1`; class 0x25's VM does the
 * same over its own command stream. `-1` is "the list has ended" and is the
 * port's, not a value the engine's pointer can hold.
 */
export type ListCursor = number;

/**
 * The fields **every** class has — the ones a class-agnostic engine routine
 * touches. See {@link Actor} for the per-class arms and why they are separate.
 */
export interface ActorBase {
  // -- identity ----------------------------------------------------------
  /** The spawn's script address. Stable, and the key the renderer binds on. */
  at: number;
  /**
   * The spawn class — `g_class_handlers` is indexed by it.
   *
   * [port-only] **The engine has no `cls` field.** `SpawnFromDescriptor`
   * (`FUN_00408A20`) uses the descriptor's first word once, to index
   * `g_class_handlers`, and stores the *handler pointer* at `obj+0x00`; the id
   * itself is never written to the actor. `cls` stands for that pointer, and
   * for the same thing it selects — which class's code owns this actor's
   * tail — so it is written at construction and never again.
   *
   * It is **not** what the engine's class-agnostic code switches on. That is
   * {@link Actor.charType}; see its note.
   */
  cls: SpawnClass;
  /**
   * `obj+0x1F4` — the character type, **s16**, and the head's real type tag.
   *
   * It lives inside the embedded model record: `ActorSetMotion`
   * (`FUN_00411930`) reads it as `*(short *)(model + 0x60)` and
   * `0x194 + 0x60 == 0x1F4`. `EvtOpSpawnPlaced09` and every class `Init` write
   * it 16 bits wide — `MOV word ptr [ESI + 0x1F4], AX`, bytes
   * `668986f4010000`, at 0x00408801, 0x004088ED, 0x00449643 and 0x00452DEA
   * among eleven sites. `[proved]`
   *
   * **The engine's class-agnostic code gates on this, not on the class.**
   * `RankEnemiesByDistance` (`FUN_004090B0`) tests it against 0xB —
   * `CMP word ptr [EAX + 0x1F4], DI`, bytes `6639b8f4010000`, at 0x004090EB —
   * `ResolveHit` against 0xC, `ActorSwapDamagedPart` against 0xD, and
   * `ShotTestSphere`, `DamageRankModifier`, `ActorDrawShadow`,
   * `ActorPlayHitVoice` and `SkeletonWalkNode` index tables with it. A port
   * routine that gates on `cls` where the exe gates on this is a divergence
   * even where the shipped data agrees: class 0x30 covers many character
   * types and class 0x31 covers four. `game/tables.ts` resolves the data.
   */
  charType: number;         // +0x1F4, s16
  /**
   * `model+0x116C` — the character's size: the `MatrixScale` the draw puts
   * between the actor's rotation and its pose, so the drawn model, the pose
   * offset, every bone and every hit centre, and the factor
   * `SkeletonApplyRootMotion` scales its root delta by. The renderer draws
   * the root node under it.
   *
   * `ActorBuildSkinnedModel` sets it from {@link Actor.charType} alone; the
   * civilian VM's op 0x27 `SetScale` is the only thing that changes it after.
   * See `ActorModelScale` in `game/root_motion.ts`.
   */
  scale: number;
  /**
   * `model+0x64` — `obj+0x1F8`, the motion block's flag word. See
   * {@link MotionFlag}, and {@link MOTION_FLAGS_INIT} for the value every
   * skeletal actor is built with.
   */
  motionFlags: number;      // +0x1F8
  /**
   * `model+0x40` — the **vertex-blended parts' draw bytes**, one per
   * `model+0x3C`: byte `+1` of each eight-byte record. `obj+0x1D4` is the
   * pointer and `obj+0x1D0` the count.
   *
   * The parts are `g_pCharacterExtraParts[type]` (`0x0052ED08`) — the waist
   * and the skirt, the geometry no skeleton node names — so index *i* here is
   * the exporter's `part<i>_<slot>` node and {@link CharacterType.parts}'
   * entry *i*, **not a bone**. `ActorBuildSkinnedModel` (`FUN_00410440`) sizes
   * the array from that table's count, null descriptors included, and writes
   * 1 into every byte (`0` into the `+0` "has a model" cache beside it, which
   * is the renderer's and not carried). `SkeletonDrawWalk` (`FUN_004110D0`)
   * skips part *i* while its byte is 0, and so does `DrawCharacterPartSlot`
   * (`FUN_00419B40`). `ActorSetPartVisibility` (`FUN_00409D10`) writes all of
   * them; `ZombieStateAwaitCivilianOrder` and class 0x14's entrances write
   * part 0's alone. `[proved]`
   *
   * On the actor rather than in {@link SkeletonModel}, because every skinned
   * actor has these records and only class 0x14 carries the rest of the
   * block. Empty for an actor whose class `Init` the port does not run the
   * build for; see `spawn.ts`.
   */
  partVisible: number[];    // model+0x40, byte +1 of each record
  /**
   * The engine's own model block (`obj+0x194`), for an actor whose class
   * poses it the way the exe does -- see `game/skeleton.ts`. Null for every
   * actor the port still poses in `render/`; class 0x14's `Init` builds one.
   * When it is set the director leaves the actor's clock alone and the class
   * steps it from its own update.
   */
  skel: SkeletonModel | null;
  /** Display name, for the feed. Copied from the type at spawn. */
  name: string;

  // -- the engine's own fields -------------------------------------------
  flags: number;            // +0x34
  /**
   * `obj+0x38` — a second flag word, and the one the **enemy counters** latch
   * in. See {@link CountFlag}; class 0x31 latches the same two facts in
   * `obj+0x136C` instead, which is the usual polymorphism.
   *
   * Bits `0x1`/`0x2`/`0x4` are class 0x30's counting latches, and bit
   * **`0x40` is class-agnostic**: the hit-slot claim, `HIT_SLOT_CLAIMED` in
   * `game/hit_slots.ts`, beside {@link Actor.hitSlot} (`obj+0x3C`).
   * `ActorInitFlags` (`FUN_00408970`) zeroes both; `ActorClaimHitSlot`
   * (`FUN_00409270`) does `obj+0x3C = -1; if (g_hit_slots[i] == 0) {
   * obj+0x38 |= 0x40; g_hit_slots[i] = obj; obj+0x3C = i; }`; and
   * `ActorDespawn` (`FUN_00409CC0`) reads the byte back —
   * `if ((obj+0x38 & 0x40) && obj+0x3C != -1) { g_hit_slots[obj+0x3C] = 0;
   * obj+0x3C = -1; }` — before `ActorKill`. `[proved]` Class draws also use
   * `obj+0x3C` as a per-actor seed. This note said the bit and the slot were
   * not modelled, for as long as the hit-slot table was not ported.
   */
  flags38: number;          // +0x38
  /**
   * `obj+0x3C` — the index this actor holds in `g_hit_slots`, or `-1`.
   *
   * `ActorClaimHitSlot` (`FUN_00409270`) writes it and `ActorDespawn`
   * (`FUN_00409CC0`) gives it back; see `game/hit_slots.ts`. It is here rather
   * than absent because `ZombieDrawBonePart` (`FUN_004534A0`) uses it as the
   * **phase** of every cel animation a class-0x30 bone plays —
   * `g_blink_frame_counter + obj+0x3C * 10`.
   */
  hitSlot: number;          // +0x3C
  pos: Vec3;                // +0x40
  /**
   * Yaw in BAMS, the middle word of the engine's rotation triple at
   * +0x64/68/6C. Almost everything turns only about Y — this used to say
   * "only Y turns", and `ZombieStateDeathKnockbackArc` (`FUN_004550E0`) is
   * the counter-example: see {@link Actor.pitch}.
   */
  yaw: number;              // +0x68
  /**
   * `obj+0x64` — the **x** word of the same triple.
   *
   * `SpawnFromDescriptor` (`FUN_00408A20`) fills it from the record's sixth
   * dword, the first word of its orientation, for every class; for a
   * character `SpawnScriptedCharacters` takes it from the placement's `pitch`.
   * One writer after the spawn is ported: body condition 4's knockback spins
   * the falling body by `±(rand() % 5) * 0x100` BAMS at 0x004551D5.
   * `ApplyRootMotion` turns every root delta by it. `render/` draws it for the
   * classes that place their own root -- class 0x31 among them -- and poses
   * every other actor from `yaw` alone, so the knockback's spin is not drawn
   * yet; it is state the engine keeps on the actor, so the port keeps it where
   * the engine does and the renderer is the half that has to catch up.
   */
  pitch: number;            // +0x64
  /**
   * `obj+0x6C` — the third orientation word, which every spawn allocator fills
   * from the descriptor and `MatrixRotateZ` consumes. For a character it comes
   * from the placement's `roll`: stage 2 block 21's two `zstin` are spawned
   * at `0xC000`, on their sides against a wall, and are the only character
   * placements in the game that are not upright.
   *
   * Two classes write it after the spawn: the owl, class 0x43, banks into its
   * dive and rolls through its orbit, and `ThrowerStateDelayedPounce`
   * (`FUN_0044E830`) turns it back to level at `0xCCC` a frame as its
   * wall-climber leaps. Class 0x41 type 4 reads the same word as an object
   * **kind**, which is the polymorphism `docs/formats/spawns.md` warns about —
   * check the class before believing it is an angle.
   */
  roll: number;             // +0x6C
  /**
   * What the camera aims at, and **not** the actor's origin.
   *
   * `SkeletonEmitNode` (`FUN_004114C0`) records one bone's world position here
   * as it walks the skeleton — bone 1, the torso, for an ordinary humanoid —
   * and `ActorRegisterCameraPoint` (`FUN_00409B70`) then raises `obj+0x104` by
   * **its float argument**, which is a per-call-site value and not a field:
   * 4.0 for class 0x30 and 0x10, 0.0 for class 0x31. See
   * `camera/track.ts`'s `CAMERA_POINT_RISE`. `SelectCameraLookAtTarget` reads
   * this and never reads `pos`. Aiming at the origin instead put the camera on
   * the feet.
   */
  lookAt: Vec3;             // +0x100
  /** `EnemyThrowerUpdate` integrates `vel += acc` and then `pos += vel`. */
  vel: Vec3;                // +0x4C
  /**
   * The vertical acceleration accumulator the falling set-pieces integrate:
   * `accY -= g; vel.y += accY; pos.y += vel.y`. Two dwords past `vel`, and
   * distinct from it — `vel.y` is the speed, this is what feeds it.
   */
  accY: number;             // +0x5C
  /** `obj+0x58` and `obj+0x60` — the other two, which only the arcs use. */
  accX: number;             // +0x58
  accZ: number;             // +0x60
  /**
   * `ZombieStateEmerge`'s descriptor: `{delay, motion}` from the tail's
   * `+0x04` and `+0x08`. The clip's own root translation is what lifts the
   * actor out of the water or the ground.
   */
  emerge: { delay: number; motion: number } | null;
  /**
   * `ZombieStateDelayedLeap`'s: `{delay, dest, gravity}` from `+0x04`,
   * `+0x08..+0x10` and `+0x14`. The last is a per-frame **acceleration**, not
   * a duration — see `ActorArcBeginFalling`.
   */
  delayedLeap: {
    delay: number; dest: [number, number, number]; gravity: number;
  } | null;
  /**
   * The descriptor tail of whichever of the twelve entrance states this spawn
   * starts in — see `class30/entrance.ts`. One field rather than twelve
   * because a spawn has one initial state and every other state's reading of
   * the same bytes is the next descriptor's.
   */
  entry: ZombieEntryTail | null;
  hp: number;               // +0x11C
  maxHp: number;            // +0x11E
  /**
   * `obj+0x121` — **a signed byte with `0xFF` as its sentinel**, not a
   * non-negative count. `-1` when it holds no permit, else the index into
   * `g_attack_permits`.
   *
   * `[proved]` on both halves: read `MOVSX EAX, byte ptr [ESI + 0x121]`
   * (bytes `0fbe8621010000`) at 0x0044CB35 and 0x0045A155, and tested against
   * the sentinel by `SelectCameraLookAtTarget` (`FUN_00403050`) —
   * `MOV DL, byte ptr [ECX + 0x121]; CMP DL, 0xFF` (bytes `8a9121010000`,
   * `80faff`) at 0x00403075, and `CMP byte ptr [EAX + 0x121], 0xFF` (bytes
   * `80b821010000ff`) at 0x00403080. Every class `Init` seeds it to `0xFF`.
   * A `number` that cannot go negative is the wrong shape for it.
   */
  attackPermit: number;     // +0x121, s8, 0xFF = none
  /**
   * `obj+0x120` — the `g_enemy_slots` index this actor was last dealt, an s8
   * with `0xFF` (-1) for none. `UpdateCameraEnemySlots` (`FUN_00408DD0`) and
   * `RegisterEnemySlot` (`FUN_00408E80`) write it; the death paths clear the
   * slot it names -- and only the slot, so it can go stale. See
   * `camera/slots.ts`.
   */
  cameraSlot: number;       // +0x120, s8, 0xFF = none
  /** `ActorBodyConditionFromHands` — indexes the attack and motion tables. */
  condition: number;        // +0x130C
  state: number;            // +0x1310
  sub: number;              // +0x1312
  /** Destroyed zones — a mask of {@link DamageZone}. */
  zones: number;            // +0x1318
  /**
   * The attack index the strike drew — **one signed byte at `obj+0x131A`**,
   * read everywhere as `MOVSX EAX, byte ptr [ESI+0x131a]`
   * (`ZombieStateStrike` 0x00455A5A, `0fbe861a130000`) and written as a byte
   * (0x00455AD0, `88861a130000`).
   *
   * It used to be two fields. `attackIndex` was the second name, given to
   * `ZombiePickThrowingHand`'s hand pick — but the hand pick writes this same
   * byte, because hand 0/1 *is* attack entry 0/1 of the row, and modelling
   * them apart let a throw's pick and a melee pick both survive when the exe
   * has one of them overwrite the other.
   */
  attack: number;           // +0x131A, s8
  /**
   * Rank in the distance queue, nearest first, and **signed**: the engine
   * reads `(s8)obj+0x131D` everywhere, and `EnemyZombieInit` writes 0xFF, so
   * -1 is "not ranked yet" and passes every `rank < allowance` test.
   */
  rank: number;             // +0x131D
  /**
   * The **compacted** rank, and a different number: `RankEnemiesByDistance`
   * writes 0xE to every ranked actor, then drops the ones that are retreating
   * — `obj+0x34 & 0x20000000`, which `ZombieStateBackOff` sets — and numbers
   * the survivors 0, 1, 2… So a zombie queued behind one that has just swung
   * and is backing away moves up immediately. This is what the `< 3` cap
   * tests; `rank` is what the ring allowance tests.
   */
  queueRank: number;        // +0x131E
  /**
   * `obj+0x1324` — the set-piece **freeze** flag. `SetPiecePropDrawAndTick`
   * advances the motion frame only while it is zero, so a non-zero value holds
   * the pose. Selectors 2 and 3 start frozen and a camera cue releases them.
   */
  frozen: number;           // +0x1324
  /**
   * `obj+0x1330` — the set-piece slide's countdown, in frames.
   *
   * Class 0x30's corpse countdown was this field and is now
   * {@link ZombieTail.corpseTimer}: same word, a different class's clock.
   */
  slideTimer: number;       // +0x1330
  /**
   * `obj+0x1320` — frames a wait has been stalled for. `SetPieceStateHoldThenPlay`
   * counts its hold in it, and class 0x25's VM its frame conditions.
   *
   * Both count **up** and both are reset by the routine that reads them, but
   * they are not the same field: class 0x24 tests it against `tail+0x0C` and
   * class 0x25 against a command's `a`, and class 0x30 aliases the same
   * address as `zom.scriptMotion`, which is a motion id and not a counter at
   * all.
   *
   * **Class 0x30 does not share this field**, and used to. Its holds are
   * counted at `obj+0x1330` — `[proved]` at `ZombieStateEmerge`
   * (`0x00458596`), `ZombieStateRunInPlaceTimed` (`0x004571B0`) and
   * `ActorArcBeginFalling` — so the port had two addresses under one name.
   * That reading is now {@link ZombieTail.holdFrames}.
   */
  holdFrames: number;       // +0x1320, class 0x24
  /** Which of `g_enemy_approach_rings` this actor measures against. */
  ringSet: number;          // +0x131F
  /**
   * `obj+0x131B` — this actor is one of the holders of the looping
   * held-weapon SE counted by `G.g_weapon_loop_holders`.
   *
   * A latch, not a count: `EnemyZombieInitByCharType` (`0x00453164`) writes 1
   * for character types 2 and 3, `ZombieReleaseWeaponLoopSe` (`FUN_00456600`)
   * refuses to do anything unless it is 1 and writes 0 on its way out. The
   * only two readers in the image are that routine's own guard and
   * `ScriptedHumanoidBoneDrawHook`, which is class 0x25 and a different
   * meaning of the same byte (**L3**).
   */
  weaponLoopHeld: number;   // +0x131B, u8
  /** How deep in the distance queue this actor may be and still attack. */
  allowance: number;        // +0x1358
  /** Frames before this actor may claim again. `ZombieStateHoldAtRange`
   *  forces it to zero unless `obj+0x1368` bit 0 is set. */
  cooldown: number;         // +0x133C
  /**
   * The player point the strike measures its lunge against, written by
   * `ActorFacePlayerTarget`. With one attacker it is the camera eye; with two
   * it is a shoulder offset from it, which is why it is stored rather than
   * recomputed.
   *
   * On a class-0x31 `zsass` (character type 0x16) the same words are the
   * last point of its trail (L3): `ThrowerStateStandAndDecide` seeds them
   * where it stands, and `ThrowerEmitGroundDust` (`FUN_0044D260`) spawns its
   * scuffs between them and the actor and then moves them up to it.
   */
  target: Vec3;             // +0x13E4
  /** Where the actor stood when its strike began; `ZombieStateBackOff`
   *  retreats toward it. */
  strikeStart: Vec3;        // +0x13D8
  /**
   * The ballistic arc a spawn placed in the air rides down, from its
   * descriptor. Null for a spawn that is already on the ground.
   */
  leap: { dest: [number, number, number]; frames: number } | null;
  /** `obj+0x13C0` — where the arc began. */
  arcFrom: Vec3;
  /** `obj+0x1330` — frames of the arc elapsed. */
  arcFrames: number;
  /**
   * The route a `ThrowerStatePathFollow` spawn walks before it fights, from
   * its descriptor: a delay and a list of waypoints.
   *
   * Decoded descriptor, written by the class-agnostic
   * `DescriptorFromPlacement`, so it stays on the head; which leg of it the
   * spawn is on is `ThrowerTail.pathLeg`, on class 0x31's arm.
   */
  path: { delay: number; points: PathPoint[] } | null;
  /** `obj+0x1334` — how many it lasts. */
  arcTotal: number;
  /** `obj+0x13CC` — where the arc ends. */
  arcTo: Vec3;
  /**
   * `obj+0x1360` — which of `ActorArcStep`'s five phases the arc is in. The
   * same word the path rider keeps its offset in; only one class uses it at a
   * time, which is why they are two names for one offset here.
   *
   * On a thrower its readers are `ActorArcStep`'s dispatch,
   * `ThrowerStrikeConnect`'s melee arm and `ThrowerStateLeapToPoint`, all
   * against the phase. `ThrowerStateCloseAndStrike` writes
   * `g_players_in_play` into it (`0x0044EA93`) and none of them reads that:
   * see the routine.
   */
  arcPhase: number;
  /**
   * The three-stage arc motion script the current leap is playing.
   *
   * [diverges] The engine keeps these in `g_arc_scripts` (0x009C8AA0), one
   * 0x30-byte slot per enemy slot, because `InstallArcMotionScript` copies
   * rather than points. It is per-actor state either way, and holding it on
   * the actor is what puts it in the snapshot.
   */
  arcScript: ArcStage[] | null;
  /** `obj+0x136C` — see {@link ThrowerFlag}. */
  flags2: number;
  /**
   * `ThrowerStateWalkDistance`'s target, from the descriptor — and
   * `ZombieStateWalkDistance`'s, which reads the same float at **`desc+0x04`**:
   * `*(float *)(obj+0x1390 + 4)`, four bytes into the descriptor parameter tail
   * `SpawnFromDescriptor` (`FUN_00408A20`) hangs at `obj+0x1390`.
   *
   * The comment here used to say "tail `+0x04`", which reads as `obj+0x04` —
   * and `obj+0x04` is inside the task control block `ActorAlloc`
   * (`FUN_004A6FA0`) owns, which no class may touch. This is not an actor
   * field at all: it is one immutable descriptor value two classes read.
   */
  walkDistance: number;     // desc+0x04
  /** `ZombieStateStandAndThrow`'s descriptor tail, from the bundle. */
  standThrow: CharacterPlacement["stand_throw"];
  /**
   * Class 0x20's descriptor tail, from the bundle — the sub-type, the removal
   * cue, the authored motion and sub-type 2's box.
   *
   * Its own field and not the shared `condition` / `initialState` pair,
   * although `OneHitTargetInit` (`FUN_00448ED0`) reads the **same two bytes**
   * `EnemyZombieInit` (`FUN_00452DA0`) reads as those: `tail+0x00` is the
   * character type here and `tail+0x01` a sub-type. Two classes, one byte
   * range, two readings — which is the polymorphism a shared field would hide
   * rather than record.
   */
  oneHitTarget: CharacterPlacement["class20"];
  /**
   * Class 0x52's descriptor tail — one s16, the sub-type. Sub-types 2, 3 and 4
   * are shootable route-branch triggers; 0 and 1 wander.
   *
   * Its own field for the reason above: `tail+0x00` is class 0x30's body
   * condition.
   */
  /**
   * Class 0x51's descriptor tail — the fish's speeds, bob and timings, or the
   * water level when the record is a group header.
   *
   * Its own field for the reason class 0x20's and class 0x52's are:
   * `tail+0x00` is class 0x30's body condition, and here it is a float.
   */
  /** Class 0x11's descriptor tail — the frog's cue, wedge and command list. */
  class11: CharacterPlacement["class11"];
  /** Class 0x13's descriptor tail — the prop's slot, despawn cue, behaviour. */
  class13: CharacterPlacement["class13"];
  /** Class 0x12's descriptor tail — the strip, its flag, delay and cue. */
  class12: CharacterPlacement["class12"];
  /** Class 0x18's three — the rider's leave-state and its camera cue. */
  class18: CharacterPlacement["class18"];
  /** Class 0x26 subtype 2's tail — the collision blob its first frame seats. */
  class26: CharacterPlacement["class26"];
  /**
   * `obj+0x14C` — **a collision blob of the object's own**, traced in its own
   * space. `-1` in the engine, `null` here, for every object that has none.
   *
   * `ColiTraceSegmentAllSets` (`FUN_004053B0`) and
   * `ColiTestSphereAgainstFullSet` (`FUN_004057F0`) both open with a pass over
   * every registered object whose `obj+0x14C != -1` and whose `obj+0x34` has
   * bits `0x10` and `0x40` up and `0x80008000` down, and test the query
   * against this blob through the inverse of {@link coliMatrix}. That is how
   * a moving object is ground: the zombie that leaps onto stage 3's boat lands
   * on its deck because of it. The key is the bundle's `coli.blobs` key.
   */
  coliBlob: string | null;
  /**
   * `obj+0x150` — the object's **world** matrix, the one {@link coliBlob} is
   * in. `[port-only]` layout: row-major 3x4, `[r00 r01 r02 tx, r10 r11 r12 ty,
   * r20 r21 r22 tz]`, a point being `R·p + t`.
   *
   * The engine's draw stores the stack top here (`MatrixStore`, `FUN_004A8CA0`)
   * — which is view-space, since the view is under it — and
   * `RegisterForShotTest` (`FUN_00405160`) multiplies the camera block's
   * matrix back in for an object carrying `obj+0x34 & 0x10`, at
   * `0x00405190`..`0x004051CC`, which `[likely]` leaves the world matrix: the
   * collision passes invert it and trace world points through the inverse,
   * which is only meaningful if it is. `null` until the object has posed.
   */
  coliMatrix: number[] | null;
  /**
   * `obj+0x13B0` — the carrier this actor rides, by spawn address.
   *
   * `[diverges]` The engine keeps a pointer; an address is what survives a
   * snapshot and is what every other cross-actor reference here uses. `-1`
   * once the actor has stepped off, which is `CarriedZombieUpdate18` putting
   * the plain zombie update back.
   *
   * That makes this field the task pointer as well, which the engine keeps
   * apart (`*obj`, read at one site, `0x0045B999`). Four routines swap it:
   * the step off, the two leaps and `ZombieStateRetireOffScreen`'s carrier
   * arm. The first three bake the carrier into the pose first; the retire
   * does not, so the one frame it still draws -- the engine's in the
   * carrier's matrix, the swap taking effect at the next update, which is the
   * despawn -- `render/` places at the carrier-relative point.
   */
  carrierAt: number;
  /**
   * Where the carrier's matrix puts this actor, in world space.
   *
   * `[port-only]` The engine has no such field: it pushes the carrier's matrix
   * around the whole update, so the draw and the shot test inherit it. The
   * port has no matrix stack in `game/`, so the composed point is published
   * here for `render/` and the camera to read.
   */
  carrierWorld: Vec3;
  /** The carrier's own yaw, so a rider's facing composes with it. */
  carrierYaw: number;
  /** Class 0x43's two descriptor bytes — the owl's member index and sub-type. */
  class43: CharacterPlacement["class43"];
  /**
   * Class 0x46's three descriptor bytes — the bat's sub-type, flight group
   * and member index. All three of them, because a class-0x46 descriptor says
   * nothing else at all: the position is in the EXE.
   */
  class46: CharacterPlacement["class46"];
  /**
   * Class 0x45's descriptor byte, `desc+0x25` -- the sub-type
   * `Boss3ClassHandler` (`FUN_0041FC00`) dispatches on. Its own field for the
   * reason class 0x46's is: nothing else in the descriptor says which of the
   * stage-3 boss's six inits this actor runs.
   */
  class45: CharacterPlacement["class45"];
  /**
   * Class 0x40's one descriptor byte that anything reads: `desc+0x25`, the
   * selector `PlaceHorde` (`FUN_0043BD30`) switches on — a horde, or the prop
   * it pushes up. Only the placer carries it; a member is built with none.
   */
  class40: CharacterPlacement["class40"];
  /**
   * Class 0x42's descriptor byte, `desc+0x25` -- the sub-type
   * `PlaceWormBatch` (`FUN_0042F9B0`) switches on. Only the placer carries
   * it; the objects it builds are allocated with none.
   */
  class42: CharacterPlacement["class42"];
  class51: CharacterPlacement["class51"];
  class52: CharacterPlacement["class52"];
  /**
   * Class 0x14's descriptor tail — the state the boss starts in, the route
   * quad it swims inside, and the camera cue that despawns it.
   *
   * Its own field for the reason class 0x20's and class 0x52's are: `tail+0x00`
   * is class 0x30's body condition and `tail+0x01` its initial state, and
   * `Class14Init` (`FUN_00475E90`) reads those two bytes as a character type
   * and a `Class14State`.
   */
  class14: CharacterPlacement["class14"];
  /**
   * Class 0x16's marker -- `WaterFieldCreate` (`FUN_00442290`) reads no tail,
   * only the spawn's `y`. Present only on a wave-field spawn.
   */
  class16: CharacterPlacement["class16"];
  /**
   * Class 0x17's tail -- one wave source's kind, amplitude, wavelength and
   * speed, as `WaterWaveSourceAdd` (`FUN_004422D0`) and its first tick read
   * them.
   */
  class17: CharacterPlacement["class17"];
  /**
   * Class 0x19's descriptor tail -- the stage-4 boss's entrance, its per-bone
   * collision meshes and the camera pair that despawns it. See
   * `game/class19/`.
   */
  class19: CharacterPlacement["class19"];
  /**
   * `bone record +0x88` per bone, for the bones that are shot-tested against
   * a **collision mesh** rather than a sphere -- the `coli.blobs` key, by
   * bone index. `ShotTestBoneTree` (`FUN_00404750`) takes `ShotTestBoneMesh`
   * (`FUN_004048A0`) for a record whose `+0x74` has bit `0x10` and whose
   * `+0x88` is not -1, and the sphere test otherwise. Two routines write it,
   * each also raising `+0x74 |= 0x51` and zeroing the sphere's radius at
   * `+0x78`: `Boss4Init` (`FUN_004917E0`) for the stage-4 boss's tail, and
   * `EnemyZombieInitByCharType` (`FUN_00452FD0`) for the weapon hands of
   * class-0x30 character types 2, 3 and 0xE ({@link Actor.boneMeshColi}).
   * An entry here is all three.
   */
  boneColi: Record<string, string>;
  /**
   * The class-0x30 descriptor tail's `+0x10`, as `EnemyZombieInitByCharType`
   * (`FUN_00452FD0`) reads it for character types 2, 3 and 0xE: the
   * `coli.blobs` key of the mesh it gives bones 5 and 8. `null` for every
   * other type, whose `+0x10` is something else.
   */
  boneMeshColi: string | null;
  /**
   * Class 0x22's descriptor tail — JUDGMENT's flier: variant, first clip,
   * despawn cue, the three hit-point words and the nested companion. Its own
   * field for the reason class 0x14's is: `tail+0x01` is class 0x30's
   * initial state, and `Class22Init` (`FUN_0049B0D0`) reads it as a variant.
   */
  class22: CharacterPlacement["class22"];
  /** Class 0x23's — the walker's subtype and despawn cue, on the same terms. */
  class23: CharacterPlacement["class23"];
  /**
   * Class 0x33 **selector 1's** descriptor tail — the draw slot, the `op_`
   * path it rides, and the four cues that raise its two `obj+0x34` bits and
   * take it off the field.
   *
   * Its own field for the reason class 0x14's, 0x20's and 0x52's are:
   * `tail+0x00` is class 0x30's body condition. Null on the other ten
   * sub-handlers, which the bundle carries no tail for at all — so its
   * presence *is* the selector, and `ScriptedSceneryDispatch33`
   * (`FUN_00432FF0`) reads `obj+0x11C` for the same answer.
   */
  class33: CharacterPlacement["class33"];
  /**
   * Class 0x33 **selector 4's** tail — the draw slot, the sphere, and the two
   * script flags that arm the push and take the object off the field.
   *
   * Never non-null on the same actor as {@link class33}: the exporter sets
   * exactly one of the two, keyed on the descriptor's `+0x22`, because they
   * are two sub-handlers' readings of the same bytes. So this field's presence
   * *is* the selector, the same way that one's is. See `class33/pushable.ts`.
   */
  class33Push: CharacterPlacement["class33_push"];
  /**
   * Class 0x33 **selector 5's** tail — one word, the camera frame
   * `ScriptedEffectAtCameraCue33` (`FUN_00433B00`) goes off on.
   *
   * The third of the class's mutually exclusive blocks, on the same terms as
   * {@link class33} and {@link class33Push}: the exporter keys it on the
   * descriptor's `+0x22`, so its presence *is* the selector. See
   * `class33/effect_cue.ts`.
   */
  class33Cue: CharacterPlacement["class33_cue"];
  /**
   * `obj+0x124` — the radius `ShotTestSphere` (`FUN_00404630`) measures the
   * shot against, and the **whole** hit test for an actor with no skeleton.
   *
   * The engine tests this sphere first for every registered object and only
   * then descends into the bone tree, and only when `obj+0x34` bit 7 is set
   * and the character type has nodes. A class that sets neither — class 0x52
   * is the one the port reaches — is hit as one sphere, whole.
   *
   * Zero means the class never set one, which for the port means "not
   * shootable by the sphere test"; the skinned classes are picked through
   * their bones instead and do not read this.
   */
  hitRadius: number;        // +0x124
  /**
   * Class 0x53's descriptor tail — the animation set and the sub-type. Sub-type
   * 2 and up is a shootable route-branch trigger, and only in event block 8;
   * 0 and 1 play their set's playlist. `CatInit` copies what it keeps into
   * the class's own sub-block, `cat` (`class53/state.ts`).
   */
  class53: CharacterPlacement["class53"];
  /**
   * How deep in the **world** this actor's body sphere was on its last push,
   * and zero when it was clear.
   *
   * [diverges] The engine has no such field: it keeps one flag bit,
   * `ZombieFlag2.Shoved`, raised by *either* push and cleared next frame, so
   * nothing in the game can tell "wedged in a wall" from "shouldering past
   * another zombie". That distinction is the whole point of the overlay in
   * `render/stuck_debug.ts`, and a bit that cannot make it is no use — so the
   * depth is recorded here rather than being recomputed by the renderer, which
   * would mean tracing the level a second time and clobbering
   * `g_coli_hit_normal` behind the game's back.
   *
   * It is plain data on the actor, so a snapshot carries it and a reload shows
   * the same actors wedged in the same walls.
   */
  worldPushDepth: number;
  /** `ThrowerStateEntranceClip`'s one-shot clip, from the descriptor. */
  entranceMotion: number;
  /** `ThrowerStateDelayedPounce`'s clip and duration, from the descriptor. */
  pounce: { motion: number; frames: number } | null;
  /** `ThrowerStateGrabPlayer`'s descriptor tail. */
  grab: {
    offset: [number, number, number];
    cue_frame: number;
    drop_frames: number;
    hold_frames: number;
    player: number;
  } | null;
  /** `ThrowerStateBlinkInThreeHops`' delay, from the descriptor. */
  backAwayDelay: number;
  /** `ThrowerStateWaitForCue`'s descriptor tail. */
  cue: { motion: number; cond: number; operand: number } | null;
  /** `ThrowerStateLeapStrike`'s arc duration, from the descriptor. */
  leapStrikeFrames: number;

  // -- class 0x31's damage and death chain -------------------------------
  /**
   * The shot `ResolveHit` charged that this actor has not reacted to yet.
   *
   * The engine has no such field: `MarkActorShot` sets `obj+0x34` bit 3 and
   * writes the bone to `obj+0x190 + player`, and the actor's own update drains
   * it. This is that pair, in one place, because the port resolves the damage
   * at shot time and the class picks its reaction on its next tick — the same
   * frame boundary the engine has.
   */
  /**
   * ...and **which player fired**, because the engine's record is per player:
   * `DispatchHit` (`FUN_004092F0`) reads the bone from `obj+0x190 + player`,
   * and `ZombieOnShot` (`FUN_00453EB0`) walks `g_hit_player_order` around the
   * whole of its body. Optional, because only the shot path knows it: the
   * routines that fabricate a hit -- `ActorKillAll`, the debug clear -- have
   * no shooter to name.
   *
   * `ZombieOnShot`'s live arm is the one reader. `ActorReactToHit`
   * (`FUN_004543F0`) is called there, at `0x0045401A`, with the player as its
   * only argument.
   */
  pendingHit:
    { bone: number; result: number; player?: number } | null;  // +0x190
  /**
   * `obj+0x190 + player` — the byte `MarkActorShot` (`FUN_00404DB0`) writes
   * for **each** shooter: the index of the bone the shot entered, or 1 when
   * the actor was hit whole, as one sphere (`ShotTestSphere`'s else arm).
   * Zero is "this player's shot did not land".
   *
   * {@link pendingHit} is the same byte merged into one record for the
   * classes whose damage the port resolves at shot time; this is the engine's
   * own shape, per player, for the classes that read it themselves -- the
   * bosses' shot routines walk both entries. Whoever consumes a shot clears
   * its byte, as the engine's routines do.
   */
  shotBones: number[];
  /**
   * `[port-only]` -- the ray of the pull that wrote {@link shotBones}`[p]`,
   * per player: `G.g_crosshair_ray[p]` as it stood when `MarkActorShot` ran.
   *
   * The engine polls the trigger once a frame, so the shot record a class
   * reads back after being marked (`g_shot_records[p] + 0x18/+0x24`,
   * `G.g_crosshair_ray` here) is always the pull that marked it. The port's
   * queue lets several pulls into one frame -- a driver's volley arrives
   * whole between two driven frames -- and the last of them, not the one
   * that landed, would be what the class read. A class that reads the record
   * back (class 0x14's weak-point gates) reads this instead; with one pull a
   * frame the two are the same object.
   */
  shotRays: (ShotRay | null)[];
  /**
   * `obj+0x131C` — which player's shot killed this actor.
   *
   * `CivilianPruneDeadChildren` reads it off a dead captor to decide who is
   * paid for the rescue. `ResolveHit`'s kill arm writes the shooter here
   * (`0x004097D1`); `ActorReactToHit`'s `znjoe` arm, `ZombieRetireAndCredit`
   * and `ZombieStateAwaitCivilianOrder` are the other writers. `-1` is the
   * engine's own "could not name one", and pays both players.
   */
  killedBy: number;         // +0x131C
  /**
   * `obj+0x124` — the actor's own radius, from `g_actor_radius_by_char`.
   *
   * `ShotTestSphere` (`FUN_00404630`) tests this sphere for any actor that is
   * not shot per bone. A class-0x10 civilian always is one: nothing in the 136
   * command streams ever raises `obj+0x34` bit 0x80, so the whole class is a
   * ten-unit ball and not a skeleton.
   */
  /**
   * `ActorDespawn` (`FUN_00409CC0`) has taken this object out of the pool.
   *
   * The engine unlinks it; a list with a flag is the same thing with an index,
   * and it keeps the actor addressable for the frame the renderer needs to
   * drop its instance. Class 0x10 is the first class whose *script* can retire
   * it — a civilian walks off when its removal cue fires.
   */
  despawned: boolean;
  radius: number;           // +0x124
  /**
   * `obj+0x128` — the **body** radius, which is a different number from the
   * shot radius above and is the one every collision uses.
   *
   * `EnemyZombieInit` writes 3.5 and `EnemyThrowerInit` 5.0 for character type
   * 0x16 or 4.0 for 0x17-0x19; `g_actor_radius_by_char` fills `+0x124` beside
   * it. The port had neither, so the body sphere had **radius zero** and the
   * world push could never find a wall — which is why a zombie walked through
   * one instead of sliding along it.
   */
  bodyRadius: number;       // +0x128
  /**
   * `obj+0x138`..`+0x148` — the push another actor recorded on this one.
   *
   * `ColiTestSphereAgainstActors` does not move the actor it finds: it writes
   * the opposite push onto it and lets it apply that on its own next frame.
   * `pushedBy` is the actor that did it, by spawn address, or `-1` — an
   * {@link ActorRef}. Ghidra types `obj+0x138` as `float`; it holds a pointer.
   */
  pushedBy: ActorRef;       // +0x138
  pushDepth: number;        // +0x13C
  pushNormal: Vec3;         // +0x140
  /**
   * `obj+0x12C/0x130/0x134` — **the actor's collision-sphere centre**.
   *
   * `RegisterForShotTest` (`FUN_00405160`) publishes it, with `obj+0x34`, into
   * the per-frame dynamic list at 0x0059D8E8, and that list feeds *both*
   * consumers: the gunshot hit test, and — after the copy to 0x005A30A0 —
   * `ColiTestSphereAgainstActors` (`FUN_00405B10`), the actor-versus-actor
   * push. `ThrowerPushOutOfWorld` passes its address as a vec3
   * (`LEA EAX, [ESI + 0x12C]` at 0x00449D69 and 0x00449E02). The radius that
   * goes with it is {@link Actor.radius} for the shot and
   * {@link Actor.bodyRadius} for the push. `[proved]`
   *
   * It was called `camPoint` here, after `CivilianUpdate`'s camera-point
   * switch (`sub+0x80`, op 0x17) — one class's writer naming a field three
   * class-agnostic routines read. Renamed for that reason; the writers are
   * `ActorUpdateBoundingSphere` (`FUN_00454AC0`) for class 0x30,
   * `ThrowerPlaceCollisionSphere` (`FUN_00449E80`) for class 0x31, and that
   * switch for class 0x10 — the actor's position, bone 2, bone 1 (the
   * default), or halfway between bones 12 and 15, each bone read out of its
   * draw record as a world point (`class10/update.ts`,
   * `CivilianWriteSphereCentre`). Whatever a class writes here is what the
   * others' crowd push measures: `RegisterForShotTest` records it and
   * `ColiTestSphereAgainstActors` reads it back out of `g_coli_dynamic_list`
   * a frame later, whichever class wrote it.
   *
   * It is **not** what the camera aims at: that is `obj+0x100`
   * ({@link Actor.lookAt}), which the skeleton walk writes and
   * `ActorRegisterCameraPoint` lifts.
   */
  sphereCentre: Vec3;       // +0x12C
  /**
   * `obj+0x70/0x74/0x78` — the point `RegisterForShotTest`
   * (`FUN_00405160`) publishes and `ShotTestSphere` (`FUN_00404630`) measures
   * `obj+0x124` around. **Not** {@link sphereCentre}, which is `obj+0x12C`,
   * the collision and push sphere.
   *
   * Written by each class's own update, immediately before it registers, and
   * that is the engine's arrangement rather than a port choice: there is no
   * shared routine that fills it, so what goes in is the class's business.
   * Class 0x46 puts `(x, y + 1, z)` there. A class that never writes it is one
   * whose shot is resolved bone by bone and never reads it.
   */
  shotCentre: Vec3;         // +0x70
  /**
   * Class 0x10's `ActorAllocSub(0xC4)` block at `obj+0x1310`.
   *
   * `obj+0x1310` is `state` for a combat class; for a civilian it is a
   * pointer to its own script state, which is the polymorphic-field trap in
   * its clearest form. See `class10/state.ts`.
   */
  civ: CivilianState | null;                             // +0x1310
  /**
   * Class 0x19's `FUN_004A74E0(0xA4)` block at `obj+0x1310`.
   *
   * The third thing this one offset holds — `state` for a combat class,
   * {@link Actor.civ} for a civilian, and this for the stage-4 boss — and the
   * reason L3 is L3. See `class19/state.ts`.
   */
  boss4: Boss4Block | null;                              // +0x1310
  /**
   * `obj+0x1394` — **the object this actor was built for**, by spawn address.
   *
   * An {@link ActorRef}, and the *other* kind of thing this offset holds.
   * `ThrowerStatePathFollow` (`FUN_0044EE00`) and `ScriptedHumanoidInit`
   * (`FUN_004840D0`) keep a walking **descriptor** pointer here — see
   * {@link ListCursor} — while for a class-0x30 zombie it is a **parent
   * actor**, written by `CivilianInit` (`FUN_0048A3E0`) for the 47 captors it
   * builds, and the whole `ZombieStateWalkToTarget` family walks at it instead
   * of at the camera. `-1` for an actor that has none.
   *
   * Two pointers to different kinds of thing, one word: a `pathLeg` assigned
   * into a `targetAt` would be a live actor id in the port and is exactly what
   * the two aliases exist to make visible at a glance.
   */
  targetAt: ActorRef;       // +0x1394, classes 0x2D and 0x30
  /**
   * The two captor scripts off the descriptor tail, decoded — `+0x04` for the
   * initial state and `+0x08` for the attack state. `ZombieScriptForState`
   * (`FUN_0045CA10`) picks between them by which state the actor is in.
   */
  script: { target: TargetScriptJson | null;
            attack: TargetScriptJson | null } | null;
  /**
   * `obj+0x138C` — a **draw alpha**, and the engine's readers of it are
   * per-part, never per-actor:
   *
   * * `DrawCharacterPartSlot` (`FUN_00419B40`) draws the vertex-blended parts
   *   of character types 9, 0x12, 0x17 and 0x18 at it, unconditionally —
   *   see `PART_ALPHA_CHAR_TYPES` in `game/model_draw.ts`;
   * * `ThrowerDrawBonePart` (`FUN_00449F90`) draws a class-0x31 bone at it
   *   while {@link ThrowerFlag.Blinking} is up, which is what the blinking
   *   states write it for -- 0 and 1 -- and writes a 120-frame ramp into it
   *   itself on a `0x1FB9` node;
   * * `ZombieSubmitSlotByLighting` (`FUN_00453AE0`) draws every class-0x30
   *   bone at it while `obj+0x1368` bit `0x20` is up
   *   (`zom.fadeDraw`), which `EnemyZombieInitByCharType`
   *   (`FUN_00452FD0`) raises for character types 9 and 0x12 with the alpha
   *   at 0.25 and 0, and `ZombieDrawBonePart` (`FUN_004534A0`) steps it --
   *   down to 0 on the twin's `0x1C7C` node, up to 1 on `znele`'s `0x1C6C`.
   *
   * What each node was drawn at is {@link Actor.nodeDrawAlpha}.
   *
   * It is not a draw gate for the whole actor and not a stand-in for one:
   * hiding a class-0x30 actor is {@link MotionFlag.Drawn} and
   * {@link Actor.partVisible}. Classes 0x22, 0x23 and 0x40 still write it as
   * a port-only "drawn this frame", which `render/characters.ts` honours for
   * them alone.
   */
  alpha: number;            // +0x138C

  /**
   * How close the bite may bring this actor to its target.
   *
   * [diverges] The engine has no such clamp that I can find, and the bite
   * plainly does travel — the recover is what the retreat then walks back, and
   * that walk is the only pause between bites; `obj+0x1338`, the 60 that
   * `ZombieStateBackOff` writes, is read nowhere in the program. But the clip
   * *overshoots its own settle point*: `char_adv00`'s bite runs
   * 0 -> -18.1 -> -15.55, so its peak carries the actor two and a half units
   * past where it ends up, and at that peak it is inside the camera. This
   * floors the travel at where the clip finishes, which keeps the recover and
   * so the pause, and drops only the transient.
   */
  strikeFloor: number;

  /**
   * This swing has already landed its hit.
   *
   * Kept, but **no longer a divergence.** It used to read: "the engine tests
   * `obj+0x19C == hit_frame` for exact equality against a counter that
   * advances one per update, so it can only fire once. The port advances clips
   * in seconds, so it latches instead." Every clip clock in the port is now a
   * whole-tick counter, so the equality fires exactly once on its own and the
   * latch is not standing in for anything.
   *
   * It stays because the engine has it too: class 0x31 reads and clears its
   * own equivalent around the grab, and a latch that agrees with the engine is
   * not a workaround.
   */
  struck: boolean;

  // -- descriptor --------------------------------------------------------
  /**
   * `obj+0x1316` — the spawn descriptor's `+0x20` word, **sign-extended**.
   *
   * `SpawnFromDescriptor` (`FUN_00408A20`) copies it in before the class's
   * `Init` runs — `MOV AX, word ptr [EDI + 0x20]` (`668b4720`) then
   * `MOV word ptr [ESI + 0x1316], AX` (`66898616130000`) at 0x00408A77 — and
   * each combat class's `Init` makes it the low half of {@link flags2}:
   * `EnemyThrowerInit` (`FUN_00449620`) ORs `0x180000` onto it,
   * `EnemyZombieInit` (`FUN_00452DA0`) ORs `0x60000000`.
   *
   * For class 0x31 the bits are the **starting surface**, and dropping this
   * word is why five stage-6 `zslman` all blinked in standing on the floor.
   * Class 0x30 has 76 shipped spawns that set it and does not read it here
   * yet.
   *
   * Not the same word as {@link flags}, which is the descriptor's `+0x04`.
   */
  descFlags: number;        // +0x1316
  /**
   * The state `EnemyZombieInit` starts this actor in — descriptor byte +2.
   * Every entrance state in stage 2 funnels into `AttackRun`.
   */
  initialState: number;
  /**
   * The state a permit-holder enters out of `ZombieStateApproach` —
   * descriptor byte +3. Nothing else reads it: `ZombieStateHoldAtRange`, which
   * is where an ordinary zombie actually decides to swing, does not.
   */
  attackState: number;
  /**
   * The descriptor tail's `+0x0C`/`+0x0E`, or null when `+0x0C` is -1.
   * The camera path and frame a captor's exit waits for.
   */
  cameraCue: { path: number; frame: number } | null;

  // -- runtime the renderer reads ----------------------------------------
  dead: boolean;
  /** The script has this spawn live and the renderer is showing it. */
  visible: boolean;
  /**
   * `obj+0x1B4` — the looping base motion id.
   *
   * It is `model[8]` of the embedded skinned-model record at `obj+0x194`, and
   * `0x194 + 0x20 == 0x1B4`: `ActorSetMotion` (`FUN_00411930`) is
   * `model[8] = id` and nothing else writes it. Every class `Init` calls it.
   * `[proved]`
   */
  motion: number;           // +0x1B4
  /**
   * `obj+0x19C` — the play cursor, **in whole 60 Hz ticks**, not in seconds.
   *
   * It was seconds, accumulated as `clock += dt` with `dt = 1/60`, and read
   * back as `Math.floor(clock * fps * 2)`. Repeated float addition of 1/60
   * does not land on multiples of 1/60, so the derived cursor **skipped
   * values**: it went 6, 8 and 30, 32, never showing 7 or 31, and showed 5
   * twice. Sixteen call sites test this cursor with `===` — correctly, because
   * `>=` double-fires across the `% (len + 1)` wrap — so an authored cue of 7,
   * 15, 31 or 507 could never fire and the actor simply parked. That is the
   * shape of most of the player's hangs.
   *
   * The engine's field is an integer incremented once per frame, and the
   * architecture doc's "whole ticks, never a fraction" rule was true of
   * `G.g_frame` and false of this. Now it is true of both: seconds are derived
   * at the point of use, never accumulated.
   */
  playTicks: number;
  /**
   * `model+0x08` (`obj+0x19C`) where a store has put a value the sampler has
   * not yet recomputed -- `null` when the cursor is what {@link playTicks}
   * gives, which is every frame but one.
   *
   * The engine keeps two words: the counter at `model+0x00`, which the class
   * steps, and the cursor at `model+0x08`, which `SkeletonAdvancePlayCursor`
   * (`FUN_004111A0`) recomputes from it on every draw (`model[2] = model[0]
   * % (play + 1)`, `0x004111DD`) unless the fade bit holds it. The port keeps
   * one, {@link playTicks}, and derives the cursor from it. A store to the
   * cursor alone -- `CivilianReapplyWaitCommand`'s ops 0x00 and 0x01
   * (`FUN_0048B760`) -- therefore has nowhere to go but here: it reaches
   * whatever reads the cursor before the next draw and nothing after it.
   * Written through `ActorStorePlayCursor`; cleared by `ActorAdvanceMotion`
   * (the next sample) and by `ActorSetMotionBlended` (`track[2] = start`).
   */
  cursorStore: number | null;
  /**
   * The clip being faded *out* of, and how far into it.
   *
   * `ActorSetMotionBlended` (`FUN_004119A0`) takes a fade length as its fourth
   * argument and stores it at `track+0x30`; every state passes one — 5 for the
   * approach walk and the strike, 10 for the run, the idle, the retreat, the
   * lunge and the wait. `ActorSetMotion` (`FUN_00411930`) is the one that does
   * not, and it is used for the scripted cues that are meant to snap.
   *
   * Without it every transition is a cut, which is what made the bite jump
   * straight into the walk-back.
   *
   * `records` are skeleton records whose snapshotted rotation is **not** the
   * clip's: a state that writes the drawn pose's records before it blends
   * (`Boss4StateTurnClipThenApproach`, `FUN_00494730`, rewrites records 1 and
   * 9 at `char+0x10C` and `+0x58C`) hands the renderer the BAMS it wrote, and
   * the fade dissolves from those. The frog's two turning states do the same
   * to record 1 after every pass of a turn clip (`FrogStateHopWithinScreenWedge`
   * (`FUN_0043AA10`), `FrogStateLeapAtPlayer` (`FUN_0043B270`)).
   * `CivilianApplyMotionPose` (`FUN_0048C310`) rewrites records 1 and 9 the
   * same way, or record 0 -- the root's own rotation.
   *
   * `root` is the same for the root translation, `model+0x6C..0x74`, which
   * `MotionLoadPoseSlot` mode 0xC copies into slot A beside the angles: an
   * axis present here is the one the fade dissolves from, an absent one is
   * the clip's. `CivilianApplyMotionPose` is its writer -- all three when it
   * has just moved the actor to hold bone 1, x and z when the outgoing block
   * walked on its clip.
   */
  fadeFrom: { motion: number; ticks: number; records?: FadeRecord[];
              root?: FadeRoot } | null;
  /**
   * Frames of the cross-fade left. It starts at the fade length and the
   * fade is over when it goes **below zero**, so the incoming clip is held on
   * its start frame for `length + 1` frames, as the engine holds it -- see
   * `ActorAdvanceMotion` and `ActorRestartFade` in `class30/motion_cue.ts`.
   */
  fade: number;
  /**
   * The engine's `track+0x30`: the fade length **plus one**, so that the
   * weight `1 - fade / fadeLen` runs from `1 / (length + 1)` to one.
   */
  fadeLen: number;
  /**
   * The **play cursor** the root-motion step was last taken at, for the base
   * motion and for `action`; `-1` when the baseline has just been re-seeded
   * and the next step is nothing. It stands for `SkeletonApplyRootMotion`'s
   * (`FUN_00410C50`) baseline, `model+0x1160..0x1168`, which is the previous
   * draw's root whenever the gate is up -- see `rootDelta` in
   * `game/root_motion.ts`. A cursor and not an authored frame, because the
   * engine samples the root between two frames on every odd cursor.
   */
  rootCursor: number;
  rootActionCursor: number;
  /** A one-shot at full weight: a swing, an arc stage, an entrance. */
  action: ActorClip | null;
  /** The death clip, once. */
  death: { motion: number; ticks: number } | null;
  /** Track 1, the overlay a hit reaction plays on -- see {@link OverlayTrack}. */
  react: OverlayTrack | null;
  /**
   * `obj+0x1319` -- the last zone a hit landed in, a signed byte:
   * `ActorReactToHit` (`FUN_004543F0`) writes 2 for a shot on bone 2 and 1 for
   * one on bone 1, before anything else, and nothing else. It indexes the
   * motion row's second half, `row[4 + zone]`, for the reaction
   * `ActorPlayHitReaction`'s `obj+0x136C` bit-0x100 arm and
   * `ZombieTickAltHitReaction` play.
   */
  lastHitZone: number;      // +0x1319, s8
  /**
   * `ZombieStateMotionCue21`'s parameters — the descriptor's `+0x04` clip and
   * its `+0x08` hold, in frames. Six spawns across the game carry it, all of
   * them class 0x30 with initial state 21, and it is read by that state alone.
   */
  intro: { motion: number; delay: number } | null;

  // -- damage bookkeeping ------------------------------------------------
  /** Charges landed per bone — the gore stage. `ResolveHit`'s counter. */
  hits: Record<string, number>;
  /** Bones whose "one hit only" effect has already fired. */
  latched: number[];
  /** Bones whose subtree has been severed. */
  removed: number[];
  /** Per-bone asset slot overrides — the draw record at +0x20C + bone*0x90. */
  boneSlot: Record<string, number>;
  /**
   * Per-bone **hit-sphere radius** — the same record's `+0x78`,
   * `obj + 0x284 + bone*0x90`, which `SkeletonWalkNode` (`FUN_004107E0`)
   * fills as the skeleton is built: the character type's table radius
   * **times the model's size**, `model+0x116C` (`0x00410837`), when the
   * table row's own slot is the node's, and zero when it is not
   * (`0x00410830`). The port's build, `ActorBuildSkinnedModel` in
   * `game/spawn.ts`, writes one for every bone, so a civilian's are 0.9 of
   * her table's.
   *
   * A routine that writes the record afterwards wins, as the engine's record
   * does: `ShotTestBoneSphere` (`FUN_004047D0`) skips a bone whose radius is
   * zero, and `BoneHitSpriteDrawAndTick` (`FUN_00407120`) and
   * `DrawBloodSpray` (`FUN_00407230`) add it to the view-space depth. The
   * writers after the build, every one unscaled:
   *
   * * `ActorSwapDamagedPart` (`FUN_004098E0`) zeroes it for slot 0 or 1, and
   *   otherwise `ResolveDamagedPartSphere` (`FUN_004099A0`) copies the
   *   damaged part's row over it when a table has one;
   * * `RemoveBoneSubtree` (`FUN_00409AF0`) zeroes it with the slot;
   * * the weapon hands: `SpawnThrownWeapon` (`FUN_004504E0`) and
   *   `ZombieThrowHandWeapon` (`FUN_0045A240`) zero the hand that let go,
   *   `ThrowerStateRearm` (`FUN_0044F7A0`) writes literals back and
   *   `ThrowerStateRestoreBothHands` (`FUN_0044F900`) table rows 4 and 7;
   * * `EnemyZombieInitByCharType` (`FUN_00452FD0`) zeroes the bones it gives
   *   a collision mesh ({@link Actor.boneColi});
   * * `FrogAwardKillAndEnterDeath` (`FUN_0043A2E0`) zeroes the frog's bone 2
   *   (`part+0x210`, `0x0043A35D`).
   *
   * A bone with no entry -- an actor that was never built -- reads the
   * table's radius unscaled.
   */
  boneRadius: Record<string, number>;
  /**
   * Per-bone **hit-sphere centre** — the record's `+0x7C..+0x84`, in the
   * bone's own space, which goes through the node's matrix into `+0x68` as
   * the bone is drawn (`SkeletonEmitNode`, `FUN_004114C0`). Written by the
   * same routines as {@link Actor.boneRadius} except the ones that only zero
   * a radius: the build (the row's centre, or zero where the row's slot is
   * not the node's), `ResolveDamagedPartSphere`, `ThrowerStateRearm` and
   * `ThrowerStateRestoreBothHands`. Never scaled: the node matrix carries
   * the model's size already.
   *
   * It was the bundle's `hit_centre` alone for as long as nothing could move
   * it, which made a gore-swapped bone keep the pristine part's centre. A
   * bone with no entry reads the table's.
   */
  boneCentre: Record<string, [number, number, number]>;
  /**
   * Bones whose own rigid draw is vetoed, one bit per bone.
   *
   * `SkeletonNodeDrawSuppressed` (`FUN_004122E0`) — see `game/parts.ts` for
   * why this is a field the port computes once a frame where the engine asks
   * a predicate per node.
   */
  suppressedBones: number;
  /**
   * What the class's node draw hook drew each bone at, by bone number: `null`
   * for `AssetDrawSlot` (`FUN_00418560`) or its light-array twin, a number for
   * `AssetDrawSlotWithAlpha` (`FUN_004185A0`) or `FUN_00418620` -- the forced
   * blend at that alpha, **1 and 0 included**, because the faded draw tests
   * nothing (`render/draw_order.ts`, `setMeshDrawAlpha`).
   *
   * [port-only] as a field. The engine draws and forgets; the renderer may
   * not call into the port, so the hooks the port runs --
   * `ZombieDrawBonePart` (`FUN_004534A0`, through `ZombieSubmitSlotByLighting`)
   * and `ThrowerDrawBonePart` (`FUN_00449F90`) -- write down which draw each
   * node got, and `render/characters/draw_gates.ts` makes it. A bone the hook
   * was not called for keeps last frame's entry, which nothing reads: the
   * gate that skipped the hook hides the bone.
   */
  nodeDrawAlpha: (number | null)[];
  /**
   * The attachment list — `model+0x1170`, ids into
   * `g_actor_attachment_records` (`0x004EC4C0`).
   *
   * `ActorBindPartList` (`FUN_00412440`) reads it once as the actor is built,
   * and `ActorDrawAttachedParts` (`FUN_004124F0`) walks the same array every
   * frame — so the engine keeps the list, not a resolved result, and so does
   * this. The ids at or above `ATTACHMENT_REPLACES_BELOW` are the ones the
   * renderer draws; the ones below it have already been folded into
   * {@link ActorHead.boneSlot} by the bind.
   */
  attachments: number[];
}

/**
 * An actor: the shared head, plus the arm its class owns.
 *
 * ## Why this is a union, and what it does and does not fix
 *
 * The struct's tail is reused. `obj+0x1330` is a hand-prop selector for class
 * 0x25, a slide countdown for 0x24 and an arc frame counter for 0x31 — one
 * word, three meanings, and that is the *engine's* design, not a porting
 * mistake. A flat interface asserts that all of those coexist on every actor,
 * which is false of every actor that has ever existed. Discriminating on `cls`
 * asserts what the engine asserts: this word means what this actor's class
 * says it means.
 *
 * **It does not remove every alias, and the honest claim is narrower than the
 * plan's.** Two kinds of aliasing look alike in a flat struct and only one is
 * cross-class:
 *
 * * *Between* classes — `obj+0x1330` as class 0x25's `bonePropMode` against
 *   class 0x24's `slideTimer`. A `cls` discriminant fixes this, and it is what
 *   the arms below are for.
 * * *Within* one class — `obj+0x1330` is also class 0x30's general-purpose
 *   per-state dword, with 98 accesses across 24 routines, read differently by
 *   each state. Putting all of those on the class-0x30 arm leaves them
 *   aliasing each other exactly as much as before. Fixing that would need a
 *   second discriminant, the *state*, and it is not obviously right either:
 *   the engine really does reuse one word across states, so a per-state union
 *   would model the port's safety rather than the engine's structure. It is
 *   not attempted, and the aliases are documented on the fields instead.
 *
 * A third group cannot go on any arm: `obj+0x1330`/`+0x1334`/`+0x1360`/
 * `+0x13C0`/`+0x13CC` are the **shared arc record** that `ActorArcBegin` and
 * `ActorArcStep` lay down, and class-0x30 and class-0x31 states both call
 * those routines directly. They stay in the head.
 *
 * ## The arms are not all the same shape
 *
 * Class 0x10's `civ` is a nullable pointer to a block the engine *allocates*
 * (`ActorAllocSub(0xC4)`), so its offsets are the block's and it is genuinely
 * absent until `CivilianInit` runs. Every other arm is a view onto words that
 * are always there — `ActorAllocSub` has 37 call sites and none of the other
 * class Inits is one of them [proved] — so those arms are **not** nullable.
 * Spelling them alike would invent an absent state the engine does not have
 * and force every reader into a check it never makes.
 */
export type Actor =
  | (ActorBase & { cls: SpawnClass.ScriptedHumanoid; hum: HumanoidTail })
  | (ActorBase & { cls: SpawnClass.SetPieceProp; prop: SetPiecePropTail })
  | (ActorBase & { cls: SpawnClass.Thrower; thr: ThrowerTail })
  | (ActorBase & { cls: SpawnClass.Zombie; zom: ZombieTail })
  // Class 0x18 **is** a class-0x30 zombie -- `CarriedZombieInit18`
  // (`FUN_0045CD60`) opens on `EnemyZombieInit` -- so it carries the same
  // tail and every class-0x30 routine takes one without a cast.
  | (ActorBase & { cls: SpawnClass.CarriedZombie; zom: ZombieTail })
  | (ActorBase & { cls: SpawnClass.OneHitTarget; tgt: OneHitTargetTail })
  | (ActorBase & { cls: SpawnClass.Boss2; boss2: Boss2Tail })
  | (ActorBase & { cls: SpawnClass.Judgment; judgment: JudgmentTail })
  | (ActorBase & { cls: SpawnClass.JudgmentCompanion;
                   companion: JudgmentCompanionTail })
  | (ActorBase & { cls: SpawnClass.RankScaledEnemy; rescue: RescueTargetTail })
  | (ActorBase & { cls: SpawnClass.Mouse; mouse: MouseTail })
  | (ActorBase & { cls: SpawnClass.SkinnedNpc; cat: CatTail })
  | (ActorBase & { cls: SpawnClass.WaterEnemy; fish: FishTail })
  | (ActorBase & { cls: SpawnClass.Frog; frog: FrogTail })
  | (ActorBase & { cls: SpawnClass.FlyingEnemy; owl: OwlTail })
  | (ActorBase & { cls: SpawnClass.ScriptedProp; prop13: ScriptedPropTail })
  | (ActorBase & { cls: SpawnClass.FlagStripProp; prop12: ScriptedProp12Tail })
  | (ActorBase & { cls: SpawnClass.Vehicle; vehicle: VehicleTail })
  | (ActorBase & { cls: SpawnClass.PathRidingProp;
                   pathProp: PathRidingPropTail })
  | (ActorBase & { cls: SpawnClass.Bat; bat: BatTail })
  | (ActorBase & { cls: SpawnClass.Boss3; boss3: Boss3Tail })
  | (ActorBase & { cls: SpawnClass.Boss5; boss5: Boss5Tail })
  | (ActorBase & { cls: SpawnClass.HordeSpawner; horde: HordeTail })
  | (ActorBase & { cls: SpawnClass.Worm; worm: WormTail })
  | (ActorBase & { cls: SpawnClass.ScriptedScenery;
                   scenery: ScriptedSceneryTail })
  | (ActorBase & { cls: SpawnClass.ResultCard; card: ResultCardTail })
  | (ActorBase & { cls: Exclude<SpawnClass,
      SpawnClass.ScriptedHumanoid | SpawnClass.SetPieceProp
      | SpawnClass.Thrower | SpawnClass.Zombie
      | SpawnClass.OneHitTarget | SpawnClass.RankScaledEnemy
      | SpawnClass.Boss2 | SpawnClass.Judgment | SpawnClass.JudgmentCompanion
      | SpawnClass.Mouse | SpawnClass.SkinnedNpc | SpawnClass.WaterEnemy
      | SpawnClass.Frog | SpawnClass.FlyingEnemy | SpawnClass.Bat
      | SpawnClass.Boss3 | SpawnClass.Boss5
      | SpawnClass.ScriptedProp | SpawnClass.FlagStripProp
      | SpawnClass.CarriedZombie
      | SpawnClass.ScriptedScenery | SpawnClass.Vehicle
      | SpawnClass.PathRidingProp | SpawnClass.HordeSpawner
      | SpawnClass.Worm | SpawnClass.ResultCard> });

/** An actor already narrowed to class 0x25, for that class's own routines. */
export type HumanoidActor = Extract<Actor,
  { cls: SpawnClass.ScriptedHumanoid }>;

/** An actor already narrowed to class 0x24. */
export type SetPiecePropActor = Extract<Actor,
  { cls: SpawnClass.SetPieceProp }>;

/** An actor already narrowed to class 0x31, for that class's own routines. */
export type ThrowerActor = Extract<Actor, { cls: SpawnClass.Thrower }>;

/** An actor already narrowed to class 0x30, for that class's own routines. */
export type ZombieActor = Extract<Actor, { cls: SpawnClass.Zombie }>;

/** An actor already narrowed to class 0x14, the stage-2 boss. */
export type Boss2Actor = Extract<Actor, { cls: SpawnClass.Boss2 }>;

/** An actor already narrowed to class 0x22, JUDGMENT's flier or its sub-actor. */
export type JudgmentActor = Extract<Actor, { cls: SpawnClass.Judgment }>;

/** An actor already narrowed to class 0x23, JUDGMENT's walker. */
export type JudgmentCompanionActor = Extract<Actor,
  { cls: SpawnClass.JudgmentCompanion }>;

/** An actor already narrowed to class 0x20, for that class's own routines. */
export type OneHitTargetActor = Extract<Actor,
  { cls: SpawnClass.OneHitTarget }>;

/** An actor already narrowed to class 0x43, for that class's own routines. */
export type OwlActor = Extract<Actor, { cls: SpawnClass.FlyingEnemy }>;

/** An actor already narrowed to class 0x46, for that class's own routines. */
export type BatActor = Extract<Actor, { cls: SpawnClass.Bat }>;

/** An actor already narrowed to class 0x45, the stage-3 boss. */
export type Boss3Actor = Extract<Actor, { cls: SpawnClass.Boss3 }>;

/** An actor already narrowed to class 0x32, the stage-5 boss or one of its projectiles. */
export type Boss5Actor = Extract<Actor, { cls: SpawnClass.Boss5 }>;

/** An actor already narrowed to class 0x11, for that class's own routines. */
export type FrogActor = Extract<Actor, { cls: SpawnClass.Frog }>;

/** An actor already narrowed to class 0x51, for that class's own routines. */
export type FishActor = Extract<Actor, { cls: SpawnClass.WaterEnemy }>;

/** An actor already narrowed to class 0x61: the result card or a figure. */
export type ResultCardActor = Extract<Actor, { cls: SpawnClass.ResultCard }>;

/** An actor already narrowed to class 0x33, for that class's own routines. */
export type ScriptedSceneryActor = Extract<Actor,
  { cls: SpawnClass.ScriptedScenery }>;

/** A fresh object. Everything the engine leaves zeroed is zero here. */
/** `ActorUpdateBoundingSphere`'s two lifts — `FUN_00454AC0`'s own literals. */
const SPHERE_RISE = 1;
const SPHERE_RISE_LOW = 0.5;
/** `obj+0x136C` bit 0x2000000: the sphere sits a half unit up, not one. */
const LOW_SPHERE = 0x2000000;

/**
 * `ActorUpdateBoundingSphere` — `FUN_00454AC0`.
 *
 * `obj+0x12C/0x130/0x134` is the sphere everything else tests: the actor's own
 * x and z, with y lifted by the **body** radius `obj+0x128` and then by one
 * unit — or a half when `obj+0x136C` bit `0x2000000` is set.
 *
 * Its caller is the class-0x30 push, `ZombiePushOutOfWorldAndActors`
 * (`FUN_00454900`). What another actor's push measures against is **not**
 * this function's answer but the centre the actor registered with
 * `RegisterForShotTest` last frame, which `ColiTestSphereAgainstActors`
 * (`FUN_00405B10`) reads out of `g_coli_dynamic_list`; it used to re-derive
 * every sphere through here instead, a frame early and in class 0x30's shape
 * whatever the class.
 */
export function ActorUpdateBoundingSphere(obj: Actor): void {
  obj.sphereCentre.x = obj.pos.x;
  obj.sphereCentre.z = obj.pos.z;
  obj.sphereCentre.y = obj.pos.y + obj.bodyRadius
    + ((obj.flags2 & LOW_SPHERE) ? SPHERE_RISE_LOW : SPHERE_RISE);
}

export function makeActor(at: number, cls: SpawnClass, charType: number,
                          name: string): Actor {
  // The head, without `cls`: which arm this actor gets is decided below, and
  // assigning `cls` here would widen it back to `SpawnClass` and defeat the
  // narrowing the union exists for.
  const head: Omit<ActorBase, "cls"> = {
    at, charType, name, flags38: 0, hitSlot: HIT_SLOT_NONE,
    // `ActorBuildSkinnedModel` writes both of these while building the model:
    // the scale from the character type alone, the flags unconditionally.
    scale: ActorModelScale(charType),
    motionFlags: MOTION_FLAGS_INIT,
    // Sized and filled by the build itself, which knows the character's
    // part count -- see `ActorBuildSkinnedModel` in `spawn.ts`.
    partVisible: [],
    flags: 0,
    pos: vec3(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    lookAt: vec3(),
    vel: vec3(),
    accY: 0,
    accX: 0,
    accZ: 0,
    emerge: null,
    delayedLeap: null,
    entry: null,
    hp: 0,
    maxHp: 0,
    attackPermit: -1,
    // `ActorClearGameFields` zeroes it, and only the Inits that call
    // `RegisterEnemySlot` or store `0xFF` themselves change that -- class
    // 0x30's does neither, so a zombie that dies before any fill has dealt
    // it a slot vacates slot 0. `[likely]`: no immediate store to `+0x120`
    // in `EnemyZombieInit` (byte search over every register encoding).
    cameraSlot: 0,
    condition: 0,
    state: 0,
    sub: 0,
    zones: 0,
    attack: -1,
    rank: -1,
    queueRank: 0xe,
    frozen: 0,
    slideTimer: 0,
    holdFrames: 0,
    ringSet: 0,
    weaponLoopHeld: 0,
    allowance: 0,
    cooldown: 0,
    target: vec3(),
    strikeStart: vec3(),
    leap: null,
    arcFrom: vec3(),
    arcFrames: 0,
    path: null,
    arcTotal: 0,
    arcTo: vec3(),
    arcPhase: 0,
    arcScript: null,
    flags2: 0,
    walkDistance: 0,
    worldPushDepth: 0,
    standThrow: undefined,
    oneHitTarget: null,
    class11: null,
    class13: null,
    class12: null,
    class18: null,
    class26: null,
    coliBlob: null,
    coliMatrix: null,
    carrierAt: -1,
    carrierWorld: vec3(),
    carrierYaw: 0,
    class43: null,
    class46: null,
    class45: null,
    class40: null,
    class42: null,
    class51: null,
    class52: null,
    class14: null,
    class16: null,
    class17: null,
    skel: null,
    class19: null,
    boneColi: {},
    boneMeshColi: null,
    class22: null,
    class23: null,
    class33: null,
    class33Push: null,
    class33Cue: null,
    class53: null,
    hitRadius: 0,
    entranceMotion: 0,
    pounce: null,
    grab: null,
    backAwayDelay: 0,
    cue: null,
    leapStrikeFrames: 0,
    pendingHit: null,
    shotBones: [0, 0],
    shotRays: [null, null],
    killedBy: -1,
    despawned: false,
    radius: 0,
    bodyRadius: 0,
    pushedBy: -1,
    pushDepth: 0,
    pushNormal: vec3(),
    sphereCentre: vec3(),
    shotCentre: vec3(),
    civ: null,
    boss4: null,
    targetAt: -1,
    script: null,
    alpha: 1,
    strikeFloor: 0,
    struck: false,
    descFlags: 0,
    initialState: 0,
    attackState: 0,
    cameraCue: null,
    dead: false,
    visible: false,
    motion: 0,
    playTicks: 0,
    cursorStore: null,
    fadeFrom: null,
    fade: 0,
    fadeLen: 0,
    rootCursor: -1,
    rootActionCursor: -1,
    action: null,
    death: null,
    react: null,
    lastHitZone: 0,
    intro: null,
    hits: {},
    latched: [],
    removed: [],
    boneSlot: {},
    boneRadius: {},
    boneCentre: {},
    suppressedBones: 0,
    nodeDrawAlpha: [],
    attachments: [],
  };
  // One `return` per arm. TypeScript narrows `cls` inside each branch, so the
  // arm's fields are required exactly where they belong and no cast is needed
  // — which is the point: a cast here would be the one place the union could
  // be lied to, and there is no cast here.
  if (cls === SpawnClass.ScriptedHumanoid) {
    return { ...head, cls, hum: makeHumanoidTail() };
  }
  if (cls === SpawnClass.SetPieceProp) {
    return { ...head, cls, prop: makeSetPiecePropTail() };
  }
  if (cls === SpawnClass.Thrower) {
    return { ...head, cls, thr: makeThrowerTail() };
  }
  if (cls === SpawnClass.Zombie || cls === SpawnClass.CarriedZombie) {
    return { ...head, cls, zom: makeZombieTail() };
  }
  if (cls === SpawnClass.OneHitTarget) {
    return { ...head, cls, tgt: makeOneHitTargetTail() };
  }
  if (cls === SpawnClass.RankScaledEnemy) {
    return { ...head, cls, rescue: makeRescueTargetTail() };
  }
  if (cls === SpawnClass.Boss2) {
    return { ...head, cls, boss2: makeBoss2Tail() };
  }
  if (cls === SpawnClass.Judgment) {
    return { ...head, cls, judgment: makeJudgmentTail() };
  }
  if (cls === SpawnClass.JudgmentCompanion) {
    return { ...head, cls, companion: makeJudgmentCompanionTail() };
  }
  if (cls === SpawnClass.Mouse) {
    return { ...head, cls, mouse: makeMouseTail() };
  }
  if (cls === SpawnClass.SkinnedNpc) {
    return { ...head, cls, cat: makeCatTail() };
  }
  if (cls === SpawnClass.WaterEnemy) {
    return { ...head, cls, fish: makeFishTail() };
  }
  if (cls === SpawnClass.Frog) {
    return { ...head, cls, frog: makeFrogTail() };
  }
  if (cls === SpawnClass.FlyingEnemy) {
    return { ...head, cls, owl: makeOwlTail() };
  }
  if (cls === SpawnClass.ScriptedProp) {
    return { ...head, cls, prop13: makeScriptedPropTail() };
  }
  if (cls === SpawnClass.FlagStripProp) {
    return { ...head, cls, prop12: makeScriptedProp12Tail() };
  }
  if (cls === SpawnClass.Vehicle) {
    return { ...head, cls, vehicle: makeVehicleTail() };
  }
  if (cls === SpawnClass.PathRidingProp) {
    return { ...head, cls, pathProp: makePathRidingPropTail() };
  }
  if (cls === SpawnClass.Bat) {
    return { ...head, cls, bat: makeBatTail() };
  }
  if (cls === SpawnClass.Boss3) {
    return { ...head, cls, boss3: makeBoss3Tail() };
  }
  if (cls === SpawnClass.Boss5) {
    return { ...head, cls, boss5: makeBoss5Tail() };
  }
  if (cls === SpawnClass.HordeSpawner) {
    return { ...head, cls, horde: makeHordeTail() };
  }
  if (cls === SpawnClass.Worm) {
    return { ...head, cls, worm: makeWormTail() };
  }
  if (cls === SpawnClass.ScriptedScenery) {
    return { ...head, cls, scenery: makeScriptedSceneryTail() };
  }
  if (cls === SpawnClass.ResultCard) {
    return { ...head, cls, card: makeResultCardTail() };
  }
  return { ...head, cls };
}

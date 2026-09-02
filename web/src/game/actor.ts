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
import type { CivilianState } from "./class10/state";
import type { SpawnClass } from "./spawn_class";
import { vec3, type Vec3 } from "./vec";

/** `obj+0x34` — the object's flag word. Only the bits the port reads. */
export enum ActorFlag {
  /**
   * Set by `ZombieStateBackOff` while the actor retreats and cleared when it
   * finishes. `RankEnemiesByDistance` drops these from the compacted queue.
   */
  BackingOff = 0x20000000,
  /**
   * `obj+0x34` bit 8. While it is set `ThrowerShotFeedback` forces the hit
   * result to 5, so a downed thrower only ricochets — a real invulnerability
   * window, counted down by `obj+0x133C`.
   */
  ShotImmune = 0x100,
  /** No more knockback arcs: two re-entries into one fall have been spent. */
  ArcSpent = 0x2000,
  /** Freezes the motion advance, which is how a pose holds mid-air. */
  PoseFrozen = 0x4000,
  /** A reaction is in progress. */
  Reacting = 0x40000000,
  /** `ResolveHit` sets it when the hit points reach zero. */
  Dead = 0x4000000,
  /**
   * Excluded from `RegisterForCameraTracking`. `ZombieStateApproach` sets it
   * while walking and clears it the moment the actor wins a permit, which is
   * how the camera comes to consider only enemies that have committed.
   */
  NoCameraTrack = 0x10000,
  /**
   * `obj+0x34` bit `0x10000000` — this actor is mid-attack and will not be
   * re-ranked out of it. `ZombieStateStandAndThrow` raises it for the length
   * of the throw clip and `ZombieStateTargetMotionScript` for an entry whose
   * mode is not negative.
   */
  Committed = 0x10000000,
  /**
   * `obj+0x34` bit `0x1000000` — set while a stationary thrower still has a
   * weapon, and cleared as it leaves. `ZombieStateStandAndThrow` is the only
   * reader and writer.
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
   * is one sphere of radius `obj+0x124`. No class-0x10 script ever sets it.
   */
  ShootPerBone = 0x80,
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
  /** `ThrowerFindWallBeside`'s own refusal bit. */
  NoWallLeap = 0x2,
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
  /** The blinking states hide the actor with this and `Actor.alpha`. */
  Blinking = 0x4,
  /** A reaction is already running; a second shot latches a re-entry. */
  ReactReentry = 0x400000,
  /** The reaction has been chosen for this death; only once. */
  DeathLatched = 0x200000,
  /** Knocked down — what routes states 1 and 2 into the get-up. */
  KnockedDown = 0x4000000,
  /** `ThrowerStrikeConnect` uses `g_class31_throws` instead of the melee row. */
  UseThrowTable = 0x400,
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
   */
  OffScreenPermit = 0x8000,
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
  /** Bit `0x20000000` — take part in the world push. Off while emerging. */
  CollideWorld = 0x20000000,
  /** Bit `0x40000000` — take part in the actor-versus-actor push. */
  CollideActors = 0x40000000,
  /** Bit `0x800000` — set for the frame a push actually moved this actor. */
  Shoved = 0x800000,
  /** Bit `0x400000` — which way `ZombieStateBackOff` turns; the shove flips it. */
  BackOffTurnFlip = 0x400000,
  /** Bit `0x2000000` — the bounding sphere sits a half unit up, not one. */
  LowSphere = 0x2000000,
  /**
   * Bit `0x100000` — the actor is being **carried**: riding
   * `g_carrier_object` in `ZombieStateRideCarrier`, or in flight in
   * `ZombieStateArcScriptedEntrance` and `ZombieStateScriptedGrabAndDespawn`.
   * The states raise it for exactly as long as something other than the actor
   * itself owns its position.
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
   * [open] Nothing in the ported call graph reads it back. Kept because the
   * state really does keep it, and because it is a different word from
   * `obj+0x34` bit 0x4000 ({@link ActorFlag.PoseFrozen}) which the same state
   * also toggles — two flags, one value, and mixing them up would freeze the
   * wrong thing.
   */
  Leaping = 0x4000,
  /** Bit `0x80000000` — raised as a delayed leap hands a dead actor to the
   *  death state. [open], like {@link ZombieFlag2.Leaping}. */
  DiedInFlight = 0x80000000,
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

/** A motion the actor is playing at full weight. `t` is seconds. */
export interface ActorClip { motion: number; t: number; loop: boolean }

export interface Actor {
  // -- identity ----------------------------------------------------------
  /** The spawn's script address. Stable, and the key the renderer binds on. */
  at: number;
  /** The spawn class — `g_class_handlers` is indexed by it. */
  cls: SpawnClass;
  /** The character type index; `game/tables.ts` resolves the data. */
  charType: number;
  /** Display name, for the feed. Copied from the type at spawn. */
  name: string;

  // -- the engine's own fields -------------------------------------------
  flags: number;            // +0x34
  pos: Vec3;                // +0x40
  /** Yaw in BAMS. The engine keeps a triple at +0x64/68/6C; only Y turns. */
  yaw: number;              // +0x68
  /**
   * What the camera aims at, and **not** the actor's origin.
   *
   * `SkeletonEmitNode` (`FUN_004114C0`) records one bone's world position here
   * as it walks the skeleton — bone 1, the torso, for an ordinary humanoid —
   * and `FUN_00409B70` then raises it by 4.0 before registering the actor for
   * camera tracking. `SelectCameraLookAtTarget` reads this and never reads
   * `pos`. Aiming at the origin instead put the camera on the feet.
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
  /** `-1` when it holds no permit, else the index into `g_attack_permits`. */
  attackPermit: number;     // +0x121
  /** `ActorBodyConditionFromHands` — indexes the attack and motion tables. */
  condition: number;        // +0x130C
  state: number;            // +0x1310
  sub: number;              // +0x1312
  /** Destroyed zones — a mask of {@link DamageZone}. */
  zones: number;            // +0x1318
  /** The attack index the strike drew. */
  attack: number;           // +0x131A
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
  /** `obj+0x1330` — the set-piece slide's countdown, in frames. */
  slideTimer: number;       // +0x1330
  /**
   * `obj+0x1320` — frames a wait has been stalled for. `SetPieceStateHoldThenPlay`
   * counts its hold in it, and class 0x25's VM its frame conditions.
   */
  holdFrames: number;       // +0x1320
  /** `obj+0x1394` — class 0x25's command cursor, as an index. -1 has left. */
  pc: number;               // +0x1394
  /** `obj+0x132C` / `+0x1328` / `+0x1354` / `+0x1350` — the turn. */
  turnMode: number;         // +0x132C
  turnFrames: number;       // +0x1328
  turnStep: number;         // +0x1354
  turnTarget: number;       // +0x1350
  /** `obj+0x1358` / `+0x135C` / `+0x1360` — riding an object path. */
  pathMode: number;         // +0x1358
  pathSlot: number;         // +0x135C
  pathOffset: number;       // +0x1360
  /**
   * `obj+0x1330` — class 0x25's `op 14`. **Not** a draw mode: the class's own
   * draw routine never reads it and poses unconditionally. `[open]` — its only
   * reader is the hit handler at `obj+0x12EC`, which is unread.
   */
  hitMode: number;          // +0x1330
  /**
   * `obj+0x13C0` — where the actor was last frame. The VM's "am I closing on
   * this point" condition compares against it, which is the only reason it is
   * kept.
   */
  prevPos: Vec3;            // +0x13C0
  /** Which of `g_enemy_approach_rings` this actor measures against. */
  ringSet: number;          // +0x131F
  /** Frames spent retreating; `ZombieStateBackOff` gives up past 0xF0. */
  backoffFrames: number;    // +0x1334
  /** How deep in the distance queue this actor may be and still attack. */
  allowance: number;        // +0x1358
  /** Frames before this actor may claim again. `ZombieStateHoldAtRange`
   *  forces it to zero unless `obj+0x1368` bit 0 is set. */
  cooldown: number;         // +0x133C
  /**
   * `obj+0x1368` bit 0 for class 0x30 — **the actor is allowed a cooldown**.
   *
   * `ZombieStateWaitForCameraFrame` (state 19) is the only thing in the class
   * that sets it, so for every other zombie `ZombieStateHoldAtRange` forces
   * {@link Actor.cooldown} to zero and there is no wait between swings beyond
   * the strike clip and the retreat.
   *
   * A separate field and not a bit of `reactBone`, which is the same offset:
   * class 0x31 reads `obj+0x1368` as the bone that was hit, and this is the
   * polymorphism trap that field carries.
   */
  hasCooldown: boolean;     // +0x1368 bit 0, class 0x30
  /**
   * The player point the strike measures its lunge against, written by
   * `ActorFacePlayerTarget`. With one attacker it is the camera eye; with two
   * it is a shoulder offset from it, which is why it is stored rather than
   * recomputed.
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
   */
  path: { delay: number; points: PathPoint[] } | null;
  /** Which leg of it — the engine keeps a cursor at `obj+0x1394`. */
  pathLeg: number;
  /** `obj+0x1330` in sub 1: the delay before the first leg. */
  pathDelay: number;
  /** `obj+0x1334` — how many it lasts. */
  arcTotal: number;
  /** `obj+0x13CC` — where the arc ends. */
  arcTo: Vec3;
  /**
   * `obj+0x1360` — which of `ActorArcStep`'s five phases the arc is in. The
   * same word the path rider keeps its offset in; only one class uses it at a
   * time, which is why they are two names for one offset here.
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
  /** `obj+0x1364` — the stance row the current attack was drawn against. */
  stance: number;
  /**
   * `obj+0x135C` — the distance band `ThrowerPickNextState` last committed to.
   * The same word as `pathSlot`; see `arcPhase`.
   */
  moveBand: number;
  /** `obj+0x1338` — frames since a leap landed. */
  sinceLanding: number;
  /**
   * `ThrowerStateWalkDistance`'s target, from the descriptor — and
   * `ZombieStateWalkDistance`'s, which reads the same float at tail `+0x04`.
   */
  walkDistance: number;
  /**
   * `obj+0x1374` — how far `ZombieStateWalkDistance` has come from
   * `arcFrom`. The engine writes it every frame and never reads it back.
   */
  walkTravelled: number;    // +0x1374
  /**
   * `obj+0x131A` — which entry of `g_class30_attacks[type][condition]` the
   * next attack uses. `ZombiePickThrowingHand` writes 0 for bone 5 and 1 for
   * bone 8; the melee states index the same table with the pick list.
   */
  attackIndex: number;      // +0x131A
  /** `obj+0x1330` — `ZombieStateStandAndThrow`'s idle countdown. */
  throwDelay: number;       // +0x1330
  /** The bone the current throw leaves from, 5 or 8. */
  throwHand: number;
  /** `ZombieStateStandAndThrow`'s descriptor tail, from the bundle. */
  standThrow: CharacterPlacement["stand_throw"];
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
  pendingHit: { bone: number; result: number } | null;   // +0x190, +0x34 bit 3
  /**
   * `obj+0x131C` — which player's shot killed this actor.
   *
   * `CivilianPruneDeadChildren` reads it off a dead captor to decide who is
   * paid for the rescue. `[open]` here: the port's shot path carries no player
   * at all, so nothing writes it and it stays `-1` — which is the engine's own
   * "could not name one", and pays both players.
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
   * `pushedBy` is the actor that did it, by spawn address, or `-1`.
   */
  pushedBy: number;         // +0x138
  pushDepth: number;        // +0x13C
  pushNormal: Vec3;         // +0x140
  /**
   * `obj+0x12C` — the point `CivilianUpdate`'s camera-point switch writes,
   * selected by `sub+0x80` (op 0x17). Mode 0 is the actor's own position;
   * modes 1-3 read matrices out of the model block and are `[open]`.
   *
   * It is **not** the shot sphere: that is `obj+0x100`, which the draw writes
   * and `ActorRegisterCameraPoint` lifts.
   */
  camPoint: Vec3;           // +0x12C
  /**
   * Class 0x10's `ActorAllocSub(0xC4)` block at `obj+0x1310`.
   *
   * `obj+0x1310` is `state` for a combat class; for a civilian it is a
   * pointer to its own script state, which is the polymorphic-field trap in
   * its clearest form. See `class10/state.ts`.
   */
  civ: CivilianState | null;                             // +0x1310
  /** `obj+0x1368` — the bone that was hit. Class 0x31 alone reads it that way. */
  reactBone: number;        // +0x1368
  /** `obj+0x1328` — re-entries into the knockdown; two caps the arc. */
  knockCount: number;       // +0x1328
  /** `obj+0x1350` — the surface under the landing point. `0x5A` kills. */
  landSurface: number;      // +0x1350
  /**
   * `obj+0x1394` — **the object this actor was built for**, by spawn address.
   *
   * Polymorphic, like everything at this end of the struct:
   * `ThrowerStatePathFollow` keeps a waypoint cursor here, and
   * `ScriptedHumanoidInit` a command pointer. For a class-0x30 zombie it is a
   * *parent actor*, written by `CivilianInit` for the 47 captors it builds —
   * and the whole `ZombieStateWalkToTarget` family walks at it instead of at
   * the camera. `-1` for an actor that has none.
   */
  targetAt: number;         // +0x1394
  /**
   * The two captor scripts off the descriptor tail, decoded — `+0x04` for the
   * initial state and `+0x08` for the attack state. `ZombieScriptForState`
   * (`FUN_0045CA10`) picks between them by which state the actor is in.
   */
  script: { target: TargetScriptJson | null;
            attack: TargetScriptJson | null } | null;
  /**
   * `obj+0x1398` — the cursor into the captor script's entry list.
   *
   * The engine keeps a pointer; an index is the same edge without the address,
   * and it survives a snapshot. Shared by every state in the family, which is
   * how `ZombieStateWalkToTarget` can hand `ZombieStateTargetMotionScript` a
   * half-walked list.
   *
   * **A pointer says which list as well as how far in**, and that half is
   * {@link scriptBlob}. Without it the cursor was re-aimed from `obj.state`
   * on every read, so a captor that arrived and entered state 35 went back to
   * the blob it had already finished instead of the one the walk left it in.
   */
  scriptPc: number;         // +0x1398
  /**
   * Which of the descriptor tail's two script blobs {@link scriptPc} indexes:
   * 0 is `+0x04`, 1 is `+0x08`. The other half of `obj+0x1398`.
   *
   * `ZombieScriptForState` (`FUN_0045CA10`) is called only where the engine
   * writes that pointer — `ZombieScriptEnded`, and each scripted state's
   * entry sub — and never on the steps in between, which read the pointer
   * back. Deriving it from the state instead is a test moved across a
   * function boundary, and it moved the answer with it.
   */
  scriptBlob: number;       // +0x1398, which blob the pointer is in
  /** `obj+0x1320` — the clip the captor script wants; the tail re-blends to it. */
  scriptMotion: number;     // +0x1320, aliases `holdFrames`
  /** `obj+0x1350` — the captor script's remaining loop count. Aliases `landSurface`. */
  targetLoops: number;      // +0x1350
  /**
   * `obj+0x1354` — the script entry's cue frame or mode, and, once
   * `ZombieStateTargetLostPause` is entered, the state to come back to.
   * Aliases `arcKind`; the two never overlap in time.
   */
  targetCue: number;        // +0x1354
  /** `obj+0x1358` — the sub to come back to. Aliases `allowance`/`pathMode`. */
  resumeSub: number;        // +0x1358
  /** `obj+0x1370` — how close `ZombieStateWalkToTarget` has to get. */
  targetArrive: number;     // +0x1370
  /** `obj+0x1388` — the height a fall began at, and a flag while it is set. */
  fallFromY: number;        // +0x1388
  /** `obj+0x1354` — the axis gravity pulls along. See `ThrowerArcKind`. */
  arcKind: number;          // +0x1354
  /** `obj+0x138C` — the draw alpha the blinking states write. */
  alpha: number;            // +0x138C
  /**
   * `obj+0x1338` — frames since this actor was last shoved out of another.
   *
   * `ZombiePushOutOfWorldAndActors` (`FUN_00454900`) counts it down and, 60
   * frames after a push, flips `obj+0x136C` bit 0x400000 — the direction
   * `ZombieStateBackOff` retreats in. **Not** the attack cooldown, which is
   * the next field along.
   */
  shoveTimer: number;       // +0x1338
  /** `obj+0x133C` is the cooldown; this is the frame the corpse is pinned to. */
  corpseFrame: number;      // +0x194, pinned
  /** `ThrowerStateBlinkInThreeHops`' two counters. */
  hopsLeft: number;         // +0x1348
  hopFrames: number;        // +0x1344

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

  /** `obj+0x136C & 0x40000` — `strikeStart` has been captured. */
  hasStrikeAnchor: boolean;
  /**
   * This swing has already landed its hit.
   *
   * [diverges] The engine tests `obj+0x19C == hit_frame` for exact equality
   * against a counter that advances one per update, so it can only fire once.
   * The port advances clips in seconds, so it latches instead.
   */
  struck: boolean;

  // -- descriptor --------------------------------------------------------
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
   * `obj+0x132C` — the state `ZombieStateHoldForCameraCue` runs on this
   * actor's behalf while it waits for its camera cue.
   */
  delegate: number;
  /**
   * The descriptor tail's `+0x0C`/`+0x0E`, or null when `+0x0C` is -1.
   * The camera path and frame a captor's exit waits for.
   */
  cameraCue: { path: number; frame: number } | null;

  // -- runtime the renderer reads ----------------------------------------
  dead: boolean;
  /** The script has this spawn live and the renderer is showing it. */
  visible: boolean;
  /** The looping base motion. */
  motion: number;
  /** Seconds into that loop. */
  clock: number;
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
   */
  fadeFrom: { motion: number; t: number } | null;
  /** Frames of the cross-fade left. */
  fade: number;
  /** How many it started with, so the weight is a ratio. */
  fadeLen: number;
  /**
   * The frame index the root-motion delta was last taken at, for the base
   * motion and for `action`. Root translation is a difference between frames,
   * so the previous one is state.
   */
  rootFrame: number;
  rootActionFrame: number;
  /** A one-shot or lunge at full weight: the lunge loops, the strike does not. */
  action: ActorClip | null;
  /** The death clip, once. */
  death: { motion: number; t: number } | null;
  /** A stumble, blended over `blend` frames. */
  react: { motion: number; t: number; blend: number; hard: boolean } | null;
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
}

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
 * It lives here rather than beside its caller because both the class-0x30 push
 * and `ColiTestSphereAgainstActors` need it, and the second must be able to
 * ask it about an actor that has not ticked yet. The engine solves that with a
 * per-frame registration list; deriving the sphere from the position is the
 * same answer without the ordering hazard.
 */
export function ActorUpdateBoundingSphere(obj: Actor): void {
  obj.camPoint.x = obj.pos.x;
  obj.camPoint.z = obj.pos.z;
  obj.camPoint.y = obj.pos.y + obj.bodyRadius
    + ((obj.flags2 & LOW_SPHERE) ? SPHERE_RISE_LOW : SPHERE_RISE);
}

export function makeActor(at: number, cls: SpawnClass, charType: number,
                          name: string): Actor {
  return {
    at, cls, charType, name,
    flags: 0,
    pos: vec3(),
    yaw: 0,
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
    condition: 0,
    state: 0,
    sub: 0,
    zones: 0,
    attack: -1,
    hasCooldown: false,
    rank: -1,
    queueRank: 0xe,
    frozen: 0,
    slideTimer: 0,
    holdFrames: 0,
    pc: 0,
    turnMode: 0,
    turnFrames: 0,
    turnStep: 0,
    turnTarget: 0,
    pathMode: 0,
    pathSlot: -1,
    pathOffset: 0,
    hitMode: 0,
    prevPos: vec3(),
    ringSet: 0,
    backoffFrames: 0,
    allowance: 0,
    cooldown: 0,
    target: vec3(),
    strikeStart: vec3(),
    leap: null,
    arcFrom: vec3(),
    arcFrames: 0,
    path: null,
    pathLeg: 0,
    pathDelay: 0,
    arcTotal: 0,
    arcTo: vec3(),
    arcPhase: 0,
    arcScript: null,
    flags2: 0,
    stance: 0,
    moveBand: 0,
    sinceLanding: 0,
    walkDistance: 0,
    walkTravelled: 0,
    worldPushDepth: 0,
    attackIndex: 0,
    throwDelay: 0,
    throwHand: 0,
    standThrow: undefined,
    entranceMotion: 0,
    pounce: null,
    grab: null,
    backAwayDelay: 0,
    cue: null,
    leapStrikeFrames: 0,
    pendingHit: null,
    killedBy: -1,
    despawned: false,
    radius: 0,
    bodyRadius: 0,
    pushedBy: -1,
    pushDepth: 0,
    pushNormal: vec3(),
    camPoint: vec3(),
    civ: null,
    reactBone: 0,
    knockCount: 0,
    landSurface: 0,
    targetAt: -1,
    script: null,
    scriptPc: 0,
    scriptBlob: 0,
    scriptMotion: 0,
    targetLoops: 0,
    targetCue: 0,
    resumeSub: 0,
    targetArrive: 0,
    fallFromY: 0,
    arcKind: 0,
    alpha: 1,
    shoveTimer: 0,
    corpseFrame: -1,
    hopsLeft: 0,
    hopFrames: 0,
    strikeFloor: 0,
    hasStrikeAnchor: false,
    struck: false,
    initialState: 0,
    attackState: 0,
    delegate: 0,
    cameraCue: null,
    dead: false,
    visible: false,
    motion: 0,
    clock: 0,
    fadeFrom: null,
    fade: 0,
    fadeLen: 0,
    rootFrame: -1,
    rootActionFrame: -1,
    action: null,
    death: null,
    react: null,
    intro: null,
    hits: {},
    latched: [],
    removed: [],
    boneSlot: {},
  };
}

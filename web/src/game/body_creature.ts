/**
 * The thing a `znjoe` lets out of its chest when you shoot it there.
 *
 * `ActorReactToHit` (`FUN_004543F0`) is the one place in the whole image that
 * tests a character type against `0x0A`, and what it does there is not a
 * stagger: it drops the actor into class 0x30 state **25**,
 * {@link ZombieState.ReleaseBodyCreature}, which walks the zombie back out to
 * its inner approach ring, plays a clip for a hundred-odd frames, opens the
 * torso, and calls `SpawnBodyCreature` (`FUN_0043E720`). What comes out is an
 * independent object with its own per-frame routine — and a **countable
 * enemy**: `BodyCreatureInit` raises `g_enemies_present` *and*
 * `g_enemies_alive`, so every one of them a room gate has to account for.
 *
 * ## What it is, and what it is not called
 *
 * `[open]` The species. It draws forty frames of `znjoe.bin` — entries
 * 176..215, the host character's own model bank — and the two sounds it plays
 * are `COMMON\MEET01_22.WAV` and `COMMON\MEET02_22.WAV`, which name nothing.
 * The sound table does hold a `WORM_TUBU`, which is the corroboration
 * `docs/BUGS.md` recorded for calling it a worm, and **nothing in this chain
 * plays it**. So it keeps the engine-shaped name it was read under: a creature
 * that comes out of a body. `L20`.
 *
 * ## Its position is in camera space, and that is the whole shape of it
 *
 * `obj+0x40..0x48` is a world position for every other object in this port.
 * For this one it is not, and the routine is unreadable until you know that:
 *
 * * the flight's **end** is the origin of that space — `tail+0x38/0x3C` stay
 *   zero in a one-player game, and in a two-player game they are
 *   `sin/cos(3π/2)` or `sin/cos(π/2)` times **0.6**, which is `x = -0.6` for
 *   player 0 and `+0.6` for player 1: one gun each;
 * * `tail+0x64 = sqrt(x₀² + z₀²)` is then the launch **range** to the eye,
 *   which is what the tumble normalises against;
 * * it draws under `MatrixLoadIdentity` — the same idiom the muzzle flash and
 *   the blood use, and `render/effects.ts` already draws both of those in its
 *   view group;
 * * and `obj+0x70..0x78`, the sphere `ShotTestSphere` (`FUN_00404630`) tests,
 *   is assigned straight from `obj+0x40..0x48` with no transform at all,
 *   where every other class needs one.
 *
 * `BodyCreatureUpdate`'s state 0 is what puts it there: it takes the host's
 * bone matrix into world with `MatrixInvert(0) · host+0x2C4`, lifts it by
 * 1.5, and transforms *that* back through the live matrix. The port's two
 * host calls — `boneWorld` then `viewSpaceOfPoint` — are the same two steps.
 *
 * ## Why plain records in `G` rather than an actor
 *
 * The engine allocates a task; `game/` holds a fixed object pool and every
 * slice of a snapshot has to survive `clonePlain`. So this is an array of
 * plain records, spawned and retired by index, which is the shape
 * `g_severed_heads`, `g_thrown_weapons` and the breakable-prop pool all have
 * and for the same reason. The creature also has **no class id** — the engine
 * reaches `BodyCreatureUpdate` only through the allocation — so there is no
 * `SpawnClass` for it to key a handler on.
 *
 * `[open]` One consequence, and it is not a spelling difference:
 * `BodyCreatureUpdate` ends by calling `RegisterForCameraTracking`
 * (`FUN_00408EC0`), so a live creature is a **camera candidate** in the
 * engine. The port's candidate list (`camera/slots.ts`) is over `Actor`s, so
 * a record here cannot enter it, and `g_camera_free` therefore does not see
 * the creature. Making it see one means either the slot array taking non-actor
 * objects or the creature becoming an `Actor` with an invented class id;
 * both are decisions above this file. The point the engine registers is
 * `obj+0x100`, and **what space that point is in is itself `[open]`**: the
 * routine writes `g_camera_blocks[cur]+0x00 · obj+0x40` with `obj+0x40` in
 * camera space, and that matrix is the world-to-camera one everywhere else in
 * the image (`GameHost.viewSpaceOfPoint`, `RegisterForShotTest`'s bit-0x10
 * arm). So the port writes no point rather than guessing at one.
 */
import type { Events } from "../core/events";
import type { Rng } from "../core/rng";
import { G } from "./globals";
import type { GameHost } from "./host";
import { ScoreAddForPlayer } from "./combat/score";
import { PlayerTakeDamage } from "./combat/player";
import { SpawnBloodSprayAtPoint } from "./effects/blood";
import { vec3, type Vec3 } from "./vec";
import { ActorFlag, type Actor } from "./actor";

/**
 * `obj+0x1310` — the creature's own state word, which is a different set from
 * class 0x30's and switched on by its own routine's jump table at
 * `0x0043EF14`. Cases 0, 3, 4 and 6 exist; 1, 2 and 5 fall to the default,
 * which is the draw alone.
 */
export enum BodyCreatureState {
  /**
   * Riding the host's bone. `BodyCreatureUpdate`'s `case 0` at `0x0043E8B7`
   * reads `host+0x2C4` every frame, and its tail launches the flight.
   */
  RideHostBone = 0,
  /** The flight. `0x0043EB6D`. */
  Fly = 3,
  /** It reached the player and was not shot: falling, tumbling one way. */
  FallAfterHit = 4,
  /** It was shot: falling, tumbling the other. */
  FallShot = 6,
}

/** `MOV word ptr [ESI + 0x11c], CX` with `CX = 1`. One shot kills it. */
export const BODY_CREATURE_HP = 1;
/** `obj+0x124 = 0x3F4CCCCD` — the sphere `ShotTestSphere` tests. */
export const BODY_CREATURE_RADIUS = 0.8;
/** `obj+0x134C = 0x3E99999A`. Written at init and read by nothing here. */
export const BODY_CREATURE_SCALE = 0.3;
/**
 * `FADD float ptr [0x004C4CB8]` at `0x0043E905` — the lift the launch point
 * gets in camera space before the flight starts, so it leaves the chest
 * rather than the navel.
 */
export const LAUNCH_RISE = 1.5;
/** `obj+0x1348 = 0x3DA3D70A` at `0x0043E949`. */
export const EASE_START = 0.08;
/** `FMUL float ptr [0x00564408]` — the ease decays this much a frame... */
export const EASE_DECAY = 0.925;
/** ...down to this floor, `0x3BA3D70A`. */
export const EASE_FLOOR = 0.005;
/**
 * `FCOMP float ptr [0x00564404]` — past this the creature has arrived.
 *
 * It is also exactly where the arc's sine comes back to zero: the y hump is
 * `sin(t · ARC_BAMS · 2π/65536)` with `ARC_BAMS = 65536 · 5/9`, so the
 * argument passes through **π** at `t = 0.9` and the creature is level with
 * the eye on the frame it latches. A one-unit half-sine, peaking at `t` 0.45.
 */
export const ARRIVE_T = 0.9;
/** `FMUL float ptr [0x0056440C]` — `0x470E38E4`, which is `65536 * 5 / 9`. */
export const ARC_BAMS = 36408.88671875;
/** `CMP EAX, 0x1E` — frames between arriving and the player losing a life. */
export const HIT_DELAY_FRAMES = 0x1e;
/** `PlayerTakeDamage(player, 1, 9)` at `0x0043EDE5`. */
export const HIT_MOTION = 9;
/** `FMUL float ptr [0x004E1FE0]` — the tumble's angle scale, in BAMS. */
export const SPIN_SWEEP_BAMS = 32768;
/** `FMUL float ptr [0x0055D22C]` — and its amplitude: 4096 BAMS is 22.5°. */
export const SPIN_AMPLITUDE = 4096;
/** `FSUB float ptr [0x00564400]` — what the fall adds to the y speed. */
export const FALL_ACCEL = 0.010888;
/** `FCOMP float ptr [0x005643FC]` — below this it leaves. */
export const DESPAWN_Y = -3.0;
/** `MOV dword ptr [EDI + 0x24], 0x100` on the shot path... */
export const FALL_SPIN_SHOT = 0x100;
/** ...and `0xFFFFFE00` on the other. */
export const FALL_SPIN_MISSED = -0x200;
/** `FMUL float ptr [0x005643B8]` — the fall's spin grows 1% a frame. */
export const FALL_SPIN_GROWTH = 1.01;
/** ...and is clamped to `±0x4000`, a quarter turn. */
export const FALL_SPIN_CLAMP = 0x4000;
/** `AssetDrawSlot(obj+0x1330 % 0x28 + 0x1D31)` — `znjoe.bin` 176..215. */
export const BODY_CREATURE_FIRST_SLOT = 0x1d31;
export const BODY_CREATURE_SLOTS = 0x28;
/** `PlaySoundId(0x3A16A9)` at `0x0043E926` — `COMMON\MEET01_22.WAV`. */
export const SOUND_RELEASE = 0x3a16a9;
/** `PlaySoundId(0x3B16A9)` at `0x0043EB8A` — `COMMON\MEET02_22.WAV`. */
export const SOUND_SHOT = 0x3b16a9;
/** `ScoreAddForPlayer(player, 0x50)` — what shooting one is worth. */
export const BODY_CREATURE_SCORE = 0x50;
/**
 * `CMP dword ptr [0x009C6F08], 0x2` — the scene-state major the damage arm
 * needs, the same one `IsPlayerAttackable` (`FUN_00409DC0`) wants.
 */
export const DAMAGE_SCENE_MAJOR = 2;
/** `CMP word ptr [EDX + 0x9A5C62], 0x5` — in play and alive. */
export const PLAYER_STATE_IN_PLAY = 5;

/**
 * The `0x504` block `BodyCreatureInit` hangs at `obj+0x1390`, as **this**
 * object lays it out.
 *
 * `[proved]` It is not a shared struct. Three routines in the image allocate
 * `0x504` — `HordeMemberInit` (`FUN_0043BEF0`), `FUN_0043D6E0` and this one —
 * and their layouts disagree: the horde member's `+0x1C` is the actor's own
 * `y` and its `+0x60` a speed, where these are the flight's start `y` and
 * (at `+0x64`) its range. The only field all three agree on is `+0x00..0x08`,
 * a position. So it is one size reused, and `L3` says to name the fields for
 * what the class that owns them uses them as.
 */
export interface BodyCreatureFlight {
  /**
   * `tail+0x18/0x1C/0x20` — where the flight started, in camera space, and
   * `start.y` is also the height it descends **from**: the y term is
   * `start.y · (1 - t)` plus the arc, so the flight always ends level with
   * the eye whatever height the chest was at.
   */
  start: Vec3;
  /**
   * `tail+0x38` and `tail+0x3C` — the end's `x` and `z`. There is no end `y`
   * because the target height is zero, which in camera space is the eye.
   */
  endX: number;
  endZ: number;
  /** `tail+0x24` — BAMS added to the pitch each falling frame. */
  fallSpin: number;
  /** `tail+0x64` — `sqrt(start.x² + start.z²)`, the range at launch. */
  range: number;
  /**
   * `tail+0x00/0x04/0x08` — the position, rewritten on the last line of every
   * frame in every state.
   *
   * `[open]` **Nothing in the image reads it back.** It is here because the
   * engine writes it and because the write is the one field the other two
   * users of the `0x504` block agree with; dropping it would make the port's
   * record disagree with the block for no reason.
   */
  published: Vec3;
}

/** One live creature. Plain data: it goes in the snapshot as it is. */
export interface BodyCreature {
  /**
   * `[port-only]` — a stable key for the renderer, like
   * {@link SeveredHead.id}. The engine's identity is the task pointer.
   */
  id: number;
  /**
   * The host, by the port's actor identity.
   *
   * `[port-only]` spelling of `obj+0x1350`: the engine stores the host's
   * `g_hit_slots` index there and finds the host again through
   * `g_body_creature_hosts` (`0x007DCBD8`), a fourteen-entry table with three
   * xrefs in the whole image, all three in this mechanism. The port has no
   * hit-slot system — see `Actor.flags38` — so it carries the host's `at`,
   * which is the same link by a different handle.
   */
  host: number;
  /** `obj+0x1310`. */
  state: BodyCreatureState;
  /** `obj+0x40..0x48`, **in camera space**. See the note at the top. */
  pos: Vec3;
  /** `obj+0x11C` — one hit point. */
  hp: number;
  /** `obj+0x124` — the shot sphere's radius. */
  radius: number;
  /** `obj+0x64` — the X rotation, in BAMS. The only one it draws with. */
  pitch: number;
  /** `obj+0x50` — the falling y speed. */
  fallSpeed: number;
  /** `obj+0x1344` — the flight parameter, 0 to 1. */
  t: number;
  /** `obj+0x1348` — how much `t` advances this frame. */
  ease: number;
  /** `obj+0x1330` — the frame counter, which is also the sprite cursor. */
  frame: number;
  /**
   * The asset slot to draw this frame — `obj+0x1330 % 0x28 + 0x1D31`.
   *
   * `[port-only]` as a **field**, not as a rule: the engine computes it inside
   * `AssetDrawSlot`'s own argument, in the draw. `verify_layers.py`'s
   * `render-drives-the-port` is why it is state here — the renderer may not
   * call an engine function to decide what to draw — and it is the same shape
   * {@link SeveredHead.slot} and `Actor.suppressedBones` have.
   */
  slot: number;
  /**
   * `obj+0x1334` — zero until the flight arrives, then a count of frames
   * since, and {@link HIT_DELAY_FRAMES} of them is what the player pays for.
   */
  arrived: number;
  /** `obj+0x121` — which player it is flying at, and who it charges. */
  target: number;
  /**
   * `obj+0x34`, and this object reads exactly three of its bits — the same
   * three `MarkActorShot` (`FUN_00404DB0`) writes on an actor.
   *
   * Bit 3 ({@link ActorFlag.Hit}) is *there is an undrained shot*; bits 1 and
   * 2 say **which player fired**, and the update reads them back to decide
   * who is paid. Carried as the word rather than as a boolean because the
   * payer selection is not derivable from a boolean: with bit 1 clear the
   * engine pays **player 1**, not player 0.
   */
  flags: number;
  /** The `0x504` tail. */
  flight: BodyCreatureFlight;
}

/**
 * `[port-only]` — the sprite slot a creature draws this frame, which the
 * engine works out inside `AssetDrawSlot`'s own argument:
 * `AssetDrawSlot(obj+0x1330 % 0x28 + 0x1D31)`.
 *
 * `CDQ / IDIV 0x28` is a signed remainder, and `obj+0x1330` never goes
 * negative: the shot arm resets it to zero and both falling states leave it
 * alone, so a creature on the floor holds the cel it was shot on.
 */
export function BodyCreatureDrawSlot(c: BodyCreature): number {
  return (c.frame % BODY_CREATURE_SLOTS) + BODY_CREATURE_FIRST_SLOT;
}

/**
 * `SpawnBodyCreature` — `FUN_0043E720`, and `BodyCreatureInit`
 * (`FUN_0043E790`) with it.
 *
 * The engine's two halves run a frame apart — `SpawnBodyCreature` allocates
 * the task and `FUN_00408E80` enrols it, and the task list calls
 * `BodyCreatureInit` when it next walks — and neither half does anything the
 * other can observe in between, so they are one call here.
 *
 * **Both enemy counters go up.** `0043E7F4 INC word ptr [0x009C7006]` and
 * `0043E7FB INC word ptr [0x009C904A]`, unconditionally and with none of the
 * `obj+0x38` latching class 0x30 does — the object is made once and it leaves
 * once, so there is nothing to latch against.
 */
export function SpawnBodyCreature(host: Actor): BodyCreature {
  const c: BodyCreature = {
    id: G.g_body_creature_seq++,
    host: host.at,
    state: BodyCreatureState.RideHostBone,
    pos: vec3(),
    hp: BODY_CREATURE_HP,
    radius: BODY_CREATURE_RADIUS,
    pitch: 0,
    fallSpeed: 0,
    t: 0,
    ease: 0,
    frame: 0,
    slot: BODY_CREATURE_FIRST_SLOT,
    arrived: 0,
    // `SpawnBodyCreature` writes `obj+0x120 = 0xFF` and `FUN_00408E80`
    // overwrites it with the enemy slot; `obj+0x121`, the player, is left at
    // whatever `FUN_004A73D0`'s zero fill left, which is player 0 until the
    // launch picks one.
    target: 0,
    // `BodyCreatureInit` writes `obj+0x34 = 1` over the allocator's zero fill.
    flags: 1,
    flight: {
      // `FUN_004A74E0` is a zeroing alloc, so the whole tail starts at zero.
      start: vec3(), endX: 0, endZ: 0, fallSpin: 0, range: 0,
      published: vec3(),
    },
  };
  G.g_body_creatures.push(c);
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
  return c;
}

/** `BodyCreatureUpdate`'s `case 0` — riding the host's bone. */
function BodyCreatureRideHostBone(c: BodyCreature, host: Actor | undefined,
                                  rng: Rng, host3d: GameHost,
                                  events?: Events): void {
  if (!host) return;
  // ```
  // MatrixStackPush(0); MatrixInvert(0); MatrixMultiply(host+0x2C4)
  // MatrixGetTranslation -> obj+0x40..0x48;  MatrixStackPop(1)
  // ```
  // The bone matrix is built in the live space, so inverting the top first is
  // what takes the bone back into the world. `GameHost.boneWorld` answers the
  // same question, because the skeleton is three.js's.
  if (!host3d.boneWorld(host.at, BODY_CREATURE_BONE, _world)) return;
  // `FLD [ESI+0x44] / FADD [0x004C4CB8] / FSTP [ESI+0x44]` — and it is added
  // to the **world** y, before the transform below.
  _world.y += LAUNCH_RISE;
  // `MatrixTransformPoint(obj+0x40, out)` under the live matrix at
  // `0x0043E9A0`, which is what moves the whole flight into camera space.
  // With no camera there is nothing to launch into and the creature waits on
  // the bone, which is what a headless run should look like.
  if (!host3d.viewSpaceOfPoint?.(_world, _cam)) return;
  c.pos.x = _cam.x; c.pos.y = _cam.y; c.pos.z = _cam.z;
  c.flight.start.x = _cam.x;
  c.flight.start.y = _cam.y;
  c.flight.start.z = _cam.z;
  // `FSQRT` of `x² + z²` at `0x0043E9E2` — the launch range, which the
  // tumble below divides by.
  c.flight.range = Math.sqrt(_cam.x * _cam.x + _cam.z * _cam.z);
  events?.emit("sound.play", { id: SOUND_RELEASE });
  c.frame = 0;
  c.arrived = 0;
  c.t = 0;
  c.ease = EASE_START;
  c.pitch = 0;
  c.state = BodyCreatureState.Fly;
  // Which player it flies at. One player: `g_active_player` names it and the
  // end point stays at the origin. Two: a coin flip, and the end point goes
  // to that player's gun.
  if (G.g_players_in_play === TWO_PLAYERS) {
    // `AND EAX, 0x80000001` then the sign fix — a signed `rand() % 2`.
    c.target = rng.int(2);
    // `sin(3π/2) = -1` for player 0 and `sin(π/2) = +1` for player 1, times
    // 0.6; `cos` of either is zero, so only `x` moves.
    c.flight.endX = (c.target === 0 ? -1 : 1) * PLAYER_GUN_OFFSET;
    c.flight.endZ = 0;
  } else if (G.g_active_player === 0 || G.g_active_player === 1) {
    c.target = G.g_active_player;
  }
}

/** `BodyCreatureUpdate`'s `case 3` — the flight. Returns false to retire. */
function BodyCreatureFly(c: BodyCreature, rng: Rng,
                         events?: Events): boolean {
  // `INC ECX / MOV [ESI+0x1330], ECX` happens **before** the shot test, so a
  // creature shot on its first flying frame is already on cel 1.
  c.frame += 1;
  if (c.flags & ActorFlag.Hit) {
    events?.emit("sound.play", { id: SOUND_SHOT });
    // Who pays, straight off the two shooter bits:
    //
    // ```
    // 0043EB9C  AND EAX, 0x2            ; player 0 fired
    // 0043EB9F  JZ  0043EBDF            ; not both -> the fixed arms
    // 0043EBA1  TEST CL, 0x4            ; player 1 fired
    // 0043EBA4  JZ  0043EBDF
    // 0043EBA6  rand() % 2              ; both -> a coin flip
    // 0043EBDF  CMP EAX, EBX / JZ 0043EBF7
    // 0043EBE5  ScoreAddForPlayer(0)    ; bit 1 set   -> player 0
    // 0043EBF7  ScoreAddForPlayer(1)    ; bit 1 clear -> player 1
    // ```
    //
    // So a creature that nothing marked pays **player 1**. That is the
    // engine's reading of the word and not a slip here: it is the fall-through
    // of a two-player test in a game that can have one player, and the port
    // reproduces it rather than tidying it into `player 0`.
    const both = (c.flags & SHOT_BY_PLAYER0) !== 0
              && (c.flags & SHOT_BY_PLAYER1) !== 0;
    const who = both
      ? rng.int(2)
      : ((c.flags & SHOT_BY_PLAYER0) !== 0 ? 0 : 1);
    ScoreAddForPlayer(who, BODY_CREATURE_SCORE);
    G.g_player_hit_count[who] = (G.g_player_hit_count[who] ?? 0) + 1;
    // `FUN_00430C50(obj+0x40)`, which reads `+0x30` past it: `obj+0x70`, and
    // in state 3 that is the position this frame.
    SpawnBloodSprayAtPoint(c.pos);
    c.frame = 0;
    c.fallSpeed = 0;
    c.flight.fallSpin = FALL_SPIN_SHOT;
    c.state = BodyCreatureState.FallShot;
    // The engine never clears bit 3 here; it does not have to, because the
    // arm it takes leaves state 3 and no other state reads the bit. Cleared
    // anyway so a record that somehow came back could not double-pay.
    c.flags &= ~ActorFlag.Hit;
    // The engine also drops its enemy slot here — `g_enemy_slots[obj+0x120]
    // = 0` — and returns without drawing. The port has no slot for a
    // non-actor to hold; see the `[open]` at the top of this file.
    return true;
  }
  const f = c.flight;
  // `x` and `z` lerp; `y` descends to zero and takes the arc on top.
  c.pos.x = (f.endX - f.start.x) * c.t + f.start.x;
  c.pos.z = (f.endZ - f.start.z) * c.t + f.start.z;
  c.pos.y = -f.start.y * c.t + BamsSin(c.t * ARC_BAMS) + f.start.y;
  if (c.arrived === 0) {
    // The tumble is a function of how much of the range is left, not of `t`:
    // `|dist / range| · 32768` BAMS through a sine, times 4096. Zero at both
    // ends, 22.5° at the middle, and the `FCOM 0.0 / FMUL -1.0` pair is an
    // absolute value.
    const d = Math.sqrt(c.pos.x * c.pos.x + c.pos.z * c.pos.z);
    const ratio = Math.abs(f.range === 0 ? 0 : d / f.range);
    // `__ftol` truncates and `AND 0xFFFF` then `NEG` is a negated `s16`.
    const sweep = Math.trunc(ratio * SPIN_SWEEP_BAMS) & 0xffff;
    c.pitch = -(Math.trunc(BamsSin(sweep) * SPIN_AMPLITUDE) & 0xffff);
    c.t += c.ease;
    c.ease *= EASE_DECAY;
    if (c.ease < EASE_FLOOR) c.ease = EASE_FLOOR;
    if (c.t > ARRIVE_T) c.arrived = 1;
  }
  if (c.arrived > 0 && ++c.arrived > HIT_DELAY_FRAMES) {
    // The engine's own three clauses, in this order and no others.
    if (G.g_scene_state_major_entered === DAMAGE_SCENE_MAJOR
        && G.g_players_in_play > 0
        && G.g_player_state[c.target] === PLAYER_STATE_IN_PLAY) {
      PlayerTakeDamage(c.target, null, HIT_MOTION, events);
      // `PlaySoundId(0)`, which is `PlaySoundId`'s own nothing: id 0 has no
      // record. Transcribed as the call it is rather than as a sound.
      events?.emit("sound.play", { id: 0 });
    }
    c.state = BodyCreatureState.FallAfterHit;
    c.flight.fallSpin = FALL_SPIN_MISSED;
    c.fallSpeed = 0;
  }
  // `obj+0x70..0x78 = obj+0x40..0x48` then `RegisterForShotTest`: the sphere
  // is the position, in the same space, with no transform, where every other
  // class needs one. The port's shot test is answered from `render/` — see
  // `GameHost.pickShot` — so being registered here is being in
  // `G.g_body_creatures` at all, and the list the renderer walks is this one.
  return true;
}

/** `case 4` and `case 6` — the fall, which differ only in the clamp. */
function BodyCreatureFall(c: BodyCreature): boolean {
  c.fallSpeed -= FALL_ACCEL;
  c.pos.y += c.fallSpeed;
  c.pitch += c.flight.fallSpin;
  // `FILD [EDI+0x24] / FMUL 1.01 / __ftol` — it grows, so the tumble
  // accelerates as the body drops.
  c.flight.fallSpin = Math.trunc(c.flight.fallSpin * FALL_SPIN_GROWTH);
  if (c.state === BodyCreatureState.FallShot) {
    if (c.pitch > FALL_SPIN_CLAMP) c.pitch = FALL_SPIN_CLAMP;
  } else if (c.pitch < -FALL_SPIN_CLAMP) {
    c.pitch = -FALL_SPIN_CLAMP;
  }
  // `FCOMP -3.0 / TEST AH, 0x41` — at or below, not below.
  if (c.pos.y <= DESPAWN_Y) {
    G.g_enemies_present -= 1;
    G.g_enemies_alive -= 1;
    return false;
  }
  return true;
}

/**
 * `BodyCreatureUpdate` — `FUN_0043E880`. One creature, one frame. False once
 * it should leave the pool.
 */
export function BodyCreatureUpdate(c: BodyCreature, rng: Rng, host: GameHost,
                                   events?: Events): boolean {
  const obj = G.g_object_list.find((a) => a.at === c.host);
  let live = true;
  switch (c.state) {
    case BodyCreatureState.RideHostBone:
      BodyCreatureRideHostBone(c, obj, rng, host, events);
      break;
    case BodyCreatureState.Fly:
      live = BodyCreatureFly(c, rng, events);
      break;
    case BodyCreatureState.FallAfterHit:
    case BodyCreatureState.FallShot:
      live = BodyCreatureFall(c);
      break;
    default:
      break;
  }
  // The last line of the routine, past the draw, on every state and every
  // path that does not despawn — the part the decompiler drops. See the
  // `[open]` about `RegisterForCameraTracking`, which is the other half of
  // that tail and is not ported.
  if (live) {
    // The draw's own argument, resolved here — see {@link BodyCreature.slot}.
    c.slot = BodyCreatureDrawSlot(c);
    c.flight.published.x = c.pos.x;
    c.flight.published.y = c.pos.y;
    c.flight.published.z = c.pos.z;
  }
  return live;
}

/**
 * `[port-only]` — the pool step the engine gets from its task list.
 *
 * Where `director.ts` runs it matters and matches: the creature is its own
 * object in the engine's pool, not an actor, so it is stepped beside the
 * thrown weapons and the breakable props rather than inside the actor walk.
 */
export function BodyCreaturePoolUpdate(rng: Rng, host: GameHost,
                                       events?: Events): void {
  const live = G.g_body_creatures;
  if (!live.length) return;
  G.g_body_creatures = live.filter(
    (c) => BodyCreatureUpdate(c, rng, host, events));
}

/**
 * `[port-only]` — the shot, from `render/`'s side of the seam: raise the bit
 * the update drains, exactly as `MarkActorShot` (`FUN_00404DB0`) does for an
 * actor. The engine needs no such function, because the creature is in the
 * same candidate array every other object is and `FUN_00404DB0` marks it.
 *
 * The score, the sound and the blood are the *update's*, not this — which is
 * the engine's own split and the reason a creature shot on the frame it
 * arrives still pays out.
 */
export function MarkBodyCreatureShot(c: BodyCreature, player: number): void {
  // `obj+0x34 |= (1 << (player + 1)) | 8` — the same line `MarkActorShot`
  // runs, and the reason the shooter bits are on the record at all.
  c.flags |= (1 << ((player + 1) & 0x1f)) | ActorFlag.Hit;
  c.hp = 0;
}

/** `obj+0x34` bit 1 — player 0 fired. `MarkActorShot`'s `1 << (0 + 1)`. */
const SHOT_BY_PLAYER0 = 0x2;
/** ...and bit 2, player 1. */
const SHOT_BY_PLAYER1 = 0x4;

/**
 * `CMP word ptr [0x009C8E80], 0x2` — the two-player arm's test, on
 * `g_players_in_play` and not on a flag. See that global's own note.
 */
const TWO_PLAYERS = 2;
/**
 * `FMUL double ptr [0x004E3108]` — how far off the eye each gun sits, in
 * camera space. `0.6`, on `x` only.
 */
const PLAYER_GUN_OFFSET = 0.6;
/**
 * The bone the creature comes out of: bone **1**, the torso, which is the
 * bone `ActorReactToHit`'s arm requires the shot to have hit and the bone
 * whose draw slot the release swaps.
 *
 * `[likely]` rather than `[proved]`: the engine reads a matrix at
 * `host+0x2C4`, and the bone records are `obj+0x20C + bone*0x90`, which makes
 * `0x2C4` bone 1's record `+0x28` — a matrix inside that record rather than a
 * bone index. Bone 1 is what the rest of the arm names, so that is the bone
 * the port asks the host for.
 */
const BODY_CREATURE_BONE = 1;

/** `FSIN` of a BAMS angle — `FMUL double ptr [0x004C4370]` is `2π/65536`. */
function BamsSin(bams: number): number {
  return Math.sin(bams * ((Math.PI * 2) / 0x10000));
}

const _world = vec3();
const _cam = vec3();

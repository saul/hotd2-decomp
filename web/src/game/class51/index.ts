/**
 * Class 0x51 — **the fish**, and the only enemy in the game that lives in the
 * water.
 *
 * The species is settled the way class 0x52's and class 0x53's were, by the
 * asset name rather than by what the model looks like: the twenty draw slots
 * `0x1156`..`0x1169` resolve through `ExeTables.assetSlots()` to **`fish.bin`
 * entries 3 to 22**, and the three the death states use — `0xB6F`, `0xB70` and
 * `0xB71` — are entries 0, 1 and 2 of the same file. `docs/formats/spawns.md`
 * had this class as "water enemy" on the strength of its splash sounds; the
 * file name is what names it.
 *
 * Twenty-eight spawns, all in stages 2 and 3, plus however many the stage-2
 * boss summons through `SpawnFishAt` (`FUN_00438640`).
 *
 * ## The descriptors come in groups, and the first of each is not a fish
 *
 * Every group of class-0x51 descriptors opens with one whose `tail+0x0E` is
 * **6**. `FishInit` takes that as a command rather than a placement: it clears
 * the four attack slots, sets `g_water_level` from the descriptor's
 * `tail+0x00` float, and kills the actor before it has a position. That is why
 * those records sit at the world origin with no orientation — they are the
 * water surface, not a creature. Seven of the twenty-eight are headers.
 *
 * ## The four attack slots
 *
 * `g_water_attack_slots` (`0x009A2C20`) is four dwords, and a fish may not
 * leave the surface without one. `FishClaimSlotAndLunge` picks at random,
 * falls back to the first free one, and gives up if all four are taken — at
 * which point the fish retires from both enemy counters and swims off.
 *
 * The slot is also **where it lunges to**: each is a point in the camera's own
 * space, `±1.5` sideways and `6.0` in front, with slots 1 and 3 two units
 * lower. In a two-player game slots 0 and 1 belong to player 0 and 2 and 3 to
 * player 1, so the four fish in the air are two at each player.
 *
 * ## Three sub-types, and only one of them is placed by a script
 *
 * `sub+0x6C` comes from `tail+0x0E` for a placed fish and from `SpawnFishAt`'s
 * argument for a summoned one. **Every shipped descriptor says 0**; 1 and 2
 * exist only because `Class14StateSummonRoundA` and `Class14StateSummonRoundB`
 * pass them. Sub-type 1 is the one that can land on solid ground — it is the
 * only arm that asks the world for a floor — and sub-type 2 lunges from a
 * point a unit higher and swings sideways by ±2 on the way.
 *
 * ## What is not ported
 *
 * `[diverges]` **The three cosmetic tasks.** `FishSpawnWaterSplash`
 * (`FUN_00439EA0`, slot `0x1339`), `FishSpawnSurfaceRing` (`FUN_00439FA0`, slot
 * `0xB71`) and `SpawnFishBloodCloud` (`FUN_00439DC0`, slot `0x3A` upward) each
 * allocate a 0x68-byte task whose update draws and steps a slot cursor. Their
 * **sounds** are ported, because those are what a player hears; the sprites
 * are not, because `[open]` — none of the three updates has a termination, so
 * porting them would mean inventing a lifetime the routines do not contain.
 *
 * `[diverges]` **The camera gate is coarser here.** `FishRegisterForCameraTracking`
 * (`FUN_00439D70`) offers the fish to the camera only in states 0, 1 and 2;
 * the port's `RegisterForCameraTracking` is a filter over the pool with no
 * per-class predicate, so a fish in {@link FishState.FallBack} stays a
 * candidate for the sixty-four frames it takes to sink. The death states are
 * covered, because `FishCheckShot` raises `NoCameraTrack` itself.
 *
 * The draw is `render/`'s: this class is drawn by asset slot, so it goes
 * through `render/slotmodels.ts` exactly as class 0x52 does.
 */
import type { Rng } from "../../core/rng";
import type { Events } from "../../core/events";
import { ActorFlag, CountFlag, type Actor } from "../actor";
import { QueryGroundHeightAt } from "../coli";
import { ReleaseEnemyAliveCount, ReleaseEnemyPresentCount } from "../combat/counts";
import { PlayerTakeDamage } from "../combat/player";
import { ScoreAddForPlayer } from "../combat/score";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import type { GameHost } from "../host";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { ActorSpawn } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { vec3 } from "../vec";
import { FishFlag, FishState, type FishTail } from "./state";

export { FishFlag, FishState } from "./state";
export type { FishTail } from "./state";

/** BAMS to radians — the engine's own `* 9.587379924285257e-05`. */
const BAMS = (Math.PI * 2) / 65536;

// -- what the descriptor says ----------------------------------------------

/**
 * `tail+0x0E == 6` — this descriptor is the **group header**, not a fish.
 *
 * The one value `FishInit` tests before anything else. It is read out of the
 * same halfword a real descriptor uses for its sub-type, which is why the
 * sub-types stop at 2.
 */
export const FISH_GROUP_HEADER = 6;

/** `tail+0x0C` — 0 draws solid and casts a surface shadow, 1 fades in. */
export enum FishEntryMode {
  /** Raises {@link FishFlag.Surfaced}. */
  Solid = 0,
  /** Starts the alpha at zero; {@link FishStateRise} winds it up. */
  FadeIn = 1,
}

// -- the numbers the routines spell as literals ----------------------------

/** `obj+0x124` — the radius `ShotTestSphere` measures against. */
export const FISH_HIT_RADIUS = 2.1;
/** `ScoreAddForPlayer(player, 0x50)` — what a fish is worth. */
export const FISH_SCORE = 0x50;
/** The twenty frames of `fish.bin`, as asset slots. */
export const FISH_FIRST_SLOT = 0x1156;
export const FISH_LAST_SLOT = 0x1169;
/** `fish.bin` 0 and 1 — the flung corpse and the sunk one. */
export const FISH_FLUNG_SLOT = 0xb6f;
export const FISH_SUNK_SLOT = 0xb70;
/** `sub+0x1C`/`sub+0x24` when the fish and the camera are at the same point. */
export const FISH_MIN_SPEED = 0.001;
/** `FishStateRise` winds the alpha up by this much a frame. */
export const FISH_FADE_RATE = 0.02;
/** `FishStateBob` steps the surface bob by this much a frame. */
export const FISH_BOB_STEP = 0x333;
/** ...and counts a cycle every this many frames. */
export const FISH_BOB_CYCLE_FRAMES = 0x50;
/** The pitch `FishStateBob` snaps to on the first frame of each cycle... */
export const FISH_BOB_PITCH_START = 0xe000;
/** ...and winds up by, until it stops at 0xFFFF. */
export const FISH_BOB_PITCH_RATE = 0xcc;
/** Inside this the lunge connects; past this it is abandoned. */
export const FISH_BITE_RANGE = 8.0;
export const FISH_ABANDON_RANGE = 200.0;
/** `PlayerTakeDamage(player, 1, 9)` — the fish's damage kind. */
export const FISH_DAMAGE_KIND = 9;
/** `FishStateFallBack`: the frame it lets the slot go, and the one it goes on. */
export const FISH_FALLBACK_RELEASE = 0x20;
export const FISH_FALLBACK_END = 0x40;
/** ...falling this much a frame, at half its lateral speed. */
export const FISH_FALLBACK_DROP = 0.4;
export const FISH_FALLBACK_DRIFT = 0.5;
/** `FishStateFlung`: the upward kick, and the gravity that takes it back. */
export const FISH_FLUNG_LIFT = 0.4;
export const FISH_FLUNG_GRAVITY = 0.03266;
/** The tumble `FishCheckShot` draws for the flung corpse. */
export const FISH_TUMBLE_YAW_BASE = 0x4ff;
export const FISH_TUMBLE_YAW_SPREAD = 0x1000;
export const FISH_TUMBLE_PITCH_SPREAD = 0x100;
/** `sub+0x3C` — the bob rate of the flung corpse, and of the sunk one. */
export const FISH_FLUNG_BOB_RATE = 819.0;
export const FISH_SINK_BOB_RATE = 1024.0;
/** `sub+0x40` — where the flung corpse's bob starts. */
export const FISH_FLUNG_BOB_PHASE = 32768.0;
/** `sub+0x2C` reused as an amplitude: the flung corpse's, and the sunk one's. */
export const FISH_FLUNG_BOB = 5.0;
export const FISH_SINK_BOB = 0.2;
/** How far above `g_water_level` a corpse floats, drifts and sinks. */
export const FISH_SINK_LIFT = 0.1;
export const FISH_DEATH_LIFT = 0.04;
export const FISH_SINK_RATE = 0.005;
export const FISH_SINK_DRIFT = 0.01;
export const FISH_SINK_YAW_STEP = 0x40;
/** `FishStateSink` gives up here. */
export const FISH_SINK_FRAMES = 300;
/** `FishStateFlung`'s own patience, for a sub-type that never meets ground. */
export const FISH_FLUNG_FRAMES = 0x1900;
/** `SpawnFishAt`'s own two: the water it sets, and the lifetime it defaults to. */
export const FISH_SUMMON_WATER_LEVEL = -24.9;
export const FISH_SUMMON_LIFETIME = 0x50;
/** `FishBeginSwimAway`'s two literals. */
export const FISH_SWIM_AWAY_FRAMES = 0x3c;
export const FISH_SWIM_AWAY_SCALE = 0.4;

/**
 * The four attack slots, as points in the camera's own space.
 *
 * `FishClaimSlotAndLunge` spells them as four arms of a jump table, each
 * building `{±1.5, y, -6.0}` where `y` is zero, or 1.0 for sub-type 2, and two
 * less again for the odd slots. `-z` is in front — the same sign
 * {@link GameHost.viewPoint} takes.
 */
export const FISH_SLOT_SIDE = 1.5;
export const FISH_SLOT_AHEAD = -6.0;
export const FISH_SLOT_DROP = 2.0;
/** Sub-type 2 aims a unit higher than the rest. */
export const FISH_SLOT_LIFT_SUBTYPE2 = 1.0;
/** How many there are, and how many belong to player 0 in a two-player game. */
export const FISH_ATTACK_SLOTS = 4;
export const FISH_SLOTS_PER_PLAYER = 2;

/** `PlaySoundId` — `COMMON\BLOOD07_16.WAV`, and it is what says it is meat. */
export const SND_FISH_KILLED = 0x716a9;
/** `COMMON\ENE_WALK3_16.WAV` — a corpse hitting something that is not water. */
export const SND_FISH_LANDED = 0x2616a9;
/** `COMMON\SIBUKI2_16.WAV` and `SIBUKI3` — *shibuki*, a splash. */
export const SND_SPLASH_BIG = 0x4116a9;
export const SND_SPLASH_SMALL = 0x4216a9;

function Tail(obj: Actor): FishTail | null {
  return (obj as Actor & { fish?: FishTail }).fish ?? null;
}

function play(events: Events | undefined, id: number): void {
  events?.emit("sound.play", { id });
}

/** `sub+0x6E += 1`, wrapping past `sub+0x70` back to `sub+0x72`. */
function FishAdvanceStrip(sub: FishTail): void {
  sub.frame += 1;
  if (sub.lastFrame < sub.frame) sub.frame = sub.firstFrame;
}

/**
 * `atan2` in the engine's order: `FPATAN` with `dx` pushed first and `dz`
 * second, which is `atan(dx / dz)` as a full-circle angle, in BAMS.
 */
function FishYawTo(dx: number, dz: number): number {
  return Math.round(Math.atan2(dx, dz) / BAMS) & 0xffff;
}

/**
 * The corpse's model, which is **not** the same slot in and out of play.
 *
 * `if (g_app_state == 6) 0xB6F else 0x1156` appears five times in the class.
 * Six is in play, so a fish killed during a run draws `fish.bin` 0 or 1 and
 * one killed anywhere else keeps the first frame of the swim strip — those two
 * models are only loaded while a stage is.
 */
function FishCorpseSlot(inPlaySlot: number): number {
  return G.g_app_state === 6 ? inPlaySlot : FISH_FIRST_SLOT;
}

// -- the effects, which are sounds here and sprites in the engine -----------

/**
 * `FishSpawnWaterSplash` — `FUN_00439EA0`.
 *
 * `kind` is the caller's: 1 for a body going into the water, 0 for the surface
 * being crossed or clipped. It picks the sound, and in the engine it also ends
 * up on the sprite at `+0x64`.
 *
 * `[diverges]` The sprite is not built — see the file's note. The sound is.
 */
export function FishSpawnWaterSplash(_obj: Actor, _scale: number, kind: number,
                                 events?: Events): void {
  play(events, kind === 0 ? SND_SPLASH_SMALL : SND_SPLASH_BIG);
}

/**
 * `FishSpawnSurfaceRing` — `FUN_00439FA0`. Slot `0xB71`, silent.
 *
 * `[diverges]` Not built, and it makes no sound, so this is a name with
 * nothing behind it — kept as a call site so the two places the engine fires
 * it are visible in the port.
 */
export function FishSpawnSurfaceRing(_obj: Actor, _scale: number): void {
  // Nothing: see the file's note on the three cosmetic tasks.
}

/**
 * `SpawnFishBloodCloud` — `FUN_00439DC0`. Slot `0x3A` upward, in play only.
 *
 * `[diverges]` Not built. It is **not** `SpawnBloodSpray` (`FUN_00407310`)
 * despite starting at the same slot: this one draws at the actor's camera-space
 * point with an identity matrix and steps its cursor with no last frame at all.
 */
export function SpawnFishBloodCloud(_obj: Actor): void {
  // Nothing: see the file's note on the three cosmetic tasks.
}

// -- claiming and releasing ------------------------------------------------

/** `if (sub+0x76 != -1) { g_water_attack_slots[sub+0x76] = 0; sub+0x76 = -1; }` */
function FishReleaseAttackSlot(sub: FishTail): void {
  if (sub.slot === -1) return;
  G.g_water_attack_slots[sub.slot] = 0;
  sub.slot = -1;
}

/** `if (obj+0x121 != -1) obj+0x121 = -1` — the permit, which is a different slot. */
function FishReleaseAttackPermit(obj: Actor): void {
  if (obj.attackPermit !== -1) obj.attackPermit = -1;
}

/**
 * `FishClaimSlotAndLunge` — `FUN_00438850`. The leap begins, or it does not.
 *
 * Three things in one routine, and the order matters:
 *
 * 1. **Claim one of the four.** A random index first; if it is taken, the
 *    lowest free one; if there is none, return -1 and change nothing. The
 *    permit follows from the index — slots 0 and 1 are player 0's — except in
 *    a one-player game, where it is `g_active_player == 0 ? 0 : 1` whatever
 *    slot came up.
 * 2. **Aim at that slot**, as a point in the camera's own space, and turn the
 *    whole displacement into a per-frame velocity over `sub+0x7E` frames. The
 *    yaw is `atan(dx/dz)` and the pitch `atan(dz/dy)`, both drawn rather than
 *    derived from the velocity.
 * 3. **Reset the animation** to the head of the strip and enter
 *    {@link FishState.Lunge} with a full alpha and no flags.
 *
 * `dx` is forced to 1.0 when it is exactly zero, before either angle is taken
 * and before the divide — so a fish directly ahead still gets a finite
 * velocity rather than a division by nothing.
 *
 * Returns 0 on success and -1 when every slot is taken, which is the only
 * thing its caller looks at.
 */
export function FishClaimSlotAndLunge(obj: Actor, rng: Rng,
                                      host?: GameHost): number {
  const sub = Tail(obj);
  if (!sub) return -1;
  const slots = G.g_water_attack_slots;

  const firstFree = (): number => {
    for (let i = 0; i < FISH_ATTACK_SLOTS; i += 1) {
      if (slots[i] === 0) return i;
    }
    return FISH_ATTACK_SLOTS;
  };

  let idx = rng.int(FISH_ATTACK_SLOTS);
  if (G.g_players_in_play === 1) {
    if (slots[idx] !== 0) {
      idx = firstFree();
      if (idx >= FISH_ATTACK_SLOTS) return -1;
    }
    slots[idx] = 1;
    obj.attackPermit = G.g_active_player === 0 ? 0 : 1;
  } else if (G.g_players_in_play === 2) {
    if (slots[idx] !== 0) {
      idx = firstFree();
      if (idx >= FISH_ATTACK_SLOTS) return -1;
    }
    slots[idx] = 1;
    obj.attackPermit = idx < FISH_SLOTS_PER_PLAYER ? 0 : 1;
  } else {
    return -1;
  }
  sub.slot = idx;

  // The slot's point, in the camera's own space. `-z` is in front.
  const lift = sub.subtype === 2 ? FISH_SLOT_LIFT_SUBTYPE2 : 0;
  const side = idx < FISH_SLOTS_PER_PLAYER ? -FISH_SLOT_SIDE : FISH_SLOT_SIDE;
  const y = (idx & 1) ? lift - FISH_SLOT_DROP : lift;
  const to = vec3();
  host?.viewPoint(side, y, FISH_SLOT_AHEAD, to);

  let dx = to.x - obj.pos.x;
  const dy = to.y - obj.pos.y;
  const dz = to.z - obj.pos.z;
  if (dx === 0) dx = 1.0;

  sub.yaw = FishYawTo(dx, dz);
  sub.pitch = Math.round(Math.atan2(dz, dy) / BAMS) & 0xffff;
  sub.dx = dx;
  sub.dy = dy;
  sub.dz = dz;
  if (sub.subtype === 2) {
    sub.swing = rng.int(10) < 5 ? -FISH_SLOT_DROP : FISH_SLOT_DROP;
  }

  const frames = sub.lungeFrames;
  sub.state = FishState.Lunge;
  sub.timer = 0;
  sub.lungeStep = 0;
  sub.frame = FISH_FIRST_SLOT;
  sub.firstFrame = FISH_FIRST_SLOT;
  sub.lastFrame = FISH_LAST_SLOT;
  sub.vx = dx / frames;
  sub.vy = dy / frames;
  sub.vz = dz / frames;
  sub.fromX = obj.pos.x;
  sub.fromY = obj.pos.y;
  sub.fromZ = obj.pos.z;
  sub.flags = 0;
  sub.alpha = 1;
  return 0;
}

// -- the Init --------------------------------------------------------------

/**
 * `FishBeginRise` — `FUN_00438760`. Everything a placed fish starts from.
 *
 * It puts the actor back on its descriptor's point, turns the two speed
 * numbers the tail carries into a velocity that heads at the camera, and faces
 * it that way. The speeds are per axis and are scaled by the **unit** direction,
 * so a descriptor with `0.3, 0.3` closes at 0.3 a frame and one with `0.0, 0.3`
 * only ever moves in z.
 *
 * `sub+0x78 = 1` here is overwritten by the Init a line later; it is the
 * default for the caller that does not set one, and `SpawnFishAt` is not that
 * caller — it skips this routine entirely.
 */
export function FishBeginRise(obj: Actor): void {
  const sub = Tail(obj);
  if (!sub) return;
  const eye = G.g_camera_block_eye;
  obj.pos.x = sub.homeX;
  obj.pos.y = sub.homeY;
  obj.pos.z = sub.homeZ;
  sub.timer = 0;
  const dx = eye.x - obj.pos.x;
  const dz = eye.z - obj.pos.z;
  const len = Math.hypot(dx, dz);
  if (len === 0) {
    sub.vx = FISH_MIN_SPEED;
    sub.vz = FISH_MIN_SPEED;
  } else {
    sub.vx = dx * sub.vx / len;
    sub.vz = dz * sub.vz / len;
  }
  sub.vy = 0;
  sub.yawRate = 0;
  sub.pitch = 0;
  sub.pitchRate = 0;
  sub.yawStep = 0;
  sub.bobPhase = 0;
  sub.bobCycle = 0;
  sub.state = FishState.Rise;
  sub.dy = 0;
  sub.flags = 0;
  sub.yaw = FishYawTo(dx, dz);
  sub.bobCycles = 1;
  sub.alpha = 1;
  sub.frame = FISH_FIRST_SLOT;
  sub.firstFrame = FISH_FIRST_SLOT;
  sub.lastFrame = FISH_LAST_SLOT;
}

/**
 * `FishInit` — `FUN_00438540`. Class 0x51's handler.
 *
 * ```c
 * obj->+0x3C = -1;                                  // no hit slot yet
 * if (tail->+0x0E == 6) {                           // the group header
 *     g_water_attack_slots[0..3] = 0;
 *     g_water_level = tail->+0x00;
 *     ActorKill(obj);  return;
 * }
 * obj->+0x124 = 2.1;
 * sub = ActorAllocSub(0x84);
 * sub->home = obj->pos;
 * g_enemies_alive++;  g_enemies_present++;
 * sub->+0x76 = -1;  obj->+0x121 = -1;  obj->+0x120 = -1;
 * RegisterEnemySlot(obj);
 * sub->+0x1C = tail->+0x00;  sub->+0x24 = tail->+0x04;
 * FishBeginRise(obj);
 * if      (tail->+0x0C == 0) sub->+0x6A |= 4;
 * else if (tail->+0x0C == 1) sub->+0x48 = 0;
 * sub->+0x6C = tail->+0x0E;  sub->+0x7C = tail->+0x10;
 * sub->+0x78 = tail->+0x12;  sub->+0x7E = tail->+0x14;
 * sub->+0x44 = tail->+0x08;
 * *obj = FishUpdate;
 * ```
 *
 * The two speed fields are written **before** `FishBeginRise` and consumed by
 * it, and the other five **after**, which is why `sub+0x78`'s default of 1
 * never survives. Transcribed in that order for the same reason.
 */
export function FishInit(obj: Actor, _rng?: Rng): void {
  const sub = Tail(obj);
  const p = obj.class51;
  if (!sub || !p) return;
  if (p.subtype === FISH_GROUP_HEADER) {
    for (let i = 0; i < FISH_ATTACK_SLOTS; i += 1) G.g_water_attack_slots[i] = 0;
    G.g_water_level = p.water_level;
    // `[port-only]` — a header never joins either counter, so it is marked as
    // having already left them. Without it the port's dead sweep, which cannot
    // know the difference, gives back two counts the actor never took, and a
    // header that is rebuilt while its spawn is still listed takes the scene's
    // enemy count negative one pair a frame.
    obj.flags38 |= CountFlag.LeftAlive | CountFlag.LeftPresent;
    ActorDespawn(obj);
    return;
  }
  obj.hitRadius = FISH_HIT_RADIUS;
  sub.homeX = obj.pos.x;
  sub.homeY = obj.pos.y;
  sub.homeZ = obj.pos.z;
  G.g_enemies_alive += 1;
  G.g_enemies_present += 1;
  sub.slot = -1;
  obj.attackPermit = -1;
  sub.vx = p.speed_x;
  sub.vz = p.speed_z;
  FishBeginRise(obj);
  sub.entryMode = p.entry_mode;
  if (p.entry_mode === FishEntryMode.Solid) sub.flags |= FishFlag.Surfaced;
  else if (p.entry_mode === FishEntryMode.FadeIn) sub.alpha = 0;
  sub.subtype = p.subtype;
  sub.riseFrames = p.rise_frames;
  sub.bobCycles = p.bob_cycles;
  sub.lungeFrames = p.lunge_frames;
  sub.bobAmplitude = p.bob_amplitude;
}

// -- the states ------------------------------------------------------------

/**
 * `FishStateRise` — `FUN_00438F90`. State 0.
 *
 * It closes on the camera at its descriptor's speed, keeps
 * {@link FishFlag.Submerged} in step with `g_water_level`, winds the alpha up
 * to one and hands over after `sub+0x7C` frames. Nothing here can be shot into
 * a different state; `FishCheckShot` does that from outside.
 */
export function FishStateRise(obj: Actor): void {
  const sub = Tail(obj);
  if (!sub) return;
  obj.pos.x += sub.vx;
  obj.pos.z += sub.vz;
  if (G.g_water_level <= obj.pos.y) sub.flags &= ~FishFlag.Submerged;
  else sub.flags |= FishFlag.Submerged;
  FishAdvanceStrip(sub);
  sub.timer += 1;
  if (sub.alpha < 1.0) sub.alpha += FISH_FADE_RATE;
  if (sub.riseFrames <= sub.timer) {
    sub.state = FishState.Bob;
    sub.timer = 0;
    sub.alpha = 1.0;
  }
}

/**
 * `FishStateBob` — `FUN_00439020`. State 1.
 *
 * The surface ride: `y = sin(phase) * amplitude + home.y`, floored at the home
 * height so it never dips below where the descriptor put it, with the phase
 * stepped `0x333` a frame and reset every eighty. Each reset counts a cycle,
 * and when the count reaches `sub+0x78` the fish tries to lunge.
 *
 * **The splash is on the crossing, not on the state.** Two arms compare the
 * height with `g_water_level` and fire `FishSpawnWaterSplash` only when the bit
 * they are about to write differs from the one already there — 0.3 coming out,
 * 0.5 going in.
 *
 * The pitch wind-up is separate machinery again: `0xE000` on the first frame
 * of each cycle, `0xCC` a frame, clamped at `0xFFFF`. It is the nose lifting.
 */
export function FishStateBob(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  const y = Math.sin(sub.bobPhase * BAMS) * sub.bobAmplitude + sub.homeY;
  obj.pos.y = y < sub.homeY ? sub.homeY : y;
  obj.pos.x += sub.vx;
  obj.pos.z += sub.vz;
  FishAdvanceStrip(sub);
  sub.bobPhase = (sub.bobPhase + FISH_BOB_STEP) << 16 >> 16;
  sub.timer += 1;
  if (sub.timer === FISH_BOB_CYCLE_FRAMES) {
    sub.bobCycle += 1;
    sub.timer = 0;
    sub.bobPhase = 0;
  }
  if (G.g_water_level <= obj.pos.y) {
    if (sub.flags & FishFlag.Submerged) FishSpawnWaterSplash(obj, 0.3, 0, f.events);
    sub.flags &= ~FishFlag.Submerged;
  } else {
    if (!(sub.flags & FishFlag.Submerged)) FishSpawnWaterSplash(obj, 0.5, 0, f.events);
    sub.flags |= FishFlag.Submerged;
  }
  if (sub.timer === 1) sub.pitch = FISH_BOB_PITCH_START;
  sub.pitch += FISH_BOB_PITCH_RATE;
  if (sub.pitch > 0xfffe) sub.pitch = 0xffff;
  sub.pitch &= 0xffff;
  if (sub.bobCycle !== sub.bobCycles) return;
  if (FishClaimSlotAndLunge(obj, f.rng, f.host) !== -1) return;
  // Every slot is taken. It stops being an enemy and swims off.
  ReleaseEnemyPresentCount(obj);
  ReleaseEnemyAliveCount(obj);
  obj.flags |= ActorFlag.NoCameraTrack;
  FishReleaseAttackPermit(obj);
  FishReleaseAttackSlot(sub);
  FishBeginSwimAway(obj, FISH_SWIM_AWAY_FRAMES);
}

/**
 * `FishStateLunge` — `FUN_00439190`. State 2, and the three sub-types differ
 * only here.
 *
 * The arc is a sine of the **step over the duration**, not of a clock: the
 * step is clamped at `sub+0x7E - 1` while the timer runs on to twice that, so
 * a fish that has not connected hangs at the top of its leap for a whole
 * second duration before {@link FishEndLunge} takes it.
 *
 * * sub-type 0 rides its velocity in x and z and takes y from the sine.
 * * sub-type 1 adds a **second** sine at twice the rate and six units of
 *   amplitude, which is a bigger, doubled hop.
 * * sub-type 2 leaves x to the sines instead — the lunge's own dx plus its
 *   ±2 swing — and steps y and z linearly.
 */
export function FishStateLunge(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  const frames = sub.lungeFrames || 1;
  const a = Math.trunc((sub.lungeStep * 0x4000) / frames);
  const b = Math.trunc((sub.lungeStep * 0x8000) / frames);
  if (sub.subtype === 1) {
    obj.pos.x += sub.vx;
    obj.pos.z += sub.vz;
    obj.pos.y = Math.sin(b * BAMS) * 6.0 + Math.sin(a * BAMS) * sub.dy
      + sub.fromY;
  } else if (sub.subtype === 2) {
    obj.pos.z += sub.vz;
    obj.pos.y += sub.vy;
    obj.pos.x = Math.sin(a * BAMS) * sub.dx + Math.sin(b * BAMS) * sub.swing
      + sub.fromX;
  } else {
    obj.pos.x += sub.vx;
    obj.pos.z += sub.vz;
    obj.pos.y = Math.sin(a * BAMS) * sub.dy + sub.fromY;
  }
  sub.timer += 1;
  FishAdvanceStrip(sub);
  sub.lungeStep += 1;
  if (sub.lungeStep > frames - 1) sub.lungeStep = frames - 1;
  if (sub.timer > frames * 2 - 1) FishEndLunge(obj);
  if (sub.timer < 0x10 && sub.timer === 2) {
    FishSpawnWaterSplash(obj, 0.6, 0, f.events);
  }
}

/**
 * `FishLungeTestBite` — `FUN_004397C0`. Beside state 2, every frame of it.
 *
 * One distance, three answers: inside eight units it bites the player whose
 * permit it holds and the lunge is over; past two hundred the lunge is over
 * without a bite; between the two, nothing. A fish that somehow arrived
 * without a permit still ends its lunge on contact — the damage is what the
 * permit gates, not the ending.
 */
export function FishLungeTestBite(obj: Actor, f: ClassFrame): void {
  const d = Math.hypot(obj.pos.x - f.eye.x, obj.pos.y - f.eye.y,
                       obj.pos.z - f.eye.z);
  if (d >= FISH_BITE_RANGE) {
    if (d <= FISH_ABANDON_RANGE) return;
  } else if (obj.attackPermit !== -1) {
    PlayerTakeDamage(obj.attackPermit, obj, FISH_DAMAGE_KIND, f.events,
                     "strike");
    FishEndLunge(obj);
    return;
  }
  FishEndLunge(obj);
}

/**
 * `FishEndLunge` — `FUN_00439330`.
 *
 * Into {@link FishState.FallBack} with the clock restarted, giving the camera
 * and the permit back — but **not** the attack slot, which
 * {@link FishStateFallBack} holds for another thirty-two frames so the next
 * fish cannot leap through the one still coming down.
 */
export function FishEndLunge(obj: Actor): void {
  const sub = Tail(obj);
  if (!sub) return;
  sub.state = FishState.FallBack;
  sub.timer = 0;
  obj.flags |= ActorFlag.NoCameraTrack;
  FishReleaseAttackPermit(obj);
}

/**
 * `FishStateFallBack` — `FUN_00439370`. State 3.
 *
 * Thirty-two frames of nothing, then the attack slot goes back and it falls
 * 0.4 a frame at half its lateral speed for another thirty-two, then it is
 * gone. Its own retire, not the sweep's: both counters and the permit.
 */
export function FishStateFallBack(obj: Actor): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (sub.timer === FISH_FALLBACK_RELEASE) {
    obj.flags |= ActorFlag.NoCameraTrack;
    FishReleaseAttackSlot(sub);
  }
  if (sub.timer > FISH_FALLBACK_RELEASE - 1
      && sub.timer < FISH_FALLBACK_END) {
    obj.pos.y -= FISH_FALLBACK_DROP;
    obj.pos.x += sub.vx * FISH_FALLBACK_DRIFT;
    obj.pos.z += sub.vz * FISH_FALLBACK_DRIFT;
  }
  if (sub.timer > FISH_FALLBACK_END - 1) {
    ReleaseEnemyAliveCount(obj);
    ReleaseEnemyPresentCount(obj);
    FishReleaseAttackPermit(obj);
    ActorDespawn(obj);
    return;
  }
  FishAdvanceStrip(sub);
  sub.timer += 1;
}

/**
 * `FishStateFlung` — `FUN_00439450`. State 4: shot above the water.
 *
 * A ballistic arc with a tumble on two axes, and where it ends depends on the
 * sub-type. **Sub-type 1 is the only one that asks the world for a floor** —
 * `QueryGroundHeightAt` ten units above itself — and it is the only fish that
 * can land on something solid, which plays `ENE_WALK3` and pins the corpse
 * where it fell. Every other sub-type simply waits to fall back through
 * `g_water_level`, or gives up after 0x1900 frames.
 *
 * `g_coli_hit_surface == 0` is "the trace found nothing", so the arm that
 * looks like the ground case is in fact the *water* case: the height came back
 * with no surface behind it.
 */
export function FishStateFlung(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  const y = obj.pos.y + sub.vy;
  sub.vy -= FISH_FLUNG_GRAVITY;
  obj.pos.x += sub.vx;
  obj.pos.z += sub.vz;
  sub.yaw = (sub.yaw + sub.yawRate) & 0xffff;
  sub.bobPhaseF += sub.bobRate;
  sub.timer += 1;
  sub.pitch = (sub.pitch + sub.pitchRate) & 0xffff;

  const intoWater = (): void => {
    sub.bobRate = FISH_SINK_BOB_RATE;
    sub.bobPhaseF = 0;
    sub.sinkY = G.g_water_level + FISH_SINK_LIFT;
    sub.vx = FISH_SINK_DRIFT;
    sub.vz = -FISH_SINK_DRIFT;
    sub.yawStep = FISH_SINK_YAW_STEP;
    sub.yaw = f.rng.int(0x10000);
  };

  if (sub.subtype === 1) {
    const h = QueryGroundHeightAt(obj.pos.x, obj.pos.y + 10.0, obj.pos.z);
    if (y > h) { obj.pos.y = y; return; }
    if (G.g_coli_hit_surface === 0) {
      obj.pos.y = y;
      intoWater();
      FishSpawnWaterSplash(obj, 0.8, 1, f.events);
      FishSpawnSurfaceRing(obj, 0.8);
    } else {
      obj.pos.y = h;
      sub.bobRate = 0;
      sub.bobPhaseF = 0;
      sub.sinkY = obj.pos.y;
      sub.flags |= FishFlag.OnGround;
      sub.vx = 0;
      sub.vz = 0;
      sub.yaw = 0;
      sub.yawStep = 0;
      play(f.events, SND_FISH_LANDED);
      FishSpawnSurfaceRing(obj, 0.8);
    }
    ReleaseEnemyPresentCount(obj);
    sub.dy = FISH_SINK_BOB;
    sub.state = FishState.Sink;
    sub.frame = FishCorpseSlot(FISH_FLUNG_SLOT);
    sub.timer = 0;
    obj.pos.y = y;
    return;
  }

  if (sub.timer < FISH_FLUNG_FRAMES && G.g_water_level < y) {
    obj.pos.y = y;
    return;
  }
  obj.pos.y = y;
  sub.state = FishState.Sink;
  sub.frame = FishCorpseSlot(FISH_FLUNG_SLOT);
  sub.dy = FISH_SINK_BOB;
  intoWater();
  sub.timer = 0;
  FishSpawnSurfaceRing(obj, 0.8);
  FishSpawnWaterSplash(obj, 0.8, 1, f.events);
  ReleaseEnemyPresentCount(obj);
}

/**
 * `FishStateSink` — `FUN_00439700`. State 5: dead on the water, or on a floor.
 *
 * `y = sin(phase) * amplitude + centre`, with the centre sinking 0.005 a frame
 * for three hundred frames. A corpse that landed on solid ground has a rate of
 * zero and an amplitude that never moves it, so it lies still and still sinks
 * — which is what the engine does, floor or no floor.
 *
 * **The phase is a float**: `sub+0x40` accumulates `sub+0x3C` as a float and
 * is converted to an integer and masked to sixteen bits for the sine. The
 * decompiler drops the argument to `__ftol`, so this reads as `__ftol()` there
 * and as the accumulator here — see `docs/LESSONS.md`.
 */
export function FishStateSink(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  obj.pos.x += sub.vx;
  const phase = Math.trunc(sub.bobPhaseF) & 0xffff;
  obj.pos.y = Math.sin(phase * BAMS) * sub.dy + sub.sinkY;
  sub.sinkY -= FISH_SINK_RATE;
  obj.pos.z += sub.vz;
  if (sub.timer === 1 && !(sub.flags & FishFlag.OnGround)) {
    FishSpawnSurfaceRing(obj, 0.6);
    FishSpawnSurfaceRing(obj, 0.3);
  }
  sub.timer += 1;
  sub.yaw += sub.yawStep;
  sub.bobPhaseF += sub.bobRate;
  if (sub.timer >= FISH_SINK_FRAMES) ActorDespawn(obj);
  void f;
}

/**
 * `FishBeginSwimAway` — `FUN_00439BF0`, and `FishSwimAwayTick`
 * (`FUN_00439C20`) is what it installs.
 *
 * The way out for a fish that wanted to leap and found all four slots taken.
 * It is already out of both counters by the time this runs, so it is scenery.
 *
 * `[open]` **Nothing ever removes it.** `FishBeginSwimAway` writes a frame
 * count into `sub+0x7C` and `FishSwimAwayTick` never reads it, and the
 * update has no despawn of any kind — it holds the fish at the home height and
 * drifts it along the velocity it already had, for ever. Transcribed as
 * written; the count is carried so the reading is visible.
 */
export function FishBeginSwimAway(obj: Actor, frames: number): void {
  const sub = Tail(obj);
  if (!sub) return;
  sub.timer = 0;
  sub.riseFrames = frames;
  sub.dx = FISH_SWIM_AWAY_SCALE;
  sub.swimAway = true;
}

/** `FishSwimAwayTick` — `FUN_00439C20`. See {@link FishBeginSwimAway}. */
export function FishSwimAwayTick(obj: Actor): void {
  const sub = Tail(obj);
  if (!sub) return;
  obj.pos.y = sub.homeY;
  obj.pos.x += sub.vx;
  obj.pos.z += sub.vz;
}

// -- being shot ------------------------------------------------------------

/**
 * `FishCheckShot` — `FUN_00438C10`. The whole of the class's damage model.
 *
 * There are no hit points: a fish is only ever shot once, because the first
 * hit takes it out of states 0 to 3 and the test is on those states. Eighty
 * points to whichever player's bit is set, or to a coin flip when both are,
 * and the hit is counted toward the accuracy grade **only for sub-type 0** —
 * the boss's summons are worth points and not worth accuracy.
 *
 * Then the fork that decides which corpse it becomes, and it is on
 * {@link FishFlag.Submerged} rather than on the height:
 *
 * * **above the water** — flung. It is kicked 0.4 upward, given a velocity
 *   directly away from the camera at half the distance, and a tumble drawn on
 *   both axes with a coin flip for the direction.
 * * **below it** — it surfaces immediately, splashes, and sinks.
 *
 * Both arms end the same way: the hit bit cleared, the blood cloud, the camera
 * let go, one off the alive count and the enemy slot, the permit and the
 * attack slot released.
 */
export function FishCheckShot(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  const st = sub.state;
  if (st !== FishState.Rise && st !== FishState.Bob
      && st !== FishState.Lunge && st !== FishState.FallBack) return;
  if (!(obj.flags & ActorFlag.Hit)) return;

  const byP0 = (obj.flags & ActorFlag.HitByPlayer0) !== 0;
  const byP1 = (obj.flags & ActorFlag.HitByPlayer1) !== 0;
  let who: number;
  if (!byP0 || !byP1) who = byP0 ? 0 : 1;
  else who = f.rng.int(2);
  ScoreAddForPlayer(who, FISH_SCORE, f.events);
  if (sub.subtype === 0) {
    G.g_player_hit_count[who] = (G.g_player_hit_count[who] ?? 0) + 1;
  }
  play(f.events, SND_FISH_KILLED);

  if (!(sub.flags & FishFlag.Submerged)) {
    sub.state = FishState.Flung;
    sub.frame = FishCorpseSlot(FISH_FLUNG_SLOT);
    sub.vy = FISH_FLUNG_LIFT;
    const dx = obj.pos.x - f.eye.x;
    const dz = obj.pos.z - f.eye.z;
    const len = Math.hypot(dx, dz) * 2;
    if (len === 0) { sub.vx = 0; sub.vz = 0; }
    else { sub.vx = dx / len; sub.vz = dz / len; }
    sub.yaw = 0;
    sub.pitch = 0;
    if (f.rng.int(100) < 50) {
      sub.yawRate = f.rng.int(FISH_TUMBLE_YAW_SPREAD) + FISH_TUMBLE_YAW_BASE;
      sub.pitchRate = f.rng.int(FISH_TUMBLE_PITCH_SPREAD);
    } else {
      sub.yawRate = -FISH_TUMBLE_YAW_BASE - f.rng.int(FISH_TUMBLE_YAW_SPREAD);
      sub.pitchRate = -f.rng.int(FISH_TUMBLE_PITCH_SPREAD);
    }
    sub.bobRate = FISH_FLUNG_BOB_RATE;
    sub.bobPhaseF = FISH_FLUNG_BOB_PHASE;
    sub.dy = FISH_FLUNG_BOB;
    sub.sinkY = obj.pos.y;
    sub.timer = 0;
  } else {
    obj.pos.y = G.g_water_level + FISH_DEATH_LIFT;
    FishSpawnWaterSplash(obj, 0.8, 1, f.events);
    ReleaseEnemyPresentCount(obj);
    sub.state = FishState.Sink;
    sub.frame = FishCorpseSlot(FISH_SUNK_SLOT);
    sub.bobRate = FISH_SINK_BOB_RATE;
    sub.bobPhaseF = 0;
    sub.dy = FISH_SINK_BOB;
    sub.sinkY = G.g_water_level + FISH_SINK_LIFT;
    sub.vx = FISH_SINK_DRIFT;
    sub.vz = -FISH_SINK_DRIFT;
    sub.yawStep = FISH_SINK_YAW_STEP;
    sub.yaw = f.rng.int(0x10000);
    sub.timer = 0;
    FishSpawnSurfaceRing(obj, 0.8);
  }

  obj.flags &= ~ActorFlag.Hit;
  SpawnFishBloodCloud(obj);
  obj.flags |= ActorFlag.NoCameraTrack;
  ReleaseEnemyAliveCount(obj);
  FishReleaseAttackPermit(obj);
  FishReleaseAttackSlot(sub);
}

// -- the update ------------------------------------------------------------

/**
 * `FishRunState` — `FUN_00438F10`. The six-arm switch on `sub+0x62`.
 *
 * State 2 is the only arm with two calls: the movement and then the bite test,
 * in that order, so a fish that arrives on this frame bites on this frame.
 */
export function FishRunState(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (sub.swimAway) { FishSwimAwayTick(obj); return; }
  switch (sub.state) {
    case FishState.Rise: FishStateRise(obj); return;
    case FishState.Bob: FishStateBob(obj, f); return;
    case FishState.Lunge:
      FishStateLunge(obj, f);
      FishLungeTestBite(obj, f);
      return;
    case FishState.FallBack: FishStateFallBack(obj); return;
    case FishState.Flung: FishStateFlung(obj, f); return;
    case FishState.Sink: FishStateSink(obj, f); return;
  }
}

/**
 * `FishUpdate` — `FUN_00438730`.
 *
 * ```c
 * g_cur_actor = obj;
 * FishCheckShot(obj);          // FUN_00438C10
 * FishRunState(obj);           // FUN_00438F10
 * FishDraw(obj);               // FUN_00439860 — render/
 * FishProjectToScreen(obj);    // FUN_00439B50 — render/
 * FishRegisterForCameraTracking(obj);  // FUN_00439D70 — see the file's note
 * ```
 *
 * The shot is checked **before** the state runs, so the frame a fish is hit is
 * the frame its death state's first tick happens.
 */
export function FishUpdate(obj: Actor, f: ClassFrame): void {
  FishCheckShot(obj, f);
  FishRunState(obj, f);
}

/**
 * `SpawnFishAt` — `FUN_00438640`. The stage-2 boss's two summoning rounds.
 *
 * A fish with no descriptor: the caller gives it a point, a lifetime for
 * `sub+0x7E` and a sub-type, and it goes **straight into a lunge** —
 * `FishClaimSlotAndLunge` rather than `FishBeginRise`, so it has no rise and
 * no bob at all.
 *
 * ```c
 * if (g_players_in_play == 0) return;
 * if (0 < g_players_in_play && g_players_in_play < 3)
 *     for (i = 0; i < 4; i++) if (g_water_attack_slots[i]) return;
 * g_water_level = -24.9;
 * obj = ActorAlloc(FishUpdate, 0x1314);  ActorClearGameFields(obj);
 * obj->+0x3C = -1;  obj->+0x124 = 2.1;
 * sub = ActorAllocSub(0x84);
 * obj->pos = (x, y, z);  obj->+0x1310 = sub;
 * sub->+0x6C = subtype;  sub->+0x7E = lifetime ? lifetime : 0x50;
 * sub->home = obj->pos;
 * g_enemies_alive++;  g_enemies_present++;
 * obj->+0x121 = -1;  obj->+0x120 = -1;  RegisterEnemySlot(obj);
 * FishClaimSlotAndLunge(obj);
 * ```
 *
 * Two things worth keeping straight. It **refuses while any one of the four
 * slots is taken**, not while all four are — that is what paces a round, and
 * it is why `Class14StateSummonRoundA` can call it every frame and get one
 * fish at a time. And it **writes the water level itself**, to the same -24.9
 * a group header would, so the boss arena's surface does not depend on which
 * descriptors ran before it.
 */
export function SpawnFishAt(x: number, y: number, z: number, lifetime: number,
                            subtype: number, rng: Rng, host?: GameHost):
                            Actor | null {
  if (G.g_players_in_play === 0) return null;
  if (G.g_players_in_play > 0 && G.g_players_in_play < 3) {
    for (let i = 0; i < FISH_ATTACK_SLOTS; i += 1) {
      if (G.g_water_attack_slots[i] !== 0) return null;
    }
  }
  G.g_water_level = FISH_SUMMON_WATER_LEVEL;
  const at = G.g_summoned_actor_at;
  G.g_summoned_actor_at -= 1;
  // No `init`: this routine is the Init. `ActorSpawn` would run `FishInit`,
  // which is the *descriptor* path and would read a tail that does not exist.
  const obj = ActorSpawn(at, SpawnClass.WaterEnemy, -1, "fish", {
    pos: vec3(x, y, z),
  }, rng);
  const sub = Tail(obj);
  if (!sub) return obj;
  obj.hitRadius = FISH_HIT_RADIUS;
  sub.subtype = subtype;
  sub.lungeFrames = lifetime !== 0 ? lifetime : FISH_SUMMON_LIFETIME;
  sub.homeX = x;
  sub.homeY = y;
  sub.homeZ = z;
  sub.frame = FISH_FIRST_SLOT;
  sub.firstFrame = FISH_FIRST_SLOT;
  sub.lastFrame = FISH_LAST_SLOT;
  sub.alpha = 1;
  G.g_enemies_alive += 1;
  G.g_enemies_present += 1;
  obj.attackPermit = -1;
  obj.visible = true;
  FishClaimSlotAndLunge(obj, rng, host);
  return obj;
}

// -- the class -------------------------------------------------------------

const handler: ClassHandler = {
  init: FishInit,
  update: FishUpdate,
  updatesWhenDead: true,
  ownsShotResult: true,
  leave(obj: Actor): void {
    const sub = Tail(obj);
    ReleaseEnemyAliveCount(obj);
    ReleaseEnemyPresentCount(obj);
    FishReleaseAttackPermit(obj);
    if (sub) FishReleaseAttackSlot(sub);
    ActorDespawn(obj);
  },
  onDeadSweep(obj: Actor): void {
    const sub = Tail(obj);
    ReleaseEnemyAliveCount(obj);
    ReleaseEnemyPresentCount(obj);
    FishReleaseAttackPermit(obj);
    if (sub) FishReleaseAttackSlot(sub);
  },
  debug(obj: Actor): ActorDebug {
    const sub = Tail(obj);
    if (!sub) return { summary: "fish" };
    return {
      summary: `${FishState[sub.state]}/${sub.timer}`,
      detail: [
        `sub-type ${sub.subtype} · slot ${sub.slot} · permit ${obj.attackPermit}`,
        `cycle ${sub.bobCycle}/${sub.bobCycles} · frame 0x${sub.frame.toString(16)}`,
      ],
      hot: sub.slot !== -1,
    };
  },
};

registerClass(SpawnClass.WaterEnemy, handler);

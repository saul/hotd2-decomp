/**
 * Class 0x42 — **the worm**.
 *
 * `PlaceWormBatch` (`FUN_0042F9B0`) is a placer with three sub-types
 * ({@link WormSubtype}), and every shipped spawn is stage 2's. At block 21's
 * cog, one instruction places sub-type 1 -- a single worm, not counted, that
 * drops from high up past the camera -- and sub-type 0, six worms (eight with
 * two players) that **ride the cog**: in block `0x15` each circles the point
 * `(-924, -1336)` at a radius of its index plus five, and when its own delay
 * runs out it lets go and falls. At block 26 sub-type 2 drops ten or fifteen
 * the same way with no cog to ride.
 *
 * A member that lands splats, crawls toward the camera and waits, wobbling
 * and turning to face it. One at a time -- the member `g_worm_leaper` names --
 * swells and leaps at the camera, takes a life off the player it picked if it
 * is not shot first, and bounces away. Each counts in both enemy counters
 * from the moment it is placed, so the `wait_enemies_alive` behind each batch
 * is a room you have to clear. One bullet kills one (`ActorFlag.Hit` is the
 * whole damage model; nothing reads `obj+0x11C`), and pays 80.
 *
 * A worm shot **before it has landed** -- on the cog or falling -- splits: its
 * death draws two halves that fall along motions `0xBF` and `0xC0` and splash
 * where they land. One shot after it has landed melts into the death strip
 * instead.
 *
 * ## Four routines behind one class id
 *
 * The placer installs `WormUpdate` (`FUN_0042FCA0`) on the batch's members and
 * `WormLoneDropUpdate` (`FUN_00431000`) on sub-type 1's worm, and the kill
 * swaps a member's routine for `WormDeathUpdate` (`FUN_00430C80`). The port
 * has one handler per class, so the routine a worm runs is a field
 * ({@link WormRoutine}) and {@link WormClassUpdate} dispatches on it.
 *
 * ## Drawn from the tail
 *
 * Every draw is an `AssetDrawSlot` out of `buyo.bin`, under a matrix each
 * routine builds for itself. The routines write down what they drew
 * ({@link WormTail.drawnBody}, `drawnStrip`, `drawnHalves`) and
 * `render/worm.ts` composes the same products.
 */
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { Class42Json } from "../../bundle";
import { ActorFlag, type Actor } from "../actor";
import { CameraSlotVacate, RegisterEnemySlot, RegisterForCameraTracking }
  from "../camera/slots";
import { CameraBlockEye } from "../camera/view";
import { SpawnHordeDeathSplash } from "../class40/splash";
import { ReleaseEnemyAliveCount, ReleaseEnemyPresentCount }
  from "../combat/counts";
import { PlayerTakeDamage } from "../combat/player";
import { ScoreAddForPlayer } from "../combat/score";
import { RegisterForShotTest } from "../combat/shot_test";
import { ActorDespawn } from "../despawn";
import { SpawnBloodSprayAtPoint } from "../effects/blood";
import { G, PlayerState } from "../globals";
import { MatIdentity, MatrixRotateY, MatrixTransformPoint, RADIANS_TO_BAMS }
  from "../matrix";
import {
  registerClass, DeadSweep, type ActorDebug, type ClassFrame,
  type ClassHandler, type SpawnRecord,
} from "../registry";
import { ActorSpawn } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { T } from "../tables";
import { vec3, type Vec3 } from "../vec";
import {
  WormBodyDraw, WormFlag, WormRoutine, WormState, WormSubtype,
  type WormHalfDraw, type WormTail,
} from "./state";

export * from "./state";

// -- what the routines spell as literals -------------------------------------

/** `SETG`/`DEC`/`AND`/`ADD` at `0x0042F9C4`: sub-type 0 makes six, or eight with two players. */
export const WORM_COUNT_ON_COG_1P = 6;
export const WORM_COUNT_ON_COG_2P = 8;
/** ...and at `0x0042F9E3`, sub-type 2 ten or fifteen. */
export const WORM_COUNT_LARGE_1P = 10;
export const WORM_COUNT_LARGE_2P = 15;
/** `FMUL float ptr [0x0055D230]` -- the offset tables are in tenths. */
export const WORM_OFFSET_UNIT = 0.1;
/** `MOV dword ptr [ESI + 0x64], 0x4000` -- a member starts pitched a quarter turn. */
export const WORM_START_PITCH = 0x4000;
/** `obj+0x124 = 0x400CCCCD` -- a member's shot sphere. */
export const WORM_HIT_RADIUS = 2.2;
/** `obj+0x124 = 0x40400000` -- the lone drop's. */
export const WORM_LONE_HIT_RADIUS = 3.0;
/** `rand() % 0x3C` into `obj+0x1E8` at `0x0042FB74`. */
export const WORM_FRAME_SEED_RANGE = 0x3c;
/** `ADD EAX, 0x7800` -- the orbit angle's bias over `g_worm_orbit_phase`. */
export const WORM_ORBIT_BIAS = 0x7800;
/** `ScoreAddForPlayer(player, 0x50)`. */
export const WORM_SCORE = 0x50;
/**
 * `rand()`'s range. Sub-type 1 divides the draw by the object's own address,
 * which is larger, so the remainder is the draw.
 */
export const WORM_RAND_RANGE = 0x8000;
/** `PlaySoundId(0x3619A9)` -- `STAGE2_SE\WORM_TUBU1_44.wav`, on an odd draw. */
export const SND_WORM_KILLED_A = 0x3619a9;
/** `PlaySoundId(0x3719A9)` -- `STAGE2_SE\WORM_TUBU2_44.wav`, on an even one. */
export const SND_WORM_KILLED_B = 0x3719a9;
/** The landing in scene 0: `STAGE1_SE\PDMG_MORR1_44.wav` / `PDMG_MORR2_44.wav`. */
export const SND_WORM_LAND_S1_A = 0x1d18a9;
export const SND_WORM_LAND_S1_B = 0x1e18a9;
/** ...and anywhere else: `STAGE2_SE\PDMG_MORR1_44.wav` / `PDMG_MORR2_44.wav`. */
export const SND_WORM_LAND_A = 0x2019a9;
export const SND_WORM_LAND_B = 0x2119a9;
/** `CMP word ptr [0x009A2BC0], 0x15` -- the cog's block. */
export const WORM_COG_BLOCK = 0x15;
/** `FSUB float ptr [0x0055D7C8]` / `[0x0055D7C4]` -- the cog's centre, `x - 924`, `z - 1336`. */
export const WORM_COG_X = 924.0;
export const WORM_COG_Z = 1336.0;
/** `FADD float ptr [0x0055D2B4]` -- the orbit's radius is the index plus five. */
export const WORM_ORBIT_RADIUS = 5.0;
/** `ADD EAX, -0x80` -- the cog's turn a frame. */
export const WORM_ORBIT_STEP = 0x80;
/** `FSUB float ptr [0x0055D7C0]` -- the fall's gravity. */
export const WORM_FALL_GRAVITY = 0.016330000013113022;
/** `FADD double ptr [0x0055D7B8]` -- it has landed below the ground plus this... */
export const WORM_LAND_TEST = 3.5699998855590818;
/** `FADD float ptr [0x004C43A8]` -- ...and is put at the ground plus this. */
export const WORM_LAND_Y = 0.800000011920929;
/** `CMP EAX, 0x18` -- the splat's last frame. */
export const WORM_SPLAT_LAST = 0x18;
/** `MOV word ptr [ESI + 0x1E8], 0x8` -- the crawl's first row. */
export const WORM_CRAWL_FIRST_ROW = 8;
/** `CMP EAX, 0x3B` -- the crawl's rows, and the row it stops at. */
export const WORM_CRAWL_ROWS = 0x3b;
/** `0x3F4CCCCD` on the cog, `0x3E99999A` elsewhere -- how much of each step and swell it takes. */
export const WORM_CRAWL_K_COG = 0.800000011920929;
export const WORM_CRAWL_K = 0.30000001192092896;
/** `FMUL float ptr [0x004D5464]` -- hundredths. */
export const WORM_HUNDREDTH = 0.009999999776482582;
/** `FMUL double ptr [0x004E3108]` -- the crawl step's scale, and the draw's. */
export const WORM_SIX_TENTHS = 0.6;
/** `FMUL float ptr [0x0055D7B4]` -- ten-thousandths. */
export const WORM_TEN_THOUSANDTH = 0.00009999999747378752;
/** `ADD EDI, 0x800` -- the wobble's step. */
export const WORM_WOBBLE_STEP = 0x800;
/** `FMUL [0x004C43AC]` 0.5, `FADD [0x0055D7B0]` 1.25 and `[0x004C4380]` 1.0 -- the wobble's swell. */
export const WORM_WOBBLE_AMP = 0.5;
export const WORM_WOBBLE_XZ = 1.25;
export const WORM_WOBBLE_Y = 1.0;
/** `FMUL float ptr [0x004C4C58]` -- a quarter of the way there a frame. */
export const WORM_WOBBLE_EASE = 0.25;
/** `IMUL 0x66666667; SAR 2` -- a tenth of the turn a frame. */
export const WORM_TURN_DIVISOR = 10;
/** `CMP EAX, 0xA` -- the leaper swells for ten frames. */
export const WORM_SWELL_FRAMES = 0xa;
/** `FMUL float ptr [0x0055D230]` -- a tenth of the swell a frame. */
export const WORM_SWELL_RATE = 0.10000000149011612;
/** `CMP dword ptr [0x009C6F08], 0x2` -- the leap needs the path camera. */
export const WORM_LEAP_SCENE_MAJOR = 2;
/** `CMP ECX, 0x1F` -- the leap's path starts at its row `0x20`. */
export const WORM_LEAP_PATH_FIRST = 0x20;
/** `CMP word ptr [ESI + 0x1E8], 0x3A` -- the pitch follows the path to here. */
export const WORM_LEAP_PITCH_LAST = 0x3a;
/** `CMP AX, 0x3C` -- the leap's length. */
export const WORM_LEAP_FRAMES = 0x3c;
/** `FMUL double ptr [0x0055D7A8]` -- the reach, per unit of range. */
export const WORM_LEAP_REACH_SCALE = 0.016179848047500653;
/** `FADD float ptr [0x004C4CA0]` -- the height the leap rises to, over the eye. */
export const WORM_LEAP_EYE_LIFT = 4.0;
/** `FMUL float ptr [0x0055D7A0]` -- the rise, per unit of that height. */
export const WORM_LEAP_RISE_SCALE = 0.06867990642786026;
/** `PlayerTakeDamage(player, 1, 9)`. */
export const WORM_DAMAGE_KIND = 9;
/** `FMUL [0x0055D79C]` -5.0 and `FMUL [0x004C43A4]` 10.0 -- the bounce off its last move. */
export const WORM_BOUNCE_XZ = -5.0;
export const WORM_BOUNCE_Y = 10.0;
/** `FSUB float ptr [0x0055CB10]` -- the bounce's gravity, the corpse's and the lone drop's. */
export const WORM_GRAVITY = 0.027219999581575394;
/** `ADD dword ptr [ESI + 0x64], 0x600` -- the bounce's tumble. */
export const WORM_BOUNCE_TUMBLE = 0x600;
/** `FADD float ptr [0x0055D7B0]` -- the shot sphere sits this far up. */
export const WORM_SHOT_LIFT = 1.25;
/** `FMUL float ptr [0x004C4CC0]` -- a splash per member, a hundredth apart. */
export const WORM_SPLASH_STAGGER = 0.009999999776482582;
/** `FADD float ptr [0x004C4380]` -- a unit above the ground. */
export const WORM_SPLASH_LIFT = 1.0;
/** `PUSH 0x3F800000` -- the splash's size. */
export const WORM_SPLASH_SIZE = 1.0;
/** `FSUB float ptr [0x004C4CB0]` -- a corpse or a landed half sinks this much a frame. */
export const WORM_SINK = 0.02500000037252903;
/** `CMP AX, 0x15` -- the death strip's last frame. */
export const WORM_DEATH_LAST = 0x15;
/** `CMP EAX, 0x3C` -- the death routine's life. */
export const WORM_DEATH_LIFE = 0x3c;
/** The halves' motions, `PUSH 0xBF` and `PUSH 0xC0`. */
export const WORM_HALF_MOTIONS: readonly number[] = [0xbf, 0xc0];
/** `CMP AX, 0x3B` -- each half's last frame. */
export const WORM_HALF_LAST = 0x3b;
/** `FADD double ptr [0x0055D7D0]` -- a half lands at the ground plus this. */
export const WORM_HALF_LAND = 1.5;
/** `FMUL float ptr [0x004E30E0]` -- the two halves' splashes, half a hundredth apart. */
export const WORM_HALF_SPLASH_STAGGER = 0.004999999888241291;
/** `MOV [ESI + 0x21C], 0xBFA9F8A1` -- half 0's pull, once its track has run out. */
export const WORM_SINK_START = -1.3279000520706177;
/** `FSUB float ptr [0x0055D7D8]` -- and what it gains a frame. */
export const WORM_SINK_GRAVITY = 0.010300000198185444;
/** `FCOMP float ptr [0x0055CCD4]` -- the lone drop is gone below this. */
export const WORM_LONE_FLOOR = 30.0;

// -- helpers -----------------------------------------------------------------

function Tail(obj: Actor): WormTail | null {
  return (obj as Actor & { worm?: WormTail }).worm ?? null;
}

/**
 * `[port-only]` -- the bundle's `characters.class42`. A member exists only
 * where the placer found it, so every routine below may assume it.
 */
function Tables(): Class42Json | null {
  return T.chars?.class42 ?? null;
}

function play(events: Events | undefined, id: number): void {
  events?.emit("sound.play", { id });
}

function s16(v: number): number {
  return (v << 16) >> 16;
}

function s8(v: number): number {
  return (v << 24) >> 24;
}

/**
 * `ftol(atan2(obj.x - eye.x, obj.z - eye.z) * 10430.378)`, as a short --
 * `FLD eye.x; FSUB x; FCHS; FLD eye.z; FSUB z; FCHS; FPATAN`, then `MOVSX
 * EAX, AX` on the `__ftol`: the heading from the camera block to the worm.
 */
function FaceFromEye(obj: Actor, eye: Vec3): number {
  return s16(Math.trunc(Math.atan2(-(eye.x - obj.pos.x),
                                   -(eye.z - obj.pos.z)) * RADIANS_TO_BAMS));
}

/**
 * `[port-only]` -- the placer's members take a derived address: bits 28 and
 * 29 together, which no other synthetic address sets both of, the member in
 * bits 20..23 and the placer's own address in the low twenty. The lone drop
 * takes member 15, which a batch of fifteen never reaches.
 */
export function WormMemberAt(placerAt: number, idx: number): number {
  return (WORM_AT_BITS | ((idx & 0xf) << 20) | (placerAt & 0xfffff)) >>> 0;
}

/** `[port-only]` -- {@link WormMemberAt}'s marker bits. */
export const WORM_AT_BITS = 0x30000000;
/** `[port-only]` -- the member slot of {@link WormMemberAt} the lone drop takes. */
export const WORM_LONE_SLOT = 0xf;

/**
 * `[port-only]` -- pick the next live member after `from`: `(from + 1) %
 * count`, stepping on while `g_worm_members` holds 0 there. The same six
 * instructions stand three times in `WormUpdate` -- the kill's re-pick (after
 * its random start), the leap's hand-over (`0x004308CC`) and the tail's
 * (`0x00430B1D`) -- and each is called from where its copy is.
 */
function NextLiveMember(from: number, count: number): number {
  let k = (from + 1) % count;
  while ((G.g_worm_members[k] ?? 0) === 0) k = (k + 1) % count;
  return k;
}

/**
 * `MotionFrameRecord` — `FUN_00412FB0`. `g_motion_slots[motion].base + 4 +
 * frame * 0x14`: one frame of a two-node effect-layout motion, its `(x, y,
 * z)` and then its `(rx, ry, rz)`.
 *
 * `[port-only]` in where it reads: the bundle carries only the two motions
 * its callers name, the halves' `0xBF` and `0xC0`, and a motion it does not
 * carry answers the origin.
 */
export function MotionFrameRecord(motion: number, frame: number):
    { t: [number, number, number]; r: [number, number, number] } {
  const h = Tables()?.halves.find((x) => x.motion === motion);
  const i = frame * 3;
  return {
    t: [h?.t[i] ?? 0, h?.t[i + 1] ?? 0, h?.t[i + 2] ?? 0],
    r: [h?.r[i] ?? 0, h?.r[i + 1] ?? 0, h?.r[i + 2] ?? 0],
  };
}

// -- the placer --------------------------------------------------------------

/**
 * `PlaceWormBatch` — `FUN_0042F9B0`. Class 0x42's handler, and a placer.
 *
 * ```c
 * switch (obj+0x130C) { case 0: n = players > 1 ? 8 : 6; break;
 *                       case 2: n = players > 1 ? 15 : 10; break; }
 * g_worm_live_count = 0;
 * g_worm_leaper = rand() % n;              // n is the object itself for 1
 * if (obj+0x130C == 1) { one WormLoneDropUpdate; ActorKill(); }
 * for (i = 0; i < n; i++) { one WormUpdate member; }
 * ActorKill();
 * ```
 *
 * Every member counts in **both** enemy counters (`0x0042FBBF`,
 * `0x0042FBC6`); the lone drop in neither.
 *
 * `[port-only]` A member or the lone drop is spawned with no descriptor --
 * the engine allocates them with their routine and no `Init` -- and returns on
 * that. A sub-type past 2 falls through the engine's `switch` with the count
 * still holding the object's address and would allocate until the pool ran
 * out; none ships (the three are 1, 0 and 2), and the port builds nothing.
 * And a bundle without the class's tables builds nothing.
 */
export function PlaceWormBatch(obj: Actor, rng?: Rng): void {
  const p = obj.class42;
  if (!p) return;
  const tb = Tables();
  if (!tb) {
    ActorDespawn(obj);
    return;
  }
  const subtype = p.subtype as WormSubtype;
  let n = 0;
  if (subtype === WormSubtype.OnCog) {
    n = G.g_players_in_play > 1 ? WORM_COUNT_ON_COG_2P : WORM_COUNT_ON_COG_1P;
  } else if (subtype === WormSubtype.Large) {
    n = G.g_players_in_play > 1 ? WORM_COUNT_LARGE_2P : WORM_COUNT_LARGE_1P;
  }
  G.g_worm_live_count = 0;
  // `rand() % n` into a byte. For sub-type 1 the divisor is the placer's own
  // address, so the byte is the draw's low eight.
  G.g_worm_leaper = n > 0 ? (rng?.int(n) ?? 0)
    : s8(rng?.int(WORM_RAND_RANGE) ?? 0);

  if (subtype === WormSubtype.LoneDrop) {
    const m = ActorSpawn(WormMemberAt(obj.at, WORM_LONE_SLOT), SpawnClass.Worm,
                         -1, "worm", { visible: true }, rng);
    const t = Tail(m);
    if (t) {
      t.routine = WormRoutine.LoneDrop;
      m.flags = 1;
      m.pos = vec3(obj.pos.x, obj.pos.y, obj.pos.z);
      m.yaw = obj.yaw;
      m.hitRadius = WORM_LONE_HIT_RADIUS;
      t.state = WormState.Fall;
    }
    ActorDespawn(obj);
    return;
  }
  if (n === 0) {
    ActorDespawn(obj);
    return;
  }

  const offs = subtype === WormSubtype.OnCog ? tb.offsets_6_8
    : tb.offsets_10_15;
  for (let i = 0; i < n; i += 1) {
    const m = ActorSpawn(WormMemberAt(obj.at, i), SpawnClass.Worm, -1, "worm",
                         { visible: true }, rng);
    const t = Tail(m);
    if (!t) continue;
    t.routine = WormRoutine.Member;
    m.flags = 1;
    m.hp = 1;
    t.idx = i;
    t.count = n;
    m.pos = vec3((offs[i * 2] ?? 0) * WORM_OFFSET_UNIT + obj.pos.x,
                 obj.pos.y,
                 (offs[i * 2 + 1] ?? 0) * WORM_OFFSET_UNIT + obj.pos.z);
    m.pitch = WORM_START_PITCH;
    m.yaw = (tb.yaw_offsets[i] ?? 0) + obj.yaw;
    // `+0x1D4` and `+0x1DC` are zeroed here and read by nothing in the class.
    t.scale = { x: 1, y: 1, z: 1 };
    m.hitRadius = WORM_HIT_RADIUS;
    t.state = WormState.Perch;
    t.frame = rng?.int(WORM_FRAME_SEED_RANGE) ?? 0;
    t.timer = 0;
    t.ground = G.g_camera_fixed_eye_y;
    t.orbit = (tb.orbit_phase[i] ?? 0) + WORM_ORBIT_BIAS;
    m.cameraSlot = -1;
    RegisterEnemySlot(m);
    G.g_enemies_present += 1;
    G.g_enemies_alive += 1;
    G.g_worm_live_count += 1;
    G.g_worm_members[i] = m.at;
  }
  ActorDespawn(obj);
}

// -- the member --------------------------------------------------------------

/**
 * `WormPickLeapTarget` — `FUN_0042FC00`. The leaper's launch: where it starts
 * from, the counters it runs on, and the player it is going for.
 *
 * With two players the target is `rand() % 2` and the yaw leans `0x400`
 * toward that player's side; with one it is `g_active_player` when that is 0
 * or 1, and whatever `obj+0x121` already held otherwise.
 */
export function WormPickLeapTarget(obj: Actor, rng: Rng): void {
  const t = Tail(obj);
  if (!t) return;
  t.leapFrom = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
  t.timer = 0;
  t.frame = 0;
  t.yawBias = 0;
  if (G.g_players_in_play === 2) {
    t.target = rng.int(2);
    t.yawBias = t.target * 0x800 - 0x400;
  } else {
    if (G.g_active_player === 0) t.target = 0;
    if (G.g_active_player === 1) t.target = 1;
  }
}

/**
 * The head of `0x0042FCA0`: the kill, `0x0042FCC9`..`0x0042FEE6`.
 *
 * `[port-only]` as a function; the routine has it inline, ahead of its state
 * switch, and this is called from there.
 *
 * The blood goes at the point the last frame's registration left in
 * `obj+0x70` -- `SpawnBloodSprayAtPoint` is handed `obj+0x40` and reads `0x30`
 * past it -- which is in view space; the port keeps that point in world space
 * and the host's camera takes it across.
 *
 * `+0x54 = -0.15`, `+0x1F4 = 0`, `+0x1F8 = 0.3` and `+0x1FC = 0` are written
 * here and read by neither this routine nor the death routine it installs, so
 * the port has no fields for them.
 */
function WormTakeKill(obj: Actor, t: WormTail, f: ClassFrame): void {
  const at = vec3();
  f.host.viewSpaceOfPoint?.(obj.shotCentre, at);
  SpawnBloodSprayAtPoint(at);
  // `DEC word ptr` on both, and the latches make them the engine's one
  // decrement each whichever route reaches them first.
  ReleaseEnemyAliveCount(obj);
  ReleaseEnemyPresentCount(obj);
  G.g_worm_members[t.idx] = 0;
  play(f.events, f.rng.int(2) !== 0 ? SND_WORM_KILLED_A : SND_WORM_KILLED_B);
  const byP0 = (obj.flags & ActorFlag.HitByPlayer0) !== 0;
  const byP1 = (obj.flags & ActorFlag.HitByPlayer1) !== 0;
  const who = byP0 && byP1 ? f.rng.int(2) : byP0 ? 0 : 1;
  ScoreAddForPlayer(who, WORM_SCORE, f.events);
  G.g_player_hit_count[who] = (G.g_player_hit_count[who] ?? 0) + 1;
  t.frame = 0;
  t.ground = G.g_camera_fixed_eye_y;
  if (t.state === WormState.Perch || t.state === WormState.Fall) {
    // Shot before it landed: it splits, and each half's height starts where
    // its motion's first frame puts it.
    obj.flags |= WormFlag.Split;
    t.halfY[0] = MotionFrameRecord(WORM_HALF_MOTIONS[0]!, 0).t[1] + obj.pos.y;
    t.halfY[1] = MotionFrameRecord(WORM_HALF_MOTIONS[1]!, 0).t[1] + obj.pos.y;
  } else {
    if (t.state === WormState.Leap) obj.flags |= WormFlag.ShotMidLeap;
    SpawnHordeDeathSplash(obj, obj.pos.x,
                          t.idx * WORM_SPLASH_STAGGER + t.ground
                            + WORM_SPLASH_LIFT,
                          obj.pos.z, WORM_SPLASH_SIZE, f.events);
  }
  t.state = WormState.Dead;
  t.timer = 0;
  t.halfFrame = [0, 0];
  t.deathVy = 0;
  obj.pitch = 0;
  G.g_worm_live_count -= 1;
  obj.flags |= ActorFlag.NoCameraTrack;
  CameraSlotVacate(obj);
  if (G.g_worm_live_count > 0) {
    let k = f.rng.int(t.count);
    while ((G.g_worm_members[k] ?? 0) === 0) k = (k + 1) % t.count;
    G.g_worm_leaper = k;
  }
  t.routine = WormRoutine.Death;
}

/**
 * `WormUpdate` — `FUN_0042FCA0`. A member of the batch, every frame.
 *
 * It writes itself into `g_worm_members`, takes a kill if it has one, runs
 * its state ({@link WormState}; the jump table at `0x00430B68` has seven
 * arms and each ends at `0x00430022`), draws, and then -- the tail at
 * `0x00430A6B` -- lets the camera track it only if it is the leaper, records
 * where it is, registers for the shot test and the camera, and moves the
 * leaper on if that member has gone.
 *
 * The camera it faces and leaps at is the block `g_camera_index` names
 * (`[g_camera_index * 0x1A4 + 0x9A60C0]`, at `0x00430464`, `0x004305CE`,
 * `0x0043061E` and `0x004306B1`).
 */
export function WormUpdate(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  const tb = Tables();
  if (!t || !tb) return;
  G.g_worm_members[t.idx] = obj.at;
  t.drawnBody = WormBodyDraw.None;
  t.drawnStrip = -1;
  t.drawnHalves = [];
  if (t.state !== WormState.Dead && (obj.flags & ActorFlag.Hit)) {
    WormTakeKill(obj, t, f);
  }

  switch (t.state) {
    case WormState.Perch: {
      if (G.g_evt_block_index === WORM_COG_BLOCK) {
        // `FILD; FMUL double; FSIN` with no store between: the double angle.
        const a = t.orbit * BAMS_TO_RAD_F64;
        t.orbit -= WORM_ORBIT_STEP;
        obj.pos.x = (t.idx + WORM_ORBIT_RADIUS) * Math.sin(a) - WORM_COG_X;
        obj.pos.z = (t.idx + WORM_ORBIT_RADIUS) * Math.cos(a) - WORM_COG_Z;
      }
      t.timer += 1;
      if (t.timer > (tb.drop_delay[t.idx] ?? 0)) {
        t.timer = 0;
        t.state = WormState.Fall;
      }
      break;
    }
    case WormState.Fall: {
      t.vy -= WORM_FALL_GRAVITY;
      obj.pos.y += t.vy;
      if (t.ground + WORM_LAND_TEST > obj.pos.y) {
        obj.pos.y = t.ground + WORM_LAND_Y;
        obj.pitch = 0;
        t.timer = 0;
        t.state = WormState.Splat;
        const odd = f.rng.int(2) !== 0;
        if (G.g_scene_index === 0) {
          play(f.events, odd ? SND_WORM_LAND_S1_A : SND_WORM_LAND_S1_B);
        } else {
          play(f.events, odd ? SND_WORM_LAND_A : SND_WORM_LAND_B);
        }
      }
      break;
    }
    case WormState.Splat: {
      t.timer += 1;
      if (t.timer > WORM_SPLAT_LAST) {
        t.frame = WORM_CRAWL_FIRST_ROW;
        t.state = WormState.Crawl;
        t.phase = 0;
      }
      break;
    }
    case WormState.Crawl: {
      const k = G.g_evt_block_index === WORM_COG_BLOCK ? WORM_CRAWL_K_COG
        : WORM_CRAWL_K;
      const i = t.frame;
      if (i < WORM_CRAWL_ROWS) {
        const d = ((tb.crawl_steps[i + 1] ?? 0) * WORM_HUNDREDTH
                   - (tb.crawl_steps[i] ?? 0) * WORM_HUNDREDTH) * WORM_SIX_TENTHS;
        // `Push; LoadIdentity; RotateY(yaw); TransformPoint((0, 0, d))`.
        const m = MatIdentity();
        MatrixRotateY(m, obj.yaw);
        const step = vec3();
        MatrixTransformPoint(m, vec3(0, 0, d), step);
        obj.pos.x = step.x * k + obj.pos.x;
        obj.pos.z = step.z * k + obj.pos.z;
        t.scale.x = ((tb.crawl_scale[i * 3] ?? 0) * WORM_TEN_THOUSANDTH - 1.0) * k + 1.0;
        t.scale.y = ((tb.crawl_scale[i * 3 + 1] ?? 0) * WORM_TEN_THOUSANDTH - 1.0) * k + 1.0;
        t.scale.z = ((tb.crawl_scale[i * 3 + 2] ?? 0) * WORM_TEN_THOUSANDTH - 1.0) * k + 1.0;
      }
      t.frame = s16(i + 1);
      if (t.frame >= WORM_CRAWL_ROWS) {
        // On the cog it crawls the table twice, the second time from row 0.
        if (G.g_evt_block_index === WORM_COG_BLOCK && t.phase === 0) {
          t.phase = 1;
          t.frame = 0;
        } else {
          t.timer = 0;
          t.state = WormState.Wait;
          t.base = { x: t.scale.x, y: t.scale.y, z: t.scale.z };
        }
      }
      break;
    }
    case WormState.Wait: {
      t.phase += WORM_WOBBLE_STEP;
      const a = t.phase * BAMS_TO_RAD_F64;
      const s = Math.sin(a) * WORM_WOBBLE_AMP + WORM_WOBBLE_XZ;
      t.scale.x = (s - t.base.x) * WORM_WOBBLE_EASE + t.base.x;
      t.scale.y = (Math.cos(a) * WORM_WOBBLE_AMP + WORM_WOBBLE_Y - t.base.y)
        * WORM_WOBBLE_EASE + t.base.y;
      t.scale.z = (s - t.base.z) * WORM_WOBBLE_EASE + t.base.z;
      // A tenth of the way round to face the camera, in sixteen bits: the
      // yaw is masked as it is stored, and the difference wrapped to a half
      // turn either way.
      const yaw = obj.yaw & 0xffff;
      let d = (FaceFromEye(obj, CameraBlockEye(G.g_camera_index))
               + t.yawBias - yaw) & 0xffff;
      if (d > 0x8000) d -= 0x10000;
      obj.yaw = Math.trunc(d / WORM_TURN_DIVISOR) + yaw;
      if (G.g_worm_leaper === t.idx
          && G.g_scene_state_major_entered === WORM_LEAP_SCENE_MAJOR
          && G.g_players_in_play > 0) {
        const n = t.timer;
        t.timer = n + 1;
        t.scale.x = ((tb.leap_scale[0] ?? 0) * WORM_TEN_THOUSANDTH - t.base.x)
          * n * WORM_SWELL_RATE + t.base.x;
        t.scale.y = ((tb.leap_scale[1] ?? 0) * WORM_TEN_THOUSANDTH - t.base.y)
          * n * WORM_SWELL_RATE + t.base.y;
        t.scale.z = ((tb.leap_scale[2] ?? 0) * WORM_TEN_THOUSANDTH - t.base.z)
          * n * WORM_SWELL_RATE + t.base.z;
        if (t.timer >= WORM_SWELL_FRAMES) {
          WormPickLeapTarget(obj, f.rng);
          t.timer = 0;
          const eye = CameraBlockEye(G.g_camera_index);
          t.state = WormState.Leap;
          obj.yaw = FaceFromEye(obj, eye) + t.yawBias;
          t.range = Math.sqrt((eye.x - obj.pos.x) * (eye.x - obj.pos.x)
                              + (eye.z - obj.pos.z) * (eye.z - obj.pos.z));
        }
      }
      break;
    }
    case WormState.Leap: {
      const i = t.frame;
      if (i > WORM_LEAP_PATH_FIRST - 1) {
        const row = (i - WORM_LEAP_PATH_FIRST) * 2;
        const rise = tb.leap_path[row] ?? 0;
        const reach = tb.leap_path[row + 1] ?? 0;
        const a = obj.yaw * BAMS_TO_RAD_F64;
        obj.pos.x = reach * WORM_HUNDREDTH * Math.sin(a) * t.range
          * WORM_LEAP_REACH_SCALE + t.leapFrom.x;
        let h = CameraBlockEye(G.g_camera_index).y + WORM_LEAP_EYE_LIFT
          - t.leapFrom.y;
        if (h < 0) h *= -1.0;
        obj.pos.y = h * WORM_LEAP_RISE_SCALE * (rise * WORM_HUNDREDTH)
          * WORM_SIX_TENTHS + t.leapFrom.y;
        obj.pos.z = reach * WORM_HUNDREDTH * Math.cos(a) * t.range
          * WORM_LEAP_REACH_SCALE + t.leapFrom.z;
        if (t.frame < WORM_LEAP_PITCH_LAST) {
          // The pitch eases a quarter of the way onto the path's own slope.
          const dRise = (tb.leap_path[row + 2] ?? 0) * WORM_HUNDREDTH
            - rise * WORM_HUNDREDTH;
          const dReach = (tb.leap_path[row + 3] ?? 0) * WORM_HUNDREDTH
            - reach * WORM_HUNDREDTH;
          const slope = s16(Math.trunc(Math.atan2(dRise, -dReach)
                                       * RADIANS_TO_BAMS));
          obj.pitch = Math.trunc((slope - obj.pitch) / 4) + obj.pitch;
        }
        t.ground = G.g_camera_fixed_eye_y;
      }
      const j = t.frame;
      t.scale.x = (tb.leap_scale[j * 3] ?? 0) * WORM_TEN_THOUSANDTH;
      t.scale.y = (tb.leap_scale[j * 3 + 1] ?? 0) * WORM_TEN_THOUSANDTH;
      t.scale.z = (tb.leap_scale[j * 3 + 2] ?? 0) * WORM_TEN_THOUSANDTH;
      t.frame = s16(j + 1);
      if (t.frame >= WORM_LEAP_FRAMES) {
        if (G.g_player_state[t.target] === PlayerState.InPlay) {
          PlayerTakeDamage(t.target, 1, WORM_DAMAGE_KIND, f.events, obj);
        }
        t.vx = (obj.pos.x - t.last.x) * WORM_BOUNCE_XZ;
        t.vy = (obj.pos.y - t.last.y) * WORM_BOUNCE_Y;
        t.state = WormState.Bounce;
        obj.flags |= ActorFlag.NoCameraTrack;
        t.vz = (obj.pos.z - t.last.z) * WORM_BOUNCE_XZ;
        CameraSlotVacate(obj);
        if (G.g_worm_live_count > 0) {
          G.g_worm_leaper = NextLiveMember(t.idx, t.count);
        }
      }
      break;
    }
    case WormState.Bounce: {
      t.vy -= WORM_GRAVITY;
      obj.pitch += WORM_BOUNCE_TUMBLE;
      obj.pos.x += t.vx;
      obj.pos.y += t.vy;
      obj.pos.z += t.vz;
      if (obj.pos.y < t.ground) {
        obj.flags |= ActorFlag.NoCameraTrack;
        CameraSlotVacate(obj);
        ReleaseEnemyAliveCount(obj);
        ReleaseEnemyPresentCount(obj);
        G.g_worm_members[t.idx] = 0;
        if (G.g_worm_live_count > 0) G.g_worm_live_count -= 1;
        ActorDespawn(obj);
        return;
      }
      break;
    }
    default:
      // State 7 -- the kill -- has no arm: `JA 0x00430022` past the table.
      break;
  }

  // The draw, `0x00430022`..`0x00430A66`: skipped on odd frames of state 7,
  // which a member only reaches on the frame of its kill, at count 0.
  if (!(t.state === WormState.Dead && t.timer % 2 !== 0)) {
    t.drawnBody = WormBodyDraw.Member;
  }

  if (G.g_worm_leaper === t.idx) obj.flags &= ~ActorFlag.NoCameraTrack;
  else obj.flags |= ActorFlag.NoCameraTrack;
  t.last = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
  obj.lookAt.x = obj.pos.x;
  obj.lookAt.y = obj.pos.y;
  obj.lookAt.z = obj.pos.z;
  // `MatrixTransformPoint((x, y + 1.25, z), obj+0x70)` under the camera: the
  // port's point is in world space and `RegisterForShotTest` takes the depth.
  obj.shotCentre.x = obj.pos.x;
  obj.shotCentre.y = obj.pos.y + WORM_SHOT_LIFT;
  obj.shotCentre.z = obj.pos.z;
  RegisterForShotTest(obj, f.host);
  RegisterForCameraTracking(obj);
  if (G.g_worm_live_count > 0
      && (G.g_worm_members[G.g_worm_leaper] ?? 0) === 0) {
    G.g_worm_leaper = NextLiveMember(t.idx, t.count);
  }
}

// -- after the kill ----------------------------------------------------------

/** `[port-only]` -- one half's draw, as the routine read it. */
function HalfDraw(obj: Actor, t: WormTail, half: number,
                  rec: ReturnType<typeof MotionFrameRecord>,
                  landed: number): WormHalfDraw {
  return {
    half, landed, halfY: t.halfY[half]!,
    x: obj.pos.x, y: obj.pos.y, z: obj.pos.z, yaw: obj.yaw,
    t: [...rec.t], r: [...rec.r],
  };
}

/**
 * `WormDeathUpdate` — `FUN_00430C80`. A member after the kill; `WormUpdate`
 * installs it at `0x0042FEE6`.
 *
 * **Killed after it landed**: the corpse drops to the ground -- or, already
 * on it, sinks -- and draws the death strip, `0x87A + obj+0x1E8`, stepping to
 * frame `0x15` and holding.
 *
 * **Killed before it landed** ({@link WormFlag.Split}): two halves, each on
 * its own motion (`0xBF`, `0xC0`) a frame at a time to `0x3B`, turned by the
 * yaw the worm had. A half whose height falls under the ground plus 1.5 has
 * landed: it is put there, splashes (`SpawnHordeDeathSplash`, at its own x and
 * z), and sinks. When half 0's motion has run out, the pull `obj+0x21C` takes
 * the whole object down, which is what brings a half that ran out in the air
 * to the ground.
 *
 * Either way it despawns after sixty-two frames. It moves no counter -- the
 * kill did -- and registers for nothing, so a dead worm cannot be shot again.
 */
export function WormDeathUpdate(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  t.drawnBody = WormBodyDraw.None;
  t.drawnStrip = -1;
  t.drawnHalves = [];
  if (!(obj.flags & WormFlag.Split)) {
    if (obj.pos.y <= t.ground) {
      obj.pitch = 0;
      obj.pos.y -= WORM_SINK;
    } else {
      obj.pos.y += t.deathVy;
      t.deathVy -= WORM_GRAVITY;
    }
    t.drawnStrip = t.frame;
    if (t.frame < WORM_DEATH_LAST) t.frame += 1;
  } else {
    for (let i = 0; i < 2; i += 1) {
      const rec = MotionFrameRecord(WORM_HALF_MOTIONS[i]!, t.halfFrame[i]!);
      t.drawnHalves.push(HalfDraw(obj, t, i, rec, t.halfLanded[i]!));
      if (t.halfLanded[i] === 0 && t.halfFrame[i]! < WORM_HALF_LAST) {
        t.halfFrame[i] = t.halfFrame[i]! + 1;
      } else if (i === 0 && t.halfFrame[0] === WORM_HALF_LAST) {
        if (t.sink === 0.0) {
          t.sink = WORM_SINK_START;
        } else {
          t.sink -= WORM_SINK_GRAVITY;
          obj.pos.y += t.sink;
        }
      }
      if (rec.t[1] + obj.pos.y < t.ground + WORM_HALF_LAND) {
        if (t.halfLanded[i] === 0) {
          // `Push; LoadIdentity; RotateY(yaw); TransformPoint((t.x, 0, t.z))`.
          const m = MatIdentity();
          MatrixRotateY(m, obj.yaw);
          const off = vec3();
          MatrixTransformPoint(m, vec3(rec.t[0], 0, rec.t[2]), off);
          t.halfY[i] = t.ground + WORM_HALF_LAND;
          SpawnHordeDeathSplash(obj, off.x + obj.pos.x,
                                i * WORM_HALF_SPLASH_STAGGER
                                  + t.idx * WORM_SPLASH_STAGGER
                                  + G.g_camera_fixed_eye_y + WORM_SPLASH_LIFT,
                                off.z + obj.pos.z, WORM_SPLASH_SIZE, f.events);
          t.halfLanded[i] = 1;
        }
        t.halfY[i] = t.halfY[i]! - WORM_SINK;
      }
    }
  }
  const was = t.timer;
  t.timer = was + 1;
  if (was > WORM_DEATH_LIFE) ActorDespawn(obj);
}

/**
 * `WormLoneDropUpdate` — `FUN_00431000`. Sub-type 1's one worm.
 *
 * Whole, it falls from where it was placed and is gone below y 30, drawn as
 * `buyo.bin` 2 -- the splat's first frame -- turned by its yaw. Shot, it
 * splits into the same two halves the members' death draws, but never lands
 * them: each follows its motion to the end, and the object goes the frame
 * half 0 reaches it. It is in neither enemy counter, pays nothing and is no
 * camera candidate; it only registers for the shot test, at the placer's
 * three-unit sphere around its own origin.
 */
export function WormLoneDropUpdate(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  t.drawnBody = WormBodyDraw.None;
  t.drawnStrip = -1;
  t.drawnHalves = [];
  if (t.state !== WormState.Dead && (obj.flags & ActorFlag.Hit)) {
    t.state = WormState.Dead;
    t.halfY[0] = MotionFrameRecord(WORM_HALF_MOTIONS[0]!, 0).t[1] + obj.pos.y;
    t.halfY[1] = MotionFrameRecord(WORM_HALF_MOTIONS[1]!, 0).t[1] + obj.pos.y;
  }
  if (t.state !== WormState.Dead) {
    t.vy -= WORM_GRAVITY;
    obj.pos.y += t.vy;
    if (obj.pos.y < WORM_LONE_FLOOR) {
      ActorDespawn(obj);
      return;
    }
    t.drawnBody = WormBodyDraw.Lone;
  } else {
    for (let i = 0; i < 2; i += 1) {
      const rec = MotionFrameRecord(WORM_HALF_MOTIONS[i]!, t.halfFrame[i]!);
      // This routine has no landing: every half is drawn on its track.
      t.drawnHalves.push(HalfDraw(obj, t, i, rec, 0));
      if (t.halfFrame[i]! >= WORM_HALF_LAST) {
        ActorDespawn(obj);
        return;
      }
      t.halfFrame[i] = t.halfFrame[i]! + 1;
    }
  }
  obj.shotCentre.x = obj.pos.x;
  obj.shotCentre.y = obj.pos.y;
  obj.shotCentre.z = obj.pos.z;
  RegisterForShotTest(obj, f.host);
}

// -- the class ---------------------------------------------------------------

/**
 * `g_class_handlers[0x42]`.
 *
 * `[port-only]`: one entry for the routines the engine reaches through
 * `obj[0]` -- see {@link WormRoutine}. The placer runs as the `Init` and
 * despawns itself, so it never gets here.
 */
export function WormClassUpdate(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if (t.routine === WormRoutine.Member) WormUpdate(obj, f);
  else if (t.routine === WormRoutine.Death) WormDeathUpdate(obj, f);
  else if (t.routine === WormRoutine.LoneDrop) WormLoneDropUpdate(obj, f);
}

/**
 * `[port-only]` -- a replay's question, `ClassHandler.countsForEnemyGate`.
 * Per record, because the answer is the sub-type's: `PlaceWormBatch` raises
 * both counters for every member of sub-types 0 and 2 (`0x0042FBBF`,
 * `0x0042FBC6`, inside the loop) and the lone drop's arm raises neither.
 */
export function WormCountsForEnemyGate(rec: SpawnRecord): boolean {
  if (rec.at === undefined) return false;
  const p = T.chars?.placements?.find((q) => q.at === rec.at)?.class42;
  return !!p && p.subtype !== WormSubtype.LoneDrop;
}

/**
 * `[port-only]` -- what a member holds that the engine gives back on its two
 * ways out, the kill and the bounce: both counters (latched, so a member the
 * kill already released pays nothing), its member slot and its place in
 * `g_worm_live_count`. The port has routes out the engine does not.
 */
function WormGiveBack(obj: Actor, t: WormTail): void {
  if (t.routine !== WormRoutine.Member) return;
  ReleaseEnemyAliveCount(obj);
  ReleaseEnemyPresentCount(obj);
  if (G.g_worm_members[t.idx] === obj.at) {
    G.g_worm_members[t.idx] = 0;
    if (G.g_worm_live_count > 0) G.g_worm_live_count -= 1;
  }
}

const handler: ClassHandler = {
  init: PlaceWormBatch,
  update: WormClassUpdate,
  countsForEnemyGate: WormCountsForEnemyGate,
  ownsShotResult: true,
  registersForShotTest: true,
  leave(obj: Actor): void {
    const t = Tail(obj);
    if (t) WormGiveBack(obj, t);
    ActorDespawn(obj);
  },
  onDeadSweep(obj: Actor, why: DeadSweep): void {
    const t = Tail(obj);
    if (!t || why === DeadSweep.Unloaded) return;
    WormGiveBack(obj, t);
  },
  debug(obj: Actor): ActorDebug {
    const t = Tail(obj);
    if (!t) return { summary: "worm" };
    if (t.routine === WormRoutine.LoneDrop) {
      return { summary: `lone ${WormState[t.state]}`,
               detail: [`y ${obj.pos.y.toFixed(1)} vy ${t.vy.toFixed(3)}`] };
    }
    const who = t.routine === WormRoutine.Death ? "dead" : WormState[t.state];
    return {
      summary: `${who}/${t.timer}`,
      detail: [
        `member ${t.idx} of ${t.count} · frame ${t.frame}`,
        G.g_worm_leaper === t.idx ? "the leaper" : `leaper ${G.g_worm_leaper}`,
      ],
      hot: t.state === WormState.Leap,
    };
  },
};

registerClass(SpawnClass.Worm, handler);

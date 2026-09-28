/**
 * Class 0x43 — **the owl**.
 *
 * Two of the binary's name tables agree, independently. `OwlDrawBodyChain`
 * (`FUN_00447C20`) draws sixteen asset slots and every one lies in
 * `0x0BBD`..`0x0C26`, which `ExeTables.assetSlots()` resolves to **`owl.bin`**
 * entries 0 to 105 — nothing else in the image draws from that run. And the
 * death sound is `COMMON2\FUKUROU1_22.wav` or `FUKUROU2_22.wav`; *fukurō* is
 * Japanese for owl. The neighbouring `KOUMORI` records — *bat* — exist and
 * this class does not play them, which rules out the other obvious reading.
 * `docs/formats/spawns.md`'s `HABATAKI6` ("wing-flap") is real but it is the
 * **launch** cue, not an identification.
 *
 * A **flying one-hit enemy**: no hit points anywhere in the class, 80 points, a
 * sphere of radius 1.5, and one life if it reaches the camera. It increments
 * both enemy counters, so a `wait_enemies_alive` gate holds behind one.
 *
 * ## The handler is a placer
 *
 * `PlaceOwlFlockMember` allocates a **second, 0x2A0-byte object** and kills
 * itself, the way classes 0x40, 0x41 and 0x44 do. That object is not a combat
 * actor: no skeleton, no motion, no descriptor tail. All fourteen spawns use
 * `spawn_placed` (0x09), so the "tail" is two bytes — `+0x24`, always zero, and
 * `+0x25`, the sub-type.
 *
 * ## Fourteen owls, four groups, one attack at a time
 *
 * Stage 2 block 5 has six (four of sub-type 1 and two of sub-type 0), stage 2
 * block 14 four of sub-type 2, and stage 3 block 7 four of sub-type 3. Within a
 * group `g_class43_attack_token` is a single permit: an owl will not begin its
 * run-in unless the token is free, and it holds it from the launch until the
 * pull-out. That is what makes a flock come at you one at a time.
 *
 * **A one-player game keeps fewer of them**: the Init kills every sub-type-0
 * owl past member 0 and every other sub-type past member 1.
 *
 * ## The loop never ends
 *
 * `Dive → OrbitAway → Dive` for ever. An owl that survives its first pass has
 * no exit at all except being shot, and `OwlStateOrbitAwayAfterStrike`'s
 * relaunch always takes the sway arm — so {@link OwlDiveKind.Home}, the one
 * that actually converges on the eye, happens **once per owl**.
 *
 * ## What is not ported
 *
 * The **body chain** is `render/owl.ts`, which is where it belongs: sixteen
 * `AssetDrawSlot` calls under one matrix stack, a body, a thirty-frame wing
 * beat, a head on a sixteen-frame ping-pong and four limb chains. The five
 * limb angles the states write are carried here so the pose is in the
 * snapshot, and the renderer composes them. What the limbs anatomically are
 * is the open question `render/owl.ts` asks, beside the chains it draws.
 *
 * ## The corpse lands where each group flies
 *
 * `OwlCorpseFallAndSettle` replaces the update on death, and the ground it
 * falls to is **four sets of literals, one per sub-type** — the class knows
 * nothing of the stage's collision. Sub-type 0 falls down a stairwell: two
 * rails at `g_class43_corpse_rails` turn it back, a wall at `x = -739` stops
 * it, thirteen steps bounce it, and it lands for good at `y = 35.91906`.
 * Sub-type 1 lands on one side of a line on a flat at `49.16` and on the
 * other against a sloped plane; sub-type 2 bounces once on an eight-step
 * stair inside a box and lands at `-36` outside it; sub-type 3 goes into
 * water at `-25`. Each landing but the water leaves a ground ring.
 *
 * ## The effects
 *
 * Three effect tasks, in `game/effects/owl.ts`: the feathers
 * (`OwlSpawnFeatherBurst`, `FUN_00448900`) -- 40 on the death and 8 on every
 * strike -- the ground impact ring and the water splash. The death also leaves
 * a spray of blood at the owl's camera-space point, `SpawnBloodSprayAtPoint`
 * (`FUN_00430C50`). The ring and the splash are made only by the corpse's
 * landing arms, at `0x00448319` and `0x00448376` (sub-type 1's two),
 * `0x00448710` (the tail sub-types 0 and 2 share) and `0x00448758` (sub-type
 * 3's splash).
 */
import type { Rng } from "../../core/rng";
import type { Events } from "../../core/events";
import { ActorFlag, type Actor } from "../actor";
import { PlayerTakeDamage } from "../combat/player";
import { ScoreAddForPlayer } from "../combat/score";
import { ActorDespawn } from "../despawn";
import { CameraSlotVacate, RegisterEnemySlot, RegisterForCameraTracking }
  from "../camera/slots";
import { G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
// The effect tasks this class spawns (`game/effects/owl.ts`), and the blood
// its death leaves at a point.
import { SpawnBloodSprayAtPoint } from "../effects/blood";
import {
  OwlSpawnFeatherBurst, OwlSpawnGroundImpactRing, OwlSpawnWaterSplashFlipbook,
} from "../effects/owl";
import { RegisterForShotTest } from "../combat/shot_test";
import { vec3 } from "../vec";
import { OwlDiveKind, OwlFlag, OwlState, type OwlTail } from "./state";

export { OwlDiveKind, OwlFlag, OwlState } from "./state";
export type { OwlTail } from "./state";

/** BAMS to radians, and back. */
const BAMS = (Math.PI * 2) / 65536;
const TO_BAMS = 65536 / (Math.PI * 2);

// -- the numbers the class spells as literals -------------------------------

/** `obj+0x124` — the sphere `ShotTestSphere` measures. There is no bone test. */
export const OWL_HIT_RADIUS = 1.5;
/** `ScoreAddForPlayer(p, 0x50)`. */
export const OWL_SCORE = 0x50;
/** `PlayerTakeDamage(player, 1, 9)`, inside this range of the camera eye. */
export const OWL_STRIKE_RANGE = 5.0;
export const OWL_DAMAGE_KIND = 9;
/**
 * `g_class43_launch_delay` — 0x00592940, `s8[4] = {0, 1, 2, 3}`, times twenty
 * frames. It sits in the four bytes immediately before `g_class43_states`,
 * which is what bounds it at four — and four is what the descriptors use.
 */
export const OWL_LAUNCH_DELAY = [0, 1, 2, 3];
export const OWL_LAUNCH_DELAY_SCALE = 20;
/** `obj+0x240` starts here for a perched owl and winds **backwards**. */
export const OWL_BEAT_START = 0x2c;
export const OWL_BEAT_FRAMES = 30;
/**
 * A sub-type-0 owl is **invulnerable until the camera's path frame reaches
 * this**, and no other sub-type is.
 */
export const OWL_SUBTYPE0_INVULN_FRAME = 682.0;
/** The two hard-coded holding circles, and the radius both use. */
export const OWL_CIRCLE_RADIUS = 6.28;
export const OWL_CIRCLE_SUBTYPE1 = { x: -640.0, z: -950.0, lift: 10.0 };
export const OWL_CIRCLE_OTHER = { x: -415.0, y: 140.0, z: -2750.0 };
/** `obj+0x248` — how long {@link OwlState.Circle} holds, by sub-type. */
export const OWL_DWELL_SUBTYPE1 = 0x37;
export const OWL_DWELL_OTHER = 0x58;
/** `obj+0x1F4` steps this much a frame while circling — a lap in about 66. */
export const OWL_CIRCLE_STEP = 0x3e0;
/** ...and this much while orbiting away. */
export const OWL_ORBIT_STEP = 0x1f0;
/** The steering gains, which are the whole difference between the states. */
export const OWL_GAIN_FLY = 0.003;
export const OWL_GAIN_CIRCLE = 0.014;
export const OWL_GAIN_APPROACH_STEP = 0.003;
export const OWL_GAIN_APPROACH_CAP = 0.2;
export const OWL_GAIN_APPROACH_CAP_SUBTYPE2 = 0.15;
export const OWL_GAIN_DIVE = 0.03;
/** The approach's speed cap, and how far from a control point it advances. */
export const OWL_APPROACH_SPEED = 1.5;
export const OWL_APPROACH_ARRIVE = 4.0;
/** `0x007DCC68` — the spline's advance rate. The class owns the word. */
export const OWL_SPLINE_RATE = 0.06;
export const OWL_SPLINE_SEGMENT_END = 0.99;
/** `obj+0x270` climbs this much a frame while flying to the holding point. */
export const OWL_FLY_STEP = 0.0175;
export const OWL_ARRIVE_RADIUS = 5.0;
/** The dive's rate: a base, a jitter, and the acceleration on top. */
export const OWL_DIVE_RATE_BASE = 0.012;
export const OWL_DIVE_RATE_JITTER = 0.0001;
export const OWL_DIVE_RATE_SPREAD = 41;
export const OWL_DIVE_ACCEL = 0.005;
/** `+0x274 * 72817.78` is the sway's phase rate. */
export const OWL_SWAY_RATE_SCALE = 72817.78;
/** ...and the amplitude is the horizontal distance to the camera times this. */
export const OWL_SWAY_FROM_DISTANCE = 0.125;
/** The pull-out's rate: a smaller base and jitter than the dive's. */
export const OWL_PULLOUT_RATE_BASE = 0.004;
export const OWL_PULLOUT_RATE_SPREAD = 21;
/** How much the pull-out keeps of its speed, and sub-type 1's own answer. */
export const OWL_PULLOUT_DAMP = 0.5;
export const OWL_PULLOUT_DAMP_SUBTYPE1 = 0.1;
/** The coast's damping, and the relaunch's. */
export const OWL_COAST_DAMP = 0.9;
export const OWL_RELAUNCH_DAMP = 0.75;
/** The orbit is half a turn: past this going one way, below it the other. */
export const OWL_ORBIT_END_HIGH = 0x8800;
export const OWL_ORBIT_END_LOW = 0x7800;
/** The coast waits this long, and then for frame 18 of the wing beat. */
export const OWL_COAST_MIN = 30;
export const OWL_RELAUNCH_BEAT = 0x12;
/**
 * The corpse: its gravity (`[0x00564798]`, subtracted), the spin the death
 * gives it (`0xFFFFFD00`) and the share of it each frame keeps (`[0x0055CB40]`,
 * through `ftol`), how long it lasts, and how fast it sinks once it has landed
 * (`[0x005644F8]`).
 */
export const OWL_CORPSE_GRAVITY = -Math.fround(0.020415);
export const OWL_CORPSE_SPIN = -768;
export const OWL_CORPSE_SPIN_KEEP = Math.fround(0.95);
export const OWL_CORPSE_FRAMES = 0x79;
export const OWL_CORPSE_SINK = Math.fround(0.03);
/** `PUSH 0x3F400000` — every ring a corpse leaves is at three quarters. */
export const OWL_CORPSE_RING_SCALE = 0.75;
/** `PUSH 0xDC00` — sub-type 1's two rings are turned to this yaw. */
export const OWL_CORPSE_RING_YAW_SUBTYPE1 = 0xdc00;
/** `PUSH 0x1000` — ...and the one on its sloped plane pitched by this. */
export const OWL_CORPSE_RING_PITCH_SLOPE = 0x1000;
/** `COMMON\DAMAGE5_22.WAV` (`0x1E16A9`, the record at `0x00584BDC`). */
export const SND_OWL_CORPSE_THUD = 0x1e16a9;
/** `COMMON\SIBUKI8_16.WAV` — sub-type 3's water. */
export const SND_OWL_CORPSE_SPLASH = 0x4616a9;

/**
 * `g_class43_corpse_rails` — 0x005928C8. `f32[2 rail][5 point][x, y, z]`,
 * 0x78 bytes ending exactly at `g_class43_launch_delay` (`0x00592940`), and
 * only `OwlCorpseFallAndSettle` reads it. The y column is read by nothing:
 * the rail test is in x and z.
 */
export const OWL_CORPSE_RAILS: readonly (readonly (readonly [number, number,
  number])[])[] = [
  [[-666.02686, 47.17505, -1090.4563], [-682.09937, 44.237053, -1097.3513],
   [-695.5081, 41.20505, -1100.8845], [-707.83405, 38.285065, -1099.6738],
   [-720.60425, 35.91906, -1093.8978]],
  [[-666.06506, 47.17505, -1107.1716], [-677.01935, 44.237053, -1112.084],
   [-694.1037, 41.20505, -1115.2294], [-710.3227, 38.285065, -1112.7423],
   [-720.60425, 35.91906, -1106.6577]],
].map((rail) => rail.map((p) =>
  [Math.fround(p[0]), Math.fround(p[1]), Math.fround(p[2])] as const));

/**
 * Sub-type 0's stairwell, `OwlCorpseFallAndSettle`'s literals in the order
 * the arm reads them. The rails are tested only east of
 * {@link OWL_STAIR_RAILS_END_X} (`[0x00564764]`, which is both rails' last
 * x, bit for bit); west of {@link OWL_STAIR_WALL_X} the corpse is stopped
 * dead. Below {@link OWL_STAIR_LANDED_Y} it has landed; above it, the floor
 * under it is a step `n` of {@link OWL_STAIR_STEP_RUN} in x and one unit in
 * y, from {@link OWL_STAIR_TOP_Y} at {@link OWL_STAIR_TOP_X} down twelve.
 */
export const OWL_STAIR_RAILS_END_X = Math.fround(-720.60425);
export const OWL_STAIR_WALL_X = -739.0;
export const OWL_STAIR_WALL_SPIN = 0x600;
export const OWL_STAIR_LANDED_Y = Math.fround(35.91906);
/** `PUSH 0x420FC199` — the ring sits two hundredths above the landing. */
export const OWL_STAIR_RING_Y = Math.fround(35.93906);
export const OWL_STAIR_TOP_X = -671.0;
export const OWL_STAIR_TOP_Y = 45.0;
export const OWL_STAIR_STEP_RUN = 6.0;
export const OWL_STAIR_STEPS_DOWN = 12;
/** A step bounce: `x0.8` across, `x-0.4` up, and `0x400` off the spin. */
export const OWL_STAIR_BOUNCE_KEEP = Math.fround(0.8);
export const OWL_STAIR_BOUNCE_UP = Math.fround(-0.4);
export const OWL_STAIR_BOUNCE_SPIN = 0x400;

/**
 * Sub-type 1's two grounds. A line through `(-630.6, -923.8)` along
 * `(-34.9, -15.5)` divides a flat at {@link OWL_FLAT_LANDED_Y} from a slope,
 * `OwlTestPositionBelowPlane`'s `(0, 0.979029, 0.203721, 140.1687)`. The
 * line is four doubles, `[0x00564790]`, `[0x00564780]`, `[0x00564778]` and
 * `[0x00564788]`, and the third is `-34.89999999999998` rather than `-34.9`:
 * `[likely]` the compiler folding `-665.5 - -630.6`.
 */
export const OWL_FLAT_LINE_X = -630.6;
export const OWL_FLAT_LINE_Z = -923.8;
export const OWL_FLAT_LINE_DX = -34.89999999999998;
export const OWL_FLAT_LINE_DZ = -15.5;
export const OWL_FLAT_LANDED_Y = Math.fround(49.16);
/** `PUSH 0x42453333` — the flat's ring is at 49.3, whatever the corpse's y. */
export const OWL_FLAT_RING_Y = Math.fround(49.3);
export const OWL_SLOPE_PLANE = [
  0, Math.fround(0.979029), Math.fround(0.203721), Math.fround(140.1687),
] as const;
/** `[0x004C4380]` — the slope's ring is a unit under the corpse. */
export const OWL_SLOPE_RING_DROP = 1.0;

/**
 * Sub-type 2's box and stair. Inside the box the floor is step `n` of
 * {@link OWL_BOX_STEP_RISE} for every {@link OWL_BOX_STEP_RUN} the corpse is
 * south of {@link OWL_BOX_STAIR_Z}, eight at most; below
 * {@link OWL_BOX_FLOOR_Y}, in the box or out of it, it has landed.
 */
export const OWL_BOX_MIN_X = -1136.0;
export const OWL_BOX_MAX_X = -1113.0;
export const OWL_BOX_MIN_Z = -1121.0;
export const OWL_BOX_MAX_Z = Math.fround(-1098.7);
export const OWL_BOX_STAIR_Z = Math.fround(-1102.4666);
export const OWL_BOX_STEP_RUN = Math.fround(3.7666);
export const OWL_BOX_STEPS = 8.0;
export const OWL_BOX_STEP_RISE = 3.5;
export const OWL_BOX_BOTTOM_STEP_Y = -33.0;
/** The one bounce: `x-0.5` on all three, and `0x600` on the spin. */
export const OWL_BOX_BOUNCE = -0.5;
export const OWL_BOX_BOUNCE_SPIN = 0x600;
export const OWL_BOX_FLOOR_Y = -36.0;
/** `PUSH 0xC20FEB85` — the ring two hundredths above the floor. */
export const OWL_BOX_RING_Y = Math.fround(-35.98);

/** Sub-type 3's water: at or below this the corpse splashes and settles. */
export const OWL_WATER_Y = -25.0;
/** `obj+0x1A0/1A8` keep this much of themselves when the owl is shot. */
export const OWL_DEATH_DAMP = 0.4;
/** How many feathers the death sheds, and how many a strike does. */
export const OWL_FEATHERS_DEATH = 0x28;
export const OWL_FEATHERS_STRIKE = 8;
/** `owl.bin` 2 and 3 — the body, alive and dead. */
export const OWL_BODY_SLOT = 0xbbf;
export const OWL_BODY_DEAD_SLOT = 0xbc0;
/** `owl.bin` 4..33 — the thirty-frame beat, and the rest of the chain. */
export const OWL_BEAT_FIRST_SLOT = 0xbc1;
export const OWL_HEAD_FIRST_SLOT = 0xbf8;

/** `COMMON2\FUKUROU1_22.wav` and `FUKUROU2_22.wav`, and the wing-flap cue. */
export const SND_OWL_KILLED_A = 0x4117a9;
export const SND_OWL_KILLED_B = 0x4217a9;
export const SND_OWL_LAUNCH = 0x4a17a9;

/**
 * `g_class43_approach_curves` — 0x00564550.
 *
 * `s16[4 sub-type][4 member][4 point][3]`, 384 bytes ending exactly where the
 * float constant pool begins, which bounds it as firmly as the index does.
 * Every row's first point is its descriptor's own spawn position, which is
 * the cross-check that the indexing is not adrift.
 *
 * Sub-type 0's four rows are the placeholder `(-1,0,0), (0,0,0)...`, and that
 * is consistent: a sub-type-0 owl starts in {@link OwlState.Dive} and never
 * enters {@link OwlState.Approach} at all.
 */
export const OWL_APPROACH_CURVES: readonly (readonly (readonly [number, number,
  number][])[])[] = [
  [
    [[-1, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
    [[-1, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
    [[-1, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
    [[-1, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  ],
  [
    [[-644, 128, -943], [-646, 103, -930], [-676, 76, -909], [-702, 60, -899]],
    [[-644, 128, -943], [-656, 99, -932], [-666, 79, -919], [-703, 63, -900]],
    [[-644, 128, -943], [-646, 103, -930], [-676, 76, -909], [-702, 60, -899]],
    [[-644, 128, -943], [-656, 99, -932], [-666, 79, -919], [-703, 63, -900]],
  ],
  [
    [[-1125, -10, -1150], [-1126, -7, -1121], [-1119, 0, -1106],
     [-1109, 15, -1092]],
    [[-1124, -12, -1150], [-1120, -8, -1124], [-1110, -4, -1109],
     [-1100, 0, -1090]],
    [[-1127, -8, -1150], [-1122, -5, -1115], [-1125, 1, -1100],
     [-1113, 10, -1093]],
    [[-1123, -6, -1149], [-1118, -7, -1110], [-1109, -1, -1107],
     [-1099, 5, -1090]],
  ],
  [
    [[-425, 100, -2750], [-400, 60, -2700], [-350, 20, -2680],
     [-328, -10, -2648]],
    [[-428, 100, -2749], [-414, 60, -2725], [-350, 20, -2680],
     [-328, -10, -2648]],
    [[-425, 100, -2750], [-400, 60, -2700], [-350, 20, -2680],
     [-328, -10, -2648]],
    [[-425, 100, -2750], [-387, 60, -2735], [-350, 20, -2680],
     [-328, -10, -2648]],
  ],
];

function Tail(obj: Actor): OwlTail | null {
  return (obj as Actor & { owl?: OwlTail }).owl ?? null;
}

function play(events: Events | undefined, id: number): void {
  events?.emit("sound.play", { id });
}

function s16(v: number): number {
  return (v << 16) >> 16;
}

/** `ftol(atan2(x, z) * 10430.378)`. */
function BamsOf(x: number, z: number): number {
  return Math.trunc(Math.atan2(x, z) * TO_BAMS);
}

/**
 * `v -= (int)((target - v) * k)` — the ease every angle in this class uses,
 * with **`k` the engine's own literal**, which is negative.
 *
 * The sign is the whole of it. `OwlStateRideApproachSpline` is
 * `obj+0x64 -= (int)((0x3000 - obj+0x64) * -0.025)`, which is
 * `v += (target - v) * 0.025` and converges; this used to negate `k` a second
 * time, so every call site — every angle the class eases — computed
 * `v -= (target - v) * 0.025` and **ran away from its target** instead of
 * toward it. `obj+0x64` is the pitch and nothing wraps it, so an
 * owl on its approach tumbled forwards for ever.
 */
function Ease(v: number, target: number, k: number): number {
  return v - Math.trunc((target - v) * k);
}

/**
 * `OwlSteerVelocityTowardTarget` — `FUN_00448890`.
 *
 * `velocity += ((target - position) - velocity) * gain`, per component, and it
 * is the one primitive every flight state uses. **The gain is the whole
 * difference between them** — 0.003 gliding out to the holding point, 0.014
 * circling, a ramp on the approach, and the dive's own accelerating one.
 */
export function OwlSteerVelocityTowardTarget(obj: Actor, sub: OwlTail,
                                             gain: number): void {
  sub.vx += ((sub.tx - obj.pos.x) - sub.vx) * gain;
  sub.vy += ((sub.ty - obj.pos.y) - sub.vy) * gain;
  sub.vz += ((sub.tz - obj.pos.z) - sub.vz) * gain;
}

/**
 * `OwlEvalApproachSplinePoint` — `FUN_00448110`.
 *
 * A uniform quadratic B-spline over four control points, in two segments. The
 * basis is `FUN_0042DFD0`, shared with the class-0x40 horde member:
 * `w0 = (1-t)²/2`, `w1 = (1-t)t + 0.5`, `w2 = t²/2`.
 */
export function OwlEvalApproachSplinePoint(sub: OwlTail): void {
  const row = OWL_APPROACH_CURVES[sub.subtype]?.[sub.member];
  if (!row) return;
  const t = sub.segT;
  const u = 1 - t;
  const w0 = (u * u) / 2;
  const w1 = u * t + 0.5;
  const w2 = (t * t) / 2;
  const i = sub.segment;
  const p0 = row[i] ?? row[0];
  const p1 = row[i + 1] ?? p0;
  const p2 = row[i + 2] ?? p1;
  sub.tx = p0[0] * w0 + p1[0] * w1 + p2[0] * w2;
  sub.ty = p0[1] * w0 + p1[1] * w1 + p2[1] * w2;
  sub.tz = p0[2] * w0 + p1[2] * w1 + p2[2] * w2;
}

/**
 * `OwlPickTargetPlayerAndAimOffset` — `FUN_00447FB0`. Called on every launch.
 *
 * With two players it flips a coin and then places an aim offset a quarter
 * turn either side of the camera block's yaw, so two owls arrive from
 * opposite sides. With one, `obj+0x121` follows `g_active_player` when that
 * is 0 or 1 and is **left where it was** when it is -1 or 2 — a real
 * asymmetry, not an oversight to tidy up.
 *
 * The offset's length is the owl's horizontal distance from the block's eye,
 * `ftol`'d, over sixty (`[0x0055CB80]`, `0x3C888889`), and its heading is
 * `g_camera_block_yaw_bams` (`0x009A60D0`, read at `0x00448050`) plus
 * `0xC000` for player 0 or `0x4000` for player 1. The port used to take the
 * length from the sway rate and the heading from `g_camera_yaw_bams`, which
 * is the block's turned half round, so the two players' owls came in on each
 * other's side.
 */
export function OwlPickTargetPlayerAndAimOffset(obj: Actor, sub: OwlTail,
                                                rng: Rng): void {
  if (G.g_players_in_play === 2) {
    const p = rng.int(2);
    obj.attackPermit = p;
    const e = G.g_camera_block_eye;
    const d = Math.trunc(Math.hypot(obj.pos.x - e.x, obj.pos.z - e.z))
      * OWL_AIM_PER_UNIT;
    const a = (G.g_camera_block_yaw_bams + (p !== 0 ? 0x4000 : 0xc000))
      * BAMS;
    sub.aimX = Math.sin(a) * d;
    sub.aimZ = Math.cos(a) * d;
    return;
  }
  if (G.g_active_player === 0) obj.attackPermit = 0;
  if (G.g_active_player === 1) obj.attackPermit = 1;
}

/** `[0x0055CB80]` — a sixtieth, as a `float`. */
export const OWL_AIM_PER_UNIT = Math.fround(1 / 60);

/** The launch every dive shares, from state 3's coast and from state 5. */
function OwlBeginSwayDive(obj: Actor, sub: OwlTail, f: ClassFrame): void {
  play(f.events, SND_OWL_LAUNCH);
  sub.state = OwlState.Dive;
  sub.dive = OwlDiveKind.Sway;
  sub.fromX = obj.pos.x;
  sub.fromY = obj.pos.y;
  sub.fromZ = obj.pos.z;
  sub.timer = 0;
  sub.t = 0;
  sub.rate = f.rng.int(OWL_DIVE_RATE_SPREAD) * OWL_DIVE_RATE_JITTER
    + OWL_DIVE_RATE_BASE;
  sub.aimX = 0;
  sub.aimZ = 0;
  sub.swayPhase = sub.escapeDir > 0 ? 0x8000 : 0;
  G.g_class43_attack_token = sub.member;
  sub.sway = Math.hypot(obj.pos.x - f.eye.x, obj.pos.z - f.eye.z)
    * OWL_SWAY_FROM_DISTANCE;
  sub.swayRate = Math.trunc(sub.rate * OWL_SWAY_RATE_SCALE);
  OwlPickTargetPlayerAndAimOffset(obj, sub, f.rng);
}

// -- the Init --------------------------------------------------------------

/**
 * `PlaceOwlFlockMember` — `FUN_00445DB0`. Class 0x43's handler.
 *
 * The player-count gate runs first and it is not symmetric:
 *
 * ```c
 * if (g_players_in_play < 2) {
 *     if (subtype == 0) { if (member + 1 > 1) ActorKill(); }
 *     else              { if (member + 1 > 2) ActorKill(); }
 * }
 * ```
 *
 * — so one player faces **one** sub-type-0 owl and **two** of everything else,
 * and two players face all four.
 *
 * `obj+0x1F0` is the heading from the spawn point to the camera, taken once and
 * kept: the sway and every retreat circle are built about it. The decompiler
 * drops the whole FPU sequence that computes it.
 *
 * Sub-type 0 starts already diving, sub-type 2 already on its spline, and
 * sub-types 1 and 3 perched.
 */
export function PlaceOwlFlockMember(obj: Actor, rng?: Rng): void {
  const sub = Tail(obj);
  const p = obj.class43;
  if (!sub || !p) return;
  sub.subtype = p.subtype;
  sub.member = p.member;
  if (G.g_players_in_play < 2) {
    const keep = sub.subtype === 0 ? 1 : 2;
    if (sub.member + 1 > keep) { ActorDespawn(obj); return; }
  }
  obj.hp = 1;
  obj.hitRadius = OWL_HIT_RADIUS;
  sub.prevX = obj.pos.x;
  sub.prevZ = obj.pos.z;
  sub.state = OwlState.WaitLaunch;
  obj.attackPermit = -1;
  sub.beat = OWL_BEAT_START;
  sub.launchYaw = s16(BamsOf(G.g_camera_block_eye.x - obj.pos.x,
                             G.g_camera_block_eye.z - obj.pos.z));
  // `obj+0x120 = 0xFF` at `0x00445E8A`, `RegisterEnemySlot` at `0x00445EFA`.
  RegisterEnemySlot(obj);
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
  G.g_class43_attack_token = -1;

  if (sub.subtype === 0) {
    sub.state = OwlState.Dive;
    sub.launchYaw = 0x4000;
    sub.fromX = obj.pos.x;
    sub.fromY = obj.pos.y;
    sub.fromZ = obj.pos.z;
    sub.limbB = 0;
    sub.t = 0;
    sub.dive = OwlDiveKind.Sway;
    sub.rate = (rng?.int(OWL_DIVE_RATE_SPREAD) ?? 0) * OWL_DIVE_RATE_JITTER
      + OWL_DIVE_RATE_BASE;
    // `placer->+0x131B` is always 0 for this class -- opcode 0x09 never writes
    // it and `ActorClearGameFields` zeroed it -- so the token is stamped 0.
    G.g_class43_attack_token = 0;
    sub.aimX = 0;
    sub.aimZ = 0;
    sub.swayPhase = 0;
    sub.sway = 3.0;
    sub.swayRate = Math.trunc(sub.rate * OWL_SWAY_RATE_SCALE);
    if (G.g_players_in_play === 2) obj.attackPermit = rng?.int(2) ?? 0;
    else {
      if (G.g_active_player === 0) obj.attackPermit = 0;
      if (G.g_active_player === 1) obj.attackPermit = 1;
    }
  } else if (sub.subtype === 2) {
    sub.state = OwlState.Approach;
    sub.launchYaw = 0x12fb;
    sub.fromX = obj.pos.x;
    sub.fromY = obj.pos.y;
    sub.fromZ = obj.pos.z;
    sub.timer = 0;
    sub.beat = (sub.member * 10) % 30;
  }
}

// -- being shot ------------------------------------------------------------

/**
 * `[port-only]` — the shot half of `OwlUpdateAndResolveShot` (`FUN_004460C0`),
 * split out so a test can drive one bullet without a whole frame. The engine
 * has it inline at the top of the update and nothing else calls it.
 *
 * `obj+0x34` bit 3 is the entire damage model: the class calls no `ResolveHit`,
 * no `DispatchHit` and no `ActorApplyDamage`, and nothing decrements
 * `obj+0x11C`. One bullet.
 *
 * The first test is the odd one: **a sub-type-0 owl cannot be shot until the
 * camera's path frame passes 682**, and no other sub-type has that guard.
 * **Nothing clears bit 3 while it waits** — no instruction in the class ANDs
 * `obj+0x34` with a mask that drops it, and `MarkActorShot` only raises it —
 * so a bullet that lands early is kept, and the owl dies on the first frame
 * the guard lets it. The port used to clear the bit every frame, which
 * forgot the early bullet.
 *
 * The death marks the body `OwlFlag.Corpse` (`0x1000000`), the bit
 * `OwlDrawBodyChain` reads, and never `ActorFlag.Dead`; and it zeroes
 * `obj+0x24C`, `+0x250` and `+0x254` — not the settle flag at `+0x26C`,
 * which nothing but a landing ever writes. `+0x254` has no other reference in
 * the image, so it is not carried.
 */
export function OwlResolveShot(obj: Actor, f: ClassFrame): boolean {
  const sub = Tail(obj);
  if (!sub) return false;
  if (sub.subtype === 0 && G.g_cam_path_frame < OWL_SUBTYPE0_INVULN_FRAME) {
    return false;
  }
  if (sub.state === OwlState.Dead) return false;
  if (!(obj.flags & ActorFlag.Hit)) return false;

  // `SpawnBloodSprayAtPoint(obj + 0x40)` at `0x00446123`, which reads 0x30
  // past its argument: the owl's `obj+0x70`, its position through the camera
  // as the end of its last update left it -- the owl has not moved yet this
  // frame, and the host's camera is the one last drawn with.
  const at = vec3();
  f.host.viewSpaceOfPoint?.(obj.pos, at);
  SpawnBloodSprayAtPoint(at);
  play(f.events, f.rng.int(2) !== 0 ? SND_OWL_KILLED_A : SND_OWL_KILLED_B);
  const byP0 = (obj.flags & ActorFlag.HitByPlayer0) !== 0;
  const byP1 = (obj.flags & ActorFlag.HitByPlayer1) !== 0;
  const who = byP0 && byP1 ? f.rng.int(2) : byP0 ? 0 : 1;
  ScoreAddForPlayer(who, OWL_SCORE, f.events);
  G.g_player_hit_count[who] = (G.g_player_hit_count[who] ?? 0) + 1;

  if (sub.state === OwlState.Dive) G.g_class43_attack_token = -1;
  obj.flags |= OwlFlag.Corpse;
  G.g_enemies_alive -= 1;
  G.g_enemies_present -= 1;
  obj.flags |= ActorFlag.NoCameraTrack;
  CameraSlotVacate(obj);
  if (sub.state === OwlState.WaitLaunch || sub.state === OwlState.FlyToCircle) {
    obj.flags |= ActorFlag.Reacting;
  }
  // The corpse is thrown at unit speed, on top of four tenths of whatever it
  // was doing, along `g_camera_block_yaw_bams + 0x8000` -- the block's yaw
  // (`0x009A60D0`, read at `0x0044627B` and `0x004462B6`) faces back at the
  // viewer, so this is **away from the camera**, the way the shot pushed it.
  // It read `g_camera_yaw_bams`, which already faces forward, and so threw
  // every corpse back over the player's head.
  const a = (G.g_camera_block_yaw_bams + 0x8000) * BAMS;
  sub.vx = sub.vx * OWL_DEATH_DAMP + Math.sin(a);
  sub.vz = sub.vz * OWL_DEATH_DAMP + Math.cos(a);
  sub.spin = OWL_CORPSE_SPIN;
  sub.state = OwlState.Dead;
  sub.timer = 0;
  sub.bounced = 0;
  // `0x004462E7`, the block's last call before it swaps `obj[0]`.
  OwlSpawnFeatherBurst(OWL_FEATHERS_DEATH, obj, f.rng);
  return true;
}

// -- the states ------------------------------------------------------------

/**
 * `OwlStateWaitLaunchDelay` — `FUN_004464C0`. State 0, sub-types 1 and 3.
 *
 * The stagger: `g_class43_launch_delay[member] * 20` frames, so a group of
 * four leaves at 0, 20, 40 and 60. Members 1 and up then fly to a **hard-coded
 * holding circle**; member 0 has no delay and no circle and goes straight to
 * its run-in, but only once the token is free and the scene has actually
 * started.
 *
 * `obj+0x240` winds **backwards** from 44 while an owl waits and the member-0
 * exit does not reset it. In the shipped data the gate opens on the first or
 * second frame, because every Init has just put -1 in the token, so the beat
 * lands at 43 and the next state's `(n + 1) % 30` puts it back in range. The
 * arithmetic is reproduced rather than clamped, which is what keeps that true.
 */
export function OwlStateWaitLaunchDelay(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  sub.limbB = sub.timer * 1092;
  const d = OWL_LAUNCH_DELAY[sub.member] ?? 0;
  const before = sub.timer;
  sub.timer += 1;
  if (before > d * OWL_LAUNCH_DELAY_SCALE - 14) sub.beat -= 1;
  if (sub.timer <= d * OWL_LAUNCH_DELAY_SCALE) return;

  if (sub.member > 0) {
    play(f.events, SND_OWL_LAUNCH);
    sub.fromX = obj.pos.x;
    sub.fromY = obj.pos.y;
    sub.fromZ = obj.pos.z;
    sub.state = OwlState.FlyToCircle;
    if (sub.subtype === 1) {
      sub.centreX = OWL_CIRCLE_SUBTYPE1.x;
      sub.centreZ = OWL_CIRCLE_SUBTYPE1.z;
      sub.centreY = obj.pos.y + OWL_CIRCLE_SUBTYPE1.lift;
      sub.orbitPhase = 0;
      sub.dwell = OWL_DWELL_SUBTYPE1;
    } else {
      sub.centreX = OWL_CIRCLE_OTHER.x;
      sub.centreY = OWL_CIRCLE_OTHER.y;
      sub.centreZ = OWL_CIRCLE_OTHER.z;
      sub.orbitPhase = 0x8000;
      sub.dwell = OWL_DWELL_OTHER;
    }
    sub.radius = OWL_CIRCLE_RADIUS;
    sub.timer = 0;
    sub.beat = 0;
    sub.limbB = 0;
    sub.circleOnArrival = 1;
    sub.holdY = sub.centreY;
    const a = s16(sub.orbitPhase - 0x2000) * BAMS;
    sub.holdX = Math.sin(a) * OWL_CIRCLE_RADIUS + sub.centreX;
    sub.holdZ = Math.cos(a) * OWL_CIRCLE_RADIUS + sub.centreZ;
    return;
  }
  if (G.g_class43_attack_token === -1 && G.g_players_in_play > 0) {
    sub.timer = 0;
    sub.t = 0.1;
    sub.state = OwlState.Approach;
    sub.circleOnArrival = 0;
    sub.fromX = obj.pos.x;
    sub.fromY = obj.pos.y;
    sub.fromZ = obj.pos.z;
  }
}

/**
 * `OwlStateCircleHoldingPoint` — `FUN_004466C0`. State 1.
 *
 * A lap of the holding circle every sixty-six frames or so, waiting for two
 * things at once: its own dwell to expire *and* the group's token to be free.
 * That pair is why a flock queues rather than swarming.
 */
export function OwlStateCircleHoldingPoint(obj: Actor): void {
  const sub = Tail(obj);
  if (!sub) return;
  sub.beat = (sub.beat + 1) % OWL_BEAT_FRAMES;
  obj.pitch = Ease(obj.pitch, 0x1000, -0.05);
  sub.orbitPhase += sub.subtype === 1 ? OWL_CIRCLE_STEP : -OWL_CIRCLE_STEP;
  sub.ty = sub.centreY;
  const a = s16(sub.orbitPhase) * BAMS;
  sub.tx = Math.sin(a) * sub.radius + sub.centreX;
  sub.tz = Math.cos(a) * sub.radius + sub.centreZ;
  OwlSteerVelocityTowardTarget(obj, sub, OWL_GAIN_CIRCLE);
  obj.pos.x += sub.vx;
  obj.pos.y += sub.vy;
  obj.pos.z += sub.vz;
  sub.limbE -= Math.trunc(sub.limbE * 0.2);
  sub.timer += 1;
  if (sub.timer > sub.dwell && G.g_class43_attack_token === -1
      && G.g_players_in_play > 0) {
    sub.fromX = obj.pos.x;
    sub.fromY = obj.pos.y;
    sub.fromZ = obj.pos.z;
    sub.timer = 0;
    sub.t = 0;
    sub.segment = 0;
    sub.segT = 0;
    sub.state = OwlState.Approach;
    sub.circleOnArrival = 0;
  }
}

/**
 * `OwlStateFlyToHoldingPoint` — `FUN_00446D20`. State 2.
 *
 * A straight lerp with a thirty-frame vertical bob on top. Its pitch target is
 * `obj+0x3C ? 0x3000 : 0x1000`, and **nothing in the class ever writes
 * `obj+0x3C`**, so it is always `0x1000` — transcribed as the constant it is.
 *
 * `obj+0x230` is 1 on every path that reaches here from state 0, so the first
 * arrival always circles; the other arm is unreachable in the shipped data.
 */
export function OwlStateFlyToHoldingPoint(obj: Actor): void {
  const sub = Tail(obj);
  if (!sub) return;
  sub.beat = (sub.beat + 1) % OWL_BEAT_FRAMES;
  obj.pitch = Ease(obj.pitch, 0x1000, -0.025);
  sub.limbE = Ease(sub.limbE, 0x3000, -0.2);
  sub.tx = sub.fromX + (sub.holdX - sub.fromX) * sub.t;
  sub.ty = sub.fromY + (sub.holdY - sub.fromY) * sub.t;
  sub.tz = sub.fromZ + (sub.holdZ - sub.fromZ) * sub.t;
  OwlSteerVelocityTowardTarget(obj, sub, OWL_GAIN_FLY);
  obj.pos.x += sub.vx;
  obj.pos.z += sub.vz;
  obj.pos.y += sub.vy
    + Math.sin(((sub.beat + 8) % 30) * (65536 / 30) * BAMS) * 0.15;
  sub.t += OWL_FLY_STEP;
  if (sub.t > 1.0) sub.t = 1.0;
  const d = Math.hypot(obj.pos.x - sub.holdX, obj.pos.y - sub.holdY,
                       obj.pos.z - sub.holdZ);
  if (d >= OWL_ARRIVE_RADIUS) return;
  if (sub.circleOnArrival === 0) {
    sub.state = OwlState.Approach;
    sub.t = 0;
  } else {
    sub.state = OwlState.Circle;
    sub.timer = 0;
  }
  sub.circleOnArrival = 0;
}

/**
 * `OwlStateRideApproachSpline` — `FUN_00446860`. State 3, the run-in.
 *
 * The spline advances only while the owl is inside four units of its current
 * control point, so a slow owl is not left behind by its own path. At the end
 * of the second segment the sub-types part company, and this is the difference
 * that decides how a group reads:
 *
 * * **sub-types 0, 1 and 3** take the token and dive with
 *   {@link OwlDiveKind.Home} — straight at the eye.
 * * **sub-type 2** instead coasts through a counter and launches with
 *   {@link OwlDiveKind.Sway}, so a stage-2 block-14 owl never homes in on its
 *   first pass. It sweeps past and comes back.
 */
export function OwlStateRideApproachSpline(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  sub.beat = (sub.beat + 1) % OWL_BEAT_FRAMES;
  obj.pitch = Ease(obj.pitch, 0x3000, -0.025);
  if (sub.subtype !== 2) {
    obj.roll = Math.trunc(
      Math.sin(Math.trunc((sub.segment + sub.segT) * 8192.0) * BAMS) * 8.0);
  }
  if (sub.timer === 0) {
    OwlEvalApproachSplinePoint(sub);
    OwlSteerVelocityTowardTarget(obj, sub, sub.t);
    sub.t += OWL_GAIN_APPROACH_STEP;
    const cap = sub.subtype === 2
      ? OWL_GAIN_APPROACH_CAP_SUBTYPE2 : OWL_GAIN_APPROACH_CAP;
    if (sub.t > cap) sub.t = cap;
    const speed = Math.hypot(sub.vx, sub.vy, sub.vz);
    if (speed > OWL_APPROACH_SPEED) {
      const k = OWL_APPROACH_SPEED / speed;
      sub.vx *= k; sub.vy *= k; sub.vz *= k;
    }
    const d = Math.hypot(obj.pos.x - sub.tx, obj.pos.y - sub.ty,
                         obj.pos.z - sub.tz);
    if (d < OWL_APPROACH_ARRIVE) sub.segT += OWL_SPLINE_RATE;
    if (sub.segT >= OWL_SPLINE_SEGMENT_END) {
      sub.segT = 0;
      sub.segment += 1;
      if (sub.segment > 1) {
        if (sub.subtype === 2) sub.timer = 1;
        else {
          sub.fromX = obj.pos.x;
          sub.fromY = obj.pos.y;
          sub.fromZ = obj.pos.z;
          G.g_class43_attack_token = sub.member;
          sub.state = OwlState.Dive;
          sub.dive = OwlDiveKind.Home;
          sub.timer = 0;
          sub.t = 0;
          sub.rate = 0;
          sub.limbB = 0;
          sub.aimX = 0;
          sub.aimZ = 0;
          OwlPickTargetPlayerAndAimOffset(obj, sub, f.rng);
        }
      }
    }
  }
  obj.pos.x += sub.vx;
  obj.pos.y += sub.vy;
  obj.pos.z += sub.vz;
  if (sub.timer <= 0) return;
  sub.vx *= OWL_COAST_DAMP;
  sub.vy *= OWL_COAST_DAMP;
  sub.vz *= OWL_COAST_DAMP;
  obj.pos.y += Math.sin(((sub.beat + 8) % 30) * (65536 / 30) * BAMS) * 0.5;
  sub.timer += sub.segment === 0 ? -1 : 1;
  if (sub.timer > (sub.member + 1) * 20) OwlBeginSwayDive(obj, sub, f);
}

/**
 * `OwlStateDiveAtCamera` — `FUN_00446F30`. State 4, and the strike.
 *
 * ⚠ Ghidra's body for this routine jumps `0x004470EC` → `0x0044727C` past a
 * `MatrixStackPop` it has marked no-return, and the 395 bytes it hides are the
 * **whole of the sway trajectory**. Read literally, the decompilation says the
 * owl has one dive and it is a straight lerp.
 *
 * **The strike is a distance, not a frame**: inside five units of the camera
 * eye it takes a life, with no clip and no attack permit beyond the group's
 * token. Then it picks a side, builds a retreat circle from a four-arm table,
 * sheds eight feathers and lets the token go.
 */
export function OwlStateDiveAtCamera(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  // **The wing beat advances here too**, at `0x00446F42`, before either
  // branch — it is the routine's first instruction and it is not optional.
  // Frozen, `sin((beat + 8) % 30)` below stops being a bob and becomes a
  // constant added to the height every frame, so the sway dive settles at
  // `eye.y + c / k` — five units under the eye at the extreme, which is
  // exactly {@link OWL_STRIKE_RANGE}. The owl then flies through the camera
  // half a body out of reach, never strikes, and since nothing clamps
  // `obj+0x270` in this branch it keeps going in a straight line for ever.
  sub.beat = (sub.beat + 1) % OWL_BEAT_FRAMES;
  if (sub.dive === OwlDiveKind.Home) {
    sub.tx = sub.fromX + ((f.eye.x + sub.aimX) - sub.fromX) * sub.t;
    sub.ty = sub.fromY + (f.eye.y - sub.fromY) * sub.t;
    sub.tz = sub.fromZ + ((f.eye.z + sub.aimZ) - sub.fromZ) * sub.t;
    OwlSteerVelocityTowardTarget(obj, sub, sub.t * OWL_GAIN_DIVE);
    sub.t += sub.rate;
    sub.rate += OWL_DIVE_ACCEL;
    if (sub.t > 1.0) sub.t = 1.0;
    obj.pos.x += sub.vx;
    obj.pos.y += sub.vy;
    obj.pos.z += sub.vz;
    obj.roll -= Math.trunc(obj.roll * 0.03);
  } else {
    // The sway is a unit x-offset rotated by the launch heading, so it swings
    // across the run-in rather than across the world.
    const a = s16(sub.launchYaw) * BAMS;
    const off = Math.sin(s16(sub.swayPhase) * BAMS);
    const outX = Math.cos(a) * off;
    const outZ = -Math.sin(a) * off;
    sub.swayPhase += sub.swayRate;
    obj.pos.x = sub.fromX + ((f.eye.x + sub.aimX) - sub.fromX) * sub.t;
    obj.pos.z = sub.fromZ + ((f.eye.z + sub.aimZ) - sub.fromZ) * sub.t;
    const k = sub.subtype === 2 || sub.subtype === 0 ? 0.04 : 0.025;
    obj.pos.y += (f.eye.y - obj.pos.y) * k;
    obj.pos.x += outX * sub.sway;
    obj.pos.z += outZ * sub.sway;
    sub.t += sub.rate;
    obj.pos.y += Math.sin(((sub.beat + 8) % 30) * (65536 / 30) * BAMS) * 0.2;
    const s = Math.trunc(Math.sin(s16(sub.swayPhase + 0x4000) * BAMS) * 4096.0);
    obj.roll -= Math.trunc((obj.roll - s) / 4);
  }
  obj.pitch = Ease(obj.pitch, 0x1e00, -0.05);
  sub.limbA -= Math.trunc((sub.limbA + 0x1000) * 0.05);
  sub.limbC -= Math.trunc((sub.limbC + 0x2800) * 0.1);
  sub.limbD = Ease(sub.limbD, 0x2800, -0.1);
  sub.limbE = Ease(sub.limbE, 0x3000, -0.2);
  sub.diveFrame += 1;

  const d = Math.hypot(obj.pos.x - f.eye.x, obj.pos.y - f.eye.y,
                       obj.pos.z - f.eye.z);
  // `obj+0x24C` is never incremented in this state, so the distance is the
  // only way out of it.
  if (d >= OWL_STRIKE_RANGE && sub.timer < 1) return;
  PlayerTakeDamage(obj.attackPermit, 1, OWL_DAMAGE_KIND, f.events, obj,
                   "strike");

  sub.state = OwlState.OrbitAway;
  const damp = sub.subtype === 1 && sub.dive === OwlDiveKind.Home
    ? OWL_PULLOUT_DAMP_SUBTYPE1 : OWL_PULLOUT_DAMP;
  sub.vx *= damp; sub.vy *= damp; sub.vz *= damp;
  sub.escapeDir = 1 - 2 * f.rng.int(2);
  const dir = sub.escapeDir;
  let r: number;
  let yawOff: number;
  let up: number;
  switch (sub.subtype) {
    case 0:
      r = 15.0; yawOff = dir > 0 ? 0 : -0x0f00; up = sub.member * 7.0; break;
    case 1:
      r = 15.0;
      yawOff = dir > 0 ? f.rng.int(0x401) : -0xc00 - f.rng.int(0x401);
      up = sub.member * 1.5 + f.rng.int(3) + 2.0;
      break;
    case 2:
      r = 12.0; yawOff = dir > 0 ? 0 : 0x0800; up = sub.member * 1.2; break;
    default:
      r = 15.0; yawOff = dir > 0 ? 0 : -0x0800; up = sub.member * 1.2; break;
  }
  const a = s16(sub.launchYaw + yawOff + 0x8000) * BAMS;
  sub.centreX = Math.sin(a) * r + obj.pos.x;
  sub.centreY = up + obj.pos.y;
  sub.centreZ = Math.cos(a) * r + obj.pos.z;
  sub.orbitPhase = dir > 0 ? 0 : 0xffff;
  sub.strikeToggle = 1 - sub.strikeToggle;
  // `0x00447605`: after the toggle, before the pull-out's `rand()`.
  OwlSpawnFeatherBurst(OWL_FEATHERS_STRIKE, obj, f.rng);
  sub.fromX = obj.pos.x;
  sub.fromY = obj.pos.y;
  sub.fromZ = obj.pos.z;
  sub.timer = 0;
  sub.t = 0;
  sub.rate = f.rng.int(OWL_PULLOUT_RATE_SPREAD) * OWL_DIVE_RATE_JITTER
    + OWL_PULLOUT_RATE_BASE;
  G.g_class43_attack_token = -1;
  sub.dive = OwlDiveKind.None;
  obj.roll = 0;
}

/**
 * `OwlStateOrbitAwayAfterStrike` — `FUN_00447690`. State 5.
 *
 * Half a turn of the retreat circle state 4 built, then a coast, then back
 * into the dive on frame 18 of the wing beat — which is what makes a whole
 * flock relaunch in step rather than at random.
 *
 * The relaunch always takes {@link OwlDiveKind.Sway}, so after the first pass
 * no owl ever homes on the eye again.
 */
export function OwlStateOrbitAwayAfterStrike(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  sub.beat = (sub.beat + 1) % OWL_BEAT_FRAMES;
  const dir = sub.escapeDir;
  if (sub.timer === 0) sub.orbitPhase += dir * OWL_ORBIT_STEP;
  let a: number;
  let r: number;
  switch (sub.subtype) {
    case 0: a = s16(sub.orbitPhase + 0x4000); r = 5.0; break;
    case 1: a = s16(sub.orbitPhase + 0xe000); r = 7.0; break;
    case 2: a = s16(sub.orbitPhase + 0x2000); r = 6.0; break;
    default: a = s16(sub.orbitPhase + 0x1800); r = 8.0; break;
  }
  sub.ty = sub.centreY;
  sub.tx = Math.sin(a * BAMS) * r + sub.centreX;
  sub.tz = Math.cos(a * BAMS) * r + sub.centreZ;
  OwlSteerVelocityTowardTarget(obj, sub, sub.rate);
  const prevY = obj.pos.y;
  const prevX = obj.pos.x;
  const prevZ = obj.pos.z;
  obj.pos.x += sub.vx;
  obj.pos.z += sub.vz;
  const b = Math.sin(((sub.beat + 8) % 30) * (65536 / 30) * BAMS);
  obj.pos.y += sub.vy + b * 0.25;
  sub.limbE += Math.trunc(b * -2048.0);

  if (sub.timer === 0) {
    const climb = Math.trunc(
      Math.atan2(-(obj.pos.y - prevY),
                 Math.hypot(obj.pos.x - prevX, obj.pos.z - prevZ)) * TO_BAMS);
    const e = s16(-obj.pitch - climb);
    obj.pitch += Math.trunc(e / 8);
    if (obj.pitch < 0) obj.pitch = 0;
  }
  sub.limbA -= Math.trunc(sub.limbA * 0.01);
  if (sub.timer === 0) {
    obj.roll = Math.trunc(
      Math.sin(Math.trunc(sub.orbitPhase * 0.94117647) * BAMS) * 8.0 * -dir);
  } else {
    obj.roll -= Math.trunc(obj.roll * 0.025);
  }
  sub.limbE -= Math.trunc(sub.limbE * 0.2);

  if (sub.timer === 0
      && ((dir > 0 && sub.orbitPhase > OWL_ORBIT_END_HIGH)
          || (dir < 0 && sub.orbitPhase < OWL_ORBIT_END_LOW))) {
    sub.timer = 1;
  }
  if (sub.timer === 0) return;
  sub.timer += 1;
  sub.vx *= OWL_COAST_DAMP;
  sub.vy *= OWL_COAST_DAMP;
  sub.vz *= OWL_COAST_DAMP;
  if (sub.timer > OWL_COAST_MIN && sub.beat === OWL_RELAUNCH_BEAT) {
    OwlBeginSwayDive(obj, sub, f);
    if (sub.subtype !== 0) {
      sub.vx *= OWL_RELAUNCH_DAMP;
      sub.vy *= OWL_RELAUNCH_DAMP;
      sub.vz *= OWL_RELAUNCH_DAMP;
    }
  }
}

/**
 * `OwlTestPositionBelowPlane` — `FUN_00448850`.
 *
 * `a*x + b*y + c*z + d <= 0` for the actor's `obj+0x40/44/48`, as `AL`:
 * `TEST AH, 0x41` after the compare with `0.0`, so "equal" is below too.
 * Its one caller is sub-type 1's corpse.
 */
export function OwlTestPositionBelowPlane(obj: Actor, a: number, b: number,
                                          c: number, d: number): boolean {
  return a * obj.pos.x + b * obj.pos.y + c * obj.pos.z + d <= 0.0;
}

/**
 * `OwlCorpseFallAndSettle` — `FUN_00448210`.
 *
 * Not a state: the death block swaps `obj[0]` for it, so it replaces the
 * update wholesale — no state dispatch, no yaw, no camera point and no shot
 * test from here on. Every frame it falls or sinks, then counts, and on its
 * 121st it is gone without drawing.
 *
 * **Falling** is gravity, the move, and the tumble: `obj+0x64 += spin`, then
 * `spin = ftol(spin * 0.95)` — the spin dies away rather than turning the body
 * over for ever. Then the landing, which is a `switch` on the sub-type
 * through the jump table at `0x004487B8` and is **four sets of literals** —
 * nothing here asks the stage's collision:
 *
 * * **0** (`0x00448397`) — a stairwell. East of both rails' last point each
 *   rail tests which side of its current segment the corpse is on and flips
 *   `vz` — rail 0 on one side, rail 1 on the other, so between them both
 *   fire and cancel and beyond either one fires and turns it back. West of
 *   `x = -739` it is stopped dead with a kick to the spin. Under `35.91906`
 *   it has landed: the ring (at `0x00448710`, the tail it shares with 2), the
 *   thud. Otherwise the step under it bounces it, with the thud.
 * * **1** (`0x004482BA`) — one side of a line is a flat: under `49.16` a ring
 *   at `0x00448319`, and **no thud**, and the corpse is not moved onto it.
 *   The other side is a slope, `OwlTestPositionBelowPlane`: a ring a unit
 *   under the corpse pitched `0x1000` at `0x00448376`, and the thud.
 * * **2** (`0x004485BA`) — inside a box an eight-step stair turns its fall
 *   back every time and bounces it across once (`obj+0x250`); at `-36`,
 *   anywhere, it has landed: the ring at `0x00448710` and the thud.
 * * **3** (`0x0044872E`) — at `-25` or under, the water: the splash at
 *   `0x00448758` and `SIBUKI8`. The corpse is not stopped at the surface;
 *   it sinks through it like every settled one.
 *
 * `obj+0x26C` is raised by those four landings only. **Settled**, the corpse
 * sinks `0.03` a frame and does nothing else.
 *
 * The positions and velocities are `float` in the engine and compared as
 * they were stored; the port keeps doubles, as the rest of the class does,
 * and every literal is the engine's `float` (or, for sub-type 1's line, its
 * `double`) bit for bit.
 */
export function OwlCorpseFallAndSettle(obj: Actor, events?: Events): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (sub.settled !== 0) {
    obj.pos.y -= OWL_CORPSE_SINK;
  } else {
    // `0x00448227`..`0x004482A7`. The locals are what the arms compare.
    sub.vy += OWL_CORPSE_GRAVITY;
    obj.pos.x += sub.vx;
    obj.pos.z += sub.vz;
    obj.pos.y += sub.vy;
    const x = obj.pos.x;
    const y = obj.pos.y;
    const z = obj.pos.z;
    obj.pitch += sub.spin;
    sub.spin = Math.trunc(sub.spin * OWL_CORPSE_SPIN_KEEP);
    switch (sub.subtype) {
      case 0: {
        if (x > OWL_STAIR_RAILS_END_X) {
          for (let rail = 0; rail < 2; rail += 1) {
            const pts = OWL_CORPSE_RAILS[rail];
            // The segment whose x span holds the corpse: 0 east of point 1,
            // else the first `i` past it with `pts[i+1].x <= x`. Point 4's x
            // is the guard above, so the walk never reaches past point 4.
            let seg = 0;
            if (x < pts[1][0]) {
              while (seg < 4) {
                const past = x < pts[seg + 2][0];
                seg += 1;
                if (!past) break;
              }
            }
            const p0 = pts[seg];
            const p1 = pts[seg + 1];
            const side = (p1[2] - p0[2]) * (p0[0] - x)
              - (p1[0] - p0[0]) * (p0[2] - obj.pos.z);
            // Rail 0 `TEST AH, 0x41; JZ` flips on `> 0`; rail 1
            // `TEST DL, AH` with `DL = 1` flips on `< 0`.
            if (rail === 0 ? side > 0.0 : side < 0.0) sub.vz *= -1.0;
          }
        }
        if (x < OWL_STAIR_WALL_X) {
          sub.spin += OWL_STAIR_WALL_SPIN;
          obj.pos.x = OWL_STAIR_WALL_X;
          sub.vx = 0;
          sub.vz = 0;
        }
        if (y < OWL_STAIR_LANDED_Y) {
          obj.pos.y = OWL_STAIR_LANDED_Y;
          OwlSpawnGroundImpactRing(obj.pos.x, OWL_STAIR_RING_Y, obj.pos.z,
                                   OWL_CORPSE_RING_SCALE, 0, obj.yaw, events);
          sub.settled = 1;
          play(events, SND_OWL_CORPSE_THUD);
          break;
        }
        // The step: `n` counts down from 0 while `n * 6 - 671` is still
        // east of the corpse, twelve at most, and the floor is `n + 45`.
        let n = 0.0;
        if (obj.pos.x < OWL_STAIR_TOP_X) {
          while (n > -OWL_STAIR_STEPS_DOWN) {
            n -= 1.0;
            if (!(n * OWL_STAIR_STEP_RUN + OWL_STAIR_TOP_X > obj.pos.x)) break;
          }
        }
        const floor = n + OWL_STAIR_TOP_Y;
        if (y <= floor) {
          obj.pos.y = floor;
          play(events, SND_OWL_CORPSE_THUD);
          sub.vx *= OWL_STAIR_BOUNCE_KEEP;
          sub.spin -= OWL_STAIR_BOUNCE_SPIN;
          sub.vy *= OWL_STAIR_BOUNCE_UP;
          sub.vz *= OWL_STAIR_BOUNCE_KEEP;
        }
        break;
      }
      case 1: {
        const side = (OWL_FLAT_LINE_X - x) * OWL_FLAT_LINE_DZ
          - (OWL_FLAT_LINE_Z - z) * OWL_FLAT_LINE_DX;
        if (side > 0.0) {
          if (y < OWL_FLAT_LANDED_Y) {
            OwlSpawnGroundImpactRing(x, OWL_FLAT_RING_Y, z,
                                     OWL_CORPSE_RING_SCALE, 0,
                                     OWL_CORPSE_RING_YAW_SUBTYPE1, events);
            sub.settled = 1;
          }
        } else if (OwlTestPositionBelowPlane(obj, ...OWL_SLOPE_PLANE)) {
          OwlSpawnGroundImpactRing(obj.pos.x, obj.pos.y - OWL_SLOPE_RING_DROP,
                                   obj.pos.z, OWL_CORPSE_RING_SCALE,
                                   OWL_CORPSE_RING_PITCH_SLOPE,
                                   OWL_CORPSE_RING_YAW_SUBTYPE1, events);
          sub.settled = 1;
          play(events, SND_OWL_CORPSE_THUD);
        }
        break;
      }
      case 2: {
        if (x > OWL_BOX_MIN_X && x < OWL_BOX_MAX_X
            && z > OWL_BOX_MIN_Z && z < OWL_BOX_MAX_Z) {
          // `n` counts up while `-1098.7 - n * 3.7666 - 3.7666` is still
          // north of the corpse, eight at most; the step is `n * 3.5 - 33`.
          let n = 0.0;
          if (z < OWL_BOX_STAIR_Z) {
            while (n < OWL_BOX_STEPS) {
              n += 1.0;
              if (!(OWL_BOX_MAX_Z - n * OWL_BOX_STEP_RUN - OWL_BOX_STEP_RUN
                    > z)) {
                break;
              }
            }
          }
          const step = n * OWL_BOX_STEP_RISE + OWL_BOX_BOTTOM_STEP_Y;
          if (y < step) {
            obj.pos.y = step;
            sub.vy *= OWL_BOX_BOUNCE;
            if (sub.bounced === 0) {
              sub.bounced = 1;
              sub.vx *= OWL_BOX_BOUNCE;
              sub.vz *= OWL_BOX_BOUNCE;
              play(events, SND_OWL_CORPSE_THUD);
              sub.spin += OWL_BOX_BOUNCE_SPIN;
            }
          }
        }
        if (obj.pos.y > OWL_BOX_FLOOR_Y) break;
        obj.pos.y = OWL_BOX_FLOOR_Y;
        OwlSpawnGroundImpactRing(obj.pos.x, OWL_BOX_RING_Y, obj.pos.z,
                                 OWL_CORPSE_RING_SCALE, 0, obj.yaw, events);
        sub.settled = 1;
        play(events, SND_OWL_CORPSE_THUD);
        break;
      }
      case 3:
        if (y <= OWL_WATER_Y) {
          sub.settled = 1;
          OwlSpawnWaterSplashFlipbook(x, y, z);
          play(events, SND_OWL_CORPSE_SPLASH);
        }
        break;
      default:
        // `CMP EAX, 3; JA 0x0044877C` — no landing at all.
        break;
    }
  }
  // `0x0044877C`: the count, and on its 121st frame the despawn instead of
  // the draw.
  sub.timer += 1;
  if (sub.timer > OWL_CORPSE_FRAMES - 1) ActorDespawn(obj);
}

/** `g_class43_states` — 0x00592944. Seven entries used; the eighth is a stub. */
const g_class43_states: Record<number, (obj: Actor, f: ClassFrame) => void> = {
  [OwlState.WaitLaunch]: OwlStateWaitLaunchDelay,
  [OwlState.Circle]: (o) => OwlStateCircleHoldingPoint(o),
  [OwlState.FlyToCircle]: (o) => OwlStateFlyToHoldingPoint(o),
  [OwlState.Approach]: OwlStateRideApproachSpline,
  [OwlState.Dive]: OwlStateDiveAtCamera,
  [OwlState.OrbitAway]: OwlStateOrbitAwayAfterStrike,
  // `g_class43_states[6]` is a bare `RET` at `0x00420810`.
};

/**
 * `OwlUpdateAndResolveShot` — `FUN_004460C0`.
 *
 * The shot first, then the state, then the yaw. The yaw steering is the part
 * worth reading twice: **states 1 and 2 point the owl along its own velocity
 * and the attack states point it at the camera**, and the turn is a tenth of
 * the error a frame, or a quarter while circling.
 *
 * The tail runs on every frame the owl is alive, **the death frame
 * included**: the camera point and `RegisterForCameraTracking`, then the
 * owl's own position through the view into `obj+0x70..0x78` and
 * `RegisterForShotTest` (`0x0044644E`..`0x00446488`). The corpse routine that
 * replaces this one makes neither call, so a corpse is never a candidate for
 * a bullet — which is why the class registers the engine's way
 * (`ClassHandler.registersForShotTest`) rather than being picked by its
 * sphere from `render/`, where a corpse went on taking the shots meant for
 * the owl behind it.
 */
export function OwlUpdateAndResolveShot(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (sub.state === OwlState.Dead) {
    OwlCorpseFallAndSettle(obj, f.events);
    return;
  }
  // **The death block falls through** (`0x004462EF` into `0x004462F5`): the
  // state it has just set is 6, whose table entry is a bare `RET`, and the
  // yaw below still steers on the frame the owl dies. Bit 3 is not cleared:
  // see `OwlResolveShot`.
  OwlResolveShot(obj, f);
  g_class43_states[sub.state]?.(obj, f);

  if (sub.state !== OwlState.WaitLaunch) {
    let h = BamsOf(obj.pos.x - sub.prevX, obj.pos.z - sub.prevZ);
    obj.yaw &= 0xffff;
    const faceCamera = sub.state === OwlState.Dive
      || (sub.state === OwlState.Approach && sub.subtype !== 2)
      || (sub.state === OwlState.OrbitAway && sub.timer > 0)
      || (sub.state === OwlState.Approach && sub.timer > 0);
    if (faceCamera) h = BamsOf(f.eye.x - obj.pos.x, f.eye.z - obj.pos.z);
    // `SUB AX, [ESI+0x68]; AND EAX, 0xFFFF; CMP ECX, 0x8000; JLE` then
    // `SUB ECX, 0x10000`: the error runs `-0x7FFF..+0x8000`, so a target
    // exactly behind turns the positive way.
    let e = (h - obj.yaw) & 0xffff;
    if (e > 0x8000) e -= 0x10000;
    obj.yaw += Math.trunc(sub.state === OwlState.Circle ? e / 4 : e / 10);
  }
  // `OwlDrawBodyChain`, then the camera point: the circle's centre four units
  // up while circling (`obj+0x1DC`, `+0x1E0 + 4.0`), the owl itself otherwise,
  // and `RegisterForCameraTracking` -- on every frame the owl is alive.
  if (sub.state === OwlState.Circle) {
    obj.lookAt.x = sub.centreX;
    obj.lookAt.y = sub.centreY + OWL_CIRCLE_LOOK_RISE;
    obj.lookAt.z = sub.centreZ;
  } else {
    obj.lookAt.x = obj.pos.x;
    obj.lookAt.y = obj.pos.y;
    obj.lookAt.z = obj.pos.z;
  }
  RegisterForCameraTracking(obj);
  // `MatrixTransformPoint(obj+0x40, obj+0x70)` and `RegisterForShotTest(obj)`.
  // The port keeps `obj+0x70..0x78` in world space (`Actor.shotCentre`) and
  // the shot test takes the depth itself: the owl's point, unlifted.
  obj.shotCentre.x = obj.pos.x;
  obj.shotCentre.y = obj.pos.y;
  obj.shotCentre.z = obj.pos.z;
  RegisterForShotTest(obj, f.host);
  sub.prevX = obj.pos.x;
  sub.prevY = obj.pos.y;
  sub.prevZ = obj.pos.z;
}

/** `+ 4.0` on the circling owl's camera point, `OwlUpdateAndResolveShot`. */
export const OWL_CIRCLE_LOOK_RISE = 4.0;

// -- the class -------------------------------------------------------------

const handler: ClassHandler = {
  init: PlaceOwlFlockMember,
  update: OwlUpdateAndResolveShot,
  updatesWhenDead: true,
  ownsShotResult: true,
  registersForShotTest: true,
  /**
   * The owl has no leave routine in the exe; this stands in for one under
   * `RetireUnlistedActor`'s declared divergence, and it gives back only what
   * the death block would: the token if the owl holds it — which is state 4,
   * the one state the death block tests — and both counts **unless the owl is
   * already a corpse**, which gave them back when it died. It used to test
   * the token against `obj+0x228`, which two groups in one block share, and
   * to release the counts whatever the owl's state. (Owls are slot actors,
   * which nothing retires today, so neither was reached; the hook should
   * still say what the death block says.)
   */
  leave(obj: Actor): void {
    const sub = Tail(obj);
    if (sub && sub.state === OwlState.Dive) G.g_class43_attack_token = -1;
    if (!(obj.flags & OwlFlag.Corpse)) {
      G.g_enemies_alive -= 1;
      G.g_enemies_present -= 1;
    }
    ActorDespawn(obj);
  },
  /**
   * Nothing. The owl gives everything back in its own death block — the
   * counts, the camera slot, and the token if it was diving — and its corpse
   * gives nothing back when it despawns. The hook is here so the generic
   * teardown, which would retire both counts a second time, is not run; it
   * used to free `g_class43_attack_token` whenever the despawned owl's member
   * index matched it, which in stage 2 block 5 is an owl of the other group.
   */
  onDeadSweep(): void {},
  debug(obj: Actor): ActorDebug {
    const sub = Tail(obj);
    if (!sub) return { summary: "owl" };
    return {
      summary: `${OwlState[sub.state]}/${sub.timer}`,
      detail: [
        `sub-type ${sub.subtype} · member ${sub.member} · dive ${OwlDiveKind[sub.dive]}`,
        `token ${G.g_class43_attack_token} · beat ${sub.beat} · t=${sub.t.toFixed(2)}`,
      ],
      hot: G.g_class43_attack_token === sub.member,
    };
  },
};

registerClass(SpawnClass.FlyingEnemy, handler);

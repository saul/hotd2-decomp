/**
 * Class 0x46 — **the bat**.
 *
 * Both of the binary's name tables agree, independently. The body's character
 * type `0x1E` resolves through `g_character_skeletons` to **`zabat.bin`** (one
 * node, asset slot `0x1B01`) and the wing actor's `0x1F` to
 * **`zabat_wing.bin`** (six nodes, two three-segment chains). And every death
 * plays `COMMON2\KOUMORI1_22.wav` or `KOUMORI2_22.wav`; *kōmori* is Japanese
 * for bat. Those are the `KOUMORI` records `game/class43/` notes as existing
 * and unplayed by the owl — this is the class that plays them.
 *
 * The evt step that places the stage-4 flight plays `HABATAKI6_16.wav`,
 * *habataki*, the beat of wings, one instruction before the spawn.
 *
 * ## The handler is a placer with three flights
 *
 * `PlaceBats` ends every path in `ActorKill`. What it leaves behind is one or
 * more `0x13D8`-byte skinned actors, and `obj+0x130C` — the opcode-0x09
 * descriptor's `+0x25` — picks which of three routines they run. See
 * {@link BatSubtype}. The three disagree about more than their trajectory:
 * about the hit gate, the gravity, the exit, and whether the enemy counters
 * move at all.
 *
 * ## The descriptors say almost nothing
 *
 * All twenty-four sub-type-0 spawns sit at the world origin with a yaw of
 * `0x8000`, and two bytes tell them apart: `+0x11C` is the member index plus
 * one and `desc+0x24` is the flight group. The pair indexes
 * {@link BAT_SPLINE_POINTS}, and the path is in the EXE. **A one-player game
 * builds only four of the six** — the guard is
 * `1 < g_players_in_play || +0x11C < 5`.
 *
 * ## It is a sphere, not a skeleton
 *
 * `PlaceBats` writes `obj+0x34 = (obj+0x34 & ~0x80) | 0x80000`, and bit `0x80`
 * is the one `ShotTestSphere` (`FUN_00404630`) tests before it descends into
 * the bones. Clearing it makes the bat one sphere of radius 4.0 at
 * `obj+0x124`, whole — the same shape the mouse and the owl are hit in, and a
 * deliberate choice rather than an accident of having one bone.
 *
 * ## Nothing stops a bat reaching you
 *
 * There is no range test, no attack permit and no `g_attack_permits` here at
 * all. A sub-type-0 bat flies its spline, homes on `g_camera_block_eye` over
 * about 67 frames, calls `PlayerTakeDamage` and despawns; a sub-type-2 bat
 * orbits and then does the same over 100. **An unshot bat always connects and
 * always leaves**, which is also why the `wait_enemies_present 0` behind each
 * flight cannot deadlock: the flight ends itself.
 *
 * ## The wings are a second actor
 *
 * `SpawnBatWings` (`FUN_0042E060`) builds a second skinned actor per bat:
 * character type `0x1F`, six nodes in two three-segment chains, running clip
 * `0x406` off its body's own motion clock, seated on the body's bone matrix
 * and translated `(0, 1, 2)`. It finds its body in {@link G.g_bat_members}
 * every frame and **despawns the frame that slot goes empty**, which is the
 * whole of how a bat's wings follow it and die with it -- and the only way a
 * wing ever goes.
 *
 * ## How every bat is drawn, and how the port finds the geometry
 *
 * **All three sub-types draw the same way** `[proved]`: each arm of
 * `PlaceBats` writes `obj+0x1F4 = 0x1E`, clip `0x407`, `obj+0x1FC = 5`, calls
 * `ActorBuildSkinnedModel` and installs `BatDrawBoneSlot` (`FUN_0042E020`,
 * the per-bone hook, which draws the node's own slot and nothing else), and
 * each update opens `DrawSkinnedModelAndShadow` (`FUN_00411090`). The model is keyed on the
 * character type alone: `zabat.bin`'s one node, and for the wing
 * `zabat_wing.bin`'s six. Nothing about a member's descriptor, or its lack of
 * one, enters the draw.
 *
 * The port's character layer binds a drawable hierarchy to a **spawn
 * address**, so an actor the script did not place needs a row in the bundle
 * to be drawn at all -- the arrangement the horde's members, JUDGMENT's
 * sub-actor and the players' bodies already have. The exporter emits a
 * **synthetic** row, of character type `0x1E` or `0x1F`, at the address the
 * port's placer gives each actor it makes ({@link BatChildAt},
 * {@link BatWingAt}), parented to the descriptor that placed it, so the row
 * is wanted exactly while the placer is: one wing per sub-type-0 bat, and 25
 * bodies and 25 wings behind the scatter's descriptor, 8 and 8 behind each
 * swarm's (the most a two-player game makes). `SpawnScriptedCharacters`
 * refuses to build from a synthetic row, and the layer adopts the object the
 * placer already made -- the row is geometry and an address, no more.
 *
 * `render/characters/bat.ts` then places each root the way
 * `SkeletonApplyRootMotion` (`FUN_00410C50`) does for `obj+0x1FC = 5`:
 * `T(pos) Rz(roll) Ry(yaw) Rx(pitch)` and `MatrixScale(model+0x116C)`, 0.6
 * for the body and 0.7 for the wing.
 *
 * ## Shot as one sphere, and it took a bug report to find out why
 *
 * `PlaceBats` writes `obj+0x34 = (obj+0x34 & ~0x80) | 0x80000`, and bit `0x80`
 * is the one `ShotTestSphere` (`FUN_00404630`) tests before it descends into
 * the bone tree. The corroboration is in the data and is the stronger half:
 * `g_character_bone_spheres` (`0x004D032C`) holds **radius 0** for character
 * type `0x1E`'s one bone, so `ShotTestSkeleton` could resolve nothing on a bat
 * even if the bit were set. What the shot measures is `obj+0x124` = 4.0
 * around the point the update publishes at `obj+0x70`, which is
 * `(x, y + 1, z)`.
 *
 * ## Who registers, and when
 *
 * The bat registers **the engine's way** (`ClassHandler.registersForShotTest`):
 * each routine calls `RegisterForShotTest` (`FUN_00405160`) at its own site,
 * and the pick finds a bat through `g_shot_test_list` and nothing else. The
 * three routines do not agree about when, and that is the point of doing it
 * at their sites rather than once for the class:
 *
 * * `BatDiveUpdate` and `BatSwarmUpdate` register at their tails, in **every**
 *   state -- waiting, flying and falling. A diving bat can therefore be hit
 *   during its launch delay; its gate refuses the hit and leaves bit 3 of
 *   `obj+0x34` standing, and the first frame it flies, the same gate takes
 *   it. Nothing between the two frames clears that bit: a sweep of the image
 *   for `AND` with `0xFFFFFFF7` or `0xF7` finds no site in the task walk,
 *   `TaskRunTree` (`FUN_004A71A0`), or in the shot processor, only class
 *   routines consuming their own hit. `[likely]` -- a clear by some other
 *   encoding is not excluded.
 * * `BatScatterUpdate` registers only at the end of its flying arm, so a
 *   scattering bat is a target only while it flies, and its hit is taken
 *   **inside** that arm -- the kill frame still runs the flight's
 *   acceleration, and the corpse's first fall is the frame after.
 * * `BatWingUpdate` never registers. A wing is drawn and never shot; the
 *   wing's bone 3 carries a 0.3 sphere in `g_character_bone_spheres`, and a
 *   pick that walked every drawn bone -- this class's first cut -- let a wing
 *   take a bullet meant for the bat behind it.
 */
import { BAMS_TO_RAD, RAD_TO_BAMS } from "../../core/bams";
import type { Rng } from "../../core/rng";
import type { Events } from "../../core/events";
import { ActorFlag, MotionFlag, type Actor } from "../actor";
import { PlayerTakeDamage } from "../combat/player";
import { ScoreAddForPlayer } from "../combat/score";
import { RegisterForShotTest } from "../combat/shot_test";
import { ActorDespawn } from "../despawn";
import { CameraSlotVacate, RegisterEnemySlot, RegisterForCameraTracking }
  from "../camera/slots";
import {
  MatIdentity, MatrixGetTranslation, MatrixRotateX, MatrixRotateY,
  MatrixRotateZ, MatrixScale, MatrixTranslate, type Mat,
} from "../matrix";
import {
  ReleaseEnemyAliveCount, ReleaseEnemyPresentCount,
} from "../combat/counts";
import { ActorReleaseHitSlot } from "../hit_slots";
import { SpawnBloodSprayAtPoint } from "../effects/blood";
import { G, PlayerState } from "../globals";
import { DrawSkinnedModelAndShadow } from "../skeleton";
import { CameraBlockEye, CameraBlockYaw } from "../camera/view";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
  type SpawnRecord,
} from "../registry";
import { ActorBuildSkinnedModel, ActorSpawn } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { CharacterTypeOf, MotionAuthoredFrame, MotionOf, T } from "../tables";
import { vec3, type Vec3 } from "../vec";
import { SpawnBatSplash } from "./splash";
import { BatState, BatSubtype, type BatTail } from "./state";

export { BatState, BatSubtype } from "./state";
export type { BatDescriptor, BatTail } from "./state";
export {
  BAT_SPLASH_FIRST_SLOT, BAT_SPLASH_LAST_FRAME, BAT_SPLASH_Y,
  BatSplashesTick, SpawnBatSplash, type BatSplash,
} from "./splash";

/** BAMS to radians, and back. One definition, and it is `core/bams.ts`'s. */
const BAMS = BAMS_TO_RAD;
const TO_BAMS = RAD_TO_BAMS;

// -- what the class spells as literals --------------------------------------

/** `obj+0x1F4` — `zabat.bin`, one node. */
export const BAT_CHAR_TYPE = 0x1e;
/** `obj+0x1F4` of the wing actor — `zabat_wing.bin`, six nodes. */
export const BAT_WING_CHAR_TYPE = 0x1f;
/** `obj+0x1B4` — the 22-frame body clip, and the wing's 16-frame one. */
export const BAT_CLIP = 0x407;
export const BAT_WING_CLIP = 0x406;
/** `obj+0x124` — the sphere `ShotTestSphere` measures. There are no bones. */
export const BAT_HIT_RADIUS = 4.0;
/**
 * `obj+0x34`'s bit `0x80000`, which every arm of `PlaceBats` ORs in after the
 * model is built, and `SpawnBatWings` writes whole as `0x80001` before it:
 * {@link ActorFlag.NoShadow}. Every draw a bat or a wing makes is a
 * `DrawSkinnedModelAndShadow` (`FUN_00411090`), whose last call is the
 * ground shadow under `g_cur_actor` -- and each update points that at itself
 * first -- so this is what keeps a bat's disc off the floor under it. `[proved]`
 */
export const BAT_FLAG_80000 = 0x80000;
/** `obj+0x34 = 1` -- `PlaceBats` overwrites the word before the build. */
export const BAT_FLAGS_INIT = 1;
/** `obj+0x34 = 0x80001` -- `SpawnBatWings`, before the build. */
export const BAT_WING_FLAGS_INIT = 0x80001;
/** `ScoreAddForPlayer(p, 0x50)`. */
export const BAT_SCORE = 0x50;
/** `PlayerTakeDamage(player, 1, 9)`. */
export const BAT_DAMAGE_KIND = 9;
/** `g_bat_members` is 25 slots per sub-type. */
export const BAT_MEMBERS_PER_SUBTYPE = 0x19;

/** `obj+0x194 = +0x11C * 7` — the motion phase, so a flight is not in step. */
export const BAT_DIVE_MOTION_PHASE = 7;
/** `obj+0x13D0 = member * 0x14` — twenty frames between launches. */
export const BAT_DIVE_LAUNCH_STAGGER = 0x14;
/** `obj+0x13D4 += 0.05` — twenty frames a segment, two segments, forty in all. */
export const BAT_SPLINE_RATE = 0.05;
/** `obj+0x13A4 += 0.015` — about 67 frames from the spline's end to the eye. */
export const BAT_DIVE_HOME_RATE = 0.015;
/** ...and the swarm's, which is slower. */
export const BAT_SWARM_HOME_RATE = 0.01;
/** The clip's own root Y, times this, is the bat's bob. */
export const BAT_DIVE_BOB_SCALE = 5.0;
export const BAT_SWARM_BOB_SCALE = 8.0;
/** `obj+0x13A8` is 1.0 until the homing parameter passes this... */
export const BAT_WOBBLE_HOLD = 0.8;
/** ...and then `(1 - t) *` this, so it damps to nothing exactly on arrival. */
export const BAT_WOBBLE_DECAY = 5.0;
/** `obj+0x1380 += 0x800` a frame, and the wobble is that sine times this. */
export const BAT_WOBBLE_STEP = 0x800;
export const BAT_WOBBLE_SCALE = 3.0;

/** Sub-type 1: twenty-five members, two frames apart. */
export const BAT_SCATTER_MEMBERS = 0x19;
export const BAT_SCATTER_STAGGER = 2;
/** Its launch velocity, drawn per member, and the two accelerations. */
export const BAT_SCATTER_VX_STEPS = 0x65;
export const BAT_SCATTER_VX_SCALE = 0.001;
export const BAT_SCATTER_VX_BIAS = -0.05;
export const BAT_SCATTER_VX_GAIN = 0.8;
export const BAT_SCATTER_VY_STEPS = 0xb;
export const BAT_SCATTER_VY_SCALE = 0.001;
export const BAT_SCATTER_VY_BIAS = 0.01;
export const BAT_SCATTER_VZ = 2.0;
export const BAT_SCATTER_ACCEL_XZ = 1.05;
export const BAT_SCATTER_ACCEL_Y = 1.08;
/** ...and where it stops being anyone's problem. */
export const BAT_SCATTER_GONE_Z = -3500.0;
/** Its spawn box: `rand() % 0x15` on x, `rand() % 0xB` hundredths on y. */
export const BAT_SCATTER_X_STEPS = 0x15;
export const BAT_SCATTER_X_BIAS = -40.0;
export const BAT_SCATTER_Y_STEPS = 0xb;
export const BAT_SCATTER_Y_SCALE = 0.01;

/**
 * Sub-type 2's member count: **six with one player and eight with two**.
 *
 * `((1 < g_players_in_play) - 1 & 0xFFFFFFFE) + 8`, which is `8` when the test
 * holds and `-2 + 8` when it does not. It reads like "eight, or ten with two
 * players" and is the other way round.
 */
export const BAT_SWARM_MEMBERS_1P = 6;
export const BAT_SWARM_MEMBERS_2P = 8;
/** `obj+0x13D0 = 0x3C + member * 0x14` — the swarm peels off one at a time. */
export const BAT_SWARM_ORBIT_BASE = 0x3c;
export const BAT_SWARM_ORBIT_STAGGER = 0x14;
/** `obj+0x135C += 0x400` a frame — a lap in 64. */
export const BAT_SWARM_ORBIT_STEP = 0x400;
/** `obj+0x135C = member << 13`, so the swarm is spread round the circle. */
export const BAT_SWARM_PHASE_SHIFT = 13;
/** The radius breathes: `12 + 5·sin`, its phase wound by a random step. */
export const BAT_SWARM_RADIUS = 12.0;
export const BAT_SWARM_RADIUS_SWING = 5.0;
export const BAT_SWARM_RADIUS_STEPS = 0x201;
export const BAT_SWARM_RADIUS_BASE_STEP = 0xe00;
/** Its members are scattered `rand() % 0x191` hundredths, less two, per axis. */
export const BAT_SWARM_SCATTER_STEPS = 0x191;
export const BAT_SWARM_SCATTER_SCALE = 0.01;
export const BAT_SWARM_SCATTER_BIAS = -2.0;
/** `obj+0x194 = member * 10` — the swarm's motion phase. */
export const BAT_SWARM_MOTION_PHASE = 10;

/** The corpse: two gravities, a pitch cap, a yaw spin, and two exits. */
export const BAT_CORPSE_GRAVITY = 0.02722;
export const BAT_SCATTER_CORPSE_GRAVITY = 0.04083;
export const BAT_CORPSE_PITCH_STEP = 0x200;
export const BAT_CORPSE_PITCH_CAP = 0x8000;
export const BAT_CORPSE_YAW_STEP = 0x800;
/** Sub-type 0 counts frames; sub-types 1 and 2 fall to the water plane. */
export const BAT_CORPSE_FRAMES = 0x50;
export const BAT_CORPSE_SPLASH_Y = -25.0;
/** How much of its own motion each corpse keeps, and the fling it is given. */
export const BAT_DIVE_CORPSE_FLING = 0.5;
export const BAT_SCATTER_CORPSE_DAMP = -0.3;
export const BAT_SWARM_CORPSE_DAMP = -0.5;

/** `COMMON2\KOUMORI1_22.wav`, `KOUMORI2_22.wav`, `COMMON\SIBUKI8_16.WAV`. */
export const SND_BAT_KILLED_A = 0x4b17a9;
export const SND_BAT_KILLED_B = 0x4c17a9;
export const SND_BAT_SPLASH = 0x4616a9;
/** `g_scene_index` 2 is stage 3, and the swarm's splash is heard only there. */
export const BAT_SPLASH_SCENE = 2;

/**
 * `g_bat_spline_points` — `0x00589944`. `s16 pts[12][4][3]`.
 *
 * Twelve flight paths of four control points, indexed
 * `group * 3 + member % 3`, so the six members of a flight share three paths
 * two apiece. The four groups are the four flights in the game: 0 is stage 4
 * block 0 step 6, 1 is stage 3 block 4 step 5, 2 is stage 4 block 2 step 6 and
 * 3 is stage 4 block 10 step 1.
 *
 * The table is `.rdata` the exporter could carry, and it is transcribed here
 * for the same reason `OWL_APPROACH_CURVES` is: twelve rows of three integers
 * is smaller than the bundle plumbing that would deliver them, and putting the
 * numbers next to the routine that walks them is what lets a reader check both
 * at once. `web/tools/checks/bats.ts` asserts them against the EXE.
 */
export const BAT_SPLINE_POINTS: readonly (readonly (readonly [number, number,
  number])[])[] = [
  [[112, -11, -260], [102, -7, -228], [113, -13, -184], [100, -12, -142]],
  [[108, -10, -260], [99, -5, -228], [110, -10, -184], [108, -12, -142]],
  [[104, -9, -260], [110, -10, -228], [100, -11, -184], [104, -9, -142]],
  [[-1103, 85, -3818], [-1102, 60, -3780], [-1101, 50, -3760],
   [-1100, 20, -3740]],
  [[-1103, 85, -3818], [-1100, 60, -3780], [-1099, 50, -3760],
   [-1100, 40, -3740]],
  [[-1103, 85, -3818], [-1102, 65, -3780], [-1103, 30, -3760],
   [-1100, 20, -3740]],
  [[138, 40, -930], [151, -26, -848], [128, -37, -819], [150, -36, -800]],
  [[158, 37, -940], [128, -15, -868], [140, -20, -839], [138, -30, -810]],
  [[118, 35, -950], [145, -10, -848], [130, -20, -830], [130, -36, -820]],
  [[-104, -15, -507], [-110, -35, -490], [-100, -45, -480], [-104, -60, -470]],
  [[-90, -15, -507], [-100, -30, -490], [-95, -45, -485], [-110, -75, -475]],
  [[-110, -15, -507], [-120, -40, -490], [-100, -55, -480], [-100, -70, -475]],
];

// -- helpers ----------------------------------------------------------------

function Tail(obj: Actor): BatTail | null {
  return (obj as Actor & { bat?: BatTail }).bat ?? null;
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

/** Which slot of `g_bat_members` this actor owns. */
function MemberSlot(sub: BatTail): number {
  return sub.subtype * BAT_MEMBERS_PER_SUBTYPE + sub.member;
}

/**
 * `[port-only]` — `obj+0x204`, the clip's root translation for the frame the
 * model was just drawn at.
 *
 * `SkeletonPoseRootFrame` (`FUN_00410920`) writes `model+0x6C/0x70/0x74` from
 * the current frame's root every time the model is drawn, so `obj+0x204` is
 * the **Y** of it. Both flying sub-types add a multiple of it to their height,
 * which is the whole of the bat's bob: the flight path itself is smooth and
 * the up-and-down comes from the wing clip.
 *
 * The port has no model record, so the same number is read out of the baked
 * motion at the frame the motion clock is on.
 */
function ClipRootY(obj: Actor): number {
  const m = MotionOf(obj, obj.motion);
  if (!m) return 0;
  const f = Math.min(MotionAuthoredFrame(obj, m), m.frames - 1);
  return m.root[f * 3 + 1] ?? 0;
}

/**
 * `BatSplineWeights` — `FUN_0042DFD0`.
 *
 * The uniform quadratic B-spline basis: `(1-t)²/2`, `(1-t)t + ½`, `t²/2`,
 * which sum to 1. Its first argument, the segment index, is **unused** — the
 * caller adds it to the control-point index instead — and is kept so the two
 * halves read alike. It is the same basis class 0x43's approach spline uses.
 */
export function BatSplineWeights(_segment: number, t: number):
    [number, number, number] {
  const u = 1 - t;
  return [(u * u) / 2, u * t + 0.5, (t * t) / 2];
}

/**
 * One point of a flight path.
 *
 * `pts[slot][seg + k]` for `k` in 0..2 against {@link BatSplineWeights}, which
 * is why a bat starts at the midpoint of the first two control points rather
 * than at the first.
 */
function BatSplinePoint(slot: number, segment: number, t: number):
    [number, number, number] {
  const row = BAT_SPLINE_POINTS[slot] ?? BAT_SPLINE_POINTS[0];
  const [w0, w1, w2] = BatSplineWeights(segment, t);
  const p0 = row[segment] ?? row[0];
  const p1 = row[segment + 1] ?? p0;
  const p2 = row[segment + 2] ?? p1;
  return [
    p0[0] * w0 + p1[0] * w1 + p2[0] * w2,
    p0[1] * w0 + p1[1] * w1 + p2[1] * w2,
    p0[2] * w0 + p1[2] * w1 + p2[2] * w2,
  ];
}

/**
 * The yaw ease all three routines share, and the one thing they tune.
 *
 * ```c
 * err = (u16)(-(s16)obj+0x68) - ftol(atan2(dx, dz));
 * err &= 0xFFFF; if (err > 0x8000) err -= 0x10000;
 * obj+0x68 = (obj+0x68 + err / divisor) & 0xFFFF;
 * ```
 *
 * Written out rather than routed through `bamsDelta` because the wrap is not
 * quite the usual one: `0x8000` stays **positive** here, where a symmetric
 * delta would make it `-0x8000`. One value in 65536, and reproducing it costs
 * nothing.
 */
function BatEaseYaw(obj: Actor, dx: number, dz: number, divisor: number): void {
  const h = BamsOf(dx, dz);
  let err = ((-s16(obj.yaw) - h) & 0xffff);
  if (err > 0x8000) err -= 0x10000;
  obj.yaw = (obj.yaw + Math.trunc(err / divisor)) & 0xffff;
}

/**
 * The lateral wobble both homing runs carry.
 *
 * `MatrixRotateY(g_camera_block_yaw_bams + 0x8000)` applied to
 * `(sin(obj+0x1380 · BAMS), 0, 0)` — the camera's own right-hand axis, turned
 * to face it — scaled by `obj+0x13A8 * 3`. `MatrixRotateY(θ)` takes the x axis
 * to `(cos θ, 0, -sin θ)`, which `BuildSceneLightDirection` (`FUN_0040E0B0`)
 * is the proof of: it takes `(0, 0, 1)` to `(sin θ, 0, cos θ)`.
 *
 * The yaw is the camera block's -- `g_camera_block_yaw_bams` (`0x009A60D0`) of
 * the block `g_camera_index` names, `[index * 0x1A4 + 0x9A60D0]` --
 * read at `0x0042E7FE` in the dive and `0x0042F0C9` in the swarm. This read
 * `g_camera_yaw_bams` (`0x009C71F0`), which the scene state's hooks write as
 * a camera heading turned half round, and so wobbled every bat the other way.
 * `[proved]`
 */
function BatApplyWobble(obj: Actor, sub: BatTail): void {
  sub.phase += BAT_WOBBLE_STEP;
  const s = Math.sin(sub.phase * BAMS);
  const a = (CameraBlockYaw(G.g_camera_index) + 0x8000) * BAMS;
  const k = sub.wobble * BAT_WOBBLE_SCALE;
  obj.pos.x += s * Math.cos(a) * k;
  obj.pos.z += -s * Math.sin(a) * k;
}

/**
 * The strike, shared by {@link BatDiveUpdate} and {@link BatSwarmUpdate}.
 *
 * `obj+0x121` picks the victim — a coin with two players, `g_active_player`
 * with one, and **left where it was** when that is -1 or 2, the same asymmetry
 * `OwlPickTargetPlayerAndAimOffset` has. Then both counters come back and the
 * actor goes. No range test: reaching `t > 1` is the whole condition.
 *
 * **No permit either, and no `IsPlayerAttackable`** (`FUN_00409DC0`): the
 * only gate is the bare `g_player_state == 5` for either player, read at
 * `0x0042E88A` in the dive and `0x0042F1B5` in the swarm. The damage call is
 * `PlayerTakeDamage(obj+0x121, 1, 9)` -- a non-zero second argument, so the
 * hit latch and hit motion 9 are written. That gate is why the page's bats
 * never hurt: `g_player_state` used to be seeded 0, and nothing but a test
 * ever wrote 5 (see `g_player_state` in `globals.ts`).
 */
function BatStrikeAndLeave(obj: Actor, sub: BatTail, f: ClassFrame): void {
  if (G.g_player_state[0] === PlayerState.InPlay
      || G.g_player_state[1] === PlayerState.InPlay) {
    if (G.g_players_in_play === 2) {
      obj.attackPermit = f.rng.int(2);
    } else {
      if (G.g_active_player === 0) obj.attackPermit = 0;
      if (G.g_active_player === 1) obj.attackPermit = 1;
    }
    PlayerTakeDamage(obj.attackPermit, 1, BAT_DAMAGE_KIND, f.events, obj);
  }
  BatReleaseCounts(obj);
  BatLeaveMemberSlot(obj, sub);
  ActorReleaseHitSlot(obj);
  ActorDespawn(obj);
}

/**
 * The two decrements, latched.
 *
 * **The engine's are bare `DEC`s**, inline in each routine and guarded by
 * nothing: class 0x46 has no `ReleaseEnemyAliveCount` (`FUN_00456560`) of its
 * own and does not call class 0x30's. It gets away with it because every path
 * that decrements also despawns on the same frame, so no actor can reach two
 * of them. The port has a despawn route the engine does not -- the sweep and
 * {@link ClassHandler.leave} in `despawn.ts` -- so the same fact is written
 * through the latched pair instead. It can only ever refuse a second
 * decrement, which the engine could never make.
 */
function BatReleaseCounts(obj: Actor): void {
  ReleaseEnemyAliveCount(obj);
  ReleaseEnemyPresentCount(obj);
}

/** `g_bat_members[slot] = 0`, which is also what kills the wing. */
function BatLeaveMemberSlot(obj: Actor, sub: BatTail): void {
  const at = G.g_bat_members[MemberSlot(sub)];
  if (at === obj.at) G.g_bat_members[MemberSlot(sub)] = 0;
}

/**
 * The score, the sound and the blood every death pays, identical in all three
 * routines.
 *
 * `rand() & 1` picks between the two `KOUMORI` records. The player is bit 2 of
 * `obj+0x34` — set means player 0, clear means player 1 — and a coin when both
 * are set.
 *
 * The blood is `SpawnBloodSprayAtPoint(obj + 0x40)`, which reads `0x30` past
 * its argument (`MOV EDX, [ECX + 0x30]` at `0x00430C66`): **`obj+0x70`, the
 * view-space point**, not the position. The pointer is `EDI` at `0x0042E34F`
 * and `0x0042EE69` (`LEA EDI, [ESI + 0x40]` at `0x0042E26B` and `0x0042ED8C`)
 * and `EBX` at `0x0042EB9F` (`LEA EBX, [ESI + 0x40]` at `0x0042EA0C`), each
 * loaded before the draw and untouched until the call. Each routine writes
 * `obj+0x70` once, at its tail before `RegisterForShotTest` -- the view of
 * `(x, y + 1, z)`, {@link BatRegisterForShotTest} -- and the kill is taken
 * before the bat moves, so it is last frame's registration. The port holds
 * that point in world space as {@link Actor.shotCentre}, and this is it
 * through the camera. It used to hand the spray the world position, which
 * `render/effects.ts` then drew in the camera's frame.
 */
function BatPayForKill(obj: Actor, f: ClassFrame): void {
  play(f.events, f.rng.int(2) === 0 ? SND_BAT_KILLED_B : SND_BAT_KILLED_A);
  const byP0 = (obj.flags & ActorFlag.HitByPlayer0) !== 0;
  const byP1 = (obj.flags & ActorFlag.HitByPlayer1) !== 0;
  const who = byP0 && byP1 ? f.rng.int(2) : byP0 ? 0 : 1;
  ScoreAddForPlayer(who, BAT_SCORE, f.events);
  G.g_player_hit_count[who] = (G.g_player_hit_count[who] ?? 0) + 1;
  const at = vec3();
  f.host.viewSpaceOfPoint?.(obj.shotCentre, at);
  SpawnBloodSprayAtPoint(at);
}

/**
 * The last lines of each routine that registers:
 *
 * ```c
 * p = (obj+0x40, obj+0x44 + 1.0, obj+0x48);
 * MatrixTransformPoint(&p, obj+0x70);
 * RegisterForShotTest(obj);
 * ```
 *
 * at `0x0042E9B7` in the dive, `0x0042F401` in the swarm and `0x0042ED16` at
 * the end of the scatter's flying arm, and nowhere in the wing.
 *
 * The engine's point is in view space because the shot test is; the port's is
 * in world space ({@link Actor.shotCentre}) and `RegisterForShotTest` takes
 * the depth itself, so the **`+1.0` in y is the whole of what has to travel**.
 * Without it the bat's four-unit sphere sits a quarter of its own radius low.
 */
function BatRegisterForShotTest(obj: Actor, f: ClassFrame): void {
  obj.shotCentre.x = obj.pos.x;
  obj.shotCentre.y = obj.pos.y + BAT_SHOT_SPHERE_LIFT;
  obj.shotCentre.z = obj.pos.z;
  RegisterForShotTest(obj, f.host);
}

/** The `+1.0` above. */
export const BAT_SHOT_SPHERE_LIFT = 1.0;

/**
 * `obj+0x100 = obj+0x40; RegisterForCameraTracking(obj)` -- the dive's and
 * the swarm's tail, on every path that does not despawn (the calls are at
 * `0x0042E973` and `0x0042F3BD`).
 *
 * The camera aims at the bat's **position**, not at a bone: the draw at the
 * top of the update has just written `obj+0x100` from node 1, and this
 * overwrites it. `RegisterForCameraTracking` refuses a corpse, which carries
 * `NoCameraTrack`.
 */
function BatPublishCameraPoint(obj: Actor): void {
  obj.lookAt.x = obj.pos.x;
  obj.lookAt.y = obj.pos.y;
  obj.lookAt.z = obj.pos.z;
  RegisterForCameraTracking(obj);
}

/** The pitch and yaw tumble all three corpses share. */
function BatTumble(obj: Actor): void {
  if (obj.pitch < BAT_CORPSE_PITCH_CAP) obj.pitch += BAT_CORPSE_PITCH_STEP;
  obj.yaw += BAT_CORPSE_YAW_STEP;
}

// -- the Init ---------------------------------------------------------------

/**
 * `SpawnBatWings` — `FUN_0042E060`.
 *
 * A second skinned actor of character type `0x1F`, running `BatWingUpdate`.
 * It carries the body's sub-type and member index and **nothing else** — no
 * position, no counter, no shot sphere — because it finds the body in
 * `g_bat_members` every frame and takes everything from there.
 *
 * `[port-only]` the spawn address. The engine's wing has no descriptor at all;
 * the port needs an `at` to key the pool on, so it takes the body's with the
 * high bit set, which no evt offset can collide with.
 */
export function SpawnBatWings(obj: Actor, sub: BatTail, rng?: Rng): void {
  const wing = ActorSpawn(BatWingAt(obj.at), SpawnClass.Bat,
                          BAT_WING_CHAR_TYPE, "bat wing",
                          { motion: BAT_WING_CLIP, visible: true }, rng);
  // `obj+0x34 = 0x80001` and then the build, which claims the wing a hit slot
  // and raises `0x80` -- which, unlike `PlaceBats`, this never takes back. It
  // cannot matter: the wing never registers for the shot test.
  wing.flags = BAT_WING_FLAGS_INIT;
  ActorBuildSkinnedModel(wing);
  // `obj+0x194 = 0`; `BatWingUpdate` copies the body's over it every frame.
  wing.playTicks = 0;
  // The wing never calls `RegisterForCameraTracking` (`FUN_00408EC0`), and
  // neither does a scatter member, so neither is ever a camera candidate.
  const w = Tail(wing);
  if (!w) return;
  w.isWing = true;
  w.subtype = sub.subtype;
  w.member = sub.member;
}

/**
 * `[port-only]` — the wing's spawn address, derived from its body's: bit 30,
 * which neither an evt offset nor {@link BatChildAt} ever sets.
 *
 * `hod2lib/characters.ts` writes the same address on the wing's synthetic
 * row (`CLASS46_WING_AT_BIT`), and `web/tools/repo/port.ts` cannot see that the two
 * agree -- so each names the other, and `render.test.ts` adopts one through
 * the other.
 */
export function BatWingAt(bodyAt: number): number {
  return bodyAt | BAT_WING_AT_BIT;
}

/** `[port-only]` — {@link BatWingAt}'s bit. */
export const BAT_WING_AT_BIT = 0x40000000;

/**
 * The part of `PlaceBats` every member of every flight shares.
 *
 * `obj+0x1F4 = 0x1E`, clip `0x407`, `obj+0x34 = 1`, `obj+0x3C = -1`,
 * `ActorBuildSkinnedModel` -- which claims the member a hit slot and raises
 * `obj+0x34` bit `0x80` -- then `obj+0x1FC = 5`, the draw hook, and
 * `obj+0x34 = (obj+0x34 & ~0x80) | 0x80000`: the bit that takes the actor
 * out of the skeleton shot test. `obj+0x1FC` is the rotation order, and the
 * port's is the class's: `render/characters/bat.ts` draws every class-0x46
 * root in order 5.
 */
function BatSeatCommon(obj: Actor, sub: BatTail, subtype: BatSubtype,
                       member: number): void {
  obj.charType = BAT_CHAR_TYPE;
  obj.motion = BAT_CLIP;
  obj.flags = BAT_FLAGS_INIT;
  ActorBuildSkinnedModel(obj);
  obj.flags = (obj.flags & ~ActorFlag.ShootPerBone) | BAT_FLAG_80000;
  obj.hitRadius = BAT_HIT_RADIUS;
  // **The descriptor's `+0x11C` is the member index, not health**, and the
  // engine's member object carries 0 there because it is a fresh allocation
  // the placer never writes it on. The port's spawn path has already put the
  // descriptor's 1..6 in `hp`, so this takes it back out before anything
  // generic can read a member index as a hit-point count. Nothing in the class
  // reads it either way: `ownsShotResult` keeps the shot out of `ResolveHit`.
  obj.hp = 1;
  obj.maxHp = 1;
  // `obj+0x3C = -1` and `obj+0x120 = 0xFF`: no hit slot and no camera slot
  // until something claims one.
  obj.attackPermit = -1;
  sub.subtype = subtype;
  sub.member = member;
  sub.state = BatState.Wait;
  G.g_bat_members[MemberSlot(sub)] = obj.at;
}

/**
 * `PlaceBats` — `FUN_0042D9C0`. Class 0x46's handler, and a placer.
 *
 * `[port-only]` the collapse of two objects into one. The engine allocates a
 * *second* actor and kills the placer; sub-type 0 is one member per descriptor
 * and the port lets the placement's own actor be that member, so the
 * descriptor's own row in the bundle is the member's geometry. Sub-types 1
 * and 2 build real children, as the engine does, the placer despawns behind
 * them, and each child is drawn from a synthetic row at {@link BatChildAt}.
 * The one thing the collapse moves is the member's place in the task list --
 * the placer's, where the engine's is appended after everything alive -- and
 * nothing a bat reads depends on another actor's update in the same frame.
 *
 * **The order of the reads matters and is preserved.** The engine seeds the
 * new object's `obj+0x1348/0x1350` from `sin`/`cos` of *its own* `obj+0x68`,
 * which `ActorClearGameFields` has just zeroed — and only afterwards copies
 * the placer's yaw over it. So the previous-position seed is taken at a yaw of
 * zero, one unit behind in z, whatever the descriptor's yaw says. Collapsing
 * the two objects would have quietly used the descriptor's `0x8000` instead.
 */
export function PlaceBats(obj: Actor, rng?: Rng): void {
  const sub = Tail(obj);
  const p = obj.class46;
  if (!sub || !p) return;
  // A wing built by `SpawnBatWings` runs no Init of its own: the engine's is a
  // different allocation with a different update, and this one has already
  // been filled in by its parent.
  if (sub.isWing) return;
  const subtype = p.subtype as BatSubtype;

  if (subtype === BatSubtype.Dive) {
    // `if (1 < g_players_in_play || obj+0x11C < 5)` — members 5 and 6 exist
    // only in a two-player game.
    if (!(G.g_players_in_play > 1 || p.member + 1 < 5)) {
      ActorDespawn(obj);
      return;
    }
    BatSeatCommon(obj, sub, subtype, p.member);
    sub.group = p.group;
    // `obj+0x194 = obj+0x11C * 7` — the motion phase, in cursor ticks.
    obj.playTicks = (p.member + 1) * BAT_DIVE_MOTION_PHASE;
    const [x, y, z] = BatSplinePoint(sub.group * 3 + sub.member % 3, 0, 0);
    obj.pos.x = x;
    obj.pos.y = y;
    obj.pos.z = z;
    // At a yaw of zero, as above: `sin(0x8000)` is nothing and `cos(0x8000)`
    // is -1, so the heading on the first frame is straight along +z.
    const a = 0x8000 * BAMS;
    sub.prevX = Math.sin(a) + obj.pos.x;
    sub.prevZ = Math.cos(a) + obj.pos.z;
    // ...and **then** `obj+0x64 = placer+0x64; obj+0x68 = placer+0x68;
    // obj+0x6C = 0`. The member faces the way the descriptor does -- `0x8000`
    // for all twenty-four -- until the first frame of the spline turns it.
    // The placer's own angles are this actor's already, so only the roll is
    // written.
    obj.roll = 0;
    sub.timer = sub.member * BAT_DIVE_LAUNCH_STAGGER;
    sub.segment = 0;
    sub.segT = 0;
    sub.wobble = 1.0;
    // `obj+0x120 = 0xFF`, `RegisterEnemySlot` at `0x0042DF82`, both `INC`s.
    RegisterEnemySlot(obj);
    G.g_enemies_present += 1;
    G.g_enemies_alive += 1;
    SpawnBatWings(obj, sub, rng);
    return;
  }

  if (subtype === BatSubtype.Scatter) {
    for (let i = 0; i < BAT_SCATTER_MEMBERS; i += 1) {
      BatSpawnScatterMember(obj, i, rng);
    }
    ActorDespawn(obj);
    return;
  }

  if (subtype === BatSubtype.Swarm) {
    const n = G.g_players_in_play > 1
      ? BAT_SWARM_MEMBERS_2P : BAT_SWARM_MEMBERS_1P;
    for (let i = 0; i < n; i += 1) BatSpawnSwarmMember(obj, i, rng);
    ActorDespawn(obj);
    return;
  }

  // A sub-type the handler has no arm for: `PlaceBats` falls straight through
  // to its own `ActorKill` and nothing is built. No shipped descriptor is one.
  ActorDespawn(obj);
}

/**
 * One member of sub-type 1's twenty-five, and the four `rand()` draws it makes.
 *
 * The order of the draws is load-bearing: x offset, y offset, the sideways
 * velocity, then the climb. A save state that reordered them would restore a
 * different flock.
 */
function BatSpawnScatterMember(placer: Actor, i: number, rng?: Rng): void {
  const at = BatChildAt(placer.at, BatSubtype.Scatter, i);
  // **No `class46` descriptor**, and that is the engine's own shape: a member
  // is built by the placer and has no spawn record at all, so `PlaceBats`
  // returns on its `!p` guard rather than placing a flight of its own. Giving
  // the child the placer's descriptor made every member place twenty-five
  // more of them.
  const child = ActorSpawn(at, SpawnClass.Bat, BAT_CHAR_TYPE, "bat",
                           { visible: true }, rng);
  const sub = Tail(child);
  if (!sub) return;
  BatSeatCommon(child, sub, BatSubtype.Scatter, i);
  // `BatScatterUpdate` calls neither `RegisterForCameraTracking` nor
  // `RegisterEnemySlot`; see the note in {@link SpawnBatWings}.
  child.playTicks = i;
  const dx = rng?.int(BAT_SCATTER_X_STEPS) ?? 0;
  child.pos.x = dx + placer.pos.x + BAT_SCATTER_X_BIAS;
  const dy = rng?.int(BAT_SCATTER_Y_STEPS) ?? 0;
  child.pos.y = dy * BAT_SCATTER_Y_SCALE + placer.pos.y;
  child.pos.z = placer.pos.z;
  sub.prevX = placer.pos.x;
  sub.prevZ = placer.pos.z;
  child.pitch = placer.pitch;
  child.yaw = placer.yaw;
  sub.vx = ((rng?.int(BAT_SCATTER_VX_STEPS) ?? 0) * BAT_SCATTER_VX_SCALE
            + BAT_SCATTER_VX_BIAS) * BAT_SCATTER_VX_GAIN;
  const vy = rng?.int(BAT_SCATTER_VY_STEPS) ?? 0;
  sub.vz = BAT_SCATTER_VZ;
  sub.vy = vy * BAT_SCATTER_VY_SCALE + BAT_SCATTER_VY_BIAS;
  sub.timer = i * BAT_SCATTER_STAGGER;
  SpawnBatWings(child, sub, rng);
}

/** One member of sub-type 2's six or eight, and its three `rand()` draws. */
function BatSpawnSwarmMember(placer: Actor, i: number, rng?: Rng): void {
  const at = BatChildAt(placer.at, BatSubtype.Swarm, i);
  // **No `class46` descriptor**, and that is the engine's own shape: a member
  // is built by the placer and has no spawn record at all, so `PlaceBats`
  // returns on its `!p` guard rather than placing a flight of its own. Giving
  // the child the placer's descriptor made every member place twenty-five
  // more of them.
  const child = ActorSpawn(at, SpawnClass.Bat, BAT_CHAR_TYPE, "bat",
                           { visible: true }, rng);
  const sub = Tail(child);
  if (!sub) return;
  BatSeatCommon(child, sub, BatSubtype.Swarm, i);
  child.playTicks = i * BAT_SWARM_MOTION_PHASE;
  child.pos.y = placer.pos.y;
  const jitter = (): number =>
    (rng?.int(BAT_SWARM_SCATTER_STEPS) ?? 0) * BAT_SWARM_SCATTER_SCALE
    + BAT_SWARM_SCATTER_BIAS;
  sub.fromX = jitter() + placer.pos.x;
  sub.fromY = jitter() + placer.pos.y;
  sub.fromZ = jitter() + placer.pos.z;
  sub.prevX = placer.pos.x;
  sub.prevZ = placer.pos.z;
  sub.timer = BAT_SWARM_ORBIT_BASE + i * BAT_SWARM_ORBIT_STAGGER;
  sub.orbitPhase = i << BAT_SWARM_PHASE_SHIFT;
  // `obj+0x120 = 0xFF`, `RegisterEnemySlot` at `0x0042DB58`, both `INC`s.
  RegisterEnemySlot(child);
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
  SpawnBatWings(child, sub, rng);
}

/**
 * `[port-only]` — a spawn address for a placer's child.
 *
 * The engine has no such thing: a child is a pointer and nothing keys it. The
 * port's pool is keyed on `at`, and so is the character layer's hierarchy, so
 * a placer's members take a derived address: bit 29 for "a bat's child", the
 * sub-type in bits 25..26, the member in bits 20..24 and the placer's own
 * address in the low twenty. Five bits because the scatter has **twenty-five**
 * members; the first cut gave the member four, so members 16..24 took the
 * addresses of 0..8 and two bats answered to one row.
 *
 * `hod2lib/characters.ts` (`batChildAt`) writes the same address on each
 * member's synthetic row, which is how the member is drawn; the two carry each
 * other's names because nothing checks that they agree but the adoption.
 */
export function BatChildAt(placerAt: number, subtype: BatSubtype,
                           member: number): number {
  return BAT_CHILD_AT_BIT | ((subtype & 0x3) << 25) | ((member & 0x1f) << 20)
    | (placerAt & 0xfffff);
}

/** `[port-only]` — {@link BatChildAt}'s marker bit. */
export const BAT_CHILD_AT_BIT = 0x20000000;

// -- being shot -------------------------------------------------------------

/**
 * `[port-only]` — the shot half of the three updates, which have it inline,
 * and each calls this from the place its own copy sits: the dive and the
 * swarm at the top, before the state switch, the scatter inside its flying
 * arm.
 *
 * `obj+0x34` bit 3 is the whole damage model: no `ResolveHit`, no
 * `ActorApplyDamage`, nothing decrements `obj+0x11C`. One bullet.
 *
 * **The gate is not the same in all three, and that is the point.** The dive
 * refuses a hit in {@link BatState.Wait} (`0x0042E29D`), so a diving bat
 * cannot die during its launch delay -- but the bit **stays up**, because only
 * the arm that takes the hit clears it (`AND AL, 0xF7` at `0x0042E2A5`), and
 * it takes the bat on its first flying frame. The scatter has no test at all:
 * it is only ever asked in {@link BatState.Fly}. The swarm tests only
 * `state != Dead`, so a swarm bat can be shot while it is still orbiting.
 * Folding the three into one test is exactly the kind of thing `L11` is
 * about.
 */
export function BatResolveShot(obj: Actor, f: ClassFrame): boolean {
  const sub = Tail(obj);
  if (!sub) return false;
  if (!(obj.flags & ActorFlag.Hit)) return false;
  if (sub.state === BatState.Dead) return false;
  if (sub.subtype !== BatSubtype.Swarm && sub.state === BatState.Wait) {
    return false;
  }
  obj.flags &= ~ActorFlag.Hit;

  // Sub-type 1 is in neither counter, so its death takes nothing out.
  if (sub.subtype !== BatSubtype.Scatter) BatReleaseCounts(obj);
  BatPayForKill(obj, f);
  sub.state = BatState.Dead;
  sub.phase = 0;

  if (sub.subtype === BatSubtype.Dive) {
    obj.flags |= ActorFlag.NoCameraTrack;
    CameraSlotVacate(obj);
    // Flung backwards along its own yaw at a half unit a frame.
    const a = (obj.yaw + 0x8000) * BAMS;
    sub.vx = Math.sin(a) * BAT_DIVE_CORPSE_FLING;
    sub.vz = Math.cos(a) * BAT_DIVE_CORPSE_FLING;
  } else if (sub.subtype === BatSubtype.Scatter) {
    sub.vx *= BAT_SCATTER_CORPSE_DAMP;
    sub.vz *= BAT_SCATTER_CORPSE_DAMP;
  } else {
    obj.flags |= ActorFlag.NoCameraTrack;
    CameraSlotVacate(obj);
    sub.vx *= BAT_SWARM_CORPSE_DAMP;
    sub.vz *= BAT_SWARM_CORPSE_DAMP;
  }
  return true;
}

// -- sub-type 0 -------------------------------------------------------------

/**
 * `BatDiveUpdate` — `FUN_0042E230`. Sub-type 0.
 *
 * Three states. {@link BatState.Wait} counts `obj+0x13D0` down.
 * {@link BatState.Fly} has two arms on `obj+0x13CC`: the spline while there
 * are segments left, then the homing run. {@link BatState.Dead} falls for
 * eighty frames and goes.
 *
 * **The bob is added twice.** The engine computes `obj+0x204 * 5.0` once and
 * then writes `y = spline.y + lift` immediately followed by `y = lift + y`, so
 * a bat on its spline rides at twice the clip's root height. It is reproduced,
 * not tidied — and the latch at the end of the spline stores `y - lift`, one
 * of the two, which is what makes the seam into the homing run continuous.
 */
export function BatDiveUpdate(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  G.g_bat_members[MemberSlot(sub)] = obj.at;
  // The draw, first (`0x0042E271`): its shadow refused by `BAT_FLAG_80000`.
  DrawSkinnedModelAndShadow(obj);
  // The shot, before the state switch -- and the engine **falls straight on**
  // into the switch with the state already `Dead`, so the corpse takes its
  // first step on the frame of the kill.
  BatResolveShot(obj, f);

  if (sub.state === BatState.Wait) {
    const before = sub.timer;
    sub.timer -= 1;
    if (before < 1) sub.state = BatState.Fly;
  } else if (sub.state === BatState.Fly) {
    if (sub.segment < 2) {
      const slot = sub.group * 3 + sub.member % 3;
      const [x, y, z] = BatSplinePoint(slot, sub.segment, sub.segT);
      const lift = ClipRootY(obj) * BAT_DIVE_BOB_SCALE;
      obj.pos.x = x;
      obj.pos.z = z;
      // ...and again, exactly as the engine does it.
      const withLift = lift + (y + lift);
      obj.pos.y = withLift;
      BatEaseYaw(obj, sub.prevX - obj.pos.x, sub.prevZ - obj.pos.z, 8);
      sub.segT += BAT_SPLINE_RATE;
      if (sub.segT > 1.0) {
        sub.segment += 1;
        sub.segT = 0;
        if (sub.segment > 1) {
          sub.fromX = obj.pos.x;
          sub.fromZ = obj.pos.z;
          sub.fromY = withLift - lift;
          sub.t = 0;
        }
      }
    } else {
      if (sub.t > BAT_WOBBLE_HOLD) {
        sub.wobble = (1.0 - sub.t) * BAT_WOBBLE_DECAY;
      }
      // The block `g_camera_index` names (`0x0042E6C5`, `0x0042E707`, `0x0042E73A`).
      const eye = CameraBlockEye(G.g_camera_index);
      obj.pos.x = (eye.x - sub.fromX) * sub.t + sub.fromX;
      obj.pos.y = (eye.y - sub.fromY) * sub.t
        + ClipRootY(obj) * BAT_DIVE_BOB_SCALE * sub.wobble + sub.fromY;
      obj.pos.z = (eye.z - sub.fromZ) * sub.t + sub.fromZ;
      sub.t += BAT_DIVE_HOME_RATE;
      BatEaseYaw(obj, sub.prevX - obj.pos.x, sub.prevZ - obj.pos.z, 8);
    }
    // The heading is taken from the position **before** the wobble, so the
    // wobble never feeds back into the turn.
    sub.prevX = obj.pos.x;
    sub.prevZ = obj.pos.z;
    BatApplyWobble(obj, sub);
    if (sub.t > 1.0) {
      BatStrikeAndLeave(obj, sub, f);
      return;
    }
  } else {
    sub.vy -= BAT_CORPSE_GRAVITY;
    obj.pos.x += sub.vx;
    obj.pos.z += sub.vz;
    obj.pos.y += sub.vy;
    BatTumble(obj);
    const before = sub.phase;
    sub.phase += 1;
    if (before > BAT_CORPSE_FRAMES) {
      ActorReleaseHitSlot(obj);
      BatLeaveMemberSlot(obj, sub);
      ActorDespawn(obj);
      return;
    }
  }
  // Every state that is still here, waiting and falling included.
  BatPublishCameraPoint(obj);
  BatRegisterForShotTest(obj, f);
}

// -- sub-type 1 -------------------------------------------------------------

/**
 * `BatScatterUpdate` — `FUN_0042E9D0`. Sub-type 1.
 *
 * No path at all: the velocity `PlaceBats` drew is scaled by `1.05` and `1.08`
 * every frame, so the flock accelerates away and each member vanishes the
 * moment its z passes -3500. Shootable for the same 80 points, and it
 * **touches neither enemy counter** — no `wait_enemies` gate can see one.
 *
 * A shot member bounces its horizontal velocity by `-0.3` and falls under a
 * heavier gravity than the other two sub-types', to a splash at `y = -25`.
 * Its one descriptor is stage 3 block 2 step 4, over water.
 *
 * **The hit is taken inside the flying arm** (`0x0042EB04`..`0x0042EBD3`),
 * not ahead of the switch as the other two take theirs, and the arm then
 * carries on: the kill frame is a flying frame, with the damped velocity put
 * through the flight's `1.05`/`1.08` and the flight's own despawn test and
 * shot registration, and the corpse's gravity starts on the frame after.
 * Only that arm registers for the shot test (`0x0042ED16`), so a waiting or
 * falling member cannot be hit at all.
 */
export function BatScatterUpdate(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  G.g_bat_members[MemberSlot(sub)] = obj.at;
  // The draw, first (`0x0042EA12`), as the dive's.
  DrawSkinnedModelAndShadow(obj);

  if (sub.state === BatState.Wait) {
    const before = sub.timer;
    sub.timer -= 1;
    if (before < 1) sub.state = BatState.Fly;
    return;
  }
  if (sub.state === BatState.Fly) {
    BatResolveShot(obj, f);
    sub.vx *= BAT_SCATTER_ACCEL_XZ;
    sub.vy *= BAT_SCATTER_ACCEL_Y;
    obj.pos.x += sub.vx;
    obj.pos.y += sub.vy;
    obj.pos.z += sub.vz;
    BatEaseYaw(obj, sub.prevX - obj.pos.x, sub.prevZ - obj.pos.z, 8);
    if (obj.pos.z > BAT_SCATTER_GONE_Z) {
      BatLeaveMemberSlot(obj, sub);
      ActorReleaseHitSlot(obj);
      ActorDespawn(obj);
      return;
    }
    // The decompiler loses this one to an `extraout_ST0` left on the FPU stack
    // by the `fpatan` above: `FADD [EBX]; FST [EBX]` at `0x0042EC01` leaves
    // the new x on the stack, the `FPATAN` consumes the two above it, and the
    // leftover is what is stored here -- the new x, as the other two routines
    // write.
    sub.prevX = obj.pos.x;
    sub.prevZ = obj.pos.z;
    BatRegisterForShotTest(obj, f);
    return;
  }
  sub.vy -= BAT_SCATTER_CORPSE_GRAVITY;
  obj.pos.x += sub.vx;
  obj.pos.z += sub.vz;
  obj.pos.y += sub.vy;
  BatTumble(obj);
  if (obj.pos.y < BAT_CORPSE_SPLASH_Y) {
    BatLeaveMemberSlot(obj, sub);
    SpawnBatSplash(obj.pos.x, obj.pos.y, obj.pos.z);
    ActorReleaseHitSlot(obj);
    play(f.events, SND_BAT_SPLASH);
    ActorDespawn(obj);
  }
}

// -- sub-type 2 -------------------------------------------------------------

/**
 * `BatSwarmUpdate` — `FUN_0042ED50`. Sub-type 2.
 *
 * {@link BatState.Wait} is **not** a wait: it is the orbit. The member circles
 * the point `PlaceBats` scattered for it at `0x400` BAMS a frame — a lap in
 * sixty-four — on a radius of `12 + 5·sin` whose phase advances by a random
 * `0xE00`..`0x1000` every frame, and it runs for `60 + member * 20` frames so
 * the swarm peels off one at a time. {@link BatState.Fly} is the dive:
 * {@link BatDiveUpdate}'s homing arm at `0.01` a frame instead of `0.015`, and
 * a yaw eased a quarter of the way rather than an eighth.
 *
 * **The dive's yaw reads camera block 0**, and its position the block
 * `g_camera_index` selects: the engine indexes `g_camera_block_eye` by
 * `g_camera_index` for the homing (`0x0042EFE4`, `0x0042F016`, `0x0042F05B`,
 * each after `MOV ECX, [0x009c6f00]`) and the block's yaw for the wobble's
 * heading (`0x0042F0C9`), and takes the bare symbol for the yaw's `fpatan`
 * (`0x0042F147`, `0x0042F153`). `[proved]` The two are different blocks
 * whenever the index is 2 -- scene state (1, 3)'s installer writes it, and
 * every checkpoint enters that state -- so each read takes its own:
 * `CameraBlockEye(G.g_camera_index)` for the homing, `G.g_camera_block_eye`
 * for the yaw. This used to read block 0 for both, on the claim that the
 * index is 0 in every shipped write.
 */
export function BatSwarmUpdate(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  G.g_bat_members[MemberSlot(sub)] = obj.at;
  // The draw, first (`0x0042ED92`), as the dive's.
  DrawSkinnedModelAndShadow(obj);
  // The shot, before the switch, as the dive has it -- with the swarm's own
  // gate, which lets an orbiting bat die.
  BatResolveShot(obj, f);

  if (sub.state === BatState.Wait) {
    sub.orbitPhase += BAT_SWARM_ORBIT_STEP;
    const step = (f.rng.int(BAT_SWARM_RADIUS_STEPS))
      + BAT_SWARM_RADIUS_BASE_STEP;
    sub.prevX = obj.pos.x;
    sub.prevZ = obj.pos.z;
    const before = sub.timer;
    sub.radiusPhase += step;
    sub.timer -= 1;
    const r = Math.sin(sub.radiusPhase * BAMS) * BAT_SWARM_RADIUS_SWING
      + BAT_SWARM_RADIUS;
    sub.t = r;
    const a = sub.orbitPhase * BAMS;
    const x = Math.sin(a) * r + sub.fromX;
    obj.pos.x = x;
    const y = ClipRootY(obj) * BAT_SWARM_BOB_SCALE + sub.fromY;
    obj.pos.y = y;
    const z = Math.cos(a) * r + sub.fromZ;
    obj.pos.z = z;
    if (before < 1) {
      sub.fromZ = z;
      sub.state = BatState.Fly;
      sub.t = 0;
      sub.fromX = x;
      sub.fromY = y;
      sub.wobble = 1.0;
    }
    BatEaseYaw(obj, sub.prevX - obj.pos.x, sub.prevZ - obj.pos.z, 2);
  } else if (sub.state === BatState.Fly) {
    if (sub.t > BAT_WOBBLE_HOLD) {
      sub.wobble = (1.0 - sub.t) * BAT_WOBBLE_DECAY;
    }
    const eye = CameraBlockEye(G.g_camera_index);
    obj.pos.x = (eye.x - sub.fromX) * sub.t + sub.fromX;
    // `FMUL [0x0055D2B4]` at `0x0042F035`: **5.0**, the dive's bob, and not
    // the orbit's 8.0 (`FMUL double [0x0055D2D0]` at `0x0042F2FE`).
    obj.pos.y = ClipRootY(obj) * sub.wobble * BAT_DIVE_BOB_SCALE
      + (eye.y - sub.fromY) * sub.t + sub.fromY;
    sub.prevX = obj.pos.x;
    obj.pos.z = (eye.z - sub.fromZ) * sub.t + sub.fromZ;
    sub.prevZ = obj.pos.z;
    sub.t += BAT_SWARM_HOME_RATE;
    BatApplyWobble(obj, sub);
    // **From the eye, not from the last position.** The dive faces away from
    // the camera rather than along its own travel, and it is the one place the
    // three routines feed the ease something different. Block 0's eye by
    // address (`0x0042F147`, `0x0042F153`), not the indexed one above.
    BatEaseYaw(obj, sub.prevX - G.g_camera_block_eye.x,
               sub.prevZ - G.g_camera_block_eye.z, 4);
    if (sub.t > 1.0) {
      BatStrikeAndLeave(obj, sub, f);
      return;
    }
  } else {
    sub.vy -= BAT_CORPSE_GRAVITY;
    obj.pos.x += sub.vx;
    obj.pos.z += sub.vz;
    obj.pos.y += sub.vy;
    BatTumble(obj);
    // No frame limit: a swarm corpse falls until it reaches the water plane.
    if (obj.pos.y < BAT_CORPSE_SPLASH_Y) {
      BatLeaveMemberSlot(obj, sub);
      ActorReleaseHitSlot(obj);
      SpawnBatSplash(obj.pos.x, obj.pos.y, obj.pos.z);
      // Heard in stage 3 alone. The class's other swarm is stage 4 block 7,
      // and its corpses splash silently.
      if (G.g_scene_index === BAT_SPLASH_SCENE) play(f.events, SND_BAT_SPLASH);
      ActorDespawn(obj);
      return;
    }
  }
  // Every state that is still here, orbiting and falling included.
  BatPublishCameraPoint(obj);
  BatRegisterForShotTest(obj, f);
}

// -- the wing ---------------------------------------------------------------

/**
 * `BatWingUpdate` — `FUN_0042F660`.
 *
 * It has no state at all. Every frame it looks its body up in
 * `g_bat_members`, **despawns if the slot is empty**, seats itself on the
 * body's bone matrix translated `(0, 1, 2)`, takes the body's yaw plus half a
 * turn and a fixed pitch of `0xE800`, copies the body's motion clock, and
 * draws.
 *
 * ```c
 * MatrixStackPush(0);
 * MatrixStackSetTopFromArray(&g_camera_blocks[g_camera_index]);  // view -> world
 * MatrixMultiply(body + 0x2C4);            // node 1's record: body -> view
 * MatrixTranslate(0, 1.0, 2.0);
 * MatrixGetTranslation(&obj+0x40);
 * MatrixStackPop(1);
 * ```
 *
 * `body+0x2C4` is node 1's draw record `+0x28` (records are `obj+0x20C +
 * bone*0x90`), the matrix `SkeletonEmitNode` (`FUN_004114C0`) stores there
 * after the node's own translate and turn -- so the seat is `(0, 1, 2)` in
 * **the body node's frame**, which carries the body's pitch and roll, its
 * model scale, the clip's root height and both of the clip's rotations. The
 * port's first cut took `(0, 1, 2)` in the body's yaw alone, and the clip's
 * root record turns the bat a half-turn about y and tips it by ~21 degrees,
 * so its wings sat four units off the body, on the wrong side.
 * {@link BatBodyNodeMatrix} is that matrix, built the way the draw builds it.
 *
 * The seat is the only thing the matrix is used for: the wing's own angles
 * are `obj+0x64 = 0xE800` and `obj+0x68 = body+0x68 + 0x8000`, written, not
 * read off the body's node.
 *
 * Its clip comes from a paired lookup: walk the five entries of
 * `g_bat_body_motions` for one equal to the body's own clip and take
 * `g_bat_wing_motions` at that index. Both tables ship five identical rows, so
 * the answer is always `0x406` — the search is reproduced in
 * {@link BatWingClip} rather than folded away, because it is the only thing
 * that would ever give a different answer.
 *
 * It never registers for the shot test and never for the camera: the routine
 * ends on the draw (`0x0042F7D8`) and returns.
 */
export function BatWingUpdate(obj: Actor, _f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  const bodyAt = G.g_bat_members[MemberSlot(sub)] ?? 0;
  const body = bodyAt ? BatBodyAt(bodyAt) : null;
  if (!body) {
    ActorReleaseHitSlot(obj);
    ActorDespawn(obj);
    return;
  }
  const m = BatBodyNodeMatrix(body);
  MatrixTranslate(m, 0, BAT_WING_OFFSET_Y, BAT_WING_OFFSET_Z);
  MatrixGetTranslation(m, obj.pos);
  obj.pitch = BAT_WING_PITCH;
  obj.yaw = body.yaw + 0x8000;
  obj.motion = BatWingClip(body.motion, obj.motion);
  obj.playTicks = body.playTicks;
  // The draw it ends on (`0x0042F7D8`); `0x80001` refuses its shadow.
  DrawSkinnedModelAndShadow(obj);
}

/** `MatrixTranslate(0, 0x3F800000, 0x40000000)` in the body node's frame. */
export const BAT_WING_OFFSET_Y = 1.0;
export const BAT_WING_OFFSET_Z = 2.0;
/** `obj+0x64 = 0xE800`, a fixed pitch the wing never leaves. */
export const BAT_WING_PITCH = 0xe800;
/** The node `body+0x2C4` is the record of: the bat's one, bone 1. */
export const BAT_BODY_SEAT_BONE = 1;

/**
 * `[port-only]` — `body+0x2C4`, node 1's draw-record matrix, in the world.
 *
 * The engine's is left behind by the body's own draw a moment earlier in the
 * same frame; the port draws nothing in `game/`, so it is built here from the
 * body's state by the calls that build it there, in their order:
 *
 * ```
 * T(obj+0x40) Rz(obj+0x6C) Ry(obj+0x68) Rx(obj+0x64)   SkeletonApplyRootMotion,
 * S(model+0x116C)                                       obj+0x1FC = 5's arm
 * T(0, root.y, 0)             -- model+0x64 bit 1 up; T(root) with it down
 * Rz Ry Rx(frame record 0)                              SkeletonPoseRootFrame
 * T(node offset) Rz Ry Rx(frame record 1)               FUN_00411700
 * ```
 *
 * with the frame the renderer poses the body at, so the wing sits on the body
 * it is drawn next to. A body whose clip the bundle did not bake -- a
 * headless run -- is posed at zero, which is the skeleton's bind pose.
 *
 * `[proved]` for the sequence: `SkeletonApplyRootMotion` (`FUN_00410C50`)'s
 * default arm and its `MatrixScale(model+0x116C)` and closing translate,
 * `SkeletonPoseRootFrame` (`FUN_00410920`)'s three rotations, and
 * `SkeletonEmitNode`'s `MatrixStore(record + 0x28)` straight after
 * `FUN_00411700` has translated and turned the node.
 */
export function BatBodyNodeMatrix(body: Actor): Mat {
  const m = MatIdentity();
  MatrixTranslate(m, body.pos.x, body.pos.y, body.pos.z);
  MatrixRotateZ(m, body.roll);
  MatrixRotateY(m, body.yaw);
  MatrixRotateX(m, body.pitch);
  MatrixScale(m, body.scale, body.scale, body.scale);
  const clip = MotionOf(body, body.motion);
  const f = clip ? MotionAuthoredFrame(body, clip) : -1;
  const at = (arr: readonly number[], i: number): number => arr[i] ?? 0;
  const root: Vec3 = f < 0 || !clip ? { x: 0, y: 0, z: 0 }
    : { x: at(clip.root, f * 3), y: at(clip.root, f * 3 + 1),
        z: at(clip.root, f * 3 + 2) };
  if (body.motionFlags & MotionFlag.RootMotion) {
    MatrixTranslate(m, 0, root.y, 0);
  } else {
    MatrixTranslate(m, root.x, root.y, root.z);
  }
  const type = CharacterTypeOf(body);
  const records = type?.bone_count ?? 0;
  const rot = (record: number): [number, number, number] => {
    if (f < 0 || !clip) return [0, 0, 0];
    const o = (f * records + record) * 3;
    return [at(clip.rot, o), at(clip.rot, o + 1), at(clip.rot, o + 2)];
  };
  const r0 = rot(0);
  MatrixRotateZ(m, r0[2]);
  MatrixRotateY(m, r0[1]);
  MatrixRotateX(m, r0[0]);
  const node = type?.bones.find((b) => b.bone === BAT_BODY_SEAT_BONE);
  const off = node?.offset ?? [0, 0, 0];
  MatrixTranslate(m, off[0], off[1], off[2]);
  const r1 = rot(BAT_BODY_SEAT_BONE);
  MatrixRotateZ(m, r1[2]);
  MatrixRotateY(m, r1[1]);
  MatrixRotateX(m, r1[0]);
  return m;
}

/**
 * `g_bat_body_motions` (`0x0058992C`) and `g_bat_wing_motions` (`0x00589938`),
 * five s16 each and every row identical.
 *
 * The tables are here rather than in the bundle for the same reason
 * {@link BAT_SPLINE_POINTS} is, and `web/tools/checks/bats.ts` asserts both
 * against the EXE.
 */
export const BAT_BODY_MOTIONS: readonly number[] = [0x407, 0x407, 0x407,
                                                    0x407, 0x407];
export const BAT_WING_MOTIONS: readonly number[] = [0x406, 0x406, 0x406,
                                                    0x406, 0x406];

/**
 * The wing clip for a body clip, by the search `BatWingUpdate` runs.
 *
 * `[port-only]` as a *function*: the engine has the loop inline in
 * `BatWingUpdate` (`FUN_0042F660`). It is lifted out so a test can ask the
 * question without a frame, and so the two tables have one reader.
 *
 * A body clip with no row leaves the wing on the clip it already had, which is
 * the loop falling through — not a default of `0x406`.
 */
export function BatWingClip(bodyClip: number,
                            current: number = BAT_WING_CLIP): number {
  const i = BAT_BODY_MOTIONS.indexOf(bodyClip);
  return i < 0 ? current : (BAT_WING_MOTIONS[i] ?? current);
}

/** `[port-only]` — `g_bat_members` holds a spawn address; this is the actor. */
function BatBodyAt(at: number): Actor | null {
  for (const a of G.g_object_list) {
    if (a.at === at && !a.despawned) return a as Actor;
  }
  return null;
}

// -- the class --------------------------------------------------------------

/**
 * `g_class_handlers[0x46]`.
 *
 * `[port-only]`. One entry for four routines, because the engine has one class
 * id for them:
 * `PlaceBats` installs one of three updates on the members it builds and
 * `SpawnBatWings` installs the fourth. The dispatch below is that choice,
 * made from the fields the Init wrote rather than from a function pointer the
 * port has nowhere to keep.
 */
export function BatUpdate(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (sub.isWing) {
    BatWingUpdate(obj, f);
    return;
  }
  // Each routine takes its own shot and registers itself -- see the file
  // comment, "Who registers, and when".
  if (sub.subtype === BatSubtype.Scatter) BatScatterUpdate(obj, f);
  else if (sub.subtype === BatSubtype.Swarm) BatSwarmUpdate(obj, f);
  else BatDiveUpdate(obj, f);
}

/**
 * `[port-only]` -- a replay's question, `ClassHandler.countsForEnemyGate`:
 * does the flight this record places count into the enemy counters, and so
 * go with the enemies a room gate stepped over?
 *
 * Per record, because the answer is the sub-type's. `PlaceBats`
 * (`0x0042D9C0`) raises both counters for every dive member -- `INC word ptr
 * [0x009C7006]` / `[0x009C904A]` at `0x0042DF87`/`0x0042DF8E` -- and for every
 * swarm member at `0x0042DB5D`/`0x0042DB64`, and the scatter flight's
 * twenty-five raise neither. `[proved]` The sub-type is the placement's
 * (`desc+0x25`), which the bundle carries as `class46`.
 *
 * Without it a reload past stage 3's `2/4/32` rebuilt the swarm `0x31B8` --
 * six counted bats the room had already shot down -- in front of every gate
 * after it: the walker's list of gate-counted classes is per class, and this
 * class counts for two of its three flights.
 */
export function BatCountsForEnemyGate(rec: SpawnRecord): boolean {
  if (rec.at === undefined) return false;
  const p = T.chars?.placements?.find((q) => q.at === rec.at)?.class46;
  return !!p && p.subtype !== BatSubtype.Scatter;
}

const handler: ClassHandler = {
  init: PlaceBats,
  update: BatUpdate,
  countsForEnemyGate: BatCountsForEnemyGate,
  updatesWhenDead: true,
  ownsShotResult: true,
  registersForShotTest: true,
  leave(obj: Actor): void {
    const sub = Tail(obj);
    if (sub) {
      BatLeaveMemberSlot(obj, sub);
      // The wing is not counted and never was; the two flying sub-types are.
      if (!sub.isWing && sub.subtype !== BatSubtype.Scatter) {
        BatReleaseCounts(obj);
      }
    }
    ActorDespawn(obj);
  },
  onDeadSweep(obj: Actor): void {
    const sub = Tail(obj);
    if (sub) BatLeaveMemberSlot(obj, sub);
  },
  debug(obj: Actor): ActorDebug {
    const sub = Tail(obj);
    if (!sub) return { summary: "bat" };
    if (sub.isWing) {
      return { summary: `wing of ${BatSubtype[sub.subtype]}/${sub.member}` };
    }
    // The state first, and the sub-type in the detail: `tools/animals.mjs`
    // reads the word before the slash as the state, and it is the state a
    // reader wants first anyway.
    return {
      summary: `${BatState[sub.state]}/${sub.timer}`,
      detail: [
        `${BatSubtype[sub.subtype]} · group ${sub.group} · member ${sub.member}`,
        `seg ${sub.segment} t=${sub.segT.toFixed(2)} · home=${sub.t.toFixed(2)}`,
      ],
      hot: sub.state === BatState.Fly && sub.t > BAT_WOBBLE_HOLD,
    };
  },
};

registerClass(SpawnClass.Bat, handler);

/**
 * Class 0x40 — **the horde**, and the thing it comes up through.
 *
 * `PlaceHorde` (`FUN_0043BD30`) is a placer with two jobs, chosen by the
 * opcode-0x09 descriptor's `+0x25` ({@link HordeSelector}). Selector 1 builds
 * four to ten members of character type `0x1D` (`mol.bin`) that walk in along
 * a spline, wander a grid in front of the camera and take turns to leap at it
 * and bite. Selector 2 builds the **emerge prop** — `emerge_prop.ts` — which
 * sits where the horde will come up and is flipped aside when it does.
 *
 * Nine spawn instructions ship, from seven descriptors: five hordes (stage 1
 * blocks 3 and 8; stage 2 blocks 0x0E, 0x12 and 0x19) and four props (stage 1
 * blocks 3, 7, 8 and 12). Where a horde is decides everything about it — the
 * spline, the grid, the skin, the size — through {@link HordeFormation}, which
 * `HordeMemberInit` picks from `g_evt_block_index`.
 *
 * ## One dive at a time
 *
 * There is no attack permit. `g_horde_diver` names the one member allowed to
 * start a dive, and only after ninety frames since the last one began
 * (`g_horde_last_dive_frame`). Every path that ends a dive, refuses one or
 * kills the diver hands the turn to the next live member, so the horde comes at
 * you one after another. A dive always connects if it is not shot:
 * `PlayerTakeDamage(player, 1, 10)` at the end of it, then the member pulls out
 * and goes back to wandering. So a horde nobody shoots never leaves, and the
 * `wait_enemies_alive` behind each one is a room you have to clear.
 *
 * ## Drawn by the sub-model, from the side block
 *
 * See `submodel.ts`. The member's draw is part of its update, and the port
 * keeps the decisions here — whether it drew this frame, the reflection, the
 * shadow — on the tail for `render/` to act on.
 *
 * ## Stage 2 block 0x19's sheet
 *
 * Formation 2's member 0 lays a sheet the first three members bulge from
 * underneath as they crawl -- `sheet.ts`, with the reshape in `render/`.
 *
 * ## What is not ported
 *
 * * Class 0x47 (`PlaceLoneHordeMember47`, `FUN_0043BE60`) is the same member
 *   without a formation. No shipped descriptor is class 0x47.
 */
import { BAMS_TO_RAD, RAD_TO_BAMS } from "../../core/bams";
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, MotionFlag, type Actor } from "../actor";
import { BatSplineWeights } from "../class46";
import { ReleaseEnemyAliveCount, ReleaseEnemyPresentCount }
  from "../combat/counts";
import { PlayerTakeDamage } from "../combat/player";
import { ScoreAddForPlayer } from "../combat/score";
import { PlacementOrientation } from "../descriptor";
import { ActorDespawn } from "../despawn";
import { CameraSlotVacate, RegisterEnemySlot, RegisterForCameraTracking }
  from "../camera/slots";
import { SpawnBloodSprayAtPoint } from "../effects/blood";
import { G, PlayerState } from "../globals";
import { CameraBlockEye, CameraBlockPitch } from "../camera/view";
import type { GameHost } from "../host";
import {
  registerClass, DeadSweep, type ActorDebug, type ClassFrame,
  type ClassHandler,
} from "../registry";
import { ActorSpawn, SpawnFromDescriptor } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { vec3 } from "../vec";
import { HordeEmergePropUpdate, SpawnHordeEmergeProp } from "./emerge_prop";
import { HordeDeformedPropAwaitModel, HordeDeformedPropUpdate,
         SpawnHordeDeformedProp } from "./sheet";
import { HordeDeathRippleFade, HordeDeathSplashUpdate, SpawnHordeDeathSplash }
  from "./splash";
import {
  HordeFlag, HordeFormation, HordeKind, HordeSelector, HordeState,
  type HordeTail,
} from "./state";
import {
  SubModelBlendToMotion, SubModelDraw, SubModelInit, SubModelSetMotion,
} from "./submodel";
import {
  HORDE_FORMATION, HORDE_FORMATION_MEMBERS, HORDE_FORMATION_POINTS,
  HORDE_SHOT_DELAY, HORDE_SPLINE_RATES, HORDE_WANDER_CELL,
  HORDE_WANDER_ORIGIN, SUBMODEL_BONE_SLOTS,
} from "./tables";

export * from "./state";
export { SubModelAdvanceClock, SubModelBlendToMotion, SubModelSetMotion }
  from "./submodel";
export { HordeEmergePropUpdate } from "./emerge_prop";

// -- what the class spells as literals --------------------------------------

/** `side+0x8E = 0x1D` — `mol.bin`. */
export const HORDE_CHAR_TYPE = 0x1d;
/** The three clips: the crawl, the leap and the death. */
export const HORDE_CLIP_CRAWL = 0x218;
export const HORDE_CLIP_LEAP = 0x217;
export const HORDE_CLIP_DEATH = 0x219;
/** `SubModelBlendToMotion(.., 0, 4)` — every blend the class makes. */
export const HORDE_BLEND_FRAMES = 4;
/** `rand() % 0x33` — the sub-model clock's starting phase. */
export const HORDE_CLOCK_PHASES = 0x33;
/** `g_horde_members` has ten slots. */
export const HORDE_MAX_MEMBERS = 10;
/** `PlaceHorde`'s counts. */
export const HORDE_COUNT_1P = 8;
export const HORDE_COUNT_2P = 10;
export const HORDE_COUNT_SMALL_1P = 6;
export const HORDE_COUNT_SMALL_2P = 8;
export const HORDE_COUNT_BLOCK_0x19 = 4;
/** The evt blocks `PlaceHorde` and `HordeMemberInit` test. */
export const HORDE_BLOCK_STAGE1_A = 3;
export const HORDE_BLOCK_STAGE1_B = 8;
export const HORDE_BLOCK_SMALL_A = 0x0e;
export const HORDE_BLOCK_SMALL_B = 0x12;
export const HORDE_BLOCK_LAST = 0x19;
/** `obj+0x134C` — the sub-model's scale, and formation 2's. */
export const HORDE_SCALE = 0.75;
export const HORDE_SCALE_SMALL = 0.55;
/** `obj+0x124 = obj+0x134C * 4.0`, and `* 2.4` while diving. */
export const HORDE_HIT_RADIUS_K = 4.0;
export const HORDE_DIVE_HIT_RADIUS_K = 2.4;
/** `obj+0x1334 = idx * 0x14` — the hold, twenty frames a member. */
export const HORDE_HOLD_STAGGER = 0x14;
/** `side+0x14 = (idx + 1) * 0.3`. */
export const HORDE_SPACING = 0.3;
/** `obj+0x44 += 1.0` — every member stands a unit above the placer. */
export const HORDE_LIFT = 1.0;
/** Formation 2's members 3+ start up here, and drop once past `x < -504`. */
export const HORDE_DROP_Y = 41.4;
export const HORDE_DROP_X = -504.0;
export const HORDE_DROP_GRAVITY = 0.02722;
export const HORDE_DROP_PITCH_STEP = 0x180;
/** `BatSplineWeights(0, 0.01)` — where the Init looks to face along. */
export const HORDE_FACE_LOOKAHEAD = 0.01;
/** A segment ends when its parameter reaches this; there are six. */
export const HORDE_SEGMENT_END = 0.99;
export const HORDE_LAST_SEGMENT = 5;
/** The dive turn may go to the leader early, from segment 4 on. */
export const HORDE_EARLY_DIVE_SEGMENT = 3;
/** The wind-up: `+-0x222` BAMS a frame, circling at 0.1. */
export const HORDE_WIND_RATE = 0x222;
export const HORDE_WIND_PER_BAMS = 0.0018310546;
export const HORDE_WIND_STEP = 0.1;
/** The dive. */
export const HORDE_DIVE_RATE = 0.027;
export const HORDE_DIVE_RATE_DECAY = 0.0005;
export const HORDE_DIVE_RATE_END = 0.01;
export const HORDE_DIVE_TRACK_UNTIL = 0.55;
export const HORDE_DIVE_REACH = 1.6;
export const HORDE_DIVE_ARC_BAMS = 32768.0;
export const HORDE_DIVE_ARC_K = 0.9;
export const HORDE_DIVE_PITCH_LIFT = 2.0;
export const HORDE_DIVE_PITCH = 8192.0;
/** `PlayerTakeDamage(player, 1, 10)`. */
export const HORDE_DAMAGE_KIND = 10;
/** The pull-out. */
export const HORDE_PULL_GRAVITY = 0.04;
export const HORDE_PULL_PITCH_RATE = -0x240;
export const HORDE_PULL_PITCH_GROWTH = 1.01;
export const HORDE_PULL_PITCH_FLOOR = 0x2000;
export const HORDE_PULL_DIVE_DECAY = 0.8;
/** The wander. */
export const HORDE_WANDER_SPEED = 0.1;
export const HORDE_WANDER_TURN_SHIFT = 5;
export const HORDE_AVOID_AFTER = 0x1e;
export const HORDE_AVOID_LOOKAHEAD = 20.0;
export const HORDE_AVOID_RADIUS = 6.0;
export const HORDE_AVOID_WIDE = 0x6000;
export const HORDE_WANDER_ARRIVE = 5.0;
export const HORDE_WANDER_GIVE_UP = 600;
/** `side+0x50` — 1.0 wandering, 2.0 just back from a dive. */
export const HORDE_SPEED_NORMAL = 1.0;
export const HORDE_SPEED_FAST = 2.0;
/** Ninety frames between dives, and ninety-one before the turn is skipped. */
export const HORDE_DIVE_SPACING = 0x5a;
export const HORDE_TURN_SKIP_AFTER = 0x5b;
/** `HordeTryStartDive`'s on-screen test, in pixels from the centre. */
export const HORDE_SCREEN_HALF_W = 0xf0;
export const HORDE_SCREEN_HALF_H = 0xb4;
/** `g_projection_distance_px` at 640x480 — see `combat/permits.ts`. */
export const HORDE_PROJECTION_PX = 640.2;
/** The kill. */
export const HORDE_SCORE = 0x50;
export const HORDE_SPLASH_Y_STEP = 0.01;
export const HORDE_SPLASH_Y_LIFT_SMALL = 0.51;
export const HORDE_SPLASH_Y_HIGH = 40.4;
/** The corpse: sixty frames, falling at this to the ground plane. */
export const HORDE_CORPSE_FRAMES = 0x3b;
export const HORDE_CORPSE_GRAVITY = 0.01633;
/** Formation 2 draws only once this far past its placer in x. */
export const HORDE_SMALL_DRAW_X = 8.0;
/** Stage 1 block 3's reflection. */
export const HORDE_MIRROR_DROP = 1.75;
export const HORDE_MIRROR_DIVE_DROP = 4.0;
/** The shadow's height above the ground plane. */
export const HORDE_SHADOW_Y = 0.1;
/** `g_active_cam_path == 0x47` freezes the horde outright. */
export const HORDE_FREEZE_CAM_PATH = 0x47;
/** `g_script_flags` the class reads. */
export const HORDE_FLAG_SMALL_DRAW = 2;
export const HORDE_FLAG_SMALL_LIVE = 94;

/**
 * `PDMG_MORR2_44.wav` / `PDMG_MORR1_44.wav`, from `STAGE1_SE` in scene 0 and
 * `STAGE2_SE` otherwise. The even draw of `rand() & 1` takes the first.
 */
export const SND_HORDE_KILLED_S1 = [0x1e18a9, 0x1d18a9] as const;
export const SND_HORDE_KILLED_S2 = [0x2119a9, 0x2019a9] as const;

// -- helpers ----------------------------------------------------------------

/** `[port-only]` The tail. Every class-0x40 object has one. */
export function HordeOf(obj: Actor): HordeTail | null {
  return (obj as Actor & { horde?: HordeTail }).horde ?? null;
}

function play(events: Events | undefined, id: number): void {
  events?.emit("sound.play", { id });
}

/** `(s8)` — the member index and the table bytes are signed chars. */
function s16(v: number): number {
  return (v << 16) >> 16;
}

/** `ftol(atan2(x, z) * 10430.378)`, truncated. */
function BamsOf(x: number, z: number): number {
  return Math.trunc(Math.atan2(x, z) * RAD_TO_BAMS);
}

/** C's `%` on a possibly negative left operand, which JS's `%` already is. */
function cmod(a: number, n: number): number {
  return a % n;
}

/** `(a + (a >> 31 & (2^k - 1))) >> k` — signed division truncating to zero. */
function sdiv(a: number, k: number): number {
  return Math.trunc(a / (1 << k));
}

/** One `g_horde_formation` point, read flat — see the table's note. */
function FormationPoint(row: number, point: number): [number, number] {
  const i = (row * HORDE_FORMATION_POINTS + point) * 2;
  return [HORDE_FORMATION[i] ?? 0, HORDE_FORMATION[i + 1] ?? 0];
}

/**
 * The spline position `HordeMemberInit` and state 1 both compute:
 * `p[seg]·w0 + p[seg+2]·w2 + p[seg+1]·w1 + base`.
 */
function FormationSplinePoint(t: HordeTail, segment: number, u: number):
    [number, number] {
  const row = t.idx + t.formation * HORDE_FORMATION_MEMBERS;
  const [w0, w1, w2] = BatSplineWeights(segment, u);
  const p0 = FormationPoint(row, segment);
  const p1 = FormationPoint(row, segment + 1);
  const p2 = FormationPoint(row, segment + 2);
  return [p0[0] * w0 + p2[0] * w2 + p1[0] * w1 + t.baseX,
          p0[1] * w0 + p2[1] * w2 + p1[1] * w1 + t.baseZ];
}

/**
 * `[port-only]` — the wander target, which the engine writes inline in three
 * places (`HordeMemberInit`, the pull-out and the wander's re-pick), identical
 * each time:
 *
 * ```c
 * size = g_horde_wander_cell[formation].x;
 * side+0x30 = ((origin.x + base.x) - size * 4.0) + rand() % (size + 1)
 *           + cell.x * size;
 * ```
 *
 * and the same for z with a second `rand()`. Two draws, x first; `Rng.int`
 * is the port's `rand() % n` (`L46`).
 */
function HordePickWanderTarget(t: HordeTail, rng: Rng): void {
  const f = t.formation * 2;
  const sx = HORDE_WANDER_CELL[f] ?? 0;
  const rx = rng.int(sx + 1);
  t.wanderX = ((HORDE_WANDER_ORIGIN[f] ?? 0) + t.baseX - sx * 4.0)
    + rx + t.cellX * sx;
  const sz = HORDE_WANDER_CELL[f + 1] ?? 0;
  const rz = rng.int(sz + 1);
  t.wanderZ = ((HORDE_WANDER_ORIGIN[f + 1] ?? 0) + t.baseZ - sz * 4.0)
    + rz + t.cellZ * sz;
}

/**
 * `[port-only]` — "the next member's turn", which the engine writes inline
 * five times:
 *
 * ```c
 * g_horde_diver = (idx + 1) % side+0x6C;
 * while (g_horde_members[g_horde_diver] == 0)
 *     g_horde_diver = (g_horde_diver + 1) % (unsigned)side+0x6C;
 * ```
 *
 * `[port-only]` too: the engine's loop spins for ever if every slot is empty,
 * which cannot happen because the caller is in a slot; the port bounds it by
 * the count so a hand-built test cannot hang.
 */
function HordePassDiveTurn(t: HordeTail): void {
  const n = t.count;
  if (n <= 0) return;
  G.g_horde_diver = cmod(t.idx + 1, n);
  for (let k = 0; k < n && !(G.g_horde_members[G.g_horde_diver] ?? 0); k++) {
    G.g_horde_diver = (G.g_horde_diver + 1) % n;
  }
}

/** `[port-only]` — `g_horde_members` holds spawn addresses; this is the actor. */
function HordeMemberByAt(at: number): Actor | null {
  if (!at) return null;
  for (const a of G.g_object_list) {
    if (a.at === at && !a.despawned) return a;
  }
  return null;
}

/**
 * `[port-only]` — a member's spawn address. The engine keys nothing on an
 * address; the port's pool does, and the exporter emits a drawable row for
 * each of these (`hod2lib/characters.ts`'s `CLASS40_MEMBER_AT_BIT`, which
 * carries this function's name so the two stay one definition).
 */
export function HordeMemberAt(placerAt: number, idx: number): number {
  return 0x10000000 | ((idx & 0xf) << 20) | (placerAt & 0xfffff);
}

/**
 * `ActorScreenX` — `FUN_0043EF30`. `ftol(g_projection_distance_px *
 * obj+0x70 / obj+0x78)`: the screen x of the view-space point the member's
 * last `RegisterForShotTest` was given.
 *
 * `[port-only]` the point is carried in world space (`obj.shotCentre`) and
 * taken through the host's camera here. A host with no camera answers 0,
 * which is on screen -- the same "no opinion" `ActorIsOnScreen` gives.
 */
export function ActorScreenX(obj: Actor, host: GameHost): number {
  const v = vec3();
  if (!host.viewSpaceOfPoint?.(obj.shotCentre, v)) return 0;
  return Math.trunc((HORDE_PROJECTION_PX * v.x) / v.z);
}

/** `ActorScreenY` — `FUN_0043EF50`. The same over `obj+0x74`. */
export function ActorScreenY(obj: Actor, host: GameHost): number {
  const v = vec3();
  if (!host.viewSpaceOfPoint?.(obj.shotCentre, v)) return 0;
  return Math.trunc((HORDE_PROJECTION_PX * v.y) / v.z);
}

// -- the placer -------------------------------------------------------------

/**
 * `PlaceHorde` — `FUN_0043BD30`. Class 0x40's handler, and a placer.
 *
 * ```c
 * g_horde_live_count = 0;
 * switch (obj+0x130C) {
 *   case 0: n = 1; break;
 *   case 1: n = 8 (10 with two players);
 *           if (block == 0x0E || block == 0x12) n = 6 (8 with two);
 *           if (block == 0x19) n = 4;  break;
 *   case 2: SpawnHordeEmergeProp(obj+0x40); ActorKill(); return;
 * }
 * g_horde_members[0..9] = 0;
 * for (i = 0; i < n; i++) { make one; copy pos, yaw, i, selector, n; }
 * g_horde_diver = 0; g_horde_last_dive_frame = g_frame_counter; ActorKill();
 * ```
 *
 * A member is only **allocated** here. Its Init runs as its first update, as
 * the engine's does; see {@link HordeKind.MemberInit}.
 *
 * `[port-only]` A selector past 2 falls through the engine's `switch` with the
 * count still holding the object pointer, and would allocate until the pool
 * ran out. Nothing ships one; the port builds nothing.
 */
export function PlaceHorde(obj: Actor, rng?: Rng): void {
  const t = HordeOf(obj);
  const p = obj.class40;
  // A member or an effect is spawned with no descriptor: its routine is
  // installed by whoever made it, not by this Init.
  if (!t || !p) return;
  t.kind = HordeKind.Placer;
  G.g_horde_live_count = 0;
  const selector = p.selector as HordeSelector;
  let n = 0;
  if (selector === HordeSelector.Single) {
    n = 1;
  } else if (selector === HordeSelector.Horde) {
    n = G.g_players_in_play === 2 ? HORDE_COUNT_2P : HORDE_COUNT_1P;
    if (G.g_evt_block_index === HORDE_BLOCK_SMALL_A
        || G.g_evt_block_index === HORDE_BLOCK_SMALL_B) {
      n = G.g_players_in_play === 2
        ? HORDE_COUNT_SMALL_2P : HORDE_COUNT_SMALL_1P;
    }
    if (G.g_evt_block_index === HORDE_BLOCK_LAST) n = HORDE_COUNT_BLOCK_0x19;
  } else if (selector === HordeSelector.EmergeProp) {
    SpawnHordeEmergeProp(obj, obj.pos.x, rng);
    ActorDespawn(obj);
    return;
  }
  G.g_horde_members = new Array(HORDE_MAX_MEMBERS).fill(0);
  for (let i = 0; i < n; i += 1) {
    const m = ActorSpawn(HordeMemberAt(obj.at, i), SpawnClass.HordeSpawner,
                         HORDE_CHAR_TYPE, "horde member",
                         { visible: true }, rng);
    const mt = HordeOf(m);
    if (!mt) continue;
    mt.kind = HordeKind.MemberInit;
    m.pos = vec3(obj.pos.x, obj.pos.y, obj.pos.z);
    m.yaw = obj.yaw;
    mt.idx = i;
    mt.selector = selector;
    mt.counter = n;
    G.g_horde_members[i] = m.at;
    G.g_horde_live_count += 1;
  }
  G.g_horde_diver = 0;
  G.g_horde_last_dive_frame = G.g_frame_counter;
  ActorDespawn(obj);
}

/**
 * `[port-only]` — build a placer for every class-0x40 spawn **instruction**.
 *
 * The engine's spawn opcode allocates an object each time it runs, and the
 * placer is gone the same frame; stage 1 runs one selector-2 descriptor in
 * three blocks (7, 8 and 12), and each run lays a fresh prop. The port's
 * slot-actor path builds an address once while the walker lists it, which
 * would lay the prop once. So this counts the listings of each address and
 * builds the difference, and forgets an address the walker has stopped
 * listing -- a replay that retires the room and re-enters it builds again.
 */
export function SpawnHordePlacers(
    spawns: readonly { at: number; class: number;
                       pos?: [number, number, number] }[],
    placements: readonly { at: number; pitch?: number; yaw?: number;
                           roll?: number;
                           class40?: { selector: number } | null }[])
    : void {
  const listed = new Map<number, number>();
  for (const s of spawns) {
    if (s.class !== SpawnClass.HordeSpawner) continue;
    listed.set(s.at, (listed.get(s.at) ?? 0) + 1);
  }
  for (const key of Object.keys(G.g_horde_placers_built)) {
    if (!listed.has(Number(key))) delete G.g_horde_placers_built[key];
  }
  for (const [at, n] of listed) {
    const done = G.g_horde_placers_built[String(at)] ?? 0;
    if (done >= n) continue;
    G.g_horde_placers_built[String(at)] = n;
    const pl = placements.find((p) => p.at === at);
    const s = spawns.find((x) => x.at === at);
    if (!pl?.class40 || !s) continue;
    for (let k = done; k < n; k += 1) {
      // `PlaceHorde` is the placer's `Init`, which the frame's walk runs
      // (`SpawnFromDescriptor`), and it despawns itself.
      SpawnFromDescriptor(at, SpawnClass.HordeSpawner, -1, "horde placer",
                          { class40: { ...pl.class40 },
                            ...PlacementOrientation(pl),
                            pos: vec3(s.pos?.[0] ?? 0, s.pos?.[1] ?? 0,
                                      s.pos?.[2] ?? 0),
                            visible: true });
    }
  }
}

// -- the member's Init ------------------------------------------------------

/**
 * `side+0x60` — the spline rate, with the Init's three overrides:
 * formation 2's member 1 at 0.05 and members 2+ at 0.025, and formation 3's
 * odd members at 0.06. `[port-only]` as a function; the engine has it inline.
 */
function HordeMemberSplineRate(t: HordeTail): number {
  let r = HORDE_SPLINE_RATES[t.formation] ?? 0;
  if (t.formation === HordeFormation.Stage2Block25) {
    if (t.idx === 1) r = 0.05;
    if (t.idx > 1) r = 0.025;
  }
  if (t.formation === HordeFormation.Stage2Block14 && (t.idx & 1) === 1) {
    r = 0.06;
  }
  return r;
}

/**
 * `HordeMemberInit` — `FUN_0043BEF0`. One member's constructor, run as its
 * first frame.
 *
 * The formation comes from the block, not the descriptor: stage 1 block 3 is
 * formation 0 and block 8 formation 1 (second skin); blocks `0x0E`, `0x12` and
 * `0x19` are 3, 4 and 2, tested in **both** scenes. Formation 2 is the odd one
 * out everywhere — scale 0.55, second skin, its members 3+ start at
 * `y = 41.4`, and it counts nobody into the enemy counters here: its state 0
 * does that once `g_script_flags[94]` rises.
 *
 * Formation 2's member 0 also lays down the sheet the first three members
 * crawl under (`SpawnHordeDeformedProp`, `FUN_0043EF70`; see `sheet.ts`).
 */
export function HordeMemberInit(obj: Actor, rng: Rng, host?: GameHost):
    void {
  const t = HordeOf(obj);
  if (!t) return;
  t.sub.clip = 0;
  // `puVar6[0x1b] = param_1[0x4cc]` -- the placer's count, kept.
  t.count = t.counter;
  obj.flags = 1;
  obj.hp = 1;
  obj.maxHp = 1;
  t.scale = HORDE_SCALE;
  t.prevX = obj.pos.x;
  t.prevZ = obj.pos.z;
  t.baseX = obj.pos.x;
  t.baseZ = obj.pos.z;
  // The sub-model never moves the member: the clip root is a pose offset.
  obj.motionFlags &= ~MotionFlag.RootMotion;

  if (t.selector === HordeSelector.Horde) {
    if (G.g_scene_index === 0 || G.g_scene_index === 1) {
      if (G.g_scene_index === 0) {
        if (G.g_evt_block_index === HORDE_BLOCK_STAGE1_A) {
          t.skinRow = 0;
          t.formation = HordeFormation.Stage1Block3;
        } else if (G.g_evt_block_index === HORDE_BLOCK_STAGE1_B) {
          t.formation = HordeFormation.Stage1Block8;
          t.skinRow = 1;
        }
      }
      if (G.g_evt_block_index === HORDE_BLOCK_SMALL_A) {
        t.skinRow = 0;
        t.formation = HordeFormation.Stage2Block14;
      } else if (G.g_evt_block_index === HORDE_BLOCK_SMALL_B) {
        t.skinRow = 0;
        t.formation = HordeFormation.Stage2Block18;
      } else if (G.g_evt_block_index === HORDE_BLOCK_LAST) {
        t.skinRow = 1;
        t.formation = HordeFormation.Stage2Block25;
        t.scale = HORDE_SCALE_SMALL;
        if (t.idx === 0) SpawnHordeDeformedProp(obj);
      }
    }
    const [x, z] = FormationSplinePoint(t, 0, 0);
    obj.pos.x = x;
    obj.pos.z = z;
    const [ax, az] = FormationSplinePoint(t, 0, HORDE_FACE_LOOKAHEAD);
    obj.yaw = s16(BamsOf(ax - obj.pos.x, az - obj.pos.z));
    t.state = HordeState.Hold;
    t.fadeBones = 0;
    t.counter = 0;
    t.hold = t.idx * HORDE_HOLD_STAGGER;
    t.flatten = 0;
    t.avoided = 0;
    t.spacing = (t.idx + 1) * HORDE_SPACING;
    const before = obj.flags;
    obj.flags = before | HordeFlag.OutOfShotTest;
    obj.pos.y += HORDE_LIFT;
    if (t.formation === HordeFormation.Stage2Block25 && t.idx > 2) {
      obj.pos.y = HORDE_DROP_Y;
      obj.flags = before | HordeFlag.OutOfShotTest | HordeFlag.Landed;
    }
  }

  // `SubModelStoreRestBone` (`FUN_0040EC50`) draws each bone from
  // `g_submodel_bone_slots[bone + obj+0x1350 * 10]`. Row 0 is the skeleton's
  // own slots; row 1 is the second skin, and the port says so the way every
  // other swap is said -- per bone, on the actor, and to the host.
  if (t.skinRow !== 0) {
    const row = SUBMODEL_BONE_SLOTS[t.skinRow] ?? [];
    for (let bone = 1; bone < row.length; bone += 1) {
      if (!row[bone]) continue;
      obj.boneSlot[String(bone)] = row[bone];
      host?.setBoneSlot(obj.at, bone, row[bone]);
    }
  }
  obj.pitch = 0;
  obj.roll = 0;
  // The grid cell each formation starts its members in.
  if (t.formation === HordeFormation.Stage1Block3) {
    t.cellX = 4;
    t.cellZ = t.idx % 8;
  } else if (t.formation === HordeFormation.Stage2Block14) {
    t.cellX = 6;
    t.cellZ = t.idx % 8;
  } else if (t.formation === HordeFormation.Stage2Block18) {
    t.cellX = 0;
    t.cellZ = t.idx % 8;
  } else {
    t.cellX = (t.idx & 3) * 2;
    t.cellZ = 4;
  }
  HordePickWanderTarget(t, rng);
  t.speed = HORDE_SPEED_NORMAL;
  t.diveFromY = obj.pos.y;
  t.segment = 0;
  t.segT = 0;
  t.segRate = HordeMemberSplineRate(t);
  // `obj+0x120 = 0xFF`: no camera slot. `obj+0x121` stays 0 from
  // `ActorClearGameFields`, and the camera's slot pass reads 0 as "holds a
  // permit" (`UpdateCameraEnemySlots`, `FUN_00408DD0`), so every member is
  // offered one of the two attacker slots. The engine's own oddity, kept.
  obj.attackPermit = 0;
  t.sub.clip = HORDE_CLIP_CRAWL;
  SubModelInit(t.sub);
  t.sub.frame = rng.int(HORDE_CLOCK_PHASES);
  obj.hitRadius = t.scale * HORDE_HIT_RADIUS_K;
  if (t.formation !== HordeFormation.Stage2Block25) {
    // `RegisterEnemySlot` at `0x0043C3B8`, then both `INC`s.
    RegisterEnemySlot(obj);
    G.g_enemies_present += 1;
    G.g_enemies_alive += 1;
  }
  obj.lookAt.x = obj.pos.x;
  obj.lookAt.y = obj.pos.y;
  obj.lookAt.z = obj.pos.z;
  HordePublishShotSphere(obj);
  t.kind = HordeKind.Member;
}

/**
 * `MatrixTransformPoint(obj+0x40, obj+0x70); RegisterForShotTest(obj)`.
 *
 * `[port-only]` the point stays in world space: the port's ray is a world ray.
 * `RegisterForShotTest` (`FUN_00405160`) skips bit `0x8000`, and a member in
 * its hold carries it; the port's pick tests a sphere only while the class
 * draws the member, which is the same set of frames.
 */
function HordePublishShotSphere(obj: Actor): void {
  obj.shotCentre.x = obj.pos.x;
  obj.shotCentre.y = obj.pos.y;
  obj.shotCentre.z = obj.pos.z;
}

// -- the dive ---------------------------------------------------------------

/**
 * `HordeTryStartDive` — `FUN_0043D4F0`. Start a dive, or hand the turn on.
 *
 * Refuses outright (0, turn kept) unless the scene is in play
 * (`g_scene_state_major_entered == 2`) with a player in it. A **wandering**
 * member must also be on screen — within 240 pixels of the centre across and
 * 180 up and down — and one that is not hands the turn on and refuses. Then
 * the target: a coin with two players, `g_active_player` with one (left alone
 * when that is neither 0 nor 1). The wind-up turns toward the eye by exactly
 * the angle between, `0x222` BAMS a frame, so `side+0x4C` is that angle over
 * `0x222`.
 */
export function HordeTryStartDive(obj: Actor, rng: Rng, host: GameHost):
    boolean {
  const t = HordeOf(obj);
  if (!t) return false;
  if (G.g_scene_state_major_entered !== 2) return false;
  if (G.g_players_in_play === 0) return false;
  if (t.state === HordeState.Wander) {
    if (Math.abs(ActorScreenX(obj, host)) > HORDE_SCREEN_HALF_W
        || Math.abs(ActorScreenY(obj, host)) > HORDE_SCREEN_HALF_H) {
      HordePassDiveTurn(t);
      return false;
    }
  }
  t.aimX = 0;
  t.aimZ = 0;
  if (G.g_players_in_play === 2) {
    obj.attackPermit = rng.int(2);
  } else {
    if (G.g_active_player === 0) obj.attackPermit = 0;
    if (G.g_active_player === 1) obj.attackPermit = 1;
  }
  obj.yaw &= 0xffff;
  // The block `g_camera_index` names (`0x0043D61E`, `0x0043D627`).
  const eye = CameraBlockEye(G.g_camera_index);
  const h = BamsOf(eye.x - obj.pos.x, eye.z - obj.pos.z) & 0xffff;
  t.windCount = 0;
  const yaw = obj.yaw;
  const d = h - yaw;
  const ad = Math.abs(d);
  if (ad <= 0x8000) {
    t.windLimit = ad * HORDE_WIND_PER_BAMS;
    t.windRate = yaw < h ? HORDE_WIND_RATE : -HORDE_WIND_RATE;
  } else if (h <= yaw) {
    t.windRate = HORDE_WIND_RATE;
    t.windLimit = (d + 0x10000) * HORDE_WIND_PER_BAMS;
  } else {
    t.windLimit = ((yaw - h) + 0x10000) * HORDE_WIND_PER_BAMS;
    t.windRate = -HORDE_WIND_RATE;
  }
  t.state = HordeState.WindUp;
  G.g_horde_last_dive_frame = G.g_frame_counter;
  return true;
}

// -- being shot -------------------------------------------------------------

/**
 * `[port-only]` as a function — the kill, inline at the top of
 * `HordeMemberUpdate` (`FUN_0043C440`), lifted out so a test can ask for it.
 *
 * `obj+0x34` bit 3, and the member is not holding and has walked at least
 * `g_horde_shot_delay` frames of its spline: one bullet. Blood, the death
 * clip, **both** counters, a `PDMG_MORR` from the stage's own bank, 80 points
 * to whoever fired (a coin if both did), and the splash. A diver or a member
 * still coming in hands the dive turn on and puts the next dive ninety frames
 * *sooner*. The corpse routine goes in, but the update carries on to its end
 * this frame with the state at 6, as the engine's does.
 *
 * `[port-only]` The two counter decrements are latched through
 * `ReleaseEnemy*Count`: the engine's are bare `DEC`s, safe because nothing
 * can reach them twice; the port has despawn routes the engine does not.
 */
export function HordeResolveShot(obj: Actor, f: ClassFrame): boolean {
  const t = HordeOf(obj);
  if (!t) return false;
  if (!(obj.flags & ActorFlag.Hit)) return false;
  if (t.state === HordeState.Hold) return false;
  if (t.state === HordeState.Enter
      && (HORDE_SHOT_DELAY[t.formation * 10 + t.idx] ?? 0) > t.counter) {
    return false;
  }
  // `LEA EBP, [ESI + 0x40]; PUSH EBP; CALL SpawnBloodSprayAtPoint` at
  // `0x0043C4AD`, which reads `0x30` past its argument: `obj+0x70`, the
  // member's position through the camera as the tail left it last frame
  // (`0x0043D40A`..`0x0043D422`, the one store to it in the routine). It is
  // {@link Actor.shotCentre} through the host's camera, not the world
  // position this used to pass.
  const at = vec3();
  f.host.viewSpaceOfPoint?.(obj.shotCentre, at);
  SpawnBloodSprayAtPoint(at);
  SubModelBlendToMotion(t.sub, HORDE_CLIP_DEATH, 0, HORDE_BLEND_FRAMES);
  ReleaseEnemyAliveCount(obj);
  ReleaseEnemyPresentCount(obj);
  const bank = G.g_scene_index === 0 ? SND_HORDE_KILLED_S1
    : SND_HORDE_KILLED_S2;
  play(f.events, bank[f.rng.int(2) === 0 ? 0 : 1]);
  const byP0 = (obj.flags & ActorFlag.HitByPlayer0) !== 0;
  const byP1 = (obj.flags & ActorFlag.HitByPlayer1) !== 0;
  const who = byP0 && byP1 ? f.rng.int(2) : byP0 ? 0 : 1;
  ScoreAddForPlayer(who, HORDE_SCORE, f.events);
  G.g_player_hit_count[who] = (G.g_player_hit_count[who] ?? 0) + 1;

  // Where the splash goes. Formation 2's high members that die up high splash
  // at 40.4, smaller; everyone else on the ground plane, a hundredth apart.
  let y: number;
  let size = 1.0;
  if (t.formation === HordeFormation.Stage2Block25) {
    if (t.idx < 3 || obj.pos.x < HORDE_DROP_X) {
      y = t.idx * HORDE_SPLASH_Y_STEP + G.g_camera_fixed_eye_y
        + HORDE_SPLASH_Y_LIFT_SMALL;
    } else {
      y = t.idx * HORDE_SPLASH_Y_STEP + HORDE_SPLASH_Y_HIGH;
      size = HORDE_SCALE;
    }
  } else {
    y = t.idx * HORDE_SPLASH_Y_STEP + G.g_camera_fixed_eye_y;
  }
  SpawnHordeDeathSplash(obj, obj.pos.x, y, obj.pos.z, size, f.events);

  const was = t.state;
  t.counter = 0;
  t.flatten = 1;
  obj.vel.y = 0;
  if ((was === HordeState.Enter || was === HordeState.WindUp
       || was === HordeState.Dive) && G.g_horde_live_count > 1) {
    HordePassDiveTurn(t);
    G.g_horde_last_dive_frame -= HORDE_DIVE_SPACING;
  }
  t.state = HordeState.Dead;
  if (G.g_horde_live_count > 1) {
    G.g_horde_live_count -= 1;
    obj.flags |= HordeFlag.NoCameraTrack;
    CameraSlotVacate(obj);
  }
  t.kind = HordeKind.Corpse;
  // `[port-only]` Out of the pick: the corpse routine never calls
  // `RegisterForShotTest`, and a zero sphere is how the port's pick is told.
  obj.hitRadius = 0;
  return true;
}

// -- the update -------------------------------------------------------------

/**
 * `HordeMemberUpdate` — `FUN_0043C440`. The member's six live states, then its
 * draw, then its bookkeeping.
 *
 * **The tail is not optional, and the decompiler says it is.** The shadow's
 * `MatrixStackPop` at `0x0043D3E3` is marked no-return in Ghidra, so the
 * pseudocode returns straight after drawing the shadow — and a member that
 * drew would then never publish its shot sphere, never register for the
 * camera, never keep its `g_horde_members` slot. The bytes carry on
 * (`ADD ESP,0x28` at `0x0043D3E8`) into all of it. `L35`.
 */
export function HordeMemberUpdate(obj: Actor, f: ClassFrame): void {
  const t = HordeOf(obj);
  if (!t) return;
  t.drawn = false;
  t.mirrored = false;
  t.shadow = false;
  // The whole routine -- the shot, the state, the draw, the bookkeeping --
  // is skipped while camera path 0x47 plays: stage 2 block 0x19's cut scene.
  if (G.g_active_cam_path === HORDE_FREEZE_CAM_PATH) {
    obj.alpha = 0;
    return;
  }
  HordeResolveShot(obj, f);
  obj.flags &= ~ActorFlag.Hit;

  switch (t.state) {
    case HordeState.Hold: HordeStateHold(obj, t); break;
    case HordeState.Enter: HordeStateEnter(obj, t, f); break;
    case HordeState.WindUp: HordeStateWindUp(obj, t); break;
    case HordeState.Dive: HordeStateDive(obj, t, f); break;
    case HordeState.PullOut: HordeStatePullOut(obj, t, f.rng); break;
    case HordeState.Wander: HordeStateWander(obj, t, f); break;
    default: break;
  }

  // The draw. Formation 2 has its own rule for when a member is visible:
  // behind its placer by eight units, or once down, or member 3+ -- and its
  // high members show from the moment `g_script_flags[2]` is 1, whatever
  // their state.
  const small = t.formation === HordeFormation.Stage2Block25;
  const draw =
    ((!small || obj.pos.x <= t.baseX - HORDE_SMALL_DRAW_X
      || (obj.flags & HordeFlag.Landed) !== 0 || t.idx > 2)
     && t.state !== HordeState.Hold && t.state !== HordeState.Dead)
    || (small && t.idx > 2
        && (G.g_script_flags[HORDE_FLAG_SMALL_DRAW] ?? 0) === 1);
  if (draw) {
    // `yaw += 0x8000` around the draw: the model faces down its own -z.
    SubModelDraw(obj, t.sub);
    t.drawn = true;
    if (G.g_scene_index === 0 && G.g_evt_block_index === HORDE_BLOCK_STAGE1_A) {
      // The reflection: the same draw mirrored about `side+0x1C - 0.875`,
      // four units lower mid-leap, and pitched half a turn while winding up
      // or diving. `obj+0x34 | 0x1000000` is up for the duration.
      let y = (t.diveFromY - (obj.pos.y - t.diveFromY)) - HORDE_MIRROR_DROP;
      if (t.state === HordeState.Dive) y -= HORDE_MIRROR_DIVE_DROP;
      let pitch = obj.pitch;
      if (t.state === HordeState.WindUp || t.state === HordeState.Dive) {
        pitch += 0x8000;
      }
      SubModelDraw(obj, t.sub);
      t.mirrored = true;
      t.mirrorY = y;
      t.mirrorPitch = pitch;
    }
    t.sub.frame += 1;
    if (!small || t.idx < 3 || obj.pos.x <= HORDE_DROP_X) {
      t.shadow = true;
      t.shadowY = G.g_camera_fixed_eye_y
        + (small ? HORDE_SPLASH_Y_LIFT_SMALL : HORDE_SHADOW_Y);
    }
  }
  obj.alpha = draw ? 1 : 0;

  HordePublishShotSphere(obj);
  // `0x0043D43F`: `obj+0x100 = pos` and `RegisterForCameraTracking` at
  // `0x0043D45B`, unless it is formation 2 waiting for its flag.
  if (!small || (G.g_script_flags[HORDE_FLAG_SMALL_LIVE] ?? 0) !== 0) {
    obj.lookAt.x = obj.pos.x;
    obj.lookAt.y = obj.pos.y;
    obj.lookAt.z = obj.pos.z;
    RegisterForCameraTracking(obj);
  }
  // A turn that has sat on an empty slot for ninety-one frames moves on.
  if ((G.g_frame_counter - G.g_horde_last_dive_frame) >>> 0
        > HORDE_TURN_SKIP_AFTER
      && !(G.g_horde_members[G.g_horde_diver] ?? 0) && t.count > 0) {
    G.g_horde_diver = (G.g_horde_diver + 1) % t.count;
  }
  t.prevX = obj.pos.x;
  t.prevY = obj.pos.y;
  t.prevZ = obj.pos.z;
  G.g_horde_members[t.idx] = obj.at;
}

/**
 * State 0 — `HordeMemberUpdate`'s case 0 (at `0x0043C70F`). The hold.
 *
 * Counts `obj+0x1334` down and comes up when it goes negative — formation 2
 * only once `g_script_flags[94]` is up — raising `g_horde_emerged` and leaving
 * the shot test's blind spot. Formation 2 is counted into both enemy counters
 * here, on every frame of state 0 that finds the flag at exactly 1; its holds
 * have all expired by the time the script raises it, so that is once each.
 */
function HordeStateHold(obj: Actor, t: HordeTail): void {
  t.hold -= 1;
  const small = t.formation === HordeFormation.Stage2Block25;
  const live = G.g_script_flags[HORDE_FLAG_SMALL_LIVE] ?? 0;
  if (t.hold < 0 && (!small || live !== 0)) {
    t.state = HordeState.Enter;
    G.g_horde_emerged = 1;
    t.counter = 0;
    obj.flags &= ~HordeFlag.OutOfShotTest;
  }
  if (small && live === 1) {
    // `RegisterEnemySlot` at `0x0043C768`, then both `INC`s.
    RegisterEnemySlot(obj);
    G.g_enemies_present += 1;
    G.g_enemies_alive += 1;
  }
}

/**
 * State 1 — case 1 (at `0x0043C783`). The walk in.
 *
 * `BatSplineWeights` over three consecutive `g_horde_formation` points, six
 * segments, `side+0x60` a frame. The heading is taken from last frame's
 * position and eased a quarter of the way — but not on the very first frame of
 * the walk, when the rate and the parameter are both still zero. Formation 2's
 * high members drop once they pass `x = -504`, pitching nose-down as they
 * fall. At the end: formation 2's first three go straight for a dive, everyone
 * else wanders. The leader may take its dive from segment 4.
 */
function HordeStateEnter(obj: Actor, t: HordeTail, f: ClassFrame): void {
  t.counter += 1;
  const [x, z] = FormationSplinePoint(t, t.segment, t.segT);
  obj.pos.x = x;
  obj.pos.z = z;
  const h = s16(BamsOf(obj.pos.x - t.prevX, obj.pos.z - t.prevZ));
  t.heading = h;
  if (t.segRate !== 0 || t.segT !== 0) {
    obj.yaw = sdiv(h - obj.yaw, 2) + obj.yaw;
  }
  const small = t.formation === HordeFormation.Stage2Block25;
  if (small && t.idx > 2) {
    if (obj.pos.y >= HORDE_DROP_Y && obj.pos.x < HORDE_DROP_X) {
      obj.vel.y = -HORDE_DROP_GRAVITY;
    }
    if (obj.vel.y < 0) {
      obj.pitch -= HORDE_DROP_PITCH_STEP;
      obj.vel.y -= HORDE_DROP_GRAVITY;
      obj.pos.y += obj.vel.y;
      if (obj.pos.y < G.g_camera_fixed_eye_y + 1.0) {
        obj.pos.y = G.g_camera_fixed_eye_y + 1.0;
        obj.vel.y = 0;
        obj.pitch = 0;
      }
    }
  }
  t.segT += t.segRate;
  if (t.segT >= HORDE_SEGMENT_END) {
    t.segT = 0;
    t.segment += 1;
    if (t.segment > HORDE_LAST_SEGMENT) {
      if (small && t.idx < 3) {
        HordeTryStartDive(obj, f.rng, f.host);
      } else {
        t.state = HordeState.Wander;
        t.counter = 0;
      }
    }
  }
  if (!small && t.idx === G.g_horde_diver
      && t.segment > HORDE_EARLY_DIVE_SEGMENT) {
    HordeTryStartDive(obj, f.rng, f.host);
  }
}

/**
 * State 2 — case 2 (at `0x0043C9AC`). The wind-up.
 *
 * Turns `side+0x44` a frame and circles a tenth of a unit along the new
 * heading until `side+0x48` passes `side+0x4C`, then latches the dive's start,
 * raises {@link HordeFlag.Diving} and blends to the leap. The sphere shrinks
 * to `scale * 2.4` for the dive.
 */
function HordeStateWindUp(obj: Actor, t: HordeTail): void {
  obj.yaw += t.windRate;
  t.windCount += 1.0;
  const a = obj.yaw * BAMS_TO_RAD;
  obj.pos.x = Math.sin(a) * HORDE_WIND_STEP + obj.pos.x;
  obj.pos.z = Math.cos(a) * HORDE_WIND_STEP + obj.pos.z;
  if (t.windLimit < t.windCount) {
    t.diveFromX = obj.pos.x;
    t.diveFromY = obj.pos.y;
    t.diveFromZ = obj.pos.z;
    t.speed = HORDE_SPEED_NORMAL;
    obj.flags |= HordeFlag.Diving;
    t.state = HordeState.Dive;
    t.diveT = 0;
    t.diveRate = HORDE_DIVE_RATE;
    SubModelBlendToMotion(t.sub, HORDE_CLIP_LEAP, 0, HORDE_BLEND_FRAMES);
    obj.hitRadius = t.scale * HORDE_DIVE_HIT_RADIUS_K;
  }
}

/**
 * State 3 — case 3 (at `0x0043CA6D`). The leap and the bite.
 *
 * Until `obj+0x1344` reaches 0.55 the member is put on a path to the camera
 * block's eye: x and z at `1.6 t` of the way there, y on a half-sine arc to
 * 0.9 of the eye's height **plus `2·sin` of the camera's pitch** — so it ends
 * where the view is looking — pitched nose-up by `(1 - t) · 8192`. The rate
 * starts at 0.027 and loses 0.0005 a frame; when it is down to 0.01 the member
 * has hung in front of the camera for a while, and it bites:
 * `PlayerTakeDamage(obj+0x121, 1, 10)` if that player is in state 5. Then the
 * pull-out, and the dive turn passes on.
 */
function HordeStateDive(obj: Actor, t: HordeTail, f: ClassFrame): void {
  if (t.diveT < HORDE_DIVE_TRACK_UNTIL) {
    // The block `g_camera_index` names, its eye (`0x0043CA99`, `0x0043CAF6`,
    // `0x0043CB38`) and its pitch alike.
    const eye = CameraBlockEye(G.g_camera_index);
    obj.pos.x = ((eye.x + t.aimX) - t.diveFromX) * t.diveT * HORDE_DIVE_REACH
      + t.diveFromX;
    const arc = Math.trunc(t.diveT * HORDE_DIVE_ARC_BAMS) & 0xffff;
    const lift = HORDE_DIVE_PITCH_LIFT
      * Math.sin(CameraBlockPitch(G.g_camera_index) * BAMS_TO_RAD);
    obj.pos.y = (lift + (eye.y - t.diveFromY)
                 * Math.sin(arc * BAMS_TO_RAD)) * HORDE_DIVE_ARC_K
      + t.diveFromY;
    obj.pos.z = ((eye.z + t.aimZ) - t.diveFromZ) * t.diveT * HORDE_DIVE_REACH
      + t.diveFromZ;
    obj.pitch = Math.trunc((1.0 - t.diveT) * HORDE_DIVE_PITCH);
  }
  t.diveRate -= HORDE_DIVE_RATE_DECAY;
  t.diveT += t.diveRate;
  if (t.diveRate <= HORDE_DIVE_RATE_END) {
    const p = obj.attackPermit;
    if ((G.g_player_state[p] ?? 0) === PlayerState.InPlay) {
      PlayerTakeDamage(p, 1, HORDE_DAMAGE_KIND, f.events, obj);
    }
    if (!(obj.flags & HordeFlag.Landed) && t.idx < 3) {
      obj.flags |= HordeFlag.Landed;
    }
    t.state = HordeState.PullOut;
    t.pullPitchRate = HORDE_PULL_PITCH_RATE;
    obj.vel.y = 0;
    obj.vel.z = 0;
    HordePassDiveTurn(t);
  }
}

/**
 * State 4 — case 4 (at `0x0043CC38`). The fall back.
 *
 * Gravity 0.04 a frame, the pitch driven down by a rate that grows 1% a frame
 * and floored at `0x2000`. On reaching the ground it lowers
 * {@link HordeFlag.Diving}, picks a new grid cell — by formation, from its own
 * index — and a target in it, turns half round, sets its clip back to the
 * crawl **with a cut, not a blend**, and wanders at double speed.
 */
function HordeStatePullOut(obj: Actor, t: HordeTail, rng: Rng): void {
  obj.vel.y -= HORDE_PULL_GRAVITY;
  obj.pos.y += obj.vel.y;
  obj.pitch += t.pullPitchRate;
  t.pullPitchRate = Math.trunc(t.pullPitchRate * HORDE_PULL_PITCH_GROWTH);
  if (obj.pitch < HORDE_PULL_PITCH_FLOOR) obj.pitch = HORDE_PULL_PITCH_FLOOR;
  t.diveT *= HORDE_PULL_DIVE_DECAY;
  if (obj.pos.y > t.diveFromY) return;
  t.diveT = 0;
  obj.flags &= ~HordeFlag.Diving;
  let cx = 0;
  let cz: number;
  switch (t.formation) {
    case HordeFormation.Stage1Block3:
      cx = 5;
      cz = t.idx % 8;
      break;
    case HordeFormation.Stage2Block14:
    case HordeFormation.Stage2Block18:
      cz = t.idx % 8;
      break;
    case HordeFormation.Stage2Block25:
      cx = 4;
      cz = (t.idx * 2 + 1) % 8;
      break;
    default:
      cx = (t.idx * 2) % 8;
      cz = 5;
      break;
  }
  t.cellX = cx + 1;
  t.cellZ = cz + 1;
  HordePickWanderTarget(t, rng);
  t.state = HordeState.Wander;
  obj.yaw += 0x8000;
  obj.pos.y = t.diveFromY;
  obj.pitch = 0;
  t.avoidClock = 0;
  SubModelSetMotion(t.sub, HORDE_CLIP_CRAWL);
  t.speed = HORDE_SPEED_FAST;
  obj.hitRadius = t.scale * HORDE_HIT_RADIUS_K;
}

/**
 * State 5 — case 5 (at `0x0043CE05`). The wander, and the dive turn.
 *
 * Steers a thirty-second of the way to its target a frame — and when the
 * target is more than half a turn round it steers by `yaw - heading`, the
 * long way, and overshoots; the engine's own arithmetic, kept. Every thirty
 * frames without a near miss it looks twenty steps ahead for another member
 * inside six units: the first time, that member is told it has been avoided
 * and this one picks a new target six units off to the side; a member that has
 * been told makes a double step instead. Straight after a pull-out
 * (`side+0x50 == 2.0`) nobody stops. Past 600 frames or within five units of
 * the target it picks a fresh random cell. And when it is this member's turn,
 * ninety frames since the last dive, it tries one — and hands the turn on if
 * it may not.
 */
function HordeStateWander(obj: Actor, t: HordeTail, f: ClassFrame): void {
  const h = BamsOf(t.wanderX - obj.pos.x, t.wanderZ - obj.pos.z) & 0xffff;
  t.heading = h;
  const yaw = obj.yaw & 0xffff;
  let d = h - yaw;
  const ad = d < 0 ? yaw - h : d;
  if (ad > 0x8000) d = yaw - h;
  obj.yaw = sdiv(d, HORDE_WANDER_TURN_SHIFT) + yaw;
  const clock = t.avoidClock;
  t.avoidClock = clock + 1;
  const a = obj.yaw * BAMS_TO_RAD;
  const s = Math.sin(a) * (t.speed * HORDE_WANDER_SPEED);
  const c = Math.cos(a) * (t.speed * HORDE_WANDER_SPEED);

  let hit = false;
  let target = 0;
  let steered = false;
  if (clock > HORDE_AVOID_AFTER && t.count >= 1) {
    for (let j = 0; j < t.count; j += 1) {
      if (j === t.idx) continue;
      const other = HordeMemberByAt(G.g_horde_members[j] ?? 0);
      if (!other) continue;
      const ot = HordeOf(other);
      const dz = (c * HORDE_AVOID_LOOKAHEAD + obj.pos.z) - (c + other.pos.z);
      const dx = (s * HORDE_AVOID_LOOKAHEAD + obj.pos.x) - (s + other.pos.x);
      if (Math.sqrt(dz * dz + dx * dx) < HORDE_AVOID_RADIUS) {
        hit = true;
        t.avoidClock = 0;
        if (t.avoided === 0) {
          if (ot) ot.avoided = 1;
          const oy = other.yaw;
          const dd = Math.abs(oy - obj.yaw);
          if (dd <= HORDE_AVOID_WIDE) {
            target = (oy - 0x8000) & 0xffff;
          } else {
            target = f.rng.int(2) * 0x8000 - 0x4000 + obj.yaw;
          }
          steered = true;
        }
      }
    }
  }
  if (hit || t.avoided !== 0) {
    if (t.speed === HORDE_SPEED_FAST) {
      obj.pos.x = s + obj.pos.x;
      obj.pos.z = c + obj.pos.z;
    } else if (t.avoided === 0) {
      // `steered` is always true here: this arm is reached only through a
      // hit, and a hit with `avoided` clear always sets the target.
      void steered;
      const ta = target * BAMS_TO_RAD;
      t.wanderX = Math.sin(ta) * HORDE_AVOID_RADIUS + obj.pos.x;
      t.wanderZ = Math.cos(ta) * HORDE_AVOID_RADIUS + obj.pos.z;
    } else {
      t.avoided = 0;
      obj.pos.x = s + s + obj.pos.x;
      obj.pos.z = c + c + obj.pos.z;
    }
  } else {
    obj.pos.x = s + obj.pos.x;
    obj.pos.z = c + obj.pos.z;
  }

  const counted = t.counter;
  t.counter = counted + 1;
  const dzt = t.wanderZ - obj.pos.z;
  const dxt = t.wanderX - obj.pos.x;
  if (counted > HORDE_WANDER_GIVE_UP
      || Math.sqrt(dzt * dzt + dxt * dxt) < HORDE_WANDER_ARRIVE) {
    t.cellX = f.rng.int(8) + 1;
    t.cellZ = f.rng.int(8) + 1;
    HordePickWanderTarget(t, f.rng);
    t.counter = 0;
    t.speed = HORDE_SPEED_NORMAL;
  }
  if (Math.trunc(t.speed) === 1
      && ((G.g_frame_counter - G.g_horde_last_dive_frame) >>> 0)
        > HORDE_DIVE_SPACING
      && G.g_horde_diver === t.idx) {
    const started = HordeTryStartDive(obj, f.rng, f.host);
    if (!started || t.speed === HORDE_SPEED_FAST) {
      G.g_horde_last_dive_frame = G.g_frame_counter;
      HordePassDiveTurn(t);
    }
  }
}

// -- the corpse -------------------------------------------------------------

/**
 * `HordeCorpseSinkUpdate` — `FUN_0043DA20`. Sixty frames of a dead member.
 *
 * It sinks — falling 0.01633 a frame faster each frame down to the ground
 * plane, or snapped to a unit above it if it was already that low — plays out
 * the death blend, and is drawn flattened by `SubModelApplyObjectTransform`'s
 * `obj+0x135C` arm to `(61 - n)/61` of its height. It keeps its
 * `g_horde_members` slot until the last frame, so the dive turn does not pass
 * to it and on; the last of a horde holds the camera while it goes.
 */
export function HordeCorpseSinkUpdate(obj: Actor): void {
  const t = HordeOf(obj);
  if (!t) return;
  t.drawn = false;
  t.mirrored = false;
  t.shadow = false;
  const n = t.counter;
  t.counter = n + 1;
  if (n > HORDE_CORPSE_FRAMES) {
    if (G.g_horde_members[t.idx] === obj.at) G.g_horde_members[t.idx] = 0;
    obj.alpha = 0;
    ActorDespawn(obj);
    return;
  }
  const small = t.formation === HordeFormation.Stage2Block25;
  if (!small || t.idx < 3 || obj.pos.x < HORDE_DROP_X) {
    if (obj.pos.y <= G.g_camera_fixed_eye_y + 1.0) {
      obj.pos.y = G.g_camera_fixed_eye_y + 1.0;
    } else {
      obj.vel.y -= HORDE_CORPSE_GRAVITY;
      obj.pos.y += obj.vel.y;
      if (obj.pos.y < G.g_camera_fixed_eye_y) {
        obj.pos.y = G.g_camera_fixed_eye_y;
      }
    }
  }
  const draw = !small || obj.pos.x <= t.baseX - HORDE_SMALL_DRAW_X
    || (obj.flags & HordeFlag.Landed) !== 0;
  if (draw) {
    SubModelDraw(obj, t.sub);
    t.drawn = true;
  }
  obj.alpha = draw ? 1 : 0;
  // `RegisterForCameraTracking` at `0x0043DB45`, only while it is the last.
  if (G.g_horde_live_count === 1) {
    obj.lookAt.x = obj.pos.x;
    obj.lookAt.y = obj.pos.y;
    obj.lookAt.z = obj.pos.z;
    RegisterForCameraTracking(obj);
  }
  t.sub.frame += 1;
  G.g_horde_members[t.idx] = obj.at;
}

// -- the class --------------------------------------------------------------

/**
 * `g_class_handlers[0x40]`.
 *
 * `[port-only]`. One entry for every routine the class's objects run, because
 * the engine has one class id for them: the placer installs the member's Init,
 * the Init installs the update, the kill installs the corpse, and the effects
 * are allocated with their own. The dispatch below is that function pointer,
 * kept as {@link HordeKind}.
 */
export function HordeUpdate(obj: Actor, f: ClassFrame): void {
  const t = HordeOf(obj);
  if (!t) return;
  switch (t.kind) {
    case HordeKind.MemberInit:
      HordeMemberInit(obj, f.rng, f.host);
      obj.alpha = 0;
      return;
    case HordeKind.Member: HordeMemberUpdate(obj, f); return;
    case HordeKind.Corpse: HordeCorpseSinkUpdate(obj); return;
    case HordeKind.EmergeProp: HordeEmergePropUpdate(obj, f); return;
    case HordeKind.Splash: HordeDeathSplashUpdate(obj); return;
    case HordeKind.Ripple: HordeDeathRippleFade(obj); return;
    case HordeKind.SheetAwait: HordeDeformedPropAwaitModel(obj); return;
    case HordeKind.Sheet: HordeDeformedPropUpdate(obj); return;
    default: return;
  }
}

/** Is this a member, alive or a corpse — the objects the counters know. */
function IsMember(t: HordeTail): boolean {
  return t.kind === HordeKind.MemberInit || t.kind === HordeKind.Member
    || t.kind === HordeKind.Corpse;
}

const handler: ClassHandler = {
  init: PlaceHorde,
  update: HordeUpdate,
  ownsShotResult: true,
  leave(obj: Actor): void {
    const t = HordeOf(obj);
    if (t && IsMember(t)) {
      // The script stopped listing the placer this member came from: out of
      // both counters, which the engine's own paths all do before a despawn.
      if (t.kind !== HordeKind.MemberInit
          || t.formation !== HordeFormation.Stage2Block25) {
        ReleaseEnemyAliveCount(obj);
        ReleaseEnemyPresentCount(obj);
      }
      if (G.g_horde_members[t.idx] === obj.at) G.g_horde_members[t.idx] = 0;
    }
    ActorDespawn(obj);
  },
  onDeadSweep(obj: Actor, why: DeadSweep): void {
    const t = HordeOf(obj);
    if (!t || !IsMember(t) || why === DeadSweep.Unloaded) return;
    // `obj+0x121` is the dive's target player here, not a permit: no
    // `ReleaseAttackSlot`, which would free a zombie's.
    if (t.kind !== HordeKind.MemberInit) {
      ReleaseEnemyAliveCount(obj);
      ReleaseEnemyPresentCount(obj);
    }
  },
  debug(obj: Actor): ActorDebug {
    const t = HordeOf(obj);
    if (!t) return { summary: "horde" };
    if (!IsMember(t)) return { summary: HordeKind[t.kind] };
    return {
      summary: `${HordeState[t.state]}/${t.counter}`,
      detail: [
        `member ${t.idx} of ${t.count} · formation ${t.formation}`
          + ` · diver ${G.g_horde_diver}`,
        `seg ${t.segment} t=${t.segT.toFixed(2)} · dive ${t.diveT.toFixed(2)}`,
      ],
      hot: t.state === HordeState.Dive,
    };
  },
};

registerClass(SpawnClass.HordeSpawner, handler);

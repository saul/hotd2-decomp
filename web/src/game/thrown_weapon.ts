/**
 * The weapon a thrower lets go of: one record, two routines.
 *
 * Two allocators make one of these, and each installs its **own** per-frame
 * routine as the task's function pointer, which is the only thing that says
 * which family a weapon belongs to — neither has a class id and neither
 * appears in `g_class_handlers`:
 *
 * | allocator | routine | states |
 * |---|---|---|
 * | `SpawnThrownWeapon` (`FUN_004504E0`), class 0x31 | `ThrownWeaponUpdate` (`FUN_00450780`) | `g_thrown_weapon_states` — `0x00592AE0`, two |
 * | `ZombieThrowHandWeapon` (`FUN_0045A240`), class 0x30 | `ZombieThrownWeaponUpdate` (`FUN_0045A4F0`) | `g_zombie_thrown_weapon_states` — `0x00593170`, four |
 * | `ZslmanBladeEmitAfterimage` (`FUN_00450930`), a `zslman` blade | `ZslmanBladeAfterimageFade` (`FUN_00450A30`) | none: it fades and goes |
 *
 * Both are `ActorAlloc(routine, 0x13F4)` followed by `ActorClearGameFields`
 * (`FUN_004A73D0`), which zeroes everything from `obj+0x34` to the end of the
 * block — so every field below that a launcher does not write starts at zero.
 * The third row is not a weapon at all but what one of them trails: the same
 * `ActorAlloc(routine, 0x13F4)` and clear, made by the weapon's own routine,
 * holding a copy of its pose. It lives in the same list because it is the
 * same kind of task, at the same offsets, drawn the same way.
 * (A note on `ActorAlloc` used to say the opposite, that the body is the
 * previous occupant's memory; the clear is the very next call at
 * `0x004504F8` / `0x0045A259`.)
 *
 * **Why a record in `G` and not an `Actor`.** The same reason as
 * `g_body_creatures` and `g_carried_props`: the engine's task has no class,
 * the port's pool is a fixed object list keyed on class handlers, and every
 * slice of a snapshot has to survive `clonePlain`. The fields keep the
 * engine's offsets, so the routines read as the exe reads.
 *
 * ## What a bullet does to one
 *
 * Both draw routines end the same way: the model under the camera matrix,
 * then **`obj+0x70..0x78` = the view-space position and `RegisterForShotTest`
 * (`FUN_00405160`)** — `0x00450864`..`0x004508AA` for class 0x31,
 * `0x0045A5CC`..`0x0045A612` for class 0x30. `obj+0x34` is `0x80000001` and
 * `obj+0x124` is 2.0 from the launch, so `ShotTestSphere` (`FUN_00404630`)
 * takes the weapon **whole** as a two-unit sphere, and `MarkActorShot`
 * (`FUN_00404DB0`) marks it like any other object. The routine reads the mark
 * back on its next frame, bumps `g_player_hit_count` and switches to its
 * shot-down state. `[proved]` — this is the whole of why a thrown knife can
 * be shot out of the air, and the port had none of it.
 */
import type { Events } from "../core/events";
import type { Rng } from "../core/rng";
import { ActorFlag } from "./actor";
import type { ShotTestEntry } from "./combat/shot_test";
import { G } from "./globals";
import type { GameHost } from "./host";
import {
  MatCopy, MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixTransformPoint, MatrixTranslate, type Mat,
} from "./matrix";
import type { Vec3 } from "./vec";

/**
 * Which per-frame routine the task runs — the function pointer `ActorAlloc`
 * was handed, which is the only thing that tells the two families apart.
 */
export enum ThrownWeaponRoutine {
  /** `ThrownWeaponUpdate` (`FUN_00450780`), installed by `SpawnThrownWeapon`. */
  Thrower = 0,
  /** `ZombieThrownWeaponUpdate` (`FUN_0045A4F0`), by `ZombieThrowHandWeapon`. */
  Zombie = 1,
  /**
   * `ZslmanBladeAfterimageFade` (`FUN_00450A30`), by
   * `ZslmanBladeEmitAfterimage` (`FUN_00450930`): `PUSH 0x450a30` at
   * `0x0045095D`, into the `ActorAlloc` at `0x00450962`.
   */
  ZslmanAfterimage = 2,
}

/**
 * `obj+0x34` bits a thrown weapon's routines write or test.
 *
 * Polymorphic by class, as `obj+0x34` always is (`L3`): these are what the
 * two weapon families use the bits for, named for that and nothing else.
 */
export enum ThrownWeaponFlag {
  /** `MarkActorShot` raised it: a shot landed and nothing has read it yet. */
  Hit = ActorFlag.Hit,
  /**
   * The bit both routines turn into a **player index** when they read the
   * mark: `TEST CL, 0x10` at `0x004507A0` and `0x0045A510`. `MarkActorShot`
   * never writes it — it writes `0x2` or `0x4` — so the hit is always
   * credited to player 0. That is the engine's reading and it is kept.
   */
  PlayerIndex = 0x10,
  /**
   * Raised only by class 0x31's landing, `OR EDX, 0x400C000` at `0x0044FE64`,
   * and read by the `zslman` afterimage (`0x00450A30`), which stops drawing
   * once its weapon has landed.
   */
  Landed = 0x4000,
  /** `RegisterForShotTest` returns before it appends. */
  NoShotTest = ActorFlag.NoShotTest,
  /**
   * The landing and the shot-down arm both raise it, and the routine's hit
   * test refuses on it: a weapon is shot down once, and not after it lands.
   */
  Spent = 0x4000000,
}

/** `MOV dword ptr [ESI + 0x34], 0x80000001` — both launchers, the same value. */
export const THROWN_WEAPON_SPAWN_FLAGS = 0x80000001 | 0;
/**
 * `obj+0x124` and `obj+0x128`: `MOV EAX, 0x40000000` then both stores —
 * `0x004506A3`..`0x004506B5` and `0x0045A3C5`..`0x0045A3D7`. The first is the
 * sphere `ShotTestSphere` tests.
 */
export const THROWN_WEAPON_HIT_RADIUS = 2.0;
/**
 * `obj+0x1F8 = 5` at `0x00450703` and `0x0045A403`: bit 0, which the draw
 * tests and the blink toggles, and bit 2.
 */
export const THROWN_WEAPON_DRAW_FLAGS = 5;
/** `obj+0x1F8` bit 0 — the routine draws, and registers, only while it is up. */
export const THROWN_WEAPON_DRAWN = 1;

/** One weapon — an `ActorAlloc`'d task, at the engine's offsets. */
export interface ThrownWeapon {
  /** `[port-only]` Unique and stable; the renderer binds its node to this. */
  id: number;
  /** The task's function pointer. See {@link ThrownWeaponRoutine}. */
  routine: ThrownWeaponRoutine;
  /**
   * `obj+0x1390` — the thrower, by spawn address. An afterimage's `+0x1390` is
   * its weapon instead, which the port keys by id: {@link weapon}.
   */
  from: number;
  /** `obj+0x13F0` — the model `AssetDrawSlot` draws. */
  slot: number;
  /**
   * `obj+0x1F4`. Class 0x31's launcher copies the thrower's character type
   * here (`0x004506FC`..`0x0045070D`); class 0x30's leaves it zero.
   */
  charType: number;
  /** `obj+0x1310` — the state, an index into the family's own table. */
  state: number;
  /** `obj+0x1312` — the state's sub-state. */
  sub: number;
  /** `obj+0x34`. See {@link ThrownWeaponFlag}. */
  flags: number;
  /** `obj+0x1F8`. Bit 0 draws. */
  drawFlags: number;
  /**
   * `obj+0x136C`. Class 0x31's launcher moves the thrower's off-screen
   * permit latch (`ThrowerFlag.OffScreenPermit`) across into it.
   */
  flags2: number;
  /**
   * `obj+0x121`, s8 — **the permit the weapon took over from its thrower**.
   * It is who the weapon hits, which player the aim leans toward, and what the
   * weapon gives back when it is spent.
   */
  attackPermit: number;
  /** `obj+0x1358` — the bone that threw it, 5 or 8. */
  hand: number;
  /** `obj+0x135C` — the tumble, BAMS a frame. */
  spinRate: number;
  /**
   * `obj+0x1364` — a constant added to the X term of class 0x31's draw.
   * `0x600` for `zsass`, 0 for `zslman`; class 0x30's draw does not read it.
   */
  tilt: number;
  /** `obj+0x1360` — class 0x30: `g_max_attackers`, latched at the throw. */
  maxAttackers: number;
  /** `obj+0x1370` — class 0x30: the straight flight's speed. */
  speed: number;
  /** `obj+0x40..0x48`. */
  pos: Vec3;
  /** `obj+0x4C..0x54`, units a frame. */
  vel: Vec3;
  /** `obj+0x58..0x60`, the arc's acceleration. */
  acc: Vec3;
  /** `obj+0x64`, `obj+0x68`, `obj+0x6C` — BAMS, the draw's X, Y and Z terms. */
  rx: number;
  ry: number;
  rz: number;
  /**
   * `obj+0x70..0x78` — the weapon's position **in view space**, as the draw
   * leaves it. `RegisterForShotTest` reads its depth, `ShotTestSphere` its
   * centre, and the shot-down arm aims away from it.
   */
  view: Vec3;
  /** `obj+0x124`. */
  hitRadius: number;
  /** `obj+0x1344` — frames of flight left. */
  ttl: number;
  /**
   * `obj+0x1330` — the stick, blink and shot-down counters, and an
   * afterimage's life.
   */
  timer: number;
  /** `obj+0x13C0..0x13C8` — where it is flying to. */
  target: Vec3;
  /**
   * `obj+0x1338` — frames until the next afterimage. `ZslmanBladeEmitAfterimage`
   * (`FUN_00450930`) counts it down and reloads it from
   * {@link afterimagePeriod}. Both launchers write it — 4 at `0x00450736` for
   * class 0x31, 7 at `0x0045A419` for class 0x30 — and only class 0x31's
   * routine reads it, and only for character type 0x18.
   */
  afterimageTimer: number;
  /** `obj+0x133C` — what {@link afterimageTimer} reloads with. */
  afterimagePeriod: number;
  /**
   * `obj+0x1368`. On a weapon, how many afterimages it has out: the emitter
   * makes one only below ten, and each gives its count back as it goes —
   * unless the weapon is {@link ThrownWeaponFlag.Spent} by then. On an
   * afterimage, that count as it stood when this one was made
   * (`MOV [EBX+0x1368], EDX` at `0x00450A0D`), which nothing reads.
   */
  afterimages: number;
  /**
   * `obj+0x1390` on an afterimage — the weapon it was made from, by id
   * (`MOV [EBX+0x1390], EBP` at `0x0045097F`). Zero on a weapon, whose
   * `+0x1390` is its thrower, {@link from}.
   */
  weapon: number;
  /**
   * `obj+0x1384` — an afterimage's light: 1.0, or 0.75 for a `zslman` blade's
   * (`0x004509A7`, `0x004509DA` / `0x004509F6`), down by {@link lightStep}
   * every frame it draws. It goes below zero before the life runs out.
   */
  light: number;
  /** `obj+0x1388` — `0x3D888889`, a fifteenth, as an f32 (`0x004509B1`). */
  lightStep: number;
  /**
   * `[port-only]` What this frame's draw handed `SetRenderLightColour`
   * (`FUN_004AA0A0`) before its `AssetDrawSlot`, or `null` for a draw that
   * left the light alone — every draw but an afterimage's. The renderer reads
   * it; nothing reads it back.
   */
  lightColour: [number, number, number] | null;
  /**
   * `[port-only]` What this frame's `AssetDrawSlot` drew with: the engine's
   * modelview (`g_camera_world_to_view` · T · Rz · Ry · Rx), or `null` for a
   * frame that drew nothing. The renderer reads it; nothing reads it back.
   */
  draw: Mat | null;
  /**
   * `[port-only]` `ActorDespawn` ran on it. The engine unlinks the task; the
   * port keeps the record to the end of the frame so the frame still draws
   * it, and the next walk drops it.
   */
  despawned: boolean;
}

/** `[port-only]` What one frame of a weapon's routine needs. */
export interface ThrownWeaponFrame {
  /** `g_camera_eye_x/y/z` — `0x009C71E0`. */
  eye: Vec3;
  cam: ThrownWeaponCamera | null;
  host: GameHost;
  rng: Rng;
  events?: Events;
}

/**
 * The shot-down arms of both families share these: `FMUL float ptr
 * [0x00565EEC]` — `0x3FA66666`, 1.3, the spin speeding up (`0x004501F9`,
 * `0x00459EA5`) — and `CMP EAX, 0xB4`, three seconds and it is gone whatever
 * (`0x00450329`, `0x00459FA0`).
 */
export const SHOT_DOWN_SPIN_SCALE = 1.2999999523162842;
export const SHOT_DOWN_FRAMES = 0xb4;
/** `PlaySoundId(0x1116A9)` — `COMMON\BULLET_MET3_22.WAV`, the ricochet both play. */
export const SFX_RICOCHET = 0x1116a9;

/**
 * `[port-only]` The two camera matrices the routines read off the camera
 * block: `g_camera_world_to_view` (`0x009A6000`, the block's `+0x00`) and its
 * inverse at the block's `+0x40`. `null` with no camera, as in a headless
 * run: the draw then draws nothing and nothing registers.
 */
export interface ThrownWeaponCamera {
  w2v: Mat;
  v2w: Mat;
}

/** `[port-only]` The two camera matrices, off the host, or none. */
export function ThrownWeaponCameraOf(host: GameHost): ThrownWeaponCamera | null {
  const w2v = new Array<number>(16).fill(0);
  const v2w = new Array<number>(16).fill(0);
  return host.cameraMatrices?.(w2v, v2w) ? { w2v, v2w } : null;
}

/**
 * A fresh record: `ActorAlloc` (`FUN_004A6FA0`) and then `ActorClearGameFields`
 * (`FUN_004A73D0`), which leaves every game field zero. The launcher writes
 * what it writes on top. `[port-only]` as a function: the engine makes the two
 * calls, and the port's identity for the task is the `id` handed out here.
 */
export function ThrownWeaponAlloc(routine: ThrownWeaponRoutine): ThrownWeapon {
  return {
    id: G.g_thrown_next_id++, routine, from: 0, slot: 0, charType: 0,
    state: 0, sub: 0, flags: 0, drawFlags: 0, flags2: 0, attackPermit: 0,
    hand: 0, spinRate: 0, tilt: 0, maxAttackers: 0, speed: 0,
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    acc: { x: 0, y: 0, z: 0 }, rx: 0, ry: 0, rz: 0,
    view: { x: 0, y: 0, z: 0 }, hitRadius: 0, ttl: 0, timer: 0,
    target: { x: 0, y: 0, z: 0 }, afterimageTimer: 0, afterimagePeriod: 0,
    afterimages: 0, weapon: 0, light: 0, lightStep: 0, lightColour: null,
    draw: null, despawned: false,
  };
}

/**
 * `ActorDespawn` (`FUN_00409CC0`) for a weapon: `obj+0x34 |= 0x80018000`, which
 * among other things is `RegisterForShotTest`'s refusal bit, and out of the
 * task list. `[port-only]` as a function: the engine calls the one routine for
 * every object.
 *
 * **Nothing after it runs.** `ActorDespawn` ends in `ActorKill`
 * (`FUN_004A7040`), which unlinks the running task, puts it on the free list
 * and `_longjmp`s to the `__setjmp3` in `TaskRunTree` (`FUN_004A71A0`) — so a
 * state routine that despawns its weapon takes the rest of the weapon's own
 * routine with it: no draw that frame, no shot-test registration, no
 * afterimage. The port's routines return on {@link ThrownWeapon.despawned}
 * where the jump lands. `[proved]`
 */
export function ThrownWeaponDespawn(w: ThrownWeapon): void {
  w.flags |= THROWN_WEAPON_DESPAWN_FLAGS;
  w.despawned = true;
}

/** `ActorDespawn`'s `OR dword ptr [obj+0x34], 0x80018000`. */
const THROWN_WEAPON_DESPAWN_FLAGS = 0x80018000 | 0;

/**
 * `[port-only]` The draw both routines open their tail with, and the view
 * point after it.
 *
 * ```
 * MatrixStackPush(0)                       ; the top is g_camera_world_to_view
 * MatrixTranslate(obj+0x40, +0x44, +0x48)
 * MatrixRotateZ(obj+0x6C); MatrixRotateY(obj+0x68); MatrixRotateX(<x term>)
 * AssetDrawSlot(obj+0x13F0); MatrixStackPop(1)
 * MatrixStackPush(0); MatrixStackSetTopFromArray(g_camera_blocks + idx*0x1A4)
 * MatrixTransformPoint(obj+0x40 -> obj+0x70); MatrixStackPop(1)
 * ```
 *
 * The X term is the one place the two families differ: class 0x31 draws
 * `obj+0x1364 + obj+0x64` (`0x0045081C`..`0x00450828`), class 0x30 `obj+0x64`
 * alone (`0x0045A58C`..`0x0045A590`). The view point is the world position
 * through the block's `+0x00` matrix — the world-to-view one, `0x9a6000` at
 * `0x0045085C` and `0x0045A5C4`.
 */
export function ThrownWeaponDrawAndProject(w: ThrownWeapon, xTerm: number,
                                           cam: ThrownWeaponCamera | null):
    boolean {
  if (!ThrownWeaponDraw(w, xTerm, cam) || !cam) return false;
  MatrixTransformPoint(cam.w2v, w.pos, w.view);
  return true;
}

/**
 * `[port-only]` The draw alone, without the view point: `MatrixStackPush(0)`,
 * `T · Rz · Ry · Rx(xTerm)`, `AssetDrawSlot`, `MatrixStackPop(1)`. The
 * afterimage's routine is exactly this (`0x00450A66`..`0x00450AEE`) and
 * neither projects nor registers.
 */
export function ThrownWeaponDraw(w: ThrownWeapon, xTerm: number,
                                 cam: ThrownWeaponCamera | null): boolean {
  if (!cam) return false;
  const m = MatCopy(MatIdentity(), cam.w2v);
  MatrixTranslate(m, w.pos.x, w.pos.y, w.pos.z);
  MatrixRotateZ(m, w.rz);
  MatrixRotateY(m, w.ry);
  MatrixRotateX(m, xTerm);
  w.draw = m;
  return true;
}

/**
 * `RegisterForShotTest` (`FUN_00405160`), for this pool. `[port-only]` as a
 * separate function: the engine has one routine for every object, and the
 * port's weapons are not `Actor`s.
 *
 * The gate is the engine's: refused outright while `obj+0x34` bit `0x8000` is
 * up, and otherwise taken only when bit `0x10` is set or the view depth
 * `obj+0x78` is not in front of zero — `TEST AH, 0x41` passes on "less",
 * "equal" and "unordered". The list entry carries the weapon's id; the
 * engine's carries the object pointer, and `ProcessPlayerShotsTestList` tests
 * both kinds of entry in one pass and one sort.
 */
export function RegisterThrownWeaponForShotTest(w: ThrownWeapon): void {
  if (w.flags & ThrownWeaponFlag.NoShotTest) return;
  if (!(w.flags & ActorFlag.ShotTestMesh) && w.view.z > 0) return;
  const entry: ShotTestEntry = {
    at: w.from, flags: w.flags, x: 0, y: 0, z: 0, thrown: w.id,
  };
  G.g_shot_test_list.push(entry);
}

/**
 * `MarkActorShot` (`FUN_00404DB0`)'s whole-object arm, for a weapon --
 * `[port-only]` as a separate function, for the same reason as the
 * registration above:
 * `obj+0x34 |= (1 << (player + 1)) | 8`. The candidate's flags are the
 * weapon's own `0x80000001`, so neither the bone arm nor the world-impact arm
 * runs, and nothing is scored here — the weapon's own routine reads the mark
 * next frame.
 */
export function MarkThrownWeaponShot(w: ThrownWeapon, player: number): void {
  w.flags |= (1 << ((player + 1) & 0x1f)) | ThrownWeaponFlag.Hit;
}

/**
 * The hit test both routines open with, `0x0045078E`..`0x004507C9` and
 * `0x0045A4FE`..`0x0045A539`: a mark that is not already spent bumps
 * `g_player_hit_count` — player 1 only if bit `0x10` is up, which nothing
 * sets (see {@link ThrownWeaponFlag.PlayerIndex}) — and switches the weapon to
 * `state` at sub 0. `[port-only]` as a function; the two sites are the same
 * twelve instructions with a different state number.
 */
export function ThrownWeaponTakeMark(w: ThrownWeapon, state: number): void {
  if (!(w.flags & ThrownWeaponFlag.Hit)) return;
  if (w.flags & ThrownWeaponFlag.Spent) return;
  const p = (w.flags & ThrownWeaponFlag.PlayerIndex) !== 0 ? 1 : 0;
  G.g_player_hit_count[p] = (G.g_player_hit_count[p] ?? 0) + 1;
  w.state = state;
  w.sub = 0;
}

/**
 * The shot-down arms' flight target: a point up to a hundred units off the
 * weapon's own view position on both screen axes, at its depth, taken back to
 * the world through `g_camera_blocks + idx*0x1A4 + 0x40`.
 *
 * ```
 * x = obj+0x70 + (rand() % 10 + 1) * 10.0 * (1 - 2 * (rand() % 2))
 * y = obj+0x74 + (rand() % 10 + 1) * 10.0 * (1 - 2 * (rand() % 2))
 * z = obj+0x78
 * ```
 *
 * The sign is drawn **before** the magnitude on each axis — `0x00450100` then
 * `0x00450122` for x, `0x00450149` then `0x0045016F` for y, and the same
 * order at `0x00459DA8`..`0x00459E1B` — which fixes the order of the four
 * draws. `[port-only]` as a function: both families inline it.
 */
export function ThrownWeaponShotDownTarget(w: ThrownWeapon,
                                           cam: ThrownWeaponCamera | null,
                                           rand: () => number): void {
  const sx = 1 - 2 * (rand() % 2);
  const x = ((rand() % 10) + 1) * SHOT_DOWN_SCATTER * sx + w.view.x;
  const sy = 1 - 2 * (rand() % 2);
  const y = ((rand() % 10) + 1) * SHOT_DOWN_SCATTER * sy + w.view.y;
  const v = { x, y, z: w.view.z };
  // With no camera there is no space to take it back through; the weapon
  // then flies at its own view point, which is as good as any.
  MatrixTransformPoint(cam?.v2w ?? MatIdentity(), v, w.target);
}

/** `FMUL float ptr [0x004C43A4]` — `0x41200000`, 10.0. */
const SHOT_DOWN_SCATTER = 10.0;

// `Vec3Normalize` (`FUN_004AAA00`) is `game/matrix.ts`'s, beside
// `Vec3ScaleToUnitLength`; the crowd push calls it too, and `coli.ts` may not
// import this module without entering its cycle (L56). Re-exported for the
// two shot-down arms that take it from here.
export { Vec3Normalize } from "./matrix";

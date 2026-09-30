/**
 * Class 0x32's projectiles: `Class32SpawnProjectile` (`FUN_0047EE30`), the
 * routine it installs, `Class32ProjectileDispatchAndDraw` (`FUN_0047EFA0`),
 * and the four states of `g_class32_projectile_states` (`0x00596AB0`).
 *
 * A projectile is an actor of the engine's pool that registers for the shot
 * test: one hit point in the shipped spawn's tail, a sphere of 0.1 until it
 * launches and `size * tail+0x14` after, and a shot anywhere in it bursts
 * it. It **gathers** at a hand (or between them) while the boss's clip plays
 * up to its cue, growing through `eff_boss5.bin` `0xB02..0xB33`; it
 * **flies** at a point four units in front of the camera and hurts the
 * player it reaches, or **scatters** across the screen in the final
 * barrage; and it **bursts**, fading, on arrival, on a shot, or when the
 * boss reacts or dies. It trails copies of itself that rise and fade
 * (`tasks.ts`).
 *
 * The port keeps it as an `Actor` of class 0x32 with `Boss5Tail.routine`
 * set to the projectile's, so the shot test, `MarkActorShot` and the hit
 * slots are the ones every actor goes through.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import {
  ActorFlag, makeActor, MotionFlag, type Boss5Actor,
} from "../actor";
import { PROJECTION_DISTANCE_PX } from "../combat/permits";
import { IsPlayerAttackable, PlayerTakeDamage } from "../combat/player";
import { RegisterForShotTest } from "../combat/shot_test";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import { SetRenderLightColour } from "../screen_sprite";
import { ActorClaimHitSlot } from "../hit_slots";
import type { GameHost } from "../host";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
  MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { SpawnClass } from "../spawn_class";
import { CameraBlockViewToWorld, CameraBlockWorldToView } from "../camera/view";
import { vec3, type Vec3 } from "../vec";
import { Class32AdjustRank, Class32StopMoving } from "./common";
import {
  Class32Flag2, Class32ProjectileKind, Class32ProjectileState,
  Class32Routine, Class32State,
} from "./state";
import {
  Class32BarrageRow, Class32ProjectileFrames, Class32TailOf,
} from "./tables";
import { Class32EmitProjectileTrail, Class32ParentOf } from "./tasks";

/** `obj+0x34 = 0x80008001` -- out of the shot test until it launches. */
const PROJECTILE_FLAGS = 0x80008001 | 0;
/** `obj+0x13F0 = 0xB02`; it grows to `0xB33` and flies as that. */
const SLOT_FIRST = 0xb02;
const SLOT_FLYING = 0xb33;
/** `obj+0x1370 = 0x3FCCCCCD` for kind 4, `0x3FE00000` otherwise -- the size it grows to. */
const GROW_CAP_BARRAGE = Math.fround(1.6);
const GROW_CAP = 1.75;
/** `obj+0x1374 = 0x3F000000` -- half a unit a frame. */
const GROW_STEP = 0.5;
/** `obj+0x124 = 0x3DCCCCCD` -- the sphere until launch, and the floor after. */
const RADIUS_MIN = Math.fround(0.1);
/** `obj+0x1364 = 0x23` for volley 2 -- its growth starts later. */
const VOLLEY2_GROW_DELAY = 0x23;
/** The volley whose flight is `* 1.35` and whose growth waits. */
const VOLLEY_BOTH = 2;
/** `FMUL float ptr [0x005691B8]` -- `0x3FACCCCD`, 1.35. */
const VOLLEY2_FLIGHT = Math.fround(1.35);
/** `FMUL float ptr [0x004C4D10]` -- `0x3E99999A`, 0.3: the size at launch. */
const LAUNCH_SHRINK = Math.fround(0.3);
/** `FMUL float ptr [0x004C4CB8]` -- 1.5: the burst's size. */
const BURST_GROW = 1.5;
/** `PlaySoundId(0xD23A9)` -- a launch, and an aimed barrage projectile's flight. */
const SND_LAUNCH = 0xd23a9;
/** `PlaySoundId(0x3C16A9)` -- a burst, unless the boss is lunging. */
const SND_BURST = 0x3c16a9;
/** `rand() % 0x1000` off the pitch and the roll, a frame. */
const TUMBLE = 0x1000;
/** `obj+0x34 |= 0x4008000` -- the burst: out of the shot test, and dead. */
const BURST_FLAGS = ActorFlag.Dead | ActorFlag.NoShotTest;
/** `PlayerTakeDamage(p, 1, 7)`. */
const STRIKE_OVERLAY = 7;
/** `Class32AdjustRank(boss, -3)` -- a player hurt. */
const RANK_HURT = -3;

/** Four units in front of the camera: `MOV [ESP+..], 0xC0800000`. */
const TARGET_DEPTH = -4.0;
/** `FMUL float ptr [0x005691C0]` -- -4.0, the scale a screen offset is taken at. */
const TARGET_SCALE = -4.0;
/** `FMUL float ptr [0x005691BC]` -- `0x3ACCCCCD`, a 640th. */
const SCATTER_PER_PIXEL = Math.fround(0.0015625);
/** `FMUL float ptr [0x005308D4]` -- 640.0, and the screen's half extents 280 and 210. */
const SCREEN_SCALE = 640.0;
const SCREEN_HALF_W = 280.0;
const SCREEN_HALF_H = 210.0;

/** A projectile's screen offset by its place, `Class32ProjectilePickCameraTarget`'s switch. */
const PLACE_OFFSET_WIDE: Readonly<Record<number, number>> = {
  1: 105.0, 2: 213.0, 3: -213.0, 4: -105.0,
};
const PLACE_OFFSET_ONE: Readonly<Record<number, number>> = {
  1: -160.0, 2: 160.0,
};
/** `local_1c = 40.0` -- every placed target is forty pixels up. */
const PLACE_RISE = 40.0;

/** `[port-only]` The next projectile's spawn address -- see {@link Class32ProjectileAt}. */
export const CLASS32_PROJECTILE_AT_BIT = 0x01000000;

/**
 * `[port-only]` -- the next class-0x32 projectile's spawn address. The
 * engine's is a task with no descriptor; the port's pool is keyed on `at`,
 * and bit 24 is one no evt offset and no other synthetic address sets. The
 * counter is in `G` so a snapshot restores it.
 */
export function Class32ProjectileAt(): number {
  const at = (CLASS32_PROJECTILE_AT_BIT
    | (G.g_class32_actor_seq & 0xffffff)) >>> 0;
  G.g_class32_actor_seq += 1;
  return at;
}

/**
 * `Class32SpawnProjectile` — `FUN_0047EE30`. `(boss, kind)`.
 *
 * ```
 * p = ActorAlloc(Class32ProjectileDispatchAndDraw, 0x13F4); ActorClearGameFields(p)
 * kind == 4: p+0x131B = 1;  kind == 5: p+0x131B = 0, kind = 4
 * boss+0x1350++
 * p+0x34 = 0x80008001; p+0x1F8 = 1; p+0x1390 = boss; p+0x1354 = kind
 * p+0x135C = 0; p+0x1360 = boss+0x1360; p+0x1368 = boss+0x1350
 * p+0x1370 = kind == 4 ? 1.6 : 1.75; p+0x1330 = 0; p+0x124 = 0.1
 * p+0x11E = p+0x11C = (s8)tail+0x10; p+0x13F0 = 0xB02; p+0x1320 = 0xFF
 * p+0x131A = boss+0x131A; p+0x1310 = p+0x1312 = 0
 * kind == 2: p+0x1334 = (s8)tail+0x1A (* 5 if boss+0x136C & 4); p+0x1364 = 0
 * else:      p+0x1334 = (s8)tail+0x12; p+0x1364 = boss+0x1360 == 2 ? 0x23 : 0
 * p+0x1374 = 0.5; ActorClaimHitSlot(p)
 * ```
 *
 * `[port-only]` in two respects, both the port's pool: the object is made
 * with `makeActor` and appended to `g_object_list` -- `ActorAlloc` links the
 * task at the end of the ring, so it runs after its boss this frame -- and
 * it is marked `visible`, the port's "the task walk steps it".
 */
export function Class32SpawnProjectile(boss: Boss5Actor, kind: number): void {
  const tail = Class32TailOf(boss);
  const p = makeActor(Class32ProjectileAt(), SpawnClass.Boss5, -1,
                      "boss5 projectile") as Boss5Actor;
  const t = p.boss5;
  t.routine = Class32Routine.Projectile;
  if (kind === Class32ProjectileKind.Barrage) {
    t.aimed = 1;
  } else if (kind === Class32ProjectileKind.BarrageWide) {
    t.aimed = 0;
    kind = Class32ProjectileKind.Barrage;
  }
  boss.boss5.liveProjectiles += 1;
  p.flags = PROJECTILE_FLAGS;
  p.motionFlags = MotionFlag.Drawn;
  t.parent = boss.at;
  t.kind = kind;
  t.laps = 0;
  t.castVolley = boss.boss5.volley;
  t.place = boss.boss5.liveProjectiles;
  t.growCap = kind === Class32ProjectileKind.Barrage
    ? GROW_CAP_BARRAGE : GROW_CAP;
  t.trailCount = 0;
  p.hitRadius = RADIUS_MIN;
  p.radius = RADIUS_MIN;
  const hp = tail?.projectile_hp ?? 0;
  p.maxHp = hp;
  p.hp = hp;
  t.slot = SLOT_FIRST;
  t.bright = 0xff;
  t.attack = boss.boss5.attack;
  p.state = Class32ProjectileState.Gather;
  p.sub = 0;
  if (kind === Class32ProjectileKind.Held) {
    t.trailEvery = tail?.held_trail_interval ?? 0;
    if (boss.flags2 & Class32Flag2.SlowHeldTrail) t.trailEvery *= 5;
    t.growDelay = 0;
  } else {
    t.trailEvery = tail?.trail_interval ?? 0;
    t.growDelay = boss.boss5.volley === VOLLEY_BOTH ? VOLLEY2_GROW_DELAY : 0;
  }
  t.growStep = GROW_STEP;
  p.visible = true;
  G.g_object_list.push(p);
  ActorClaimHitSlot(p);
}

/**
 * `Class32ProjectileDispatchAndDraw` — `FUN_0047EFA0`.
 *
 * ```
 * if (!(p+0x34 & 0x4000000) && ((boss+0x34 & 0x40000000) || boss+0x11C < 1))
 *     { state 3; sub 0 }
 * g_class32_projectile_states[state](p)            ; CALL [EAX*4 + 0x596AB0]
 * if (p+0x1F8 & 1) {
 *     push; T RotZ RotY RotX Scale(p+0x118)
 *     v = 1.0 / (float)(0xFF / p+0x1320); p+0x138C = v
 *     SetRenderLightColour(1.0, v, v); AssetDrawSlot(p+0x13F0); pop
 *     p+0x70 = g_camera_world_to_view * pos; RegisterForShotTest(p)
 *     if (state != 3) {
 *         n = p+0x1334
 *         if (kind == 4) {
 *             if (state == 1 || state == 2) { if (--p+0x133C > 0) n = p+0x1330 + 2 }
 *             else n <<= 3
 *         }
 *         if (++p+0x1330 >= n) { p+0x1330 = 0; Class32EmitProjectileTrail(p) }
 *     }
 * }
 * ```
 *
 * A state that despawns the projectile ends the routine there (L72): no
 * draw, no registration. The port holds `p+0x70` in the world like every
 * actor's (`Actor.shotCentre`), and keeps the view-space copy too, which the
 * two states that test the screen read.
 */
export function Class32ProjectileDispatchAndDraw(p: Boss5Actor, rng: Rng,
                                                 host: GameHost,
                                                 events?: Events): void {
  const t = p.boss5;
  t.draw = null;
  const boss = Class32ParentOf(t.parent);
  if ((p.flags & ActorFlag.Dead) === 0 && boss
      && ((boss.flags & ActorFlag.Reacting) !== 0 || boss.hp < 1)) {
    p.state = Class32ProjectileState.Burst;
    p.sub = 0;
  }
  switch (p.state) {
    case Class32ProjectileState.Gather:
      Class32ProjectileStateGather(p, rng, events); break;
    case Class32ProjectileState.FlyAtCamera:
      Class32ProjectileStateFlyAtCamera(p, rng, events); break;
    case Class32ProjectileState.Scatter:
      Class32ProjectileStateScatter(p, rng, events); break;
    case Class32ProjectileState.Burst:
      Class32ProjectileStateBurst(p, events); break;
  }
  if (p.despawned) return;
  if ((p.motionFlags & MotionFlag.Drawn) === 0) return;
  const m = MatIdentity();
  MatrixTranslate(m, p.pos.x, p.pos.y, p.pos.z);
  MatrixRotateZ(m, p.roll);
  MatrixRotateY(m, p.yaw);
  MatrixRotateX(m, p.pitch);
  MatrixScale(m, t.size, t.size, t.size);
  const v = Math.fround(1.0 / Math.trunc(0xff / t.bright));
  p.alpha = v;
  SetRenderLightColour(1.0, v, v);
  t.draw = { m, light: [1.0, v, v] };
  MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index), p.pos,
                       t.view);
  p.shotCentre.x = p.pos.x;
  p.shotCentre.y = p.pos.y;
  p.shotCentre.z = p.pos.z;
  RegisterForShotTest(p, host);
  if (p.state === Class32ProjectileState.Burst) return;
  let n = t.trailEvery;
  if (t.kind === Class32ProjectileKind.Barrage) {
    if (p.state === Class32ProjectileState.FlyAtCamera
        || p.state === Class32ProjectileState.Scatter) {
      t.trailDelay -= 1;
      if (t.trailDelay > 0) n = t.trailCount + 2;
    } else {
      n <<= 3;
    }
  }
  t.trailCount += 1;
  if (n <= t.trailCount) {
    t.trailCount = 0;
    Class32EmitProjectileTrail(p, rng);
  }
}

const _a = vec3();
const _b = vec3();

/** `[port-only]` A bone's point on the boss -- node record `+0x68`, in the world. */
function BossBonePoint(boss: Boss5Actor, bone: number, out: Vec3): void {
  const h = boss.skel?.bones[bone]?.hit ?? [0, 0, 0];
  out.x = h[0]; out.y = h[1]; out.z = h[2];
}

/**
 * `Class32ProjectileStateGather` — `FUN_0047E440`.
 *
 * ```
 * p+0x34 |= 0x8000
 * sub 0: kind 0: bone 5, cue (boss+0x132C == 2 ? 0x82 : 0x8C) at 0x1D / 0x46
 *        kind 1: bone 8, cue 0x8B at 0x46;  kind 2: bone 8, cue 0x84 at 0x2F
 *        kind 4: bone 8, cue 0x94 at 0xA5   (kind 3, never made, compares garbage)
 *        pos = kind == 4 ? midpoint(boss node 8, boss node 5) : boss node(bone)
 *        kind != 2: if ((boss clip == cue && boss cursor == frame)
 *                       || (boss clip == 0x8A && boss cursor == 0x5A)) { sub++; launch }
 *                   else grow
 *        kind == 2: if ((boss+0x34 & 0x10000000) && !(boss+0x34 & 0x40000000)) grow
 *                   state 3; sub 0; grow
 * sub 1: launch
 * launch: p+0x118 *= 0.3; p+0x124 = p+0x118 * tail+0x14, at least 0.1
 *         Class32ProjectilePickCameraTarget(p, &p+0x13C0)
 *         if (boss+0x136C & 1) { PlaySoundId(0xD23A9); boss+0x136C &= ~1 }
 *         p+0x34 &= ~0x8000; state = kind == 4 ? 2 : 1; sub 0
 * grow:   if (--p+0x1364 < 1) {
 *             if (++p+0x13F0 > 0xB33) p+0x13F0 = 0xB33
 *             p+0x118 += p+0x1374; if (p+0x118 >= p+0x1370) p+0x1374 = 0
 *         }
 * ```
 */
export function Class32ProjectileStateGather(p: Boss5Actor, rng: Rng,
                                             events?: Events): void {
  const t = p.boss5;
  const boss = Class32ParentOf(t.parent);
  p.flags |= ActorFlag.NoShotTest;
  let launch = false;
  if (p.sub === 0) {
    let bone = -1;
    let cue = -1;
    let frame = -1;
    switch (t.kind) {
      case Class32ProjectileKind.LeftHand:
        bone = 5;
        if (boss && boss.boss5.castMode === 2) { cue = 0x82; frame = 0x1d; }
        else { cue = 0x8c; frame = 0x46; }
        break;
      case Class32ProjectileKind.RightHand: bone = 8; cue = 0x8b; frame = 0x46; break;
      case Class32ProjectileKind.Held: bone = 8; cue = 0x84; frame = 0x2f; break;
      case Class32ProjectileKind.Barrage: bone = 8; cue = 0x94; frame = 0xa5; break;
    }
    if (boss) {
      if (t.kind === Class32ProjectileKind.Barrage) {
        BossBonePoint(boss, 8, _a);
        BossBonePoint(boss, 5, _b);
        p.pos.x = Math.fround((_a.x - _b.x) * 0.5 + _b.x);
        p.pos.y = Math.fround((_a.y - _b.y) * 0.5 + _b.y);
        p.pos.z = Math.fround((_a.z - _b.z) * 0.5 + _b.z);
      } else if (bone >= 0) {
        BossBonePoint(boss, bone, _a);
        p.pos.x = _a.x; p.pos.y = _a.y; p.pos.z = _a.z;
      }
    }
    const clip = boss?.motion ?? -1;
    const cursor = boss?.skel?.cursor ?? -1;
    if (t.kind !== Class32ProjectileKind.Held) {
      if ((clip === cue && cursor === frame)
          || (clip === 0x8a && cursor === 0x5a)) {
        p.sub += 1;
        launch = true;
      }
    } else if (!(boss && (boss.flags & ActorFlag.Committed) !== 0
                 && (boss.flags & ActorFlag.Reacting) === 0)) {
      p.state = Class32ProjectileState.Burst;
      p.sub = 0;
    }
  } else if (p.sub === 1) {
    launch = true;
  }
  if (launch) {
    t.size = Math.fround(t.size * LAUNCH_SHRINK);
    const r = t.size * (Class32TailOf(boss ?? undefined)?.projectile_radius ?? 0);
    p.hitRadius = Math.fround(r);
    p.radius = p.hitRadius;
    if (r < RADIUS_MIN) { p.hitRadius = RADIUS_MIN; p.radius = RADIUS_MIN; }
    Class32ProjectilePickCameraTarget(p, t.target, rng);
    if (boss && (boss.flags2 & Class32Flag2.LaunchSound) !== 0) {
      events?.emit("sound.play", { id: SND_LAUNCH });
      boss.flags2 &= ~Class32Flag2.LaunchSound;
    }
    p.flags &= ~ActorFlag.NoShotTest;
    p.state = t.kind === Class32ProjectileKind.Barrage
      ? Class32ProjectileState.Scatter : Class32ProjectileState.FlyAtCamera;
    p.sub = 0;
  }
  t.growDelay -= 1;
  if (t.growDelay < 1) {
    t.slot += 1;
    if (t.slot > SLOT_FLYING) t.slot = SLOT_FLYING;
    t.size = Math.fround(t.size + t.growStep);
    if (t.growCap <= t.size) t.growStep = 0;
  }
}

/**
 * The bit-3 test both flights end on (`0x0047E949`, `0x0047EAFC`): a shot
 * takes a hit point, and at none the projectile bursts. Bit 3 is not
 * cleared, so a projectile shot once keeps losing them. `[port-only]` as a
 * function; the two states inline it.
 */
function ProjectileTakeShot(p: Boss5Actor): void {
  if ((p.flags & ActorFlag.Hit) === 0) return;
  p.hp = ((p.hp - 1) << 16) >> 16;
  if (p.hp < 1) {
    p.state = Class32ProjectileState.Burst;
    p.sub = 0;
  }
}

/**
 * `Class32ProjectileStateFlyAtCamera` — `FUN_0047E810`.
 *
 * ```
 * sub 0: p+0x13F0 = 0xB33; p+0x34 &= ~0x8000; Class32StopMoving
 *        n = g_class32_projectile_frames[boss rank]; volley 2: n = ftol(n * 1.35)
 *        p+0x1338 = n; sub++; vel = (target - pos) / n        ; and on
 * sub 1: pos += vel; p+0x64 -= rand() % 0x1000; r = rand() % 0x1000
 *        p+0x6C -= r; if (--p+0x1338 < 1) {
 *            Class32StopMoving; Class32ProjectileStrikePlayer(p); state 3; sub 0 }
 * then:  the shot test
 * ```
 */
export function Class32ProjectileStateFlyAtCamera(p: Boss5Actor, rng: Rng,
                                                  events?: Events): void {
  const t = p.boss5;
  const boss = Class32ParentOf(t.parent);
  let fly = false;
  if (p.sub === 0) {
    t.slot = SLOT_FLYING;
    p.flags &= ~ActorFlag.NoShotTest;
    Class32StopMoving(p);
    const n = Class32ProjectileFrames(boss?.boss5.rank ?? 0);
    t.flight = t.castVolley === VOLLEY_BOTH
      ? Math.trunc(n * VOLLEY2_FLIGHT) : n;
    const f = t.flight;
    p.sub += 1;
    p.vel.x = Math.fround((t.target.x - p.pos.x) / f);
    p.vel.y = Math.fround((t.target.y - p.pos.y) / f);
    p.vel.z = Math.fround((t.target.z - p.pos.z) / f);
    fly = true;
  } else if (p.sub === 1) {
    fly = true;
  }
  if (fly) {
    p.pos.x = Math.fround(p.vel.x + p.pos.x);
    p.pos.y = Math.fround(p.vel.y + p.pos.y);
    p.pos.z = Math.fround(p.vel.z + p.pos.z);
    p.pitch = (p.pitch - rng.int(TUMBLE)) | 0;
    const r = rng.int(TUMBLE);
    t.flight -= 1;
    p.roll = (p.roll - r) | 0;
    if (t.flight < 1) {
      Class32StopMoving(p);
      Class32ProjectileStrikePlayer(p, events);
      p.state = Class32ProjectileState.Burst;
      p.sub = 0;
    }
  }
  ProjectileTakeShot(p);
}

/**
 * `Class32ProjectileStateScatter` — `FUN_0047E980`, kind 4.
 *
 * ```
 * sub 0: p+0x34 &= ~0x8000; p+0x13F0 = 0xB33
 *        Class32ProjectilePickScatterTarget(p); Class32StopMoving
 *        n = rand() % row.scatter_spread + row.scatter_base       ; row by boss rank
 *        if (p+0x131B == 0) { n += n / 4; p+0x1320 /= 2 }
 *        p+0x1338 = n; vel = (target - pos) / n
 *        if (p+0x131B == 1) PlaySoundId(0xD23A9)
 *        sub++; p+0x133C = n / 6                                  ; and on
 * sub 1: pos += vel; p+0x64 -= rand() % 0x1000
 *        if (--p+0x1338 < 1) { Class32StopMoving
 *            if (Class32ProjectileIsOnScreen(p) == 1) Class32ProjectileStrikePlayer(p)
 *            state 3; sub 0 }
 * then:  the shot test
 * ```
 */
export function Class32ProjectileStateScatter(p: Boss5Actor, rng: Rng,
                                              events?: Events): void {
  const t = p.boss5;
  const boss = Class32ParentOf(t.parent);
  let fly = false;
  if (p.sub === 0) {
    p.flags &= ~ActorFlag.NoShotTest;
    t.slot = SLOT_FLYING;
    Class32ProjectilePickScatterTarget(p, rng);
    Class32StopMoving(p);
    const row = Class32BarrageRow(boss?.boss5.rank ?? 0);
    let n = rng.int(row[1]) + row[0];
    t.flight = n;
    if (t.aimed === 0) {
      n = Math.trunc(n / 4) + n;
      t.flight = n;
      t.bright = Math.trunc(t.bright / 2);
    }
    p.vel.x = Math.fround((t.target.x - p.pos.x) / t.flight);
    p.vel.y = Math.fround((t.target.y - p.pos.y) / t.flight);
    p.vel.z = Math.fround((t.target.z - p.pos.z) / t.flight);
    if (t.aimed === 1) events?.emit("sound.play", { id: SND_LAUNCH });
    p.sub += 1;
    t.trailDelay = Math.trunc(t.flight / 6);
    fly = true;
  } else if (p.sub === 1) {
    fly = true;
  }
  if (fly) {
    p.pos.x = Math.fround(p.vel.x + p.pos.x);
    p.pos.y = Math.fround(p.vel.y + p.pos.y);
    p.pos.z = Math.fround(p.vel.z + p.pos.z);
    const r = rng.int(TUMBLE);
    t.flight -= 1;
    p.pitch = (p.pitch - r) | 0;
    if (t.flight < 1) {
      Class32StopMoving(p);
      if (Class32ProjectileIsOnScreen(p) === 1) {
        Class32ProjectileStrikePlayer(p, events);
      }
      p.state = Class32ProjectileState.Burst;
      p.sub = 0;
    }
  }
  ProjectileTakeShot(p);
}

/**
 * `Class32ProjectileStateBurst` — `FUN_0047ED10`.
 *
 * ```
 * sub 0: f = p+0x34; p+0x1320 = 0xFF; p+0x34 = f | 0x4008000; p+0x118 *= 1.5
 *        p+0x1350 = tail+0x20; p+0x1334 = tail+0x1C
 *        if ((p+0x136C & 0x40) || ((s8)p+0x131A == 3 && (f & 8))) p+0x1334 /= 8
 *        p+0x1340 = (float)((0xFF - p+0x1350) / p+0x1334)       ; integers
 *        if (boss state != 9) PlaySoundId(0x3C16A9)
 *        if (kind != 4) boss+0x1350--; sub++                   ; and on
 * sub 1: p+0x1320 = ftol(p+0x1320 - p+0x1340)
 *        if (p+0x1320 <= p+0x1350) { if (kind == 4) boss+0x1350--; ActorDespawn(p) }
 * ```
 *
 * The divisions truncate toward zero. A projectile that struck and hurt
 * nobody, or a barrage projectile that was shot, fades in an eighth of the
 * time.
 */
export function Class32ProjectileStateBurst(p: Boss5Actor,
                                            events?: Events): void {
  const t = p.boss5;
  const boss = Class32ParentOf(t.parent);
  const tail = Class32TailOf(boss ?? undefined);
  if (p.sub === 0) {
    const f = p.flags;
    t.bright = 0xff;
    p.flags = f | BURST_FLAGS;
    t.size = Math.fround(t.size * BURST_GROW);
    t.fadeEnd = tail?.burst_bright ?? 0;
    t.trailEvery = tail?.burst_frames ?? 0;
    if ((p.flags2 & Class32Flag2.StruckNobody) !== 0
        || (t.attack === 3 && (f & ActorFlag.Hit) !== 0)) {
      t.trailEvery = Math.trunc(t.trailEvery / 8);
    }
    t.fadeStep = Math.trunc((0xff - t.fadeEnd) / t.trailEvery);
    if (!boss || boss.state !== Class32State.LungeAtCamera) {
      events?.emit("sound.play", { id: SND_BURST });
    }
    if (t.kind !== Class32ProjectileKind.Barrage && boss) {
      boss.boss5.liveProjectiles -= 1;
    }
    p.sub += 1;
  } else if (p.sub !== 1) {
    return;
  }
  t.bright = Math.trunc(t.bright - t.fadeStep);
  if (t.bright <= t.fadeEnd) {
    if (t.kind === Class32ProjectileKind.Barrage && boss) {
      boss.boss5.liveProjectiles -= 1;
    }
    ActorDespawn(p);
  }
}

/**
 * `Class32ProjectilePickCameraTarget` — `FUN_0047F190`. `(p, out)`.
 *
 * ```
 * ox = oy = 0; v = p+0x1360
 * if (g_players_in_play == 2 || v == 2)
 *     ox = {1: 105, 2: 213, 3: -213, 4: -105}[p+0x1368] or 0; oy = 40
 * else if (v == 0 || v == 1)
 *     ox = {1: -160, 2: 160}[p+0x1368] or 0; oy = 40
 * a = rand(); b = rand()
 * x = ((7 - (a & 0xF)) + ox) * -4.0 / g_projection_distance_px
 * y = ((31 - (b & 0x3F)) + oy) * -4.0 / g_projection_distance_px
 * out = g_camera_blocks[cam] * (x, y, -4.0)
 * ```
 *
 * A volley below 0 or past 2 (with one player) takes no offset and no rise.
 */
export function Class32ProjectilePickCameraTarget(p: Boss5Actor, out: Vec3,
                                                  rng: Rng): void {
  const t = p.boss5;
  let ox = 0;
  let oy = 0;
  const v = t.castVolley;
  if (G.g_players_in_play === 2 || v === VOLLEY_BOTH) {
    ox = PLACE_OFFSET_WIDE[t.place] ?? 0;
    oy = PLACE_RISE;
  } else if (v === 0 || v === 1) {
    ox = PLACE_OFFSET_ONE[t.place] ?? 0;
    oy = PLACE_RISE;
  }
  const a = rng.int(16);
  const b = rng.int(64);
  _a.x = Math.fround((((7 - a) + ox) * TARGET_SCALE) / PROJECTION_DISTANCE_PX);
  _a.y = Math.fround((((31 - b) + oy) * TARGET_SCALE) / PROJECTION_DISTANCE_PX);
  _a.z = TARGET_DEPTH;
  MatrixTransformPoint(CameraBlockViewToWorld(G.g_camera_index), _a, _b);
  out.x = Math.fround(_b.x);
  out.y = Math.fround(_b.y);
  out.z = Math.fround(_b.z);
}

/**
 * `Class32ProjectilePickScatterTarget` — `FUN_0047EB30`.
 *
 * ```
 * p+0x131B == 1: x = (1 - 2*(rand() % 2)) * (rand() % 0xF0)
 *                y = (1 - 2*(rand() % 2)) * (rand() % 0xB4)
 * else:          s = 1 - 2*(rand() % 2)
 *                x = (rand() % 0x280 + 0x280) * s; y = (rand() % 0x1E0 + 0x1E0) * s
 * p+0x13C0 = g_camera_blocks[cam] * (x * -4.0 * 0.0015625, y * -4.0 * 0.0015625, -4.0)
 * ```
 *
 * An aimed one lands inside the middle of the screen; a wide one a whole
 * screen or more out, in one diagonal.
 */
export function Class32ProjectilePickScatterTarget(p: Boss5Actor,
                                                   rng: Rng): void {
  const t = p.boss5;
  let x: number;
  let y: number;
  if (t.aimed === 1) {
    const sx = 1 - 2 * rng.int(2);
    x = sx * rng.int(0xf0);
    const sy = 1 - 2 * rng.int(2);
    y = sy * rng.int(0xb4);
  } else {
    const s = 1 - 2 * rng.int(2);
    x = (rng.int(0x280) + 0x280) * s;
    y = (rng.int(0x1e0) + 0x1e0) * s;
  }
  _a.x = Math.fround(x * TARGET_SCALE * SCATTER_PER_PIXEL);
  _a.y = Math.fround(y * TARGET_SCALE * SCATTER_PER_PIXEL);
  _a.z = TARGET_DEPTH;
  MatrixTransformPoint(CameraBlockViewToWorld(G.g_camera_index), _a, _b);
  t.target.x = Math.fround(_b.x);
  t.target.y = Math.fround(_b.y);
  t.target.z = Math.fround(_b.z);
}

/**
 * `Class32ProjectileIsOnScreen` — `FUN_0047ECA0`. 1 when `p+0x70 * 640 /
 * p+0x78` is within +-280 and `p+0x74 * 640 / p+0x78` within +-210, else 0.
 */
export function Class32ProjectileIsOnScreen(p: Boss5Actor): number {
  const v = p.boss5.view;
  const x = (v.x * SCREEN_SCALE) / v.z;
  const y = (v.y * SCREEN_SCALE) / v.z;
  if (-SCREEN_HALF_W <= x && x <= SCREEN_HALF_W
      && -SCREEN_HALF_H <= y && y <= SCREEN_HALF_H) {
    return 1;
  }
  return 0;
}

/**
 * `Class32ProjectileStrikePlayer` — `FUN_0047F320`.
 *
 * ```
 * l0 = lives[0]; l1 = lives[1]                     ; 0x009A5C66, 0x009A5D96
 * if (g_max_attackers == 1) {
 *     if (IsPlayerAttackable(0) == 1) PlayerTakeDamage(0, 1, 7)
 *     if (IsPlayerAttackable(1) == 1) PlayerTakeDamage(1, 1, 7)
 * } else if (p+0x70 * g_projection_distance_px / p+0x78 < 0.0) {
 *     if (IsPlayerAttackable(1) == 1) PlayerTakeDamage(1, 1, 7)
 * } else if (IsPlayerAttackable(0) == 1) PlayerTakeDamage(0, 1, 7)
 * if (l0 <= lives[0] && l1 <= lives[1]) p+0x136C |= 0x40
 * else Class32AdjustRank(boss, -3)
 * ```
 *
 * With two attackers the projectile hurts the player on its side of the
 * screen, by the sign `ActorScreenHalfSign` uses.
 */
export function Class32ProjectileStrikePlayer(p: Boss5Actor,
                                              events?: Events): void {
  const l0 = G.g_player_lives[0] ?? 0;
  const l1 = G.g_player_lives[1] ?? 0;
  if (G.g_max_attackers === 1) {
    if (IsPlayerAttackable(0)) PlayerTakeDamage(0, 1, STRIKE_OVERLAY, events, p);
    if (IsPlayerAttackable(1)) PlayerTakeDamage(1, 1, STRIKE_OVERLAY, events, p);
  } else {
    const v = p.boss5.view;
    if ((v.x * PROJECTION_DISTANCE_PX) / v.z < 0.0) {
      if (IsPlayerAttackable(1)) {
        PlayerTakeDamage(1, 1, STRIKE_OVERLAY, events, p);
      }
    } else if (IsPlayerAttackable(0)) {
      PlayerTakeDamage(0, 1, STRIKE_OVERLAY, events, p);
    }
  }
  if (l0 <= (G.g_player_lives[0] ?? 0) && l1 <= (G.g_player_lives[1] ?? 0)) {
    p.flags2 |= Class32Flag2.StruckNobody;
    return;
  }
  const boss = Class32ParentOf(p.boss5.parent);
  if (boss) Class32AdjustRank(boss, RANK_HURT);
}

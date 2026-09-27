/**
 * Class 0x14 being shot: `Class14ResolveShotBone` (`FUN_00476270`), the first
 * thing `Class14Update` does, and the two routines it reaches.
 *
 * **Only bone 1 can hurt the boss, and only through a window.** A shot the
 * port's pick lands on any bone raises `obj+0x34` bit 3 and names the bone in
 * `obj+0x190 + player` (`MarkActorShot`), and that is all it does; this is
 * what the hit means:
 *
 * 1. any bone but 1, or any bone while the phase immunity (`0x100`) is up:
 *    a ricochet sprite at the bone and nothing else;
 * 2. bone 1: the shot line must pass within 3.5 of a point four up and one
 *    forward of the bone (`RayTestSphere`), **and** flipbook B -- the thing
 *    on the boss's chest that opens and shuts -- must be at least 19 frames
 *    open, **and** the point where the line enters a 5.5 sphere about the
 *    bone must lie inside that frame's cone. Anything else is the ricochet;
 * 3. through all three: the damage, the blood, the reaction.
 *
 * All of it is `[proved]` from the instruction stream, including the tails
 * Ghidra's listing drops after `MatrixStackPop` (L35).
 *
 * ## Space
 *
 * The engine does this in the camera's view space and in world space, mixing
 * the two: the weak-point sphere is tested in view space against the shot
 * record's angles, the cone in world space against the shot record's segment.
 * The port's bone matrices are world ones (`game/skeleton.ts`), so the view
 * half converts through the host's camera matrices -- the same camera block
 * the engine reads -- and the world half needs nothing.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, type Actor } from "../actor";
import { BossHpFractionOf } from "../boss_hp_bar";
import { BossModeRecordGrade } from "../boss_mode";
import { LineSphereIntersect } from "../carried_prop";
import { QueryGroundHeightAt } from "../coli";
import { ScoreAddForPlayer } from "../combat/score";
import { RayTestSphere, ShotRayAnglesFromView } from "../combat/shot_test";
import { SpawnBloodSpray } from "../effects/blood";
import { SpawnSpriteEffect } from "../effects/sprite";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import type { GameHost } from "../host";
import {
  MatCopy, MatIdentity, MatrixGetTranslation, MatrixInvert, MatrixRotateX,
  MatrixTransformPoint, MatrixTranslate, RADIANS_TO_BAMS, FtolS16,
} from "../matrix";
import { SpawnClass } from "../spawn_class";
import { vec3, type Vec3 } from "../vec";
import { Class14State, type Boss2Tail } from "./state";
import {
  CLASS14_CAMERA_RISE, CLASS14_DAMAGE_CAP, CLASS14_SCORE_HIT,
  CLASS14_SCORE_KILL, Class14BoneDamage, Class14DamageCone,
  Class14PhaseHpFrac, Class14Sound,
} from "./tables";

/** The one bone the weak point is on. */
const WEAK_POINT_BONE = 1;
/** `Translate(0, 4.0f, 1.0f)` (`0x40800000`, `0x3F800000`) and its radius, 3.5. */
const WEAK_POINT_OFFSET: Vec3 = { x: 0, y: 4, z: 1 };
const WEAK_POINT_RADIUS = 3.5;
/** `Translate(0, 3.0f, 0)` (`0x40400000`) and the entry sphere's 5.5. */
const CONE_CENTRE_Y = 3;
const CONE_SPHERE_RADIUS = 5.5;
/** `SpawnBloodSpray(obj, bone, 2.0f)` — `PUSH 0x40000000`. */
const BLOOD_SEVERITY = 2;
/** `SpawnSpriteEffect(&pt, 2, 1, player)`: kind 2, facing the camera. */
const RICOCHET_KIND = 2;
/** `FADD [0x004C43B0]` — the ground probe starts 100 above. */
const GROUND_PROBE = 100;
/** `FADD [0x0055D2B4]` — the lunge's airborne margin, 5.0. */
const LUNGE_AIR_MARGIN = 5;
/** `+0x94` is raised by 2 a reaction and held at 7. */
const WINDOW_STEP = 2;
const WINDOW_MAX = 7;

const _p = vec3();
const _pv = vec3();
const _e = vec3();
const _ov = vec3();
const _ev = vec3();
const _w = vec3();
const _l = vec3();

function Tail(obj: Actor): Boss2Tail | null {
  return obj.cls === SpawnClass.Boss2 ? obj.boss2 : null;
}

/**
 * `Class14SpawnNoDamageHitEffect` — `FUN_00476A30`. The ricochet: kind 2 of
 * `SpawnSpriteEffect`, facing the camera, at the bone's hit centre (`R+0x68`,
 * which the last draw left) taken to world space.
 *
 * The routine hands over the angle words of its parameter block unwritten;
 * the effect's camera-facing arm computes its own, so they are not read.
 */
export function Class14SpawnNoDamageHitEffect(obj: Actor, bone: number,
                                              player: number, host?: GameHost,
                                              events?: Events): void {
  const h = obj.skel?.bones[bone]?.hit;
  if (!h) return;
  SpawnSpriteEffect(vec3(h[0], h[1], h[2]), 0, 0, RICOCHET_KIND, 1, player,
                    host, events);
}

/**
 * Gate 1: `RayTestSphere(player, P, 3.5) >= 0` with `P` the translation of
 * bone 1's **view** matrix times `Translate(0, 4.0, 1.0)`.
 *
 * `[port-only]` in how it gets its numbers, and the same way the port's
 * `ProcessPlayerShotsTestList` gets them (`combat/shot_test.ts`): the bone's
 * matrix is world here, so `P` and the fired ray go to view space through
 * the host's camera, the ray's direction becomes `BuildShotRay`'s four
 * angles, and `P` is measured from the eye, where the engine's line starts.
 * Without a camera there is no view space and no hit -- the engine is never
 * without one.
 */
function Class14WeakPointInReach(W1: ArrayLike<number>, player: number,
                                 host: GameHost | undefined): boolean {
  const ray = G.g_crosshair_ray[player];
  const toView = host?.viewSpaceOfPoint;
  if (!ray || !toView) return false;
  const m = MatCopy(MatIdentity(), W1);
  MatrixTranslate(m, WEAK_POINT_OFFSET.x, WEAK_POINT_OFFSET.y,
                  WEAK_POINT_OFFSET.z);
  MatrixGetTranslation(m, _p);
  _e.x = ray.origin.x + ray.dir.x;
  _e.y = ray.origin.y + ray.dir.y;
  _e.z = ray.origin.z + ray.dir.z;
  if (!toView(_p, _pv) || !toView(ray.origin, _ov) || !toView(_e, _ev)) {
    return false;
  }
  const dx = _ev.x - _ov.x, dy = _ev.y - _ov.y, dz = _ev.z - _ov.z;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0)) return false;
  const a = ShotRayAnglesFromView({ x: dx / len, y: dy / len, z: dz / len });
  return RayTestSphere(a, _pv.x - _ov.x, _pv.y - _ov.y, _pv.z - _ov.z,
                       WEAK_POINT_RADIUS) >= 0;
}

/**
 * Gate 2, the window cone, `0x00476463..0x00476728`. Answers true when the
 * shot lands.
 *
 * ```
 * C = g_class14_damage_cones[B.frame - B.low]
 * if (C.maxYaw == 0) miss                       ; rows 0..18: shut
 * W = cam * V1 * T(0, 3, 0)                     ; world
 * LineSphereIntersect(5.5, W, S, S + seg, &A, &B)
 * Q = |S - A| <= |S - B| ? A : B                ; the nearer crossing
 * L = Q * inverse(RotX(C.rotX) * T(0, 3, 0) * V1 * cam)
 * pitch = (s16)ftol(atan2(-L.y, L.z) * K)
 * yaw   = (s16)ftol(atan2( L.x, L.z) * K)
 * miss if |yaw| > C.maxYaw || pitch < C.minPitch || pitch > C.maxPitch
 * ```
 *
 * `S` and `seg` are the shot record's `+0x18` and `+0x24`, world space; the
 * port's are the fired ray's origin and direction, which describe the same
 * line. The routine never tests `LineSphereIntersect`'s answer: the line has
 * just passed within 3.5 of a point 1.41 from `W`, so it crosses the 5.5
 * sphere every time. `[port-only]` A miss is treated as no damage all the
 * same, rather than reading two points that were never written.
 */
function Class14WindowConeHit(W1: ArrayLike<number>, t: Boss2Tail,
                              player: number): boolean {
  const [maxYaw, rotX, minPitch, maxPitch] =
    Class14DamageCone(t.bookB.frame - t.bookB.low);
  if (maxYaw === 0) return false;
  const ray = G.g_crosshair_ray[player];
  if (!ray) return false;
  const m = MatCopy(MatIdentity(), W1);
  MatrixTranslate(m, 0, CONE_CENTRE_Y, 0);
  MatrixGetTranslation(m, _w);
  const S = ray.origin;
  const E = { x: S.x + ray.dir.x, y: S.y + ray.dir.y, z: S.z + ray.dir.z };
  const hit = LineSphereIntersect(CONE_SPHERE_RADIUS, _w, S, E);
  if (!hit) return false;
  const [A, B] = hit;
  const dA = Math.sqrt((S.x - A.x) ** 2 + (S.y - A.y) ** 2 + (S.z - A.z) ** 2);
  const dB = Math.sqrt((S.x - B.x) ** 2 + (S.y - B.y) ** 2 + (S.z - B.z) ** 2);
  // `FLD dA; FCOMP dB; TEST AH, 0x41; JZ` -- the second only when strictly
  // farther, so a tangent (A == B) takes A.
  const Q = Math.fround(dA) <= Math.fround(dB) ? A : B;
  MatrixRotateX(m, rotX);
  MatrixInvert(m);
  MatrixTransformPoint(m, Q, _l);
  const pitch = FtolS16(Math.atan2(-_l.y, _l.z) * RADIANS_TO_BAMS);
  const yaw = FtolS16(Math.atan2(_l.x, _l.z) * RADIANS_TO_BAMS);
  if (Math.abs(yaw) > maxYaw) return false;
  if (pitch < minPitch) return false;
  if (pitch > maxPitch) return false;
  return true;
}

/**
 * `Class14ApplyBoneDamage` — `FUN_004763E0`, `(obj, bone, player)`.
 *
 * The two gates above, then -- unless the boss is already dead -- the damage:
 *
 * ```
 * f = (float)g_class14_bone_damage[rank][g_players_in_play - 1]
 * if (g_GameMode == 1)                           ; Original only, 0x00476772
 *     f = factor == -1.0f ? f + f : f * factor   ; factor at 0x009A224C + p*0x14
 * if (f > 33.0) f = 33.0
 * hp = ftol(hp - f); rankBump++; PlaySoundId(0x316A9)
 * if (hp <= 0) { g_boss_hp_fraction = 0.0; flags = flags & ~0x2000 | 0x4000000;
 *                g_enemies_alive--; ScoreAddForPlayer(p, 0x5DC); BossModeRecordGrade(); }
 * else { g_boss_hp_fraction = (float)hp / maxhp;
 *        if (hp <= maxhp * frac[phase]) flags |= 0x100; }
 * ScoreAddForPlayer(p, 10)
 * ```
 *
 * then the blood, and -- unless a reaction is already running (`0x40000000`)
 * -- the reaction and the window step.
 */
export function Class14ApplyBoneDamage(obj: Actor, bone: number,
                                       player: number, host?: GameHost,
                                       events?: Events): void {
  const t = Tail(obj);
  const W1 = obj.skel?.bones[WEAK_POINT_BONE]?.mat;
  if (!t || !W1) return;
  if (!Class14WeakPointInReach(W1, player, host)
      || !Class14WindowConeHit(W1, t, player)) {
    Class14SpawnNoDamageHitEffect(obj, bone, player, host, events);
    return;
  }
  if (!(obj.flags & ActorFlag.Dead)) {
    let f = Class14BoneDamage(t.rank, G.g_players_in_play);
    if (G.g_GameMode === GameMode.Original) {
      const k = G.g_original_weapon_damage_scale[player] ?? 1;
      f = k === -1 ? f + f : f * Math.fround(k);
    }
    // `FCOM [0x0055E1B4]; TEST AH, 0x41; JNZ` keeps anything not above it.
    if (f > CLASS14_DAMAGE_CAP) f = CLASS14_DAMAGE_CAP;
    // `FILD hp; FSUB ST0, ST1; CALL __ftol; MOV word ptr [ESI+0x11C], AX`.
    obj.hp = (Math.trunc(obj.hp - f) << 16) >> 16;
    t.rankBump = ((t.rankBump + 1) << 24) >> 24;
    events?.emit("sound.play", { id: Class14Sound.Blood });
    if (obj.hp <= 0) {
      // `MOV dword ptr [0x009C8E10], 0x0` at `0x004767F8`.
      G.g_boss_hp_fraction = 0;
      obj.flags = (obj.flags & ~ActorFlag.NoHitReaction) | ActorFlag.Dead;
      G.g_enemies_alive -= 1;
      ScoreAddForPlayer(player, CLASS14_SCORE_KILL, events);
      BossModeRecordGrade();
    } else {
      // `FILD hp; FIDIV maxhp; FSTP float ptr [0x009C8E10]` at `0x0047684E`.
      G.g_boss_hp_fraction = BossHpFractionOf(obj.hp, obj.maxHp);
      if (!(obj.maxHp * Class14PhaseHpFrac(t.phase) < obj.hp)) {
        obj.flags |= ActorFlag.ShotImmune;
      }
    }
    ScoreAddForPlayer(player, CLASS14_SCORE_HIT, events);
  }
  SpawnBloodSpray(obj.at, bone, BLOOD_SEVERITY);
  if (obj.flags & ActorFlag.Reacting) return;
  if (!(obj.flags & ActorFlag.NoHitReaction)) {
    const airborne = Class14ReactsAirborne(obj, t);
    obj.flags = (obj.flags & ~ActorFlag.PoseFrozen) | ActorFlag.Reacting;
    t.savedState = t.state;
    t.savedSub = t.sub;
    if (airborne) {
      t.state = Class14State.KnockedDown;
      t.sub = 0;
    } else {
      t.state = Class14State.CuedMotion;
      t.sub = 0;
      t.cameraRise = CLASS14_CAMERA_RISE;
    }
    events?.emit("sound.play", { id: Class14Sound.React });
  }
  // `ADD word ptr [EAX + 0x94], 2; CMP 8; JL` -- then 7.
  t.timing += WINDOW_STEP;
  if (t.timing >= WINDOW_MAX + 1) t.timing = WINDOW_MAX;
}

/**
 * The airborne test at `0x004768C3..0x0047694B`: in state 12 or 14 anywhere
 * above the ground under it, or in state 9 more than five above.
 */
function Class14ReactsAirborne(obj: Actor, t: Boss2Tail): boolean {
  const probe = Math.fround(obj.pos.y + GROUND_PROBE);
  if (t.state === Class14State.LeapAttack
      || t.state === Class14State.LeapFromSide) {
    if (QueryGroundHeightAt(obj.pos.x, probe, obj.pos.z) < obj.pos.y) {
      return true;
    }
  }
  if (t.state === Class14State.LungeAtCamera) {
    const g = QueryGroundHeightAt(obj.pos.x, probe, obj.pos.z);
    if (g + LUNGE_AIR_MARGIN < obj.pos.y) return true;
  }
  return false;
}

/**
 * `Class14ResolveShotBone` — `FUN_00476270`.
 *
 * ```
 * if (!(obj+0x34 & 8)) return
 * switch (obj+0x34 & 6) {                   ; who fired
 *   case 2: order = {0, -1}; case 4: order = {1, -1}
 *   default: r = rand() % 2; order = {r, r ^ 1}
 * }
 * obj+0x34 &= ~0xE
 * for (p in order) {                        ; both entries, to 0x009C8910
 *     if (p == -1) continue
 *     bone = (s8)obj+0x190[p]; if (bone <= 0) continue
 *     pt = cam * R(bone)+0x68               ; the bone's hit centre, world
 *     if (!(obj+0x34 & 0x100) && bone == 1) {
 *         Class14ApplyBoneDamage(obj, bone, p)
 *         if (obj+0x34 & 0x4000000) obj+0x34 |= 0x100
 *     } else SpawnSpriteEffect(&pt, 2, 1, p)
 * }
 * ```
 *
 * The per-player bone byte is read and not cleared: `MarkActorShot` writes
 * it again on the next hit, and a stale one is never read, because only a
 * player whose bit is up this frame is in the order.
 */
export function Class14ResolveShotBone(obj: Actor, rng: Rng, host?: GameHost,
                                       events?: Events): void {
  if (!(obj.flags & ActorFlag.Hit)) return;
  const bits = obj.flags & (ActorFlag.HitByPlayer0 | ActorFlag.HitByPlayer1);
  let order: [number, number];
  if (bits === ActorFlag.HitByPlayer0) order = [0, -1];
  else if (bits === ActorFlag.HitByPlayer1) order = [1, -1];
  else {
    // `rand(); AND EAX, 0x80000001` -- `rand() % 2` of a non-negative (L46).
    const r = rng.int(2);
    order = [r, r ^ 1];
  }
  obj.flags &= ~(ActorFlag.Hit | ActorFlag.HitByPlayer0
                 | ActorFlag.HitByPlayer1);
  // [port-only] The port's merged record of the same hit; nothing in this
  // class reads it.
  obj.pendingHit = null;
  for (const p of order) {
    if (p === -1) continue;
    const bone = ((obj.shotBones[p] ?? 0) << 24) >> 24;
    if (bone <= 0) continue;
    // The hit centre is taken to world space before the branch, as the
    // engine does -- the same point `Class14SpawnNoDamageHitEffect` uses,
    // inlined here rather than called.
    const h = obj.skel?.bones[bone]?.hit ?? [0, 0, 0];
    const pt = vec3(h[0], h[1], h[2]);
    if (!(obj.flags & ActorFlag.ShotImmune) && bone === WEAK_POINT_BONE) {
      Class14ApplyBoneDamage(obj, bone, p, host, events);
      if (obj.flags & ActorFlag.Dead) obj.flags |= ActorFlag.ShotImmune;
    } else {
      // `SpawnSpriteEffect(&pt, 2, 1, p)` at `0x004763B5`.
      SpawnSpriteEffect(pt, 0, 0, RICOCHET_KIND, 1, p, host, events);
    }
  }
}

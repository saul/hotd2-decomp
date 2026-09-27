/**
 * `Boss4ResolveShot` — `FUN_00491B40`. Class 0x19's whole damage model.
 *
 * This class sets {@link ClassHandler.ownsShotResult}, so a shot at the boss
 * never goes through `combat/`'s `ResolveHit`: `MarkActorShot`
 * (`FUN_00404DB0`) raises `obj+0x34` bit 3 and the shooter's bit, and writes
 * the bone into `obj+0x190 + player` -- and, for a bone with a collision mesh,
 * runs `SpawnWorldImpact`, which leaves the quad's point, surface and normal
 * in `g_shot_hit_records[player]`. This routine reads all of it back, once per
 * shooter.
 *
 * ## What a hit is
 *
 * Ten of the boss's fifteen bones are shot-tested against `coli4.bin` meshes
 * rather than spheres (`Actor.boneColi`), and the mesh's **surface** is the
 * decision: `0x3D` is flesh -- one hit point, blood and a mark on the bone --
 * `0x35` is nothing at all, and anything else is a spark. Bone 2, a sphere, is
 * the head: its damage comes from `g_boss4_head_damage` by player count and
 * rank, and a head hit is what makes the boss react.
 *
 * And the hit points do not run out on their own. `state+0x24` is this phase's
 * share of the bar; the frame the hit points reach it `obj+0x34` bit `0x100`
 * goes up and **every later shot is refused** -- `TEST AH, 0x1; JNZ` at
 * `0x00491DC5`, before any of the arithmetic -- until the arena has moved the
 * boss on (`class19/arena.ts`).
 *
 * Ghidra ends the function at `0x00491D52`, a `MatrixStackPop` (`L35`); the
 * body runs to `0x004920B8` and every line below is from the instructions.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { ActorFlag } from "../actor";
import { G } from "../globals";
import type { GameHost } from "../host";
import { ScoreAddForPlayer } from "../combat/score";
import { SpawnBloodSpray } from "../effects/blood";
import { SpawnSpriteEffect } from "../effects/sprite";
import { LineSphereIntersect } from "../carried_prop";
import { BossHpFractionOf } from "../boss_hp_bar";
import { BossModeRecordGrade } from "../boss_mode";
import { GameMode } from "../game_mode";
import { vec3, type Vec3 } from "../vec";
import { Boss4SpawnBoneHitMark } from "./hit_mark";
import {
  BOSS4_BODY_DAMAGE, BOSS4_FLESH_SURFACE, BOSS4_FOOT_A, BOSS4_FOOT_B,
  BOSS4_SHOT_DAMAGE_CAP, BOSS4_SILENT_SURFACE, BOSS4_WEAK_BONE, Boss4Sound,
  Boss4State, Boss4Tables,
} from "./state";
import type { Boss4Block as Blk } from "./state";

/** Points for one head hit -- `PUSH 0xA` at `0x00491DF3`. */
const BOSS4_HEAD_SCORE = 10;

/** Points for the kill -- `PUSH 0x5DC` at `0x00491EA4`. */
export const BOSS4_KILL_SCORE = 0x5dc;

/** `SpawnBloodSpray(obj, bone, 0x3F4CCCCD)` -- a flesh hit's, 0.8. */
const FLESH_BLOOD = Math.fround(0.8);
/** `SpawnBloodSpray(obj, 2, 0x40000000)` -- a damaging head hit's, 2.0. */
const HEAD_BLOOD = 2.0;
/** `SpawnSpriteEffect(&point, 0x33, 1, p)` -- the spark, camera-facing. */
const SPARK_KIND = 0x33;
const SPARK_FACE_CAMERA = 1;

/**
 * `FMUL float ptr [0x00570A44]` -- -9.0. The head model is
 * `g_boss4_head_slot_by_bar[trunc(bar * 9)]`, computed as
 * `0x005709A0 - ftol(bar * -9.0) * 2`.
 */
const HEAD_MODEL_STEPS = -9.0;

/**
 * `FLD [g_camera_fixed_eye_y]; FADD [0x004C43A4]` -- 10.0 above the ground
 * plane: a head hit with both feet at least this high is the knock-down.
 */
const KNOCKDOWN_FOOT_RISE = 10.0;

/** `obj+0x34` bits 1..3, the shot and its shooters -- `AND AL, 0xF1`. */
const SHOT_BITS = 0x0e;

const _point = vec3();
const _centre = vec3();
const _a = vec3();
const _b = vec3();
const _va = vec3();
const _vb = vec3();
const _foot = vec3();

/**
 * `Boss4ResolveShot` — `FUN_00491B40`.
 *
 * ```
 * if (!(obj+0x34 & 8)) return
 * order = obj+0x34 & 6 == 2 ? {0, -1} : == 4 ? {1, -1} : r = rand() & 1 -> {r, r ^ 1}
 * obj+0x34 &= ~0x0E
 * surface = 0                  -- a local, zeroed ONCE, not per shooter
 * for p in order: if p == -1 or (bone = (s8)obj[0x190 + p]) <= 0: next
 *     bone has a mesh (record +0x88 != -1):
 *         point = g_shot_hit_records[p].point; surface = .surface
 *     else:
 *         LineSphereIntersect(record radius, record centre, p's shot segment)
 *         1 -> out1;  2 -> both view z < 0 ? the one nearer the camera : centre
 *         otherwise the centre; into the world.  surface untouched
 *     effects (below); damage (Boss4ApplyShotDamage); reaction (below)
 * ```
 *
 * The shooter's bone byte is **not** cleared: the engine leaves it, and the
 * next shot rewrites it before the bit that makes it read comes back up.
 */
export function Boss4ResolveShot(obj: Actor, b: Blk, host: GameHost, rng: Rng,
                                 events?: Events): void {
  if (!(obj.flags & ActorFlag.Hit)) return;
  const who = obj.flags & 6;
  let order: [number, number];
  if (who === 2) order = [0, -1];
  else if (who === 4) order = [1, -1];
  else {
    // `CALL rand; AND EAX, 0x80000001` -- a signed low bit, which for rand()'s
    // 0..0x7FFF is the plain one.
    const r = rng.int(2);
    order = [r, r ^ 1];
  }
  obj.flags &= ~SHOT_BITS;
  // The port's merged record of the same shot, consumed with the bits.
  obj.pendingHit = null;

  let surface = 0;
  for (const p of order) {
    if (p === -1) continue;
    const bone = ((obj.shotBones[p] ?? 0) << 24) >> 24;
    if (bone <= 0) continue;

    if (obj.boneColi[String(bone)]) {
      const rec = G.g_shot_hit_records[p];
      _point.x = rec.x; _point.y = rec.y; _point.z = rec.z;
      surface = rec.surface;
    } else {
      Boss4SphereHitPoint(obj, bone, p, host, _point);
    }

    // -- the effects, `0x00491D5E` --------------------------------------
    if (surface === BOSS4_FLESH_SURFACE) {
      Boss4SpawnBoneHitMark(p, bone, obj.at, host);
      SpawnBloodSpray(obj.at, bone, FLESH_BLOOD);
      events?.emit("sound.play", { id: Boss4Sound.Blood02 });
    } else if (surface === BOSS4_SILENT_SURFACE) {
      // `CMP EAX, 0x35; JZ` -- nothing at all.
    } else if (bone === BOSS4_WEAK_BONE
               && !(obj.flags & ActorFlag.ShotImmune)) {
      SpawnBloodSpray(obj.at, BOSS4_WEAK_BONE, HEAD_BLOOD);
      events?.emit("sound.play", { id: Boss4Sound.Blood03 });
    } else {
      // The angles `FUN_00407340` copies from past the point are the stack's;
      // face 1 re-aims the sprite at the camera, so they are never used.
      SpawnSpriteEffect({ x: _point.x, y: _point.y, z: _point.z }, 0, 0,
                        SPARK_KIND, SPARK_FACE_CAMERA, p, host, events);
    }

    // -- the damage, `0x00491DC5` ---------------------------------------
    if (obj.flags & ActorFlag.ShotImmune) continue;
    if (bone !== BOSS4_WEAK_BONE && surface !== BOSS4_FLESH_SURFACE) continue;
    if (!(obj.flags & ActorFlag.Dead)) {
      Boss4ApplyShotDamage(obj, b, bone, p, host);
    }

    // -- the reaction, `0x00491F6E` -------------------------------------
    if (obj.flags & ActorFlag.Dead) {
      b.state = Boss4State.Death;
      b.sub = 0;
      continue;
    }
    if (obj.flags & (ActorFlag.Reacting | ActorFlag.NoHitReaction)) continue;
    if (bone !== BOSS4_WEAK_BONE) continue;
    // `AND EAX, 0xEFFFBFFF; OR EAX, 0x40000000` at `0x00491FA1`.
    obj.flags = (obj.flags & ~(ActorFlag.Committed | ActorFlag.PoseFrozen))
              | ActorFlag.Reacting;
    b.savedState = b.state;
    b.savedSub = b.sub;
    b.state = Boss4FeetInTheAir(obj, host)
      ? Boss4State.KnockDown : Boss4State.Flinch;
    b.sub = 0;
  }
}

/**
 * The sphere arm's point. `LineSphereIntersect` (`FUN_00445C00`) against the
 * bone's hit sphere along the player's shot line, and the choice the routine
 * makes between the two crossings **in view space** -- the one with the
 * larger z, which with `-z` in front is the one nearer the camera, and only
 * when both are in front; a tangent takes its one point, a miss the sphere's
 * centre. `[port-only]` as a function.
 *
 * The engine does the intersection in view space and takes the result into
 * the world; a line through a sphere is the same line through the same sphere
 * either way, so the port intersects in the world and asks the host only for
 * the two depths. With no host to ask -- headless -- the point is the centre,
 * which is only ever the spark's position.
 */
function Boss4SphereHitPoint(obj: Actor, bone: number, p: number,
                             host: GameHost, out: Vec3): void {
  const r = host.boneSphere?.(obj.at, bone, _centre) ?? null;
  const ray = G.g_crosshair_ray[p];
  if (r === null || !ray) return;
  out.x = _centre.x; out.y = _centre.y; out.z = _centre.z;
  _a.x = ray.origin.x; _a.y = ray.origin.y; _a.z = ray.origin.z;
  _b.x = ray.origin.x + ray.dir.x;
  _b.y = ray.origin.y + ray.dir.y;
  _b.z = ray.origin.z + ray.dir.z;
  const hit = LineSphereIntersect(r, _centre, _a, _b);
  if (!hit) return;
  const [p1, p2] = hit;
  if (p1.x === p2.x && p1.y === p2.y && p1.z === p2.z) {
    out.x = p1.x; out.y = p1.y; out.z = p1.z;
    return;
  }
  if (!host.viewSpaceOfPoint?.(p1, _va)) return;
  if (!host.viewSpaceOfPoint?.(p2, _vb)) return;
  if (!(_va.z < 0) || !(_vb.z < 0)) return;
  const nearer = _va.z < _vb.z ? p2 : p1;
  out.x = nearer.x; out.y = nearer.y; out.z = nearer.z;
}

/**
 * The knock-down test, `0x00491FB9`..`0x00492090`: the world Y of bones 15
 * and 12 (the two leaf nodes of the leg chains under bone 9) against the
 * ground plane plus ten. Both at or above it is the knock-down; either below
 * is the flinch. `[port-only]` as a function.
 *
 * With no posed skeleton -- headless -- there are no feet to measure, and the
 * boss standing on the ground is the answer the arena makes true for every
 * frame but a jump: the flinch.
 */
function Boss4FeetInTheAir(obj: Actor, host: GameHost): boolean {
  const g = G.g_camera_fixed_eye_y + KNOCKDOWN_FOOT_RISE;
  if (!host.boneWorld(obj.at, BOSS4_FOOT_A, _foot)) return false;
  if (_foot.y < g) return false;
  if (!host.boneWorld(obj.at, BOSS4_FOOT_B, _foot)) return false;
  return !(_foot.y < g);
}

/**
 * The arithmetic at `0x00491DE9`..`0x00491F6B`, which the decompiler drops
 * because it is all FPU (`L1`). `[port-only]` as a function.
 *
 * ```
 * head:  d = (s8)g_boss4_head_damage[g_players_in_play + rank*2]; hits++;
 *        ScoreAddForPlayer(p, 10)
 * flesh: d = 1.0 ([0x004C4380])
 * Original Mode: scale = [0x009A224C + p*0x14]; d = scale == -1.0 ? d + d : d * scale
 * if (!(d <= 33.0)) d = 33.0
 * hp = (s16)__ftol((float)hp - d)
 * hp <= 0: g_boss_hp_fraction = 0.0 (00491E94); obj+0x34 = &~0x2000 | 0x4000100
 *          g_enemies_alive--; ScoreAddForPlayer(p, 0x5DC); BossModeRecordGrade()
 * else:    g_boss_hp_fraction = (float)hp / maxhp (00491EE9)
 *          hp <= floor: obj+0x34 |= 0x100; unless state 0x12/0x13, &= ~0x2000
 * if (g_boss_hp_fraction < 1.0)                        (00491F2F)
 *     char+0x198 = g_boss4_head_slot_by_bar[trunc(fraction * 9)]   -- bone 2's model
 * ```
 */
function Boss4ApplyShotDamage(obj: Actor, b: Blk, bone: number, p: number,
                              host: GameHost): void {
  let damage: number;
  if (bone === BOSS4_WEAK_BONE) {
    damage = Boss4Tables().head_damage[G.g_players_in_play + b.rank * 2] ?? 0;
    b.headHits = (b.headHits + 1) & 0xff;
    ScoreAddForPlayer(p, BOSS4_HEAD_SCORE);
  } else {
    damage = BOSS4_BODY_DAMAGE;
  }
  if (G.g_GameMode === GameMode.Original) {
    const scale = G.g_original_weapon_damage_scale[p] ?? 1;
    damage = scale === -1 ? damage + damage : damage * scale;
  }
  if (!(damage <= BOSS4_SHOT_DAMAGE_CAP)) damage = BOSS4_SHOT_DAMAGE_CAP;
  obj.hp = (Math.trunc(obj.hp - damage) << 16) >> 16;

  if (obj.hp <= 0) {
    G.g_boss_hp_fraction = 0;
    obj.flags = (obj.flags & ~ActorFlag.NoHitReaction)
              | ActorFlag.Dead | ActorFlag.ShotImmune;
    G.g_enemies_alive -= 1;
    ScoreAddForPlayer(p, BOSS4_KILL_SCORE);
    BossModeRecordGrade();
  } else {
    G.g_boss_hp_fraction = BossHpFractionOf(obj.hp, obj.maxHp);
    if (obj.hp <= b.phaseHpFloor) {
      obj.flags |= ActorFlag.ShotImmune;
      if (b.state !== Boss4State.ThrowHeldProp
          && b.state !== Boss4State.ChargePastCamera) {
        obj.flags &= ~ActorFlag.NoHitReaction;
      }
    }
  }
  if (G.g_boss_hp_fraction < 1.0) {
    // `FMUL [0x00570A44]; CALL __ftol` -- the product is negative, so the
    // truncation rounds toward zero from below: `-trunc(9 * fraction)`.
    const step = -Math.trunc(Math.fround(G.g_boss_hp_fraction)
                             * HEAD_MODEL_STEPS);
    const slot = Boss4Tables().head_slot_by_bar[step];
    if (slot !== undefined) {
      obj.boneSlot[String(BOSS4_WEAK_BONE)] = slot;
      host.setBoneSlot(obj.at, BOSS4_WEAK_BONE, slot);
    }
  }
}

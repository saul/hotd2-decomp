/**
 * The marks a flesh hit leaves on the stage-4 boss --
 * `Boss4SpawnBoneHitMark` (`FUN_004920C0`) and the task it allocates,
 * `Boss4DrawAndAgeBoneHitMark` (`FUN_00492210`).
 *
 * A hit on a bone whose collision surface is flesh (`0x3D`) spawns one: the
 * hit point and its normal are taken **into the bone's own frame** at the
 * moment of the hit, and from then on the mark is drawn under that bone's
 * matrix every frame, so it stays where the bullet went in while the boss
 * moves. It lives 0x78 frames and shrinks away over the last sixty; while the
 * boss is dead it stops ageing and simply stays.
 *
 * ## Why a pool in `G`, and what the port computes
 *
 * The engine allocates a task (`ActorAlloc(Boss4DrawAndAgeBoneHitMark,
 * 0x19C)`) with a 12-byte sub `{bone matrix, life, boss}`. The port keeps the
 * same three facts as a plain record -- the boss's `at` and the bone index in
 * place of the two pointers -- and steps them after the actor walk, where an
 * appended task runs. The draw matrix is built here from the bone's world
 * matrix (`GameHost.boneMatrix`) exactly as the routine builds it on the
 * bone's view-space record, and `render/effects.ts` draws `0x3CD` with it, the
 * same arrangement the carried props have.
 */
import type { GameHost } from "../host";
import { ActorByAt, G } from "../globals";
import { ActorFlag } from "../actor";
import {
  FtolS16, MatCopy, MatIdentity, MatrixInvert, MatrixRotateX, MatrixRotateY,
  MatrixScale, MatrixTransformPoint, MatrixTransformVector, MatrixTranslate,
  type Mat,
} from "../matrix";
import { VecToAngles, type Vec3 } from "../vec";
import { BOSS4_HIT_MARK_SLOT } from "./slots";

/** `MOV dword ptr [EBX + 0x4], 0x78` at `0x004921F2` -- the mark's life. */
const HIT_MARK_LIFE = 0x78;
/** `CMP EAX, 0x3C; JGE` at `0x00492254` -- it shrinks over the last sixty. */
const HIT_MARK_SHRINK_BELOW = 0x3c;
/** `FMUL float ptr [0x0055CB80]` -- 1/60. */
const HIT_MARK_SHRINK_RATE = Math.fround(1 / 60);

/** One mark: the task's `obj+0x40`..`+0x68` and its 12-byte sub. */
export interface Boss4HitMark {
  /** `[port-only]` -- the pool's identity, for the renderer. */
  id: number;
  /** `sub+0x08` -- the boss, as its `at`. */
  boss: number;
  /** `sub+0x00` -- which bone's matrix the mark rides (a pointer there). */
  bone: number;
  /** `sub+0x04` -- frames left. */
  life: number;
  /** `obj+0x40..0x48` -- the hit point in the bone's own frame. */
  local: Vec3;
  /** `obj+0x64` -- the normal's pitch in the bone's frame, BAMS. */
  pitch: number;
  /** `obj+0x68` -- ...and its yaw. */
  yaw: number;
  /**
   * `[port-only]` -- this frame's draw: `AssetDrawSlot(0x3CD)`'s matrix, in
   * world space, or null for a frame with no bone to draw on.
   */
  draw: Mat | null;
}

/**
 * `Boss4SpawnBoneHitMark` — `FUN_004920C0`. `(player, bone, boss)`.
 *
 * ```
 * mark = ActorAlloc(Boss4DrawAndAgeBoneHitMark, 0x19C); ActorClearGameFields
 * sub = ActorAllocRaw(0xC); sub[0] = &char[bone].matrix
 * Push; SetTop(g_camera_blocks); Multiply(sub[0]); MatrixInvert(0)
 *   mark+0x40 = top * g_shot_hit_records[p].point
 *   n = top (rotation) * g_shot_hit_records[p].normal
 *   VecToAngles(n) -> mark+0x64 (pitch), mark+0x68 (yaw)
 * Pop; sub[1] = 0x78; sub[2] = boss
 * ```
 *
 * `g_camera_blocks · bone record` is the bone's world matrix, which is what
 * the host hands over; inverted, it takes the world hit into the bone.
 * Nothing is spawned when the bone is not posed -- a headless host -- which is
 * the only way the port can fail to have the matrix the engine always has.
 */
export function Boss4SpawnBoneHitMark(player: number, bone: number,
                                      bossAt: number, host: GameHost): void {
  const world: number[] = new Array(16).fill(0);
  if (!host.boneMatrix?.(bossAt, bone, world)) return;
  const inv = MatCopy(MatIdentity(), world);
  MatrixInvert(inv);
  const rec = G.g_shot_hit_records[player] ?? G.g_shot_hit_records[0];
  const local = { x: 0, y: 0, z: 0 };
  MatrixTransformPoint(inv, { x: rec.x, y: rec.y, z: rec.z }, local);
  const n = { x: 0, y: 0, z: 0 };
  MatrixTransformVector(inv, { x: rec.nx, y: rec.ny, z: rec.nz }, n);
  const a = VecToAngles(n.x, n.y, n.z);
  G.g_boss4_hit_marks.push({
    id: G.g_boss4_hit_mark_seq++, boss: bossAt, bone, life: HIT_MARK_LIFE,
    // `VecToAngles` (`FUN_004016B0`) stores both angles `__ftol`'d to s16.
    local, pitch: FtolS16(a.pitch), yaw: FtolS16(a.yaw), draw: null,
  });
}

/**
 * `Boss4DrawAndAgeBoneHitMark` — `FUN_00492210`. One mark, one frame. Returns
 * `false` on the frame it calls `ActorKill`.
 *
 * ```
 * Push; SetTop(sub[0]); Translate(+0x40); RotY(+0x68); RotX(+0x64)
 * if (life < 0x3C) { s = life * (1/60); MatrixScale(s, s, s); NoOpStub(s) }
 * AssetDrawSlot(0x3CD); Pop
 * if (!(boss+0x34 & 0x4000000) && --life == 0) ActorKill
 * ```
 *
 * A boss the pool has dropped takes its marks with it: the engine's record
 * pointer would be into freed memory, and there is no bone to draw on.
 */
export function Boss4DrawAndAgeBoneHitMark(m: Boss4HitMark,
                                           host: GameHost): boolean {
  const boss = ActorByAt(m.boss);
  if (!boss || boss.despawned) return false;
  const world: number[] = new Array(16).fill(0);
  if (host.boneMatrix?.(m.boss, m.bone, world)) {
    const t = MatCopy(MatIdentity(), world);
    MatrixTranslate(t, m.local.x, m.local.y, m.local.z);
    MatrixRotateY(t, m.yaw);
    MatrixRotateX(t, m.pitch);
    if (m.life < HIT_MARK_SHRINK_BELOW) {
      const s = Math.fround(m.life * HIT_MARK_SHRINK_RATE);
      MatrixScale(t, s, s, s);
      // `NoOpStub(s)` -- `FUN_0041EBB0`, called with the scale and doing
      // nothing with it.
    }
    m.draw = t;
  } else {
    m.draw = null;
  }
  if (boss.flags & ActorFlag.Dead) return true;
  m.life -= 1;
  return m.life !== 0;
}

/**
 * `[port-only]` -- the mark tasks, stepped in creation order after the actor
 * walk, where the engine's appended tasks run.
 */
export function Boss4HitMarksTick(host: GameHost): void {
  if (G.g_boss4_hit_marks.length === 0) return;
  G.g_boss4_hit_marks = G.g_boss4_hit_marks.filter(
    (m) => Boss4DrawAndAgeBoneHitMark(m, host));
}

/** The slot every mark draws, for `render/effects.ts`. */
export const BOSS4_HIT_MARK_DRAW_SLOT = BOSS4_HIT_MARK_SLOT;

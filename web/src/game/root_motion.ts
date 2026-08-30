/**
 * How a zombie closes the distance: the clips carry it.
 *
 * This was `[open]` for a long time and the answer was in the data all along.
 * None of the five ported class-0x30 states writes `obj+0x4C`, and
 * `ZombieStateWalkDistance` *measures* how far the actor has travelled from a
 * remembered point — which only makes sense if something other than the state
 * is moving it. Measured on `char_adv02`'s own motion row:
 *
 * ```
 * walk      motion 270   31 frames   net  +0.023   in place
 * run       motion 264   16 frames   net -19.333   1.289 per frame, 77 u/s
 * back away motion 256   36 frames   net +15.000   0.429 per frame
 * ```
 *
 * So the approach genuinely does not move — it plays an in-place walk while it
 * waits for its turn in the queue — and the attack run closes fast. An earlier
 * revision of this port invented `CLOSING_SPEED = 6` units per second and
 * applied it to every state, which was both the wrong shape and thirteen times
 * too slow.
 *
 * [diverges] What is still unread is the *mechanism*: `EnemyZombieUpdate`
 * integrates `obj+0x40 += obj+0x4C` and something must put the clip's root
 * delta there, but neither the states nor `ZombieAdvanceMotion` visibly do it.
 * The magnitudes below are measured from the clips rather than invented, so
 * only the transfer is in question.
 */
import type { BakedMotion } from "../bundle";
import type { Actor } from "./actor";

/**
 * The root translation between two frames of a clip, wrapping across the loop.
 *
 * `prev` is the frame the delta was last taken at, `-1` on the first call.
 * Returns the delta in the clip's own space, which the caller rotates by the
 * actor's yaw.
 */
export function rootDelta(m: BakedMotion, prev: number, next: number):
    { x: number; z: number } {
  const n = m.frames;
  if (n <= 1 || prev < 0 || prev === next) return { x: 0, z: 0 };
  const at = (f: number): [number, number] =>
    [m.root[f * 3] ?? 0, m.root[f * 3 + 2] ?? 0];
  const [px, pz] = at(Math.min(prev, n - 1));
  const [nx, nz] = at(Math.min(next, n - 1));
  if (next > prev) return { x: nx - px, z: nz - pz };
  // The clip looped: finish the cycle, then start the next one.
  const [ex, ez] = at(n - 1);
  const [sx, sz] = at(0);
  return { x: (ex - px) + (nx - sx), z: (ez - pz) + (nz - sz) };
}

/**
 * Apply a clip-space root delta to the actor, rotated into world space by its
 * own yaw. The clips walk along their local -Z, which is the actor's forward.
 */
export function ApplyRootMotion(obj: Actor, dx: number, dz: number): void {
  if (dx === 0 && dz === 0) return;
  const a = obj.yaw * ((Math.PI * 2) / 65536);
  const s = Math.sin(a);
  const c = Math.cos(a);
  const nx = obj.pos.x + dx * c + dz * s;
  const nz = obj.pos.z + dz * c - dx * s;

  // The bite's floor -- see `Actor.strikeFloor`. Zero means no floor.
  if (obj.strikeFloor > 0) {
    const tx = nx - obj.target.x;
    const tz = nz - obj.target.z;
    const d = Math.hypot(tx, tz);
    if (d < obj.strikeFloor) {
      if (d < 1e-4) return;
      const k = obj.strikeFloor / d;
      obj.pos.x = obj.target.x + tx * k;
      obj.pos.z = obj.target.z + tz * k;
      return;
    }
  }
  obj.pos.x = nx;
  obj.pos.z = nz;
}

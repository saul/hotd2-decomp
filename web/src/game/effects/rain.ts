/**
 * The rain, as the engine simulates it — `DrawRainParticles` (`FUN_004136A0`).
 *
 * ```c
 * if (rain_enabled == 1) {
 *   SetDrawLayerNibble(0xE);
 *   for (p = 0x007C1EB8; p < 0x007C2114; p += 3 floats) {
 *     p.y -= 2.0;
 *     if (p.y <= -7.0) {                      // respawn
 *       p.x = rand() % 0x14 - 10.0;           // [-10,  9]
 *       p.y = rand() % 0x32 - 25.0;           // [-25, 24]
 *       p.z = rand() % 0x19 - 35.0;           // [-35,-11]
 *     }
 *     world = RotY(camera_yaw) * p + camera_eye;
 *     yaw   = angle_of(world - camera_eye with dy forced to 0);
 *     Translate(world); RotateY(yaw); RotateZ(0x100); Scale(1.5, 3.5, 1.0);
 *     AssetDrawSlotAlpha(0x53, 0.5);
 *   }
 *   SetDrawLayerNibble(8);
 * }
 * ```
 *
 * The routine interleaves its simulation with its drawing, as most of this
 * engine's per-frame code does. This is the simulation half: the fifty
 * positions and the fall. The draw half — the camera-relative transform, the
 * per-drop facing, the `0x100` roll — is `render/rain.ts`, because it needs
 * the camera and produces nodes.
 *
 * Splitting it that way is what puts the positions in `G`, and therefore in
 * the snapshot. Before this a save restored the whole world except where the
 * rain was, and every drop jumped on a load.
 *
 * `rand()` is the CRT one, which `checkpoint` reseeds with 0 during gameplay
 * so a run is deterministic. The port's seeded `Rng` is used for the same
 * reason.
 */
import type { Rng } from "../../core/rng";
import type { Context, System, Tick } from "../../core/system";
import { G, type RainParticle } from "../globals";

/** How the spawn box is described: a modulus and an offset, per axis. */
export interface RainSpawnBox {
  x: readonly [number, number];
  y: readonly [number, number];
  z: readonly [number, number];
}

export interface RainRules {
  /** `p.y -= 2.0`, per 60 Hz frame. */
  fallPerFrame: number;
  /** `p.y <= -7.0`. */
  respawnBelow: number;
  spawn: RainSpawnBox;
}

/** The extent of the array, not a stored count. See the module comment. */
export const RAIN_PARTICLE_COUNT = 50;

function respawn(r: RainRules, rng: Rng): RainParticle {
  // `rand() % m + off` -- an integer draw, so the positions sit on the same
  // lattice the engine's do.
  const pick = (m: number, off: number) => Math.floor(rng.next() * m) + off;
  return {
    x: pick(r.spawn.x[0], r.spawn.x[1]),
    y: pick(r.spawn.y[0], r.spawn.y[1]),
    z: pick(r.spawn.z[0], r.spawn.z[1]),
  };
}

/** Fill the array. The engine's is static data, so this stands in for its load. */
export function RainResetParticles(r: RainRules, rng: Rng): void {
  G.g_rain_particles = [];
  for (let i = 0; i < RAIN_PARTICLE_COUNT; i++) {
    G.g_rain_particles.push(respawn(r, rng));
  }
}

/**
 * One frame of fall, for every particle.
 *
 * `frames` is elapsed 60 Hz frames rather than a literal one, because the
 * player runs the rain on wall time — it keeps falling in free roam and while
 * the script is stepped, which the engine never has to consider.
 */
export function RainAdvanceParticles(r: RainRules, frames: number,
                                     rng: Rng): void {
  if (frames <= 0) return;
  for (const p of G.g_rain_particles) {
    p.y -= r.fallPerFrame * frames;
    if (p.y <= r.respawnBelow) Object.assign(p, respawn(r, rng));
  }
}

/**
 * The rain, as a system in the **game** phase.
 *
 * It is here rather than in `render/rain.ts` because advancing the pool is a
 * decision about the world, not about the picture: the renderer asking for it
 * every frame was the renderer driving the port, which is what
 * `render-drives-the-port` counts. The draw half reads `G.g_rain_particles`
 * and asks for nothing.
 *
 * `[diverges]` — it runs on **wall** time, so the rain keeps falling in free
 * roam and while the script is stepped an instruction at a time. The engine
 * has neither mode and advances it once per frame with everything else.
 */
export class RainSystem implements System {
  readonly id = "game.rain";
  private rules: RainRules | null = null;

  /** The stage's rain block. Seeds the pool, which the engine ships static. */
  configure(rules: RainRules | null, rng: Rng): void {
    this.rules = rules;
    if (rules) RainResetParticles(rules, rng);
  }

  update(ctx: Context, t: Tick): void {
    if (!this.rules || !ctx.walker?.rain) return;
    RainAdvanceParticles(this.rules, t.frozen ? 0 : t.wall * 60, ctx.rng);
  }
}

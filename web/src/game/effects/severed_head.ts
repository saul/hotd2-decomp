/**
 * The head that comes off, and where it lands.
 *
 * One headshot kill in four takes the head off — `ResolveHit`'s second read of
 * `g_app_state`, at `0x00409741`, gates the whole thing on being in play. What
 * the port had was the *removal*: `RemoveBoneSubtree` took the head off the
 * skeleton and nothing else happened, because `docs/formats/combat.md` recorded
 * the routine on that path as "a blood spray at `obj+0x394`". It is not a blood
 * spray. `SpawnSeveredHead` (`FUN_0040A130`) is
 * `ActorAlloc(SeveredHeadUpdate, 0x1A8)` — an **independent object with its own
 * per-frame routine**, carrying the head's own model, and it is thrown.
 *
 * That is the difference between a head that vanishes and a head that flies,
 * bounces off the floor with a wet noise and rolls to a stop.
 *
 * ## Why this is plain data in `G` and not a `Scope`
 *
 * The engine allocates a task; the port cannot, because `game/` holds a fixed
 * object pool and a snapshot slice has to survive `clonePlain`. So the heads
 * are an array of plain records in `G`, spawned and retired by index, which is
 * the same shape `g_shot_requests` uses and for the same reason: it makes them
 * free to save, and a load rebuilds nothing.
 */
import type { Rng } from "../../core/rng";
import type { Events } from "../../core/events";
import { G } from "../globals";
import { QueryGroundHeightAt } from "../coli";
import { vec3, type Vec3 } from "../vec";

/** `+0x5C`, `0xBCA740DA`. */
const GRAVITY = -0.020416665822267532;
/** `+0x50` — `(rand() % 20 + 1) * 0.01 + 0.3`. */
const UP_MIN = 0.3;
const UP_STEPS = 20;
const UP_STEP = 0.01;
/** The push along the camera's own yaw, `0xBE4CCCCD` through `MatrixRotateY`. */
const AWAY_SPEED = -0.2;
/** Both spins: `rand() % 0x800 + 0x800` BAMS a frame. Yaw takes a sign. */
const SPIN_BASE = 0x800;
/** `+0x50 *= -0.25` on contact — a quarter of the speed comes back. */
const BOUNCE = -0.25;
/** Below this the bounce is over and the head settles. */
const REST_SPEED = 0.15;
/** `+0x198 = 0x78` — two seconds on the floor before it goes. */
const LINGER_FRAMES = 0x78;
/** `+0x44 -= 0.04` a frame while it lingers. */
const SINK_PER_FRAME = 0.04;
/** Both spins lose a tenth a frame once it is down. */
const SPIN_DECAY = 10;

/** The two head models whose bounce is a clink rather than a splat. */
const HARD_HEAD_SLOTS = new Set([0x2015, 0x1dc1]);
/** `PlaySoundId` ids on contact: hard, wet, and everything else. */
const SOUND_HARD = 0x1116a9;
const SOUND_WET = 0x4416a9;
const SOUND_SOFT = 0x2616a9;
/** `g_coli_hit_surface` values that count as wet. */
const WET_SURFACES = new Set([0x37, 5]);

/** `+0x194`. */
export enum SeveredHeadPhase {
  /** Not launched yet; the next tick seeds the throw. */
  Launch = 0,
  /** In the air, bouncing. */
  Falling = 1,
  /** Down, sinking, counting out. */
  Settled = 2,
}

/** One head in flight. Plain data: it goes in the snapshot as it is. */
export interface SeveredHead {
  /**
   * `[port-only]` — a stable key for the renderer.
   *
   * The engine has no id: a head *is* its task pointer, and the draw happens
   * inside the same routine that moves it. The port draws from a separate
   * layer, which needs to tell one head's node from another's across frames.
   */
  id: number;
  pos: Vec3;                 // +0x40 / +0x44 / +0x48
  vel: Vec3;                 // +0x4C / +0x50 / +0x54
  gravity: number;           // +0x5C
  pitch: number;             // +0x64
  yaw: number;               // +0x68
  spinPitch: number;         // +0x1A0
  spinYaw: number;           // +0x19C
  scale: number;             // +0x118
  /** The asset slot the head is drawn with — `obj+0x32C`. */
  slot: number;              // +0x1A4
  phase: SeveredHeadPhase;   // +0x194
  timer: number;             // +0x198
}

/**
 * `SpawnSeveredHead` — `FUN_0040A130`.
 *
 * The engine seeds the position from `obj+0x394` — the posed head point —
 * through the camera block's matrix. This port has the head bone's world
 * position from the same place the shot test got it, so it takes that
 * directly. [diverges] in spelling, not in where the head starts.
 */
export function SpawnSeveredHead(at: Vec3, slot: number, pitch: number,
                                 yaw: number, scale = 1): void {
  G.g_severed_heads.push({
    id: G.g_severed_head_seq++,
    pos: vec3(at.x, at.y, at.z),
    vel: vec3(),
    gravity: 0,
    pitch, yaw,
    spinPitch: 0, spinYaw: 0,
    scale, slot,
    phase: SeveredHeadPhase.Launch,
    timer: 0,
  });
}

/**
 * `SeveredHeadUpdate` — `FUN_0040A230`, one head, one frame.
 *
 * Returns false when the head has counted out and should be dropped.
 */
export function SeveredHeadUpdate(h: SeveredHead, rng: Rng,
                                  events?: Events): boolean {
  if (h.phase === SeveredHeadPhase.Launch) {
    h.gravity = GRAVITY;
    h.vel.y = (rng.int(UP_STEPS) + 1) * UP_STEP + UP_MIN;
    // `MatrixRotateY(camera yaw)` applied to `(0, 0, -0.2)`: the head is
    // thrown along the camera's own forward, which is always away from the
    // viewer whichever way the shot came from.
    const a = G.g_camera_yaw_bams * ((Math.PI * 2) / 65536);
    h.vel.x = AWAY_SPEED * Math.sin(a);
    h.vel.z = AWAY_SPEED * Math.cos(a);
    // `rand() & 0x80000001` is a signed `% 2`; `(x * -2 + 1)` turns 0/1 into
    // +1/-1, so the yaw spin takes a side and the pitch spin never does.
    const side = rng.int(2) === 0 ? 1 : -1;
    h.spinYaw = side * (rng.int(SPIN_BASE) + SPIN_BASE);
    h.spinPitch = rng.int(SPIN_BASE) + SPIN_BASE;
    h.phase = SeveredHeadPhase.Falling;
  }

  // Launch falls straight into the ground test in the engine (`goto
  // LAB_0040a352`), so the first frame both throws the head and tests it.
  if (h.phase === SeveredHeadPhase.Falling) {
    // **The test is against the position it is about to reach**, not the one
    // it is at: `ground < y + vy`. A head moving faster than its own height
    // above the floor would otherwise fall through it.
    const ground = QueryGroundHeightAt(h.pos.x, h.pos.y, h.pos.z);
    if (ground >= h.pos.y + h.vel.y) {
      h.pos.y = ground;
      h.vel.y *= BOUNCE;
      events?.emit("sound.play", { id: bounceSound(h) });
      if (Math.abs(h.vel.y) <= REST_SPEED) {
        h.pos.y = ground;
        h.gravity = 0;
        h.vel.x = 0; h.vel.y = 0; h.vel.z = 0;
        h.phase = SeveredHeadPhase.Settled;
        h.timer = LINGER_FRAMES;
      }
    }
  }

  if (h.phase === SeveredHeadPhase.Settled) {
    h.pos.y -= SINK_PER_FRAME;
    h.spinYaw -= (h.spinYaw / SPIN_DECAY) | 0;
    h.spinPitch -= (h.spinPitch / SPIN_DECAY) | 0;
    if (--h.timer < 1) return false;
  }

  h.vel.y += h.gravity;
  h.yaw += h.spinYaw;
  h.pitch += h.spinPitch;
  h.pos.x += h.vel.x;
  h.pos.y += h.vel.y;
  h.pos.z += h.vel.z;
  return true;
}

/**
 * Which noise the floor makes.
 *
 * The two hard slots clink whatever they land on; everything else asks
 * `g_coli_hit_surface`, which `QueryGroundHeightAt` has just written.
 */
function bounceSound(h: SeveredHead): number {
  if (HARD_HEAD_SLOTS.has(h.slot)) return SOUND_HARD;
  return WET_SURFACES.has(G.g_coli_hit_surface) ? SOUND_WET : SOUND_SOFT;
}

/** `[port-only]` — the pool step the engine gets from its task list. */
export function SeveredHeadsTick(rng: Rng, events?: Events): void {
  const live = G.g_severed_heads;
  if (!live.length) return;
  G.g_severed_heads = live.filter((h) => SeveredHeadUpdate(h, rng, events));
}

/**
 * The boss health bar — `BossHpBarSpawn` (`FUN_00435E50`) and
 * `BossHpBarUpdate` (`FUN_00435C80`) — and the one global every boss writes to
 * drive it, `g_boss_hp_fraction`.
 *
 * ## One global, many writers, one reader
 *
 * The bar is not part of any boss. A boss's entrance calls `BossHpBarSpawn`
 * with a screen position, which allocates a task of its own and seats the
 * fill at 1.0; from then on the boss **only writes a float** — hit points
 * over maximum — into `g_boss_hp_fraction` (`0x009C8E10`) whenever it takes
 * damage, and the task reads it back every frame. Every boss class in the game
 * does this: 0x14, 0x19, 0x22, 0x45, 0x2D, 0x32 and class 0x23's sub-type 2.
 * `BossHpBarUpdate` is the only reader in the image, which is what makes it
 * the bar and not a guess about one.
 *
 * Two exact values are signals rather than fills: **-1.0** kills the bar on
 * the spot (`FCOMP float ptr [0x004c4c64]`, `0xBF800000`), and **0.0** — which
 * a dead boss writes — starts a 120-frame blink after which the bar kills
 * itself.
 *
 * ## The two numbers it keeps
 *
 * The task's 0x4C-byte block holds the position the boss gave it and two
 * fills of its own:
 *
 * * `+0x40`, the **shown** fill. While it is below the global it rises by
 *   0.01 a frame, which is the bar filling up from empty when a fight starts
 *   (a hundred frames); once it has caught up it simply equals the global, so
 *   damage is shown on the frame it lands.
 * * `+0x44`, the **trail**. It falls by 0.001 a frame and never below the
 *   shown fill, so the hit points just lost stay on the bar in a second colour
 *   and drain away over the next second or so.
 *
 * The picture is four sprites from `tex/scr_bosmater.bin`: the frame
 * (`0xB8`, 256x32, centred on the spawn point and stretched 1.2 x 0.8), and
 * three 16x16 tiles stretched along a 288-pixel track from `x - 144`: the fill
 * (`0xB5`), the trail (`0xB7`) and the empty remainder (`0xB6`). All four go
 * through the layered queue (`DrawScreenSpriteLayered`, layer 2), so they are
 * drawn after everything the frame draws directly.
 *
 * ## Why this is plain data in `G`
 *
 * The same reason as `g_severed_heads`: the engine allocates a task, and the
 * port keeps a pool of plain records that survive `clonePlain`. The bar is
 * **not** driven from the boss's update, because it outlives it: the blink
 * after a death runs for two seconds, and the boss may have despawned.
 */
import { G } from "./globals";
import { BossHpBarSprite } from "./hud_sprites";
import { DrawScreenSpriteLayered } from "./screen_sprite";

/** `BossHpBarUpdate`'s kill value — `0x004C4C64`, `0xBF800000`. */
export const BOSS_HP_BAR_KILL = -1;
/** What `BossHpBarSpawn` seats — `MOV dword ptr [0x009c8e10], 0x3F800000`. */
export const BOSS_HP_BAR_FULL = 1;
/** `FADD double ptr [0x0055d190]` — 0.01 a frame while filling. */
const FILL_RATE = 0.01;
/** `FSUB double ptr [0x0055e180]` — 0.001 a frame off the trail. */
const TRAIL_RATE = 0.001;
/** `CMP ECX, 0x78` — the blink's last frame; the next one kills the bar. */
const BLINK_FRAMES = 0x78;
/** `MOV ECX, 0xA; IDIV ECX; CMP EDX, 0x5` — hidden 5 frames in every 10. */
const BLINK_PERIOD = 10;
const BLINK_HIDDEN = 5;
/** `FMUL float ptr [0x005308e8]`, 144.0 — half the track, in pixels. */
const TRACK_HALF = 144;
/** `FMUL float ptr [0x0055d178]`, 18.0 — a full track in 16-pixel tiles. */
const TRACK_TILES = 18;
/** Every tile's `sy`, `0x3F4CCCCD`. */
const BAR_SY = 0.8;
/** The frame's `sx`, `0x3F99999A`. */
const FRAME_SX = 1.2;
/** The four depths, pushed as immediates: nearest first. */
const DEPTH_FILL = 1;                     // 0x3F800000
const DEPTH_TRAIL = Math.fround(1.001);   // 0x3F8020C5
const DEPTH_EMPTY = Math.fround(1.002);   // 0x3F804189
const DEPTH_FRAME = Math.fround(1.003);   // 0x3F80624E
/** The tiles' flags: anchor `(1, 2)` -- left edge, vertical centre -- and 0x20. */
const TILE_FLAGS = 0x29;
/** The frame's flags: anchor `(2, 2)`, its centre. */
const FRAME_FLAGS = 10;
/** Every call's queue layer, `PUSH 0x2`. */
const BAR_LAYER = 2;

/** One bar task's 0x4C-byte block, the fields `BossHpBarUpdate` reads. */
export interface BossHpBar {
  /** `+0x34` — the frame's centre, x, in the 640x480 screen. */
  x: number;
  /** `+0x38` — its centre, y. */
  y: number;
  /** `+0x40` — the fill the bar shows, 0..1. Seated at 0. */
  shown: number;
  /** `+0x44` — the trail, never below {@link shown}. Seated at 1.0. */
  trail: number;
  /** `+0x48` — the blink counter: 0 until the fill reads 0, then 1.. */
  blink: number;
}

/**
 * `BossHpBarSpawn` — `FUN_00435E50`. `ActorAlloc(BossHpBarUpdate, 0x4C)`,
 * the position into `+0x34`/`+0x38`, `+0x40 = 0`, `+0x44 = 1.0`,
 * `+0x48 = 0`, and `g_boss_hp_fraction = 1.0`.
 *
 * Appended, as `ActorAlloc` appends to the task ring: a bar spawned while an
 * old one is still blinking runs after it, and both draw.
 */
export function BossHpBarSpawn(x: number, y: number): void {
  G.g_boss_hp_bars.push({ x, y, shown: 0, trail: 1, blink: 0 });
  G.g_boss_hp_fraction = BOSS_HP_BAR_FULL;
}

/**
 * `BossHpBarUpdate` — `FUN_00435C80`. One bar, one 60 Hz frame. Returns
 * `false` on the frame it calls `ActorKill`, which is how the pool below
 * knows to drop it.
 *
 * Every store to the block is `FST float ptr`, so the port rounds to single
 * precision where the engine does: a hundred additions of 0.01 in doubles do
 * not land where a hundred in floats do, and the comparison against the global
 * is exact.
 */
export function BossHpBarUpdate(b: BossHpBar): boolean {
  const fill = G.g_boss_hp_fraction;
  if (fill === BOSS_HP_BAR_KILL) return false;
  if (b.shown < fill) {
    // `FADD double ptr [0x0055d190]; FST float ptr [ESI + 0x40]`, clamped to
    // the global, and the trail pinned to it: a bar filling has no trail.
    // `FST` stores the rounded value and leaves the unrounded sum in ST0, and
    // it is ST0 that `FCOMP` tests -- so the clamp compares the sum.
    const sum = b.shown + FILL_RATE;
    b.shown = Math.fround(sum);
    if (!(sum < fill)) b.shown = fill;
    b.trail = b.shown;
  } else {
    b.shown = fill;
  }
  // The same shape: `FSUB double ptr [0x0055e180]; FST; FCOMP [ESI + 0x40]`.
  const less = b.trail - TRAIL_RATE;
  b.trail = Math.fround(less);
  if (less < b.shown) b.trail = b.shown;
  if (b.blink === 0 && fill === 0) b.blink = 1;
  if (b.blink !== 0) {
    const was = b.blink;
    b.blink = was + 1;
    if (was === BLINK_FRAMES) return false;
    if (b.blink % BLINK_PERIOD < BLINK_HIDDEN) return true;
  }
  // Four draws, in the engine's order. The queue puts the newest of a layer
  // first, so the frame is drawn first and the empty tile last; the depths
  // are what stack them, nearest the fill.
  DrawScreenSpriteLayered(BossHpBarSprite.Empty,
    b.x - (1 - (b.trail + b.trail)) * TRACK_HALF, b.y, DEPTH_EMPTY,
    (1 - b.trail) * TRACK_TILES, BAR_SY, TILE_FLAGS, BAR_LAYER);
  DrawScreenSpriteLayered(BossHpBarSprite.Trail,
    b.x - (1 - (b.shown + b.shown)) * TRACK_HALF, b.y, DEPTH_TRAIL,
    (b.trail - b.shown) * TRACK_TILES, BAR_SY, TILE_FLAGS, BAR_LAYER);
  DrawScreenSpriteLayered(BossHpBarSprite.Fill,
    b.x - TRACK_HALF, b.y, DEPTH_FILL,
    b.shown * TRACK_TILES, BAR_SY, TILE_FLAGS, BAR_LAYER);
  DrawScreenSpriteLayered(BossHpBarSprite.Frame,
    b.x, b.y, DEPTH_FRAME, FRAME_SX, BAR_SY, FRAME_FLAGS, BAR_LAYER);
  return true;
}

/**
 * `[port-only]` — the bar tasks, stepped in creation order.
 *
 * The engine's task walk reaches a bar after the boss that spawned it,
 * because `ActorAlloc` appends; the director calls this after the actor walk
 * for the same reason. A task that kills itself leaves the list here.
 */
export function BossHpBarsTick(): void {
  if (G.g_boss_hp_bars.length === 0) return;
  G.g_boss_hp_bars = G.g_boss_hp_bars.filter((b) => BossHpBarUpdate(b));
}

/**
 * The fill a boss writes: hit points over maximum, as the float the engine
 * stores. `[port-only]` as a function -- every writer computes
 * `(float)obj+0x11C / (float)obj+0x11E` inline -- but the division, the
 * rounding and the global are the same at every call site, and a helper keeps
 * them the same in the port.
 */
export function BossHpFractionOf(hp: number, maxHp: number): number {
  return maxHp > 0 ? Math.fround(hp / maxHp) : 0;
}

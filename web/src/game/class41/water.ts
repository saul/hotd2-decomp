/**
 * Class 0x41 type 1 -- **the canal's water**, which the port did not draw.
 *
 * `docs/formats/water.md` used to say the engine has no water renderer and
 * that the surface is region geometry. For most of the canal that is true.
 * But fifteen spawns in the game -- five in stage 2, seven in stage 3, three
 * in training -- are class-0x41 placers of constructor type 1,
 * `PlaceWaterSurface` (`FUN_00462F70`), and what they build is a task that
 * draws a water tile the script has loaded, every frame, and ripples its
 * texture as it does. No region names those tiles as something to draw: the
 * script loads them with opcode 0x50, and a slot that is only *loaded* is
 * drawn by nothing unless something calls `AssetDrawSlot` on it
 * (`RegionDrawResidentSet`, `FUN_00401260`, walks the current region's list
 * and nothing else). So stage 2's block 16 stood on a dock over no water at
 * all.
 *
 * The tile is `g_water_surface_slots` (`0x00593DA4`) indexed by the placer's
 * `obj+0x1F4`, the one table in this that is image data; the exporter resolves
 * it into the placement's `slot`. The pairings and swaps the routine applies
 * afterwards are immediates, in `water_slots.ts`.
 *
 * **The ripple is a walk over the model's own vertices.** Each frame the
 * routine runs it, every vertex's `u` gains `sin(phase(x)) * 0.00075` and its
 * `v` gains `cos(phase(z)) * 0.00075`, where the phase is the scene tick times
 * 0x180 plus the coordinate times 600, in BAMS. That is state -- it lives in
 * the slot's model, and it is the sum of every frame the gate was open -- so
 * it is kept here, in `G`, and `render/water_surfaces.ts` applies it to the
 * vertices, which are three.js's. What is
 * kept is two sums rather than a copy of the UVs: `sin(a + b)` is
 * `sin a cos b + cos a sin b`, so the per-vertex term factors out and the sum
 * over frames is `Σ sin(tick phase)` and `Σ cos(tick phase)` whatever the
 * vertex. See {@link WaterSurfaceUv}.
 */
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import { CameraBlockPathFrame } from "../camera/view";
import { T } from "../tables";
import type { Actor } from "../actor";
import { SCRIPT_FLAG_CLEAR_PROPS } from "./lifetime";
import {
  WATER_ARENA_ALT_PAIR_SLOT, WATER_ARENA_ALT_SLOT, WATER_ARENA_PAIR_SLOT,
  WATER_ARENA_SLOT, WATER_CANAL_SLOT, WATER_DEATH_ALT_SLOT, WATER_DEATH_SLOT,
} from "./water_slots";

/** `ActorAlloc(WaterSurfaceUpdate, 0x44)`: header plus 0x10 bytes. */
export const WATER_SURFACE_TASK_SIZE = 0x44;

/** `g_scene_index` 1 -- stage 2, whose own kill tests are block 0x23's. */
const SCENE_STAGE2 = 1;
/** `g_scene_index` 2 -- stage 3, the only scene whose tasks get a kill flag. */
const SCENE_STAGE3 = 2;

/**
 * The `g_script_flags` the routine tests. Indices into one array, so an enum:
 * the routine switches its behaviour on each.
 */
export enum WaterSurfaceFlag {
  /** `g_script_flags[4]` -- on stage 3, `ActorKill` every task. */
  KillAllStage3 = 4,
  /** `g_script_flags[8]` -- {@link WATER_ARENA_SLOT} ripples only while up. */
  ArenaRipple = 8,
  /** `g_script_flags[9]` -- swap the arena and the death water to their
   * alternates. The stage-2 boss's banner waits on the same flag. */
  SwapTiles = 9,
  /** `g_script_flags[0x6A]` -- no tile ripples while up. */
  RippleOff = 0x6a,
  /** `g_script_flags[0xF1]` -- in Training, a tile ripples only while up... */
  TrainingRippleOn = 0xf1,
  /** `g_script_flags[0xF2]` -- ...and this is down. */
  TrainingRippleOff = 0xf2,
}

/** Stage 3's kill flag is `index + 0x0B` -- flags 15..19 for indices 4..8. */
export const WATER_SURFACE_KILL_FLAG_BASE = 0x0b;
/** `g_evt_block_index == 0x23 && g_evt_step_index == 2` kills on stage 2. */
export const WATER_SURFACE_KILL_BLOCK = 0x23;
export const WATER_SURFACE_KILL_BLOCK_STEP = 2;
/** {@link WATER_CANAL_SLOT} is killed when `g_evt_step_index` reaches 0xF. */
export const WATER_CANAL_KILL_STEP = 0x0f;
/** {@link WATER_DEATH_SLOT} ripples only on this camera path, and turns back
 * from its alternate on it. */
export const WATER_DEATH_CAM_PATH = 0x6e;
/** No tile ripples on this camera path at this frame. */
export const WATER_PAUSE_CAM_PATH = 0x7e;
export const WATER_PAUSE_CAM_FRAME = 0x163;

/** `IMUL 0x180` -- BAMS a scene tick moves the phase. */
export const WATER_PHASE_PER_TICK = 0x180;
/** `LEA`s to `x * 600` -- BAMS a world unit moves it. */
export const WATER_PHASE_PER_UNIT = 600;
/** `g_water_surface_uv_step` -- `0x00569108`, f64 0.00075. */
export const WATER_UV_STEP = 0.00075;
/** `g_water_surface_z_limit` -- `0x00569110`, f32 -1870. With index 0 only
 * the vertices at `z <= this` ripple. */
export const WATER_Z_LIMIT = -1870;

/** The 0x44-byte task `PlaceWaterSurface` allocates. Plain data. */
export interface WaterSurface {
  /** `[port-only]` -- the engine's identity is the task pointer. */
  id: number;
  /** `+0x34` -- the placer's `obj+0x1F4`, low byte: the table index. */
  index: number;
  /** `+0x35` -- the placer's `obj+0x11C`, low byte: how many changes of
   * `g_evt_step_index` it outlives. */
  lifetime: number;
  /** `+0x36` -- the low byte of `g_evt_step_index` when it last changed. */
  seenStep: number;
  /** `+0x37` -- changes seen. */
  stepChanges: number;
  /** `+0x38` -- the script flag that kills it, stage 3 only; 0 elsewhere,
   * because `ActorClearGameFields` zeroed it. */
  killFlag: number;
  /** `+0x40` -- the asset slot it draws and ripples. */
  slot: number;
  /** `[port-only]` -- the slots this frame's update handed `AssetDrawSlot`,
   * in order, for `render/water_surfaces.ts`. Empty until it has run. */
  drawn: number[];
}

/**
 * `[port-only]` in shape -- what the routine's vertex walk has done to one
 * slot's model, which in the engine is the model: its UVs and its mesh
 * headers, rewritten in place.
 *
 * `u(x) = u₀ + 0.00075·(sin·cos b(x) + cos·sin b(x))` and
 * `v(z) = v₀ + 0.00075·(cos·cos b(z) − sin·sin b(z))`, with
 * `b(t) = (ftol(t) * 600) & 0xFFFF` in BAMS. That is the engine's per-frame
 * sum in closed form.
 *
 * [diverges] Two numeric details of the walk are not carried: the engine
 * rounds `u` and `v` to float after every frame's add, and ORs 1 into the
 * bits of `v` each time. Both are below a float's last place on a UV of
 * order one, and keeping them would mean keeping every vertex's UVs in `G`.
 *
 * [diverges] The engine's state lives exactly as long as the model does: a
 * slot unloaded by opcode 0x51 or `asset_free_polfile` and loaded again comes
 * back with its authored UVs. The port has no asset residency, so this is
 * dropped only with the scene. Block 22 unloading `0x13B5` and block 35
 * reloading it is the one shipped case, and the ripple it would restart is at
 * most 0.02 of a texture repeat out of phase.
 */
export interface WaterSurfaceUv {
  slot: number;
  /** `Σ sin(tick phase)` over the frames the walk ran. */
  sin: number;
  /** `Σ cos(tick phase)` over the same frames. */
  cos: number;
  /** How many frames that was. Above zero, the walk has also raised TSP
   * bit `0x2000` on every mesh header -- filter mode 1, bilinear. */
  frames: number;
  /** The walking task's index was 0: only vertices at `z <= -1870` moved. */
  zLimited: boolean;
}

function flag(i: number): number {
  return G.g_script_flags[i] ?? 0;
}

/** `(s16)` of a 16-bit word, and `(char)` of a byte. */
const s16 = (v: number): number => (v << 16) >> 16;
const s8 = (v: number): number => (v << 24) >> 24;

/**
 * `PlaceWaterSurface` — `FUN_00462F70`. `g_class41_constructors[1]`.
 *
 * ```
 * task = ActorAlloc(WaterSurfaceUpdate, 0x44); ActorClearGameFields(task)
 * task+0x34 = (u8)placer+0x1F4
 * task+0x35 = (u8)placer+0x11C
 * task+0x40 = g_water_surface_slots[(s16)placer+0x1F4]
 * task+0x36 = (u8)g_evt_step_index;  task+0x37 = 0
 * if (g_scene_index == 2) task+0x38 = task+0x34 + 0x0B
 * ```
 *
 * The table lookup is the exporter's: the placement at the placer's address
 * carries the slot it resolved. A placer with none is a stage whose bundle
 * predates this, and builds nothing rather than a task on slot 0.
 */
export function PlaceWaterSurface(obj: Actor): WaterSurface | null {
  const pl = T.breakables?.placements?.find(
    (q) => q.at === obj.at && q.container === "water_surface");
  if (!pl || pl.slot === undefined) return null;
  const index = obj.charType & 0xff;
  const w: WaterSurface = {
    id: ++G.g_water_surface_seq,
    index,
    lifetime: obj.hp & 0xff,
    seenStep: G.g_evt_step_index & 0xff,
    stepChanges: 0,
    killFlag: G.g_scene_index === SCENE_STAGE3
      ? (index + WATER_SURFACE_KILL_FLAG_BASE) & 0xff : 0,
    slot: pl.slot,
    drawn: [],
  };
  G.g_water_surfaces.push(w);
  return w;
}

/**
 * `WaterSurfaceUpdate` — `FUN_0046E3A0`. Returns false when the task has
 * gone: `ActorDespawn` and `ActorKill` both end it, and neither draws.
 *
 * ```
 * if (scene 1 && flags[0x77]) ActorDespawn
 * if ((s16)step != (char)+0x36) { if ((char)+0x35 < (char)+++0x37) ActorDespawn;
 *                                 +0x36 = step }
 * if (g_GameMode != 3) {
 *   if (scene 2) { if (flags[+0x38] == 1) ActorKill }
 *   else if (scene 1 && block 0x23 && step 2) ActorKill
 *   if (+0x40 == 0x13B5 && step 0xF) ActorKill
 *   if (scene 2 && flags[4]) ActorKill
 * }
 * if (resident(+0x40) && (+0x40 != 0x13A7 || flags[8])
 *     && (+0x40 != 0x13A0 || cam == 0x6E) && !flags[0x6A]
 *     && !(cam == 0x7E && block[g_camera_index].frame == 0x163)
 *     && (mode != 2 || (flags[0xF1] && !flags[0xF2])))  walk the model
 * AssetDrawSlot(+0x40)
 * if (+0x40 == 0x13A7) AssetDrawSlot(0x13A5)
 * if (+0x40 == 0x13A9) AssetDrawSlot(0x13AC)
 * if (flags[9]) { 0x13A7 -> 0x13A9, or 0x13A0 -> 0x13A2 }
 * if (+0x40 == 0x13A2 && cam == 0x6E) +0x40 = 0x13A0
 * ```
 *
 * The pause's frame is the drawn block's -- `CMP [ECX*4 + 0x9a6110], 0x163`
 * at `0x0046E50B`, `ECX` from `MOV EDX, [0x009c6f00]` times 0x69 -- so under
 * scene state (1, 3) it is block 2's, which is always 0, and the tiles do not
 * pause. Stage 3's path 0x7E reaches 0x163 under (2, 7), index 0.
 *
 * The last line reads the slot the swap above it may just have written, so
 * with flag 9 up on camera path 0x6E the death water swaps and swaps back in
 * one frame. Transcribed as it is.
 *
 * [diverges] `resident` is the slot table's `+0xD` bit 0x80, which the port
 * does not keep: opcodes 0x52..0x58 are whole-file asset traffic it treats as
 * already done. So the walk runs
 * whether or not the tile is loaded. Every shipped placement follows the load
 * of its tile except block 16 step 10's, whose `komono_boss2.bin` arrives at
 * step 13, and the only effect is three steps of ripple phase on a tile that
 * is not drawn yet. `render/water_surfaces.ts` does honour the residency the
 * player tracks when it draws.
 */
export function WaterSurfaceUpdate(w: WaterSurface): boolean {
  if (G.g_scene_index === SCENE_STAGE2 && flag(SCRIPT_FLAG_CLEAR_PROPS)) {
    return false;
  }
  const step = s16(G.g_evt_step_index);
  if (step !== s8(w.seenStep)) {
    w.stepChanges = (w.stepChanges + 1) & 0xff;
    if (s8(w.lifetime) < s8(w.stepChanges)) return false;
    w.seenStep = G.g_evt_step_index & 0xff;
  }
  if (G.g_GameMode !== GameMode.Boss) {
    if (G.g_scene_index === SCENE_STAGE3) {
      if (flag(w.killFlag) === 1) return false;
    } else if (G.g_scene_index === SCENE_STAGE2
               && G.g_evt_block_index === WATER_SURFACE_KILL_BLOCK
               && step === WATER_SURFACE_KILL_BLOCK_STEP) {
      return false;
    }
    if (w.slot === WATER_CANAL_SLOT && step === WATER_CANAL_KILL_STEP) {
      return false;
    }
    if (G.g_scene_index === SCENE_STAGE3
        && flag(WaterSurfaceFlag.KillAllStage3)) {
      return false;
    }
  }
  const cam = G.g_active_cam_path;
  if ((w.slot !== WATER_ARENA_SLOT || flag(WaterSurfaceFlag.ArenaRipple))
      && (w.slot !== WATER_DEATH_SLOT || cam === WATER_DEATH_CAM_PATH)
      && !flag(WaterSurfaceFlag.RippleOff)
      && !(cam === WATER_PAUSE_CAM_PATH
           && CameraBlockPathFrame(G.g_camera_index) === WATER_PAUSE_CAM_FRAME)
      && (G.g_GameMode !== GameMode.Training
          || (flag(WaterSurfaceFlag.TrainingRippleOn)
              && !flag(WaterSurfaceFlag.TrainingRippleOff)))) {
    WaterSurfaceRipple(w);
  }
  w.drawn = [w.slot];
  if (w.slot === WATER_ARENA_SLOT) w.drawn.push(WATER_ARENA_PAIR_SLOT);
  if (w.slot === WATER_ARENA_ALT_SLOT) w.drawn.push(WATER_ARENA_ALT_PAIR_SLOT);
  if (flag(WaterSurfaceFlag.SwapTiles)) {
    if (w.slot === WATER_ARENA_SLOT) w.slot = WATER_ARENA_ALT_SLOT;
    else if (w.slot === WATER_DEATH_SLOT) w.slot = WATER_DEATH_ALT_SLOT;
  }
  if (w.slot === WATER_DEATH_ALT_SLOT && cam === WATER_DEATH_CAM_PATH) {
    w.slot = WATER_DEATH_SLOT;
  }
  return true;
}

/**
 * `[port-only]` -- the vertex walk inside `WaterSurfaceUpdate`, as the one
 * frame's worth of its closed form. The phase's tick half is
 * `(g_scene_tick_counter * 0x180) & 0xFFFF`; its vertex half is
 * `render/water_surfaces.ts`'s, which holds the vertices.
 */
function WaterSurfaceRipple(w: WaterSurface): void {
  let uv = G.g_water_surface_uv.find((e) => e.slot === w.slot);
  if (!uv) {
    uv = { slot: w.slot, sin: 0, cos: 0, frames: 0, zLimited: false };
    G.g_water_surface_uv.push(uv);
  }
  const a = (Math.imul(G.g_scene_tick_counter, WATER_PHASE_PER_TICK) & 0xffff)
    * BAMS_TO_RAD_F64;
  uv.sin += Math.sin(a);
  uv.cos += Math.cos(a);
  uv.frames += 1;
  uv.zLimited = w.index === 0;
}

/**
 * `[port-only]` -- the tasks `PlaceWaterSurface` allocated, once a frame, in
 * allocation order. A task that ends leaves the list.
 */
export function WaterSurfacesTick(): void {
  if (!G.g_water_surfaces.length) return;
  G.g_water_surfaces = G.g_water_surfaces.filter((w) => {
    const alive = WaterSurfaceUpdate(w);
    if (!alive) w.drawn = [];
    return alive;
  });
}

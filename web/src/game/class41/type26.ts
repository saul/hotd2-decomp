/**
 * Class 0x41 constructor 26 -- **the warehouse water**: a task that ripples
 * and draws one model, `komono_souko.bin[9]` (slot `0x197F`), at half alpha
 * under the scene light array.
 *
 * One spawn in the game: stage 2 block 24 step 1 (evt `0x109A8`), with a
 * lifetime of 3, placed beside constructor 16's six drums (`type16.ts`),
 * which stand in it. The file is the script's own whole-file load
 * (`asset_load_polfile` 112, from block 22) and is freed at block 24 step 3
 * op 48 while the task still lives; from that frame the task walks and draws
 * nothing, because both test the slot's resident bit (`game/pol_files.ts`).
 *
 * **The ripple is a walk over the model's own vertices**, the same strip
 * walk `WaterSurfaceUpdate` and constructor 3's make: every header's TSP
 * word gains `0x2000` (bilinear), every full vertex's `y` is set from its
 * distance to (-472.5, -1230.7) and the task's phase, and its `u` and `v`
 * each gain a sine of the scene tick and the coordinate. The `y` is written
 * whole each frame, so the model holds the last walk's; the UVs are sums
 * over every frame the walk ran, kept in closed form as the water's are
 * (`water.ts`), and `render/type26_ripple.ts` -- which holds the vertices,
 * and so computes each one's half (`type26RippleHeight`,
 * `type26RippleUvOffset`) -- applies both to the model.
 */
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import type { Actor } from "../actor";
import { G } from "../globals";
import { PolFileResident } from "../pol_files";
import { T } from "../tables";
import { SCRIPT_FLAG_CLEAR_PROPS } from "./lifetime";

export { TYPE26_CONSTRUCTOR, TYPE26_SLOT } from "./type26_slots";
/** `ActorAlloc(Type26RippleUpdate, 0x44)`: header plus 0x10 bytes. */
export const TYPE26_TASK_SIZE = 0x44;
/** `PUSH 0x3F000000` -- the alpha it draws at, 0.5. */
export const TYPE26_ALPHA = 0.5;
/** `ADD EAX, 0x200` -- the phase's step a frame, `+0x3C`. */
export const TYPE26_PHASE_STEP = 0x200;
/** `g_scene_index` 1 -- stage 2, whose props `g_script_flags[0x77]` clears. */
const SCENE_STAGE2 = 1;

/**
 * The walk's constants, `0x005690C0`..`0x005690D8`, and `0x005643D8`:
 * `FADD [0x005690D8]` and `FADD [0x005690D4]` move the rings' centre to the
 * origin (f32 472.5158 and 1230.6945), `FMUL [0x005690D0]` (f32 400) scales
 * the distance squared into BAMS, `FMUL [0x005643D8]` (f64 0.1) and `FSUB
 * [0x005690C8]` (f64 4.805454...) make the height, and `FMUL [0x005690C0]`
 * (f64 0.0004) each frame's UV step.
 */
export const TYPE26_CENTRE_X = Math.fround(472.5158);
export const TYPE26_CENTRE_Z = Math.fround(1230.6945);
export const TYPE26_RING_SCALE = 400;
export const TYPE26_HEIGHT_SCALE = 0.1;
/** The f64 at `0x005690C8`, `0x401338C8E0000000`. */
export const TYPE26_HEIGHT_BASE = 4.805453777313232;
export const TYPE26_UV_STEP = 0.0004;
/** `LEA`s to `tick * 0x180` and `ftol(c) * 600` -- the UV phase, in BAMS. */
export const TYPE26_PHASE_PER_TICK = 0x180;
export const TYPE26_PHASE_PER_UNIT = 600;

/** The 0x44-byte task `PlaceType26RippleTask` allocates. Plain data. */
export interface Type26RippleTask {
  /** `[port-only]` -- the engine's identity is the task pointer. */
  id: number;
  /** `+0x35` -- the placer's `obj+0x11C`, low byte: how many changes of
   * `g_evt_step_index` it outlives. */
  lifetime: number;
  /** `+0x36` -- the low byte of `g_evt_step_index` when it last changed. */
  seenStep: number;
  /** `+0x37` -- changes seen. */
  stepChanges: number;
  /** `+0x3C` -- the rings' phase, in BAMS. */
  phase: number;
  /**
   * `[port-only]` -- the `pol/` file slot `0x197F` belongs to, which the
   * bundle resolves (`komono_souko.bin`, 112), so its resident bit can be
   * answered from the file's state.
   */
  pol: number;
  /**
   * `[port-only]` -- whether this frame's `AssetDrawSlotWithAlphaSceneLights`
   * found the slot resident and drew it, for `render/type26_ripple.ts`.
   */
  drawn: boolean;
}

/**
 * `[port-only]` in shape -- what the walk has done to slot `0x197F`'s model,
 * which in the engine is the model: its heights, its UVs and its headers,
 * rewritten in place.
 *
 * `y(x, z) = (f32)(sin(ftol(((x + 472.5158)^2 + (z + 1230.6945)^2) * 400 +
 * phase) BAMS) * 0.1 - 4.805454)` with `phase` the task's `+0x3C` at the
 * last walk, and `u`/`v` the authored ones plus `0.0004·(sin·cos b +
 * cos·sin b)` and `0.0004·(cos·cos b − sin·sin b)`, `b = (ftol(c) * 600) &
 * 0xFFFF` of the vertex's own `x` or `z`, as the water's are.
 *
 * [diverges] The two numeric details the water port does not carry are not
 * carried here either: the engine rounds `u` and `v` to float after every
 * frame's add and ORs 1 into the bits of `v` each time. Both are below a
 * float's last place on a UV of order one, and keeping them would mean
 * keeping every vertex's UVs in `G`. The inputs that would show it: a run of
 * walks long enough for the rounding to add up -- the task lives three step
 * changes.
 */
export interface Type26ModelState {
  /** `Σ sin(tick phase)` over the frames the walk ran. */
  sin: number;
  /** `Σ cos(tick phase)` over the same frames. */
  cos: number;
  /** How many frames that was. Above zero, TSP `0x2000` is on. */
  frames: number;
  /** `+0x3C` when the walk last ran: what every height was last set from. */
  phase: number;
}

/**
 * `PlaceType26RippleTask` — `FUN_00463230`. `g_class41_constructors[26]`.
 *
 * ```
 * task = ActorAlloc(Type26RippleUpdate, 0x44);  ActorClearGameFields(task)
 * task+0x35 = (u8)placer+0x11C
 * task+0x36 = (u8)g_evt_step_index;  task+0x37 = 0
 * ```
 *
 * `[proved]`. Nothing else of the placer is read; the phase at `+0x3C` is
 * `ActorClearGameFields`' zero. The file the slot belongs to is the
 * exporter's (the placement's `pol`); a placer with none is a bundle that
 * predates it, and builds nothing.
 */
export function PlaceType26RippleTask(obj: Actor): Type26RippleTask | null {
  const pl = T.breakables?.placements?.find(
    (q) => q.at === obj.descAt && q.container === "ripple");
  if (!pl || pl.pol === undefined) return null;
  const t: Type26RippleTask = {
    id: ++G.g_type26_task_seq,
    lifetime: obj.hp & 0xff,
    seenStep: G.g_evt_step_index & 0xff,
    stepChanges: 0,
    phase: 0,
    pol: pl.pol,
    drawn: false,
  };
  G.g_type26_tasks.push(t);
  return t;
}

/** `(s16)` of a 16-bit word, and `(char)` of a byte. */
const s16 = (v: number): number => (v << 16) >> 16;
const s8 = (v: number): number => (v << 24) >> 24;

/**
 * `Type26RippleUpdate` — `FUN_00469C80`. Returns false when the task has
 * gone (`ActorDespawn`).
 *
 * ```
 * 00469C83  if (g_scene_index == 1 && g_script_flags[0x77]) { ActorDespawn; return }
 * 00469CA9  if ((s16)g_evt_step_index != (char)+0x36) {
 *               if ((char)+0x35 < (char)+++0x37) { ActorDespawn; return }
 *               +0x36 = (u8)g_evt_step_index }
 * 00469CE3  if (g_asset_slots[0x197F].flags & 0x8000)     ; TEST AH, 0x80 on 0x009BFE9C
 *               walk the model: headers TSP |= 0x2000; each full vertex
 *               y = sin(...) * 0.1 - 4.805454, u += ..., v = (u32)(v + ...) | 1
 * 00469E32  AssetDrawSlotWithAlphaSceneLights(0x197F, 0.5)
 * 00469E41  +0x3C += 0x200
 * ```
 *
 * `[proved]`, from the listing. The decompiler has the `u` phase as
 * `ftol(x + 472.5158)`; the stack says otherwise -- the two `FSTP ST0` at
 * `0x00469D57` pop the centred `z` and `x`, and the `__ftol` at `0x00469D90`
 * takes the vertex's own `x` -- so `u`'s phase is `ftol(x) * 600`, as `v`'s is
 * `ftol(z) * 600` off the raw `z` it saved at `[ESP+0x1C]`. The height's
 * phase is the task's `+0x3C` before this frame's step.
 */
export function Type26RippleUpdate(t: Type26RippleTask): boolean {
  t.drawn = false;
  if (G.g_scene_index === SCENE_STAGE2
      && (G.g_script_flags[SCRIPT_FLAG_CLEAR_PROPS] ?? 0) !== 0) {
    return false;
  }
  if (s16(G.g_evt_step_index) !== s8(t.seenStep)) {
    t.stepChanges = (t.stepChanges + 1) & 0xff;
    if (s8(t.lifetime) < s8(t.stepChanges)) return false;
    t.seenStep = G.g_evt_step_index & 0xff;
  }
  const resident = PolFileResident(t.pol);
  if (resident) Type26RippleWalk(t);
  // `AssetDrawSlotWithAlphaSceneLights` tests the same bit and draws nothing
  // without it.
  t.drawn = resident;
  t.phase = (t.phase + TYPE26_PHASE_STEP) | 0;
  return true;
}

/**
 * `[port-only]` -- the vertex walk inside `Type26RippleUpdate`, as one
 * frame's worth of its closed form: the heights' phase is the task's, and
 * the UVs' tick half is `(g_scene_tick_counter * 0x180) & 0xFFFF`. The vertex
 * halves are `render/type26_ripple.ts`'s, which holds the vertices.
 */
function Type26RippleWalk(t: Type26RippleTask): void {
  let m = G.g_type26_model;
  if (!m) {
    m = { sin: 0, cos: 0, frames: 0, phase: 0 };
    G.g_type26_model = m;
  }
  const a = (Math.imul(G.g_scene_tick_counter, TYPE26_PHASE_PER_TICK) & 0xffff)
    * BAMS_TO_RAD_F64;
  m.sin += Math.sin(a);
  m.cos += Math.cos(a);
  m.frames += 1;
  m.phase = t.phase;
}

/**
 * `[port-only]` -- the tasks `PlaceType26RippleTask` allocated, once a frame,
 * in allocation order. A task that ends leaves the list.
 */
export function Type26RipplesTick(): void {
  if (!G.g_type26_tasks.length) return;
  G.g_type26_tasks = G.g_type26_tasks.filter((t) => Type26RippleUpdate(t));
}

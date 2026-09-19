/**
 * Class 0x41 type 39 — `PlaceTable39Stacks` and `PropUpdateType39`.
 *
 * Stage 1's church again, block 1 step 2 op 16 (evt `0x19BC`, the placer after
 * type 38's in the same instruction). Eight **stacks** of the same model type 38
 * draws, `komono_st1.bin[3]` (slot `0x1237`), standing on the pews at
 * y = 15.609 with each item 0.926 above the last and a random tilt about X.
 * The stack heights are not in the table: they are `__ftol(8.0 - row * 0.4)`,
 * so 8, 7, 7, 6, 6, 6, 5 and 5.
 *
 * A shot knocks the whole stack over one item at a time — item *i* starts to
 * turn two frames after item *i - 1* — and lays them on the floor in a row
 * 1.2 apart, after which the stack blinks for a second and is gone.
 *
 * `[proved]` from `FUN_00463510` and `FUN_0046C240`, constants re-read out of
 * the disassembly (L1). [open] what the model is, as for type 38.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { BreakablePropAwardHit, ActorKillProp, SFX_PROP_CRACK } from "./prop";
import { PropStepLifetimeInline } from "./lifetime";
import { MsvcRand } from "./group";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { DEGREES_TO_BAMS, TYPE38_SLOT } from "./type38";

/**
 * `g_prop_table39` — `0x00593F48`, eight rows of the same
 * `{f32 x, y, z; f32 rx, ry, rz}` (degrees) shape as `g_prop_table38`.
 */
export const PROP_TABLE39: ReadonlyArray<readonly number[]> = [
  [14.317, 15.609, -8.375, -75.859, 0, 90],
  [19.968, 15.609, -8.375, -72.766, 0, 90],
  [26.949, 15.609, -34.395, -72.766, 0, 90],
  [-17.601, 15.609, -8.375, -72.766, 0, 90],
  [-14.792, 15.609, -36.096, -72.766, 0, 90],
  [-26.937, 15.609, -36.096, 17.761, 0, 90],
  [-26.056, 15.609, -60.485, -72.766, 0, 90],
  [19.698, 15.609, -34.395, -72.766, 0, 90],
];

/** The eight sub-positions every stack is built with. */
export const TYPE39_STACK_SLOTS = 8;
/** `0x00569014` — each item stands this far above the last. */
export const TYPE39_STACK_STEP = Math.fround(0.926);
/** `0x004C43A0` and `0x0055D1A0`: the height is `8.0 - row * 0.4`. */
export const TYPE39_HEIGHT_BASE = 8.0;
export const TYPE39_HEIGHT_STEP = Math.fround(0.4);
/** `obj+0x124 = 0x40A00000`. */
export const TYPE39_RADIUS = 5.0;
/** `0x004C4D10` — how far toward -z a falling item slides a frame. */
export const TYPE39_SLIDE = Math.fround(0.3);
/** `0x005690F0` — how far a turning item drops a frame. */
export const TYPE39_DROP = Math.fround(0.40829998);
/** `0x300` of yaw a frame while it turns. */
export const TYPE39_TURN = 0x300;
/** `0x005690F8` — where item 0 comes to rest above the floor. */
export const TYPE39_FIRST_REST = Math.fround(0.463);
/** `0x005690F4` — where every other item comes to rest. */
export const TYPE39_REST = Math.fround(1.6205);
/** `0x00564708` — the spacing of the row they land in, along -z. */
export const TYPE39_ROW_STEP = Math.fround(1.2);
/** `0x17C0 - i` — the yaw a landed item is laid at. */
export const TYPE39_LAID_YAW = 0x17c0;
/** `CMP EAX, 0x3C / JLE` — the blink runs until its count passes this. */
export const TYPE39_BLINK_FRAMES = 0x3c;
/** `0x004C49C0` — the shot point is this far above the stack's base. */
export const TYPE39_SHOT_RISE = 3.0;

/**
 * [port-only] as a function — the first line of `PropUpdateType39`.
 *
 * How many items row *i* draws: `__ftol(8.0 - (float)i * 0.4f)`.
 *
 * The product is stored as a `float` before `__ftol` truncates it, and that
 * store is what makes row 5 six and not five: `8 - 5 * 0.4f` is 5.99999997 in
 * the FPU and exactly 6.0 once it has been through a 32-bit float.
 */
export function Type39StackHeight(row: number): number {
  return Math.trunc(Math.fround(TYPE39_HEIGHT_BASE - row * TYPE39_HEIGHT_STEP));
}

/**
 * `PlaceTable39Stacks` — `FUN_00463510`. `g_class41_constructors[39]`.
 *
 * ```c
 * for (i = 0, row = g_prop_table39; row < 0x59400C; row += 6, i++) {
 *     obj = ActorAlloc(PropUpdateType39, 0x378); ActorClearGameFields(obj);
 *     obj->+0x11C = placer->+0x11C;  obj->+0x196 = g_evt_step_index;
 *     obj->+0x290 = i;  position and __ftol(angle * 182.0444) as type 38;
 *     for (k = 0; k < 8; k++) {
 *         obj->+0x22C[k] = { x, y + k * 0.926, z };
 *         obj->+0x1FC[k].rx = rand() % 0x1001 - 0x800;
 *     }
 *     obj->+0x1B8 = y;  obj->+0x124 = 5.0;  obj->+0x34 = 0x80000001;
 *     obj->+0x28C = 0x1237;  obj->+0x192 = 0;
 * }
 * ```
 */
export function PlaceTable39Stacks(at: number, lifetime: number, rng: Rng):
    BreakableProp[] {
  return PROP_TABLE39.map((row, i) => {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, i);
    p.family = PropFamily.Type39;
    p.at = at;
    p.kind = i;
    p.lifetime = lifetime;
    p.lastStepIndex = G.g_evt_step_index;
    p.stepsElapsed = 0;
    p.x = row[0];
    p.y = row[1];
    p.z = row[2];
    p.pitch = Math.trunc(row[3] * DEGREES_TO_BAMS);
    p.yaw = Math.trunc(row[4] * DEGREES_TO_BAMS);
    p.roll = Math.trunc(row[5] * DEGREES_TO_BAMS);
    p.stack = [];
    for (let k = 0; k < TYPE39_STACK_SLOTS; k++) {
      p.stack.push({
        x: p.x, y: Math.fround(k * TYPE39_STACK_STEP + p.y), z: p.z,
        rx: (MsvcRand(rng) % 0x1001) - 0x800, ry: 0,
      });
    }
    p.restHeight = p.y;
    p.hitRadius = TYPE39_RADIUS;
    p.flags = 0x80000000 | BreakableFlag.Live;
    p.slot = TYPE38_SLOT;
    p.state = BreakableState.Standing;
    // `+0x2A0` is the frames-since-the-hit counter and `+0x2A4` the blink
    // counter for this family; `ActorClearGameFields` leaves both at 0.
    p.storyItem = 0;
    p.removeFlag = 0;
    p.stackDrawn = Type39StackHeight(i);
    return p;
  });
}

/** `(s16)` — the stack's rotation offsets are 16-bit words. */
function S16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * `PropUpdateType39` — `FUN_0046C240`. One stack, one 60 Hz frame.
 *
 * `obj+0x2A0` counts frames since the hit — carried as
 * {@link BreakableProp.storyItem} — and `obj+0x2A4` the blink after the last
 * item lands, carried as {@link BreakableProp.removeFlag}. Both are that
 * offset's reading **for this family**; `L3`.
 */
export function PropUpdateType39(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  const count = Type39StackHeight(p.kind);
  if (PropStepLifetimeInline(p)) return;

  // `if (+0x2A4 != 0 && +0x2A4++ > 0x3C) ActorKill()` — the old value is the
  // one compared, and the increment happens either way.
  if (p.removeFlag !== 0) {
    const was = p.removeFlag;
    p.removeFlag = was + 1;
    if (was > TYPE39_BLINK_FRAMES) {
      ActorKillProp(p);
      return;
    }
  }

  if ((p.flags & BreakableFlag.Hit) !== 0
      && p.state === BreakableState.Standing) {
    BreakablePropAwardHit(p.flags, true, rng);
    events?.emit("sound.play", { id: SFX_PROP_CRACK });
    // `[open]` `SpawnPropHitEffectScaled(obj, player, 1.0f)` (`FUN_004666B0`)
    // is not ported; `combat/shot.ts` spawns the prop spark in its place.
    p.state = BreakableState.Falling;
    p.storyItem = 0;
  }
  // `AND [ESI+0x34], 0xFFFFFFF7` — bit 3 only.
  p.flags &= ~BreakableFlag.Hit;

  if (p.state === BreakableState.Falling) {
    p.storyItem += 1;
    const floor = G.g_camera_fixed_eye_y;
    for (let i = 0; i < count; i++) {
      const s = p.stack[i];
      let landed: boolean;
      if (i === 0) {
        landed = !(floor + TYPE39_FIRST_REST < s.y);
        if (landed) {
          s.y = floor + TYPE39_FIRST_REST;
          s.ry = 0;
        }
      } else {
        landed = !(floor + TYPE39_REST < s.y);
        if (landed) {
          s.z = p.stack[0].z - i * TYPE39_ROW_STEP;
          s.y = floor + TYPE39_REST;
          s.ry = S16(TYPE39_LAID_YAW - i);
        }
      }
      if (!landed) {
        s.z -= TYPE39_SLIDE;
        if (p.storyItem > i * 2) {
          s.ry = S16(s.ry + TYPE39_TURN);
          s.y -= TYPE39_DROP;
        }
        continue;
      }
      if (i === count - 1 && p.removeFlag === 0) p.removeFlag = 1;
    }
  }

  // The draw is `(obj+0x2A4 % 2) != 1`: every frame until the blink starts,
  // then every other one. The count is left on the object for `render/`.
  p.stackDrawn = (p.removeFlag % 2) === 1 ? 0 : count;
  if (p.state === BreakableState.Standing) {
    PropRegisterForShotTest(p, p.x, p.y + TYPE39_SHOT_RISE, p.z);
  }
}

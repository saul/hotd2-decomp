/**
 * Class 0x41 type 38 — `PlaceTable38Props` and `PropUpdateType38`.
 *
 * Stage 1's church, block 1 step 2 op 16 (evt `0x1994`): nine objects the
 * constructor builds from a table in the image rather than from the spawn,
 * which is why the descriptor stands at the origin and the objects do not.
 * All nine draw `komono_st1.bin[3]` (slot `0x1237`) and are shootable: the
 * first hit swaps them to `komono_st1.bin[2]` (`0x1236`), throws them up at
 * 0.75 a frame with a random spin, and they come down pivoting on whichever of
 * their eight hull corners reaches the rest height first.
 *
 * [open] what the model is. Its hull is a slab 0.61 thick, 5.54 tall and 4.17
 * deep, and the six floor-level rows lie it on its side (`rz = 90`°); the name
 * the port gives it is the constructor's, not a guess at the object.
 *
 * `[proved]` everything below from `FUN_00463420` and `FUN_0046BCC0`, every
 * float constant re-read out of the disassembly (L1).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { BAMS } from "../vec";
import { G } from "../globals";
import { BreakablePropAwardHit, SFX_PROP_CRACK } from "./prop";
import { PropStepLifetimeInline } from "./lifetime";
import { MsvcRand } from "./group";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";

/**
 * `g_prop_table38` — `0x00593E70`, nine rows of
 * `{f32 x, y, z; f32 rx, ry, rz}` with the angles in **degrees**.
 *
 * Checked against the image by `tools/verify_prop_tables.py`.
 */
export const PROP_TABLE38: ReadonlyArray<readonly number[]> = [
  [15.283, 6.735, 9.353, -104.851, 0, 90],
  [-15.546, 6.735, 8.844, -37.815, 0, 90],
  [-16.419, 6.735, 20.26, 63.025, 0, 90],
  [5.904, 6.735, -18.277, -57.869, 0, 90],
  [-3.877, 6.735, -70.18, -115.737, 0, 90],
  [7.573, 6.735, -99.46, -106.226, 0, 90],
  [16.426, 15.606, 13.125, -75.859, 0, 90],
  [14.347, 15.609, -35.164, -100.268, 0, 90],
  [-14.571, 15.609, -57.219, -57.869, 0, 90],
];

/**
 * `g_prop38_hull_points` — `0x00594008`, eight corners as s16 `x, y, z`,
 * scaled by 0.001 where they are read.
 */
export const PROP38_HULL_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [-307, 2772, 2188], [307, 2772, 2188], [-307, 2772, -1985],
  [307, 2772, -1985], [-307, -2772, 2188], [307, -2772, 2188],
  [-307, -2772, -1985], [307, -2772, -1985],
];

/** `0x00569010` — 182.0444, degrees to BAMS, and `__ftol` truncates. */
export const DEGREES_TO_BAMS = Math.fround(182.0444);
/** `obj+0x28C = 0x1237` whole and `0x1236` once shot. */
export const TYPE38_SLOT = 0x1237;
export const TYPE38_SLOT_HIT = 0x1236;
/** `obj+0x124 = 0x40400000`. */
export const TYPE38_RADIUS = 3.0;
/** `obj+0x1C4 = 0x3F400000` on the hit. */
export const TYPE38_HOP = 0.75;
/** `0x0055D2CC` — taken off `obj+0x1C4` every frame of the hop. */
export const TYPE38_GRAVITY = Math.fround(0.04083);
/** `0x0055D2B0` — the hull points' s16 scale. */
export const TYPE38_HULL_SCALE = Math.fround(0.001);
/** `0x004C4C90` — the spins at the corner that lands: `* -2.0`. */
export const TYPE38_LAND_SPIN = -2.0;
/** `0x0055D2C0` — the pivot's spins grow by this a frame. */
export const TYPE38_PIVOT_GROWTH = Math.fround(1.05);
/** `0x004C43AC` — the pivot's origin sits this far below the rest height. */
export const TYPE38_PIVOT_DROP = 0.5;
/** `0x004C4380` — the shot point is this far below the origin. */
export const TYPE38_SHOT_DROP = 1.0;
/** Where the pivot stops each spin: yaw at 0 and roll at a quarter turn. */
export const TYPE38_REST_ROLL = 0x4000;

/** `obj+0x192` for this family. */
export enum Type38State {
  /** On its rest, or never shot. Shootable. */
  Resting = 0,
  /** In the air after a hit. */
  Hopping = 1,
  /** A corner is on the floor; it pivots about it until both spins lock. */
  Pivoting = 2,
}

/**
 * `PlaceTable38Props` — `FUN_00463420`. `g_class41_constructors[38]`.
 *
 * ```c
 * for (i = 0, row = g_prop_table38; row < 0x593F4C; row += 6, i++) {
 *     obj = ActorAlloc(PropUpdateType38, 0x378); ActorClearGameFields(obj);
 *     obj->+0x11C = placer->+0x11C;                  // the step lifetime
 *     obj->+0x196 = g_evt_step_index; obj->+0x197 = 0;
 *     obj->+0x290 = i;
 *     obj->+0x19C/1A0/1A4 = row.x, row.y, row.z;
 *     obj->+0x1CC/1D0/1D4 = __ftol(row.rx/ry/rz * 182.0444);
 *     obj->+0x124 = 3.0;  obj->+0x34 = 0x80000001;  obj->+0x28C = 0x1237;
 *     obj->+0x1B8 = obj->+0x1A0;  obj->+0x192 = 0;
 * }
 * ```
 */
export function PlaceTable38Props(at: number, lifetime: number):
    BreakableProp[] {
  return PROP_TABLE38.map((row, i) => {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, i);
    p.family = PropFamily.Type38;
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
    p.hitRadius = TYPE38_RADIUS;
    p.flags = 0x80000000 | BreakableFlag.Live;
    p.slot = TYPE38_SLOT;
    p.restHeight = p.y;
    p.state = Type38State.Resting as unknown as BreakableState;
    // `ActorClearGameFields` zeroes from `+0x34` up, so `+0x2A0` (the pivot's
    // lock count here) starts at 0 and not at the -1 the struct defaults to.
    p.storyItem = 0;
    return p;
  });
}

/**
 * `Rz(roll) . Ry(yaw) . Rx(pitch)` applied to a point — the matrix
 * `MatrixLoadIdentity; MatrixRotateZ; MatrixRotateY; MatrixRotateX` builds,
 * and `MatrixTransformPoint` multiplies by.
 *
 * `[port-only]` as a function: the engine leaves it on the matrix stack.
 */
export function RotateZYX(x: number, y: number, z: number, pitch: number,
                          yaw: number, roll: number):
    { x: number; y: number; z: number } {
  let c = Math.cos(pitch / BAMS), s = Math.sin(pitch / BAMS);
  const y1 = y * c - z * s;
  const z1 = y * s + z * c;
  c = Math.cos(yaw / BAMS); s = Math.sin(yaw / BAMS);
  const x2 = x * c + z1 * s;
  const z2 = -x * s + z1 * c;
  c = Math.cos(roll / BAMS); s = Math.sin(roll / BAMS);
  return { x: x2 * c - y1 * s, y: x2 * s + y1 * c, z: z2 };
}

/** `(rand() & 1 ? -1 : 1) * (rand() % 0x81 + 0x80)`, in its two draws. */
function Type38Spin(rng: Rng): number {
  const sign = 1 - (MsvcRand(rng) & 1) * 2;
  return sign * ((MsvcRand(rng) % 0x81) + 0x80);
}

/**
 * `PropUpdateType38` — `FUN_0046BCC0`. One object, one 60 Hz frame.
 *
 * `obj+0x1DC` and `obj+0x1E0` are the yaw and roll spins, carried as
 * {@link BreakableProp.yawSpin} and {@link BreakableProp.rollSpin};
 * `obj+0x2A0` is how many of the two have locked, carried as
 * {@link BreakableProp.storyItem} — the offset's reading for this family.
 */
export function PropUpdateType38(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  if (PropStepLifetimeInline(p)) return;

  const state = p.state as unknown as Type38State;
  if ((p.flags & BreakableFlag.Hit) !== 0 && state === Type38State.Resting) {
    BreakablePropAwardHit(p.flags, false, rng);
    events?.emit("sound.play", { id: SFX_PROP_CRACK });
    // `[open]` `SpawnPropHitEffectScaled(obj, player, 0.7f)` (`FUN_004666B0`)
    // — effect 0xE25 at the crosshair — is not ported; the spark
    // `combat/shot.ts` spawns for every prop hit stands in its place.
    p.slot = TYPE38_SLOT_HIT;
    p.state = Type38State.Hopping as unknown as BreakableState;
    p.vy = TYPE38_HOP;
    p.yawSpin = Type38Spin(rng);
    p.rollSpin = Type38Spin(rng);
  }
  // `AND [ESI+0x34], 0xFFFFFFF1` — all three hit bits, every frame.
  p.flags &= ~0xe;

  const now = p.state as unknown as Type38State;
  if (now === Type38State.Hopping) {
    p.vy = Math.fround(p.vy - TYPE38_GRAVITY);
    p.yaw += p.yawSpin;
    p.roll += p.rollSpin;
    p.y = Math.fround(p.vy + p.y);
    if (p.vy < 0) {
      // Every corner below the rest height re-enters the arm, and the last
      // one wins -- including the spins, which are doubled and reversed once
      // per corner. That is the code; it is not tidied.
      for (let k = 0; k < PROP38_HULL_POINTS.length; k++) {
        const h = PROP38_HULL_POINTS[k];
        const q = RotateZYX(h[0] * TYPE38_HULL_SCALE, h[1] * TYPE38_HULL_SCALE,
                            h[2] * TYPE38_HULL_SCALE, p.pitch, p.yaw, p.roll);
        if (q.y + p.y < p.restHeight) {
          p.state = Type38State.Pivoting as unknown as BreakableState;
          p.restY = p.restHeight;
          p.restX = q.x + p.x;
          p.restZ = q.z + p.z;
          p.yawSpin = Math.trunc(p.yawSpin * TYPE38_LAND_SPIN);
          p.rollSpin = Math.trunc(p.rollSpin * TYPE38_LAND_SPIN);
          p.storyItem = 0;
          p.contact = k;
        }
      }
    }
  } else if (now === Type38State.Pivoting) {
    p.yawSpin = Math.trunc(p.yawSpin * TYPE38_PIVOT_GROWTH);
    p.rollSpin = Math.trunc(p.rollSpin * TYPE38_PIVOT_GROWTH);
    p.yaw += p.yawSpin;
    p.roll += p.rollSpin;
    if ((p.yawSpin > 0 && p.yaw > 0) || (p.yawSpin < 0 && p.yaw < 0)) {
      p.yawSpin = 0;
      p.yaw = 0;
      p.storyItem += 1;
    }
    if ((p.rollSpin > 0 && p.roll > TYPE38_REST_ROLL)
        || (p.rollSpin < 0 && p.roll < TYPE38_REST_ROLL)) {
      p.rollSpin = 0;
      p.roll = TYPE38_REST_ROLL;
      p.storyItem += 1;
    }
    if (p.storyItem === 2) {
      p.state = Type38State.Resting as unknown as BreakableState;
      p.y = p.restHeight;
    }
  }

  // The pivot's draw: `T(rest.x, rest.y - 0.5, rest.z) . Rz . Ry . Rx .
  // T(-hull[contact])`, stored at `obj+0x2E4`, and its translation read back
  // into the position. The pose the renderer draws from `x/y/z` and the three
  // angles in Z, Y, X order is that same matrix.
  if ((p.state as unknown as Type38State) === Type38State.Pivoting) {
    const h = PROP38_HULL_POINTS[p.contact];
    const q = RotateZYX(-h[0] * TYPE38_HULL_SCALE, -h[1] * TYPE38_HULL_SCALE,
                        -h[2] * TYPE38_HULL_SCALE, p.pitch, p.yaw, p.roll);
    p.x = p.restX + q.x;
    p.y = p.restY - TYPE38_PIVOT_DROP + q.y;
    p.z = p.restZ + q.z;
  }

  PropRegisterForShotTest(p, p.x, p.y - TYPE38_SHOT_DROP, p.z);
}

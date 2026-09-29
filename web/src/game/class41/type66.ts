/**
 * Class 0x41 constructor 66 — `PlaceTable66Props` and `PropUpdateType66`:
 * twenty or twenty-nine models out of a table in the image, three of whose
 * slots swing when shot and, in stage 1, when the screen shakes.
 *
 * Two shipped descriptors. `0x6884` (`+0x1F4` 0, table a) is placed by stage 1
 * at blocks 6, 14 and 16, and `0x0C64` by stage 2 at block 0; `0x2554`
 * (`+0x1F4` 1, table b) by stage 2 at block 3. Table a stands at x -1037 to
 * -1506, 340 units and more from stage 1's bin scene; table b at x -621 to
 * -743 (and one row at x +740.193, which is what the image holds).
 *
 * What they draw is `komono_kanban.bin` — `[0]`..`[11]` — and
 * `komono_uemiti.bin[0]` and `[1]`. `[likely]` signs, from the file name; the
 * port names nothing for it.
 *
 * `[proved]` from `0x00464500`..`0x00464617` and `0x0046FE00`..`0x0047007A`,
 * both read in the disassembly. Ghidra's decompile of the update stops at
 * `PlaySoundId`, which the database marks no-return (`L72`); the swing rate the
 * hit arm writes after it (`0x0046FEA7`..`0x0046FEBA`) is only in the listing.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { G } from "../globals";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale, MatrixTranslate,
} from "../matrix";
import { ActorKillProp, BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import {
  BreakableFlag, makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";

/**
 * `g_prop_table66_a` — `0x00595158`, twenty rows of 32 bytes,
 * `{s16 slot; s16 pad; f32 x, y, z; s32 yaw; f32 sx, sy, sz}`. Carried as
 * `[slot, x, y, z, yaw, sx, sy, sz]`.
 *
 * Checked word for word against the image by `tools/verify_prop_tables.py`.
 */
export const PROP_TABLE66_A: ReadonlyArray<readonly number[]> = [
  [0x17d4, -1113.2, 45.4084, -541.172, 0x61c, 0.5016, 0.5016, 0.5016],  // komono_kanban.bin[11]
  [0x10dc, -1113.8, 44.8884, -539.878, 0x4614, 0.57, 0.57, 0.3999],  // komono_kanban.bin[8]
  [0x17d4, -1037.87, 31.8396, -554.608, 0x6ed, 0.5016, 0.5016, 0.5016],  // komono_kanban.bin[11]
  [0x10dd, -1037.74, 31.3195, -553.89, 0x46e4, 0.5597, 0.5597, 0.5597],  // komono_kanban.bin[9]
  [0x10d9, -1109.72, 49.779, -544.539, 0x684, 0.7606, 1, 0.5404],  // komono_kanban.bin[5]
  [0x10d5, -1111.93, 30.444, -544.793, 0x684, 0.66, 0.66, 0.66],  // komono_kanban.bin[1]
  [0x10d8, -1263.97, 35.002, -544.152, 0x4f0a, 2.65, 1.8, 1],  // komono_kanban.bin[4]
  [0x10db, -1241.08, 13.2388, -492.391, 0x4f0a, 0.54, 0.54, 0.54],  // komono_kanban.bin[7]
  [0x10d5, -1240.63, 6.9988, -491.341, 0x4f0a, 0.497, 0.497, 0.497],  // komono_kanban.bin[1]
  [0x17d4, -1241.6, 26.0152, -483.876, 0xeaa, 0.64, 0.64, 0.64],  // komono_kanban.bin[11]
  [0x10dd, -1240.97, 25.2352, -482.24, 0x4ea2, 0.5184, 0.5184, 0.5184],  // komono_kanban.bin[9]
  [0x17d4, -1272.85, 37.0952, -470.971, 0xeaa, 0.76, 0.76, 0.76],  // komono_kanban.bin[11]
  [0x10dc, -1272.11, 36.2406, -468.997, 0x4ea2, 0.4765, 0.4765, 0.3336],  // komono_kanban.bin[8]
  [0x17d4, -1506.05, 33.1752, -254.607, 0x1b4c, 0.64, 0.64, 0.64],  // komono_kanban.bin[11]
  [0x10db, -1504.64, 28.9015, -352.709, 0x5b44, 0.5684, 0.70992, 0.7992],  // komono_kanban.bin[7]
  [0x17d4, -1068.14, 51.7865, -410.72, -0x7a3b, 1, 1, 1],  // komono_kanban.bin[11]
  [0x10dc, -1068.52, 50.6802, -413.593, 0x45ab, 0.75, 0.75, 0.525],  // komono_kanban.bin[8]
  [0x10d5, -1238.39, 17.1624, -375.285, 0x6d31, 0.75, 0.75, 0.75],  // komono_kanban.bin[1]
  [0x17d4, -1246.05, 41.9212, -382.57, -0x72e5, 1, 1, 1],  // komono_kanban.bin[11]
  [0x10dd, -1246.92, 40.7595, -385.103, 0x4d69, 0.6531, 0.6531, 0.6476],  // komono_kanban.bin[9]
];

/**
 * `g_prop_table66_b` — `0x005953D8`, twenty-nine rows of the
 * {@link PROP_TABLE66_A} shape, straight after it.
 */
export const PROP_TABLE66_B: ReadonlyArray<readonly number[]> = [
  [0x17d5, -737.939, 68.5743, -725.605, 0x4000, 0.56, 0.56, 0.43],  // komono_uemiti.bin[1]
  [0x10dd, -737.03, 68.0201, -725.551, 0x0, 0.5, 0.5, 0.5],  // komono_kanban.bin[9]
  [0x17d5, -740.34, 65.7943, -791.314, 0x4000, 0.56, 0.56, 0.3232],  // komono_uemiti.bin[1]
  [0x10d5, -743.123, 49.7932, -812.184, 0x4000, 0.738, 0.4753, 1.23],  // komono_kanban.bin[1]
  [0x10db, -743.156, 65.6532, -826.624, 0x4000, 0.93, 0.93, 0.93],  // komono_kanban.bin[7]
  [0x17d4, -740.193, 62.872, -850.699, 0x4000, 0.73, 0.73, 0.4818],  // komono_kanban.bin[11]
  [0x10d5, -743.224, 53.9482, -855.092, 0x4000, 1, 1, 1],  // komono_kanban.bin[1]
  [0x10d7, -743.224, 55.5082, -862.171, 0x4000, 1, 1, 1],  // komono_kanban.bin[3]
  [0x10d7, -743.224, 55.5082, -869.211, 0x4000, 1, 1, 1],  // komono_kanban.bin[3]
  [0x10d7, -743.224, 47.9282, -861.911, 0x4000, 1, 1, 1],  // komono_kanban.bin[3]
  [0x10d7, -743.224, 47.9282, -869.411, 0x4000, 1, 1, 1],  // komono_kanban.bin[3]
  [0x17d4, 740.193, 62.872, -885.262, 0x4000, 0.73, 0.73, 0.4818],  // komono_kanban.bin[11]
  [0x17d4, -679.84, 83.312, -924.665, 0x17a9, 0.69, 0.69, 0.69],  // komono_kanban.bin[11]
  [0x17d4, -665.389, 83.312, -934.673, 0x17a9, 0.69, 0.69, 0.69],  // komono_kanban.bin[11]
  [0x10d4, -738.99, 60.7014, -889.379, 0x1872, 0.8122, 0.8122, 0.8031],  // komono_kanban.bin[0]
  [0x10d8, -665.597, 96.347, -1017.08, 0x4000, 1, 1, 1],  // komono_kanban.bin[4]
  [0x17d4, -659.948, 76.627, -1062.49, 0x4000, 0.5751, 0.5751, 0.5751],  // komono_kanban.bin[11]
  [0x10dd, -658.059, 76.1227, -1062.47, 0x0, 0.5, 0.5, 0.5],  // komono_kanban.bin[9]
  [0x17d5, -721.687, 63.9143, -796.183, -0x4000, 0.56, 0.56, 0.3232],  // komono_uemiti.bin[1]
  [0x10de, -722.346, 61.3543, -796.183, 0x0, 0.46, 0.46, 0.46],  // komono_kanban.bin[10]
  [0x10d5, -638.201, 96.739, -920.135, -0x67e5, 1, 1, 1],  // komono_kanban.bin[1]
  [0x10da, -632.444, 85.73, -941.15, -0x4000, 1, 0.89, 1],  // komono_kanban.bin[6]
  [0x17d5, -626.58, 80.1342, -957.011, -0x4000, 0.56, 0.56, 0.3232],  // komono_uemiti.bin[1]
  [0x10dc, -627.448, 79.6589, -957.003, 0x0, 0.3823, 0.3823, 0.268],  // komono_kanban.bin[8]
  [0x10d6, -621.169, 55.952, -969.407, -0x4000, 1.12, 1.12, 1.12],  // komono_kanban.bin[2]
  [0x17d5, -626.58, 80.1342, -1036.52, -0x4000, 0.56, 0.56, 0.3232],  // komono_uemiti.bin[1]
  [0x10de, -627.956, 77.3143, -1036.52, 0x0, 0.46, 0.46, 0.46],  // komono_kanban.bin[10]
  [0x10b1, -742.619, 53.6403, -887.126, -0x4d22, 0.5106, 1.459, 1.71],  // komono_uemiti.bin[0]
  [0x17d4, -737.083, 62.572, -1093.7, 0x861c, 0.69, 0.69, 0.69],  // komono_kanban.bin[11]
];

/** `obj+0x124 = 0x40800000` — the radius every object is given, 4.0. */
export const TYPE66_RADIUS = 4.0;
/** `obj+0x2C0 = 0xC0600000` — how far below the origin the sphere sits, -3.5. */
export const TYPE66_SHOT_DROP = -3.5;
/** `CMP AX,0x10DC` — `komono_kanban.bin[8]`, the one with a larger sphere. */
export const TYPE66_LARGE_SLOT = 0x10dc;
/** `0x40D00000` and `0xC0A00000` — its radius 6.5 and its drop -5.0. */
export const TYPE66_LARGE_RADIUS = 6.5;
export const TYPE66_LARGE_SHOT_DROP = -5.0;
/** `CMP AX,0x10B1` — `komono_uemiti.bin[0]`, the one laid back a quarter turn. */
export const TYPE66_TILTED_SLOT = 0x10b1;
/** `obj+0x1CC = 0xFFFFC000`. */
export const TYPE66_TILTED_PITCH = -0x4000;

/**
 * `0x10DC`, `0x10DD`, `0x10DE` — `komono_kanban.bin[8]`, `[9]`, `[10]`: the
 * three slots `PropUpdateType66` swings, shot-tests and scores. Every other
 * slot is drawn and nothing else.
 */
export const TYPE66_SWING_SLOTS: readonly number[] = [0x10dc, 0x10dd, 0x10de];
/**
 * `0x10DE` — `komono_kanban.bin[10]`, which swings about a point 1.5 above its
 * origin: `MatrixTranslate(0, 1.5, 0)` before the rotations and
 * `(0, -1.5, 0)` after (`0x3FC00000`, `0xBFC00000`).
 */
export const TYPE66_PIVOT_SLOT = 0x10de;
export const TYPE66_PIVOT_RISE = 1.5;

/** `PUSH 0x1116A9; CALL PlaySoundId` — the hit. */
export const SFX_TYPE66_HIT = 0x1116a9;
/** `PUSH 0x3F800000` — `SpawnPropHitEffectScaled`'s size. */
const TYPE66_HIT_EFFECT_SCALE = 1.0;
/** `rand() % 0x201 + 0x600` — the swing rate a hit starts. */
export const TYPE66_HIT_SPREAD = 0x201;
export const TYPE66_HIT_RATE = 0x600;
/**
 * `g_scene_index == 0` and `g_screen_shake_frames` 0x17 or 0x2F: the two
 * frames of a stage-1 shake on which the three swing again, at
 * `±(rand() % 0x201 + frames * 32)`.
 */
export const TYPE66_SHAKE_SCENE = 0;
export const TYPE66_SHAKE_FRAMES: readonly number[] = [0x17, 0x2f];
/** `SHL EAX,5` — the shake's frames times 32. */
export const TYPE66_SHAKE_SCALE = 32;
/** `MOV EAX,0x2AAAAAAB; IMUL; SAR EDX,2` — the spring divides by 24. */
export const TYPE66_SPRING_DIVISOR = 24;

/**
 * `PlaceTable66Props` — `FUN_00464500`. `g_class41_constructors[66]`.
 *
 * ```c
 * n = 0x14; row = g_prop_table66_a;
 * if (0 < (s16)placer->+0x1F4) { n = 0x1D; row = g_prop_table66_b; }
 * for (; n; n--, row += 0x20) {
 *     obj = ActorAlloc(PropUpdateType66, 0x378); ActorClearGameFields(obj);
 *     obj->+0x19C/1A0/1A4 = row.x, row.y, row.z;
 *     obj->+0x1D0 = row.yaw;
 *     obj->+0x1A8/1AC/1B0 = row.sx, row.sy, row.sz;
 *     obj->+0x28C = row.slot;
 *     obj->+0x196 = g_evt_step_index;  obj->+0x197 = 0;
 *     obj->+0x124 = 4.0f;  obj->+0x11C = placer->+0x11C;  obj->+0x2C0 = -3.5f;
 *     if (row.slot == 0x10DC) { obj->+0x124 = 6.5f; obj->+0x2C0 = -5.0f; }
 *     if (row.slot == 0x10B1) obj->+0x1CC = 0xFFFFC000;
 *     obj->+0x34 = 0x80000001;
 * }
 * ```
 *
 * `table` is the placer's `+0x1F4` and `lifetime` its `+0x11C`. Pitch and
 * roll are otherwise the zero `ActorClearGameFields` (`FUN_004A73D0`) left.
 */
export function PlaceTable66Props(at: number, table: number,
                                  lifetime: number): BreakableProp[] {
  const rows = table > 0 ? PROP_TABLE66_B : PROP_TABLE66_A;
  return rows.map((row) => {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
    p.family = PropFamily.Type66;
    p.at = at;
    p.x = Math.fround(row[1]);
    p.y = Math.fround(row[2]);
    p.z = Math.fround(row[3]);
    p.yaw = row[4];
    p.restX = Math.fround(row[5]);                  // +0x1A8
    p.restY = Math.fround(row[6]);                  // +0x1AC
    p.restZ = Math.fround(row[7]);                  // +0x1B0
    p.slot = row[0];
    p.lastStepIndex = G.g_evt_step_index;
    p.stepsElapsed = 0;
    p.hitRadius = TYPE66_RADIUS;
    p.lifetime = lifetime;
    // `obj+0x2C0` — for this family the shot point's drop below the origin,
    // not the crack's shake it is for the group props (`L3`).
    p.shake = TYPE66_SHOT_DROP;
    if (p.slot === TYPE66_LARGE_SLOT) {
      p.hitRadius = TYPE66_LARGE_RADIUS;
      p.shake = TYPE66_LARGE_SHOT_DROP;
    }
    if (p.slot === TYPE66_TILTED_SLOT) p.pitch = TYPE66_TILTED_PITCH;
    p.flags = 0x80000000 | BreakableFlag.Live;
    // `ActorClearGameFields` zeroes `+0x2A0`/`+0x2A4` too.
    p.storyItem = 0;
    p.removeFlag = 0;
    return p;
  });
}

/**
 * `PropUpdateType66` — `FUN_0046FE00`. One object, one 60 Hz frame.
 *
 * `+0x1D8` is {@link BreakableProp.spin}, the swing's rate on `+0x1CC`
 * ({@link BreakableProp.pitch}); `+0x2C0` is {@link BreakableProp.shake},
 * the sphere's drop; `+0x1A8..+0x1B0` {@link BreakableProp.restX}/`restY`/
 * `restZ`, the scale; `+0x1C8` {@link BreakableProp.vz}, which nothing
 * writes for this family and the draw adds to Z.
 */
export function PropUpdateType66(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  // The inline lifetime: no scene-1 sweep, and `ActorKill` (`CALL 0x004A7040`
  // at `0x0046FE34`), not the prologue's `ActorDespawn`.
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.lifetime < p.stepsElapsed) {
      ActorKillProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }

  if (TYPE66_SWING_SLOTS.includes(p.slot)) {
    if ((p.flags & BreakableFlag.Hit) !== 0) {
      // `AND AL,0xF7` and the store, then the award on the cleared word.
      p.flags &= ~BreakableFlag.Hit;
      BreakablePropAwardHit(p.flags, false, rng);
      // `SpawnPropHitEffectScaled(obj, (obj+0x34 & 2) ? 0 : 1, 1.0f)`
      // (`FUN_004666B0`) at the point `combat/shot.ts` left on the prop.
      if (p.hitAim) {
        SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                                 TYPE66_HIT_EFFECT_SCALE);
      }
      events?.emit("sound.play", { id: SFX_TYPE66_HIT });
      p.spin = rng.int(TYPE66_HIT_SPREAD) + TYPE66_HIT_RATE;
    }
    if (G.g_scene_index === TYPE66_SHAKE_SCENE
        && TYPE66_SHAKE_FRAMES.includes(G.g_screen_shake_frames)) {
      // `rand() & 0x80000001` with the sign fixup is `rand() % 2`; the sign
      // is drawn before the size.
      const sign = 1 - rng.int(2) * 2;
      p.spin = sign * (rng.int(TYPE66_HIT_SPREAD)
                       + G.g_screen_shake_frames * TYPE66_SHAKE_SCALE);
    }
    // The rate from the OLD angle, the angle from the NEW rate; the divide
    // truncates toward zero (the multiply-and-shift's sign fixup).
    const rate = (p.spin
      - Math.trunc(((p.pitch + p.spin) | 0) / TYPE66_SPRING_DIVISOR)) | 0;
    p.spin = rate;
    p.pitch = (rate + p.pitch) | 0;
    // `FLD +0x2C0; FADD +0x1A0` — the drop and the height in float32, the
    // point through the view into `obj+0x70`, and `RegisterForShotTest`.
    PropRegisterForShotTest(p, p.x, Math.fround(p.shake + p.y), p.z);
  }
  // `AND EDI,0xFFFFFFF9` — the two player bits, for every slot.
  p.flags &= ~(BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1);

  const m = PropMatrixPush();
  // `FLD +0x1C8; FADD +0x1A4; FSTP` — a float32 sum on its way to the stack.
  MatrixTranslate(m, p.x, p.y, Math.fround(p.vz + p.z));
  if (p.slot === TYPE66_PIVOT_SLOT) MatrixTranslate(m, 0, TYPE66_PIVOT_RISE, 0);
  MatrixRotateZ(m, p.roll);
  MatrixRotateY(m, p.yaw);
  MatrixRotateX(m, p.pitch);
  if (p.slot === TYPE66_PIVOT_SLOT) {
    MatrixTranslate(m, 0, -TYPE66_PIVOT_RISE, 0);
  }
  MatrixScale(m, p.restX, p.restY, p.restZ);
  // `MaxOfThreeToNoOpStub` between the scale and the draw: empty.
  PropDrawSlot(p, m, p.slot);
}

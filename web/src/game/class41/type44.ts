/**
 * Class 0x41 type 44 — `PlaceTable44Props` and `PropUpdateType44`.
 *
 * Stage 1's church, block 1 step 2 op 17 (evt `0x1B48`): seven objects from
 * `g_prop_table44`, and they are **chairs** — not by resemblance but by asset:
 *
 * * rows 2..6 draw slot `0x1064`, which is `komono_7.bin[0]`, the model
 *   `docs/formats/spawns.md` already identifies as the chair class 0x33's
 *   pushable scenery draws;
 * * rows 0 and 1 draw **effect 0x13** instead, a ten-node tree whose pieces
 *   are `komono_7.bin[11..20]` (slots `0x1070`..`0x1079`), and a shot plays
 *   motion 468 on it, which throws the pieces apart.
 *
 * Row 6 is the one lying on its side at (-22.3, 9.06, -97.86) — pitch
 * `-0x26BD`, roll `-0x4000` — beside the class-0x25 humanoid block 1 step 5
 * places at (-4.9, 6.22, -114.5). [likely] that is the chair new bug 9 means
 * ("the static chair prop that the NPC has his arm around"): it is the only
 * object the script places anywhere near that humanoid, and rows 2..6 are
 * exactly "static" — nothing in the routine ever moves or hides them.
 *
 * Every row is shootable while its clock is at zero, and a hit pays ten; only
 * rows 0 and 1 show it.
 *
 * `[proved]` from `FUN_004639F0` and `FUN_0046D850`, the draw tails read out
 * of the disassembly because the decompiler ends the routine at the first
 * `MatrixStackPop` (L35/L37).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { T } from "../tables";
import { BreakablePropAwardHit, SFX_PROP_BREAK } from "./prop";
import { PropStepLifetimeInline } from "./lifetime";
import {
  BreakableFlag, makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import {
  EffectSampleNode, type EffectNodePose,
} from "../class44/script_flag_effect";

/**
 * `g_prop_table44` — `0x005946F8`, seven rows of
 * `{s16 x, y, z (* 0.01); pad; s32 rx, ry, rz (BAMS)}`, stride 20.
 */
export const PROP_TABLE44: ReadonlyArray<readonly number[]> = [
  [-1060, 600, 458, 0, 0x8000, 0],
  [-2004, 600, 408, 0, 0x71c7, 0],
  [2209, 619, 933, 0, 0xaee3, 0],
  [-1560, 600, -2758, 0, 0x8000, 0],
  [-2304, 600, -1608, 0, 0, 0],
  [-1635, 600, -6690, 0, 0, 0],
  [-2230, 906, -9786, -0x26bd, 0, -0x4000],
];

/** `0x0046D988`'s `(float)(s16) * 0.01`. */
export const TYPE44_POS_SCALE = 0.01;
/** `obj+0x324 = 0x13` — the effect rows 0 and 1 draw. */
export const TYPE44_EFFECT = 0x13;
/** `obj+0x328 = 0x1D4` — motion 468, the one a hit plays. */
export const TYPE44_MOTION = 0x1d4;
/** `CMP word [ESI+0x290], 2 / JGE` — rows from here on draw the whole chair. */
export const TYPE44_FIRST_WHOLE_ROW = 2;
/** `AssetDrawSlot(0x1064)` — `komono_7.bin[0]`. */
export const TYPE44_WHOLE_SLOT = 0x1064;
/** `AssetDrawSlot(0x10D1)`, at `floor + 0.2`, scaled `(8, 1, 8)`. */
export const TYPE44_SHADOW_SLOT = 0x10d1;
export const TYPE44_SHADOW_RISE = Math.fround(0.2);
export const TYPE44_SHADOW_SCALE = 8.0;
/** `obj+0x124 = 0x40A00000`. */
export const TYPE44_RADIUS = 5.0;
/** `0x0055D2B4` — the shot point is this far above the origin. */
export const TYPE44_SHOT_RISE = 5.0;

/**
 * `PlaceTable44Props` — `FUN_004639F0`. `g_class41_constructors[44]`.
 *
 * ```c
 * for (i = 0, row = g_prop_table44; row < 0x594786; row += 10 shorts, i++) {
 *     obj = ActorAlloc(PropUpdateType44, 0x378); ActorClearGameFields(obj);
 *     obj->+0x11C = placer->+0x11C;  obj->+0x196 = g_evt_step_index;
 *     obj->+0x290 = i;
 *     obj->+0x19C/1A0/1A4 = row.x/y/z * 0.01;
 *     obj->+0x1CC/1D0/1D4 = row.rx/ry/rz;
 *     obj->+0x124 = 5.0;  obj->+0x34 = 0x80000001;
 *     obj->+0x324 = 0x13;  obj->+0x328 = 0x1D4;
 * }
 * ```
 */
export function PlaceTable44Props(at: number, lifetime: number):
    BreakableProp[] {
  return PROP_TABLE44.map((row, i) => {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, i);
    p.family = PropFamily.Type44;
    p.at = at;
    p.kind = i;
    p.lifetime = lifetime;
    p.lastStepIndex = G.g_evt_step_index;
    p.stepsElapsed = 0;
    p.x = row[0] * TYPE44_POS_SCALE;
    p.y = row[1] * TYPE44_POS_SCALE;
    p.z = row[2] * TYPE44_POS_SCALE;
    p.pitch = row[3];
    p.yaw = row[4];
    p.roll = row[5];
    p.hitRadius = TYPE44_RADIUS;
    p.flags = 0x80000000 | BreakableFlag.Live;
    p.effect = TYPE44_EFFECT;
    p.effectVariant = TYPE44_MOTION;
    p.effectFrames = 0;
    p.effectPrevFrame = 0;
    // No `obj+0x28C` write: the routine never draws that field.
    p.slot = i < TYPE44_FIRST_WHOLE_ROW ? 0xffff : TYPE44_WHOLE_SLOT;
    if (i < TYPE44_FIRST_WHOLE_ROW) Type44PoseEffect(p);
    return p;
  });
}

/**
 * `PropUpdateType44` — `FUN_0046D850`. One object, one 60 Hz frame.
 *
 * `obj+0x32C` is both the "has been shot" latch and the effect's play cursor:
 * 0 until the hit, then 1, 2, … up to `g_motion_play_length[468] - 2`, where
 * it holds.
 */
export function PropUpdateType44(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  if (PropStepLifetimeInline(p)) return;

  if (p.effectFrames === 0 && (p.flags & BreakableFlag.Hit) !== 0) {
    BreakablePropAwardHit(p.flags, true, rng);
    events?.emit("sound.play", { id: SFX_PROP_BREAK });
    p.effectFrames = 1;
    // The mask is inside the hit arm, not after it: a hit that lands on a
    // row already shot leaves its bit set, and nothing reads it again.
    p.flags &= ~BreakableFlag.Hit;
    // `[open]` `SpawnPropHitEffectScaled(obj, player, 1.5f)` (`FUN_004666B0`)
    // is not ported; `combat/shot.ts` spawns the prop spark in its place.
  }
  if (p.effectFrames >= 1) {
    p.effectFrames += 1;
    // `g_motion_play_length[obj+0x328] - 2`. The port reads the length off
    // the effect record the bundle carries for 0x13 -- motion 468 is 60 --
    // and a bundle without that record has nothing to draw either, so the
    // clock simply runs on rather than clamping at a length it does not know.
    const len = T.breakables?.effects?.[String(TYPE44_EFFECT)]?.play_length;
    if (len !== undefined && p.effectFrames > len - 2) {
      p.effectFrames = len - 2;
    }
  }

  // The draw: rows 0 and 1 go through `EffectDrawUnlit` (`FUN_0040DD90`),
  // which leaves `obj+0x330` behind; the port's draw is in
  // `render/breakables.ts`, so the word the engine's draw writes is written
  // here. [port-only] in where it is written, not in what.
  //
  // `CMP word [0x009A4684], 2` gates that draw on `g_motion_slots[468]` being
  // resident. The bundle bakes the motion, so for the port it always is — the
  // same answer `ScriptFlagEffectUpdate` gives its own residency test.
  if (p.kind < TYPE44_FIRST_WHOLE_ROW) {
    Type44PoseEffect(p);
    p.effectPrevFrame = p.effectFrames;
  }

  if (p.effectFrames === 0) {
    PropRegisterForShotTest(p, p.x, p.y + TYPE44_SHOT_RISE, p.z);
  }
}

/**
 * `EffectDrawUnlit`'s walk of effect 0x13 for one object: every drawn node
 * posed by `EffectPoseNode` at the cursor in `obj+0x32C`.
 *
 * [port-only] as a function: the engine poses and draws in one walk inside
 * `PropUpdateType44`'s draw. The poses are left in
 * {@link BreakableProp.effectPoses} for `render/`, which composes them under
 * the object's own `T . Rz . Ry . Rx`.
 */
function Type44PoseEffect(p: BreakableProp): void {
  const def = T.breakables?.effects?.[String(TYPE44_EFFECT)];
  p.effectPoses = [];
  if (!def) return;
  const pose: EffectNodePose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  def.nodes.forEach((n, i) => {
    if (!n.slot) return;
    if (!EffectSampleNode(def, i, p.effectFrames, p.effectPrevFrame, pose)) {
      return;
    }
    p.effectPoses.push({ slot: n.slot, ...pose });
  });
}

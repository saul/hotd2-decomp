/**
 * Class 0x44 selector 0 — the window the zombies come through.
 *
 * Two spawns in the whole game, both in stage 1: the descriptors at evt
 * `0x1580` and `0x15CC`, placed together by every block that leads into the
 * hall and kicked apart by the three class-0x30 zombies behind them.
 *
 * ## It is not a hinge, and it has no position of its own
 *
 * Every other selector of this class builds a **model at a pose**:
 * `PropBuildHinge` (`FUN_00472BD0`) copies the spawn's `+0x40` into
 * `obj+0x19C` and `HingeUpdate` (`FUN_00473CF0`) opens with
 * `MatrixTranslate` from it. `PropBuildScriptFlagEffect` (`FUN_00472B30`)
 * copies **nothing**: there is no `MatrixTranslate` anywhere in the family,
 * and `ScriptFlagEffectUpdate` (`FUN_00473B90`) hands the object's four-word
 * state block straight to `EffectDrawWithCapture` (`FUN_0040DFD0`). The parts
 * are placed by the *motion*, in world coordinates — motion 471 frame 0 puts
 * them at `(±13.762, 0, −361.5/−362.8)`, which is the spawn positions to
 * three decimals. That is why the exporter emitted nothing for these two for
 * as long as it treated the class as hinges only: there was no hinge to emit,
 * and `props.hinges` is where a class-0x44 spawn was looked for.
 *
 * ## The whole routine
 *
 * ```c
 * if (g_script_flags[0x13]) { ActorDespawn(obj); return; }
 * if (g_script_flags[0x12]
 *     && obj->+0x32C < g_motion_play_length[obj->+0x328] - 2)
 *     obj->+0x32C++;
 * cues = obj->+0x324 == 2 ? g_script_flag_effect_cues_a
 *                         : g_script_flag_effect_cues_b;
 * if (cues[cursor] == obj->+0x32C) {
 *     PlaySoundId(0x1816A9);
 *     if (cues[++cursor] == -1) cursor = 0;
 * }
 * if (g_motion_slots[471].state == 2) {                // the motion is resident
 *     EffectDrawWithCapture(obj + 0x324, obj->+0x2A0, -1);  // -> obj+0x338
 *     rot = EffectFrameRotations(obj + 0x324, obj->+0x32C);
 *     memcpy(obj + 0x150, obj + 0x338, 64);              // REP MOVSD, 0x00473CBB
 *     obj->+0x64/+0x68/+0x6C = rot[obj->+0x2A0 * 3 - 3 ..];  // three s16
 *     RegisterForShotTest(obj);                          // 0x00473CDF
 * }
 * ```
 *
 * `[proved]`, `0x00473B90`..`0x00473CE7`. Three script flags and a clip, and
 * the sound is on the *play* cursor rather than on the authored key -- the
 * cue frames run to 175 against 101 keys.
 *
 * `[port-only]` **The residency test is not modelled.** `g_motion_slots[471]`
 * is loaded by the scene's own asset job and the bundle bakes the motion
 * unconditionally, so the port's answer to "is it resident" is always yes; a
 * loader the port does not have cannot be asked.
 *
 * ## It is shot through its mesh, and it is in the way
 *
 * `PropBuildScriptFlagEffect` sets `obj+0x34 |= 0x51` and copies the tail's
 * `+0x08` to `obj+0x14C` -- `coli1.bin:5248` and `:5712` for the two halves
 * (the placements' `coli_blob`). Bit `0x10` sends the registration to
 * `ShotTestMesh` (`FUN_00404A00`), and with `0x40` the window is in the
 * moving-object collision passes (`coli.ts`). The matrix it is traced
 * through is the **capture**: `EffectDrawNode` (`FUN_0040DE50`) stores the
 * stack top for the node whose bone is `obj+0x2A0` at `obj+0x338`
 * ({@link BreakableProp.effectCapture}, `PropDrawEffect`'s *capture*), and
 * the routine copies it over `obj+0x150`. With no push or translate before
 * the draw, the node's matrix is its motion's world pose, built here on the
 * identity, which is what `RegisterForShotTest`'s mesh arm leaves
 * (`class41/shot_test.ts`).
 *
 * The three angles `ShotTestMesh` turns a hit's normal by are
 * `EffectFrameRotations` (`FUN_0040E070`) at the **raw** cursor, entry
 * `obj+0x2A0` -- read where the routine reads them, in the bank's file, by
 * the exporter (`rotation_entries`) -- and from cursor 101 they are past the
 * end of `mot/komono_niwa.bin`: see {@link EffectFrameRotationsEntry}, which
 * carries the one declared divergence. `hitRadius` carries the engine's
 * 40.0, which `ShotTestMesh` never reads.
 */
import type { EffectDefJson } from "../../bundle";
import {
  MatrixFromZYX, MatrixInterpolateSwingTwist, MatrixToZYX,
} from "./swing_twist";
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { T } from "../tables";
import { ColiStoreObjectMatrix } from "../coli";
import { ActorDespawnProp } from "../class41/prop";
import {
  PropDrawBegin, PropDrawEffect, PropMatrixPush,
} from "../class41/prop_draw";
import {
  BreakableFlag, makeBreakableProp, PropFamily, type BreakableProp,
} from "../class41/prop_state";
import { PropRegisterForShotTestAsIs } from "../class41/shot_test";
import { PropWords } from "../class41/words";

/**
 * The `g_script_flags` indices `ScriptFlagEffectUpdate` reads.
 *
 * Both are literals in the routine — `DAT_009C7212` and `DAT_009C7213` against
 * `g_script_flags` at `0x009C7200` — and not fields of the descriptor, so they
 * are the same two for every spawn of this selector. Stage 1 raises `Advance`
 * at block 2 step 2 op 6 and block 10 step 2 op 5, and `Remove` at blocks 3,
 * 7 and 12.
 */
export enum ScriptFlagEffectFlag {
  /** `g_script_flags[0x12]` — while it is up, the clip runs. */
  Advance = 0x12,
  /** `g_script_flags[0x13]` — `ActorDespawn`, tested before anything else. */
  Remove = 0x13,
}

/** `PlaySoundId(0x1816A9)` at every cue frame. */
export const SFX_SCRIPT_FLAG_EFFECT = 0x1816a9;

/** `obj+0x124 = 0x42200000` at `0x00472BB6`. */
export const SCRIPT_FLAG_EFFECT_RADIUS = 40.0;

/**
 * `g_effect_interp_mode` — 0x004D5440, the rate `EffectPoseNode`
 * (`FUN_0040D9D0`) samples an effect's motion at.
 */
export enum EffectInterp {
  /** One key per play frame. */
  PerFrame = 0,
  /** Half rate: key `cursor / 2`, blended half way to the next on odd. */
  HalfRate = 1,
  /**
   * As {@link HalfRate}, except that on an odd cursor past 1, when **all
   * three** of the two keys' angles differ by more than `0x3000` (Z, then Y,
   * then X, each as a plain integer difference), the rotation is not blended
   * angle by angle: both keys' `Rz . Ry . Rx` go through
   * `MatrixInterpolateSwingTwist` (`FUN_00412750`) at `t = 0.5`. Effect 0x13 —
   * class 0x41 type 44's breaking chair — is this mode, and motion 468
   * reaches the matrix arm on twelve of its node-frames. See `swing_twist.ts`.
   */
  HalfRateSlerp = 2,
}

/** One effect's baked motion and tree, as the bundle carries it. */
function EffectDefOf(effect: number) {
  return T.breakables?.effects?.[String(effect)] ?? null;
}

/**
 * The words of the object the window's routine writes that no shared
 * {@link BreakableProp} field names: `obj+0x64`/`+0x68`/`+0x6C`, the three
 * angles `ShotTestMesh` turns a hit's normal by (`PropShotMeshObject`).
 */
export interface EffectAngleWords {
  o64: number;
  o68: number;
  o6c: number;
}

const EFFECT_ANGLE_WORDS: EffectAngleWords = { o64: 0, o68: 0, o6c: 0 };

/**
 * `PropBuildScriptFlagEffect` — `FUN_00472B30`.
 *
 * `ActorAlloc(ScriptFlagEffectUpdate, 0x378)`, then the state block and two
 * literals. The dword at `tail+0x04` picks the pair (`CMP ECX,0x13F5` at
 * `0x00472B6C`) and the exporter has already resolved that to the effect id
 * and the capture bone, because it is the same test. `obj+0x28C` is the
 * tail's `+0x04`, which this family never draws through; `obj+0x14C` the
 * tail's `+0x08`, raw and resolved. One object: `EffectDrawWithCapture`
 * walks the whole tree from it, and the port records that walk's draws
 * ({@link PropDrawEffect}).
 */
export function PropBuildScriptFlagEffect(
    pl: BreakablePlacement): BreakableProp | null {
  const effect = pl.effect ?? 0;
  if (!EffectDefOf(effect)) return null;
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.ScriptFlagEffect;
  p.at = pl.at;
  // `obj+0x34 |= 0x51`.
  p.flags = BreakableFlag.Live | 0x10 | 0x40;
  p.slot = pl.slot ?? 0;
  // `obj+0x324`/`+0x328`/`+0x32C`/`+0x330` — the state block, in order.
  p.effect = effect;
  p.effectVariant = pl.motion ?? 0;
  p.effectFrames = 0;
  p.effectPrevFrame = 0;
  // `obj+0x2A0`, and the two cue cursors `obj+0x2A4`/`+0x2A8`.
  p.storyItem = pl.capture_bone ?? 0;
  p.removeFlag = 0;
  p.cueCursorB = 0;
  // `obj+0x124 = 40.0` and `obj+0x14C = tail+0x08`.
  p.hitRadius = SCRIPT_FLAG_EFFECT_RADIUS;
  p.coliBlob = pl.coli_blob ?? null;
  return p;
}

/**
 * `ScriptFlagEffectUpdate` — `FUN_00473B90`. One object, one 60 Hz frame.
 * See the file comment for the routine.
 */
export function ScriptFlagEffectUpdate(p: BreakableProp, rng: Rng,
                                       events?: Events): void {
  if (G.g_script_flags[ScriptFlagEffectFlag.Remove] === 1) {
    ActorDespawnProp(p);
    return;
  }
  const def = EffectDefOf(p.effect);
  if (!def) return;
  if (G.g_script_flags[ScriptFlagEffectFlag.Advance] === 1
      && p.effectFrames < def.play_length - 2) {
    p.effectFrames += 1;
  }
  ScriptFlagEffectSoundCue(p, def.cues, events);
  // `EffectDrawWithCapture(obj + 0x324, obj->+0x2A0, -1)`.
  PropDrawBegin(p);
  PropDrawEffect(p, PropMatrixPush(), rng, -1, p.storyItem);
  ScriptFlagEffectFileMesh(p, "script_flag_effect");
}

/**
 * The tail `ScriptFlagEffectUpdate` and `FlagSlotEffectUpdate`
 * (`FUN_00474120`) share past their draws: `rot =
 * EffectFrameRotations(obj + 0x324, obj->+0x32C)`, the capture copied over
 * `obj+0x150` by `REP MOVSD` (`0x00473CBB`, `0x0047420B`), `obj+0x64`/`+0x68`
 * /`+0x6C` = entry `obj+0x2A0` of `rot`, and `RegisterForShotTest`.
 *
 * `[port-only]` as a function: the engine writes the same eleven
 * instructions out in both routines. *container* names the placement the
 * exporter's reads ride on.
 */
export function ScriptFlagEffectFileMesh(p: BreakableProp,
                                         container: string): void {
  if (p.effectCapture) {
    ColiStoreObjectMatrix(p, p.effectCapture);
    p.coliMatrixDrawn = true;
  }
  const w = PropWords(p, EFFECT_ANGLE_WORDS);
  const [rx, ry, rz] = EffectFrameRotationsEntry(p, container);
  w.o64 = rx;
  w.o68 = ry;
  w.o6c = rz;
  PropRegisterForShotTestAsIs(p);
}

/**
 * `EffectFrameRotations` (`FUN_0040E070`) at the object's raw cursor
 * `obj+0x32C`, entry `obj+0x2A0`: the three signed shorts the routine loads,
 * as the exporter read them where the routine reads them
 * (`rotation_entries`, `MotionBank.effectRotationEntry`).
 *
 * [diverges] **Zero past the end of the bank's file.** There the routine reads
 * its own heap: the bank's uncleared block slack, then the next arena
 * block's header (absolute addresses) and whatever is allocated or was left
 * there, which depends on every allocation since the scene's `ArenaReset`
 * -- a sprite actor per shot into the scenery among them -- and on the CRT's
 * `malloc` address (`docs/formats/mot.md`, "What lies after a bank in
 * memory"). No rule reproduces it; zero is the arena as `ArenaReset` first
 * leaves it, and it is what this reads. The inputs that reach it: selector
 * 0's two window halves (motion 471, entries 2 and 1) at cursor > 100, and
 * selector 3 at stage 1's `0x3ACC` (motion 470, entry 30, its open flag) at
 * cursor > 65; the other selector-3 spawn names no blob, so no trace reads
 * its angles. All three reach the port: the cursor runs to `play_length -
 * 2`, 198 and 146. The only reader is `ShotTestMesh`'s turn of a mesh hit's
 * normal, which `SpawnWorldImpact` orients its sprite by.
 * `test/port/class44.test.ts` pins the zero.
 *
 * `[port-only]` as a function: the read is two lines of each routine; the
 * table is the bundle's.
 */
export function EffectFrameRotationsEntry(p: BreakableProp,
                                          container: string):
    [number, number, number] {
  const pl = T.breakables?.placements?.find(
    (q) => q.at === p.at && q.container === container);
  return pl?.rotation_entries?.[p.effectFrames] ?? [0, 0, 0];
}

/**
 * The cue block, which is the same shape twice with a different cursor.
 *
 * `ScriptFlagEffectUpdate` writes the two branches out — `obj+0x2A4` into
 * `g_script_flag_effect_cues_a` for effect 2, `obj+0x2A8` into
 * `g_script_flag_effect_cues_b` for anything else — and the exporter has
 * already picked the list by the same test, so what is left here is the
 * cursor. **Equality, not `>=`**: a cursor parked past its cue never fires
 * again, which is what makes the list run once through and stop.
 */
function ScriptFlagEffectSoundCue(p: BreakableProp, cues: readonly number[],
                                  events?: Events): void {
  const a = p.effect === SCRIPT_FLAG_EFFECT_A;
  const cursor = a ? p.removeFlag : p.cueCursorB;
  if (cues[cursor] !== p.effectFrames) return;
  events?.emit("sound.play", { id: SFX_SCRIPT_FLAG_EFFECT });
  // `if (cues[++cursor] == -1) cursor = 0` — the exporter drops the
  // terminator, so running off the end is the same test.
  const next = cursor + 1 >= cues.length ? 0 : cursor + 1;
  if (a) p.removeFlag = next; else p.cueCursorB = next;
}

/** `CMP ECX,0x13F5`'s matching arm: effect 2, captured at bone 2. */
export const SCRIPT_FLAG_EFFECT_A = 2;

/** Where one node's pose lands: a position and three BAMS angles. */
export interface EffectNodePose {
  x: number; y: number; z: number;
  pitch: number; yaw: number; roll: number;
}

/**
 * The body of `EffectPoseNode` (`FUN_0040D9D0`) for one node, written into
 * *out* instead of onto a matrix stack. False for a node the routine does not
 * pose (the root, bone 0).
 *
 * `[port-only]` as a function: split out of the routine above so that an
 * object drawing a **whole tree** under its own transform —
 * `PropUpdateType44` (`FUN_0046D850`) draws effect 0x13's ten pieces — can
 * ask for each node without the one-prop-per-node shape
 * `PropBuildScriptFlagEffect` uses. Same arithmetic, same arms.
 */
export function EffectSampleNode(def: EffectDefJson, nodeIndex: number,
                                 cursor: number, prevFrame: number,
                                 out: EffectNodePose): boolean {
  const node = def.nodes[nodeIndex];
  if (!node || node.bone < 1) return false;
  const b = node.bone - 1;
  if (b >= def.bones) return false;
  const p = out;

  if (def.interp === EffectInterp.PerFrame) {
    ScriptFlagEffectSeat(p, def, cursor, b);
    return true;
  }
  // Half rate. `cursor & 0x80000001` — even and non-negative reads one key.
  if ((cursor & 1) === 0) {
    ScriptFlagEffectSeat(p, def, Math.trunc(cursor / 2), b);
    return true;
  }
  const key = Math.trunc(cursor / 2);
  // The three arms of the engine's `next`, in its order. **Neither wrap arm is
  // reachable for class 0x44**: `ScriptFlagEffectUpdate` stops the cursor at
  // `play_length - 2`, so it never equals `play_length - 1`, and it only ever
  // counts up, so `cursor == 0` cannot follow a positive previous frame. Both
  // pass a *play* frame where a key index is wanted and the engine does not
  // clamp; this does, rather than read off the end of the array.
  let next: number;
  if (cursor === def.play_length - 1 && cursor !== prevFrame
      && cursor - prevFrame >= 0) {
    next = 0;
  } else if (cursor === 0 && prevFrame > 0) {
    next = def.play_length - 1;
  } else {
    next = key + 1;
  }
  ScriptFlagEffectBlend(p, def, key, next, b);
  if (def.interp === EffectInterp.HalfRateSlerp && cursor > 1) {
    EffectSwingTwistArm(p, def, key, next, b);
  }
  return true;
}

/**
 * `EffectPoseNode`'s matrix arm (`0x0040DBC0`..`0x0040DCD9`): when all three
 * angles jump by more than `0x3000` between the two keys, the rotation is
 * `MatrixInterpolateSwingTwist(Rzyx(key), Rzyx(next), 0.5)` instead of the
 * per-angle halfway the caller has already written. The translation blend
 * is the same either way.
 *
 * [port-only] as a function: the engine writes the arm inline.
 */
function EffectSwingTwistArm(p: EffectNodePose, def: EffectDefJson,
                             a: number, bKey: number, b: number): void {
  const ia = EffectKey(def, a, b);
  const ib = EffectKey(def, bKey, b);
  const far = (k: number) => Math.abs(def.r[ib + k] - def.r[ia + k]) > 0x3000;
  if (!(far(2) && far(1) && far(0))) return;
  const m = MatrixInterpolateSwingTwist(
    MatrixFromZYX(def.r[ia], def.r[ia + 1], def.r[ia + 2]),
    MatrixFromZYX(def.r[ib], def.r[ib + 1], def.r[ib + 2]), 0.5);
  const e = MatrixToZYX(m);
  p.pitch = e.pitch;
  p.yaw = e.yaw;
  p.roll = e.roll;
}

/**
 * `[port-only]` {@link EffectSampleNode} for a caller that wants the pose
 * back rather than written into a record it owns — the carried props' break
 * effect (`CarriedPropBreakUpdate`, `FUN_00444EE0`) poses through it.
 * The engine has one routine, `EffectPoseNode` (`FUN_0040D9D0`), and one
 * state block; the port has two owners. Null for a node the engine neither
 * poses nor draws, and for an effect with no baked frames.
 */
export function EffectNodePoseAt(def: EffectDefJson, nodeIndex: number,
                                 cursor: number, prev: number):
    EffectNodePose | null {
  if (!def.frames) return null;
  const out: EffectNodePose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  return EffectSampleNode(def, nodeIndex, cursor, prev, out) ? out : null;
}

/** Key *k*, bone *b*, straight out of the baked arrays. */
function ScriptFlagEffectSeat(p: EffectNodePose, def: EffectDefJson,
                              k: number, b: number): void {
  const i = EffectKey(def, k, b);
  p.x = def.t[i];
  p.y = def.t[i + 1];
  p.z = def.t[i + 2];
  p.pitch = def.r[i];
  p.yaw = def.r[i + 1];
  p.roll = def.r[i + 2];
}

/** Half way from key *a* to key *bKey*, as the engine computes each term. */
function ScriptFlagEffectBlend(p: EffectNodePose, def: EffectDefJson,
                               a: number, bKey: number, b: number): void {
  const ia = EffectKey(def, a, b);
  const ib = EffectKey(def, bKey, b);
  // Translations blend linearly at 0.5 -- `(next - this) * 0.5 + this`.
  p.x = (def.t[ib] - def.t[ia]) * 0.5 + def.t[ia];
  p.y = (def.t[ib + 1] - def.t[ia + 1]) * 0.5 + def.t[ia + 1];
  p.z = (def.t[ib + 2] - def.t[ia + 2]) * 0.5 + def.t[ia + 2];
  p.pitch = BamsHalfway(def.r[ia], def.r[ib]);
  p.yaw = BamsHalfway(def.r[ia + 1], def.r[ib + 1]);
  p.roll = BamsHalfway(def.r[ia + 2], def.r[ib + 2]);
}

/** Where in the flat arrays key *k*'s bone *b* starts, clamped to the block. */
function EffectKey(def: EffectDefJson, k: number, b: number): number {
  const f = Math.min(Math.max(k, 0), def.frames - 1);
  return (f * def.bones + b) * 3;
}

/**
 * `a` plus half the **shortest** way round to `b`, in BAMS.
 *
 * [port-only] Three copies of one expression inside `EffectPoseNode`
 * (`FUN_0040D9D0`), named once. The engine writes it out per axis.
 *
 * The engine's own expression: the difference is taken as a `u16`, folded
 * negative above `0x8000` — strictly above, so exactly half a turn stays
 * positive — and halved by a C division that truncates toward zero.
 */
export function BamsHalfway(a: number, b: number): number {
  let d = (b - a) & 0xffff;
  if (d > 0x8000) d -= 0x10000;
  return a + Math.trunc(d / 2);
}

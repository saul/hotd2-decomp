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
 * if (g_motion_slots[471].state == 2)                  // the motion is resident
 *     EffectDrawWithCapture(obj + 0x324, obj->+0x2A0, -1);
 * ```
 *
 * Three script flags and a clip, and the sound is on the *play* cursor rather
 * than on the authored key — the cue frames run to 175 against 101 keys.
 *
 * `[port-only]` **The residency test is not modelled.** `g_motion_slots[471]`
 * is loaded by the scene's own asset job and the bundle bakes the motion
 * unconditionally, so the port's answer to "is it resident" is always yes; a
 * loader the port does not have cannot be asked.
 *
 * `[port-only]` **The shot test is not registered.** `PropBuildScriptFlagEffect`
 * sets `obj+0x34 |= 0x51`, and bit `0x10` sends `RegisterForShotTest`
 * (`FUN_00405160`) to `ShotTestMesh` rather than to the sphere — the same path
 * the story-mode switch's volume takes, and the same one `class41/shot_test.ts`
 * says the port has not got. `hitRadius` carries the engine's 40.0 so the day
 * it is written the number is already right.
 */
import type { EffectDefJson } from "../../bundle";
import type { Events } from "../../core/events";
import { G } from "../globals";
import { T } from "../tables";
import { ActorDespawnProp } from "../class41/prop";
import {
  BreakableFlag, makeBreakableProp, PropFamily, type BreakableProp,
} from "../class41/prop_state";

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
   * As {@link HalfRate}, and additionally slerping through matrices when any
   * of the three angles differs by more than `0x3000`.
   *
   * The slerp arm is **not ported**: no effect this class places is mode 2 —
   * effects 2 and 3 are both mode 1 — so it has never been reached. Below,
   * mode 2 takes the same blend mode 1 does, which is what the engine does
   * for every pair of keys inside that threshold.
   */
  HalfRateSlerp = 2,
}

/** One effect's baked motion and tree, as the bundle carries it. */
function EffectDefOf(effect: number) {
  return T.breakables?.effects?.[String(effect)] ?? null;
}

/**
 * `PropBuildScriptFlagEffect` — `FUN_00472B30`.
 *
 * `ActorAlloc(ScriptFlagEffectUpdate, 0x378)`, then the state block and two
 * literals. The dword at `tail+0x04` picks the pair (`CMP ECX,0x13F5` at
 * `0x00472B6C`) and the exporter has already resolved that to the effect id
 * and the capture bone, because it is the same test.
 *
 * `[port-only]` **One prop per drawable node.** The engine allocates one
 * object and `EffectDrawTree` walks its whole node tree from it; the port's
 * `BreakableProp` is one drawn model at one pose, which is what
 * `render/breakables.ts` clones by asset slot. Both of the game's two effects
 * have exactly one node with a slot — the others are pure transforms — so the
 * two shapes agree here; a tree with two drawable nodes would want the sound
 * and the cursor kept once rather than per node, which is why they are driven
 * by `member === 0` below.
 */
export function PropBuildScriptFlagEffect(
    at: number, effect: number, captureBone: number, motion: number,
): BreakableProp[] {
  const def = EffectDefOf(effect);
  if (!def) return [];
  const out: BreakableProp[] = [];
  for (let i = 0; i < def.nodes.length; i++) {
    const n = def.nodes[i];
    // `EffectDrawNode` (`FUN_0040DE50`) poses and draws nothing below bone 1,
    // and `AssetDrawSlot(0)` draws nothing at all.
    if (n.bone < 1 || !n.slot) continue;
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, out.length);
    p.family = PropFamily.ScriptFlagEffect;
    p.at = at;
    p.slot = n.slot;
    // `obj+0x324`/`+0x328`/`+0x32C`/`+0x330` — the state block, in order.
    p.effect = effect;
    p.effectVariant = motion;
    p.effectFrames = 0;
    p.effectPrevFrame = 0;
    // `obj+0x2A0`, and the two cue cursors.
    p.storyItem = captureBone;
    p.removeFlag = 0;
    p.cueCursorB = 0;
    // `obj+0x34 |= 0x51`, and `obj+0x124 = 40.0`.
    p.flags = BreakableFlag.Live | 0x10 | 0x40;
    p.hitRadius = SCRIPT_FLAG_EFFECT_RADIUS;
    // `[port-only]` The node index this prop draws, so the pose can find its
    // bone. The engine reaches it through the tree it is walking.
    p.kind = i;
    EffectPoseNode(p);
    out.push(p);
  }
  return out;
}

/**
 * `ScriptFlagEffectUpdate` — `FUN_00473B90`. One object, one 60 Hz frame.
 */
export function ScriptFlagEffectUpdate(p: BreakableProp,
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
  // The engine has one object and one cursor; the port has one prop per
  // drawable node, so only the first of them owns the sound.
  if (p.member === 0) ScriptFlagEffectSoundCue(p, def.cues, events);
  EffectPoseNode(p);
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

/**
 * `EffectPoseNode` — `FUN_0040D9D0`. One node's transform, for one frame.
 *
 * `MatrixTranslate(t); RotZ(rz); RotY(ry); RotX(rx)` — the engine's order, and
 * the one `render/breakables.ts` already draws `PropFamily.Falling` in.
 *
 * `[port-only]` The pose lands on the prop's own `x/y/z` and `pitch/yaw/roll`.
 * The engine puts it on the matrix stack and never in a field; the port needs
 * somewhere for the renderer to read it, and these are the fields that layer
 * already poses a prop from. Nothing else in the port reads them for this
 * family.
 */
export function EffectPoseNode(p: BreakableProp): void {
  const def = EffectDefOf(p.effect);
  if (!def || !def.frames) return;
  const node = def.nodes[p.kind];
  if (!node || node.bone < 1) return;
  const b = node.bone - 1;
  if (b >= def.bones) return;
  const cursor = p.effectFrames;

  if (def.interp === EffectInterp.PerFrame) {
    ScriptFlagEffectSeat(p, def, cursor, b);
    p.effectPrevFrame = cursor;
    return;
  }
  // Half rate. `cursor & 0x80000001` — even and non-negative reads one key.
  if ((cursor & 1) === 0) {
    ScriptFlagEffectSeat(p, def, Math.trunc(cursor / 2), b);
    p.effectPrevFrame = cursor;
    return;
  }
  const key = Math.trunc(cursor / 2);
  // The three arms of the engine's `next`, in its order. **Neither wrap arm is
  // reachable here**: `ScriptFlagEffectUpdate` stops the cursor at
  // `play_length - 2`, so it never equals `play_length - 1`, and it only ever
  // counts up, so `cursor == 0` cannot follow a positive previous frame. Both
  // pass a *play* frame where a key index is wanted and the engine does not
  // clamp; this does, rather than read off the end of the array.
  let next: number;
  if (cursor === def.play_length - 1 && cursor !== p.effectPrevFrame
      && cursor - p.effectPrevFrame >= 0) {
    next = 0;
  } else if (cursor === 0 && p.effectPrevFrame > 0) {
    next = def.play_length - 1;
  } else {
    next = key + 1;
  }
  ScriptFlagEffectBlend(p, def, key, next, b);
  p.effectPrevFrame = cursor;
}

/** Key *k*, bone *b*, straight out of the baked arrays. */
function ScriptFlagEffectSeat(p: BreakableProp, def: EffectDefJson,
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
function ScriptFlagEffectBlend(p: BreakableProp, def: EffectDefJson,
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

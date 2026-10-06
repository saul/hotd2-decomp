/**
 * Class 0x44 selector 5 — a model that plays an effect on script flag 0x62
 * and hands itself over to a hinge.
 *
 * One spawn: stage 2's `0x10018` (block 22, slot `0x17ED`, curve 1). Until
 * flag 0x62 rises it draws `0x17D7`; on the frame it rises the object starts
 * effect 0xC on motion 0x1CE under its own slot and allocates, once, a
 * `HingeUpdate` object (`class44/hinge.ts`) with its own slot, curve and flags
 * -- after which it draws only the effect, and the hinge draws the slot.
 *
 * ## The two routines `[proved]`
 *
 * ```c
 * PropBuildEffectHandoff (0x00472F80):
 *   obj = ActorAlloc(EffectHandoffUpdate, 0x378); ActorClearGameFields(obj);
 *   PropBuildHinge's fields from the same tail offsets, and obj->+0x192 = 0;
 *   obj->+0x324 = 0xC;  obj->+0x328 = 0x1CE;
 *
 * EffectHandoffUpdate (0x00474240):
 *   if (g_script_flags[obj->+0x2A4] == 1) { obj->+0x14C != -1 ? ActorDespawn(obj) : ActorKill(); return; }
 *   if (g_scene_index == 1 && g_script_flags[0x77]) { ActorDespawn(obj); return; }
 *   if (g_script_flags[0x62] == 1) {
 *       if (obj->+0x32C < g_motion_play_length[obj->+0x328] - 3) obj->+0x32C++;
 *       if (obj->+0x192 == 0) {
 *           h = ActorAlloc(HingeUpdate, 0x378); ActorClearGameFields(h);
 *           h->+0x19C..0x1A4 = obj->+0x19C..0x1A4;  h->+0x1D0 = obj->+0x1D0;
 *           h->+0x34 |= 0x51;  h->+0x68 = 0;
 *           h->+0x28C = obj->+0x28C;  h->+0x14C = obj->+0x14C;  h->+0x1DC = obj->+0x1DC;
 *           h->+0x290 = obj->+0x290;  h->+0x2A0 = obj->+0x2A0;  h->+0x2A4 = obj->+0x2A4;
 *           h->+0x2A8 = 0;  h->+0x2C0 = h->+0x1A8 = h->+0x1AC = h->+0x1B0 = 1.0f;
 *           obj->+0x192 = 1;
 *       }
 *   }
 *   if (obj->+0x32C == 0) {
 *       Push; Translate(pos); RotY(+0x1D0); AssetDrawSlot(0x17D7); Pop; return;
 *   }
 *   if (g_motion_slots[obj->+0x328].state == 2) {
 *       Push; Translate(pos); RotY(+0x1D0);
 *       if (obj->+0x192 == 0) AssetDrawSlot((s16)obj->+0x28C);
 *       Translate(0, -1.0, 0);  EffectDrawUnlit(obj + 0x324);  Pop;
 *   }
 * ```
 *
 * Three things to hold on to. The clip stops **three** short of the play
 * length, not two. The hinge is **not** given `obj+0x1E8`, so its wobble
 * phase is the clear's zero rather than the descriptor's. And the routine
 * never calls `RegisterForShotTest`: the object is not shootable, though the
 * hinge it makes is filed as every hinge is.
 *
 * `[port-only]` The residency test is not modelled, the answer
 * `ScriptFlagEffectUpdate` (`FUN_00473B90`) gives its own: the bundle bakes
 * the motion.
 */
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { MatrixRotateY, MatrixTranslate } from "../matrix";
import { EffectMotionPlayLength } from "../effect_draw";
import { ActorDespawnProp, ActorKillProp } from "../class41/prop";
import {
  PropDrawBegin, PropDrawEffect, PropDrawSlot, PropMatrixPush,
} from "../class41/prop_draw";
import {
  BreakableState, makeBreakableProp, PropFamily, type BreakableProp,
} from "../class41/prop_state";
import { PropWords } from "../class41/words";
import {
  HINGE_FLAGS, HINGE_WORDS, PROP_SWEEP_FLAG, PROP_SWEEP_SCENE,
  type HingeWords,
} from "./hinge";

/** `obj+0x324`/`+0x328`: effect 0xC on motion 0x1CE. */
export const EFFECT_HANDOFF_EFFECT = 0xc;
export const EFFECT_HANDOFF_MOTION = 0x1ce;
/** `CMP byte ptr [0x009C7262],1` -- `g_script_flags[0x62]` plays it. */
export const EFFECT_HANDOFF_FLAG = 0x62;
/** `SUB EDX,3` -- the clip stops this far short of its play length. */
const EFFECT_HANDOFF_STOP = 3;
/** `PUSH 0x17D7` -- what it draws until the clip starts. */
export const EFFECT_HANDOFF_CLOSED_SLOT = 0x17d7;
/** `PUSH 0xBF800000` -- the effect is drawn one unit down. */
const EFFECT_HANDOFF_DROP = -1.0;

/** The hinge's words, and `obj+0x192`: the hinge has been made. */
export interface EffectHandoffWords extends HingeWords {
  o192: number;
}

const EFFECT_HANDOFF_WORDS: EffectHandoffWords = { ...HINGE_WORDS, o192: 0 };

/** `PropBuildEffectHandoff` — `FUN_00472F80`. `g_class44_subtypes[5]`. */
export function PropBuildEffectHandoff(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.EffectHandoff;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  p.flags = HINGE_FLAGS;
  p.x = Math.fround(pl.pos?.[0] ?? 0);
  p.y = Math.fround(pl.pos?.[1] ?? 0);
  p.z = Math.fround(pl.pos?.[2] ?? 0);
  p.yaw = pl.yaw ?? 0;
  const w = PropWords(p, EFFECT_HANDOFF_WORDS);
  w.o68 = 0;
  w.o192 = 0;
  p.slot = pl.slot ?? 0;
  w.o14c = pl.coli ?? -1;
  p.coliBlob = pl.coli_blob ?? null;
  w.o1dc = pl.side ?? 0;
  w.o1e8 = pl.wobble_phase ?? 0;
  w.o290 = pl.curve ?? 0;
  p.storyItem = pl.open_flag ?? 0;
  p.removeFlag = pl.remove_flag ?? -1;
  w.o2a8 = 0;
  w.o2c0 = 1.0;
  p.restX = 1.0;
  p.restY = 1.0;
  p.restZ = 1.0;
  p.effect = EFFECT_HANDOFF_EFFECT;
  p.effectVariant = EFFECT_HANDOFF_MOTION;
  p.hitRadius = 0;
  return p;
}

/** `EffectHandoffUpdate` — `FUN_00474240`. One object, one 60 Hz frame. */
export function EffectHandoffUpdate(p: BreakableProp, rng: Rng): void {
  const w = PropWords(p, EFFECT_HANDOFF_WORDS);
  PropDrawBegin(p);
  if ((G.g_script_flags[p.removeFlag] ?? 0) === 1) {
    if (w.o14c !== -1) ActorDespawnProp(p);
    else ActorKillProp(p);
    return;
  }
  if (G.g_scene_index === PROP_SWEEP_SCENE
      && (G.g_script_flags[PROP_SWEEP_FLAG] ?? 0) !== 0) {
    ActorDespawnProp(p);
    return;
  }
  if ((G.g_script_flags[EFFECT_HANDOFF_FLAG] ?? 0) === 1) {
    const len = EffectMotionPlayLength(p.effectVariant);
    if (len !== null && p.effectFrames < len - EFFECT_HANDOFF_STOP) {
      p.effectFrames += 1;
    }
    if (w.o192 === 0) {
      // `ActorAlloc` appends to the task list the pool is walking, so the
      // hinge takes its first step this frame, after everything before it.
      G.g_breakable_props.push(EffectHandoffAllocHinge(p, w));
      w.o192 = 1;
    }
  }
  if (p.effectFrames === 0) {
    const m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    MatrixRotateY(m, p.yaw);
    PropDrawSlot(p, m, EFFECT_HANDOFF_CLOSED_SLOT);
    return;
  }
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, p.yaw);
  if (w.o192 === 0) PropDrawSlot(p, m, p.slot);
  MatrixTranslate(m, 0, EFFECT_HANDOFF_DROP, 0);
  PropDrawEffect(p, m, rng);
}

/**
 * `[port-only]` as a function: the allocation at `0x004742CA`..`0x0047439E`
 * of `EffectHandoffUpdate`, written out there in the engine. Split so the
 * update reads as the routine does; nothing here is not the routine's.
 */
function EffectHandoffAllocHinge(p: BreakableProp,
                                 w: EffectHandoffWords): BreakableProp {
  const h = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  h.family = PropFamily.Hinge;
  h.at = p.at;
  h.state = BreakableState.Standing;
  h.x = p.x;
  h.y = p.y;
  h.z = p.z;
  h.yaw = p.yaw;
  h.flags = HINGE_FLAGS;
  h.slot = p.slot;
  h.storyItem = p.storyItem;
  h.removeFlag = p.removeFlag;
  h.restX = 1.0;
  h.restY = 1.0;
  h.restZ = 1.0;
  h.hitRadius = 0;
  const hw = PropWords(h, HINGE_WORDS);
  hw.o68 = 0;
  // `MOV EDX,[EDI+0x14C]; MOV [ESI+0x14C],EDX` at `0x00474332` -- the one
  // word, both its port fields: the hinge is shot through the same blob.
  hw.o14c = w.o14c;
  h.coliBlob = p.coliBlob;
  hw.o1dc = w.o1dc;
  hw.o290 = w.o290;
  hw.o2a8 = 0;
  hw.o2c0 = 1.0;
  return h;
}

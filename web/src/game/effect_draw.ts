/**
 * The engine's unlit effect draw, for an owner that keeps the four-word state
 * block itself and wants the draws back.
 *
 * An "effect" is a tree of rigid parts, each an asset slot, posed by an
 * ordinary motion clip: `g_effect_trees[id]` (`0x004D5390`) is the tree and
 * `g_motion_slots[motion]` (`0x009A37E0`) the clip. The owner keeps `{effect, motion, frame,
 * prev}` and calls the three routines here, which pose each node from the
 * clip, draw it, and **write the block back** -- the frame wraps in
 * `EffectDrawTree` and the previous frame is stored there -- so an owner that
 * steps its own frame steps it in two places, as the engine's do.
 *
 * `[proved]` from the decompilation of all three, which agrees with their
 * disassembly on the arms below.
 *
 * `game/class41/prop_draw.ts`, `game/carried_prop.ts` and
 * `game/class44/script_flag_effect.ts` each walk a tree for their own pool's
 * record shape; this is the walk as the three routines are, for an owner whose
 * block is the engine's own four words. Class 0x13's carrier selectors 4, 5,
 * 7 and 8 draw through it.
 */
import type { EffectDefJson } from "../bundle";
import type { Rng } from "../core/rng";
import { EffectSampleNode, type EffectNodePose }
  from "./class44/script_flag_effect";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale, MatrixTranslate,
  type Mat,
} from "./matrix";
import { T } from "./tables";

/**
 * The four words `EffectDrawUnlit` is handed a pointer to, as the owner keeps
 * them: `+0x00` the effect id, `+0x04` the motion, `+0x08` the play frame and
 * `+0x0C` the frame the last draw was made at.
 */
export interface EffectState {
  effect: number;
  motion: number;
  frame: number;
  prev: number;
}

/** One `AssetDrawSlot` the walk made, under the matrix it made it with. */
export interface EffectDraw {
  slot: number;
  m: Mat;
}

/**
 * `[port-only]` -- the tree and the baked clip for one effect id and one
 * motion, out of the bundle's `breakables.effects`. The engine reads the two
 * from separate tables; the bundle ships them paired, keyed by the effect id
 * when a stage's owners give that id one motion and by `"<effect>@<motion>"`
 * when an owner switches its block between two -- class 0x13's carriers,
 * whose blocks play motion `0x1CC` and then `0x1CD`, or the reverse.
 */
export function EffectDefFor(effect: number, motion: number):
    EffectDefJson | null {
  const all = T.breakables?.effects;
  if (!all) return null;
  const paired = all[`${effect}@${motion}`];
  if (paired) return paired;
  const byId = all[String(effect)];
  return byId && byId.motion === motion ? byId : null;
}

/** `EffectDrawNode`'s smoke puff: the one slot the walk rescales at random. */
const EFFECT_SMOKE_PUFF_SLOT = 0x10ce;
/**
 * `rand() % 11`, `FMUL float [0x004D5464]`, `FADD float [0x004D5460]`, and an
 * `FSTP` to a float: `0.01f` and `0.27f`, the sum stored single.
 */
const EFFECT_SMOKE_PUFF_SPREAD = 11;
const EFFECT_SMOKE_PUFF_STEP = Math.fround(0.01);
const EFFECT_SMOKE_PUFF_BASE = Math.fround(0.27);

/**
 * `EffectDrawUnlit` — `FUN_0040DD90`.
 *
 * ```c
 * DAT_007c1788 = 0;           // unlit: AssetDrawSlot, not the light array
 * DAT_007c1784 = state;
 * DAT_007c1789 = 0xFF;        // capture bone: none (signed, below 1)
 * DAT_007c178c = -1;          // slot override: none
 * DAT_007c1780 = 1.0f;        // scale: 1, which the node draw skips
 * EffectDrawTree();
 * ```
 *
 * *base* is the matrix the caller left on the stack's top; the draws are
 * appended to *out*.
 */
export function EffectDrawUnlit(state: EffectState, base: Mat,
                                out: EffectDraw[], rng: Rng): void {
  EffectDrawTree(state, base, out, rng);
}

/**
 * `EffectDrawTree` — `FUN_0040DDC0`.
 *
 * ```c
 * tree = g_effect_trees[state->effect];
 * if (g_motion_play_length[state->motion] - 1 <= state->frame) state->frame = 0;
 * if (state->frame < 0) state->frame = g_motion_play_length[state->motion] - 2;
 * for each of tree's children: EffectDrawNode(child);
 * state->prev = state->frame;
 * ```
 *
 * `[port-only]` the early return: an id the bundle did not ship has no tree
 * to walk, where the engine's table always has one.
 */
function EffectDrawTree(state: EffectState, base: Mat, out: EffectDraw[],
                        rng: Rng): void {
  const def = EffectDefFor(state.effect, state.motion);
  if (!def) return;
  if (def.play_length - 1 <= state.frame) state.frame = 0;
  if (state.frame < 0) state.frame = def.play_length - 2;
  for (const c of def.nodes[0]?.children ?? []) {
    EffectDrawNode(state, def, c, base, out, rng);
  }
  state.prev = state.frame;
}

/**
 * `EffectDrawNode` — `FUN_0040DE50`, in `EffectDrawUnlit`'s arm.
 *
 * ```c
 * MatrixStackPush(0);
 * if (node->bone >= 1) {
 *     EffectPoseNode(state, node);          // T; RotZ; RotY; RotX
 *     if (node->slot == 0x10CE) { s = rand() % 11 * 0.01 + 0.27; MatrixScale(s, s, s); }
 *     AssetDrawSlot(node->slot);            // no override, unlit
 * }
 * for each child: EffectDrawNode(child);
 * MatrixStackPop(1);
 * ```
 *
 * The push duplicates the top, so a child composes on its parent's pose. The
 * capture arm (`MatrixStore` at the capture bone) and the `NoOpStub(scale)`
 * calls are not reached from `EffectDrawUnlit`.
 */
function EffectDrawNode(state: EffectState, def: EffectDefJson, i: number,
                        parent: Mat, out: EffectDraw[], rng: Rng): void {
  const node = def.nodes[i];
  if (!node) return;
  const m = parent.slice(0, 16);
  if (node.bone >= 1) {
    // `EffectPoseNode` (`FUN_0040D9D0`): the node's key, or half way between
    // two, as `T; RotZ; RotY; RotX`.
    const pose: EffectNodePose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
    if (def.frames
        && EffectSampleNode(def, i, state.frame, state.prev, pose)) {
      MatrixTranslate(m, pose.x, pose.y, pose.z);
      MatrixRotateZ(m, pose.roll);
      MatrixRotateY(m, pose.yaw);
      MatrixRotateX(m, pose.pitch);
    }
    if (node.slot === EFFECT_SMOKE_PUFF_SLOT) {
      const s = Math.fround(rng.int(EFFECT_SMOKE_PUFF_SPREAD)
                            * EFFECT_SMOKE_PUFF_STEP + EFFECT_SMOKE_PUFF_BASE);
      MatrixScale(m, s, s, s);
    }
    out.push({ slot: node.slot, m: m.slice(0, 16) });
  }
  for (const c of node.children) EffectDrawNode(state, def, c, m, out, rng);
}

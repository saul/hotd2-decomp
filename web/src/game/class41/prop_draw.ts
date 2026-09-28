/**
 * The draw half of a transcribed class-0x41 routine, recorded where the
 * routine makes it.
 *
 * Every one of these routines interleaves its drawing with its state: it
 * pushes a matrix, translates and rotates by fields it may have just changed,
 * calls `AssetDrawSlot`, pops, and very often changes the field again
 * afterwards. `FUN_004668A0` draws its slot and *then* increments it; the
 * sweeps draw before they swing. A renderer that poses from the fields after
 * the whole frame has run shows every one of those one step along, and a
 * renderer that re-derives the draw from the fields has to re-implement the
 * routine's conditions beside it — which is two copies of one routine, the
 * shape `L16` is about.
 *
 * So the draw is transcribed **with** the routine. The routine builds its
 * matrices with `game/matrix.ts`, which is the engine's own matrix stack one
 * matrix at a time, and each `AssetDrawSlot` it makes lands in
 * {@link BreakableProp.draws} with the matrix it was made under.
 * `render/breakables.ts` clones the slot and sets the matrix, and decides
 * nothing.
 *
 * **The matrices start from the identity**, where the engine's stack starts
 * from the camera's world-to-view: what is recorded is the model's world
 * matrix, which is what three.js wants and is the engine's view-space matrix
 * with the camera taken back off.
 *
 * `[port-only]` as a *file*: the engine has no recording, it draws. Everything
 * here stands for one engine routine, named on each function.
 */
import type { Rng } from "../../core/rng";
import type { EffectDefJson } from "../../bundle";
import { T } from "../tables";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
  MatrixTranslate, type Mat,
} from "../matrix";
import { EffectSampleNode, type EffectNodePose }
  from "../class44/script_flag_effect";
import type { BreakableProp } from "./prop_state";

/**
 * `[port-only]` The head of a routine that records its draws: nothing drawn
 * yet this frame. A routine that returns before its first `AssetDrawSlot`
 * therefore draws nothing on that frame, which is what the engine does.
 */
export function PropDrawBegin(p: BreakableProp): void {
  p.draws = [];
}

/**
 * `MatrixStackPush(0)` (`FUN_004A9880`) — duplicate the top.
 *
 * With no argument this is the push a routine opens its draw with, which
 * duplicates the camera's view in the engine and is the identity here (see
 * the file comment). With one it is a push inside a draw, which duplicates
 * whatever the routine has composed so far.
 *
 * `[port-only]` as a *signature*: the engine's stack is a global and the pop
 * throws the top away; here the copy is the caller's, and a pop is simply not
 * using it any more.
 */
export function PropMatrixPush(m?: Mat): Mat {
  return m ? m.slice(0, 16) : MatIdentity();
}

/**
 * `AssetDrawSlot` (`FUN_00418560`), and its lit twin
 * `SubmitSlotWithSceneLightArray` (`FUN_004185E0`), which draws the same slot
 * under the scene's light array: the model is `slot`, under `m`.
 *
 * `(s16)` on the way in, which is how every caller loads it (`MOVSX`). Slot 0
 * is not recorded: `AssetDrawSlot(0)` calls `NoOpStub(1.0f)` and returns
 * having drawn nothing.
 */
export function PropDrawSlot(p: BreakableProp, m: Mat, slot: number): void {
  const s = (slot << 16) >> 16;
  if (s === 0) return;
  (p.draws ??= []).push({ slot: s, m: m.slice(0, 16) });
}

/**
 * `MatrixTranslate; MatrixRotateZ; MatrixRotateY; MatrixRotateX` — the four
 * calls most of these routines open their draw with, in the order they make
 * them. `[port-only]` as a function; the order is the routine's and a routine
 * that composes a different one writes its own calls out.
 */
export function PropMatrixTRzRyRx(m: Mat, x: number, y: number, z: number,
                                  pitch: number, yaw: number,
                                  roll: number): void {
  MatrixTranslate(m, x, y, z);
  MatrixRotateZ(m, roll);
  MatrixRotateY(m, yaw);
  MatrixRotateX(m, pitch);
}

/**
 * `EffectDrawUnlit` (`FUN_0040DD90`) → `EffectDrawTree` (`FUN_0040DDC0`) →
 * `EffectDrawNode` (`FUN_0040DE50`), for the four-word state block at
 * `obj+0x324`: `{effect, motion, frame, prev frame}`, which the prop carries
 * as `effect`, `effectVariant`, `effectFrames` and `effectPrevFrame`.
 *
 * ```c
 * EffectDrawTree:
 *   if (g_motion_play_length[motion] - 1 <= frame) frame = 0;
 *   if (frame < 0) frame = g_motion_play_length[motion] - 2;
 *   for each child of g_effect_trees[effect]: EffectDrawNode(child);
 *   prev = frame;
 * EffectDrawNode(node):
 *   MatrixStackPush(0);
 *   if (node->bone >= 1) {
 *     EffectPoseNode(state, node);         // T; Rz; Ry; Rx from the motion
 *     if (node->slot == 0x10CE) MatrixScale(s, s, s),
 *                               s = rand() % 11 * 0.01 + 0.27;
 *     AssetDrawSlot(node->slot);
 *   }
 *   for each child: EffectDrawNode(child);
 *   MatrixStackPop(1);
 * ```
 *
 * **The tree is a hierarchy**: a child is posed on top of its parent's
 * matrix, inside the parent's push. **The draw writes the state block** — the
 * cursor wraps here and the previous frame is stored here — so a routine
 * that draws an effect steps its cursor in two places, its own and this one.
 * **And the draw takes a `rand()`** for every `0x10CE` smoke puff it draws,
 * which is why this takes the game's generator: the engine's draw is inside
 * the game's frame and so is this.
 *
 * `EffectDrawUnlit` sets the four globals `EffectDrawNode` reads to "no slot
 * override, no capture, unlit, scale 1.0", which is the arm transcribed here.
 *
 * The effect's tree and baked clip come from the bundle's
 * `breakables.effects`, keyed by effect id, and the clip must be the one the
 * state block names: a routine that drew one effect id with two motions would
 * need two records, and none of the routines that use this does.
 */
export function PropDrawEffect(p: BreakableProp, m: Mat, rng: Rng): void {
  const def = T.breakables?.effects?.[String(p.effect)];
  if (!def || !def.frames || def.motion !== p.effectVariant) return;
  if (def.play_length - 1 <= p.effectFrames) p.effectFrames = 0;
  if (p.effectFrames < 0) p.effectFrames = def.play_length - 2;
  const root = def.nodes[0];
  const pose: EffectNodePose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  for (const c of root?.children ?? []) {
    PropDrawEffectNode(p, def, c, m, pose, rng);
  }
  p.effectPrevFrame = p.effectFrames;
}

/** `EffectDrawNode`'s smoke puff: the one slot the walk rescales at random. */
export const EFFECT_SMOKE_PUFF_SLOT = 0x10ce;
/** `FMUL [0x004D5464]; FADD [0x004D5460]` — `rand() % 11 * 0.01 + 0.27`. */
const EFFECT_SMOKE_PUFF_SPREAD = 11;
const EFFECT_SMOKE_PUFF_STEP = 0.01;
const EFFECT_SMOKE_PUFF_BASE = 0.27;

/** One node of {@link PropDrawEffect}'s walk, and its children. */
function PropDrawEffectNode(p: BreakableProp, def: EffectDefJson, i: number,
                            parent: Mat, pose: EffectNodePose,
                            rng: Rng): void {
  const node = def.nodes[i];
  if (!node) return;
  const m = PropMatrixPush(parent);
  if (node.bone >= 1
      && EffectSampleNode(def, i, p.effectFrames, p.effectPrevFrame, pose)) {
    PropMatrixTRzRyRx(m, pose.x, pose.y, pose.z, pose.pitch, pose.yaw,
                      pose.roll);
    if (node.slot === EFFECT_SMOKE_PUFF_SLOT) {
      const s = rng.int(EFFECT_SMOKE_PUFF_SPREAD) * EFFECT_SMOKE_PUFF_STEP
        + EFFECT_SMOKE_PUFF_BASE;
      MatrixScale(m, s, s, s);
    }
    PropDrawSlot(p, m, node.slot);
  }
  for (const c of node.children) PropDrawEffectNode(p, def, c, m, pose, rng);
}

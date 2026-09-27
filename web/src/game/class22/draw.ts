/**
 * Class 0x22's draw — `Class22DrawAndPoseSubActor` (`FUN_0049D770`) and its
 * per-bone hook, `Class22DrawBonePart` (`FUN_0049D980`).
 *
 * The engine's draw is three things the port has to keep apart. The pose and
 * the triangles are the renderer's. The sampler's two answers — the play
 * cursor at `obj+0x19C` and the done byte at `char+0x5D` — are state the
 * states test the frame after, so the class records them here, at the point
 * the draw call stands (`Class22SampleCursor`). And the sub-actor's clip, its
 * counter and node 2's slot are decisions the draw makes from game state,
 * which are the port's.
 */
import type { Actor, JudgmentActor } from "../actor";
import { ActorSetMotion } from "../class30/motion_cue";
import { ActorByAt, G } from "../globals";
import { ActorAdvanceMotion } from "../motion";
import type { GameHost } from "../host";
import type { ClassFrame } from "../registry";
import type { Vec3 } from "../vec";
import { MotionPlayFrame, MotionPlayLength } from "../tables";
import {
  CLASS22_NODE2_CYCLE_A, CLASS22_NODE2_CYCLE_B, CLASS22_NODE2_SLOT_BASE,
  CLASS22_PATH_SPEED, CLASS22_SUBACTOR_MOTIONS,
} from "./records";
import { Class22Variant, type JudgmentTail } from "./state";

/**
 * Node 2's own slot, `MOV [EDI+0x198], 0x2A9` at `0x0049B162` — `obj+0x32C`,
 * node 2's draw record `+0x00`. `Class22DrawBonePart` draws it whenever
 * `+0x1338` is 0.
 */
export const CLASS22_NODE2_SLOT = 0x2a9;

/**
 * The flight-speed thresholds `Class22DrawAndPoseSubActor` picks the
 * sub-actor's clip by: doubles at `0x00569160` (2.5), `0x0055CAF8` (2.0),
 * `0x0055D7D0` (1.5) and `0x004ECB70` (1.0).
 */
const SUBACTOR_SPEED_STEPS: readonly number[] = [2.5, 2.0, 1.5, 1.0];

/**
 * `[port-only]` — the half of `SkeletonAdvancePlayCursor` (`FUN_004111A0`)
 * that the states read back: `cursor = counter % (play_length + 1)`, and
 * `char+0x5D` raised when the cursor has reached the play length. Called
 * where the engine's `DrawSkinnedModelAndShadow` (`FUN_00411090`) is.
 *
 * During a cross-fade the engine holds the cursor on the fade's start frame
 * and so does `ActorAdvanceMotion`, which holds the port's counter there
 * instead; the answer is the same number either way.
 */
export function Class22SampleCursor(obj: Actor,
                                   t: { cursor: number; done: number }): void {
  t.cursor = MotionPlayFrame(obj);
  t.done = t.cursor >= MotionPlayLength(obj) ? 1 : 0;
}

/**
 * `SkeletonEmitNode`'s (`FUN_004114C0`) tracked bone. **Bone 1**: the routine
 * picks 1 for any character type outside `0..0x14` (`sVar3 = 1`), and the
 * flier is 0x45, its walker 0x44.
 */
const JUDGMENT_TRACKED_BONE = 1;
const _tracked: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * `[port-only]` — the one write `SkeletonEmitNode` (`FUN_004114C0`) leaves on
 * the actor as the draw walks the skeleton: when it emits the tracked node,
 * that node's world translation goes to `obj+0x100..0x108` (through
 * `g_camera_blocks[g_camera_index]`, `0x0041162B`..`0x00411660`).
 *
 * Both classes read the point straight back: class 0x22's phase 1 and class
 * 0x23's collapse carry `obj+0x100` into `obj+0x70` for `RegisterForShotTest`
 * on the lines after their draw, and `ActorRegisterCameraPoint` lifts it. The
 * pose is the renderer's, so the point is the bone as it was last drawn --
 * the same reading `ActorRegisterCameraPoint` itself takes (`camera/track.ts`).
 * With no pose the field keeps what it had, as the engine's does on a frame
 * the tracked node is not emitted.
 */
export function JudgmentEmitTrackedBone(obj: Actor, host: GameHost): void {
  if (!host.boneWorld(obj.at, JUDGMENT_TRACKED_BONE, _tracked)) return;
  obj.lookAt.x = _tracked.x;
  obj.lookAt.y = _tracked.y;
  obj.lookAt.z = _tracked.z;
}

/**
 * `Class22DrawAndPoseSubActor` — `FUN_0049D770`. The flier's draw, and its
 * sub-actor's. **Not an advance**: every caller steps `obj+0x194` itself,
 * after this returns.
 *
 * ```
 * LightsUseSecondarySet(); DrawSkinnedModelAndShadow(obj)
 * push; SetTop(g_camera_blocks); MatrixMultiply(obj+0x2C4)       ; node 1
 * MatrixGetTranslation(&sub+0x40); MatrixToEulerZYX(&sub+0x64..); pop
 * DrawSkinnedModelAndShadow(sub)
 * switch variant: pick sub+0x1350; re-clip on a change; subchar+0 ++
 * LightsRestoreScene()
 * ```
 *
 * **The seat is the renderer's**, and it is exact there: node 1's matrix is
 * the pose the draw has just made, and in the port the pose is made in
 * `render/`. `render/characters/judgment.ts` puts the sub-actor's root on the
 * flier's posed node 1 on the frame it poses the flier, which is the engine's
 * own ordering. Nothing in the game reads the sub-actor's transform: its
 * `obj+0x34` has `0x8000`, which keeps it out of the shot test and the push,
 * and it never registers for the camera. The two lighting calls are
 * `game/light_sets.ts`'s.
 *
 * `[port-only]` — `obj.alpha = 1` on both: the frame's "this was drawn". The
 * engine's actor is invisible on a frame its state returns before the draw;
 * the renderer's only per-frame "not now" is the alpha, so each update clears
 * it and this raises it. Neither class reads or writes `obj+0x138C` itself.
 */
export function Class22DrawAndPoseSubActor(obj: JudgmentActor,
                                           f: ClassFrame): void {
  const t = obj.judgment;
  obj.alpha = 1;
  Class22SampleCursor(obj, t);
  JudgmentEmitTrackedBone(obj, f.host);
  Class22DrawBonePart(obj, t, f.host);

  const sub = ActorByAt(t.subActorAt);
  if (!sub || sub.cls !== obj.cls) return;
  const s = sub.judgment;
  sub.alpha = 1;
  Class22SampleCursor(sub, s);
  switch (t.variant) {
    case Class22Variant.Cameo:
      Class22ReclipSubActor(sub);
      // `if (obj+0x1324) subchar+0++` -- the cutscene holds its wings still
      // until the take-off.
      if (t.hint !== 0) ActorAdvanceMotion(sub, f.dt);
      break;
    case Class22Variant.Stage1:
    case Class22Variant.Stage5:
      // `MOVSX EAX, word ptr [ESI+0x11C]; TEST EAX, EAX; JLE` -- a dead flier's
      // wings stop.
      if (obj.hp > 0) {
        const speed = CLASS22_PATH_SPEED[G.g_damage_rank + 16 * t.hpStage]
          ?? 0;
        let i = SUBACTOR_SPEED_STEPS.length;
        for (let k = 0; k < SUBACTOR_SPEED_STEPS.length; k++) {
          if (speed > SUBACTOR_SPEED_STEPS[k]) { i = k; break; }
        }
        // `> 2.5 ? 4 : > 2.0 ? 3 : > 1.5 ? 2 : > 1.0 ? 1 : 0`.
        s.subClipWanted = SUBACTOR_SPEED_STEPS.length - i;
        Class22ReclipSubActor(sub);
        ActorAdvanceMotion(sub, f.dt);
      }
      break;
    case Class22Variant.Attract:
      ActorAdvanceMotion(sub, f.dt);
      break;
  }
}

/**
 * The re-clip both arms share:
 * `if (sub+0x1354 != sub+0x1350) { ActorSetMotion(subchar,
 * g_class22_subactor_motions[sub+0x1350]); sub+0x1354 = sub+0x1350; }`.
 */
function Class22ReclipSubActor(sub: JudgmentActor): void {
  const s = sub.judgment;
  if (s.subClipShown === s.subClipWanted) return;
  ActorSetMotion(sub, CLASS22_SUBACTOR_MOTIONS[s.subClipWanted] ?? sub.motion);
  s.subClipShown = s.subClipWanted;
}

/**
 * `Class22DrawBonePart` — `FUN_0049D980`, the per-bone hook `Class22Init`
 * installs at `model+0x1158`. The node-2 arm, which is the part that is a
 * decision:
 *
 * ```
 * if (node == 2) {
 *     a+0x133C++;
 *     slot = a+0x1338 == 1 ? 0x2A5 + g_class22_node2_cycle_a[a+0x133C % 10]
 *          : a+0x1338 == 2 ? 0x2A5 + g_class22_node2_cycle_b[a+0x133C % 6]
 *          : rec[0];
 * }
 * ```
 *
 * The port's per-bone slot override (`Actor.boneSlot`) is the draw record
 * the renderer draws node 2 from, so the choice goes there each drawn frame.
 * The counter steps once per draw, which is once per frame the flier is drawn
 * and not otherwise.
 *
 * The node-1 arm -- slots 0x2B5 and 0x2B4 drawn at `(-0.778, 1.49, 0)` and
 * `(+0.778, 1.49, 0)` under rotations taken from node 3's and node 6's pose --
 * is the renderer's alone; see `render/characters/judgment.ts`.
 */
export function Class22DrawBonePart(obj: JudgmentActor, t: JudgmentTail,
                                    host: ClassFrame["host"]): void {
  t.node2Count += 1;
  let slot = CLASS22_NODE2_SLOT;
  if (t.node2Mode === 1) {
    slot = CLASS22_NODE2_SLOT_BASE
      + CLASS22_NODE2_CYCLE_A[t.node2Count % CLASS22_NODE2_CYCLE_A.length];
  } else if (t.node2Mode === 2) {
    slot = CLASS22_NODE2_SLOT_BASE
      + CLASS22_NODE2_CYCLE_B[t.node2Count % CLASS22_NODE2_CYCLE_B.length];
  }
  // The record the renderer draws node 2 from, and the swap itself when it
  // changes -- `setBoneSlot` is how the port's per-bone draw record reaches
  // the pose, as `ActorSwapDamagedPart`'s does.
  if (obj.boneSlot["2"] !== slot) {
    obj.boneSlot["2"] = slot;
    host.setBoneSlot(obj.at, 2, slot);
  }
}

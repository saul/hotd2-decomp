/**
 * Class 0x41 type 27 — a piece of stage 2's scenery that bursts on a script
 * flag, and is gone the moment the route goes one way.
 *
 * Two shipped spawns, both stage 2 block 22 step 6 op 3 (evts `0xFDC8` and
 * `0xFDF0`), side by side at `(-591, -13.7, -1261.3)` and
 * `(-581.4, -13.7, -1261.3)` with a four-step lifetime. Block 23 step 3 op 21
 * raises `g_script_flags[0x61]`.
 *
 * What it is, from the assets: whole it is `0x17A9` = `komono_1.bin[114]`,
 * and its effect — 7 on motion `0x1D5`, the same pair
 * `g_prop_kind_params` gives class 0x41's kind 2 — is 38 more pieces of
 * `komono_1.bin` (*komono*, small articles). `[open]` beyond "a small object
 * that flies apart".
 *
 * ## The whole routine, `0x00469E60`..`0x00469F45`
 *
 * ```c
 * PropExpireByStepLifetime(obj);                      // ActorDespawn never returns
 * if ((s16)g_script_branch_var == 1) { ActorKill(); return; }
 * if (g_script_flags[0x61] == 1) {
 *     if (obj->+0x32C >= g_motion_play_length[obj->+0x328] - 2) goto effect;
 *     obj->+0x32C++;
 * }
 * if (g_script_flags[0x61] == 0) {
 *     Push; Translate(x, y, z); RotY(obj->+0x68);
 *     SubmitSlotWithSceneLightArray(0x17A9); Pop; return;
 * }
 * effect:
 * if ((s16)g_motion_slots[obj->+0x328].state == 2) {
 *     Push; Translate(x, y, z); RotY(obj->+0x68);
 *     EffectDrawSceneLit(obj + 0x324); Pop;
 * }
 * ```
 *
 * `[proved]` from the listing; both draw arms end at their `MatrixStackPop`
 * and a `RET`, so the pseudocode is whole. What it leaves implicit:
 *
 * * `PropExpireByStepLifetime` (`FUN_00466640`)'s result is not tested, and
 *   need not be: its despawn is `ActorDespawn` (`FUN_00409CC0`), which ends in
 *   `ActorKill` (`FUN_004A7040`) and never returns. So a retired prop stops
 *   there, and the scene-1 sweep on `g_script_flags[0x77]` applies — stage 2
 *   is scene 1.
 * * **The route test is `== 1` on a word**, `CMP word [0x009C88A4],0x1`, and
 *   it is `ActorKill`, not a despawn. The routine only reads the branch var.
 * * **The rotation is `obj+0x68`, which nothing writes.** It is not the
 *   descriptor's yaw — `PlaceGenericProp` (`FUN_00461CF0`) puts that at
 *   `obj+0x1D0` — and `ActorClearGameFields` (`FUN_004A73D0`) zeroed it.
 *   `[proved]` that neither the prologue, this type's arm nor this routine
 *   writes it; `[likely]` that nothing else does, since nothing else is handed
 *   the object. So both draws are unrotated, whatever the descriptor says; the
 *   two shipped spawns carry yaw 0 and would not show the difference.
 * * The clip steps **before** the draw and stops at `play_length - 2`
 *   (`MOVSX EDX,word [ECX*2+0x4E07D0]; SUB EDX,2; CMP EAX,EDX; JGE`), which
 *   for motion `0x1D5` is 72: the effect plays 1..72 and holds on 72. The
 *   tree's wrap at `play_length - 1` is never reached.
 * * A flag value other than 0 and 1 draws the effect without stepping it.
 * * Both draws are **lit**: `SubmitSlotWithSceneLightArray` (`FUN_004185E0`)
 *   and `EffectDrawSceneLit` (`FUN_0040DFA0`), which is `EffectDrawUnlit`'s
 *   walk with `SubmitSlotWithSceneLightArray` for each node, with no test of
 *   `g_scene_lighting` -- recorded so (`PropDrawCall.sceneLit`).
 * * No hit arm, no `RegisterForShotTest` (`FUN_00405160`) and no `AND` on
 *   `obj+0x34`: not shootable.
 *
 * `[port-only]` The residency test on `g_motion_slots` (`0x009A37E0`) is
 * **not modelled**, the answer `ScriptFlagEffectUpdate` (`FUN_00473B90`)
 * gives its own: the bundle bakes the motion, so it is always resident here.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { T } from "../tables";
import { MatrixRotateY, MatrixTranslate } from "../matrix";
import { PropExpireByStepLifetime } from "./lifetime";
import { ActorKillProp } from "./prop";
import {
  PropDrawBegin, PropDrawEffectSceneLit, PropMatrixPush,
  PropSubmitSlotWithSceneLightArray,
} from "./prop_draw";
import type { BreakableProp } from "./prop_state";
import { PropWords } from "./words";

/** `PropKillOnBranchOneUpdate`'s words beyond the shared fields. */
interface Type27Words {
  /**
   * `obj+0x68` — the actor's Y rotation word, which both draws turn by. No
   * writer: zero for the object's whole life.
   */
  o68: number;
}
const TYPE27_WORDS_ZERO: Type27Words = { o68: 0 };

/** `g_script_flags[0x61]` (`0x009C7261`) — burst. Stage 2 block 23 step 3. */
export const SCRIPT_FLAG_TYPE27_BURST = 0x61;
/** `CMP word [0x009C88A4],0x1` — the route that removes it. */
export const TYPE27_KILL_BRANCH = 1;

/** `PUSH 0x17A9` — `komono_1.bin[114]`, drawn while the flag is down. */
export const TYPE27_WHOLE_SLOT = 0x17a9;
/** The arm's state block: effect 7 on motion `0x1D5`. */
export const TYPE27_EFFECT = 7;
export const TYPE27_MOTION = 0x1d5;

/**
 * `PlaceGenericProp` case 0x1B's own arm.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x0046202C`
 * of `PlaceGenericProp`'s switch (entry 13 of `g_place_generic_prop_arms`):
 * `MOV dword [ESI+0x324],0x7; MOV dword [ESI+0x328],0x1d5`, and return.
 */
export function PlaceGenericPropType27(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void pl; void rng;
  p.effect = TYPE27_EFFECT;
  p.effectVariant = TYPE27_MOTION;
}

/**
 * `g_motion_play_length[obj->+0x328]` — `0x004E07D0`, read off the effect
 * record the bundle carries for the state block's effect id, which has to
 * name the same motion.
 *
 * `[port-only]` A bundle without that record gives `undefined`, and the
 * caller lets the cursor run on rather than stop at a length it does not
 * know: nothing draws the effect without the record anyway.
 */
function Type27PlayLength(p: BreakableProp): number | undefined {
  const def = T.breakables?.effects?.[String(p.effect)];
  return def && def.motion === p.effectVariant ? def.play_length : undefined;
}

/**
 * `PropKillOnBranchOneUpdate` — `FUN_00469E60`, `g_class41_updates[27]`.
 *
 * `+0x324`..`+0x330` are the effect state block ({@link BreakableProp.effect},
 * `effectVariant`, `effectFrames`, `effectPrevFrame`) and `+0x19C..+0x1A4`
 * its position.
 */
export function PropKillOnBranchOneUpdate(p: BreakableProp, rng: Rng,
                                          events?: Events): void {
  void events;
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;
  if (G.g_script_branch_var === TYPE27_KILL_BRANCH) {
    ActorKillProp(p);
    return;
  }
  const w = PropWords(p, TYPE27_WORDS_ZERO);
  const flag = G.g_script_flags[SCRIPT_FLAG_TYPE27_BURST] ?? 0;
  let held = false;
  if (flag === 1) {
    const len = Type27PlayLength(p);
    if (len !== undefined && p.effectFrames >= len - 2) held = true;
    else p.effectFrames += 1;
  }
  if (!held && flag === 0) {
    const m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    MatrixRotateY(m, w.o68);
    PropSubmitSlotWithSceneLightArray(p, m, TYPE27_WHOLE_SLOT); // 0x00469EE2
    return;
  }
  // 0x00469EF3. `g_motion_slots[obj+0x328]` resident: always (file comment).
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, w.o68);
  PropDrawEffectSceneLit(p, m, rng);                          // 0x00469F35
}

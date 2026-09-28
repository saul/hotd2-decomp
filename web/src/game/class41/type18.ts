/**
 * Class 0x41 type 18 — a bridge coming down, in stage 2 and again in stage 5.
 *
 * Two shipped spawns. Stage 2 block 37 (`0x25`) step 1 op 35 (evt
 * `0x155F8`) places it at `(229.36, 12.8, -2188)`, and op 68 of the same step
 * raises `g_script_flags[0x5F]`. Stage 5 places evt `0x2370` at
 * `(583.4, -81, -5041.5)` from block 2 step 4 and from block 3 step 0, and
 * block 3 step 1 raises `g_script_flags[0x0B]`.
 *
 * What it is, from the assets: `PlaceGenericProp`'s arm gives it effect 1 in
 * scene 1 and effect `0x19` anywhere else, and those two trees are 28 pieces
 * of `bridge.bin` and 25 of `bridge_st5.bin`. `[likely]` a bridge breaking up,
 * from the file names and nothing else.
 *
 * ## The whole routine, `0x00468E50`..`0x00468EF1`
 *
 * ```c
 * if ((s16)g_motion_slots[0x1D8].state == 2) {        // CMP word [0x009A46A4], 2
 *     Push; Translate(x, y, z); EffectDrawUnlit(obj + 0x324); Pop;
 * }                                                    // no return: falls on
 * if (g_scene_index == 1) { if (g_script_flags[0x5F] != 1) return; }
 * else if (g_scene_index != 4 || g_script_flags[0x0B] == 0) return;
 * if (++obj->+0x32C >= 0x6C) {
 *     if (g_scene_index == 1 && g_evt_block_index != 0x25)
 *         g_script_flags[0x5F] = 0;
 *     ActorKill();
 * }
 * ```
 *
 * **The draw arm does not return**, and the decompilation says it does: the
 * `MatrixStackPop` Ghidra marks no-return is followed by `ADD ESP,0x18` at
 * `0x00468E93` and then the scene test at `0x00468E96`, which is where the
 * `JNZ` past the draw lands too (`L35`, `L53`). Read literally, the pseudocode
 * has a bridge that never collapses whenever its clip is loaded — which is
 * always. So the clip is drawn at cursor `n` and then stepped to `n + 1`, and
 * the tree's own wrap (`EffectDrawTree` (`FUN_0040DDC0`), at
 * `g_motion_play_length[0x1D8] - 1 = 109`) is never reached: the object kills
 * itself when the cursor reaches `0x6C = 108`, having drawn 0..107.
 *
 * * Its position is read, its three orientation words are not: the draw is
 *   one `MatrixTranslate` and the effect's own motion.
 * * The scene tests are `CMP word [0x009A1A08]` against 1 and 4, and the
 *   flags are a byte `== 1` (`0x009C725F`) and a byte non-zero
 *   (`0x009C720B`). In any other scene the clip holds on its first frame for
 *   ever.
 * * Until its flag goes up it still draws, frame 0 of the clip: the bridge
 *   standing.
 * * No lifetime prologue at all, no hit arm, no `RegisterForShotTest`
 *   (`FUN_00405160`) and no `AND` on `obj+0x34`. The only way out is the end
 *   of the clip.
 *
 * `[port-only]` The residency test on `g_motion_slots` (`0x009A37E0`;
 * `0x009A37E4 + 8 * 0x1D8` is `0x009A46A4`) is **not modelled**, the answer
 * `ScriptFlagEffectUpdate` (`FUN_00473B90`) gives its own: the bundle bakes
 * the motion, so it is always resident here.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { MatrixTranslate } from "../matrix";
import { ActorKillProp } from "./prop";
import { PropDrawBegin, PropDrawEffect, PropMatrixPush } from "./prop_draw";
import type { BreakableProp } from "./prop_state";

/** `g_scene_index` values the routine gates on: stage 2 and stage 5. */
export enum Type18Scene {
  Stage2 = 1,
  Stage5 = 4,
}

/** `g_script_flags[0x5F]` (`0x009C725F`) — collapse, in scene 1. */
export const SCRIPT_FLAG_TYPE18_STAGE2 = 0x5f;
/** `g_script_flags[0x0B]` (`0x009C720B`) — collapse, in scene 4. */
export const SCRIPT_FLAG_TYPE18_STAGE5 = 0x0b;
/**
 * `CMP word [0x009A2BC0],0x25` — the block in which the end of the collapse
 * leaves flag 0x5F up. Stage 2 places the prop in this block.
 */
export const TYPE18_KEEP_FLAG_BLOCK = 0x25;
/** `CMP EAX,0x6C; JL` — the cursor value that kills it. */
export const TYPE18_END_FRAME = 0x6c;

/** The arm's effect ids: `EDI` (1, the prologue's) in scene 1, else `0x19`. */
export const TYPE18_EFFECT_STAGE2 = 1;
export const TYPE18_EFFECT_OTHER = 0x19;
/** `MOV [ESI+0x328],0x1D8` in both halves of the arm. */
export const TYPE18_MOTION = 0x1d8;

/**
 * `PlaceGenericProp` case 0x12's own arm.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00461F6C`
 * of `PlaceGenericProp`'s switch (entry 9 of `g_place_generic_prop_arms`):
 *
 * ```
 * 00461F6C  CMP word [0x009a1a08],DI      ; EDI = 1 since 0x00461D1B
 * 00461F73  JNZ 0x00461f8a
 * 00461F75  MOV [ESI+0x324],EDI           ; effect 1
 * 00461F7B  MOV dword [ESI+0x328],0x1d8   ; ...and return
 * 00461F8A  MOV dword [ESI+0x324],0x19
 * 00461F94  MOV dword [ESI+0x328],0x1d8   ; ...and return
 * ```
 */
export function PlaceGenericPropType18(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void pl; void rng;
  p.effect = G.g_scene_index === Type18Scene.Stage2
    ? TYPE18_EFFECT_STAGE2 : TYPE18_EFFECT_OTHER;
  p.effectVariant = TYPE18_MOTION;
}

/**
 * `PropUpdateType18` — `FUN_00468E50`. One bridge, one 60 Hz frame.
 *
 * `+0x324`..`+0x330` are the effect state block ({@link BreakableProp.effect},
 * `effectVariant`, `effectFrames`, `effectPrevFrame`) and `+0x19C..+0x1A4`
 * its position.
 *
 * The frame that kills it has drawn cursor 107 before the `ActorKill`, and
 * the engine shows that draw: it was queued before the object went. The pool
 * keeps it for the renderer in `g_prop_final_draws`.
 */
export function PropUpdateType18(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  void events;
  PropDrawBegin(p);
  // `g_motion_slots[0x1D8]` resident: always, in the port (file comment).
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  PropDrawEffect(p, m, rng);
  // 0x00468E96: the draw arm falls through to here.
  if (G.g_scene_index === Type18Scene.Stage2) {
    if ((G.g_script_flags[SCRIPT_FLAG_TYPE18_STAGE2] ?? 0) !== 1) return;
  } else {
    if (G.g_scene_index !== Type18Scene.Stage5) return;
    if ((G.g_script_flags[SCRIPT_FLAG_TYPE18_STAGE5] ?? 0) === 0) return;
  }
  p.effectFrames += 1;
  if (p.effectFrames >= TYPE18_END_FRAME) {
    if (G.g_scene_index === Type18Scene.Stage2
        && G.g_evt_block_index !== TYPE18_KEEP_FLAG_BLOCK) {
      G.g_script_flags[SCRIPT_FLAG_TYPE18_STAGE2] = 0;
    }
    ActorKillProp(p);
  }
}

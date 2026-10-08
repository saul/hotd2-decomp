/**
 * The result card's figures: the civilians the player rescued in the scene,
 * standing where the card's list puts them while the camera flies past.
 *
 * `ResultCardInstall`'s sub 0 allocates one task per figure with no class id
 * -- `ActorAlloc(ResultCardFigureInit, 0x13F4)` -- which the port files
 * under class 0x61 (`state.ts`, {@link ResultCardRoutine}). Three routines:
 *
 * * `ResultCardFigureInit` (`FUN_004356A0`): the model, a random phase, the
 *   node hook, out of the shot test, the type's hair or hat, and the one
 *   figure type whose clips stand it 2.4 lower. Then the update, once.
 * * `ResultCardFigureUpdate` (`FUN_00435760`): figure 0, when the card's
 *   life bonus is above 0, changes to clip `0x180` at camera frame `0x104`
 *   and freezes on it; then the draw under light block 1, and the counter.
 * * `ResultCardFigureDrawNode` (`FUN_004357F0`), the node hook: the node, and
 *   for figure 0 on bone 5 through cursor `0x1E..0x57` of clip `0x180`,
 *   `common.bin[199]` held up -- the only thing on the card that shows the
 *   life being given.
 *
 * A figure never kills itself. It lasts until the scene's task list goes.
 */
import type { Actor, ResultCardActor } from "../actor";
import { ActorFlag } from "../actor";
import { ActorBindPartList } from "../attachments";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { GameMode } from "../game_mode";
import { G, HIT_SLOT_NONE } from "../globals";
import { ActorRunNodeDrawHooks } from "../model_draw";
import { DrawSkinnedModelAndShadow } from "../skeleton";
import { ActorAdvanceMotion } from "../motion";
import type { ClassFrame } from "../registry";
import { ActorBuildSkinnedModel } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { MotionPlayFrame } from "../tables";
import { ResultFigureAttachmentsOf } from "./rdata";
import {
  RESULT_FIGURE_LIFE_BONE, RESULT_FIGURE_LIFE_MOTION,
  RESULT_FIGURE_PART_SCALE, ResultCardRoutine,
} from "./state";

/** `CMP word ptr [ESI + 0x60], 0x20` at `0x0043571B`: the one type lowered. */
const LOWERED_TYPE = 0x20;
/** ...on these clips: `CMP ESI, 0x17c; JL`, `CMP ESI, 0x17d; JLE`, `0x17f`. */
const LOWERED_FROM = 0x17c;
const LOWERED_TO = 0x17d;
const LOWERED_ALSO = 0x17f;
/** ...by `FSUB [0x0055E174]`, 2.4. */
const LOWERED_BY = Math.fround(2.4);

/** `CMP dword ptr [0x009a6110], 0x104` at `0x0043578A`: camera frame 260. */
export const RESULT_FIGURE_LIFE_CAM_FRAME = 0x104;
/** `PUSH 0x14` at `0x00435796`: the fade into the life clip. */
const LIFE_FADE = 0x14;
/** `CMP dword ptr [EDI + 0x8], 0x80` at `0x004357B1`: where it freezes. */
export const RESULT_FIGURE_LIFE_FREEZE_CURSOR = 0x80;
/** `CMP EAX, 0x1e; JL` / `CMP EAX, 0x57; JG` at `0x004358B5`: held up. */
export const RESULT_FIGURE_LIFE_SHOWN_FROM = 0x1e;
export const RESULT_FIGURE_LIFE_SHOWN_TO = 0x57;


/**
 * `ResultCardFigureInit` — `FUN_004356A0`. The figure's first update, run by
 * the task walk the frame the card allocated it.
 *
 * ```
 * g_cur_actor = obj; obj+0x3C = -1; obj+0x120 = -1
 * ActorBuildSkinnedModel(model, pos, recs)   ; type +0x1F4, clip +0x1B4
 * model+0x68 = 1                             ; rotation order
 * model+0 = rand()                           ; the counter: a random phase
 * model+0x1158 = ResultCardFigureDrawNode
 * obj+0x34 |= 0x8000
 * if (g_result_figure_attachments[type - 0x20][0] != -1)
 *     model+0x1170 = that list; ActorBindPartList(model)
 * if (type == 0x20 && clip in 0x17C..0x17D or 0x17F) pos.y -= 2.4
 * ResultCardFigureUpdate(obj); obj+0x00 = ResultCardFigureUpdate
 * ```
 *
 * The rotation order is not carried: pitch and roll are
 * `ActorClearGameFields`' zero and nothing writes them, and a lone yaw draws
 * the same in every order. The node hook is not a stored pointer either: the
 * update calls it where the draw would. `[proved]`
 */
export function ResultCardFigureInit(obj: ResultCardActor, f: ClassFrame): void {
  G.g_cur_actor = obj.at;
  obj.hitSlot = HIT_SLOT_NONE;
  obj.cameraSlot = -1;
  ActorBuildSkinnedModel(obj);
  obj.playTicks = f.rng.int(0x8000);
  obj.flags |= ActorFlag.NoShotTest;
  const list = ResultFigureAttachmentsOf(obj.charType);
  if (list.first !== null && list.first !== -1) {
    obj.attachments = list.list;
    ActorBindPartList(obj);
  }
  if (obj.charType === LOWERED_TYPE
      && ((obj.motion >= LOWERED_FROM && obj.motion <= LOWERED_TO)
          || obj.motion === LOWERED_ALSO)) {
    obj.pos.y = Math.fround(obj.pos.y - LOWERED_BY);
  }
  ResultCardFigureUpdate(obj, f);
  obj.card.routine = ResultCardRoutine.FigureUpdate;
}

/**
 * `ResultCardFigureUpdate` — `FUN_00435760`. Every frame after the init.
 *
 * ```
 * g_cur_actor = obj
 * if (obj+0x131B == 0 && obj+0x1350) {
 *     if (g_cam_path_frame == 0x104) ActorSetMotionBlended(model, 0x180, 0, 0x14)
 *     if (model+0x20 == 0x180 && model+0x08 == 0x80) obj+0x1324 = 1
 * }
 * LightsUseSecondarySet(); DrawSkinnedModelAndShadow(model, pos, recs);
 * LightsRestoreScene()
 * if (obj+0x1324 == 0) model+0 += 1
 * ```
 *
 * `model+0x08` is the cursor **the last draw computed** from the counter, a
 * frame behind the counter the port steps (L62), which is why the test reads
 * the figure's own {@link ResultCardTail.cursor} rather than the counter.
 * The draw is the renderer's, under light block 1 (`game/light_sets.ts`);
 * what of it is state -- the cursor it samples and the node hook -- is here.
 * `[proved]`
 */
export function ResultCardFigureUpdate(obj: ResultCardActor,
                                       f: ClassFrame): void {
  G.g_cur_actor = obj.at;
  if (obj.card.figureIndex === 0 && obj.card.lifeBonus !== 0) {
    if (G.g_cam_path_frame === RESULT_FIGURE_LIFE_CAM_FRAME) {
      ActorSetMotionBlended(obj, RESULT_FIGURE_LIFE_MOTION, 0, LIFE_FADE);
    }
    if (obj.motion === RESULT_FIGURE_LIFE_MOTION
        && obj.card.cursor === RESULT_FIGURE_LIFE_FREEZE_CURSOR) {
      obj.frozen = 1;
    }
  }
  // `DrawSkinnedModelAndShadow` (`FUN_00411090`): the sampler writes
  // `model+0x08` from the counter, then the walk calls the node hook.
  obj.card.cursor = MotionPlayFrame(obj);
  obj.card.holdsLife = false;
  obj.card.partScale = false;
  ActorRunNodeDrawHooks(obj, ResultCardFigureDrawNode, f);
  DrawSkinnedModelAndShadow(obj);
  // `INC dword ptr [EDI]` at `0x004357E6`, unless `obj+0x1324`.
  if (obj.frozen === 0) ActorAdvanceMotion(obj, f.dt);
}

/**
 * `ResultCardFigureDrawNode` — `FUN_004357F0`, the figures' node hook
 * (`model+0x1158`), once per node the walk draws.
 *
 * ```
 * Push
 * if (g_GameMode == 1 && g_original_item_part_scale == 1 && bone in 2..15)
 *     MatrixScale by RESULT_FIGURE_PART_SCALE[bone]
 * AssetDrawSlot(record slot); Pop
 * if (g_cur_actor+0x131B == 0 && bone == 5 && g_cur_actor+0x1B4 == 0x180
 *     && 0x1E <= g_cur_actor+0x19C <= 0x57) {
 *     Push; Translate(1, -1, 0); RotX(0x4000); RotZ(0); RotY(0)
 *     AssetDrawSlot(0x10C3); Pop
 * }
 * ```
 *
 * The node's own draw is the renderer's; what the hook decides is recorded
 * on the figure -- whether it took the scale arm this frame
 * ({@link ResultCardTail.partScale}) and whether it drew the life
 * ({@link ResultCardTail.holdsLife}) -- and `render/` draws from those. The
 * figure-0 test reads `obj+0x131B` and not `obj+0x1350`: a no-rescue figure 0
 * on clip `0x180` would draw it too, and none is ever on it. `[proved]`
 */
export function ResultCardFigureDrawNode(obj: Actor, bone: number,
                                         _slot: number, _f: ClassFrame): void {
  if (obj.cls !== SpawnClass.ResultCard) return;
  if (G.g_GameMode === GameMode.Original
      && G.g_original_item_part_scale === 1
      && RESULT_FIGURE_PART_SCALE[bone] !== undefined) {
    obj.card.partScale = true;
  }
  if (obj.card.figureIndex === 0 && bone === RESULT_FIGURE_LIFE_BONE
      && obj.motion === RESULT_FIGURE_LIFE_MOTION
      && obj.card.cursor >= RESULT_FIGURE_LIFE_SHOWN_FROM
      && obj.card.cursor <= RESULT_FIGURE_LIFE_SHOWN_TO) {
    obj.card.holdsLife = true;
  }
}

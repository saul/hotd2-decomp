/**
 * Class 0x29 -- **a batch of floor decals**, drawn until a camera cue.
 *
 * The routine at `0x00432C80` is the class's whole handler: the
 * pair `{0x29, 0x00432C80}` in `g_class_handlers`' source table at
 * `0x00593400`, and no `Init` rewrites `obj+0x00`, so the routine runs from
 * the object's first walk. It draws one of three fixed lists of
 * `{slot, x, y, z, yaw, scale}` records, every one of them slot `0x93C` or
 * `0x93D`, and kills itself once the camera path the descriptor names reaches
 * the frame it names.
 *
 * Three shipped spawns, all `spawn_obj` (0x0B) at the origin: stage 1 block 3
 * step 3 (list 0, until path 41 frame 660), stage 1 block 8 step 3 (list 1,
 * until path 44 frame 770) and stage 2 block 11 step 5 (list 2, until path 70
 * frame 745) -- the last the trail of blood beside the dead `hito_mario` the
 * same instruction places. `[likely]` blood, from where each list lies and
 * what lies beside it; the slots are `common.bin`'s.
 *
 * Before this module the port had no handler for the class, so
 * `SpawnSlotActor` built nothing and no list anywhere said so (`L83`).
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import {
  MatIdentity, MatrixRotateY, MatrixScale, MatrixTranslate,
} from "../matrix";
import { registerClass, type ActorDebug, type ClassHandler } from "../registry";
import { SpawnClass } from "../spawn_class";
import { DrawSlotInWorld } from "../view_slot";

/** One record of a list: `{i32 slot; f32 x, y, z; i32 yaw; f32 scale}`. */
export type SceneryBatchRecord = readonly [
  slot: number, x: number, y: number, z: number, yaw: number, scale: number];

/**
 * `g_class29_list0` -- `0x00589AF0`, nine records and the `-1` that ends
 * them. Stage 1 block 3's. Read out of the image; `web/tools/checks/
 * prop_tables.ts` compares every word.
 */
const LIST0: readonly SceneryBatchRecord[] = [
  [0x93c, -36.0, -9.76, -527.6, 0x0000, 3.0],
  [0x93c, -43.1, -9.76, -523.1, 0x4000, 2.0],
  [0x93d, -52.5, -9.76, -524.5, 0x8000, 3.0],
  [0x93c, -54.2, -9.76, -528.2, 0xc000, 3.0],
  [0x93c, -60.3, -9.76, -525.5, 0x6000, 3.0],
  [0x93c, -66.0, -9.76, -529.0, 0x2000, 1.0],
  [0x93c, -76.0, -9.76, -526.4, 0x8000, 3.0],
  [0x93d, -92.0, -9.76, -524.0, 0x0000, 2.0],
  [0x93c, -101.0, -9.76, -526.1, 0xc000, 3.0],
];

/** `g_class29_list1` -- `0x00589BE0`, six records. Stage 1 block 8's. */
const LIST1: readonly SceneryBatchRecord[] = [
  [0x93d, -202.8, -9.76, -530.6, 0x3000, 3.0],
  [0x93c, -206.1, -9.76, -526.6, 0xc000, 3.0],
  [0x93c, -211.4, -9.76, -529.3, 0x0000, 2.0],
  [0x93d, -216.5, -9.76, -526.2, 0x6000, 3.0],
  [0x93c, -223.2, -6.98, -527.2, 0xb000, 3.0],
  [0x93c, -226.0, -4.77, -532.2, 0x8000, 2.0],
];

/** `g_class29_list2` -- `0x00589C88`, nine records. Stage 2 block 11's. */
const LIST2: readonly SceneryBatchRecord[] = [
  [0x93c, -832.9, -6.75, -924.3, 0x0000, 2.0],
  [0x93c, -836.0, -6.75, -922.6, 0x2000, 3.0],
  [0x93d, -838.9, -6.75, -918.5, 0xb000, 2.0],
  [0x93c, -842.0, -6.75, -916.6, 0xc000, 1.0],
  [0x93c, -844.7, -6.75, -914.8, 0x9000, 3.0],
  [0x93c, -846.2, -6.75, -909.7, 0xf000, 2.0],
  [0x93c, -848.5, -6.75, -908.6, 0x3000, 1.0],
  [0x93d, -851.8, -6.75, -906.6, 0x3000, 3.0],
  [0x93c, -852.0, -6.75, -902.2, 0xa000, 1.0],
];

/**
 * The three lists in `obj+0x11C`'s order: `MOV ESI,0x589af0` for 0 at
 * `0x00432CCB`, `0x589be0` for 1 at `0x00432CC4`, `0x589c88` for 2 at
 * `0x00432CBD`. The floats are `f32`s, rounded here so the port draws the
 * value the image holds and not the decimal that names it.
 */
export const CLASS29_LISTS: readonly (readonly SceneryBatchRecord[])[] =
  [LIST0, LIST1, LIST2].map((l) => l.map(([s, x, y, z, ry, k]) =>
    [s, Math.fround(x), Math.fround(y), Math.fround(z), ry,
     Math.fround(k)] as SceneryBatchRecord));

/** The list addresses, for the check that reads them back out of the image. */
export const CLASS29_LIST_VA: readonly number[] =
  [0x00589af0, 0x00589be0, 0x00589c88];

/**
 * `ActorKill` (`FUN_004A7040`) as this class takes it -- a `CALL` straight to
 * the unlink, no `ActorDespawn`, and no hit slot to give back because the
 * class never claims one. `[port-only]` as a name, the same shape and reason
 * as `PathRidingPropKill` in `class28/index.ts`.
 */
function SceneryBatchKill(obj: Actor): void {
  obj.despawned = true;
  obj.visible = false;
}

/**
 * `SceneryBatchUpdate29` -- `FUN_00432C80`. One frame of the batch.
 *
 * ```
 * 00432C85  MOV ESI,[0x009a2d78]; MOV EAX,[ECX+0x1390]  ; g_active_cam_path, tail
 * 00432C94  CMP ESI,(s16)[EAX]; JNZ draw
 * 00432C9C  CMP [0x009a6110],(s16)[EAX+2]; JL draw       ; g_cam_path_frame
 * 00432CA4  CALL ActorKill
 * 00432CAB  switch ((s16)obj+0x11C) { 0, 1, 2: the list; default: ESI = obj }
 * 00432CD6  while (*list != -1) {
 *             Push; Translate(+4, +8, +0xC); RotY(+0x10);
 *             Scale(+0x14 x3); NoOpStub(+0x14); AssetDrawSlot(*list); Pop;
 *             list += 0x18; }
 * ```
 *
 * [diverges] The default arm: a selector outside 0..2 loads `ESI` with the
 * object's own address (`MOV ESI,[ESP+0x8]` at `0x00432CD2`, the argument
 * past the pushed `ESI`) and walks the object's memory as records -- its
 * first dword is the task handler, not `-1`, so the engine would draw slot
 * `0x00432C80`. The port has no object memory to walk and draws nothing. The
 * input is `desc+0x22`; every shipped class-0x29 descriptor carries 0, 1 or
 * 2, which `web/tools/checks/prop_tables.ts` holds, and the port test pins
 * that an out-of-range selector draws nothing.
 */
export function SceneryBatchUpdate29(obj: Actor): void {
  // The director builds this class only from a placement carrying the tail.
  const t = obj.class29!;
  if (G.g_active_cam_path === t.kill_path
      && G.g_cam_path_frame >= t.kill_frame) {
    SceneryBatchKill(obj);
    return;
  }
  const list = CLASS29_LISTS[obj.hp];
  if (!list) return;
  for (const [slot, x, y, z, yaw, scale] of list) {
    const m = MatIdentity();
    MatrixTranslate(m, x, y, z);
    MatrixRotateY(m, yaw);
    MatrixScale(m, scale, scale, scale);
    DrawSlotInWorld(slot, m);
  }
}

function SceneryBatchDebug29(obj: Actor): ActorDebug {
  const t = obj.class29;
  return {
    summary: `list ${obj.hp} · ${CLASS29_LISTS[obj.hp]?.length ?? 0} decals`,
    detail: [`until path ${t?.kill_path ?? -1} frame ${t?.kill_frame ?? 0}`
             + ` · camera at path ${G.g_active_cam_path} frame`
             + ` ${G.g_cam_path_frame}`],
    hot: false,
  };
}

export const SceneryBatchHandler: ClassHandler = {
  // No `Init`: `SpawnFromDescriptor` stores the handler and the first walk
  // runs it as the update.
  init: () => {},
  update: SceneryBatchUpdate29,
  // No hit points: `obj+0x11C` is the list.
  ownsShotResult: true,
  debug: SceneryBatchDebug29,
};

registerClass(SpawnClass.SceneryBatch, SceneryBatchHandler);

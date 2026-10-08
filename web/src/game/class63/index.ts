/**
 * Class 0x63 -- **the cutscene-skip watcher**, the task that turns a Start
 * press into a skip.
 *
 * `spawn_simple` places one at the top of most steps (record `0x0097724C`,
 * `{0x63, 0}`), and `g_class_handlers` gives it `InitCutsceneSkipWatcher`
 * (`{0x63, 0x00435F20}` at `0x005934E0`). Its three routines are reached only
 * through that table and through the pointers they store at `obj+0x00`, which
 * is why an xref search on the flags it raises once found only writers that
 * stored 0.
 *
 * ```
 * InitCutsceneSkipWatcher    g_nSkipRequested = 0; Check(obj); obj+0x00 = Check
 * CheckCutsceneSkipRequest   region closed -> ActorKill
 *                            request -> end the camera move where it stands,
 *                                       g_nEvtSkipFlag = g_cutscene_skipping = 1,
 *                                       obj+0x00 = Finish
 * FinishCutsceneSkip         g_cutscene_skipping = 0; ActorKill
 * ```
 *
 * The request is the player-update routines' (`FUN_00414940`, `FUN_00414B90`
 * raise `g_nSkipRequested` on Start while a region is open and the firing gate
 * is down); in the port it is `Walker.requestSkip`, the input seam. Before
 * this module the walker did the whole chain itself at the press, and
 * `g_cutscene_skipping` had no home, so every reader of it declared its arm
 * missing.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import { registerClass, type ActorDebug, type ClassHandler } from "../registry";
import { SpawnClass } from "../spawn_class";
import { SkipWatchRoutine } from "./state";

export { SkipWatchRoutine } from "./state";

/**
 * `ActorKill` (`FUN_004A7040`) as this class takes it: a `JMP` straight to the
 * unlink, no `ActorDespawn`, no hit slot to give back. `[port-only]` as a
 * name. Marked dead and kept in the pool, as the other `spawn_simple` classes'
 * kills are (`ChapterCardKill` in `class60/index.ts`): `SpawnSimpleActors`
 * runs over the walker's whole list at every `spawn_simple`, and a watcher
 * that had left the pool would be built again.
 */
function SkipWatchKill(obj: Actor): void {
  obj.dead = true;
  obj.visible = false;
}

/** `[port-only]` -- the watcher's tail; every actor this module runs has one. */
function Routine(obj: Actor): { routine: SkipWatchRoutine } {
  return (obj as { skipWatch: { routine: SkipWatchRoutine } }).skipWatch;
}

/**
 * `InitCutsceneSkipWatcher` — `FUN_00435F20`. Clears any request left over,
 * runs the Check once on this same frame, and installs it.
 *
 * ```
 * 00435F26  MOV byte [0x009a1a18],0x0
 * 00435F2D  CALL CheckCutsceneSkipRequest
 * 00435F35  MOV dword [ESI],0x435f40
 * ```
 *
 * The store comes after the call, so a Check that took a request and
 * installed `FinishCutsceneSkip` is overwritten with the Check again -- moot,
 * since the request was cleared on the line before.
 */
export function InitCutsceneSkipWatcher(obj: Actor): void {
  G.g_nSkipRequested = 0;
  CheckCutsceneSkipRequest(obj);
  if (obj.dead) return;
  Routine(obj).routine = SkipWatchRoutine.Check;
}

/**
 * `CheckCutsceneSkipRequest` — `FUN_00435F40`.
 *
 * ```
 * if (g_nEvtSkippableRegion == 0) ActorKill();          // a tail JMP
 * if (g_nSkipRequested) {
 *     if (g_cam_path_end_frame != g_cam_path_cursor)
 *         g_cam_path_end_frame = g_cam_path_cursor;
 *     g_nSkipRequested = 0;
 *     g_nEvtSkipFlag = 1;  g_cutscene_skipping = 1;
 *     AssetDrainAllJobs();
 *     obj+0x00 = FinishCutsceneSkip;
 * }
 * ```
 *
 * The camera line ends the move where it stands rather than fast-forwarding
 * it: `CamAdvancePathFrame` publishes the cursor and retires on its next call,
 * which lets `wait_queued_events_done` fall through. `AssetDrainAllJobs`
 * (`FUN_0041D970`) completes the streaming the skipped waits would have
 * covered; the port loads its assets from the bundle and has no job queue to
 * drain, as `CommitAppState` and `ResetSceneOnEnter` note for their calls.
 */
export function CheckCutsceneSkipRequest(obj: Actor): void {
  if (G.g_nEvtSkippableRegion === 0) {
    SkipWatchKill(obj);
    return;
  }
  if (G.g_nSkipRequested === 0) return;
  if (G.g_cam_path_end_frame !== G.g_cam_path_cursor) {
    G.g_cam_path_end_frame = G.g_cam_path_cursor;
  }
  G.g_nSkipRequested = 0;
  G.g_nEvtSkipFlag = 1;
  G.g_cutscene_skipping = 1;
  Routine(obj).routine = SkipWatchRoutine.Finish;
}

/**
 * `FinishCutsceneSkip` — `FUN_00435FA0`. `g_cutscene_skipping` back to 0 on
 * the watcher's next run, and `ActorKill`. The skip flag stays up: only
 * `set_skippable_region(0)` lowers it.
 */
export function FinishCutsceneSkip(obj: Actor): void {
  G.g_cutscene_skipping = 0;
  SkipWatchKill(obj);
}

/** `[port-only]` -- the call through `obj+0x00`. */
function SkipWatchUpdate(obj: Actor): void {
  if (obj.cls !== SpawnClass.CutsceneSkipWatcher) return;
  switch (Routine(obj).routine) {
    case SkipWatchRoutine.Init: InitCutsceneSkipWatcher(obj); break;
    case SkipWatchRoutine.Check: CheckCutsceneSkipRequest(obj); break;
    case SkipWatchRoutine.Finish: FinishCutsceneSkip(obj); break;
  }
}

function SkipWatchDebug(obj: Actor): ActorDebug {
  const r = Routine(obj).routine;
  return {
    summary: `skip watcher · ${SkipWatchRoutine[r]}`,
    detail: [`region ${G.g_nEvtSkippableRegion} · request `
             + `${G.g_nSkipRequested} · skip ${G.g_nEvtSkipFlag} · `
             + `skipping ${G.g_cutscene_skipping}`],
    hot: G.g_nSkipRequested !== 0,
  };
}

export const SkipWatchHandler: ClassHandler = {
  // The pool's handler is the Init itself; the first walk runs it.
  init: () => {},
  update: SkipWatchUpdate,
  // No hit points: `obj+0x11C` is the record's second word, 0.
  ownsShotResult: true,
  debug: SkipWatchDebug,
};

registerClass(SpawnClass.CutsceneSkipWatcher, SkipWatchHandler);

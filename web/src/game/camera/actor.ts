/**
 * The camera's two tasks, as `SceneTaskWalk` runs them.
 *
 * ```
 * task 1  EvtInterpreterLoop      (0x0045EBC0)  the script: queue_event only PUSHES
 * task 2  PushSceneLightStateToDevice (0x0040AE60)
 * task 3  CameraActorTick         (0x00402300)  the queued action, then the view
 * task 4  DrawBackdropDome        (0x004134D0)
 * task 5  CameraUpdateTick        (0x00414F20)  the scene state's hook; the bodies
 * task 6  the two player tasks    (0x00414ED0)
 * task 7  SelectAttackablePlayer  (0x00414FB0)
 * task 8  HudDrawShutterState     (0x00413950)
 * task 9  SceneLightArrayUpdate   (0x004809D0)
 * task 10 RegionDrawResidentSet   (0x00401470)
 * task 11 DrawRainParticles       (0x004138A0)
 * task 12 UpdateCameraEnemySlots  (0x00408D90)  the candidates filed last frame
 * task 13 RankEnemiesByDistance   (0x00409080)
 * task 14 ProcessPlayerShots      (0x00404480)
 *   ...   every actor and effect, in allocation order
 * ```
 *
 * `[proved]`: the scene's task-list builder at `0x00460710` makes fourteen
 * calls in that order, `ActorAlloc` (`FUN_004A6FA0`) appends and
 * `TaskRunTree` (`FUN_004A71A0`) walks from the head, so creation order is
 * execution order, and every actor is allocated after the list is built.
 */
import { G } from "../globals";
import { EvtRunQueuedActions } from "./actions";
import { CameraUpdateHook, EvtActionHandler } from "./driver";
import { CameraUpdateTick } from "./hooks";
import { RailMayAdvance } from "./rail";
import { UpdateSceneViewAndLight } from "./view";

export { CameraUpdateTick };

/**
 * `CameraActorTick` — `FUN_004022B0`. The camera actor's task, third in every
 * scene's list.
 *
 * ```c
 * g_camera_settled = 0;  g_camera_is_tracking = 1;
 * g_camera_actor_major_hooks[g_scene_state_major_entered]();   // 0x00576B10
 * for (b = 1; b < 4; b++) evt_action_block[b].handler(b);
 * UpdateSceneViewAndLight();
 * ```
 *
 * `g_camera_settled` is a **this-frame** answer, cleared here before any
 * driver can raise it; `g_camera_is_tracking` is seeded to 1 and
 * `SelectCameraLookAtTarget` clears it when no slot is claimed. The major
 * hooks are `[0]` and `[3]` `NoOpStub`, `[2]` `EvtRunQueuedActions` and `[1]`
 * `EvtRunQueuedActionsSyncViewBlock`, which is `EvtRunQueuedActions` and then,
 * while the minor is 3, a copy of block 0's eye and look-at into block 2 -- a
 * block the port has no reader for. The handlers of evt-action blocks 1..3
 * are the two-player camera blocks', and every one the shipped scripts leave
 * is `NoOpStub`. `[proved]`
 */
export function CameraActorTick(): void {
  G.g_camera_settled = 0;
  G.g_camera_is_tracking = 1;
  const major = G.g_scene_state_major_entered;
  if (major === 1 || major === 2) EvtRunQueuedActions();
  UpdateSceneViewAndLight();
}

/** A replay's camera frames are cheap, and no postcondition needs more. */
const REPLAY_FRAMES = 16;

/**
 * `[port-only]` -- a replay's camera: the camera's two tasks, run at least
 * `minFrames` times and then until `done` holds, with a playing shot's cursor
 * and the stashed rail's frame carried forward to `target` (the end of the
 * range when `null`) before each.
 *
 * A seek walks the script without running frames, and a wait it steps over is
 * a claim about the world past it: every wait but `0x40` spends at least the
 * frame it yields on, so the camera actor has run by then -- the action ring
 * has dequeued what was pushed in front of the wait -- and some claim more:
 * `wait_queued_events_done` that the ring is empty, `wait_camera_path_frame`
 * that the path has passed a frame, a room gate that the fight is over.
 * Running the engine's own routines to that state, rather than writing the
 * words that describe it, keeps the landing one the game could be in: the
 * ring dequeues as it would, the scene state's hook evaluates the rail, the
 * drivers seat the block. What is skipped is the frames between.
 */
export function CameraReplayUntil(done: () => boolean, target: number | null,
                                  minFrames = 0): void {
  for (let i = 0; i < REPLAY_FRAMES && (i < minFrames || !done()); i++) {
    if (G.g_evt_action_handler === EvtActionHandler.PathPlay) {
      const end = G.g_cam_path_end_frame;
      const to = target === null ? end : Math.min(target, end);
      if (G.g_cam_path_cursor < to) G.g_cam_path_cursor = to;
    }
    const hook = G.g_camera_update_hook as CameraUpdateHook;
    if (hook === CameraUpdateHook.StepRail
        || hook === CameraUpdateHook.DeferredRailInstall
        || hook === CameraUpdateHook.PlayStashedPath) {
      // (2,7)'s `JG` publishes one frame past the end; the operand-0 wait
      // is over at the end itself (`g_cam_path_frames_left < 1`).
      const last = G.g_stashed_path_end_frame
        + (hook === CameraUpdateHook.PlayStashedPath ? 1 : 0);
      const to = target === null ? G.g_stashed_path_end_frame
        : Math.min(target, last);
      // The hook steps before it publishes, when its gate lets it.
      const from = RailMayAdvance() ? to - 1 : to;
      if (G.g_stashed_path_frame < from) G.g_stashed_path_frame = from;
    }
    CameraActorTick();
    CameraUpdateTick();
  }
}

/**
 * `[port-only]` -- the camera a replay leaves past a wait that holds for a
 * long time and names no frame: a room gate, a script flag, the targets. The
 * ring runs until nothing is queued and no shot is still playing -- each shot
 * carried to its end -- or a driver it cannot get past holds the slot.
 */
export function CameraReplaySettle(): void {
  CameraReplayUntil(() => G.g_evt_action_ring.length === 0
    && G.g_evt_action_handler !== EvtActionHandler.PathPlay, null, 1);
}

/**
 * `[port-only]` -- the camera a replay leaves past `wait_frames n`: `n + 1`
 * frames on (`EvtOpWaitFrames42`), the shot or the rail carried that far.
 */
export function CameraReplayFor(frames: number): void {
  // The frames the camera tasks really run: at most two, which is enough for
  // the ring to dequeue and call what is waiting; the rest are skipped by
  // carrying the cursor, or the rail's stash, forward by as many.
  const run = Math.min(frames, 2);
  const skip = frames - run;
  if (skip > 0) {
    if (G.g_evt_action_handler === EvtActionHandler.PathPlay) {
      G.g_cam_path_cursor = Math.min(G.g_cam_path_cursor + skip,
                                     G.g_cam_path_end_frame);
    }
    const hook = G.g_camera_update_hook as CameraUpdateHook;
    if ((hook === CameraUpdateHook.StepRail
         || hook === CameraUpdateHook.DeferredRailInstall
         || hook === CameraUpdateHook.PlayStashedPath) && RailMayAdvance()) {
      G.g_stashed_path_frame = Math.min(G.g_stashed_path_frame + skip,
                                        G.g_stashed_path_end_frame);
    }
  }
  for (let i = 0; i < run; i++) {
    CameraActorTick();
    CameraUpdateTick();
  }
}

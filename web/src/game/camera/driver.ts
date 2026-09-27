/**
 * The identities the camera's two function-pointer slots hold, as enums a
 * snapshot can carry.
 *
 * The engine keeps both as code pointers: the queued action's handler in
 * `g_evt_action_handler` (`0x009A610C`), which `EvtRunQueuedActions` calls once
 * a frame from inside `CameraActorTick`, and the scene state's camera routine
 * in `g_camera_update_hook` (`0x009C7080`), which `CameraUpdateTick` jumps
 * through straight after. The port cannot put a function in `G`, so it keeps
 * which routine each slot holds, and a switch stands in for the indirect call.
 * On their own in this file because the routines on both sides of each switch
 * -- `camera/path.ts`, `camera/rail.ts`, `camera/mode.ts`, `camera/hooks.ts`
 * -- all write the slots.
 */

/**
 * `[port-only]` — which routine `g_evt_action_handler` (`0x009A610C`) holds.
 * See `G.g_camera_action_driver` and `CameraRunQueuedAction`.
 */
export enum CameraActionDriver {
  /** `NoOpStub` (`0x0041EBB0`): nothing queued, or `goto_scene_state` parked the slot. */
  None = 0,
  /** `CameraDriverSelectMode` (`FUN_00402650`) — scene-state minors 4 and 6. */
  SelectMode = 1,
  /** `CameraDriverFromDeferredPose` (`FUN_00402E00`) — minor 7. */
  DeferredPose = 2,
  /** `CamAdvancePathFrame` (`FUN_004035E0`) — a `cam_play` still playing. */
  PathPlay = 3,
  /** `CameraActionStartWithEyeSnap` (`FUN_00402460`) — minor 4's starter. */
  StartWithEyeSnap = 4,
  /** `CameraActionStartWithEyeMatrix` (`FUN_00402580`) — minor 6's starter. */
  StartWithEyeMatrix = 5,
  /** `CameraActionStartDeferredPose` (`FUN_00402DB0`) — minor 7's starter. */
  StartDeferredPose = 6,
}

/**
 * `[port-only]` — which routine `g_camera_update_hook` (`0x009C7080`) holds.
 *
 * The installers in `g_scene_state_table` write it, and three of those
 * routines re-point it at their own steady body on their first call, which is
 * why an install and its body are two members.
 */
export enum CameraUpdateHook {
  /** `NoOpStub` — `CameraInstallNoOpHook` (0,0), `CameraInstallNoOpWithBodyDraw` (1,2). */
  None = 0,
  /** `CameraFollowPlayerMidpoint` (`FUN_0040C9C0`) — (1,1). */
  FollowPlayerMidpoint = 1,
  /** `CameraFromViewAngles` (`FUN_0040C380`) — (1,3). */
  FromViewAngles = 2,
  /** `CameraSnapToPathEye` (`FUN_0040C430`) — (2,4)'s install. */
  SnapToPathEye = 3,
  /** `CameraHoldEyeTick` (`FUN_0040C470`) — (2,4)'s steady body. */
  HoldEye = 4,
  /** `CameraPathWithImpulseShake` (`FUN_0040C4C0`) — (2,5)'s install. */
  PathWithImpulseShake = 5,
  /** `CameraImpulseShakeTick` (`FUN_0040C5C0`) — (2,5)'s steady body. */
  ImpulseShake = 6,
  /** `CameraStepDeferredRailWithFrameExport` (`FUN_0040C770`) — (2,6)'s install. */
  DeferredRailInstall = 7,
  /** `CameraStepRailTick` (`FUN_0040C790`) — (2,6)'s steady body. */
  StepRail = 8,
  /** `CameraPlayStashedPath` (`FUN_0040C8A0`) — (2,7), install and body both. */
  PlayStashedPath = 9,
}

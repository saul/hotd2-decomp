/**
 * The identities the camera's two function-pointer slots hold, as enums a
 * snapshot can carry.
 *
 * The engine keeps both as code pointers: the queued action's handler in
 * `g_evt_action_handler` (`0x009A610C`), which `EvtRunQueuedActions` calls
 * from inside `CameraActorTick`, and the scene state's camera routine in
 * `g_camera_update_hook` (`0x009C7080`), which `CameraUpdateTick` jumps
 * through straight after. The port cannot put a function in `G`, so it keeps
 * which routine each slot holds, and a switch stands in for the indirect call.
 * On their own in this file because the routines on both sides of each switch
 * -- `camera/actions.ts`, `camera/path.ts`, `camera/rail.ts`,
 * `camera/mode.ts`, `camera/hooks.ts` -- all write the slots.
 */

/**
 * `[port-only]` — which routine `g_evt_action_handler` (`0x009A610C`) holds:
 * the ten `queue_event` actions `EvtRunQueuedActions` dequeues into it (from
 * the two-level table at `0x005776EC`), and the persistent routines some of
 * them install in their own place. See `G.g_evt_action_handler`.
 */
export enum EvtActionHandler {
  /** `NoOpStub` (`0x0041EBB0`): nothing queued, or the ring parked the slot. */
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
  /** `EvtActionSetPlayerFlag10` (`FUN_00403830`), selector 0x10. */
  SetPlayerFlag = 7,
  /** `EvtActionSceneState11` (`FUN_004036B0`), selector 0x11. */
  SceneState = 8,
  /** `EvtActionSetUpdateRoutine12` (`FUN_00403780`), selector 0x12. */
  SetUpdateRoutine = 9,
  /** `EvtActionSetContinuation13` (`FUN_00403250`), selector 0x13 -- never queued. */
  SetContinuation = 10,
  /** `EvtActionSetGlobal14` (`FUN_004037E0`), selector 0x14: `g_camera_index`. */
  SetCameraIndex = 11,
  /** `EvtActionSetFlag15` (`FUN_00403930`), selector 0x15: `g_camera_ease_eye`. */
  SetEaseEye = 12,
  /** `EvtActionHoldCameraPreset20` (`FUN_004032E0`), selector 0x20. */
  HoldCameraPreset = 13,
  /** `EvtActionFinishSequence21` (`FUN_00403710`), selector 0x21. */
  FinishSequence = 14,
  /** `EvtActionCamPlay40` (`FUN_00403360`), selector 0x40. */
  CamPlay = 15,
  /** `EvtActionStoreSixOperands60` (`FUN_004038A0`), selector 0x60. */
  StoreSix = 16,
}

/**
 * `g_evt_action_table` (`0x005776EC`) as the port reads it: `table[sel >> 4]
 * [sel & 0xF]`, the group index doubling as the operand count: group 1 at
 * `0x005776C4` (`0x00403830`, `0x004036B0`, `0x00403780`, `0x00403250`,
 * `0x004037E0`, `0x00403930`), group 2 at `0x005776DC` (`0x004032E0`,
 * `0x00403710`), group 4 at `0x005776E4` (`0x00403360`) and group 6 at
 * `0x005776E8` (`0x004038A0`). Selectors not listed are null in the engine and
 * never queued by a shipped script. `[proved]` (`read_memory`)
 */
export const EVT_ACTION_TABLE: Readonly<Record<number, EvtActionHandler>> = {
  0x10: EvtActionHandler.SetPlayerFlag,
  0x11: EvtActionHandler.SceneState,
  0x12: EvtActionHandler.SetUpdateRoutine,
  0x13: EvtActionHandler.SetContinuation,
  0x14: EvtActionHandler.SetCameraIndex,
  0x15: EvtActionHandler.SetEaseEye,
  0x20: EvtActionHandler.HoldCameraPreset,
  0x21: EvtActionHandler.FinishSequence,
  0x40: EvtActionHandler.CamPlay,
  0x60: EvtActionHandler.StoreSix,
};

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

/**
 * The camera, as the engine's own two halves.
 *
 * `CamStartPathPlayback` evaluates the path and writes the camera **block**;
 * `CameraTrackEnemiesTick`, inside `GameUpdate`, eases that block's look-at
 * towards whatever `SelectCameraLookAtTarget` picked; and only then does the
 * draw read the block back. Three things, in that order, with the port's frame
 * in the middle of them.
 *
 * So this is two systems over one piece of state, and they sit either side of
 * the `game` phase:
 *
 * ```
 * script:  CameraSeat   -- CamAdvancePathFrame writes the block
 * game:    CameraTake   -- the camera becomes thirty-two floats
 *          GameSystem   -- the hook eases the block's look-at
 * render:  CameraDraw   -- the block becomes the three.js camera
 * ```
 *
 * `CameraTake` is the seam: the port reads the camera it was drawn with last
 * frame, which is what it has always read, and now reads it as plain numbers.
 *
 * Doing all three in one place is what the player used to do, and it is why
 * the aim could only ever be a frame stale or a frame early.
 */
import type { PerspectiveCamera } from "three";
import type { System, Tick } from "../core/system";
import type { RenderContext } from "./context";
import { CamAdvancePathFrame, CamSetPathTarget } from "../game/camera/path";
import { G } from "../game/globals";
import { Vector3 } from "three";
import { CamPaths, applyPose, cameraEyeY, type CameraPose } from "./campath";
import type { RailLayer } from "./overlays";

/**
 * The state both halves share: the pose scratch, the path table, and the two
 * switches the player's own chrome owns.
 */
export class CameraRig {
  paths: CamPaths | null = null;
  rails: RailLayer | null = null;
  /**
   * False in free roam, where the viewer is flying the camera and the script's
   * shot must not fight them for it.
   */
  scripted = true;
  /** False while the frame slider is driving the camera by hand. */
  driving = true;
  /** UI toggle — off pins the block to the rail and restores the authored shot. */
  trackEnabled = true;

  readonly pose: CameraPose = {
    eye: new Vector3(0, 0, 0),
    target: new Vector3(0, 0, -1),
    roll: 0,
  };

  /**
   * The queued `cam_play` action: evaluate the path, write the camera block.
   *
   * `force` seats the block even though the shot's action has retired. The
   * engine never needs that — it has no seek — but arriving at a deep link
   * with an eased look-at of (0,0,0) points the camera at the world origin.
   */
  seat(ctx: RenderContext, force = false): void {
    const w = ctx.walker;
    if (!w || !this.scripted) return;
    const cam = w.cam;
    if (!cam) return;
    const p = this.paths?.paths.get(cam.slot);
    if (!p) return;
    p.pose(cam.frame, w.rollEnabled, this.pose);
    // The block holds the **raw** curve eye, as `CamEvalPath7` leaves it. The
    // `path.y - 15` rule is a property of the draw (`g_camera_eye_y`), not of
    // the block, so it is applied in the draw -- see the note on
    // `APPLY_EYE_Y_RULE` in render/campath.ts for why it is off anyway.
    // The path's own aim, which `SelectCameraLookAtTarget` falls back to.
    CamSetPathTarget(this.pose.target);
    // `CamAdvancePathFrame` runs only while the action is live. Once the shot
    // reaches its end frame the action retires and the block is left where it
    // is, for the camera hook to ease from -- which is the state the player
    // spends every fight in.
    if (force || !cam.done || !this.trackEnabled) {
      CamAdvancePathFrame(this.pose.eye, this.pose.target);
    }
  }

  /** The draw: the block, after the hook has eased it. */
  draw(ctx: RenderContext): void {
    const w = ctx.walker;
    if (!w || !this.scripted) return;
    if (!w.cam || !this.paths?.paths.get(w.cam.slot)) return;
    this.pose.eye.set(G.g_camera_block_eye.x, G.g_camera_block_eye.y,
                      G.g_camera_block_eye.z);
    this.pose.target.set(G.g_camera_block_target.x, G.g_camera_block_target.y,
                         G.g_camera_block_target.z);
    // The orientation comes from the block's eye/target pair; only the eye's
    // height is adjusted, and only after. Doing it the other way round tilts
    // the shot.
    applyPose(ctx.camera, this.pose,
              cameraEyeY(this.pose, w.useFixedEyeY, w.fixedEyeY));
    this.rails?.setCameraPose(ctx.camera.position, this.pose.target);
  }

  /** Seat and draw in one go, for the paths that have no game tick between. */
  sync(ctx: RenderContext, force = false): void {
    this.seat(ctx, force);
    this.draw(ctx);
  }

  /** `?slot=59&frame=170`: pose straight off a path, no script. */
  poseFromSlot(camera: PerspectiveCamera, walkerRoll: boolean,
               useFixedEyeY: boolean, fixedEyeY: number,
               slot: number, frame: number): boolean {
    const p = this.paths?.paths.get(slot);
    if (!p) return false;
    p.pose(frame, walkerRoll, this.pose);
    applyPose(camera, this.pose,
              cameraEyeY(this.pose, useFixedEyeY, fixedEyeY));
    this.rails?.highlight(slot, p.start, p.end);
    this.rails?.setCameraPose(camera.position, this.pose.target);
    return true;
  }
}

/**
 * The first half, in the `script` phase: the shot writes the camera block
 * before the port's frame reads it.
 */
export class CameraSeatSystem implements System<RenderContext> {
  readonly id = "camera.seat";
  constructor(private readonly rig: CameraRig) {}

  update(ctx: RenderContext, _t: Tick): void {
    if (!this.rig.driving) return;
    this.rig.seat(ctx);
  }
}

/**
 * The seam, at the head of the `game` phase: the three.js camera, taken.
 *
 * It reads `matrixWorld` and `matrixWorldInverse` as the renderer left them —
 * which is one frame behind the block, because `CameraDraw` runs after this
 * and `WebGLRenderer` computes the inverse during `render`. That staleness is
 * the port's own and predates this system; moving the read out of
 * `GameSystem` and into a system of its own preserves it exactly, by sitting
 * in the same place in the order that the read used to sit in.
 */
export class CameraTakeSystem implements System<RenderContext> {
  readonly id = "camera.take";
  private readonly eye = new Vector3();
  private readonly fwd = new Vector3();

  update(ctx: RenderContext): void {
    const cam = ctx.camera;
    // In this order, and it matters. `getWorldPosition` recomposes
    // `matrixWorld` in place, so the matrices are copied first — a frame
    // behind the eye whenever free roam moved the camera after the last draw,
    // exactly as `GameSystem` read them when the read lived there.
    ctx.view.take(cam.matrixWorld.elements, cam.matrixWorldInverse.elements);
    cam.getWorldPosition(this.eye);
    cam.getWorldDirection(this.fwd);
    ctx.view.place(this.eye, this.fwd);
  }

  /** A load moved the camera. The port must not read the old one. */
  resync(ctx: RenderContext): void {
    this.update(ctx);
  }
}

/**
 * The second half, first in the `render` phase: every layer below this one
 * poses against the camera this put where it is.
 */
export class CameraDrawSystem implements System<RenderContext> {
  readonly id = "camera.draw";
  constructor(private readonly rig: CameraRig) {}

  update(ctx: RenderContext, _t: Tick): void {
    if (!this.rig.driving) return;
    this.rig.draw(ctx);
  }

  /**
   * A load replaced the walker's camera command wholesale. `force`, because
   * the restored shot's action may already have retired and the eased look-at
   * that came back with it has nothing to ease *from* until the block is on
   * the rail.
   */
  resync(ctx: RenderContext): void {
    this.rig.sync(ctx, true);
  }
}

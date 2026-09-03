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
 * script:  CameraSeat   -- CamSeatPathFrame writes the block      (app/systems)
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
 *
 * **The seat is not in this file.** Seating the block is an engine decision —
 * it evaluates a `cam/` curve and writes `g_camera_block_eye` — and a renderer
 * that calls `CamAdvancePathFrame` is the port being driven from `render/`.
 * The evaluation is `game/camera/curve.ts` and the frame is
 * `CamSeatPathFrame`; the system that runs it is `app/systems.ts`, which is
 * the composition root and the one layer allowed to hand the script's state to
 * the port. What is left here is the rig — the pose scratch, the rails and the
 * two chrome toggles — and the two systems that only read.
 */
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import { G } from "../game/globals";
import { Vector3 } from "three";
import { applyPose, cameraEyeY, type CameraPose } from "./campath";
import type { RailLayer } from "./overlays";

/**
 * The state both halves share: the pose scratch, the rails, and the two
 * switches the player's own chrome owns.
 *
 * The path table is **not** here. It is on the context, where every layer that
 * evaluates a shot already reads it; a copy of it on this class was a second
 * owner of one fact, and it was the copy nothing assigned.
 */
export class CameraRig {
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

  /** The draw: the block, after the hook has eased it. */
  draw(ctx: RenderContext): void {
    const w = ctx.walker;
    if (!w || !this.scripted) return;
    if (!w.cam || !ctx.paths?.paths.get(w.cam.slot)) return;
    this.pose.eye.set(G.g_camera_block_eye.x, G.g_camera_block_eye.y,
                      G.g_camera_block_eye.z);
    this.pose.target.set(G.g_camera_block_target.x, G.g_camera_block_target.y,
                         G.g_camera_block_target.z);
    // The orientation comes from the block's eye/target pair; only the eye's
    // height is adjusted, and only after. Doing it the other way round tilts
    // the shot.
    // The block holds the **raw** curve eye, as `CamEvalPath7` leaves it. The
    // `path.y - 15` rule is a property of the draw (`g_camera_eye_y`), not of
    // the block, so it is applied here -- see the note on `APPLY_EYE_Y_RULE`
    // in render/campath.ts for why it is off anyway.
    applyPose(ctx.camera, this.pose,
              cameraEyeY(this.pose, w.useFixedEyeY, w.fixedEyeY));
    this.rails?.setCameraPose(ctx.camera.position, this.pose.target);
  }

  /** `?slot=59&frame=170`: pose straight off a path, no script. */
  poseFromSlot(ctx: RenderContext, walkerRoll: boolean,
               useFixedEyeY: boolean, fixedEyeY: number,
               slot: number, frame: number): boolean {
    const camera = ctx.camera;
    const p = ctx.paths?.paths.get(slot);
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

  update(ctx: RenderContext): void {
    if (!this.rig.driving) return;
    this.rig.draw(ctx);
  }

  /**
   * A load replaced the walker's camera command wholesale.
   *
   * Only the draw. `CameraSeatSystem.resync` has already put the block back on
   * the rail — it runs in the `script` phase, which `World.resync` reaches
   * first — so by the time this runs there is something to draw. It used to
   * seat the block itself, which is how a renderer came to be calling
   * `CamAdvancePathFrame`.
   */
  resync(ctx: RenderContext): void {
    this.rig.draw(ctx);
  }
}

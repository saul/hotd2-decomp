/**
 * The camera, drawn.
 *
 * The camera is the port's from end to end: the queued action writes the
 * camera block, the driver eases it, and `UpdateSceneViewAndLight` builds the
 * view matrices out of the block's eye and **angles** -- all inside
 * `CameraActorTick`, at the head of `GameUpdate` (`game/camera/`). What is
 * left here is the draw: the three.js camera placed from
 * `G.g_camera_view_to_world`, the matrix every task after the camera actor
 * read the frame through, and the rails overlay.
 *
 * ```
 * game:    CameraTake   -- the camera as the last draw left it, for render/
 *          GameSystem   -- the camera actor builds this frame's view
 * render:  CameraDraw   -- the view becomes the three.js camera
 * ```
 *
 * Nothing here evaluates a path or writes `G`: a renderer that seats the
 * block is the port being driven from `render/`, which is exactly what
 * `render-drives-the-port` counts.
 */
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import { G } from "../game/globals";
import { Matrix4, Vector3 } from "three";
import { applyPose, type CameraPose } from "./campath";
import type { RailLayer } from "./overlays";

const _view = new Matrix4();
const _scale = new Vector3();

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
  /** UI toggle — off draws the authored shot, the path itself, not the block. */
  trackEnabled = true;

  readonly pose: CameraPose = {
    eye: new Vector3(0, 0, 0),
    target: new Vector3(0, 0, -1),
    roll: 0,
  };

  /**
   * The draw: the three.js camera placed from the view the port built this
   * frame -- `g_camera_blocks`, `T(eye) Ry(yaw) Rx(pitch) Rz(roll)` of the
   * block after the shake's nod. The matrix stack's row-vector layout is
   * three.js's column-major `elements`, so the sixteen floats cross as they
   * are. A frame that runs no tick draws what the last tick built.
   */
  draw(ctx: RenderContext): void {
    if (!ctx.walker || !this.scripted) return;
    const cam = ctx.camera;
    // The chrome's "authored shot" toggle: the path the camera is on, at the
    // frame it published, drawn straight off the curve with nothing the port
    // did to it. A view, not a write -- the port's block is untouched.
    const p = this.trackEnabled ? null
      : ctx.paths?.paths.get(G.g_active_cam_path) ?? null;
    if (p) {
      p.pose(G.g_cam_path_frame, G.g_cam_roll_enabled !== 0, this.pose);
      applyPose(cam, this.pose);
      cam.updateMatrixWorld(true);
      this.rails?.setCameraPose(cam.position, this.pose.target);
      return;
    }
    _view.fromArray(G.g_camera_view_to_world);
    _view.decompose(cam.position, cam.quaternion, _scale);
    cam.updateMatrixWorld(true);
    this.pose.eye.copy(cam.position);
    this.pose.target.set(G.g_camera_block_target.x, G.g_camera_block_target.y,
                         G.g_camera_block_target.z);
    this.pose.roll = 0;
    this.rails?.setCameraPose(cam.position, this.pose.target);
  }

  /** `?slot=59&frame=170`: pose straight off a path, no script. */
  poseFromSlot(ctx: RenderContext, walkerRoll: boolean,
               slot: number, frame: number): boolean {
    const camera = ctx.camera;
    const p = ctx.paths?.paths.get(slot);
    if (!p) return false;
    p.pose(frame, walkerRoll, this.pose);
    // The raw eye: the `- 15` the path hooks apply is to the gameplay eye,
    // never to the drawn camera. See `render/campath.ts`.
    applyPose(camera, this.pose);
    this.rails?.highlight(slot, p.start, p.end);
    this.rails?.setCameraPose(camera.position, this.pose.target);
    return true;
  }
}

/**
 * The seam, at the head of the `game` phase: the three.js camera, taken, as
 * the last draw left it -- which is the view the port built on the tick
 * before, or free roam's. `ctx.view` is what the render half reads the camera
 * through; the port reads its own `g_camera_view_to_world`, built this tick.
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
   * A load or a seek replaced `G`: draw the view it carries. The block and
   * its matrices are the port's and come back with the snapshot, or are
   * rebuilt by the seek (`CameraReseatFromFrame`), so there is nothing to
   * seat here.
   */
  resync(ctx: RenderContext): void {
    this.rig.draw(ctx);
  }
}

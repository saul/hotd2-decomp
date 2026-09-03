/**
 * Free-roam camera: orbit with the mouse, fly with WASD.
 *
 * Detached from the rail entirely, so it can go where no `cam/` path does.
 * Stage geometry is loaded whole for this mode -- region visibility is off in
 * free roam, because a region holds only the handful of models the game draws
 * from one point on the rail and the rest of the level would simply not be
 * there.
 *
 * ## It is a system, and that is not bookkeeping
 *
 * It used to be ticked by hand out of `Player.frame`, before `world.update`
 * ran, which put it outside the one thing `World` is for: `resync`. A seek or
 * a snapshot load replaces the game state underneath every layer and then asks
 * each of them to place itself against the new state -- and a layer nobody
 * asks does not move. Free roam owns `camera.position` and `camera.rotation`
 * outright while it is enabled (`CameraRig.scripted` is false, so the draw
 * system does not touch them), so a rebuild that skipped it left the camera
 * wherever the *previous* state's last frame had put it, which is a shot no
 * play of the stage could produce. It is registered in the `render` phase
 * after `CameraDrawSystem` for the same reason: it is the last word on where
 * the camera is.
 *
 * Its own pose is **derived, never saved**. When it is off it re-adopts the
 * scripted camera on every `resync`, which is what makes entering free roam
 * after a seek start from the shot the seek produced; when it is on it puts
 * the camera back where the viewer flew it. So it contributes no snapshot
 * slice, and `World.load` has nothing to refuse.
 *
 * One behaviour change came with the move, deliberately: it now flies on
 * `t.wall` whether or not the transport is frozen. The hand-rolled tick was
 * gated on `!state.freeze` and so froze the free camera with the game, which
 * is backwards -- freeze stops *game* time, and a frozen frame is exactly the
 * one `Tick.wall` exists to carry.
 */

import { PerspectiveCamera, Vector3 } from "three";
import type { System, Tick } from "../core/system";
import type { RenderContext } from "./context";

const MOVE_KEYS: Record<string, [number, number, number]> = {
  KeyW: [0, 0, -1],
  KeyS: [0, 0, 1],
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  KeyE: [0, 1, 0],
  KeyQ: [0, -1, 0],
};

export class FreeRoam implements System<RenderContext> {
  readonly id = "render.freeroam";
  enabled = false;
  /** Units per second at speed 1. Stage 2 spans about 6700 units. */
  speed = 60;

  private yaw = 0;
  private pitch = 0;
  private readonly pos = new Vector3();
  private readonly keys = new Set<string>();
  private dragging = false;
  private readonly el: HTMLElement;
  private readonly move = new Vector3();

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
  }

  dispose(): void {
    this.el.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.el.removeEventListener("wheel", this.onWheel);
  }

  /** Start free roam from wherever the scripted camera currently is. */
  adoptFrom(camera: PerspectiveCamera): void {
    this.pos.copy(camera.position);
    const dir = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    this.yaw = Math.atan2(-dir.x, -dir.z);
  }

  update(ctx: RenderContext, t: Tick): void {
    if (!this.enabled) return;
    this.fly(ctx.camera, t.wall);
  }

  /**
   * Put the camera where free roam says it is.
   *
   * Off, it does the opposite and takes its own pose from the camera, so the
   * next entry into free roam starts from the shot the rebuild produced.
   */
  resync(ctx: RenderContext): void {
    if (!this.enabled) {
      this.adoptFrom(ctx.camera);
      return;
    }
    this.fly(ctx.camera, 0);
  }

  /** One step of the fly cam. `dt` of zero re-places without moving. */
  private fly(camera: PerspectiveCamera, dt: number): void {
    // YXZ so yaw turns about world up and pitch about the camera's own right
    // axis; no roll can accumulate from mouse movement.
    camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");

    let x = 0, y = 0, z = 0;
    for (const code of this.keys) {
      const v = MOVE_KEYS[code];
      if (v) { x += v[0]; y += v[1]; z += v[2]; }
    }
    if (x || y || z) {
      const boost = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")
        ? 6
        : this.keys.has("AltLeft") ? 0.2 : 1;
      const dist = this.speed * boost * dt;
      if (x || z) {
        this.move.set(x, 0, z).normalize()
          .applyQuaternion(camera.quaternion).multiplyScalar(dist);
        this.pos.add(this.move);
      }
      // Q/E are world-vertical, which is what people expect of a fly cam.
      if (y) this.pos.y += y * dist;
    }
    camera.position.copy(this.pos);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled || e.button !== 0) return;
    this.dragging = true;
    this.el.setPointerCapture(e.pointerId);
  };

  private onUp = () => {
    this.dragging = false;
  };

  private onMove = (e: PointerEvent) => {
    if (!this.enabled || !this.dragging) return;
    this.yaw -= e.movementX * 0.0035;
    this.pitch -= e.movementY * 0.0035;
    const lim = Math.PI / 2 - 1e-3;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.speed = Math.max(2, Math.min(2000, this.speed * (e.deltaY > 0 ? 1.15 : 0.87)));
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return;
    this.keys.add(e.code);
    if (this.enabled && (MOVE_KEYS[e.code] || e.code.startsWith("Shift"))) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
}

/**
 * Is this keystroke the page's, or the focused control's?
 *
 * `BUTTON` is in the list for a reason that is not obvious from the name: the
 * browser activates a focused button on **Space**, and the transport's play
 * button dispatches `pause`/`play` when it is activated. So Space with the
 * play button focused ran the shortcut *and* clicked the button, and playback
 * toggled twice — which reads as the key doing nothing at all.
 *
 * `web/tools/shot.mjs` blurs the active element before it sends any key, and
 * that workaround is the evidence: it was written because the shortcut did
 * not work after a click. It stays, because blurring before a scripted
 * keystroke is right whatever this function says.
 */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
    tag === "BUTTON" || el.isContentEditable;
}

/**
 * Free-roam camera: orbit with the mouse, fly with WASD.
 *
 * Detached from the rail entirely, so it can go where no `cam/` path does.
 * Stage geometry is loaded whole for this mode -- region visibility is off in
 * free roam, because a region holds only the handful of models the game draws
 * from one point on the rail and the rest of the level would simply not be
 * there.
 */

import { PerspectiveCamera, Vector3 } from "three";

const MOVE_KEYS: Record<string, [number, number, number]> = {
  KeyW: [0, 0, -1],
  KeyS: [0, 0, 1],
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  KeyE: [0, 1, 0],
  KeyQ: [0, -1, 0],
};

export class FreeRoam {
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

  update(dt: number, camera: PerspectiveCamera): void {
    if (!this.enabled) return;
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

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
    el.isContentEditable;
}

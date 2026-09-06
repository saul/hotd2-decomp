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
 *
 * ## The pointer is captured, and the drag is still there
 *
 * Turning with a held button ran the cursor off the element and then off the
 * window, which is what the Pointer Lock API exists for: a click in the
 * viewport locks the pointer to the **canvas**, and while it is locked every
 * mouse move is a look. Escape releases it -- the browser does that itself and
 * tells the document, so there is no key bound here -- and so does leaving
 * free roam, which is why `enabled` is an accessor rather than a field.
 *
 * The lock is asked for and never assumed. `requestPointerLock` needs a user
 * gesture, so it is asked for from `pointerdown` and nowhere else, and a
 * browser may still say no: Chrome refuses for about a second after an Escape,
 * and an embedded or headless context may refuse outright. So the drag path is
 * kept exactly as it was and `movementX`/`movementY` drive the look either
 * way. **A refusal is not an error here**: it means the viewer turns the
 * camera by holding the button, which is what they did before, so it clears
 * the pending flag and is otherwise not reported. There is nowhere honest to
 * report it to -- no panel reads it -- and a field nothing reads is a claim
 * about the design that nothing checks.
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
  /** Units per second at speed 1. Stage 2 spans about 6700 units. */
  speed = 60;

  private yaw = 0;
  private pitch = 0;
  private readonly pos = new Vector3();
  private readonly keys = new Set<string>();
  private dragging = false;
  private readonly el: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly move = new Vector3();

  /**
   * Free roam is on. An accessor rather than a field because **turning it off
   * has to release things**: the pointer lock, the keys held down, and the
   * drag. `Player.setMode` assigns it exactly as it did when it was a field.
   */
  private on = false;
  /** The browser has the pointer locked to the canvas. */
  private locked = false;
  /** A lock has been asked for and `pointerlockchange` has not answered yet. */
  private locking = false;
  constructor(el: HTMLElement, canvas: HTMLElement = el) {
    this.el = el;
    this.canvas = canvas;
    el.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("pointerlockerror", this.onLockError);
    // A key held when the window loses focus never gets its `keyup`, so it
    // would fly for ever. Alt-tabbing out of a locked pointer is the ordinary
    // way to produce that.
    window.addEventListener("blur", this.onBlur);
  }

  get enabled(): boolean { return this.on; }

  set enabled(v: boolean) {
    if (v === this.on) return;
    this.on = v;
    if (!v) this.release();
  }

  /**
   * Let go of everything a free-roam session holds.
   *
   * The lock is asked about the **document** rather than read off `locked`,
   * because `locked` is only ever as true as the last `pointerlockchange`:
   * the document is the owner of that fact and this is the one place where
   * believing a stale copy would leave a viewer with a captured cursor over a
   * mode that has no use for one.
   */
  private release(): void {
    this.keys.clear();
    this.dragging = false;
    if (this.locking || document.pointerLockElement === this.canvas) {
      this.locked = false;
      document.exitPointerLock?.();
    }
  }

  dispose(): void {
    this.el.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.el.removeEventListener("wheel", this.onWheel);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("pointerlockerror", this.onLockError);
    window.removeEventListener("blur", this.onBlur);
    this.release();
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

  /**
   * A click in the viewport captures the pointer to the canvas.
   *
   * This is the user gesture the Pointer Lock API insists on — a lock may only
   * be asked for from a handler with transient activation behind it, so it is
   * asked for here and nowhere else. The drag path is **kept** rather than
   * replaced: the browser can refuse (Chrome refuses for about a second after
   * an Escape released the last one, and a sandboxed or headless context may
   * refuse outright), and a viewer whose lock was refused should still be able
   * to turn the camera by holding the button.
   */
  private onDown = (e: PointerEvent) => {
    if (!this.on || e.button !== 0) return;
    this.dragging = true;
    // Not while locked: there is no pointer position to capture, and Chrome
    // throws `InvalidPointerId` for a pointer the locked document never had.
    if (!this.locked) this.el.setPointerCapture(e.pointerId);
    this.requestLock();
  };

  private onUp = () => {
    this.dragging = false;
  };

  /**
   * Turn the camera.
   *
   * Locked, every mouse move is a look — that is the whole point of the lock,
   * and `movementX`/`movementY` are the only coordinates a locked pointer has,
   * which is why the drag path was already written against them.
   */
  private onMove = (e: PointerEvent) => {
    if (!this.on || !(this.locked || this.dragging)) return;
    this.yaw -= e.movementX * 0.0035;
    this.pitch -= e.movementY * 0.0035;
    const lim = Math.PI / 2 - 1e-3;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  };

  /**
   * Ask for the lock, and take a refusal for an answer.
   *
   * `requestPointerLock` returns a promise in current Chrome and nothing at
   * all in older engines, so the result is inspected rather than awaited: an
   * unhandled rejection here would be a console error on a page whose only
   * fault is that the browser said no.
   */
  private requestLock(): void {
    if (this.locked || this.locking) return;
    if (typeof this.canvas.requestPointerLock !== "function") return;
    this.locking = true;
    const r: unknown = this.canvas.requestPointerLock();
    if (r instanceof Promise) r.catch(() => { this.locking = false; });
  }

  /**
   * The browser's answer, and the only thing that sets `locked`.
   *
   * Escape arrives here too: the browser exits the lock itself and tells the
   * document, so there is no key to bind. Losing the lock also ends the drag,
   * or a viewer who pressed Escape mid-drag would still be turning.
   */
  private onLockChange = () => {
    this.locking = false;
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) this.dragging = false;
  };

  private onLockError = () => {
    this.locking = false;
    this.locked = false;
  };

  private onBlur = () => {
    this.keys.clear();
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.speed = Math.max(2, Math.min(2000, this.speed * (e.deltaY > 0 ? 1.15 : 0.87)));
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (ownsKey(e.target, e.code)) return;
    this.keys.add(e.code);
    if (this.on && (MOVE_KEYS[e.code] || e.code.startsWith("Shift"))) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
}

/**
 * `<input>` types that are **not** text entry: a control that happens to be
 * spelled `<input>`. Everything else — `text`, `search`, `number`, the date
 * and time family, and any type a future browser adds — is somewhere a person
 * types, and typing owns every key.
 */
const INPUT_CONTROLS = new Set([
  "button", "checkbox", "color", "file", "image", "radio", "range", "reset",
  "submit",
]);

/** What the browser activates a focused control with. */
const ACTIVATION_KEYS = new Set(["Space", "Enter", "NumpadEnter"]);

/** What a focused `<input type=range>` — the scrubber, the volume — acts on. */
const RANGE_KEYS = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "Home", "End", "PageUp", "PageDown",
]);

/**
 * Is the viewer typing into something?
 *
 * Text entry, and only text entry: a `<textarea>`, a contenteditable, a
 * `<select>` — whose type-ahead is letters — and an `<input>` that is not one
 * of the controls above. A focused text box owns **every** key, including the
 * ones this player would otherwise bind.
 */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (tag !== "INPUT") return false;
  const type = ((el as HTMLInputElement).type || "text").toLowerCase();
  return !INPUT_CONTROLS.has(type);
}

/**
 * Is this keystroke the focused control's, or the page's?
 *
 * **A control claims the keys it acts on and no others**, and getting that
 * wrong is what this function was written to fix. It used to be `isTyping`
 * alone, and `isTyping` counted a focused `BUTTON` as typing — for a real
 * reason: the browser activates a focused button on **Space**, and the
 * transport's play button dispatches `pause`/`play` when it is activated, so
 * Space with the play button focused ran the shortcut *and* clicked the
 * button and playback toggled twice, which reads as the key doing nothing.
 *
 * The cure was worse than the disease. Free roam is entered by clicking the
 * **Free roam** button, which then holds focus, so every subsequent keystroke
 * had a `BUTTON` as its target and both keydown handlers returned before
 * looking at the code: `FreeRoam` never added W to its held set and the camera
 * never moved. The same held after clicking any checkbox in the sidebar. The
 * bug report read "as if some other element is capturing the keys", and that
 * is exactly what was happening — a button that acts on Space was being let
 * swallow the alphabet.
 *
 * So the question is asked about the **key**, not only about the element. A
 * button, a link and a `<summary>` take Space and Enter; a range input takes
 * those and the arrows and Home/End, which is what makes the scrubber
 * keyboard-usable next to a player that binds the arrows itself; a text box
 * takes everything.
 *
 * `web/tools/shot.mjs` blurs the active element before it sends any key. That
 * workaround is the evidence this was wrong — it was written because the
 * shortcuts did not work after a click — and it stays, because blurring
 * before a scripted keystroke is right whatever this function says.
 */
export function ownsKey(target: EventTarget | null, code: string): boolean {
  if (isTyping(target)) return true;
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  const type = tag === "INPUT"
    ? ((el as HTMLInputElement).type || "text").toLowerCase()
    : "";
  if (type === "range") {
    return ACTIVATION_KEYS.has(code) || RANGE_KEYS.has(code);
  }
  if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY" || tag === "INPUT") {
    return ACTIVATION_KEYS.has(code);
  }
  return false;
}

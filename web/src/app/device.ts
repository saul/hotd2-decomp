/**
 * The phone as a light gun.
 *
 * `[port-only]` throughout: the cabinet has a gun and the PC build a mouse,
 * and neither has a touch screen or a gyroscope. What this file does is map a
 * phone onto the gun the engine already understands, without inventing any
 * input the engine does not have:
 *
 * * **A tap is a trigger pull.** Nothing here: pointer events already carry
 *   touches, and `render/shooting.ts` fires on a `pointerdown` whatever made
 *   it. A tap in the black bars beside the 4:3 frame is a pull *off the
 *   screen*, which is how the gun reloads (`MouseGunResolvePull`,
 *   `FUN_0041EB30`) -- that half is in `Shooting` too.
 * * **A flick of the wrist is also a pull off the screen.** Tipping the top of
 *   the phone sharply towards you or away is the nearest a hand holding a
 *   phone comes to jerking a gun off the screen, and it is the one reload a
 *   player can make without taking a thumb off the glass. {@link TiltReload}
 *   hears it and calls the same `offscreenPull` the right mouse button and
 *   `R` do, so the engine sees exactly one kind of reload.
 * * **Fullscreen, landscape, and the motion sensors** are all things a browser
 *   grants only inside a press, which is why {@link unlockDevice} is called
 *   from the start screen's button and from nowhere a frame could reach.
 *
 * `devicemotion` needs a secure context: over plain `http://` on a LAN
 * address the event never fires, and a second finger (`render/shooting.ts`)
 * is the reload that is left. `localhost` counts as secure; a phone pointed at
 * a dev machine does not, without HTTPS.
 *
 * **The two phones differ in one call each.** iOS Safari asks permission for
 * the motion sensors (`DeviceMotionEvent.requestPermission`) and has no
 * element fullscreen or orientation lock, so the page's turn-your-phone notice
 * is what holds it sideways. Android Chrome asks nothing for the sensors and
 * honours `screen.orientation.lock` once the page is fullscreen, which is the
 * order {@link unlockDevice} asks in. Both report `rotationRate` in degrees a
 * second, and both deliver touches as pointer events.
 */

/**
 * How fast the phone has to pitch to count as a flick, in degrees a second.
 *
 * Holding a phone steady and turning it to follow the action peaks well under
 * a hundred; a deliberate snap of the wrist is several hundred. The gap is
 * wide, and the number sits in it on the high side on purpose -- a reload
 * nobody asked for costs the rounds left in the magazine, and one that took a
 * second try costs a flick. Not a number from the exe: there is no gyroscope
 * in it.
 */
const FLICK_DEG_PER_S = 300;

/**
 * One flick, one reload. A snap forward and back is two peaks a few tens of
 * milliseconds apart, and the second one is not a second reload.
 */
const FLICK_COOLDOWN_MS = 600;

/**
 * The screen's rotation from the device's natural orientation, in degrees:
 * 0, 90, 180 or 270. `screen.orientation` where there is one, the old iOS
 * `window.orientation` where there is not, and null when neither says.
 */
function screenAngle(): number | null {
  const so = typeof screen !== "undefined" ? screen.orientation : undefined;
  if (so && typeof so.angle === "number") return ((so.angle % 360) + 360) % 360;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? ((legacy % 360) + 360) % 360 : null;
}

/**
 * How fast the top of the *screen* is tipping towards or away from the
 * viewer, in degrees a second, sign discarded.
 *
 * `rotationRate` is in the device's own frame: `beta` about its x axis, which
 * is the screen's horizontal while the phone is upright, and `gamma` about
 * its y axis, which is the screen's horizontal once it is turned on its side.
 * So the axis follows the screen's rotation. When the browser will not say
 * which way the screen is turned, the larger of the two -- a sideways swing
 * then counts as well, which is the cheaper of the two ways to be wrong.
 */
export function pitchRate(beta: number | null, gamma: number | null,
                          angle: number | null): number {
  const b = Math.abs(beta ?? 0);
  const g = Math.abs(gamma ?? 0);
  if (angle === null) return Math.max(b, g);
  return angle % 180 === 0 ? b : g;
}

/**
 * Reload on a flick. Listens only once {@link listen} is called, which is
 * only ever from inside a press -- iOS will not deliver the events otherwise.
 */
export class TiltReload {
  private listening = false;
  private last = -Infinity;

  constructor(private readonly onReload: () => void) {}

  listen(): void {
    if (this.listening || typeof window === "undefined") return;
    if (!("DeviceMotionEvent" in window)) return;
    this.listening = true;
    window.addEventListener("devicemotion", this.onMotion);
  }

  private readonly onMotion = (e: DeviceMotionEvent): void => {
    const r = e.rotationRate;
    if (!r) return;
    if (pitchRate(r.beta, r.gamma, screenAngle()) < FLICK_DEG_PER_S) return;
    // The page's clock rather than the event's: `timeStamp` on a sensor event
    // has been zero, or on a different epoch, in more than one browser.
    const now = performance.now();
    if (now - this.last < FLICK_COOLDOWN_MS) return;
    this.last = now;
    this.onReload();
  };
}

/** A finger rather than a mouse: the only devices any of this is for. */
function touchFirst(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;
}

interface MotionPermission {
  requestPermission?: () => Promise<"granted" | "denied">;
}

interface LockableOrientation {
  lock?: (o: "landscape") => Promise<void>;
}

function lockLandscape(): void {
  const so = screen.orientation as unknown as LockableOrientation | undefined;
  so?.lock?.("landscape").catch(() => { /* not allowed here; the hint shows */ });
}

/**
 * Everything a first press unlocks on a touch screen: the motion sensors, and
 * a fullscreen landscape game. Nothing at all on a desktop.
 *
 * **Call it synchronously inside a press.** Each of the three calls below is
 * refused outside one, and a promise or a timer in between is outside one.
 *
 * The permission prompt comes first because it is iOS's and iOS has no
 * element fullscreen on a phone, so on the device that asks, nothing else
 * competes for the press; Android asks nothing, and gets fullscreen and then
 * the lock, which Android only honours in fullscreen. Every refusal is
 * swallowed: the game plays without any of them, and the stylesheet's
 * turn-your-phone notice covers a lock that did not take.
 */
export function unlockDevice(tilt: TiltReload): void {
  if (!touchFirst()) return;
  const motion = (window as unknown as { DeviceMotionEvent?: MotionPermission })
    .DeviceMotionEvent;
  if (typeof motion?.requestPermission === "function") {
    motion.requestPermission()
      .then((s) => { if (s === "granted") tilt.listen(); })
      .catch(() => { /* refused: the side bars still reload */ });
  } else {
    tilt.listen();
  }
  const root = document.documentElement;
  if (!document.fullscreenElement && typeof root.requestFullscreen === "function") {
    root.requestFullscreen({ navigationUI: "hide" })
      .then(lockLandscape)
      .catch(() => { /* refused; the page still fills the window */ });
  } else {
    lockLandscape();
  }
}

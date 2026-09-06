/**
 * Does free roam actually fly, and does the pointer actually lock?
 *
 * Both halves of this file exist because a green `tsc` and a green
 * `vite build` said nothing about either. WASD in free roam was dead for as
 * long as anyone had been entering free roam the obvious way — by clicking the
 * **Free roam** button — because the button kept focus and `isTyping` counted
 * a focused `BUTTON` as typing, so both keydown handlers returned before they
 * looked at the key. Nothing in the tree could see that: the handler is
 * correct, the fly cam is correct, the system is registered, and the only
 * thing wrong was which element the browser said the event was for. It takes
 * a real browser, a real click and a real keystroke.
 *
 * Eight assertions, and each one is a thing that was or could be wrong:
 *
 *  1. entered from the **keyboard** (`3`), holding W moves the camera. The
 *     control case — this always worked, and it is what made the bug look
 *     like it was not there;
 *  2. entered by **clicking the Free roam button**, holding W moves the
 *     camera. This is the bug as reported;
 *  3. after clicking into the script tree's filter box, W does **not** move
 *     the camera — a text box owns every key, and the fix must not take that
 *     away;
 *  4. and clicking back on the viewport gives the keys back;
 *  5. **Space with a button focused still activates only the button.** That
 *     is why `BUTTON` was in `isTyping` in the first place, and the fix is
 *     only right if it kept that: the play button toggles playback once, not
 *     twice;
 *  6. a click in the viewport **asks** for a lock on the canvas;
 *  7. if the browser grants it, the pointer is locked to the canvas and a
 *     locked move turns the camera with no button held — the half
 *     `movementX`/`movementY` exists for, which the drag path cannot cover;
 *  8. and leaving free roam releases the lock.
 *
 * The camera is read from the Camera panel's own projection — `eye` and
 * `yaw` — because there is no page handle on the player and this check is
 * deliberately not a reason to add one.
 *
 *   node tools/freeroam.mjs --headless
 *
 * **Asking for a lock and getting one are two different claims, and only the
 * first is about this code.** Whether a lock is granted is browser policy and
 * it moves under you: Chrome refuses on an unfocused window, refuses for about
 * a second after an Escape, and refuses outright in some embedded contexts.
 * Written as a hard assertion it fails on a clean tree, and a check that does
 * that gets ignored, which is worse than not having it.
 *
 * So the request itself is hooked and asserted everywhere — remove the
 * `requestPointerLock` call and this fails on any machine — and the two
 * assertions that need a *granted* lock are reported as SKIP, with the
 * browser's own refusal quoted, when there is none. Skips are counted and
 * named separately from passes for the reason `verify_all.py` counts them
 * that way: a skip that reads as green is how a check comes to be believed
 * on a machine that never ran it.
 *
 * Exit status is 0 when nothing failed, 1 when something did, and 3 when the
 * whole run asserted nothing.
 */
import { openPlayer, waitForLoad } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);

const stage = opt("stage", "1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let bad = 0;
let ran = 0;
const skipped = [];
const check = (what, ok, detail = "") => {
  ran++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) bad++;
};
/** An assertion the browser would not let us make. Never a pass. */
const skip = (what, why) => {
  console.log(`  SKIP  ${what} — ${why}`);
  skipped.push(what);
};

const { page, close } = await openPlayer({
  url: `?stage=${stage}`,
  size: "1280x800",
  headless: flag("headless"),
  quiet: true,
  // The page asking for a lock is this code's behaviour and is checkable on
  // any machine; the browser granting one is not. Hooking the request is what
  // separates the two, and it has to be in place before the app's first line.
  init: () => {
    window.__lockAsks = [];
    window.__lockRefused = null;
    const real = Element.prototype.requestPointerLock;
    Element.prototype.requestPointerLock = function (...rest) {
      window.__lockAsks.push(this.tagName + (this.id ? `#${this.id}` : ""));
      return real.apply(this, rest);
    };
    document.addEventListener("pointerlockerror",
      () => { window.__lockRefused = "the browser refused it"; });
  },
});

/**
 * The camera as the Camera panel publishes it: the eye, and the heading.
 *
 * The panel is a `<details>` whose `open` is React's, and its rows are a
 * demanded slice of the projection — so it is re-asserted and then waited for
 * rather than read once. A reading that is simply missing must never be
 * allowed to look like a camera that did not move: `moved` would return a
 * number, and `< 0.5` would call it a pass.
 */
async function camera() {
  const deadline = Date.now() + 4000;
  for (;;) {
    const v = await page.evaluate(() => {
      const p = document.querySelector("#panel-camera");
      if (p && !p.hasAttribute("open")) p.setAttribute("open", "");
      const txt = p?.innerText ?? "";
      const e = /eye\s+(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/.exec(txt);
      const y = /yaw\s+(-?[\d.]+)°/.exec(txt);
      return { eye: e ? [+e[1], +e[2], +e[3]] : null, yaw: y ? +y[1] : null };
    });
    if (v.eye || Date.now() > deadline) return v;
    await sleep(100);
  }
}

/** How far the eye went, or `NaN` when either end had no reading at all. */
const moved = (a, b) => a.eye && b.eye
  ? Math.hypot(b.eye[0] - a.eye[0], b.eye[1] - a.eye[1], b.eye[2] - a.eye[2])
  : NaN;

const focused = () => page.evaluate(() => {
  const a = document.activeElement;
  if (!a) return "none";
  return a.tagName + (a.id ? `#${a.id}` : a.className ? `.${a.className}` : "");
});

const mode = () => page.evaluate(() =>
  document.querySelector("button.mode.active")?.innerText ?? "?");

/** Hold W for a while, and say how far the camera went. */
async function flyW(ms = 500) {
  const before = await camera();
  await page.keyboard.down("KeyW");
  await sleep(ms);
  await page.keyboard.up("KeyW");
  await sleep(150);
  return moved(before, await camera());
}

try {
  await waitForLoad(page);
  // A click somewhere inert, then a blur, so the run starts from the state a
  // freshly loaded page is in rather than from whatever the last step left.
  await page.click("body");
  await page.evaluate(() => document.activeElement?.blur?.());
  // The panel is the only place the camera is published. `open` rather than a
  // click on the summary, so the run does not start by focusing something.
  await page.evaluate(() => {
    const p = document.querySelector("#panel-camera");
    if (p && !p.hasAttribute("open")) p.setAttribute("open", "");
  });
  await sleep(300);

  console.log("free roam");

  // 1. The control case: free roam from the keyboard, nothing focused.
  await page.keyboard.press("Digit3");
  await sleep(250);
  const byKey = await flyW();
  check("W flies after entering free roam with the 3 key",
        byKey > 1, `moved ${byKey.toFixed(1)} units`);

  // 2. The bug as reported: free roam from the button, which keeps focus.
  await page.keyboard.press("Digit2");
  await sleep(200);
  await page.click("button.mode >> text=Free roam");
  await sleep(250);
  const focus2 = await focused();
  const byClick = await flyW();
  check("W flies after clicking the Free roam button",
        byClick > 1, `focus ${focus2}, moved ${byClick.toFixed(1)} units`);

  // 3. A text box still owns every key. The script tree's filter is the one
  //    text input on the page, and it is behind the tree's own panel.
  await page.click("#tree-filter");
  await sleep(150);
  const focus3 = await focused();
  const whileTyping = await flyW(400);
  check("W does not fly while the filter box has focus",
        focus3.startsWith("INPUT") && whileTyping >= 0 && whileTyping < 0.5,
        `focus ${focus3}, moved ${whileTyping.toFixed(1)} units`);

  // 4. ...and clicking back on the viewport gives the keys back.
  await page.click("#viewport", { position: { x: 400, y: 300 } });
  await sleep(200);
  const backAgain = await flyW();
  check("W flies again after clicking back on the viewport",
        backAgain > 1, `focus ${await focused()}, ` +
        `moved ${backAgain.toFixed(1)} units`);

  // 6a. That click was in the viewport in free roam, so it must have asked
  //     for a lock on the canvas. This is the assertion with teeth: it holds
  //     wherever the check runs, granted or not.
  const asks = await page.evaluate(() => window.__lockAsks ?? []);
  check("a click in the viewport asks for a lock on the canvas",
        asks.some((t) => t.startsWith("CANVAS")),
        asks.length ? `asked on ${asks.join(", ")}` : "never asked");

  // 6b. Whether it was granted is the browser's business. When it was, the
  //     two things that need a real lock are asserted; when it was not, they
  //     are skipped by name rather than failed, because the refusal is not a
  //     fact about this code.
  const lock = await page.evaluate(() => {
    const el = document.pointerLockElement;
    return el ? el.tagName + (el.id ? `#${el.id}` : "") : null;
  });
  const refused = await page.evaluate(() => window.__lockRefused);
  if (lock === null) {
    const why = refused ?? "the browser granted no lock";
    skip("the pointer is locked to the canvas", why);
    skip("a locked pointer turns the camera with no button held", why);
  } else {
    check("the pointer is locked to the canvas", lock.startsWith("CANVAS"),
          `locked to ${lock}`);
    // A locked pointer has no coordinates, only deltas, so the look has to
    // ride `movementX`/`movementY` with no button held. This is the half the
    // drag path cannot cover.
    const beforeLook = await camera();
    await page.mouse.move(700, 400);
    await page.mouse.move(500, 400);
    await sleep(200);
    const afterLook = await camera();
    const turned = beforeLook.yaw === null || afterLook.yaw === null
      ? -1
      : Math.abs(afterLook.yaw - beforeLook.yaw);
    check("a locked pointer turns the camera with no button held",
          turned > 0.5, `yaw ${beforeLook.yaw}° -> ${afterLook.yaw}°`);
  }

  // 6c. ...and leaving free roam gives it back, whether or not it was granted.
  await page.keyboard.press("Digit2");
  await sleep(250);
  const afterLeave = await page.evaluate(() => !!document.pointerLockElement);
  check("leaving free roam releases the pointer", !afterLeave,
        `mode is now ${await mode()}`);

  // 5. The regression the old rule was there to stop. Space with the play
  //    button focused must toggle playback exactly once: the browser clicks
  //    the button, and the page's own shortcut must stand aside.
  const playing = () => page.evaluate(() =>
    document.querySelector('button[title^="Play / pause"]')?.innerText.trim());
  await page.click('button[title^="Play / pause"]');
  await sleep(200);
  const before5 = await playing();
  await page.keyboard.press("Space");
  await sleep(250);
  const after5 = await playing();
  check("Space with the play button focused toggles playback once",
        before5 !== after5 && !!before5,
        `${before5} -> ${after5}, focus ${await focused()}`);
} finally {
  await close();
}

// A skip is never folded into the pass line. `verify_all.py` counts them
// apart for the same reason, and exit 3 is this repo's "asserted nothing".
const tail = skipped.length
  ? ` (${skipped.length} skipped: ${skipped.join("; ")})` : "";
console.log(bad ? `\n${bad} failed${tail}`
                : `\n${ran} passed${tail}`);
process.exit(bad ? 1 : (ran ? 0 : 3));

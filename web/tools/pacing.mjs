/**
 * Does the loop run when it should, and **stop** when it should?
 *
 * `app/loop.ts` says the simulation is a fixed 60 Hz tick that is never
 * skipped, and that a debt worth skipping is never allowed to form because the
 * clock stops instead: the tab goes into the background, or the transport is
 * paused, and the player stops asking for frames altogether. That last part is
 * the risky half. A loop that sleeps has to be woken by everything that
 * changes what is on screen, and a waker that is missing does not throw, does
 * not fail a type check and does not fail any headless test — it just leaves a
 * panel showing something that is no longer true.
 *
 * So this drives the **real page, not driven** — no `?drive=1`, the ordinary
 * wall-clock loop a person gets — and asserts the four things the sleep
 * depends on:
 *
 *  1. playing, the page asks for frames and the game advances;
 *  2. paused, it stops asking, and the game does not advance;
 *  3. a keypress while paused wakes it for a frame or two and no more;
 *  4. and the game still did not advance, because a wake is a redraw and not
 *     a tick;
 *  5. **and a click made while paused is drawn, and does nothing else.** Two
 *     defects met here. The waker was written into `Pacer`'s own list of
 *     obligations and never called: `onFire` pushed onto `g_shot_requests` and
 *     returned, so the click sat in the queue until some other waker happened
 *     to run. And once it was woken, `GameSystem` drained the queue on the
 *     frozen tick, so the shot resolved — hit points, score, and three effect
 *     rings that only a game tick can empty, which meant the loop then had
 *     feedback in flight that could never finish and never went back to sleep.
 *     Nothing else could have caught either: the queue is correct, the drain
 *     is correct, and no frame was asked for.
 *
 * The page's own `requestAnimationFrame` is counted by wrapping it before the
 * app boots, from outside the module graph — see the `init` option in
 * `lib/player.mjs`. Nothing in `src/` knows this exists, which is the point:
 * an instrument that the instrumented code can see is not measuring the thing
 * a player gets.
 *
 *   node tools/pacing.mjs --headless
 *
 * Exit status is 0 only if every assertion held.
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
const check = (what, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) bad++;
};

/** Frames the page has asked for, and the game frame it has reached. */
async function probe(page) {
  return page.evaluate(() => {
    const t = document.querySelector("#transport")?.innerText ?? "";
    // The transport bar's own readout: `cp_st1[0] slot 32 frame 79 / 230`.
    // The camera path's frame is the one number on the page that moves once
    // per *game* frame, which is exactly what has to be distinguished from a
    // frame that was merely drawn.
    const m = /frame\s+(\d+)\s*\/\s*(\d+)/.exec(t);
    return {
      raf: window.__pacingRaf ?? -1,
      frame: m ? Number(m[1]) : -1,
    };
  });
}

const { page, close } = await openPlayer({
  url: `?stage=${stage}`,
  size: "1280x800",
  headless: flag("headless"),
  quiet: true,
  // Before the app's first line. A counter and nothing else.
  init: () => {
    window.__pacingRaf = 0;
    const real = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      window.__pacingRaf++;
      return real(cb);
    };
  },
});

try {
  await waitForLoad(page);
  await page.click("body");

  console.log("\nPlaying, the loop runs and the game advances:\n");
  await page.keyboard.press("Space");
  await sleep(300);
  const a = await probe(page);
  await sleep(1000);
  const b = await probe(page);
  const playRaf = b.raf - a.raf;
  const playFrames = b.frame - a.frame;
  check("the page asked for a second's worth of frames",
        playRaf > 20, `${playRaf} in ~1s`);
  check("...and the game advanced", playFrames > 0,
        `frame ${a.frame} -> ${b.frame}`);
  // The whole of the fixed tick, in one number. On a 60 Hz display one drawn
  // frame runs one 60 Hz tick, so these two agree; if the port were still
  // integrating a fraction of a frame off the rAF delta they would not have
  // to, and before this they did not.
  check("...one drawn frame, one simulated frame",
        Math.abs(playRaf - playFrames) <= 2,
        `${playRaf} drawn, ${playFrames} simulated`);

  console.log("\nPaused, it stops asking:\n");
  await page.keyboard.press("Space");
  // Long enough for the sprites from any stray click to die and the loop to
  // find nothing left to do.
  await sleep(700);
  const c = await probe(page);
  await sleep(1000);
  const d = await probe(page);
  const idleRaf = d.raf - c.raf;
  check("the loop is asleep", idleRaf <= 2, `${idleRaf} frames in ~1s`);
  check("...and the game did not advance", d.frame === c.frame,
        `frame ${c.frame} -> ${d.frame}`);

  console.log("\nAn input wakes it, for a frame and not a tick:\n");
  // A key the player binds nothing to. Every bound key changes a mode or the
  // address, and two of them — Step mode among them — legitimately start the
  // loop again, because in Step mode the port keeps running while the script
  // stands still. This asks the narrower question: does the *waking* work,
  // with nothing else riding on it.
  await page.keyboard.press("KeyZ");
  await sleep(400);
  const e = await probe(page);
  const wakeRaf = e.raf - d.raf;
  check("the input was drawn", wakeRaf >= 1, `${wakeRaf} frames`);
  check("...and it did not start the loop again", wakeRaf <= 4,
        `${wakeRaf} frames`);
  check("...and no game time passed", e.frame === d.frame,
        `frame ${d.frame} -> ${e.frame}`);

  console.log("\nA shot fired while paused is drawn:\n");
  // Shooting used to be off by default, and with it off a viewport click did
  // nothing at all -- so this assertion could pass on a page where the shot
  // path never ran. It is always on now; the settle stays, because the click
  // below has to land on a loop that has already gone quiet.
  await sleep(400);
  const f = await probe(page);
  await sleep(500);
  const g = await probe(page);
  check("...the loop went back to sleep first", g.raf - f.raf <= 2,
        `${g.raf - f.raf} frames in ~0.5s`);

  // The middle of the viewport, which is where the crosshair is. Whether it
  // hits anything is not the question; `fire` runs either way, and with the
  // clock stopped the composition root refuses to make it input at all.
  const box = await page.locator("#viewport").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(400);
  const h = await probe(page);
  const shotRaf = h.raf - g.raf;
  check("the shot was drawn", shotRaf >= 1, `${shotRaf} frames`);
  check("...and no game time passed", h.frame === g.frame,
        `frame ${g.frame} -> ${h.frame}`);

  // **The property that matters is that it stops.** `Player.wantsFrame` keeps
  // asking while `Shooting.busy` -- and that reads the port's effect pools,
  // which `ShotEffectsTick` steps on *game* time. So a shot that resolved with
  // the clock stopped filled those pools with records nothing could ever
  // retire, and this line measured 60 frames in a second, for ever. It is the
  // reason a shot resolving on a frozen tick was not merely wrong on paper.
  await sleep(1000);
  const i = await probe(page);
  check("...and the loop went back to sleep after the feedback",
        i.raf - h.raf <= 2, `${i.raf - h.raf} frames in ~1s`);
  check("...still no game time", i.frame === g.frame,
        `frame ${g.frame} -> ${i.frame}`);
} finally {
  await close();
}

console.log(bad ? `\n${bad} failed` : "\nthe loop runs and stops when it should");
process.exit(bad ? 1 : 0);

/**
 * Do the looping sound effects actually loop in the page, and survive a seek?
 *
 *     node tools/loops.mjs
 *
 * Every other check in this tree can be green while the ambience is missing.
 * `verify_looping_se.py` proves the two EXE tables pair up; `seek.test.ts`
 * proves the **walker** remembers what should be sounding. Neither gets near
 * an `<audio>` element, and the bug this was written for lived exactly there:
 * playing stage 1 from the top gave rain, and opening the same stage at a deep
 * link past the `se_play` that starts it gave silence for the rest of the
 * scene.
 *
 * So it taps `window.Audio` before the app boots, records every element the
 * page makes, and samples `loop`, `paused` and `currentTime` once a second. A
 * loop that never starts, never wraps, or stops early is visible in the
 * cursor.
 *
 * Two runs, because the difference between them *was* the bug: the same stage
 * from the top and from a deep link past the instruction that starts the loop.
 */
import { openPlayer, waitForLoad } from "./lib/player.mjs";

/** Stage 1's rain: `se_play STAGE1_SE\RAIN3ST_44.wav` at block 0 step 1 op 42. */
const LOOP_FILE = "RAIN3ST_44.wav";
const FROM_TOP = "?stage=1&mode=play";
const DEEP_LINK = "?stage=1&mode=play&block=0&step=2&op=10";

const TAP = () => {
  const seen = [];
  const Native = window.Audio;
  window.Audio = function Tapped(...a) {
    const el = new Native(...a);
    seen.push(el);
    return el;
  };
  window.Audio.prototype = Native.prototype;
  window.__snap = () => seen.map((e) => ({
    src: e.src.replace(/^.*\/(se|bgm|voice)\//i, "$1/"),
    loop: e.loop, paused: e.paused,
    t: Number(e.currentTime.toFixed(2)),
  })).filter((e) => e.src);
};

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : ` -- ${detail}`}`);
};

async function run(label, url, seconds) {
  const { page, browser } = await openPlayer({
    url, size: "1280x800", headless: !process.argv.includes("--head"),
    quiet: true, init: TAP,
  });
  const cursors = [];
  try {
    await waitForLoad(page);
    // The gesture and the unmute in one real click: browsers block playback
    // until a gesture, and the store cannot supply one.
    await page.locator("button.sound").click();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Space");
    for (let s = 0; s < seconds; s++) {
      await page.waitForTimeout(1000);
      const snap = await page.evaluate(() => window.__snap());
      const el = snap.find((e) => e.loop && e.src.includes(LOOP_FILE));
      cursors.push(el ? { t: el.t, paused: el.paused } : null);
    }
  } finally {
    await browser.close();
  }
  console.log(`\n  ${label}: ${cursors.map((c) => (c ? c.t : "-")).join(" ")}`);
  return cursors;
}

// From the top: the loop starts, and the cursor **goes backwards** at least
// once, which is the only direct evidence that it wrapped rather than stopped.
const top = await run("from the top", FROM_TOP, 6);
check("playing from the top starts the loop",
      top.some((c) => c !== null), "no looping element for the ambience");
const live = top.filter((c) => c !== null).map((c) => c.t);
check("...and it wraps rather than running out",
      live.some((t, i) => i > 0 && t < live[i - 1]), live.join(" "));

// The deep link: the `se_play` is stepped over by the replay, so this is the
// one the walker's record has to reconstitute.
const deep = await run("by a deep link", DEEP_LINK, 3);
check("a deep link past the `se_play` still has the loop",
      deep.some((c) => c !== null),
      "the seek replayed the instruction silently and told the mixer nothing");

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);

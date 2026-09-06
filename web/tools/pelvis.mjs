/**
 * The pelvis, in the running player, at an exact frame.
 *
 * `SkeletonNodeDrawSuppressed` (`FUN_004122E0`) stops bone 9's own model being
 * drawn on the ten character types whose vertex-blended skirt draws that same
 * model. Both halves of that are invisible to every headless check: the veto is
 * about **two models in the same place**, which no count can see, and the skin
 * is about where a vertex ends up after the renderer has had its turn.
 *
 * Stage 3's boat is the frame to look at, because it carries one of each side
 * by side: the passenger at script address 4128 is character type `0x3B`,
 * which is one of the ten, and 4252 is `0x3C`, which is not. Same shot, same
 * lighting, same distance.
 *
 *     node tools/pelvis.mjs --headless --at 700 --out pelvis_after
 *
 * Output goes to `web/shots/`, which is gitignored -- a screenshot of a stage
 * is derived game art and this repository commits none.
 *
 * **A second headless Chrome on the machine steals the audio device**, so if
 * another harness is running, a silent run here is contention and not
 * evidence. Nothing in this file reads audio, but the note belongs with the
 * tools that boot a browser.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const stage = opt("stage", "3");
const marks = opt("at", "700").split(",").map(Number);
const out = opt("out", "pelvis");
/** `x,y,w,h` in canvas pixels, to crop in on the thing being compared. */
const clip = opt("clip", null);

const { page, close } = await openPlayer({
  url: opt("url", null) ?? `?stage=${stage}&mode=play&drive=1`,
  size: opt("size", "1280x800"),
  headless: flag("headless"),
  quiet: true,
});

try {
  await waitForLoad(page);
  // The walker only advances while the transport is running, driven clock or
  // not. Blur first: Space on a just-clicked control goes to the control.
  await page.keyboard.press("Space");
  await page.evaluate(() => document.activeElement?.blur?.());

  mkdirSync(SHOTS, { recursive: true });
  let at = 0;
  for (const f of marks) {
    if (f > at) {
      await page.evaluate((n) => window.__hotd2Drive.advance(n), f - at);
      at = f;
    }
    await page.evaluate(() =>
      new Promise((r) => requestAnimationFrame(() => r())));
    const path = resolve(SHOTS, `${out}_${f}.png`);
    const shot = { path };
    if (clip) {
      const [x, y, width, height] = clip.split(",").map(Number);
      shot.clip = { x, y, width, height };
    }
    await page.locator("canvas").first().screenshot(shot);
    console.log(`frame ${f} -> ${path}`);
  }
} finally {
  await close();
}

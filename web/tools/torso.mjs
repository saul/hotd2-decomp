/**
 * A shot `char_adv02`, photographed.
 *
 * The reported symptom is *"char_adv02 zombies seem to lose their midriff on
 * one shot"*, and the half of it that was open until now is that the damaged
 * torso model is chest-only: slots `0x1B70` and `0x1B71` stop at `y 1.35`,
 * the pelvis tops out at `-0.45`, and what fills the band is a **second draw**
 * in class 0x30's own per-bone hook — a thirty-cel flipbook at `0x1B52`. See
 * `game/class30/bonecels.ts`.
 *
 * None of that is visible to a headless check: it is about whether a model is
 * on the screen, in a place, after the renderer has had its turn. So this
 * drives the real page, shoots the zombies stage 2's block 28 puts in front of
 * the camera, and photographs the result every few shots.
 *
 *     node tools/torso.mjs --headless --out torso_after
 *
 * Output goes to `web/shots/`, which is gitignored -- a screenshot of a stage
 * is derived game art and this repository commits none.
 *
 * **A second headless Chrome on the machine contends for the GPU and the audio
 * device** (L29); a run that produces nothing is contention before it is
 * evidence.
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

/** Stage 2's block 28 steps 4 and 5 spawn four `char_adv02` between them. */
const url = opt("url", "?stage=2&mode=play&block=28&step=5&drive=1");
const out = opt("out", "torso");
/** Frames to let the spawn walk into frame before the first shot. */
const settle = Number(opt("settle", "120"));
/** Shots to fire, and how many frames between them. */
const shots = Number(opt("shots", "18"));
const gap = Number(opt("gap", "12"));
/** Photograph after every this many shots. */
const every = Number(opt("every", "3"));

const { page, close } = await openPlayer({
  url, size: opt("size", "1280x800"),
  headless: flag("headless"), quiet: true,
});

try {
  await waitForLoad(page);
  await page.keyboard.press("Space");
  await page.evaluate(() => document.activeElement?.blur?.());

  const dir = resolve(SHOTS, out);
  mkdirSync(dir, { recursive: true });
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();

  await page.evaluate((n) => window.__hotd2Drive.advance(n), settle);
  await canvas.screenshot({ path: `${dir}/s00_unshot.png` });

  // A column sweep down the middle third of the frame: a zombie walking at the
  // camera is somewhere in it, and the torso is the largest target on the way
  // down. Nothing here knows where an actor is on screen -- there is no
  // projection seam and inventing one for a screenshot tool would be a seam
  // nobody asked for -- so this is a sweep and the pictures are the evidence.
  const cols = 5;
  const rows = 3;
  for (let i = 0; i < shots; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols) % rows;
    await page.mouse.click(
      box.x + box.width * (0.3 + (0.4 * (c + 0.5)) / cols),
      box.y + box.height * (0.35 + (0.3 * (r + 0.5)) / rows));
    await page.evaluate((n) => window.__hotd2Drive.advance(n), gap);
    if ((i + 1) % every === 0) {
      const path = `${dir}/s${String(i + 1).padStart(2, "0")}.png`;
      await canvas.screenshot({ path });
      console.log(`after ${i + 1} shots -> ${path}`);
    }
  }
} finally {
  await close();
}

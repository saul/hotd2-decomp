/**
 * A screenshot of the running player, so what it actually looks like can be
 * looked at.
 *
 * Every other check here reads the source or renders to a string. None of them
 * loads the page, and the failures this project keeps meeting are exactly the
 * ones that survive a green `tsc` and a green `vite build`: a column that does
 * not appear, a stylesheet rule that styles nothing, a canvas drawing into a
 * node nothing is showing. This is the check that is a pair of eyes.
 *
 * Booting Chrome on its own vite server is `tools/lib/player.mjs`, shared with
 * `playthrough.mjs` — see the note there on why it is shared rather than
 * copied. What is left here is the driving and the shutter.
 *
 * Nothing in `web/src/` knows this exists. The player is already addressable
 * by URL — stage, block, step, op, mode, slot, frame, freeze — and "the page
 * has settled" is `#loading` leaving the DOM, so no seam into the app is
 * needed to reach a state or to know it has been reached. If one is ever
 * needed for a state the URL cannot name, it goes in `app/harness.ts` and it
 * may do nothing a `UiCommand` cannot.
 *
 *   node tools/shot.mjs --out cold
 *   node tools/shot.mjs --url '?stage=2&block=12&op=0&freeze=1' --out wait
 *   node tools/shot.mjs --el '#right' --out sidebar
 *
 * Output goes to `web/shots/`, which is gitignored: a screenshot of a stage is
 * derived game art, and this repository does not commit game assets.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const url = opt("url", "");
const out = opt("out", "shot");
const el = opt("el");
const waitFor = opt("wait");
const [w, h] = (opt("size", "1600x1000")).split("x").map(Number);
/** Milliseconds to keep playing before the shot, for a frame mid-animation. */
const settle = Number(opt("settle", "0"));
const headless = flag("headless");

const { page, state, close } = await openPlayer({
  url, size: opt("size", "1600x1000"), headless,
});

try {

  // The bundle and the stage are fetched after the first paint, so the page
  // is not itself until the overlay goes. This is the whole of the timing:
  // no fixed wait anywhere, because a fixed wait is a race with a pass rate.
  await waitForLoad(page, waitFor);
  // Drive it. A stage sitting at its entry block has simulated nothing, so a
  // shot of frame zero is a shot of a scene with no actors in it yet -- press
  // Space, give it some seconds, and what comes back is the game running.
  for (const sel of opt("click", "").split(",").filter(Boolean)) {
    await page.click(sel);
  }
  // Blur first, and it is not a nicety. The player's shortcuts are on
  // `window` and skip the event when something typable has focus, so a key
  // pressed straight after a click goes to the control instead -- Space on a
  // just-clicked checkbox toggles it back off, which reads as "the toggle does
  // not work" and is really "the harness undid it".
  if (opt("press")) await page.evaluate(() => (document.activeElement)?.blur?.());
  for (const key of opt("press", "").split(",").filter(Boolean)) {
    await page.keyboard.press(key);
  }
  if (settle > 0) await page.waitForTimeout(settle);
  // A second round, after the game has been running for a while: the state
  // worth photographing is often reached by doing something *to* a running
  // game rather than to a freshly loaded one.
  for (const sel of opt("then", "").split(",").filter(Boolean)) {
    await page.click(sel);
  }
  const after = Number(opt("after", "0"));
  if (after > 0) await page.waitForTimeout(after);
  // One more frame, so the shot is of a frame that has been through the whole
  // of `Player.frame` — render, then publish — and not of a half-applied one.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));

  // Read text out of the page. A panel is often narrower than what it is
  // saying -- the actor rows ellipsise exactly where the interesting number
  // is -- and a screenshot of a truncated row is not evidence.
  for (const sel of opt("dump", "").split(",").filter(Boolean)) {
    const text = await page.locator(sel).first().innerText().catch(() => null);
    console.log(`--- ${sel} ---\n${text ?? "(no such element)"}`);
  }

  mkdirSync(SHOTS, { recursive: true });
  const path = resolve(SHOTS, `${out}.png`);
  const target = el ? page.locator(el) : page;
  await target.screenshot({ path });
  console.log(`wrote ${path}`);
} finally {
  await close();
}
process.exit(state.faults ? 1 : 0);

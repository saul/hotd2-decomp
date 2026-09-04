/**
 * Camera continuity: the largest single-frame turn the drawn camera makes.
 *
 * A cut between shots is a hard turn of tens of degrees in one frame, and
 * nothing else in this repo measures one. `test:camera` checks that a path
 * *seats* where the exe's own evaluation puts it; this checks what happens
 * between two shots, which is the half a seat cannot see.
 *
 * It reads the camera out of the Camera panel's own projection, because the
 * player exposes no handle on itself, and it measures the **angle** of
 * (look-at - eye). The point alone is the wrong measure: `TurnLookAtToward`
 * turns a direction and re-projects it, so the look-at point slides tens of
 * units along the ray without the camera moving at all -- which sent one
 * investigation of this chasing a 49-unit "jump" that was a 0-degree one.
 *
 *   npm run lookat                       # stage 1, block 3 step 3
 *   PROBE_URL="?stage=2&mode=play" SECS=20 npm run lookat
 *
 * Needs a bundle and playwright, like `pacing.mjs`, so it is not in
 * `verify_all.py`.
 */
import { openPlayer, waitForLoad, enableShooting } from "./lib/player.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.env.PROBE_URL ?? "?stage=1&mode=play&block=3&step=3";
const SECS = Number(process.env.SECS ?? 12);
const { page, close } = await openPlayer({ url: URL, size: "1280x800",
                                           headless: true });
try {
  await waitForLoad(page);
  await page.click("body");
  await page.evaluate(() => document.activeElement?.blur?.());
  // **Shooting on, or there is no fight.** With it off `WalkerHost.aliveEnemies`
  // answers null and every live-enemy gate passes on the spot -- including the
  // `wait_enemies_alive 0` this shot is supposed to sit through. Measuring the
  // camera across a fight that did not happen measures nothing.
  if (process.env.NO_SHOOT !== "1") await enableShooting(page);
  // Start the transport. Without this the loop is asleep and nothing is drawn.
  await page.keyboard.press("Space");
  await sleep(400);
  // Hook the render loop from outside the module graph and record the camera's
  // world matrix each drawn frame -- the pose a viewer actually sees.
  await page.evaluate(() => {
    const panel = document.querySelector("#panel-camera");
    if (panel && !panel.hasAttribute("open")) panel.setAttribute("open", "");
  });
  await sleep(200);
  // There is no page handle on the player, so the camera is read from the one
  // place it is published: the Camera panel's own projection. `eye` and
  // `look at` are what a viewer is looking along.
  await page.evaluate(() => {
    window.__cam = [];
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => {
      cb(t);
      const txt = document.querySelector("#panel-camera")?.innerText ?? "";
      const m = /eye\s+(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)[\s\S]*?look at\s+(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/.exec(txt);
      if (!m) { window.__cam.push(null); return; }
      const n = m.slice(1).map(Number);
      const d = [n[3] - n[0], n[4] - n[1], n[5] - n[2]];
      const L = Math.hypot(...d) || 1;
      const sf = /slot\s+(\d+)\s+frame\s+([\d.]+)\s*\/\s*(\d+)/.exec(txt);
      const addr = (document.querySelector("#panel-wait")?.innerText ?? "")
        .replace(/\s+/g, " ").slice(0, 90);
      window.__cam.push([d[0] / L, d[1] / L, d[2] / L, n[0], n[1], n[2],
                         sf ? +sf[1] : -1, sf ? +sf[2] : -1, addr]);
    });
  });
  await sleep(SECS * 1000);
  const cam = await page.evaluate(() => window.__cam);
  const good = cam.filter(Boolean);
  console.log(`${URL}: ${cam.length} frames, ${good.length} with a camera`);
  if (!good.length) { console.log("  (no window.__player -- see note)"); }
  let worst = 0, at = -1, turns = [];
  for (let i = 1; i < good.length; i++) {
    const a = good[i - 1], b = good[i];
    const d = Math.acos(Math.max(-1, Math.min(1,
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
    turns.push(d);
    if (d > worst) { worst = d; at = i; }
  }
  console.log("  around the worst frame:");
  for (let i = Math.max(1, at - 3); i <= Math.min(good.length - 1, at + 3); i++) {
    const a = good[i - 1], b = good[i];
    const d = Math.acos(Math.max(-1, Math.min(1,
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
    console.log(`    f${String(i).padStart(4)} turn=${d.toFixed(2).padStart(6)}`
      + ` slot=${b[6]} camframe=${b[7]}`
      + ` eye=(${b[3].toFixed(0)},${b[4].toFixed(0)},${b[5].toFixed(0)})`
      + `  ${b[8]}`);
  }
  turns.sort((x, y) => x - y);
  console.log(`  worst single-frame turn: ${worst.toFixed(2)} deg at frame ${at}`);
  console.log(`  median ${turns[turns.length >> 1]?.toFixed(3)} deg,`
    + ` 99th ${turns[Math.floor(turns.length * 0.99)]?.toFixed(2)} deg`);
} finally { await close(); }

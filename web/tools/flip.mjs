/**
 * Does anything about stage 3's boat passengers alternate frame to frame?
 *
 * Throwaway probe for the "flipping between two poses on alternating frames"
 * half of the boat report. Traces every driven frame of the canal shot and
 * looks, per actor, for a value that changes sign every frame -- which is what
 * two writers to one transform, or a pose read off a value updated every other
 * frame, looks like from outside.
 *
 *     node tools/flip.mjs --headless
 *     node tools/flip.mjs --headless --shots --out flip-before
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

const CANAL_SLOT = opt("slot", "122");
const SEARCH = 6000;
const STEP = 20;
const SAMPLE = Number(opt("frames", "900"));

const { page, close } = await openPlayer({
  url: `?stage=${opt("stage", "3")}&mode=play&drive=1`,
  size: "960x600",
  headless: flag("headless"),
  quiet: true,
  init: () => {
    for (const id of ["panel-camera", "panel-scene", "panel-props"]) {
      localStorage.setItem(`hod2.ui.${id}`, "true");
    }
  },
});

const row = (panel, label) => page.evaluate(([p, k]) => {
  const lines = (document.getElementById(p)?.innerText ?? "").split("\n");
  const i = lines.indexOf(k);
  return i >= 0 ? lines[i + 1] : null;
}, [panel, label]);

try {
  await waitForLoad(page);
  await page.keyboard.press("Space");
  await page.evaluate(() => document.activeElement?.blur?.());

  let at = 0;
  let found = null;
  if (!flag("from-start")) {
    for (let n = 0; n < SEARCH && found === null; n += STEP) {
      await page.evaluate((k) => window.__hotd2Drive.advance(k), STEP);
      at += STEP;
      if (await row("panel-camera", "slot") === CANAL_SLOT) found = at;
    }
    console.log(`cam slot ${CANAL_SLOT} from driven frame ${found}`);
  }

  if (flag("shots")) {
    const dir = resolve(SHOTS, opt("out", "flip"));
    mkdirSync(dir, { recursive: true });
    const canvas = page.locator("canvas").first();
    const skip = Number(opt("skip", "0"));
    if (skip) await page.evaluate((n) => window.__hotd2Drive.advance(n), skip);
    for (let i = 0; i < Number(opt("shots-n", "6")); i++) {
      await canvas.screenshot(
        { path: `${dir}/f${String(i).padStart(2, "0")}.png` });
      await page.evaluate(() => window.__hotd2Drive.advance(1));
    }
    console.log(`shots in ${dir}`);
  }

  if (flag("sweep")) {
    const dir = resolve(SHOTS, opt("out", "flip-sweep"));
    mkdirSync(dir, { recursive: true });
    const canvas = page.locator("canvas").first();
    const every = Number(opt("every", "100"));
    const burst = Number(opt("burst", "6"));
    const total = Number(opt("sweep-frames", "2400"));
    for (let base = 0; base < total; base += every) {
      for (let i = 0; i < burst; i++) {
        await canvas.screenshot({
          path: `${dir}/s${String(at + base).padStart(5, "0")}`
                + `_f${String(i).padStart(2, "0")}.png` });
        await page.evaluate(() => window.__hotd2Drive.advance(1));
      }
      await page.evaluate((n) => window.__hotd2Drive.advance(n),
                          Math.max(0, every - burst));
    }
    console.log(`sweep in ${dir}`);
  }

  await page.evaluate(() => window.__hotd2Drive.trace(true));
  for (let n = 0; n < SAMPLE; n += 60) {
    await page.evaluate((k) => window.__hotd2Drive.advance(k),
                        Math.min(60, SAMPLE - n));
  }
  const rows = await page.evaluate(() => window.__hotd2Drive.drain());
  await page.evaluate(() => window.__hotd2Drive.trace(false));

  const parse = (o) => {
    const m = /^(\d+) c(\d+) s(-?\d+)\.(-?\d+) h(-?\d+) @(-?\d+),(-?\d+),(-?\d+) y(-?\d+)/
      .exec(o);
    return m && { at: Number(m[1]), cls: Number(m[2]),
                  state: `${m[3]}.${m[4]}`,
                  x: Number(m[6]), y: Number(m[7]), z: Number(m[8]),
                  yaw: Number(m[9]) };
  };

  // Per actor, per field, count frames where the delta reverses sign and the
  // step is the same size both ways -- a two-state oscillation.
  const series = new Map();
  for (const r of rows) {
    for (const o of r.o) {
      const p = parse(o);
      if (!p) continue;
      if (!series.has(p.at)) series.set(p.at, []);
      series.get(p.at).push({ f: r.f, ...p });
    }
  }
  console.log(`\n${rows.length} frames, ${series.size} actors`);
  for (const [key, s] of [...series].sort((a, b) => a[0] - b[0])) {
    for (const field of ["x", "y", "z", "yaw"]) {
      let flips = 0;
      for (let i = 2; i < s.length; i++) {
        const d1 = s[i - 1][field] - s[i - 2][field];
        const d2 = s[i][field] - s[i - 1][field];
        if (d1 !== 0 && d2 !== 0 && Math.sign(d1) !== Math.sign(d2)
            && Math.abs(d1 + d2) < Math.abs(d1) / 4) flips++;
      }
      if (flips > s.length / 8) {
        const amp = Math.max(...s.map((r) => r[field]))
                  - Math.min(...s.map((r) => r[field]));
        console.log(`  ${key} c${s[0].cls} ${field}: ${flips}/${s.length}`
                    + ` alternating, range ${amp}`);
      }
    }
  }
} finally {
  await close();
}

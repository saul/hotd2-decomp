/**
 * **Do the civilians move?** In a real browser, on the real bundle, with eyes.
 *
 * `docs/BUGS.md` carries a report that says "civilians seem to be missing
 * their root motion", and the answer to a report about something you can see
 * is a picture and a number that came from the same run — L19 and L25. This
 * deep-links to the block that spawns them, drives whole game frames through
 * `?drive=1` rather than the wall clock (L12, and `PLAYER_HANGS` item 8),
 * samples every class-0x10 row's `at (x,z) · root on|off · scale n` line, and
 * writes a screenshot at each end of the sample.
 *
 *   node tools/civ_walk.mjs [--stage 1] [--block 1] [--step 8] [--frames 600]
 *                           [--out civ_walk] [--headless]
 *
 * Three outcomes, and only one of them is a bug:
 *
 * * `root on` and the position changes — her clip is carrying her.
 * * `root off` and it does not — **the engine's own answer.**
 *   `CivilianRunScript` clears `model+0x64` bit 1 for any block whose wait
 *   word has no `0x00100000`, and 297 of the 596 shipped wait words do not.
 *   Those clips animate in place.
 * * `root on` and the position never changes — the report.
 *
 * A denormal scale is the other failure it fails on, and that one needs no
 * judgement: nothing in the game's data can produce one. Ops 0x1B, 0x23, 0x24
 * and 0x25 falling through into `SetScale`'s body did, for 125 commands across
 * the shipped streams, and `AsFloat(2)` is 2.8e-45.
 *
 * Output goes to `web/shots/`, which is gitignored — a frame of this game is
 * derived art and this repository commits none.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);

const stage = Number(opt("stage", "1"));
/**
 * Stage 1 block 1 step 8 is the rescue `root_motion.ts` is written around: the
 * civilian at 6184 (`hito_fem`, type 37) and her one captor. `spawn_obj_c` at
 * that address is what puts her in the pool -- step 7 spawns the scenery and
 * no class 0x10, which is worth knowing because "no civilian rows" and "the
 * civilians do not move" look the same from outside.
 */
const block = Number(opt("block", "1"));
const step = Number(opt("step", "8"));
const frames = Number(opt("frames", "900"));
const out = opt("out", "civ_walk");

const { page, state, close } = await openPlayer({
  url: `?stage=${stage}&block=${block}&step=${step}&mode=play&drive=1&seed=1`,
  size: "1600x1000", headless: flag("headless"),
});

/**
 * Every civilian row the Actors panel is showing.
 *
 * The panel is the player's own readout and not a back door: `CivilianDebug`
 * puts the position and the gate in the row precisely so this question can be
 * asked from outside the engine, and the tool reads the same characters a
 * person reads off the screen.
 */
const sample = () => page.evaluate(() => {
  for (const d of document.querySelectorAll("details")) {
    d.setAttribute("open", "");
  }
  const txt = document.querySelector("#panel-actors")?.innerText ?? "";
  const rows = [];
  // The actor's own address leads its row — `0x1868 hito_gal · d=42` — and it
  // is the only part of the row that does not change while she plays, so it
  // is what the two samples are matched on. Keying on the whole line matched
  // nothing, because the line carries the cursor.
  let name = "?";
  for (const line of txt.split("\n")) {
    const head = /^(0x[0-9A-Fa-f]{3,4}) (\S+)/.exec(line.trim());
    if (head) name = `${head[1]} ${head[2]}`;
    const m =
      /at \((-?[\d.]+),(-?[\d.]+)\) · root (on|off) · scale ([\d.e+-]+)/
        .exec(line);
    if (m) rows.push({ name, x: +m[1], z: +m[2], root: m[3], scale: +m[4] });
  }
  return rows;
});

let exit = 1;
try {
  await waitForLoad(page);
  const version = await page.evaluate(
    () => globalThis.__hotd2Drive?.version ?? null);
  if (version === null) {
    throw new Error("the page has no drive seam — see web/src/app/harness.ts");
  }
  // **Space, or nothing happens.** `?mode=play` picks the mode; it does not
  // start the clock, and a deep link lands paused. Without this the tool ran
  // 1,200 driven frames with the walker parked on `1/8/0`, every actor on clip
  // frame 0 and the camera path on frame 191 of 219 — and reported that the
  // civilian had not moved, which was true of the tool and not of the game.
  // `playthrough.mjs` presses it too, and that is where this was found.
  await page.keyboard.press("Space");
  const advance = (n) =>
    page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);

  mkdirSync(SHOTS, { recursive: true });
  // **Sampled all the way through rather than at two ends**, because a
  // civilian is spawned by the step she belongs to and removed when it is
  // over: a "before" taken at a fixed frame caught an empty pool and a
  // "moved" of `NaN`, which reads as a pass in anything less careful than a
  // NaN-safe comparison. Every row's first and last sighting is what is
  // compared, and each is a frame she was actually in the pool.
  const seen = new Map();
  const STRIDE = 10;
  let shot = 0;
  for (let f = 0; f < frames; f += STRIDE) {
    await advance(STRIDE);
    for (const r of await sample()) {
      const e = seen.get(r.name);
      if (!e) seen.set(r.name, { first: r, last: r, frames: 1 });
      else { e.last = r; e.frames += 1; }
    }
    // One picture early and one late, both of them frames a civilian is in.
    if (seen.size && shot < 2 && (shot === 0 || f > frames * 0.6)) {
      writeFileSync(resolve(SHOTS,
                            `${out}_${shot === 0 ? "before" : "after"}.png`),
                    await page.screenshot({ type: "png" }));
      shot += 1;
    }
  }

  let moved = 0, gated = 0, stuck = 0;
  const after = [...seen.values()];
  console.log(`\n${after.length} civilian rows over ${frames} game frames:`);
  for (const e of after) {
    const a = e.last, b = e.first;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (a.root === "off") gated += 1;
    else if (!(d > 0.5)) stuck += 1;
    else moved += 1;
    console.log(`  ${a.name.padEnd(26)} root ${a.root.padEnd(3)} `
      + `scale ${String(a.scale).padEnd(8)} moved ${d.toFixed(2)}`
      + ` over ${e.frames * STRIDE} frames`
      + `   (${b.x.toFixed(0)},${b.z.toFixed(0)})`
      + ` -> (${a.x.toFixed(0)},${a.z.toFixed(0)})`);
  }
  console.log(`\n${moved} carried by their clips, ${gated} gated off by their `
    + `script, ${stuck} say root on and did not move`);
  console.log(`shots -> ${SHOTS}/${out}_{before,after}.png`);

  const denormal = after.filter((e) => e.last.scale > 0
                                 && e.last.scale < 1e-6);
  if (denormal.length) {
    console.log(`\nFAIL ${denormal.length} rows carry a denormal scale`);
  } else if (!after.length) {
    console.log("\nFAIL no civilian rows — wrong block, or nothing spawned");
  } else if (stuck) {
    console.log(`\nFAIL ${stuck} civilians whose clip may carry them and `
      + "did not move");
  } else {
    exit = 0;
  }
} finally {
  await close();
}
process.exit(exit || (state.faults ? 1 : 0));

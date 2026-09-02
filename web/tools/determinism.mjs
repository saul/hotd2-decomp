/**
 * Does the same stage, on the same seed, with the same shots on the same
 * frames, produce the same run?
 *
 * `docs/PLAYER_HANGS.md` item 8 says it did not: stage 1 gave four different
 * outcomes over five runs on identical code and an identical route. Until that
 * is gone, no other item on that list can be investigated honestly — you
 * cannot tell a fix from a coin landing your way. **This is the check that can
 * fail.**
 *
 * It runs the real page twice, over `?drive=1` — see `web/src/app/harness.ts`
 * — so that game time advances only when this asks, and only in whole 60 Hz
 * frames. Every input is scheduled by **frame number** and nothing at all is
 * scheduled by milliseconds; the shots go through the same pointer events on
 * `#viewport` a player's do. Then it diffs the two per-frame traces and exits
 * non-zero on the first frame that differs, printing both sides.
 *
 * The trace is **game state only**: the frame, the walker's address, the RNG's
 * whole state, `g_frame`, the gate counters, and one digest per live actor —
 * class, state, sub, quantised position, hit points. No render state, no
 * audio, no wall time. A trace that carried any of those would be measuring
 * the browser.
 *
 * The input schedule is fixed and state-blind on purpose. `playthrough.mjs`
 * reads the HUD and decides what to do; that is the right shape for a
 * playthrough and the wrong shape here, because a check for determinism must
 * not have a decision in it that could itself vary. So: a key on these frames,
 * a volley on those, whatever the game happens to be doing.
 *
 *   node tools/determinism.mjs --stage 1 --headless
 *   node tools/determinism.mjs --stage 2 --frames 9000 --runs 3 --headless
 *
 * Exit status is 0 only if every run traced identically.
 */
import { openPlayer, waitForLoad, enableShooting } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);

const STAGE = opt("stage", "1");
const SEED = opt("seed", "1");
/** Game frames to run. 3600 is a minute of game time. */
const FRAMES = Number(opt("frames", "6000"));
const RUNS = Number(opt("runs", "2"));
const SIZE = opt("size", "1280x800");
const HEADLESS = flag("headless");
/** How often a skip is taken, in frames. `Enter` is the player's own binding. */
const SKIP_EVERY = Number(opt("skip-every", "60"));
/** How often a volley is fired, in frames. */
const VOLLEY_EVERY = Number(opt("volley-every", "90"));
/** The most frames run between two trace drains. Memory, nothing else. */
const CHUNK = 120;

/**
 * The input schedule: what happens, and on which **frame**.
 *
 * Not a millisecond anywhere. Two runs of this list put the same pointer event
 * on the same game frame, which is the whole premise of the check — under the
 * driven clock the game is stopped between two `advance` calls, so an event
 * dispatched there lands at an exact frame boundary and cannot interleave with
 * a tick.
 */
function schedule(frames) {
  const ev = new Map();
  const at = (f, a) => {
    if (f <= 0 || f > frames) return;
    if (!ev.has(f)) ev.set(f, []);
    ev.get(f).push(a);
  };
  for (let f = SKIP_EVERY; f <= frames; f += SKIP_EVERY) at(f, "skip");
  for (let f = VOLLEY_EVERY; f <= frames; f += VOLLEY_EVERY) at(f, "volley");
  return ev;
}

/** The same grid `playthrough.mjs` sprays, through the same real shot path. */
async function volley(page, box) {
  const COLS = 5, ROWS = 4;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      await page.mouse.click(box.x + (box.width * (c + 0.5)) / COLS,
                             box.y + (box.height * (r + 0.5)) / ROWS);
    }
  }
}

/** One row, as the one string the diff compares. */
const canon = (r) => `${r.f} ${r.a} rng=${r.r} g=${r.g} ${r.c} | `
                   + r.o.join(" ; ");

/** One run of the real page, start to finish. Returns its trace. */
async function once(label) {
  const { page, state, close } = await openPlayer({
    url: `?stage=${STAGE}&drive=1&seed=${SEED}`,
    size: SIZE, headless: HEADLESS, quiet: true,
  });
  try {
    await waitForLoad(page);
    const version = await page.evaluate(
      () => globalThis.__hotd2Drive?.version ?? null);
    if (version === null) {
      throw new Error("the page has no drive seam — is ?drive=1 wired up?");
    }
    await enableShooting(page);
    await page.keyboard.press("Space");
    await page.evaluate(() => globalThis.__hotd2Drive.trace(true));
    const box = await page.locator("#viewport").boundingBox();
    if (!box) throw new Error("#viewport has no box");

    const ev = schedule(FRAMES);
    const rows = [];
    let f = 0;
    while (f < FRAMES) {
      // Run up to the next scheduled frame, never past it.
      let next = FRAMES;
      for (const k of ev.keys()) if (k > f && k < next) next = k;
      const step = Math.min(CHUNK, next - f);
      await page.evaluate((n) => globalThis.__hotd2Drive.advance(n), step);
      f += step;
      rows.push(...await page.evaluate(
        () => globalThis.__hotd2Drive.drain()));
      for (const a of ev.get(f) ?? []) {
        if (a === "skip") await page.keyboard.press("Enter");
        if (a === "volley") await volley(page, box);
      }
    }
    process.stdout.write(`  ${label}: ${rows.length} frames traced`
                         + `${state.faults ? `, ${state.faults} console errors`
                                           : ""}\n`);
    return rows.map(canon);
  } finally {
    await close();
  }
}

console.log(`stage ${STAGE}, seed ${SEED}, ${FRAMES} frames, ${RUNS} runs`);
console.log(`  input: Enter every ${SKIP_EVERY} frames, `
            + `a 20-shot volley every ${VOLLEY_EVERY} — by frame, not by ms`);

const runs = [];
for (let i = 0; i < RUNS; i++) runs.push(await once(`run ${i + 1}`));

let bad = 0;
for (let i = 1; i < runs.length; i++) {
  const a = runs[0], b = runs[i];
  const n = Math.min(a.length, b.length);
  let at = -1;
  for (let k = 0; k < n; k++) {
    if (a[k] !== b[k]) { at = k; break; }
  }
  if (at < 0 && a.length !== b.length) at = n;
  if (at < 0) continue;
  bad++;
  console.log(`\nrun 1 and run ${i + 1} DIVERGE at trace index ${at}`);
  if (at >= n) {
    console.log(`  run 1 traced ${a.length} frames, run ${i + 1} traced `
                + `${b.length} — one of them ran a different number of frames`);
  } else {
    // The frame before it, so the difference can be read as a change rather
    // than as a pair of unrelated lines.
    if (at > 0) console.log(`  both, one frame earlier:\n    ${a[at - 1]}`);
    console.log(`  run 1:\n    ${a[at]}`);
    console.log(`  run ${i + 1}:\n    ${b[at]}`);
  }
}

if (bad) {
  console.log(`\n${bad} of ${RUNS - 1} comparisons differ. The stage is NOT `
              + `reproducible.`);
  process.exit(1);
}
console.log(`\n${RUNS} runs, ${runs[0].length} frames each, identical.`);
process.exit(0);

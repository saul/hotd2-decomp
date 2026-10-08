/**
 * Do the looping sound effects actually loop in the page, and survive a seek?
 *
 *     node tools/loops.mjs
 *
 * Every other check in this tree can be green while the ambience is missing.
 * `web/tools/checks/looping_se.ts` proves the two EXE tables pair up; `seek.test.ts`
 * proves the **walker** remembers what should be sounding. Neither gets near
 * an `<audio>` element, and the bug this was written for lived exactly there:
 * playing stage 1 from the top gave rain, and opening the same stage at a deep
 * link past the `se_play` that starts it gave silence for the rest of the
 * scene.
 *
 * So it taps Web Audio before the app boots -- every `AudioBufferSourceNode`
 * the page starts, with its buffer's length, its `loop` flag and when it
 * started -- and samples four times a second. A loop that never starts, never
 * wraps, or stops early is visible in what it records. Each run stops sampling
 * once what it asks has been seen -- the wrap, the node -- and otherwise
 * samples for as long as it always did.
 *
 * **A node, not an element.** Since the AAC set (`audio/aac.ts`) a looping SE
 * is a buffer looped whole (`Bgm.loops`), on the WAV path and the AAC one
 * alike, and this used to tap `window.Audio` -- so it found no element on
 * either and failed on both. The rain is told from the other looped buffer,
 * the music, by its **length**: the WAV's data frames over its rate, which is
 * what the index records for the AAC copy and what a WAV decode keeps however
 * it resamples.
 *
 * Two runs, because the difference between them *was* the bug: the same stage
 * from the top and from a deep link past the instruction that starts the loop.
 */
import { openPlayer, requireBundle, waitForLoad } from "./lib/player.mjs";

requireBundle("loops");

/** Stage 1's rain: `se_play STAGE1_SE\RAIN3ST_44.wav` at block 0 step 1 op 42. */
const LOOP_FILE = "RAIN3ST_44.wav";
const FROM_TOP = "?stage=1&mode=play";
const DEEP_LINK = "?stage=1&mode=play&block=0&step=3&op=10";

const TAP = () => {
  const seen = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    const rec = { node: this, dur: this.buffer?.duration ?? 0, loop: this.loop,
                  t0: this.context.currentTime, done: false };
    this.addEventListener("ended", () => { rec.done = true; });
    seen.push(rec);
    return start.apply(this, a);
  };
  const stop = AudioScheduledSourceNode.prototype.stop;
  AudioScheduledSourceNode.prototype.stop = function (...a) {
    const rec = seen.find((r) => r.node === this);
    if (rec) rec.done = true;
    return stop.apply(this, a);
  };
  window.__snap = () => seen.map((r) => ({
    dur: r.dur, loop: r.loop, done: r.done,
    played: Number((r.node.context.currentTime - r.t0).toFixed(2)),
  }));
};

/**
 * The rain's length in seconds, as the page's server holds it: the AAC
 * index's true frame count when there is an index, else the WAV's own data
 * chunk. Either way the frames the engine's static buffer holds.
 */
async function loopSeconds(origin) {
  const key = `se/stage1_se/${LOOP_FILE.toLowerCase()}`;
  const index = await fetch(new URL("/sounds.json", origin)).catch(() => null);
  if (index?.ok) {
    const e = (await index.json()).files?.[key];
    if (e) return { seconds: e.frames / e.rate, via: "sounds.json" };
  }
  const b = new Uint8Array(await (await fetch(new URL(`/${key}`, origin)))
    .arrayBuffer());
  const v = new DataView(b.buffer);
  let rate = 0, align = 0, data = 0;
  for (let p = 12; p + 8 <= b.length;) {
    const id = String.fromCharCode(...b.subarray(p, p + 4));
    const n = v.getUint32(p + 4, true);
    if (id === "fmt ") { rate = v.getUint32(p + 12, true); align = v.getUint16(p + 20, true); }
    if (id === "data") { data = n; break; }
    p += 8 + n + (n & 1);
  }
  return { seconds: data / align / rate, via: "the WAV" };
}

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : ` -- ${detail}`}`);
};

/** Samples a second: the rain's loop is under a second long. */
const RATE = 4;

async function run(label, url, seconds, seen) {
  const { page, close } = await openPlayer({
    url, size: "1280x800", headless: !process.argv.includes("--head"),
    quiet: true, init: TAP,
  });
  const samples = [];
  try {
    await waitForLoad(page);
    const { seconds: want, via } = await loopSeconds(page.url());
    // The gesture and the unmute in one real click: browsers block playback
    // until a gesture, and the store cannot supply one.
    await page.locator("button.sound").click();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Space");
    for (let s = 0; s < seconds * RATE && !seen(samples); s++) {
      await page.waitForTimeout(1000 / RATE);
      const snap = await page.evaluate(() => window.__snap());
      // Half a frame of the slower rate either side: a WAV decode resamples
      // to the context's rate and keeps the duration, not the frame count.
      const el = snap.find((e) => e.loop && Math.abs(e.dur - want) < 0.002);
      samples.push(el ? { played: el.played, dur: el.dur, done: el.done } : null);
    }
    console.log(`\n  ${label}: the rain is ${want.toFixed(4)} s (${via}); `
      + samples.map((c) => (c ? (c.done ? "x" : c.played) : "-")).join(" "));
  } finally {
    await close();
  }
  return samples;
}

// From the top: the loop starts, and is still sounding after more than one
// pass of its buffer -- the only direct evidence that it wrapped rather than
// stopped.
const wrapped = (cs) => cs.some((c) => c !== null && !c.done && c.played > c.dur * 1.5);
const top = await run("from the top", FROM_TOP, 6, wrapped);
check("playing from the top starts the loop",
      top.some((c) => c !== null), "no looped buffer of the rain's length");
check("...and it wraps rather than running out", wrapped(top),
      top.filter((c) => c).map((c) => `${c.played}/${c.dur.toFixed(2)}${c.done ? " stopped" : ""}`)
        .join(" "));

// The deep link: the `se_play` is stepped over by the replay, so this is the
// one the walker's record has to reconstitute.
const deep = await run("by a deep link", DEEP_LINK, 3,
                       (cs) => cs.some((c) => c !== null));
check("a deep link past the `se_play` still has the loop",
      deep.some((c) => c !== null),
      "the seek replayed the instruction silently and told the mixer nothing");

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);

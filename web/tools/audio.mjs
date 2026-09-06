/**
 * Does a shot actually make a noise?
 *
 * Every other check in this tree can be green while the page is silent. The
 * unit tests assert that `sound.play` was emitted, which is the port asking
 * itself whether it meant to make a sound; `render.test.ts` never gets near an
 * `<audio>` element. So this loads the real page, unmutes it with a real
 * click, fires real shots, and measures **decoded samples**: every media
 * element the page plays is routed through an `AnalyserNode` and its peak
 * amplitude is read while it plays. A file that 200s and decodes to silence
 * fails here, and so does one the page never asked for.
 *
 *     node tools/audio.mjs
 *     node tools/audio.mjs --url '?stage=1&block=4' --head
 *
 * It prints, per sound the page reached for: the URL, the HTTP status, and the
 * peak sample seen on the graph.
 *
 * Two traps it works around, both of which have cost a run in this repo:
 *
 * * the sidebar's groups start collapsed, and expanding one leaves a
 *   `<summary>` focused — so the Space that starts playback toggles the group
 *   shut instead, the game never advances, and every shot misses into an empty
 *   scene;
 * * audio is muted on load and browsers block playback until a gesture, so the
 *   sound button has to be *clicked*, not toggled through the store.
 */
import { openPlayer, waitForLoad } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

/**
 * The tap, installed before the app's first line runs.
 *
 * `createMediaElementSource` takes the element out of the default output and
 * into the graph, so it is reconnected to `destination` — the page still makes
 * the noise, and now the noise is measurable. One source per element, because
 * a second call on the same element throws; the pool reuses eight elements
 * across every one-shot in the run, so the tap follows the element and the
 * bookkeeping follows `src`.
 */
const TAP = () => {
  const out = { plays: [], peaks: {}, ctxState: "none" };
  window.__audio = out;
  let ctx = null;
  const taps = [];
  const ensureCtx = () => {
    if (!ctx) {
      const C = window.AudioContext ?? window.webkitAudioContext;
      ctx = new C();
      setInterval(() => {
        out.ctxState = ctx.state;
        for (const t of taps) {
          t.an.getFloatTimeDomainData(t.buf);
          let p = 0;
          for (let i = 0; i < t.buf.length; i++) {
            const v = Math.abs(t.buf[i]);
            if (v > p) p = v;
          }
          const key = t.el.currentSrc || t.el.src;
          if (!key) continue;
          if (!(key in out.peaks) || out.peaks[key] < p) out.peaks[key] = p;
        }
      }, 20);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  };
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const c = ensureCtx();
    if (!this.__tapped) {
      this.__tapped = true;
      try {
        const src = c.createMediaElementSource(this);
        const an = c.createAnalyser();
        an.fftSize = 2048;
        src.connect(an);
        an.connect(c.destination);
        taps.push({ el: this, an, buf: new Float32Array(an.fftSize) });
      } catch (e) {
        out.plays.push(`TAP FAILED: ${e.message}`);
      }
    }
    out.plays.push(this.src);
    return orig.apply(this, arguments);
  };
};

const { page, state, close } = await openPlayer({
  url: opt("url", "?stage=1&block=4"), size: "1280x800",
  headless: !args.includes("--head"), quiet: true, init: TAP,
});

/** Every audio response the page got, by URL. */
const responses = new Map();
page.on("response", (r) => {
  const u = r.url();
  if (/\/(se|bgm|voice)\//.test(u)) responses.set(u, r.status());
});
page.on("requestfailed", (r) => {
  const u = r.url();
  if (/\/(se|bgm|voice)\//.test(u)) {
    responses.set(u, `failed: ${r.failure()?.errorText ?? "?"}`);
  }
});

let bad = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ok    ${name}`);
  else { bad++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const openAll = async () => {
  const n = await page.locator("#right summary").count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = page.locator("#right summary").nth(i);
    const open = await el.evaluate((e) => e.parentElement?.open ?? true)
      .catch(() => true);
    if (!open) await el.click().catch(() => {});
  }
  await page.evaluate(() => document.activeElement?.blur?.());
};

const audio = () => page.evaluate(() => window.__audio);
const name = (u) => decodeURIComponent(u.replace(/^.*\/(se|bgm|voice)\//i, ""));

try {
  await waitForLoad(page);
  await openAll();

  // The gesture, and the unmute, in one real click.
  await page.locator("button.sound").click();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(300);
  check("the sound button unmutes",
        await page.locator("button.sound").getAttribute("aria-pressed") === "true");

  await page.keyboard.press("Space");
  await page.waitForTimeout(2500);

  const box = await page.locator("#viewport").boundingBox();
  // A sweep, so some shots meet flesh, some meet the level and some meet
  // nothing. The gunshot itself does not care which.
  for (let round = 0; round < 6; round++) {
    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        const x = box.x + box.width * (0.12 + gx * 0.19);
        const y = box.y + box.height * (0.22 + gy * 0.17);
        await page.mouse.move(x, y);
        await page.mouse.click(x, y);
        await page.waitForTimeout(60);
      }
    }
  }
  await page.waitForTimeout(600);

  const a = await audio();
  const played = [...new Set(a.plays)];
  console.log(`\n  AudioContext: ${a.ctxState}`);
  console.log(`  ${played.length} distinct sources played\n`);
  for (const u of played) {
    const peak = a.peaks[u];
    console.log(`   ${String(responses.get(u) ?? "-").padEnd(7)}`
      + ` peak ${peak === undefined ? "  n/a" : peak.toFixed(3)}  ${name(u)}`);
  }
  for (const [u, s] of responses) {
    if (!played.includes(u)) console.log(`   ${s}  (fetched, not played) ${name(u)}`);
  }

  const audible = played.filter((u) => (a.peaks[u] ?? 0) > 0.01);
  const heardName = (re) => audible.some((u) => re.test(name(u)));

  check("something audible reached the output at all", audible.length > 0,
        `${played.length} sources played, none above 0.01 peak`);
  check("the gunshot is audible", heardName(/GUN5_22\.WAV/i),
        "no COMMON/GUN5_22.WAV above 0.01 peak");
  check("an impact is audible",
        heardName(/BLOOD0|BONE01|BULLET_/i),
        "no flesh impact and no ricochet above 0.01 peak");
  // 206 is the normal answer: the dev server serves ranges so a 14 MB track
  // does not have to buffer end to end before it starts.
  //
  // `_OFF` is the one exemption, and it is measured rather than assumed: 37 of
  // `g_se_name_list`'s 324 names carry it, 36 of those 36 are absent from the
  // install, and **every one of the other 287 resolves**. So an `_OFF` 404 is
  // shipped data and anything else is a real fault — which is why the whole
  // rest of the list is held to 200/206 rather than the check being loosened.
  const bad4 = [...responses.entries()]
    .filter(([u, s]) => s !== 200 && s !== 206 && !/_OFF\./i.test(name(u)))
    .map(([u, s]) => `${s} ${name(u)}`);
  check("every sound the page asked for exists in the install",
        bad4.length === 0, bad4.join(", "));
  const offs = [...responses.entries()]
    .filter(([u]) => /_OFF\./i.test(name(u))).map(([u]) => name(u));
  if (offs.length) console.log(`  --    ${offs.length} \`_OFF\` name(s) not `
    + `shipped, which is the game's own data: ${offs.join(", ")}`);
} finally { await close(); }
console.log(bad ? `\n${bad} failed` : "\nall passed");
process.exit(bad || state.faults ? 1 : 0);

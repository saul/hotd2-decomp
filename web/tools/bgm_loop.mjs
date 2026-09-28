/**
 * Does the page's music loop where the engine's does?
 *
 *     node tools/bgm_loop.mjs            # npm run bgm-loop
 *     node tools/bgm_loop.mjs --head
 *
 * The engine has no loop points. Channel `0xF` is streamed, and when
 * `SoundStreamThread` (`FUN_004A4640`) reads past **end of file** it seeks
 * back to the first sample and reads on: one pass is `[first sample, EOF)`,
 * the `LIST` chunk after the data included, and a pass of `2 mod 4` bytes puts
 * the next one half a frame late. `tools/verify_bgm_stream.py` reads that out
 * of the exe and `test:audio` holds `audio/stream.ts` to it; neither gets near
 * a page. This does:
 *
 * 1. Stage 1 in Arcade, played from the top. Its script starts `ST1.WAV` with
 *    a `se_play` at block 0 step 2. Every `AudioBufferSourceNode` the page
 *    starts is recorded before the app's first line runs, and the one that
 *    carries the track is compared, **frame by frame at the places that
 *    matter**, against the file fetched from the same server: the first
 *    frames, the join where the data ends and the tail begins, the second
 *    pass's start, the end of the period, and a spread between. It has to be
 *    looped, whole-buffer, and exactly one period long.
 * 2. The same page, from a deep link past that `se_play`: the replay is
 *    silent, so the track has to come back through the seek.
 * 3. A `Bgm` of the page's own, driven by id: a one-shot track plays once, a
 *    replay of the playing track restarts it, `0x80000002` leaves the music
 *    alone and `0x80000000` stops it.
 *
 * And the level: an `AnalyserNode` between the mixer and the destination.
 * L29 -- a peak of exactly 0.000 with another headless Chrome on the machine
 * is contention, not evidence; re-run alone before believing it.
 */
import { openPlayer, requireBundle, waitForLoad } from "./lib/player.mjs";

requireBundle("bgm_loop");

const args = process.argv.slice(2);
const HEAD = args.includes("--head");

/** Installed before the app's first line: every buffer start, and a level. */
const TAP = () => {
  const out = { starts: [], stops: 0, peak: 0 };
  window.__bgm = out;
  const origStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    const b = this.buffer;
    out.starts.push({
      node: this, frames: b?.length ?? 0, rate: b?.sampleRate ?? 0,
      channels: b?.numberOfChannels ?? 0, loop: this.loop,
      loopStart: this.loopStart, loopEnd: this.loopEnd, stopped: false,
    });
    return origStart.apply(this, a);
  };
  const origStop = AudioScheduledSourceNode.prototype.stop;
  AudioScheduledSourceNode.prototype.stop = function (...a) {
    const s = out.starts.find((x) => x.node === this);
    if (s) s.stopped = true;
    out.stops++;
    return origStop.apply(this, a);
  };
  // Put an analyser between anything and the destination.
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode && !(this instanceof AnalyserNode)) {
      const an = this.context.createAnalyser();
      an.fftSize = 2048;
      const buf = new Float32Array(an.fftSize);
      origConnect.call(this, an);
      origConnect.call(an, dest);
      setInterval(() => {
        an.getFloatTimeDomainData(buf);
        for (const v of buf) if (Math.abs(v) > out.peak) out.peak = Math.abs(v);
      }, 25);
      return dest;
    }
    return origConnect.call(this, dest, ...rest);
  };
  window.__bgmFrames = (i, frames) => {
    const b = window.__bgm.starts[i].node.buffer;
    const L = b.getChannelData(0);
    const R = b.getChannelData(b.numberOfChannels > 1 ? 1 : 0);
    return frames.map((f) => [L[f], R[f]]);
  };
};

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : ` -- ${detail}`}`);
};

/** The engine's stream, from the file: byte k of a pass is file[44 + k % P]. */
function expected(bytes, loop) {
  // `SoundChannelOpenWav`'s walk, the short way: every shipped track is
  // RIFF/WAVE/fmt(16)/data, so the first sample is at 44. The check that
  // this is so for every track is `verify_bgm_stream.py`'s.
  const start = 44;
  const dataSize = new DataView(bytes.buffer, bytes.byteOffset).getUint32(40, true);
  const P = bytes.length - start;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const passes = loop ? 4 / gcd(P, 4) : 1;
  const frames = Math.ceil(passes * P / 4);
  const total = loop ? passes * P : P;
  const byte = (k) => (k < total ? bytes[start + (k % P)] : 0);
  const s16 = (k) => {
    const v = byte(k) | (byte(k + 1) << 8);
    return (v & 0x8000 ? v - 0x10000 : v) / 32768;
  };
  return { P, dataSize, passes, frames, frame: (f) => [s16(f * 4), s16(f * 4 + 2)] };
}

/** Frames worth comparing: the edges of every pass, and a spread. */
function probes(e) {
  const set = new Set();
  const add = (a, b) => { for (let f = Math.max(0, a); f < Math.min(e.frames, b); f++) set.add(f); };
  add(0, 64);
  const dataEnd = Math.floor(e.dataSize / 4);
  add(dataEnd - 8, dataEnd + 24);           // the last samples, the tail
  const pass2 = Math.floor(e.P / 4);
  add(pass2 - 8, pass2 + 24);               // the second pass's first samples
  add(Math.floor((e.P + e.dataSize) / 4) - 8, Math.floor((e.P + e.dataSize) / 4) + 24);
  add(e.frames - 32, e.frames);             // the end of the period
  for (let i = 0; i < 400; i++) set.add(Math.floor((i + 0.5) / 400 * e.frames));
  return [...set].sort((a, b) => a - b);
}

async function compare(page, i, file, loop, label) {
  const url = new URL(`/bgm/${encodeURIComponent(file)}`, page.url()).href;
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const e = expected(bytes, loop);
  const s = await page.evaluate((k) => {
    const x = window.__bgm.starts[k];
    return { frames: x.frames, rate: x.rate, loop: x.loop,
             loopStart: x.loopStart, loopEnd: x.loopEnd };
  }, i);
  check(`${label}: ${file} is ${loop ? "looped over the whole buffer" : "played once"}`,
        s.loop === loop && s.loopStart === 0 && s.loopEnd === 0,
        JSON.stringify(s));
  check(`${label}: ...one ${loop ? "period" : "pass"} long: `
        + `${e.frames} frames = ${e.passes} x (${bytes.length} - 44) bytes / 4`,
        s.frames === e.frames && s.rate === 22050,
        `${s.frames} frames at ${s.rate} Hz`);
  const at = probes(e);
  const got = await page.evaluate(([k, f]) => window.__bgmFrames(k, f), [i, at]);
  let bad = null;
  for (let j = 0; j < at.length && !bad; j++) {
    const want = e.frame(at[j]);
    if (got[j][0] !== want[0] || got[j][1] !== want[1]) {
      bad = `frame ${at[j]}: ${got[j].map((v) => v * 32768)} want ${want.map((v) => v * 32768)}`;
    }
  }
  check(`${label}: ...and ${at.length} frames across it are the file's bytes `
        + "from its first sample to end of file, tail and all", !bad, bad ?? "");
  if (loop && e.passes === 2) {
    // The half-frame shift, stated rather than implied: the first frame of
    // the second pass carries the first LEFT sample in the RIGHT channel.
    const k = Math.floor(e.P / 4);
    const [f] = await page.evaluate(([x, y]) => window.__bgmFrames(x, y), [i, [k]]);
    check(`${label}: ...the second pass starts in the right channel `
          + `(frame ${k}), as a ${e.P % 4}-over pass puts it`,
          f[1] === e.frame(0)[0], `${f.map((v) => v * 32768)}`);
  }
  if (loop) {
    // The wrap itself, rendered: the very buffer the page plays, looped by
    // Web Audio across its own end in an offline context at its own rate, so
    // nothing is resampled. Every output sample has to be the stream's --
    // no run of silence at the seam, which is what an `<audio loop>`
    // element put there (8 ms measured on ST1.WAV before this).
    const r = await page.evaluate(async (k) => {
      const b = window.__bgm.starts[k].node.buffer;
      const N = b.length, lead = 2000, span = 6000;
      const ctx = new OfflineAudioContext(b.numberOfChannels, span, b.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      src.connect(ctx.destination);
      src.start(0, (N - lead) / b.sampleRate);
      const out = await ctx.startRendering();
      let worst = 0, zeros = 0, run = 0;
      for (let c = 0; c < b.numberOfChannels; c++) {
        const o = out.getChannelData(c), s = b.getChannelData(c);
        for (let j = 0; j < span; j++) {
          worst = Math.max(worst, Math.abs(o[j] - s[(N - lead + j) % N]));
          if (c === 0) {
            run = o[j] === 0 && out.getChannelData(1 % out.numberOfChannels)[j] === 0
              ? run + 1 : 0;
            zeros = Math.max(zeros, run);
          }
        }
      }
      return { worst, zeros, lead };
    }, i);
    check(`${label}: ...and the wrap is gapless: ${r.lead} frames before the end `
          + "and 4000 after, rendered, are the stream's own samples",
          r.worst < 1e-4 && r.zeros < 4,
          `worst error ${r.worst}, longest digital silence ${r.zeros} frames`);
  }
}

async function waitFor(page, pred, ms) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(pred).catch(() => false)) return true;
    if (Date.now() - t0 > ms) return false;
    await page.waitForTimeout(250);
  }
}

async function scenario(url, label, body) {
  const { page, close, state } = await openPlayer({
    url, size: "1280x800", headless: !HEAD, quiet: true, init: TAP,
  });
  try {
    await waitForLoad(page);
    // The gesture and the unmute in one real click.
    await page.locator("button.sound").click();
    await page.evaluate(() => document.activeElement?.blur?.());
    await body(page);
  } finally {
    await close();
  }
  // `_OFF` is the one exemption, as in `tools/audio.mjs`: a looping SE's stop
  // id plays its own name, and none of the 36 `_OFF` files ship -- a 404 by
  // design (`verify_looping_se.py`). Anything else the page complains of is
  // counted.
  const faults = state.faultLines.filter((l) => !/_OFF\.wav/i.test(l));
  check(`${label}: the page raised no errors`, faults.length === 0,
        faults.join(" | "));
}

// -- 1. from the top ----------------------------------------------------------
await scenario("?stage=1&mode=play", "from the top", async (page) => {
  await page.keyboard.press("Space");
  const ok = await waitFor(page, () => window.__bgm.starts.some((s) => s.channels === 2), 120_000);
  check("from the top: the script's se_play starts the track", ok,
        "no buffer started in 120 s");
  if (!ok) return;
  const i = await page.evaluate(() => window.__bgm.starts.findIndex((s) => s.channels === 2));
  await compare(page, i, "ST1.WAV", true, "from the top");
  await page.waitForTimeout(1500);
  const peak = await page.evaluate(() => window.__bgm.peak);
  check(`from the top: it is audible (peak ${peak.toFixed(3)})`, peak > 0.01,
        peak === 0 ? "exactly zero: another headless browser? (L29) re-run alone" : "");
});

// -- 2. by a deep link past the se_play ---------------------------------------
await scenario("?stage=1&mode=play&block=0&step=2&op=40", "deep link", async (page) => {
  const ok = await waitFor(page, () => window.__bgm.starts.some((s) => s.channels === 2), 20_000);
  check("deep link: the seek puts the script's track back", ok,
        "no buffer started in 20 s");
  if (ok) {
    const i = await page.evaluate(() => window.__bgm.starts.findIndex((s) => s.channels === 2));
    await compare(page, i, "ST1.WAV", true, "deep link");
  }
});

// -- 3. the dispatch, on a Bgm of the page's own --------------------------------
await scenario("?stage=1&original=1", "by id", async (page) => {
  const n0 = await page.evaluate(() => window.__bgm.starts.length);
  await page.evaluate(async () => {
    const { Bgm } = await import("/src/audio/bgm.ts");
    const script = await (await fetch("/bundle/stage1_original/stage1_original.script.json")).json();
    const b = new Bgm();
    b.setTable(script.bgm, 1);          // Original: the _AR table
    b.setSoundTables(script.sound);
    b.setMuted(false);
    window.__mine = b;
  });
  const started = (n) => waitFor(page, `window.__bgm.starts.length >= ${n}`, 20_000);

  await page.evaluate(() => window.__mine.play(0x10000009));
  check("by id: 0x10000009 starts", await started(n0 + 1));
  await compare(page, n0, "OVR_AR.WAV", false, "by id");

  await page.evaluate(() => window.__mine.play(0x10000001));
  await started(n0 + 2);
  await page.evaluate(() => window.__mine.play(0x10000001));
  const again = await started(n0 + 3);
  const st = await page.evaluate((k) => window.__bgm.starts.slice(k).map((s) => s.stopped), n0);
  check("by id: playing the track that is playing restarts it -- the old "
        + "buffer stopped, a new one started", again && st[1] === true && st[2] === false,
        JSON.stringify(st));
  await compare(page, n0 + 2, "ST1_AR.WAV", true, "by id");

  await page.evaluate(() => window.__mine.play(0x80000002));
  const afterVoice = await page.evaluate((k) => window.__bgm.starts[k].stopped, n0 + 2);
  check("by id: 0x80000002 is the voice's stop and leaves the music playing",
        afterVoice === false);
  await page.evaluate(() => window.__mine.play(0x80000000));
  const afterStop = await page.evaluate((k) => window.__bgm.starts[k].stopped, n0 + 2);
  check("by id: 0x80000000 stops it", afterStop === true);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);

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
 * the next one half a frame late. `web/tools/checks/bgm_stream.ts` reads that out
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
 * **Two sound paths.** With the AAC set served (`npm run sounds`,
 * `/sounds.json`) the track is a decode of a 96 kbit/s copy of that same
 * period (`audio/aac.ts`), which `tools/sounds.ts` declares lossy. So its
 * length, its loop, its seam and the dispatch are held exactly as on the WAV
 * path, and its samples are held to the stream by **residual power** -- the
 * energy of the difference over the energy of the signal, at the same
 * frames -- under {@link AAC_RESIDUAL}. A WAV-path page is still held bit for
 * bit. The track is found by its length, the period's frame count at 22,050
 * Hz, because on the AAC path every clip is a constructed buffer too and
 * "the first stereo buffer not decoded" was the rain.
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
  // The SE and the voice are buffers too since they left `<audio>`, and
  // they come out of `decodeAudioData`; the music never does -- it is filled
  // sample by sample from the engine's stream (`audio/stream.ts`). So a
  // decoded buffer is not the track, and is not recorded.
  const decoded = new WeakSet();
  const decode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (...a) {
    const p = decode.apply(this, a);
    if (p && typeof p.then === "function") {
      p.then((buf) => decoded.add(buf), () => {});
    }
    return p;
  };
  const origStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    const b = this.buffer;
    if (b && decoded.has(b)) return origStart.apply(this, a);
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

/**
 * The AAC copy's ceiling: residual power over signal power, across the frames
 * compared. Measured at the frames this check compares (2026-10-08, Chrome,
 * stage 1's three tracks): the copy as served is 0.96-1.52%; the same buffer
 * held to the stream one frame late is 50-68%, with its channels swapped
 * 46-55%, 64 frames late 153-190%, and carrying its 2,112 frames of priming
 * 207-243%. Five percent is three times the codec's worst and a ninth of the
 * smallest fault.
 */
const AAC_RESIDUAL = 0.05;

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : ` -- ${detail}`}`);
};

/** The engine's stream, from the file: byte k of a pass is file[44 + k % P]. */
function expected(bytes, loop) {
  // `SoundChannelOpenWav`'s walk, the short way: every shipped track is
  // RIFF/WAVE/fmt(16)/data, so the first sample is at 44. The check that
  // this is so for every track is `web/tools/checks/bgm_stream.ts`'s.
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

/** Is the page on the AAC set? The index answers from the same server. */
async function aacServed(page) {
  const r = await fetch(new URL("/sounds.json", page.url()).href).catch(() => null);
  return Boolean(r?.ok);
}

/** Residual power over signal power, `got` against `want`, both channels. */
function residual(got, want) {
  let d = 0, w = 0;
  for (let j = 0; j < got.length; j++) {
    for (let c = 0; c < 2; c++) {
      d += (got[j][c] - want[j][c]) ** 2;
      w += want[j][c] ** 2;
    }
  }
  return w ? d / w : (d ? Infinity : 0);
}

/**
 * The start that carries `file`, from index `from` on: the first buffer one
 * period of the stream long at 22,050 Hz. Waits up to `ms` for it. -1 if none.
 */
async function trackStart(page, file, loop, from, ms) {
  const url = new URL(`/bgm/${encodeURIComponent(file)}`, page.url()).href;
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const e = expected(bytes, loop);
  const pred = `window.__bgm.starts.findIndex((s, k) => k >= ${from} `
    + `&& s.frames === ${e.frames} && s.rate === 22050)`;
  await waitFor(page, `${pred} >= 0`, ms);
  return { i: await page.evaluate(pred), bytes, e };
}

async function compare(page, i, bytes, e, file, loop, label) {
  const aac = await aacServed(page);
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
  if (aac) {
    const r = residual(got, at.map((f) => e.frame(f)));
    check(`${label}: ...and ${at.length} frames across it are the stream's from `
          + `its first sample to end of file, tail and all, to the AAC copy's `
          + `residual (${(r * 100).toFixed(2)}% of the signal's power)`,
          r < AAC_RESIDUAL, `${(r * 100).toFixed(2)}% >= ${AAC_RESIDUAL * 100}%`);
  } else {
    let bad = null;
    for (let j = 0; j < at.length && !bad; j++) {
      const want = e.frame(at[j]);
      if (got[j][0] !== want[0] || got[j][1] !== want[1]) {
        bad = `frame ${at[j]}: ${got[j].map((v) => v * 32768)} want ${want.map((v) => v * 32768)}`;
      }
    }
    check(`${label}: ...and ${at.length} frames across it are the file's bytes `
          + "from its first sample to end of file, tail and all", !bad, bad ?? "");
  }
  if (loop && e.passes === 2) {
    // The half-frame shift, stated rather than implied: the first frame of
    // the second pass carries the first LEFT sample in the RIGHT channel. On
    // the AAC copy one sample says nothing, so a window from that frame on is
    // held to the stream -- the shifted stream, which a copy without the
    // shift misses by its whole power.
    const k = Math.floor(e.P / 4);
    if (aac) {
      const win = Array.from({ length: 2048 }, (_, j) => k + j);
      const g = await page.evaluate(([x, y]) => window.__bgmFrames(x, y), [i, win]);
      const r = residual(g, win.map((f) => e.frame(f)));
      check(`${label}: ...the second pass starts in the right channel `
            + `(frames ${k}..+2048), as a ${e.P % 4}-over pass puts it `
            + `(${(r * 100).toFixed(2)}% residual)`,
            r < AAC_RESIDUAL, `${(r * 100).toFixed(2)}%`);
    } else {
      const [f] = await page.evaluate(([x, y]) => window.__bgmFrames(x, y), [i, [k]]);
      check(`${label}: ...the second pass starts in the right channel `
            + `(frame ${k}), as a ${e.P % 4}-over pass puts it`,
            f[1] === e.frame(0)[0], `${f.map((v) => v * 32768)}`);
    }
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
  // design (`web/tools/checks/looping_se.ts`). So is `/sounds.json` on a server
  // with no AAC set: the page asks, and plays the WAVs on the 404
  // (`vite.config.ts`). Anything else the page complains of is counted.
  const faults = state.faultLines.filter((l) => !/_OFF\.wav/i.test(l)
    && !/\/sounds\.json\)$/.test(l));
  check(`${label}: the page raised no errors`, faults.length === 0,
        faults.join(" | "));
}

// -- 1. from the top ----------------------------------------------------------
await scenario("?stage=1&mode=play", "from the top", async (page) => {
  await page.keyboard.press("Space");
  const { i, bytes, e } = await trackStart(page, "ST1.WAV", true, 0, 120_000);
  check("from the top: the script's se_play starts the track", i >= 0,
        "no buffer one period of ST1.WAV long started in 120 s");
  if (i < 0) return;
  await compare(page, i, bytes, e, "ST1.WAV", true, "from the top");
  await page.waitForTimeout(1500);
  const peak = await page.evaluate(() => window.__bgm.peak);
  check(`from the top: it is audible (peak ${peak.toFixed(3)})`, peak > 0.01,
        peak === 0 ? "exactly zero: another headless browser? (L29) re-run alone" : "");
});

// -- 2. by a deep link past the se_play ---------------------------------------
await scenario("?stage=1&mode=play&block=0&step=3&op=40", "deep link", async (page) => {
  const { i, bytes, e } = await trackStart(page, "ST1.WAV", true, 0, 20_000);
  check("deep link: the seek puts the script's track back", i >= 0,
        "no buffer one period of ST1.WAV long started in 20 s");
  if (i >= 0) await compare(page, i, bytes, e, "ST1.WAV", true, "deep link");
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
  const ovr = await trackStart(page, "OVR_AR.WAV", false, n0, 20_000);
  check("by id: ...and what it starts is OVR_AR.WAV's one pass", ovr.i === n0,
        `start ${ovr.i}, expected ${n0}`);
  if (ovr.i >= 0) await compare(page, ovr.i, ovr.bytes, ovr.e, "OVR_AR.WAV", false, "by id");

  await page.evaluate(() => window.__mine.play(0x10000001));
  await started(n0 + 2);
  await page.evaluate(() => window.__mine.play(0x10000001));
  const again = await started(n0 + 3);
  const st = await page.evaluate((k) => window.__bgm.starts.slice(k).map((s) => s.stopped), n0);
  check("by id: playing the track that is playing restarts it -- the old "
        + "buffer stopped, a new one started", again && st[1] === true && st[2] === false,
        JSON.stringify(st));
  const st1 = await trackStart(page, "ST1_AR.WAV", true, n0 + 2, 20_000);
  check("by id: ...and the restart is ST1_AR.WAV's period", st1.i === n0 + 2,
        `start ${st1.i}, expected ${n0 + 2}`);
  if (st1.i >= 0) await compare(page, st1.i, st1.bytes, st1.e, "ST1_AR.WAV", true, "by id");

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

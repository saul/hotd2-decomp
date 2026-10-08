/**
 * Encode the install's sounds as AAC, for the page to download a stage's
 * worth at once.
 *
 *     npm run sounds                           # into extract/sound/
 *     npm run sounds -- --game-dir ... --out ... --jobs 8
 *
 * **Why.** Every sound the game ships is uncompressed 16-bit PCM -- 623 of the
 * 802 files at 22,050 Hz stereo, the rest at 11,025, 16,000 or 44,100, some
 * mono -- 368 MB in all; a stage's music alone is 13 to 36 MB. At 96 kbit/s AAC the whole set
 * is about an eighth of that, which is what lets `audio/precache.ts` fetch
 * every effect and voice line under the loading screen rather than on first
 * play. AAC because it is the codec Safari, iOS and Chrome all decode.
 *
 * `[diverges]` It is lossy: the page no longer plays the shipped samples, but
 * a 96 kbit/s encoding of them. The dev server and a site staged without this
 * directory still serve the WAVs, and the page plays those exactly.
 *
 * **What is encoded is what the engine plays, not the file.**
 *
 * * An effect or a voice line is loaded whole into a static buffer, so it is
 *   the `data` chunk's frames.
 * * A track is streamed (`audio/stream.ts`): the byte range from the first
 *   sample to the end of the **file**, the `LIST` tail included, looped
 *   without a gap -- and a tail that is half a frame over swaps the channels
 *   on every other pass. So a looping track is encoded as the period
 *   `bgmStreamFill` writes, one or two passes long, and a one-shot as its one
 *   pass. The page decodes it and loops the buffer whole, as it does the WAV.
 *
 * **The lead-in.** `afconvert`'s AAC starts with 2,112 samples of encoder
 * priming and ends padded to a whole 1,024-sample frame. A decoder may strip
 * both, the priming alone, or neither; so the index records each file's true
 * frame count, and the page (`audio/aac.ts`) takes the priming off when the
 * decode is long enough to still hold it, and then the length. Measured: a
 * one-second tone burst at frame 1000 decodes, through `ffmpeg`, to 22,464
 * frames with the burst at frame 1000 -- priming gone, padding kept.
 *
 * **The output**, all lowercased as the page asks for it (`soundUrl`):
 *
 *     sounds.json           the index: per sound, where it is and how long
 *     clips.pack            every effect and voice line, end to end
 *     bgm/<name>.loop.m4a   a looping track's period
 *     bgm/<name>.once.m4a   a one-shot track's pass
 *
 * Effects and voices are one file because the page fetches all of them: 760
 * requests at a phone's latency would cost seconds that one does not.
 *
 * Incremental: a sound whose encoding is newer than its source is not
 * encoded again.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { BgmJson } from "../src/bundle";
import { BGM_ONE_SHOT_IDS } from "../src/audio/bgm";
import {
  bgmStreamFill, bgmStreamLayout, wavStreamHeader,
} from "../src/audio/stream";
import {
  AAC_PRIMING, SOUND_INDEX_FORMAT, type SoundIndex, type SoundIndexEntry,
} from "../src/audio/aac";
import { BUNDLE_ROOT, repoRoot } from "./lib/bundle_root";

const USAGE = `usage: npm run sounds -- [options]

  --game-dir <dir>   the install whose sound/ to encode (default: the bundle
                     manifest's game_dir)
  --bundle <dir>     a bundle, for the music tables (default: HOTD2_BUNDLE,
                     else extract/player)
  --out <dir>        where to write (default: extract/sound)
  --bitrate <bps>    AAC bitrate (default 96000)
  --jobs <n>         encoders at once (default 8)`;

interface Args {
  gameDir: string;
  bundle: string;
  out: string;
  bitrate: number;
  jobs: number;
}

function fail(msg: string): never {
  console.error(`sounds: ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    gameDir: "", bundle: BUNDLE_ROOT, out: join(repoRoot(), "extract", "sound"),
    bitrate: 96000, jobs: 8,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => argv[++i] ?? fail(`${k} needs a value`);
    switch (k) {
      case "--game-dir": a.gameDir = resolve(val()); break;
      case "--bundle": a.bundle = resolve(val()); break;
      case "--out": a.out = resolve(val()); break;
      case "--bitrate": a.bitrate = Number(val()); break;
      case "--jobs": a.jobs = Math.max(1, Number(val())); break;
      case "-h": case "--help": console.log(USAGE); process.exit(0); break;
      default: fail(`unknown argument ${k}\n\n${USAGE}`);
    }
  }
  return a;
}

/** Every file under `dir`, relative to it. */
function walk(dir: string, under = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, under), { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const rel = under ? `${under}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** A canonical 16-bit PCM WAV of `frames` interleaved samples. */
function wavFile(rate: number, channels: number, pcm: Int16Array): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/**
 * The bitrates tried, highest first. `afconvert` refuses one above what AAC
 * allows at a file's rate -- 96 kbit/s is too much for the seven 11,025 Hz
 * stereo effects (`Couldn't set audio converter property ('!dat')`), and
 * 64 kbit/s is accepted -- so a file takes the first it will.
 */
const STEP_DOWN = [96000, 80000, 64000, 48000, 32000];

/** `afconvert` one file at the highest bitrate it accepts, up to `bitrate`. */
async function encode(src: string, dst: string, bitrate: number): Promise<void> {
  const tries = [bitrate, ...STEP_DOWN.filter((b) => b < bitrate)];
  for (let i = 0; ; i++) {
    try {
      return await encodeAt(src, dst, tries[i]);
    } catch (e) {
      if (i + 1 >= tries.length || !String(e).includes("'!dat'")) throw e;
    }
  }
}

function encodeAt(src: string, dst: string, bitrate: number): Promise<void> {
  mkdirSync(dirname(dst), { recursive: true });
  return new Promise((ok, no) => {
    const p = spawn("afconvert", ["-f", "m4af", "-d", "aac", "-b", String(bitrate),
                                  src, dst], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (b) => { err += String(b); });
    p.on("error", no);
    p.on("exit", (c) => (c === 0 ? ok() : no(new Error(`afconvert ${src}: ${err}`))));
  });
}

/** The newer-than test staging uses: skip when the output is current. */
function current(src: string, dst: string): boolean {
  return existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs;
}

/** `(file, loop)` for every name either music table holds, as `PlaySoundId` routes it. */
function tracks(bgm: BgmJson): Map<string, Set<boolean>> {
  const out = new Map<string, Set<boolean>>();
  for (const table of [bgm.names.ar, bgm.names.plain]) {
    table.forEach((name, idx) => {
      if (!name) return;
      const id = (0x10000000 | idx) >>> 0;
      const loop = !BGM_ONE_SHOT_IDS.includes(id);
      const key = name.toLowerCase();
      if (!out.has(key)) out.set(key, new Set());
      out.get(key)!.add(loop);
    });
  }
  return out;
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (spawnSync("afconvert", ["-h"]).error) {
    fail("needs afconvert, which ships with macOS");
  }
  const manifestPath = join(a.bundle, "manifest.json");
  if (!existsSync(manifestPath)) fail(`no bundle at ${a.bundle}, for the music tables`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as
    { game_dir?: string; stages: { name: string; script: string }[] };
  const gameDir = a.gameDir || manifest.game_dir;
  if (!gameDir) fail("no --game-dir, and the bundle names none");
  const root = join(gameDir, "sound");
  const dirs = existsSync(root) ? readdirSync(root) : [];
  const dirOf = (kind: string) => {
    const d = dirs.find((x) => x.toLowerCase() === kind);
    if (!d) fail(`no sound/${kind} under ${gameDir}`);
    return join(root, d);
  };
  const first = manifest.stages[0];
  const script = JSON.parse(readFileSync(join(a.bundle, first.name, first.script), "utf8")) as
    { bgm?: BgmJson };
  if (!script.bgm) fail(`${first.name}'s script carries no music tables`);

  mkdirSync(a.out, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "hod2-sounds-"));
  const index: SoundIndex = {
    format: SOUND_INDEX_FORMAT, codec: "aac", bitrate: a.bitrate,
    priming: AAC_PRIMING, pack: "clips.pack", files: {},
  };
  const jobs: (() => Promise<void>)[] = [];
  let encoded = 0;

  // Effects and voices: the data chunk, whole.
  const clipOrder: { key: string; m4a: string }[] = [];
  for (const kind of ["se", "voice"] as const) {
    const src = dirOf(kind);
    for (const rel of walk(src).filter((f) => /\.wav$/i.test(f))) {
      const low = rel.toLowerCase();
      const key = `${kind}/${low}`;
      const bytes = readFileSync(join(src, rel));
      const h = wavStreamHeader(bytes);
      if (!h || h.formatTag !== 1 || h.bitsPerSample !== 16) {
        console.warn(`  skipped ${key}: not 16-bit PCM`);
        continue;
      }
      const frames = Math.floor(Math.min(h.dataSize, bytes.length - h.dataStart)
                                / h.blockAlign);
      const m4a = join(a.out, kind, low.replace(/\.wav$/, ".m4a"));
      index.files[key] = { rate: h.sampleRate, channels: h.channels, frames };
      clipOrder.push({ key, m4a });
      if (!current(join(src, rel), m4a)) {
        jobs.push(async () => { await encode(join(src, rel), m4a, a.bitrate); encoded++; });
      }
    }
  }

  // Music: the stream's period, for each way the tables play it.
  const bgmDir = dirOf("bgm");
  const bgmFiles = new Map(walk(bgmDir).map((f) => [f.toLowerCase(), f]));
  for (const [name, loops] of tracks(script.bgm)) {
    const rel = bgmFiles.get(name);
    if (!rel) { console.warn(`  no bgm/${name} in the install`); continue; }
    const bytes = readFileSync(join(bgmDir, rel));
    const h = wavStreamHeader(bytes);
    if (!h) { console.warn(`  skipped bgm/${name}: no data chunk`); continue; }
    for (const loop of loops) {
      const layout = bgmStreamLayout(h, bytes.length, loop);
      if (!layout) { console.warn(`  skipped bgm/${name}: not a PCM stream`); continue; }
      const variant = loop ? "loop" : "once";
      const out = join(a.out, "bgm", name.replace(/\.wav$/, `.${variant}.m4a`));
      index.files[`bgm/${name}#${variant}`] = {
        rate: layout.sampleRate, channels: layout.channels, frames: layout.frames,
        file: `bgm/${name.replace(/\.wav$/, `.${variant}.m4a`)}`,
      };
      if (current(join(bgmDir, rel), out)) continue;
      jobs.push(async () => {
        const chans: Float32Array[] = [];
        for (let c = 0; c < layout.channels; c++) chans.push(new Float32Array(layout.frames));
        bgmStreamFill(bytes, h, layout, chans);
        // Back to the samples they were: `bgmStreamFill` divides each s16 by
        // 32768 and nothing else, so this is exact.
        const pcm = new Int16Array(layout.frames * layout.channels);
        for (let f = 0; f < layout.frames; f++) {
          for (let c = 0; c < layout.channels; c++) {
            pcm[f * layout.channels + c] = Math.round(chans[c][f] * 32768);
          }
        }
        const tmp = join(work, `${name}.${variant}.wav`);
        writeFileSync(tmp, wavFile(layout.sampleRate, layout.channels, pcm));
        await encode(tmp, out, a.bitrate);
        rmSync(tmp);
        encoded++;
      });
    }
  }

  console.log(`sounds: ${Object.keys(index.files).length} sounds, `
    + `${jobs.length} to encode, ${a.jobs} at a time`);
  let next = 0;
  await Promise.all(Array.from({ length: a.jobs }, async () => {
    while (next < jobs.length) {
      await jobs[next++]();
      if (encoded % 50 === 0) console.log(`  ${encoded} of ${jobs.length}`);
    }
  }));
  rmSync(work, { recursive: true, force: true });

  // The pack: every clip end to end, in a stable order, and where each is.
  const parts: Buffer[] = [];
  let at = 0;
  for (const { key, m4a } of clipOrder) {
    const b = readFileSync(m4a);
    (index.files[key] as SoundIndexEntry).pack = [at, b.length];
    parts.push(b);
    at += b.length;
  }
  writeFileSync(join(a.out, "clips.pack"), Buffer.concat(parts));
  writeFileSync(join(a.out, "sounds.json"), JSON.stringify(index));
  const music = Object.values(index.files).filter((e) => e.file)
    .reduce((n, e) => n + statSync(join(a.out, e.file!)).size, 0);
  console.log(`sounds: ${encoded} encoded; clips.pack ${(at / 1e6).toFixed(1)} MB `
    + `(${clipOrder.length} clips), music ${(music / 1e6).toFixed(1)} MB, in ${a.out}`);
}

void main();

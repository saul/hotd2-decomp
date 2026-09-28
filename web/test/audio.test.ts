/**
 * The mixer's decisions and the music stream's bytes, held to the exe with no
 * browser.
 *
 * `audio/stream.ts` is what channel `0xF` plays: `SoundChannelOpenWav`'s
 * header walk and `SoundStreamThread`'s wrap, which reads `[first sample,
 * EOF)` end to end with no loop points and no frame alignment. `routeSoundId`
 * is `PlaySoundId`'s dispatch, loop flag and control words included. Both are
 * pure so that this file can fail on them; the half that owns an
 * `AudioContext` is measured in the page by `tools/bgm_loop.mjs`.
 *
 * Run with `npm run test:audio`.
 */
import {
  BGM_ONE_SHOT_IDS, SOUND_STOP, SOUND_STOP_SE, SOUND_STOP_VOICE, routeSoundId,
} from "../src/audio/bgm";
import {
  bgmRingBytes, bgmStreamLayout, bgmStreamSamples, wavStreamHeader,
} from "../src/audio/stream";
import type { BgmJson, SoundJson } from "../src/bundle";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok    ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

// -- a WAV the way the shipped ones are laid out ------------------------------

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const le32 = (n: number): number[] =>
  [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const le16 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff];

/**
 * `RIFF` / `WAVE` / `fmt ` / [`before`] / `data` / [`tail`] -- every shipped
 * track is this shape with a `LIST` chunk as the tail. `fmtExtra` lengthens
 * `fmt ` past 16 bytes, the `cbSize` case.
 */
function wav(o: {
  channels: number; bits: number; rate: number; data: number[];
  tail?: number[]; before?: number[]; fmtExtra?: number[];
}): Uint8Array {
  const ba = o.channels * o.bits / 8;
  const fmt = [
    ...le16(1), ...le16(o.channels), ...le32(o.rate), ...le32(o.rate * ba),
    ...le16(ba), ...le16(o.bits), ...(o.fmtExtra ?? []),
  ];
  const body = [
    ...ascii("WAVE"),
    ...ascii("fmt "), ...le32(fmt.length), ...fmt,
    ...(o.before ?? []),
    ...ascii("data"), ...le32(o.data.length), ...o.data,
    ...(o.tail ?? []),
  ];
  return new Uint8Array([...ascii("RIFF"), ...le32(body.length), ...body]);
}

/** A `LIST` chunk of `n` body bytes, as the shipped tails are. */
const list = (n: number): number[] =>
  [...ascii("LIST"), ...le32(n), ...ascii("INFO"),
   ...Array.from({ length: n - 4 }, (_, i) => (i * 37 + 11) & 0xff)];

/** 16-bit stereo data: frame `f` is `(1000 + f, -1000 - f)`. */
const stereo = (frames: number): number[] => {
  const out: number[] = [];
  for (let f = 0; f < frames; f++) out.push(...le16((1000 + f) & 0xffff),
                                            ...le16((-1000 - f) & 0xffff));
  return out;
};

const s16 = (lo: number, hi: number): number => {
  const v = lo | (hi << 8);
  return (v & 0x8000 ? v - 0x10000 : v) / 32768;
};

// -- SoundChannelOpenWav's walk ----------------------------------------------

{
  const b = wav({ channels: 2, bits: 16, rate: 22050, data: stereo(8),
                  tail: list(4) });
  const h = wavStreamHeader(b);
  check("the canonical layout streams from byte 44, as every shipped track does",
        h?.dataStart === 44 && h.dataSize === 32 && h.channels === 2
        && h.sampleRate === 22050 && h.blockAlign === 4 && h.bitsPerSample === 16,
        JSON.stringify(h));
  check("...and a 3000 ms ring of 22050 Hz stereo is 264,640 bytes -- "
        + "88,200 * 3 rounded up to 64",
        !!h && bgmRingBytes(h) === 264640, String(h && bgmRingBytes(h)));

  // A `fmt ` of 18 bytes (a `cbSize`) and an odd-sized chunk before `data`:
  // the walk counts each chunk's size as it stands, with **no** pad byte.
  const odd = wav({ channels: 2, bits: 16, rate: 22050, data: stereo(2),
                    fmtExtra: [0, 0],
                    before: [...ascii("junk"), ...le32(3), 1, 2, 3] });
  const g = wavStreamHeader(odd);
  check("an 18-byte fmt and a 3-byte chunk move the first sample to 57, "
        + "unpadded, as the engine counts", g?.dataStart === 57,
        String(g?.dataStart));
  check("a file with no data chunk does not open",
        wavStreamHeader(b.slice(0, 36)) === null);
}

// -- SoundStreamThread's wrap -------------------------------------------------

{
  // A 12-byte tail (LIST, size 4): a pass is 44 bytes, 11 whole frames.
  const b = wav({ channels: 2, bits: 16, rate: 22050, data: stereo(8),
                  tail: list(4) });
  const r = bgmStreamSamples(b, true)!;
  check("a pass of whole frames loops in one pass",
        r.layout.passBytes === 44 && r.layout.passes === 1
        && r.layout.frames === 11, JSON.stringify(r.layout));
  check("...the first frame is the first sample",
        r.samples[0][0] === 1000 / 32768 && r.samples[1][0] === -1000 / 32768);
  check("...and the tail is played as PCM between the last sample and the "
        + "first: frame 8 is \"LI\" / \"ST\"",
        r.samples[0][8] === s16(0x4c, 0x49) && r.samples[1][8] === s16(0x53, 0x54),
        `${r.samples[0][8]} ${r.samples[1][8]}`);
}

{
  // A 38-byte tail (LIST, size 30): a pass is 32 + 38 = 70 bytes, 17.5
  // frames, so the second pass starts one sample late -- the channels swap.
  const data = stereo(8);
  const b = wav({ channels: 2, bits: 16, rate: 22050, data, tail: list(30) });
  const r = bgmStreamSamples(b, true)!;
  check("a pass of 2 mod 4 bytes takes two passes to come round",
        r.layout.passBytes === 70 && r.layout.passes === 2
        && r.layout.frames === 35, JSON.stringify(r.layout));
  check("...frame 17 is the last tail byte pair and then the first LEFT sample, "
        + "in the RIGHT channel",
        r.samples[1][17] === 1000 / 32768, String(r.samples[1][17] * 32768));
  check("...and frame 18 has the first RIGHT sample on the left",
        r.samples[0][18] === -1000 / 32768 && r.samples[1][18] === 1001 / 32768,
        `${r.samples[0][18] * 32768} ${r.samples[1][18] * 32768}`);

  // The whole period, byte for byte against the stream the thread reads.
  const stream = b.slice(44);
  let bad = -1;
  for (let f = 0; f < r.layout.frames && bad < 0; f++) {
    for (let c = 0; c < 2; c++) {
      const k = (f * 2 + c) * 2;
      const want = s16(stream[k % 70], stream[(k + 1) % 70]);
      if (r.samples[c][f] !== want) { bad = f; break; }
    }
  }
  check("...every frame of the period is file byte `44 + k mod pass`", bad < 0,
        `first differs at frame ${bad}`);
}

{
  // One-shot: one pass, and the half frame over is the thread's silence.
  const b = wav({ channels: 2, bits: 16, rate: 22050, data: stereo(8),
                  tail: list(30) });
  const r = bgmStreamSamples(b, false)!;
  check("a one-shot is one pass, its last half-frame completed with silence",
        r.layout.passes === 1 && r.layout.frames === 18
        && r.samples[1][17] === 0, JSON.stringify(r.layout));
  // 8-bit silence is 0x80, which is zero once decoded.
  const m = wav({ channels: 1, bits: 8, rate: 11025, data: [0xff, 0x00, 0x80] });
  const q = bgmStreamSamples(m, true)!;
  check("8-bit mono decodes about 0x80",
        q.samples[0][0] === 127 / 128 && q.samples[0][1] === -1
        && q.samples[0][2] === 0);
  check("a format the engine could stream but the port cannot decode is refused",
        bgmStreamLayout({ ...wavStreamHeader(b)!, formatTag: 2 }, b.length,
                        true) === null);
}

// -- PlaySoundId's dispatch ----------------------------------------------------

/** Both tables as `ExeTables.bgm_names()` reads them. */
const AR = ["ST2_AR.WAV", "ST1_AR.WAV", null, "CLR_AR.WAV", null, "BOS_AR.WAV",
  "NAM_AR.WAV", null, "ADV_AR.WAV", "OVR_AR.WAV", "ST5_BOS1_AR.WAV",
  "ST6_BOS1_AR.WAV", "ENDL_AR.WAV", "ENDS_AR.WAV", "ST5_BOS2_AR.WAV",
  "ST6_BOS2_AR.WAV", "ST4_AR.WAV", "ST3_AR.WAV", "ST5_AR.WAV", "ST6_AR.WAV",
  "HOD1_ADV.WAV", "BOSS.WAV", "CLR.WAV", "ENDL.WAV", "ENDS.WAV", "NAME.WAV",
  "ST1.WAV", "ST2.WAV", "ST3.WAV", "ST4.WAV", "ST5.WAV", "ST5BOS1.WAV",
  "ST5BOS2.WAV", "ST6.WAV", "ST6BOS1.WAV", "ST6BOS2.WAV", "BOSS_MOD.WAV",
  "CLR2.WAV", "RANK_MOD.WAV", "TRA_MOD.WAV", "ITEM_SELECT.wav"];
const PLAIN = ["ST2.WAV", "ST1.WAV", null, "CLR.WAV", null, "BOSS.WAV",
  "NAME.WAV", null, "ADV_AR.WAV", "OVR_AR.WAV", "ST5BOS1.WAV", "ST6BOS1.WAV",
  "ENDL.WAV", "ENDS.WAV", "ST5BOS2.WAV", "ST6BOS2.WAV", "ST4.WAV", "ST3.WAV",
  "ST5.WAV", "ST6.WAV"];
const BGM: BgmJson = { names: { ar: AR, plain: PLAIN }, stage_track: null,
                       game_mode: 1 };
const SOUND: SoundJson = {
  se: { [String(0x004d17a9)]: "COMMON2\\CHAIN_SAW_22.WAV",
        [String(0x004e17a9)]: "COMMON2\\CHAIN_SAW_22_OFF.WAV",
        [String(0x000116a9)]: "COMMON\\GUN5_22.WAV" },
  voice: { "3": "st1\\a.wav" },
  looping: [{ play: 0x004d17a9, stop: 0x004e17a9 }],
};

{
  const r = (id: number, ar = true) => routeSoundId(id, BGM, ar, SOUND);
  const a = r(0x10000001);
  check("a stage track loops, from the _AR table outside Arcade",
        a.kind === "bgm" && a.file === "ST1_AR.WAV" && a.loop, JSON.stringify(a));
  const p = r(0x10000001, false);
  check("...and from the plain table in Arcade",
        p.kind === "bgm" && p.file === "ST1.WAV" && p.loop, JSON.stringify(p));
  const once = BGM_ONE_SHOT_IDS.map((id) => r(id));
  check("0x10000009, 0x10000025 and 0x10000014 are the three one-shots: "
        + "OVR_AR, CLR2, HOD1_ADV",
        once.every((x) => x.kind === "bgm" && !x.loop)
        && once.map((x) => (x.kind === "bgm" ? x.file : "")).join(",")
          === "OVR_AR.WAV,CLR2.WAV,HOD1_ADV.WAV",
        JSON.stringify(once));
  const loops = AR.map((f, i) => ({ f, a: r(0x10000000 | i) }))
    .filter(({ f }) => f !== null)
    .filter(({ a: x }) => x.kind === "bgm" && x.loop).length;
  check("every other named track loops",
        loops === AR.filter((f) => f !== null).length - 3, String(loops));
  check("a null entry changes nothing -- the old track plays on",
        r(0x10000002).kind === "none" && r(0x10000007).kind === "none");
  check("the plain table is 20 long: index 0x25 is nothing in Arcade",
        r(0x10000025, false).kind === "none");

  check("0x80000000 stops the music", r(SOUND_STOP).kind === "stop-bgm");
  check("0x80000001 stops the SE, not the music",
        r(SOUND_STOP_SE).kind === "stop-se");
  check("0x80000002 stops the VOICE, not the music -- evt 0x2E's word",
        r(SOUND_STOP_VOICE).kind === "stop-voice");
  check("any other control word takes the music's arm",
        r(0x80000007).kind === "stop-bgm");
  check("id 0 is nothing", r(0).kind === "none");

  const saw = r(0x004d17a9);
  const off = r(0x004e17a9);
  const gun = r(0x000116a9);
  check("the looping-SE walk still decides the SE's loop",
        saw.kind === "se" && saw.loop === "play"
        && off.kind === "se" && off.loop === "stop"
        && gun.kind === "se" && gun.loop === null);
  const v = r(0x20000003);
  check("a voice id routes to its line",
        v.kind === "voice" && v.file === "st1\\a.wav", JSON.stringify(v));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);

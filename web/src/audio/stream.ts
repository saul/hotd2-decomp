/**
 * The BGM stream: what the engine's streaming channel actually plays.
 *
 * **Pure.** No DOM, no Web Audio: bytes in, samples out, so `test:audio` can
 * hold it to the exe without a browser. `bgm.ts` is the half that owns an
 * `AudioContext` and hands these samples to it.
 *
 * ## What the engine does, `[proved]`
 *
 * `PlaySoundId` (`FUN_0041CFD0`) routes every BGM id to
 * `SoundPlayOnFreeChannel(name, loop, 0xF, -1)` (`FUN_004AC020`), and channel
 * `0xF` is the only channel that is opened **streaming**:
 * `SoundChannelOpenWav(0xF, name, 1, 3000)` (`FUN_004A3EF0`) -- flag bit 0 is
 * "stream", and 3000 is the length of the DirectSound ring in milliseconds.
 * Everything else is loaded whole into a static buffer.
 *
 * `SoundChannelOpenWav` walks the RIFF chunks counting bytes into the
 * channel's `+0x3C`, and stops at `data`: so `+0x3C` is the **file offset of
 * the first sample** -- 44 for every shipped track. It reads the
 * data chunk's size and never uses it on the streaming path. The ring is
 * `nAvgBytesPerSec * 3000 / 1000` rounded up to 64 bytes, filled whole from
 * the file (`SoundStreamFill`, `FUN_004A3C70`), and `SoundStreamThread`
 * (`FUN_004A4640`) refills one half each time the play cursor crosses into the
 * other.
 *
 * The refill is a raw `ReadFile` of half a ring. When it comes back short --
 * **end of file, not end of the data chunk** -- the thread tests the channel's
 * loop bit (`+0x40 & 0x08000000`, set by `SoundChannelStartBuffer`,
 * `FUN_004A34B0`, when `PlaySoundId` passed `loop = 1`):
 *
 * ```c
 * if (read != want) {
 *     if (ch->flags & 0x08000000) {                      // 0x004A4991 / 0x004A4AAF
 *         SetFilePointer(ch->file, ch->dataStart, 0, FILE_BEGIN);
 *         ReadFile(ch->file, buf + read, want - read, &read, 0);
 *     } else {
 *         fill(buf + read, silence, want - read);        // and stop a half later
 *     }
 * }
 * ```
 *
 * So there are no loop points anywhere -- not in the file, not in a table.
 * **A looping track is the byte range `[dataStart, EOF)` played end to end
 * for ever**, with the wrap made inside one ring refill: gapless. Three
 * consequences follow, and all three are the game's:
 *
 * 1. **The loop restarts at the very first sample.** There is no intro that
 *    plays once. (That is also what the port did before; what it did not do
 *    was wrap without a gap -- an `<audio loop>` element measured an 8 ms run
 *    of digital silence at the seam of `ST1.WAV`.)
 * 2. **Whatever follows the data chunk is played as PCM.** Every shipped
 *    track ends in a `LIST` chunk -- 12, 38, 40 or 62 bytes -- and those bytes
 *    reach the speaker once per pass, between the last sample and the first.
 * 3. **A pass that is not a whole number of frames shifts the next pass.**
 *    `ReadFile` knows nothing of frames: the byte after EOF-1 is `dataStart`,
 *    written wherever the last read stopped. A track whose tail is 38 or 62
 *    bytes has a pass of `2 mod 4` bytes, so on 16-bit stereo every second
 *    pass starts one sample late -- **left and right exchanged** -- and the
 *    pattern repeats every two passes.
 *
 * {@link bgmStreamLayout} computes the period that captures all three, and
 * {@link bgmStreamFill} writes it out, so a Web Audio buffer looped over its
 * whole length plays exactly the byte stream the thread produces.
 *
 * A one-shot track (`loop = 0`) plays `[dataStart, EOF)` once, then silence,
 * and the thread stops the buffer a half-ring later; nothing audible follows.
 *
 * ## The one case this does not model
 *
 * The first fill is made while the channel's flags are still zero -- the loop
 * bit is set only afterwards, by `SoundChannelStartBuffer` -- so a *looping*
 * file **shorter than the ring** plays once, then silence to the end of the
 * ring, and only then wraps. No shipped looping track is that short (the
 * shortest is `ST6_BOS1_AR.WAV`, 25 s against a 3 s ring; `CLR2.WAV`, 4.35 s,
 * is one of the three one-shots), and `tools/verify_bgm_stream.py` asserts it
 * of every name in both tables, so the model below is exact for the game as
 * shipped rather than for every file the engine could be handed.
 */

/** `SoundPlayOnFreeChannel`'s channel for music: the one streamed channel. */
export const BGM_CHANNEL = 0xf;
/**
 * The ring's length in milliseconds -- the `3000` `SoundPlayOnFreeChannel`
 * passes `SoundChannelOpenWav` for channel `0xF` and for no other.
 */
export const BGM_RING_MS = 3000;

/** The `WAVEFORMATEX` fields the engine reads, and where the samples start. */
export interface WavStreamHeader {
  /**
   * The channel's `+0x3C`: every byte `SoundChannelOpenWav` counted on its
   * way to the `data` chunk, which is the file offset of the first sample and
   * the offset the stream seeks back to.
   */
  dataStart: number;
  /** The `data` chunk's own size -- read, and **not** used when streaming. */
  dataSize: number;
  formatTag: number;
  channels: number;
  sampleRate: number;
  avgBytesPerSec: number;
  blockAlign: number;
  bitsPerSample: number;
}

const tag = (b: Uint8Array, at: number): number =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const u32 = tag;
const u16 = (b: Uint8Array, at: number): number => b[at] | (b[at + 1] << 8);

const RIFF = 0x46464952; // "RIFF"
const WAVE = 0x45564157; // "WAVE"
const FMT_ = 0x20746d66; // "fmt "
const DATA = 0x61746164; // "data"

/**
 * The header walk of `SoundChannelOpenWav` (`FUN_004A3EF0`), as far as the
 * first byte it streams.
 *
 * Transcribed rather than written as a RIFF parser, because the two differ:
 * the engine counts `RIFF`'s tag and size and nothing of its body, skips
 * `WAVE` as a bare tag, reads at most `0x12` bytes of `fmt ` and seeks past
 * the rest, skips any other chunk by its size **with no word-alignment pad**,
 * and stops at the first `data`. Null where the engine's own read would fail
 * -- a truncated tag or size, or no `data` before end of file.
 */
export function wavStreamHeader(b: Uint8Array): WavStreamHeader | null {
  let at = 0;          // the file pointer
  let counted = 0;     // the channel's `+0x3C`
  let fmt: Omit<WavStreamHeader, "dataStart" | "dataSize"> | null = null;
  while (at + 4 <= b.length) {
    const t = tag(b, at);
    at += 4;
    counted += 4;
    if (t === RIFF) {
      if (at + 4 > b.length) return null;
      at += 4;
      counted += 4;
    } else if (t === WAVE) {
      // A bare tag: the `RIFF` size was consumed and nothing else is read.
    } else if (t === FMT_) {
      if (at + 4 > b.length) return null;
      const size = u32(b, at);
      at += 4;
      counted += size + 4;
      const f = at;
      // `size < 0x13` reads `size` bytes; otherwise `0x12` and a seek past
      // the remainder. Either way the fields below are the first 16.
      at += size;
      if (f + 16 > b.length) return null;
      fmt = {
        formatTag: u16(b, f), channels: u16(b, f + 2),
        sampleRate: u32(b, f + 4), avgBytesPerSec: u32(b, f + 8),
        blockAlign: u16(b, f + 12), bitsPerSample: u16(b, f + 14),
      };
    } else if (t === DATA) {
      counted += 4;
      if (at + 4 > b.length || !fmt) return null;
      const dataSize = u32(b, at);
      at += 4;
      return { dataStart: counted, dataSize, ...fmt };
    } else {
      if (at + 4 > b.length) return null;
      const size = u32(b, at);
      at += 4 + size;
      counted += size + 4;
    }
  }
  return null;
}

/**
 * The ring's size in bytes: `nAvgBytesPerSec * 3000 / 1000`, rounded **up**
 * to a multiple of 64 when it is not one already.
 */
export function bgmRingBytes(h: WavStreamHeader): number {
  let n = Math.floor(h.avgBytesPerSec * BGM_RING_MS / 1000) >>> 0;
  if (n & 0x3f) n = (n + 0x40) & ~0x3f;
  return n >>> 0;
}

/** How many frames of what, and whether the buffer is looped whole. */
export interface BgmStreamLayout {
  sampleRate: number;
  channels: number;
  /** Frames in the buffer -- one full period of the stream when `loop`. */
  frames: number;
  loop: boolean;
  /** `EOF - dataStart`: the bytes one pass of the file streams. */
  passBytes: number;
  /**
   * Passes of the file in one period: 1 when a pass is a whole number of
   * frames, 2 for a track whose `LIST` tail leaves it half a frame over, and
   * in general `lcm(passBytes, blockAlign) / passBytes`.
   */
  passes: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Size one period of the stream for a file of `fileBytes` bytes.
 *
 * Null for a format the port cannot decode -- anything but 8- or 16-bit PCM
 * -- which no shipped track is.
 */
export function bgmStreamLayout(h: WavStreamHeader, fileBytes: number,
                                loop: boolean): BgmStreamLayout | null {
  if (h.formatTag !== 1) return null;
  if (h.bitsPerSample !== 8 && h.bitsPerSample !== 16) return null;
  const bytesPerSample = h.bitsPerSample / 8;
  if (h.channels < 1 || h.blockAlign !== h.channels * bytesPerSample) return null;
  const passBytes = fileBytes - h.dataStart;
  if (passBytes <= 0) return null;
  const passes = loop ? h.blockAlign / gcd(passBytes, h.blockAlign) : 1;
  // A one-shot's last partial frame is completed with the silence the thread
  // fills after a short read; a loop's period is a whole number of frames by
  // construction.
  const frames = Math.ceil(passes * passBytes / h.blockAlign);
  return {
    sampleRate: h.sampleRate, channels: h.channels, frames, loop,
    passBytes, passes,
  };
}

/**
 * Write one period of the stream into `out` (one array per channel, each
 * `layout.frames` long), as floats in `[-1, 1)`.
 *
 * Byte `k` of the period is file byte `dataStart + k mod passBytes` -- the
 * `SetFilePointer(dataStart)` the thread makes at every end of file -- and a
 * frame is simply the next `blockAlign` of those bytes, which is what puts the
 * `LIST` tail on the speaker and the channels the wrong way round on an odd
 * pass. Past the end of a one-shot, the silence the thread fills: `0x80` for
 * 8-bit, `0x00` for 16.
 */
export function bgmStreamFill(b: Uint8Array, h: WavStreamHeader,
                              layout: BgmStreamLayout,
                              out: Float32Array[]): void {
  const { passBytes, channels, frames } = layout;
  const total = layout.loop ? layout.passes * passBytes : passBytes;
  const silence = h.bitsPerSample === 8 ? 0x80 : 0x00;
  const byteAt = (k: number): number => (k < total
    ? b[h.dataStart + (k % passBytes)] : silence);
  let k = 0;
  if (h.bitsPerSample === 16) {
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < channels; c++, k += 2) {
        let v = byteAt(k) | (byteAt(k + 1) << 8);
        if (v & 0x8000) v -= 0x10000;
        out[c][f] = v / 32768;
      }
    }
  } else {
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < channels; c++, k += 1) {
        out[c][f] = (byteAt(k) - 128) / 128;
      }
    }
  }
}

/** {@link bgmStreamLayout} and {@link bgmStreamFill} in one, for the tests. */
export function bgmStreamSamples(b: Uint8Array, loop: boolean): {
  header: WavStreamHeader; layout: BgmStreamLayout; samples: Float32Array[];
} | null {
  const header = wavStreamHeader(b);
  if (!header) return null;
  const layout = bgmStreamLayout(header, b.length, loop);
  if (!layout) return null;
  const samples = Array.from({ length: layout.channels },
                             () => new Float32Array(layout.frames));
  bgmStreamFill(b, header, layout, samples);
  return { header, layout, samples };
}

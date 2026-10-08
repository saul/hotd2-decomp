/**
 * The AAC sound set `tools/sounds.ts` writes, and how the page decodes it.
 *
 * `[port-only]`: the engine plays WAVs off the disc. See `tools/sounds.ts`
 * for why the page has a compressed copy and what is encoded -- the clips
 * whole, and each track as the period its stream plays.
 */

/** Bumped when the index's shape changes; a page refuses an index it cannot read. */
export const SOUND_INDEX_FORMAT = 1;
/**
 * `afconvert`'s AAC encoder delay: the samples of priming before the first
 * real one. Apple's documented 2,112, and measured -- see `tools/sounds.ts`.
 */
export const AAC_PRIMING = 2112;

/** One sound in the index. */
export interface SoundIndexEntry {
  /** Its sample rate, channel count and true length in frames. */
  rate: number;
  channels: number;
  frames: number;
  /** A track: its own file, relative to the index. */
  file?: string;
  /** A clip: `[offset, length]` in the pack. */
  pack?: [number, number];
}

/**
 * `sounds.json`. Keyed as the page asks for a WAV -- `soundUrl`'s lowercased
 * `kind/path` -- and a track by that plus `#loop` or `#once`.
 */
export interface SoundIndex {
  format: number;
  codec: "aac";
  bitrate: number;
  priming: number;
  /** Every clip, end to end, relative to the index. */
  pack: string;
  files: Record<string, SoundIndexEntry>;
}

/**
 * Where the real samples are in a decode of `decoded` frames, for a sound of
 * `frames` that was encoded with `priming` frames before it.
 *
 * A decoder hands back the priming and the padding, the padding alone, or
 * neither: Chrome, Safari and `ffmpeg` need not agree, and nothing in the
 * decode says which it did. The padding rounds the stream up to a whole AAC
 * frame -- under 1,024, so under the 2,112 of priming -- and that is what tells
 * them apart: a decode at least `priming` longer than the sound still holds
 * its priming, and any shorter one does not.
 */
export function aacTrim(decoded: number, frames: number,
                        priming: number): { lead: number; length: number } {
  const lead = decoded - frames >= priming ? priming : 0;
  return { lead, length: Math.max(0, Math.min(frames, decoded - lead)) };
}

/**
 * Decode one sound at its own sample rate and cut it to its true length.
 *
 * An `OfflineAudioContext` at the file's rate, so the decode is not resampled
 * and the frame counts in the index mean what they say; the buffer it makes
 * plays in any context, which resamples it there as it does a WAV's.
 */
export async function decodeAac(bytes: ArrayBuffer, e: SoundIndexEntry,
                                priming: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(e.channels, 1, e.rate);
  const raw = await ctx.decodeAudioData(bytes);
  const { lead, length } = aacTrim(raw.length, e.frames, priming);
  const out = new AudioBuffer({
    numberOfChannels: raw.numberOfChannels, length: Math.max(1, length),
    sampleRate: raw.sampleRate,
  });
  for (let c = 0; c < raw.numberOfChannels; c++) {
    out.copyToChannel(raw.getChannelData(c).subarray(lead, lead + length), c);
  }
  return out;
}

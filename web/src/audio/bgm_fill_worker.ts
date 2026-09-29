/**
 * A track's stream period, filled off the main thread.
 *
 * `bgmStreamFill` turns a whole track's PCM into floats one sample at a time
 * -- ten million of them for a three-minute stereo track -- and on the main
 * thread that was a frame of a tenth of a second on a desktop, and several on
 * a phone, whenever the music changed in the middle of play. Here it is the
 * same function, on the same bytes, and the page only copies the result in.
 */
import { bgmStreamFill, bgmStreamLayout, wavStreamHeader } from "./stream";

/** A request: the file's bytes, handed over, and whether it loops. */
export interface FillIn {
  id: number;
  bytes: ArrayBuffer;
  loop: boolean;
}

/** The answer: one array per channel, handed back, or null for a file this cannot read. */
export interface FillOut {
  id: number;
  sampleRate: number;
  channels: Float32Array<ArrayBuffer>[] | null;
}

self.onmessage = (ev: MessageEvent<FillIn>) => {
  const { id, bytes, loop } = ev.data;
  const b = new Uint8Array(bytes);
  const header = wavStreamHeader(b);
  const layout = header && bgmStreamLayout(header, b.length, loop);
  const post = (m: FillOut, t: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(m, t);
  if (!header || !layout) return post({ id, sampleRate: 0, channels: null });
  const out: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < layout.channels; c++) out.push(new Float32Array(layout.frames));
  bgmStreamFill(b, header, layout, out);
  post({ id, sampleRate: layout.sampleRate, channels: out }, out.map((a) => a.buffer));
};

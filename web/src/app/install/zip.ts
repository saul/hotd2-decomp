/**
 * A store-only ZIP writer, so a bundle built in the page can be taken out of
 * it.
 *
 * **No compression, on purpose.** A GLB is 99% of a stage bundle and it is
 * already packed -- vertex floats and a PNG per texture -- so deflating it
 * costs a minute and saves a few percent. The `.json` files do compress, and
 * they are the other 1%. A `.zip` that unpacks straight into `extract/player/`
 * is what this is for, not an archive.
 *
 * Zip64 is not emitted and does not need to be: the format's 32-bit fields cap
 * an entry at 4 GB and the archive at 4 GB, and the whole twelve-bundle export
 * is 411 MB. A single archive that big is still a bad idea to build in memory,
 * which is why {@link zipStream} streams rather than returning a blob.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = (CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function le(...pairs: [number, number][]): Uint8Array {
  const size = pairs.reduce((n, [, w]) => n + w, 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const [v, w] of pairs) {
    let x = v >>> 0;
    for (let i = 0; i < w; i++) { out[o++] = x & 0xff; x = Math.floor(x / 256); }
  }
  return out;
}

const encoder = new TextEncoder();

interface Entry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

/** One file to put in the archive. */
export interface ZipFile {
  path: string;
  blob: Blob;
}

/**
 * A `ReadableStream` of the archive holding *files*.
 *
 * Streamed because the whole export is bigger than a comfortable `Blob`: the
 * caller pipes it at a `showSaveFilePicker` handle, or wraps it in a `Response`
 * for a download link. Each file is read one at a time, so peak memory is one
 * file rather than the archive.
 */
export function zipStream(files: ZipFile[]): ReadableStream<Uint8Array> {
  let i = 0;
  let offset = 0;
  const entries: Entry[] = [];

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i < files.length) {
        const f = files[i++];
        const name = encoder.encode(f.path);
        const data = new Uint8Array(await f.blob.arrayBuffer());
        const crc = crc32(data);
        entries.push({ name, crc, size: data.length, offset });
        // Local file header: version 2.0, no flags, method 0 (stored), and a
        // zero date, because a bundle's timestamps are not part of it.
        const head = le([0x04034b50, 4], [20, 2], [0, 2], [0, 2],
                        [0, 2], [0, 2], [crc, 4],
                        [data.length, 4], [data.length, 4],
                        [name.length, 2], [0, 2]);
        controller.enqueue(head);
        controller.enqueue(name);
        controller.enqueue(data);
        offset += head.length + name.length + data.length;
        return;
      }

      // Central directory, then the end record, then done.
      const start = offset;
      for (const e of entries) {
        const rec = le([0x02014b50, 4], [20, 2], [20, 2], [0, 2], [0, 2],
                       [0, 2], [0, 2], [e.crc, 4], [e.size, 4], [e.size, 4],
                       [e.name.length, 2], [0, 2], [0, 2], [0, 2], [0, 2],
                       [0, 4], [e.offset, 4]);
        controller.enqueue(rec);
        controller.enqueue(e.name);
        offset += rec.length + e.name.length;
      }
      controller.enqueue(le([0x06054b50, 4], [0, 2], [0, 2],
                            [entries.length, 2], [entries.length, 2],
                            [offset - start, 4], [start, 4], [0, 2]));
      controller.close();
    },
  });
}

/** The archive as one `Blob`. Fine for a stage; not for the whole export. */
export async function zipBlob(files: ZipFile[]): Promise<Blob> {
  const chunks: BlobPart[] = [];
  const reader = zipStream(files).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    // `slice()` rather than the view: a `Uint8Array` may be backed by a
    // `SharedArrayBuffer`, which `Blob` does not take, and the copy is the
    // chunk rather than the archive.
    chunks.push((value as Uint8Array).slice().buffer);
  }
  return new Blob(chunks, { type: "application/zip" });
}

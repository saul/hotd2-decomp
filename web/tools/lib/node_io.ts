/**
 * The node half of `src/hod2lib/io.ts`: a game directory read with `node:fs`,
 * a bundle directory written with it, and zlib for PNG.
 *
 * It lives under `tools/` rather than under `src/` because it is not part of
 * the player. `src/hod2lib/` is pure and takes its bytes from an interface;
 * this is one implementation of that interface and the browser's is the other.
 * Putting it in `src/` would put `node:fs` inside the engine layer, which is
 * the boundary `tools/verify_layers.py` exists to hold.
 */
import { deflate } from "node:zlib";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { AssetSource, BundleSink, Deflate } from "../../src/hod2lib/io";
import { resolveCase, segments } from "../../src/hod2lib/io";

/**
 * A game install on disk.
 *
 * Case-insensitive resolution is cached per directory: the exporter asks for
 * some thousands of paths under `pol/` and `tex/`, and re-reading a directory
 * listing for each of them is most of an export's syscall budget on a cold
 * cache.
 */
export class NodeAssetSource implements AssetSource {
  readonly label: string;
  private listings = new Map<string, string[]>();
  private resolved = new Map<string, string | null>();

  constructor(private readonly root: string) {
    this.label = root;
  }

  private async listDir(rel: string): Promise<string[]> {
    const hit = this.listings.get(rel);
    if (hit) return hit;
    const names = await readdir(rel ? join(this.root, rel) : this.root);
    this.listings.set(rel, names);
    return names;
  }

  private async real(path: string): Promise<string | null> {
    if (this.resolved.has(path)) return this.resolved.get(path)!;
    const r = await resolveCase(path, (d) => this.listDir(d));
    this.resolved.set(path, r);
    return r;
  }

  async read(path: string): Promise<Uint8Array> {
    const real = await this.real(path);
    if (real === null) throw new Error(`no such file under ${this.root}: ${path}`);
    return new Uint8Array(await readFile(join(this.root, real)));
  }

  async exists(path: string): Promise<boolean> {
    return (await this.real(path)) !== null;
  }

  async list(dir: string): Promise<string[]> {
    const real = dir ? await this.real(dir) : "";
    if (real === null) return [];
    return this.listDir(real);
  }
}

/** A bundle directory on disk, laid out exactly like `extract/player/`. */
export class NodeBundleSink implements BundleSink {
  constructor(readonly root: string) {}

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const file = join(this.root, ...segments(path));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, typeof data === "string" ? data : data);
  }

  async readJson<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(
        await readFile(join(this.root, ...segments(path)), "utf8")) as T;
    } catch {
      return null;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      return (await stat(join(this.root, ...segments(path)))).isFile();
    } catch {
      return false;
    }
  }
}

/**
 * zlib, at the level PNG asks for.
 *
 * This is the same zlib Python's `zlib.compress(data, 6)` calls, with the same
 * window and memory level, so a PNG written here is byte-identical to one
 * written by `tools/hod2lib/png.py`. The browser's `CompressionStream` is not
 * promised to be.
 */
export const nodeDeflate: Deflate = (data, level) =>
  new Promise((ok, fail) => {
    deflate(data, { level }, (err, buf) =>
      err ? fail(err) : ok(new Uint8Array(buf)));
  });

export function absolute(path: string): string {
  return resolve(path.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
}

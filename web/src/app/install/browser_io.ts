/**
 * The browser half of `src/hod2lib/io.ts`: a game install the user pointed at,
 * a bundle cache in the Origin Private File System, and `CompressionStream`
 * for PNG.
 *
 * This is the app layer because it is the composition root's business where
 * the bytes come from. `src/hod2lib/` is pure and takes an interface; `node_io`
 * under `tools/` is the other implementation of it.
 *
 * **Two ways to choose an install, and they are not equivalent.**
 * `showDirectoryPicker` gives a handle that can be stored and re-used, so the
 * page remembers the install across reloads. Firefox and Safari have no such
 * API, and `<input type="file" webkitdirectory>` gives a flat `FileList` that
 * cannot be persisted at all -- so those browsers re-prompt every session.
 * That is the browser's rule, not a shortcut.
 */

import type { AssetSource, BundleSink, Deflate } from "../../hod2lib/io";
import { resolveCase, segments } from "../../hod2lib/io";

/** Whether this browser can hand out a directory handle we can keep. */
export function canPickDirectory(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown })
    .showDirectoryPicker === "function";
}

/**
 * An install behind a `FileSystemDirectoryHandle`.
 *
 * Directory listings are cached, like the node source's, because the exporter
 * asks for some thousands of paths and each `getDirectoryHandle` is a real
 * call into the browser's file layer.
 */
export class HandleAssetSource implements AssetSource {
  readonly label: string;
  private listings = new Map<string, string[]>();
  private resolved = new Map<string, string | null>();

  constructor(private readonly root: FileSystemDirectoryHandle, label?: string) {
    this.label = label ?? root.name;
  }

  private async dirHandle(rel: string): Promise<FileSystemDirectoryHandle> {
    let d = this.root;
    for (const part of segments(rel)) d = await d.getDirectoryHandle(part);
    return d;
  }

  private async listDir(rel: string): Promise<string[]> {
    const hit = this.listings.get(rel);
    if (hit) return hit;
    const names: string[] = [];
    const d = await this.dirHandle(rel);
    for await (const name of (d as unknown as
        { keys(): AsyncIterable<string> }).keys()) {
      names.push(name);
    }
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
    if (real === null) throw new Error(`no such file in the install: ${path}`);
    const parts = segments(real);
    const dir = await this.dirHandle(parts.slice(0, -1).join("/"));
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    return new Uint8Array(await (await fh.getFile()).arrayBuffer());
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

/**
 * An install chosen with `<input webkitdirectory>`, which hands over a flat
 * list of `File`s whose `webkitRelativePath` starts with the directory's own
 * name. That first segment is dropped so the paths look like every other
 * source's.
 */
export class FileListAssetSource implements AssetSource {
  readonly label: string;
  private byLower = new Map<string, File>();
  private children = new Map<string, Set<string>>();

  constructor(files: Iterable<File>, label?: string) {
    let root = "";
    for (const f of files) {
      const rel = (f as File & { webkitRelativePath?: string })
        .webkitRelativePath ?? f.name;
      const parts = segments(rel);
      if (!root && parts.length > 1) root = parts[0];
      const path = (parts[0] === root ? parts.slice(1) : parts).join("/");
      if (!path) continue;
      this.byLower.set(path.toLowerCase(), f);
      // Directory membership, so `list()` answers without a second index.
      const seg = segments(path);
      for (let i = 0; i < seg.length; i++) {
        const dir = seg.slice(0, i).join("/").toLowerCase();
        let s = this.children.get(dir);
        if (!s) { s = new Set(); this.children.set(dir, s); }
        s.add(seg[i]);
      }
    }
    this.label = label ?? root ?? "install";
  }

  async read(path: string): Promise<Uint8Array> {
    const f = this.byLower.get(path.toLowerCase());
    if (!f) throw new Error(`no such file in the install: ${path}`);
    return new Uint8Array(await f.arrayBuffer());
  }

  async exists(path: string): Promise<boolean> {
    return this.byLower.has(path.toLowerCase());
  }

  async list(dir: string): Promise<string[]> {
    return [...(this.children.get(dir.toLowerCase()) ?? [])];
  }
}

/** Where the cached bundle lives inside the origin's private file system. */
export const CACHE_DIR = "bundle";

async function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

async function opfsDir(path: string,
                       create: boolean): Promise<FileSystemDirectoryHandle | null> {
  let d = await opfsRoot();
  for (const part of [CACHE_DIR, ...segments(path)]) {
    try {
      d = await d.getDirectoryHandle(part, { create });
    } catch {
      return null;
    }
  }
  return d;
}

/**
 * The bundle cache: the same tree `extract/player/` holds, in OPFS.
 *
 * Same layout and same names on purpose, so one reader serves both and there
 * is no second arrangement to keep true. OPFS survives a reload and is not
 * swept the way a Cache API entry can be, but a browser may still evict it
 * under storage pressure -- `requestPersist` below asks not to be.
 */
export class OpfsBundleSink implements BundleSink {
  async write(path: string, data: Uint8Array | string): Promise<void> {
    const parts = segments(path);
    const dir = await opfsDir(parts.slice(0, -1).join("/"), true);
    if (!dir) throw new Error(`cannot create ${path} in the cache`);
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(typeof data === "string" ? data : (data as BufferSource));
    await w.close();
  }

  async readJson<T>(path: string): Promise<T | null> {
    try {
      const f = await openCached(path);
      return f ? JSON.parse(await f.text()) as T : null;
    } catch {
      return null;
    }
  }

  async exists(path: string): Promise<boolean> {
    return (await openCached(path)) !== null;
  }
}

/** One file out of the cache, or null. */
export async function openCached(path: string): Promise<File | null> {
  const parts = segments(path);
  const dir = await opfsDir(parts.slice(0, -1).join("/"), false);
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    return await fh.getFile();
  } catch {
    return null;
  }
}

/** Every file in the cache, as `path -> File`, deepest last. */
export async function listCached(): Promise<Map<string, File>> {
  const out = new Map<string, File>();
  const root = await opfsDir("", false);
  if (!root) return out;
  const walk = async (d: FileSystemDirectoryHandle,
                      prefix: string): Promise<void> => {
    for await (const [name, h] of (d as unknown as
        { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (h.kind === "directory") {
        await walk(h as FileSystemDirectoryHandle, path);
      } else {
        out.set(path, await (h as FileSystemFileHandle).getFile());
      }
    }
  };
  await walk(root, "");
  return out;
}

/** Delete the whole cache. Used by "clear" and before a full rebuild. */
export async function clearCache(): Promise<void> {
  const root = await opfsRoot();
  try {
    await (root as unknown as {
      removeEntry(n: string, o: { recursive: boolean }): Promise<void>;
    }).removeEntry(CACHE_DIR, { recursive: true });
  } catch {
    // Nothing to clear, which is the same end state.
  }
}

/**
 * Ask the browser not to evict the cache.
 *
 * A full export is 411 MB. Without a persistence grant that sits in the
 * "best effort" bucket, which a browser is free to drop when the disk fills --
 * and the failure looks like a bundle that was there yesterday and is not
 * there now. Asking costs one prompt at most and is a no-op where the API is
 * missing.
 */
export async function requestPersist(): Promise<boolean> {
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** How much room the origin has, for the warning before a full export. */
export async function storageEstimate():
    Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

/**
 * zlib deflate, from the platform.
 *
 * `CompressionStream("deflate")` emits a zlib stream, which is what PNG's
 * IDAT holds. It is the same library node's `zlib` is, but the level and
 * strategy are the engine's choice, so a PNG written here need not be byte
 * identical to one written by the CLI. The pixels are, which is the guarantee
 * docs/TS_PORT.md makes.
 */
export const browserDeflate: Deflate = async (data) => {
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  void writer.write(data as BufferSource);
  void writer.close();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = cs.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
    total += (value as Uint8Array).length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
};

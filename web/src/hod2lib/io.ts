/**
 * The seam. Everything in this package is a pure function of bytes; this file
 * is where the bytes come from and where they go.
 *
 * `tools/hod2lib/` opens files. It can, because it only ever runs on a machine
 * with the install on it. This package runs in a browser too, where "open a
 * file" is a directory handle the user granted, and in node, where it is
 * `node:fs` — so no module below this one is allowed to know which.
 *
 * The implementations live outside the package on purpose: `web/tools/lib/`
 * for the CLI, `web/src/app/install/` for the page. Nothing here imports them.
 *
 * See docs/TS_PORT.md.
 */

/**
 * The game install, as a flat read-only namespace.
 *
 * Paths are `evt/st1evtbl.bin` — forward slashes, relative to the directory
 * holding `Hod2.exe`, and **resolved case-insensitively**. That is not a
 * convenience: the tables compiled into the exe spell `COMMON\BLOOD01_16.WAV`
 * and the files on disk are lowercase under real directories, so the game's
 * own spelling has to reach an implementation that can still find the file.
 */
export interface AssetSource {
  /** The whole file. Rejects if it is not there. */
  read(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  /** Entry names directly under *dir*, in no particular order. */
  list(dir: string): Promise<string[]>;
  /** For `manifest.json`'s `game_dir`, and for the sound middleware. */
  readonly label: string;
}

/** Where the bundle goes. Paths are relative to the bundle root. */
export interface BundleSink {
  write(path: string, data: Uint8Array | string): Promise<void>;
  /** The bundle's own `manifest.json`, if this sink already holds one. */
  readJson<T>(path: string): Promise<T | null>;
  /** Whether a file this sink previously wrote is still there. */
  exists(path: string): Promise<boolean>;
}

/**
 * zlib deflate, at the level PNG asks for.
 *
 * Node has `zlib.deflateSync`, which is the same zlib Python calls and emits
 * the same bytes. The browser has `CompressionStream("deflate")`, which is
 * also zlib but chooses its own level. Both decode to the same pixels, which
 * is the guarantee `docs/TS_PORT.md` makes and the one the parity check
 * asserts.
 */
export type Deflate = (data: Uint8Array, level: number) => Promise<Uint8Array>;

/** One line of progress. The CLI prints it; the page puts it in a feed. */
export type Progress = (line: string) => void;

/** Everything the export needs from its host, in one bag. */
export interface Host {
  source: AssetSource;
  sink: BundleSink;
  deflate: Deflate;
  progress: Progress;
}

/** Split a path the way both implementations need it. */
export function segments(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter((s) => s.length > 0);
}

/**
 * Resolve *path* against a listing function, one segment at a time, matching
 * case-insensitively. Returns the real spelling, or null.
 *
 * Shared by both implementations rather than written twice: `vite.config.ts`
 * had its own copy for the sound middleware and it is the same walk.
 */
export async function resolveCase(
  path: string,
  list: (dir: string) => Promise<string[]>,
): Promise<string | null> {
  const parts = segments(path);
  const out: string[] = [];
  for (const want of parts) {
    const here = out.join("/");
    let hit: string | null = null;
    let names: string[];
    try {
      names = await list(here);
    } catch {
      return null;
    }
    for (const n of names) {
      if (n === want) { hit = n; break; }
      if (hit === null && n.toLowerCase() === want.toLowerCase()) hit = n;
    }
    if (hit === null) return null;
    out.push(hit);
  }
  return out.join("/");
}

/**
 * The fixed input set: every file of a HOTD2 (PC) install, with its size and
 * SHA-256, in `manifest.csv` at the repository root.
 *
 *     cd web && node tools/run_ts.mjs tools/baseline.ts --game-dir ~/"THE HOUSE OF THE DEAD 2" --verify
 *     cd web && node tools/run_ts.mjs tools/baseline.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `--verify` checks the install against the recorded manifest and writes
 * nothing; without it, the manifest is written from the install. It holds
 * metadata and hashes only, never asset content. `--out-dir` puts the
 * manifest somewhere other than the repository root.
 *
 * **Every reading this repository takes from the game is only as good as the
 * bytes it read.** Files rot on local media -- scattered bytes smashed to
 * `0xFF` in four `cam/` files and `evt/st1evtbl.bin` cost this project a
 * fortnight of work explaining damage as a format convention -- and two copies
 * of the same *installed* tree agreeing with each other says nothing about the
 * disc. So `--verify` reports three kinds of difference and does not
 * editorialise about which is which: a hash that moved may be rot, may be a
 * patch applied on purpose, may be a different release. It is for the reader
 * to say. The one thing it will not do is let an install drift from its
 * record in silence.
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
         readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { repoRoot } from "./lib/bundle_root";

const ASSET_DIRS = ["pol", "tex", "mot", "cam", "coli", "evt", "sound"];

const USAGE = "usage: baseline.ts [-h] --game-dir GAME_DIR [--out-dir OUT_DIR] [--verify]";

function usageError(msg: string): never {
  console.error(`${USAGE}\nbaseline.ts: error: ${msg}`);
  process.exit(2);
}

function sha256(path: string): string {
  const h = createHash("sha256");
  const buf = Buffer.alloc(1 << 20);
  const fd = openSync(path, "r");
  try {
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;       // not-a-loss: a dangling link is not a file
  }
}

/**
 * Every file under `dir`, as `/`-separated paths relative to it, in path
 * order -- component by component, so `a/b` sorts before `a-b/c`. A link to
 * a file counts as the file; a link to a directory is not followed.
 */
function files(dir: string, prefix: string[] = []): string[][] {
  const out: string[][] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = [...prefix, name];
    if (lstatSync(p).isDirectory()) out.push(...files(p, rel));
    else if (isFile(p)) out.push(rel);
  }
  return out.sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
    }
    return a.length - b.length;
  });
}

/** One CSV field, quoted only when it has to be. */
function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** `text` as CSV records: quoted fields, doubled quotes, any line ending. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') quoted = false;
      else field += c;
      i++;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") endField();
    else if (c === "\r" || c === "\n") {
      endRow();
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
    i++;
  }
  if (field || row.length) endRow();
  return rows;
}

/** Write `manifest.csv` for the install at `gameDir`. Returns the file count. */
function writeManifest(gameDir: string, out: string): number {
  const lines = ["path,size,sha256"];
  const all = files(gameDir);
  for (const rel of all) {
    const p = join(gameDir, ...rel);
    lines.push([rel.join("/"), String(statSync(p).size), sha256(p)].map(csvField).join(","));
  }
  writeFileSync(out, lines.map((l) => `${l}\r\n`).join(""), "utf8");
  return all.length;
}

/** Check the install at `gameDir` against a recorded manifest. Returns an exit code. */
function verifyManifest(gameDir: string, manifest: string): number {
  if (!isFile(manifest)) {
    console.error(`error: no manifest at ${manifest}`);
    return 2;
  }
  const [header, ...body] = csvRows(readFileSync(manifest, "utf8"));
  const col = (name: string): number => header!.indexOf(name);
  const recorded = new Map<string, { size: number; sha256: string }>();
  for (const r of body) {
    if (!r.length || (r.length === 1 && r[0] === "")) continue;
    recorded.set(r[col("path")]!, { size: Number(r[col("size")]), sha256: r[col("sha256")]! });
  }
  const onDisk = new Set(files(gameDir).map((rel) => rel.join("/")));
  const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

  const changed: [string, number, number][] = [];
  for (const rel of [...recorded.keys()].sort(order)) {
    const f = join(gameDir, rel);
    if (!isFile(f)) continue;
    const row = recorded.get(rel)!;
    if (sha256(f) !== row.sha256) changed.push([rel, row.size, statSync(f).size]);
  }
  const missing = [...recorded.keys()].filter((r) => !onDisk.has(r)).sort(order);
  const extra = [...onDisk].filter((r) => !recorded.has(r)).sort(order);

  for (const [rel, was, now] of changed) {
    console.log(`  CHANGED  ${rel}  (${was === now ? "same size" : `${was} -> ${now} bytes`})`);
  }
  for (const rel of missing) console.log(`  MISSING  ${rel}`);
  for (const rel of extra) console.log(`  EXTRA    ${rel}`);

  const n = changed.length + missing.length + extra.length;
  console.log(`\n${recorded.size} recorded, ${changed.length} changed, `
              + `${missing.length} missing, ${extra.length} not in the manifest`);
  if (n === 0) {
    console.log("install matches the manifest");
    return 0;
  }
  console.log("\nIf these differences are intended -- a restore from the disc, a "
              + "patch you applied --\nregenerate the manifest and say why in "
              + "docs/re/provenance.md. If they are not,\nyou have found bit-rot, "
              + "and every reading taken from those files is suspect.");
  return 1;
}

function main(argv: readonly string[]): number {
  let gameArg: string | null = null;
  let outArg: string | null = null;
  let verify = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const [flag, inline] = a.startsWith("--") && a.includes("=")
      ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, null];
    const value = (): string => inline ?? argv[++i] ?? usageError(`argument ${flag}: expected one argument`);
    if (flag === "--game-dir") gameArg = value();
    else if (flag === "--out-dir") outArg = value();
    else if (a === "--verify") verify = true;
    else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      return 0;
    } else usageError(`unrecognized arguments: ${a}`);
  }
  if (gameArg === null) usageError("the following arguments are required: --game-dir");

  const gameDir = resolve(gameArg.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
  if (!existsSync(gameDir) || !statSync(gameDir).isDirectory()) {
    console.error(`error: not a directory: ${gameDir}`);
    return 1;
  }
  const missing = ASSET_DIRS.filter((d) => {
    const p = join(gameDir, d);
    return !existsSync(p) || !statSync(p).isDirectory();
  });
  if (missing.length) console.error(`warning: missing expected directories: ${missing.join(", ")}`);

  const outDir = outArg === null ? repoRoot() : resolve(outArg);
  if (verify) return verifyManifest(gameDir, join(outDir, "manifest.csv"));

  mkdirSync(outDir, { recursive: true });
  const n = writeManifest(gameDir, join(outDir, "manifest.csv"));
  console.log(`manifest.csv    ${n} files hashed`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));

/**
 * Stage the player as a static site -- the page, a bundle and the sounds, in
 * one directory any static host can serve -- and optionally upload it to S3.
 *
 *     npm run site                                  # stage into extract/site/
 *     npm run site -- --gzip --check                # ...compressed, then play it
 *     npm run site -- --gzip --sync s3://bucket/<secret>
 *
 * **What is staged is the game's data.** The bundle and the sounds are derived
 * from a copyrighted install, so the default output is under `extract/`,
 * which `.gitignore` already keeps out of the repository, and the place it is
 * uploaded to must be private. `docs/HOSTING.md` says how, and why a private
 * bucket behind CloudFront is the shape that works on a phone.
 *
 * The layout is the one the page already asks for, relative to itself:
 *
 *     index.html, assets/      `vite build`, with `base: "./"`
 *     manifest.webmanifest     the same, from `public/`
 *     icons/                   the favicon and Home Screen icons, David's face
 *                              out of the install's exe (`lib/app_icon.ts`)
 *     bundle/                  the export, as `serverSource` fetches it
 *     bgm/ se/ voice/          the install's `sound/`, **lowercased**
 *
 * Lowercased because the dev server resolves a sound's name case-insensitively
 * and a static host cannot -- an S3 key is exact, and the exe's tables do not
 * spell names the way the install does. `audio/bgm.ts`'s `soundUrl` asks for
 * every file in lowercase, so the two meet without either knowing the other's
 * spelling; this refuses an install where two files differ in case alone,
 * which is the one thing that would make that unsafe.
 *
 * `--gzip` stores every bundle file gzip-compressed under its own name, for a
 * host told to send `Content-Encoding: gzip` with them -- which `--sync` does
 * and `tools/site_check.mjs` does. A stage's GLB is 73 MB and 30 MB gzipped,
 * and CloudFront will not compress anything over 10 MB itself. Off by
 * default, because a plain host (`tailscale serve`, `python -m http.server`)
 * would hand the page the compressed bytes as they are.
 *
 * Staging is incremental: a file whose source is not newer than its staged
 * copy is left alone, mtime and all, which is also what lets `aws s3 sync`
 * skip it. A bundle this client would refuse, or one with a stage an older
 * exporter wrote, is refused here too -- a gigabyte uploaded to be told so by
 * a phone is the expensive way to find out.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, statSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import type { Manifest } from "../src/bundle/manifest";
import { manifestRefusal, stageBuilderStale } from "../src/bundle/load";
import { BUNDLE_ROOT, repoRoot } from "./lib/bundle_root";
import { APP_ICONS, appIcon } from "./lib/app_icon";

const USAGE = `usage: npm run site -- [options]

  --bundle <dir>     the export to stage (default: HOTD2_BUNDLE, else extract/player)
  --game-dir <dir>   the install whose sound/ to stage (default: the manifest's game_dir)
  --out <dir>        where to stage it (default: extract/site)
  --gzip             store the bundle gzip-compressed; the host must send
                     Content-Encoding: gzip (--sync does)
  --no-sound         leave the sounds out (about 370 MB)
  --allow-stale      stage stages an older exporter wrote
  --check            serve the staged site case-sensitively and play stage 1
  --sync <s3-url>    upload it with the AWS CLI: s3://bucket/prefix
  --dryrun           with --sync, show what would be uploaded`;

interface Args {
  bundle: string;
  gameDir: string;
  out: string;
  gzip: boolean;
  sound: boolean;
  allowStale: boolean;
  check: boolean;
  sync: string;
  dryrun: boolean;
}

/** What was staged, so a later run knows whether `--gzip` changed. */
interface SiteRecord {
  gzip: boolean;
  sound: boolean;
  bundle: string;
  staged: string;
}

const REPO = repoRoot();
const WEB = join(REPO, "web");

function parseArgs(argv: string[]): Args {
  const a: Args = {
    bundle: BUNDLE_ROOT, gameDir: "", out: join(REPO, "extract", "site"),
    gzip: false, sound: true, allowStale: false, check: false, sync: "",
    dryrun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => {
      const v = argv[++i];
      if (!v) fail(`${k} needs a value`);
      return v;
    };
    switch (k) {
      case "--bundle": a.bundle = resolve(val()); break;
      case "--game-dir": a.gameDir = resolve(val()); break;
      case "--out": a.out = resolve(val()); break;
      case "--gzip": a.gzip = true; break;
      case "--no-sound": a.sound = false; break;
      case "--allow-stale": a.allowStale = true; break;
      case "--check": a.check = true; break;
      case "--sync": a.sync = val(); break;
      case "--dryrun": case "--dry-run": a.dryrun = true; break;
      case "-h": case "--help": console.log(USAGE); process.exit(0); break;
      default: fail(`unknown argument ${k}\n\n${USAGE}`);
    }
  }
  if (a.sync && !/^s3:\/\/[^/]+/.test(a.sync)) {
    fail(`--sync wants an s3:// URL, not ${a.sync}`);
  }
  return a;
}

function fail(msg: string): never {
  console.error(`site: ${msg}`);
  process.exit(1);
}

function mb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

/** Every file under `dir`, as paths relative to it. */
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

/**
 * Put `src` at `dst` unless `dst` is already at least as new, and give `dst`
 * the source's mtime so the next run -- and `aws s3 sync` -- can tell.
 * Returns the bytes staged, 0 when it was skipped.
 */
function stageFile(src: string, dst: string, gzip: boolean): number {
  const s = statSync(src);
  // Within a millisecond: `utimes` below goes through a float of seconds and
  // keeps no more than that, and a source stamped in nanoseconds would
  // otherwise look newer than its own copy about half the time.
  if (existsSync(dst) && statSync(dst).mtimeMs >= s.mtimeMs - 1) return 0;
  mkdirSync(dirname(dst), { recursive: true });
  if (gzip) {
    // Level 9 and no timestamp in the header (Node writes none), so the same
    // input stages the same bytes every time.
    writeFileSync(dst, gzipSync(readFileSync(src), { level: 9 }));
  } else {
    copyFileSync(src, dst);
  }
  utimesSync(dst, s.atime, s.mtime);
  return s.size;
}

/** Remove what is staged under `dir` and no longer has a source. */
function prune(dir: string, keep: Set<string>): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const rel of walk(dir)) {
    if (keep.has(rel)) continue;
    rmSync(join(dir, rel));
    n++;
  }
  return n;
}

function readRecord(out: string): SiteRecord | null {
  try {
    return JSON.parse(readFileSync(join(out, "site.json"), "utf8")) as SiteRecord;
  } catch {
    return null;
  }
}

// -- the steps ---------------------------------------------------------------

function checkBundle(a: Args): Manifest {
  const path = join(a.bundle, "manifest.json");
  if (!existsSync(path)) {
    fail(`no bundle at ${a.bundle}. Build one: npm run export -- --game-dir "..." --all`);
  }
  const m = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  const no = manifestRefusal(m);
  if (no) fail(`the page would refuse ${path}: ${no}`);
  const stale = m.stages.filter((s) => stageBuilderStale(s.builder))
    .map((s) => s.name);
  if (stale.length && !a.allowStale) {
    fail(`written by an older exporter: ${stale.join(", ")}. Re-export them, `
      + `or pass --allow-stale to stage them anyway -- the page will mark them`);
  }
  const missing = m.stages.filter((s) => !existsSync(join(a.bundle, s.name, s.geometry)))
    .map((s) => s.name);
  if (missing.length) fail(`the manifest names stages that are not there: ${missing.join(", ")}`);
  return m;
}

function buildPage(out: string): void {
  const tmp = mkdtempSync(join(tmpdir(), "hod2-site-"));
  const r = spawnSync("npx", ["vite", "build", "--outDir", tmp, "--emptyOutDir"],
                      { cwd: WEB, stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) fail("vite build failed");
  // The hashed assets of the last build go: nothing but the index names them,
  // and the index is replaced with them.
  rmSync(join(out, "assets"), { recursive: true, force: true });
  cpSync(tmp, out, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
}

function stageBundle(a: Args, restage: boolean): void {
  const dst = join(a.out, "bundle");
  if (restage) rmSync(dst, { recursive: true, force: true });
  const files = walk(a.bundle);
  let bytes = 0;
  let n = 0;
  for (const rel of files) {
    const b = stageFile(join(a.bundle, rel), join(dst, rel), a.gzip);
    if (b) { bytes += b; n++; }
  }
  const pruned = prune(dst, new Set(files));
  console.log(`  bundle: ${files.length} files, ${n} staged (${mb(bytes)})`
    + (pruned ? `, ${pruned} removed` : "") + (a.gzip ? ", gzipped" : ""));
}

/** The page's icons, made from the install's exe, or a reticle without one. */
function stageIcons(a: Args, m: Manifest): void {
  const dst = join(a.out, "icons");
  mkdirSync(dst, { recursive: true });
  const gameDir = a.gameDir || m.game_dir || null;
  const from = gameDir && existsSync(join(gameDir, "Hod2.exe"))
    ? `from ${join(gameDir, "Hod2.exe")}` : "a reticle: no Hod2.exe to take them from";
  for (const name of Object.keys(APP_ICONS)) writeFileSync(join(dst, name), appIcon(name, gameDir)!);
  console.log(`  icons: ${Object.keys(APP_ICONS).length}, ${from}`);
}

/** `sound/SE` -> `se`, and the same for every segment below it. */
function stageSounds(a: Args, m: Manifest): void {
  const gameDir = a.gameDir || m.game_dir;
  const root = join(gameDir, "sound");
  if (!existsSync(root)) {
    fail(`no sound/ under ${gameDir}. Pass --game-dir, or --no-sound`);
  }
  for (const kind of ["bgm", "se", "voice"]) {
    const from = readdirSync(root).find((d) => d.toLowerCase() === kind);
    if (!from) fail(`no sound/${kind} under ${gameDir}`);
    const src = join(root, from);
    const dst = join(a.out, kind);
    const files = walk(src);
    const lower = new Map<string, string>();
    for (const rel of files) {
      const low = rel.toLowerCase();
      const clash = lower.get(low);
      if (clash) {
        fail(`${kind}/${rel} and ${kind}/${clash} differ only in case, and a `
          + `lowercased site cannot hold both`);
      }
      lower.set(low, rel);
    }
    let bytes = 0;
    let n = 0;
    for (const [low, rel] of lower) {
      const b = stageFile(join(src, rel), join(dst, low), false);
      if (b) { bytes += b; n++; }
    }
    const pruned = prune(dst, new Set(lower.keys()));
    console.log(`  ${kind}: ${files.length} files, ${n} staged (${mb(bytes)})`
      + (pruned ? `, ${pruned} removed` : ""));
  }
}

function du(dir: string): number {
  if (!existsSync(dir)) return 0;
  return walk(dir).reduce((t, rel) => t + statSync(join(dir, rel)).size, 0);
}

/**
 * The AWS CLI, one `sync` per kind of file, because the kinds want different
 * headers: the hashed assets never change, the bundle and the index must be
 * revalidated whenever they are fetched, and the sounds sit in between. The
 * index goes last, so a new one never names an asset still uploading.
 */
function sync(a: Args, gzip: boolean): void {
  const dst = a.sync.replace(/\/+$/, "");
  const dry = a.dryrun ? ["--dryrun"] : [];
  const runs: string[][] = [
    ["s3", "sync", join(a.out, "bundle"), `${dst}/bundle`, "--delete",
     "--cache-control", "no-cache",
     ...(gzip ? ["--content-encoding", "gzip"] : [])],
    ...["bgm", "se", "voice"].filter((k) => existsSync(join(a.out, k)))
      .map((k) => ["s3", "sync", join(a.out, k), `${dst}/${k}`, "--delete",
                   "--cache-control", "public, max-age=604800",
                   "--content-type", "audio/wav"]),
    ["s3", "sync", join(a.out, "assets"), `${dst}/assets`, "--delete",
     "--cache-control", "public, max-age=31536000, immutable"],
    ["s3", "sync", join(a.out, "icons"), `${dst}/icons`, "--delete",
     "--cache-control", "no-cache", "--content-type", "image/png"],
    ["s3", "cp", join(a.out, "manifest.webmanifest"), `${dst}/manifest.webmanifest`,
     "--cache-control", "no-cache", "--content-type", "application/manifest+json"],
    ["s3", "cp", join(a.out, "index.html"), `${dst}/index.html`,
     "--cache-control", "no-cache", "--content-type", "text/html; charset=utf-8"],
  ];
  for (const args of runs) {
    const full = [...args, ...dry];
    console.log(`  aws ${full.map((x) => (/[\s;,]/.test(x) ? `"${x}"` : x)).join(" ")}`);
    const r = spawnSync("aws", full, { stdio: "inherit" });
    if (r.error) fail(`could not run the AWS CLI: ${r.error.message}`);
    if (r.status !== 0) fail(`aws exited ${r.status}`);
  }
}

// -- main --------------------------------------------------------------------

const a = parseArgs(process.argv.slice(2));
const m = checkBundle(a);
mkdirSync(a.out, { recursive: true });
const before = readRecord(a.out);
const restage = before !== null && before.gzip !== a.gzip;

console.log(`site: staging into ${a.out}`);
buildPage(a.out);
stageIcons(a, m);
stageBundle(a, restage);
if (a.sound) {
  stageSounds(a, m);
} else {
  for (const k of ["bgm", "se", "voice"]) rmSync(join(a.out, k), { recursive: true, force: true });
}
const record: SiteRecord = {
  gzip: a.gzip, sound: a.sound, bundle: a.bundle, staged: new Date().toISOString(),
};
writeFileSync(join(a.out, "site.json"), JSON.stringify(record, null, 1));
console.log(`  total: ${mb(du(a.out))} in ${relative(process.cwd(), a.out) || "."}`);
console.log(`  stages: ${m.stages.map((s) => s.name).join(" ")}`);

if (a.check) {
  const r = spawnSync("node", [join(WEB, "tools", "site_check.mjs"), a.out],
                      { stdio: "inherit" });
  if (r.status !== 0) fail("the check failed; nothing was uploaded");
}
if (a.sync) {
  console.log(`site: uploading to ${a.sync}${a.dryrun ? " (dry run)" : ""}`);
  sync(a, a.gzip);
  const path = a.sync.replace(/\/+$/, "").replace(/^s3:\/\/[^/]+/, "");
  console.log(`site: open https://<your distribution>${path}/index.html`);
}

/**
 * Build the static bundle the browser stage player loads. The TypeScript
 * exporter's command line, ported from the `tools/export_player.py` that
 * used to be the only way to build a bundle.
 *
 *     npm run export -- --game-dir "..." --all       # both modes
 *     npm run export -- --game-dir "..." --stage 2   # both modes
 *     npm run export -- --game-dir "..." --stage 2 --original
 *     npm run export -- --game-dir "..." --stage 2 --arcade
 *
 * **Both game modes unless you ask for one.** Original Mode is half the game,
 * not a variant of the export, and a default that built only Arcade left six
 * of the twelve stage bundles carried forward from whenever they were last
 * built.
 *
 * Output lands in `extract/player/`. This is a thin wrapper: every decision is
 * in `src/hod2lib/`, which the browser runs too, and all this adds is argument
 * parsing, `node:fs` and a place for the warnings to be printed.
 */
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { BUNDLE_FORMAT, buildStage, writeManifest } from "../src/hod2lib/bundle";
import * as degraded from "../src/hod2lib/degraded";
import { Stage } from "../src/hod2lib/stage";
import { NodeAssetSource, NodeBundleSink, absolute,
         nodeDeflate } from "./lib/node_io";

interface Args {
  gameDir: string;
  stages: number[];
  all: boolean;
  arcade: boolean;
  original: boolean;
  out: string;
  gltf: boolean;
  noTextures: boolean;
  lit: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    gameDir: "", stages: [], all: false, arcade: false, original: false,
    out: "", gltf: false, noTextures: false, lit: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    switch (k) {
      case "--game-dir": a.gameDir = argv[++i]; break;
      case "--stage": a.stages.push(Number(argv[++i])); break;
      case "--out": a.out = argv[++i]; break;
      case "--all": a.all = true; break;
      case "--arcade": a.arcade = true; break;
      case "--original": a.original = true; break;
      case "--gltf": a.gltf = true; break;
      case "--no-textures": a.noTextures = true; break;
      case "--lit": a.lit = true; break;
      case "-h": case "--help":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`unrecognised argument: ${k}`);
    }
  }
  return a;
}

const USAGE = `usage: npm run export -- --game-dir DIR (--all | --stage N ...)

  --game-dir DIR   the HOTD2 install, the directory holding Hod2.exe
  --stage N        stage number, repeatable
  --all            every stage, 1-6
  --arcade         Arcade Mode only; the default is both modes
  --original       Original Mode only; the default is both modes
  --out DIR        where the bundle goes (default: extract/player)
  --gltf           write .gltf + .bin + loose PNGs instead of one .glb
  --no-textures    skip the PNGs (only meaningful with --gltf)
  --lit            do not mark materials KHR_materials_unlit`;

/**
 * What this export could not read, printed at the end where it is read.
 *
 * The decoders' warnings already travelled -- `evt`'s in the stage JSON, and
 * `cam`'s since format 4 -- and the player surfaces both. But the person who
 * runs the export is the person who can act on them, and they were only
 * visible by opening the JSON afterwards.
 *
 * So: one block at the end, after the size line, always printed -- including
 * the "nothing" case, because "no warnings" and "I forgot to look" are the two
 * readings of an absent summary and only one of them is good news.
 */
async function report(out: string,
                      entries: Record<string, unknown>[]): Promise<void> {
  const rows: [string, string, string[]][] = [];
  for (const e of entries) {
    for (const [kind, fname] of [["script", e.script], ["cam", e.cam]] as
         [string, string | undefined][]) {
      if (!fname) continue;
      const f = join(out, e.name as string, fname);
      try {
        const w = (JSON.parse(await readFile(f, "utf8")).warnings ?? []) as string[];
        if (w.length) rows.push([e.name as string, kind, w]);
      } catch {
        // not-a-loss: the file was just written and indexed; a read failure
        // here is about this summary, not about the bundle, and the export
        // itself has already reported its own errors.
      }
    }
  }

  if (!rows.length) {
    console.log("\ndecoder warnings: none -- every cam/ and evt/ block in "
                + "every stage parsed whole");
    return;
  }
  // One stream, because two of them interleave: the header went to stdout and
  // the detail to stderr, and a terminal showed the warnings above the line
  // introducing them. All of it is a warning, so all of it is stderr.
  const n = rows.reduce((k, [, , w]) => k + w.length, 0);
  console.error(`\ndecoder warnings: ${n} across ${rows.length} block(s). `
                + "The player shows these in the feed too.");
  for (const [name, kind, w] of rows) {
    console.error(`  ${name} (${kind}): ${w.length}`);
    for (const line of w.slice(0, 8)) console.error(`      ${line}`);
    if (w.length > 8) console.error(`      ... and ${w.length - 8} more`);
  }
}

/** Total bytes under *dir*, for the size line. */
async function treeBytes(dir: string): Promise<number> {
  let total = 0;
  const walk = async (d: string): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(d);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(d, n);
      const st = await stat(p);
      if (st.isDirectory()) await walk(p);
      else total += st.size;
    }
  };
  await walk(dir);
  return total;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.gameDir) {
    console.error(USAGE);
    return 2;
  }

  const game = absolute(args.gameDir);
  const source = new NodeAssetSource(game);
  if (!await source.exists("Hod2.exe")) {
    console.error(`no Hod2.exe under ${game}`);
    return 1;
  }

  const wanted = args.stages.length
    ? [...new Set(args.stages)].sort((a, b) => a - b)
    : (args.all ? [1, 2, 3, 4, 5, 6] : []);
  if (!wanted.length) {
    console.error("give --stage N (repeatable) or --all");
    return 1;
  }

  // Default: the repository's own `extract/player`, found by walking up from
  // this file the way `tools/lib/bundle_root.ts` does, so a checkout at any
  // path exports to its own tree.
  const out = args.out
    ? absolute(args.out)
    : resolve(dirname(new URL(import.meta.url).pathname), "..", "..",
              "extract", "player");
  await mkdir(out, { recursive: true });
  const sink = new NodeBundleSink(out);

  degraded.setWarningSink((line) => console.error(line));

  // **Both modes by default.** `--original` used to *add* Original Mode to a
  // run that was otherwise Arcade-only, so the plain `--all` everyone runs
  // built six of the twelve stage bundles and left the other six carried
  // forward from whenever they were last built.
  let modes = [false, true];
  if (args.arcade && !args.original) modes = [false];
  else if (args.original && !args.arcade) modes = [true];

  const entries: Record<string, unknown>[] = [];
  for (const n of wanted) {
    for (const original of modes) {
      let st: Stage;
      try {
        st = await Stage.create(source, { stage: n, original });
      } catch (exc) {
        console.error(`stage ${n}: ${(exc as Error).message}`);
        continue;
      }
      console.log(`stage ${n}${original ? " (Original Mode)" : ""}`);
      const entry = await buildStage(st, sink, nodeDeflate, {
        glb: !args.gltf,
        writeTextures: !args.noTextures,
        unlit: !args.lit,
        progress: (line) => console.log(line),
      });
      entries.push(entry);
      const c = entry.counts as Record<string, number>;
      console.log(`  -> ${c.models} models, ${c.triangles.toLocaleString("en-US")} tris, `
        + `${c.textures} textures, ${c.regions} regions, ${c.blocks} blocks `
        + `(${c.branch_points} branch points), ${c.cam_paths} cam paths, `
        + `${c.spawns} spawns`);
      if (c.degraded) {
        console.error(`  -> ${c.degraded} DEGRADED: this bundle is missing `
          + "parts of the game (see the warnings above, and `degraded` in the "
          + "manifest entry)");
      }
    }
  }

  if (!entries.length) {
    console.error("nothing was built");
    return 1;
  }

  // **The manifest is the whole bundle's index, and a partial export used to
  // replace it.** `--stage 2` after an `--all` left a manifest naming stage 2
  // alone, and the player simply had no other stages -- silently, because
  // every other stage's files were still sitting on disk beside it. So carry
  // forward any entry this run did not rebuild whose files are still there,
  // and say which, rather than dropping it.
  const built = new Set(entries.map((e) => e.name as string));
  const kept: string[] = [];
  const previous = await sink.readJson<{ stages?: Record<string, unknown>[] }>(
    "manifest.json");
  for (const e of previous?.stages ?? []) {
    if (built.has(e.name as string)) continue;
    const files = ["geometry", "cam", "script"].map((k) => e[k] as string | undefined);
    let ok = true;
    for (const f of files) {
      if (!f || !await sink.exists(`${e.name}/${f}`)) { ok = false; break; }
    }
    if (!ok) continue;
    entries.push(e);
    kept.push(e.name as string);
  }
  if (kept.length) {
    console.log(`carried forward from the previous manifest: ${kept.join(", ")}`);
  }
  // A carried entry was written by whatever tool built it, which is not
  // necessarily this one. Its files are on disk and index fine; the client
  // refuses that stage on its own `format` and says so. Say it here too.
  const stale = entries.filter((e) => e.format !== BUNDLE_FORMAT)
    .map((e) => e.name as string).sort();
  if (stale.length) {
    console.error(`stale stage format, the client will refuse these: `
      + `${stale.join(", ")} -- rebuild them (--all)`);
  }
  entries.sort((a, b) => ((a.stage as number) ?? 0) - ((b.stage as number) ?? 0)
    || String(a.name).localeCompare(String(b.name)));

  const built_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const path = await writeManifest(sink, entries, game, built_at, {
    unlit: !args.lit,
    geometry: args.gltf ? "gltf" : "glb",
    cameras: "raw Hermite curves in <stage>.cam.json; the client evaluates "
      + "and draws the rails itself",
  });
  const total = await treeBytes(out);
  console.log(`\n${entries.length} stage bundles, `
    + `${(total / 1e6).toFixed(1)} MB -> ${join(out, path)}`);
  await report(out, entries);

  // **A degraded export fails. There is no flag for this.**
  //
  // A `--strict` nobody passes is a check that never fires. If anything under
  // `hod2lib` answered a failure with an empty result then this bundle is
  // missing part of the game, and a tool that prints a warning and exits 0 is
  // telling the next person it went fine. The files are still written -- an
  // incomplete bundle is often exactly what you want to *look at* while
  // finding out why -- but the exit code says what it is.
  const short = entries
    .filter((e) => (e.counts as Record<string, number> | undefined)?.degraded)
    .map((e) => [e.name as string,
                 (e.counts as Record<string, number>).degraded] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (short.length) {
    console.error(`degraded: ${short.map(([n, k]) => `${n} (${k})`).join(", ")}`);
    console.error("the bundle is written but incomplete; this is a failure");
    return 1;
  }
  return 0;
}

process.exitCode = await main();

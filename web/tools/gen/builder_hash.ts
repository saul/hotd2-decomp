/**
 * Generate `web/src/bundle/builder_hash.ts` from the exporter that writes bundles.
 *
 *     cd web && node tools/run_ts.mjs tools/gen/builder_hash.ts            # write, if it changed
 *     cd web && node tools/run_ts.mjs tools/gen/builder_hash.ts --check    # exit 1 if stale
 *
 * **The digest that says a bundle is out of date.**
 *
 * `tools/gen/schema_hash.ts` ties a bundle to the declarations that *read* it,
 * and refuses one that does not match. This is the other half: what wrote it.
 * A bundle can agree with every declaration in `web/src/bundle/` and still be
 * wrong, because `web/src/hod2lib/` decides its contents. An exporter change
 * that moves no declaration and no `BUNDLE_FORMAT` -- dropping the triangles
 * whose UVs collapse, say -- leaves a stage already built into the browser's
 * OPFS cache winning over the freshly exported one, with holes in it, however
 * many times the tree is exported.
 *
 * **This warns; it does not refuse.** A schema mismatch means the bundle
 * cannot be read correctly and must be rebuilt before it is used. An exporter
 * change usually means it *can* be read and may be a little out of date, which
 * is a thing to tell someone about, not a thing to stop them playing over. The
 * client marks the stage stale, the Bundle button says so, and rebuilding is
 * one click.
 *
 * **What is hashed is the code, not the file.** Comments and whitespace are
 * stripped, so a doc comment costs nothing -- but unlike the schema digest,
 * the bodies are hashed, because a body is exactly what decides a byte of
 * output. `tools/repo/exporters.ts` fails when the committed copy is stale.
 */
import { realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { repoRoot } from "../lib/bundle_root";
import {
  SPACE_CLASS, byCodePoint, committed, declarations, digestOfDigests, readText, sha256Hex, tsFiles,
} from "./schema_hash";

/** Everything that decides what goes in a bundle, relative to the repo root. */
export const BUILDER_DIR = "web/src/hod2lib";
/**
 * Where the generated file lives: with the declarations that read a bundle,
 * because both halves of the contract are imported from there.
 */
export const OUT_DIR = "web/src/bundle";
export const GENERATED = "builder_hash.ts";

/**
 * Every `.ts` directly under `hod2lib/`, globbed rather than named.
 *
 * The opposite decision from the schema digest's `SOURCES`, and for the
 * opposite reason. There the list keeps the loader's *text* out of a digest a
 * bundle is compared against. Here every file is implementation and every one
 * of them can change a byte of output, so a file this missed would be a stale
 * bundle nobody is warned about -- and a new module is exactly when that
 * would happen.
 */
export function sources(root: string = repoRoot()): string[] {
  const d = join(root, BUILDER_DIR);
  return tsFiles(d).map((n) => join(d, n));
}

const S = SPACE_CLASS;

/**
 * One import or re-export statement's specifier, and whether it is type-only.
 * `import type` / `export type` are erased and decide no byte; everything else
 * -- a named, default, namespace, side-effect or re-export -- runs, so it can.
 * Statements may span lines, hence the lazy `[^;]*?`. A statement starts at
 * the start of a line.
 */
const IMPORT = new RegExp(
  `(?:^|(?<=\\n))${S}*(?:import|export)${S}+(type${S}+)?`
  + `(?:[^;"']*?${S}+from${S}+)?["']([^"']+)["']`, "g");

/**
 * Modules an exporter import may reach that are **not** exporter input: the
 * two generated digests. `builder_hash.ts` is this file's own output, and
 * hashing it would make the digest depend on itself; `schema_hash.ts` is the
 * other half of the contract and has its own generator and check.
 */
const NOT_INPUT = new Set(["bundle/builder_hash.ts", "bundle/schema_hash.ts"]);

/** `path` with every symlink in the part of it that exists resolved. */
function realPath(path: string): string {
  const abs = resolve(path);
  try {
    return realpathSync(abs);
  } catch {
    // not-a-loss: the path does not exist yet, so its parent is resolved and
    // the missing name kept.
    const up = dirname(abs);
    return up === abs ? abs : join(realPath(up), basename(abs));
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;       // not-a-loss: a candidate that is not there is not a file
  }
}

/** A relative specifier as the bundler resolves it, or `null` (a package). */
function resolveSpec(spec: string, importer: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = realPath(join(dirname(importer), spec));
  for (const cand of [`${base}.ts`, join(base, "index.ts"), base]) {
    if (isFile(cand) && cand.endsWith(".ts") && basename(cand) !== ".ts") return cand;
  }
  return null;
}

/** Path order, one component at a time, so `a/b.ts` sorts before `a-b.ts`. */
function byComponents(a: string, b: string): number {
  const x = a.split(sep);
  const y = b.split(sep);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = byCodePoint(x[i]!, y[i]!);
    if (d) return d;
  }
  return x.length - y.length;
}

/** `path` under `dir`, spelled with `/`, or `null` when it is not under it. */
function under(dir: string, path: string): string | null {
  const rel = relative(dir, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/**
 * Every module outside `hod2lib/` the exporter runs, followed transitively.
 *
 * `hod2lib/bundle.ts` reads `CARRIER_SELECTORS_PORTED` out of
 * `game/class13/state.ts` and the HUD's sprite ids out of
 * `game/hud_sprites.ts`, so porting a routine changes a bundle without
 * touching `hod2lib/` -- a stale bundle nobody is warned about (`L24`).
 *
 * **Derived from the import statements, never named**, and followed to the
 * bottom, so a data module that imports a value from a second module, or an
 * exporter import from `core/` rather than `game/`, is covered. Type-only
 * imports are skipped because they are erased; the two generated digests are
 * skipped (see {@link NOT_INPUT}).
 */
export function gameSources(root: string = repoRoot()): string[] {
  const src = realPath(join(root, BUILDER_DIR, ".."));
  const hod2lib = realPath(join(root, BUILDER_DIR));
  const seen = new Set<string>();
  const todo = sources(root).map(realPath);
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of readText(f).matchAll(IMPORT)) {
      if (m[1]) continue;
      const dep = resolveSpec(m[2]!, f);
      if (dep === null || seen.has(dep)) continue;
      const rel = under(src, dep);
      if (rel === null || NOT_INPUT.has(rel)) continue;
      todo.push(dep);
    }
  }
  return [...seen].filter((p) => dirname(p) !== hod2lib).sort(byComponents);
}

/**
 * `{filename: sha256 of its code}`, sorted by filename.
 *
 * `hod2lib/` files are keyed by their bare name; the modules outside it they
 * import by their path under `web/src/`, so two `state.ts` files cannot
 * collide.
 */
export function fileDigests(root: string = repoRoot()): Record<string, string> {
  const src = realPath(join(root, BUILDER_DIR, ".."));
  const keyed: [string, string][] = [
    ...sources(root).map((p): [string, string] => [basename(p), p]),
    ...gameSources(root).map((p): [string, string] => [under(src, p)!, p]),
  ];
  keyed.sort(([ka, pa], [kb, pb]) => byCodePoint(ka, kb) || byComponents(pa, pb));
  const out: Record<string, string> = {};
  for (const [k, p] of keyed) out[k] = sha256Hex(declarations(readText(p)));
  return out;
}

/** One digest over the per-file digests, in filename order. */
export function builderHash(root: string = repoRoot()): string {
  return digestOfDigests(fileDigests(root));
}

/** The exact text {@link GENERATED} must hold for this checkout. */
export function clientSource(root: string = repoRoot()): string {
  const rows = Object.entries(fileDigests(root))
    .map(([name, digest]) => `  "${name}": "${digest}",\n`).join("");
  return [
    "/**",
    " * The digest of the exporter that wrote a bundle. **Generated file.**",
    " *",
    " * Written by `web/tools/gen/builder_hash.ts` (`npm run gen:hashes`) and",
    " * committed; it covers the code in",
    " * `web/src/hod2lib/`, which is the only thing that decides what a bundle",
    " * contains, and every module it imports a value from, followed transitively.",
    " * `web/tools/repo/exporters.ts` fails when this file is stale.",
    " *",
    " * The exporter stamps it into `manifest.json` and onto every stage entry, and",
    " * `bundle/load.ts` compares -- but **warns rather than refuses**. A schema",
    " * mismatch means a bundle cannot be read; an exporter change usually means it",
    " * can be read and is merely out of date. See {@link stageBuilderStale}.",
    " *",
    " * The gap this closes: an exporter fix that changes what a stage holds --",
    " * keeping the 3-5% of triangles a UV-area filter drops, say -- moves no",
    " * declaration and no `BUNDLE_FORMAT`, so without this a stage already built",
    " * into the browser's OPFS cache goes on winning over the rebuilt one, holes",
    " * and all, however many times the tree is exported.",
    " */",
    "",
    "/** The per-file digests, so a stale bundle can name what moved. */",
    "export const BUILDER_FILES: Readonly<Record<string, string>> = {",
    `${rows}};`,
    "",
    "/** One digest over {@link BUILDER_FILES}, in filename order. */",
    `export const BUILDER_HASH = "${builderHash(root)}";`,
    "",
  ].join("\n");
}

function main(argv: readonly string[]): number {
  const check = argv.includes("--check");
  const unknown = argv.filter((a) => a !== "--check");
  if (unknown.length) {
    console.error(`usage: builder_hash.ts [--check]\nunrecognized arguments: ${unknown.join(" ")}`);
    return 2;
  }
  const root = repoRoot();
  const path = join(root, OUT_DIR, GENERATED);
  const rel = `${OUT_DIR}/${GENERATED}`;
  const want = clientSource(root);
  const have = committed(path);
  const short = `${builderHash(root).slice(0, 16)}...`;
  if (check) {
    if (have === want) {
      console.log(`${rel} is current (${short})`);
      return 0;
    }
    console.error(`${rel} is stale -- run \`npm run gen:hashes\` in web/ and commit it `
                  + "with the exporter change that moved it");
    return 1;
  }
  if (have === want) {
    console.log(`${rel} already current (${short})`);
    return 0;
  }
  writeFileSync(path, want, "utf8");
  console.log(`wrote ${rel} (${short})`);
  console.log("commit it in the same commit as the exporter change.");
  return 0;
}

if (/(?:^|[\\/])gen[\\/]builder_hash\.ts$/.test(process.argv[1] ?? "")) {
  process.exitCode = main(process.argv.slice(2));
}

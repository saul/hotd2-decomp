/**
 * Generate `web/src/bundle/schema_hash.ts` from the declarations beside it.
 *
 *     cd web && node tools/run_ts.mjs tools/gen/schema_hash.ts            # write, if it changed
 *     cd web && node tools/run_ts.mjs tools/gen/schema_hash.ts --check    # exit 1 if stale
 *
 * **The digest that ties a bundle to the TypeScript that reads it.**
 *
 * `web/src/bundle/*.ts` holds the interfaces that mirror what the exporter
 * emits, and `getJson<T>` is a bare cast: a field renamed on one side and not
 * the other produces `undefined` at the read site and a stage that renders
 * *almost* right. So the digest is generated into {@link GENERATED} and
 * committed; the exporter imports it and stamps it into `manifest.json`, and
 * the client compares the two and refuses a bundle that does not match. Nobody
 * has to remember to bump anything. `tools/repo/exporters.ts` fails when the
 * committed copy is stale.
 *
 * **What is hashed is the declarations, not the file.** Comments and
 * whitespace are stripped first ({@link declarations}). A digest that moved
 * when someone fixed a typo in a doc comment would demand a full re-export for
 * a change that cannot affect a single byte of a bundle, and a check that
 * expensive to satisfy is a check that gets deleted.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "../lib/bundle_root";

/** The interfaces the bundle is mirrored by, relative to the repository root. */
export const SCHEMA_DIR = "web/src/bundle";
/** The generated file, which is excluded from its own digest. */
export const GENERATED = "schema_hash.ts";

/**
 * **The declaration files, named rather than globbed.**
 *
 * A bundle can disagree with a declaration. It cannot disagree with a
 * function. So the loader lives in `load.ts` and this list names what is
 * hashed: a glob would put `getJson`, the format checks and every refusal
 * string in the digest, and rewording "rebuild the bundle" would invalidate
 * every bundle on disk for an edit that cannot change one byte of one.
 * {@link checkSources} fails if a file on the list grows runtime code, or if a
 * declaration file appears in the directory and is not on it -- a list that
 * could silently omit a file would be worse than the glob.
 */
export const SOURCES: readonly string[] = [
  "cameras.ts", "characters.ts", "manifest.ts", "scene.ts",
  "script.ts", "sound.ts", "stage.ts",
];

/**
 * The characters the digests treat as whitespace, as a regular-expression
 * class: every Unicode space and separator, and the ASCII controls 0x09-0x0D
 * and 0x1C-0x1F. The digests are defined over this set; changing it moves
 * every one of them.
 */
export const SPACE_CLASS =
  "[\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const SPACE_RUN = new RegExp(`${SPACE_CLASS}+`, "g");

/**
 * A text file as the digests read it: UTF-8, with `\r\n` and a lone `\r` read
 * as `\n`, so a checkout with Windows line endings hashes like any other.
 */
export function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
}

/**
 * `text` with comments and runs of whitespace removed.
 *
 * A hand-rolled scanner rather than a regex because a regex for "`//` that is
 * not inside a string" is either wrong or unreadable, and getting it wrong
 * here means a digest that is stable when it should move. The state machine
 * is four states and fits on a screen; TypeScript's template literals nest
 * `${...}` but no declaration in `web/src/bundle/` uses one, and a nested
 * brace would only ever end the literal early -- it cannot make a comment
 * look like code or the reverse.
 */
export function declarations(text: string): string {
  const out: string[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {       // a string: copy it whole
      const quote = c;
      out.push(c);
      i++;
      while (i < n) {
        out.push(text[i]!);
        if (text[i] === "\\") {
          if (i + 1 < n) out.push(text[i + 1]!);
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && i + 1 < n && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && i + 1 < n && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("").split(SPACE_RUN).filter((w) => w !== "").join(" ");
}

/** The sha-256 of `text`'s UTF-8 bytes, as lowercase hex. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** One digest over `{name: digest}`, in the object's (sorted) key order. */
export function digestOfDigests(files: Readonly<Record<string, string>>): string {
  const h = createHash("sha256");
  for (const [name, digest] of Object.entries(files)) {
    h.update(name, "utf8");
    h.update("\0");
    h.update(digest, "utf8");
    h.update("\0");
  }
  return h.digest("hex");
}

/** Code-point order. */
export function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}

/** The files in `dir` whose names end in `.ts`, in name order. */
export function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".ts") && statSync(join(dir, n)).isFile())
    .sort(byCodePoint);
}

/**
 * `{filename: sha256 of its declarations}`, sorted by filename.
 *
 * Per file rather than one number for the lot, so the client can name *which*
 * block drifted. "the bundle does not match this client" is true and useless;
 * "`scene.ts` and `script.ts` changed" is where to look.
 */
export function fileDigests(root: string = repoRoot()): Record<string, string> {
  const d = join(root, SCHEMA_DIR);
  const out: Record<string, string> = {};
  for (const name of [...SOURCES].sort(byCodePoint)) {
    out[name] = sha256Hex(declarations(readText(join(d, name))));
  }
  return out;
}

/** One digest over the per-file digests, in filename order. */
export function schemaHash(root: string = repoRoot()): string {
  return digestOfDigests(fileDigests(root));
}

/** The exact text {@link GENERATED} must hold for this checkout. */
export function clientSource(root: string = repoRoot()): string {
  const rows = Object.entries(fileDigests(root))
    .map(([name, digest]) => `  "${name}": "${digest}",\n`).join("");
  return [
    "/**",
    " * The schema digest this client was compiled against. **Generated file.**",
    " *",
    " * Written by `web/tools/gen/schema_hash.ts` (`npm run gen:hashes`) and",
    " * committed; re-run it after changing any declaration in this directory.",
    " * `web/tools/repo/exporters.ts` fails when this file is stale, so it cannot",
    " * quietly drift from its sources.",
    " *",
    " * The exporter imports {@link SCHEMA_HASH} and stamps it into",
    " * `manifest.json`, and `bundle/load.ts` refuses a bundle whose digest is not",
    " * this one -- so the exporter and the client agree by construction rather than",
    " * by anyone remembering.",
    " *",
    " * The digest covers the *declarations* in `web/src/bundle/*.ts` -- comments",
    " * and whitespace are stripped before hashing -- so editing a doc comment costs",
    " * nothing and changing a field invalidates every bundle built before it. See",
    " * `docs/formats/bundle.md`.",
    " */",
    "",
    "/** The per-file digests, so a mismatch can name the block that moved. */",
    "export const SCHEMA_FILES: Readonly<Record<string, string>> = {",
    `${rows}};`,
    "",
    "/** One digest over {@link SCHEMA_FILES}, in filename order. */",
    `export const SCHEMA_HASH = "${schemaHash(root)}";`,
    "",
  ].join("\n");
}

/**
 * {@link SOURCES} against the directory, in both directions.
 *
 * A declaration file that is not on the list is not hashed, so a bundle can
 * disagree with it and nothing will say so; a file on the list that has grown
 * runtime code makes the digest move for a reason a bundle cannot be wrong
 * about.
 */
export function checkSources(root: string = repoRoot()): string[] {
  const d = join(root, SCHEMA_DIR);
  const out: string[] = [];
  for (const name of tsFiles(d)) {
    // The two generated digests and the loader. `builder_hash.ts` is
    // `tools/gen/builder_hash.ts`'s, and it is a constant rather than a
    // declaration a bundle can disagree with.
    if ([GENERATED, "builder_hash.ts", "index.ts", "load.ts"].includes(name)) continue;
    if (!SOURCES.includes(name)) {
      out.push(`${name} is a declaration file and is not on SOURCES in `
               + "web/tools/gen/schema_hash.ts, so nothing hashes it");
    }
  }
  for (const name of SOURCES) {
    const p = join(d, name);
    if (!existsSync(p) || !statSync(p).isFile()) {
      out.push(`SOURCES names ${name}, which does not exist`);
      continue;
    }
    const body = declarations(readText(p));
    // A declaration file declares. `function`, `=>` and `return` are the three
    // shapes runtime code takes, and none of them belongs in a file a bundle
    // is compared against.
    for (const token of ["function ", "=>", "return "]) {
      if (body.includes(token)) {
        out.push(`${name} contains \`${token.trim()}\` -- it is on SOURCES, so it `
                 + "must hold declarations only; code that runs goes in "
                 + "web/src/bundle/load.ts");
        break;
      }
    }
  }
  return out;
}

/** The committed file's text, or `null` when there is none. */
export function committed(path: string): string | null {
  return existsSync(path) ? readText(path) : null;
}

function main(argv: readonly string[]): number {
  const check = argv.includes("--check");
  const unknown = argv.filter((a) => a !== "--check");
  if (unknown.length) {
    console.error(`usage: schema_hash.ts [--check]\nunrecognized arguments: ${unknown.join(" ")}`);
    return 2;
  }
  const root = repoRoot();
  const bad = checkSources(root);
  if (bad.length) {
    for (const m of bad) console.error(`FAIL ${m}`);
    return 1;
  }
  const path = join(root, SCHEMA_DIR, GENERATED);
  const rel = `${SCHEMA_DIR}/${GENERATED}`;
  const want = clientSource(root);
  const have = committed(path);
  const short = `${schemaHash(root).slice(0, 16)}...`;
  if (check) {
    if (have === want) {
      console.log(`${rel} is current (${short})`);
      return 0;
    }
    console.error(`${rel} is stale -- run \`npm run gen:hashes\` in web/ and commit it `
                  + "with the declaration change that moved it");
    return 1;
  }
  if (have === want) {
    console.log(`${rel} already current (${short})`);
    return 0;
  }
  writeFileSync(path, want, "utf8");
  console.log(`wrote ${rel} (${short})`);
  console.log("commit it in the same commit as the declaration change.");
  return 0;
}

if (/(?:^|[\\/])gen[\\/]schema_hash\.ts$/.test(process.argv[1] ?? "")) {
  process.exitCode = main(process.argv.slice(2));
}

/**
 * The exporter never swallows a failure, its two digests are current, and
 * `GameMode` is the exe's numbering.
 *
 *     cd web && node tools/run_ts.mjs tools/repo/exporters.ts
 *
 * Four checks over `web/src/hod2lib/` and `web/tools/export.ts`, the only code
 * that writes a bundle.
 *
 * **A handler that gives something up says so.** A `catch` in the exporter
 * that answers a failure with an empty result is often right -- an install
 * missing one `pol/` file should still export, and refusing a stage because
 * one prop model will not parse would be worse than exporting without it. What
 * is never right is doing it silently: a parser regression then produces a
 * valid bundle with zero characters and exit code 0, and the player draws an
 * empty stage, which looks exactly like a gameplay bug. So every `catch` must,
 * within its first few lines of code and inside its own braces, record the
 * loss through `degraded.note` (whose count reaches `manifest.json` and the
 * exporter's exit code), rethrow, push a warning the stage JSON carries, print
 * to stderr -- or declare with a reason that nothing is lost, as
 * `// not-a-loss: <reason>` on or just inside the handler.
 *
 * **The digests are current.** `manifest.json` carries a hash of the
 * declarations in `web/src/bundle/*.ts`, which the client compares against the
 * committed `web/src/bundle/schema_hash.ts` and refuses a bundle on; and a hash
 * of the exporter's own code, which the client compares against
 * `builder_hash.ts` and marks a stage stale on. Both files are generated
 * (`tools/gen/schema_hash.ts`, `tools/gen/builder_hash.ts`). This re-derives
 * them and fails when a committed copy is stale, which is what makes the
 * digests impossible to forget.
 *
 * **`GameMode` is the exe's numbering in both places it is declared.** Its
 * values go into every bundle as `game_mode` and cross from the exporter to
 * the player untranslated, and a renumbering moves no declaration and so no
 * digest.
 *
 * Exit 0 when all four hold, 1 when any does not.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { repoRoot } from "../lib/bundle_root";
import * as builder from "../gen/builder_hash";
import * as schema from "../gen/schema_hash";
import { SPACE_CLASS as S, byCodePoint, committed, readText } from "../gen/schema_hash";

const ROOT = repoRoot();
const TS_LIB = join(ROOT, "web", "src", "hod2lib");
const EXPORT_CLI = join(ROOT, "web", "tools", "export.ts");

/** A word character: a Unicode letter or digit, or `_`. */
const W = "[\\p{L}\\p{N}_]";

/**
 * Every `catch`, with or without a binding. The narrowness of what it catches
 * is not the question; whether the handler *says* something is, and that is
 * the same question for every handler.
 */
const ANY_CATCH = new RegExp(`(?<!${W})catch(?!${W})${S}*(\\([^)]*\\))?${S}*\\{`, "u");

/**
 * A handler carrying this, on the `catch` line or inside it, declares that
 * nothing was lost -- the failure *is* the answer. The reason is required.
 */
const NOT_A_LOSS = /\/\/\s*not-a-loss:\s*\S/;

/** What counts as saying something. */
const SAYS = new RegExp(
  `degraded\\.note\\(|(?<!${W})note\\(|(?<!${W})throw(?!${W})|warnings\\.push\\(`
  + "|console\\.(error|warn)\\(", "u");

/**
 * How many lines of code past the `catch` to look in. A handler that needs
 * more than this before it says anything is doing too much.
 */
const WINDOW = 6;

/** The exporter's sources: `hod2lib/*.ts` but the degradation log, and the CLI. */
function sources(): string[] {
  const lib = existsSync(TS_LIB)
    ? readdirSync(TS_LIB).filter((n) => n.endsWith(".ts")).sort(byCodePoint)
      .map((n) => join(TS_LIB, n))
    : [];
  return [...lib, EXPORT_CLI].filter(
    (p) => existsSync(p) && statSync(p).isFile() && basename(p) !== "degraded.ts");
}

/** A line boundary: every one Unicode names. */
const LINE_BREAK = new RegExp("\\r\\n|[\\n\\r\\v\\f\\x1c-\\x1e\\x85\\u2028\\u2029]");

/** `text` split into lines, with no empty last line for a final line break. */
function splitLines(text: string): string[] {
  const out = text.split(LINE_BREAK);
  if (out[out.length - 1] === "") out.pop();
  return out;
}

function isComment(line: string): boolean {
  const s = line.trimStart();
  return s.startsWith("//") || s.startsWith("*") || s.startsWith("/*");
}

/**
 * The `catch` block opening on line `i`, braces balanced: its lines whole,
 * and its code -- the text between its braces, line by line.
 *
 * Braces inside strings and `//` comments are skipped; a handler body is
 * simple enough that this is exact for every handler the exporter has.
 */
function handler(lines: readonly string[], i: number): { lines: string[]; code: string[] } {
  const m = ANY_CATCH.exec(lines[i]!)!;
  const open = m.index + m[0].length - 1;                // the opening `{`
  const whole: string[] = [];
  const code: string[] = [];
  let depth = 0;
  let started = false;
  for (let j = i; j < lines.length; j++) {
    const from = j === i ? open : 0;
    const text = lines[j]!.slice(from);
    whole.push(lines[j]!);
    let quote: string | null = null;
    let k = 0;
    let closed = -1;
    for (; k < text.length; k++) {
      const c = text[k]!;
      if (quote) {
        if (c === "\\") k++;
        else if (c === quote) quote = null;
      } else if (c === "'" || c === '"' || c === "`") {
        quote = c;
      } else if (text.startsWith("//", k)) {
        break;
      } else if (c === "{") {
        depth++;
        started = true;
      } else if (c === "}") {
        depth--;
        if (started && depth === 0) {
          closed = k;
          break;
        }
      }
    }
    // The code is what lies inside the braces: past the opening `{` on the
    // first line, and short of the closing `}` on the last.
    code.push(text.slice(j === i ? 1 : 0, closed < 0 ? text.length : closed));
    if (closed >= 0) break;
  }
  return { lines: whole, code };
}

/** Every `catch` in the exporter, and the ones that say nothing. */
export function checkHandlers(): { total: number; bad: string[] } {
  const bad: string[] = [];
  let total = 0;
  for (const path of sources()) {
    const lines = splitLines(readText(path));
    const rel = path.slice(ROOT.length + 1);
    lines.forEach((line, i) => {
      if (isComment(line) || !ANY_CATCH.test(line)) return;
      total++;
      const h = handler(lines, i);
      if (h.lines.some((ln) => NOT_A_LOSS.test(ln))) return;
      // The window counts *code*, not prose: a handler whose reason takes
      // eight lines of comment is the handler you want explained.
      const code = h.code.filter((ln) => ln.trim() && !isComment(ln));
      if (SAYS.test(code.slice(0, WINDOW).join("\n"))) return;
      bad.push(`${rel}:${i + 1}: ${line.trim()} -- says nothing`);
    });
  }
  return { total, bad };
}

/** The committed generated file at `dir/name` against the text it must hold. */
function stale(dir: string, name: string, want: string): string[] {
  return committed(join(ROOT, dir, name)) === want ? [] : [`${dir}/${name} is stale`];
}

/**
 * `g_GameMode` (0x009CA08C), from the title menu's own row order -- see
 * `TitleMenuRegisterSprites` (FUN_004962C0) and the note on either enum.
 */
const GAME_MODE: ReadonlyArray<readonly [string, number]> = [
  ["ARCADE", 0], ["ORIGINAL", 1], ["TRAINING", 2], ["BOSS", 3],
];

function enumMembers(path: string): Map<string, number> | null {
  const body = /export enum GameMode \{([\s\S]*?)\n\}/.exec(readText(path));
  if (!body) return null;
  const out = new Map<string, number>();
  const member = new RegExp(`(?:^|(?<=\\n))${S}*([A-Za-z_]+)${S}*=${S}*(\\d+)${S}*,`, "g");
  for (const m of body[1]!.matchAll(member)) {
    out.set(m[1]!, Number(m[2]));
  }
  return out;
}

/** `ARCADE` as `Arcade`: each run of letters capitalised, the rest lowered. */
function title(s: string): string {
  return s.replace(/[A-Za-z]+/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Both `GameMode` enums against the exe's numbering: the exporter's
 * (`ARCADE`) and the player's (`Arcade`), which `game_mode` crosses between
 * untranslated.
 */
export function checkGameMode(): string[] {
  const out: string[] = [];
  const places: [string, (s: string) => string][] = [
    ["web/src/hod2lib/stage.ts", (s) => s.toUpperCase()],
    ["web/src/game/game_mode.ts", title],
  ];
  for (const [rel, spell] of places) {
    const path = join(ROOT, rel);
    const found = existsSync(path) ? enumMembers(path) : null;
    if (found === null) {
      out.push(`${rel} declares no GameMode enum`);
      continue;
    }
    const want = new Map(GAME_MODE.map(([k, v]) => [spell(k), v]));
    for (const [name, v] of want) {
      if (!found.has(name)) out.push(`${rel} GameMode has no ${name}`);
      else if (found.get(name) !== v) {
        out.push(`${rel} GameMode.${name} is ${found.get(name)}, and g_GameMode's is ${v}`);
      }
    }
    for (const name of [...found.keys()].filter((n) => !want.has(n)).sort(byCodePoint)) {
      out.push(`${rel} GameMode has member ${name}, which g_GameMode does not`);
    }
  }
  return out;
}

function report(heading: string, problems: readonly string[], fix: string, ok: string): boolean {
  console.log(`\n${heading}\n`);
  if (problems.length) {
    for (const m of problems) console.log(`FAIL ${m}`);
    console.log(`\n${fix}`);
    return false;
  }
  console.log(`  ${ok}\n\nclean`);
  return true;
}

function main(argv: readonly string[]): number {
  // `--game-dir` is accepted and unused, so a caller may pass it to every
  // check alike.
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--game-dir") i++;
    else if (!a.startsWith("--game-dir=")) {
      console.error(`usage: exporters.ts [--game-dir DIR]\nunrecognized arguments: ${a}`);
      return 2;
    }
  }

  const { total, bad: silent } = checkHandlers();
  let ok = report(
    "the exporter -- what a swallowed failure has to say", silent,
    "Record the loss with `degraded.note(where, what, lost, exc)` -- see "
    + "web/src/hod2lib/degraded.ts -- or, if the failure *is* the answer and "
    + "nothing is lost, say so on the handler with a `// not-a-loss: "
    + "<reason>` comment.",
    `${total} handlers, none of them silent`);

  const schemaProblems = [
    ...stale(schema.SCHEMA_DIR, schema.GENERATED, schema.clientSource(ROOT)),
    ...schema.checkSources(ROOT),
  ];
  ok = report(
    "the schema digest the client compiles against", schemaProblems,
    "Regenerate it and commit it with the declaration change that moved "
    + "it:\n  cd web && npm run gen:hashes\nDeclarations go on `SOURCES` "
    + "in web/tools/gen/schema_hash.ts; code that runs goes in "
    + "web/src/bundle/load.ts.",
    `${Object.keys(schema.fileDigests(ROOT)).length} declaration files, digest `
    + `${schema.schemaHash(ROOT).slice(0, 16)}...`) && ok;

  ok = report(
    "the exporter digest a bundle is stamped with",
    stale(builder.OUT_DIR, builder.GENERATED, builder.clientSource(ROOT)),
    "Regenerate it and commit it with the exporter change that moved it, "
    + "then re-export (L33):\n  cd web && npm run gen:hashes",
    `${Object.keys(builder.fileDigests(ROOT)).length} exporter files, digest `
    + `${builder.builderHash(ROOT).slice(0, 16)}...`) && ok;

  ok = report(
    "GameMode, as g_GameMode numbers it", checkGameMode(),
    "The values travel in every bundle as `game_mode`; fix the enum, not "
    + "this table.",
    `both enums are ${GAME_MODE.map(([k, v]) => `${k}=${v}`).join(", ")}`) && ok;
  return ok ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));

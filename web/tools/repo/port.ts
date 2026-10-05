/**
 * The browser player's `game/` tree against the Ghidra annotations.
 *
 *     node tools/run_ts.mjs tools/repo/port.ts [--root <dir>]
 *
 * The porting rules in `docs/PLAYER.md` are cheaply checkable because both
 * sides are text, and this checks them:
 *
 *  1. every `FUN_` address cited beside a name in `game/` or `script/` is in
 *     `ghidra/annotations/functions.tsv` under that name, and every
 *     `0x00…` address beside a `g_` name is in `globals.tsv` under that name;
 *     a definition (`` `Name` -- `FUN_…` ``) is backed by a function or
 *     `const` of that name in the same file, and no exe function is ported in
 *     two files;
 *  2. the coverage -- how much of the gameplay code has a port -- is a number,
 *     over the gameplay address ranges on both sides of the fraction;
 *  3. every exported function in `game/` cites the exe function it ports or
 *     is tagged `[port-only]`, and the count of those that do neither is a
 *     ratchet: it may fall, and a rise fails;
 *  4. every `[diverges]` in a comment anywhere under `web/src/` is gathered
 *     into one list, and each carries its reason;
 *  5. the class modules line up with `SpawnClass` and with the class table in
 *     `docs/formats/spawns.md`;
 *  6. the ways state escapes a save snapshot are refused: three.js in
 *     `game/`, `Math.random(`, `export let` or `export var` in `globals.ts`,
 *     and a hand-rolled `dt * 60` in `game/` or `render/`;
 *  7. the exporter bakes every class-0x31 clip the port names as a literal,
 *     and -- with a bundle -- class 0x33's tail blocks and the crawler's
 *     leap (its entry, lunge and arc clips) are in it;
 *  8. and the same citation rule holds in `docs/`: a name beside an address
 *     there agrees with `functions.tsv`.
 *
 * Exit 0 when every check passes, 1 when one fails, 2 when there is no
 * `web/src/game/` to check. The bundle is `HOTD2_BUNDLE`, or `extract/player`
 * under the tree; with none, the bundle checks print a note saying what they
 * did not check.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type * as TS from "typescript";

import {
  basename, bundleDir, charLength, dirname, dirsIn, filesIn, filesUnder, isDir,
  isFile, isSource, join, lineAt, matches, parse, parseArgs, readText,
  relative, scan, scanText, sortPaths, splitLines, strip, ts, words,
} from "./tree";

/** The two markers counted in every source file. */
export const DIVERGES_TAG = "[diverges]";
export const OPEN_TAG = "[open]";

/** Where everything this reads is, for the tree at `root`. */
export interface PortTree {
  root: string;
  src: string;
  game: string;
  script: string;
  docs: string;
  funcs: string;
  globals: string;
  spawns: string;
  bundle: string;
}

export function portTree(root: string): PortTree {
  const src = join(root, "web", "src");
  return {
    root, src,
    game: join(src, "game"),
    script: join(src, "script"),
    docs: join(root, "docs"),
    funcs: join(root, "ghidra", "annotations", "functions.tsv"),
    globals: join(root, "ghidra", "annotations", "globals.tsv"),
    spawns: join(root, "docs", "formats", "spawns.md"),
    bundle: bundleDir(root),
  };
}

/** What the checks found: notes to print, and failures to fail on. */
export class Findings {
  readonly failures: string[] = [];
  readonly notes: string[] = [];
  fail(s: string): void { this.failures.push(s); }
  note(s: string): void { this.notes.push(s); }
}

// Two citation forms, and the difference matters.
//
//   definition   `ResolveHit` -- `FUN_00409430`      "this file ports it"
//   reference    `ZombieStateStrike` (`FUN_00455A40`) "this is where it lives"
//
// Both must agree with functions.tsv; only a definition has to be backed by a
// function of that name in the same file.
export const DEF = /`([A-Za-z_][A-Za-z0-9_]*)`\s*[-—]+\s*`(FUN_[0-9A-Fa-f]{8})`/g;
export const REF = /`([A-Za-z_][A-Za-z0-9_]*)`\s*\(`(FUN_[0-9A-Fa-f]{8})`\)/g;
const ANY_FUN = /`(FUN_[0-9A-Fa-f]{8})`/g;
// `/** `g_attack_permits` -- `0x009A2BA0`, one per player. */`, and the same
// thing written as a trailing comment on the field itself.
const GLOBAL_DOC = /`(g_[A-Za-z0-9_]+)`\s*[-—]+\s*`?0x([0-9A-Fa-f]{6,8})`?/g;
const PORT_ONLY = "[port-only]";

const rel = (t: PortTree, p: string): string => relative(t.root, p);

/** `address -> name` from an annotation TSV, addresses in lower case. */
export function annotations(path: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of splitLines(readText(path))) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    out.set(parts[0].toLowerCase(), parts[1]);
  }
  return out;
}

const isTs = (name: string): boolean => name.endsWith(".ts");

/** Every `.ts` under `game/`: where the port's boundary and coverage hold. */
export function gameFiles(t: PortTree): string[] {
  return filesUnder(t.game, isTs);
}

/**
 * Everything whose exe citations are checked: `game/`, and `script/`, whose
 * event VM opcode handlers are exe functions like any other. The boundary
 * and coverage checks stay on `game/` -- `script/` legitimately touches the
 * DOM, and the opcode handlers are not the gameplay call graph coverage
 * measures.
 */
export function citedFiles(t: PortTree): string[] {
  return [...gameFiles(t), ...filesUnder(t.script, isTs)];
}

/**
 * Every source file under `web/src/`, in every layer and `.tsx` included:
 * where a `[diverges]` or an `[open]` counts. A departure declared in the
 * composition root is a departure, and a question the exporter has not
 * answered is a question, so the rule is the directory tree.
 *
 * Citations are **not** checked this wide: `render/` and the layers above it
 * have different rules. This says only that a declared marker counts
 * wherever it is written.
 */
export function markerFiles(t: PortTree): string[] {
  return filesUnder(t.src, isSource);
}

/**
 * The 1-based line of every `token` that sits **in a comment**, one entry per
 * occurrence. A marker is a claim written in prose next to the code it is
 * about, so the comment is what counts: a word in code is not a marker, and
 * neither is one in a string, a template, a regular expression or JSX text.
 * The comments are the parser's (`tree.ts`'s `commentRanges`).
 */
export function markerLines(text: string,
                            comments: readonly { pos: number; end: number }[],
                            token: string): number[] {
  const out: number[] = [];
  for (const { pos, end } of comments) {
    const body = text.slice(pos, end);
    for (let k = body.indexOf(token); k >= 0; k = body.indexOf(token, k + 1)) {
      out.push(lineAt(text, pos + k));
    }
  }
  return out;
}

/**
 * Occurrences of `token` in comments, by top-level directory of `web/src/`
 * -- the unit `layers.ts`'s `LAYER_OF` assigns a layer to.
 */
export function markerCounts(t: PortTree, token: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const path of markerFiles(t)) {
    const top = relative(t.src, path).split("/")[0];
    const s = scan(path);
    out.set(top, (out.get(top) ?? 0) + markerLines(s.text, s.comments, token).length);
  }
  return out;
}

/**
 * The marker count's own fixture: every shape that has a marker in it, with
 * the lines that must count and the lines that must not. Line 7 is JSX text
 * with a `//` in it, which is text and not a comment.
 */
const MARKER_FIXTURE = `\
const s = "a // not a comment [open]";  // [open] counts
const r = /[open]\\//g; // [diverges] counts, with a reason of its own here
const t = \`\${x /* [open] counts */} [open] template text does not\`;
useEffect(() => {}, [open]);
/** [diverges] a
 * [open] b */
const p = <p>don't [open], nor http://a.b [open]</p>;
const u = a / b; // [open] after a division counts
`;

/**
 * Pin {@link markerLines} against {@link MARKER_FIXTURE}, so a change that
 * starts counting code -- or stops counting a comment -- fails here rather
 * than moving the status report's numbers in silence (`L41`); and pin that a
 * comment left open is reported as one.
 */
export function checkMarkerCount(out: Findings): void {
  const src = scanText("fixture.tsx", MARKER_FIXTURE);
  const want: [string, number[]][] = [[OPEN_TAG, [1, 3, 6, 8]], [DIVERGES_TAG, [2, 5]]];
  for (const [token, lines] of want) {
    const got = markerLines(src.text, src.comments, token);
    if (got.join() !== lines.join() || !src.closed) {
      out.fail(`marker count: ${token} found on lines ${showList(got)} of the `
        + `fixture, expected ${showList(lines)} (closed: ${showBool(src.closed)})`);
    }
  }
  if (scanText("open.ts", "const a = 1;\n/* [open]\n").closed) {
    out.fail("marker count: a block comment left open at the end of a file "
      + "is not reported");
  }
}

/** A comment line: one that starts, after its indent, `*`, `//` or `/*`. */
const isCommentLine = (line: string): boolean => {
  const s = strip(line);
  return s.startsWith("*") || s.startsWith("//") || s.startsWith("/*");
};

/**
 * The prose of the comment `lines[i]` sits in, tag and comment markers
 * stripped. Walks out in both directions over contiguous comment lines, so a
 * reason written above the tag counts as much as one written after it.
 */
export function commentBlock(lines: readonly string[], i: number): string {
  let lo = i;
  while (lo > 0 && isCommentLine(lines[lo - 1])) lo--;
  let hi = i;
  while (hi + 1 < lines.length && isCommentLine(lines[hi + 1])) hi++;
  let text = lines.slice(lo, hi + 1).join(" ");
  for (const junk of ["[diverges]", "/**", "*/", "//", "*"]) {
    text = text.split(junk).join(" ");
  }
  return words(text).join(" ");
}

type Ported = Map<string, [name: string, file: string]>;

/**
 * Rule 1: one exe function, one TS function, same name.
 *
 * Returns the ports found, keyed by **address** rather than by name: an
 * address is the identity the rule is about, and keying by name would let
 * one exe function be transcribed twice with different bodies, the second
 * swallowed by the first.
 */
export function checkNames(t: PortTree, named: Map<string, string>,
                           out: Findings): Ported {
  const ported: Ported = new Map();
  const unnamed = new Set<string>();
  for (const path of citedFiles(t)) {
    const src = scan(path);
    const text = src.text;
    const r = rel(t, path);
    const cited = new Set<string>();

    const cite = (name: string, fun: string, isDef: boolean) => {
      const addr = fun.slice(4).toLowerCase();
      cited.add(addr);
      const real = named.get(addr);
      if (real === undefined) {
        out.fail(`${r}: ${fun} is cited as \`${name}\` but is not in `
          + `functions.tsv -- name it there first (/decomp)`);
        return;
      }
      if (real !== name) {
        // A rename applied in Ghidra and in the TSV but not here.
        out.fail(`${r}: says \`${name}\` for ${fun}, functions.tsv says \`${real}\``);
        return;
      }
      if (!isDef) return;
      const prev = ported.get(addr);
      if (prev !== undefined && prev[1] !== r) {
        out.fail(`${r}: ${fun} (\`${real}\`) is also ported in ${prev[1]} -- `
          + `one exe function, one TS function; make one of them call the other`);
      }
      ported.set(addr, [real, r]);
      // A definition must actually be declared, or the doc is decoration.
      if (!src.declared.has(name)) {
        out.fail(`${r}: documents \`${name}\` -- ${fun} as a port but declares `
          + `no such function; cite it as \`${name}\` (${fun}) instead`);
      }
    };

    const refs = matches(REF, text).map((m) => [m[1], m[2]] as const);
    for (const [name, fun] of refs) cite(name, fun, false);
    const refKeys = new Set(refs.map(([n, f]) => `${n}\t${f}`));
    for (const m of matches(DEF, text)) {
      // A pair this file also cites as a reference is a reference.
      if (refKeys.has(`${m[1]}\t${m[2]}`)) continue;
      cite(m[1], m[2], true);
    }

    // A bare address with no name beside it is a pointer at something Ghidra
    // has not named. Legitimate -- an unread class handler is still worth
    // citing -- but counted, so it does not become the norm.
    for (const m of matches(ANY_FUN, text)) {
      const a = m[1].slice(4).toLowerCase();
      if (!cited.has(a) && !named.has(a)) unnamed.add(m[1]);
    }
  }
  if (unnamed.size) {
    out.note(`unnamed citations: ${unnamed.size} -- ${[...unnamed].sort().join(", ")}`);
  }
  return ported;
}

/**
 * Exported functions in `game/` that claim nothing about the exe: they cite
 * no exe function as a definition and are not tagged `[port-only]` in the
 * comment around them. `path:line name`, in file order.
 */
export function uncitedExports(t: PortTree): string[] {
  const uncited: string[] = [];
  for (const path of gameFiles(t)) {
    const src = scan(path);
    const defined = new Set(matches(DEF, src.text).map((m) => m[1]));
    const lines = splitLines(src.text);
    for (const { name, line } of src.exportedFunctions) {
      if (defined.has(name)) continue;
      // `[port-only]` anywhere in the enclosing comment block, on the same
      // terms as `[diverges]`: this file's scaffolding, no exe function
      // behind it.
      if (commentBlock(lines, line - 1).includes(PORT_ONLY)) continue;
      uncited.push(`${rel(t, path)}:${line} ${name}`);
    }
  }
  return uncited;
}

/**
 * The uncited-export ratchet. The count falls when someone opens a file
 * with Ghidra beside them and cites what it ports; it may never rise. A new
 * export must declare which kind it is.
 */
export const UNCITED_BASELINE = 79;

export function checkUncitedExports(t: PortTree, out: Findings): void {
  const uncited = uncitedExports(t);
  const n = uncited.length;
  const status = n === UNCITED_BASELINE ? "held"
    : n < UNCITED_BASELINE ? "IMPROVED -- lower the baseline" : "RISEN";
  out.note(`uncited exports: ${n} of ${UNCITED_BASELINE} baseline (${status})`);
  if (n > UNCITED_BASELINE) {
    for (const u of uncited) out.note(`  ${u}`);
    out.fail(`uncited exports rose to ${n} from a baseline of `
      + `${UNCITED_BASELINE} -- a new \`export function\` in game/ must `
      + `either cite the exe function it ports (\`Name\` -- \`FUN_...\`) or `
      + `be tagged [port-only]`);
  }
}

/**
 * Rule 1, for the data segment: a global renamed in Ghidra and not here
 * still resolves by address, and the name beside it no longer matches.
 */
export function checkGlobals(t: PortTree, named: Map<string, string>,
                             out: Findings): number {
  const seen = new Set<string>();
  for (const path of citedFiles(t)) {
    const r = rel(t, path);
    for (const m of matches(GLOBAL_DOC, scan(path).text)) {
      const key = m[2].toLowerCase().padStart(8, "0");
      const real = named.get(key);
      if (real === undefined) {
        out.fail(`${r}: 0x${key.toUpperCase()} is not in globals.tsv`);
      } else if (real !== m[1]) {
        out.fail(`${r}: doc says \`${m[1]}\` for 0x${key.toUpperCase()}, `
          + `globals.tsv says \`${real}\``);
      } else {
        seen.add(real);
      }
    }
  }
  out.note(`globals: ${seen.size} cited, all matching globals.tsv`);
  return seen.size;
}

/**
 * The enemy, camera-director, player-damage and thrower code: where the
 * ported functions live, so the denominator is the code this port is trying
 * to cover rather than the whole binary.
 */
const GAMEPLAY_RANGES: [number, number][] = [
  [0x00402800, 0x00403E00],   // the camera director
  [0x00408C00, 0x0040B000],   // slots, ranking, class table
  [0x00415200, 0x00415500],   // player damage
  [0x00449000, 0x00451000],   // class 0x31
  [0x00452C00, 0x0045E000],   // class 0x30
];

function inGameplay(addr: string): boolean {
  const a = Number.parseInt(addr, 16);
  return GAMEPLAY_RANGES.some(([lo, hi]) => lo <= a && a < hi);
}

/**
 * `[ported in range, annotated in range, ported outside the ranges]`.
 * **Both halves of the fraction are filtered by the same ranges**: the
 * out-of-range ports -- opcode handlers, and the classes whose handlers sit
 * elsewhere -- are real work, and are reported on their own rather than
 * folded into a ratio they are not part of.
 */
export function coverageCounts(named: Map<string, string>,
                               ported: Ported): [number, number, number] {
  let total = 0;
  for (const addr of named.keys()) if (inGameplay(addr)) total++;
  let inside = 0;
  for (const addr of ported.keys()) if (inGameplay(addr)) inside++;
  return [inside, total, ported.size - inside];
}

function checkCoverage(named: Map<string, string>, ported: Ported,
                       out: Findings): void {
  const [inside, total, outside] = coverageCounts(named, ported);
  out.note(`coverage: ${inside} of ${total} annotated gameplay functions have `
    + `a port (${Math.floor(100 * inside / Math.max(1, total))}%)`);
  out.note(`  and ${outside} ported functions outside the gameplay ranges `
    + `(opcodes, classes 0x10/0x24/0x25/0x41)`);
}

/**
 * Rule 4: the places the port is knowingly wrong, in one list, over
 * {@link markerFiles}. An occurrence is one in a comment, one per
 * occurrence. A tag with no prose around it is a confession with no content,
 * so each needs a reason in its comment block, in either direction -- the
 * convention is to explain first and tag last.
 */
export function checkDivergences(t: PortTree, out: Findings): void {
  const found: string[] = [];
  for (const path of markerFiles(t)) {
    const src = scan(path);
    const lines = splitLines(src.text);
    if (!src.closed) {
      out.fail(`${rel(t, path)}: the file ends inside a comment, string or `
        + `template -- fix it before believing any count from it`);
    }
    for (const n of markerLines(src.text, src.comments, DIVERGES_TAG)) {
      const where = `${rel(t, path)}:${n}`;
      found.push(where);
      if (charLength(commentBlock(lines, n - 1)) < 60) {
        out.fail(`${where}: [diverges] with no reason around it -- say what `
          + `the engine does and what this does instead`);
      }
    }
  }
  out.note(`divergences: ${found.length} declared`);
  for (const f of found) out.note(`  ${f}`);
}

/**
 * The three things every class check reads: the classes the port has a
 * `game/class<NN>/` for, what the `SpawnClass` enum names, and what
 * `spawns.md` records as `[class, placements]`.
 *
 * A row of the table may cover several classes -- the doc groups them where
 * the engine does. The placement count is per row, so a shared row's count
 * goes to its first class and the rest score zero, unless the row gives one
 * count per class (`6/8`); that keeps the total honest.
 */
export function readClassTable(t: PortTree):
    [Set<number>, Map<number, string>, [number, number][]] {
  const ported = new Set<number>();
  for (const name of dirsIn(t.game)) {
    if (!name.startsWith("class")) continue;
    const id = name.slice(5);
    if (!/^[\p{L}\p{N}]+$/u.test(id)) continue;
    if (!/^[0-9a-fA-F]+$/.test(id)) {
      throw new Error(`game/${name}/: ${JSON.stringify(id)} is not a hex class id`);
    }
    ported.add(Number.parseInt(id, 16));
  }

  const members = new Map<number, string>();
  const enumPath = join(t.game, "spawn_class.ts");
  const sf = parse(enumPath, readText(enumPath));
  for (const st of sf.statements) {
    if (!ts.isEnumDeclaration(st) || st.name.text !== "SpawnClass") continue;
    for (const m of st.members) {
      if (ts.isIdentifier(m.name) && m.initializer
          && ts.isNumericLiteral(m.initializer)) {
        members.set(Number(m.initializer.text), m.name.text);
      }
    }
  }

  const ROW = /^\| ((?:`0x[0-9A-Fa-f]{2}`[/,] *)*`0x[0-9A-Fa-f]{2}`) \| [^|]+ \| ([\d/]+) \|/gm;
  const known: [number, number][] = [];
  for (const m of matches(ROW, readText(t.spawns))) {
    const found = matches(/0x([0-9A-Fa-f]{2})/g, m[1]).map((x) => x[1]);
    const each = m[2].split("/");
    found.forEach((c, i) => {
      const n = each.length === found.length ? each[i] : (i === 0 ? each[0] : "0");
      known.push([Number.parseInt(c, 16), Number.parseInt(n, 10)]);
    });
  }
  return [ported, members, known];
}

/**
 * `[classes with a module, read classes, covered placements, placements]`,
 * zeroes if `spawns.md`'s table cannot be read -- {@link checkClasses} is
 * the one that turns that into a failure.
 */
export function classCounts(t: PortTree): [number, number, number, number] {
  const [ported, , known] = readClassTable(t);
  if (!known.length) return [0, 0, 0, 0];
  let covered = 0, total = 0;
  for (const [c, n] of known) {
    total += n;
    if (ported.has(c)) covered += n;
  }
  return [ported.size, known.length, covered, total];
}

const hex2 = (n: number): string => n.toString(16).padStart(2, "0");
const HEX2 = (n: number): string => hex2(n).toUpperCase();
const byNumber = (a: number, b: number): number => a - b;

/** Which spawn classes have behaviour, and which are simply unread. */
export function checkClasses(t: PortTree, out: Findings): void {
  const [ported, members, known] = readClassTable(t);
  if (!known.length) {
    out.fail("spawns.md: could not read the class table");
    return;
  }
  // Every class module has a `SpawnClass` member, so no registry key is ever
  // a bare number -- the rule that keeps one class from running another's
  // state machine.
  for (const c of [...ported].sort(byNumber)) {
    if (!members.has(c)) {
      out.fail(`game/class${hex2(c)}/ has no SpawnClass member; `
        + `add one rather than keying the registry on 0x${HEX2(c)}`);
    }
  }
  const [nPorted, nKnown, covered, total] = classCounts(t);
  out.note(`classes: ${nPorted} of ${nKnown} read classes have a module, `
    + `covering ${covered} of ${total} placements`);
  for (const [c, n] of [...known].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    if (!ported.has(c)) out.note(`  unported: 0x${HEX2(c)}, ${n} placements`);
  }
  const rows = new Set(known.map(([c]) => c));
  for (const c of [...ported].sort(byNumber)) {
    if (!rows.has(c)) out.fail(`game/class${hex2(c)}/ has no row in spawns.md`);
  }
  for (const c of [...members.keys()].sort(byNumber)) {
    if (!rows.has(c)) out.fail(`SpawnClass 0x${HEX2(c)} has no row in spawns.md`);
  }
}

/**
 * The ways state escapes a save, each with one honest spelling: three.js in
 * `game/` (the port runs headless), `Math.random(` anywhere in a `game/` file
 * (draw from the world `Rng`, or a snapshot cannot be replayed), and an
 * `export let` or `export var` in `globals.ts` (a binding cannot be
 * enumerated, so it cannot be snapshotted -- it goes in `G`).
 */
export function checkSnapshotRules(t: PortTree, out: Findings): void {
  for (const path of gameFiles(t)) {
    const r = rel(t, path);
    const src = scan(path);
    if (src.modules.some((m) => m.spec === "three" || m.spec.startsWith("three/"))) {
      out.fail(`${r}: imports three -- game/ must run headless`);
    }
    if (src.text.includes("Math.random(")) {
      out.fail(`${r}: Math.random() -- draw from the world Rng, or a `
        + `snapshot cannot be replayed`);
    }
  }
  if (scan(join(t.game, "globals.ts")).exportedLets.length) {
    out.fail("game/globals.ts: `export let` cannot be enumerated, "
      + "so it cannot be snapshotted -- put it in `G`");
  }
}

/**
 * `dt` is seconds of game time; a tick count derived from it by a bare
 * multiplication is a float. `dt` is `frames * (1 / 60)`, and for 9 of the
 * 241 tick counts a frame can carry, multiplying back gives
 * 30.999999999999996 rather than 31 -- a counter decremented by that drifts
 * off every exact comparison the engine's own whole-step counters make.
 * `core/play_cursor.ts`'s `ticksOfSeconds` rounds, and `game/` reaches it
 * through `SecondsToTicks` in `tables.ts`. Read from the code with its
 * comments taken out: prose about the hazard is not the hazard.
 */
const FRAME_MATH = /\bdt\s*\*\s*60\b/g;
const TICK_SCOPE = ["game", "render"];

export function checkFrameMath(t: PortTree, out: Findings): void {
  const bad: string[] = [];
  for (const name of TICK_SCOPE) {
    for (const path of filesUnder(join(t.src, name), isTs)) {
      const src = scan(path);
      const lines = splitLines(src.text);
      const hit = new Set(matches(FRAME_MATH, src.code)
        .map((m) => lineAt(src.code, m.index)));
      for (const n of hit) {
        bad.push(`${rel(t, path)}:${n}: ${strip(lines[n - 1] ?? "")}`);
      }
    }
  }
  if (bad.length) {
    for (const b of bad) out.fail(`hand-rolled tick conversion -- ${b}`);
    out.fail("use `SecondsToTicks` (game/tables.ts) or `ticksOfSeconds` "
      + "(core/play_cursor.ts); `dt * 60` is a float and the counters it "
      + "feeds are compared exactly");
  } else {
    out.note(`frame math: no hand-rolled \`dt * 60\` under ${TICK_SCOPE.join("/, ")}/`);
  }
}

/**
 * Every stage script in the bundle -- a `stage….script.json` in a directory
 * whose name starts `stage` -- in path order.
 */
function bundleStages(t: PortTree): string[] {
  const out: string[] = [];
  for (const d of dirsIn(t.bundle)) {
    if (!d.startsWith("stage")) continue;
    out.push(...filesIn(join(t.bundle, d), (n) => n.startsWith("stage")
      && n.endsWith(".script.json") && n.length >= "stage.script.json".length));
  }
  return sortPaths(out);
}

/** A bundle document, as parsed: the checks read it field by field. */
type Json = any;

const readJson = (path: string): Json => JSON.parse(readText(path));

/** Truth as the bundle's writer means it: empty containers are false. */
function truthy(v: Json): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/** A value as the report prints it: `None`, `True`, `3`, `{'cue': 3}`. */
function show(v: Json): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "string") return v;
  return repr(v);
}

function repr(v: Json): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    return v.includes("'") && !v.includes('"')
      ? `"${v.replace(/\\/g, "\\\\")}"`
      : `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
  if (Array.isArray(v)) return `[${v.map(repr).join(", ")}]`;
  return `{${Object.entries(v).map(([k, x]) => `${repr(k)}: ${repr(x)}`).join(", ")}}`;
}

const showBool = (b: boolean): string => (b ? "True" : "False");
const showList = (xs: number[]): string => `[${xs.join(", ")}]`;
/** `0x` and at least `width` hex digits: `0x00ab`. */
const hexw = (n: number, width: number): string =>
  `0x${n.toString(16).padStart(width, "0")}`;

/**
 * Every clip a class-0x31 state names as a literal must be baked.
 *
 * Class 0x31's motion ids mostly arrive through `g_class31_motion_sets` and
 * the attack tables, and the exporter collects those from the data. A
 * handful of states name a clip **inline**, and nothing collects those -- so
 * `CLASS31_LITERAL_MOTIONS` in `web/src/hod2lib/class31.ts` is a hand-kept
 * list, and a clip missing from it breaks its state silently: `MotionOf`
 * returns nothing and the state falls through. `REARM_CLIP`
 * (`ThrowerStateRearm`, `FUN_0044F7A0`) is the sharp case -- with no clip the
 * state's midpoint, where the hands are re-armed, never arrives, and a
 * thrower that has thrown once never attacks again.
 *
 * So the producer and the consumer are checked against each other: every
 * top-level `const` in `game/class31/` named `*CLIP` or `*MOTION` with a
 * number for its value is in the set, and -- with a bundle -- some class-0x31
 * character type carries it. The claim is deliberately that weak: which
 * types may reach which clip is a per-state rule, and baked for nobody is the
 * failure that matters.
 */
export function checkClass31LiteralClips(t: PortTree, out: Findings): void {
  const libPath = join(t.src, "hod2lib", "class31.ts");
  const lib = parse(libPath, readText(libPath));
  let set: number[] | null = null;
  const visit = (n: TS.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)
        && n.name.text === "CLASS31_LITERAL_MOTIONS" && n.initializer
        && ts.isNewExpression(n.initializer)) {
      const arg = n.initializer.arguments?.[0];
      set = [];
      if (arg && ts.isArrayLiteralExpression(arg)) {
        for (const e of arg.elements) if (ts.isNumericLiteral(e)) set.push(Number(e.text));
      }
    }
    n.forEachChild(visit);
  };
  visit(lib);
  if (set === null) {
    out.fail("web/src/hod2lib/class31.ts declares no CLASS31_LITERAL_MOTIONS set");
    return;
  }
  const baked = new Set<number>(set);
  if (!baked.size) {
    out.fail("CLASS31_LITERAL_MOTIONS in web/src/hod2lib/class31.ts is empty "
      + "or could not be read");
    return;
  }
  let found = 0;
  const named = new Map<string, [string, number]>();
  for (const path of filesIn(join(t.game, "class31"), isTs)) {
    const sf = parse(path, readText(path));
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)
          || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer
            || !ts.isNumericLiteral(d.initializer)
            || !/^[A-Z][A-Z0-9_]*(?:CLIP|MOTION)$/.test(d.name.text)) continue;
        found++;
        const value = d.initializer.getText(sf);
        const n = Number(d.initializer.text);
        named.set(`${d.name.text}\t${n}`, [d.name.text, n]);
        if (baked.has(n)) continue;
        out.fail(`web/src/game/class31/${basename(path)}: ${d.name.text} = ${value} `
          + `is not in CLASS31_LITERAL_MOTIONS, so the exporter never bakes it `
          + `and the state it belongs to plays no clip at all`);
      }
    }
  }
  const stages = bundleStages(t);
  if (!stages.length) {
    out.note(`${found} class-0x31 literal clip ids check out against the `
      + `exporter's bake list (no bundle to check them in)`);
    return;
  }
  const carried = new Set<number>();
  const types31 = new Set<number>();
  for (const path of stages) {
    const chars = readJson(path).characters || {};
    for (const p of chars.placements || []) {
      if (p.class === 0x31) types31.add(p.char_type);
    }
    for (const [key, ty] of Object.entries<Json>(chars.types || {})) {
      if (!types31.has(Number.parseInt(key, 10))) continue;
      for (const m of Object.keys(ty.motions || {})) carried.add(Number.parseInt(m, 10));
    }
  }
  const lits = [...named.values()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);
  for (const [name, n] of lits) {
    if (!carried.has(n)) {
      out.fail(`class-0x31 clip ${name} = 0x${n.toString(16).toUpperCase()} is `
        + `baked for no character type in extract/player -- the state that `
        + `names it plays no clip at all, and nothing else will say so`);
    }
  }
  out.note(`${found} class-0x31 literal clip ids check out against the `
    + `exporter's bake list and ${stages.length} exported stages`);
}

/** The node names in a `.glb`'s JSON chunk, reading only that chunk. */
function glbNodeNames(path: string): string[] {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(8);
    for (let off = 12; off + 8 <= size;) {
      readSync(fd, head, 0, 8, off);
      const len = head.readUInt32LE(0);
      if (head.toString("latin1", 4, 8) === "JSON") {
        const body = Buffer.alloc(Math.min(len, size - off - 8));
        readSync(fd, body, 0, body.length, off + 8);
        return (JSON.parse(body.toString("utf8")).nodes as Json[])
          .map((n) => n.name ?? "");
      }
      off += 8 + len;
    }
    return [];
  } finally {
    closeSync(fd);
  }
}

/** The class-0x33 selectors the port runs, and so the bundle must carry. */
const CLASS33_PORTED = [1, 4, 5, 6, 7, 8, 9, 10, 11, 99];

/**
 * Class 0x33's decoded sub-handlers, producer against consumer.
 *
 * `ScriptedSceneryDispatch33` (`FUN_00432FF0`) switches `obj+0x11C` into
 * twelve objects that read the same descriptor bytes twelve ways, and the
 * port has ten: selector 1 through the `class33` block, selector 4 through
 * `class33_push`, selector 5 through `class33_cue` and selectors 6 to 11 and
 * 99 through `class33_sub`, which names its own selector. The port takes which
 * block arrived as the selector, so in the bundle:
 *
 * 1. **every spawn of a ported selector the script makes has a placement**;
 * 2. **each placement carries exactly one block**, the one its selector
 *    reads -- two would be one handler's names over the other's bytes
 *    (`L3`), selector 5's is the one integer word it reads, and
 *    `class33_sub`'s selector is the placement's, and selector 7's list ends
 *    on the one record that cannot fire, with a sound on every record before
 *    it;
 * 3. **the model travels**: selector 4's draw slot is named by the
 *    descriptor, not the class, so its `slots_actor` part must be in the
 *    glTF, and every cel of the kind-0x44 sprite selector 5 throws must be
 *    in `slots_effect`, or the object works and is not drawn; so must the
 *    strip selectors 8 and 9 draw and selector 99's slot.
 */
export function checkClass33Selectors(t: PortTree, out: Findings): void {
  const stages = bundleStages(t);
  if (!stages.length) {
    out.note("class 0x33's three tail blocks unchecked (no bundle)");
    return;
  }
  let nCarrier = 0, nPush = 0, nCue = 0, nSub = 0;
  for (const path of stages) {
    const doc = readJson(path);
    const stage = basename(dirname(path));
    const places: Json[] = (doc.characters || {}).placements || [];
    // The script's own spawn records are the producer's input, so the count
    // comes from the data rather than from a number written here.
    const want = new Map<number, number>();
    for (const blk of doc.blocks || []) {
      for (const step of blk.steps || []) {
        for (const op of step.ops || []) {
          for (const sp of op.spawns || []) {
            if (sp.class === 0x33 && CLASS33_PORTED.includes(sp.hp)) want.set(sp.at, sp.hp);
          }
        }
      }
    }
    const have = new Set(places.filter((p) => p.class === 0x33).map((p) => p.at));
    for (const [at, hp] of [...want].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
      if (!have.has(at)) {
        out.fail(`${stage} spawn ${hexw(at, 4)}: selector ${hp} is spawned by `
          + `the script and has no placement, so \`SpawnSlotActors\` can never `
          + `make it -- widen \`slotDrawnSpawn\` and \`slot_drawn_spawn\` together`);
      }
    }
    const pushSlots = new Set<number>();
    const subSlots = new Set<number>();
    let cueHere = false;
    for (const p of places) {
      if (p.class !== 0x33) continue;
      const carrier = p.class33, push = p.class33_push, cue = p.class33_cue;
      const sub = p.class33_sub;
      const at: number = p.at ?? 0, hp = p.hp;
      const blocks = ([["class33", carrier], ["class33_push", push],
                       ["class33_cue", cue], ["class33_sub", sub]] as [string, Json][])
        .filter(([, v]) => truthy(v)).map(([k]) => k);
      if (blocks.length > 1) {
        out.fail(`${stage} spawn ${hexw(at, 4)}: carries `
          + `${blocks.map((k) => `\`${k}\``).join(" and ")} -- sub-handlers' `
          + `readings of the same bytes, which is \`L3\` in the bundle`);
      }
      if (!blocks.length) {
        out.fail(`${stage} spawn ${hexw(at, 4)}: selector ${show(hp)} has a `
          + `placement and no tail block, so \`SpawnSlotActors\` will refuse it `
          + `and the placement is dead weight`);
      }
      if (truthy(carrier)) {
        nCarrier++;
        if (hp !== 1) {
          out.fail(`${stage} spawn ${hexw(at, 4)}: \`class33\` on selector `
            + `${show(hp)}, but only selector 1 reads those bytes`);
        }
      }
      if (truthy(push)) {
        nPush++;
        if (hp !== 4) {
          out.fail(`${stage} spawn ${hexw(at, 4)}: \`class33_push\` on selector `
            + `${show(hp)}, but only selector 4 reads those bytes`);
        }
        const slot = push.slot;
        if (Number.isInteger(slot) && slot > 0) {
          pushSlots.add(slot);
        } else {
          out.fail(`${stage} spawn ${hexw(at, 4)}: selector 4 with no draw slot `
            + `-- nothing can be cloned for it`);
        }
      }
      if (truthy(sub)) {
        nSub++;
        if (sub.selector !== hp) {
          out.fail(`${stage} spawn ${hexw(at, 4)}: \`class33_sub\` names `
            + `selector ${show(sub.selector)} on a selector-${show(hp)} spawn`);
        }
        if (sub.selector === 7) {
          // `ScriptedSoundCues33` parks on the first record that cannot fire
          // and reads nothing past it; every record before it plays a sound.
          const cues: Json[] = Array.isArray(sub.cues) ? sub.cues : [];
          const last = cues[cues.length - 1];
          const fires = (c: Json) => c.mode === 0 || c.mode === 1;
          if (!last || fires(last) || "sound" in last
              || cues.slice(0, -1).some((c) => !fires(c) || !Number.isInteger(c.sound))) {
            out.fail(`${stage} spawn ${hexw(at, 4)}: selector 7's cues `
              + `${repr(cues)} do not end on one record that cannot fire, `
              + `with a sound on every record before it`);
          }
        }
        if (sub.selector === 8) for (let s = 0x174a; s <= 0x1785; s++) subSlots.add(s);
        if (sub.selector === 9) for (let s = 0x1aab; s <= 0x1ad2; s++) subSlots.add(s);
        if (sub.selector === 99) subSlots.add(sub.slot);
      }
      if (truthy(cue)) {
        nCue++;
        cueHere = true;
        if (hp !== 5) {
          out.fail(`${stage} spawn ${hexw(at, 4)}: \`class33_cue\` on selector `
            + `${show(hp)}, but only selector 5 reads that word`);
        }
        // `ScriptedEffectAtCameraCue33` reads `tail+0x00` and nothing else,
        // as an integer camera frame. A block that grew a second key has
        // read past the one-word tail into the next record.
        if (Object.keys(cue).sort().join() !== "cue" || !Number.isInteger(cue.cue)) {
          out.fail(`${stage} spawn ${hexw(at, 4)}: \`class33_cue\` is `
            + `${repr(cue)}, not the one integer word selector 5 reads`);
        }
      }
    }
    if (!pushSlots.size && !cueHere && !subSlots.size) continue;
    const glb = join(dirname(path), `${stage}.glb`);
    if (!isFile(glb)) continue;
    const names = new Set(glbNodeNames(glb));
    for (const slot of [...pushSlots].sort(byNumber)) {
      const part = `slots_actor_fixed000_slot_${slot.toString(16).padStart(4, "0")}`;
      if (!names.has(part)) {
        out.fail(`${stage}: selector-4 draw slot ${hexw(slot, 4)} is in a `
          + `placement but has no \`${part}\` part in the glTF -- the object `
          + `is pushable and invisible`);
      }
    }
    for (const slot of [...subSlots].sort(byNumber)) {
      const part = `slots_actor_fixed000_slot_${slot.toString(16).padStart(4, "0")}`;
      if (!names.has(part)) {
        out.fail(`${stage}: class-0x33 draw slot ${hexw(slot, 4)} (selector `
          + `8, 9 or 99) has no \`${part}\` part in the glTF -- the object `
          + `runs and is not drawn`);
        break;
      }
    }
    if (cueHere) {
      // `SpawnSpriteEffectFromParams`' `case 0x44:`, first and last slot.
      for (let slot = 0xFD4; slot <= 0x1031; slot++) {
        const part = `slots_effect_fixed000_slot_${slot.toString(16).padStart(4, "0")}`;
        if (!names.has(part)) {
          out.fail(`${stage}: a selector-5 placement throws sprite kind 0x44, `
            + `and its cel ${hexw(slot, 4)} has no \`${part}\` part in the glTF `
            + `-- the effect fires and draws nothing`);
          break;
        }
      }
    }
  }
  out.note(`class 0x33: ${nCarrier} selector-1, ${nPush} selector-4, `
    + `${nCue} selector-5 and ${nSub} selector-6..11/99 tails across `
    + `${stages.length} bundles, each with `
    + `exactly one block, and a model to draw where it draws one`);
}

/**
 * The crawler's undamaged attack, as the exe holds it at `0x00566E70`: body
 * condition 4's entry 2, `{997, 1051, 26.0f, 40, 9, 1}`. Character type 0xC is
 * the only one the shipped data gives condition 4
 * (`web/tools/checks/split_unreachable.ts` holds that), so it is the only one
 * this asks about.
 */
const CRAWLER_TYPE = 0x0C;
const CRAWLER_CONDITION = 4;
const CRAWLER_INDEX = 2;
const CRAWLER_LUNGE = 1051;
/** `g_class30_leap_strike_arc_script` (`0x00593180`) as the bundle names it. */
const CRAWLER_ARC_SCRIPT = "leap_strike";

/**
 * What a crawler attacks with has to be **in** the bundle.
 *
 * `ZombieStateHoldAtRange` sends body condition 4 to `ZombieStateLeapStrike`
 * (`FUN_0045E330`) and never to `ZombieStateStrike` (`0x0045585E`), so a
 * `znkager` reads its drawn entry for the lunge (`+0x02`), the distance it
 * closes to (`+0x04`) and, through `ActorStrikeConnect` on landing, the
 * overlay kind and cancel mask -- and **not** the strike clip or the hit
 * frame, which is why the entry's hit frame of 40 on a 20-frame clip is not a
 * whiff. It then flies `g_class30_leap_strike_arc_script` (`L92`). What can go
 * wrong is the bundle -- the entry dropped, the lunge not baked, or the arc
 * script or its clips missing, any of which leaves the leap with nothing to
 * play. Asked of every exported stage that places a type-0xC class-0x30
 * actor; with no bundle this is a note.
 */
export function checkCrawlerLeap(t: PortTree, out: Findings): void {
  const stages = bundleStages(t);
  if (!stages.length) {
    out.note("the crawler's leap is unchecked (no bundle to look in)");
    return;
  }
  let seen = 0;
  for (const path of stages) {
    const chars = readJson(path).characters || {};
    const placed = new Set((chars.placements || [])
      .filter((p: Json) => p.class === 0x30).map((p: Json) => p.char_type));
    const ty = (chars.types || {})[String(CRAWLER_TYPE)];
    if (!placed.has(CRAWLER_TYPE) || ty === undefined || ty === null) continue;
    const where = `${basename(dirname(path))}/${basename(path)}`;
    const motions = ty.motions || {};
    const row = (ty.attacks || {})[String(CRAWLER_CONDITION)] || {};
    const entry = row[String(CRAWLER_INDEX)];
    if (entry === undefined || entry === null) {
      out.fail(`${where}: body condition ${CRAWLER_CONDITION} carries no attack `
        + `${CRAWLER_INDEX}, so an undamaged crawler's leap has no lunge, `
        + `no distance and no hit`);
      continue;
    }
    if (entry.lunge !== CRAWLER_LUNGE || !(String(CRAWLER_LUNGE) in motions)) {
      out.fail(`${where}: attack ${CRAWLER_INDEX}'s lunge is ${show(entry.lunge)}, `
        + `baked ${String(entry.lunge) in motions ? "True" : "False"} -- the crawler `
        + `would close on no clip`);
      continue;
    }
    const script = ((chars.combat || {}).arc_scripts || {})[CRAWLER_ARC_SCRIPT];
    if (!Array.isArray(script) || script.length !== 3) {
      out.fail(`${where}: no three-stage ${CRAWLER_ARC_SCRIPT} arc script, so the `
        + `leap flies with no clip`);
      continue;
    }
    const missing = script.map((st: Json) => st.motion)
      .filter((m: unknown) => !(String(m) in motions));
    if (missing.length) {
      out.fail(`${where}: the leap's clips [${missing.join(", ")}] are not baked `
        + `for character type 0xC`);
      continue;
    }
    seen++;
  }
  if (!seen) {
    out.fail("no exported stage places a crawler, so nothing was checked");
    return;
  }
  out.note(`the crawler's leap -- its entry, lunge and arc clips -- checks out `
    + `in ${seen} exported stages`);
}

/**
 * `docs/` cites the binary too. Only the two forms that assert *this name is
 * this address* are tested -- `` Name (`FUN_…`) `` and `` Name -- `FUN_…` ``
 * -- because an arrow between a name and an address is a call chain, not a
 * claim about identity. A disagreement fails: the doc and the TSV cannot both
 * be right about what lives at an address. An address the TSV does not name
 * at all is a work list rather than a failure -- a routine read far enough to
 * point at and not far enough to name.
 */
export function checkDocsCitations(t: PortTree, named: Map<string, string>,
                                   out: Findings): void {
  const seen = new Map<string, [string, string]>();
  const cited = new Set<string>();
  for (const path of filesUnder(t.docs, (n) => n.endsWith(".md"))) {
    const text = readText(path);
    const r = rel(t, path);
    for (const m of matches(ANY_FUN, text)) cited.add(m[1].slice(4).toLowerCase());
    for (const pat of [DEF, REF]) {
      for (const m of matches(pat, text)) {
        const name = m[1], addr = m[2].slice(4).toLowerCase();
        const real = named.get(addr);
        if (real !== undefined && real !== name) {
          out.fail(`${r}: cites \`${addr}\` as \`${name}\`; functions.tsv says \`${real}\``);
        }
        seen.set(addr, [name, r]);
      }
    }
  }
  const unknown = [...cited].filter((a) => !named.has(a)).sort();
  out.note(`docs: ${seen.size} name/address citations checked against functions.tsv`);
  if (unknown.length) {
    const shown = unknown.slice(0, 10).map((a) => `FUN_${a.toUpperCase()}`).join(", ");
    out.note(`  and ${unknown.length} addresses docs point at that Ghidra has `
      + `not named: ${shown}${unknown.length > 10 ? ", ..." : ""}`);
  }
}

/** Every check, in order, into `out`. Returns the ports found. */
export function runPort(t: PortTree, out: Findings): Ported {
  const named = annotations(t.funcs);
  const ported = checkNames(t, named, out);
  checkGlobals(t, annotations(t.globals), out);
  checkCoverage(named, ported, out);
  checkUncitedExports(t, out);
  checkMarkerCount(out);
  checkDivergences(t, out);
  checkClasses(t, out);
  checkSnapshotRules(t, out);
  checkFrameMath(t, out);
  checkClass31LiteralClips(t, out);
  checkClass33Selectors(t, out);
  checkCrawlerLeap(t, out);
  checkDocsCitations(t, named, out);
  return ported;
}

export function main(argv: string[]): number {
  const { root } = parseArgs(argv, "usage: port.ts [--root <dir>]");
  const t = portTree(root);
  if (!isDir(t.game)) {
    console.error(`no ${t.game}`);
    return 2;
  }
  const out = new Findings();
  const ported = runPort(t, out);
  for (const n of out.notes) console.log(n);
  console.log();
  if (out.failures.length) {
    for (const f of out.failures) console.log(`FAIL ${f}`);
    console.log(`\n${out.failures.length} failed`);
    return 1;
  }
  console.log(`${ported.size} ported functions check out against functions.tsv`);
  return 0;
}

if (/(^|[\\/])repo[\\/]port\.ts$/.test(process.argv[1] ?? "")) {
  process.exitCode = main(process.argv.slice(2));
}

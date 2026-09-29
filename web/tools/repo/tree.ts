/**
 * What the repository checks share: where the tree is, how its files are
 * listed and read, and the TypeScript compiler's view of a source file.
 *
 * Library only; `repo/port.ts`, `repo/layers.ts` and `status.ts` are the
 * commands.
 *
 * **The tree** is the repository root found by walking up from the working
 * directory (`repoRoot`), or the directory after `--root`, so a check can be
 * run against a copy of the tree with a mutation in it. The bundle a check
 * reads is `HOTD2_BUNDLE` when that is set and `<root>/extract/player`
 * otherwise.
 *
 * **Listing and reading** keep two properties every count here depends on.
 * Files are listed in path order compared one component at a time, so that
 * `a/b.ts` comes before `a-b.ts` and `a.ts`, and every list a check prints
 * has one order on every machine. Text is read with `\r\n` and `\r` folded to
 * `\n`, and split into lines on every line boundary Unicode names, so a line
 * number a check prints is the one an editor shows.
 *
 * **The compiler's view** is `ts.createSourceFile`, read once per file by
 * {@link scan}: every comment ({@link commentRanges}), the text with the
 * comments blanked out ({@link codeView}), and the syntax the rules are about
 * -- the modules a file names, its exported functions and classes, what it
 * declares and what it calls. The parser is the only lexer that knows a
 * regular expression from a division and JSX text from a string, so nothing
 * here re-implements one.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type * as TS from "typescript";

import { repoRoot } from "../lib/bundle_root";

/**
 * The compiler, required from the player's own `node_modules` when the
 * check runs rather than bundled into it: it is a CommonJS package that reads
 * `__filename` as it loads, which an ES module bundle does not have.
 */
export const ts: typeof TS = (() => {
  for (const from of [resolve(process.argv[1] ?? "."),
                      join(repoRoot(), "web", "package.json")]) {
    try {
      return createRequire(from)("typescript") as typeof TS;
    } catch {
      // the next place
    }
  }
  throw new Error("typescript is not installed: run `npm install` in web/");
})();

// ---------------------------------------------------------------------------
// The command line

/** A command's arguments: `--root <dir>`, the flags it takes, nothing else. */
export interface Args {
  root: string;
  flags: Set<string>;
}

/**
 * Parse `argv` for `--root <dir>` and the boolean `flags` a command accepts.
 * `--game-dir <dir>` is accepted and ignored, because the suite hands it to
 * every check. Anything else prints `usage` and exits 2.
 */
export function parseArgs(argv: string[], usage: string,
                          flags: readonly string[] = []): Args {
  let root = repoRoot();
  const got = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf("=");
    const key = a.startsWith("--") && eq > 0 ? a.slice(0, eq) : a;
    const inline = a.startsWith("--") && eq > 0 ? a.slice(eq + 1) : undefined;
    if (key === "--root" || key === "--game-dir") {
      const v = inline ?? argv[++i];
      if (v === undefined) die(usage, `${key} needs a value`);
      if (key === "--root") root = resolve(v);
    } else if (a === "-h" || a === "--help") {
      console.log(usage);
      process.exit(0);
    } else if (flags.includes(a)) {
      got.add(a);
    } else {
      die(usage, `unrecognised argument ${a}`);
    }
  }
  return { root, flags: got };
}

function die(usage: string, why: string): never {
  console.error(usage);
  console.error(`error: ${why}`);
  process.exit(2);
}

/** Where the exported bundle is for the tree at `root`. */
export function bundleDir(root: string): string {
  return process.env.HOTD2_BUNDLE ?? join(root, "extract", "player");
}

// ---------------------------------------------------------------------------
// Listing

/** Path components, for ordering. */
function parts(p: string): string[] {
  return p.split(sep);
}

/** Path order, one component at a time: `a/b.ts` < `a-b.ts` < `a.ts`. */
export function comparePaths(a: string, b: string): number {
  const pa = parts(a), pb = parts(b);
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return pa.length - pb.length;
}

/** Sort paths in place by {@link comparePaths}, and return them. */
export function sortPaths(paths: string[]): string[] {
  return paths.sort(comparePaths);
}

/**
 * Every file under `dir`, at any depth, whose name `keep` accepts, in path
 * order. A symbolic link to a file is a file; a symbolic link to a directory
 * is not descended into. A missing `dir` has no files.
 */
export function filesUnder(dir: string,
                           keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let ents;
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (keep(e.name) && (e.isFile() || (e.isSymbolicLink() && isFile(p)))) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return sortPaths(out);
}

/** The files directly in `dir` whose name `keep` accepts, in path order. */
export function filesIn(dir: string, keep: (name: string) => boolean): string[] {
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return sortPaths(ents
    .filter((e) => keep(e.name) && (e.isFile()
                                    || (e.isSymbolicLink() && isFile(join(dir, e.name)))))
    .map((e) => join(dir, e.name)));
}

/** The directories directly in `dir`, by name. */
export function dirsIn(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

export { basename, dirname, join, relative };

/** `.ts` or `.tsx`: a source file of the player. */
export const isSource = (name: string): boolean =>
  name.endsWith(".ts") || name.endsWith(".tsx");

// ---------------------------------------------------------------------------
// Reading

/** A text file, with `\r\n` and `\r` folded to `\n`. */
export function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
}

/** Every line boundary Unicode names, `\r\n` as one. */
const LINE_BREAK = new RegExp("\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85\\u2028\\u2029]");

/** The lines of `text`, a final line break ending the last line. */
export function splitLines(text: string): string[] {
  const out = text.split(LINE_BREAK);
  if (out[out.length - 1] === "") out.pop();
  return out;
}

/** Whitespace: every character Unicode calls a space or a separator. */
const WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a"
  + "\\u2028\\u2029\\u202f\\u205f\\u3000";
const WS_RUN = new RegExp(`[${WS}]+`);
const WS_EDGES = new RegExp(`^[${WS}]+|[${WS}]+$`, "g");

/** `s` without whitespace at either end. */
export const strip = (s: string): string => s.replace(WS_EDGES, "");
/** The words of `s`, split on runs of whitespace. */
export const words = (s: string): string[] =>
  s.split(WS_RUN).filter((w) => w !== "");
/** Length in characters, not UTF-16 units. */
export const charLength = (s: string): number => [...s].length;

/** The 1-based line of offset `at`. */
export function lineAt(text: string, at: number): number {
  let n = 1;
  for (let i = text.indexOf("\n"); i >= 0 && i < at; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

/** Every match of the global regex `re` in `text`. */
export function matches(re: RegExp, text: string): RegExpExecArray[] {
  if (!re.global) throw new Error(`${re} is not global`);
  re.lastIndex = 0;
  const out: RegExpExecArray[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push(m);
    if (m[0] === "") re.lastIndex++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The compiler's view

/**
 * `path` parsed as TypeScript, or as TSX for a `.tsx` file. Doc comments
 * are not parsed into nodes: every check reads them as comments.
 */
export function parse(path: string, text: string): TS.SourceFile {
  return ts.createSourceFile(
    path, text,
    { languageVersion: ts.ScriptTarget.Latest,
      jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    false, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

const isJSDocNode = (n: TS.Node): boolean =>
  n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode;

/** What {@link commentRanges} found. */
export interface Comments {
  /** Every comment, `//` and `/* *\/` alike, in source order. */
  ranges: TS.CommentRange[];
  /**
   * Whether the file ended back in code: no block comment, string or
   * template left open at the end of the file. A file that does not is one
   * no count from can be believed.
   */
  closed: boolean;
}

/**
 * Every comment in `sf`, found where the parser puts them: in the trivia in
 * front of each token. A `//` inside a string, a template, a regular
 * expression or JSX text is inside a token and is never read as one.
 */
export function commentRanges(sf: TS.SourceFile): Comments {
  const text = sf.text;
  const ranges: TS.CommentRange[] = [];
  const seen = new Set<number>();
  let closed = true;
  const visit = (node: TS.Node): void => {
    if (isJSDocNode(node)) return;           // read as trivia, below
    const kids = node.getChildren(sf);
    if (kids.length) {
      for (const k of kids) visit(k);
      return;
    }
    if ((node as TS.LiteralLikeNode).isUnterminated) closed = false;
    if (node.kind === ts.SyntaxKind.JsxText) return;   // text, not trivia
    // The trivia in front of a token is the previous token's trailing
    // comments, up to the first line break, and then this one's leading
    // comments; each call returns one of the two.
    for (const r of [...ts.getTrailingCommentRanges(text, node.pos) ?? [],
                     ...ts.getLeadingCommentRanges(text, node.pos) ?? []]) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      ranges.push(r);
      if (r.kind === ts.SyntaxKind.MultiLineCommentTrivia
          && (r.end - r.pos < 4 || !text.startsWith("*/", r.end - 2))) {
        closed = false;
      }
    }
  };
  visit(sf);
  ranges.sort((a, b) => a.pos - b.pos);
  return { ranges, closed };
}

/**
 * `text` with every comment taken out and the line breaks inside it kept,
 * so an offset's line in the result is its line in the file. Strings,
 * templates and regular expressions are code and stay.
 */
export function codeView(text: string, ranges: readonly TS.CommentRange[]): string {
  let out = "", at = 0;
  for (const r of ranges) {
    out += text.slice(at, r.pos);
    out += "\n".repeat(text.slice(r.pos, r.end).split("\n").length - 1);
    at = r.end;
  }
  return out + text.slice(at);
}

/** One module a file names. */
export interface ModuleRef {
  spec: string;
  line: number;
  /**
   * What a static `import` binds as a value -- the default, a namespace, or
   * a named import not marked `type` -- by its local name. Empty for an
   * `import type`, `export ... from`, `import()` or a side-effect import.
   */
  values: { local: string; namespace: boolean }[];
}

/** What the checks read from one source file, from one parse. */
export interface Source {
  path: string;
  text: string;
  /** Every comment, `//` and `/* *\/` alike, in source order. */
  comments: TS.CommentRange[];
  /**
   * Whether the file ended back in code: no block comment, string or
   * template left open at its end. A file that does not is one no count
   * from can be believed.
   */
  closed: boolean;
  /** The text with every comment blanked ({@link codeView}). */
  code: string;
  /**
   * Every module the file names: `import ... from`, `import "..."`,
   * `export ... from`, `import x = require(...)`, `import(...)` in code and
   * `import(...)` in a type -- type-only forms included, because a type is a
   * dependency on the module that declares it.
   */
  modules: ModuleRef[];
  /**
   * `export function` and `export async function` at the top level, each
   * overload signature on its own -- not `export default`, not `declare`.
   */
  exportedFunctions: { name: string; line: number }[];
  /** Every `function` declaration and `const` binding, at any depth. */
  declared: Set<string>;
  /** Lines of every top-level `export let` or `export var`. */
  exportedLets: number[];
  /** Every exported class with a member named `update`. */
  updateClasses: { name: string; line: number }[];
  /**
   * What the file calls, `new`s or tags a template with, by name: `f` for
   * `f(...)`, and `ns.f` for `ns.f(...)` on a plain identifier.
   */
  calls: Set<string>;
}

const cache = new Map<string, Source>();

/** `path`, read and parsed once per process. */
export function scan(path: string): Source {
  let s = cache.get(path);
  if (!s) {
    s = scanText(path, readText(path));
    cache.set(path, s);
  }
  return s;
}

const hasModifier = (n: TS.Node, kind: TS.SyntaxKind): boolean =>
  ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === kind);

/** {@link scan} for text that is not on disk; `path` picks TS or TSX. */
export function scanText(path: string, text: string): Source {
  const sf = parse(path, text);
  const { ranges, closed } = commentRanges(sf);
  const line = (n: TS.Node) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const src: Source = {
    path, text, comments: ranges, closed, code: codeView(text, ranges),
    modules: [], exportedFunctions: [], declared: new Set(), exportedLets: [],
    updateClasses: [], calls: new Set(),
  };

  for (const st of sf.statements) {
    const exported = hasModifier(st, ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(st) && st.name && exported
        && !hasModifier(st, ts.SyntaxKind.DefaultKeyword)
        && !hasModifier(st, ts.SyntaxKind.DeclareKeyword)) {
      src.exportedFunctions.push({ name: st.name.text, line: line(st) });
    } else if (ts.isVariableStatement(st) && exported
               && !(st.declarationList.flags & ts.NodeFlags.Const)) {
      src.exportedLets.push(line(st));
    } else if (ts.isClassDeclaration(st) && st.name && exported
               && st.members.some((m) => m.name !== undefined
                                   && ts.isIdentifier(m.name)
                                   && m.name.text === "update")) {
      src.updateClasses.push({ name: st.name.text, line: line(st) });
    }
  }

  const module = (lit: TS.Node | undefined, values: ModuleRef["values"] = []) => {
    if (lit && ts.isStringLiteralLike(lit)) {
      src.modules.push({ spec: lit.text, line: line(lit), values });
    }
  };
  const callee = (e: TS.Expression) => {
    while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) {
      e = e.expression;
    }
    if (ts.isIdentifier(e)) src.calls.add(e.text);
    else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      src.calls.add(`${e.expression.text}.${e.name.text}`);
    }
  };
  const visit = (n: TS.Node): void => {
    if (ts.isImportDeclaration(n)) {
      const c = n.importClause;
      const values: ModuleRef["values"] = [];
      if (c && !c.isTypeOnly) {
        if (c.name) values.push({ local: c.name.text, namespace: false });
        const b = c.namedBindings;
        if (b && ts.isNamespaceImport(b)) {
          values.push({ local: b.name.text, namespace: true });
        } else if (b) {
          for (const e of b.elements) {
            if (!e.isTypeOnly) values.push({ local: e.name.text, namespace: false });
          }
        }
      }
      module(n.moduleSpecifier, values);
    } else if (ts.isExportDeclaration(n)) {
      module(n.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(n)
               && ts.isExternalModuleReference(n.moduleReference)) {
      module(n.moduleReference.expression);
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) {
      module(n.argument.literal);
    } else if (ts.isCallExpression(n)
               && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      module(n.arguments[0]);
    } else if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      callee(n.expression);
    } else if (ts.isTaggedTemplateExpression(n)) {
      callee(n.tag);
    } else if (ts.isFunctionDeclaration(n) && n.name) {
      src.declared.add(n.name.text);
    } else if (ts.isVariableDeclarationList(n)
               && (n.flags & ts.NodeFlags.Const)) {
      for (const d of n.declarations) {
        if (ts.isIdentifier(d.name)) src.declared.add(d.name.text);
      }
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return src;
}

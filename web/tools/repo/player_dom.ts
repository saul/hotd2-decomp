/**
 * Every id the player styles or looks up is one something renders.
 *
 *     cd web && node tools/run_ts.mjs tools/repo/player_dom.ts [--list]
 *
 * `document.querySelector("#thing") as HTMLElement` is a lie the type system
 * cannot catch: a missing element is `null`, the cast hides it, and the first
 * `addEventListener` throws at startup with a clean `tsc` and a clean
 * `vite build` behind it. And a CSS rule whose id nothing renders is silent:
 * `#frame-label`'s `min-width` is what stops the frame slider reflowing on
 * every frame of playback, `#skip-go:disabled` is what makes a skip you cannot
 * take look different from one you can, and nothing in the build says when
 * such a rule stops matching.
 *
 * So it asks two questions, both of them errors that must be zero:
 *
 * * **styled-ids-are-rendered** -- every `#id` selector in `web/src/style.css`
 *   is produced by something in `web/`.
 * * **looked-up-ids-are-rendered** -- every id the code looks up is produced
 *   by something.
 *
 * "Produced by something" means a literal `id="foo"` in `web/index.html` or in
 * any `.tsx` under `web/src`, or an imperative `el.id = "foo"` in any `.ts`
 * there. An id built from an expression -- `<details id={id}>` in `Panel.tsx`
 * -- is resolved at its call sites, which write the literal. `--list` prints
 * every violation rather than the first eight of each rule.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { repoRoot } from "../lib/bundle_root";

const ROOT = repoRoot();
const SRC = join(ROOT, "web", "src");
const HTML = join(ROOT, "web", "index.html");
const CSS = join(SRC, "style.css");

/** A word character: a Unicode letter or digit, or `_`. */
const W = "[\\p{L}\\p{N}_]";
/** An id: a letter, then letters, digits, `_` and `-`. */
const ID = `[A-Za-z](?:-|${W})*`;

/**
 * Only real lookups: `$("#feed")`, `$<HTMLInputElement>("#shoot")`,
 * `document.querySelector("#view")`, `getElementById("app")`. Matching any
 * `"#..."` string instead would sweep up CSS colours -- and `"#feed"` is four
 * hex digits, so excluding colours by shape would quietly drop a real one.
 * The type parameter is optional on both forms: `querySelector<T>("#id")` is
 * how every lookup in `ui/` is written.
 */
const SELECTOR = new RegExp(
  `(?:\\$|querySelector(?:All)?)(?:<[^>()]*>)?\\s*\\(\\s*["']#(${ID})["']`
  + `|getElementById\\s*\\(\\s*["'](${ID})["']`, "gu");
/** Selectors built at runtime are out of scope; they are flagged, not resolved. */
const DYNAMIC = /querySelector(?:All)?\s*\(\s*`[^`]*\$\{/;

const ATTR_ID = new RegExp(`(?<!${W})id="(${ID})"`, "gu");
/** `el.id = "crosshair"` -- the imperative way to put an id on the page. */
const PROP_ID = new RegExp(`\\.id\\s*=\\s*["'](${ID})["']`, "gu");
/** An id in a selector, which is the only place in CSS an id can appear. */
const CSS_ID = new RegExp(`#(${ID})`, "gu");

/** A file's text, with `\r\n` and a lone `\r` read as `\n`. */
function read(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
}

/**
 * Comments out, the way `tools/repo/layers.ts` does it and for the same
 * reason. A doc comment *describing* a lookup -- one naming a selector the
 * code deliberately no longer reads -- is neither a lookup nor a definition,
 * and counting one would make such a comment unwritable. Whole-line `//`
 * only, so a `https://` inside a string survives.
 */
function stripTsComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The ids the stylesheet selects on, and nothing that merely looks like one.
 *
 * `#a33`, `#d7dee6`, `#ff8c1a` and more hex colours live in this sheet, and a
 * bare `#[A-Za-z][-\w]*` sweep reports every one of them as an id. A colour
 * only ever appears inside a declaration block, so: drop the comments, cut the
 * sheet at each `}`, and inside each chunk read ids from everything but the
 * run after its last `{`, which is the declarations. Everything before is a
 * selector list or an at-rule prelude -- taking only the text before the
 * *first* `{` would lose `#skipbar` and `#branchbar`, which this sheet also
 * selects from inside a `@media (prefers-reduced-motion)`.
 */
function cssSelectorIds(sheet: string): Set<string> {
  const ids = new Set<string>();
  for (const chunk of sheet.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    for (const part of chunk.split("{").slice(0, -1)) {
      for (const m of part.matchAll(CSS_ID)) ids.add(m[1]!);
    }
  }
  return ids;
}

/** Every `.ts` and `.tsx` under `dir`, recursively, not following links. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) out.push(p);
  }
  return out;
}

class Rule {
  hits: string[] = [];
  constructor(readonly name: string, readonly why: string,
              readonly severity: string, readonly baseline = 0) {}
}

const sorted = (xs: Iterable<string>): string[] =>
  [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

function main(argv: readonly string[]): number {
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--list") list = true;
    // Accepted and unused: the suite may pass it to every check alike.
    else if (a === "--game-dir") i++;
    else if (!a.startsWith("--game-dir=")) {
      console.error(`usage: player_dom.ts [--list]\nunrecognized arguments: ${a}`);
      return 2;
    }
  }

  for (const needed of [HTML, CSS]) {
    if (!existsSync(needed) || !statSync(needed).isFile()) {
      console.error(`no ${needed}`);
      return 2;
    }
  }

  // -- what the page produces ------------------------------------------
  const rendered = new Map<string, string[]>();
  const produce = (name: string, where: string): void => {
    rendered.set(name, [...(rendered.get(name) ?? []), where]);
  };

  // `index.html` is a mount point, but `#app` lives here and it is the one id
  // `app/ui_root.ts` cannot do without.
  const markup = read(HTML).replace(/<!--[\s\S]*?-->/g, "");
  for (const m of markup.matchAll(ATTR_ID)) produce(m[1]!, "web/index.html");

  // All of `web/src`, not just `ui/`: the renderer and the HUD put ids on
  // elements they create too, and an id is an id wherever it is written.
  const wanted = new Map<string, string[]>();
  const dynamic: string[] = [];
  for (const path of sources(SRC)) {
    const rel = relative(ROOT, path).split("\\").join("/");
    const code = stripTsComments(read(path));
    for (const m of code.matchAll(ATTR_ID)) produce(m[1]!, rel);
    for (const m of code.matchAll(PROP_ID)) produce(m[1]!, rel);
    for (const m of code.matchAll(SELECTOR)) {
      const name = m[1] ?? m[2]!;
      wanted.set(name, [...(wanted.get(name) ?? []), rel]);
    }
    if (DYNAMIC.test(code)) dynamic.push(rel);
  }

  const styled = cssSelectorIds(read(CSS));

  const rules = {
    styled: new Rule(
      "styled-ids-are-rendered",
      "a rule whose id nothing renders is a rule that does nothing, and "
      + "CSS never says so -- this is how the frame slider loses the "
      + "`min-width` that stops it reflowing on every frame",
      "error"),
    lookedUp: new Rule(
      "looked-up-ids-are-rendered",
      "a lookup that finds nothing is `null` behind a cast, and it "
      + "throws at startup with a clean tsc behind it",
      "error"),
  };

  for (const name of sorted(styled)) {
    if (!rendered.has(name)) {
      rules.styled.hits.push(`web/src/style.css: #${name} is styled but nothing renders it`);
    }
  }
  for (const name of sorted(wanted.keys())) {
    if (!rendered.has(name)) {
      rules.lookedUp.hits.push(`#${name} is looked up in ${sorted(new Set(wanted.get(name))).join(", ")} `
                               + "but nothing renders it");
    }
  }

  console.log("browser player -- the ids the page styles and looks up\n");
  console.log(`  ${styled.size} ids styled, ${wanted.size} looked up, ${rendered.size} rendered\n`);
  console.log(`  ${"rule".padEnd(28)}${"sev".padEnd(9)}${"count".padStart(6)}`
              + `${"baseline".padStart(10)}   status`);
  const failed: Rule[] = [];
  for (const r of Object.values(rules)) {
    const n = r.hits.length;
    const ok = n <= r.baseline;
    if (!ok) failed.push(r);
    console.log(`  ${r.name.padEnd(28)}${r.severity.padEnd(9)}${String(n).padStart(6)}`
                + `${String(r.baseline).padStart(10)}   ${ok ? "ok" : "FAIL"}`);
  }

  if (dynamic.length) {
    console.log(`\n  built at runtime, not checked: ${sorted(new Set(dynamic)).join(", ")}`);
  }

  for (const r of Object.values(rules)) {
    if (!r.hits.length) continue;
    console.log(`\n${r.name} -- ${r.why}`);
    for (const h of list ? r.hits : r.hits.slice(0, 8)) console.log(`    ${h}`);
    if (!list && r.hits.length > 8) console.log(`    ... ${r.hits.length - 8} more (--list)`);
  }

  console.log();
  if (failed.length) {
    console.log(`${failed.length} rule(s) failed:`);
    for (const r of failed) console.log(`  ${r.name}: must be zero.`);
    return 1;
  }
  console.log("clean: every id the sheet styles and the code looks up is rendered");
  return 0;
}

process.exitCode = main(process.argv.slice(2));

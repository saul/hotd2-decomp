/**
 * Every number this repository states about itself, measured from the tree.
 *
 *     node tools/run_ts.mjs tools/status.ts [--root <dir>]
 *
 * Prints a Markdown report to stdout and writes nothing. A number written
 * into prose is a second source for a fact a checker already computes, and
 * the second source rots (`L16`), so no document quotes a countable fact:
 * this measures them on every run. What stays in prose is judgement -- what
 * a directory is for lives in `docs/PLAYER.md`, and what only each check can
 * see is printed by `npm run verify -- --list`.
 *
 * The measurements are the checkers' own, imported rather than restated:
 * coverage, citations, classes, markers and the uncited-export ratchet from
 * `repo/port.ts`, and the directory-to-layer table and the rules from
 * `repo/layers.ts`.
 */
import { buildRules, LAYER_OF } from "./repo/layers";
import {
  annotations, checkNames, classCounts, coverageCounts, DIVERGES_TAG,
  Findings, markerCounts, OPEN_TAG, portTree, UNCITED_BASELINE, uncitedExports,
} from "./repo/port";
import {
  filesUnder, isDir, isSource, join, parse, parseArgs, readText, relative,
  splitLines, ts,
} from "./repo/tree";

/** `[directory, lines, files, layer]` for each layer directory, longest first. */
function treeRows(src: string): [string, number, number, string][] {
  const rows: [string, number, number, string][] = [];
  for (const [name, layer] of Object.entries(LAYER_OF)) {
    const d = join(src, name);
    if (!isDir(d)) continue;
    const files = filesUnder(d, isSource);
    const lines = files.reduce((n, p) => n + splitLines(readText(p)).length, 0);
    rows.push([name, lines, files.length, layer]);
  }
  return rows.sort((a, b) => b[1] - a[1]);
}

/** The `n` longest source files, as paths under `web/src/`. */
function largest(src: string, n: number): [string, number][] {
  return filesUnder(src, isSource)
    .map((p): [string, number] => [relative(src, p), splitLines(readText(p)).length])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

/**
 * How many members an `export interface` declares. `PlayerCommands` against
 * `PlayerView` is the player's standing measurement of how much of itself a
 * click can reach.
 */
function interfaceMembers(path: string, name: string): number {
  const sf = parse(path, readText(path));
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st) && st.name.text === name
        && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      return st.members.length;
    }
  }
  return 0;
}

/** Rows of an annotation TSV that are not blank or a `#` comment. */
function tsvRows(path: string): number {
  return splitLines(readText(path)).filter((l) => l && !l.startsWith("#")).length;
}

const sum = (m: Map<string, number>, names?: string[]): number =>
  (names ?? [...m.keys()]).reduce((n, k) => n + (m.get(k) ?? 0), 0);

/** The report, as Markdown. */
export function render(root: string): string {
  const t = portTree(root);
  const src = t.src;
  const named = annotations(t.funcs);
  const ported = checkNames(t, named, new Findings());
  const [nIn, nRange, nOut] = coverageCounts(named, ported);
  const [nCls, nKnown, covPl, allPl] = classCounts(t);
  const rules = buildRules();
  const ratchets = [...rules.values()].filter((r) => r.severity === "ratchet");
  const rows = treeRows(src);
  const uncited = uncitedExports(t).length;

  const L: string[] = [];
  const add = (s = "") => { L.push(s); };

  add("# Status");
  add();
  add("Every countable fact this repository states about itself, measured from");
  add("the tree each time this runs. Nothing else quotes these numbers: a");
  add("number written twice is a number that will disagree with itself.");
  add();
  add("What is *not* here is anything that is a judgement rather than a");
  add("measurement. What each directory is for is in");
  add("[`PLAYER.md`](docs/PLAYER.md).");
  add();

  add("## The browser player, by directory");
  add();
  add("| Directory | Lines | Files | Layer |");
  add("|---|---:|---:|---|");
  for (const [name, lines, files, layer] of rows) {
    add(`| \`${name}/\` | ${lines} | ${files} | ${layer} |`);
  }
  const totalLines = rows.reduce((n, r) => n + r[1], 0);
  const totalFiles = rows.reduce((n, r) => n + r[2], 0);
  add(`| **total** | **${totalLines}** | **${totalFiles}** | |`);
  add();
  add("The largest files, which is where the pressure to split next is:");
  add();
  for (const [rel, n] of largest(src, 5)) add(`* \`${rel}\` — ${n}`);
  add();

  add("## The port");
  add();
  add("| | |");
  add("|---|---|");
  add(`| Gameplay coverage | **${nIn} of ${nRange}** annotated functions in the `
    + `gameplay address ranges have a port `
    + `(${Math.floor(100 * nIn / Math.max(1, nRange))}%) |`);
  add(`| Ported outside those ranges | ${nOut} (opcodes, and the classes whose `
    + `handlers sit elsewhere) |`);
  add(`| Citations checked | ${ported.size} ported functions match `
    + "`functions.tsv` under the same name |");
  add(`| Spawn classes | **${nCls} of ${nKnown}** read classes have a module, `
    + `covering ${covPl} of ${allPl} placements |`);
  const div = markerCounts(t, DIVERGES_TAG);
  const opn = markerCounts(t, OPEN_TAG);
  add(`| Declared \`[diverges]\` | **${sum(div)}** — where the port knowingly `
    + "departs from the exe, each with its reason on the spot |");
  add(`| \`[open]\` markers | **${sum(opn)}** — questions the port and the `
    + "exporter are honest about not having answered |");
  add();
  add("Both markers are counted in **every** `.ts`/`.tsx` file under `web/src/`, "
    + "one per occurrence, and only in comments — a word in code or in a string "
    + "is not a marker (`markerLines` in `web/tools/repo/port.ts`). Each "
    + "departure and each question is written once, where it is made; "
    + "everything that refers to it names it in words "
    + "([`PLAYER.md`](docs/PLAYER.md#one-departure-one-tag), \"One departure, "
    + "one tag\"). By layer, from the same table as the directories above:");
  add();
  add("| Layer | Directories | `[diverges]` | `[open]` |");
  add("|---|---|---:|---:|");
  const layers = new Map<string, string[]>();
  for (const [name, layer] of Object.entries(LAYER_OF)) {
    if (!isDir(join(src, name))) continue;
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer)!.push(name);
  }
  for (const [layer, names] of layers) {
    add(`| ${layer} | ${names.map((n) => `\`${n}/\``).join(", ")} | `
      + `${sum(div, names)} | ${sum(opn, names)} |`);
  }
  // A marker in a directory `LAYER_OF` has not heard of is still counted in
  // the totals above; it gets a row of its own rather than vanishing here.
  const stray = [...new Set([...div.keys(), ...opn.keys()])]
    .filter((k) => !(k in LAYER_OF)).sort();
  for (const n of stray) {
    add(`| (no layer) | \`${n}\` | ${div.get(n) ?? 0} | ${opn.get(n) ?? 0} |`);
  }
  add();
  const nCmd = interfaceMembers(join(src, "app", "commands.ts"), "PlayerCommands");
  const nView = interfaceMembers(join(src, "app", "projection", "player.ts"),
                                 "PlayerView");
  add("The two declared seams between the UI and the player: "
    + `**\`PlayerCommands\` has ${nCmd} members against \`PlayerView\`'s `
    + `${nView}** — how much of the player a click can move, against how much `
    + "of it the page can see. Neither can grow without a line appearing in "
    + "the open.");
  add();

  add("## The decomp");
  add();
  add("| | |");
  add("|---|---|");
  add(`| Named functions | ${tsvRows(t.funcs)} in \`ghidra/annotations/functions.tsv\` |`);
  add(`| Named globals | ${tsvRows(t.globals)} in \`ghidra/annotations/globals.tsv\` |`);
  add();

  add("## Ratchets");
  add();
  add("A ratchet is a violation the architecture has not reached yet: a count");
  add("that may fall and may never rise. **Raising one is a decision for the");
  add("repository's owner, not a line edit in a checker**, and there is");
  add("deliberately no suppression comment.");
  add();
  add("| Ratchet | Where | Now | Baseline |");
  add("|---|---|---:|---:|");
  add(`| \`uncited-exports\` | \`web/tools/repo/port.ts\` | ${uncited} | `
    + `${UNCITED_BASELINE} |`);
  for (const r of ratchets) {
    add(`| \`${r.name}\` | \`web/tools/repo/layers.ts\` | ${r.hits.length} | `
      + `${r.baseline} |`);
  }
  add();
  if (!ratchets.length) {
    add(`All ${rules.size} rules in \`web/tools/repo/layers.ts\` are \`error\` at zero;`);
    add("a new violation of any of them fails the build rather than moving");
    add("a number. `uncited-exports` above is the only ratchet in the repo:");
    add("every exported function in `game/` should cite the exe function it");
    add("ports or declare itself `[port-only]`.");
    add();
  }

  add("## The checks");
  add();
  add("`npm run verify -- --list` prints them, with what only each one can see");
  add("and whether it needs the installed game or an exported bundle.");
  return L.join("\n") + "\n";
}

const { root } = parseArgs(process.argv.slice(2), "usage: status.ts [--root <dir>]");
process.stdout.write(render(root));

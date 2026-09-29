/**
 * `ghidra/annotations/*.tsv` against the real executable.
 *
 *     node tools/run_ts.mjs tools/checks/annotations.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * The annotations are the committed source of truth for the Ghidra database,
 * so a typo in an address is a silent corruption: `ApplyAnnotations` would
 * happily name the wrong thing. This checks every row against the exe's own
 * section table -- the one `ExeTables.v2r` resolves through, read out of the
 * PE headers -- before anyone runs it.
 *
 * What is asserted, per file:
 *
 * * the file parses as TSV with at least an address and a name per row;
 * * every address resolves to a real section of `Hod2.exe`;
 * * function addresses land in `.text`. Globals land in a data section except
 *   inline jump tables and class state tables, which MSVC emits inside the
 *   function body, so a global in `.text` is listed rather than rejected;
 * * no address is listed twice, and no name is used twice;
 *
 * and across the two: **no address is in both files.** The `.text` rule
 * cannot catch a function wrongly filed as a global, because some globals
 * legitimately live in `.text`, so a misfiled function slips straight through
 * it. Being in both files is never legitimate, so this is the rule that bites.
 * It matters beyond tidiness: `verify_port` checks a global citation against
 * `globals.tsv` and a function citation against `functions.tsv`, so a name in
 * both makes a wrong citation pass.
 *
 * What only this check can see: an annotation row whose address no section of
 * the exe holds, or that sits in the wrong file.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Checker, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { repoRoot } from "../lib/bundle_root";
import { IMAGE_BASE } from "../../src/hod2lib/exetab";

const ANNOT = join(repoRoot(), "ghidra", "annotations");

interface Row {
  line: number;
  va: number | null;
  name: string | null;
  err: string | null;
}

/** Every row that is not blank or a `#` comment. */
function rows(text: string): Row[] {
  const out: Row[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim() || raw.trimStart().startsWith("#")) return;
    const parts = raw.split("\t").map((s) => s.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      out.push({ line, va: null, name: null, err: "malformed row" });
    } else if (!/^(0x)?[0-9a-f]+$/i.test(parts[0])) {
      out.push({ line, va: null, name: parts[1],
                 err: `bad address ${JSON.stringify(parts[0])}` });
    } else {
      out.push({ line, va: Number.parseInt(parts[0].replace(/^0x/i, ""), 16),
                 name: parts[1], err: null });
    }
  });
  return out;
}

const c = new Checker("annotations");
const { exe } = await openGame(gameDirOrSkip("annotations"));

// The section map straight out of the PE headers, so the check is against the
// binary rather than against another copy of an assumption. It is the map
// `v2r` uses; a section spans the larger of its virtual and raw sizes.
const sections = exe["sections"].map((s) => ({
  name: s.name, lo: IMAGE_BASE + s.va, hi: IMAGE_BASE + s.va + Math.max(s.vs, s.rs),
}));
c.ok(sections.some((s) => s.name === ".text"),
     `${sections.length} sections in Hod2.exe, one of them .text`);
for (const s of sections) {
  c.note(`${s.name.padEnd(10)} ${hex(s.lo, 8)}..${hex(s.hi, 8)}`);
}

const byFile = new Map<string, Map<number, string>>();
for (const [file, wantText] of [["functions.tsv", true], ["globals.tsv", false]] as const) {
  const path = join(ANNOT, file);
  if (!existsSync(path)) {
    c.fail(`${file}: missing from ${ANNOT}`);
    continue;
  }
  const bad = { parse: [] as string[], section: [] as string[], text: [] as string[],
                addr: [] as string[], name: [] as string[] };
  const seenVa = new Map<number, string>();
  const seenName = new Map<string, number>();
  const inText: string[] = [];
  let count = 0;
  for (const { line, va, name, err } of rows(readFileSync(path, "utf8"))) {
    if (err !== null || va === null || name === null) {
      bad.parse.push(`${file}:${line}: ${err}`);
      continue;
    }
    count++;
    const hit = sections.find((s) => s.lo <= va && va < s.hi);
    if (hit === undefined) {
      bad.section.push(`${file}:${line}: ${name} at ${hex(va, 8)} is in no section`);
      continue;
    }
    // .text is the only executable section in this build.
    if (hit.name === ".text") {
      if (!wantText) inText.push(`${name} at ${hex(va, 8)}`);
    } else if (wantText) {
      bad.text.push(`${file}:${line}: ${name} at ${hex(va, 8)} is in `
                    + `${hit.name}, not .text`);
    }
    const prevName = seenVa.get(va);
    if (prevName !== undefined) {
      bad.addr.push(`${file}:${line}: ${hex(va, 8)} already used by ${prevName}`);
    }
    seenVa.set(va, name);
    const prevVa = seenName.get(name);
    if (prevVa !== undefined) {
      bad.name.push(`${file}:${line}: name ${name} already used at ${hex(prevVa, 8)}`);
    }
    seenName.set(name, va);
  }
  byFile.set(file, seenVa);

  /** One assertion when the rule held, one failure per row when it did not. */
  const rule = (problems: string[], held: string): void => {
    if (!problems.length) c.ok(true, held);
    for (const p of problems) c.fail(p);
  };
  rule(bad.parse, `${file}: all ${count} rows parse as <address>\\t<name>`);
  rule(bad.section, `${file}: every address lies in a section of Hod2.exe`);
  if (wantText) rule(bad.text, `${file}: every function address is in .text`);
  rule(bad.addr, `${file}: ${seenVa.size} distinct addresses, none listed twice`);
  rule(bad.name, `${file}: no name used twice`);
  if (inText.length) {
    c.note(`${file}: ${inText.length} inline tables inside .text (MSVC emits `
           + "them in the function body):");
    for (const t of inText) c.note(`  ${t}`);
  }
}

const funcs = byFile.get("functions.tsv") ?? new Map<number, string>();
const globals = byFile.get("globals.tsv") ?? new Map<number, string>();
const both = [...funcs.keys()].filter((va) => globals.has(va)).sort((a, b) => a - b);
if (!both.length) {
  c.ok(true, `no address is in both files (${funcs.size} functions, `
       + `${globals.size} globals)`);
}
for (const va of both) {
  c.fail(`${hex(va, 8)} is in functions.tsv as ${funcs.get(va)} and in `
         + `globals.tsv as ${globals.get(va)} -- an address belongs to exactly `
         + "one of the two, and verify_port checks citations against the file "
         + "the kind implies");
}
c.finish();

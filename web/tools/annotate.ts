/**
 * Upsert a row into `ghidra/annotations/{functions,globals}.tsv`.
 *
 *     cd web && npm run annotate -- functions 004090b0 RankEnemiesByDistance "..."
 *     cd web && npm run annotate -- functions 004090b0 NewName "..." --rename
 *
 * Appending blind puts a duplicate address in the file whenever the address
 * is already named and nobody looked; `tools/checks/annotations.ts` catches it
 * afterwards, and this stops it happening. The rules are the decomp skill's:
 *
 * * an address already present keeps its **name** unless `--rename` is given,
 *   because the port cites that name and a silent rename breaks it;
 * * the comment is replaced, because that is what improves as more is read;
 * * **a new row is inserted in address order**, never appended. Two
 *   workstreams appending at the tail conflict on every merge -- unrelated
 *   rows, same last line -- and sorted insertion puts their rows in different
 *   parts of the file. `ExportAnnotations.java` holds the same invariant from
 *   the other end;
 * * a name or comment holding a newline, carriage return or tab is refused:
 *   one row is one line of three tab-separated fields, and a pasted comment
 *   with a newline in it splits into rows whose first field is prose, which
 *   breaks `tools/checks/annotations.ts`, the exporter and the ordered insert
 *   at once while the write itself looks fine.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "./lib/bundle_root";

const USAGE = "usage: annotate.ts [-h] [--rename] {functions,globals} address name [comment]";

function usageError(msg: string): never {
  console.error(`${USAGE}\nannotate.ts: error: ${msg}`);
  process.exit(2);
}

/** An option rather than a value: a dash-led word, no space in it, not a negative number. */
function isOption(a: string): boolean {
  return a.startsWith("-") && a !== "-" && !a.includes(" ") && !/^-\d+$|^-\d*\.\d+$/.test(a);
}

/** A hex number -- a sign, `0x` and `_` separators allowed -- or a failure. */
function hexValue(s: string, line: string): number {
  const t = s.trim();
  if (!/^[+-]?(?:0[xX]_?)?[0-9a-fA-F]+(?:_[0-9a-fA-F]+)*$/.test(t)) {
    throw new Error(`invalid literal for int() with base 16: ${JSON.stringify(t)} in ${JSON.stringify(line)}`);
  }
  const v = Number.parseInt(t.replace(/^[+-]/, "").replace(/^0[xX]/, "").replace(/_/g, ""), 16);
  return t.startsWith("-") ? -v : v;
}

function main(argv: readonly string[]): number {
  let rename = false;
  const pos: string[] = [];
  let rest = false;
  for (const a of argv) {
    if (rest || !isOption(a)) pos.push(a);
    else if (a === "--") rest = true;
    else if (a === "--rename") rename = true;
    else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      return 0;
    } else usageError(`unrecognized arguments: ${a}`);
  }
  if (pos.length < 3) {
    usageError(`the following arguments are required: ${["table", "address", "name"].slice(pos.length).join(", ")}`);
  }
  if (pos.length > 4) usageError(`unrecognized arguments: ${pos.slice(4).join(" ")}`);
  const [table, address, name] = pos as [string, string, string];
  const comment = pos[3] ?? "";
  if (table !== "functions" && table !== "globals") {
    usageError(`argument table: invalid choice: '${table}' (choose from 'functions', 'globals')`);
  }

  for (const [field, text] of [["name", name], ["comment", comment]] as const) {
    const bad = [["\n", "'\\n'"], ["\r", "'\\r'"], ["\t", "'\\t'"]]
      .filter(([c]) => text.includes(c!)).map(([, r]) => r);
    if (bad.length) {
      console.error(`${field} contains ${bad.join(" and ")}; a TSV row is one line -- `
                    + "write it as running prose");
      return 1;
    }
  }

  const path = join(repoRoot(), "ghidra", "annotations", `${table}.tsv`);
  const addr = address.toLowerCase().replace(/^[0x]+/, "").padStart(8, "0");
  const lines = readFileSync(path, "utf8").replace(/\r\n?/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts[0]!.toLowerCase() !== addr) continue;
    if (parts[1] !== name && !rename) {
      console.error(`0x${addr.toUpperCase()} is already \`${parts[1]}\`; pass --rename to `
                    + "change it, and update every citation if you do");
      return 1;
    }
    lines[i] = [parts[0], name, comment].join("\t");
    writeFileSync(path, lines.join("\n"), "utf8");
    console.log(`updated 0x${addr.toUpperCase()} \`${name}\``);
    return 0;
  }

  // New: insert in address order. The header block and its blank line stay
  // where they are; the row goes before the first data row with a higher
  // address, or at the end when there is none.
  const row = [addr, name, comment].join("\t");
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const here = hexValue(addr, addr);
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line || line.startsWith("#")) continue;
    if (hexValue(line.split("\t")[0]!, line) > here) {
      at = i;
      break;
    }
  }
  if (at < 0) lines.push(row);
  else lines.splice(at, 0, row);
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  console.log(`added 0x${addr.toUpperCase()} \`${name}\``);
  return 0;
}

process.exitCode = main(process.argv.slice(2));

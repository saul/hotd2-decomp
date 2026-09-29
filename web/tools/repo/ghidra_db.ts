/**
 * The Ghidra database says what `ghidra/annotations/` says, and no call is cut.
 *
 *     node tools/run_ts.mjs tools/repo/ghidra_db.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * Every other check reads the exe. This one reads the **database** every
 * session decompiles from -- the one the MCP bridge serves -- because that is
 * where the decompiler's model of the program lives, and a wrong model produces
 * pseudocode that reads cleanly and is missing code (L89).
 *
 * It copies the saved project (the GUI's lock stays on the original, so this
 * runs with Ghidra open and reads what was last saved), then runs
 * `ApplyAnnotations` and `RepairFlowDamage` over the copy **in report mode**,
 * and `ExportAnnotations` into a copy of `ghidra/annotations/`, and asserts:
 *
 * * no `CALL` to a function that returns carries a `CALL_RETURN` flow
 *   override, and no such call falls into undisassembled bytes -- a
 *   `CALL_RETURN` prints as a clean `return;` and cuts the body short;
 * * the "Non-Returning Functions - Discovered" analyzer is off in the
 *   program's own options, since the GUI's incremental analysis is what sets
 *   those overrides;
 * * every function flagged no-return is declared `noreturn` in
 *   `prototypes.tsv`, and every flag and prototype the file declares is what
 *   the database has. A prototype set by hand that differs from its row is
 *   reported separately, because the fix is `export-annotations`, not `apply`;
 * * the program was imported from the `Hod2.exe` in `--game-dir`;
 * * **no export would put back a name the file has renamed away from**: a
 *   function or global whose database name is one this tree's history gave
 *   the address before its current row. The database wins on names in an
 *   export, so that rename is reverted by the next `export-annotations` (L90);
 * * every row of `functions.tsv` and `globals.tsv` applies.
 *
 * Names and comments that differ **without** that are counted and printed, and
 * do not fail. Either the files are ahead (a row committed with
 * `npm run annotate` that `apply-annotations` has not written yet, which needs
 * the GUI closed) or the database is (a rename or a comment made over MCP that
 * nobody has exported -- a peer's work in progress, or a branch that never
 * landed). Neither is wrong, and failing on them would hold every session's
 * check red for someone else's work. A database comment that differs from a
 * non-empty file comment is listed as a conflict: the next apply replaces it
 * with the file's, and the export keeps the file's too, so prose that exists
 * only in the database has to be carried over by hand.
 *
 * What only this check can see: a database that disagrees with the committed
 * annotations, a rename an export would silently undo, and a call the
 * decompiler has been told never comes back.
 *
 * Exit 0 when it asserted all of that, 1 when any of it is wrong, and 3 when it
 * could assert nothing -- no Ghidra, no project, or no game.
 * `HOTD2_PROJECT_DIR` and `GHIDRA_HOME` override where the project and Ghidra
 * are looked for.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { argValue } from "../lib/exe_check";
import { repoRoot } from "../lib/bundle_root";

const ROOT = argValue("root") ?? repoRoot();
const PROJECT_NAME = "HOTD2";
const PROGRAM = "Hod2.exe";

const FIX_REPAIR = "HOTD2_APPLY=1 ./ghidra/run.sh repair-flow";
const FIX_APPLY = `HOTD2_APPLY=1 ./ghidra/run.sh apply-annotations, then ${FIX_REPAIR}`;

/** The one `[hotd2] <tag>: k=v ...` line a script prints, as a record. */
function summary(out: string, tag: string): Record<string, string> | null {
  const m = new RegExp(`\\[hotd2\\] ${tag}: ((?:\\S+=\\S+ ?)+)`).exec(out);
  if (!m) return null;
  const rec: Record<string, string> = {};
  for (const kv of m[1]!.trim().split(/\s+/)) {
    const i = kv.indexOf("=");
    rec[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return rec;
}

const RENAME = /\[hotd2\] export (functions|globals) rename ([0-9a-f]{8}) (\S+) -> (\S+)/g;

/**
 * Every name each address has carried in this tree's committed history.
 *
 * One `git log -p` over the file: a row's name appears on a `+` or `-` line of
 * every commit that touched it. A name the database has that is in this set,
 * but is not the row's name now, is a rename the file made and the database
 * never followed.
 */
function formerNames(table: string): Map<string, Set<string>> {
  const p = spawnSync("git", ["-C", ROOT, "log", "-p", "-U0", "--no-renames", "--format=",
    "HEAD", "--", `ghidra/annotations/${table}.tsv`], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  const names = new Map<string, Set<string>>();
  for (const line of (p.stdout ?? "").split("\n")) {
    if (!(line.startsWith("+") || line.startsWith("-")) || line.startsWith("+++") || line.startsWith("---")) continue;
    const c = line.slice(1).split("\t");
    if (c.length >= 2 && /^[0-9a-fA-F]{8}$/.test(c[0]!)) {
      const a = c[0]!.toLowerCase();
      if (!names.has(a)) names.set(a, new Set());
      names.get(a)!.add(c[1]!.trim());
    }
  }
  return names;
}

function isFile(p: string): boolean {
  try { return statSync(p).isFile(); } catch { return false; }
}

function main(): number {
  const gameDir = argValue("game-dir") ?? process.env.GAME_DIR ?? null;
  const projectDir = argValue("project-dir") ?? process.env.HOTD2_PROJECT_DIR
    ?? join(ROOT, "ghidra", "project");
  const ghidraHome = argValue("ghidra-home") ?? process.env.GHIDRA_HOME
    ?? join(homedir(), "ghidra_12.1.3_PUBLIC");

  const headless = join(ghidraHome, "support", "analyzeHeadless");
  const exe = join(gameDir ?? "", PROGRAM);
  if (!isFile(headless)) {
    console.log(`SKIP  ghidra_db: no Ghidra at ${ghidraHome} (set GHIDRA_HOME)`);
    return 3;
  }
  if (!isFile(join(projectDir, `${PROJECT_NAME}.gpr`))) {
    console.log(`SKIP  ghidra_db: no project at ${projectDir}; ./ghidra/run.sh rebuild makes one`);
    return 3;
  }
  if (!gameDir || !isFile(exe)) {
    console.log(`SKIP  ghidra_db: no ${PROGRAM} (pass --game-dir)`);
    return 3;
  }

  const tmp = mkdtempSync(join(tmpdir(), "hotd2-ghidra-"));
  let out: string;
  let status: number | null;
  try {
    const copy = join(tmp, "project");
    cpSync(projectDir, copy, {
      recursive: true,
      filter: (src) => !/\.lock~?$/.test(basename(src)),
    });
    // The scripts read -- and ExportAnnotations writes -- a copy of the
    // annotations, so what an export would do is measured without doing it.
    const repo = join(tmp, "repo");
    mkdirSync(join(repo, "ghidra"), { recursive: true });
    cpSync(join(ROOT, "ghidra", "annotations"), join(repo, "ghidra", "annotations"), { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env, HOTD2_REPO: repo, HOTD2_OUT: tmp };
    delete env.HOTD2_APPLY;
    const p = spawnSync(headless, [
      copy, PROJECT_NAME, "-process", PROGRAM, "-noanalysis", "-readOnly",
      "-scriptPath", join(ROOT, "ghidra", "scripts"),
      "-postScript", "ApplyAnnotations.java",
      "-postScript", "RepairFlowDamage.java",
      // Last: it rewrites the copy's prototypes.tsv, which RepairFlowDamage reads.
      "-postScript", "ExportAnnotations.java",
    ], { env, encoding: "utf8", timeout: 900_000, maxBuffer: 256 * 1024 * 1024 });
    out = (p.stdout ?? "") + (p.stderr ?? "");
    status = p.status;
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  }

  const proto = summary(out, "prototypes");
  const flow = summary(out, "flow");
  const fns = summary(out, "functions");
  const gbls = summary(out, "globals");
  const xfns = summary(out, "export functions");
  const xgbls = summary(out, "export globals");
  const got = [proto, flow, fns, gbls, xfns, xgbls];
  if (status !== 0 || proto === null || flow === null || fns === null || gbls === null
      || xfns === null || xgbls === null || out.includes("SCRIPT ERROR")) {
    // A run that printed no summary did not look at the database (L13), and a
    // script that failed to compile is skipped with exit 0.
    console.log(`FAIL  ghidra_db: the headless run exited ${status} `
      + `with ${got.filter((g) => g !== null).length} of ${got.length} summaries`);
    for (const line of out.split("\n").slice(-25)) console.log(`  ${line}`);
    return 1;
  }

  const detail = out.split("\n")
    .filter((l) => /\[hotd2\] (prototype |flow |name )/.test(l))
    .map((l) => l.replace(/^.*?\[hotd2\] /, "").trim().replace(/\(GhidraScript\)$/, "").trim());
  const md5 = createHash("md5").update(readFileSync(exe)).digest("hex");

  const ok: string[] = [];
  const bad: string[] = [];
  const rule = (held: boolean, good: string, wrong: string): void => {
    (held ? ok : bad).push(held ? good : wrong);
  };
  const n = (v: string | undefined): number => Number.parseInt(v ?? "NaN", 10);

  rule(flow.md5 === md5,
    `the database was imported from this ${PROGRAM} (${md5})`,
    `the database's program md5 is ${flow.md5}, ${exe} is ${md5}: `
    + "it was imported from a different executable");
  rule(flow.discovered === "false",
    "the Discovered no-return analyzer is off",
    `the "Non-Returning Functions - Discovered" analyzer is on -- ${FIX_REPAIR}`);
  const stale = n(flow.stale);
  const dropped = n(flow.dropped);
  rule(stale === 0 && dropped === 0,
    "no CALL to a returning function is cut short",
    `${stale} CALLs to a function that returns carry CALL_RETURN and `
    + `${dropped} fall into undisassembled bytes -- the decompiler ends `
    + `those bodies at the call. ${FIX_REPAIR}`);
  rule(n(flow.undeclared) === 0,
    "every no-return flag is declared in prototypes.tsv",
    `${flow.undeclared} functions are flagged no-return and `
    + "prototypes.tsv does not say so -- prove it and add a `noreturn` row, "
    + `or add a \`returns\` row and run ${FIX_APPLY}`);
  const changes = n(proto.changed) + n(proto.flags) + n(proto.missing);
  rule(changes === 0,
    `all ${proto.same} prototypes and every flag in prototypes.tsv are applied`,
    `${proto.changed} prototypes, ${proto.flags} flags and `
    + `${proto.missing} missing functions differ from prototypes.tsv -- ${FIX_APPLY}`);
  rule(n(proto.kept) === 0,
    "no prototype set by hand disagrees with its row",
    `${proto.kept} prototypes were set by hand and differ from their `
    + "row -- ./ghidra/run.sh export-annotations if the database is right, "
    + "else fix it and re-apply");
  rule(n(proto.failed) === 0,
    "every row of prototypes.tsv parses",
    `${proto.failed} rows of prototypes.tsv do not parse`);

  // Names and comments. An export takes the database's name, so the one
  // disagreement that loses work is a database name the file already left.
  const renames = [...out.matchAll(RENAME)].map((m) => [m[1]!, m[2]!, m[3]!, m[4]!] as const);
  const history: Record<string, Map<string, Set<string>>> = {
    functions: formerNames("functions"), globals: formerNames("globals"),
  };
  const staleNames = renames.filter(([t, a, , db]) => history[t]!.get(a)?.has(db) ?? false);
  rule(staleNames.length === 0,
    "no export would put back a name the file renamed away from",
    `${staleNames.length} database names are ones the file has since renamed, and `
    + "export-annotations would put them back: "
    + staleNames.slice(0, 6).map(([, a, have, db]) => `0x${a.toUpperCase()} \`${db}\` (the file: \`${have}\`)`).join(", ")
    + " -- rename them in the database (rename_function over MCP, or the GUI)");
  const failedRows = n(fns.failed) + n(gbls.failed);
  rule(failedRows === 0,
    "every row of functions.tsv and globals.tsv applies",
    `${failedRows} rows of functions.tsv/globals.tsv fail to apply -- see `
    + "ghidra/out/apply_annotations.txt after a report run");

  // Counted, never failed: someone's work on its way (see the doc comment).
  const notes: string[] = [];
  const aheadN = n(fns.named) + n(fns.created) + n(gbls.named);
  const aheadC = n(fns.comments) + n(gbls.comments);
  if (aheadN || aheadC) {
    notes.push(`the files are ahead: ${aheadN} names and ${aheadC} comments `
      + "not in the database yet -- HOTD2_APPLY=1 ./ghidra/run.sh "
      + "apply-annotations (with the GUI closed) writes them");
  }
  const pending = renames.filter((r) => !staleNames.includes(r));
  const newRows = n(xfns.appended) + n(xgbls.appended);
  const filled = n(xfns.filled);
  if (pending.length || newRows || filled) {
    notes.push(`the database is ahead: ${newRows} names no row has, `
      + `${pending.length} renames and ${filled} comments for empty rows `
      + "-- ./ghidra/run.sh export-annotations brings them over; "
      + "check a branch has not already committed them");
    for (const [t, a, have, db] of pending.slice(0, 6)) {
      notes.push(`  rename 0x${a.toUpperCase()} ${t}: the file \`${have}\`, the database \`${db}\``);
    }
  }
  const conflicts = n(xfns.conflicts);
  if (conflicts) {
    notes.push(`${conflicts} comments differ between a file row and the `
      + "database; both scripts keep the file's, and the database's "
      + "is replaced on the next apply -- carry anything worth keeping "
      + "over with npm run annotate (export-annotations lists them in "
      + "ghidra/out/export_comment_conflicts.tsv)");
  }

  for (const line of ok) console.log(`  ok    ${line}`);
  for (const line of notes) console.log(`  note  ${line}`);
  if (bad.length) {
    for (const line of bad) console.log(`  FAIL  ${line}`);
    for (const line of detail.slice(0, 40)) console.log(`        ${line}`);
    console.log(`\nFAIL  ghidra_db: ${bad.length} of ${bad.length + ok.length} `
      + "rules broken (read from the last saved database)");
    return 1;
  }
  console.log(`\nclean: ${ok.length} rules over the saved database`);
  return 0;
}

process.exit(main());

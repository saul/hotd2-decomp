/**
 * The frame every check against the installed game shares.
 *
 *     node tools/run_ts.mjs tools/checks/<name>.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * A check reads the game through `src/hod2lib/` -- the same library the
 * exporter runs -- and asserts through a {@link Checker}, which exits with the
 * repository's convention: **0** asserted things and all held, **1** something
 * was wrong, **3** asserted nothing. Exit 3 is a skip, and `verify_all.py`
 * counts it as one rather than as a pass.
 */
import { NodeAssetSource } from "./node_io";
import { ExeTables } from "../../src/hod2lib/exetab";

/** Exit status for "asserted nothing". */
export const EXIT_SKIPPED = 3;

/** The value of `--<name> <value>` or `--<name>=<value>` on the command line. */
export function argValue(name: string, argv: readonly string[] = process.argv.slice(2)): string | null {
  const flag = `--${name}`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === flag) return argv[i + 1] ?? null;
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
  }
  return null;
}

/** `--game-dir`, or exit 3 saying why nothing was asserted. */
export function gameDirOrSkip(check: string): string {
  const dir = argValue("game-dir");
  if (!dir) {
    console.log(`${check}: no --game-dir given; asserted nothing`);
    process.exit(EXIT_SKIPPED);
  }
  return dir;
}

/** The installed game, and its executable's tables. */
export interface Game {
  source: NodeAssetSource;
  exe: ExeTables;
}

/** Open the install at `dir`; `ExeTables.create` refuses any other build. */
export async function openGame(dir: string): Promise<Game> {
  const source = new NodeAssetSource(dir);
  const exe = await ExeTables.create(await source.read("Hod2.exe"), "Hod2.exe");
  return { source, exe };
}

/** `0x1234ABCD` -- the spelling every address in this repository uses. */
export function hex(v: number, width = 0): string {
  return `0x${(v >>> 0).toString(16).toUpperCase().padStart(width, "0")}`;
}

/** The IEEE-754 single-precision bits of `v`: two floats are equal when these are. */
export function f32Bits(v: number): number {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, v, true);
  return b.getUint32(0, true);
}

/**
 * Counts what a check asserted, prints each result, and exits with the
 * repository's convention.
 */
export class Checker {
  asserted = 0;
  failed = 0;

  constructor(readonly name: string) {}

  /** Assert `cond`; `what` says what held, or what did not. */
  ok(cond: boolean, what: string): boolean {
    this.asserted++;
    if (cond) {
      console.log(`  ok    ${what}`);
    } else {
      this.failed++;
      console.log(`FAIL  ${what}`);
    }
    return cond;
  }

  /** Assert `actual === expected`, printing both when they differ. */
  eq<T>(actual: T, expected: T, what: string): boolean {
    this.asserted++;
    if (Object.is(actual, expected)) {
      console.log(`  ok    ${what}`);
      return true;
    }
    this.failed++;
    console.log(`FAIL  ${what}: got ${fmt(actual)}, expected ${fmt(expected)}`);
    return false;
  }

  /** Record a failure without a condition. */
  fail(what: string): void {
    this.asserted++;
    this.failed++;
    console.log(`FAIL  ${what}`);
  }

  /** A line of context that asserts nothing. */
  note(what: string): void {
    console.log(`  note  ${what}`);
  }

  /** Print the tally and exit 0, 1 or 3. */
  finish(): never {
    if (this.asserted === 0) {
      console.log(`${this.name}: asserted nothing`);
      process.exit(EXIT_SKIPPED);
    }
    console.log(`${this.name}: ${this.asserted - this.failed}/${this.asserted} held`);
    process.exit(this.failed ? 1 : 0);
  }
}

function fmt(v: unknown): string {
  return typeof v === "number" && Number.isInteger(v) && Math.abs(v) > 255 ? hex(v) : String(v);
}

/**
 * What the exporter could not read, and carried on without.
 *
 * A port of `tools/hod2lib/degraded.py`, and the reasoning there is the whole
 * story: thirty-odd places in this package answer a failure with an empty
 * result, every one of them deliberate, and what was wrong is that they were
 * silent. A site that swallows says so, `buildStage` drains the records into
 * the stage's manifest entry, and the export exits non-zero if the list is not
 * empty.
 *
 * **One divergence, and it is in the `where` field.** Python takes it from the
 * caller's frame, `sys._getframe(1)`, so a moved function cannot leave a stale
 * location behind. JavaScript has no equivalent that survives bundling:
 * esbuild renames functions and the browser build has no file names at all. So
 * the call site passes it, spelled exactly as Python would have derived it
 * (`hod2lib.nl1.parse`), and `tools/compare_bundles.py` compares the strings.
 * A hand-written location can go stale, which is the cost; a location that
 * reads `t.a` after minification is worse.
 */

export interface Degradation {
  /** `module.function` of the call site. */
  where: string;
  /** What was being read, in the words of whoever wrote the site. */
  what: string;
  /** What the bundle is missing as a result. The half that matters. */
  lost: string;
  /** `TypeName: message`. Not a stack; the site is the location. */
  error: string;
}

/** The em dash is the reference implementation's; the strings are compared. */
export function line(r: Degradation): string {
  return `${r.where}: could not read ${r.what} (${r.error}) — ${r.lost}`;
}

const log: Degradation[] = [];
/**
 * `(where, error type)` already printed. A cache miss inside a loop over two
 * hundred asset slots is one story, not two hundred lines of it; every
 * occurrence is still recorded, only the printing is folded.
 */
const printed = new Set<string>();

let warn: (text: string) => void = () => {};

/** Where a warning goes. The CLI sends it to stderr; the page, to the feed. */
export function setWarningSink(fn: (text: string) => void): void {
  warn = fn;
}

/**
 * `TypeName: message`, the way Python renders an exception in a record.
 *
 * An `Error` subclass keeps its constructor name through esbuild because the
 * classes in this package are declared rather than generated; anything thrown
 * that is not an `Error` is reported as its own text, which is what Python's
 * `str(exc)` does for a value with no message of its own.
 */
export function describe(exc: unknown): string {
  if (exc instanceof Error) return `${exc.name}: ${exc.message}`;
  return String(exc);
}

/** Record that *what* could not be read, and that *lost* is the price. */
export function note(where: string, what: string, lost: string,
                     exc: unknown): void {
  const rec: Degradation = { where, what, lost, error: describe(exc) };
  log.push(rec);
  const key = `${where} ${rec.error.split(":")[0]}`;
  if (!printed.has(key)) {
    printed.add(key);
    warn(`  warning: ${line(rec)}`);
  }
}

/** Start a fresh count. `buildStage` calls this so a count is per stage. */
export function reset(): void {
  log.length = 0;
  printed.clear();
}

/** Everything recorded since {@link reset}, and start again. */
export function drain(): Degradation[] {
  const out = log.slice();
  reset();
  return out;
}

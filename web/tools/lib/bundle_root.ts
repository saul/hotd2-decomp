/**
 * Where the exported bundle lives, resolved once for tests and tools alike.
 *
 * This exists because three tests spent an unknown number of weeks exiting 0
 * having asserted nothing. Their bundle path was hard-coded to
 * `$HOME/hotd2-decomp/extract/player`, as it was in ten tools under `tools/`,
 * while `vite.config.ts` resolved `../extract/player` — so on a checkout at
 * any other path the tests could never find a bundle *even when one was
 * built*, printed "no bundle", and passed. A check that cannot fire is worse
 * than no check, because it is also an argument against looking.
 *
 * Two rules follow from that:
 *
 * * **The path is derived from this checkout**, by walking up from the working
 *   directory to the repository root, so moving or renaming the clone cannot
 *   silently disarm anything. `HOTD2_BUNDLE` overrides it for an export that
 *   lives elsewhere.
 * * **A skip is not a pass.** {@link skipNoBundle} exits `3`, which is neither
 *   the `0` of a run that asserted things nor the `1` of a run that found them
 *   wrong. `npm run` stops on it, loudly, which is the intended amount of
 *   annoying: the bundle-free fixture that makes these three tests run
 *   everywhere is the next phase of the review plan, and until it lands the
 *   skip should be impossible to mistake for green.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Exit status for "this test needs a bundle and there is none". */
export const EXIT_SKIPPED = 3;

/**
 * The repository root: the nearest ancestor of the working directory holding
 * both a `.git` and a `web/`. Falls back to the working directory, which makes
 * the error message name a wrong-but-visible path rather than throwing.
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, ".git")) && existsSync(join(dir, "web"))) return dir;
    const up = dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
}

/** The bundle directory. Not guaranteed to exist — see {@link hasBundle}. */
export const BUNDLE_ROOT: string =
  process.env.HOTD2_BUNDLE ?? join(repoRoot(), "extract", "player");

/** `<bundle>/stage<n>/stage<n>.<ext>.json`, the shape every stage file has. */
export function stageFile(stage: number, ext: string): string {
  return join(BUNDLE_ROOT, `stage${stage}`, `stage${stage}.${ext}.json`);
}

/** Whether stage `n`'s script was exported. */
export function hasStage(stage: number): boolean {
  return existsSync(stageFile(stage, "script"));
}

/** Whether any stage was exported. */
export function hasBundle(): boolean {
  for (let s = 1; s <= 6; s++) if (hasStage(s)) return true;
  return false;
}

/**
 * Report the skip and leave. Never returns; see {@link EXIT_SKIPPED} for why
 * the status is not `0`.
 */
export function skipNoBundle(what: string): never {
  console.log(`\nSKIP  ${what}: no bundle under ${BUNDLE_ROOT}`);
  console.log("      build one with tools/export_player.py,"
    + " or point HOTD2_BUNDLE at an existing export.");
  process.exit(EXIT_SKIPPED);
}

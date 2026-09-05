/**
 * Bundle one TypeScript entry with esbuild and run it in node, forwarding the
 * rest of the command line to it.
 *
 * `run_test.mjs` does the same for a test, and deliberately takes no
 * arguments: a test that reads argv is a test with two behaviours. The
 * exporter CLI is the opposite -- it is nothing but arguments -- so it gets
 * its own runner rather than growing a flag on that one.
 *
 *     node tools/run_ts.mjs src/hod2lib/cli.ts --game-dir "..." --all
 */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = process.argv[2];
if (!entry) {
  console.error("usage: node tools/run_ts.mjs <entry.ts> [args...]");
  process.exit(2);
}

const out = await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "warning",
  banner: {
    js: "import { createRequire as __cr } from 'node:module';"
      + " const require = __cr(import.meta.url);",
  },
});

const dir = mkdtempSync(join(tmpdir(), "hod2-run-"));
const file = join(dir, "bundle.mjs");
writeFileSync(file, out.outputFiles[0].text);

// The entry sees its own arguments where a node script expects them: argv[0]
// node, argv[1] the script, argv[2..] the flags.
process.argv = [process.argv[0], entry, ...process.argv.slice(3)];
await import(pathToFileURL(file).href);

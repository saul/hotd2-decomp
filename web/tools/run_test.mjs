/**
 * Bundle one TypeScript entry with esbuild (which vite already ships) and run
 * it in node. There is no browser and no DOM: if the file being run reaches
 * three.js, the bundle pulls it in and the import of `window` fails loudly,
 * which is exactly the check `game/` is meant to pass.
 */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = process.argv[2];
if (!entry) {
  console.error("usage: node tools/run_test.mjs <entry.ts>");
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
  // A CJS dependency bundled into ESM keeps its `require`, and esbuild's shim
  // for it looks for a global one before giving up. `react-dom/server` reaches
  // for `util` that way, so give it a real `require` rather than pretend no
  // test will ever pull in a CommonJS package.
  banner: {
    js: "import { createRequire as __cr } from 'node:module';"
      + " const require = __cr(import.meta.url);",
  },
});

const dir = mkdtempSync(join(tmpdir(), "hod2-test-"));
const file = join(dir, "bundle.mjs");
writeFileSync(file, out.outputFiles[0].text);
await import(pathToFileURL(file).href);

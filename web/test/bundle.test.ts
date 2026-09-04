/**
 * The Python-to-TypeScript bundle contract, and whether it can actually fire.
 *
 * Item 25 gave the loader two refusals — a `format` that must match and a
 * schema digest that must match — and they were right and unreachable. Every
 * other suite reads the bundle's JSON straight off disk; **nothing calls
 * `loadManifest` or `loadStage`**, so all nine went green against
 * `extract/player` at format 2 while the client read 3. A bundle the player
 * would refuse to open was, to the check chain, a passing bundle.
 *
 * That is the same defect as F7-F10: the property was right, and the thing
 * measuring it could not fire. The refusals are pure functions now — the
 * shape `snapshotRefusal` already had in `core/` — and this drives them.
 *
 * Bundle-free on purpose. It builds its manifests in memory, so unlike
 * `test:seek`/`state`/`camera` it runs on a machine with no game data and
 * cannot SKIP.
 *
 * Run with `npm run test:bundle`.
 */
import { SCHEMA_FILES, SCHEMA_HASH } from "../src/bundle/schema_hash";
import { manifestRefusal, stageFormatRefusal } from "../src/bundle/load";
import { SUPPORTED_FORMAT, type Manifest } from "../src/bundle/manifest";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

/** A manifest this client should accept: current format, current digest. */
function good(): Manifest {
  return {
    format: SUPPORTED_FORMAT,
    schema: { hash: SCHEMA_HASH, files: { ...SCHEMA_FILES } },
    stages: [],
  } as unknown as Manifest;
}

console.log("\nbundle contract: the refusals, and that they fire");

{
  check("a current manifest is accepted", manifestRefusal(good()) === null,
        String(manifestRefusal(good())));

  // The exact case that was live in the repo when this test was written.
  const old = { ...good(), format: 2 };
  const no = manifestRefusal(old as Manifest);
  check("the format-2 bundle on disk is refused", no !== null);
  check("and the message says both numbers",
        !!no?.includes("format 2") && !!no?.includes(`reads ${SUPPORTED_FORMAT}`),
        String(no));

  check("a manifest from before the schema key is refused",
        manifestRefusal({ format: SUPPORTED_FORMAT, stages: [] } as
          unknown as Manifest) !== null);

  check("a non-manifest is refused rather than trusted",
        manifestRefusal(null) !== null && manifestRefusal(
          undefined) !== null);
}

console.log("\nschema drift names the declaration files that moved");

{
  // A digest mismatch alone can only say *that* something moved. Naming the
  // file is the difference between a message you act on and one you learn to
  // ignore, so the naming is asserted, not just the refusal.
  //
  // **Named, not counted.** This was `names.length >= 8`, which was the size
  // of `web/src/bundle/*.ts` minus the generated file — a count standing in
  // for a set. When the digest stopped hashing the loader and started hashing
  // a named list of declaration files, the count fell to 7 and the assertion
  // failed without being able to say what it wanted. A count cannot tell you
  // that the right seven are covered, only that seven things are.
  //
  // Which files belong on the list is `schema.SOURCES`, and
  // `verify_exporters.py` reads the directory and fails both ways — a listed
  // file that grows runtime code, and a declaration file nobody listed. This
  // asserts the client compiled against the same set.
  const WANT = ["cameras.ts", "characters.ts", "manifest.ts", "scene.ts",
                "script.ts", "sound.ts", "stage.ts"];
  const names = Object.keys(SCHEMA_FILES).sort();
  check("the digest covers exactly the declaration modules",
        names.join(",") === WANT.join(","),
        `have ${names.join(", ")}; want ${WANT.join(", ")}`);

  const drifted = good();
  const first = names[0];
  drifted.schema = {
    hash: "0".repeat(SCHEMA_HASH.length),
    files: { ...SCHEMA_FILES, [first]: "0".repeat(16) },
  };
  const no = manifestRefusal(drifted);
  check("a changed declaration is refused", no !== null);
  check(`and the message names ${first}`, !!no?.includes(first), String(no));

  // A bundle exported against a *newer* schema than the client is the same
  // failure in the other direction, and must not be waved through.
  const ahead = good();
  ahead.schema = { hash: "f".repeat(SCHEMA_HASH.length), files: {} };
  check("a bundle from a newer schema is refused too",
        manifestRefusal(ahead) !== null);
}

console.log("\na stage carries its own format, and the entry's does not imply it");

{
  check("a current stage passes",
        stageFormatRefusal("stage1.script.json", SUPPORTED_FORMAT) === null);

  // The case the per-stage field exists for: a stage directory copied in from
  // an older bundle keeps its own format while the entry indexing it says
  // whatever the latest export said.
  const no = stageFormatRefusal("stage1.script.json", SUPPORTED_FORMAT - 1);
  check("a stage carried from an older export is refused", no !== null);
  check("and the message names the file", !!no?.includes("stage1.script.json"),
        String(no));

  check("a stage written before the field existed is refused",
        stageFormatRefusal("stage1.cam.json", undefined) !== null);
  check("and says so rather than printing undefined",
        !!stageFormatRefusal("s", undefined)?.includes("(none)"));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);

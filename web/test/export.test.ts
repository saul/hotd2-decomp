/**
 * The parts of the TypeScript exporter a game directory cannot check.
 *
 * `tools/verify_parity.py` is the real proof: it exports a stage with both
 * implementations and compares the bytes. But it needs an install, so it runs
 * only where there is one -- and three pieces of this port are load-bearing,
 * are *not* exercised by comparing two bundles, and had nothing testing them
 * at all:
 *
 * * **`pyjson`** is compared against recorded `json.dumps` output. A bundle
 *   diff cannot catch a separator bug, because both sides would be read back
 *   with `JSON.parse` and agree.
 * * **`resolveCase`** is what makes `COMMON\BLOOD01_16.WAV` find
 *   `common/blood01_16.wav`. On a case-insensitive filesystem -- which is what
 *   this repository is developed on -- a broken resolver still works, and the
 *   failure only appears on someone else's Linux box.
 * * **the ZIP writer** is how an in-page export leaves the browser, and an
 *   archive nothing can open is a silent loss of the whole export.
 *
 * `lz` is here too, on streams hand-built from the grammar in
 * `docs/formats/lz.md` rather than from a `pol/` file. The interesting cases
 * are the ones the shipped data does not obviously contain -- an offset of -1
 * filling a run, a header that disagrees with its stream -- and they are the
 * ones a corpus test would never isolate.
 *
 * Bundle-free and install-free on purpose, so it cannot SKIP.
 *
 * Run with `npm run test:export`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decompress, decompressFile, LZError } from "../src/hod2lib/lz";
import { resolveCase, segments } from "../src/hod2lib/io";
import { dumps, dumpsIndented, dumpsStrict, dumpsTight } from "../src/hod2lib/pyjson";
import { crc32 } from "../src/hod2lib/png";
import { zipBlob } from "../src/app/install/zip";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
console.log("\npyjson: what `json.dumps` actually writes");

/**
 * The oracle is Python itself.
 *
 * Recording expected strings by hand would be recording *my reading* of
 * `json.dumps`, which is the thing under test. This runs the real one -- the
 * same interpreter `tools/hod2lib/` runs on -- and compares.
 */
function python(expr: string): string {
  return execFileSync("python3", ["-c", `import json;print(${expr}, end="")`],
                      { encoding: "utf8" });
}

{
  // The default separators, which `bundle.py` relies on and `JSON.stringify`
  // does not have: `", "` and `": "`, with the spaces.
  const v = { a: 1, b: [1, 2], c: { d: "x" } };
  const py = python('json.dumps({"a":1,"b":[1,2],"c":{"d":"x"}})');
  check("default separators match json.dumps", dumps(v) === py,
        `${dumps(v)} vs ${py}`);

  // The glTF JSON chunk, which asks for the tight pair.
  const tight = python('json.dumps({"a":1,"b":[1,2]},separators=(",",":"))');
  check("the tight pair matches", dumpsTight({ a: 1, b: [1, 2] }) === tight,
        `${dumpsTight({ a: 1, b: [1, 2] })} vs ${tight}`);

  // `indent=1`, which the manifest and a loose .gltf use. Note that Python
  // drops the trailing space from the item separator when indenting.
  const ind = python('json.dumps({"a":1,"b":[1,2],"c":{}},indent=1)');
  check("indent=1 matches", dumpsIndented({ a: 1, b: [1, 2], c: {} }) === ind,
        `${JSON.stringify(dumpsIndented({ a: 1, b: [1, 2], c: {} }))} vs `
        + JSON.stringify(ind));

  // `ensure_ascii`, which is on by default in Python and has no equivalent in
  // `JSON.stringify`. A `degraded` record can carry an exception message.
  const nonAscii = python('json.dumps({"k":"caf\\u00e9 \\u2014 ok"})');
  check("non-ASCII is escaped the way Python escapes it",
        dumps({ k: "café — ok" }) === nonAscii,
        `${dumps({ k: "café — ok" })} vs ${nonAscii}`);

  // Control characters and quotes, the other half of the escape table.
  const esc = python(String.raw`json.dumps({"k":"a\"b\\c\nd\te"})`);
  check("escapes match", dumps({ k: 'a"b\\c\nd\te' }) === esc,
        `${dumps({ k: 'a"b\\c\nd\te' })} vs ${esc}`);

  check("an empty container is not indented",
        dumpsIndented({}) === "{}" && dumpsIndented([]) === "[]");

  // `allow_nan=False`, which `bundle.py` passes so a camera curve that decoded
  // to garbage fails the export rather than writing a file no parser will read.
  let threw = false;
  try {
    dumpsStrict({ x: Number.NaN });
  } catch {
    threw = true;
  }
  check("NaN is refused, as allow_nan=False", threw);
  threw = false;
  try {
    dumpsStrict({ x: Number.POSITIVE_INFINITY });
  } catch {
    threw = true;
  }
  check("Infinity is refused too", threw);

  // A negative zero is a real value a float can hold, and `String(-0)` is "0".
  check("negative zero keeps its sign", dumps(-0) === "-0", dumps(-0));

  // `undefined` is how an optional block that was not built stays out of the
  // file: Python simply never puts the key in the dict.
  check("an undefined member is dropped, and null is not",
        dumps({ a: undefined, b: null }) === '{"b": null}',
        dumps({ a: undefined, b: null }));
}

// ---------------------------------------------------------------------------
console.log("\ncase-insensitive resolution: the game's own spelling");

{
  const tree: Record<string, string[]> = {
    "": ["Hod2.exe", "sound", "pol"],
    "sound": ["SE"],
    "sound/SE": ["COMMON"],
    "sound/SE/COMMON": ["blood01_16.wav"],
    "pol": ["st1_01.bin"],
  };
  const list = async (d: string) => tree[d] ?? [];

  const hit = await resolveCase("SOUND/se/common/BLOOD01_16.WAV", list);
  check("a path in the wrong case resolves to the real spelling",
        hit === "sound/SE/COMMON/blood01_16.wav", String(hit));

  check("an exact match wins", await resolveCase("pol/st1_01.bin", list)
        === "pol/st1_01.bin");
  check("a missing file is null",
        await resolveCase("pol/nope.bin", list) === null);
  check("a missing directory is null, not a throw",
        await resolveCase("nope/st1_01.bin", list) === null);
  check("backslashes are separators, as the exe writes them",
        await resolveCase("sound\\SE\\COMMON\\blood01_16.wav", list)
        === "sound/SE/COMMON/blood01_16.wav");
  check("segments drops the empty parts",
        segments("//a///b/").join(",") === "a,b");
}

// ---------------------------------------------------------------------------
console.log("\nLZ: the decoder against its own output");

{
  // Hand-built from the grammar in `docs/formats/lz.md`. Flag bits are
  // LSB-first and share the byte stream with the payload, which is the part
  // that is easy to get wrong and impossible to notice on data that happens to
  // decode anyway.
  //
  //   flag byte 0x17 = bits 1,1,1,0,1,...
  //     1,1,1  three literals: 'A', 'B', 'C', each read from the cursor
  //     0      a match follows
  //     1      long form -> u16, and a u16 of 0 is end of stream
  const stream = new Uint8Array([0x17, 0x41, 0x42, 0x43, 0x00, 0x00]);
  const got = decompress(stream);
  check("a literal run decodes", String.fromCharCode(...got) === "ABC",
        `${got.length} bytes: ${[...got].join(",")}`);

  // The same stream behind a size header, which is the on-disk form.
  const file = new Uint8Array([3, 0, 0, 0, ...stream]);
  check("decompressFile honours the size header",
        String.fromCharCode(...decompressFile(file)) === "ABC");

  // A header that disagrees with the stream is a damaged file, and saying so
  // is the whole reason the header is checked rather than trusted.
  let threw = false;
  try {
    decompressFile(new Uint8Array([4, 0, 0, 0, ...stream]));
  } catch (e) {
    threw = e instanceof LZError;
  }
  check("a length that disagrees with the header raises", threw);

  threw = false;
  try {
    decompress(new Uint8Array([0xff]));
  } catch (e) {
    threw = e instanceof LZError;
  }
  check("a truncated stream raises LZError", threw);

  threw = false;
  try {
    decompressFile(new Uint8Array([1, 2]));
  } catch (e) {
    threw = e instanceof LZError;
  }
  check("a file too short for a size header raises", threw);

  check("a zero-length file decompresses to nothing",
        decompressFile(new Uint8Array([0, 0, 0, 0])).length === 0);

  // An overlapping copy is intentional -- an offset of -1 is a legal run fill
  // -- and it is the one case a naive `memcpy` gets wrong, so it is spelled
  // out rather than assumed:
  //
  //   flag byte 0x47 = bits 1,1,1,0,0,0,1,0
  //     1,1,1  'A', 'B', 'C'
  //     0      end of the literal run, a match follows
  //     0      short form
  //     0,1    two length bits, MSB first -> n = 1 -> length 3
  //            then one payload byte, 0xFF -> offset 0xFF - 0x100 = -1
  //     0      the next round's literal bit: no literal
  //   flag byte 0x01
  //     1      long form -> u16, and a u16 of 0 is end of stream
  const run = new Uint8Array([0x47, 0x41, 0x42, 0x43, 0xff,
                              0x01, 0x00, 0x00]);
  const filled = decompress(run);
  check("an offset of -1 fills a run",
        String.fromCharCode(...filled) === "ABCCCC",
        String.fromCharCode(...filled));
}

// ---------------------------------------------------------------------------
console.log("\nzip: an archive the platform can open");

{
  const files = [
    { path: "manifest.json", blob: new Blob(['{"format":4}']) },
    { path: "stage1/stage1.cam.json", blob: new Blob(["[1,2,3]"]) },
  ];
  const blob = await zipBlob(files);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  check("it starts with a local file header",
        bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3
        && bytes[3] === 4);

  // The real check is that something that is not this code can read it back.
  const dir = mkdtempSync(join(tmpdir(), "hod2-zip-"));
  try {
    const path = join(dir, "b.zip");
    writeFileSync(path, bytes);
    const listing = execFileSync("unzip", ["-l", path], { encoding: "utf8" });
    check("unzip lists both entries",
          listing.includes("manifest.json")
          && listing.includes("stage1/stage1.cam.json"), listing);
    execFileSync("unzip", ["-qq", "-o", path, "-d", dir]);
    const back = execFileSync("cat", [join(dir, "stage1/stage1.cam.json")],
                              { encoding: "utf8" });
    check("and the content survives the round trip", back === "[1,2,3]", back);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // The CRC is the field an unzip checks, so it is worth one direct case.
  check("crc32 matches the known value for 'hello'",
        crc32(new TextEncoder().encode("hello")) === 0x3610a686,
        crc32(new TextEncoder().encode("hello")).toString(16));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);

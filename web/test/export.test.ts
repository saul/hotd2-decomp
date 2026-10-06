/**
 * The parts of the TypeScript exporter a game directory cannot check.
 *
 * * **`bundleJson`** writes every JSON file in a bundle, and what it writes
 *   has to come back through `JSON.parse` as what went in -- or not be
 *   written at all: a `NaN` that `JSON.stringify` would turn into `null`
 *   fails the export instead. The manifest and a `.glb`'s JSON chunk are
 *   written here and read back.
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

import { BUNDLE_FORMAT, writeManifest } from "../src/hod2lib/bundle";
import { decompress, decompressFile, LZError } from "../src/hod2lib/lz";
import { bundleJson, resolveCase, segments } from "../src/hod2lib/io";
import { crc32 } from "../src/hod2lib/png";
import { zipBlob } from "../src/app/install/zip";
import { RIGS } from "../src/hod2lib/rigs_data";
import { holdFrameOf } from "../src/hod2lib/rigs";
import { entranceTailState } from "../src/hod2lib/placement";
import { class13Tail } from "../src/hod2lib/characters";
import { SPAWN_HEADER, Spawn, type EvtFile } from "../src/hod2lib/evt";
import type { ExeTables } from "../src/hod2lib/exetab";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

/** A sink that keeps what is written, keyed by path. */
function memorySink(): { files: Map<string, Uint8Array | string>;
                         write: (p: string, d: Uint8Array | string) => Promise<void>;
                         readJson: () => Promise<null>;
                         exists: () => Promise<boolean> } {
  const files = new Map<string, Uint8Array | string>();
  return {
    files,
    write: async (path, d) => { files.set(path, d); },
    readJson: async () => null,
    exists: async () => false,
  };
}

// ---------------------------------------------------------------------------
console.log("\nbundleJson: what goes in comes back out of JSON.parse");

{
  // `JSON.stringify` would write these as `null`; a curve of nulls loads and
  // fails far from where it was made, so the export fails instead.
  for (const [what, v] of [["NaN", Number.NaN],
                           ["Infinity", Number.POSITIVE_INFINITY],
                           ["-Infinity", Number.NEGATIVE_INFINITY]] as const) {
    let msg = "";
    try {
      bundleJson({ curve: [0, { key: v }] });
    } catch (e) {
      msg = (e as Error).message;
    }
    check(`${what} is refused, naming the key`, msg.includes('"key"'), msg);
  }
  // ...and a Map, which `JSON.stringify` writes as `{}`.
  let threw = false;
  try {
    bundleJson({ m: new Map([[1, 2]]) });
  } catch {
    threw = true;
  }
  check("a Map is refused rather than written as {}", threw);

  // `undefined` is how an optional block that was not built stays out of the
  // file.
  check("an undefined member is dropped, and null is not",
        bundleJson({ a: undefined, b: null }) === '{"b":null}',
        bundleJson({ a: undefined, b: null }));
  check("compact unless indented",
        bundleJson({ a: [1, 2] }) === '{"a":[1,2]}'
        && bundleJson({ a: [1, 2] }, 1) === '{\n "a": [\n  1,\n  2\n ]\n}',
        JSON.stringify(bundleJson({ a: [1, 2] }, 1)));
}

{
  // The manifest, written by the exporter's own function and read back. A
  // `degraded` record carries an exception message, which may be anything.
  const sink = memorySink();
  const entry = {
    name: "stage1", format: BUNDLE_FORMAT, stage: 1, counts: { degraded: 1 },
    degraded: [{ where: "x", what: "caf\u00e9 \u2014 \"quoted\"\n\ttab", lost: "" }],
    sources: { "pol/st1_01.bin": "00" },
  };
  await writeManifest(sink, [entry], "C:\\Games\\HOTD2", "2026-01-01T00:00:00Z",
                      { note: "n" });
  const text = String(sink.files.get("manifest.json"));
  let back: Record<string, unknown> = {};
  try {
    back = JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    check("manifest.json parses", false, (e as Error).message);
  }
  check("manifest.json parses, and says its format",
        back.format === BUNDLE_FORMAT, String(back.format));
  check("...and its stage entry round-trips unchanged",
        JSON.stringify((back.stages as unknown[])?.[0]) === JSON.stringify(entry),
        JSON.stringify((back.stages as unknown[])?.[0]));
  check("...as does the game directory, backslashes and all",
        back.game_dir === "C:\\Games\\HOTD2", String(back.game_dir));
  check("the manifest carries no tool_version", !("tool_version" in back));
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

  // **The header is not trusted input.** `container.classify` decompresses on
  // spec to decide whether a blob is compressed at all, and 865 of the game's
  // files have a first dword that merely looks like a size -- 4.03 GB of it in
  // `tex/st5_01b.bin`. Preallocating from that number asks the platform for
  // four gigabytes: node hands it over, so the CLI never noticed, and a
  // browser refuses with a `RangeError`, which is not an `LZError` and so
  // escaped the trial and killed the export at stage 2's first texture bank.
  threw = false;
  try {
    // 1 GB claimed from twelve bytes of stream. The grammar's ceiling is
    // 78.8x, so this is arithmetically impossible rather than merely unlikely.
    decompressFile(new Uint8Array([0, 0, 0, 0x40, ...stream, 0, 0]));
  } catch (e) {
    threw = e instanceof LZError;
  }
  check("a size header the grammar cannot reach raises LZError, not RangeError",
        threw);

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

// -- a rig route parked on its path stays parked ---------------------------

/**
 * **A `Route` that says `frame: "zero"` must emit `hold_frame: 0`.**
 *
 * Those are two spellings of one fact — the routine passes a literal `0.0f` to
 * `CamEvalObjectPath6`, so the object sits at one point on the path — and only
 * the second is a field the exporter reads. Both routes that carried it,
 * `obj_48f050` on `op_st4` 371 and `obj_48f560` on `op_st6` 386, set the prose
 * one and not the mechanism, so `render/rigs.ts` drove them with the camera
 * frame instead and walked them along a curve the engine parks them on. That
 * is what made stage 6's lift ascend the moment its shot began, and `rigs.ts`
 * already carried a comment warning about exactly this failure for the stage-1
 * vehicle.
 *
 * `hold_frame` is derived from `frame` now, and this is what says it stayed
 * derived. It reads the source table rather than a bundle, so it runs without
 * a game directory and cannot be satisfied by a stale export.
 */
console.log("\na rig route parked on its path:");
{
  const parked = RIGS.flatMap((r) => (r.routes ?? [])
    .filter((x) => x.frame === "zero")
    .map((x) => ({ rig: r.name, slot: x.slot, hold: holdFrameOf(x) })));
  check("the two routes that name a literal frame are still there",
        parked.length === 2, `${parked.length}: ${JSON.stringify(parked)}`);
  // **Through the derivation, not around it.** Reading `holdFrame` off the
  // source and defaulting an absent one to 0 would pass whether or not
  // anything derived it, which is the whole bug wearing a green tick.
  check("...and each one emits a hold frame, not a ride along the path",
        parked.every((p) => p.hold === 0), JSON.stringify(parked));
  // The other side of it: an ordinary route must still ride the camera frame.
  check("a route with no `frame` rule is not parked",
        holdFrameOf({ slot: 1 }) === null, String(holdFrameOf({ slot: 1 })));
  check("...and a prose rule is not a literal frame",
        holdFrameOf({ slot: 1, frame: "(age % 24), a 24-frame loop" }) === null,
        String(holdFrameOf({ slot: 1, frame: "(age % 24)" })));
}

// -- which state reads a class-0x30 tail ------------------------------------

/**
 * `ZombieStateRideCarrier` (`FUN_00458960`) reads only the tail's byte 3 and
 * hands the actor to that state at `0x00458A48`, so a passenger's entrance
 * tail is decoded for its **attack** state. Stage 2's boat riders start in 29
 * and hand over to 30 and 26; keyed on 29, their arcs and leaps were never
 * decoded and they walked off the boats. Spawns that start in any other state
 * keep their own: stage 4's three state-30 spawns, whose attack byte is 0.
 */
console.log("\nthe state that reads a class-0x30 tail:");
{
  check("a passenger's tail is its attack state's: 29 handing to 30",
        entranceTailState(0x30, 29, 30) === 30,
        String(entranceTailState(0x30, 29, 30)));
  check("...and 29 handing to 26",
        entranceTailState(0x30, 29, 26) === 26,
        String(entranceTailState(0x30, 29, 26)));
  check("a spawn that starts in its entrance keeps it: 30 with attack 0",
        entranceTailState(0x30, 30, 0) === 30,
        String(entranceTailState(0x30, 30, 0)));
  check("class 0x18 runs the same table, so the same rule",
        entranceTailState(0x18, 29, 47) === 47,
        String(entranceTailState(0x18, 29, 47)));
  check("a class that is not a zombie keeps its byte as it is",
        entranceTailState(0x31, 29, 30) === 29,
        String(entranceTailState(0x31, 29, 30)));
}

// -- a texture's alpha is the bank's, whatever the mesh's IgnoreTexAlpha -----

/**
 * **One image per texture, carrying the alpha the bank stores.**
 *
 * `BindModelTextureHandles` (`FUN_004AC980`) decodes each bank texture once,
 * from the bank entry and its data -- no mesh word is an input -- and
 * `DecodeTextureToSurface` (`FUN_004AC270`) copies every texel verbatim into
 * a surface that keeps the alpha. TSP bit 19, `IgnoreTexAlpha`, reaches none
 * of it: the D3D translation reads it only as half of the pass selector. The
 * exporter used to write an alpha-stripped `_opaque` copy for every mesh with
 * the bit set, and the 101 translucent-pass meshes that set it -- the
 * additive blades of `zslman` and `zndina` among them -- drew as solid bars.
 *
 * Two meshes on one ARGB4444 texture: a translucent-pass one with
 * `IgnoreTexAlpha` and `UseAlpha` both set, and an opaque-pass one. The
 * opaque pass ignores the texture's alpha by its draw state, which the
 * material carries (`alphaMode: OPAQUE`), not by a second image.
 */
console.log("\na texture's alpha is the bank's, not the mesh's:");
{
  const { exportLevel } = await import("../src/hod2lib/gltf");
  const { Mesh, Model } = await import("../src/hod2lib/nl1");
  const { bankDecode } = await import("../src/hod2lib/texbank");
  const { deflateSync, inflateSync } = await import("node:zlib");

  // 8 x 8 ARGB4444, linear: texel i has alpha nibble i % 16.
  const data = new Uint8Array(8 * 8 * 2);
  for (let i = 0; i < 64; i++) {
    const p = ((i % 16) << 12) | 0x0f00 | ((i * 3) & 0xff);
    data[i * 2] = p & 0xff;
    data[i * 2 + 1] = p >>> 8;
  }
  const bank = {
    data, complete: true, residual: 0,
    descs: new Map([[0, { width: 8, height: 8, pixfmt: 2, vq: false,
                          mipmap: false, twiddled: false }]]),
    offsets: new Map([[0, 0]]),
  };
  // texture_control: pixel format 2 (ARGB4444) at bits 27-29, bit 26 linear.
  const TC = (2 << 27) | (1 << 26);
  const mesh = (pc: number, tsp: number,
                base: [number, number, number, number] = [1, 1, 1, 1]) => {
    const m = new Mesh(0, pc, 0x83000000, tsp, TC, [0, 0, 0], 1, 0, 0,
                       base, [0, 0, 0, 0]);
    for (const pos of [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as const) {
      m.vertices.push({ pos: [pos[0], pos[1], pos[2]], normal: [0, 0, 1],
                        uv: [pos[0], pos[1]], colour: null });
    }
    m.triangles.push([0, 1, 2]);
    return m;
  };
  const model = new Model(0, 0, [0, 0, 0], 1);
  // List 2, TSP 0x94180000: SRCALPHA/INVSRCALPHA, UseAlpha and IgnoreTexAlpha.
  model.meshes.push(mesh(0x02000008, 0x94180000));
  // List 0, TSP 0x20080000: ONE/ZERO, IgnoreTexAlpha alone -- the opaque pass.
  model.meshes.push(mesh(0x00000008, 0x20080000));
  // The first mesh again, black: the stage-2 car's inner copies of its shells
  // (char_adv04). Same texture and words, its own material.
  model.meshes.push(mesh(0x02000008, 0x94180000, [1, 0, 0, 0]));

  const sink = memorySink();
  const deflate = async (d: Uint8Array, level: number) =>
    new Uint8Array(deflateSync(d, { level }));
  const info = await exportLevel("t", [["part", [model], bank]], "out", sink,
                                 deflate);

  // The `.glb`: a 12-byte header, the JSON chunk, the BIN chunk.
  const glb = sink.files.get(`out/${info.gltf}`);
  const bytes = glb instanceof Uint8Array ? glb : new Uint8Array();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLen = bytes.length >= 20 ? dv.getUint32(12, true) : 0;
  const binAt = 20 + jsonLen;
  const bin = binAt + 8 <= bytes.length
    ? bytes.subarray(binAt + 8, binAt + 8 + dv.getUint32(binAt, true))
    : new Uint8Array();
  check("the export is one .glb", info.gltf === "t.glb"
        && dv.getUint32(0, true) === 0x46546c67 && sink.files.size === 1,
        `${info.gltf}, ${sink.files.size} file(s)`);
  const doc = JSON.parse(new TextDecoder().decode(
    bytes.subarray(20, 20 + jsonLen))) as {
    images: { name: string; bufferView: number }[];
    bufferViews: { byteOffset: number; byteLength: number }[];
    materials: { alphaMode: string;
                 extensions?: Record<string, unknown>;
                 extras: { pvr2: { texture_alpha_used: boolean } } }[];
    extensionsUsed?: string[];
  };
  check("its JSON chunk parses", Array.isArray(doc.materials));
  check("every material is KHR_materials_unlit, and the file says so",
        doc.materials.every((m) => m.extensions?.KHR_materials_unlit)
        && doc.extensionsUsed?.includes("KHR_materials_unlit") === true,
        JSON.stringify(doc.extensionsUsed));
  check("both meshes share one image: there is no alpha-stripped copy",
        doc.images.length === 1 && !doc.images[0].name.includes("_opaque"),
        JSON.stringify(doc.images));

  /** The RGBA rows of an 8-bit RGBA PNG, filter 0 on every row. */
  const pixels = (png: Uint8Array): Uint8Array => {
    const idat: Uint8Array[] = [];
    let w = 0;
    for (let at = 8; at < png.length;) {
      const len = new DataView(png.buffer, png.byteOffset + at).getUint32(0);
      const tag = String.fromCharCode(...png.subarray(at + 4, at + 8));
      const body = png.subarray(at + 8, at + 8 + len);
      if (tag === "IHDR") w = new DataView(body.buffer, body.byteOffset).getUint32(0);
      if (tag === "IDAT") idat.push(body);
      at += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const rows: number[] = [];
    for (let y = 0; y * (w * 4 + 1) < raw.length; y++) {
      const start = y * (w * 4 + 1) + 1;
      rows.push(...raw.subarray(start, start + w * 4));
    }
    return new Uint8Array(rows);
  };
  const view = doc.bufferViews[doc.images[0]?.bufferView ?? -1];
  const got = view
    ? pixels(bin.subarray(view.byteOffset, view.byteOffset + view.byteLength))
    : new Uint8Array();
  const want = bankDecode(bank, 0)!.pixels;
  const alphas = (px: Uint8Array) => Array.from(px.filter((_, i) => i % 4 === 3));
  check("...and it carries the bank's alpha, byte for byte",
        got.length === want.length
        && alphas(got).every((a, i) => a === alphas(want)[i])
        && new Set(alphas(got)).size === 16,
        `alphas ${alphas(got).slice(0, 16)}`);
  check("the translucent-pass mesh blends (BLEND), and uses the texture's alpha",
        doc.materials[0]?.alphaMode === "BLEND"
        && doc.materials[0].extras.pvr2.texture_alpha_used === true,
        JSON.stringify(doc.materials[0]?.extras.pvr2.texture_alpha_used));
  check("the opaque-pass mesh is OPAQUE: its pass, not its image, drops alpha",
        doc.materials[1]?.alphaMode === "OPAQUE"
        && doc.materials[1].extras.pvr2.texture_alpha_used === false,
        `${doc.materials[1]?.alphaMode}`);
  const factors = (doc.materials as unknown as
    { pbrMetallicRoughness: { baseColorFactor: number[] } }[])
    .map((m) => m.pbrMetallicRoughness.baseColorFactor.join());
  check("a mesh with its own base colour gets its own material, not the "
        + "first match's",
        factors.length === 3 && factors[0] === "1,1,1,1"
        && factors[2] === "0,0,0,1", JSON.stringify(factors));
}

console.log("\nclass 0x13's tail carries what behaviours 6 and 7 read:");
{
  // `PropBehaviourLaunchWithAccel` (`FUN_0043FFC0`) reads six floats from
  // the operand block at tail `+0x14`; `PropBehaviourRideObjectPath`
  // (`FUN_004400D0`) its first dword as a path slot and
  // `g_cam_path_length[slot]` (`CMP EDX, [EDI*4 + 0x576D38]`). A
  // hand-built descriptor, every operand word different, so each field can
  // only have come from one offset.
  const tail = (behaviour: number, words: number[]): Spawn => {
    const raw = new Uint8Array(SPAWN_HEADER + 0x14 + 4 * words.length);
    const dv = new DataView(raw.buffer);
    dv.setUint32(0, 0x13, true);
    dv.setUint16(SPAWN_HEADER + 0x00, 0x1234, true);
    dv.setFloat32(SPAWN_HEADER + 0x0c, 1, true);
    dv.setUint32(SPAWN_HEADER + 0x10, behaviour, true);
    words.forEach((w, k) => dv.setFloat32(SPAWN_HEADER + 0x14 + 4 * k, w, true));
    return new Spawn(0, 0x0c, 0x13, 0, [0, 0, 0], [0, 0, 0], 0, 0,
                     { raw } as unknown as EvtFile);
  };
  const lengths: number[] = [];
  const tables = {
    camPathLength: (slot: number) => { lengths.push(slot); return 240; },
  } as unknown as ExeTables;
  const six = class13Tail(tail(6, [1.5, -2, 3.25, 0.125, -0.5, 0.75]), tables);
  check("behaviour 6 carries the operand block's six floats, in order",
        JSON.stringify(six.operand) === "[1.5,-2,3.25,0.125,-0.5,0.75]"
        && six.path_length === undefined && lengths.length === 0,
        JSON.stringify(six));
  const raw7 = tail(7, [0]);
  new DataView(raw7.evt!.raw.buffer).setUint32(SPAWN_HEADER + 0x14, 0x176, true);
  const seven = class13Tail(raw7, tables);
  check("behaviour 7 carries g_cam_path_length at the first dword's slot",
        seven.selector === 0x176 && seven.path_length === 240
        && lengths.join() === String(0x176) && seven.operand === undefined,
        JSON.stringify(seven));
  const eight = class13Tail(tail(8, [0]), tables);
  check("...and no other behaviour carries either",
        eight.operand === undefined && eight.path_length === undefined,
        JSON.stringify(eight));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);

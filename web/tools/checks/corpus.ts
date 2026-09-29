/**
 * The whole disc, decoded: every corpus-wide number the format documents
 * state, read through the library the exporter runs.
 *
 *     node tools/run_ts.mjs tools/checks/corpus.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `docs/re/method.md` Rule 3 says every format claim in `docs/formats/` is
 * backed by an exhaustive check rather than a sample, and lists the metrics.
 * This is that check. Each section walks every file of one format on the disc
 * with `src/hod2lib/`, and each metric is one that **collapses** when the
 * reading is wrong -- a wrong stride desynchronises a linear walk, a wrong
 * operand length lands a decoder on a stub, a wrong header claims bytes the
 * stream cannot produce.
 *
 * **Where a document states a number, the number is asserted exactly**, and a
 * failure names the document (`L65`): a changed count is either a changed
 * reader or a changed disc, and either is worth a person's attention. Where a
 * document states an invariant, the invariant is asserted over every record.
 *
 * * **`lz` and the container** (`formats/lz.md`, `formats/container.md`,
 *   `re/anomalies.md`). The census by kind -- 458 compressed, 192 raw and 6
 *   opaque in `pol/`; 335 compressed, 87 opaque, 47 BMP and 23 empty in
 *   `tex/` -- which is also the decompression test, because
 *   `container.classify` calls a file compressed only when `decompressFile`
 *   produced exactly the byte count its header declares: 793 files, 60,571,242
 *   bytes in and 131,562,208 out. 18,027 models parse out of the containers;
 *   every table size is a multiple of 32; the six opaque `pol/` files are the
 *   six `anomalies.md` names; each empty `tex/` file holds no data; the best
 *   ratio is 25.4x in `tex/scr_tv.bin`; and 865 files in the two directories
 *   have a first dword above their own size, up to 4.03 GB in
 *   `tex/st5_01b.bin` (`L22`).
 * * **`nl1`** (`formats/nl1.md`, `formats/texbank.md`). The parser the
 *   exporter runs, over every model of every unprefixed `pol/` file, reads the
 *   9,112 models, 41,463 meshes and 1,488,301 vertices the binary's own chain
 *   walk counts -- that walk is `mesh_walk.ts` -- with every triangle index in
 *   range and every position and UV finite. Every model is `objFormat` 1;
 *   `parameter_control` bit 0 is set on exactly the 903 untextured meshes,
 *   clear on the 40,560 textured ones, mirrored by ISP bit 22 on all 41,463,
 *   and the 33,875 vertices under it read `(0, 0)`. The textured meshes use
 *   only RGB565, ARGB4444 and ARGB1555, and none is mipmapped.
 * * **asset slots** (`formats/pipeline.md`). 326 live `pol/` files in the
 *   exe's table, and for 326 of 326 the entry count is the container's model
 *   count; the second copy of the name list from index 328 carries count 0.
 * * **`texbank`** (`formats/texbank.md`). The 303 banks that pair with a
 *   `pol/` file and have a descriptor table resolve exactly -- every texture
 *   inside the file, the last ending at its last byte -- and 23 `pol/` assets
 *   with a bank have no table.
 * * **`cam`** (`formats/cam.md`). 23 files, each at 100.0000 % byte
 *   coverage by `{offset table, curve, descriptor}`; 418 paths, 3,018 curves,
 *   44,800 keyframes, every path with every channel, every offset-table entry
 *   on a descriptor; 99.68 % of key times on the 60 Hz grid and the longest
 *   curve ending at frame 3600. The exe's binding: 23 files, each `u16` count
 *   the parser's path count, every slot mapping back through the `s8` table,
 *   the runs tiling 0-417 with `cp_demo` 0-17, `cp_st1`..`cp_st6` at
 *   32-54 / 55-120 / 121-162 / 163-202 / 203-216 / 217-232, `op_st1` 253-327
 *   and `op_train` 406-417, and the `s8` table resolving 23 distinct ids in 23
 *   runs.
 * * **`evt`** (`formats/evt.md`, `re/method.md`). The 10 scene files: the
 *   walk recovers each one's block count exactly as the exe's route table
 *   states it; 17,150 instructions decode with zero errors and no stub opcode;
 *   76 distinct opcodes, all inside the 96-entry table, whose five stubs are
 *   `0x00`, `0x2A`, `0x34`, `0x3C` and `0x4C`.
 * * **`mot`** (`formats/mot.md`). 49 banks, 1058 motions, 1058 blocks; the
 *   offsets ascend and stay in the file; 1058 of 1058 blocks divide exactly by
 *   a stride `(n*6+15) & ~3` can produce; the implied bone counts run 1..430
 *   over 25 distinct values.
 * * **`coli`** (`formats/coli.md`). The per-file table -- bytes, blobs,
 *   quads, 100.00 % coverage -- for the eight files the filename table names;
 *   126 groups, 2,516 quads, one group per blob; no vertex of 10,064 outside
 *   its group's AABB; the worst `|n.v + d|` 3.7e-01 with p99 5.1e-03; the
 *   worst `| |n| - 1 |` 6.8e-07; `axis` disagreeing with argmax|normal| on 2
 *   of 2,516; the surface-id census; and across stages 1-6, 113
 *   collision-set instructions -- 41 clearing, 72 carrying 86 pointers -- with
 *   86 of 86 landing on a blob header of their scene's own files.
 *
 * `root_pose.ts` also decodes the 1058 motion blocks, for what their roots
 * say; this holds the bank walk the count rests on.
 *
 * Exit 0 when everything held, 1 when anything did not, 3 with no game
 * directory.
 */
import { Checker, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import type { NodeAssetSource } from "../lib/node_io";
import { u32 } from "../../src/hod2lib/bytes";
import * as camlib from "../../src/hod2lib/cam";
import * as colilib from "../../src/hod2lib/coli";
import * as C from "../../src/hod2lib/container";
import * as evt from "../../src/hod2lib/evt";
import { ExeTables } from "../../src/hod2lib/exetab";
import * as mot from "../../src/hod2lib/mot";
import * as nl1 from "../../src/hod2lib/nl1";
import * as texbank from "../../src/hod2lib/texbank";

/** `1,488,301`: counts are read by people, not compared as hex. */
function n(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString("en-US") : String(v);
}

/**
 * Assert a count a document states. The failure says which document, so a
 * changed number is a pointer to the sentence that has to change with it.
 */
function stated(c: Checker, got: number, want: number, what: string,
                doc: string): boolean {
  return c.ok(got === want, got === want
    ? `${what}: ${n(got)}`
    : `${what}: ${n(got)}, where ${doc} states ${n(want)}`);
}

/** Assert that a list a check collected is empty, showing the first few. */
function none(c: Checker, bad: readonly string[], what: string): boolean {
  return c.ok(bad.length === 0, bad.length === 0 ? what
    : `${what}: ${bad.length} do not -- ${bad.slice(0, 6).join("; ")}`);
}

/** Two significant figures, the precision a document quotes a float to. */
function sig2(v: number): string {
  return v.toExponential(1);
}

interface Loaded {
  name: string;
  raw: Uint8Array;
  c: C.Container;
}

// ---------------------------------------------------------------------------
// lz and the container
// ---------------------------------------------------------------------------

/** What `formats/container.md`'s census states, per directory and kind. */
const CENSUS: Record<string, Record<string, number>> = {
  pol: { compressed: 458, raw: 192, blob: 6 },
  tex: { compressed: 335, blob: 87, bmp: 47, empty: 23 },
};

/** `re/anomalies.md` section 1b: the `pol/` files that are neither kind. */
const OPAQUE_POL = ["bg_adv19.bin", "komono_0.bin", "pol_boss2_hane_hod1.bin",
                    "pol_komono_suimonie.bin", "pol_znonoo.bin", "tv2.bin"];

async function loadDir(source: NodeAssetSource, dir: string): Promise<Loaded[]> {
  const out: Loaded[] = [];
  const names = (await source.list(dir)).filter((x) => x.endsWith(".bin")).sort();
  for (const name of names) {
    const raw = await source.read(`${dir}/${name}`);
    out.push({ name, raw, c: C.load(raw) });
  }
  return out;
}

/** Whatever else `pol/` and `tex/` hold: `pol/files.txt`, the build listing. */
async function otherFiles(source: NodeAssetSource): Promise<[string, Uint8Array][]> {
  const out: [string, Uint8Array][] = [];
  for (const dir of ["pol", "tex"]) {
    for (const name of (await source.list(dir)).filter((x) => !x.endsWith(".bin")).sort()) {
      out.push([`${dir}/${name}`, await source.read(`${dir}/${name}`)]);
    }
  }
  return out;
}

function checkLz(c: Checker, pol: Loaded[], tex: Loaded[],
                 others: [string, Uint8Array][]): void {
  console.log("\nlz and the container");
  let files = 0, bytesIn = 0, bytesOut = 0, models = 0;
  let bestRatio = 0, bestName = "";
  let sizeLike = 0, sizeLikeMax = 0, sizeLikeMaxName = "";
  const wrongLength: string[] = [];
  for (const [dir, list] of [["pol", pol], ["tex", tex]] as const) {
    const kinds = new Map<string, number>();
    for (const { name, raw, c: box } of list) {
      kinds.set(box.kind, (kinds.get(box.kind) ?? 0) + 1);
      // A first dword above the file size is what makes `classify` try the
      // decompressor, so it is the untrusted size header `L22` is about.
      const head = raw.length >= 4 ? u32(raw, 0) : 0;
      if (head > raw.length) {
        sizeLike++;
        if (head > sizeLikeMax) { sizeLikeMax = head; sizeLikeMaxName = `${dir}/${name}`; }
      }
      if (box.kind === C.COMPRESSED) {
        files++;
        bytesIn += raw.length;
        bytesOut += box.data.length;
        if (box.data.length !== head) wrongLength.push(`${dir}/${name}`);
        const ratio = box.data.length / raw.length;
        if (ratio > bestRatio) { bestRatio = ratio; bestName = `${dir}/${name}`; }
      }
      if (box.kind === C.RAW || box.kind === C.COMPRESSED) models += box.models.length;
    }
    for (const [kind, want] of Object.entries(CENSUS[dir]!)) {
      stated(c, kinds.get(kind) ?? 0, want, `${dir}/ files classified ${kind}`,
             "formats/container.md");
    }
    const extra = [...kinds.keys()].filter((k) => !(k in CENSUS[dir]!));
    none(c, extra, `${dir}/ holds no kind the census does not list`);
  }
  stated(c, files, 793, "compressed files, every one the size its header declares",
         "formats/lz.md and re/method.md");
  none(c, wrongLength, "each compressed file's output length equals its u32 header");
  stated(c, bytesIn, 60571242, "compressed bytes in", "formats/lz.md");
  stated(c, bytesOut, 131562208, "decompressed bytes out", "formats/lz.md");
  stated(c, models, 18027, "models parsed out of the decompressed containers",
         "formats/lz.md and formats/container.md");
  c.ok(bestName === "tex/scr_tv.bin" && bestRatio.toFixed(1) === "25.4",
       `the best compression ratio is ${bestRatio.toFixed(1)}x, in ${bestName}`
       + (bestName === "tex/scr_tv.bin" && bestRatio.toFixed(1) === "25.4" ? ""
         : "; src/hod2lib/lz.ts states 25.4x in tex/scr_tv.bin"));
  // The documents' 865 counts every file in the two directories, and one of
  // them is `pol/files.txt`, whose first four ASCII bytes read as a size too.
  const textLike = others.filter(([, raw]) => raw.length >= 4 && u32(raw, 0) > raw.length);
  stated(c, sizeLike + textLike.length, 865,
         "files in pol/ and tex/ whose first dword exceeds the file's own size",
         "src/hod2lib/lz.ts and LESSONS L22");
  c.note(`${sizeLike} of them are .bin assets; the rest are ${textLike.map(([x]) => x).join(", ") || "none"}`);
  c.ok(sizeLikeMaxName === "tex/st5_01b.bin"
       && (sizeLikeMax / 1e9).toFixed(2) === "4.03",
       `the largest of those claims ${(sizeLikeMax / 1e9).toFixed(2)} GB, in ${sizeLikeMaxName}`);

  const opaque = pol.filter((x) => x.c.kind === C.BLOB).map((x) => x.name).sort();
  c.ok(opaque.join() === OPAQUE_POL.join(), opaque.join() === OPAQUE_POL.join()
    ? `the opaque pol/ files are re/anomalies.md's six: ${opaque.join(", ")}`
    : `${opaque.length} opaque pol/ files, ${opaque.slice(0, 8).join(", ")}; `
      + `re/anomalies.md names six, ${OPAQUE_POL.join(", ")}`);
  // Twelve are a four-byte zero size header and eleven are zero bytes long;
  // either way there is nothing in them.
  const notEmpty = tex.filter((x) => x.c.kind === C.EMPTY)
    .filter((x) => x.raw.length > 4 || x.raw.some((b) => b !== 0)).map((x) => x.name);
  none(c, notEmpty, "every empty tex/ file holds no data: no bytes, or a zero size header");

  const badTable: string[] = [];
  for (const { name, c: box } of pol) {
    if (box.kind !== C.RAW && box.kind !== C.COMPRESSED) continue;
    const first = u32(box.data, 0);
    if (first < 0x20 || first % 32) badTable.push(`${name} ${hex(first)}`);
  }
  none(c, badTable, "every pol/ container's table is at least 0x20 and a multiple of 32");
}

// ---------------------------------------------------------------------------
// nl1
// ---------------------------------------------------------------------------

/** `formats/texbank.md`'s "What the game actually uses" pixel formats. */
const MODEL_PIXEL_FORMATS = ["ARGB1555", "ARGB4444", "RGB565"];

/**
 * The corpus `formats/nl1.md` measures, read by the parser the exporter runs.
 * The binary's own chain walk over the same models is `mesh_walk.ts`'s; this
 * holds `nl1.parseContainer` to the totals that walk gives, and to what the
 * documents say of the meshes it reads.
 */
function checkNl1(c: Checker, pol: Loaded[]): void {
  console.log("\nnl1");
  let models = 0, parsedModels = 0, parsedMeshes = 0, parsedVertices = 0;
  let notSuperIndex = 0;
  const badIndex: string[] = [];
  const nonFinite: string[] = [];
  let bit0Set = 0, bit0SetUntextured = 0, bit0Clear = 0, bit0ClearTextured = 0;
  let isp22Agrees = 0, zeroUv = 0;
  const zeroUvNot: string[] = [];
  const pixfmt = new Set<string>();
  let mipmapped = 0;

  for (const { name, c: box } of pol) {
    // The `pol_` twins are disabled table entries (formats/pipeline.md); the
    // corpus the documents measure is the unprefixed set.
    if (name.startsWith("pol_")) continue;
    if (box.kind !== C.RAW && box.kind !== C.COMPRESSED) continue;
    for (const [start] of box.models) {
      models++;
      if (u32(box.data, start) !== 1) notSuperIndex++;
    }
    const parsed = nl1.parseContainer(box);
    parsedModels += parsed.length;
    parsed.forEach((m, i) => {
      parsedMeshes += m.meshes.length;
      parsedVertices += m.vertexCount;
      for (const me of m.meshes) {
        const nv = me.vertices.length;
        if (me.triangles.some((t) => t.some((x) => x < 0 || x >= nv))) {
          badIndex.push(`${name} model ${i} mesh ${hex(me.offset)}`);
        }
        if (!me.vertices.every((v) => [...v.pos, ...v.uv].every(Number.isFinite))) {
          nonFinite.push(`${name} model ${i} mesh ${hex(me.offset)}`);
        }
        const bit0 = me.parameterControl & 1;
        if (((me.ispTsp >>> 22) & 1) === bit0) isp22Agrees++;
        if (bit0) {
          bit0Set++;
          if (me.textureId === -1) bit0SetUntextured++;
          for (const v of me.vertices) {
            zeroUv++;
            if (v.uv[0] !== 0 || v.uv[1] !== 0) zeroUvNot.push(`${name} model ${i}`);
          }
        } else {
          bit0Clear++;
          if (me.textureId >= 0) bit0ClearTextured++;
        }
        if (me.textureId >= 0) {
          pixfmt.add(me.pixelFormatName);
          if (me.mipmapped) mipmapped++;
        }
      }
    });
  }

  const walk = "formats/nl1.md (How the game itself walks a model)";
  stated(c, models, 9112, "models in the unprefixed pol/ containers", walk);
  stated(c, parsedModels, 9112, "models nl1.parseContainer reads", walk);
  stated(c, parsedMeshes, 41463, "meshes it reads", walk);
  stated(c, parsedVertices, 1488301, "vertices it reads", walk);
  none(c, badIndex, "every triangle index is inside its mesh");
  none(c, nonFinite, "every position and UV is finite");
  stated(c, notSuperIndex, 0, "models whose objFormat is not 1 (Super Index)",
         "formats/nl1.md (Validity check)");
  const bit = "formats/nl1.md (16-bit UVs)";
  stated(c, bit0Set, 903, "meshes with parameter_control bit 0 set", bit);
  stated(c, bit0SetUntextured, 903, "...of which texture_id is -1", bit);
  stated(c, bit0Clear, 40560, "meshes with it clear", bit);
  stated(c, bit0ClearTextured, 40560, "...of which texture_id is >= 0", bit);
  stated(c, isp22Agrees, 41463, "meshes whose ISP bit 22 equals that bit", bit);
  stated(c, zeroUv, 33875, "vertices under bit 0", bit);
  none(c, zeroUvNot, "each of them reads UV (0, 0)");
  const fmts = [...pixfmt].sort();
  c.ok(fmts.join() === MODEL_PIXEL_FORMATS.join(),
       `textured meshes use ${fmts.join(", ")}`
       + (fmts.join() === MODEL_PIXEL_FORMATS.join() ? ""
         : `; formats/texbank.md states ${MODEL_PIXEL_FORMATS.join(", ")} only`));
  stated(c, mipmapped, 0, "mipmapped textured meshes", "formats/texbank.md");
}

// ---------------------------------------------------------------------------
// asset slots and texture banks
// ---------------------------------------------------------------------------

/** Where `ExeTables.polFiles` stops: the second copy of the name list. */
const POL_SECOND_COPY = 328;

function checkSlots(c: Checker, exe: ExeTables, pol: Loaded[]): void {
  console.log("\nasset slots");
  const byName = new Map(pol.map((x) => [x.name, x.c]));
  const files = exe.polFiles();
  const doc = "formats/pipeline.md and re/method.md";
  stated(c, files.size, 326, "live pol files in the exe's table", doc);
  const mismatch: string[] = [];
  let agree = 0;
  for (const [i, [name, cnt]] of files) {
    const box = byName.get(name);
    const found = box ? box.models.length : -1;
    if (found === cnt) agree++;
    else mismatch.push(`${i} ${name}: exe ${cnt}, container ${found}`);
  }
  stated(c, agree, 326, "files whose exe entry count is the container's model count", doc);
  none(c, mismatch, "no entry count differs from its container");

  const firstNames = new Set<string>();
  for (let i = 0; i < POL_SECOND_COPY; i++) {
    const p = exe.ru32(ExeTables.POL_NAME_TABLE + i * 4);
    const name = p ? exe.cstr(p) : null;
    if (name) firstNames.add(name);
  }
  const live: string[] = [];
  let copies = 0;
  for (let i = POL_SECOND_COPY; i < ExeTables.MAX_POL_FILES; i++) {
    const p = exe.ru32(ExeTables.POL_NAME_TABLE + i * 4);
    const name = p ? exe.cstr(p) : null;
    if (!name) continue;
    copies++;
    const cnt = exe.ru16(ExeTables.POL_ENTRY_COUNT + i * 2) ?? 0;
    if (cnt !== 0 || !firstNames.has(name)) live.push(`${i} ${name} count ${cnt}`);
  }
  c.ok(copies > 0 && live.length === 0,
       `indices from ${POL_SECOND_COPY} are a second copy of the name list with count 0 `
       + `(${copies} names)` + (live.length ? `; not ${live.slice(0, 4).join(", ")}` : ""));
}

function checkTexbank(c: Checker, exe: ExeTables, pol: Loaded[],
                      tex: Loaded[]): void {
  console.log("\ntexbank");
  const polStems = new Set(pol.map((x) => x.name.slice(0, -4)));
  const texByStem = new Map(tex.map((x) => [x.name.slice(0, -4), x]));
  let paired = 0, exact = 0, coverage = 0;
  const off: string[] = [];
  for (const [stem] of exe.banks) {
    const entries = exe.entries(stem);
    const t = texByStem.get(stem);
    if (!entries.length || !t || !polStems.has(stem)) continue;
    paired++;
    const data = t.c.kind === C.COMPRESSED ? t.c.data : t.raw;
    const bank = texbank.bankFromExe(data, entries);
    const inside = entries.every((e) =>
      e.offset + texbank.descSize(bank.descs.get(e.index)!) <= data.length);
    if (inside && bank.residual === 0) exact++;
    else off.push(`${stem}: ${bank.residual} bytes ${bank.residual < 0 ? "over" : "short"}`);
    coverage += (data.length - bank.residual) / data.length;
  }
  const doc = "formats/texbank.md and re/method.md";
  stated(c, paired, 303, "banks with a descriptor table and a pol/ file", doc);
  stated(c, exact, 303, "...resolving exactly, every texture inside, the last at the file's end", doc);
  none(c, off, "no model bank over- or under-runs its file");
  c.ok(paired > 0 && (coverage / paired).toFixed(3) === "1.000",
       `mean coverage ${(coverage / Math.max(1, paired)).toFixed(3)}`);
  let noTable = 0;
  for (const stem of polStems) {
    if (stem.startsWith("pol_") || !texByStem.has(stem)) continue;
    if (!exe.entries(stem).length) noTable++;
  }
  stated(c, noTable, 23, "pol/ assets with a tex/ bank and no descriptor table",
         "formats/texbank.md (Non-texture entries)");
}

// ---------------------------------------------------------------------------
// cam
// ---------------------------------------------------------------------------

/** `formats/cam.md`'s slot ranges, `[first, last]`, for the files it names. */
const CAM_RANGES: Record<string, [number, number]> = {
  "cp_demo.bin": [0, 17],
  "cp_st1.bin": [32, 54], "cp_st2.bin": [55, 120], "cp_st3.bin": [121, 162],
  "cp_st4.bin": [163, 202], "cp_st5.bin": [203, 216], "cp_st6.bin": [217, 232],
  "op_st1.bin": [253, 327], "op_train.bin": [406, 417],
};

async function checkCam(c: Checker, source: NodeAssetSource,
                        exe: ExeTables): Promise<void> {
  console.log("\ncam");
  const names = (await source.list("cam")).filter((x) => x.endsWith(".bin")).sort();
  const files = new Map<string, camlib.CamFile>();
  const shortCover: string[] = [];
  const failed: string[] = [];
  const noChannel: string[] = [];
  const offTable: string[] = [];
  let bytes = 0, covered = 0, paths = 0, curves = 0, keys = 0, onGrid = 0;
  let longest = -Infinity;
  for (const name of names) {
    let f: camlib.CamFile;
    try {
      f = camlib.parse(await source.read(`cam/${name}`), name);
    } catch (exc) {
      failed.push(`${name}: ${(exc as Error).message}`);
      continue;
    }
    files.set(name, f);
    let cov = f.base;
    for (const cv of f.curves.values()) cov += cv.size;
    for (const [, span] of f.descriptorSpans) cov += span;
    bytes += f.raw.length;
    covered += cov;
    if (cov !== f.raw.length) shortCover.push(`${name} ${n(cov)} of ${n(f.raw.length)}`);
    paths += f.paths.length;
    curves += f.curves.size;
    for (const cv of f.curves.values()) {
      for (const k of cv.keys) {
        keys++;
        if (Math.abs(k.time - Math.round(k.time)) <= 0.01) onGrid++;
        if (k.time > longest) longest = k.time;
      }
    }
    for (const p of f.paths) {
      if (p.channels.size !== f.channelNames.length) noChannel.push(`${name} path ${p.index}`);
    }
    noChannel.push(...f.warnings.map((w) => `${name}: ${w}`));
    const starts = new Set(f.descriptorSpans.map(([o]) => o));
    for (const o of f.pathOffsets) {
      if (o % 4 || !starts.has(o)) offTable.push(`${name} ${hex(o)}`);
    }
  }
  const doc = "formats/cam.md";
  stated(c, names.length, 23, "cam/ files on disk", `${doc} (Integrity) and src/hod2lib/cam.ts`);
  none(c, failed, "every file parses with every keyframe word finite and sane");
  none(c, shortCover, "every byte of every file is claimed by the table, a curve or a descriptor");
  c.ok(bytes > 0 && covered === bytes,
       `byte coverage ${(100 * covered / Math.max(1, bytes)).toFixed(4)} % (${n(covered)} of ${n(bytes)})`);
  stated(c, paths, 418, "paths", doc);
  stated(c, curves, 3018, "curves", doc);
  stated(c, keys, 44800, "keyframes", doc);
  none(c, noChannel, "every path names a curve for every channel");
  none(c, offTable, "every offset-table entry is dword aligned and starts a descriptor");
  const grid = (100 * onGrid / Math.max(1, keys)).toFixed(2);
  c.ok(grid === "99.68", `${grid} % of key times sit within 0.01 of a 60 Hz frame`
       + (grid === "99.68" ? "" : `; ${doc} (Timebase) states 99.68 %`));
  stated(c, longest, 3600, "the longest curve ends at frame", `${doc} (Timebase)`);

  // -- the exe's binding ------------------------------------------------------
  const listed = exe.camFiles();
  stated(c, listed.size, 23, "cam files the exe lists", doc);
  const countOff: string[] = [];
  const backOff: string[] = [];
  const runs: [string, number, number, number][] = [];
  for (const [, [name, cnt]] of listed) {
    const f = files.get(name);
    if (!f || f.paths.length !== cnt) {
      countOff.push(`${name}: exe ${cnt}, file ${f ? f.paths.length : "missing"}`);
    }
    const slots = exe.camSlotsFor(name);
    for (const s of slots) if (exe.slotCamFile(s) !== name) backOff.push(`${name} slot ${s}`);
    runs.push([name, Math.min(...slots), Math.max(...slots), slots.length]);
  }
  none(c, countOff, "each file's u16 path count is the number of paths the parser finds");
  none(c, backOff, "every slot in a file's forward list maps back to it through the s8 table");
  runs.sort((a, b) => a[1] - b[1]);
  let next = 0;
  const gaps: string[] = [];
  for (const [name, lo, hi, cnt] of runs) {
    if (lo !== next || hi - lo + 1 !== cnt) gaps.push(`${name} ${lo}-${hi} (${cnt})`);
    next = hi + 1;
  }
  c.ok(gaps.length === 0 && next === 418,
       `the files' slot runs tile 0-${next - 1} contiguously, with no gap or overlap`
       + (gaps.length ? `; not ${gaps.slice(0, 4).join(", ")}` : ""));
  for (const [name, [lo, hi]] of Object.entries(CAM_RANGES)) {
    const r = runs.find(([x]) => x === name);
    c.ok(r !== undefined && r[1] === lo && r[2] === hi,
         `${name} owns slots ${r ? `${r[1]}-${r[2]}` : "none"}`
         + (r && r[1] === lo && r[2] === hi ? "" : `; ${doc} states ${lo}-${hi}`));
  }
  // `DAT_004C479C` is one byte per global path and has no terminator: read
  // exactly as many bytes as there are paths.
  const r8 = exe.v2r(ExeTables.SLOT_TO_CAM);
  const ids: [number, number][] = [];
  if (r8 !== null) {
    for (let i = 0; i < paths; i++) {
      const id = (exe.data[r8 + i]! << 24) >> 24;
      const last = ids[ids.length - 1];
      if (last && last[0] === id) last[1]++;
      else ids.push([id, 1]);
    }
  }
  const distinct = new Set(ids.map(([id]) => id)).size;
  stated(c, ids.length, 23, "runs in the s8 slot -> file table", "formats/evt.md and formats/cam.md");
  stated(c, distinct, 23, "distinct file ids in it, none repeated", "formats/evt.md and formats/cam.md");
}

// ---------------------------------------------------------------------------
// evt
// ---------------------------------------------------------------------------

/** `formats/evt.md`: the dispatch slots that point at the empty stub. */
const STUBS = [0x00, 0x2a, 0x34, 0x3c, 0x4c];

async function checkEvt(c: Checker, source: NodeAssetSource,
                        exe: ExeTables): Promise<void> {
  console.log("\nevt");
  const stubs = Object.entries(evt.OPCODES)
    .filter(([, [, kind]]) => kind === "bad").map(([op]) => Number(op)).sort((a, b) => a - b);
  c.ok(stubs.join() === STUBS.join(),
       `evt.OPCODES's stub slots are ${stubs.map((x) => hex(x, 2)).join(", ")}`);
  const table = Object.keys(evt.OPCODES).length;
  stated(c, table, 96, "entries in evt.OPCODES, one per dispatch slot", "src/hod2lib/evt.ts");

  let files = 0, instructions = 0;
  const blockCount: string[] = [];
  const warnings: string[] = [];
  const stubHits: string[] = [];
  const outside: string[] = [];
  const used = new Set<number>();
  for (let scene = 0; scene < ExeTables.SCENE_COUNT; scene++) {
    const name = exe.sceneEvtFile(scene);
    if (!name) continue;
    if (!(await source.exists(`evt/${name}`))) {
      warnings.push(`scene ${scene}: ${name} is missing`);
      continue;
    }
    files++;
    const raw = await source.read(`evt/${name}`);
    const expected = exe.sceneBlockCount(scene);
    // The file alone, walked while entries are pointer-or-hole...
    const walked = evt.parse(raw, name, null);
    if (walked.blocks.length !== expected) {
      blockCount.push(`${name}: the walk finds ${walked.blocks.length}, the route table ${expected}`);
    }
    // ...and the parse the exporter runs, sized by the exe.
    const f = evt.parse(raw, name, expected);
    warnings.push(...f.warnings.map((w) => `${name}: ${w}`));
    for (const b of f.blocks) {
      if (b.offset < 0) continue;
      for (const prog of b.programs) {
        for (const ins of prog) {
          instructions++;
          used.add(ins.opcode);
          if (STUBS.includes(ins.opcode)) stubHits.push(`${name} ${hex(ins.offset)}`);
          if (!(ins.opcode >= 0 && ins.opcode < 96)) outside.push(`${name} ${hex(ins.opcode)}`);
        }
      }
    }
  }
  const doc = "formats/evt.md";
  stated(c, files, 10, "scene evt files", `${doc} (the root array)`);
  none(c, blockCount, "each file's walk recovers the block count its route table states");
  none(c, warnings, "every stream decodes with zero errors");
  stated(c, instructions, 17150, "instructions decoded", "re/method.md and src/hod2lib/evt.ts");
  none(c, stubHits, "no stream reaches a stub opcode");
  none(c, outside, "every opcode is inside the 96-entry dispatch table");
  stated(c, used.size, 76, "distinct opcodes used", doc);
}

// ---------------------------------------------------------------------------
// mot
// ---------------------------------------------------------------------------

async function checkMot(c: Checker, source: NodeAssetSource,
                        exe: ExeTables): Promise<void> {
  console.log("\nmot");
  // `FUN_00412F50` loads `DAT_004E2C40[motion]`, so the real banks are the
  // values in that table; a name with no id list is a camera-path entry of
  // the shared filename table, not a bank.
  const mb = exe.v2r(ExeTables.MOTION_BANK_OF);
  const real = new Set<number>();
  if (mb !== null) {
    for (let m = 0; m < 2048; m++) {
      const b = exe.data[mb + m];
      if (b !== undefined && b < 64) real.add(b);
    }
  }
  const banks = exe.motionBanks();
  let loaded = 0, motions = 0, blocks = 0, divide = 0;
  const bones = new Set<number>();
  const bad: string[] = [];
  for (const b of [...real].sort((x, y) => x - y)) {
    const rec = banks.get(b);
    if (!rec) continue;
    const [name, ids] = rec;
    if (!(await source.exists(`mot/${name}`))) continue;
    const bank = await mot.loadBank(source, name, ids);
    if (bank === null) {
      bad.push(`${name}: shorter than its own header`);
      continue;
    }
    loaded++;
    motions += ids.length;
    const offs = ids.map((m) => bank.offsets.get(m)!);
    for (let i = 0; i + 1 < offs.length; i++) {
      if (offs[i]! >= offs[i + 1]!) { bad.push(`${name}: offsets do not ascend at ${i}`); break; }
    }
    for (const o of offs) {
      if (!(ids.length * 4 <= o && o < bank.size)) { bad.push(`${name}: offset ${o} outside`); break; }
    }
    for (const m of ids) {
      blocks++;
      const b2 = bank.impliedBoneCount(m);
      if (b2 !== null) { divide++; bones.add(b2); }
      else bad.push(`${name}: motion ${m} declares ${bank.frameCount(m)} frames at no real stride`);
    }
  }
  const doc = "formats/mot.md (Verification)";
  stated(c, loaded, 49, "banks", doc);
  stated(c, motions, 1058, "motions", doc);
  stated(c, blocks, 1058, "blocks", doc);
  stated(c, divide, 1058, "blocks whose frame count divides their size at a real stride",
         "formats/mot.md and src/hod2lib/mot.ts");
  none(c, bad, "every bank's offsets ascend inside the file and every block divides");
  const bs = [...bones];
  c.ok(bs.length === 25 && Math.min(...bs) === 1 && Math.max(...bs) === 430,
       `implied bone counts ${Math.min(...bs)}..${Math.max(...bs)} (${bs.length} distinct)`
       + (bs.length === 25 && Math.min(...bs) === 1 && Math.max(...bs) === 430 ? ""
         : `; ${doc} states 1..430 (25 distinct)`));
}

// ---------------------------------------------------------------------------
// coli
// ---------------------------------------------------------------------------

/** `ColiLoadFileByIndex`'s filename table; `coli.bin` is not in it. */
const COLI_NAMES = 0x004d1cc4;

/** `formats/coli.md`'s corpus table: bytes, blobs, quads. */
const COLI_FILES: Record<string, [number, number, number]> = {
  "coli0.bin": [5184, 9, 68],
  "coli1.bin": [9224, 16, 121],
  "coli2.bin": [53160, 48, 717],
  "coli3.bin": [67976, 16, 937],
  "coli4.bin": [44080, 23, 602],
  "coli5.bin": [1032, 3, 13],
  "coli6.bin": [3504, 6, 46],
  "coliT.bin": [1024, 5, 12],
};

/** `formats/coli.md`'s surface-id census over the eight loaded files. */
const SURFACES: Record<number, number> = {
  0: 5, 2: 110, 3: 6, 5: 4, 50: 29, 52: 465, 53: 874, 55: 276, 56: 266,
  60: 137, 61: 321, 90: 7, 99: 16,
};

async function checkColi(c: Checker, source: NodeAssetSource,
                         exe: ExeTables): Promise<void> {
  console.log("\ncoli");
  const doc = "formats/coli.md";
  const named: string[] = [];
  for (let i = 0; i < 16; i++) {
    const p = exe.ru32(COLI_NAMES + i * 4);
    const name = p ? exe.cstr(p) : null;
    if (!name) break;
    named.push(name);
  }
  c.ok(named.join() === Object.keys(COLI_FILES).join(),
       `the loader's filename table names ${named.join(", ")}, and not coli.bin`);

  const files = new Map<string, colilib.ColiFile>();
  let groups = 0, quads = 0, vertices = 0, outsideBox = 0, degenerate = 0;
  let axisDisagree = 0, worstNorm = 0;
  const planeErr: number[] = [];
  const multiGroup: string[] = [];
  const surfaces = new Map<number, number>();
  for (const [name, [bytes, blobs, nq]] of Object.entries(COLI_FILES)) {
    const f = await colilib.load(source, `coli/${name}`, name);
    files.set(name, f);
    const nb = f.blobs.length;
    const got = f.quads.length;
    const ok = f.raw.length === bytes && nb === blobs && got === nq && f.coverage === 1;
    c.ok(ok, `${name}: ${n(f.raw.length)} bytes, ${nb} blobs, ${got} quads, `
         + `${(100 * f.coverage).toFixed(2)} %`
         + (ok ? "" : `; ${doc} states ${n(bytes)}, ${blobs}, ${nq}, 100.00 %`));
    for (const b of f.blobs) {
      if (b.groups.length !== 1) multiGroup.push(`${name} ${hex(b.offset)}`);
      for (const g of b.groups) {
        groups++;
        for (const q of g.quads) {
          quads++;
          surfaces.set(q.surface, (surfaces.get(q.surface) ?? 0) + 1);
          for (const v of q.verts) {
            vertices++;
            if (![0, 1, 2].every((k) => g.aabbMin[k]! - 1 <= v[k]! && v[k]! <= g.aabbMax[k]! + 1)) {
              outsideBox++;
            }
          }
          for (const v of q.verts) {
            planeErr.push(Math.abs(q.normal[0] * v[0] + q.normal[1] * v[1]
                                   + q.normal[2] * v[2] + q.planeD));
          }
          const len = Math.hypot(...q.normal);
          if (len <= 0.5) { degenerate++; continue; }
          worstNorm = Math.max(worstNorm, Math.abs(len - 1));
          let arg = 0;
          for (const k of [1, 2]) if (Math.abs(q.normal[k]!) > Math.abs(q.normal[arg]!)) arg = k;
          if (arg !== q.axis) axisDisagree++;
        }
      }
    }
  }
  stated(c, groups, 126, "groups", doc);
  stated(c, quads, 2516, "quads", doc);
  none(c, multiGroup, "every blob holds exactly one group");
  stated(c, vertices, 10064, "quad vertices", `${doc} (Validation)`);
  stated(c, outsideBox, 0, "vertices outside their group's AABB", `${doc} (Validation)`);
  planeErr.sort((a, b) => a - b);
  const worst = planeErr[planeErr.length - 1] ?? 0;
  const p99 = planeErr[Math.floor(0.99 * planeErr.length)] ?? 0;
  c.ok(sig2(worst) === "3.7e-1" && sig2(p99) === "5.1e-3",
       `worst |n.v + d| ${sig2(worst)}, p99 ${sig2(p99)}`
       + (sig2(worst) === "3.7e-1" && sig2(p99) === "5.1e-3" ? ""
         : `; ${doc} states 3.7e-01, p99 5.1e-03`));
  c.ok(sig2(worstNorm) === "6.8e-7", `worst | |n| - 1 | ${sig2(worstNorm)}`
       + (sig2(worstNorm) === "6.8e-7" ? "" : `; ${doc} states 6.8e-07`));
  stated(c, quads - axisDisagree, 2514, "quads whose axis tag is argmax|normal|",
         `${doc} (Validation)`);
  c.note(`${degenerate} quads have a zero-length normal and so no argmax to disagree with`);
  const census = [...surfaces].sort((a, b) => a[0] - b[0]);
  const want = Object.entries(SURFACES).map(([k, v]) => [Number(k), v]);
  const shown = census.slice(0, 16).map(([id, cnt]) => `${id} x${cnt}`).join(", ")
    + (census.length > 16 ? `, ... ${census.length} ids` : "");
  c.ok(JSON.stringify(census) === JSON.stringify(want),
       JSON.stringify(census) === JSON.stringify(want)
         ? `the surface-id census is ${doc}'s: ${shown}`
         : `the surface-id census is ${shown}; ${doc} states `
           + want.map(([id, cnt]) => `${id} x${cnt}`).join(", "));

  // -- the evt -> coli link ---------------------------------------------------
  let instr = 0, clear = 0, carrying = 0, pointers = 0, land = 0;
  const miss: string[] = [];
  for (let scene = 0; scene < 6; scene++) {
    const name = exe.sceneEvtFile(scene);
    if (!name) continue;
    const [common, own] = colilib.sceneFiles(scene);
    const f = evt.parse(await source.read(`evt/${name}`), name, exe.sceneBlockCount(scene));
    for (const b of f.blocks) {
      if (b.offset < 0) continue;
      for (const prog of b.programs) {
        for (const ins of prog) {
          if (ins.opcode !== 0x10 && ins.opcode !== 0x11) continue;
          instr++;
          const ptrs = ins.raw.filter((w) => w !== evt.TERM);
          if (ptrs.length) carrying++;
          else clear++;
          for (const w of ptrs) {
            pointers++;
            if (colilib.pointerToOffset(w, files.get(common)!, files.get(own)!)) land++;
            else miss.push(`${name} ${hex(ins.offset)}: ${hex(w, 8)}`);
          }
        }
      }
    }
  }
  const tooling = `${doc} (Tooling)`;
  stated(c, instr, 113, "collision-set instructions in stages 1-6", tooling);
  stated(c, clear, 41, "...clearing the set", tooling);
  stated(c, carrying, 72, "...carrying pointers", tooling);
  stated(c, pointers, 86, "pointers", `${doc} and src/hod2lib/coli.ts`);
  stated(c, land, 86, "pointers landing exactly on a blob header of their scene's files",
         `${doc} and src/hod2lib/coli.ts`);
  none(c, miss, "no pointer misses");
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dir = gameDirOrSkip("corpus");
  const { source, exe } = await openGame(dir);
  const c = new Checker("corpus");
  const pol = await loadDir(source, "pol");
  const tex = await loadDir(source, "tex");
  checkLz(c, pol, tex, await otherFiles(source));
  checkNl1(c, pol);
  checkSlots(c, exe, pol);
  checkTexbank(c, exe, pol, tex);
  await checkCam(c, source, exe);
  await checkEvt(c, source, exe);
  await checkMot(c, source, exe);
  await checkColi(c, source, exe);
  c.finish();
}

await main();

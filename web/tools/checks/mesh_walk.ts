/**
 * The binary's own mesh-chain walk, replayed over every model in the game.
 *
 *     node tools/run_ts.mjs tools/checks/mesh_walk.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * Two routines walk a loaded model's mesh chain -- `ModelFlipStripCullingParity`
 * (`FUN_00419270`) at load and `WalkMeshChainAndDraw` (`FUN_004A7EF0`) to
 * draw -- and between them they state the whole traversal in three rules: a
 * chain word with bit 31 set is a 0x50-byte mesh header whose geometry runs
 * `mesh_data_size & ~3` bytes; inside it an 8-byte strip header
 * `{flags, count}` carries `count` records, or `count * 3` when `flags & 8`;
 * and a record is 32 bytes when bit 0 of its first dword is set and an 8-byte
 * back-reference when it is clear. Nothing else is consulted -- not
 * `parameter_control`, not the shading mode, not a 16-bit-UV flag.
 *
 * This replays exactly those rules over every model `hod2lib/container.ts`
 * finds in `pol/`, and requires each mesh's walk to land on the mesh's
 * declared end. A wrong stride desynchronises a linear walk at once, so the
 * metric collapses rather than degrading.
 *
 * What this asserts, and the statement each assertion guards
 * (`docs/formats/nl1.md`, "How the game itself walks a model"):
 *
 *  * **The walk lands exactly on every declared mesh end**, with no strip
 *    header at chain level and no mesh header inside a mesh's geometry.
 *  * **The corpus it walks**: 9,112 models, 41,463 meshes, 278,807 strips,
 *    1,488,301 vertices and 447,930 back-references -- the numbers the doc
 *    quotes from this walk.
 *  * **The back-reference test is `(word0 & 1) == 0`, and the reference
 *    addon's `(word0 >> 20) == 0x5FF` agrees on every one of them.**
 *  * **No mesh sets the low bits of `mesh_data_size`**, though both walkers
 *    mask them.
 *  * **`parameter_control` bit 0 is set on 903 meshes and changes no
 *    stride** -- they walk clean with everything else ("16-bit UVs -- SOLVED").
 *  * **2,976 strips set bit 8**, the environment-mapping bit ("Strip control
 *    word").
 */
import { gameDirOrSkip, openGame, Checker } from "../lib/exe_check";
import { polFiles } from "./lib_d3d";
import * as C from "../../src/hod2lib/container";
import { u32 } from "../../src/hod2lib/bytes";
import { LZError } from "../../src/hod2lib/lz";

/** `nl1.md`: what the walk sees, over the whole of `pol/`. */
const EXPECT = {
  models: 9112,
  meshes: 41463,
  strips: 278807,
  vertices: 1488301,
  backRefs: 447930,
  pcwBit0Meshes: 903,
  envMapStrips: 2976,
};

const MESH_HEADER = 0x50;
const CHAIN_START = 0x18;

class Desync extends Error {}

/** A count, compared and printed in decimal. */
function count(c: Checker, got: number, want: number, what: string): boolean {
  return c.ok(got === want, `${what}: ${got}` + (got === want ? "" : `, expected ${want}`));
}

interface Stats {
  meshes: number;
  strips: number;
  vertices: number;
  backRefs: number;
  heuristicMisses: number;
  unalignedSize: number;
  pcwBit0Meshes: number;
  envMapStrips: number;
  /**
   * Meshes with some bit-8 strips and some without. `ModelUVsFromViewNormals`
   * tests each strip, and the exporter marks the primitive
   * (`nl1.envUvRewritten`), which is the same thing only while this is 0.
   */
  mixedEnvMeshes: number;
}

/** `ModelFlipStripCullingParity`'s walk, with every invariant it implies. */
function walkModel(b: Uint8Array, s: Stats): void {
  let pos = CHAIN_START;
  for (;;) {
    if (pos + 4 > b.length) throw new Desync(`ran off the end at 0x${pos.toString(16)}`);
    const w = u32(b, pos);
    if (w === 0) return;
    if (!(w & 0x80000000)) {
      throw new Desync(`strip header at chain level at 0x${pos.toString(16)}`);
    }
    const size = u32(b, pos + 0x4c);
    s.meshes++;
    if (size & 3) s.unalignedSize++;
    if (w & 1) s.pcwBit0Meshes++;
    const end = pos + MESH_HEADER + (size & ~3);
    if (end > b.length) throw new Desync(`mesh at 0x${pos.toString(16)} runs past the model`);
    let p = pos + MESH_HEADER;
    let env = 0;
    let plain = 0;
    while (p < end) {
      if (p + 8 > end) throw new Desync(`strip header straddles the mesh end at 0x${p.toString(16)}`);
      const flags = u32(b, p);
      const count = u32(b, p + 4);
      if (flags & 0x80000000) throw new Desync(`mesh header inside geometry at 0x${p.toString(16)}`);
      s.strips++;
      if (flags & 0x100) { s.envMapStrips++; env++; } else plain++;
      const n = flags & 8 ? count * 3 : count;
      p += 8;
      for (let i = 0; i < n; i++) {
        if (p + 4 > end) throw new Desync(`record straddles the mesh end at 0x${p.toString(16)}`);
        const w0 = u32(b, p);
        if (w0 & 1) {
          s.vertices++;
          p += 32;
        } else {
          s.backRefs++;
          if ((w0 >>> 20) !== 0x5ff) s.heuristicMisses++;
          p += 8;
        }
      }
    }
    if (p !== end) {
      throw new Desync(`geometry walk ended at 0x${p.toString(16)}, mesh declares 0x${end.toString(16)}`);
    }
    if (env && plain) s.mixedEnvMeshes++;
    pos = end;
  }
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("mesh_walk");
  const { source } = await openGame(dir);
  const c = new Checker("mesh_walk");

  const s: Stats = { meshes: 0, strips: 0, vertices: 0, backRefs: 0, heuristicMisses: 0,
                     unalignedSize: 0, pcwBit0Meshes: 0, envMapStrips: 0,
                     mixedEnvMeshes: 0 };
  const desyncs: string[] = [];
  let models = 0;
  for (const name of await polFiles(source)) {
    if (name.startsWith("pol_")) continue;
    let cont: C.Container;
    try {
      cont = C.load(await source.read(`pol/${name}`));
    } catch (exc) {
      // not-a-loss: a file that is not a container holds no model; the model
      // count asserted below is what says the walk saw the whole corpus.
      if (exc instanceof LZError || exc instanceof RangeError) continue;
      throw exc;
    }
    if ((cont.kind !== C.RAW && cont.kind !== C.COMPRESSED) || !cont.models.length) continue;
    cont.models.forEach(([start, end], i) => {
      const blob = cont.data.subarray(start, end);
      if (blob.length < CHAIN_START) return;
      const obj = u32(blob, 0);
      const flag = u32(blob, 4);
      if ((obj !== 0 && obj !== 1) || !(flag & 1) || (flag & ~0x1f)) return;
      models++;
      try {
        walkModel(blob, s);
      } catch (exc) {
        if (!(exc instanceof Desync)) throw exc;
        desyncs.push(`${name}[${i}]: ${exc.message}`);
      }
    });
  }

  c.ok(!desyncs.length, `the walk lands on every declared mesh end`
       + (desyncs.length ? `; ${desyncs.length} desyncs: ${desyncs.slice(0, 6).join("; ")}` : ""));
  count(c, models, EXPECT.models, "models walked");
  count(c, s.meshes, EXPECT.meshes, "meshes");
  count(c, s.strips, EXPECT.strips, "strips");
  count(c, s.vertices, EXPECT.vertices, "vertices");
  count(c, s.backRefs, EXPECT.backRefs, "back-references");
  count(c, s.heuristicMisses, 0, "back-references (word0 >> 20) == 0x5FF does not match");
  count(c, s.unalignedSize, 0, "meshes whose mesh_data_size has its low bits set");
  count(c, s.pcwBit0Meshes, EXPECT.pcwBit0Meshes, "meshes with parameter_control bit 0");
  count(c, s.envMapStrips, EXPECT.envMapStrips, "strips with bit 8 (environment mapping)");
  count(c, s.mixedEnvMeshes, 0, "meshes mixing bit-8 strips with others");

  c.finish();
}

await main();

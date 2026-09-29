/**
 * The player's two draw passes and translucent order, against the exe.
 *
 *     node tools/run_ts.mjs tools/checks/draw_order.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `src/render/draw_order.ts` puts `TranslatePvr2StateToD3D`'s state on every
 * exported material and gives the renderer `RenderCommandCompare`'s order.
 * Both halves rest on readings of the binary that no other check touches, and
 * the direction of the sort in particular turns on the sign of eye-space z,
 * which is read here from bytes rather than assumed. What this asserts:
 *
 *   * **The three tables are the port's.** `g_ZFuncTable`, `g_SrcBlendTable`
 *     and `g_DstBlendTable`, eight dwords each, against the arrays of the same
 *     names `draw_order.ts` exports -- imported, so the values compared are
 *     the ones the renderer runs.
 *   * **The pass state is where the port says.** `TranslatePvr2StateToD3D`
 *     sends `(tsp & 0x180000) != 0x80000` as state 0x0F, `ALPHATESTENABLE`;
 *     `RenderFlushCommandList` turns 0x1B, `ALPHABLENDENABLE`, on before the
 *     translucent pass and `RenderBeginCommandList` turns it off when the list
 *     opens; `RenderInitStates` sets `ALPHAREF` to the port's `ALPHA_REF`
 *     under `ALPHAFUNC` `GREATEREQUAL`. `WalkMeshChainAndDraw` selects the
 *     pass with the same mask, and lowers the sort depth to a skipped mesh's
 *     z only when it is less -- a minimum.
 *   * **Nearest first.** `RenderInitStates` installs `VIEW` =
 *     diag(1, 1, -1, 1) and `BuildPerspectiveProjection` builds a left-handed
 *     matrix (`_34` = 1), so eye z on the matrix stack is negative in front of
 *     the camera; `RenderCommandCompare` subtracts `a` from `b` and returns -1
 *     on a negative difference, which is descending. Together: the command
 *     whose least z -- its farthest point -- is greatest goes first.
 *   * **The corpus premise.** Every mesh in `pol/` has ISP bit 26 clear (depth
 *     write on) and compare mode 4 (`LESSEQUAL`). The port maps any value;
 *     `draw_order.ts` says "no mesh disables the depth write", and this is
 *     what keeps that sentence true.
 *   * **The bundle carries what the sort reads**, when one written by this
 *     tree's `gltf.ts` is present: every triangle primitive of every stage
 *     glTF has `hod2_model` and a four-number `hod2_sphere`. Without such a
 *     bundle that part is reported as not run (a stale one warns, L24); the
 *     rest still asserts.
 *
 * Exit 0 when it asserted things and they held, 1 when one did not, 3 with no
 * `--game-dir`.
 */
import { Checker, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import {
  bundleDir, bundleIsCurrent, bytesAt, checkSequences, polFiles, readGlb,
  stageGlbs, type Sequence,
} from "./lib_d3d";
import * as C from "../../src/hod2lib/container";
import { LZError } from "../../src/hod2lib/lz";
import * as nl1 from "../../src/hod2lib/nl1";
import {
  ALPHA_REF, G_DST_BLEND_TABLE, G_SRC_BLEND_TABLE, G_ZFUNC_TABLE,
} from "../../src/render/draw_order";
import type { NodeAssetSource } from "../lib/node_io";

const G_SRC_BLEND_TABLE_VA = 0x00598ab0;
const G_DST_BLEND_TABLE_VA = 0x00598ad0;
const G_ZFUNC_TABLE_VA = 0x00598b00;
const VIEW_MATRIX = 0x00598b38;

/**
 * Instruction sequences read off the disassembly; a different build or a
 * wrong reading fails here.
 */
const SEQUENCES: readonly Sequence[] = [
  [0x004a786b, "0f95c1516a0f",
   "TranslatePvr2StateToD3D: SETNZ CL; PUSH ECX; PUSH 0x0F "
   + "(ALPHATESTENABLE = pass is translucent)"],
  [0x004a785b, "81e200001800",
   "TranslatePvr2StateToD3D: AND EDX, 0x180000 (the pass bits)"],
  [0x004a7865, "81fa00000800",
   "TranslatePvr2StateToD3D: CMP EDX, 0x80000 (the opaque value)"],
  [0x004a8905, "6a016a1b",
   "RenderFlushCommandList: PUSH 1; PUSH 0x1B (ALPHABLENDENABLE on)"],
  [0x004a7a1e, "6a0024fc6a1b",
   "RenderBeginCommandList: PUSH 0; AND AL, 0xFC; PUSH 0x1B "
   + "(ALPHABLENDENABLE off; the AND aligns the queue pointer)"],
  [0x004a7666, "6a076a19",
   "RenderInitStates: PUSH 7; PUSH 0x19 (ALPHAFUNC GREATEREQUAL)"],
  [0x004a773e, "68388b59006a02",
   "RenderInitStates: PUSH 0x00598B38; PUSH 2 (SetTransform VIEW)"],
  [0x004a7f69, "8b45082500001800" + "3d00000800",
   "WalkMeshChainAndDraw: the same pass selector"],
  [0x004a7fbe, "d90538797e00d8d9dfe0f6c441",
   "WalkMeshChainAndDraw: FLD depth; FCOMP z; TEST AH, 0x41 "
   + "(keep the stored depth unless z is less: a minimum)"],
  [0x004a8a3c, "d94204d86104",
   "RenderCommandCompare: FLD [b+4]; FSUB [a+4] (b - a: descending)"],
  [0x004abd76, "c74424300000803f",
   "BuildPerspectiveProjection: _34 = 1.0 (left-handed)"],
];
/** `RenderInitStates`' `PUSH ref; PUSH 0x18`; the ref byte is the port's. */
const ALPHAREF_PUSH = 0x004a7657;

/** `[meshes, depth write disabled, compare mode not 4]` over `pol/`. */
async function corpus(source: NodeAssetSource): Promise<[number, number, number]> {
  let n = 0, nozw = 0, notle = 0;
  for (const name of await polFiles(source)) {
    let models: nl1.Model[];
    try {
      models = nl1.parseContainer(C.load(await source.read(`pol/${name}`)));
    } catch (exc) {
      // not-a-loss: not every file in pol/ is a model container; the mesh
      // count asserted below is what says the walk saw the whole corpus.
      if (exc instanceof nl1.NL1Error || exc instanceof LZError
          || exc instanceof RangeError) continue;
      throw exc;
    }
    for (const m of models) {
      for (const me of m.meshes) {
        n++;
        if (me.ispTsp & (1 << 26)) nozw++;
        if (((me.ispTsp >>> 29) & 7) !== 4) notle++;
      }
    }
  }
  return [n, nozw, notle];
}

function sameList(a: readonly number[] | null, b: readonly number[]): boolean {
  return !!a && a.length === b.length && a.every((v, i) => v === b[i]);
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("draw_order");
  const { source, exe } = await openGame(dir);
  const chk = new Checker("draw_order");
  const dwords = (va: number, n: number): number[] => {
    const b = bytesAt(exe, va, n * 4);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return Array.from({ length: n }, (_, i) => dv.getUint32(i * 4, true));
  };

  // -- the tables ----------------------------------------------------------
  for (const [va, name, port] of [
    [G_ZFUNC_TABLE_VA, "G_ZFUNC_TABLE", G_ZFUNC_TABLE],
    [G_SRC_BLEND_TABLE_VA, "G_SRC_BLEND_TABLE", G_SRC_BLEND_TABLE],
    [G_DST_BLEND_TABLE_VA, "G_DST_BLEND_TABLE", G_DST_BLEND_TABLE],
  ] as const) {
    const got = dwords(va, 8);
    chk.ok(sameList(port, got),
           `${name}: exe [${got.join(", ")}] at ${hex(va, 8)}, port [${port.join(", ")}]`);
  }

  // -- the instructions ------------------------------------------------------
  checkSequences(chk, exe, SEQUENCES);
  const ref = bytesAt(exe, ALPHAREF_PUSH, 4);
  chk.ok(ref[0] === 0x6a && ref[2] === 0x6a && ref[3] === 0x18,
         `${hex(ALPHAREF_PUSH, 8)} RenderInitStates: PUSH imm8; PUSH 0x18 (ALPHAREF)`);
  chk.eq(ALPHA_REF, ref[1], `ALPHA_REF is the exe's PUSH ${ref[1]}`);

  const vb = bytesAt(exe, VIEW_MATRIX, 64);
  const vdv = new DataView(vb.buffer, vb.byteOffset, 64);
  const view = Array.from({ length: 16 }, (_, i) => vdv.getFloat32(i * 4, true));
  chk.ok(sameList(view, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]),
         `the VIEW matrix at ${hex(VIEW_MATRIX, 8)} is diag(1, 1, -1, 1)`
         + ` [${view.join(", ")}]: under a left-handed projection negative z is`
         + " in front, so descending is nearest first");

  // -- the corpus ------------------------------------------------------------
  const [n, nozw, notle] = await corpus(source);
  chk.ok(n > 80000, `${n} meshes parsed from pol/ (more than 80000)`);
  chk.eq(nozw, 0, `meshes in pol/ that disable the depth write (ISP bit 26), of ${n}`);
  chk.eq(notle, 0, `meshes in pol/ that compare with a mode other than 4 (LESSEQUAL), of ${n}`);

  // -- the bundle ------------------------------------------------------------
  const bd = bundleDir();
  if (bd === null) {
    chk.note("bundle: none found -- the per-primitive extras were NOT checked"
             + " (export one, or set HOTD2_BUNDLE)");
  } else if (!bundleIsCurrent(bd)) {
    chk.note(`bundle: ${bd} was written by a different gltf.ts than this tree's`
             + " -- the per-primitive extras were NOT checked; re-export it");
  } else {
    let prims = 0, bad = 0;
    for (const glb of stageGlbs(bd)) {
      const { doc } = readGlb(glb);
      for (const mesh of doc.meshes ?? []) {
        for (const pr of mesh.primitives) {
          if (pr.material === undefined) continue;   // collision: no material, no draw
          prims++;
          const ex = pr.extras ?? {};
          const s = ex.hod2_sphere;
          if (!Number.isInteger(ex.hod2_model) || !Array.isArray(s) || s.length !== 4) bad++;
        }
      }
    }
    chk.ok(prims > 0, `${prims} drawn primitives in ${bd}`);
    chk.eq(bad, 0, `primitives in ${bd} without hod2_model and hod2_sphere, of ${prims}`);
  }

  chk.finish();
}

await main();

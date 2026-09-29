/**
 * A stage bundle carries all of a stage's scenery and all of its collision,
 * held against the game files it was made from.
 *
 *     node tools/run_ts.mjs tools/checks/geometry.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * Reads the bundle at `HOTD2_BUNDLE`, or `extract/player/`, and the game
 * through `src/hod2lib/`. Comparing two exports says only that two writers
 * agree, and a test of the bundle against itself says nothing about what it
 * left out; this compares every stage in the manifest with its sources.
 *
 * * **Every triangle the scenery's models declare is drawn** (`formats/nl1.md`:
 *   the game submits every strip whole, and no stage bundle asks for
 *   `dropCollapsedUvTriangles`). Per
 *   part -- `Stage.geometry`'s union of every region's asset slots and every
 *   slot opcode `0x50` loads -- the glTF's `<part>_model_<nnn>` meshes hold,
 *   in their `TRIANGLES` primitives, exactly the triangles `nl1` parses out of
 *   `pol/`. Per part and not per stage, because a stage total can hide a part
 *   that lost half its faces behind one that gained some, and exactly rather
 *   than at least, because a part that comes out long is a name collision.
 *   Stage 1 comes to 35,637, the figure `formats/nl1.md` gives for it.
 *   Meshes under other names -- rigs, characters, props, the rain -- are not
 *   scenery and are not counted.
 * * **The collision is the game's** (`formats/coli.md`, the bundle carries
 *   every blob of both files a scene loads). The `coli` block of
 *   `<stage>.script.json` names the two files `ColiLoadForScene` loads for the
 *   scene, and every blob with quads, keyed `<file>:<offset>`, carries each
 *   quad's plane, four vertices, axis tag and surface id equal to the parsed
 *   file, and the box the groups' AABBs merge to. The player runs its hit
 *   tests on these, so a transposed vertex or a stride off by one would read as
 *   plausible geometry and silently move walls.
 *
 * A bundle written by a different `gltf.ts` than this tree's is still held to
 * the game -- what it carries is the question -- and the run says so.
 *
 * Exit 0 when everything held, 1 when anything did not, 3 with no game
 * directory or no bundle.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BUNDLE_ROOT } from "../lib/bundle_root";
import { Checker, EXIT_SKIPPED, gameDirOrSkip, openGame } from "../lib/exe_check";
import { bundleDir, bundleIsCurrent, readGlb } from "./lib_d3d";
import * as colilib from "../../src/hod2lib/coli";
import { Stage } from "../../src/hod2lib/stage";

/** `<part>_model_<nnn>`, the name `gltf.ts` gives a scenery model's mesh. */
const MESH_NAME = /^(.+)_model_(\d{3})$/;
const TRIANGLES = 4;

/** `formats/nl1.md`: stage 1's scenery. */
const STAGE1_TRIANGLES = 35637;

interface ManifestStage {
  name: string;
  stage: number;
  game_mode: number;
  geometry: string;
  script: string;
}

interface Doc {
  meshes?: { name?: string; primitives: { mode?: number; indices?: number }[] }[];
  accessors?: { count: number }[];
}

interface ColiBlob {
  min: number[];
  max: number[];
  n: number;
  plane: number[];
  verts: number[];
  axis: number[];
  surface: number[];
}

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("geometry");
  const bd = bundleDir();
  if (bd === null) {
    console.log(`\nSKIP  geometry: no bundle under ${BUNDLE_ROOT}`);
    process.exit(EXIT_SKIPPED);
  }
  const { source } = await openGame(dir);
  const c = new Checker("geometry");
  if (!bundleIsCurrent(bd)) {
    c.note(`${bd} was written by a different gltf.ts than this tree's; held to the game regardless`);
  }
  const stages = (JSON.parse(readFileSync(join(bd, "manifest.json"), "utf8")) as
    { stages: ManifestStage[] }).stages;

  for (const entry of stages) {
    console.log(`\n${entry.name}`);
    const st = await Stage.create(source, { stage: entry.stage, original: entry.game_mode === 1 });

    // -- scenery triangles ------------------------------------------------------
    const want = new Map<string, number>();
    for (const [part, models] of (await st.geometry()).parts) {
      want.set(part, models.reduce((s, m) => s + m.triangleCount, 0));
    }
    const doc = readGlb(join(bd, entry.name, entry.geometry)).doc as unknown as Doc;
    const got = new Map<string, number>();
    for (const mesh of doc.meshes ?? []) {
      const m = MESH_NAME.exec(mesh.name ?? "");
      if (!m) continue;
      let tris = 0;
      for (const p of mesh.primitives) {
        if ((p.mode ?? TRIANGLES) !== TRIANGLES || p.indices === undefined) continue;
        tris += Math.floor((doc.accessors?.[p.indices]?.count ?? 0) / 3);
      }
      got.set(m[1]!, (got.get(m[1]!) ?? 0) + tris);
    }
    const off: string[] = [];
    for (const [part, tris] of want) {
      const have = got.get(part);
      if (have !== tris) {
        off.push(`${part}: ${have === undefined ? "absent" : have} of ${tris}`);
      }
    }
    const total = [...want.values()].reduce((a, b) => a + b, 0);
    c.ok(want.size > 0 && off.length === 0,
         `${want.size} scenery parts, ${total.toLocaleString("en-US")} triangles, `
         + `each part's meshes holding exactly its models' triangles`
         + (off.length ? `; not ${off.slice(0, 6).join(", ")}` : ""));
    const others = [...got.keys()].filter((k) => !want.has(k));
    if (others.length) c.note(`model meshes that are not scenery parts: ${others.join(", ")}`);
    if (entry.name === "stage1") {
      c.ok(total === STAGE1_TRIANGLES,
           `stage 1's scenery is ${total.toLocaleString("en-US")} triangles`
           + (total === STAGE1_TRIANGLES ? "" : `; formats/nl1.md states ${STAGE1_TRIANGLES}`));
    }

    // -- collision -------------------------------------------------------------
    const sets = await st.colisets();
    const coli = (JSON.parse(readFileSync(join(bd, entry.name, entry.script), "utf8")) as
      { coli?: { files?: string[]; blobs?: Record<string, ColiBlob> } }).coli ?? {};
    if (!c.ok(sets !== null, "the scene loads a collision pair") || sets === null) continue;
    const files = colilib.sceneFiles(st.scene);
    c.ok(same((coli.files ?? []).map((f) => files.indexOf(f)), [0, 1]),
         `the bundle names ${(coli.files ?? []).join(" and ")}, the files ColiLoadForScene loads`);
    const blobs = coli.blobs ?? {};
    const seen = new Set<string>();
    const wrong: string[] = [];
    let quads = 0;
    for (const f of sets) {
      for (const b of f.blobs) {
        const qs = colilib.blobQuads(b);
        if (!qs.length) continue;
        const key = `${f.name}:${b.offset}`;
        seen.add(key);
        const out = blobs[key];
        if (!out) { wrong.push(`${key} missing`); continue; }
        const lo = [0, 1, 2].map((k) => Math.min(...b.groups.map((g) => g.aabbMin[k]!)));
        const hi = [0, 1, 2].map((k) => Math.max(...b.groups.map((g) => g.aabbMax[k]!)));
        const ok = out.n === qs.length
          && same(out.plane, qs.flatMap((q) => [...q.normal, q.planeD]))
          && same(out.verts, qs.flatMap((q) => q.verts.flat()))
          && same(out.axis, qs.map((q) => q.axis))
          && same(out.surface, qs.map((q) => q.surface))
          && same(out.min, lo) && same(out.max, hi);
        if (!ok) wrong.push(`${key} differs from the file`);
        quads += qs.length;
      }
    }
    const extra = Object.keys(blobs).filter((k) => !seen.has(k));
    c.ok(seen.size > 0 && wrong.length === 0 && extra.length === 0,
         `${seen.size} collision blobs, ${quads} quads, each the parsed file's`
         + (wrong.length ? `; ${wrong.slice(0, 5).join(", ")}` : "")
         + (extra.length ? `; blobs in no file: ${extra.slice(0, 5).join(", ")}` : ""));
  }

  c.finish();
}

await main();

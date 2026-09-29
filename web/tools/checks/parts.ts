/**
 * The vertex-blended parts in a bundle, against the exe and the `pol/` models
 * they came from.
 *
 *     node tools/run_ts.mjs tools/checks/parts.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `g_pCharacterExtraParts` (`0x0052ED08`) gives a character type one or two
 * parts its skeleton does not name -- the waist between the chest and the
 * pelvis, the skirt between the pelvis and both thighs.
 * `DeformCharacterPartGroup` (`FUN_00419980`) re-transforms them every frame,
 * one bone per vertex and no weights, and the exporter says that in glTF as a
 * skinned primitive (`formats/civilians.md`, The waist and the skirt are not
 * in the skeleton either). Reads the bundle at `HOTD2_BUNDLE`, or
 * `extract/player/`, and holds every stage in its manifest to
 * `ExeTables.characterParts` and to `pol/`:
 *
 * 1. **The bundle's part table is the exe's**, row for row: slot, draw bone,
 *    the four group bones, the groups the drawer deforms, the number of
 *    logical vertices in the row table, and whether the port has read the
 *    drawer. Type `0x17`'s part 1 is the one the port has
 *    not, and it is described with `supported: false` and drawn nowhere.
 * 2. **Every part the port draws has a skinned node** under its character's
 *    rig wherever that rig is in the glTF -- every instance, because the
 *    exporter writes a hierarchy and a skin per spawn -- with `POSITION`,
 *    `NORMAL`, `JOINTS_0` and `WEIGHTS_0`.
 * 3. **Every weight is 1 in slot 0 and 0 in the other three**, and every
 *    joint index is inside the skin: the engine has no weights, and "each
 *    vertex has one bone and weight 1" is the reading.
 * 4. **Every joint is a `rig_joint` proxy**, never a bone node: `GLTFLoader`
 *    turns a node a skin names into a `Bone` and re-parents its mesh, which is
 *    what the gore swap and the severed head classify on (`src/hod2lib/gltf.ts`).
 * 5. **No skin carries `inverseBindMatrices`**: the exe's source vertices are
 *    already in their group bone's local space, so the inverse bind is the
 *    identity.
 * 6. **The positions are the exe's.** Every vertex a deformed group claims,
 *    through the part's row table and that group's assign bytes, is exported
 *    at the group's source vertex on the group's bone; every other vertex
 *    keeps the `pol/` model's stored position on the draw bone, because such a
 *    group's bone is the draw bone.
 *
 * Comparing two exports cannot see any of this. A part hung off the pelvis as
 * a rigid child has every count right, and a walking character's waist then
 * rides its hips instead of stretching to its chest.
 *
 * Exit 0 when everything held, 1 when anything did not, 3 with no game
 * directory or no bundle.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BUNDLE_ROOT } from "../lib/bundle_root";
import { Checker, EXIT_SKIPPED, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { bundleDir, bundleIsCurrent, readGlb } from "./lib_d3d";
import * as C from "../../src/hod2lib/container";
import type { CharacterPart } from "../../src/hod2lib/exetab";
import * as nl1 from "../../src/hod2lib/nl1";

/** The character type whose part 1 has a drawer the port has not read. */
const UNREAD_TYPE = 0x17;
const UNREAD_PART = 1;

interface ManifestStage { name: string; geometry: string; script: string }

interface BundlePart {
  slot: number;
  draw_bone: number;
  bones: (number | null)[];
  deformed: number[];
  rows?: number;
  supported?: boolean;
}

interface Node {
  name?: string;
  mesh?: number;
  skin?: number;
  extras?: { hod2_rig?: string; hod2_part?: string; hod2_kind?: string; hod2_bone?: number };
}

interface Prim {
  attributes: Record<string, number>;
  extras?: { hod2_chain_index?: number };
}

interface Doc {
  nodes?: Node[];
  meshes?: { primitives: Prim[] }[];
  skins?: { joints: number[]; inverseBindMatrices?: number }[];
  accessors?: { bufferView: number; componentType: number; count: number; type: string;
                byteOffset?: number }[];
  bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[];
}

const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const COMPONENT: Record<number, [number, (v: DataView, o: number) => number]> = {
  5121: [1, (v, o) => v.getUint8(o)],
  5123: [2, (v, o) => v.getUint16(o, true)],
  5125: [4, (v, o) => v.getUint32(o, true)],
  5126: [4, (v, o) => v.getFloat32(o, true)],
};

/** An accessor's elements, each an array of its components. */
function accessor(doc: Doc, bin: Uint8Array, i: number): number[][] {
  const a = doc.accessors![i]!;
  const view = doc.bufferViews![a.bufferView]!;
  const [size, read] = COMPONENT[a.componentType]!;
  const n = WIDTH[a.type]!;
  const stride = view.byteStride ?? n * size;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out: number[][] = [];
  for (let k = 0; k < a.count; k++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) row.push(read(dv, base + k * stride + j * size));
    out.push(row);
  }
  return out;
}

function sameRow(g: BundlePart, w: CharacterPart): boolean {
  const bones = w.groups.map((x) => x === null ? null : x.bone);
  return g.slot === w.slot && g.draw_bone === w.drawBone
    && JSON.stringify(g.bones) === JSON.stringify(bones)
    && JSON.stringify(g.deformed) === JSON.stringify(w.deformed)
    && g.rows === w.rows.length && g.supported === w.supported;
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("parts");
  const bd = bundleDir();
  if (bd === null) {
    console.log(`\nSKIP  parts: no bundle under ${BUNDLE_ROOT}`);
    process.exit(EXIT_SKIPPED);
  }
  const { source, exe } = await openGame(dir);
  const c = new Checker("parts");
  if (!bundleIsCurrent(bd)) {
    c.note(`${bd} was written by a different gltf.ts than this tree's; held to the exe regardless`);
  }
  const slots = exe.assetSlots();
  const polModels = new Map<string, nl1.Model[]>();
  const modelFor = async (slot: number): Promise<nl1.Model | null> => {
    const rec = slots.get(slot);
    if (!rec) return null;
    let models = polModels.get(rec[0]);
    if (!models) {
      models = nl1.parseContainer(C.load(await source.read(`pol/${rec[0]}`)));
      polModels.set(rec[0], models);
    }
    return models[rec[1]] ?? null;
  };

  const stages = (JSON.parse(readFileSync(join(bd, "manifest.json"), "utf8")) as
    { stages: ManifestStage[] }).stages;
  let skinnedVertices = 0;
  for (const entry of stages) {
    console.log(`\n${entry.name}`);
    const types = (JSON.parse(readFileSync(join(bd, entry.name, entry.script), "utf8")) as
      { characters?: { types?: Record<string, { name: string; parts?: (BundlePart | null)[] }> } })
      .characters?.types ?? {};
    const { doc: raw, bin } = readGlb(join(bd, entry.name, entry.geometry));
    const doc = raw as unknown as Doc;
    const nodes = doc.nodes ?? [];
    const rigsHere = new Set(nodes.map((nd) => nd.extras?.hod2_rig).filter((x) => x));
    const skinned = new Map<string, Node[]>();
    for (const nd of nodes) {
      if (nd.skin === undefined) continue;
      const key = `${nd.extras?.hod2_rig ?? ""}/${nd.extras?.hod2_part ?? ""}`;
      skinned.set(key, [...(skinned.get(key) ?? []), nd]);
    }

    // -- 1. the table ------------------------------------------------------------
    const tableOff: string[] = [];
    let rows = 0, drawn = 0, instances = 0;
    const geometryOff: string[] = [];
    for (const [key, ct] of Object.entries(types)) {
      const type = Number(key);
      const want = exe.characterParts(type);
      const got = ct.parts ?? null;
      if (got === null || got.length !== want.length) {
        tableOff.push(`type ${hex(type, 2)}: ${got === null ? "no" : got.length} rows, the exe ${want.length}`);
        continue;
      }
      for (let i = 0; i < want.length; i++) {
        const g = got[i] ?? null;
        const w = want[i] ?? null;
        if ((g === null) !== (w === null) || (g && w && !sameRow(g, w))) {
          tableOff.push(`type ${hex(type, 2)} part ${i}: ${JSON.stringify(g)} against the exe's `
                        + (w ? `slot ${hex(w.slot, 4)} draw bone ${w.drawBone} deformed [${w.deformed}]` : "null"));
          continue;
        }
        if (!g || !w) continue;
        rows++;
        const rig = `chr_${ct.name}`;
        const partName = `part${i}_${w.slot.toString(16).padStart(4, "0")}`;
        const insts = skinned.get(`${rig}/${partName}`) ?? [];
        if (!w.supported) {
          if (insts.length) geometryOff.push(`${rig} ${partName}: drawn, but its drawer is unread`);
          continue;
        }
        // -- 2. a skinned node wherever the rig is ------------------------------
        if (!insts.length) {
          if (rigsHere.has(rig)) geometryOff.push(`${rig} ${partName}: a table row and no skinned node`);
          continue;
        }
        drawn++;
        const model = await modelFor(w.slot);
        if (model === null) { geometryOff.push(`${rig} ${partName}: slot ${hex(w.slot, 4)} has no model`); continue; }
        const meshes = model.meshes.filter((m) => m.triangles.length && m.vertices.length);
        const rowOf = new Map<number, number>();
        w.rows.forEach((offs, r) => { for (const o of offs) rowOf.set(o, r); });
        for (const nd of insts) {
          instances++;
          const where = `${rig} ${partName} ${nd.name ?? ""}`;
          const skin = doc.skins?.[nd.skin!];
          if (!skin) { geometryOff.push(`${where}: no skin ${nd.skin}`); continue; }
          // -- 5. and 4. -------------------------------------------------------
          if (skin.inverseBindMatrices !== undefined) {
            geometryOff.push(`${where}: carries inverseBindMatrices`);
          }
          const jointBones: (number | undefined)[] = [];
          let proxies = true;
          for (const j of skin.joints) {
            const ex = nodes[j]?.extras;
            if (ex?.hod2_kind !== "rig_joint") proxies = false;
            jointBones.push(ex?.hod2_bone);
          }
          if (!proxies) { geometryOff.push(`${where}: a joint that is not a rig_joint proxy`); continue; }
          const prims = doc.meshes?.[nd.mesh!]?.primitives ?? [];
          if (prims.length !== meshes.length) {
            geometryOff.push(`${where}: ${prims.length} primitives, ${meshes.length} model meshes`);
            continue;
          }
          for (const prim of prims) {
            // Primitives are emitted opaque first, so a primitive's place in the
            // mesh is not its place in the chain; `hod2_chain_index` is.
            const ci = prim.extras?.hod2_chain_index;
            const sm = ci === undefined ? undefined : meshes[ci];
            if (sm === undefined) { geometryOff.push(`${where}: chain index ${ci}`); continue; }
            const at = prim.attributes;
            const missing = ["POSITION", "NORMAL", "JOINTS_0", "WEIGHTS_0"].filter((k) => !(k in at));
            if (missing.length) { geometryOff.push(`${where} primitive ${ci}: no ${missing.join(", ")}`); continue; }
            const pos = accessor(doc, bin, at.POSITION!);
            const jt = accessor(doc, bin, at.JOINTS_0!);
            const wt = accessor(doc, bin, at.WEIGHTS_0!);
            if (pos.length !== sm.vertices.length) {
              geometryOff.push(`${where} primitive ${ci}: ${pos.length} vertices, pol ${sm.vertices.length}`);
              continue;
            }
            for (let k = 0; k < pos.length; k++) {
              skinnedVertices++;
              // -- 3. one joint, weight 1 ----------------------------------------
              const [w0, w1, w2, w3] = wt[k]!;
              if (w0 !== 1 || w1 !== 0 || w2 !== 0 || w3 !== 0) {
                geometryOff.push(`${where} vertex ${k}: weights ${wt[k]!.join(",")}`);
                break;
              }
              const [j0, j1, j2, j3] = jt[k]!;
              if (j0! >= jointBones.length || j1 !== 0 || j2 !== 0 || j3 !== 0) {
                geometryOff.push(`${where} vertex ${k}: joints ${jt[k]!.join(",")} of ${jointBones.length}`);
                break;
              }
              // -- 6. whose vertex it is, from the exe ---------------------------
              let wantPos = sm.vertices[k]!.pos as number[];
              let wantBone = w.drawBone;
              const row = rowOf.get(sm.offsets[k] ?? -1);
              if (row !== undefined) {
                // The break belongs to the claim, not to the group: a deformed
                // group may not claim this row, and the next one may.
                for (const gi of w.deformed) {
                  const grp = w.groups[gi];
                  if (!grp) continue;
                  const a = grp.assign[row]!;
                  if (a >= 0 && a < grp.verts.length) {
                    wantPos = grp.verts[a]!.pos;
                    wantBone = grp.bone;
                    break;
                  }
                }
              }
              if (jointBones[j0!] !== wantBone) {
                geometryOff.push(`${where} vertex ${k}: bone ${jointBones[j0!]}, the exe says ${wantBone}`);
                break;
              }
              if (![0, 1, 2].every((i2) => pos[k]![i2] === Math.fround(wantPos[i2]!))) {
                geometryOff.push(`${where} vertex ${k}: (${pos[k]!.join(", ")}), the exe says (${wantPos.join(", ")})`);
                break;
              }
            }
          }
        }
      }
    }
    c.ok(rows > 0 && tableOff.length === 0,
         `${Object.keys(types).length} character types, ${rows} part rows, each the exe's`
         + (tableOff.length ? `; not ${tableOff.slice(0, 4).join("; ")}` : ""));
    c.ok(geometryOff.length === 0,
         `${drawn} drawn parts in ${instances} skinned instances: one weight, proxy joints, `
         + `no inverse binds, the exe's positions on the exe's bones`
         + (geometryOff.length ? `; ${geometryOff.length} wrong: ${geometryOff.slice(0, 4).join("; ")}` : ""));
    const t17 = types[String(UNREAD_TYPE)];
    if (t17) {
      const row = t17.parts?.[UNREAD_PART];
      c.ok(row !== null && row !== undefined && row.supported === false,
           `type ${hex(UNREAD_TYPE, 2)}'s part ${UNREAD_PART} is described with supported: false`);
    }
  }
  c.note(`${skinnedVertices} skinned vertices compared with the exe and pol/`);
  c.finish();
}

await main();

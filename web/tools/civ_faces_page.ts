/**
 * The in-page half of `tools/civ_faces.mjs`: photograph one part of every
 * civilian's rig, straight out of the bundle the player loads.
 *
 * It runs inside the player's own origin so it fetches the same
 * `bundle/stageN/stageN.glb` through the same `GLTFLoader`, which means the
 * materials it draws are the ones the player draws -- `KHR_materials_unlit`
 * turned into `MeshBasicMaterial`, no lights, blend modes and alpha exactly as
 * the exporter wrote them. Anything this picture is missing, the player is
 * missing too.
 *
 * Nothing in `src/` knows it exists, and it grants no power over the game: it
 * loads a file and renders it, the way any page could.
 */
import {
  Box3,
  Color,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface Shot {
  rig: string;
  part: string;
  /** `data:image/png;base64,...`, one per yaw in `YAWS`. */
  views: string[];
  /** `{material, alphaMode, doubleSided, vertices}` per primitive drawn. */
  prims: {
    name: string; transparent: boolean; opacity: number;
    alphaTest: number; depthWrite: boolean; side: number; verts: number;
  }[];
}

/** Front, both sides and back: hair is mostly not on the face. */
const YAWS = [0, 90, 180, 270];

export async function run(stage: number, partPrefix: string,
                          rigMatch = "", attach = true,
                          size = 320): Promise<Shot[]> {
  const gltf = await new GLTFLoader()
    .loadAsync(`bundle/stage${stage}/stage${stage}.glb`);
  const script = await (await fetch(
    `bundle/stage${stage}/stage${stage}.script.json`)).json();

  // What the bundle says each spawn wears, resolved the way
  // `ActorDrawAttachedParts` (`FUN_004124F0`) resolves it: the record's asset
  // slot, drawn on the record's bone, for every id at or above the split.
  // Ids below it are `ActorBindPartList`'s and replace a bone's own model,
  // which needs a game object; this shows the added half.
  const chars = script.characters ?? {};
  const records: { bone: number; slot: number }[] = chars.attachments ?? [];
  const split: number = chars.attachment_replaces_below ?? 0x24;
  /** rig name -> the accessory slots its first listed spawn asks for. */
  const wornBy = new Map<string, number[]>();
  for (const pl of chars.placements ?? []) {
    const ids: number[] = pl.attachments ?? [];
    if (!ids.length) continue;
    const t = chars.types?.[String(pl.char_type)];
    if (!t) continue;
    const rig = `chr_${t.name}`;
    if (wornBy.has(rig)) continue;
    wornBy.set(rig, ids.filter((i: number) => i >= split));
  }
  /** The hidden per-type templates, by asset slot -- `goreEntry`'s output. */
  const templates = new Map<number, Object3D>();
  gltf.scene.traverse((o) => {
    const m = /_gore_([0-9a-f]{4})$/.exec(o.name);
    if (m) templates.set(Number.parseInt(m[1], 16), o);
  });

  const wanted: Object3D[] = [];
  const seen = new Set<string>();
  gltf.scene.traverse((o) => {
    const ex = (o.userData ?? {}) as Record<string, string>;
    const rig = ex.hod2_rig ?? "";
    const part = ex.hod2_part ?? "";
    // `--part whole` photographs the rig root instead of one of its parts.
    // The exporter bakes a motion frame into the hierarchy, so a whole rig is
    // an assembled, posed character and not the heap a bind pose would be --
    // which is what a vertex-blended part has to be looked at inside.
    if (partPrefix === "whole") {
      if (ex.hod2_kind !== "rig" || !rig.startsWith("chr_")) return;
    } else if (ex.hod2_kind !== "rig_part" || !part.startsWith(partPrefix)) {
      return;
    }
    if (rigMatch) {
      if (!rig.includes(rigMatch)) return;
    } else if (!(rig.startsWith("chr_hito") || rig.startsWith("chr_deka")
                 || rig.startsWith("chr_hitoc"))) return;
    if (seen.has(rig)) return;
    seen.add(rig);
    wanted.push(o);
  });

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(new Color(0x303840), 1);

  const out: Shot[] = [];
  for (const node of wanted) {
    const ex = (node.userData ?? {}) as Record<string, string>;
    const clone = node.clone(true);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    clone.visible = true;
    clone.traverse((o) => { o.visible = true; });

    const scene = new Scene();
    const holder = new Object3D();
    holder.add(clone);
    scene.add(holder);

    const box = new Box3().setFromObject(clone);
    const centre = box.getCenter(new Vector3());
    const radius = box.getSize(new Vector3()).length() / 2 || 1;
    clone.position.sub(centre);

    const cam = new PerspectiveCamera(35, 1, 0.01, 1000);
    const dist = radius / Math.tan((35 / 2) * Math.PI / 180) * 1.25;

    // The accessories this rig's spawn wears, hung on the part exactly as
    // `CharacterLayer.syncAttachments` hangs them.
    if (attach) {
      for (const id of wornBy.get(ex.hod2_rig ?? "") ?? []) {
        const rec = records[id];
        const tmpl = rec && rec.slot ? templates.get(rec.slot) : undefined;
        if (!rec || !tmpl) continue;
        if (!(ex.hod2_part ?? "").startsWith(`bone${String(rec.bone)
          .padStart(2, "0")}`)) continue;
        const copy = tmpl.clone(true);
        copy.visible = true;
        copy.traverse((o) => { o.visible = true; });
        copy.position.set(0, 0, 0);
        copy.quaternion.identity();
        copy.scale.set(1, 1, 1);
        clone.add(copy);
      }
    }

    const prims: Shot["prims"] = [];
    clone.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const a = mat as unknown as {
          name: string; transparent: boolean; opacity: number;
          alphaTest: number; depthWrite: boolean; side: number;
        };
        prims.push({
          name: a.name, transparent: a.transparent, opacity: a.opacity,
          alphaTest: a.alphaTest, depthWrite: a.depthWrite, side: a.side,
          verts: m.geometry.getAttribute("position")?.count ?? 0,
        });
      }
    });

    const views: string[] = [];
    for (const yaw of YAWS) {
      const t = yaw * Math.PI / 180;
      cam.position.set(Math.sin(t) * dist, 0, Math.cos(t) * dist);
      cam.lookAt(0, 0, 0);
      renderer.render(scene, cam);
      views.push(canvas.toDataURL("image/png"));
    }
    out.push({ rig: ex.hod2_rig, part: ex.hod2_part ?? "whole", views,
               prims });
  }
  renderer.dispose();
  return out;
}

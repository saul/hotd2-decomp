/**
 * Class 0x2D's hand-drawn models -- `G.g_class2d_draws`, every
 * `AssetDrawSlot` / `AssetDrawSlotWithAlpha` the stage-6 boss's routines,
 * its satellites, children and tasks made this frame (`game/class2D/`) --
 * drawn.
 *
 * Each record carries the matrix its routine built, and which space that is
 * in: the world (a bone record, `Translate(pos)`) or the camera's own
 * (`MatrixLoadIdentity`, or the view with its rotation cleared). The node is
 * a clone of the slot's template hung under the matching group with that
 * whole matrix. Three more things ride on it:
 *
 * * **the alpha** -- `AssetDrawSlotWithAlpha`'s, through `setAssetDrawAlpha`,
 *   the forced blend at any value;
 * * **the UVs** -- a record made after `AssetSlotUVsFromViewNormals`
 *   (`FUN_00418660`) has every primitive the exporter marked `hod2_env_uv`
 *   rewritten from its normals through the modelview, as
 *   `ModelUVsFromViewNormals` (`FUN_004AA400`) rewrites the loaded model's
 *   (`docs/formats/nl1.md`). The node's geometry is its own copy, since the
 *   rewrite is per draw here;
 * * **the light** -- the set `LightsUseCustomSet` (`FUN_0041DC10`) installed
 *   for the draw, as `userData.hod2_light_set`, which `render/lighting.ts`
 *   lights the node's meshes with. A record with none is drawn under the
 *   scene's block 0.
 *
 * Slot `0x16B6`'s UVs are also scrolled: `Class2DScrollBurstModelUVs`
 * (`FUN_00429C90`) lowers every vertex's second coordinate by 0.005 in the
 * loaded model each call, and the port counts the calls
 * (`G.g_class2d_burst_uv_scroll`).
 *
 * Nothing here is state: every node is rebuilt from the frame's list.
 */
import {
  BufferAttribute, type BufferGeometry, type Group, Matrix4, type Mesh,
  type Object3D, type SkinnedMesh,
} from "three";
import { G } from "../game/globals";
import { setAssetDrawAlpha } from "./draw_order";

/** What this needs of the effect layer. */
export interface Class2DDrawHost {
  /** A node for `key` at `slot` under `parent`, re-cloned when the slot moves. */
  node(key: string, slot: number, parent: Group): Object3D | null;
  /** World-space draws, under the scene's lighting. */
  world: Group;
  /** Camera-space draws, the same. */
  view: Group;
  /** The camera's world-to-view matrix. */
  viewMatrix: Matrix4;
}

/** `PUSH 0x16B6` -- the burst's shell, whose UVs scroll. */
const BURST_SHELL = 0x16b6;
/** `FSUB qword ptr [0x0055D1B0]` -- 0.005 off `+0x1C` a call. */
const BURST_SCROLL = 0.005;

const _mv = new Matrix4();
const _m = new Matrix4();
const _j = new Matrix4();

/** Every record of this frame's list. */
export function drawClass2DDraws(h: Class2DDrawHost, seen: Set<string>): void {
  G.g_class2d_draws.forEach((d, i) => {
    const key = `c2d${i}`;
    const node = h.node(key, d.slot, d.view ? h.view : h.world);
    if (!node) return;
    seen.add(key);
    place(node, d.m);
    setAssetDrawAlpha(node, d.alpha);
    setLight(node, d.light);
    if (d.envUv) rewriteEnvUvs(node, h.viewMatrix);
    if (d.slot === BURST_SHELL) scrollUvs(node, G.g_class2d_burst_uv_scroll);
  });
}

/** Hang `node` under its parent with exactly the matrix the routine built. */
function place(node: Object3D, m: ArrayLike<number>): void {
  node.matrixAutoUpdate = false;
  node.matrix.fromArray(m as number[]);
  node.matrixWorldNeedsUpdate = true;
}

export function setLight(node: Object3D,
                  l: { ambient: number; dir: readonly number[];
                       rgb: readonly number[] } | null):
    void {
  if (l) {
    node.userData.hod2_light_set = { ambient: l.ambient, dir: [...l.dir],
                                     rgb: [...l.rgb] };
  } else {
    delete node.userData.hod2_light_set;
  }
}

/**
 * The geometry a mesh under `node` draws with, as the node's own copy --
 * made once, and freed with the node (`ownedGeometries`, `effects.ts`).
 */
function ownGeometry(owner: Object3D, mesh: Mesh): BufferGeometry {
  if (mesh.userData.c2dOwnGeometry) return mesh.geometry;
  const g = mesh.geometry.clone();
  g.userData = { ...mesh.geometry.userData };
  mesh.geometry = g;
  mesh.userData.c2dOwnGeometry = true;
  const list = (owner.userData.ownedGeometries as BufferGeometry[] | undefined)
    ?? [];
  list.push(g);
  owner.userData.ownedGeometries = list;
  return g;
}

/**
 * `ModelUVsFromViewNormals` on every marked primitive under `node`, through
 * this frame's modelview: `u = (1 - n.x) / 2`, `v = (1 + n.y) / 2` of the
 * normal taken through the top matrix's rotation rows, unnormalised -- a
 * scaled draw squeezes the UVs toward the middle, as the engine's does. A
 * skinned part's normals are its bones' first, as `DeformCharacterPartGroup`
 * leaves them before the draw. Exported for the character layer's parts.
 */
export function rewriteEnvUvs(node: Object3D, view: Matrix4): void {
  node.updateWorldMatrix(true, true);
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.geometry?.userData?.hod2_env_uv) return;
    const g = ownGeometry(node, mesh);
    const n = g.getAttribute("normal");
    const uv = g.getAttribute("uv");
    if (!n || !uv) return;
    _mv.multiplyMatrices(view, mesh.matrixWorld);
    const sk = mesh as SkinnedMesh;
    const joints = sk.isSkinnedMesh ? g.getAttribute("skinIndex") : null;
    const e = _mv.elements;
    for (let i = 0; i < n.count; i++) {
      let m = e;
      if (joints && sk.skeleton) {
        const j = joints.getX(i);
        const bone = sk.skeleton.bones[j];
        const inv = sk.skeleton.boneInverses[j];
        if (bone && inv) {
          _j.multiplyMatrices(bone.matrixWorld, inv);
          _m.multiplyMatrices(_mv, sk.bindMatrixInverse).multiply(_j)
            .multiply(sk.bindMatrix);
          m = _m.elements;
        }
      }
      const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
      const x = nx * m[0]! + ny * m[4]! + nz * m[8]!;
      const y = nx * m[1]! + ny * m[5]! + nz * m[9]!;
      uv.setXY(i, (1 - x) * 0.5, (1 + y) * 0.5);
    }
    uv.needsUpdate = true;
  });
}

const _f = new Float32Array(1);
const _u = new Uint32Array(_f.buffer);

/**
 * `Class2DScrollBurstModelUVs`' calls so far on the burst's shell, one step
 * per call as the routine makes it: `v = (float)(v - 0.005)` with the low
 * bit of the stored float forced on (`OR ECX, 1`). Stepped on from the
 * node's last count, and from the model's own UVs when the count went back.
 */
function scrollUvs(node: Object3D, count: number): void {
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const g = ownGeometry(node, mesh);
    const uv = g.getAttribute("uv") as BufferAttribute | undefined;
    if (!uv) return;
    let base = mesh.userData.c2dBaseUv as Float32Array | undefined;
    if (!base) {
      base = Float32Array.from(uv.array as ArrayLike<number>);
      mesh.userData.c2dBaseUv = base;
      mesh.userData.c2dScrolled = 0;
    }
    let done = (mesh.userData.c2dScrolled as number | undefined) ?? 0;
    if (count < done) {
      for (let i = 0; i < uv.count; i++) uv.setY(i, base[i * 2 + 1]!);
      done = 0;
    }
    for (; done < count; done++) {
      for (let i = 0; i < uv.count; i++) {
        _f[0] = uv.getY(i) - BURST_SCROLL;
        _u[0] = (_u[0]! | 1) >>> 0;
        uv.setY(i, _f[0]!);
      }
    }
    mesh.userData.c2dScrolled = done;
    uv.needsUpdate = true;
  });
}

/**
 * `CurlModelSlot7EEByYaw` — `FUN_004759C0`. The page turn of the boss cards'
 * backs.
 *
 * Both tarot-card intros -- `BossIntroBannerUpdate` (`FUN_00437AC0`) and the
 * Tower's own `Boss3IntroCardUpdate` (`FUN_00424900`) -- call it once per card
 * with that card's yaw, immediately before the card's `AssetDrawSlot`, in the
 * step that turns the cards over and in no other. It rewrites the **loaded
 * model** of asset slot `0x7EE`, `etc_2.bin[3]`: every full vertex's `z` from
 * its `x` and the yaw,
 *
 * ```
 * z = (float)(4.8e-05 - sin(ftol(x * 2058.112) BAMS) * (sin(yaw BAMS) * 4.0))
 * ```
 *
 * The model is one strip of 24 vertices running out from a hinge at `x = 0`
 * to `x = 7.96`, all at `z = 4.8e-05`, so `x * 2058.112` reaches a quarter
 * turn at the free edge: at yaw 0 the card is the model as loaded, and edge-on
 * (`-0x4000`) its free edge stands four units off the hinge's plane and lags
 * the turn, as a page does. `[proved]`, `functions.tsv`.
 *
 * ## One model, and one copy per card here
 *
 * The engine bends one model and draws every card from it. That still gives
 * each card its own bend because the mesh is in the **opaque pass** (TSP
 * `0x20080465`: `(tsp & 0x180000) == 0x80000`), which `RenderEnqueueCommand`
 * (`FUN_004A7E50`) draws on the spot -- `WalkMeshChainAndDraw(cmd, 0)` at
 * `0x004A7E8F`, before the next card's call rewrites the vertices; the queue
 * only ever holds a copy of the command, never the geometry. three.js draws
 * every card at the end of the frame, so the same picture needs a copy of the
 * geometry per card, owned by that card's node and freed with it
 * (`ownedGeometries`, see `effects.ts`). The template is never touched.
 *
 * In the step that does **not** call it, the model keeps whatever the last
 * call left: the last card's bend, and the last card never turns (yaw 0, which
 * is the model as loaded). {@link curlHeldYaw} says so where it is used.
 *
 * ## Which vertices
 *
 * The routine walks the model its own way -- from `+0x18`, a negative dword
 * (a mesh header) skips `0x50`, anything else is a strip `{flags, count}` of
 * `count` records, 32 bytes for a full vertex (bit 0 of its first byte) and 8
 * for a back-reference -- and writes every full vertex. The exporter emits one
 * glTF vertex per full vertex and none for a back-reference, so here it is
 * every vertex of the geometry. `tools/verify_card_curl.py` holds the walk
 * against the standard one over the shipped model, so a model the two walks
 * disagreed on would fail there rather than bend differently here.
 */
import { type BufferGeometry, Matrix4, type Mesh, type Object3D, Vector3 }
  from "three";
import { BAMS_TO_RAD_F64 } from "../core/bams";

/**
 * The one slot the routine bends. `[0x009AE58C]` (flags, `0x8000` resident)
 * and `[0x009AE584]` (the model) are the `+0x0C` and `+0x04` of the record at
 * `0x009A66A0 + 0x7EE * 0x10` -- `AssetDrawSlot`'s stride, `SHL EAX, 4` at
 * `0x00418576`.
 */
export const CURL_SLOT = 0x7ee;
/** `FMUL float [0x0055DD14]`, `0x4500A1CB`: model x to BAMS across the card. */
export const CURL_ACROSS = Math.fround(2058.112);
/** `FMUL double [0x004C4CA8]`: how far the free edge stands off, edge-on. */
export const CURL_DEPTH = 4.0;
/**
 * `FSUBR double [0x00569190]`, `0x3F092A7380000000`: the z every full vertex
 * is written from, which is `(float)4.8e-05` -- the model's own rest z.
 */
export const CURL_REST_Z = 4.8000001697801054e-05;

/**
 * One full vertex's new `z`: `0x004759F1..0x00475A3A`.
 *
 * `FLD float x; FMUL float [0x0055DD14]` is a product of two singles, which a
 * double holds exactly, and `__ftol` truncates it. The two `FSIN`s are on the
 * x87's 64-bit mantissa where this is on a double's 53; the result is stored
 * as a single, which is where the difference goes.
 */
export function curlZ(x: number, yaw: number): number {
  const across = Math.trunc(x * CURL_ACROSS);
  const s = Math.sin(across * BAMS_TO_RAD_F64);
  return Math.fround(CURL_REST_Z
                     - s * (Math.sin(yaw * BAMS_TO_RAD_F64) * CURL_DEPTH));
}

/**
 * The bend a card is drawn with in the step that does not call the curl --
 * the banner's step 3 (`0x00437DE9..0x00437E47`) and the Tower card's step 2.
 * The loaded model holds the last call of the turning step, which is the last
 * card's, so it is that card's yaw. Both intros seat every card at yaw 0
 * (`MOV [EAX+0xC], 0` at `0x00437B77`) and turn only the first six, so this
 * is 0 in every shipped run; it is written as the last card's yaw because
 * that is what the engine's model holds.
 */
export function curlHeldYaw(yaws: readonly number[]): number {
  return yaws[yaws.length - 1] ?? 0;
}

const _toModel = new Matrix4();
const _toMesh = new Matrix4();
const _v = new Vector3();

/**
 * Bend `node` -- a clone of slot `0x7EE`'s model -- to `yaw`, on geometry the
 * node owns. Copied from the template the first time, so the template and
 * every other card keep their own shape; re-bent only when the yaw moves.
 */
export function CurlModelSlot7EEByYaw(node: Object3D, yaw: number): void {
  if (node.userData.curlYaw === yaw) return;
  node.userData.curlYaw = yaw;
  node.traverse((o) => {
    const mesh = o as Mesh;
    let geo = mesh.geometry as BufferGeometry | undefined;
    if (!mesh.isMesh || !geo?.attributes?.position) return;
    if (!mesh.userData.curlOwnGeometry) {
      geo = geo.clone();
      mesh.geometry = geo;
      mesh.userData.curlOwnGeometry = true;
      const owned = (node.userData.ownedGeometries ??= []) as BufferGeometry[];
      owned.push(geo);
    }
    // The model's space is the node's; a mesh below it may carry a transform.
    _toModel.identity();
    for (let p: Object3D | null = mesh; p && p !== node; p = p.parent) {
      p.updateMatrix();
      _toModel.premultiply(p.matrix);
    }
    _toMesh.copy(_toModel).invert();
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(_toModel);
      _v.z = curlZ(_v.x, yaw);
      _v.applyMatrix4(_toMesh);
      pos.setXYZ(i, _v.x, _v.y, _v.z);
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
  });
}
